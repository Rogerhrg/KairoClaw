import { DateTime } from 'luxon';
import {
  getJournalCollection,
  getGymCollection,
  getFinanceCollection,
  getTodoCollection,
} from './db.js';
import {
  resolveFinanceCategory,
  resolveGymExercise,
  upsertPendingConfirmation,
} from './entities.js';
import { callLLM } from './llm.js';
import { getMemory } from './memory.js';

const USER_ID = 'default';
const MONTERREY_TZ = 'America/Monterrey';

// ---------------------------------------------------------------------------
// Text normalization
// ---------------------------------------------------------------------------

export const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normalizeText = (value: unknown): string =>
  stripAccents(String(value || ''))
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

const FINANCE_METHOD_ALIASES: Record<string, string> = {
  efectivo: 'efectivo',
  cash: 'efectivo',
  transferencia: 'gasto',
  transfer: 'gasto',
  'tdc banregio': 'tdc banregio',
  'tarjeta credito banregio': 'tdc banregio',
  'tarjeta de credito banregio': 'tdc banregio',
  'tarjeta banregio': 'tdc banregio',
  banregio: 'tdc banregio',
  'tdc rappi': 'tdc rappi',
  'tarjeta credito rappi': 'tdc rappi',
  'tarjeta de credito rappi': 'tdc rappi',
  'tarjeta rappi': 'tdc rappi',
  rappi: 'tdc rappi',
  'tdc banamex': 'tdc banamex',
  'tarjeta credito banamex': 'tdc banamex',
  'tarjeta de credito banamex': 'tdc banamex',
  'tarjeta banamex': 'tdc banamex',
  banamex: 'tdc banamex',
  otro: 'otro',
};

export const normalizeFinanceMethod = (value: unknown, type = 'gasto'): string => {
  const normalized = normalizeText(value);
  if (!normalized && type === 'gasto') return 'tdc banregio';
  return FINANCE_METHOD_ALIASES[normalized] || normalized || (type === 'gasto' ? 'tdc banregio' : 'otro');
};

// ---------------------------------------------------------------------------
// Timestamp parsing
// ---------------------------------------------------------------------------

export const parseDocumentTimestamp = (date?: unknown, hour?: unknown): DateTime => {
  const now = DateTime.now().setZone(MONTERREY_TZ);
  const dateStr = typeof date === 'string' ? date : '';
  const hourStr = typeof hour === 'string' ? hour : '';

  // If no date, or date is today and no hour, use 'now'
  const todayStr = now.toISODate();
  if (!dateStr || (todayStr && dateStr === todayStr && !hourStr)) {
    return now;
  }

  if (hourStr) {
    const formats = ['HH:mm', 'h:mm a', 'HH:mm:ss'];
    for (const fmt of formats) {
      const dt = DateTime.fromFormat(`${dateStr} ${hourStr}`, `yyyy-MM-dd ${fmt}`, { zone: MONTERREY_TZ });
      if (dt.isValid) return dt;
    }
    const dtFallback = DateTime.fromISO(`${dateStr}T${hourStr}`, { zone: MONTERREY_TZ });
    if (dtFallback.isValid) return dtFallback;
  }

  const baseDt = DateTime.fromISO(dateStr, { zone: MONTERREY_TZ });
  if (baseDt.isValid) return baseDt.set({ hour: 12, minute: 0, second: 0 });

  return DateTime.now().setZone(MONTERREY_TZ);
};

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

export const buildFinanceDocument = (
  data: Record<string, unknown>,
  categoryId: string,
  categoryName: string,
) => {
  const timestamp = parseDocumentTimestamp(data.date, data.hour).toJSDate();
  return {
    type: normalizeText(data.type || 'gasto'),
    amount: Math.abs(Number(data.amount) || 0),
    method: normalizeFinanceMethod(data.method, normalizeText(data.type || 'gasto')),
    categoryId,
    categoryName,
    concept: normalizeText(data.concept),
    timestamp,
  };
};

export const buildGymDocument = (
  data: Record<string, unknown>,
  exerciseId: string,
  exerciseName: string,
) => {
  const timestamp = parseDocumentTimestamp(data.date, data.hour).toJSDate();
  return {
    exercise: { id: exerciseId, name: exerciseName },
    exerciseName,
    weight: Number(data.weight) || 0,
    unit: (() => {
      const u = normalizeText(data.unit || 'kg');
      if (u === 'lbs') return 'lbs';
      if (u === 'min' || u === 'minuto' || u === 'minutos') return 'min';
      return 'kg';
    })(),
    reps: Number(data.reps) || 0,
    sets: Number(data.sets) || 0,
    type: normalizeText(data.type || 'standard') === 'top' ? 'top' : 'standard',
    muscleGroup: typeof data.muscleGroup === 'string' ? data.muscleGroup : undefined,
    timestamp,
  };
};

