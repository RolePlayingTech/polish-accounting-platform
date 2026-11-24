import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { redactSecretsAndPiiForMcp } from '@pap/application/mcp-gateway';
import { createStatusServer } from './server.js';
import { startPapMcpStdioUpstreamBridge } from './stdio-bridge.js';

/**
 * Domyślny punkt wejścia CLI (@pap/mcp):
 * - bez `PAP_MCP_TRANSPORT` (lub `stdio`): lokalny serwer STDIO ze statusem publicznym,
 * - `PAP_MCP_TRANSPORT=stdio-upstream`: uwierzytelniony most STDIO -> lokalny Streamable HTTP
 *   (`PAP_MCP_UPSTREAM_URL` wyłącznie na loopback + `PAP_MCP_BEARER_TOKEN`, fail-closed),
 * - `PAP_MCP_TRANSPORT=http`: odmowa uruchomienia z CLI bez wstrzykniętego weryfikatora OIDC (fail-closed).
 */
const transportMode = process.env['PAP_MCP_TRANSPORT'] ?? 'stdio';

if (transportMode === 'http') {
  process.stderr.write(
    'Zdalny serwer MCP Streamable HTTP wymaga jawnego wstrzyknięcia OidcAccessTokenVerifier i UserIdentityResolver (startPapMcpHttpServer). Odmowa uruchomienia bez weryfikatora OIDC (fail-closed).\n',
  );
  process.exitCode = 1;
} else if (transportMode === 'stdio-upstream') {
  const upstreamUrl = process.env['PAP_MCP_UPSTREAM_URL'] ?? '';
  const bearerToken = process.env['PAP_MCP_BEARER_TOKEN'] ?? '';
  startPapMcpStdioUpstreamBridge({
    upstreamUrl,
    bearerToken,
  }).catch((err: unknown) => {
    const rawMsg = err instanceof Error ? err.message : 'Nieznany błąd uruchomienia mostu STDIO';
    const safeMsg = redactSecretsAndPiiForMcp(rawMsg, bearerToken ? [bearerToken] : []);
    process.stderr.write(`Odmowa uruchomienia mostu STDIO MCP (fail-closed): ${safeMsg}\n`);
    process.exitCode = 1;
  });
} else if (transportMode === 'stdio') {
  serveStdio(createStatusServer);
} else {
  process.stderr.write(
    `Nieobsługiwany tryb PAP_MCP_TRANSPORT="${redactSecretsAndPiiForMcp(transportMode)}". Dozwolone: stdio, stdio-upstream.\n`,
  );
  process.exitCode = 1;
}
