import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const webPort = Number(process.env['PAP_E2E_WEB_PORT'] || 31_607);
const apiPort = Number(process.env['PAP_E2E_API_PORT'] || 41_607);
const webUrl = `http://127.0.0.1:${String(webPort)}`;

// Zestaw E2E w LOCAL_DEV weryfikuje persony syntetyczne i lokalne API HTTP;
// zgodnie z ADR-011 (runtime-mode.ts) LOCAL_DEV wymaga NODE_ENV !== 'production' (next dev).
export default defineConfig({
  testDir: './apps/web/e2e',
  testIgnore: ['**/oidc-single-login-flow.spec.ts'],
  timeout: 240_000,
  expect: {
    timeout: 60_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    launchOptions: {
      args: ['--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${String(webPort)}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: `${webUrl}/login`,
    timeout: 180_000,
    reuseExistingServer: process.env['PAP_REUSE_EXISTING_WEB_SERVER'] === 'true',
    env: {
      CI: '1',
      __NEXT_AGENT_UPGRADE: 'security',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: '--max-old-space-size=640',
      PAP_RUNTIME_MODE: 'LOCAL_DEV',
      API_BASE_URL: `http://127.0.0.1:${String(apiPort)}`,
    },
  },
});
