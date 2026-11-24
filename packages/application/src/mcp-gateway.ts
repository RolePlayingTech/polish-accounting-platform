import { randomBytes, randomUUID } from 'node:crypto';
import type { SystemStatus } from '@pap/contracts';
import {
  UuidSelectorSchema,
  type ConfirmBankReconciliationOutput,
  type ConfirmMonthCloseOutput,
  type ConfirmPreparedProposalOutput,
  type CreateConsultationDraftOutput,
  type ExplainAccountingItemOutput,
  type ExplainTaxCalculationOutput,
  type GetAuditLineageOutput,
  type GetCompanyProfileOutput,
  type GetConsultationCaseOutput,
  type GetLegalBasisOutput,
  type GetMonthCloseChecklistOutput,
  type GetMonthlyTaxObligationsOutput,
  type ListAvailableCapabilitiesOutput,
  type ListMyCompaniesOutput,
  type ListMyConsultationCasesOutput,
  type ListUnpaidInvoicesOutput,
  type ListUnreconciledBankTransactionsOutput,
  type McpToolDescriptor,
  type PrepareBankReconciliationOutput,
  type PrepareInvoiceAndPostingProposalOutput,
  type PrepareMonthCloseOutput,
  type PreviewInvoicePostingOutput,
  type PreviewJpkExportOutput,
  type ReplyToConsultationCaseOutput,
} from '@pap/contracts/mcp-tools';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
  type CompanyAccessGrant,
  type LegalEntityId,
  type TenantId,
  type TenantMembership,
  type UserId,
} from '@pap/domain';
import { authorizeAuthenticatedCompanyAction } from './oidc-authentication.js';
import { getSystemStatus } from './system-status.js';
import { systemClock } from './tenant-authorization.js';
import {
  AccountantConsultationService,
  InMemoryAccountantConsultationStore,
  InMemoryMcpAuditSink,
  InMemoryPapMcpDataSource,
  KeyedAsyncMutex,
  McpSlidingWindowRateLimiter,
  PAP_MCP_TOOL_DESCRIPTORS,
  SYNTHETIC_CONSULTATION_STAGE_AB_DISCLAIMER_PL,
  VERIFIED_POLISH_LEGAL_BASIS_CATALOG,
  computeCanonicalMcpInvoicePayloadHash,
  computeProposedAccountingPreview,
  evaluateCompanyCapabilities,
  handleConfirmBankReconciliationProposal,
  handleConfirmMonthCloseProposal,
  handleConfirmPreparedProposal,
  handleCreateConsultationDraft,
  handleExplainAccountingItem,
  handleExplainTaxCalculation,
  handleGetAuditLineage,
  handleGetCompanyProfile,
  handleGetConsultationCase,
  handleGetLegalBasis,
  handleGetMonthCloseChecklist,
  handleGetMonthlyTaxObligations,
  handleListAvailableCapabilities,
  handleListMyCompanies,
  handleListMyConsultationCases,
  handleListUnpaidInvoices,
  handleListUnreconciledBankTransactions,
  handlePrepareBankReconciliation,
  handlePrepareInvoiceAndPostingProposal,
  handlePrepareMonthClose,
  handlePreviewInvoicePosting,
  handlePreviewJpkExport,
  handleReplyToConsultationCase,
  isSelfApprovalForbiddenForChallengeIssuer,
  maskNip,
  parsePlnToGrosze,
  redactSecretsAndPiiForMcp,
  recordMcpAuditFailClosed,
  resolveCompanyProfileSupportStatus,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
  validateAndResolveMcpInvoiceVat,
  type AccountantConsultationServiceDependencies,
  type AccountantConsultationStorePort,
  type AccountingItemExplanationRecord,
  type CompanyDirectoryRecord,
  type CompanyTaxProfile,
  type CompanyTaxRegime,
  type CompanyVatStatus,
  type ConsultationCallContext,
  type ConsultationServiceResult,
  type ExternalCompanyAuditRecord,
  type LegalBasisCatalogEntry,
  type McpAuditEvent,
  type McpAuditSink,
  type McpCallContext,
  type McpGateEnvironment,
  type McpGatewayToolResult,
  type McpJpkPeriodSourceData,
  type McpTaxCalculationSourceData,
  type MonthCloseRawData,
  type PapMcpDataSource,
  type PapMcpGatewayDependencies,
  type StoredBankReconciliationProposal,
  type StoredConsultationCaseRecord,
  type StoredConsultationMessageRecord,
  type StoredMonthCloseProposal,
  type StoredPreparedProposal,
  type UnpaidInvoiceRecord,
  type UnreconciledBankTransactionRecord,
  type VatPeriodPreviewSnapshot,
} from './mcp/index.js';

