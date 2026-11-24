import { randomUUID } from 'node:crypto';
import {
  McpToolErrorEnvelopeSchema,
  type McpScope,
  type McpToolErrorCode,
  type McpToolErrorEnvelope,
} from '@pap/contracts/mcp-tools';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  type LegalEntityId,
  type TenantId,
  type UserId,
} from '@pap/domain';
import {
  authenticateOidcActor,
  authorizeAuthenticatedCompanyAction,
  type OidcAccessTokenVerifier,
  type UserIdentityResolver,
  type VerifiedOidcIdentity,
} from '../oidc-authentication.js';
import type { SecurityAuditRecorder } from '../security-audit.js';
import type { Clock, TenantAuthorizationDataSource } from '../tenant-authorization.js';
import {
  KeyedAsyncMutex,
  McpSlidingWindowRateLimiter,
  redactSecretsAndPiiForMcp,
  resolveSafeRequestCorrelationId,
} from './security-and-redaction.js';
import type {
  CompanyTaxProfile,
  McpAuditEvent,
  McpAuditSink,
  PapMcpDataSource,
  PapMcpMutableState,
} from './types.js';

const HUMAN_APPROVAL_UI_SCOPES: ReadonlySet<string> = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
]);

const AUTONOMOUS_AGENT_SCOPES: ReadonlySet<string> = new Set([
  'pap:mcp:agent_autonomous',
  'pap:mcp:no_human_approval',
  'pap:mcp:autonomous',
  'pap:agent',
]);

/**
 * Hard anti-self-approval helper:
 * 1. Always rejects tokens carrying autonomous agent scopes (`pap:mcp:agent_autonomous`,
 *    `pap:mcp:no_human_approval`, `pap:mcp:autonomous`, `pap:agent`).
 * 2. Whenever `scopes` are present (`scopes.length > 0`, whether `'openid'` is included or
 *    omitted as in RFC 9068 OAuth2 resource tokens), requires at least one human UI scope
 *    (`pap:ui:full`, `pap:ui:accounting`, or `pap:accounting`) so an MCP-only delegated token
 *    (`['pap:mcp:read', 'pap:mcp:prepare']`) can NEVER mint its own human confirmation challenge!
 */
export function isSelfApprovalForbiddenForChallengeIssuer(identity: VerifiedOidcIdentity): boolean {
  const scopes = identity.scopes ?? [];
  if (scopes.some((s) => AUTONOMOUS_AGENT_SCOPES.has(s))) {
    return true;
  }
  if (scopes.length > 0) {
    const hasHumanUiScope = scopes.some((s) => HUMAN_APPROVAL_UI_SCOPES.has(s));
    if (!hasHumanUiScope) {
      return true;
    }
  }
  return false;
}

export function isAutonomousAgentToken(identity: VerifiedOidcIdentity): boolean {
  const scopes = identity.scopes ?? [];
  return scopes.some((s) => AUTONOMOUS_AGENT_SCOPES.has(s));
}

export interface McpGateEnvironment {
  readonly verifier: OidcAccessTokenVerifier;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly dataSource: PapMcpDataSource;
  readonly securityAudit: SecurityAuditRecorder;
  readonly auditSink: McpAuditSink;
  readonly clock: Clock;
  readonly proposalTtlMs: number;
  readonly humanConfirmationTtlMs: number;
  readonly mutex: KeyedAsyncMutex;
  readonly rateLimiter: McpSlidingWindowRateLimiter;
  readonly state: PapMcpMutableState;
}

export interface AuthorizedCompanyToolActor {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly identity: VerifiedOidcIdentity;
  readonly reason: string;
}

export async function recordMcpAuditFailClosed(
  env: McpGateEnvironment,
  params: Omit<McpAuditEvent, 'auditEventId' | 'occurredAt' | 'source'>,
): Promise<string | null> {
  const auditEventId = randomUUID();
  const { correlationId } = resolveSafeRequestCorrelationId(params.correlationId);
  const occurredAt = env.clock.now().toISOString();
  const safeEvent: McpAuditEvent = {
    auditEventId,
    occurredAt,
    source: 'mcp',
    ...params,
    correlationId,
    reasonCode: redactSecretsAndPiiForMcp(params.reasonCode) ?? 'redacted',
    actorSubject: redactSecretsAndPiiForMcp(params.actorSubject),
  };
  try {
    await env.auditSink.record(safeEvent);
    env.state.recordedAuditHistory.push(Object.freeze(safeEvent));
    if (env.state.recordedAuditHistory.length > 1_000) {
      env.state.recordedAuditHistory.shift();
    }
    return auditEventId;
  } catch {
    return null;
  }
}

