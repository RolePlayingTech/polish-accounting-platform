import { defineConfig } from '@playwright/test';

const webPort = Number(process.env.PAP_BENCH_WEB_PORT ?? '31801');
const webUrl = process.env.APP_URL ?? `http://127.0.0.1:${String(webPort)}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['playwright/**/*.spec.ts', 'diagnostics/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: './playwright-results/report.json' }]],
  outputDir: './playwright-results/artifacts',
  use: {
    baseURL: webUrl,
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
  },
});