export {
  AccountantConsultationService,
  InMemoryAccountantConsultationStore,
  InMemoryMcpAuditSink,
  InMemoryPapMcpDataSource,
  PAP_MCP_TOOL_DESCRIPTORS,
  SYNTHETIC_CONSULTATION_STAGE_AB_DISCLAIMER_PL,
  VERIFIED_POLISH_LEGAL_BASIS_CATALOG,
  computeCanonicalMcpInvoicePayloadHash,
  computeProposedAccountingPreview,
  evaluateCompanyCapabilities,
  maskNip,
  parseLegalEntityId as mcpLegalEntityId,
  parseTenantId as mcpTenantId,
  parseUserId as mcpUserId,
  redactSecretsAndPiiForMcp,
  resolveCompanyProfileSupportStatus,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  validateAndResolveMcpInvoiceVat,
};

export type {
  AccountantConsultationServiceDependencies,
  AccountantConsultationStorePort,
  AccountingItemExplanationRecord,
  CompanyAccessGrant,
  CompanyDirectoryRecord,
  CompanyTaxProfile,
  CompanyTaxRegime,
  CompanyVatStatus,
  ConsultationCallContext,
  ConsultationServiceResult,
  ExternalCompanyAuditRecord,
  LegalBasisCatalogEntry,
  LegalEntityId,
  McpAuditEvent,
  McpAuditSink,
  McpCallContext,
  McpGatewayToolResult,
  McpJpkPeriodSourceData,
  McpTaxCalculationSourceData,
  MonthCloseRawData,
  PapMcpDataSource,
  PapMcpGatewayDependencies,
  StoredBankReconciliationProposal,
  StoredConsultationCaseRecord,
  StoredConsultationMessageRecord,
  StoredMonthCloseProposal,
  StoredPreparedProposal,
  TenantId,
  TenantMembership,
  UnpaidInvoiceRecord,
  UnreconciledBankTransactionRecord,
  UserId,
  VatPeriodPreviewSnapshot,
};

export class PapMcpGateway {
  private readonly env: McpGateEnvironment;
  readonly proposalsById: McpGateEnvironment['state']['proposalsById'];
  readonly prepareIdempotency: McpGateEnvironment['state']['prepareIdempotency'];
  readonly confirmIdempotency: McpGateEnvironment['state']['confirmIdempotency'];
  readonly humanChallengesByProposal: McpGateEnvironment['state']['humanChallengesByProposal'];

