import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const webPort = 31_607;
const webUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${webPort}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: webUrl,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      API_BASE_URL: 'http://127.0.0.1:41607',
    },
  },
});
