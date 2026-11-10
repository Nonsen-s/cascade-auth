import { ConfigurationError } from './config.js';
import { loadServerConfig } from './environment.js';
import { createRuntime } from './runtime.js';

async function main() {
  const config = loadServerConfig();
  const runtime = await createRuntime(config);
  try {
    await runtime.server.listen({ host: config.host, port: config.port });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  if (config.runMailWorker) runtime.worker.start();
  const shutdown = () => {
    void runtime.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.stderr.write('Graceful shutdown failed\n');
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof ConfigurationError
      ? `${error.message}\n`
      : 'Server startup failed. Check database, migrations and configuration.\n',
  );
  process.exitCode = 1;
});