  constructor(deps: PapMcpGatewayDependencies) {
    const auditSink = deps.auditSink ?? new InMemoryMcpAuditSink();
    const clock = deps.clock ?? systemClock;
    const securityAudit = deps.securityAudit ?? {
      recordDecision: async (event) => {
        const safeCorr = resolveSafeRequestCorrelationId(event.requestId ?? undefined);
        await auditSink.record({
          auditEventId: randomUUID(),
          occurredAt: clock.now().toISOString(),
          source: 'mcp',
          toolName: '_security_decision_preflight',
          correlationId: safeCorr.correlationId,
          actorUserId: event.actorId,
          actorIssuer: null,
          actorSubject: null,
          tenantId: event.tenantId,
          legalEntityId: event.legalEntityId,
          outcome: event.decision,
          reasonCode: redactSecretsAndPiiForMcp(event.reason) ?? 'redacted',
          idempotencyKey: null,
          proposalId: null,
          payloadHash: null,
          promptInjectionSuspected: false,
        });
      },
    };

    const mutableDataSourceRef: { current: PapMcpDataSource } = {
      current: deps.dataSource,
    };
    const dynamicDataSource = new Proxy({} as PapMcpDataSource, {
      get(_target, prop) {
        const current = mutableDataSourceRef.current;
        const val = Reflect.get(current, prop, current);
        return typeof val === 'function' ? val.bind(current) : val;
      },
    });

    const consultationService =
      deps.consultationService ??
      new AccountantConsultationService({
        verifier: deps.verifier,
        identityResolver: deps.identityResolver,
        authorizationDataSource: deps.authorizationDataSource,
        securityAudit,
        clock,
        listCandidateCompaniesForUser: async (uId) => {
          const candidates = await dynamicDataSource.listCandidateCompaniesForUser(uId);
          return candidates.map((c) => ({
            tenantId: c.tenantId,
            legalEntityId: c.legalEntityId,
          }));
        },
      });

    this.mutableDataSourceRef = mutableDataSourceRef;
    this.env = {
      verifier: deps.verifier,
      identityResolver: deps.identityResolver,
      authorizationDataSource: deps.authorizationDataSource,
      dataSource: dynamicDataSource,
      securityAudit,
      auditSink,
      clock,
      proposalTtlMs: Math.max(60_000, deps.proposalTtlMs ?? 24 * 60 * 60 * 1000),
      humanConfirmationTtlMs: Math.max(30_000, deps.humanConfirmationTtlMs ?? 15 * 60 * 1000),
      mutex: new KeyedAsyncMutex(),
      rateLimiter: new McpSlidingWindowRateLimiter({
        maxCalls: deps.rateLimitMaxCallsPerMinute ?? 240,
        windowMs: 60_000,
      }),
      consultationService,
      state: {
        proposalsById: new Map(),
        prepareIdempotency: new Map(),
        confirmIdempotency: new Map(),
        bankProposalsById: new Map(),
        bankPrepareIdempotency: new Map(),
        bankConfirmIdempotency: new Map(),
        monthCloseProposalsById: new Map(),
        monthCloseIdempotency: new Map(),
        monthCloseConfirmIdempotency: new Map(),
        humanChallengesByProposal: new Map(),
        recordedAuditHistory: [],
      },
    };
    this.proposalsById = this.env.state.proposalsById;
    this.prepareIdempotency = this.env.state.prepareIdempotency;
    this.confirmIdempotency = this.env.state.confirmIdempotency;
    this.humanChallengesByProposal = this.env.state.humanChallengesByProposal;
  }

  private readonly mutableDataSourceRef: { current: PapMcpDataSource };

  getConsultationService(): AccountantConsultationService {
    return this.env.consultationService;
  }

  /**
   * Attaches live read/write adapter overrides onto the underlying MCP data source
   * without breaking existing bound workspace references.
   */
  attachLiveDataSourceOverrides(overrides: Partial<PapMcpDataSource>): void {
    const base = this.mutableDataSourceRef.current;
    this.mutableDataSourceRef.current = new Proxy(base, {
      get(target, prop, receiver) {
        if (
          typeof prop === 'string' &&
          Object.prototype.hasOwnProperty.call(overrides, prop) &&
          overrides[prop as keyof PapMcpDataSource] !== undefined
        ) {
          return overrides[prop as keyof PapMcpDataSource];
        }
        const val: unknown = Reflect.get(target, prop, receiver);
        return typeof val === 'function' ? val.bind(target) : val;
      },
    });
  }

  getSystemStatus(): SystemStatus {
    return getSystemStatus();
  }

  getToolDescriptors(): readonly McpToolDescriptor[] {
    return PAP_MCP_TOOL_DESCRIPTORS;
  }

