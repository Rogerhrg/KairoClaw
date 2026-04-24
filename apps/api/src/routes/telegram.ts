import { FastifyInstance, FastifyRequest } from 'fastify';

function parseAllowedChatId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAllowedTelegramChat(chatId: unknown): boolean {
  const allowedChatId = parseAllowedChatId(process.env.TELEGRAM_CHAT_ID);
  // If TELEGRAM_CHAT_ID isn't configured, keep current behavior (process all chats).
  if (allowedChatId === null) return true;
  const parsedChatId = Number(chatId);
  return Number.isFinite(parsedChatId) && parsedChatId === allowedChatId;
}

// Download a Telegram file and return it as a base64 string
async function downloadTelegramFile(fileId: string, botToken: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    // 1. Get file path from Telegram
    const metaRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`);
    const metaJson: any = await metaRes.json();
    if (!metaJson.ok) throw new Error(`getFile failed: ${JSON.stringify(metaJson)}`);
    const filePath = metaJson.result.file_path;

    // 2. Download binary content
    const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
    if (!fileRes.ok) throw new Error(`File download failed: ${fileRes.status}`);
    const arrayBuffer = await fileRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Telegram voice = ogg/opus; video_note = mp4
    const mimeType = filePath.endsWith('.mp4') ? 'audio/mp4' : 'audio/ogg';
    return { base64, mimeType };
  } catch (e) {
    console.error('[Telegram] Failed to download file', e);
    return null;
  }
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendTelegramMessage(botToken: string, chatId: string | number, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      chat_id: chatId, 
      text, 
      parse_mode: 'HTML' 
    }),
  });
}

export default async function (fastify: FastifyInstance) {

  fastify.post('/api/telegram/webhook', async (request: FastifyRequest, reply) => {
    const body = request.body as any;
    const botToken = process.env.TELEGRAM_BOT_API;

    if (!body?.message) return reply.send({ status: 'ok' });

    const chatId = body.message.chat.id;

    // Security: ignore messages from any chat that isn't TELEGRAM_CHAT_ID.
    if (!isAllowedTelegramChat(chatId)) {
      return reply.send({ status: 'ok' });
    }

    // ─── /model command (text only) ───────────────────────────────
    if (body.message.text?.startsWith('/model')) {
      const parts = body.message.text.split(' ');
      const newModel = parts[1]?.trim();
      const userId = String(chatId);
      if (newModel) {
        const { updatePreferredModel, getMemory } = await import('../services/memory.js');
        const mem = await getMemory(userId);
        if (mem.preferredModel !== newModel) await updatePreferredModel(userId, newModel);
        if (botToken) await sendTelegramMessage(botToken, chatId, `Modelo cambiado a: <b>${escapeHTML(newModel)}</b>`);
      } else {
        if (botToken) {
          const { getMemory } = await import('../services/memory.js');
          const mem = await getMemory(userId);
          const current = mem?.preferredModel || process.env.LLM_MODEL || 'moonshotai/kimi-k2.5';
          await sendTelegramMessage(botToken, chatId, `Modelo actual: <b>${escapeHTML(current)}</b>\nPara cambiarlo: <code>/model &lt;nombre&gt;</code>`);
        }
      }
      return reply.send({ status: 'ok' });
    }

    // ─── Determine message type ────────────────────────────────────
    const isVoice = !!body.message.voice;
    const isVideoNote = !!body.message.video_note;
    const hasText = !!body.message.text;

    if (!hasText && !isVoice && !isVideoNote) {
      return reply.send({ status: 'ok' }); // unsupported message type
    }

    // ─── Inject into our internal /api/chat pipeline ────────────────
    const basicToken = Buffer.from(`${process.env.USER_EMAIL}:${process.env.USER_PASSWORD}`).toString('base64');
    
    // We respond to Telegram immediately to prevent retries if the LLM takes > 30s.
    // The actual processing and reply sending happens in the background.
    (async () => {
      try {
        const injectionPayload: Record<string, any> = {
          telegramChatId: chatId,
        };

        if (hasText) {
          injectionPayload.message = body.message.text;
        } else if ((isVoice || isVideoNote) && botToken) {
          const fileId = isVoice ? body.message.voice.file_id : body.message.video_note.file_id;
          const audioData = await downloadTelegramFile(fileId, botToken);
          if (!audioData) {
            if (botToken) await sendTelegramMessage(botToken, chatId, 'No pude procesar el audio. Intenta de nuevo.');
            return;
          }
          injectionPayload.message = '[VOICE NOTE — process the audio attached]';
          injectionPayload.audio = audioData;
        }

        const res = await fastify.inject({
          method: 'POST',
          url: '/api/chat',
          payload: injectionPayload,
          headers: { 'authorization': `Basic ${basicToken}` },
        });

        const parsed = JSON.parse(res.payload);
        
        if (parsed.error) {
          if (botToken) {
            await sendTelegramMessage(
              botToken, 
              chatId, 
              `⚠️ <b>Error de IA:</b>\n<i>${escapeHTML(parsed.error)}</i>${parsed.details ? `\n\n<pre><code>${escapeHTML(parsed.details)}</code></pre>` : ''}`
            );
          }
          return;
        }

        const responseObj = parsed.response;
        let finalContent = '';
        if (typeof responseObj === 'object' && responseObj !== null) {
          finalContent = responseObj.text || '';
          if (responseObj.code) {
            finalContent += `\n\n<pre><code>${escapeHTML(responseObj.code)}</code></pre>`;
          }
        } else {
          finalContent = String(responseObj || 'Sin respuesta');
        }

        if (botToken && finalContent) {
          await sendTelegramMessage(botToken, chatId, finalContent);
        }
      } catch (e) {
        console.error('[Telegram] Error processing background reply', e);
        if (botToken) {
          try {
            await sendTelegramMessage(botToken, chatId, '❌ <b>Error crítico:</b> No se pudo procesar la respuesta del servidor.');
          } catch {}
        }
      }
    })();

    return reply.send({ status: 'ok' });
  });
}
