import { randomUUID } from 'node:crypto';
import {
  ConsultationCaseDetailSchema,
  ConsultationCaseSummarySchema,
  CreateConsultationDraftInputSchema,
  CreateConsultationDraftOutputSchema,
  GetConsultationCaseInputSchema,
  GetConsultationCaseOutputSchema,
  ListMyConsultationCasesInputSchema,
  ListMyConsultationCasesOutputSchema,
  McpToolErrorEnvelopeSchema,
  ReplyToConsultationCaseInputSchema,
  ReplyToConsultationCaseOutputSchema,
  type ConsultationAssignedAccountantStatus,
  type ConsultationAuthorRole,
  type ConsultationCaseDetail,
  type ConsultationCasePriority,
  type ConsultationCaseStatus,
  type ConsultationCaseSummary,
  type ConsultationCaseType,
  type CreateConsultationDraftOutput,
  type GetConsultationCaseOutput,
  type ListMyConsultationCasesOutput,
  type McpScope,
  type McpToolErrorCode,
  type McpToolErrorEnvelope,
  type ReplyToConsultationCaseOutput,
} from '@pap/contracts/mcp-tools';
import {
  decideAccountingAccess,
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
} from '../oidc-authentication.js';
import type {
  SecurityAuditEvent,
  SecurityAuditReason,
  SecurityAuditRecorder,
} from '../security-audit.js';
import {
  systemClock,
  type Clock,
  type TenantAuthorizationDataSource,
} from '../tenant-authorization.js';
import {
  KeyedAsyncMutex,
  constantTimeHexEquals,
  redactSecretsAndPiiForMcp,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
} from '../mcp/security-and-redaction.js';

export const SYNTHETIC_CONSULTATION_STAGE_AB_DISCLAIMER_PL =
  'Wycinek syntetyczny etapu A/B (#121): komunikacja na danych testowych; wysłanie wiadomości nigdy nie księguje operacji w księgach ani nie symuluje odpowiedzi doradcy przez AI.' as const;

export interface StoredConsultationMessageRecord {
  readonly messageId: string;
  readonly caseId: string;
  readonly authorUserId: UserId;
  readonly authorRole: ConsultationAuthorRole;
  readonly rawSanitizedBody: string;
  readonly createdAtIso: string;
}

export interface StoredConsultationCaseRecord {
  readonly caseId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly caseType: ConsultationCaseType;
  status: ConsultationCaseStatus;
  readonly priority: ConsultationCasePriority;
  readonly rawSanitizedSubject: string;
  readonly taxPeriod: string | null;
  readonly relatedDocumentId: string | null;
  readonly createdByUserId: UserId;
  assignedAccountantStatus: ConsultationAssignedAccountantStatus;
  lastMessageAuthorRole: ConsultationAuthorRole;
  version: number;
  readonly createdAtIso: string;
  updatedAtIso: string;
  readonly messages: StoredConsultationMessageRecord[];
}

export interface AccountantConsultationStorePort {
  listCasesForEntity(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): Promise<readonly StoredConsultationCaseRecord[]>;
  listDistinctEntityScopes(): Promise<
    readonly { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }[]
  >;
  getCaseById(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    caseId: string,
  ): Promise<StoredConsultationCaseRecord | null>;
  saveNewCase(record: StoredConsultationCaseRecord): Promise<void>;
  appendReplyAndUpdateCase(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly caseId: string;
    readonly expectedVersion: number;
    readonly message: StoredConsultationMessageRecord;
    readonly nextStatus: ConsultationCaseStatus;
    readonly assignedAccountantStatus: ConsultationAssignedAccountantStatus;
    readonly updatedAtIso: string;
  }): Promise<StoredConsultationCaseRecord | 'version_conflict' | 'not_found'>;
}

function cloneCaseRecord(record: StoredConsultationCaseRecord): StoredConsultationCaseRecord {
  return {
    ...record,
    messages: record.messages.map((m) => ({ ...m })),
  };
}

export class InMemoryAccountantConsultationStore implements AccountantConsultationStorePort {
  private readonly casesById = new Map<string, StoredConsultationCaseRecord>();

  async listCasesForEntity(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
  ): Promise<readonly StoredConsultationCaseRecord[]> {
    const out: StoredConsultationCaseRecord[] = [];
    for (const c of this.casesById.values()) {
      if (c.tenantId === tenantIdVal && c.legalEntityId === legalEntityIdVal) {
        out.push(cloneCaseRecord(c));
      }
    }
    out.sort((a, b) =>
      a.updatedAtIso === b.updatedAtIso
        ? a.caseId.localeCompare(b.caseId)
        : b.updatedAtIso.localeCompare(a.updatedAtIso),
    );
    return out;
  }

  async listDistinctEntityScopes(): Promise<
    readonly { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }[]
  > {
    const seen = new Set<string>();
    const scopes: { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }[] = [];
    for (const c of this.casesById.values()) {
      const key = `${c.tenantId}:${c.legalEntityId}`;
      if (!seen.has(key)) {
        seen.add(key);
        scopes.push({ tenantId: c.tenantId, legalEntityId: c.legalEntityId });
      }
    }
    return scopes;
  }