  /**
   * Used by HTTP transport middleware to record pre-tool authentication/header rejections
   * in the unified MCP audit trail without ever logging raw tokens or throwing unhandled exceptions.
   */
  async recordTransportRejectionAudit(input: {
    readonly correlationId: string;
    readonly reasonCode: string;
  }): Promise<string | null> {
    const safeCorr = resolveSafeRequestCorrelationId(input.correlationId);
    return recordMcpAuditFailClosed(this.env, {
      toolName: '_http_transport_gate',
      correlationId: safeCorr.correlationId,
      actorUserId: null,
      actorIssuer: null,
      actorSubject: null,
      tenantId: null,
      legalEntityId: null,
      outcome: 'deny',
      reasonCode: redactSecretsAndPiiForMcp(input.reasonCode) ?? 'transport_rejected',
      idempotencyKey: null,
      proposalId: null,
      payloadHash: null,
      promptInjectionSuspected: false,
    });
  }

  /**
   * Out-of-band human review gate (invoked ONLY from authenticated Web UI / human confirmation service,
   * NEVER exposed as an MCP tool to AI agents!). Issues a short-lived one-time confirmationCode bound
   * to the exact proposalId, payloadHash, and human reviewer userId, with hard anti-self-approval.
   */
  async issueHumanConfirmationChallenge(input: {
    readonly humanBearerToken: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly proposalId: string;
    readonly correlationId?: string | undefined;
  }): Promise<
    | {
        readonly ok: true;
        readonly confirmationCode: string;
        readonly payloadHash: string;
        readonly expiresAt: string;
        readonly auditEventId: string;
      }
    | {
        readonly ok: false;
        readonly reason: string;
      }
  > {
    const { correlationId } = resolveSafeRequestCorrelationId(input.correlationId);
    const parsedProposalId = UuidSelectorSchema.safeParse(input.proposalId);
    const safeProposalId = parsedProposalId.success ? parsedProposalId.data.toLowerCase() : null;

    const auth = await authorizeAuthenticatedCompanyAction(
      {
        requestId: correlationId,
        rawBearerToken: input.humanBearerToken,
        tenantId: input.tenantId,
        legalEntityId: input.legalEntityId,
        action: 'write',
      },
      {
        verifier: this.env.verifier,
        identityResolver: this.env.identityResolver,
        securityAudit: this.env.securityAudit,
        authorizationDataSource: this.env.authorizationDataSource,
        clock: this.env.clock,
      },
    );

    let safeTenant: string | null;
    let safeEntity: string | null;
    try {
      safeTenant = parseTenantId(input.tenantId);
      safeEntity = parseLegalEntityId(input.legalEntityId);
    } catch {
      safeTenant = null;
      safeEntity = null;
    }

    if (!auth.allowed) {
      if (auth.reason === 'authorization_audit_unavailable') {
        return { ok: false, reason: 'audit_unavailable' };
      }
      const denyAuditId = await recordMcpAuditFailClosed(this.env, {
        toolName: '_human_confirmation_challenge',
        correlationId,
        actorUserId: null,
        actorIssuer: null,
        actorSubject: null,
        tenantId: safeTenant,
        legalEntityId: safeEntity,
        outcome: 'deny',
        reasonCode: auth.reason,
        idempotencyKey: null,
        proposalId: safeProposalId,
        payloadHash: null,
        promptInjectionSuspected: false,
      });
      if (!denyAuditId) {
        return { ok: false, reason: 'audit_unavailable' };
      }
      return { ok: false, reason: auth.reason };
    }

    if (isSelfApprovalForbiddenForChallengeIssuer(auth.context.identity)) {
      const denyAuditId = await recordMcpAuditFailClosed(this.env, {
        toolName: '_human_confirmation_challenge',
        correlationId,
        actorUserId: auth.context.userId,
        actorIssuer: auth.context.identity.issuer,
        actorSubject: auth.context.identity.subject,
        tenantId: auth.context.tenantId,
        legalEntityId: auth.context.legalEntityId,
        outcome: 'deny',
        reasonCode: 'agent_self_approval_forbidden',
        idempotencyKey: null,
        proposalId: safeProposalId,
        payloadHash: null,
        promptInjectionSuspected: false,
      });
      if (!denyAuditId) {
        return { ok: false, reason: 'audit_unavailable' };
      }
      return { ok: false, reason: 'agent_self_approval_forbidden' };
    }

    if (!safeProposalId) {
      const denyAuditId = await recordMcpAuditFailClosed(this.env, {
        toolName: '_human_confirmation_challenge',
        correlationId,
        actorUserId: auth.context.userId,
        actorIssuer: auth.context.identity.issuer,
        actorSubject: auth.context.identity.subject,
        tenantId: auth.context.tenantId,
        legalEntityId: auth.context.legalEntityId,
        outcome: 'deny',
        reasonCode: 'invalid_proposal_selector',
        idempotencyKey: null,
        proposalId: null,
        payloadHash: null,
        promptInjectionSuspected: false,
      });
      if (!denyAuditId) {
        return { ok: false, reason: 'audit_unavailable' };
      }
      return { ok: false, reason: 'proposal_not_found_or_forbidden' };
    }

    return this.env.mutex.runExclusive(
      [
        `proposal:${safeProposalId}`,
        `bank-proposal:${safeProposalId}`,
        `month-close-proposal:${safeProposalId}`,
      ],
      async () => {
        const invoiceProposal = this.env.state.proposalsById.get(safeProposalId);
        const bankProposal = this.env.state.bankProposalsById.get(safeProposalId);
        const monthCloseProposal = this.env.state.monthCloseProposalsById.get(safeProposalId);
        const proposal = invoiceProposal ?? bankProposal ?? monthCloseProposal;
        const proposalKind: 'invoice_posting' | 'bank_reconciliation' | 'month_close' =
          invoiceProposal
            ? 'invoice_posting'
            : bankProposal
              ? 'bank_reconciliation'
              : 'month_close';

        if (
          !proposal ||
          proposal.tenantId !== auth.context.tenantId ||
          proposal.legalEntityId !== auth.context.legalEntityId
        ) {
          const denyAuditId = await recordMcpAuditFailClosed(this.env, {
            toolName: '_human_confirmation_challenge',
            correlationId,
            actorUserId: auth.context.userId,
            actorIssuer: auth.context.identity.issuer,
            actorSubject: auth.context.identity.subject,
            tenantId: auth.context.tenantId,
            legalEntityId: auth.context.legalEntityId,
            outcome: 'deny',
            reasonCode: 'proposal_not_found_or_forbidden',
            idempotencyKey: null,
            proposalId: safeProposalId,
            payloadHash: null,
            promptInjectionSuspected: false,
          });
          if (!denyAuditId) {
            return { ok: false, reason: 'audit_unavailable' } as const;
          }
          return { ok: false, reason: 'proposal_not_found_or_forbidden' } as const;
        }

        const nowMs = this.env.clock.now().getTime();
        if (nowMs >= proposal.expiresAtMs) {
          const denyAuditId = await recordMcpAuditFailClosed(this.env, {
            toolName: '_human_confirmation_challenge',
            correlationId,
            actorUserId: auth.context.userId,
            actorIssuer: auth.context.identity.issuer,
            actorSubject: auth.context.identity.subject,
            tenantId: auth.context.tenantId,
            legalEntityId: auth.context.legalEntityId,
            outcome: 'deny',
            reasonCode: 'proposal_expired',
            idempotencyKey: null,
            proposalId: proposal.proposalId,
            payloadHash: proposal.payloadHash,
            promptInjectionSuspected: false,
          });
          if (!denyAuditId) {
            return { ok: false, reason: 'audit_unavailable' } as const;
          }
          return { ok: false, reason: 'proposal_expired' } as const;
        }

        if (proposal.status !== 'pending_human_approval') {
          const denyAuditId = await recordMcpAuditFailClosed(this.env, {
            toolName: '_human_confirmation_challenge',
            correlationId,
            actorUserId: auth.context.userId,
            actorIssuer: auth.context.identity.issuer,
            actorSubject: auth.context.identity.subject,
            tenantId: auth.context.tenantId,
            legalEntityId: auth.context.legalEntityId,
            outcome: 'deny',
            reasonCode: 'proposal_already_processed',
            idempotencyKey: null,
            proposalId: proposal.proposalId,
            payloadHash: proposal.payloadHash,
            promptInjectionSuspected: false,
          });
          if (!denyAuditId) {
            return { ok: false, reason: 'audit_unavailable' } as const;
          }
          return { ok: false, reason: 'proposal_already_processed' } as const;
        }

        const allowAuditId = await recordMcpAuditFailClosed(this.env, {
          toolName: '_human_confirmation_challenge',
          correlationId,
          actorUserId: auth.context.userId,
          actorIssuer: auth.context.identity.issuer,
          actorSubject: auth.context.identity.subject,
          tenantId: proposal.tenantId,
          legalEntityId: proposal.legalEntityId,
          outcome: 'allow',
          reasonCode: 'human_confirmation_challenge_issued',
          idempotencyKey: null,
          proposalId: proposal.proposalId,
          payloadHash: proposal.payloadHash,
          promptInjectionSuspected: false,
        });

        if (!allowAuditId) {
          return { ok: false, reason: 'audit_unavailable' } as const;
        }

        const confirmationCode = `pap_hconf_${randomBytes(24).toString('base64url')}`;
        const expiresAtMs = nowMs + this.env.humanConfirmationTtlMs;

        this.env.state.humanChallengesByProposal.set(proposal.proposalId, {
          challengeId: randomUUID(),
          proposalKind,
          proposalId: proposal.proposalId,
          tenantId: proposal.tenantId,
          legalEntityId: proposal.legalEntityId,
          authorizedHumanUserId: auth.context.userId,
          expectedPayloadHash: proposal.payloadHash,
          codeSha256Hex: sha256Hex(confirmationCode),
          expiresAtMs,
          consumingInFlight: false,
          consumedAtIso: null,
        });

        return {
          ok: true,
          confirmationCode,
          payloadHash: proposal.payloadHash,
          expiresAt: new Date(expiresAtMs).toISOString(),
          auditEventId: allowAuditId,
        } as const;
      },
    );
  }

