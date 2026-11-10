import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
if (mode !== 'build' && mode !== 'up') {
  console.error('Specify a Docker command: build or up.');
  process.exit(1);
}

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}

async function build(dockerfile, tag, files) {
  // A tar context avoids BuildKit session headers containing the checkout's
  // non-ASCII path. Keep this input list aligned with .dockerignore.
  const archive = spawn('tar', ['-cf', '-', ...files], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  const docker = spawn(
    'docker',
    ['build', '--file', dockerfile, '--target', 'runtime', '--tag', tag, '-'],
    {
      cwd: parse(root).root,
      stdio: ['pipe', 'inherit', 'inherit'],
      windowsHide: true,
    },
  );
  archive.once('error', () => docker.kill());
  docker.once('error', () => archive.kill());
  docker.stdin.on('error', () => archive.kill());
  archive.stdout.pipe(docker.stdin);
  const codes = await Promise.all([completed(archive), completed(docker)]);
  if (codes.some((code) => code !== 0))
    throw new Error(`Unable to build ${tag}.`);
}

try {
  if (mode === 'up') {
    const validation = spawn(
      'docker',
      ['compose', '--env-file', '.env.docker', 'config', '--quiet'],
      { cwd: root, stdio: 'inherit', windowsHide: true },
    );
    if ((await completed(validation)) !== 0)
      throw new Error(
        'Invalid Docker configuration. Run npm run docker:setup first.',
      );
  }
  const files = [
    '.dockerignore',
    'package.json',
    'package-lock.json',
    'index.html',
    'vite.config.ts',
    ...(await readdir(root)).filter((name) => /^tsconfig.*\.json$/.test(name)),
    'server/Dockerfile',
    'server/src',
    'server/migrations',
    'server/tsconfig.json',
    'server/tsup.config.ts',
    'shared',
    'src',
    'public',
    'docker',
  ];
  await build('server/Dockerfile', 'cascade-auth-api:local', files);
  await build('docker/web.Dockerfile', 'cascade-auth-web:local', files);
  if (mode === 'up') {
    const child = spawn(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.docker',
        'up',
        '-d',
        '--no-build',
        '--wait',
      ],
      { cwd: root, stdio: 'inherit', windowsHide: true },
    );
    process.exitCode = await completed(child);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