  async getCaseById(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    caseId: string,
  ): Promise<StoredConsultationCaseRecord | null> {
    const found = this.casesById.get(caseId.toLowerCase());
    if (!found || found.tenantId !== tenantIdVal || found.legalEntityId !== legalEntityIdVal) {
      return null;
    }
    return cloneCaseRecord(found);
  }

  async saveNewCase(record: StoredConsultationCaseRecord): Promise<void> {
    this.casesById.set(record.caseId.toLowerCase(), cloneCaseRecord(record));
  }

  async appendReplyAndUpdateCase(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly caseId: string;
    readonly expectedVersion: number;
    readonly message: StoredConsultationMessageRecord;
    readonly nextStatus: ConsultationCaseStatus;
    readonly assignedAccountantStatus: ConsultationAssignedAccountantStatus;
    readonly updatedAtIso: string;
  }): Promise<StoredConsultationCaseRecord | 'version_conflict' | 'not_found'> {
    const existing = this.casesById.get(params.caseId.toLowerCase());
    if (
      !existing ||
      existing.tenantId !== params.tenantId ||
      existing.legalEntityId !== params.legalEntityId
    ) {
      return 'not_found';
    }
    if (existing.version !== params.expectedVersion) {
      return 'version_conflict';
    }
    existing.messages.push({ ...params.message });
    existing.status = params.nextStatus;
    existing.lastMessageAuthorRole = params.message.authorRole;
    existing.assignedAccountantStatus = params.assignedAccountantStatus;
    existing.version += 1;
    existing.updatedAtIso = params.updatedAtIso;
    return cloneCaseRecord(existing);
  }
}

export interface ConsultationCallContext {
  readonly rawBearerToken: string | undefined | null;
  readonly correlationId?: string | undefined;
  /**
   * When invoked from MCP tools, enforces MCP scopes (`pap:mcp:read` / `pap:mcp:prepare`).
   * When invoked from authenticated REST/UI routes, enforces REST/UI scopes (`REST_CONSULTATION_*_SCOPES`).
   */
  readonly enforceMcpScopes?: boolean | undefined;
  /**
   * Set by HTTP transport layer when a spoofed identity header, query token, or malformed
   * Authorization header is detected prior to token verification.
   */
  readonly transportFailureReason?: string | undefined;
}

const CONSULTATION_AUTONOMOUS_AGENT_SCOPES: ReadonlySet<string> = new Set([
  'pap:mcp:agent_autonomous',
  'pap:mcp:no_human_approval',
  'pap:mcp:autonomous',
  'pap:agent',
]);

const REST_CONSULTATION_READ_SCOPES: ReadonlySet<string> = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
  'pap:api:read',
  'pap:api:write',
  'pap:mcp:read',
]);

const REST_CONSULTATION_WRITE_SCOPES: ReadonlySet<string> = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
  'pap:api:write',
  'pap:mcp:prepare',
]);

function hasAnyConsultationScope(
  scopes: readonly string[] | undefined,
  allowed: ReadonlySet<string>,
): boolean {
  return Boolean(scopes && scopes.some((s) => allowed.has(s)));
}

function isAutonomousConsultationAgentToken(scopes: readonly string[] | undefined): boolean {
  return Boolean(scopes && scopes.some((s) => CONSULTATION_AUTONOMOUS_AGENT_SCOPES.has(s)));
}

export type ConsultationServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly statusCode: number; readonly error: McpToolErrorEnvelope };

export interface AccountantConsultationServiceDependencies {
  readonly verifier: OidcAccessTokenVerifier;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly securityAudit: SecurityAuditRecorder;
  readonly clock?: Clock | undefined;
  readonly store?: AccountantConsultationStorePort | undefined;
  readonly listCandidateCompaniesForUser?:
    | ((
        userId: UserId,
      ) => Promise<
        readonly { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }[]
      >)
    | undefined;
  readonly checkExternalAccountantAssigned?:
    ((tenantId: TenantId, legalEntityId: LegalEntityId) => Promise<boolean>) | undefined;
}

function buildErrorResult(
  statusCode: number,
  errorCode: McpToolErrorCode,
  messagePl: string,
  auditEventId: string | null = null,
  retryable = false,
): { readonly ok: false; readonly statusCode: number; readonly error: McpToolErrorEnvelope } {
  return {
    ok: false,
    statusCode,
    error: McpToolErrorEnvelopeSchema.parse({
      ok: false,
      errorCode,
      messagePl,
      auditEventId,
      retryable,
    }),
  };
}

function serializeCaseSummary(record: StoredConsultationCaseRecord): ConsultationCaseSummary {
  const subjectEnv = sanitizeUntrustedDocumentTextForMcp(record.rawSanitizedSubject, {
    field: 'consultationCase.subject',
    maxLength: 200,
  });
  return ConsultationCaseSummarySchema.parse({
    caseId: record.caseId,
    tenantId: record.tenantId,
    legalEntityId: record.legalEntityId,
    caseType: record.caseType,
    status: record.status,
    priority: record.priority,
    subject: subjectEnv,
    taxPeriod: record.taxPeriod,
    relatedDocumentId: record.relatedDocumentId,
    createdByUserId: record.createdByUserId,
    assignedAccountantStatus: record.assignedAccountantStatus,
    lastMessageAuthorRole: record.lastMessageAuthorRole,
    messagesCount: record.messages.length,
    version: record.version,
    createdAt: record.createdAtIso,
    updatedAt: record.updatedAtIso,
    ledgerMutationPerformed: false,
    storageMode: 'synthetic_in_memory_stage_ab',
    syntheticPrototypeDisclaimerPl: SYNTHETIC_CONSULTATION_STAGE_AB_DISCLAIMER_PL,
  });
}