  getStoredProposalSnapshot(proposalId: string): Readonly<StoredPreparedProposal> | undefined {
    const found = this.env.state.proposalsById.get(proposalId.toLowerCase());
    if (!found) {
      return undefined;
    }
    const enrichedLines = found.invoice.lines?.map((l) => ({
      ...l,
      netGrosze: Number(parsePlnToGrosze(l.netAmountPln)),
      vatGrosze: Number(parsePlnToGrosze(l.vatAmountPln)),
      grossGrosze: Number(parsePlnToGrosze(l.grossAmountPln)),
    }));
    return Object.freeze({
      ...found,
      invoice: Object.freeze({
        ...found.invoice,
        ...(enrichedLines ? { lines: enrichedLines } : {}),
      }),
      proposedPosting: Object.freeze({
        ...found.proposedPosting,
        appliedRule: Object.freeze({ ...found.proposedPosting.appliedRule }),
      }),
    });
  }

  syncProposalFromWorkspace(proposal: StoredPreparedProposal): void {
    const key = proposal.proposalId.toLowerCase();
    const enrichedLines = proposal.invoice.lines?.map((l) => ({
      ...l,
      netGrosze: Number(parsePlnToGrosze(l.netAmountPln)),
      vatGrosze: Number(parsePlnToGrosze(l.vatAmountPln)),
      grossGrosze: Number(parsePlnToGrosze(l.grossAmountPln)),
    }));
    this.env.state.proposalsById.set(key, {
      ...proposal,
      proposalId: key,
      invoice: {
        ...proposal.invoice,
        ...(enrichedLines ? { lines: enrichedLines } : {}),
      },
      proposedPosting: {
        ...proposal.proposedPosting,
        appliedRule: { ...proposal.proposedPosting.appliedRule },
      },
    });
  }

