import { config } from 'dotenv';
import { readServerConfig } from './config.js';

export function loadServerConfig() {
  config({ path: process.env.SERVER_ENV_FILE ?? '.env.server', quiet: true });
  return readServerConfig(process.env);
}
