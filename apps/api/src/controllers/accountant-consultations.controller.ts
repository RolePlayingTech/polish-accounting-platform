import type { AccountantConsultationService } from '@pap/application/mcp-gateway';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const FORBIDDEN_IDENTITY_SPOOF_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-forwarded-user',
  'x-forwarded-host',
  'x-forwarded-server',
  'x-original-url',
  'x-rewrite-url',
  'x-auth-request-user',
  'x-auth-request-email',
  'x-remote-user',
  'x-pap-user-id',
  'x-pap-actor-id',
  'x-pap-tenant-role',
  'x-pap-platform-role',
  'x-pap-role',
  'x-approved',
] as const;

const FORBIDDEN_TOKEN_QUERY_KEYS = ['access_token', 'token', 'bearer', 'id_token'] as const;

function detectSpoofedIdentityOrQueryToken(req: FastifyRequest): string | undefined {
  for (const headerName of FORBIDDEN_IDENTITY_SPOOF_HEADERS) {
    if (req.headers[headerName] !== undefined) {
      return `spoofed_header_${headerName}`;
    }
  }
  for (const rawKey of Object.keys(req.headers)) {
    const lower = rawKey.toLowerCase();
    if (lower.startsWith('x-pap-') && req.headers[rawKey] !== undefined) {
      return `spoofed_header_${lower}`;
    }
  }
  const query = req.query;
  if (typeof query === 'object' && query !== null) {
    for (const key of FORBIDDEN_TOKEN_QUERY_KEYS) {
      if (key in query) {
        return `query_token_${key}`;
      }
    }
  }
  const rawUrl = req.raw.url ?? req.url;
  try {
    const parsedUrl = new URL(rawUrl, 'http://127.0.0.1');
    for (const key of FORBIDDEN_TOKEN_QUERY_KEYS) {
      if (parsedUrl.searchParams.has(key)) {
        return `query_token_${key}`;
      }
    }
  } catch {
    return 'malformed_request_url';
  }
  return undefined;
}

function extractStrictBearerHeader(req: FastifyRequest): {
  readonly rawBearerToken: string | undefined;
  readonly transportFailureReason?: string | undefined;
} {
  const spoofReason = detectSpoofedIdentityOrQueryToken(req);
  if (spoofReason) {
    return { rawBearerToken: undefined, transportFailureReason: spoofReason };
  }
  const rawAuth = req.headers.authorization;
  if (rawAuth === undefined) {
    return { rawBearerToken: undefined };
  }
  if (typeof rawAuth !== 'string') {
    return {
      rawBearerToken: undefined,
      transportFailureReason: 'malformed_authorization_header',
    };
  }
  const trimmed = rawAuth.trim();
  if (trimmed.includes(',') || !/^Bearer\s+/i.test(trimmed)) {
    return {
      rawBearerToken: undefined,
      transportFailureReason: 'malformed_authorization_header',
    };
  }
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(trimmed);
  if (!match?.[1]) {
    return {
      rawBearerToken: undefined,
      transportFailureReason: 'malformed_authorization_header',
    };
  }
  return { rawBearerToken: match[1] };
}