  getHumanChallengeSnapshot(proposalId: string):
    | {
        readonly proposalId: string;
        readonly tenantId: TenantId;
        readonly legalEntityId: LegalEntityId;
        readonly authorizedHumanUserId: UserId;
        readonly expectedPayloadHash: string;
        readonly codeSha256Hex: string;
        readonly expiresAtMs: number;
        readonly consumedAtIso: string | null;
      }
    | undefined {
    const ch = this.env.state.humanChallengesByProposal.get(proposalId.toLowerCase());
    if (!ch) {
      return undefined;
    }
    return Object.freeze({
      proposalId: ch.proposalId,
      tenantId: ch.tenantId,
      legalEntityId: ch.legalEntityId,
      authorizedHumanUserId: ch.authorizedHumanUserId,
      expectedPayloadHash: ch.expectedPayloadHash,
      codeSha256Hex: ch.codeSha256Hex,
      expiresAtMs: ch.expiresAtMs,
      consumedAtIso: ch.consumedAtIso,
    });
  }

  syncHumanChallengeFromWorkspace(challenge: {
    readonly proposalId: string;
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly authorizedHumanUserId: UserId;
    readonly expectedPayloadHash: string;
    readonly codeSha256Hex: string;
    readonly expiresAtMs: number;
    readonly consumedAtIso: string | null;
  }): void {
    const key = challenge.proposalId.toLowerCase();
    const isBank = this.env.state.bankProposalsById.has(key);
    const isMonthClose = this.env.state.monthCloseProposalsById.has(key);
    this.env.state.humanChallengesByProposal.set(key, {
      challengeId: randomUUID(),
      proposalKind: isBank
        ? 'bank_reconciliation'
        : isMonthClose
          ? 'month_close'
          : 'invoice_posting',
      proposalId: key,
      tenantId: challenge.tenantId,
      legalEntityId: challenge.legalEntityId,
      authorizedHumanUserId: challenge.authorizedHumanUserId,
      expectedPayloadHash: challenge.expectedPayloadHash,
      codeSha256Hex: challenge.codeSha256Hex,
      expiresAtMs: challenge.expiresAtMs,
      consumingInFlight: false,
      consumedAtIso: challenge.consumedAtIso,
    });
  }

