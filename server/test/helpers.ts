import { randomUUID } from 'node:crypto';
import { copyFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import supertest from 'supertest';
import { expect, inject } from 'vitest';
import { DEMO_ACCOUNTS, generateDemoDataset, type AuthSession } from '@flowdesk/shared';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';

export const TEST_JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-signing';

/** Spins up an isolated app + database copy for one test file. */
export async function createTestContext(envOverrides: Record<string, string> = {}) {
  const template = inject('templateDb');
  const dbFile = join(dirname(template), `${randomUUID()}.db`);
  copyFileSync(template, dbFile);

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: `file:${dbFile}`,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    LOG_LEVEL: 'silent',
    RATE_LIMIT_LOGIN_MAX: '1000',
    RATE_LIMIT_MAX: '10000',
    ...envOverrides,
  });
  const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  const app = await buildApp({ env, prisma, logger: false });
  // Listen on an explicit loopback port: supertest's per-request ephemeral servers are flaky on newer Node.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = app.server.address() as AddressInfo;
  const request = supertest(`http://127.0.0.1:${port}`);

  const sessions = new Map<string, AuthSession>();
  async function login(role: keyof typeof DEMO_ACCOUNTS = 'admin'): Promise<AuthSession> {
    const res = await request.post('/api/auth/login').send(DEMO_ACCOUNTS[role]);
    expect(res.status).toBe(200);
    return res.body as AuthSession;
  }
  /** Authorization header for a role, logging in once per file. */
  async function authHeader(role: keyof typeof DEMO_ACCOUNTS = 'admin') {
    let session = sessions.get(role);
    if (!session) {
      session = await login(role);
      sessions.set(role, session);
    }
    return { Authorization: `Bearer ${session.accessToken}` };
  }

  async function close() {
    await app.close();
    await prisma.$disconnect();
    rmSync(dbFile, { force: true });
  }

  const dataset = generateDemoDataset({ now: new Date(inject('seedNow')) });
  return { app, env, prisma, request, login, authHeader, close, dataset };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
