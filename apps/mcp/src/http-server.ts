import { randomUUID } from 'node:crypto';
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import { Readable } from 'node:stream';
import {
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
  validateHostHeader,
  type AuthInfo,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import {
  authenticateOidcActor,
  type OidcAccessTokenVerifier,
  type UserIdentityResolver,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import { createPapMcpServer } from './server.js';

const FORBIDDEN_QUERY_TOKEN_PARAMS = ['access_token', 'token', 'bearer', 'id_token'] as const;

const FORBIDDEN_SPOOFING_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-pap-role',
  'x-approved',
  'x-forwarded-user',
] as const;

export interface PapMcpHttpHandlerOptions {
  readonly gateway: PapMcpGateway;
  readonly verifier: OidcAccessTokenVerifier;
  readonly identityResolver: UserIdentityResolver;
  /** Allowed Host header hostnames (port-agnostic). Defaults to localhost/127.0.0.1/[::1]. */
  readonly allowedHostnames?: readonly string[] | undefined;
  /** Allowed browser Origin hostnames. Defaults to localhost/127.0.0.1/[::1]. */
  readonly allowedOriginHostnames?: readonly string[] | undefined;
  /** Allowed URL paths when mounted standalone. Defaults to ['/mcp', '/api/v1/mcp']. */
  readonly allowedPaths?: readonly string[] | undefined;
  /** Upper bound in bytes on incoming HTTP request body (default 1 MiB). */
  readonly maxRequestBodyBytes?: number | undefined;
}

export interface PapMcpHttpEndpoint {
  readonly handleRequest: (request: Request) => Promise<Response>;
  readonly close: () => Promise<void>;
}

function jsonErrorResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  return new Response(JSON.stringify(body), { status, headers });
}

function extractStrictBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const trimmed = authorizationHeader.trim();
  // Reject comma-joined multiple Authorization headers or whitespace inside token
  if (trimmed.includes(',')) {
    return null;
  }
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(trimmed);
  if (!match?.[1]) {
    return null;
  }
  return match[1];
}

