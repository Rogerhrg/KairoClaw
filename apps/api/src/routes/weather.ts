import { FastifyInstance } from 'fastify';
import { getMonterreyWeather } from '../services/weather.js';

export default async function weatherRoutes(fastify: FastifyInstance) {
  fastify.get('/api/weather', async (request, reply) => {
    try {
      const weather = await getMonterreyWeather();
      if (!weather) {
        return reply.status(503).send({ error: 'Weather data unavailable' });
      }
      return reply.send(weather);
    } catch (error) {
      fastify.log.error(error, '[Weather Route] Error');
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
