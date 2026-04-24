import { ObjectId } from 'mongodb';
import {
  getFinanceCategoriesCollection,
  getFinanceBusinessesCollection,
  getGymExercisesCollection,
  getPendingConfirmationsCollection,
  normalizeKeywordList,
  normalizeLookupText,
  tokenizeLookupText,
  toObjectId,
} from './db.js';

type EntityCollection = 'finance' | 'gym' | 'finance_businesses';
type ConfirmationType = 'finance_keyword' | 'finance_create' | 'finance_business_select' | 'finance_business_create' | 'finance_select' | 'gym_keyword' | 'gym_create' | 'gym_muscle_group' | 'gym_select' | 'data_completion';

interface NamedEntityDocument {
  _id: ObjectId;
  name: string;
  keywords: string[];
  createdAt?: Date;
  updatedAt?: Date;
  muscleGroup?: string;
}

interface EntityResolutionBase {
  kind: 'resolved' | 'needs_confirmation';
}

interface ResolvedEntity extends EntityResolutionBase {
  kind: 'resolved';
  entityId: string;
  entityName: string;
}

interface PendingEntityConfirmation extends EntityResolutionBase {
  kind: 'needs_confirmation';
  confirmationType: ConfirmationType;
  prompt: string;
  payload: Record<string, unknown>;
}

export type EntityResolution = ResolvedEntity | PendingEntityConfirmation;