  markProposalConfirmedFromWorkspace(params: {
    readonly proposalId: string;
    readonly ledgerEntryId: string;
    readonly confirmedAtIso: string;
    readonly confirmedByUserId: UserId;
  }): void {
    const key = params.proposalId.toLowerCase();
    const existing = this.env.state.proposalsById.get(key);
    if (existing) {
      existing.status = 'confirmed';
      existing.ledgerEntryId = params.ledgerEntryId;
      existing.confirmedAtIso = params.confirmedAtIso;
      existing.confirmedByUserId = params.confirmedByUserId;
    }
    const ch = this.env.state.humanChallengesByProposal.get(key);
    if (ch) {
      ch.consumingInFlight = false;
      ch.consumedAtIso = params.confirmedAtIso;
    }
  }

  markProposalRejectedFromWorkspace(params: { readonly proposalId: string }): void {
    const key = params.proposalId.toLowerCase();
    const existing = this.env.state.proposalsById.get(key);
    if (existing) {
      existing.status = 'rejected';
    }
    const existingBank = this.env.state.bankProposalsById.get(key);
    if (existingBank) {
      existingBank.status = 'rejected';
    }
    const existingMonthClose = this.env.state.monthCloseProposalsById.get(key);
    if (existingMonthClose) {
      existingMonthClose.status = 'rejected';
    }
    this.env.state.humanChallengesByProposal.delete(key);
  }

  tamperStoredProposalPayloadHashForTestOnly(proposalId: string, mutatedHash: string): void {
    const key = proposalId.toLowerCase();
    const existing = this.env.state.proposalsById.get(key);
    if (existing) {
      existing.payloadHash = mutatedHash;
    }
    const existingBank = this.env.state.bankProposalsById.get(key);
    if (existingBank) {
      existingBank.payloadHash = mutatedHash;
    }
    const existingMonthClose = this.env.state.monthCloseProposalsById.get(key);
    if (existingMonthClose) {
      existingMonthClose.payloadHash = mutatedHash;
    }
  }

