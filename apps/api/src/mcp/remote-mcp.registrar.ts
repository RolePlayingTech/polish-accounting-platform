import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Readable } from 'node:stream';
import {
  authenticateOidcActor,
  type OidcAccessTokenVerifier,
  type UserIdentityResolver,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import { createPapMcpHttpEndpoint, type PapMcpHttpEndpoint } from '@pap/mcp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  USER_IDENTITY_RESOLVER,
} from '../auth/company-access.guard.js';
import { API_RUNTIME_ENV, PAP_MCP_GATEWAY } from '../runtime/workspace-runtime.js';

const MAX_MCP_BODY_BYTES = 1024 * 1024;
const DEFAULT_LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;
const ALLOWED_PRECHECK_METHODS = new Set(['GET', 'POST', 'DELETE']);
const FORBIDDEN_SPOOF_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-pap-role',
  'x-approved',
  'x-forwarded-user',
] as const;
const FORBIDDEN_QUERY_PARAMS = ['access_token', 'token', 'bearer', 'id_token'] as const;

export function normalizeMcpHostnameEntry(rawEntry: string): string | null {
  const trimmed = rawEntry.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('[')) {
    const closeIdx = trimmed.indexOf(']');
    return closeIdx > 0 ? trimmed.slice(0, closeIdx + 1).toLowerCase() : null;
  }
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveMcpAllowedHostnames(rawEnvValue: string | undefined): readonly string[] {
  const allowed = new Set<string>(DEFAULT_LOOPBACK_HOSTS);
  if (!rawEnvValue) {
    return [...allowed];
  }
  for (const part of rawEnvValue.split(',')) {
    const normalized = normalizeMcpHostnameEntry(part);
    if (normalized) {
      allowed.add(normalized);
    }
  }
  return [...allowed];
}

function extractRawHostHeader(req: FastifyRequest): string | null {
  const rawHeaders = req.raw.rawHeaders;
  if (Array.isArray(rawHeaders) && rawHeaders.length > 0) {
    const hostValues: string[] = [];
    for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
      if (rawHeaders[i]?.toLowerCase() === 'host') {
        hostValues.push(rawHeaders[i + 1] ?? '');
      }
    }
    if (hostValues.length > 0) {
      return hostValues.join(', ');
    }
  }
  return typeof req.headers.host === 'string' ? req.headers.host : null;
}

function buildWebHeaders(req: FastifyRequest, explicitHost: string | null): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.toLowerCase() === 'host') {
      continue;
    }
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '));
    } else {
      headers.set(key, value);
    }
  }
  if (explicitHost !== null) {
    headers.set('host', explicitHost);
  }
  return headers;
}

function isReadableStream(value: unknown): value is AsyncIterable<Buffer | Uint8Array | string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

async function readMcpBodyWithCap(
  body: unknown,
  contentLengthHeader: string | string[] | undefined,
  maxBytes: number,
): Promise<
  | { readonly tooLarge: true }
  | { readonly tooLarge: false; readonly bytes: Uint8Array<ArrayBuffer> | undefined }
> {
  if (typeof contentLengthHeader === 'string') {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { tooLarge: true };
    }
  }
  if (body === undefined || body === null) {
    return { tooLarge: false, bytes: undefined };
  }
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    if (body.byteLength > maxBytes) {
      return { tooLarge: true };
    }
    if (body.byteLength === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return { tooLarge: false, bytes: copy };
  }
  if (typeof body === 'string') {
    const buf = Buffer.from(body, 'utf8');
    if (buf.byteLength > maxBytes) {
      return { tooLarge: true };
    }
    if (buf.byteLength === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return { tooLarge: false, bytes: copy };
  }
  if (isReadableStream(body)) {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : Buffer.from(chunk);
      total += buf.byteLength;
      if (total > maxBytes) {
        return { tooLarge: true };
      }
      chunks.push(buf);
    }
    if (total === 0) {
      return { tooLarge: false, bytes: undefined };
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { tooLarge: false, bytes: out };
  }
  const serialized = Buffer.from(JSON.stringify(body), 'utf8');
  if (serialized.byteLength > maxBytes) {
    return { tooLarge: true };
  }
  const copy = new Uint8Array(serialized.byteLength);
  copy.set(serialized);
  return { tooLarge: false, bytes: copy };
}

