import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../../src/db/seed';

/**
 * Applies the migrations to TEST_POSTGRES_URL and resets it to the demo dataset, so point it at
 * a throwaway database. Without the variable the tests skip themselves and nothing runs here.
 */
export default async function setup() {
  const url = process.env.TEST_POSTGRES_URL;
  if (!url) return;
  execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
    cwd: resolve(import.meta.dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await seedDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }
}
