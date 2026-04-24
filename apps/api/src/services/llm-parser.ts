import { extractBestJson } from '@autoclaw/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbActionPayload {
  type: string;
  data: Record<string, unknown>;
}

export interface ParsedTag<T = Record<string, unknown>> {
  /** The full raw matched string (for removal) */
  rawMatch: string;
  payload: T;
}

export interface GmailDraftPayload {
  to: string;
  subject: string;
  body: string;
}

export interface GmailListPayload {
  query: string;
  max: number;
}

export interface GmailReadPayload {
  id: string;
}

export interface CalendarListPayload {
  from: string;
  to: string;
}

export interface CalendarCreatePayload {
  summary: string;
  from: string;
  to: string;
  description?: string;
}

export interface ParsedLLMResponse {
  /** Clean conversational text to show the user */
  text: string;
  /** Cleaned code/extra field */
  code: string;
  /** Raw response text before any processing */
  rawText: string;
  // Action tags
  dbAction?: ParsedTag<DbActionPayload>;
  dbActions: ParsedTag<DbActionPayload>[];
  n8nAction?: ParsedTag;
  reminder?: ParsedTag;
  query?: ParsedTag;
  gmailDraft?: ParsedTag<GmailDraftPayload>;
  gmailList?: ParsedTag<GmailListPayload>;
  gmailRead?: ParsedTag<GmailReadPayload>;
  calendarList?: ParsedTag<CalendarListPayload>;
  calendarCreate?: ParsedTag<CalendarCreatePayload>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse JSON with a fallback that strips leftover backslash-escaped
 * quotes (e.g. `\"key\"`) that some LLMs like nvidia/nemotron leave behind
 * after one level of JSON.parse.
 */
export function safeParseJson(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(raw.replace(/\\"/g, '"'));
    } catch {
      return null;
    }
  }
}

/**
 * Build a single normalized search corpus from all the places an LLM might
 * put its tool tags: the raw response, the parsed `code` field, and the
 * parsed `text` field.  We also try an unescaped variant of `code` because
 * some models double-escape newlines (`\\n`) inside JSON string fields.
 */
function buildCorpus(rawText: string, text: string, code: string): string {
  const parts: string[] = [rawText];

  if (code) {
    parts.push(code);
    // Unescape one level in case the model left \\n / \\" literals
    const unescaped = code
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
    if (unescaped !== code) parts.push(unescaped);
  }

  if (text) parts.push(text);

  return parts.join('\n');
}

/**
 * Extract a tag whose body is a JSON object: `<tagName>{...}</tagName>`.
 * Uses a greedy match so nested objects are captured in full.
 */
function extractJsonTag<T = Record<string, unknown>>(
  corpus: string,
  tagName: string,
): ParsedTag<T> | undefined {
  const all = extractAllJsonTags<T>(corpus, tagName);
  return all[0];
}

/**
 * Extract ALL tags of a certain name whose body is a JSON object.
 */
function extractAllJsonTags<T = Record<string, unknown>>(
  corpus: string,
  tagName: string,
): ParsedTag<T>[] {
  const results: ParsedTag<T>[] = [];
  const regex = new RegExp(`<${tagName}>\\s*({[\\s\\S]*?})\\s*</${tagName}>`, 'gi');
  const seenPayloads = new Set<string>();
  
  let match;
  while ((match = regex.exec(corpus)) !== null) {
    const payload = safeParseJson(match[1]) as T | null;
    if (payload) {
      const payloadStr = JSON.stringify(payload);
      if (!seenPayloads.has(payloadStr)) {
        seenPayloads.add(payloadStr);
        results.push({ rawMatch: match[0], payload });
      }
    }
  }
  return results;
}

const ALL_TAG_PATTERNS = [
  /<db_action>[\s\S]*?<\/db_action>/gi,
  /<n8n>[\s\S]*?<\/n8n>/gi,
  /<reminder>[\s\S]*?<\/reminder>/gi,
  /<query>[\s\S]*?<\/query>/gi,
  /<gmail_list[^>]*\/>/gi,
  /<gmail_read[^>]*\/>/gi,
  /<gmail_draft[^>]*\/>/gi,
  /<calendar_list[^>]*\/>/gi,
  /<calendar_create[^>]*\/>/gi,
];

/** Strip every known tool tag from a string and collapse whitespace. */
export function removeTags(text: string): string {
  let result = text;
  for (const pattern of ALL_TAG_PATTERNS) {
    result = result.replace(pattern, '');
  }
  return result.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Parse an LLM raw response into a structured object.
 *
 * Handles three common layouts:
 *  1. Plain text with tags inline
 *  2. JSON `{ "text": "...", "code": "<db_action>...</db_action>" }`
 *  3. JSON where `code` still has double-escaped quotes (`\\\"`)
 */
export function parseLLMResponse(rawText: string): ParsedLLMResponse {
  // 1. Try to unwrap the outer JSON envelope {text, code}
  const extracted = extractBestJson(rawText);
  const text: string = extracted?.text ?? rawText;
  const code: string = extracted?.code ?? '';

  // 2. Build unified corpus for tag searching
  const corpus = buildCorpus(rawText, text, code);

  // 3. Extract all action tags in one pass
  const dbActions = extractAllJsonTags<DbActionPayload>(corpus, 'db_action');
  const n8nAction = extractJsonTag(corpus, 'n8n');
  const reminder = extractJsonTag(corpus, 'reminder');
  const query = extractJsonTag(corpus, 'query');

  // 4. Attribute-style tags (Gmail, Calendar)
  let gmailDraft: ParsedTag<GmailDraftPayload> | undefined;
  const gdMatch = corpus.match(
    /<gmail_draft\s+to="([^"]*)"\s+subject="([^"]*)"\s+body="([^"]*)"\s*\/>/,
  );
  if (gdMatch) {
    gmailDraft = {
      rawMatch: gdMatch[0],
      payload: { to: gdMatch[1], subject: gdMatch[2], body: gdMatch[3] },
    };
  }