// ---------------------------------------------------------------------------
// Acknowledgement builders (for confirmation flows only)
// These are NOT shown to the user in normal chat — the LLM's text is used instead.
// ---------------------------------------------------------------------------

export const buildFinanceAck = (entry: ReturnType<typeof buildFinanceDocument>): string => {
  const type = normalizeText(entry.type || 'gasto');
  const verb = type === 'ingreso' ? 'ingreso' : 'gasto';
  let msg = `He registrado con éxito tu ${verb} de $${entry.amount}`;
  if (entry.concept) msg += ` de ${entry.concept}`;
  if (entry.categoryName) msg += ` en la categoria ${entry.categoryName}`;
  if (entry.method) msg += ` usando ${entry.method}`;
  return msg + '.';
};

export const buildGymAck = (entry: ReturnType<typeof buildGymDocument>): string => {
  const name = entry.exerciseName || 'ejercicio';
  const type = entry.type === 'top' ? ' (serie top)' : '';
  if (entry.sets > 0 && entry.reps > 0)
    return `He registrado ${entry.sets} series de ${entry.reps} reps con ${entry.weight}${entry.unit} de ${name}${type}.`;
  if (entry.reps > 0)
    return `He registrado ${entry.reps} reps con ${entry.weight}${entry.unit} de ${name}${type}.`;
  if (entry.unit === 'min')
    return `He registrado ${entry.weight} min de ${name}${type}.`;
  return `He registrado el ejercicio ${name} con ${entry.weight}${entry.unit}${type}.`;
};

// ---------------------------------------------------------------------------
// Gym query normalization
// ---------------------------------------------------------------------------

export const resolveGymQuery = (query: Record<string, unknown>) => {
  const normalized = { ...query };
  if (typeof normalized.exercise === 'string' && !normalized.exerciseName) {
    normalized.exerciseName = normalized.exercise;
    delete normalized.exercise;
  }
  return normalized;
};

// ---------------------------------------------------------------------------
// Entity name override extraction
// ---------------------------------------------------------------------------

export const extractCreatedEntityNameOverride = (message: string): string | null => {
  const text = String(message || '').trim();
  if (!text) return null;

  const patterns: RegExp[] = [
    /\bse\s+llamar[aá]\s+(.+)$/i,
    /\bque\s+se\s+llame\s+(.+)$/i,
    /\bnombre\s*:\s*(.+)$/i,
    /^(si|s[ií]|yes|ok|va|dale)\s*[:,-]\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = (match?.[1] || match?.[2] || '').trim();
    if (candidate) return candidate.replace(/[.?!]+$/g, '').trim();
  }
  return null;
};

// ---------------------------------------------------------------------------
// Main action processor
// Returns null when the LLM's own conversational text should be used as response.
// Returns a string only when the system must override the LLM text (e.g. for
// confirmation prompts that need an immediate interactive reply).
// ---------------------------------------------------------------------------

