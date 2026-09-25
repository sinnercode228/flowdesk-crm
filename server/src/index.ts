import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadDotEnv } from './config/dotenv';
import { loadEnv } from './config/env';
import { isDatabaseEmpty, seedDatabase } from './db/seed';

loadDotEnv();
const env = loadEnv();
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const app = await buildApp({ env, prisma });

if (env.SEED_ON_START && (await isDatabaseEmpty(prisma))) {
  const result = await seedDatabase(prisma);
  app.log.info({ result }, 'seeded demo data');
}

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  app.log.info(`API docs: http://localhost:${env.PORT}/docs`);
} catch (err) {
  app.log.error({ err }, 'failed to start');
  await prisma.$disconnect();
  process.exit(1);
}
