import { existsSync } from 'node:fs';

/** Loads `.env` from the working directory when present (Node's built-in loader, no dependency). */
export function loadDotEnv(path = '.env') {
  if (existsSync(path)) process.loadEnvFile(path);
}