  let gmailList: ParsedTag<GmailListPayload> | undefined;
  const glMatch = corpus.match(/<gmail_list\s+query="([^"]*)"\s+max=(\d+)\s*\/>/);
  if (glMatch) {
    gmailList = {
      rawMatch: glMatch[0],
      payload: { query: glMatch[1], max: parseInt(glMatch[2], 10) },
    };
  }

  let gmailRead: ParsedTag<GmailReadPayload> | undefined;
  const grMatch = corpus.match(/<gmail_read\s+id="([^"]*)"\s*\/>/);
  if (grMatch) {
    gmailRead = {
      rawMatch: grMatch[0],
      payload: { id: grMatch[1] },
    };
  }

  let calendarList: ParsedTag<CalendarListPayload> | undefined;
  const clMatch = corpus.match(/<calendar_list\s+from="([^"]*)"\s+to="([^"]*)"\s*\/>/);
  if (clMatch) {
    calendarList = {
      rawMatch: clMatch[0],
      payload: { from: clMatch[1], to: clMatch[2] },
    };
  }

  let calendarCreate: ParsedTag<CalendarCreatePayload> | undefined;
  const ccMatch = corpus.match(
    /<calendar_create\s+summary="([^"]*)"\s+from="([^"]*)"\s+to="([^"]*)"\s*(?:description="([^"]*)")?\s*\/>/,
  );
  if (ccMatch) {
    calendarCreate = {
      rawMatch: ccMatch[0],
      payload: {
        summary: ccMatch[1],
        from: ccMatch[2],
        to: ccMatch[3],
        description: ccMatch[4],
      },
    };
  }

  // 5. Strip all tool tags from the conversational text
  const cleanText = removeTags(text || rawText);
  const cleanCode = removeTags(code);

  return {
    text: cleanText,
    code: cleanCode,
    rawText,
    dbAction: dbActions[0],
    dbActions,
    n8nAction,
    reminder,
    query,
    gmailDraft,
    gmailList,
    gmailRead,
    calendarList,
    calendarCreate,
  };
}
