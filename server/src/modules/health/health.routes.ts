import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { API_VERSION } from '../../plugins/swagger';

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  version: z.string(),
  uptimeSeconds: z.number(),
});

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Liveness and database connectivity',
        response: { 200: HealthSchema, 503: HealthSchema },
      },
    },
    async (_request, reply) => {
      let database: 'up' | 'down' = 'up';
      try {
        await app.prisma.$queryRaw`SELECT 1`;
      } catch (err) {
        app.log.warn({ err }, 'database health check failed');
        database = 'down';
      }
      return reply.status(database === 'up' ? 200 : 503).send({
        status: database === 'up' ? 'ok' : 'degraded',
        database,
        version: API_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
      });
    },
  );
};