function serializeCaseDetail(record: StoredConsultationCaseRecord): ConsultationCaseDetail {
  const summary = serializeCaseSummary(record);
  const messages = record.messages.map((msg, idx) => {
    const bodyEnv = sanitizeUntrustedDocumentTextForMcp(msg.rawSanitizedBody, {
      field: `consultationCase.messages.${idx}.body`,
      maxLength: 4000,
    });
    return {
      messageId: msg.messageId,
      caseId: msg.caseId,
      authorUserId: msg.authorUserId,
      authorRole: msg.authorRole,
      body: bodyEnv,
      createdAt: msg.createdAtIso,
      ledgerMutationPerformed: false as const,
    };
  });
  return ConsultationCaseDetailSchema.parse({
    ...summary,
    messages,
  });
}

export class AccountantConsultationService {
  private readonly verifier: OidcAccessTokenVerifier;
  private readonly identityResolver: UserIdentityResolver;
  private readonly authorizationDataSource: TenantAuthorizationDataSource;
  private readonly securityAudit: SecurityAuditRecorder;
  private readonly clock: Clock;
  private readonly store: AccountantConsultationStorePort;
  private readonly mutex = new KeyedAsyncMutex();
  private readonly createIdempotency = new Map<
    string,
    { readonly requestHash: string; readonly caseId: string }
  >();
  private readonly replyIdempotency = new Map<
    string,
    { readonly requestHash: string; readonly response: ConsultationCaseDetail }
  >();
  private readonly listCandidateCompaniesForUser:
    | ((
        userId: UserId,
      ) => Promise<
        readonly { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }[]
      >)
    | undefined;
  private readonly checkExternalAccountantAssigned:
    ((tenantId: TenantId, legalEntityId: LegalEntityId) => Promise<boolean>) | undefined;

  constructor(deps: AccountantConsultationServiceDependencies) {
    this.verifier = deps.verifier;
    this.identityResolver = deps.identityResolver;
    this.authorizationDataSource = deps.authorizationDataSource;
    this.securityAudit = deps.securityAudit;
    this.clock = deps.clock ?? systemClock;
    this.store = deps.store ?? new InMemoryAccountantConsultationStore();
    this.listCandidateCompaniesForUser = deps.listCandidateCompaniesForUser;
    this.checkExternalAccountantAssigned = deps.checkExternalAccountantAssigned;
  }

  private async classifyActorConsultationRole(
    userIdVal: UserId,
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
  ): Promise<{
    readonly authorRole: ConsultationAuthorRole;
    readonly assignedAccountantStatus: ConsultationAssignedAccountantStatus;
  }> {
    const facts = await this.authorizationDataSource.getFacts({
      userId: userIdVal,
      tenantId: tenantIdVal,
      legalEntityId: legalEntityIdVal,
      action: 'read',
    });
    const role = facts.membership?.role;
    const authorRole: ConsultationAuthorRole =
      role === 'tenant_owner' || role === 'tenant_admin' ? 'company_client' : 'assigned_accountant';

    let hasAccountant = authorRole === 'assigned_accountant';
    if (!hasAccountant && this.checkExternalAccountantAssigned) {
      hasAccountant = await this.checkExternalAccountantAssigned(tenantIdVal, legalEntityIdVal);
    }
    return {
      authorRole,
      assignedAccountantStatus: hasAccountant ? 'active_grant_present' : 'no_accountant_assigned',
    };
  }

  private async recordSecurityDecisionFailClosed(
    event: Omit<SecurityAuditEvent, 'decidedAt'>,
  ): Promise<boolean> {
    try {
      await this.securityAudit.recordDecision({
        ...event,
        decidedAt: this.clock.now().toISOString(),
      });
      return true;
    } catch {
      return false;
    }
  }

