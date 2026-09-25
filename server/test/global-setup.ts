import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { TestProject } from 'vitest/node';
import { seedDatabase } from '../src/db/seed';

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
    seedNow: string;
  }
}

/**
 * Creates one seeded SQLite template database per test run. Every test file copies it,
 * so files run in parallel with full isolation and no Docker/PostgreSQL requirement.
 */
export default async function setup(project: TestProject) {
  const root = resolve(import.meta.dirname, '..');
  const tmp = resolve(root, '.tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  const template = resolve(tmp, 'template.db');
  execSync('npx prisma db push --schema prisma/sqlite/schema.prisma --skip-generate', {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${template}` },
    stdio: 'pipe',
  });

  const seedNow = new Date().toISOString();
  const prisma = new PrismaClient({ datasourceUrl: `file:${template}` });
  await seedDatabase(prisma, { now: new Date(seedNow) });
  await prisma.$disconnect();

  project.provide('templateDb', template);
  project.provide('seedNow', seedNow);

  return () => rmSync(tmp, { recursive: true, force: true });
}