async function sendWebResponseToFastify(webRes: Response, reply: FastifyReply): Promise<void> {
  reply.hijack();
  const nodeRes = reply.raw;
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

@Injectable()
export class RemoteMcpFastifyRegistrar implements OnModuleInit, OnModuleDestroy {
  private endpoint: PapMcpHttpEndpoint | null = null;
  private readonly env: Readonly<Record<string, string | undefined>>;

  constructor(
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
    @Inject(PAP_MCP_GATEWAY)
    private readonly gateway: PapMcpGateway,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
    @Optional()
    @Inject(API_RUNTIME_ENV)
    env?: Readonly<Record<string, string | undefined>>,
  ) {
    this.env = env ?? process.env;
  }

  private async passesPreBodySecurityGate(
    method: string,
    fullUrl: string,
    headers: Headers,
    explicitHost: string | null,
    allowedHostSet: ReadonlySet<string>,
    allowedOriginSet: ReadonlySet<string>,
  ): Promise<boolean> {
    if (!explicitHost || explicitHost.trim().length === 0 || explicitHost.includes(',')) {
      return false;
    }
    const hostName = normalizeMcpHostnameEntry(explicitHost);
    if (!hostName || !allowedHostSet.has(hostName)) {
      return false;
    }
    const originHeader = headers.get('origin');
    if (originHeader !== null) {
      const originHost = normalizeMcpHostnameEntry(originHeader);
      if (!originHost || !allowedOriginSet.has(originHost)) {
        return false;
      }
    }
    if (!ALLOWED_PRECHECK_METHODS.has(method)) {
      return false;
    }
    for (const spoofHeader of FORBIDDEN_SPOOF_HEADERS) {
      if (headers.has(spoofHeader)) {
        return false;
      }
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return false;
    }
    for (const qKey of FORBIDDEN_QUERY_PARAMS) {
      if (parsedUrl.searchParams.has(qKey)) {
        return false;
      }
    }
    const rawAuth = headers.get('authorization');
    if (!rawAuth || rawAuth.includes(',')) {
      return false;
    }
    const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(rawAuth.trim());
    if (!match?.[1]) {
      return false;
    }
    const actor = await authenticateOidcActor(
      match[1],
      { verifier: this.verifier, identityResolver: this.identityResolver },
      { requiredScopes: ['pap:mcp:read'] },
    );
    return actor.authenticated;
  }

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      return;
    }

    const allowedHostnames = resolveMcpAllowedHostnames(this.env.PAP_MCP_ALLOWED_HOSTS);
    const allowedOriginHostnames = resolveMcpAllowedHostnames(this.env.PAP_MCP_ALLOWED_ORIGINS);
    const allowedHostSet = new Set(allowedHostnames);
    const allowedOriginSet = new Set(allowedOriginHostnames);

    this.endpoint = createPapMcpHttpEndpoint({
      gateway: this.gateway,
      verifier: this.verifier,
      identityResolver: this.identityResolver,
      allowedHostnames,
      allowedOriginHostnames,
      allowedPaths: ['/api/v1/mcp', '/mcp'],
      maxRequestBodyBytes: MAX_MCP_BODY_BYTES,
    });

    const endpoint = this.endpoint;

    await fastify.register(async (mcpScope) => {
      // Do NOT buffer body in Fastify content-type parser before pre-body auth & Host checks run.
      mcpScope.removeAllContentTypeParsers();
      mcpScope.addContentTypeParser('*', (_req, payload, done) => {
        done(null, payload);
      });

      mcpScope.all('/api/v1/mcp', async (req, reply) => {
        const explicitHost = extractRawHostHeader(req);
        const headers = buildWebHeaders(req, explicitHost);
        const safeBaseHost =
          explicitHost && explicitHost.trim().length > 0 && !explicitHost.includes(',')
            ? explicitHost.trim()
            : '127.0.0.1';
        const rawUrl = req.raw.url ?? req.url;

        let fullUrl: string;
        try {
          fullUrl = new URL(rawUrl, `http://${safeBaseHost}`).toString();
        } catch {
          fullUrl = 'http://127.0.0.1/api/v1/mcp';
        }

        const method = req.method.toUpperCase();
        const canReadBody = await this.passesPreBodySecurityGate(
          method,
          fullUrl,
          headers,
          explicitHost,
          allowedHostSet,
          allowedOriginSet,
        );

        let bodyBytes: Uint8Array<ArrayBuffer> | undefined;
        if (canReadBody && method !== 'GET' && method !== 'HEAD') {
          const readResult = await readMcpBodyWithCap(
            req.body,
            req.headers['content-length'],
            MAX_MCP_BODY_BYTES,
          );
          bodyBytes = readResult.tooLarge
            ? new Uint8Array(MAX_MCP_BODY_BYTES + 1)
            : readResult.bytes;
        }

        const webReq = new Request(fullUrl, {
          method,
          headers,
          ...(bodyBytes !== undefined ? { body: bodyBytes } : {}),
        });

        const webRes = await endpoint.handleRequest(webReq);
        await sendWebResponseToFastify(webRes, reply);
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.endpoint) {
      await this.endpoint.close();
      this.endpoint = null;
    }
  }
}
