import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/postgres/**/*.test.ts'],
    globalSetup: ['test/postgres/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
