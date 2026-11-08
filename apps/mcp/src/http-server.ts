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
import { resolveSafeRequestCorrelationId, type PapMcpGateway } from '@pap/application/mcp-gateway';
import { createPapMcpServer } from './server.js';

const FORBIDDEN_QUERY_TOKEN_PARAMS = ['access_token', 'token', 'bearer', 'id_token'] as const;

const ALLOWED_MCP_HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'POST', 'DELETE']);

const FORBIDDEN_SPOOFING_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-pap-role',
  'x-pap-user',
  'x-pap-tenant',
  'x-pap-actor',
  'x-pap-scopes',
  'x-approved',
  'x-forwarded-user',
  'x-forwarded-host',
  'x-forwarded-server',
  'x-original-url',
  'x-rewrite-url',
  'x-remote-user',
  'x-auth-request-user',
  'x-auth-request-email',
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

interface InternalPapMcpHttpEndpoint extends PapMcpHttpEndpoint {
  readonly preAuthenticate: (params: {
    readonly rawUrl: string;
    readonly method: string;
    readonly headers: Headers;
    readonly explicitHostHeader: string | null;
  }) => Promise<
    | { readonly ok: false; readonly response: Response }
    | {
        readonly ok: true;
        readonly correlationId: string;
        readonly canonicalUrl: string;
        readonly method: string;
        readonly sanitizedHeaders: Headers;
        readonly authInfo: AuthInfo;
      }
  >;
  readonly dispatchAuthenticated: (request: Request, authInfo: AuthInfo) => Promise<Response>;
  readonly recordRejectionResponse: (params: {
    readonly status: number;
    readonly body: Record<string, unknown>;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly extraHeaders?: Readonly<Record<string, string>> | undefined;
  }) => Promise<Response>;
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

function auditUnavailableHttpResponse(): Response {
  return jsonErrorResponse(
    503,
    {
      error: 'audit_unavailable',
      error_description: 'Audit subsystem unavailable; request rejected (fail-closed).',
    },
    { Connection: 'close' },
  );
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

function createInternalPapMcpHttpEndpoint(
  options: PapMcpHttpHandlerOptions,
): InternalPapMcpHttpEndpoint {
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

  const recordRejectionResponse: InternalPapMcpHttpEndpoint['recordRejectionResponse'] = async (
    params,
  ) => {
    const auditEventId = await options.gateway.recordTransportRejectionAudit({
      correlationId: params.correlationId,
      reasonCode: params.reasonCode,
    });
    if (!auditEventId) {
      return auditUnavailableHttpResponse();
    }
    return jsonErrorResponse(params.status, params.body, params.extraHeaders);
  };

  const preAuthenticate: InternalPapMcpHttpEndpoint['preAuthenticate'] = async (params) => {
    const rawReqId = params.headers.get('x-request-id');
    const reqIdCheck = resolveSafeRequestCorrelationId(rawReqId);
    const correlationId = reqIdCheck.correlationId;

    if (reqIdCheck.invalidHeaderRejected) {
      const invalidReqIdAudit = await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: 'invalid_x_request_id_sanitized',
      });
      if (!invalidReqIdAudit) {
        return { ok: false, response: auditUnavailableHttpResponse() };
      }
    }

    // 1. Strict Host header check (NEVER substitute an allowed default host when missing!)
    const rawHost = params.explicitHostHeader;
    if (!rawHost || rawHost.trim().length === 0 || rawHost.includes(',')) {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 400,
          body: {
            error: 'missing_host',
            error_description: 'Missing or invalid HTTP Host header.',
          },
          reasonCode: 'missing_host_header',
          correlationId,
        }),
      };
    }

    const trimmedHost = rawHost.trim();
    const hostCheck = validateHostHeader(trimmedHost, allowedHosts);
    if (!hostCheck.ok) {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 403,
          body: {
            error: 'forbidden_host',
            error_description: 'Host header is not on the allowlist.',
          },
          reasonCode: hostCheck.errorCode,
          correlationId,
        }),
      };
    }

    // 2. Parse URL safely against the validated Host header without ever throwing 500
    //    and enforce RFC 9112 authority consistency on absolute-form request targets (#69)
    let parsedUrl: URL;
    const isAbsoluteFormUrl =
      params.rawUrl.startsWith('http://') || params.rawUrl.startsWith('https://');
    try {
      parsedUrl = isAbsoluteFormUrl
        ? new URL(params.rawUrl)
        : new URL(params.rawUrl, `http://${trimmedHost}`);
    } catch {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 400,
          body: {
            error: 'invalid_request',
            error_description: 'Malformed request URL.',
          },
          reasonCode: 'malformed_request_url',
          correlationId,
        }),
      };
    }

    if (parsedUrl.username !== '' || parsedUrl.password !== '') {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 400,
          body: {
            error: 'invalid_request',
            error_description: 'Credentials in request URL authority are forbidden.',
          },
          reasonCode: 'url_userinfo_rejected',
          correlationId,
        }),
      };
    }

    if (isAbsoluteFormUrl) {
      const urlHostCheck = validateHostHeader(parsedUrl.host, allowedHosts);
      if (!urlHostCheck.ok || parsedUrl.host.toLowerCase() !== trimmedHost.toLowerCase()) {
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 403,
            body: {
              error: 'forbidden_host',
              error_description:
                'Request URL authority does not match the validated Host header allowlist.',
            },
            reasonCode: !urlHostCheck.ok ? urlHostCheck.errorCode : 'url_authority_host_mismatch',
            correlationId,
          }),
        };
      }
      parsedUrl = new URL(`${parsedUrl.pathname}${parsedUrl.search}`, `http://${trimmedHost}`);
    }

    const sanitizedHeaders = new Headers(params.headers);
    sanitizedHeaders.set('host', trimmedHost);
    sanitizedHeaders.set('x-request-id', correlationId);

    // 3. Validate browser Origin header before reading body
    const headerOnlyProbeRequest = new Request(parsedUrl.toString(), {
      method: 'GET',
      headers: sanitizedHeaders,
    });
    const originRejected = originValidationResponse(headerOnlyProbeRequest, allowedOrigins);
    if (originRejected) {
      const auditId = await options.gateway.recordTransportRejectionAudit({
        correlationId,
        reasonCode: 'untrusted_origin_header',
      });
      if (!auditId) {
        return { ok: false, response: auditUnavailableHttpResponse() };
      }
      return { ok: false, response: originRejected };
    }

    // 4. Validate endpoint path and HTTP method before reading body
    if (!allowedPaths.has(parsedUrl.pathname)) {
      return {
        ok: false,
        response: jsonErrorResponse(404, {
          error: 'not_found',
          error_description: 'Unknown MCP endpoint path.',
        }),
      };
    }

    const normalizedMethod = params.method.toUpperCase();
    if (!ALLOWED_MCP_HTTP_METHODS.has(normalizedMethod)) {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 405,
          body: {
            error: 'method_not_allowed',
            error_description: 'Only GET, POST, and DELETE methods are supported on MCP endpoints.',
          },
          reasonCode: `unsupported_http_method_${normalizedMethod.slice(0, 16)}`,
          correlationId,
          extraHeaders: { Allow: 'GET, POST, DELETE' },
        }),
      };
    }

    // 5. Security gate: forbid ?access_token= or any token query parameter (RFC 9700)
    for (const forbiddenQueryParam of FORBIDDEN_QUERY_TOKEN_PARAMS) {
      if (parsedUrl.searchParams.has(forbiddenQueryParam)) {
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 401,
            body: {
              error: 'invalid_request',
              error_description:
                'Passing access tokens in URL query parameters is forbidden. Use Authorization: Bearer header.',
            },
            reasonCode: 'query_string_access_token_rejected',
            correlationId,
            extraHeaders: {
              'WWW-Authenticate':
                'Bearer realm="pap-mcp", error="invalid_request", error_description="Query parameter tokens are forbidden"',
            },
          }),
        };
      }
    }

    // 6. Security gate: forbid client identity/role/routing spoofing headers (#69)
    for (const spoofHeader of FORBIDDEN_SPOOFING_HEADERS) {
      if (params.headers.has(spoofHeader)) {
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 401,
            body: {
              error: 'invalid_token',
              error_description: `Forbidden identity-spoofing header detected (${spoofHeader}).`,
            },
            reasonCode: `spoofed_header_rejected_${spoofHeader}`,
            correlationId,
            extraHeaders: {
              'WWW-Authenticate': 'Bearer realm="pap-mcp", error="invalid_token"',
            },
          }),
        };
      }
    }
    for (const [headerName] of params.headers.entries()) {
      const lowerHeader = headerName.toLowerCase();
      if (lowerHeader.startsWith('x-pap-')) {
        const safeSuffix = lowerHeader.replace(/[^a-z0-9_-]/g, '').slice(0, 32);
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 401,
            body: {
              error: 'invalid_token',
              error_description: `Forbidden internal header prefix detected (${lowerHeader}).`,
            },
            reasonCode: `spoofed_header_rejected_${safeSuffix}`,
            correlationId,
            extraHeaders: {
              'WWW-Authenticate': 'Bearer realm="pap-mcp", error="invalid_token"',
            },
          }),
        };
      }
    }

    // 7. Strict Authorization: Bearer header extraction & OIDC token verification BEFORE reading body
    const rawBearerToken = extractStrictBearerToken(params.headers.get('authorization'));
    if (!rawBearerToken) {
      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 401,
          body: {
            error: 'unauthorized',
            error_description: 'Missing or malformed Authorization: Bearer <token> header.',
          },
          reasonCode: 'missing_or_malformed_authorization_header',
          correlationId,
          extraHeaders: {
            'WWW-Authenticate': 'Bearer realm="pap-mcp"',
          },
        }),
      };
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
      if (actorResult.reason === 'insufficient_scope') {
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 403,
            body: {
              error: 'insufficient_scope',
              error_description: 'Token is missing required scope pap:mcp:read.',
            },
            reasonCode: actorResult.reason,
            correlationId,
            extraHeaders: {
              'WWW-Authenticate':
                'Bearer realm="pap-mcp", error="insufficient_scope", scope="pap:mcp:read"',
            },
          }),
        };
      }

      if (actorResult.status === 'forbidden') {
        return {
          ok: false,
          response: await recordRejectionResponse({
            status: 403,
            body: {
              error: 'forbidden',
              error_description: 'Authenticated identity is not provisioned or is disabled.',
            },
            reasonCode: actorResult.reason,
            correlationId,
          }),
        };
      }

      return {
        ok: false,
        response: await recordRejectionResponse({
          status: 401,
          body: {
            error: 'invalid_token',
            error_description: 'Access token verification failed.',
          },
          reasonCode: actorResult.reason,
          correlationId,
          extraHeaders: {
            'WWW-Authenticate': 'Bearer realm="pap-mcp", error="invalid_token"',
          },
        }),
      };
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

    return {
      ok: true,
      correlationId,
      canonicalUrl: parsedUrl.toString(),
      method: normalizedMethod,
      sanitizedHeaders,
      authInfo,
    };
  };

  const dispatchAuthenticated: InternalPapMcpHttpEndpoint['dispatchAuthenticated'] = (
    request,
    authInfo,
  ) => mcpHandler.fetch(request, { authInfo });

  const handleRequest = async (request: Request): Promise<Response> => {
    const preAuth = await preAuthenticate({
      rawUrl: request.url,
      method: request.method,
      headers: request.headers,
      explicitHostHeader: request.headers.get('host'),
    });

    if (!preAuth.ok) {
      return preAuth.response;
    }

    let bodyBytes: Uint8Array<ArrayBuffer> | undefined;
    if (preAuth.method !== 'GET' && preAuth.method !== 'HEAD') {
      const arrayBuf = await request.arrayBuffer();
      if (arrayBuf.byteLength > maxRequestBodyBytes) {
        return recordRejectionResponse({
          status: 413,
          body: {
            error: 'payload_too_large',
            error_description: 'Request body exceeds maximum allowed size.',
          },
          reasonCode: 'request_body_too_large',
          correlationId: preAuth.correlationId,
          extraHeaders: { Connection: 'close' },
        });
      }
      bodyBytes = new Uint8Array(arrayBuf);
    }

    const forwardedRequest = new Request(preAuth.canonicalUrl, {
      method: preAuth.method,
      headers: preAuth.sanitizedHeaders,
      ...(bodyBytes !== undefined ? { body: bodyBytes } : {}),
    });

    return dispatchAuthenticated(forwardedRequest, preAuth.authInfo);
  };

  return {
    handleRequest,
    preAuthenticate,
    dispatchAuthenticated,
    recordRejectionResponse,
    close: () => mcpHandler.close(),
  };
}

