import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const webPort = Number(process.env['PAP_E2E_WEB_PORT'] || 31_608);
const webBindUrl = `http://127.0.0.1:${String(webPort)}/academy`;
const browserBaseUrl = `http://localhost:${String(webPort)}`;
const apiPortA = Number(process.env['PAP_E2E_API_PORT_A'] || 41_608);
const oidcIdpPort = Number(process.env['PAP_E2E_OIDC_IDP_PORT'] || 42_608);
const sharedBffSecret = 'pap-e2e-oidc-shared-bff-session-secret-key-min-32b!!';
const useNextStart =
  process.env['PAP_PLAYWRIGHT_USE_NEXT_START'] !== 'false' &&
  existsSync(resolve(process.cwd(), 'apps/web/.next/BUILD_ID'));
const nextMode = useNextStart ? 'start' : 'dev';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: ['**/oidc-single-login-flow.spec.ts'],
  timeout: 240_000,
  expect: {
    timeout: 45_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: browserBaseUrl,
    browserName: 'chromium',
    actionTimeout: 45_000,
    navigationTimeout: 60_000,
    launchOptions: {
      args: ['--host-resolver-rules=MAP localhost 127.0.0.1', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next ${nextMode} --hostname 127.0.0.1 --port ${String(webPort)}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: webBindUrl,
    timeout: 150_000,
    reuseExistingServer: process.env['PAP_REUSE_EXISTING_WEB_SERVER'] === 'true',
    env: {
      CI: '1',
      __NEXT_AGENT_UPGRADE: 'security',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_OPTIONS: useNextStart ? '--max-old-space-size=256' : '--max-old-space-size=512',
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      PAP_OIDC_ENV: 'test',
      API_BASE_URL: `http://127.0.0.1:${String(apiPortA)}`,
      PAP_WEB_SESSION_SECRET: sharedBffSecret,
      PAP_OIDC_ISSUER: `http://127.0.0.1:${String(oidcIdpPort)}`,
      PAP_OIDC_CLIENT_ID: 'pap-web',
      PAP_OIDC_TOKEN_AUTH_METHOD: 'none',
      PAP_OIDC_REDIRECT_URI: `${browserBaseUrl}/api/session/oidc/callback`,
      PAP_OIDC_SCOPES: 'openid profile email pap:ui:full pap:mcp:read pap:mcp:prepare',
    },
  },
});