export interface PendingConfirmationDocument {
  _id?: ObjectId;
  userId: string;
  status: 'pending';
  type: ConfirmationType;
  prompt: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const YES_PATTERN = /^(si|s[ií]|yes|va|dale|ok|okay|claro|confirmo|hazlo|adelante|agregala|agregalo|creala|crealo|anadela|anadelo)\b/i;
const NO_PATTERN = /^(no|nel|nop|cancel(a|o)|mejor no)\b/i;

const FINANCE_FALLBACK_CATEGORIES = [
  { name: 'despensa', keywords: ['super', 'supermercado', 'mandado', 'despensa'] },
  { name: 'comida rapida', keywords: ['comida rapida', 'fast food', 'comida callejera'] },
  { name: 'gasolina', keywords: ['gas', 'gasolina', 'combustible'] },
  { name: 'mascotas', keywords: ['perro', 'gato', 'veterinario', 'croquetas', 'mascota'] },
  { name: 'regalo', keywords: ['regalo', 'detalle', 'cumpleanos'] },
  { name: 'otros', keywords: ['otros'] },
];

const getEntityCollection = (collection: EntityCollection) => {
  if (collection === 'finance') return getFinanceCategoriesCollection();
  if (collection === 'finance_businesses') return getFinanceBusinessesCollection();
  return getGymExercisesCollection();
};

const getCollectionLabel = (collection: EntityCollection) => {
  if (collection === 'finance') return 'categoria';
  if (collection === 'finance_businesses') return 'negocio';
  return 'ejercicio';
};

const getKeywordNoun = (collection: EntityCollection) => {
  if (collection === 'finance') return 'gasto';
  if (collection === 'finance_businesses') return 'negocio';
  return 'ejercicio';
};

const normalizeEntityName = (value: string): string => value.trim();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scoreEntityMatch = (entity: NamedEntityDocument, searchText: string, tokens: string[]): number => {
  const name = normalizeLookupText(entity.name);
  const keywords = normalizeKeywordList(entity.keywords || []);
  let score = 0;

  if (name === searchText) score += 100;
  if (keywords.includes(searchText)) score += 120;
  if (searchText.includes(name) || name.includes(searchText)) score += 45;

  for (const keyword of keywords) {
    if (searchText.includes(keyword) || keyword.includes(searchText)) {
      score += 30;
    }
  }

  for (const token of tokens) {
    if (token === name) score += 20;
    if (keywords.includes(token)) score += 25;
    if (name.includes(token)) score += 10;
    if (keywords.some(keyword => keyword.includes(token) || token.includes(keyword))) {
      score += 8;
    }
  }

  return score;
};

const ensureDefaultFinanceCategories = async () => {
  const collection = getFinanceCategoriesCollection();
  const count = await collection.countDocuments({});
  if (count > 0) return;

  const now = new Date();
  await collection.insertMany(
    FINANCE_FALLBACK_CATEGORIES.map(category => ({
      name: category.name,
      keywords: normalizeKeywordList([category.name, ...category.keywords]),
      createdAt: now,
      updatedAt: now,
    }))
  );
};

const findBestEntity = async (
  collection: EntityCollection,
  searchText: string
): Promise<NamedEntityDocument | null> => {
  const normalized = normalizeLookupText(searchText);
  if (!normalized) return null;

  if (collection === 'finance') {
    await ensureDefaultFinanceCategories();
  }

  const entities = (await getEntityCollection(collection).find({}).toArray()) as NamedEntityDocument[];
  const tokens = tokenizeLookupText(normalized);

  const scored = entities
    .map(entity => ({ entity, score: scoreEntityMatch(entity, normalized, tokens) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.entity ?? null;
};

const findEntityByName = async (
  collection: EntityCollection,
  name: string
): Promise<NamedEntityDocument | null> => {
  const normalized = normalizeEntityName(name);
  if (!normalized) return null;

  const byName = await getEntityCollection(collection).findOne({ 
    $or: [
      { name: normalized },
      { keywords: normalized }
    ]
  });
  return (byName as NamedEntityDocument | null) ?? null;
};

export const upsertPendingConfirmation = async (
  confirmation: Omit<PendingConfirmationDocument, '_id' | 'createdAt' | 'updatedAt'>
) => {
  const collection = getPendingConfirmationsCollection();
  const now = new Date();
  await collection.deleteMany({ userId: confirmation.userId, status: 'pending' });
  await collection.insertOne({
    ...confirmation,
    createdAt: now,
    updatedAt: now,
  });
};

export const getPendingConfirmation = async (userId: string) => {
  return (await getPendingConfirmationsCollection().findOne({
    userId,
    status: 'pending',
  })) as PendingConfirmationDocument | null;
};

export const clearPendingConfirmation = async (id: ObjectId) => {
  await getPendingConfirmationsCollection().deleteOne({ _id: id });
};

export const isAffirmativeMessage = (message: string): boolean => YES_PATTERN.test(normalizeLookupText(message));
export const isNegativeMessage = (message: string): boolean => NO_PATTERN.test(normalizeLookupText(message));

export const addKeywordToEntity = async (collection: EntityCollection, entityId: string, keyword: string) => {
  const normalizedKeyword = normalizeLookupText(keyword);
  if (!normalizedKeyword) return;

  await getEntityCollection(collection).updateOne(
    { _id: toObjectId(entityId) },
    {
      $addToSet: { keywords: normalizedKeyword },
      $set: { updatedAt: new Date() },
    }
  );
};

export const createEntity = async (collection: EntityCollection, name: string, keyword?: string, extraFields: Record<string, any> = {}) => {
  const originalName = name.trim();
  const normalizedName = normalizeLookupText(originalName);
  const keywords = normalizeKeywordList([normalizedName, keyword || '']);
  const now = new Date();
  const result = await getEntityCollection(collection).insertOne({
    name: originalName,
    keywords,
    ...extraFields,
    createdAt: now,
    updatedAt: now,
  });

  return {
    entityId: result.insertedId.toString(),
    entityName: normalizedName,
  };
};

export const resolveFinanceCategory = async (concept: string, categoryHint?: string): Promise<EntityResolution> => {
  const searchText = normalizeLookupText(categoryHint || concept);
  if (!searchText) {
    return {
      kind: 'needs_confirmation',
      confirmationType: 'finance_create',
      prompt: '¿En que categoria quieres registrarlo?',
      payload: { collection: 'finance', entryData: {} },
    };
  }

  const collection = getFinanceCategoriesCollection();
  
  // 1. Exact Match (Name)
  const exactMatch = await collection.findOne({ name: searchText }) as NamedEntityDocument | null;
  if (exactMatch) {
    return {
      kind: 'resolved',
      entityId: exactMatch._id.toString(),
      entityName: exactMatch.name,
    };
  }

  // 2. Exact Match (Synonym)
  const synonymMatch = await collection.findOne({ keywords: searchText }) as NamedEntityDocument | null;
  if (synonymMatch) {
    return {
      kind: 'resolved',
      entityId: synonymMatch._id.toString(),
      entityName: synonymMatch.name,
    };
  }

  // 3. Broader Search (Contains)
  const candidates = await collection.find({
    $or: [
      { name: { $regex: escapeRegExp(searchText), $options: 'i' } },
      { keywords: { $regex: escapeRegExp(searchText), $options: 'i' } }
    ]
  }).limit(10).toArray() as NamedEntityDocument[];

  if (candidates.length === 1) {
    const matched = candidates[0];
    return {
      kind: 'resolved',
      entityId: matched._id.toString(),
      entityName: matched.name,
    };
  }

  if (candidates.length > 1) {
    const list = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    const createOption = `${candidates.length + 1}. Crear categoria "${searchText}"`;
    return {
      kind: 'needs_confirmation',
      confirmationType: 'finance_select',
      prompt: `He encontrado varias categorias para "${searchText}":\n${list}\n${createOption}\n\n¿Cual es? (Responde con numero o nombre).`,
      payload: {
        collection: 'finance',
        candidates: candidates.map(c => ({ id: c._id.toString(), name: c.name })),
        keyword: searchText,
      },
    };
  }

  // Suggest Creation
  const proposedName = categoryHint || concept || 'otros';
  return {
    kind: 'needs_confirmation',
    confirmationType: 'finance_create',
    prompt: `No encontre la categoria "${searchText}". ¿Quieres crear "${proposedName}"?`,
    payload: {
      collection: 'finance',
      entityName: proposedName,
      keyword: searchText,
    },
  };
};

export const resolveFinanceBusiness = async (businessName: string): Promise<EntityResolution> => {
  const normalized = normalizeLookupText(businessName);
  if (!normalized) {
    return {
      kind: 'resolved',
      entityId: '',
      entityName: '',
    };
  }

  const collection = getFinanceBusinessesCollection();
  
  // 1. Exact Match
  const exactMatch = await collection.findOne({ name: normalized }) as NamedEntityDocument | null;
  if (exactMatch) {
    return {
      kind: 'resolved',
      entityId: exactMatch._id.toString(),
      entityName: exactMatch.name,
    };
  }

  // 2. Partial Match (Contains)
  const candidates = await collection.find({
    name: { $regex: escapeRegExp(normalized), $options: 'i' }
  }).limit(10).toArray() as NamedEntityDocument[];

  if (candidates.length === 1) {
    const matched = candidates[0];
    return {
      kind: 'resolved',
      entityId: matched._id.toString(),
      entityName: matched.name,
    };
  }

  if (candidates.length > 1) {
    const list = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    const createOption = `${candidates.length + 1}. Crear negocio "${normalized}"`;
    return {
      kind: 'needs_confirmation',
      confirmationType: 'finance_business_select',
      prompt: `He encontrado varios negocios similares para "${normalized}":\n${list}\n${createOption}\n\n¿Cual de ellos es? (Responde con el numero o nombre).`,
      payload: {
        collection: 'finance_businesses',
        candidates: candidates.map(c => ({ id: c._id.toString(), name: c.name })),
        keyword: normalized,
      },
    };
  }

  // 3. Suggest Creation
  return {
    kind: 'needs_confirmation',
    confirmationType: 'finance_business_create',
    prompt: `No encontre el negocio "${normalized}". ¿Quieres crearlo?`,
    payload: {
      collection: 'finance_businesses',
      entityName: normalized,
      keyword: normalized,
    },
  };
};

/**
 * @deprecated Use resolveFinanceCategory. Businesses are now treated as keywords for categories.
 */
export const resolveFinanceBusinessLegacy = resolveFinanceBusiness;

export const resolveGymExercise = async (exerciseName: string, gymData: Record<string, any> = {}): Promise<EntityResolution> => {
  const normalized = normalizeLookupText(exerciseName);
  if (!normalized) {
    return {
      kind: 'needs_confirmation',
      confirmationType: 'gym_create',
      prompt: '¿Qué ejercicio quieres registrar?',
      payload: { collection: 'gym', entryData: {} },
    };
  }

  const collection = getGymExercisesCollection();
  
  // 1. Exact Match (Name)
  const exactMatch = await collection.findOne({ name: normalized }) as NamedEntityDocument | null;
  if (exactMatch) {
    gymData.muscleGroup = exactMatch.muscleGroup;
    return {
      kind: 'resolved',
      entityId: exactMatch._id.toString(),
      entityName: exactMatch.name,
    };
  }

  // 2. Exact Match (Synonym)
  // Note: We use the normalized list of synonyms in the DB.
  const synonymMatch = await collection.findOne({ keywords: normalized }) as NamedEntityDocument | null;
  if (synonymMatch) {
    gymData.muscleGroup = synonymMatch.muscleGroup;
    return {
      kind: 'resolved',
      entityId: synonymMatch._id.toString(),
      entityName: synonymMatch.name,
    };
  }

  // 3. Broader Search (Contains)
  // We look for exercises where the name or any synonym contains the search text.
  const candidates = await collection.find({
    $or: [
      { name: { $regex: escapeRegExp(normalized), $options: 'i' } },
      { keywords: { $regex: escapeRegExp(normalized), $options: 'i' } }
    ]
  }).limit(10).toArray() as NamedEntityDocument[];

  if (candidates.length === 1) {
    const matched = candidates[0];
    gymData.muscleGroup = matched.muscleGroup;
    return {
      kind: 'resolved',
      entityId: matched._id.toString(),
      entityName: matched.name,
    };
  }

  if (candidates.length > 1) {
    const list = candidates.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
    const createOption = `${candidates.length + 1}. Crear ejercicio "${normalized}"`;
    return {
      kind: 'needs_confirmation',
      confirmationType: 'gym_select',
      prompt: `He encontrado varios resultados para "${normalized}":\n${list}\n${createOption}\n\n¿Cual de ellos es? (Responde con el numero o nombre).`,
      payload: {
        collection: 'gym',
        candidates: candidates.map(c => ({ id: c._id.toString(), name: c.name })),
        keyword: normalized,
      },
    };
  }

  // No coincidence at all
  return {
    kind: 'needs_confirmation',
    confirmationType: 'gym_create',
    prompt: `No encontre el ejercicio "${normalized}". ¿Quieres crearlo?`,
    payload: {
      collection: 'gym',
      entityName: normalized,
      keyword: normalized,
    },
  };
};

export const completePendingEntityConfirmation = async (pending: PendingConfirmationDocument) => {
  const collection = String(pending.payload.collection) as EntityCollection;
  const keyword = typeof pending.payload.keyword === 'string' ? pending.payload.keyword : '';
  let entityId = typeof pending.payload.entityId === 'string' ? pending.payload.entityId : '';
  let entityName = typeof pending.payload.entityName === 'string' ? pending.payload.entityName : '';

  if (pending.type === 'finance_keyword' || pending.type === 'gym_keyword') {
    await addKeywordToEntity(collection, entityId, keyword);
  }

  if (pending.type === 'finance_create' || pending.type === 'gym_create') {
    const created = await createEntity(collection, entityName, keyword);
    entityId = created.entityId;
    entityName = created.entityName;
  }

  await clearPendingConfirmation(pending._id as ObjectId);

  return {
    collection,
    entityId,
    entityName,
    keyword,
    label: getCollectionLabel(collection),
    keywordNoun: getKeywordNoun(collection),
    entryData: pending.payload.entryData as Record<string, unknown>,
  };
};

export const createFinanceBusiness = async (name: string) => {
  const normalizedName = normalizeLookupText(name);
  const now = new Date();
  const result = await getFinanceBusinessesCollection().insertOne({
    name: normalizedName,
    keywords: [normalizedName],
    createdAt: now,
    updatedAt: now,
  });

  return {
    entityId: result.insertedId.toString(),
    entityName: normalizedName,
  };
};