  private async authorizeCompanyConsultationAccess(
    ctx: ConsultationCallContext,
    tenantIdRaw: string,
    legalEntityIdRaw: string,
    requiredMcpScope: McpScope,
  ): Promise<
    | {
        readonly ok: true;
        readonly userId: UserId;
        readonly tenantId: TenantId;
        readonly legalEntityId: LegalEntityId;
        readonly issuer: string;
        readonly subject: string;
        readonly scopes: readonly string[] | undefined;
        readonly correlationId: string;
      }
    | { readonly ok: false; readonly statusCode: number; readonly error: McpToolErrorEnvelope }
  > {
    const { correlationId } = resolveSafeRequestCorrelationId(ctx.correlationId);
    if (ctx.transportFailureReason) {
      const recorded = await this.recordSecurityDecisionFailClosed({
        requestId: correlationId,
        operationId: randomUUID(),
        actorId: null,
        tenantId: null,
        legalEntityId: null,
        action: requiredMcpScope === 'pap:mcp:prepare' ? 'write' : 'read',
        kind: 'transport',
        decision: 'deny',
        outcome: 'denied',
        reason: 'transport_rejected',
      });
      if (!recorded) {
        return buildErrorResult(
          503,
          'audit_unavailable',
          'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
          null,
          true,
        );
      }
      return buildErrorResult(
        401,
        'unauthenticated',
        'Odrzucono żądanie konsultacyjne z powodu niedozwolonego nagłówka tożsamości, tokenu w URL lub błędnego formatu Authorization.',
      );
    }

    const enforceMcp = ctx.enforceMcpScopes !== false;
    const auth = await authorizeAuthenticatedCompanyAction(
      {
        requestId: correlationId,
        rawBearerToken: ctx.rawBearerToken,
        tenantId: tenantIdRaw,
        legalEntityId: legalEntityIdRaw,
        action: 'read',
        ...(enforceMcp ? { requiredScopes: [requiredMcpScope] } : {}),
      },
      {
        verifier: this.verifier,
        identityResolver: this.identityResolver,
        securityAudit: this.securityAudit,
        authorizationDataSource: this.authorizationDataSource,
        clock: this.clock,
      },
    );

    if (!auth.allowed) {
      if (auth.reason === 'authorization_audit_unavailable') {
        return buildErrorResult(
          503,
          'audit_unavailable',
          'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
          null,
          true,
        );
      }
      if (auth.status === 'invalid_selector') {
        return buildErrorResult(
          400,
          'invalid_selector',
          'Nieprawidłowy identyfikator organizacji (tenantId) lub firmy (legalEntityId).',
        );
      }
      if (auth.reason === 'insufficient_scope') {
        return buildErrorResult(
          403,
          'insufficient_scope',
          `Brak wymaganego zakresu OIDC (${requiredMcpScope}) do operacji konsultacyjnej.`,
        );
      }
      if (auth.status === 'unauthenticated') {
        return buildErrorResult(
          401,
          'unauthenticated',
          'Wymagane ważne uwierzytelnienie OIDC Bearer do dostępu do spraw konsultacyjnych.',
        );
      }
      return buildErrorResult(
        403,
        'forbidden',
        'Brak aktywnego uprawnienia (grantu) do spraw konsultacyjnych wybranej firmy lub grant został cofnięty.',
      );
    }

    const actorScopes = auth.context.identity.scopes;
    if (!enforceMcp) {
      if (
        requiredMcpScope === 'pap:mcp:prepare' &&
        isAutonomousConsultationAgentToken(actorScopes)
      ) {
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: correlationId,
          operationId: randomUUID(),
          actorId: auth.context.userId,
          tenantId: auth.context.tenantId,
          legalEntityId: auth.context.legalEntityId,
          action: 'write',
          kind: 'company',
          decision: 'deny',
          outcome: 'denied',
          reason: 'authorization_context_invalid',
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        return buildErrorResult(
          403,
          'agent_self_approval_forbidden',
          'Autonomiczny agent AI nie może wykonywać bezpośrednich mutacji REST w sprawach konsultacyjnych.',
        );
      }

      const requiredRestSet =
        requiredMcpScope === 'pap:mcp:prepare'
          ? REST_CONSULTATION_WRITE_SCOPES
          : REST_CONSULTATION_READ_SCOPES;
      if (!hasAnyConsultationScope(actorScopes, requiredRestSet)) {
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: correlationId,
          operationId: randomUUID(),
          actorId: auth.context.userId,
          tenantId: auth.context.tenantId,
          legalEntityId: auth.context.legalEntityId,
          action: requiredMcpScope === 'pap:mcp:prepare' ? 'write' : 'read',
          kind: 'company',
          decision: 'deny',
          outcome: 'denied',
          reason: 'authentication_failed',
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        return buildErrorResult(
          403,
          'insufficient_scope',
          requiredMcpScope === 'pap:mcp:prepare'
            ? 'Zapis w wątku konsultacyjnym wymaga zakresu zapisu lub przygotowania (np. pap:ui:full, pap:ui:accounting, pap:api:write lub pap:mcp:prepare).'
            : 'Odczyt spraw konsultacyjnych wymaga odpowiedniego zakresu OIDC odczytu.',
        );
      }
    }

    return {
      ok: true,
      userId: auth.context.userId,
      tenantId: auth.context.tenantId,
      legalEntityId: auth.context.legalEntityId,
      issuer: auth.context.identity.issuer,
      subject: auth.context.identity.subject,
      scopes: actorScopes,
      correlationId,
    };
  }

  async listMyCases(
    ctx: ConsultationCallContext,
    rawInput: unknown,
  ): Promise<ConsultationServiceResult<ListMyConsultationCasesOutput>> {
    const { correlationId } = resolveSafeRequestCorrelationId(ctx.correlationId);
    const parsed = ListMyConsultationCasesInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return buildErrorResult(
        400,
        'validation_failed',
        'Nieprawidłowe parametry filtrowania spraw konsultacyjnych.',
      );
    }
    const input = parsed.data;

    if ((input.tenantId === undefined) !== (input.legalEntityId === undefined)) {
      return buildErrorResult(
        400,
        'invalid_selector',
        'Podając kontekst firmy w list_my_cases, wskaż jednocześnie tenantId oraz legalEntityId.',
      );
    }

