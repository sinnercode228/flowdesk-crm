// Writes the OpenAPI document to docs/openapi.json without a database connection.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app';
import { loadEnv } from '../src/config/env';

const env = loadEnv({ ...process.env, DATABASE_URL: 'file:./unused.db', LOG_LEVEL: 'silent' });
const app = await buildApp({ env, prisma: {} as PrismaClient, logger: false });
await app.ready();
const target = resolve(import.meta.dirname, '../../docs/openapi.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`OpenAPI document written to ${target}`);