export async function processDbAction(
  parsedDb: { type: string; data: Record<string, unknown> },
): Promise<{ ack: string | null; requiresConfirmation: boolean }> {
  const data = parsedDb.data || {};

  // --- Journal ---
  if (parsedDb.type === 'journal') {
    const entryText = String(data.entry || '');
    const dt = parseDocumentTimestamp(data.date, data.hour);
    const journalDate = dt.toJSDate();
    const startOfDay = dt.startOf('day').toJSDate();
    const endOfDay = dt.endOf('day').toJSDate();

    const journalCol = getJournalCollection();
    const existing = await journalCol.findOne({ timestamp: { $gte: startOfDay, $lte: endOfDay } });

    if (existing) {
      console.log('[processDbAction] Merging journal entry via LLM asynchronously.');
      const mem = await getMemory(USER_ID);
      const model = mem?.preferredModel || 'gemini-2.5-flash';

      const mergePrompt = `
Aquí tienes dos fragmentos de un diario personal escritos en momentos diferentes del mismo día.
Tu tarea es unirlos en una sola entrada coherente, fluida y natural.
IMPORTANTE:
- Combina la información sin repetir conceptos.
- Respeta el orden cronológico o lógico de los eventos.
- No es necesario usar mis palabras textuales si puedes redactarlo mejor y más natural.
- Debe leerse como una sola entrada de diario bien escrita.

ENTRADA EXISTENTE: "${existing.entry}"
NUEVA INFORMACIÓN: "${entryText}"

Genera únicamente el texto de la entrada combinada resultante.
      `.trim();

      // Run asynchronously to prevent blocking the chat response, which could cause Telegram to timeout
      Promise.resolve().then(async () => {
        try {
          const mergedEntry = await callLLM([{ role: 'system', content: mergePrompt }], model);
          await journalCol.updateOne(
            { _id: existing._id },
            { $set: { entry: mergedEntry || `${existing.entry}\n${entryText}`, timestamp: journalDate } },
          );
          console.log('[processDbAction] Journal entry merged successfully.');
        } catch (e) {
          console.error('[processDbAction] Error merging journal entry via LLM:', e);
          // Fallback to simple concatenation if the LLM call fails
          await journalCol.updateOne(
            { _id: existing._id },
            { $set: { entry: `${existing.entry}\n\n--- Nueva entrada ---\n${entryText}`, timestamp: journalDate } },
          );
        }
      });
    } else {
      console.log('[processDbAction] Creating new journal entry.');
      await journalCol.insertOne({ ...data, entry: entryText, timestamp: journalDate });
    }

    // Return null → caller will preserve the LLM's conversational response
    return { ack: null, requiresConfirmation: false };
  }

  // --- Todo ---
  if (parsedDb.type === 'todo') {
    const timestamp = parseDocumentTimestamp(data.date, data.hour).toJSDate();
    const title = typeof data.title === 'string'
      ? data.title.charAt(0).toUpperCase() + data.title.slice(1)
      : String(data.title || '');
    const content = typeof data.content === 'string'
      ? data.content.charAt(0).toUpperCase() + data.content.slice(1)
      : String(data.content || '');

    const statusMap: Record<string, string> = {
      todo: 'Pendiente',
      in_progress: 'En progreso',
      waiting: 'En espera',
      completed: 'Completada',
    };
    let status = String(data.status || 'Pendiente');
    if (statusMap[status.toLowerCase()]) status = statusMap[status.toLowerCase()];

    const todoCol = getTodoCollection();
    const existing = await todoCol.findOne({
      title: { $regex: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      status: { $nin: ['Completada', 'completed', 'Completado'] }
    });

    if (existing) {
      console.log(`[processDbAction] Updating existing todo: ${title}`);
      await todoCol.updateOne({ _id: existing._id }, { $set: { status, timestamp } });
    } else {
      console.log(`[processDbAction] Creating new todo: ${title}`);
      await todoCol.insertOne({ ...data, title, content, status, timestamp });
    }
    return { ack: null, requiresConfirmation: false };
  }

  // --- Finance Category ---
  if (parsedDb.type === 'finance_category') {
    const created = await resolveFinanceCategory('', String(data.name || ''));
    if (created.kind === 'needs_confirmation') {
      await upsertPendingConfirmation({
        userId: USER_ID,
        status: 'pending',
        type: created.confirmationType,
        prompt: created.prompt,
        payload: { ...created.payload, entityName: String(data.name || ''), entryData: {} },
      });
      return { ack: created.prompt, requiresConfirmation: true };
    }
    return { ack: null, requiresConfirmation: false };
  }

  // --- Finance ---
  if (parsedDb.type === 'finance') {
    const financeData = data as Record<string, unknown>;
    const categoryName =
      typeof financeData.category === 'string' ? financeData.category :
      typeof financeData.categoryHint === 'string' ? financeData.categoryHint : undefined;

    const categoryRes = await resolveFinanceCategory(
      String(financeData.concept || ''),
      categoryName,
    );

    if (categoryRes.kind === 'needs_confirmation') {
      await upsertPendingConfirmation({
        userId: USER_ID,
        status: 'pending',
        type: categoryRes.confirmationType,
        prompt: categoryRes.prompt,
        payload: { ...categoryRes.payload, entryData: financeData },
      });
      return { ack: categoryRes.prompt, requiresConfirmation: true };
    }

    const entry = buildFinanceDocument(financeData, categoryRes.entityId, categoryRes.entityName);
    await getFinanceCollection().insertOne(entry);
    return { ack: null, requiresConfirmation: false };
  }

  // --- Gym ---
  if (parsedDb.type === 'gym') {
    const gymData = data as Record<string, unknown>;
    const rawExerciseName =
      (typeof gymData.exerciseName === 'string' && gymData.exerciseName) ||
      (typeof gymData.exercise === 'string' && gymData.exercise) ||
      '';

    const resolution = await resolveGymExercise(String(rawExerciseName), gymData);

    if (resolution.kind === 'resolved') {
      const entry = buildGymDocument(gymData, resolution.entityId, resolution.entityName);
      await getGymCollection().insertOne(entry);
      return { ack: null, requiresConfirmation: false };
    }

    await upsertPendingConfirmation({
      userId: USER_ID,
      status: 'pending',
      type: resolution.confirmationType,
      prompt: resolution.prompt,
      payload: { ...resolution.payload, entryData: gymData },
    });
    return { ack: resolution.prompt, requiresConfirmation: true };
  }

  return { ack: null, requiresConfirmation: false };
}