    const collectedRecords: StoredConsultationCaseRecord[] = [];
    const roleFilter = input.roleView ?? 'all';

    let finalAuditEventId = correlationId;

    if (input.tenantId && input.legalEntityId) {
      const auth = await this.authorizeCompanyConsultationAccess(
        ctx,
        input.tenantId,
        input.legalEntityId,
        'pap:mcp:read',
      );
      if (!auth.ok) {
        return auth;
      }
      const roleInfo = await this.classifyActorConsultationRole(
        auth.userId,
        auth.tenantId,
        auth.legalEntityId,
      );
      if (
        (roleFilter === 'client' && roleInfo.authorRole !== 'company_client') ||
        (roleFilter === 'accountant_queue' && roleInfo.authorRole !== 'assigned_accountant')
      ) {
        // Role view filter excludes this company role
      } else {
        const entityCases = await this.store.listCasesForEntity(auth.tenantId, auth.legalEntityId);
        collectedRecords.push(...entityCases);
      }
    } else {
      if (ctx.transportFailureReason) {
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: correlationId,
          operationId: randomUUID(),
          actorId: null,
          tenantId: null,
          legalEntityId: null,
          action: 'read',
          kind: 'transport',
          decision: 'deny',
          outcome: 'denied',
          reason: 'transport_rejected',
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        return buildErrorResult(
          401,
          'unauthenticated',
          'Odrzucono żądanie konsultacyjne z powodu niedozwolonego nagłówka tożsamości, tokenu w URL lub błędnego formatu Authorization.',
        );
      }

      const enforceMcp = ctx.enforceMcpScopes !== false;
      const actor = await authenticateOidcActor(
        ctx.rawBearerToken,
        { verifier: this.verifier, identityResolver: this.identityResolver },
        enforceMcp ? { requiredScopes: ['pap:mcp:read'] } : undefined,
      );
      if (!actor.authenticated) {
        const denyReason: SecurityAuditReason =
          actor.status === 'forbidden'
            ? 'identity_not_provisioned_or_disabled'
            : 'authentication_failed';
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: correlationId,
          operationId: randomUUID(),
          actorId: null,
          tenantId: null,
          legalEntityId: null,
          action: 'read',
          kind: 'preflight',
          decision: 'deny',
          outcome: 'denied',
          reason: denyReason,
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        if (actor.reason === 'insufficient_scope') {
          return buildErrorResult(
            403,
            'insufficient_scope',
            'Brak wymaganego zakresu OIDC (pap:mcp:read) do odczytu kolejki spraw.',
          );
        }
        return buildErrorResult(
          actor.status === 'unauthenticated' ? 401 : 403,
          actor.status === 'unauthenticated' ? 'unauthenticated' : 'forbidden',
          'Wymagane uwierzytelnienie OIDC do odczytu kolejki spraw konsultacyjnych.',
        );
      }

      if (
        !enforceMcp &&
        !hasAnyConsultationScope(actor.identity.scopes, REST_CONSULTATION_READ_SCOPES)
      ) {
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: correlationId,
          operationId: randomUUID(),
          actorId: actor.userId,
          tenantId: null,
          legalEntityId: null,
          action: 'read',
          kind: 'preflight',
          decision: 'deny',
          outcome: 'denied',
          reason: 'authentication_failed',
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        return buildErrorResult(
          403,
          'insufficient_scope',
          'Brak wymaganego zakresu OIDC do odczytu kolejki spraw konsultacyjnych.',
        );
      }

      const candidateMap = new Map<
        string,
        { readonly tenantId: TenantId; readonly legalEntityId: LegalEntityId }
      >();
      if (this.listCandidateCompaniesForUser) {
        const fromDirectory = await this.listCandidateCompaniesForUser(actor.userId);
        for (const item of fromDirectory) {
          candidateMap.set(`${item.tenantId}:${item.legalEntityId}`, item);
        }
      }
      for (const scope of await this.store.listDistinctEntityScopes()) {
        candidateMap.set(`${scope.tenantId}:${scope.legalEntityId}`, scope);
      }

      const now = this.clock.now();
      for (const candidate of candidateMap.values()) {
        const facts = await this.authorizationDataSource.getFacts({
          userId: actor.userId,
          tenantId: candidate.tenantId,
          legalEntityId: candidate.legalEntityId,
          action: 'read',
        });
        const decision = decideAccountingAccess({
          userId: actor.userId,
          tenantId: candidate.tenantId,
          legalEntityId: candidate.legalEntityId,
          action: 'read',
          membership: facts.membership,
          grants: facts.grants,
          now,
        });
        if (!decision.allowed) {
          continue;
        }
        const mRole = facts.membership?.role;
        const actorRole: ConsultationAuthorRole =
          mRole === 'tenant_owner' || mRole === 'tenant_admin'
            ? 'company_client'
            : 'assigned_accountant';
        if (roleFilter === 'client' && actorRole !== 'company_client') {
          continue;
        }
        if (roleFilter === 'accountant_queue' && actorRole !== 'assigned_accountant') {
          continue;
        }
        const entityCases = await this.store.listCasesForEntity(
          candidate.tenantId,
          candidate.legalEntityId,
        );
        collectedRecords.push(...entityCases);
      }

      const globalAuditOpId = randomUUID();
      const recordedAllow = await this.recordSecurityDecisionFailClosed({
        requestId: correlationId,
        operationId: globalAuditOpId,
        actorId: actor.userId,
        tenantId: null,
        legalEntityId: null,
        action: 'read',
        kind: 'preflight',
        decision: 'allow',
        outcome: 'preflight',
        reason: 'explicit_company_grant',
      });
      if (!recordedAllow) {
        return buildErrorResult(
          503,
          'audit_unavailable',
          'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
          null,
          true,
        );
      }
      finalAuditEventId = globalAuditOpId;
    }

