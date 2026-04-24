import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyStatic from '@fastify/static';
import { connectDB } from './services/db.js';

import chatRoutes from './routes/chat.js';
import crudRoutes from './routes/crud.js';
import telegramRoutes from './routes/telegram.js';
import { restoreRemindersOnBoot } from './services/reminders.js';
import { initCronJobs } from './services/cron.js';

dotenv.config();

const fastify = Fastify({
  logger: true
});

// Simple Auth Hook
fastify.addHook('onRequest', async (request, reply) => {
  // Only apply strict auth to /api routes
  if (!request.url.startsWith('/api')) {
    return; // allow static web files
  }

  // Exclude checking on telegram webhook
  if (request.url.startsWith('/api/telegram/webhook')) {
    return;
  }

  // Pre-flight CORS check
  if (request.method === 'OPTIONS') {
    return;
  }

  // Auth check reading email and password (using Basic auth convention or custom headers)
  const expectedEmail = process.env.USER_EMAIL;
  const expectedPassword = process.env.USER_PASSWORD;

  if (!expectedEmail || !expectedPassword) {
    fastify.log.warn('USER_EMAIL or USER_PASSWORD not set. Accepting all requests.');
    return;
  }

  const authHeader = request.headers.authorization;
  if (!authHeader) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  if (authHeader.startsWith('Basic ')) {
    const b64 = authHeader.split(' ')[1];
    const [email, password] = Buffer.from(b64, 'base64').toString().split(':');
    if (email !== expectedEmail || password !== expectedPassword) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  } else {
    // Fallback if needed but we'll adapt the frontend to use Basic Auth
    return reply.status(401).send({ error: 'Unauthorized' });
  }
});

// CORS (rudimentary for Vite dev server & simplistic static serving)
fastify.addHook('onRequest', async (req, reply) => {
  reply.header('Access-Control-Allow-Origin', '*');
  reply.header('Access-Control-Allow-Headers', 'authorization, content-type');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
});

fastify.options('/*', async (request, reply) => {
  return reply.send();
});

// Register routes
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../../web/dist'),
  prefix: '/'
});

// Serve index.html for unknown logic to support React Router natively
fastify.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api')) {
    reply.code(404).send({ error: 'Not Found' });
  } else {
    // bypass fastify types for sendFile
    (reply as any).sendFile('index.html');
  }
});

fastify.register(chatRoutes);
fastify.register(crudRoutes);
fastify.register(telegramRoutes);

// Run server
const start = async () => {
  try {
    await connectDB();
    console.log("DEBUG: DB connected successfully");
    await restoreRemindersOnBoot();
    initCronJobs();
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`API running on http://localhost:3000`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
