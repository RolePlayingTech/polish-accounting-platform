import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Readable } from 'node:stream';
import type { OidcAccessTokenVerifier, UserIdentityResolver } from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import { createPapMcpHttpEndpoint, type PapMcpHttpEndpoint } from '@pap/mcp';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  USER_IDENTITY_RESOLVER,
} from '../auth/company-access.guard.js';
import { PAP_MCP_GATEWAY } from '../runtime/workspace-runtime.js';

const MAX_MCP_BODY_BYTES = 1024 * 1024;

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

function normalizeBodyBytes(body: unknown): Uint8Array<ArrayBuffer> | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (Buffer.isBuffer(body)) {
    if (body.byteLength === 0) {
      return undefined;
    }
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy;
  }
  if (body instanceof Uint8Array) {
    if (body.byteLength === 0) {
      return undefined;
    }
    const copy = new Uint8Array(body.byteLength);
    copy.set(body);
    return copy;
  }
  if (typeof body === 'string') {
    if (body.length === 0) {
      return undefined;
    }
    const buf = Buffer.from(body, 'utf8');
    const copy = new Uint8Array(buf.byteLength);
    copy.set(buf);
    return copy;
  }
  const serialized = Buffer.from(JSON.stringify(body), 'utf8');
  const copy = new Uint8Array(serialized.byteLength);
  copy.set(serialized);
  return copy;
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

  constructor(
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
    @Inject(PAP_MCP_GATEWAY)
    private readonly gateway: PapMcpGateway,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
  ) {}

  async onModuleInit(): Promise<void> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      return;
    }

    this.endpoint = createPapMcpHttpEndpoint({
      gateway: this.gateway,
      verifier: this.verifier,
      identityResolver: this.identityResolver,
      allowedPaths: ['/api/v1/mcp', '/mcp'],
      maxRequestBodyBytes: MAX_MCP_BODY_BYTES,
    });

    const endpoint = this.endpoint;

    await fastify.register(async (mcpScope) => {
      mcpScope.removeAllContentTypeParsers();
      mcpScope.addContentTypeParser(
        '*',
        { parseAs: 'buffer', bodyLimit: MAX_MCP_BODY_BYTES + 4_096 },
        (_req, payload, done) => {
          done(null, payload);
        },
      );

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
          fullUrl = `http://127.0.0.1/api/v1/mcp`;
        }

        const method = req.method.toUpperCase();
        const bodyBytes =
          method !== 'GET' && method !== 'HEAD' ? normalizeBodyBytes(req.body) : undefined;

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
