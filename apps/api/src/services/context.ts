import { getSystemPrompt, buildContextPrompt, Message } from '@autoclaw/core';
import { getMemory, getRecentHistory, getStructuredMemory } from './memory.js';
import {
  getDistinctExercises,
  getDistinctFinanceCategories,
  getTodoCollection,
  getJournalCollection,
} from './db.js';

const MONTERREY_TZ = 'America/Monterrey';

export async function getFullSystemPrompt(userId: string, currentTimeOverride?: string) {
  const mem = await getMemory(userId);
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const [
    structuredMem,
    knownExercises,
    knownFinanceCategories,
    activeTodosDocs,
    recentCompletedDocs,
    recentJournalDocs,
  ] = await Promise.all([
    getStructuredMemory(userId),
    getDistinctExercises(),
    getDistinctFinanceCategories(),
    getTodoCollection().find({ status: { $nin: ['completed', 'Completada', 'Completado'] } }).limit(30).toArray(),
    getTodoCollection()
      .find({ status: { $in: ['completed', 'Completada', 'Completado'] }, timestamp: { $gte: threeDaysAgo } })
      .limit(10)
      .toArray(),
    getJournalCollection().find({}).sort({ _id: -1 }).limit(2).toArray(),
  ]);

  const activeTodos = activeTodosDocs.map((t: any) => `${t.title} (${t.status})`);
  const recentCompleted = recentCompletedDocs.map((t: any) => `${t.title} (${t.timestamp ? new Date(t.timestamp).toLocaleDateString() : 'recent'})`);
  const recentJournal = recentJournalDocs.map((j: any) => `${j.timestamp ? new Date(j.timestamp).toLocaleDateString() : 'recent'}: ${j.entry}`);
  const history = await getRecentHistory(userId, 15);
  
  const currentTime = currentTimeOverride || new Date().toLocaleString('es-MX', {
    timeZone: MONTERREY_TZ,
    dateStyle: 'full',
    timeStyle: 'long',
  });

  const { getSoulPrompt, STRUCTURED_TOOLS_PROMPT } = await import('@autoclaw/core');
  const soulInstructions = getSoulPrompt();
  const toolInstructions = STRUCTURED_TOOLS_PROMPT;
  
  const context = buildContextPrompt(
    soulInstructions,
    toolInstructions,
    structuredMem,
    mem.dynamicMemory,
    history,
    20000,
  );

  return getSystemPrompt(
    context,
    knownExercises,
    knownFinanceCategories,
    currentTime,
    activeTodos,
    recentCompleted,
    recentJournal
  );
}
