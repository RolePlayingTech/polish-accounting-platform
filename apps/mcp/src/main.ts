import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createStatusServer } from './server.js';

/**
 * Domyślny punkt wejścia CLI (@pap/mcp): lokalny serwer STDIO ze statusem publicznym.
 * Zdalny transport Streamable HTTP (127.0.0.1:4110 lub /api/v1/mcp) uruchamia się
 * wyłącznie z jawnie podpiętym OidcAccessTokenVerifier oraz UserIdentityResolver
 * poprzez `startPapMcpHttpServer(...)` / `handlePapMcpHttpRequest(...)` (fail-closed).
 */
if (process.env['PAP_MCP_TRANSPORT'] === 'http') {
  process.stderr.write(
    'Zdalny serwer MCP Streamable HTTP wymaga jawnego wstrzyknięcia OidcAccessTokenVerifier i UserIdentityResolver (startPapMcpHttpServer). Odmowa uruchomienia bez weryfikatora OIDC (fail-closed).\n',
  );
  process.exitCode = 1;
} else {
  serveStdio(createStatusServer);
}
