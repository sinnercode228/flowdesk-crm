/**
 * `npm run db:seed` — seeds the demo dataset into an empty database; refuses a non-empty one.
 * `npm run db:seed -- --if-empty` — same, but a non-empty database is a success (used by the Docker entrypoint).
 * `npm run db:seed -- --reset` — wipes the database and reseeds it.
 */
import { PrismaClient } from '@prisma/client';
import { loadDotEnv } from '../config/dotenv';
import { isDatabaseEmpty, seedDatabase } from './seed';

loadDotEnv();
const prisma = new PrismaClient();

try {
  const ifEmpty = process.argv.includes('--if-empty');
  const reset = process.argv.includes('--reset');
  const empty = await isDatabaseEmpty(prisma);

  if (!empty && !reset) {
    if (ifEmpty) {
      console.log('[seed] database already has data, skipping');
    } else {
      console.error(
        '[seed] database already has data; refusing to wipe it. ' +
          'Pass --reset to overwrite, or --if-empty to make this a no-op.',
      );
      process.exitCode = 1;
    }
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