export function buildAuditUnavailableError(): {
  readonly ok: false;
  readonly error: McpToolErrorEnvelope;
} {
  return {
    ok: false,
    error: McpToolErrorEnvelopeSchema.parse({
      ok: false,
      errorCode: 'audit_unavailable',
      messagePl:
        'Operacja została zablokowana (fail-closed), ponieważ zapis wymaganego zdarzenia audytu nie powiódł się.',
      auditEventId: null,
      retryable: true,
    }),
  };
}

export async function denyMcpToolCall(
  env: McpGateEnvironment,
  params: {
    readonly toolName: string;
    readonly correlationId: string;
    readonly actorUserId?: string | null | undefined;
    readonly actorIssuer?: string | null | undefined;
    readonly actorSubject?: string | null | undefined;
    readonly tenantId?: string | null | undefined;
    readonly legalEntityId?: string | null | undefined;
    readonly idempotencyKey?: string | null | undefined;
    readonly proposalId?: string | null | undefined;
    readonly errorCode: McpToolErrorCode;
    readonly reasonCode: string;
    readonly messagePl: string;
    readonly retryable?: boolean | undefined;
  },
): Promise<{ readonly ok: false; readonly error: McpToolErrorEnvelope }> {
  const safeMessage =
    redactSecretsAndPiiForMcp(params.messagePl) ?? 'Odmowa wykonania narzędzia MCP.';
  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: params.toolName,
    correlationId: params.correlationId,
    actorUserId: params.actorUserId ?? null,
    actorIssuer: params.actorIssuer ?? null,
    actorSubject: params.actorSubject ?? null,
    tenantId: params.tenantId ?? null,
    legalEntityId: params.legalEntityId ?? null,
    outcome: 'deny',
    reasonCode: params.reasonCode,
    idempotencyKey: params.idempotencyKey ?? null,
    proposalId: params.proposalId ?? null,
    payloadHash: null,
    promptInjectionSuspected: false,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: false,
    error: McpToolErrorEnvelopeSchema.parse({
      ok: false,
      errorCode: params.errorCode,
      messagePl: safeMessage,
      auditEventId,
      retryable: params.retryable ?? params.errorCode === 'rate_limit_exceeded',
    }),
  };
}

export async function denyCompanyAuthFailure(
  env: McpGateEnvironment,
  toolName: string,
  correlationId: string,
  selectors: { readonly tenantId: string; readonly legalEntityId: string },
  failure: Extract<
    Awaited<ReturnType<typeof authorizeAuthenticatedCompanyAction>>,
    { readonly allowed: false }
  >,
  idempotencyKey: string | null = null,
): Promise<{ readonly ok: false; readonly error: McpToolErrorEnvelope }> {
  if (failure.reason === 'authorization_audit_unavailable') {
    return buildAuditUnavailableError();
  }

  const errorCode: McpToolErrorCode =
    failure.reason === 'insufficient_scope'
      ? 'insufficient_scope'
      : failure.status === 'unauthenticated'
        ? 'unauthenticated'
        : failure.status === 'invalid_selector'
          ? 'invalid_selector'
          : 'forbidden';

  const messageByCode: Readonly<Record<string, string>> = {
    unauthenticated: 'Wymagany ważny token dostępu OIDC Bearer.',
    insufficient_scope: 'Token nie posiada wymaganego zakresu uprawnień MCP dla tej operacji.',
    invalid_selector: 'Nieprawidłowy format identyfikatora tenantId lub legalEntityId.',
    forbidden:
      'Odmowa dostępu do wybranej firmy lub operacji (brak aktywnego grantu lub odwołane uprawnienia).',
  };

  let safeTenant: string | null;
  let safeEntity: string | null;
  try {
    safeTenant = parseTenantId(selectors.tenantId);
    safeEntity = parseLegalEntityId(selectors.legalEntityId);
  } catch {
    safeTenant = null;
    safeEntity = null;
  }

  return denyMcpToolCall(env, {
    toolName,
    correlationId,
    tenantId: safeTenant,
    legalEntityId: safeEntity,
    idempotencyKey,
    errorCode,
    reasonCode: failure.reason,
    messagePl: messageByCode[errorCode] ?? 'Odmowa dostępu.',
  });
}

export async function authenticateGlobalMcpToolActor(
  env: McpGateEnvironment,
  params: {
    readonly toolName: string;
    readonly correlationId: string;
    readonly rawBearerToken: string | null | undefined;
    readonly requiredScopes: readonly McpScope[];
  },
): Promise<
  | {
      readonly ok: true;
      readonly userId: UserId;
      readonly identity: VerifiedOidcIdentity;
    }
  | { readonly ok: false; readonly error: McpToolErrorEnvelope }
