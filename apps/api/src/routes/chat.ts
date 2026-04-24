import { FastifyInstance, FastifyRequest } from 'fastify';
import { getSystemPrompt, Message, buildContextPrompt } from '@autoclaw/core';
import { DateTime } from 'luxon';
import { callLLM } from '../services/llm.js';
import type { AudioPayload } from '../services/llm.js';
import { getMemory, appendHistory, getRecentHistory, checkAndSummarizeMemory, getStructuredMemory, } from '../services/memory.js';
import { getDistinctExercises, getDistinctFinanceCategories, getTodoCollection, getJournalCollection, } from '../services/db.js';
import { triggerN8N } from '../services/n8n.js';
import { scheduleReminder } from '../services/reminders.js';
import { googleService } from '../services/google.js';
import { upsertPendingConfirmation } from '../services/entities.js';
import { parseLLMResponse } from '../services/llm-parser.js';
import { processDbAction } from '../services/actions.js';
import { handlePendingConfirmation } from '../services/confirmation-handler.js';
import { normalizeText } from '../services/actions.js';
import { getFullSystemPrompt } from '../services/context.js';
import { getMonterreyWeather, formatWeatherForPrompt } from '../services/weather.js';


const USER_ID = 'default';
const MONTERREY_TZ = 'America/Monterrey';

