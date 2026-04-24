import { FastifyInstance, FastifyRequest } from 'fastify';
import { ObjectId } from 'mongodb';
import {
  getMemory,
  getStructuredMemory,
  syncMemoryToFile,
} from '../services/memory.js';
import {
  getHistoryCollection,
  getFinanceCategoriesCollection,
  getFinanceBusinessesCollection,
  getGymExercisesCollection,
  getFinanceCollection,
  getGymCollection,
  getJournalCollection,
  getTodoCollection,
  getMemoryCollection,
  getStructuredMemoryCollection,
  normalizeKeywordList,
} from '../services/db.js';

const USER_ID = 'default';

const COLLECTIONS: Record<string, () => any> = {
  journal: getJournalCollection,
  gym: getGymCollection,
  finance: getFinanceCollection,
  todo: getTodoCollection,
  finance_categories: getFinanceCategoriesCollection,
  finance_businesses: getFinanceBusinessesCollection,
  gym_exercises: getGymExercisesCollection,
};

const normalizeKeywordsFromBody = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    return normalizeKeywordList(value.map((v) => String(v)));
  }
  if (typeof value === 'string') {
    const parts = value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return normalizeKeywordList(parts);
  }
  return undefined;
};

export default async function crudRoutes(fastify: FastifyInstance) {
  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  fastify.get('/api/memory', async (_request, reply) => {
    const mem = await getMemory(USER_ID);
    return reply.send({
      summary:
        typeof mem?.dynamicMemory === 'string'
          ? mem.dynamicMemory
          : mem?.dynamicMemory?.summary || '',
      keyPoints:
        typeof mem?.dynamicMemory === 'object' && mem.dynamicMemory
          ? mem.dynamicMemory.keyPoints || []
          : [],
      lastUpdated:
        (typeof mem?.dynamicMemory === 'object' && mem?.dynamicMemory?.lastUpdated) ||
        mem?.lastUpdated,
    });
  });

  fastify.patch(
    '/api/memory',
    async (
      request: FastifyRequest<{ Body: { summary?: string; keyPoints?: string[] } }>,
      reply,
    ) => {
      const { summary, keyPoints } = request.body;
      const col = getMemoryCollection();
      const now = new Date();
      await col.updateOne(
        { userId: USER_ID },
        {
          $set: {
            'dynamicMemory.summary': summary,
            'dynamicMemory.keyPoints': keyPoints,
            'dynamicMemory.lastUpdated': now,
            lastUpdated: now,
          },
        },
        { upsert: true },
      );
      return reply.send({ status: 'ok' });
    },
  );

  fastify.get('/api/structured-memory', async (_request, reply) => {
    const mem = await getStructuredMemory(USER_ID);
    return reply.send(mem);
  });

  fastify.patch(
    '/api/structured-memory',
    async (request: FastifyRequest<{ Body: any }>, reply) => {
      const updatedMemory = request.body;
      const col = getStructuredMemoryCollection();
      const now = new Date();
      await col.updateOne(
        { userId: USER_ID },
        { $set: { memory: updatedMemory, lastUpdated: now } },
        { upsert: true },
      );
      await syncMemoryToFile(updatedMemory);
      return reply.send({ status: 'ok' });
    },
  );

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  fastify.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/history',
    async (request, reply) => {
      const limit = Math.max(
        1,
        Math.min(parseInt(request.query.limit || '30', 10) || 30, 200),
      );
      const cursor = (request.query.cursor || '').trim();
      const query: Record<string, unknown> = { userId: USER_ID };

      if (cursor) {
        try {
          query._id = { $lt: new ObjectId(cursor) };
        } catch {
          return reply.status(400).send({ error: 'Invalid cursor' });
        }
      }

      const docs = await getHistoryCollection()
        .find(query)
        .sort({ _id: -1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = docs.length > limit;
      const pageDocs = hasMore ? docs.slice(0, limit) : docs;
      pageDocs.reverse();

      const nextCursor = pageDocs.length > 0 ? String(pageDocs[0]._id) : null;
      const items = pageDocs.map((doc: any) => ({
        _id: String(doc._id),
        role: doc.role,
        content: doc.content,
        timestamp: doc.timestamp,
      }));

      return reply.send({ items, hasMore, nextCursor });
    },
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/history/:id',
    async (request, reply) => {
      const { id } = request.params;
      try {
        await getHistoryCollection().deleteOne({ _id: new ObjectId(id), userId: USER_ID });
        return reply.send({ status: 'ok' });
      } catch {
        return reply.status(400).send({ error: 'Invalid ID' });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Generic collection entries
  // -------------------------------------------------------------------------

  fastify.get<{
    Params: { collection: string };
    Querystring: { page?: string; limit?: string; filter?: string };
  }>('/api/entries/:collection', async (request, reply) => {
    const { collection } = request.params;
    const page = parseInt(request.query.page || '1', 10);
    const limit = parseInt(request.query.limit || '50', 10);
    const filterStr = request.query.filter;

    const getCol = COLLECTIONS[collection];
    if (!getCol) return reply.status(400).send({ error: 'Unknown collection' });
    const col = getCol();
    const skip = (page - 1) * limit;

    let query: Record<string, any> = {};
    if (filterStr) {
      try {
        query = JSON.parse(filterStr);
        if (
          query.exerciseId &&
          typeof query.exerciseId === 'string' &&
          query.exerciseId.length === 24
        ) {
          query['exercise.id'] = query.exerciseId;
          delete query.exerciseId;
        }
      } catch {
        console.warn('[API] Failed to parse filter query:', filterStr);
      }
    }

    const [items, total] = await Promise.all([
      col.find(query).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(query),
    ]);
    return reply.send({ items, total, page, limit, pages: Math.ceil(total / limit) });
  });

  fastify.patch<{
    Params: { collection: string; id: string };
    Body: Record<string, unknown>;
  }>('/api/entries/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params;
    const getCol = COLLECTIONS[collection];
    if (!getCol) return reply.status(400).send({ error: 'Unknown collection' });

    const body = { ...request.body };
    delete body._id;

    if (collection === 'finance_categories' || collection === 'gym_exercises') {
      const originalName = typeof body.name === 'string' ? body.name.trim() : '';
      if (originalName) {
        body.name = originalName;
        // Ensure normalized name is the first keyword
        const normalizedName = originalName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        const currentKeywords = normalizeKeywordsFromBody(body.keywords) || [];
        // Prepend and remove duplicates
        body.keywords = [normalizedName, ...currentKeywords.filter(k => k !== normalizedName)];
      }
    }

    const col = getCol();
    const now = new Date();

    if (id === 'new') {
      const result = await col.insertOne({ ...body, createdAt: now, updatedAt: now });
      return reply.send({ status: 'ok', _id: result.insertedId });
    }

    try {
      await col.updateOne({ _id: new ObjectId(id) }, { $set: { ...body, updatedAt: now } });
      return reply.send({ status: 'ok' });
    } catch {
      return reply.status(400).send({ error: 'Invalid ID' });
    }
  });

  fastify.delete<{ Params: { collection: string; id: string } }>(
    '/api/entries/:collection/:id',
    async (request, reply) => {
      const { collection, id } = request.params;
      const getCol = COLLECTIONS[collection];
      if (!getCol) return reply.status(400).send({ error: 'Unknown collection' });
      await getCol().deleteOne({ _id: new ObjectId(id) });
      return reply.send({ status: 'ok' });
    },
  );

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  fastify.get('/api/settings', async (_request, reply) => {
    const mem = await getMemory(USER_ID);
    return reply.send({ preferredModel: mem?.preferredModel || '' });
  });

  fastify.post(
    '/api/settings',
    async (request: FastifyRequest<{ Body: { preferredModel: string } }>, reply) => {
      const mem = await getMemory(USER_ID);
      const newModel = request.body?.preferredModel?.trim() || '';
      if (mem?.preferredModel !== newModel) {
        const { updatePreferredModel } = await import('../services/memory.js');
        await updatePreferredModel(USER_ID, newModel);
      }
      return reply.send({ status: 'ok' });
    },
  );
}
