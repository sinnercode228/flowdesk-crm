import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', seed: 'src/db/seed-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // The shared workspace package ships TypeScript sources, so bundle it into the output.
  noExternal: ['@flowdesk/shared'],
});