export function createPapMcpHttpEndpoint(options: PapMcpHttpHandlerOptions): PapMcpHttpEndpoint {
  const internal = createInternalPapMcpHttpEndpoint(options);
  return {
    handleRequest: internal.handleRequest,
    close: internal.close,
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
): Promise<
  | { readonly tooLarge: true }
  | { readonly tooLarge: false; readonly bytes: Uint8Array<ArrayBuffer> }
> {
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

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, bytes: out };
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

  const nodeReadable = Readable.fromWeb(
    webRes.body as unknown as import('node:stream/web').ReadableStream,
  );
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
  const endpoint = createInternalPapMcpHttpEndpoint({
    ...options,
    maxRequestBodyBytes: maxBodyBytes,
  });

  const server = createNodeHttpServer(async (req, res) => {
    try {
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

      const hostHeaderValues: string[] = [];
      for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
        if (req.rawHeaders[i]?.toLowerCase() === 'host') {
          hostHeaderValues.push(req.rawHeaders[i + 1] ?? '');
        }
      }
      const rawHostHeader =
        hostHeaderValues.length > 0
          ? hostHeaderValues.join(', ')
          : typeof req.headers.host === 'string'
            ? req.headers.host
            : null;

      // Security & DoS gate: validate Host, Origin, path, method, query params, spoofing headers,
      // and OIDC Authorization: Bearer token BEFORE reading/buffering `req` body stream!
      const preAuth = await endpoint.preAuthenticate({
        rawUrl: req.url ?? '/',
        method: req.method ?? 'GET',
        headers,
        explicitHostHeader: rawHostHeader,
      });

      if (!preAuth.ok) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => {
          if (!req.complete && !req.destroyed) {
            req.destroy();
          }
        });
        await writeWebResponseToNodeResponse(preAuth.response, res);
        return;
      }

      let body: Uint8Array<ArrayBuffer> | undefined;
      if (preAuth.method !== 'GET' && preAuth.method !== 'HEAD') {
        const readResult = await readNodeRequestBodyWithCap(req, maxBodyBytes);
        if (readResult.tooLarge) {
          const tooLargeResponse = await endpoint.recordRejectionResponse({
            status: 413,
            body: {
              error: 'payload_too_large',
              error_description: 'Request body exceeds maximum allowed size.',
            },
            reasonCode: 'request_body_too_large',
            correlationId: preAuth.correlationId,
            extraHeaders: { Connection: 'close' },
          });
          res.once('finish', () => {
            if (!req.destroyed) {
              req.destroy();
            }
          });
          await writeWebResponseToNodeResponse(tooLargeResponse, res);
          return;
        }
        body = readResult.bytes;
      }

      const webRequest = new Request(preAuth.canonicalUrl, {
        method: preAuth.method,
        headers: preAuth.sanitizedHeaders,
        ...(body !== undefined ? { body } : {}),
      });

      const webResponse = await endpoint.dispatchAuthenticated(webRequest, preAuth.authInfo);
      await writeWebResponseToNodeResponse(webResponse, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Connection', 'close');
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_server_error' }));
      } else {
        res.end();
      }
      if (!req.destroyed) {
        req.destroy();
      }
    }
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;

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
