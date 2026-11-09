import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const webPort = 31_608;
const webBindUrl = `http://127.0.0.1:${String(webPort)}/academy`;
const browserBaseUrl = `http://localhost:${String(webPort)}`;
const apiPortA = 41_608;
const oidcIdpPort = 42_608;
const sharedBffSecret = 'pap-e2e-oidc-shared-bff-session-secret-key-min-32b!!';

export default defineConfig({
  testDir: './apps/web/e2e',
  testMatch: ['**/oidc-single-login-flow.spec.ts'],
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: browserBaseUrl,
    browserName: 'chromium',
    launchOptions: {
      args: ['--host-resolver-rules=MAP localhost 127.0.0.1'],
    },
  },
  webServer: {
    command: `"${process.execPath}" node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${String(webPort)}`,
    cwd: resolve(process.cwd(), 'apps/web'),
    url: webBindUrl,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
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
