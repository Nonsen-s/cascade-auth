import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = {
  unit: [
    'vitest/vitest.mjs',
    'run',
    '--config',
    'local-only/qa/vitest.config.ts',
  ],
  watch: ['vitest/vitest.mjs', '--config', 'local-only/qa/vitest.config.ts'],
  server: [
    'vitest/vitest.mjs',
    'run',
    '--config',
    'local-only/qa/vitest.server.config.ts',
  ],
  e2e: [
    '@playwright/test/cli.js',
    'test',
    '--config',
    'local-only/qa/playwright.config.ts',
  ],
  types: ['typescript/bin/tsc', '-p', 'local-only/qa/tsconfig.json'],
};
const command = commands[process.argv[2]];
if (!command) {
  console.error(
    'Specify a local QA command: unit, watch, server, e2e or types.',
  );
  process.exit(1);
}
const [binary, ...args] = command;
const config = args.at(-1);
if (!existsSync(resolve(root, config))) {
  console.error(
    'Local QA is stored in local-only/qa and is excluded from Git. ' +
      'Use npm run check to validate the published source and build.',
  );
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [resolve(root, 'node_modules', binary), ...args, ...process.argv.slice(3)],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(`Unable to start local QA: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