> {
  const actor = await authenticateOidcActor(
    params.rawBearerToken,
    { verifier: env.verifier, identityResolver: env.identityResolver },
    { requiredScopes: params.requiredScopes },
  );

  if (!actor.authenticated) {
    const code: McpToolErrorCode =
      actor.reason === 'insufficient_scope'
        ? 'insufficient_scope'
        : actor.status === 'unauthenticated'
          ? 'unauthenticated'
          : 'forbidden';
    return denyMcpToolCall(env, {
      toolName: params.toolName,
      correlationId: params.correlationId,
      errorCode: code,
      reasonCode: actor.reason,
      messagePl: `Brak wymaganego uwierzytelnienia lub zakresu ${params.requiredScopes.join(', ')}.`,
    });
  }

  const nowMs = env.clock.now().getTime();
  const rateKey = `${actor.userId}:global:${params.toolName}`;
  if (!env.rateLimiter.tryAcquire(rateKey, nowMs)) {
    return denyMcpToolCall(env, {
      toolName: params.toolName,
      correlationId: params.correlationId,
      actorUserId: actor.userId,
      actorIssuer: actor.identity.issuer,
      actorSubject: actor.identity.subject,
      errorCode: 'rate_limit_exceeded',
      reasonCode: 'actor_tool_rate_limit_exceeded',
      messagePl: 'Przekroczono limit wywołań narzędzia MCP w bieżącym oknie czasowym.',
      retryable: true,
    });
  }

  return {
    ok: true,
    userId: actor.userId,
    identity: actor.identity,
  };
}

export async function authorizeCompanyScopedMcpTool(
  env: McpGateEnvironment,
  params: {
    readonly toolName: string;
    readonly correlationId: string;
    readonly rawBearerToken: string | null | undefined;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly action: 'read' | 'write';
    readonly requiredScopes: readonly McpScope[];
    readonly idempotencyKey?: string | null | undefined;
  },
): Promise<
  | { readonly ok: true; readonly actor: AuthorizedCompanyToolActor }
  | { readonly ok: false; readonly error: McpToolErrorEnvelope }
> {
  const auth = await authorizeAuthenticatedCompanyAction(
    {
      requestId: params.correlationId,
      rawBearerToken: params.rawBearerToken,
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      action: params.action,
      requiredScopes: params.requiredScopes,
    },
    {
      verifier: env.verifier,
      identityResolver: env.identityResolver,
      securityAudit: env.securityAudit,
      authorizationDataSource: env.authorizationDataSource,
      clock: env.clock,
    },
  );

  if (!auth.allowed) {
    return denyCompanyAuthFailure(
      env,
      params.toolName,
      params.correlationId,
      { tenantId: params.tenantId, legalEntityId: params.legalEntityId },
      auth,
      params.idempotencyKey ?? null,
    );
  }

  const nowMs = env.clock.now().getTime();
  const rateKey = `${auth.context.userId}:${auth.context.tenantId}:${params.toolName}`;
  if (!env.rateLimiter.tryAcquire(rateKey, nowMs)) {
    return denyMcpToolCall(env, {
      toolName: params.toolName,
      correlationId: params.correlationId,
      actorUserId: auth.context.userId,
      actorIssuer: auth.context.identity.issuer,
      actorSubject: auth.context.identity.subject,
      tenantId: auth.context.tenantId,
      legalEntityId: auth.context.legalEntityId,
      idempotencyKey: params.idempotencyKey ?? null,
      errorCode: 'rate_limit_exceeded',
      reasonCode: 'actor_tenant_tool_rate_limit_exceeded',
      messagePl: 'Przekroczono limit wywołań narzędzia MCP dla wybranej firmy i aktora.',
      retryable: true,
    });
  }

  return {
    ok: true,
    actor: {
      userId: auth.context.userId,
      tenantId: auth.context.tenantId,
      legalEntityId: auth.context.legalEntityId,
      identity: auth.context.identity,
      reason: auth.reason,
    },
  };
}

export async function resolveAuthorizedCompanyTaxProfile(
  env: McpGateEnvironment,
  userIdVal: UserId,
  tenantIdVal: TenantId,
  legalEntityIdVal: LegalEntityId,
): Promise<CompanyTaxProfile | null> {
  if (env.dataSource.getCompanyTaxProfile) {
    const direct = await env.dataSource.getCompanyTaxProfile(tenantIdVal, legalEntityIdVal);
    if (direct) {
      return direct;
    }
  }
  const candidates = await env.dataSource.listCandidateCompaniesForUser(userIdVal);
  const match = candidates.find(
    (c) => c.tenantId === tenantIdVal && c.legalEntityId === legalEntityIdVal,
  );
  if (!match) {
    return null;
  }
  return {
    legalForm: match.legalForm,
    taxRegime: match.taxRegime,
    vatStatus: match.vatStatus,
  };
}
