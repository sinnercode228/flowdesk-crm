import fp from 'fastify-plugin';
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../config/env';

declare module 'fastify' {
  interface FastifyInstance {
    config: Env;
    prisma: PrismaClient;
  }
}

export interface ContextOptions {
  env: Env;
  prisma: PrismaClient;
}

/** Makes validated config and the Prisma client available to every route and plugin. */
export default fp<ContextOptions>(
  async (app, { env, prisma }) => {
    app.decorate('config', env);
    app.decorate('prisma', prisma);
  },
  { name: 'config' },
);
