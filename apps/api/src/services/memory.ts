import { getMemoryCollection, getHistoryCollection, getStructuredMemoryCollection } from './db.js';
import { 
  getSummarizationPrompt, 
  getStructuredMemoryPrompt, 
  Message,
  deepMerge,
  extractBestJson,
  StructuredMemory,
  MemoryDocument
} from '@autoclaw/core';
import { callLLM } from './llm.js';
import fs from 'fs';
import path from 'path';

// Path to structured memory representation (For local debugging, not source of truth)
const MEMORY_FILE_PATH = path.join(process.cwd(), '..', '..', 'memory.md');

// Concurrency lock to prevent multiple summarizations for the same user
const activeSummarizations = new Set<string>();

/**
 * Migration helper: wraps legacy string dynamic memory into the new object structure.
 */
function migrateMemory(mem: any): MemoryDocument {
  if (typeof mem.dynamicMemory === 'string') {
    mem.dynamicMemory = {
      summary: mem.dynamicMemory,
      keyPoints: [],
      lastUpdated: new Date()
    };
  }
  return mem as MemoryDocument;
}

export const getMemory = async (userId: string): Promise<MemoryDocument> => {
  const collection = getMemoryCollection();
  let mem = await collection.findOne({ userId });
  if (!mem) {
    const defaultMem = { 
      userId, 
      dynamicMemory: { summary: '', keyPoints: [], lastUpdated: new Date() }, 
      preferredModel: 'google/gemma-4-31b-it:free', 
      lastUpdated: new Date() 
    } as any;
    await collection.insertOne(defaultMem);
    return defaultMem as MemoryDocument;
  }
  return migrateMemory(mem);
};

export const getStructuredMemory = async (userId: string): Promise<StructuredMemory> => {
  const collection = getStructuredMemoryCollection();
  let mem = await collection.findOne({ userId });
  if (!mem) {
    const defaultMem = { 
      userId, 
      memory: { 
        preferences: {}, 
        userProfile: {}, 
        business: {}, 
        facts: {},
        lastUpdated: new Date()
      }, 
      lastUpdated: new Date() 
    } as any;
    await collection.insertOne(defaultMem);
    return defaultMem.memory as StructuredMemory;
  }
  return mem.memory as StructuredMemory;
};

export const syncMemoryToFile = async (memoryState: any) => {
  try {
    const content = JSON.stringify(memoryState, null, 2);
    await fs.promises.writeFile(MEMORY_FILE_PATH, content, 'utf-8');
  } catch (e) {
    console.error('[Memory] Failed to sync memory to file', e);
  }
};

export const extractAndMergeStructuredMemory = async (userId: string, historyString: string) => {
  const currentMemory = await getStructuredMemory(userId);
  const prompt = getStructuredMemoryPrompt(JSON.stringify(currentMemory), historyString);

  try {
    const responseText = await callLLM([{ role: 'system', content: prompt }]);
    const extracted = extractBestJson(responseText);
    
    if (!extracted) {
      console.warn('[Memory] Failed to extract valid structured JSON candidate', { userId, rawLength: responseText.length });
      return;
    }

    const updatedMemory = deepMerge(currentMemory, extracted);
    updatedMemory.lastUpdated = new Date();
    
    const collection = getStructuredMemoryCollection();
    await collection.updateOne(
      { userId },
      { $set: { memory: updatedMemory, lastUpdated: new Date() } },
      { upsert: true }
    );
    await syncMemoryToFile(updatedMemory);
    console.log('[Memory] Structured memory updated successfully', { userId });
  } catch (e: any) {
    console.error('[Memory] Background extraction failed', { userId, errorMessage: e.message });
  }
};

export const updatePreferredModel = async (userId: string, model: string) => {
  const memCol = getMemoryCollection();
  await memCol.updateOne(
    { userId },
    { $set: { preferredModel: model, lastUpdated: new Date() } },
    { upsert: true }
  );
};

export const appendHistory = async (userId: string, msg: Message) => {
  const col = getHistoryCollection();
  await col.insertOne({ userId, ...msg, timestamp: new Date() });
};

export const getRecentHistory = async (userId: string, limit: number = 20): Promise<Message[]> => {
  const col = getHistoryCollection();
  const docs = await col.find({ userId }).sort({ timestamp: -1 }).limit(limit).toArray();
  // Reverse to get chronological order and cast role
  return docs.reverse().map(d => ({ 
    role: d.role as 'system' | 'user' | 'assistant', 
    content: d.content 
  }));
};

/**
 * Checks if summarization is needed based on character threshold (~3000 chars).
 */
export const checkAndSummarizeMemory = async (userId: string) => {
  if (activeSummarizations.has(userId)) {
    console.debug('[Memory] Concurrency skip: summarizing already in progress', { userId });
    return;
  }

  const historyCol = getHistoryCollection();
  
  // Get recent messages to check accumulation
  const recentDocs = await historyCol.find({ userId }).sort({ timestamp: -1 }).limit(15).toArray();
  const totalChars = recentDocs.reduce((acc, doc) => acc + (doc.content?.length || 0), 0);
  
  // Threshold: 3000 chars
  if (totalChars > 3000) {
    activeSummarizations.add(userId);
    
    // Execute in background
    (async () => {
      try {
        console.log('[Memory] Triggering context condensation...', { userId });
        const historyString = recentDocs.reverse().map(r => `${r.role.toUpperCase()}: ${r.content}`).join('\n');
        const mem = await getMemory(userId);
        
        // 1. Condense dynamic memory
        const currentDynamic = typeof mem.dynamicMemory === 'string' ? mem.dynamicMemory : mem.dynamicMemory.summary;
        const prompt = getSummarizationPrompt(currentDynamic, historyString);
        const responseText = await callLLM([{ role: 'system', content: prompt }]);
        const summarized = extractBestJson(responseText);

        if (summarized) {
          const memCol = getMemoryCollection();
          await memCol.updateOne(
            { userId },
            { $set: { dynamicMemory: { ...summarized, lastUpdated: new Date() }, lastUpdated: new Date() } }
          );
          console.log('[Memory] Dynamic memory summarized', { userId });
        }

        // 2. Extract structured facts
        await extractAndMergeStructuredMemory(userId, historyString);
        
      } catch (e: any) {
        console.error('[Memory] Background summarization failed', { userId, errorMessage: e.message });
      } finally {
        activeSummarizations.delete(userId);
      }
    })();
  }
};