function extractCorrelationId(req: FastifyRequest): string | undefined {
  const header = req.headers['x-request-id'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  return undefined;
}

function extractHeaderIdempotencyKey(req: FastifyRequest): string | undefined {
  const header = req.headers['idempotency-key'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildRestCallContext(req: FastifyRequest) {
  const bearer = extractStrictBearerHeader(req);
  return {
    rawBearerToken: bearer.rawBearerToken,
    correlationId: extractCorrelationId(req),
    enforceMcpScopes: false,
    ...(bearer.transportFailureReason
      ? { transportFailureReason: bearer.transportFailureReason }
      : {}),
  };
}

function sendConsultationReply<T>(
  reply: FastifyReply,
  outcome:
    | Awaited<ReturnType<AccountantConsultationService['listMyCases']>>
    | {
        readonly ok: true;
        readonly data: T;
      },
  successStatusCode = 200,
): FastifyReply {
  reply.header('Cache-Control', 'no-store');
  if (!outcome.ok) {
    if (outcome.statusCode === 401) {
      reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
    } else if (outcome.statusCode === 403 && outcome.error.errorCode === 'insufficient_scope') {
      reply.header('WWW-Authenticate', 'Bearer error="insufficient_scope"');
    }
    return reply.code(outcome.statusCode).send(outcome.error);
  }
  return reply.code(successStatusCode).send(outcome.data);
}

/**
 * Registers Stage A/B (#121 / ADR-013) accountant–client consultation routes on Fastify.
 * Enforces strict OIDC Bearer authentication, spoof-header & query-token rejection (`401`),
 * OIDC read/write scope verification (`403 insufficient_scope`), autonomous-agent block (`403`),
 * live `company_access_grant` authorization, immediate revoked-grant `403`, cross-tenant/sibling IDOR denial,
 * optimistic concurrency (`expectedVersion`), idempotency (`Idempotency-Key`), and zero automatic ledger mutations.
 */
export async function registerAccountantConsultationsRoutes(
  fastify: FastifyInstance,
  consultationService: AccountantConsultationService,
): Promise<void> {
  await fastify.register(async (scope) => {
    scope.get('/api/v1/consultations/cases', async (req, reply) => {
      const query = isPlainObject(req.query) ? req.query : {};
      const parsedLimit =
        typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number(query.limit)
          : undefined;
      const outcome = await consultationService.listMyCases(buildRestCallContext(req), {
        ...(typeof query.tenantId === 'string' ? { tenantId: query.tenantId } : {}),
        ...(typeof query.legalEntityId === 'string' ? { legalEntityId: query.legalEntityId } : {}),
        ...(typeof query.statusFilter === 'string' ? { statusFilter: query.statusFilter } : {}),
        ...(typeof query.roleView === 'string' ? { roleView: query.roleView } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      });
      return sendConsultationReply(reply, outcome, 200);
    });

    scope.get<{
      Params: { tenantId: string; legalEntityId: string };
    }>('/api/v1/tenants/:tenantId/companies/:legalEntityId/consultations', async (req, reply) => {
      const query = isPlainObject(req.query) ? req.query : {};
      const parsedLimit =
        typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number(query.limit)
          : undefined;
      const outcome = await consultationService.listMyCases(buildRestCallContext(req), {
        tenantId: req.params.tenantId,
        legalEntityId: req.params.legalEntityId,
        ...(typeof query.statusFilter === 'string' ? { statusFilter: query.statusFilter } : {}),
        ...(typeof query.roleView === 'string' ? { roleView: query.roleView } : {}),
        ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}),
        ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
      });
      return sendConsultationReply(reply, outcome, 200);
    });

    scope.post<{
      Params: { tenantId: string; legalEntityId: string };
    }>('/api/v1/tenants/:tenantId/companies/:legalEntityId/consultations', async (req, reply) => {
      const body = isPlainObject(req.body) ? req.body : {};
      const headerIdem = extractHeaderIdempotencyKey(req);
      const outcome = await consultationService.createConsultationDraft(buildRestCallContext(req), {
        ...body,
        tenantId: req.params.tenantId,
        legalEntityId: req.params.legalEntityId,
        ...(headerIdem && body.idempotencyKey === undefined ? { idempotencyKey: headerIdem } : {}),
      });
      const status = outcome.ok && !outcome.data.idempotentReplay ? 201 : 200;
      return sendConsultationReply(reply, outcome, status);
    });

    scope.get<{
      Params: { tenantId: string; legalEntityId: string; caseId: string };
    }>(
      '/api/v1/tenants/:tenantId/companies/:legalEntityId/consultations/:caseId',
      async (req, reply) => {
        const outcome = await consultationService.getConsultationCase(buildRestCallContext(req), {
          tenantId: req.params.tenantId,
          legalEntityId: req.params.legalEntityId,
          caseId: req.params.caseId,
        });
        return sendConsultationReply(reply, outcome, 200);
      },
    );

    scope.post<{
      Params: { tenantId: string; legalEntityId: string; caseId: string };
    }>(
      '/api/v1/tenants/:tenantId/companies/:legalEntityId/consultations/:caseId/messages',
      async (req, reply) => {
        const body = isPlainObject(req.body) ? req.body : {};
        const headerIdem = extractHeaderIdempotencyKey(req);
        const outcome = await consultationService.replyToConsultationCase(
          buildRestCallContext(req),
          {
            ...body,
            tenantId: req.params.tenantId,
            legalEntityId: req.params.legalEntityId,
            caseId: req.params.caseId,
            ...(headerIdem && body.idempotencyKey === undefined
              ? { idempotencyKey: headerIdem }
              : {}),
          },
        );
        return sendConsultationReply(reply, outcome, 200);
      },
    );
  });
}
