import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const webPort = 31_607;
const webUrl = `http://127.0.0.1:${webPort}`;
const useNextStart =
  process.env['PAP_PLAYWRIGHT_USE_NEXT_START'] === 'true' &&
  existsSync(resolve(process.cwd(), 'apps/web/.next/BUILD_ID'));
const nextMode = useNextStart ? 'start' : 'dev';

export default defineConfig({
  testDir: './apps/web/e2e',
  testIgnore: ['**/oidc-single-login-flow.spec.ts'],
  timeout: 180_000,
  expect: {
    timeout: 35_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next ${nextMode} --hostname 127.0.0.1 --port ${webPort}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: webUrl,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_OPTIONS: '--max-old-space-size=192',
      API_BASE_URL: 'http://127.0.0.1:41607',
    },
  },
});