export function createPapMcpHttpEndpoint(options: PapMcpHttpHandlerOptions): PapMcpHttpEndpoint {
  const allowedHosts = [...(options.allowedHostnames ?? localhostAllowedHostnames())];
  const allowedOrigins = [...(options.allowedOriginHostnames ?? localhostAllowedOrigins())];
  const allowedPaths = new Set(options.allowedPaths ?? ['/mcp', '/api/v1/mcp']);
  const maxRequestBodyBytes = Math.max(4096, options.maxRequestBodyBytes ?? 1024 * 1024);

  const mcpHandler: McpHttpHandler = createMcpHandler(
    (ctx) =>
      createPapMcpServer(options.gateway, {
        getFallbackBearerToken: () => ctx.authInfo?.token,
      }),
    {
      legacy: 'stateless',
      keepAliveMs: 0,
      maxRequestBodySize: maxRequestBodyBytes,
    },
  );

  const handleRequest = async (request: Request): Promise<Response> => {
    const correlationId = request.headers.get('x-request-id')?.trim() || randomUUID();

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(request.url);
    } catch {
      await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: 'malformed_request_url',
      });
      return jsonErrorResponse(400, {
        error: 'invalid_request',
        error_description: 'Malformed request URL.',
      });
    }

    const hostHeader = request.headers.get('host') ?? parsedUrl.host;
    const hostCheck = validateHostHeader(hostHeader, allowedHosts);
    if (!hostCheck.ok) {
      await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: hostCheck.errorCode,
      });
      return jsonErrorResponse(403, {
        error: 'forbidden_host',
        error_description: 'Host header is not on the allowlist.',
      });
    }

    const originRejected = originValidationResponse(request, allowedOrigins);
    if (originRejected) {
      await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: 'untrusted_origin_header',
      });
      return originRejected;
    }

    if (!allowedPaths.has(parsedUrl.pathname)) {
      return jsonErrorResponse(404, {
        error: 'not_found',
        error_description: 'Unknown MCP endpoint path.',
      });
    }

    // Security gate: forbid ?access_token= or any token query parameter (RFC 9700)
    for (const forbiddenQueryParam of FORBIDDEN_QUERY_TOKEN_PARAMS) {
      if (parsedUrl.searchParams.has(forbiddenQueryParam)) {
        await options.gateway.recordTransportRejectionAudit({
          correlationId,
          reasonCode: 'query_string_access_token_rejected',
        });
        return jsonErrorResponse(
          401,
          {
            error: 'invalid_request',
            error_description:
              'Passing access tokens in URL query parameters is forbidden. Use Authorization: Bearer header.',
          },
          {
            'WWW-Authenticate':
              'Bearer realm="pap-mcp", error="invalid_request", error_description="Query parameter tokens are forbidden"',
          },
        );
      }
    }

    // Security gate: forbid client identity/role spoofing headers
    for (const spoofHeader of FORBIDDEN_SPOOFING_HEADERS) {
      if (request.headers.has(spoofHeader)) {
        await options.gateway.recordTransportRejectionAudit({
          correlationId,
          reasonCode: `spoofed_header_rejected_${spoofHeader}`,
        });
        return jsonErrorResponse(
          401,
          {
            error: 'invalid_token',
            error_description: `Forbidden identity-spoofing header detected (${spoofHeader}).`,
          },
          {
            'WWW-Authenticate': 'Bearer realm="pap-mcp", error="invalid_token"',
          },
        );
      }
    }

    const rawBearerToken = extractStrictBearerToken(request.headers.get('authorization'));
    if (!rawBearerToken) {
      await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: 'missing_or_malformed_authorization_header',
      });
      return jsonErrorResponse(
        401,
        {
          error: 'unauthorized',
          error_description: 'Missing or malformed Authorization: Bearer <token> header.',
        },
        {
          'WWW-Authenticate': 'Bearer realm="pap-mcp"',
        },
      );
    }

    const actorResult = await authenticateOidcActor(
      rawBearerToken,
      {
        verifier: options.verifier,
        identityResolver: options.identityResolver,
      },
      { requiredScopes: ['pap:mcp:read'] },
    );

    if (!actorResult.authenticated) {
      await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: actorResult.reason,
      });

      if (actorResult.reason === 'insufficient_scope') {
        return jsonErrorResponse(
          403,
          {
            error: 'insufficient_scope',
            error_description: 'Token is missing required scope pap:mcp:read.',
          },
          {
            'WWW-Authenticate':
              'Bearer realm="pap-mcp", error="insufficient_scope", scope="pap:mcp:read"',
          },
        );
      }

      if (actorResult.status === 'forbidden') {
        return jsonErrorResponse(403, {
          error: 'forbidden',
          error_description: 'Authenticated identity is not provisioned or is disabled.',
        });
      }

      return jsonErrorResponse(
        401,
        {
          error: 'invalid_token',
          error_description: 'Access token verification failed.',
        },
        {
          'WWW-Authenticate': 'Bearer realm="pap-mcp", error="invalid_token"',
        },
      );
    }

    const expiresAtSeconds = actorResult.identity.expiresAt
      ? Math.floor(actorResult.identity.expiresAt.getTime() / 1000)
      : undefined;

    const authInfo: AuthInfo = {
      token: rawBearerToken,
      clientId: actorResult.identity.subject,
      scopes: [...(actorResult.identity.scopes ?? [])],
      ...(expiresAtSeconds !== undefined ? { expiresAt: expiresAtSeconds } : {}),
      extra: {
        userId: actorResult.userId,
        issuer: actorResult.identity.issuer,
      },
    };

    return mcpHandler.fetch(request, { authInfo });
  };

  return {
    handleRequest,
    close: () => mcpHandler.close(),
  };
}

/**
 * Stateless Web Standard Request -> Response entrypoint suitable for direct mounting
 * under `/api/v1/mcp` in `@pap/api` or serverless/edge fetch adapters.
 */
