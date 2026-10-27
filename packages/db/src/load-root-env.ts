import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));

export function loadRootEnvFile(): void {
  try {
    loadEnvFile(ROOT_ENV_FILE);
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}
