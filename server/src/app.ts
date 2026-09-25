import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { PrismaClient } from '@prisma/client';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Env } from './config/env';
import { AppError } from './lib/errors';
import authPlugin from './plugins/auth';
import contextPlugin from './plugins/context';
import { registerErrorHandling } from './plugins/error-handler';
import swaggerPlugin from './plugins/swagger';
import { analyticsRoutes } from './modules/analytics/analytics.routes';
import { authRoutes } from './modules/auth/auth.routes';
import { contactRoutes } from './modules/contacts/contacts.routes';
import { dealRoutes } from './modules/deals/deals.routes';
import { healthRoutes } from './modules/health/health.routes';
import { stageRoutes } from './modules/stages/stages.routes';
import { userRoutes } from './modules/users/users.routes';

export interface BuildAppOptions {
  env: Env;
  prisma: PrismaClient;
  /** Override the logger (tests pass `false`). */
  logger?: FastifyServerOptions['logger'];
}

export function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  if (env.LOG_LEVEL === 'silent') return false;
  return {
    level: env.LOG_LEVEL,
    // Never write credentials or tokens to the logs.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[redacted]',
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  };
}

export async function buildApp({ env, prisma, logger }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? loggerOptions(env),
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(contextPlugin, { env, prisma });
  // JSON-only API: the content security policy is owned by the web host (and Swagger UI needs inline assets).
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: ['x-request-id', 'retry-after'],
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', `Too many requests, retry in ${context.after}`),
  });
  await app.register(swaggerPlugin);
  await app.register(authPlugin);
  registerErrorHandling(app);

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(stageRoutes, { prefix: '/stages' });
      await api.register(dealRoutes, { prefix: '/deals' });
      await api.register(contactRoutes, { prefix: '/contacts' });
      await api.register(analyticsRoutes, { prefix: '/analytics' });
    },
    { prefix: '/api' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