    const filtered = collectedRecords
      .filter((c) => !input.statusFilter || c.status === input.statusFilter)
      .sort((a, b) =>
        a.updatedAtIso === b.updatedAtIso
          ? a.caseId.localeCompare(b.caseId)
          : b.updatedAtIso.localeCompare(a.updatedAtIso),
      );

    const summaries = filtered.map(serializeCaseSummary);
    const promptInjectionWarningsCount = summaries.filter(
      (s) => s.subject.promptInjectionSuspected,
    ).length;

    const limit = input.limit ?? 50;
    let startIdx = 0;
    if (input.cursor) {
      const idx = summaries.findIndex((s) => s.caseId === input.cursor?.toLowerCase());
      startIdx = idx >= 0 ? idx + 1 : summaries.length;
    }
    const page = summaries.slice(startIdx, startIdx + limit);
    const nextCursor =
      startIdx + limit < summaries.length && page.length > 0 ? page[page.length - 1]!.caseId : null;

    return {
      ok: true,
      data: ListMyConsultationCasesOutputSchema.parse({
        cases: page,
        nextCursor,
        promptInjectionWarningsCount,
        storageMode: 'synthetic_in_memory_stage_ab',
        auditEventId: finalAuditEventId,
      }),
    };
  }

  async getConsultationCase(
    ctx: ConsultationCallContext,
    rawInput: unknown,
  ): Promise<ConsultationServiceResult<GetConsultationCaseOutput>> {
    const parsed = GetConsultationCaseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return buildErrorResult(
        400,
        'validation_failed',
        'Wymagane poprawne identyfikatory UUID: tenantId, legalEntityId oraz caseId.',
      );
    }
    const input = parsed.data;
    const auth = await this.authorizeCompanyConsultationAccess(
      ctx,
      input.tenantId,
      input.legalEntityId,
      'pap:mcp:read',
    );
    if (!auth.ok) {
      return auth;
    }

    const record = await this.store.getCaseById(
      auth.tenantId,
      auth.legalEntityId,
      input.caseId.toLowerCase(),
    );
    if (!record) {
      return buildErrorResult(
        404,
        'resource_not_found',
        'Nie znaleziono sprawy konsultacyjnej we wskazanej firmie.',
      );
    }

    return {
      ok: true,
      data: GetConsultationCaseOutputSchema.parse({
        caseDetail: serializeCaseDetail(record),
        auditEventId: auth.correlationId,
      }),
    };
  }

  async createConsultationDraft(
    ctx: ConsultationCallContext,
    rawInput: unknown,
  ): Promise<ConsultationServiceResult<CreateConsultationDraftOutput>> {
    const parsed = CreateConsultationDraftInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return buildErrorResult(
        422,
        'validation_failed',
        'Nieprawidłowe dane nowej sprawy konsultacyjnej (wymagany temat min. 3 znaki, treść wiadomości oraz UUID idempotencyKey).',
      );
    }
    const input = parsed.data;
    const normalizedIdem = input.idempotencyKey.toLowerCase();

    const auth = await this.authorizeCompanyConsultationAccess(
      ctx,
      input.tenantId,
      input.legalEntityId,
      'pap:mcp:prepare',
    );
    if (!auth.ok) {
      return auth;
    }

    const redactedSubject = redactSecretsAndPiiForMcp(input.subject.trim()) ?? input.subject.trim();
    const redactedMessage =
      redactSecretsAndPiiForMcp(input.initialMessage.trim()) ?? input.initialMessage.trim();
    const subjectEnv = sanitizeUntrustedDocumentTextForMcp(redactedSubject, {
      field: 'consultationCase.subject',
      maxLength: 200,
    });
    const messageEnv = sanitizeUntrustedDocumentTextForMcp(redactedMessage, {
      field: 'consultationCase.initialMessage',
      maxLength: 4000,
    });

    if (subjectEnv.sanitizedText.length < 3 || messageEnv.sanitizedText.length < 3) {
      return buildErrorResult(
        422,
        'validation_failed',
        'Temat lub treść wiadomości konsultacyjnej jest pusta po oczyszczeniu znaków sterujących.',
      );
    }

    const idemSlot = `${auth.userId}:${auth.tenantId}:${auth.legalEntityId}:${normalizedIdem}`;
    const requestHash = sha256Hex(
      JSON.stringify({
        tenantId: auth.tenantId,
        legalEntityId: auth.legalEntityId,
        caseType: input.caseType,
        priority: input.priority ?? 'normal',
        subject: subjectEnv.sanitizedText,
        initialMessage: messageEnv.sanitizedText,
        taxPeriod: input.taxPeriod ?? null,
        relatedDocumentId: input.relatedDocumentId?.toLowerCase() ?? null,
      }),
    );

    return this.mutex.runExclusive([`consult-create:${idemSlot}`], async () => {
      const existingIdem = this.createIdempotency.get(idemSlot);
      if (existingIdem) {
        if (!constantTimeHexEquals(existingIdem.requestHash, requestHash)) {
          return buildErrorResult(
            409,
            'idempotency_key_payload_conflict',
            'Klucz idempotencyKey został już użyty do utworzenia sprawy konsultacyjnej o innej treści.',
          );
        }
        const existingCase = await this.store.getCaseById(
          auth.tenantId,
          auth.legalEntityId,
          existingIdem.caseId,
        );
        if (existingCase) {
          return {
            ok: true,
            data: CreateConsultationDraftOutputSchema.parse({
              caseDetail: serializeCaseDetail(existingCase),
              idempotencyKey: normalizedIdem,
              idempotentReplay: true,
              ledgerMutationPerformed: false,
              aiSimulatedAccountantReplyGenerated: false,
              auditEventId: auth.correlationId,
            }),
          };
        }
      }

      const roleInfo = await this.classifyActorConsultationRole(
        auth.userId,
        auth.tenantId,
        auth.legalEntityId,
      );
      if (
        isAutonomousConsultationAgentToken(auth.scopes) &&
        roleInfo.authorRole === 'assigned_accountant'
      ) {
        const recorded = await this.recordSecurityDecisionFailClosed({
          requestId: auth.correlationId,
          operationId: randomUUID(),
          actorId: auth.userId,
          tenantId: auth.tenantId,
          legalEntityId: auth.legalEntityId,
          action: 'write',
          kind: 'company',
          decision: 'deny',
          outcome: 'denied',
          reason: 'authorization_context_invalid',
        });
        if (!recorded) {
          return buildErrorResult(
            503,
            'audit_unavailable',
            'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
            null,
            true,
          );
        }
        return buildErrorResult(
          403,
          'agent_self_approval_forbidden',
          'Autonomiczny agent AI nie może otwierać wątków konsultacyjnych w roli przypisanego księgowego (assigned_accountant) bez udziału człowieka.',
        );
      }
      const nowIso = this.clock.now().toISOString();
      const caseId = randomUUID();
      const initialStatus: ConsultationCaseStatus =
        roleInfo.authorRole === 'company_client' ? 'waiting_for_accountant' : 'waiting_for_client';

      const newRecord: StoredConsultationCaseRecord = {
        caseId,
        tenantId: auth.tenantId,
        legalEntityId: auth.legalEntityId,
        caseType: input.caseType,
        status: initialStatus,
        priority: input.priority ?? 'normal',
        rawSanitizedSubject: subjectEnv.sanitizedText,
        taxPeriod: input.taxPeriod ?? null,
        relatedDocumentId: input.relatedDocumentId?.toLowerCase() ?? null,
        createdByUserId: auth.userId,
        assignedAccountantStatus: roleInfo.assignedAccountantStatus,
        lastMessageAuthorRole: roleInfo.authorRole,
        version: 1,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        messages: [
          {
            messageId: randomUUID(),
            caseId,
            authorUserId: auth.userId,
            authorRole: roleInfo.authorRole,
            rawSanitizedBody: messageEnv.sanitizedText,
            createdAtIso: nowIso,
          },
        ],
      };

      await this.store.saveNewCase(newRecord);
      this.createIdempotency.set(idemSlot, { requestHash, caseId });

      return {
        ok: true,
        data: CreateConsultationDraftOutputSchema.parse({
          caseDetail: serializeCaseDetail(newRecord),
          idempotencyKey: normalizedIdem,
          idempotentReplay: false,
          ledgerMutationPerformed: false,
          aiSimulatedAccountantReplyGenerated: false,
          auditEventId: auth.correlationId,
        }),
      };
    });
  }

  async replyToConsultationCase(
    ctx: ConsultationCallContext,
    rawInput: unknown,
  ): Promise<ConsultationServiceResult<ReplyToConsultationCaseOutput>> {
    const parsed = ReplyToConsultationCaseInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return buildErrorResult(
        422,
        'validation_failed',
        'Nieprawidłowe parametry odpowiedzi w sprawie konsultacyjnej (wymagane caseId, expectedVersion, treść wiadomości oraz idempotencyKey).',
      );
    }
    const input = parsed.data;
    const normalizedIdem = input.idempotencyKey.toLowerCase();
    const normalizedCaseId = input.caseId.toLowerCase();

    const auth = await this.authorizeCompanyConsultationAccess(
      ctx,
      input.tenantId,
      input.legalEntityId,
      'pap:mcp:prepare',
    );
    if (!auth.ok) {
      return auth;
    }

    if (isAutonomousConsultationAgentToken(auth.scopes)) {
      const recorded = await this.recordSecurityDecisionFailClosed({
        requestId: auth.correlationId,
        operationId: randomUUID(),
        actorId: auth.userId,
        tenantId: auth.tenantId,
        legalEntityId: auth.legalEntityId,
        action: 'write',
        kind: 'company',
        decision: 'deny',
        outcome: 'denied',
        reason: 'authorization_context_invalid',
      });
      if (!recorded) {
        return buildErrorResult(
          503,
          'audit_unavailable',
          'Operacja konsultacji została zablokowana (fail-closed) z powodu niedostępności audytu.',
          null,
          true,
        );
      }
      return buildErrorResult(
        403,
        'agent_self_approval_forbidden',
        'Autonomiczny agent AI nie może samodzielnie odpowiadać w wątku konsultacyjnym, podszywać się pod doradcę ani zamykać spraw bez zatwierdzenia człowieka.',
      );
    }

    const redactedMsg = redactSecretsAndPiiForMcp(input.message.trim()) ?? input.message.trim();
    const msgEnv = sanitizeUntrustedDocumentTextForMcp(redactedMsg, {
      field: 'consultationCase.replyMessage',
      maxLength: 4000,
    });
    if (msgEnv.sanitizedText.length < 2) {
      return buildErrorResult(
        422,
        'validation_failed',
        'Treść odpowiedzi konsultacyjnej jest pusta po oczyszczeniu znaków sterujących.',
      );
    }

    const idemSlot = `${auth.userId}:${auth.tenantId}:${auth.legalEntityId}:${normalizedIdem}`;
    const requestHash = sha256Hex(
      JSON.stringify({
        tenantId: auth.tenantId,
        legalEntityId: auth.legalEntityId,
        caseId: normalizedCaseId,
        expectedVersion: input.expectedVersion,
        message: msgEnv.sanitizedText,
        nextStatus: input.nextStatus ?? null,
      }),
    );

    return this.mutex.runExclusive(
      [`consult-case:${normalizedCaseId}`, `consult-reply-idem:${idemSlot}`],
      async () => {
        const existingIdem = this.replyIdempotency.get(idemSlot);
        if (existingIdem) {
          if (!constantTimeHexEquals(existingIdem.requestHash, requestHash)) {
            return buildErrorResult(
              409,
              'idempotency_key_payload_conflict',
              'Klucz idempotencyKey został już użyty do wysłania innej odpowiedzi konsultacyjnej.',
            );
          }
          return {
            ok: true,
            data: ReplyToConsultationCaseOutputSchema.parse({
              caseDetail: existingIdem.response,
              idempotencyKey: normalizedIdem,
              idempotentReplay: true,
              ledgerMutationPerformed: false,
              aiSimulatedAccountantReplyGenerated: false,
              auditEventId: auth.correlationId,
            }),
          };
        }

        const current = await this.store.getCaseById(
          auth.tenantId,
          auth.legalEntityId,
          normalizedCaseId,
        );
        if (!current) {
          return buildErrorResult(
            404,
            'resource_not_found',
            'Nie znaleziono sprawy konsultacyjnej we wskazanej firmie.',
          );
        }
        if (current.status === 'closed') {
          return buildErrorResult(
            409,
            'conflict',
            'Sprawa konsultacyjna została zamknięta — utwórz nową sprawę dla kolejnego zapytania.',
          );
        }

        const roleInfo = await this.classifyActorConsultationRole(
          auth.userId,
          auth.tenantId,
          auth.legalEntityId,
        );
        const defaultNextStatus: ConsultationCaseStatus =
          roleInfo.authorRole === 'assigned_accountant'
            ? 'waiting_for_client'
            : 'waiting_for_accountant';
        const nextStatus: ConsultationCaseStatus = input.nextStatus ?? defaultNextStatus;
        const nowIso = this.clock.now().toISOString();

        const updated = await this.store.appendReplyAndUpdateCase({
          tenantId: auth.tenantId,
          legalEntityId: auth.legalEntityId,
          caseId: normalizedCaseId,
          expectedVersion: input.expectedVersion,
          message: {
            messageId: randomUUID(),
            caseId: normalizedCaseId,
            authorUserId: auth.userId,
            authorRole: roleInfo.authorRole,
            rawSanitizedBody: msgEnv.sanitizedText,
            createdAtIso: nowIso,
          },
          nextStatus,
          assignedAccountantStatus: roleInfo.assignedAccountantStatus,
          updatedAtIso: nowIso,
        });

        if (updated === 'not_found') {
          return buildErrorResult(
            404,
            'resource_not_found',
            'Nie znaleziono sprawy konsultacyjnej we wskazanej firmie.',
          );
        }
        if (updated === 'version_conflict') {
          return buildErrorResult(
            409,
            'conflict',
            `Konflikt wersji sprawy konsultacyjnej (expectedVersion=${input.expectedVersion}, aktualna wersja uległa zmianie) — odśwież wątek przed wysłaniem odpowiedzi.`,
          );
        }

        const detail = serializeCaseDetail(updated);
        this.replyIdempotency.set(idemSlot, { requestHash, response: detail });

        return {
          ok: true,
          data: ReplyToConsultationCaseOutputSchema.parse({
            caseDetail: detail,
            idempotencyKey: normalizedIdem,
            idempotentReplay: false,
            ledgerMutationPerformed: false,
            aiSimulatedAccountantReplyGenerated: false,
            auditEventId: auth.correlationId,
          }),
        };
      },
    );
  }
}

export { parseLegalEntityId, parseTenantId };
