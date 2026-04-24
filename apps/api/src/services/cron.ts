import cron from 'node-cron';
import { DateTime } from 'luxon';
import { getFinanceCollection, getJournalCollection, getTodoCollection } from './db.js';
import { callLLM } from './llm.js';
import { appendHistory, getMemory, getRecentHistory } from './memory.js';
import { getFullSystemPrompt } from './context.js';
import { Message } from '@autoclaw/core';
import { getMonterreyWeather, formatWeatherForPrompt } from './weather.js';


const USER_ID = 'default';

// ─────────────────────────────────────────────
// Helper to send Telegram message
// ─────────────────────────────────────────────
async function sendTelegramMessage(chatId: string | number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_API;
  if (!botToken) {
    console.warn('[Cron] TELEGRAM_BOT_API not set — cannot send message');
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
    if (!res.ok) {
      console.error(`[Cron] Failed to send Telegram message: ${await res.text()}`);
    } else {
      console.log(`[Cron] ✅ Sent proactive message to chatId ${chatId}`);
    }
  } catch (e) {
    console.error('[Cron] Error sending Telegram message', e);
  }
}

async function afternoonFeelingsJob() {
  console.log('[Cron] Running afternoon feelings job...');

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  try {
    const mem = await getMemory(USER_ID);
    const model = mem?.preferredModel;
    const history = await getRecentHistory(USER_ID, 10);
    const basePrompt = await getFullSystemPrompt(USER_ID);

    const jobInstructions = `
[CRON JOB: CHECKUP MEDIODÍA]
Son las 2:30 PM (Monterrey). Tu tarea es hacer un check-in rápido.
1. Pregunta "cómo te va" o cómo va el progreso del día.
2. Mantenlo práctico y breve.
3. Usa el contexto de tareas arriba para ser específico si algo resalta.
4. NO preguntes "cómo te sientes" emocionalmente, enfócate en el ritmo del día.
    `.trim();

    const messages: Message[] = [
      { role: 'system', content: basePrompt },
      ...history,
      { 
        role: 'system', 
        content: `${jobInstructions}\n\nIMPORTANTE: Estás iniciando una interacción nueva. NO repitas el último mensaje del asistente ni respondas a él si no es necesario.\nTu objetivo es el checkup de mediodía.`
      }
    ];

    const response = await callLLM(messages, model);
    if (response) {
      // The response might be JSON because of getSystemPrompt rules
      let cleanResponse = response.trim();
      try {
        const parsed = JSON.parse(cleanResponse);
        if (parsed.text) cleanResponse = parsed.text;
      } catch (e) {
        // Not JSON, use as is
      }

      await sendTelegramMessage(chatId, cleanResponse);
      await appendHistory(USER_ID, { role: 'assistant', content: cleanResponse });
      console.log('[Cron] Afternoon checkup message sent.');
    }
  } catch (error) {
    console.error('[Cron] Error in afternoonFeelingsJob:', error);
  }
}

async function morningWakeupJob() {
  console.log('[Cron] Running morning wakeup job...');

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;

  try {
    const mem = await getMemory(USER_ID);
    const model = mem?.preferredModel;
    const history = await getRecentHistory(USER_ID, 10);
    const basePrompt = await getFullSystemPrompt(USER_ID);

    const weatherData = await getMonterreyWeather();
    const weatherString = formatWeatherForPrompt(weatherData);

    const jobInstructions = `
[CRON JOB: CHECKUP MATUTINO]
Son las 8:30 AM (Monterrey). Tu tarea es saludar y motivar.
${weatherString}
1. Pregunta amablemente si ya despertó.
2. Revisa los [ACTIVE TODOS] arriba y sugiere de forma motivadora continuar con lo más importante.
3. Sé breve y con un tono energético.
    `.trim();


    const messages: Message[] = [
      { role: 'system', content: basePrompt },
      ...history,
      { 
        role: 'system', 
        content: `${jobInstructions}\n\nIMPORTANTE: Estás iniciando el día. NO repitas saludos previos. Enfócate en la motivación matutina y las tareas pendientes.`
      }
    ];

    const response = await callLLM(messages, model);
    if (response) {
      let cleanResponse = response.trim();
      try {
        const parsed = JSON.parse(cleanResponse);
        if (parsed.text) cleanResponse = parsed.text;
      } catch (e) {
        // Not JSON, use as is
      }
      
      await sendTelegramMessage(chatId, cleanResponse);
      await appendHistory(USER_ID, { role: 'assistant', content: cleanResponse });
      console.log('[Cron] Morning wakeup message sent.');
    }
  } catch (error) {
    console.error('[Cron] Error in morningWakeupJob:', error);
  }
}

