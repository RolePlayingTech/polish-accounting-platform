import type { Readable, Writable } from 'node:stream';
import type { JSONRPCMessage } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { redactSecretsAndPiiForMcp } from '@pap/application/mcp-gateway';

const ALLOWED_LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  '127.0.0.1',
  'localhost',
  '[::1]',
  '::1',
]);

const ALLOWED_UPSTREAM_PATHS: ReadonlySet<string> = new Set(['/mcp', '/api/v1/mcp']);

const STRICT_BEARER_TOKEN_REGEX = /^[A-Za-z0-9._~+/=-]{8,4096}$/;

export interface ValidatedLoopbackUpstreamConfig {
  readonly canonicalUrl: string;
  readonly hostHeader: string;
}

/**
 * Validates that an STDIO bridge upstream URL targets ONLY a local loopback MCP endpoint
 * (`/mcp` or `/api/v1/mcp`) without credentials or query tokens — zero SSRF or arbitrary network egress.
 */
export function validateLoopbackMcpUpstreamUrl(
  rawUrl: string | undefined | null,
):
  | { readonly ok: true; readonly config: ValidatedLoopbackUpstreamConfig }
  | { readonly ok: false; readonly reason: string } {
  if (!rawUrl || rawUrl.trim().length === 0) {
    return {
      ok: false,
      reason: 'Brak wymaganego adresu PAP_MCP_UPSTREAM_URL dla trybu stdio-upstream.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      ok: false,
      reason: 'Nieprawidłowy format URL w PAP_MCP_UPSTREAM_URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      reason:
        'PAP_MCP_UPSTREAM_URL musi używać protokołu http: lub https: na interfejsie loopback.',
    };
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return {
      ok: false,
      reason: 'Poświadczenia w URL (userinfo) są zabronione w PAP_MCP_UPSTREAM_URL.',
    };
  }

  if (parsed.search !== '' || parsed.hash !== '') {
    return {
      ok: false,
      reason:
        'Parametry zapytania (query) i fragmenty w PAP_MCP_UPSTREAM_URL są zabronione (RFC 9700).',
    };
  }

  const normalizedHostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_LOOPBACK_HOSTS.has(normalizedHostname)) {
    return {
      ok: false,
      reason: `Host "${redactSecretsAndPiiForMcp(parsed.hostname)}" nie należy do dozwolonych adresów loopback (127.0.0.1, localhost, [::1]).`,
    };
  }

  if (!ALLOWED_UPSTREAM_PATHS.has(parsed.pathname)) {
    return {
      ok: false,
      reason: `Ścieżka "${parsed.pathname}" nie jest dozwolonym punktem końcowym MCP (/mcp lub /api/v1/mcp).`,
    };
  }

  return {
    ok: true,
    config: {
      canonicalUrl: parsed.toString(),
      hostHeader: parsed.host,
    },
  };
}

export interface StartPapMcpStdioUpstreamBridgeOptions {
  readonly upstreamUrl: string;
  readonly bearerToken: string;
  readonly stdin?: Readable | undefined;
  readonly stdout?: Writable | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
}

export interface RunningPapMcpStdioBridge {
  readonly close: () => Promise<void>;
}

function parseSseJsonRpcMessages(sseBody: string): JSONRPCMessage[] {
  const messages: JSONRPCMessage[] = [];
  const normalized = sseBody.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');

  for (const block of blocks) {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      continue;
    }
    const payload = dataLines.join('\n').trim();
    if (!payload) {
      continue;
    }
    const parsed: unknown = JSON.parse(payload);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        messages.push(item as JSONRPCMessage);
      }
    } else if (parsed && typeof parsed === 'object') {
      messages.push(parsed as JSONRPCMessage);
    }
  }

  return messages;
}

function isJsonRpcRequestWithId(
  message: JSONRPCMessage,
): message is JSONRPCMessage & { readonly id: string | number } {
  return (
    'id' in message &&
    (typeof message.id === 'string' || typeof message.id === 'number') &&
    'method' in message
  );
}

/**
 * Starts a fail-closed STDIO MCP transport that bridges JSON-RPC messages over authenticated
 * loopback Streamable HTTP (`/api/v1/mcp` or `/mcp`) without importing `@pap/db` into `@pap/mcp`.
 */
export async function startPapMcpStdioUpstreamBridge(
  options: StartPapMcpStdioUpstreamBridgeOptions,
): Promise<RunningPapMcpStdioBridge> {
  const urlCheck = validateLoopbackMcpUpstreamUrl(options.upstreamUrl);
  if (!urlCheck.ok) {
    throw new Error(urlCheck.reason);
  }

  const trimmedToken = options.bearerToken.trim();
  if (!STRICT_BEARER_TOKEN_REGEX.test(trimmedToken)) {
    throw new Error(
      'Brak lub nieprawidłowy format tokenu PAP_MCP_BEARER_TOKEN dla mostu STDIO (fail-closed).',
    );
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const transport = new StdioServerTransport(options.stdin, options.stdout);
  let sessionId: string | null = null;
  let closed = false;

  const forwardMessage = async (message: JSONRPCMessage): Promise<void> => {
    if (closed) {
      return;
    }
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${trimmedToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        host: urlCheck.config.hostHeader,
      };
      if (sessionId) {
        headers['mcp-session-id'] = sessionId;
      }

      const response = await fetchFn(urlCheck.config.canonicalUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
      });

      const returnedSessionId = response.headers.get('mcp-session-id');
      if (returnedSessionId && /^[A-Za-z0-9._-]{1,128}$/.test(returnedSessionId)) {
        sessionId = returnedSessionId;
      }

      if (response.status === 202 || response.status === 204) {
        return;
      }

      const rawText = await response.text();
      if (!response.ok) {
        if (isJsonRpcRequestWithId(message) && !closed) {
          const safeDetail = redactSecretsAndPiiForMcp(rawText.slice(0, 300), [trimmedToken]);
          await transport.send({
            jsonrpc: '2.0',
            id: message.id,
            error: {
              code: response.status === 401 ? -32001 : response.status === 403 ? -32003 : -32000,
              message: `Odmowa transportu MCP HTTP (${response.status}): ${safeDetail}`,
            },
          });
        }
        return;
      }

      if (rawText.trim().length === 0) {
        return;
      }

      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        const sseMessages = parseSseJsonRpcMessages(rawText);
        for (const item of sseMessages) {
          if (!closed) {
            await transport.send(item);
          }
        }
        return;
      }

      const parsed: unknown = JSON.parse(rawText);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!closed) {
            await transport.send(item as JSONRPCMessage);
          }
        }
      } else if (parsed && typeof parsed === 'object' && !closed) {
        await transport.send(parsed as JSONRPCMessage);
      }
    } catch (err) {
      if (isJsonRpcRequestWithId(message) && !closed) {
        const rawErrMsg = err instanceof Error ? err.message : 'Błąd połączenia z serwerem MCP';
        const safeErrMsg = redactSecretsAndPiiForMcp(rawErrMsg, [trimmedToken]);
        await transport.send({
          jsonrpc: '2.0',
          id: message.id,
          error: {
            code: -32603,
            message: `Błąd mostu STDIO MCP: ${safeErrMsg}`,
          },
        });
      }
    }
  };

  transport.onmessage = (message) => {
    void forwardMessage(message);
  };

  transport.onclose = () => {
    closed = true;
  };

  await transport.start();

  return {
    close: async () => {
      if (!closed) {
        closed = true;
        await transport.close();
      }
    },
  };
}
