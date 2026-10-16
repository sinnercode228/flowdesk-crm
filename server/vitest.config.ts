import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Needs the PostgreSQL client and a database: `npm run test:postgres` (vitest.postgres.config.ts).
    exclude: [...configDefaults.exclude, 'test/postgres/**'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
