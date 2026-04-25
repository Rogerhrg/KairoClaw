import { Message } from '@autoclaw/core';
import dotenv from 'dotenv';
dotenv.config();

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export interface AudioPayload {
  base64: string;     // raw base64 (NO data URI prefix)
  mimeType: string;   // e.g. "audio/ogg"
}

// ─────────────────────────────────────────────
// Provider: NVIDIA / OpenRouter (OpenAI-compatible)
// ─────────────────────────────────────────────
const callNvidiaModel = async (
  messages: Message[],
  model: string,
): Promise<string> => {
  const llmUrl = 'https://integrate.api.nvidia.com/v1';
  const llmToken = process.env.NVIDIA_KEY;
  if (!llmToken) throw new Error('Missing NVIDIA_KEY');

  const response = await fetch(`${llmUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmToken}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    }),
  });

  if (!response.ok) throw new Error(`NVIDIA ${model} → Status ${response.status}: ${await response.text()}`);

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`NVIDIA ${model} returned empty content`);
  return content;
};

// ─────────────────────────────────────────────
// Provider: Google AI Studio (Gemini)
// Supports text-only and text+audio via inline_data
// ─────────────────────────────────────────────
const callGemini = async (
  messages: Message[],
  audio?: AudioPayload,
  model = 'gemini-1.5-flash',
): Promise<string> => {
  const apiKey = process.env.GEMINI_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_KEY');

  // Convert OpenAI-style messages into Gemini "contents" format
  // System prompt goes into systemInstruction
  const systemMsg = messages.find(m => m.role === 'system');
  const conversationMsgs = messages.filter(m => m.role !== 'system');

  const contents = conversationMsgs.map((m, idx) => {
    const isLast = idx === conversationMsgs.length - 1;
    const parts: any[] = [{ text: m.content }];

    // Attach audio only to the last user message
    if (isLast && m.role === 'user' && audio) {
      parts.push({
        inline_data: {
          mime_type: audio.mimeType,
          data: audio.base64,
        },
      });
    }

    return {
      role: m.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  });

  const requestBody: any = { contents };
  if (systemMsg) {
    requestBody.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) throw new Error(`Gemini ${model} → Status ${response.status}: ${await response.text()}`);

  const data: any = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error(`Gemini ${model} returned empty content`);
  return content;
};

// ─────────────────────────────────────────────
// Provider: OpenRouter (OpenAI-compatible)
// ─────────────────────────────────────────────
const callOpenRouterModel = async (
  messages: Message[],
  model: string,
): Promise<string> => {
  const llmToken = process.env.OPENROUTER_API_KEY;
  if (!llmToken) throw new Error('Missing OPENROUTER_API_KEY');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmToken}`,
      'HTTP-Referer': 'https://github.com/Rogerhrg/AutoClaw',
      'X-Title': 'AutoClaw',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[OpenRouter Error] Model: ${model}, Status: ${response.status}, Body: ${errorBody}`);
    throw new Error(`OpenRouter ${model} → Status ${response.status}: ${errorBody}`);
  }

  const data: any = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.error(`[OpenRouter Error] Model: ${model} returned empty data:`, JSON.stringify(data));
    throw new Error(`OpenRouter ${model} returned empty content`);
  }
  return content;
};

// ─────────────────────────────────────────────
// Main router
// Priority:
//   Text:  targetModel → Kimi → Nemotron → Minimax → Gemini Flash
//   Audio: Gemini Flash
// ─────────────────────────────────────────────
export const callLLM = async (
  messages: Message[],
  targetModel?: string,
  audio?: AudioPayload,
): Promise<string> => {

  // If audio is present, bypass secondary providers and go directly to Gemini
  if (audio) {
    console.log('[LLM Router] Audio payload detected → routing to Gemini 2.5 Flash');
    return callGemini(messages, audio, 'gemini-2.5-flash');
  }

  // Build text model priority queue
  // Fallback order: Nemotron -> Kimi -> Minimax -> Gemini Flash
  const modelsToTry: Array<{ model: string; provider: 'nvidia' | 'openrouter' | 'google' }> = [];

  // 1. Gemma 4 31b (OpenRouter) - NEW PRIMARY
  modelsToTry.push({ model: 'google/gemma-4-31b-it:free', provider: 'openrouter' });

  // 2. Nemotron (OpenRouter)
  modelsToTry.push({ model: 'nvidia/nemotron-3-super-120b-a12b:free', provider: 'openrouter' });

  // 3. Kimi (NVIDIA)
  modelsToTry.push({ model: 'moonshotai/kimi-k2.5', provider: 'nvidia' });

  // 3. Minimax (NVIDIA)
  modelsToTry.push({ model: 'minimaxai/minimax-m2.7', provider: 'nvidia' });

  // If targetModel was provided from UI, it always goes first
  if (targetModel) {
    const existingIdx = modelsToTry.findIndex(m => m.model === targetModel);
    if (existingIdx !== -1) {
      const entry = modelsToTry.splice(existingIdx, 1)[0];
      modelsToTry.unshift(entry);
    } else {
      // Default to NVIDIA for unknown target models
      modelsToTry.unshift({ model: targetModel, provider: 'nvidia' });
    }
  }

  let lastError: any = null;

  for (const entry of modelsToTry) {
    try {
      console.log(`[LLM Router] Trying ${entry.provider.toUpperCase()} model: ${entry.model}`);
      if (entry.provider === 'nvidia') {
        return await callNvidiaModel(messages, entry.model);
      } else if (entry.provider === 'openrouter') {
        return await callOpenRouterModel(messages, entry.model);
      }
    } catch (err: any) {
      console.warn(`[LLM Router] ${entry.provider.toUpperCase()} '${entry.model}' failed: ${err.message}`);
      lastError = err;
    }
  }

  // 4. Last Fallback: Google Gemini Flash
  try {
    const fallbackGemini = targetModel?.startsWith('gemini-') ? targetModel : 'gemini-2.5-flash';
    console.log(`[LLM Router] Routing to Gemini (Last Fallback): ${fallbackGemini}`);
    return await callGemini(messages, undefined, fallbackGemini);
  } catch (err: any) {
    console.warn(`[LLM Router] Gemini fallback failed: ${err.message}`);
    lastError = err;
  }

  throw new Error(`All LLM routing layers failed. Last error: ${lastError?.message}`);
};