// ─────────────────────────────────────────────
// Nightly Checkup Task
// ─────────────────────────────────────────────
async function nightlyCheckupJob() {
  console.log('[Cron] Running nightly checkup job...');

  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!chatId) {
    console.warn('[Cron] TELEGRAM_CHAT_ID not set — skipping nightly job');
    return;
  }

  const nowMonterrey = DateTime.now().setZone('America/Monterrey');
  const startOfDay = nowMonterrey.startOf('day').toJSDate();
  const endOfDay = nowMonterrey.endOf('day').toJSDate();

  try {
    const mem = await getMemory(USER_ID);
    const model = mem?.preferredModel;
    const history = await getRecentHistory(USER_ID, 10);
    const basePrompt = await getFullSystemPrompt(USER_ID);

    // Check for expenses today for specific context
    const financeCol = getFinanceCollection();
    const expensesCount = await financeCol.countDocuments({
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    });
    const hasExpenses = expensesCount > 0;

    const jobInstructions = `
[CRON JOB: CHECKUP NOCTURNO]
Es el final del día (11 PM). Tu tarea es introspección y cierre.
1. Si NO registró gastos hoy (Registró gastos: ${hasExpenses ? 'SÍ' : 'NO'}), pregunta si se le olvidó algo de forma natural.
2. Pregunta cómo se siente hoy, qué avances hubo o qué reflexiones tiene para el diario.
3. Usa el contexto de [LAST 2 JOURNAL ENTRIES] y [RECENTLY COMPLETED TODOS] arriba para conectar con su día.
4. Genera UN SOLO mensaje corto e introspectivo.
    `.trim();

    const messages: Message[] = [
      { role: 'system', content: basePrompt },
      ...history,
      { 
        role: 'system', 
        content: `${jobInstructions}\n\nIMPORTANTE: Es el final del día. NO repitas interacciones previas. Sé introspectivo y cierra el día.`
      }
    ];

    const response = await callLLM(messages, model);

    if (response) {
      let cleanResponse = response.trim();
      try {
        const parsed = JSON.parse(cleanResponse);
        if (parsed.text) cleanResponse = parsed.text;
      } catch (e) {
        // Not JSON, use as is
      }
      
      await sendTelegramMessage(chatId, cleanResponse);
      await appendHistory(USER_ID, { role: 'assistant', content: cleanResponse });
      console.log('[Cron] Nightly checkup message sent and stored in history.');
    }

  } catch (error) {
    console.error('[Cron] Error in nightlyCheckupJob:', error);
  }
}

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────
export function initCronJobs() {
  // Every day at 23:00 (11 PM) Monterrey time
  // node-cron uses server time. We need to calculate the cron pattern based on server time 
  // OR use a scheduling library that supports timezones.
  // node-cron doesn't natively support timezones in the pattern, but we can wrap it.
  
  // Alternative: Run every hour and check if it's 11 PM in Monterrey.
  // Or better: use 'cron' package which supports timezones, but I installed node-cron.
  
  // With node-cron, we'll run every minute and check the hour in Monterrey.
  cron.schedule('* * * * *', () => {
    const nowMTY = DateTime.now().setZone('America/Monterrey');
    
    // 8:30 AM
    if (nowMTY.hour === 8 && nowMTY.minute === 30) {
      morningWakeupJob();
    }
    
    // 2:30 PM (14:30)
    if (nowMTY.hour === 14 && nowMTY.minute === 30) {
      afternoonFeelingsJob();
    }
    
    // 11:00 PM
    if (nowMTY.hour === 23 && nowMTY.minute === 0) {
      nightlyCheckupJob();
    }
  });

  console.log('[Cron] Cron jobs initialized (Check at 8:30 AM, 2:30 PM and 11 PM Monterrey)');
}