export async function handlePapMcpHttpRequest(
  request: Request,
  options: PapMcpHttpHandlerOptions,
): Promise<Response> {
  const endpoint = createPapMcpHttpEndpoint(options);
  try {
    return await endpoint.handleRequest(request);
  } finally {
    await endpoint.close();
  }
}

export interface StartPapMcpHttpServerOptions extends PapMcpHttpHandlerOptions {
  readonly host?: string | undefined;
  readonly port?: number | undefined;
}

export interface RunningPapMcpHttpServer {
  readonly server: NodeHttpServer;
  readonly host: string;
  readonly port: number;
  readonly baseUrl: string;
  readonly mcpUrl: string;
  readonly close: () => Promise<void>;
}

async function readNodeRequestBodyWithCap(
  req: IncomingMessage,
  maxBytes: number,
): Promise<{ readonly tooLarge: true } | { readonly tooLarge: false; readonly buffer: Buffer }> {
  const contentLengthHeader = req.headers['content-length'];
  if (typeof contentLengthHeader === 'string') {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { tooLarge: true };
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.length;
    if (total > maxBytes) {
      return { tooLarge: true };
    }
    chunks.push(buf);
  }

  return { tooLarge: false, buffer: Buffer.concat(chunks) };
}

async function writeWebResponseToNodeResponse(
  webRes: Response,
  nodeRes: ServerResponse,
): Promise<void> {
  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    nodeRes.setHeader(key, value);
  });

  if (!webRes.body) {
    nodeRes.end();
    return;
  }

  const nodeReadable = Readable.fromWeb(webRes.body as unknown as import('node:stream/web').ReadableStream);
  await new Promise<void>((resolve, reject) => {
    nodeReadable.on('error', reject);
    nodeRes.on('error', reject);
    nodeRes.on('close', () => resolve());
    nodeRes.on('finish', () => resolve());
    nodeReadable.pipe(nodeRes);
  });
}

export async function startPapMcpHttpServer(
  options: StartPapMcpHttpServerOptions,
): Promise<RunningPapMcpHttpServer> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 4110;
  const maxBodyBytes = Math.max(4096, options.maxRequestBodyBytes ?? 1024 * 1024);
  const endpoint = createPapMcpHttpEndpoint({
    ...options,
    maxRequestBodyBytes: maxBodyBytes,
  });

  const server = createNodeHttpServer(async (req, res) => {
    try {
      const hostHeader = req.headers.host ?? `${host}:${requestedPort}`;
      const url = new URL(req.url ?? '/', `http://${hostHeader}`);
      const headers = new Headers();

      for (const [key, rawValue] of Object.entries(req.headers)) {
        if (rawValue === undefined) {
          continue;
        }
        if (Array.isArray(rawValue)) {
          headers.set(key, rawValue.join(', '));
        } else {
          headers.set(key, rawValue);
        }
      }

      const method = (req.method ?? 'GET').toUpperCase();
      let body: Uint8Array<ArrayBuffer> | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const readResult = await readNodeRequestBodyWithCap(req, maxBodyBytes);
        if (readResult.tooLarge) {
          res.statusCode = 413;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          return;
        }
        const copy = new Uint8Array(readResult.buffer.length);
        copy.set(readResult.buffer);
        body = copy;
      }

      const webRequest = new Request(url.toString(), {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
      });

      const webResponse = await endpoint.handleRequest(webRequest);
      await writeWebResponseToNodeResponse(webResponse, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_server_error' }));
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await endpoint.close();
    throw new Error('Failed to resolve bound TCP address for PAP MCP HTTP server');
  }

  const boundPort = address.port;
  const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const baseUrl = `http://${formattedHost}:${boundPort}`;

  return {
    server,
    host,
    port: boundPort,
    baseUrl,
    mcpUrl: `${baseUrl}/mcp`,
    close: async () => {
      await endpoint.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
    },
  };
}
