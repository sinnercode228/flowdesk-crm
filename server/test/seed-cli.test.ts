import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverRoot = resolve(import.meta.dirname, '..');
const cli = resolve(serverRoot, 'src/db/seed-cli.ts');

function runCli(args: string[], databaseUrl: string) {
  return spawnSync('npx', ['--no-install', 'tsx', cli, ...args], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
    encoding: 'utf8',
  });
}

describe('seed-cli', () => {
  let dir: string;
  let dbFile: string;
  let databaseUrl: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'flowdesk-seed-cli-'));
    mkdirSync(dir, { recursive: true });
    dbFile = join(dir, 'cli.db');
    databaseUrl = `file:${dbFile}`;
    execSync('npx prisma db push --schema prisma/sqlite/schema.prisma --skip-generate', {
      cwd: serverRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('seeds an empty database with no flags', async () => {
    const result = runCli([], databaseUrl);
    expect(result.status).toBe(0);
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      expect(await prisma.user.count()).toBeGreaterThan(0);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('refuses to overwrite a non-empty database without --reset', async () => {
    // The previous test left the database seeded; a second run must refuse.
    const result = runCli([], databaseUrl);
    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/--reset/);
  });

  it('--if-empty skips a non-empty database without failing', async () => {
    const result = runCli(['--if-empty'], databaseUrl);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/skipping|already has data/i);
  });

  it('--reset wipes a non-empty database and reseeds', async () => {
    const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
    try {
      // Add a row the demo dataset will not keep: a refresh token for an unrelated user id.
      const user = await prisma.user.findFirstOrThrow();
      await prisma.refreshToken.create({
        data: {
          id: 'test-token-id',
          familyId: 'test-family',
          userId: user.id,
          tokenHash: 'x'.repeat(64),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const before = await prisma.refreshToken.count();
      expect(before).toBeGreaterThan(0);

      const result = runCli(['--reset'], databaseUrl);
      expect(result.status).toBe(0);

      // RefreshToken rows are wiped by a reseed; demo data has none.
      expect(await prisma.refreshToken.count()).toBe(0);
      expect(await prisma.user.count()).toBeGreaterThan(0);
    } finally {
      await prisma.$disconnect();
    }
  });
});
