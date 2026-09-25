/**
 * `npm run db:seed` — resets the database to the demo dataset.
 * `node dist/seed.js --if-empty` — seeds only a fresh database (used by the Docker entrypoint).
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../config/dotenv';
import { isDatabaseEmpty, seedDatabase } from './seed';

loadDotEnv();
const prisma = new PrismaClient();

try {
  if (process.argv.includes('--if-empty') && !(await isDatabaseEmpty(prisma))) {
    console.log('[seed] database already has data, skipping');
  } else {
    const result = await seedDatabase(prisma);
    console.log('[seed] done', result);
  }
} catch (err) {
  console.error('[seed] failed', err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
