import { Message } from './types';

/**
 * Normalizes a string for deduplication (lowercase and trim).
 */
export const normalizeString = (str: string): string => str.toLowerCase().trim();

/**
 * Deep merges two objects based on version 3.5 rules:
 * - Scalars: overwrite (newest wins)
 * - Arrays: combine, normalize and deduplicate
 * - Objects: recursive merge
 */
export function deepMerge(target: any, source: any): any {
  const result = { ...target };

  for (const key in source) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (Array.isArray(sourceVal)) {
      const existing = Array.isArray(targetVal) ? targetVal : [];
      // Normalize and deduplicate strings in arrays
      const combined = [...existing, ...sourceVal];
      const normalized = new Set();
      const distinct: any[] = [];
      
      combined.forEach(item => {
        const fingerPrint = typeof item === 'string' ? normalizeString(item) : JSON.stringify(item);
        if (!normalized.has(fingerPrint)) {
          normalized.add(fingerPrint);
          distinct.push(item);
        }
      });
      result[key] = distinct;
    } else if (sourceVal && typeof sourceVal === 'object' && !Array.isArray(sourceVal)) {
      result[key] = deepMerge(targetVal || {}, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }

  return result;
}

/**
 * Truncates text at the nearest word boundary.
 */
export function smartTruncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  
  const sub = text.substring(0, limit);
  const lastSpace = sub.lastIndexOf(' ');
  
  const truncated = lastSpace > 0 ? sub.substring(0, lastSpace) : sub;
  return truncated.trim() + '...';
}

/**
 * Validates a candidate JSON for basic quality:
 * - Must be an object
 * - Must have a 'text' field > 5 chars
 * - Must NOT be trivial ("ok", "done", etc)
 */
export function isValidResponse(candidate: any): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const text = candidate.text;
  if (typeof text !== 'string' || text.length <= 5) return false;

  const trivialRegex = /^(ok|vale|listo|done|entendido|gracias|perfecto|👍|\s)+$/i;
  if (trivialRegex.test(text)) return false;

  return true;
}

/**
 * Heuristic-based repetition check.
 */
export function countRepetitions(text: string): number {
  const words = text.toLowerCase().split(/\s+/);
  if (words.length < 10) return 0;
  
  const wordCounts: Record<string, number> = {};
  words.forEach(w => { wordCounts[w] = (wordCounts[w] || 0) + 1; });
  
  const repeats = Object.values(wordCounts).filter(c => c > 3).length;
  return repeats;
}

/**
 * Extracts all {...} candidates and picks the best one.
 */
export function extractBestJson(raw: string): any {
  try {
    const direct = JSON.parse(raw);
    if (isValidResponse(direct)) return direct;
  } catch { /* proceed to extract */ }

  const candidates: any[] = [];
  // Balanced-brace extraction: find all top-level {...} blocks
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < raw.length; j++) {
      const ch = raw[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"' && !escape) {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            const candidateStr = raw.substring(i, j + 1);
            const parsed = JSON.parse(candidateStr);
            if (isValidResponse(parsed)) {
              candidates.push(parsed);
            }
          } catch {
            /* skip invalid blocks */
          }
          i = j; // Move outer loop to end of this block
          break;
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Selection logic: Highest quality (longest text - repetition penalty)
  return candidates.sort((a, b) => {
    const scoreA = a.text.length - (countRepetitions(a.text) * 20);
    const scoreB = b.text.length - (countRepetitions(b.text) * 20);
    return scoreB - scoreA;
  })[0];
}

/**
 * Prompt Builder with Token Budgeting (approx charCount / 4)
 * Budget sections: Core Memory (Priority) > Dynamic Memory > Recent Hist (Mandatory) > Old Hist
 */
export function buildContextPrompt(
  soul: string,
  tools: string,
  structuredMem: any,
  dynamicMem: { summary: string, keyPoints: string[] } | string,
  history: Message[],
  charLimit: number = 20000
): string {
  let currentChars = 0;
  
  // 1. Core Persona & Tools (Always included)
  const base = soul + '\n\n' + tools;
  currentChars += base.length;

  // 2. Structured Memory (Priority)
  const structuredStr = `\n\n[USER KNOWLEDGE]\n${JSON.stringify(structuredMem, null, 2)}`;
  currentChars += structuredStr.length;

  // 3. Dynamic Memory
  let dynamicStr = '';
  if (typeof dynamicMem === 'string') {
    dynamicStr = `\n\n[CONTEXT]\n${dynamicMem}`;
  } else {
    dynamicStr = `\n\n[CONTEXT SUMMARY]\n${dynamicMem.summary}`;
    if (dynamicMem.keyPoints.length > 0) {
      const points = `\nKey points: ${dynamicMem.keyPoints.join(', ')}`;
      if (currentChars + dynamicStr.length + points.length < charLimit * 0.8) {
        dynamicStr += points;
      }
    }
  }
  currentChars += dynamicStr.length;

  // 4. History (Trimming oldest first, but keeping last 5 mandatory if possible)
  const historyLines: string[] = [];
  const mandatoryCount = 8;
  const recentHistory = history.slice(-mandatoryCount);
  const olderHistory = history.slice(0, -mandatoryCount).reverse();

  // Add recent mandatory history
  const recentLines = recentHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`);
  const recentStr = '\n\n[HISTORY]\n' + recentLines.join('\n');
  
  // Add older until limit
  const olderLines: string[] = [];
  let olderCharsUsed = 0;
  const historyBudget = charLimit - currentChars - recentStr.length;

  for (const m of olderHistory) {
    const line = `${m.role.toUpperCase()}: ${m.content}`;
    if (olderCharsUsed + line.length + 1 < historyBudget) {
      olderLines.unshift(line);
      olderCharsUsed += line.length + 1;
    } else {
      break;
    }
  }

  const finalHistory = [...olderLines, ...recentLines].join('\n');
  
  return `${base}${structuredStr}${dynamicStr}\n\n[HISTORY]\n${finalHistory}`;
}