export default async function chatRoute(fastify: FastifyInstance) {
  fastify.post(
    '/api/chat',
    async (
      request: FastifyRequest<{
        Body: { message: string; audio?: AudioPayload; telegramChatId?: number };
      }>,
      reply,
    ) => {
      const userMessage = request.body?.message;
      const audio = request.body?.audio;
      const telegramChatId = request.body?.telegramChatId;
      if (!userMessage) return reply.status(400).send({ error: 'Message is required' });

      await appendHistory(USER_ID, { role: 'user', content: userMessage });

      // -----------------------------------------------------------------------
      // Immediate structured memory extraction on explicit request
      // -----------------------------------------------------------------------
      const rememberPattern = /^(recuerda|recordar|apunta|memo|guardar en memoria)\b/i;
      if (rememberPattern.test(normalizeText(userMessage))) {
        const { extractAndMergeStructuredMemory } = await import('../services/memory.js');
        await extractAndMergeStructuredMemory(USER_ID, `USER EXPLICIT REQUEST: ${userMessage}`);
      }

      // -----------------------------------------------------------------------
      // Pending confirmation state machine
      // -----------------------------------------------------------------------
      const confirmationResult = await handlePendingConfirmation(userMessage);
      if (confirmationResult.response !== null) {
        await appendHistory(USER_ID, { role: 'assistant', content: confirmationResult.response });
        checkAndSummarizeMemory(USER_ID);
        return reply.send({ response: { text: confirmationResult.response } });
      }

      // -----------------------------------------------------------------------
      // Build LLM context
      // -----------------------------------------------------------------------
      const mem = await getMemory(USER_ID);
      const systemPrompt = await getFullSystemPrompt(USER_ID);
      const history = await getRecentHistory(USER_ID, 15);

      // Split system prompt into Identity and Tools/Context to ensure identity is not ignored
      const soulInstructions = await (await import('@autoclaw/core')).getSoulPrompt();
      const messages: Message[] = [
        { role: 'system', content: soulInstructions },
        { role: 'system', content: systemPrompt.replace(soulInstructions, '').trim() },
        ...history,
        { role: 'user', content: userMessage },
      ];

      try {
        // -----------------------------------------------------------------------
        // LLM call + retrieval loop (queries / Google)
        // -----------------------------------------------------------------------
        let rawResponse = await callLLM(messages, mem?.preferredModel, audio);
        console.log(`[RAW LLM RESPONSE]: ${rawResponse}`);

        let loopCount = 0;
        const calendarListRegex = /<calendar_list\s+from="([^"]*)"\s+to="([^"]*)"\s*\/>/;
        const weatherGetRegex = /<weather_get\s*\/>/;

        while (loopCount < 2) {
          const parsed = parseLLMResponse(rawResponse);
          const { query, gmailList, gmailRead, calendarList } = parsed;
          const cListMatch = rawResponse.match(calendarListRegex);
          const wGetMatch = rawResponse.match(weatherGetRegex);

          if (!query && !gmailList && !gmailRead && !calendarList && !cListMatch && !wGetMatch) break;

          console.log(`[LOOP ${loopCount}] Tool detected:`, { 
            query: !!query, 
            gmailList: !!gmailList, 
            gmailRead: !!gmailRead, 
            calendarList: !!calendarList,
            cListMatch: !!cListMatch,
            wGetMatch: !!wGetMatch
          });

          let systemResult = '';
          try {
            if (query) {
              const parsedQuery: any = query.payload;
              const collName = parsedQuery.collection;
              const queryLimit = parsedQuery.limit || parsedQuery.query?.LIMIT || 5;
              const rawQuery = parsedQuery.query || {};

              if (
                rawQuery.timestamp &&
                typeof rawQuery.timestamp === 'string' &&
                /^\d{4}-\d{2}-\d{2}$/.test(rawQuery.timestamp)
              ) {
                const day = DateTime.fromISO(rawQuery.timestamp, { zone: MONTERREY_TZ });
                if (day.isValid) {
                  rawQuery.timestamp = {
                    $gte: day.startOf('day').toJSDate(),
                    $lte: day.endOf('day').toJSDate(),
                  };
                }
              }

              const { getGymCollection, getFinanceCollection, getTodoCollection: getTodo, getJournalCollection } = await import('../services/db.js');
              const colMap: Record<string, () => any> = {
                gym: getGymCollection,
                finance: getFinanceCollection,
                todo: getTodo,
                journal: getJournalCollection,
              };

              // Normalize gym query
              const normalizedQuery = collName === 'gym'
                ? (() => {
                  const q = { ...rawQuery };
                  if (typeof q.exercise === 'string' && !q.exerciseName) {
                    q.exerciseName = q.exercise;
                    delete q.exercise;
                  }
                  return q;
                })()
                : rawQuery;

              const res = colMap[collName]
                ? await colMap[collName]().find(normalizedQuery).sort({ _id: -1 }).limit(queryLimit).toArray()
                : [];
              console.log(`[LOOP ${loopCount}] Query [${collName}] result count: ${res.length}`);
              systemResult = `[SYSTEM: QUERY RESULT]\n${JSON.stringify(res)}`;
            } else if (gmailList) {
              console.log(`[LOOP ${loopCount}] Gmail List: ${gmailList.payload.query}`);
              const res = await googleService.listEmails(gmailList.payload.query, gmailList.payload.max);
              systemResult = `[SYSTEM: GOOGLE RESULT]\n${JSON.stringify(res)}`;
            } else if (gmailRead) {
              console.log(`[LOOP ${loopCount}] Gmail Read: ${gmailRead.payload.id}`);
              const res = await googleService.getEmailContent(gmailRead.payload.id);
              systemResult = `[SYSTEM: GOOGLE RESULT]\n${JSON.stringify(res)}`;
            } else if (calendarList) {
              console.log(`[LOOP ${loopCount}] Calendar List: ${calendarList.payload.from} to ${calendarList.payload.to}`);
              const res = await googleService.listEvents('primary', calendarList.payload.from, calendarList.payload.to);
              systemResult = `[SYSTEM: GOOGLE RESULT]\n${JSON.stringify(res)}`;
            } else if (cListMatch) {
              const res = await googleService.listEvents('primary', cListMatch[1], cListMatch[2]);
              systemResult = `[SYSTEM: GOOGLE RESULT]\n${JSON.stringify(res)}`;
            } else if (wGetMatch) {
              const weather = await getMonterreyWeather();
              systemResult = `[SYSTEM: WEATHER RESULT]\n${formatWeatherForPrompt(weather)}`;
            }
          } catch (e) {
            systemResult = `[SYSTEM: ERROR] ${(e as Error).message}`;
          }

          messages.push({ role: 'assistant', content: rawResponse });
          messages.push({ role: 'user', content: systemResult });
          rawResponse = await callLLM(messages, mem?.preferredModel);
          loopCount++;
        }

        // -----------------------------------------------------------------------
        // Parse the final LLM response into structured parts
        // -----------------------------------------------------------------------
        const parsed = parseLLMResponse(rawResponse);
        let { text: responseText, code: responseCode } = parsed;

        console.log(`[DEBUG] dbAction found: ${!!parsed.dbAction}`);
        console.log(`[DEBUG] n8nAction found: ${!!parsed.n8nAction}`);
        console.log(`[DEBUG] reminder found: ${!!parsed.reminder}`);

        // -----------------------------------------------------------------------
        // Execute db_action(s) (if any)
        // The LLM's own conversational text is always preserved.
        // We only override with a system message when a confirmation is needed.
        // -----------------------------------------------------------------------
        for (const action of parsed.dbActions) {
          const data = action.payload.data || {};

          // Ask for hour on past entries (except journal)
          if (data.date && !data.hour && action.payload.type !== 'journal') {
            const prompt = `¿A qué hora aproximadamente fue el registro del ${data.date}?`;
            await upsertPendingConfirmation({
              userId: USER_ID,
              status: 'pending',
              type: 'data_completion',
              prompt,
              payload: { originalAction: action.payload },
            });
            responseText = prompt;
            // Stop processing further actions if one needs confirmation/input
            break;
          } else {
            try {
              const result = await processDbAction(action.payload);
              // Only override the conversational text when a confirmation dialog must start
              if (result.requiresConfirmation && result.ack) {
                responseText = result.ack;
              }
              // Otherwise: keep the LLM's own response — it's already conversational
            } catch (e) {
              console.error('[chat] Failed to process db action:', e);
              responseText = 'Lo siento, hubo un error al procesar el registro.';
            }
          }
        }

        // -----------------------------------------------------------------------
        // Execute n8n action (if any)
        // -----------------------------------------------------------------------
        if (parsed.n8nAction) {
          try {
            await triggerN8N(parsed.n8nAction.payload.action as string, parsed.n8nAction.payload.data as any);
          } catch (e) {
            console.error('[chat] n8n trigger failed:', e);
          }
        }

        // -----------------------------------------------------------------------
        // Execute reminder (if any)
        // -----------------------------------------------------------------------
        if (parsed.reminder) {
          const r = parsed.reminder.payload;
          if (telegramChatId && r.message && r.fireAt) {
            try {
              await scheduleReminder({
                chatId: telegramChatId,
                message: r.message as string,
                fireAt: new Date(r.fireAt as string),
              });
              // Check if LLM already provided a matching todo to prevent duplicates
              const hasTodo = parsed.dbActions.some(
                (a) => a.payload.type === 'todo' &&
                  (a.payload.data?.title as string)?.includes(r.message as string)
              );

              if (!hasTodo) {
                // Reminder also creates a todo
                await processDbAction({
                  type: 'todo',
                  data: {
                    title: r.message as string,
                    status: 'todo',
                    content: `Reminder set for ${r.fireAt}`,
                  },
                });
              }
            } catch (e) {
              console.error('[chat] Reminder scheduling failed:', e);
            }
          } else if (!telegramChatId) {
            console.warn('[Reminder] No telegramChatId — reminder will not fire.');
          }
        }

        // -----------------------------------------------------------------------
        // Execute Google actions (if any)
        // -----------------------------------------------------------------------
        if (parsed.gmailDraft) {
          try {
            const { to, subject, body } = parsed.gmailDraft.payload;
            await googleService.createDraft(to, subject, body);
          } catch (e) {
            console.error('[chat] Gmail draft failed:', e);
          }
        }

        if (parsed.calendarCreate) {
          try {
            const { summary, from, to, description } = parsed.calendarCreate.payload;
            await googleService.createEvent('primary', summary, from, to, description);
          } catch (e) {
            console.error('[chat] Calendar create failed:', e);
          }
        }

        // -----------------------------------------------------------------------
        // Persist and respond
        // -----------------------------------------------------------------------
        await appendHistory(USER_ID, { role: 'assistant', content: responseText });
        checkAndSummarizeMemory(USER_ID);
        return reply.send({ response: { text: responseText, code: responseCode } });
      } catch (e: any) {
        console.error(e);
        return reply.status(500).send({ error: 'LLM completion failed', details: e.message });
      }
    },
  );
}