  // --- Modular Capability Handlers ---

  listMyCompanies(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ListMyCompaniesOutput>> {
    return handleListMyCompanies(this.env, callContext, rawInput);
  }

  getCompanyProfile(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetCompanyProfileOutput>> {
    return handleGetCompanyProfile(this.env, callContext, rawInput);
  }

  listAvailableCapabilities(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ListAvailableCapabilitiesOutput>> {
    return handleListAvailableCapabilities(this.env, callContext, rawInput);
  }

  listUnpaidInvoices(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ListUnpaidInvoicesOutput>> {
    return handleListUnpaidInvoices(this.env, callContext, rawInput);
  }

  previewInvoicePosting(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<PreviewInvoicePostingOutput>> {
    return handlePreviewInvoicePosting(this.env, callContext, rawInput);
  }

  prepareInvoiceAndPostingProposal(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<PrepareInvoiceAndPostingProposalOutput>> {
    return handlePrepareInvoiceAndPostingProposal(this.env, callContext, rawInput);
  }

  confirmPreparedProposal(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ConfirmPreparedProposalOutput>> {
    return handleConfirmPreparedProposal(this.env, callContext, rawInput);
  }

  getMonthlyTaxObligations(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetMonthlyTaxObligationsOutput>> {
    return handleGetMonthlyTaxObligations(this.env, callContext, rawInput);
  }

  explainAccountingItem(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ExplainAccountingItemOutput>> {
    return handleExplainAccountingItem(this.env, callContext, rawInput);
  }

  explainTaxCalculation(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ExplainTaxCalculationOutput>> {
    return handleExplainTaxCalculation(this.env, callContext, rawInput);
  }

  getLegalBasis(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetLegalBasisOutput>> {
    return handleGetLegalBasis(this.env, callContext, rawInput);
  }

  previewJpkExport(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<PreviewJpkExportOutput>> {
    return handlePreviewJpkExport(this.env, callContext, rawInput);
  }

  getMonthCloseChecklist(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetMonthCloseChecklistOutput>> {
    return handleGetMonthCloseChecklist(this.env, callContext, rawInput);
  }

  prepareMonthClose(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<PrepareMonthCloseOutput>> {
    return handlePrepareMonthClose(this.env, callContext, rawInput);
  }

  confirmMonthCloseProposal(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ConfirmMonthCloseOutput>> {
    return handleConfirmMonthCloseProposal(this.env, callContext, rawInput);
  }

  listUnreconciledBankTransactions(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ListUnreconciledBankTransactionsOutput>> {
    return handleListUnreconciledBankTransactions(this.env, callContext, rawInput);
  }

  prepareBankReconciliation(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<PrepareBankReconciliationOutput>> {
    return handlePrepareBankReconciliation(this.env, callContext, rawInput);
  }

  confirmBankReconciliationProposal(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ConfirmBankReconciliationOutput>> {
    return handleConfirmBankReconciliationProposal(this.env, callContext, rawInput);
  }

  getAuditLineage(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetAuditLineageOutput>> {
    return handleGetAuditLineage(this.env, callContext, rawInput);
  }

  listMyCases(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ListMyConsultationCasesOutput>> {
    return handleListMyConsultationCases(this.env, callContext, rawInput);
  }

  getConsultationCase(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<GetConsultationCaseOutput>> {
    return handleGetConsultationCase(this.env, callContext, rawInput);
  }

  createConsultationDraft(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<CreateConsultationDraftOutput>> {
    return handleCreateConsultationDraft(this.env, callContext, rawInput);
  }

  replyToConsultationCase(
    callContext: McpCallContext,
    rawInput: unknown,
  ): Promise<McpGatewayToolResult<ReplyToConsultationCaseOutput>> {
    return handleReplyToConsultationCase(this.env, callContext, rawInput);
  }
}
