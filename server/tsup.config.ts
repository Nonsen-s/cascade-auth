import { defineConfig } from 'tsup';

export default defineConfig({
  tsconfig: 'server/tsconfig.json',
  entry: [
    'server/src/main.ts',
    'server/src/migrate.ts',
    'server/src/worker.ts',
  ],
  outDir: 'server/dist',
  target: 'node22',
  format: ['esm'],
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
});
