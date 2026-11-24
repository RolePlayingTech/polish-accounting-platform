import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ACADEMY_COURSE,
  ACADEMY_DISCLAIMER,
  ACADEMY_FIELD_HELP_ENTRIES,
  ACADEMY_GLOSSARY_TERMS,
  evaluateQuizByLessonSlug,
} from '@pap/domain/academy';
import {
  DoubleEntryValidationError,
  InvalidIdentifierError,
  POLISH_LEGAL_RULES_REGISTRY,
  RYCZALT_RATE_ORDER,
  STANDARD_SPZOO_CHART_OF_ACCOUNTS,
  buildLegalExplanation,
  calculateCitAdvance,
  calculateInvoiceLineFromNet,
  calculateJpkV7mSummary,
  calculateKpirPitAdvance,
  calculateMonthlyRyczalt,
  calculateMonthlyZusContributions,
  createKpirEntry,
  createKpirStornoEntry,
  createRyczaltEntry,
  createValidatedJournalEntry,
  createVatRegisterEntry,
  decideAccessManagementAuthorization,
  decideAccountingAccess,
  evaluateVatExemptionLimit,
  formatPlnFromGrosze,
  generateBalanceSheet,
  generateProfitAndLoss,
  generateTaxCalendarObligations,
  generateTrialBalance,
  getKpirColumnLayout,
  legalEntityId as parseLegalEntityId,
  listActiveRulesAtDate,
  multiplyGroszeByBps,
  parseMt940Statement,
  parsePlnToGrosze,
  parsePolishBankCsv,
  qualifyKpirExpense,
  reconcileBankTransactions,
  resolveRuleAtDate,
  summarizeKpirPeriod,
  tenantId as parseTenantId,
  userId as parseUserId,
  validatePolishNip,
  validateVerifiedPaymentRecord,
  type AccountNature,
  type BankStatementTransaction,
  type CompanyAccessGrant,
  type JpkV7mDeclarationSummary,
  type JournalEntry,
  type KpirColumnsTotals,
  type KpirEntry,
  type KpirExpenseQualificationKind,
  type LegalEntityId,
  type LegalExplanation,
  type LegalRule,
  type MonthlyZusContributionsResult,
  type OpenInvoiceSettlementItem,
  type RyczaltEntry,
  type RyczaltRateCode,
  type TaxProfileCode,
  type TenantId,
  type TenantMembership,
  type TenantRole,
  type UserId,
  type VatDeductionMode,
  type VatRateCode,
  type VatRegisterEntry,
  type VerifiedTaxOrZusPayment,
} from '@pap/domain';
import {
  AccessMutationResponseSchema,
  ApproveAndPostDocumentRequestSchema,
  CalendarViewResponseSchema,
  CloseAccountingPeriodRequestSchema,
  CompanyAccessResponseSchema,
  CompanyAuditListResponseSchema,
  CompanyDocumentItemSchema,
  CompanyOverviewResponseSchema,
  CompanySettingsResponseSchema,
  ConfigureVatPeriodSettlementRequestSchema,
  ConfirmMcpProposalRequestSchema,
  ConfirmMcpProposalResponseSchema,
  CreateCompanyRequestSchema,
  CreateCompanyResponseSchema,
  CreateDocumentRequestSchema,
  CreateJournalEntryRequestSchema,
  CreateKpirEntryRequestSchema,
  CreateRyczaltEntryRequestSchema,
  DispatchDueNotificationsRequestSchema,
  DispatchDueNotificationsResponseSchema,
  DocumentsListResponseSchema,
  ExplainLegalRuleRequestSchema,
  ExplainLegalRuleResponseSchema,
  FinanceViewResponseSchema,
  GetAcademyCourseResponseSchema,
  GetLegalRuleDetailResponseSchema,
  GetMyCompaniesResponseSchema,
  GradeAcademyLessonRequestSchema,
  GradeAcademyLessonResponseSchema,
  GrantCompanyAccessRequestSchema,
  ImportBankStatementRequestSchema,
  ImportBankStatementResponseSchema,
  IssueMcpChallengeResponseSchema,
  KpirViewResponseSchema,
  LedgerViewResponseSchema,
  ListLegalRulesResponseSchema,
  ListSandboxPersonasResponseSchema,
  McpProposalsListResponseSchema,
  NotificationsViewResponseSchema,
  PeriodCloseStatusResponseSchema,
  PeriodTaxObligationsResponseSchema,
  ReconcileBankRequestSchema,
  RecordVerifiedTaxPaymentRequestSchema,
  RejectMcpProposalRequestSchema,
  RejectMcpProposalResponseSchema,
  RevokeCompanyAccessRequestSchema,
  RyczaltViewResponseSchema,
  SandboxMailboxMessageSchema,
  UpdateCompanySettingsRequestSchema,
  UpdateNotificationPreferencesRequestSchema,
  UpdateObligationStatusRequestSchema,
  VatViewResponseSchema,
  type AccessibleCompanyItem,
  type AccessMutationResponse,
  type ApproveAndPostDocumentRequest,
  type CalendarObligationItemContract,
  type CalendarViewResponse,
  type CloseAccountingPeriodRequest,
  type CompanyAccessResponse,
  type CompanyAddressContract,
  type CompanyAuditItemContract,
  type CompanyAuditListResponse,
  type CompanyDocumentItemContract,
  type CompanyLegalFormContract,
  type CompanyOverviewResponse,
  type CompanySettingsResponse,
  type CompanyTaxRegimeContract,
  type CompanyVatStatusSimpleContract,
  type ConfigureVatPeriodSettlementRequest,
  type ConfirmMcpProposalRequest,
  type ConfirmMcpProposalResponse,
  type CreateCompanyRequest,
  type CreateCompanyResponse,
  type CreateDocumentRequest,
  type CreateJournalEntryRequest,
  type CreateKpirEntryRequest,
  type CreateRyczaltEntryRequest,
  type DispatchDueNotificationsRequest,
  type DispatchDueNotificationsResponse,
  type DocumentAiProposalContract,
  type DocumentPostingResultContract,
  type DocumentSourceFormatContract,
  type DocumentStatusContract,
  type DocumentVerificationSourceContract,
  type DocumentsListResponse,
  type ExplainLegalRuleRequest,
  type ExplainLegalRuleResponse,
  type FinanceViewResponse,
  type GetAcademyCourseResponse,
  type GetLegalRuleDetailResponse,
  type GetMyCompaniesResponse,
  type GradeAcademyLessonRequest,
  type GradeAcademyLessonResponse,
  type GrantCompanyAccessRequest,
  type GtuReviewStatusContract,
  type ImportBankStatementRequest,
  type ImportBankStatementResponse,
  type IssueMcpChallengeResponse,
  type KasWhiteListVerificationStatusContract,
  type KpirViewResponse,
  type LedgerViewResponse,
  type ListLegalRulesResponse,
  type ListSandboxPersonasResponse,
  type McpProposalListItemContract,
  type McpProposalsListResponse,
  type NotificationsViewResponse,
  type PeriodCloseStatusResponse,
  type PeriodTaxObligationsResponse,
  type ReconcileBankRequest,
  type RecordVerifiedTaxPaymentRequest,
  type RejectMcpProposalRequest,
  type RejectMcpProposalResponse,
  type RevokeCompanyAccessRequest,
  type RyczaltViewResponse,
  type SandboxMailboxMessageContract,
  type SettlementItemContract,
  type UpdateCompanySettingsRequest,
  type UpdateNotificationPreferencesRequest,
  type UpdateObligationStatusRequest,
  type VatViewResponse,
} from '@pap/contracts/api';
import {
  JournalEntrySchema,
  KpirEntrySchema,
  RyczaltEntrySchema,
  type AccountingDocumentContract,
  type BankReconciliationMatchContract,
  type CitPreferentialAttestationContract,
  type DocumentLineItemContract,
  type JournalEntryContract,
  type KpirEntryContract,
  type KsefInvoiceMarkerContract,
  type RyczaltEntryContract,
  type TaxProfileConfigContract,
} from '@pap/contracts/accounting';
import {
  KsefReferenceNumberSchema,
  PrepareInvoiceAndPostingProposalInputSchema,
  type AccountingCalculationStep,
  type ConfirmPreparedProposalOutput,
  type LegalBasisReference,
  type MonthlyTaxObligation,
  type PrepareInvoiceAndPostingProposalInput,
  type PrepareInvoiceAndPostingProposalOutput,
  type ProposedAccountingPreview,
  type ProposedPostingCategory,
} from '@pap/contracts/mcp-tools';
import {
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  type NotificationObligationInput,
  type NotificationOutboxEntry,
  type NotificationPreferences,
  type OutboxMessageStatus,
  type ReminderStage,
  type RenderedAuxiliaryEmail,
} from '@pap/contracts/notifications';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  COMPANY_TENANT_2_ID,
  DEMO_COMPANIES_SEED,
  DEMO_DEFAULT_PERIOD,
  DEMO_EVALUATION_DATE,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_INPUT,
  DEMO_INITIAL_GRANTS_SEED,
  DEMO_PERSONAS_SEED,
  DEMO_USER_JAN_ID,
  DEMO_USER_PIOTR_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  TENANT_2_ID,
  buildSandboxPersonasManifest,
  resolveDemoPersonaSeed,
} from './demo-seed.js';
import {
  parseSafeDocumentCsv as parseStrictDocumentCsv,
  parseSafeDocumentJson as parseStrictDocumentJson,
  parseSafeKsefXml as parseStrictKsefXml,
  type ParsedDocumentImportResult,
} from './document-import-parsers.js';
import {
  PapMcpGateway,
  VERIFIED_POLISH_LEGAL_BASIS_CATALOG,
  computeCanonicalMcpInvoicePayloadHash,
  computeProposedAccountingPreview,
  sanitizeUntrustedDocumentTextForMcp,
  type AccountingItemExplanationRecord,
  type CompanyDirectoryRecord,
  type CompanyTaxProfile,
  type LegalBasisCatalogEntry,
  type McpAuditEvent,
  type McpAuditSink,
  type McpCallContext,
  type McpGatewayToolResult,
  type MonthCloseRawData,
  type PapMcpDataSource,
  type UnpaidInvoiceRecord,
} from './mcp-gateway.js';
import {
  ControlledSandboxMailboxTransport as BaseControlledSandboxMailboxTransport,
  NotificationsEngine,
  maskEmailForAudit,
  renderAuxiliaryReminderEmail,
  type ControlledSandboxMailboxTransportOptions,
  type EmailTransportDeliveryResult,
  type NotificationsAuditEvent,
  type NotificationsAuditSink,
  type StoredSandboxEmailMessage,
} from './notifications-engine.js';
import type {
  OidcAccessTokenVerifier,
  UserIdentityResolver,
  VerifiedOidcIdentity,
} from './oidc-authentication.js';
import type { SecurityAuditEvent, SecurityAuditRecorder } from './security-audit.js';
import type {
  ExternalCompanyAuditRecord,
  UnreconciledBankTransactionRecord,
  VatPeriodPreviewSnapshot,
} from './mcp/types.js';
import {
  AccountingWorkspaceAccessError,
  AccountingWorkspaceConflictError,
  AccountingWorkspaceError,
  AccountingWorkspaceValidationError,
  assertAccountingRegimeSupportsAction,
  assertApproveOverridesMatchRegime,
  assertPeriodOpenForWrite,
  assertTaxProfileMutationAllowed,
  assertValidPeriodMonth,
  computeCompanyPeriodTaxObligations,
  computeUnreconciledBankTransactionsForPeriod,
  evaluatePeriodCloseStatus,
  listClosedPeriods,
  syncSpzooBankReconciliationJournalEntries,
  transitionPeriodCloseState,
  type PeriodCloseState,
} from './accounting/index.js';
import {
  systemClock,
  type Clock,
  type TenantAuthorizationDataSource,
  type TenantAuthorizationFacts,
  type TenantAuthorizationQuery,
} from './tenant-authorization.js';

export {
  AccountingWorkspaceAccessError,
  AccountingWorkspaceConflictError,
  AccountingWorkspaceError,
  AccountingWorkspaceValidationError,
};
export type { PeriodCloseState };

type CompanySettingsHistoryItem = CompanySettingsResponse['history'][number];
type RegimeComparisonSummary = NonNullable<
  CompanyOverviewResponse['taxSummary']['regimeComparison']
>;

function toContractExplanation(
  exp: LegalExplanation,
): DocumentPostingResultContract['explanation'] {
  return {
    calculationType: exp.calculationType,
    summary: exp.summary,
    eventDate: exp.eventDate,
    appliedRules: exp.appliedRules.map((r) => ({ ...r })),
    steps: exp.steps.map((s) => ({ ...s, inputs: { ...s.inputs } })),
    inputs: { ...exp.inputs },
    outputs: { ...exp.outputs },
    warnings: exp.warnings.map((w) => ({ ...w })),
    requiresHumanApproval: exp.requiresHumanApproval,
  };
}

export const SANDBOX_ALLOWED_EMAIL_DOMAINS = [
  '*.example',
  '*.invalid',
  '*.test',
  '*.localhost',
] as const;

export const DEFAULT_SANDBOX_SENDER_EMAIL = 'powiadomienia@platforma-rachunkowa.example' as const;

export class SandboxRecipientBlockedError extends AccountingWorkspaceError {
  declare readonly statusCode: 403;

  constructor(recipientMasked: string, message?: string) {
    super(
      403,
      'blocked_recipient_policy',
      message ??
        `Adres odbiorcy (${recipientMasked}) spoza dozwolonych domen testowych (.example, .invalid, .test, .localhost) został zablokowany (fail-closed).`,
    );
    this.name = 'SandboxRecipientBlockedError';
  }
}

export interface WorkspaceActorContext {
  readonly userId: string;
  readonly issuer?: string | undefined;
  readonly subject?: string | undefined;
  readonly displayName?: string | undefined;
  readonly email?: string | undefined;
  readonly scopes?: readonly string[] | undefined;
  readonly rawBearerToken?: string | undefined;
  readonly requestId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

export type AuditLogEntry = CompanyAuditItemContract & {
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly actorUserId: string | null;
};

export interface WorkspaceUserRecord {
  readonly userId: UserId;
  readonly issuer?: string | undefined;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly active: boolean;
}

export interface VatPeriodSettlementState {
  readonly period: string;
  readonly version: number;
  readonly status: 'draft' | 'finalized';
  readonly refundRequestedP54Grosze: number;
  readonly carryOverFromPreviousP39Grosze: number;
  readonly carryForwardP62Grosze: number;
  readonly taxDueP51Grosze: number;
  readonly updatedAt: string;
  readonly updatedByUserId: string;
  readonly correctionReason: string | null;
}

export interface WorkspaceCompanyState {
  tenantId: TenantId;
  legalEntityId: LegalEntityId;
  displayName: string;
  nip: string;
  legalForm: CompanyLegalFormContract;
  taxRegime: CompanyTaxRegimeContract;
  vatStatusSimple: CompanyVatStatusSimpleContract;
  taxProfile: TaxProfileConfigContract;
  address?: CompanyAddressContract | undefined;
  settingsHistory: CompanySettingsHistoryItem[];
  documents: CompanyDocumentItemContract[];
  kpirEntries: KpirEntry[];
  ryczaltEntries: RyczaltEntry[];
  vatEntries: VatRegisterEntry[];
  journalEntries: JournalEntry[];
  settlements: SettlementItemContract[];
  bankTransactions: BankStatementTransaction[];
  reconciliationMatches: BankReconciliationMatchContract[];
  paidObligationsByKey: Map<string, string>;
  explanationsById: Map<string, AccountingItemExplanationRecord>;
  vatPeriodSettlements?: Map<string, VatPeriodSettlementState> | undefined;
  periodCloseStates?: Map<string, PeriodCloseState> | undefined;
  verifiedTaxPayments?: VerifiedTaxOrZusPayment[] | undefined;
}

export interface WorkspaceStoredMcpProposal {
  proposalId: string;
  tenantId: TenantId;
  legalEntityId: LegalEntityId;
  createdByUserId: UserId;
  idempotencyKey: string;
  payloadHash: string;
  createdAtIso: string;
  expiresAtMs: number;
  expiresAtIso: string;
  status: 'pending_human_approval' | 'confirmed' | 'expired' | 'rejected';
  ledgerPosted: boolean;
  ledgerEntryId: string | null;
  confirmedAtIso: string | null;
  confirmedByUserId?: UserId | null | undefined;
  rejectedAtIso: string | null;
  rejectedByUserId: string | null;
  rejectionReason: string | null;
  invoice: PrepareInvoiceAndPostingProposalInput['invoice'];
  proposedPosting: ProposedAccountingPreview;
}

export interface WorkspaceHumanChallenge {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly humanUserId: UserId;
  readonly expectedPayloadHash: string;
  readonly codeSha256Hex: string;
  readonly expiresAtMs: number;
  readonly expiresAtIso: string;
  consumedAtIso: string | null;
}

export interface AccountingWorkspaceStorePort {
  getUserById(userId: UserId): WorkspaceUserRecord | null;
  getUserBySubject(subject: string, issuer?: string): WorkspaceUserRecord | null;
  upsertUser(record: WorkspaceUserRecord): void;
  listUsers(): readonly WorkspaceUserRecord[];
  getMembership(tenantId: TenantId, userId: UserId): TenantMembership | null;
  listTenantMemberships(tenantId: TenantId): readonly TenantMembership[];
  listMembershipsForUser(userId: UserId): readonly TenantMembership[];
  upsertMembership(membership: TenantMembership): void;
  listGrantsForCompany(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): readonly CompanyAccessGrant[];
  listGrantsForUser(userId: UserId): readonly CompanyAccessGrant[];
  upsertGrant(grant: CompanyAccessGrant): void;
  getCompany(tenantId: TenantId, legalEntityId: LegalEntityId): WorkspaceCompanyState | null;
  listCompaniesForTenant(tenantId: TenantId): readonly WorkspaceCompanyState[];
  listAllCompanies(): readonly WorkspaceCompanyState[];
  saveCompany(company: WorkspaceCompanyState): void;
  getMcpProposal(proposalId: string): WorkspaceStoredMcpProposal | null;
  listMcpProposals(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): readonly WorkspaceStoredMcpProposal[];
  upsertMcpProposal(proposal: WorkspaceStoredMcpProposal): void;
  getHumanChallenge(proposalId: string): WorkspaceHumanChallenge | null;
  saveHumanChallenge(challenge: WorkspaceHumanChallenge): void;
  appendAuditEvent(event: AuditLogEntry): void;
  listAuditEvents(filter?: {
    readonly tenantId?: string | undefined;
    readonly legalEntityId?: string | undefined;
  }): readonly AuditLogEntry[];
}

/**
 * Kontrolowany transport pocztowy piaskownicy (RFC 5322 MIME + stopka anty-impersonacyjna),
 * odrzucający fail-closed wszystkie domeny spoza `.example`, `.invalid`, `.test`, `.localhost`.
 */
export interface WorkspaceSandboxMailboxTransportOptions extends Omit<
  ControlledSandboxMailboxTransportOptions,
  'allowlistedDomains'
> {
  readonly allowlistedDomains?: readonly string[] | undefined;
  /**
   * Gdy `true` (domyślnie dla bezpośrednich wywołań `ControlledSandboxMailboxTransport`),
   * próba wysyłki poza `.example`/`.invalid`/`.test`/`.localhost` natychmiast rzuca `SandboxRecipientBlockedError`.
   * Gdy `false` (wewnątrz procesora outbox `NotificationsEngine`), zwraca `{ ok: false, outcome: 'blocked_recipient_policy' }`.
   */
  readonly throwOnBlockedRecipient?: boolean | undefined;
}

export class ControlledSandboxMailboxTransport extends BaseControlledSandboxMailboxTransport {
  private readonly throwOnBlockedRecipient: boolean;

  constructor(options: WorkspaceSandboxMailboxTransportOptions = {}) {
    super({
      ...options,
      allowlistedDomains: options.allowlistedDomains ?? SANDBOX_ALLOWED_EMAIL_DOMAINS,
    });
    this.throwOnBlockedRecipient = options.throwOnBlockedRecipient ?? true;
  }

  override async sendEmail(
    email: RenderedAuxiliaryEmail,
    metadata: {
      readonly outboxId: string;
      readonly deduplicationKey: string;
      readonly tenantId: string;
      readonly legalEntityId: string;
    },
  ): Promise<EmailTransportDeliveryResult> {
    const result = await super.sendEmail(email, metadata);
    if (
      !result.ok &&
      result.outcome === 'blocked_recipient_policy' &&
      this.throwOnBlockedRecipient
    ) {
      throw new SandboxRecipientBlockedError(
        maskEmailForAudit(email.toAddress),
        result.errorMessage,
      );
    }
    return result;
  }
}

export class InMemoryNotificationOutboxStore {
  private readonly engine: NotificationsEngine;

  constructor(engine: NotificationsEngine) {
    this.engine = engine;
  }

  listEntries(filter?: {
    readonly tenantId?: string | undefined;
    readonly legalEntityId?: string | undefined;
    readonly status?: OutboxMessageStatus | undefined;
  }): readonly NotificationOutboxEntry[] {
    return this.engine.listOutboxEntries(filter);
  }
}

export { NotificationsEngine as NotificationEngine, NotificationsEngine };

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeHexEquals(leftHex: string, rightHex: string): boolean {
  if (leftHex.length !== rightHex.length || leftHex.length === 0 || leftHex.length % 2 !== 0) {
    return false;
  }
  if (!/^[0-9a-f]+$/i.test(leftHex) || !/^[0-9a-f]+$/i.test(rightHex)) {
    return false;
  }
  const leftBuf = Buffer.from(leftHex.toLowerCase(), 'hex');
  const rightBuf = Buffer.from(rightHex.toLowerCase(), 'hex');
  if (leftBuf.byteLength !== rightBuf.byteLength) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

const HUMAN_APPROVAL_OIDC_SCOPES = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
  'pap:api:write',
]);

export function deterministicUuidV4(seed: string): string {
  const hex = sha256Hex(seed).slice(0, 32).split('');
  hex[12] = '4';
  const variantNibble = parseInt(hex[16] ?? '8', 16);
  hex[16] = ((variantNibble & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export function maskPolishNip(nip: string): string {
  const digits = nip.replace(/\D/g, '');
  const tail = digits.slice(-4).padStart(4, '0');
  return `******${tail}`;
}

function formatGroszeDecimalPln(grosze: number): string {
  const sign = grosze < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(grosze));
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, '0');
  return `${sign}${whole}.${cents}`;
}

function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

function previousMonthPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period;
  }
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function nextMonthPeriod(period: string): string {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period;
  }
  if (month === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

export function normalizeCanonicalDocNumber(documentNumber: string): string {
  return documentNumber.trim().replace(/\s+/g, '').toUpperCase();
}

export function computeEconomicOperationKey(params: {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly direction: 'sales' | 'purchase';
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly counterpartyNip?: string | null | undefined;
  readonly counterpartyName?: string | undefined;
  readonly companyNip: string;
  readonly isCorrection?: boolean | undefined;
}): string {
  const docNumNorm = normalizeCanonicalDocNumber(params.documentNumber);
  const companyNipNorm = params.companyNip.replace(/\D/g, '');
  const cpNipNorm = params.counterpartyNip ? params.counterpartyNip.replace(/\D/g, '') : '';
  const cpNameNorm = (params.counterpartyName ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  const issuerOrPartyKey =
    params.direction === 'sales'
      ? `issuer:${companyNipNorm}`
      : cpNipNorm.length > 0
        ? `nip:${cpNipNorm}`
        : `name:${cpNameNorm}`;
  const kind = params.isCorrection ? 'corr' : 'orig';
  return `econ-op:v1:${params.tenantId}:${params.legalEntityId}:${params.direction}:${kind}:${issuerOrPartyKey}:${docNumNorm}:${params.issueDate}`;
}

export function computeEconomicSnapshotHash(params: {
  readonly direction: 'sales' | 'purchase';
  readonly isCorrection?: boolean | undefined;
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly counterpartyNip?: string | null | undefined;
  readonly totalNetGrosze: number;
  readonly totalVatGrosze: number;
  readonly totalGrossGrosze: number;
}): string {
  const nipNorm = params.counterpartyNip ? params.counterpartyNip.replace(/\D/g, '') : '';
  return sha256Hex(
    JSON.stringify({
      v: 1,
      direction: params.direction,
      isCorrection: Boolean(params.isCorrection),
      docNum: normalizeCanonicalDocNumber(params.documentNumber),
      issueDate: params.issueDate,
      counterpartyNip: nipNorm,
      totalNetGrosze: params.totalNetGrosze,
      totalVatGrosze: params.totalVatGrosze,
      totalGrossGrosze: params.totalGrossGrosze,
    }),
  );
}

function validateInvoiceLineVatConsistency(params: {
  readonly netGrosze: number;
  readonly vatRate: VatRateCode;
  readonly vatGrosze: number;
  readonly grossGrosze: number;
  readonly lineLabel: string;
}): void {
  if (params.netGrosze + params.vatGrosze !== params.grossGrosze) {
    throw new AccountingWorkspaceValidationError(
      422,
      'invalid_document_amounts',
      `Niezgodność kwot pozycji (${params.lineLabel}): netto (${params.netGrosze} gr) + VAT (${params.vatGrosze} gr) !== brutto (${params.grossGrosze} gr).`,
    );
  }
  if (params.vatRate === '0' || params.vatRate === 'zw' || params.vatRate === 'np') {
    if (params.vatGrosze !== 0) {
      throw new AccountingWorkspaceValidationError(
        422,
        'vat_rate_amount_mismatch',
        `Pozycja (${params.lineLabel}) ma stawkę VAT "${params.vatRate}", lecz niezerową kwotę VAT (${params.vatGrosze} gr).`,
      );
    }
    return;
  }
  const expectedVat = calculateInvoiceLineFromNet(params.netGrosze, params.vatRate).vatGrosze;
  if (Math.abs(params.vatGrosze - expectedVat) > 2) {
    throw new AccountingWorkspaceValidationError(
      422,
      'vat_rate_amount_mismatch',
      `Kwota VAT (${params.vatGrosze} gr) w pozycji (${params.lineLabel}) jest sprzeczna ze stawką ${params.vatRate}% dla kwoty netto ${params.netGrosze} gr (oczekiwano ok. ${expectedVat} gr).`,
    );
  }
}

function computeBankTxSemanticSignature(tx: BankStatementTransaction): string {
  return JSON.stringify({
    bookingDate: tx.bookingDate,
    valueDate: tx.valueDate ?? '',
    direction: tx.direction,
    amountGrosze: tx.amountGrosze,
    counterpartyIban: (tx.counterpartyIban ?? '').replace(/\s+/g, '').toUpperCase(),
    title: tx.title.trim(),
  });
}

export function explainRuleApplication(
  rawInput: ExplainLegalRuleRequest,
): ExplainLegalRuleResponse {
  const input = ExplainLegalRuleRequestSchema.parse(rawInput);
  const asOfDate = input.asOfDate ?? `${DEMO_DEFAULT_PERIOD}-20`;
  const catalogEntry = VERIFIED_POLISH_LEGAL_BASIS_CATALOG[input.ruleCode] ?? null;

  let matchedRule: LegalRule | undefined = POLISH_LEGAL_RULES_REGISTRY.find(
    (r) =>
      r.ruleCode === input.ruleCode &&
      r.validFrom <= asOfDate &&
      (r.validTo === null || asOfDate <= r.validTo),
  );
  if (!matchedRule) {
    matchedRule = POLISH_LEGAL_RULES_REGISTRY.find(
      (r) => r.id === input.ruleCode || r.ruleCode === input.ruleCode,
    );
  }
  if (!matchedRule && catalogEntry) {
    matchedRule = POLISH_LEGAL_RULES_REGISTRY.find(
      (r) =>
        r.id === catalogEntry.legalBasis.ruleId || r.ruleCode === catalogEntry.legalBasis.ruleId,
    );
  }
  if (!matchedRule) {
    matchedRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', asOfDate);
  }

  const amountGrosze = input.amountGrosze ?? 100_000;
  const explanation = buildLegalExplanation({
    calculationType: `rule_explanation:${input.ruleCode}`,
    summary: catalogEntry?.summaryPl ?? `${matchedRule.title} — ${matchedRule.description}`,
    eventDate: asOfDate,
    rules: [matchedRule],
    steps: [
      {
        stepNumber: 1,
        label: `Zastosowanie reguły ${matchedRule.ruleCode} (${matchedRule.legalBasis.article})`,
        formula: `${matchedRule.legalBasis.actTitle} (${matchedRule.legalBasis.journalReference})`,
        inputs: {
          asOfDate,
          amountGrosze,
          ...(input.contextDescriptionPl ? { context: input.contextDescriptionPl } : {}),
        },
        resultFormatted: formatPlnFromGrosze(amountGrosze),
        resultGrosze: amountGrosze,
      },
    ],
    inputs: {
      ruleCode: input.ruleCode,
      asOfDate,
      amountGrosze,
    },
    outputs: {
      verificationStatus: matchedRule.verificationStatus,
      sourceUrl: matchedRule.sourceUrl,
    },
  });

  return ExplainLegalRuleResponseSchema.parse({
    ruleCode: input.ruleCode,
    asOfDate,
    explanation,
  });
}

export function validateSplitPaymentMpp(
  grossGrosze: number,
  annex15Item: boolean,
  eventDate = `${DEMO_DEFAULT_PERIOD}-15`,
): {
  readonly mandatoryMpp: boolean;
  readonly thresholdGrosze: number;
  readonly explanation: LegalExplanation;
} {
  const rule = resolveRuleAtDate('VAT_SPLIT_PAYMENT_MPP_ART_108A', eventDate);
  const thresholdGrosze = 1_500_000;
  const mandatoryMpp = annex15Item && grossGrosze > thresholdGrosze;
  const explanation = buildLegalExplanation({
    calculationType: 'vat_mpp_validation',
    summary: mandatoryMpp
      ? 'Obowiązkowy mechanizm podzielonej płatności (MPP) — faktura przekracza 15 000 zł brutto i obejmuje pozycję z załącznika nr 15.'
      : 'Brak obowiązku MPP (kwota nie przekracza 15 000 zł brutto lub brak towarów/usług z załącznika nr 15).',
    eventDate,
    rules: [rule],
    steps: [
      {
        stepNumber: 1,
        label: 'Weryfikacja progu 15 000 zł brutto oraz załącznika nr 15 (art. 108a ust. 1a VAT)',
        formula: 'grossGrosze > 1_500_000 && annex15Item',
        inputs: { grossGrosze, thresholdGrosze, annex15Item },
        resultFormatted: mandatoryMpp ? 'MPP OBOWIĄZKOWY' : 'MPP dobrowolny',
      },
    ],
    inputs: { grossGrosze, annex15Item },
    outputs: { mandatoryMpp, thresholdGrosze },
  });
  return { mandatoryMpp, thresholdGrosze, explanation };
}

function mapRuleToLegalBasisRef(rule: LegalRule): LegalBasisReference {
  return {
    ruleId: rule.ruleCode,
    ruleVersion: rule.version,
    actTitle: rule.legalBasis.actTitle,
    articleRef: rule.legalBasis.article,
    journalOfLawsRef: rule.legalBasis.journalReference,
    officialUrl: rule.sourceUrl,
    effectiveFrom: rule.validFrom,
    effectiveTo: rule.validTo,
    verificationStatus: rule.verificationStatus === 'verified' ? 'verified' : 'experimental',
  };
}

function mapLedgerNatureToContract(nature: AccountNature): {
  readonly kind:
    | 'asset'
    | 'liability'
    | 'equity'
    | 'asset_liability'
    | 'cost_by_nature'
    | 'revenue'
    | 'financial_result';
  readonly normalBalanceSide: 'Wn' | 'Ma' | 'both';
} {
  switch (nature) {
    case 'asset':
      return { kind: 'asset', normalBalanceSide: 'Wn' };
    case 'contra_asset':
      return { kind: 'asset', normalBalanceSide: 'Ma' };
    case 'liability':
      return { kind: 'liability', normalBalanceSide: 'Ma' };
    case 'equity':
      return { kind: 'equity', normalBalanceSide: 'Ma' };
    case 'expense':
      return { kind: 'cost_by_nature', normalBalanceSide: 'Wn' };
    case 'revenue':
      return { kind: 'revenue', normalBalanceSide: 'Ma' };
    case 'tax_expense':
      return { kind: 'financial_result', normalBalanceSide: 'Wn' };
  }
}

function deriveSettlementStatus(
  grossGrosze: number,
  settledGrosze: number,
  dueDate: string,
  asOfDate: string,
): { readonly status: SettlementItemContract['status']; readonly daysOverdue: number } {
  if (settledGrosze >= grossGrosze) {
    return { status: 'paid', daysOverdue: 0 };
  }
  const [y1, m1, d1] = dueDate.split('-').map(Number);
  const [y2, m2, d2] = asOfDate.split('-').map(Number);
  const dueUtc = Date.UTC(y1 ?? 2026, (m1 ?? 1) - 1, d1 ?? 1);
  const nowUtc = Date.UTC(y2 ?? 2026, (m2 ?? 1) - 1, d2 ?? 1);
  const diffDays = Math.floor((nowUtc - dueUtc) / 86_400_000);
  if (diffDays > 0) {
    return { status: 'overdue', daysOverdue: diffDays };
  }
  if (settledGrosze > 0) {
    return { status: 'partially_paid', daysOverdue: 0 };
  }
  return { status: 'open', daysOverdue: 0 };
}

export class InMemoryAccountingWorkspaceStore implements AccountingWorkspaceStorePort {
  private readonly users = new Map<UserId, WorkspaceUserRecord>();
  private readonly memberships = new Map<string, TenantMembership>();
  private readonly grants = new Map<string, CompanyAccessGrant>();
  private readonly companies = new Map<string, WorkspaceCompanyState>();
  private readonly mcpProposals = new Map<string, WorkspaceStoredMcpProposal>();
  private readonly humanChallenges = new Map<string, WorkspaceHumanChallenge>();
  private readonly auditEvents: AuditLogEntry[] = [];

  private companyKey(tId: TenantId, leId: LegalEntityId): string {
    return `${tId}::${leId}`;
  }

  private membershipKey(tId: TenantId, uId: UserId): string {
    return `${tId}::${uId}`;
  }

  getUserById(uId: UserId): WorkspaceUserRecord | null {
    return this.users.get(uId) ?? null;
  }

  getUserBySubject(subject: string, issuer?: string): WorkspaceUserRecord | null {
    if (issuer !== undefined) {
      let legacyWithoutIssuer: WorkspaceUserRecord | null = null;
      for (const u of this.users.values()) {
        if (u.subject !== subject) {
          continue;
        }
        if (u.issuer === issuer) {
          return u;
        }
        if (u.issuer === undefined && legacyWithoutIssuer === null) {
          legacyWithoutIssuer = u;
        }
      }
      return legacyWithoutIssuer;
    }
    for (const u of this.users.values()) {
      if (u.subject === subject) {
        return u;
      }
    }
    return null;
  }

  upsertUser(record: WorkspaceUserRecord): void {
    this.users.set(record.userId, record);
  }

  listUsers(): readonly WorkspaceUserRecord[] {
    return [...this.users.values()];
  }

  getMembership(tId: TenantId, uId: UserId): TenantMembership | null {
    return this.memberships.get(this.membershipKey(tId, uId)) ?? null;
  }

  listTenantMemberships(tId: TenantId): readonly TenantMembership[] {
    const out: TenantMembership[] = [];
    for (const m of this.memberships.values()) {
      if (m.tenantId === tId) {
        out.push(m);
      }
    }
    return out;
  }

  listMembershipsForUser(uId: UserId): readonly TenantMembership[] {
    const out: TenantMembership[] = [];
    for (const m of this.memberships.values()) {
      if (m.userId === uId) {
        out.push(m);
      }
    }
    return out;
  }

  upsertMembership(membership: TenantMembership): void {
    this.memberships.set(this.membershipKey(membership.tenantId, membership.userId), membership);
  }

  listGrantsForCompany(tId: TenantId, leId: LegalEntityId): readonly CompanyAccessGrant[] {
    const out: CompanyAccessGrant[] = [];
    for (const g of this.grants.values()) {
      if (g.tenantId === tId && g.legalEntityId === leId) {
        out.push(g);
      }
    }
    return out;
  }

  listGrantsForUser(uId: UserId): readonly CompanyAccessGrant[] {
    const out: CompanyAccessGrant[] = [];
    for (const g of this.grants.values()) {
      if (g.userId === uId) {
        out.push(g);
      }
    }
    return out;
  }

  upsertGrant(grant: CompanyAccessGrant): void {
    this.grants.set(grant.grantId, grant);
  }

  getCompany(tId: TenantId, leId: LegalEntityId): WorkspaceCompanyState | null {
    return this.companies.get(this.companyKey(tId, leId)) ?? null;
  }

  listCompaniesForTenant(tId: TenantId): readonly WorkspaceCompanyState[] {
    const out: WorkspaceCompanyState[] = [];
    for (const c of this.companies.values()) {
      if (c.tenantId === tId) {
        out.push(c);
      }
    }
    return out;
  }

  listAllCompanies(): readonly WorkspaceCompanyState[] {
    return [...this.companies.values()];
  }

  saveCompany(company: WorkspaceCompanyState): void {
    this.companies.set(this.companyKey(company.tenantId, company.legalEntityId), company);
  }

  getMcpProposal(proposalId: string): WorkspaceStoredMcpProposal | null {
    return this.mcpProposals.get(proposalId.toLowerCase()) ?? null;
  }

  listMcpProposals(tId: TenantId, leId: LegalEntityId): readonly WorkspaceStoredMcpProposal[] {
    const out: WorkspaceStoredMcpProposal[] = [];
    for (const p of this.mcpProposals.values()) {
      if (p.tenantId === tId && p.legalEntityId === leId) {
        out.push(p);
      }
    }
    return out;
  }

  upsertMcpProposal(proposal: WorkspaceStoredMcpProposal): void {
    this.mcpProposals.set(proposal.proposalId.toLowerCase(), proposal);
  }

  getHumanChallenge(proposalId: string): WorkspaceHumanChallenge | null {
    return this.humanChallenges.get(proposalId.toLowerCase()) ?? null;
  }

  saveHumanChallenge(challenge: WorkspaceHumanChallenge): void {
    this.humanChallenges.set(challenge.proposalId.toLowerCase(), challenge);
  }

  appendAuditEvent(event: AuditLogEntry): void {
    this.auditEvents.unshift(event);
  }

  listAuditEvents(filter?: {
    readonly tenantId?: string | undefined;
    readonly legalEntityId?: string | undefined;
  }): readonly AuditLogEntry[] {
    return this.auditEvents.filter((ev) => {
      if (filter?.tenantId && ev.tenantId !== filter.tenantId) return false;
      if (filter?.legalEntityId && ev.legalEntityId !== filter.legalEntityId) return false;
      return true;
    });
  }
}

export interface PapMcpDomainPort
  extends
    PapMcpDataSource,
    TenantAuthorizationDataSource,
    UserIdentityResolver,
    SecurityAuditRecorder,
    McpAuditSink {
  prepare_invoice_draft(
    actor: WorkspaceActorContext,
    input: PrepareInvoiceAndPostingProposalInput,
  ): Promise<PrepareInvoiceAndPostingProposalOutput>;
  issue_human_confirmation_token(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    proposalId: string,
  ): Promise<IssueMcpChallengeResponse>;
  confirm_prepared_proposal(
    actor: WorkspaceActorContext,
    tenantId: string,
    legalEntityId: string,
    proposalId: string,
    input: ConfirmMcpProposalRequest,
  ): Promise<ConfirmMcpProposalResponse>;
  applyConfirmedMonthClose?(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly period: string;
    readonly confirmedByUserId: UserId;
    readonly note?: string | undefined;
  }): Promise<{ readonly closedAt: string }>;
  createBoundMcpGateway(
    verifier: OidcAccessTokenVerifier,
    options?: {
      readonly proposalTtlMs?: number | undefined;
      readonly humanConfirmationTtlMs?: number | undefined;
    },
  ): PapMcpGateway;
}

export interface AccountingWorkspaceServiceOptions {
  readonly store?: AccountingWorkspaceStorePort | undefined;
  readonly clock?: Clock | undefined;
  readonly seedDemoData?: boolean | undefined;
  readonly sandboxMailboxTransport?: ControlledSandboxMailboxTransport | undefined;
}

export class AccountingWorkspaceService {
  readonly store: AccountingWorkspaceStorePort;
  readonly clock: Clock;
  readonly sandboxMailboxTransport: ControlledSandboxMailboxTransport;
  readonly notificationsEngine: NotificationsEngine;
  readonly notificationOutboxStore: InMemoryNotificationOutboxStore;
  private readonly internalNotificationsTransport: ControlledSandboxMailboxTransport;
  private readonly boundMcpGateways = new Set<PapMcpGateway>();
  private readonly inMemoryIdempotencyReceipts = new Map<
    string,
    { readonly payloadHash: string; readonly response: unknown }
  >();

  private runWithInMemoryIdempotency<T>(
    scopeKey: string,
    idempotencyKey: string | undefined,
    payload: unknown,
    execute: () => T,
  ): T {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      return execute();
    }
    const mapKey = `${scopeKey}::${idempotencyKey.trim()}`;
    const payloadHash = sha256Hex(JSON.stringify(payload ?? null));
    const existing = this.inMemoryIdempotencyReceipts.get(mapKey);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new AccountingWorkspaceConflictError(
          'idempotency_payload_mismatch',
          'Klucz Idempotency-Key został już użyty z innymi parametrami żądania.',
        );
      }
      return structuredClone(existing.response) as T;
    }
    const result = execute();
    this.inMemoryIdempotencyReceipts.set(mapKey, {
      payloadHash,
      response: structuredClone(result),
    });
    return result;
  }

  constructor(options: AccountingWorkspaceServiceOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.store = options.store ?? new InMemoryAccountingWorkspaceStore();

    const notificationsAuditSink: NotificationsAuditSink = {
      record: (event: NotificationsAuditEvent) => {
        this.recordAudit({
          channel: 'notifications',
          action: event.kind,
          actorUserId: event.userId,
          actorDisplayLabel: event.userId
            ? this.resolveDisplayLabel(event.userId)
            : 'System powiadomień',
          tenantId: event.tenantId,
          legalEntityId: event.legalEntityId,
          outcome: event.outcome,
          reasonCode: event.reasonCode,
          summaryPl: `Powiadomienie ${event.kind} (${event.maskedRecipient ?? 'brak odbiorcy'}): ${event.reasonCode}`,
        });
      },
    };

    this.sandboxMailboxTransport =
      options.sandboxMailboxTransport ??
      new ControlledSandboxMailboxTransport({
        allowlistedDomains: SANDBOX_ALLOWED_EMAIL_DOMAINS,
        throwOnBlockedRecipient: true,
        auditSink: notificationsAuditSink,
        clock: this.clock,
      });

    // Procesor outbox używa tego samego zestawu domen, rejestrując odrzucenia w outboxie oraz skrzynce odbiorczej
    this.internalNotificationsTransport = new ControlledSandboxMailboxTransport({
      allowlistedDomains: SANDBOX_ALLOWED_EMAIL_DOMAINS,
      throwOnBlockedRecipient: false,
      auditSink: notificationsAuditSink,
      clock: this.clock,
    });

    this.notificationsEngine = new NotificationsEngine({
      transport: {
        sendEmail: async (email, metadata) => {
          const res = await this.internalNotificationsTransport.sendEmail(email, metadata);
          if (res.ok && this.sandboxMailboxTransport !== this.internalNotificationsTransport) {
            await this.sandboxMailboxTransport.sendEmail(email, metadata);
          }
          return res;
        },
      },
      auditSink: notificationsAuditSink,
      clock: this.clock,
      fromAddress: DEFAULT_SANDBOX_SENDER_EMAIL,
    });
    this.notificationOutboxStore = new InMemoryNotificationOutboxStore(this.notificationsEngine);

    if (options.seedDemoData !== false && this.store.listAllCompanies().length === 0) {
      this.seedDefaultDemoWorkspace();
    }
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  private todayIso(): string {
    return this.nowIso().slice(0, 10);
  }

  private resolveDisplayLabel(userIdRaw: string): string {
    try {
      const u = this.store.getUserById(parseUserId(userIdRaw));
      if (u) {
        return `${u.displayName} (${maskEmailForAudit(u.email)})`;
      }
    } catch {
      // ignore invalid uuid
    }
    return `Użytkownik ${userIdRaw.slice(0, 8)}`;
  }

  private recordAudit(params: {
    readonly channel: CompanyAuditItemContract['channel'];
    readonly action: string;
    readonly actorUserId: string | null;
    readonly actorDisplayLabel: string;
    readonly tenantId: string | null;
    readonly legalEntityId: string | null;
    readonly outcome: CompanyAuditItemContract['outcome'];
    readonly reasonCode: string;
    readonly summaryPl: string;
  }): AuditLogEntry {
    const entry: AuditLogEntry = {
      auditEventId: randomUUID(),
      occurredAt: this.nowIso(),
      channel: params.channel,
      action: params.action,
      actorDisplayLabel: params.actorDisplayLabel,
      outcome: params.outcome,
      reasonCode: params.reasonCode,
      summaryPl: params.summaryPl,
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      actorUserId: params.actorUserId,
    };
    this.store.appendAuditEvent(entry);
    return entry;
  }

  private parseSelectors(
    rawTenantId: string,
    rawLegalEntityId: string,
    rawUserId: string,
  ): {
    readonly tId: TenantId;
    readonly leId: LegalEntityId;
    readonly uId: UserId;
  } {
    try {
      return {
        tId: parseTenantId(rawTenantId),
        leId: parseLegalEntityId(rawLegalEntityId),
        uId: parseUserId(rawUserId),
      };
    } catch (error) {
      if (error instanceof InvalidIdentifierError) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_selector',
          'Nieprawidłowy format identyfikatora UUID tenanta, firmy lub użytkownika.',
        );
      }
      throw error;
    }
  }

  private authorizeCompanyOperation(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    action: 'read' | 'write',
    operationName: string,
  ): {
    readonly tId: TenantId;
    readonly leId: LegalEntityId;
    readonly uId: UserId;
    readonly company: WorkspaceCompanyState;
    readonly membership: TenantMembership;
  } {
    const { tId, leId, uId } = this.parseSelectors(rawTenantId, rawLegalEntityId, actor.userId);
    const userRecord = this.store.getUserById(uId);
    const actorLabel =
      actor.displayName ??
      (userRecord ? `${userRecord.displayName} (${maskEmailForAudit(userRecord.email)})` : uId);

    if (userRecord && !userRecord.active) {
      this.recordAudit({
        channel: 'security',
        action: operationName,
        actorUserId: uId,
        actorDisplayLabel: actorLabel,
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'identity_not_provisioned_or_disabled',
        summaryPl: `Odmowa dostępu (${action}) w operacji ${operationName}: konto użytkownika nieaktywne.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'identity_not_provisioned_or_disabled',
        'Konto użytkownika jest nieaktywne lub pozbawione uprawnień.',
      );
    }

    const now = this.clock.now();
    const membership = this.store.getMembership(tId, uId);
    const grants = this.store.listGrantsForCompany(tId, leId).filter((g) => g.userId === uId);

    const decision = decideAccountingAccess({
      userId: uId,
      tenantId: tId,
      legalEntityId: leId,
      action,
      membership,
      grants,
      now,
    });

    if (!decision.allowed) {
      this.recordAudit({
        channel: 'security',
        action: operationName,
        actorUserId: uId,
        actorDisplayLabel: actorLabel,
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: decision.reason,
        summaryPl: `Odmowa dostępu (${action}) do firmy ${leId} w operacji ${operationName}: ${decision.reason}.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        decision.reason,
        `Brak uprawnienia (${action}) do wybranej firmy (${decision.reason}).`,
      );
    }

    const company = this.store.getCompany(tId, leId);
    if (!company || !membership) {
      this.recordAudit({
        channel: 'security',
        action: operationName,
        actorUserId: uId,
        actorDisplayLabel: actorLabel,
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'company_not_found',
        summaryPl: `Nie znaleziono firmy ${leId} w tenancie ${tId}.`,
      });
      throw new AccountingWorkspaceAccessError(
        404,
        'company_not_found',
        'Wskazana firma nie istnieje w bieżącym tenancie.',
      );
    }

    this.recordAudit({
      channel: action === 'write' ? 'accounting' : 'security',
      action: operationName,
      actorUserId: uId,
      actorDisplayLabel: actorLabel,
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: decision.reason,
      summaryPl: `Autoryzowano operację ${operationName} (${action}) na firmie ${company.displayName}.`,
    });

    return { tId, leId, uId, company, membership };
  }

  resolveActorFromPersona(
    personaIdOrAlias: string,
    issuer = 'http://127.0.0.1:4000',
  ): WorkspaceActorContext {
    const seed = resolveDemoPersonaSeed(personaIdOrAlias);
    if (!seed) {
      throw new AccountingWorkspaceAccessError(
        404,
        'persona_not_found',
        `Nieznana persona piaskownicy: ${personaIdOrAlias}.`,
      );
    }
    return {
      userId: seed.userId,
      issuer,
      subject: seed.subject,
      displayName: seed.displayName,
      email: seed.email,
      scopes: [...seed.defaultScopes],
    };
  }

  listSandboxPersonas(issuer = 'http://127.0.0.1:4000'): ListSandboxPersonasResponse {
    return ListSandboxPersonasResponseSchema.parse({
      issuer,
      personas: buildSandboxPersonasManifest(issuer),
    });
  }

  private toAccessibleCompanyItem(
    company: WorkspaceCompanyState,
    uId: UserId,
    now: Date,
  ): AccessibleCompanyItem | null {
    const membership = this.store.getMembership(company.tenantId, uId);
    if (!membership || membership.status !== 'active') {
      return null;
    }
    const grants = this.store
      .listGrantsForCompany(company.tenantId, company.legalEntityId)
      .filter((g) => g.userId === uId);
    const readDecision = decideAccountingAccess({
      userId: uId,
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      action: 'read',
      membership,
      grants,
      now,
    });
    const writeDecision = decideAccountingAccess({
      userId: uId,
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      action: 'write',
      membership,
      grants,
      now,
    });
    if (!readDecision.allowed && !writeDecision.allowed) {
      return null;
    }
    return {
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      displayName: company.displayName,
      nip: company.nip,
      legalForm: company.legalForm,
      taxRegime: company.taxRegime,
      vatStatus: company.vatStatusSimple,
      zusStage: company.taxProfile.zusScheme,
      role: membership.role,
      canRead: readDecision.allowed,
      canWrite: writeDecision.allowed,
      ...(company.address !== undefined ? { address: company.address } : {}),
      ...(company.taxProfile.street !== undefined ? { street: company.taxProfile.street } : {}),
      ...(company.taxProfile.buildingNumber !== undefined
        ? { buildingNumber: company.taxProfile.buildingNumber }
        : {}),
      ...(company.taxProfile.unitNumber !== undefined
        ? { unitNumber: company.taxProfile.unitNumber }
        : {}),
      ...(company.taxProfile.postalCode !== undefined
        ? { postalCode: company.taxProfile.postalCode }
        : {}),
      ...(company.taxProfile.city !== undefined ? { city: company.taxProfile.city } : {}),
      ...(company.taxProfile.voivodeship !== undefined
        ? { voivodeship: company.taxProfile.voivodeship }
        : {}),
      ...(company.taxProfile.taxOfficeName !== undefined
        ? { taxOfficeName: company.taxProfile.taxOfficeName }
        : {}),
    };
  }

  private assertHumanApprovalActorScopes(
    actor: WorkspaceActorContext,
    tenantIdValue: TenantId | null,
    legalEntityIdValue: LegalEntityId | null,
    action: string,
  ): void {
    const uId = parseUserId(actor.userId);
    if (actor.scopes?.includes('pap:mcp:agent_autonomous')) {
      this.recordAudit({
        channel: 'mcp',
        action,
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tenantIdValue,
        legalEntityId: legalEntityIdValue,
        outcome: 'deny',
        reasonCode: 'agent_self_approval_forbidden',
        summaryPl: `Zablokowano próbę samozatwierdzenia przez autonomicznego agenta MCP (${action}).`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'agent_self_approval_forbidden',
        'Autonomiczny agent MCP nie może samodzielnie wystawiać wyzwań ani zatwierdzać księgowań.',
      );
    }
    if (
      actor.scopes !== undefined &&
      !actor.scopes.some((s) => HUMAN_APPROVAL_OIDC_SCOPES.has(s))
    ) {
      this.recordAudit({
        channel: 'security',
        action,
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tenantIdValue,
        legalEntityId: legalEntityIdValue,
        outcome: 'deny',
        reasonCode: 'insufficient_scope',
        summaryPl: `Odmowa operacji ${action}: token OIDC nie posiada wymaganego zakresu zatwierdzania człowieka.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'insufficient_scope',
        'Operacja zatwierdzania wymaga ludzkiego zakresu OIDC (np. pap:ui:full lub pap:ui:accounting).',
      );
    }
  }

  getMyCompanies(actor: WorkspaceActorContext): GetMyCompaniesResponse {
    const uId = parseUserId(actor.userId);
    const userRecord = this.store.getUserById(uId);
    if (!userRecord || !userRecord.active) {
      this.recordAudit({
        channel: 'security',
        action: 'get_my_companies',
        actorUserId: uId,
        actorDisplayLabel: userRecord?.displayName ?? uId,
        tenantId: null,
        legalEntityId: null,
        outcome: 'deny',
        reasonCode: 'inactive_user_account',
        summaryPl: `Odmowa dostępu do katalogu firm dla nieaktywnego lub nieznanego konta ${uId}.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'inactive_user_account',
        'Konto użytkownika jest nieaktywne lub nie posiada dostępu do platformy.',
      );
    }
    const now = this.clock.now();
    const companies: AccessibleCompanyItem[] = [];
    for (const company of this.store.listAllCompanies()) {
      const item = this.toAccessibleCompanyItem(company, uId, now);
      if (item) {
        companies.push(item);
      }
    }
    return GetMyCompaniesResponseSchema.parse({
      actor: {
        userId: uId,
        issuer: actor.issuer ?? 'http://127.0.0.1:4000',
        subject: actor.subject ?? userRecord.subject,
        displayName: actor.displayName ?? userRecord.displayName,
      },
      companies,
    });
  }

  listTenantCompanies(actor: WorkspaceActorContext, rawTenantId: string): GetMyCompaniesResponse {
    const tId = parseTenantId(rawTenantId);
    const uId = parseUserId(actor.userId);
    const userRecord = this.store.getUserById(uId);
    if (!userRecord || !userRecord.active) {
      this.recordAudit({
        channel: 'security',
        action: 'list_tenant_companies',
        actorUserId: uId,
        actorDisplayLabel: userRecord?.displayName ?? uId,
        tenantId: tId,
        legalEntityId: null,
        outcome: 'deny',
        reasonCode: 'inactive_user_account',
        summaryPl: `Odmowa listowania firm tenanta ${tId}: konto użytkownika nieaktywne.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'inactive_user_account',
        'Konto użytkownika jest nieaktywne.',
      );
    }
    const membership = this.store.getMembership(tId, uId);
    if (!membership || membership.status !== 'active') {
      this.recordAudit({
        channel: 'security',
        action: 'list_tenant_companies',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: null,
        outcome: 'deny',
        reasonCode: 'active_membership_required',
        summaryPl: `Odmowa listowania firm tenanta ${tId}: brak aktywnego członkostwa.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'active_membership_required',
        'Brak aktywnego członkostwa w wybranym tenancie.',
      );
    }
    const now = this.clock.now();
    const companies: AccessibleCompanyItem[] = [];
    for (const company of this.store.listCompaniesForTenant(tId)) {
      const item = this.toAccessibleCompanyItem(company, uId, now);
      if (item) {
        companies.push(item);
      }
    }
    return GetMyCompaniesResponseSchema.parse({
      actor: {
        userId: uId,
        issuer: actor.issuer ?? 'http://127.0.0.1:4000',
        subject: actor.subject ?? userRecord.subject,
        displayName: actor.displayName ?? userRecord.displayName,
      },
      companies,
    });
  }

  createCompany(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawRequest: CreateCompanyRequest,
  ): CreateCompanyResponse {
    const tId = parseTenantId(rawTenantId);
    const uId = parseUserId(actor.userId);
    const actorUser = this.store.getUserById(uId);
    if (!actorUser || !actorUser.active) {
      this.recordAudit({
        channel: 'security',
        action: 'create_company',
        actorUserId: uId,
        actorDisplayLabel: actorUser?.displayName ?? uId,
        tenantId: tId,
        legalEntityId: null,
        outcome: 'deny',
        reasonCode: 'inactive_user_account',
        summaryPl: `Odmowa utworzenia firmy w tenancie ${tId}: konto użytkownika nieaktywne.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'inactive_user_account',
        'Konto użytkownika jest nieaktywne.',
      );
    }
    const membership = this.store.getMembership(tId, uId);
    if (
      !membership ||
      membership.status !== 'active' ||
      (membership.role !== 'tenant_owner' && membership.role !== 'tenant_admin')
    ) {
      this.recordAudit({
        channel: 'access',
        action: 'create_company',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: null,
        outcome: 'deny',
        reasonCode: 'admin_role_required',
        summaryPl: `Odmowa utworzenia firmy w tenancie ${tId}: wymagana rola właściciela lub administratora.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'admin_role_required',
        'Tworzenie nowej firmy wymaga aktywnej roli właściciela lub administratora tenanta.',
      );
    }

    const req = CreateCompanyRequestSchema.parse(rawRequest);
    const nipValidation = validatePolishNip(req.nip);
    if (!nipValidation.valid) {
      throw new AccountingWorkspaceValidationError(
        422,
        'invalid_nip_checksum',
        nipValidation.reason ?? 'Nieprawidłowa suma kontrolna numeru NIP.',
      );
    }

    const normalizedNip = nipValidation.normalizedNip ?? req.nip.replace(/\D/g, '');
    const duplicateCompany = this.store
      .listCompaniesForTenant(tId)
      .find((c) => c.nip.replace(/\D/g, '') === normalizedNip);
    if (duplicateCompany) {
      this.recordAudit({
        channel: 'accounting',
        action: 'create_company_duplicate_nip_rejected',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: duplicateCompany.legalEntityId,
        outcome: 'deny',
        reasonCode: 'duplicate_company_nip',
        summaryPl: `Odrzucono próbę utworzenia duplikatu firmy o NIP ${maskPolishNip(normalizedNip)} w tenancie ${tId}.`,
      });
      throw new AccountingWorkspaceConflictError(
        'duplicate_company_nip',
        `Firma o numerze NIP ${normalizedNip} już istnieje w tej organizacji (${duplicateCompany.displayName}).`,
      );
    }

    const name = (req.displayName ?? req.companyName ?? 'Nowa Firma').trim();
    const profileCode: TaxProfileCode =
      req.profileCode ??
      (req.taxRegime === 'kpir_liniowy'
        ? 'jdg_kpir_liniowy'
        : req.taxRegime === 'ryczalt'
          ? 'jdg_ryczalt'
          : req.taxRegime === 'cit_klasyczny' || req.legalForm === 'sp_z_o_o'
            ? 'spzoo_pelne_ksiegi'
            : 'jdg_kpir_skala');

    const taxRegime: CompanyTaxRegimeContract =
      req.taxRegime ??
      (profileCode === 'jdg_kpir_liniowy'
        ? 'kpir_liniowy'
        : profileCode === 'jdg_ryczalt'
          ? 'ryczalt'
          : profileCode === 'spzoo_pelne_ksiegi'
            ? 'cit_klasyczny'
            : 'kpir_skala');

    const effectiveVatStatus: TaxProfileConfigContract['vatStatus'] =
      req.vatStatus === 'zwolniony'
        ? 'zwolniony_art_113'
        : (req.vatStatus ??
          (req.vatPayer === true
            ? 'czynny'
            : req.vatPayer === false
              ? 'zwolniony_art_113'
              : 'czynny'));
    const vatStatusSimple: CompanyVatStatusSimpleContract =
      effectiveVatStatus === 'czynny' ? 'czynny' : 'zwolniony';
    const effectiveVatSettlementPeriod =
      req.vatSettlementPeriod ??
      req.vatPeriod ??
      (effectiveVatStatus === 'czynny' ? 'monthly' : 'not_applicable');
    const zusScheme =
      req.zusScheme ??
      req.zusStage ??
      (req.legalForm === 'sp_z_o_o' ? 'not_applicable' : 'duzy_zus');

    const structuredAddrObj =
      typeof req.address === 'object' && req.address !== null ? req.address : undefined;
    const streetVal = req.street ?? structuredAddrObj?.street;
    const buildingNoVal = req.buildingNumber ?? structuredAddrObj?.buildingNumber;
    const unitNoVal = req.unitNumber !== undefined ? req.unitNumber : structuredAddrObj?.unitNumber;
    const postalCodeVal = req.postalCode ?? structuredAddrObj?.postalCode;
    const cityVal = req.city ?? structuredAddrObj?.city;
    const voivodeshipVal = req.voivodeship ?? structuredAddrObj?.voivodeship;
    const taxOfficeNameVal = req.taxOfficeName ?? structuredAddrObj?.taxOfficeName;

    const resolvedAddress: CompanyAddressContract | undefined =
      typeof req.address === 'string'
        ? req.address.trim()
        : streetVal && buildingNoVal && postalCodeVal && cityVal
          ? {
              street: streetVal,
              buildingNumber: buildingNoVal,
              ...(unitNoVal !== undefined ? { unitNumber: unitNoVal } : {}),
              postalCode: postalCodeVal,
              city: cityVal,
              countryCode: structuredAddrObj?.countryCode ?? 'PL',
              ...(voivodeshipVal ? { voivodeship: voivodeshipVal } : {}),
              ...(taxOfficeNameVal ? { taxOfficeName: taxOfficeNameVal } : {}),
            }
          : req.address;

    const newLeId = parseLegalEntityId(randomUUID());
    const now = this.clock.now();
    const nowIso = now.toISOString();

    const taxProfile: TaxProfileConfigContract = {
      profileCode,
      supportLevel: 'supported',
      nip: normalizedNip,
      ...(req.regon ? { regon: req.regon } : {}),
      ...(req.krs ? { krs: req.krs } : {}),
      companyName: name,
      activityStartDate: req.activityStartDate ?? '2026-01-01',
      vatStatus: effectiveVatStatus,
      vatSettlementPeriod: effectiveVatSettlementPeriod,
      vatPayer: req.vatPayer ?? effectiveVatStatus === 'czynny',
      vatPeriod: effectiveVatSettlementPeriod,
      zusScheme,
      voluntarySicknessInsurance: req.voluntarySicknessInsurance ?? zusScheme !== 'not_applicable',
      accidentRateBps: 167,
      insuredPersonsCount: req.legalForm === 'sp_z_o_o' ? 2 : 1,
      smallTaxpayer: req.smallTaxpayer ?? true,
      ...(req.ksefEnabled !== undefined ? { ksefEnabled: req.ksefEnabled } : {}),
      ...(req.ryczaltDefaultRate !== undefined
        ? { ryczaltDefaultRate: req.ryczaltDefaultRate }
        : {}),
      ...(req.healthContributionTier !== undefined
        ? { healthContributionTier: req.healthContributionTier }
        : {}),
      ...(streetVal ? { street: streetVal } : {}),
      ...(buildingNoVal ? { buildingNumber: buildingNoVal } : {}),
      ...(unitNoVal !== undefined ? { unitNumber: unitNoVal } : {}),
      ...(postalCodeVal ? { postalCode: postalCodeVal } : {}),
      ...(cityVal ? { city: cityVal } : {}),
      ...(voivodeshipVal ? { voivodeship: voivodeshipVal } : {}),
      ...(taxOfficeNameVal ? { taxOfficeName: taxOfficeNameVal } : {}),
      ksefSales2024Above200M: false,
      ...(req.legalForm === 'sp_z_o_o'
        ? { krsRegisteredBefore2025: false }
        : { ceidgRegisteredBefore2025: false }),
      ...(req.citPreferentialAttestation !== undefined
        ? { citPreferentialAttestation: req.citPreferentialAttestation }
        : {}),
    };

    assertTaxProfileMutationAllowed({
      legalForm: req.legalForm,
      currentProfileCode: profileCode,
      nextProfileCode: profileCode,
      postedDocumentsCount: 0,
      kpirEntriesCount: 0,
      ryczaltEntriesCount: 0,
      journalEntriesCount: 0,
      vatEntriesCount: 0,
    });

    const state: WorkspaceCompanyState = {
      tenantId: tId,
      legalEntityId: newLeId,
      displayName: name,
      nip: normalizedNip,
      legalForm: req.legalForm,
      taxRegime,
      vatStatusSimple,
      taxProfile,
      ...(resolvedAddress !== undefined ? { address: resolvedAddress } : {}),
      settingsHistory: [
        {
          version: 1,
          effectiveFrom: taxProfile.activityStartDate,
          changedAt: nowIso,
          changedByUserId: uId,
          changeSummaryPl: 'Utworzenie profilu podatkowego firmy.',
          taxProfile,
        },
      ],
      documents: [],
      kpirEntries: [],
      ryczaltEntries: [],
      vatEntries: [],
      journalEntries: [],
      settlements: [],
      bankTransactions: [],
      reconciliationMatches: [],
      paidObligationsByKey: new Map(),
      explanationsById: new Map(),
      vatPeriodSettlements: new Map(),
      periodCloseStates: new Map(),
      verifiedTaxPayments: [],
    };

    this.store.saveCompany(state);
    const validFromDate = new Date('2025-01-01T00:00:00.000Z');
    const granteeUserIds = new Set<UserId>([uId]);
    for (const member of this.store.listTenantMemberships(tId)) {
      if (member.status === 'active' && member.role === 'tenant_owner') {
        granteeUserIds.add(member.userId);
      }
    }
    for (const granteeUserId of granteeUserIds) {
      for (const action of ['read', 'write'] as const) {
        this.store.upsertGrant({
          grantId: randomUUID(),
          tenantId: tId,
          legalEntityId: newLeId,
          userId: granteeUserId,
          action,
          validFrom: validFromDate,
          validUntil: null,
          revokedAt: null,
        });
      }
    }

    this.recordAudit({
      channel: 'accounting',
      action: 'create_company',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: newLeId,
      outcome: 'allow',
      reasonCode: 'authorized_tenant_administration',
      summaryPl: `Utworzono firmę ${name} (${maskPolishNip(normalizedNip)}) w profilu ${profileCode}.`,
    });

    const item = this.toAccessibleCompanyItem(state, uId, now)!;
    return CreateCompanyResponseSchema.parse({
      company: item,
      taxProfile,
      ...(resolvedAddress !== undefined ? { address: resolvedAddress } : {}),
    });
  }

  listLegalRules(
    asOfDate = `${DEMO_DEFAULT_PERIOD}-20`,
    profile?: TaxProfileCode,
  ): ListLegalRulesResponse {
    const rules = listActiveRulesAtDate(asOfDate, profile);
    const catalogEntries = Object.values(VERIFIED_POLISH_LEGAL_BASIS_CATALOG).map((entry) => ({
      code: entry.code,
      titlePl: entry.titlePl,
      summaryPl: entry.summaryPl,
      legalBasis: entry.legalBasis,
      exceptionsPl: [...entry.exceptionsPl],
    }));
    return ListLegalRulesResponseSchema.parse({
      asOfDate,
      rules: [...rules],
      catalogEntries,
    });
  }

  getLegalRuleDetail(
    code: string,
    asOfDate = `${DEMO_DEFAULT_PERIOD}-20`,
  ): GetLegalRuleDetailResponse {
    const rule =
      POLISH_LEGAL_RULES_REGISTRY.find(
        (r) =>
          (r.ruleCode === code || r.id === code) &&
          r.validFrom <= asOfDate &&
          (r.validTo === null || asOfDate <= r.validTo),
      ) ??
      POLISH_LEGAL_RULES_REGISTRY.find((r) => r.ruleCode === code || r.id === code) ??
      null;
    const rawCatalog = VERIFIED_POLISH_LEGAL_BASIS_CATALOG[code] ?? null;
    const catalogEntry = rawCatalog
      ? {
          code: rawCatalog.code,
          titlePl: rawCatalog.titlePl,
          summaryPl: rawCatalog.summaryPl,
          legalBasis: rawCatalog.legalBasis,
          exceptionsPl: [...rawCatalog.exceptionsPl],
        }
      : null;

    if (!rule && !catalogEntry) {
      throw new AccountingWorkspaceAccessError(
        404,
        'legal_rule_not_found',
        `Nie znaleziono reguły prawnej o kodzie ${code}.`,
      );
    }

    return GetLegalRuleDetailResponseSchema.parse({
      code,
      asOfDate,
      rule,
      catalogEntry,
      explanationSummaryPl:
        catalogEntry?.summaryPl ??
        `${rule!.title}: ${rule!.description} (${rule!.legalBasis.actTitle}, ${rule!.legalBasis.article}).`,
    });
  }

  explainLegalRule(request: ExplainLegalRuleRequest): ExplainLegalRuleResponse {
    return explainRuleApplication(request);
  }

  getAcademyCourse(): GetAcademyCourseResponse {
    return GetAcademyCourseResponseSchema.parse({
      course: ACADEMY_COURSE,
      glossary: [...ACADEMY_GLOSSARY_TERMS],
      fieldHelp: [...ACADEMY_FIELD_HELP_ENTRIES],
      disclaimer: ACADEMY_DISCLAIMER,
    });
  }

  gradeAcademyLesson(
    lessonSlug: string,
    rawRequest: GradeAcademyLessonRequest,
  ): GradeAcademyLessonResponse {
    const req = GradeAcademyLessonRequestSchema.parse(rawRequest);
    const result = evaluateQuizByLessonSlug({
      lessonSlug,
      answers: req.answers,
      passingThresholdPercent: req.passingThresholdPercent,
    });
    return GradeAcademyLessonResponseSchema.parse(result);
  }

  getCompanySettings(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): CompanySettingsResponse {
    const { company, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_company_settings',
    );
    const item = this.toAccessibleCompanyItem(company, uId, this.clock.now())!;
    return CompanySettingsResponseSchema.parse({
      company: item,
      taxProfile: company.taxProfile,
      history: company.settingsHistory,
    });
  }

  updateCompanySettings(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: UpdateCompanySettingsRequest,
  ): CompanySettingsResponse {
    const { company, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'update_company_settings',
    );
    const req = UpdateCompanySettingsRequestSchema.parse(rawRequest);
    const updatedName = req.displayName ?? req.companyName ?? company.displayName;
    const updatedProfileCode = req.profileCode ?? company.taxProfile.profileCode;

    assertTaxProfileMutationAllowed({
      legalForm: company.legalForm,
      currentProfileCode: company.taxProfile.profileCode,
      nextProfileCode: updatedProfileCode,
      postedDocumentsCount: company.documents.filter((d) => d.status === 'posted').length,
      kpirEntriesCount: company.kpirEntries.length,
      ryczaltEntriesCount: company.ryczaltEntries.length,
      journalEntriesCount: company.journalEntries.length,
      vatEntriesCount: company.vatEntries.length,
    });
    if (
      req.citPreferentialAttestation !== undefined &&
      req.citPreferentialAttestation !== null &&
      updatedProfileCode !== 'spzoo_pelne_ksiegi'
    ) {
      assertAccountingRegimeSupportsAction(updatedProfileCode, 'full_ledger_manual_write');
    }
    const updatedVatStatus: TaxProfileConfigContract['vatStatus'] =
      req.vatStatus === 'zwolniony'
        ? 'zwolniony_art_113'
        : (req.vatStatus ??
          (req.vatPayer === true
            ? 'czynny'
            : req.vatPayer === false
              ? 'zwolniony_art_113'
              : company.taxProfile.vatStatus));
    const updatedVatPeriod =
      req.vatSettlementPeriod ??
      req.vatPeriod ??
      (updatedVatStatus === 'czynny' ? 'monthly' : 'not_applicable');

    const structuredAddrObj =
      typeof req.address === 'object' && req.address !== null ? req.address : undefined;
    const streetVal = req.street ?? structuredAddrObj?.street ?? company.taxProfile.street;
    const buildingNoVal =
      req.buildingNumber ?? structuredAddrObj?.buildingNumber ?? company.taxProfile.buildingNumber;
    const unitNoVal =
      req.unitNumber !== undefined
        ? req.unitNumber
        : structuredAddrObj?.unitNumber !== undefined
          ? structuredAddrObj.unitNumber
          : company.taxProfile.unitNumber;
    const postalCodeVal =
      req.postalCode ?? structuredAddrObj?.postalCode ?? company.taxProfile.postalCode;
    const cityVal = req.city ?? structuredAddrObj?.city ?? company.taxProfile.city;
    const voivodeshipVal =
      req.voivodeship ?? structuredAddrObj?.voivodeship ?? company.taxProfile.voivodeship;
    const taxOfficeNameVal =
      req.taxOfficeName ?? structuredAddrObj?.taxOfficeName ?? company.taxProfile.taxOfficeName;

    if (typeof req.address === 'string') {
      company.address = req.address.trim();
    } else if (streetVal && buildingNoVal && postalCodeVal && cityVal) {
      company.address = {
        street: streetVal,
        buildingNumber: buildingNoVal,
        ...(unitNoVal !== undefined ? { unitNumber: unitNoVal } : {}),
        postalCode: postalCodeVal,
        city: cityVal,
        countryCode: structuredAddrObj?.countryCode ?? 'PL',
        ...(voivodeshipVal ? { voivodeship: voivodeshipVal } : {}),
        ...(taxOfficeNameVal ? { taxOfficeName: taxOfficeNameVal } : {}),
      };
    }

    const { citPreferentialAttestation: prevCitAttestation, ...restPrevProfile } =
      company.taxProfile;
    const nextCitAttestation =
      req.citPreferentialAttestation === null
        ? undefined
        : (req.citPreferentialAttestation ?? prevCitAttestation);

    const updatedProfile: TaxProfileConfigContract = {
      ...restPrevProfile,
      companyName: updatedName,
      profileCode: updatedProfileCode,
      vatStatus: updatedVatStatus,
      vatSettlementPeriod: updatedVatPeriod,
      vatPayer: req.vatPayer ?? updatedVatStatus === 'czynny',
      vatPeriod: updatedVatPeriod,
      zusScheme: req.zusScheme ?? company.taxProfile.zusScheme,
      voluntarySicknessInsurance:
        req.voluntarySicknessInsurance ?? company.taxProfile.voluntarySicknessInsurance,
      accidentRateBps: req.accidentRateBps ?? company.taxProfile.accidentRateBps,
      insuredPersonsCount: req.insuredPersonsCount ?? company.taxProfile.insuredPersonsCount,
      smallTaxpayer: req.smallTaxpayer ?? company.taxProfile.smallTaxpayer,
      ...(req.ksefEnabled !== undefined ? { ksefEnabled: req.ksefEnabled } : {}),
      ...(req.ryczaltDefaultRate !== undefined
        ? { ryczaltDefaultRate: req.ryczaltDefaultRate }
        : {}),
      ...(req.healthContributionTier !== undefined
        ? { healthContributionTier: req.healthContributionTier }
        : {}),
      ...(streetVal !== undefined ? { street: streetVal } : {}),
      ...(buildingNoVal !== undefined ? { buildingNumber: buildingNoVal } : {}),
      ...(unitNoVal !== undefined ? { unitNumber: unitNoVal } : {}),
      ...(postalCodeVal !== undefined ? { postalCode: postalCodeVal } : {}),
      ...(cityVal !== undefined ? { city: cityVal } : {}),
      ...(voivodeshipVal !== undefined ? { voivodeship: voivodeshipVal } : {}),
      ...(taxOfficeNameVal !== undefined ? { taxOfficeName: taxOfficeNameVal } : {}),
      ...(nextCitAttestation !== undefined
        ? { citPreferentialAttestation: nextCitAttestation }
        : {}),
    };

    company.displayName = updatedName;
    company.vatStatusSimple = updatedVatStatus === 'czynny' ? 'czynny' : 'zwolniony';
    company.taxRegime =
      updatedProfileCode === 'jdg_kpir_liniowy'
        ? 'kpir_liniowy'
        : updatedProfileCode === 'jdg_ryczalt'
          ? 'ryczalt'
          : updatedProfileCode === 'spzoo_pelne_ksiegi'
            ? 'cit_klasyczny'
            : 'kpir_skala';
    company.taxProfile = updatedProfile;

    const nextVersion = company.settingsHistory.length + 1;
    company.settingsHistory.unshift({
      version: nextVersion,
      effectiveFrom: req.effectiveFrom ?? `${DEMO_DEFAULT_PERIOD}-01`,
      changedAt: this.nowIso(),
      changedByUserId: uId,
      changeSummaryPl: req.changeSummaryPl ?? 'Aktualizacja ustawień podatkowych i ZUS.',
      taxProfile: updatedProfile,
    });
    this.store.saveCompany(company);

    const item = this.toAccessibleCompanyItem(company, uId, this.clock.now())!;
    return CompanySettingsResponseSchema.parse({
      company: item,
      taxProfile: company.taxProfile,
      history: company.settingsHistory,
    });
  }

  getCompanyAccess(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): CompanyAccessResponse {
    const { tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_company_access',
    );
    const now = this.clock.now();
    const actorMembership = this.store.getMembership(tId, uId);
    const isActorActiveAdmin =
      Boolean(actorMembership) &&
      actorMembership!.status === 'active' &&
      (actorMembership!.role === 'tenant_owner' || actorMembership!.role === 'tenant_admin') &&
      actorMembership!.validFrom.getTime() <= now.getTime() &&
      (actorMembership!.validUntil === null ||
        actorMembership!.validUntil.getTime() > now.getTime());

    const visibleMemberships = this.store
      .listTenantMemberships(tId)
      .filter((m) => isActorActiveAdmin || m.userId === uId);
    const members = visibleMemberships.map((m) => {
      const user = this.store.getUserById(m.userId);
      return {
        userId: m.userId,
        displayName: user?.displayName ?? m.userId,
        maskedEmail: maskEmailForAudit(user?.email ?? 'unknown@example.test'),
        tenantRole: m.role,
        status: m.status,
      };
    });

    const visibleGrants = this.store
      .listGrantsForCompany(tId, leId)
      .filter((g) => isActorActiveAdmin || g.userId === uId);
    const grants = visibleGrants.map((g) => {
      const user = this.store.getUserById(g.userId);
      const isActive =
        g.revokedAt === null &&
        g.validFrom.getTime() <= now.getTime() &&
        (g.validUntil === null || now.getTime() < g.validUntil.getTime());
      return {
        grantId: g.grantId,
        userId: g.userId,
        displayName: user?.displayName ?? g.userId,
        action: g.action,
        validFrom: g.validFrom.toISOString(),
        validUntil: g.validUntil ? g.validUntil.toISOString() : null,
        revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
        active: isActive,
      };
    });

    return CompanyAccessResponseSchema.parse({
      tenantId: tId,
      legalEntityId: leId,
      members,
      grants,
    });
  }

  grantCompanyAccess(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: GrantCompanyAccessRequest,
  ): AccessMutationResponse {
    const req = GrantCompanyAccessRequestSchema.parse(rawRequest);
    const { tId, leId, uId } = this.parseSelectors(rawTenantId, rawLegalEntityId, actor.userId);
    const targetUserId = parseUserId(req.targetUserId);
    const now = this.clock.now();
    const actorMembership = this.store.getMembership(tId, uId);
    const targetMembership = this.store.getMembership(tId, targetUserId);
    const actorGrants = this.store.listGrantsForUser(uId).filter((g) => g.tenantId === tId);

    if (!actorMembership || actorMembership.role !== 'tenant_owner') {
      this.recordAudit({
        channel: 'access',
        action: 'grant_company_access',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'owner_role_required',
        summaryPl: `Odmowa nadania grantu (${req.action}): wyłącznie właściciel (owner) może nadawać granty.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'owner_role_required',
        'Nadawanie i odbieranie uprawnień do firmy jest dozwolone wyłącznie dla właściciela organizacji (owner).',
      );
    }

    const validFrom = req.validFrom ? new Date(req.validFrom) : now;
    const validUntil = req.validUntil ? new Date(req.validUntil) : null;
    const authDecision = decideAccessManagementAuthorization({
      actorUserId: uId,
      targetUserId,
      tenantId: tId,
      commandKind: 'grant',
      actorMembership,
      actorGrants,
      targetMembership,
      grantScope: {
        legalEntityId: leId,
        action: req.action,
        validFrom,
        validUntil,
      },
      now,
    });

    if (!authDecision.allowed) {
      this.recordAudit({
        channel: 'access',
        action: 'grant_company_access',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: authDecision.reason,
        summaryPl: `Odmowa nadania grantu: ${authDecision.reason}.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        authDecision.reason,
        `Operacja nadania uprawnień odrzucona (${authDecision.reason}).`,
      );
    }

    const grantId = req.grantId ?? randomUUID();
    this.store.upsertGrant({
      grantId,
      tenantId: tId,
      legalEntityId: leId,
      userId: targetUserId,
      action: req.action,
      validFrom,
      validUntil,
      revokedAt: null,
    });

    this.recordAudit({
      channel: 'access',
      action: 'grant_company_access',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: authDecision.reason,
      summaryPl: `Nadano grant ${req.action} użytkownikowi ${targetUserId} dla firmy ${leId}.`,
    });

    return AccessMutationResponseSchema.parse({
      ok: true,
      receipt: {
        operationId: req.operationId ?? randomUUID(),
        occurredAt: now.toISOString(),
        changed: true,
        grantId,
      },
    });
  }

  revokeCompanyAccess(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: RevokeCompanyAccessRequest,
  ): AccessMutationResponse {
    const req = RevokeCompanyAccessRequestSchema.parse(rawRequest);
    const { tId, leId, uId } = this.parseSelectors(rawTenantId, rawLegalEntityId, actor.userId);
    const now = this.clock.now();
    const actorMembership = this.store.getMembership(tId, uId);

    if (!actorMembership || actorMembership.role !== 'tenant_owner') {
      this.recordAudit({
        channel: 'access',
        action: 'revoke_company_access',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'owner_role_required',
        summaryPl: 'Odmowa odebrania grantu: wyłącznie właściciel (owner) może cofać granty.',
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'owner_role_required',
        'Cofanie uprawnień do firmy jest dozwolone wyłącznie dla właściciela organizacji (owner).',
      );
    }

    const companyGrants = this.store.listGrantsForCompany(tId, leId);
    const targetGrant = companyGrants.find(
      (g) =>
        g.revokedAt === null &&
        ((req.grantId && g.grantId === req.grantId) ||
          (req.targetUserId && g.userId === req.targetUserId)),
    );

    if (!targetGrant) {
      throw new AccountingWorkspaceAccessError(
        404,
        'grant_unavailable',
        'Nie znaleziono aktywnego grantu do cofnięcia.',
      );
    }

    const targetMembership = this.store.getMembership(tId, targetGrant.userId);
    const actorGrants = this.store.listGrantsForUser(uId).filter((g) => g.tenantId === tId);
    const authDecision = decideAccessManagementAuthorization({
      actorUserId: uId,
      targetUserId: targetGrant.userId,
      tenantId: tId,
      commandKind: 'revoke_grant',
      actorMembership,
      actorGrants,
      targetMembership,
      revokedGrantScope: {
        legalEntityId: targetGrant.legalEntityId,
        action: targetGrant.action,
      },
      now,
    });

    if (!authDecision.allowed) {
      this.recordAudit({
        channel: 'access',
        action: 'revoke_company_access',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: authDecision.reason,
        summaryPl: `Odmowa cofnięcia grantu: ${authDecision.reason}.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        authDecision.reason,
        `Odmowa cofnięcia uprawnień (${authDecision.reason}).`,
      );
    }

    this.store.upsertGrant({
      ...targetGrant,
      revokedAt: now,
    });

    this.recordAudit({
      channel: 'access',
      action: 'revoke_company_access',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: authDecision.reason,
      summaryPl: `Cofnięto grant ${targetGrant.action} (${targetGrant.grantId}) dla firmy ${leId}.`,
    });

    return AccessMutationResponseSchema.parse({
      ok: true,
      receipt: {
        operationId: req.operationId ?? randomUUID(),
        occurredAt: now.toISOString(),
        changed: true,
        grantId: targetGrant.grantId,
      },
    });
  }

  revokeTenantMembership(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawTargetUserId: string,
    rawRequest?: {
      readonly operationId?: string | undefined;
      readonly reason?: string | undefined;
    },
  ): AccessMutationResponse {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let operationId: string;
    if (rawRequest?.operationId !== undefined) {
      const trimmedOpId = rawRequest.operationId.trim();
      if (!UUID_RE.test(trimmedOpId)) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_operation_id',
          'Identyfikator operacji (operationId) musi być poprawnym UUID.',
        );
      }
      operationId = trimmedOpId.toLowerCase();
    } else if (actor.idempotencyKey && UUID_RE.test(actor.idempotencyKey.trim())) {
      operationId = actor.idempotencyKey.trim().toLowerCase();
    } else {
      operationId = randomUUID();
    }

    let tId: TenantId;
    try {
      tId = parseTenantId(rawTenantId);
    } catch {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_tenant_id',
        'Niepoprawny identyfikator organizacji (tenantId).',
      );
    }
    let uId: UserId;
    let targetUserId: UserId;
    try {
      uId = parseUserId(actor.userId);
      targetUserId = parseUserId(rawTargetUserId);
    } catch {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_user_id',
        'Niepoprawny identyfikator użytkownika (userId).',
      );
    }

    const now = this.clock.now();
    const actorMembership = this.store.getMembership(tId, uId);
    const targetMembership = this.store.getMembership(tId, targetUserId);
    if (!targetMembership) {
      throw new AccountingWorkspaceAccessError(
        404,
        'membership_unavailable',
        'Wskazany użytkownik nie posiada członkostwa w tej organizacji.',
      );
    }

    const actorGrants = this.store.listGrantsForUser(uId).filter((g) => g.tenantId === tId);
    const authDecision = decideAccessManagementAuthorization({
      actorUserId: uId,
      targetUserId,
      tenantId: tId,
      commandKind: 'revoke_membership',
      actorMembership,
      actorGrants,
      targetMembership,
      now,
    });

    if (!authDecision.allowed) {
      throw new AccountingWorkspaceAccessError(
        403,
        authDecision.reason,
        `Odmowa cofnięcia członkostwa w organizacji (${authDecision.reason}).`,
      );
    }

    const changed = targetMembership.status !== 'revoked';
    this.store.upsertMembership({
      ...targetMembership,
      status: 'revoked',
    });

    for (const grant of this.store.listGrantsForUser(targetUserId)) {
      if (
        grant.tenantId === tId &&
        (grant.revokedAt === null || grant.revokedAt.getTime() > now.getTime())
      ) {
        this.store.upsertGrant({
          ...grant,
          revokedAt: now,
        });
      }
    }

    return AccessMutationResponseSchema.parse({
      ok: true,
      receipt: {
        operationId,
        occurredAt: now.toISOString(),
        changed,
        grantId: null,
      },
    });
  }

  getAuditLog(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): CompanyAuditListResponse {
    const { tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_audit_log',
    );
    const events = this.store.listAuditEvents({ tenantId: tId, legalEntityId: leId }).map((ev) => ({
      auditEventId: ev.auditEventId,
      occurredAt: ev.occurredAt,
      channel: ev.channel,
      action: ev.action,
      actorDisplayLabel: ev.actorDisplayLabel,
      outcome: ev.outcome,
      reasonCode: ev.reasonCode,
      summaryPl: ev.summaryPl,
    }));
    return CompanyAuditListResponseSchema.parse({ events });
  }

  listDocuments(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period?: string,
  ): DocumentsListResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'list_documents',
    );
    const docs = period
      ? company.documents.filter((d) => d.document.eventDate.startsWith(period))
      : company.documents;
    return DocumentsListResponseSchema.parse({ documents: docs });
  }

  getDocument(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    documentId: string,
  ): CompanyDocumentItemContract {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_document',
    );
    const found = company.documents.find((d) => d.documentId === documentId);
    if (!found) {
      throw new AccountingWorkspaceAccessError(
        404,
        'document_not_found',
        `Nie znaleziono dokumentu ${documentId}.`,
      );
    }
    return CompanyDocumentItemSchema.parse(found);
  }

  private buildDocumentRecordInternal(params: {
    readonly company: WorkspaceCompanyState;
    readonly documentId?: string | undefined;
    readonly sourceFormat: DocumentSourceFormatContract;
    readonly status: DocumentStatusContract;
    readonly sha256Hash: string;
    readonly documentNumber: string;
    readonly direction: 'sales' | 'purchase';
    readonly issueDate: string;
    readonly eventDate: string;
    readonly dueDate: string;
    readonly counterpartyName: string;
    readonly counterpartyNip?: string | undefined;
    readonly counterpartyAddress?: string | undefined;
    readonly counterpartyIban?: string | undefined;
    readonly ksefReferenceNumber?: string | undefined;
    readonly ksefMarker?: KsefInvoiceMarkerContract | undefined;
    readonly suggestedCategory?: ProposedPostingCategory | undefined;
    readonly vatDeductionMode?: VatDeductionMode | undefined;
    readonly ryczaltRate?: RyczaltRateCode | undefined;
    readonly isCorrection?: boolean | undefined;
    readonly correctedDocumentNumber?: string | undefined;
    readonly correctionReason?: string | undefined;
    readonly verificationSource?: DocumentVerificationSourceContract | undefined;
    readonly kasWhiteListStatus?: KasWhiteListVerificationStatusContract | undefined;
    readonly gtuReviewStatus?: GtuReviewStatusContract | undefined;
    readonly confidenceScoreBps?: number | undefined;
    readonly extractedSummaryPl?: string | undefined;
    readonly lines: readonly {
      readonly description: string;
      readonly quantity?: string | undefined;
      readonly unit?: string | undefined;
      readonly netGrosze: number;
      readonly vatRate: VatRateCode;
      readonly vatGrosze?: number | undefined;
      readonly grossGrosze?: number | undefined;
      readonly annex15Item?: boolean | undefined;
    }[];
  }): CompanyDocumentItemContract {
    const docId = params.documentId ?? randomUUID();
    const nowIso = this.nowIso();

    const lineItems: DocumentLineItemContract[] = params.lines.map((line, index) => {
      const calc = calculateInvoiceLineFromNet(line.netGrosze, line.vatRate);
      const vatGrosze = line.vatGrosze ?? calc.vatGrosze;
      const grossGrosze = line.grossGrosze ?? line.netGrosze + vatGrosze;
      validateInvoiceLineVatConsistency({
        netGrosze: line.netGrosze,
        vatRate: line.vatRate,
        vatGrosze,
        grossGrosze,
        lineLabel: line.description || `pozycja #${index + 1}`,
      });
      return {
        lineNumber: index + 1,
        description: line.description,
        quantity: line.quantity ?? '1',
        unit: line.unit ?? 'szt.',
        netGrosze: line.netGrosze,
        vatRate: line.vatRate,
        vatGrosze,
        grossGrosze,
        annex15Item: line.annex15Item ?? false,
      };
    });

    const totalNetGrosze = lineItems.reduce((acc, l) => acc + l.netGrosze, 0);
    const totalVatGrosze = lineItems.reduce((acc, l) => acc + l.vatGrosze, 0);
    const totalGrossGrosze = totalNetGrosze + totalVatGrosze;

    if (
      !params.isCorrection &&
      (totalNetGrosze < 0 ||
        totalVatGrosze < 0 ||
        totalGrossGrosze < 0 ||
        lineItems.some((l) => l.netGrosze < 0 || l.vatGrosze < 0 || l.grossGrosze < 0))
    ) {
      throw new AccountingWorkspaceValidationError(
        422,
        'negative_amount_requires_correction',
        'Ujemne kwoty netto, VAT lub brutto są dozwolone wyłącznie dla faktur korygujących (isCorrection = true).',
      );
    }

    const defaultCategory: ProposedPostingCategory =
      params.direction === 'sales'
        ? 'przychod_sprzedaz'
        : (params.suggestedCategory ?? 'uslugi_obce');
    const isCarMixed = defaultCategory === 'eksploatacja_samochodu_mieszana';
    const defaultVatDeduction: VatDeductionMode =
      params.company.taxProfile.vatStatus !== 'czynny'
        ? 'none_0'
        : (params.vatDeductionMode ?? (isCarMixed ? 'vehicle_mixed_50' : 'full_100'));

    const defaultKpirQual: KpirExpenseQualificationKind =
      params.direction === 'sales'
        ? 'none'
        : isCarMixed
          ? 'vehicle_mixed_75_col13'
          : defaultCategory === 'towary_i_materialy'
            ? 'goods_and_materials_col10'
            : 'other_expenses_100_col13';

    const untrustedCounterparty = sanitizeUntrustedDocumentTextForMcp(params.counterpartyName, {
      field: 'counterpartyName',
    });
    const combinedDesc = lineItems.map((l) => l.description).join('; ');
    const untrustedDescription = sanitizeUntrustedDocumentTextForMcp(combinedDesc, {
      field: 'description',
    });
    const promptInjectionSuspected =
      untrustedCounterparty.promptInjectionSuspected ||
      untrustedDescription.promptInjectionSuspected;

    const accountingDoc: AccountingDocumentContract = {
      documentId: docId,
      documentNumber: params.documentNumber,
      direction: params.direction,
      issueDate: params.issueDate,
      eventDate: params.eventDate,
      dueDate: params.dueDate,
      counterpartyName: untrustedCounterparty.sanitizedText || params.counterpartyName,
      ...(params.counterpartyNip ? { counterpartyNip: params.counterpartyNip } : {}),
      ...(params.counterpartyAddress ? { counterpartyAddress: params.counterpartyAddress } : {}),
      ...(params.counterpartyIban ? { counterpartyIban: params.counterpartyIban } : {}),
      currency: 'PLN',
      ...(params.ksefReferenceNumber ? { ksefReferenceNumber: params.ksefReferenceNumber } : {}),
      ksefMarker: params.ksefMarker ?? (params.ksefReferenceNumber ? 'NrKSeF' : 'BFK'),
      lines: lineItems,
      totalNetGrosze,
      totalVatGrosze,
      totalGrossGrosze,
      totalGrossFormatted: formatPlnFromGrosze(totalGrossGrosze),
    };

    const resolvedVerificationSource: DocumentVerificationSourceContract =
      params.verificationSource ??
      (params.sourceFormat === 'manual'
        ? 'manual_entry'
        : params.sourceFormat === 'mcp_confirmed'
          ? 'mcp_proposal'
          : 'deterministic_parser');
    const resolvedKasWhiteListStatus: KasWhiteListVerificationStatusContract =
      params.kasWhiteListStatus ?? 'not_checked';
    const resolvedGtuReviewStatus: GtuReviewStatusContract =
      params.gtuReviewStatus ?? 'requires_human_review';

    const aiProposal: DocumentAiProposalContract = {
      status: params.sourceFormat === 'manual' ? 'not_applicable' : 'ai_proposed',
      confidenceScoreBps: params.confidenceScoreBps ?? (promptInjectionSuspected ? 4500 : 9400),
      suggestedCategory: defaultCategory,
      vatDeductionMode: defaultVatDeduction,
      kpirQualification: defaultKpirQual,
      ryczaltRate: params.company.taxRegime === 'ryczalt' ? (params.ryczaltRate ?? '12') : null,
      ledgerAccountCode:
        params.company.taxRegime === 'cit_klasyczny'
          ? params.direction === 'sales'
            ? '700'
            : defaultCategory === 'towary_i_materialy'
              ? '330'
              : '402'
          : null,
      extractedSummaryPl:
        params.extractedSummaryPl ??
        `Deterministyczna propozycja ujęcia dokumentu ${params.documentNumber} (${formatPlnFromGrosze(totalGrossGrosze)}) [źródło: ${resolvedVerificationSource}; wykaz KAS: niezweryfikowano; GTU: wymaga decyzji człowieka] — wymaga zatwierdzenia przez uprawnionego człowieka.`,
      promptInjectionSuspected,
      verificationSource: resolvedVerificationSource,
      kasWhiteListStatus: resolvedKasWhiteListStatus,
      gtuReviewStatus: resolvedGtuReviewStatus,
      untrustedCounterpartyName: untrustedCounterparty,
      untrustedDescription,
    };

    const economicOperationKey = computeEconomicOperationKey({
      tenantId: params.company.tenantId,
      legalEntityId: params.company.legalEntityId,
      direction: params.direction,
      documentNumber: params.documentNumber,
      issueDate: params.issueDate,
      counterpartyNip: params.counterpartyNip,
      counterpartyName: accountingDoc.counterpartyName,
      companyNip: params.company.nip,
      isCorrection: params.isCorrection,
    });
    const economicSnapshotHash = computeEconomicSnapshotHash({
      direction: params.direction,
      isCorrection: params.isCorrection,
      documentNumber: params.documentNumber,
      issueDate: params.issueDate,
      counterpartyNip: params.counterpartyNip,
      totalNetGrosze,
      totalVatGrosze,
      totalGrossGrosze,
    });

    return CompanyDocumentItemSchema.parse({
      documentId: docId,
      tenantId: params.company.tenantId,
      legalEntityId: params.company.legalEntityId,
      status: params.status,
      sourceFormat: params.sourceFormat,
      sha256Hash: params.sha256Hash,
      economicOperationKey,
      economicSnapshotHash,
      createdAt: nowIso,
      updatedAt: nowIso,
      approvedByUserId: null,
      approvedAt: null,
      isCorrection: params.isCorrection ?? false,
      correctedDocumentNumber: params.correctedDocumentNumber ?? null,
      correctionReason: params.correctionReason ?? null,
      document: accountingDoc,
      aiProposal,
      postingResult: null,
    });
  }

  private getDocumentEconomicIdentity(
    company: WorkspaceCompanyState,
    item: CompanyDocumentItemContract,
  ): { readonly economicOperationKey: string; readonly economicSnapshotHash: string } {
    const economicOperationKey =
      item.economicOperationKey ??
      computeEconomicOperationKey({
        tenantId: company.tenantId,
        legalEntityId: company.legalEntityId,
        direction: item.document.direction,
        documentNumber: item.document.documentNumber,
        issueDate: item.document.issueDate,
        counterpartyNip: item.document.counterpartyNip,
        counterpartyName: item.document.counterpartyName,
        companyNip: company.nip,
        isCorrection: item.isCorrection,
      });
    const economicSnapshotHash =
      item.economicSnapshotHash ??
      computeEconomicSnapshotHash({
        direction: item.document.direction,
        isCorrection: item.isCorrection,
        documentNumber: item.document.documentNumber,
        issueDate: item.document.issueDate,
        counterpartyNip: item.document.counterpartyNip,
        totalNetGrosze: item.document.totalNetGrosze,
        totalVatGrosze: item.document.totalVatGrosze,
        totalGrossGrosze: item.document.totalGrossGrosze,
      });
    return { economicOperationKey, economicSnapshotHash };
  }

  private assertNoCanonicalDocumentConflict(params: {
    readonly company: WorkspaceCompanyState;
    readonly candidateKey: string;
    readonly candidateSnapshotHash: string;
    readonly candidateKsefReference?: string | undefined;
    readonly candidateDocNumber: string;
    readonly excludeDocumentId?: string | undefined;
  }): void {
    const ksefRefNorm = params.candidateKsefReference?.trim();
    for (const existing of params.company.documents) {
      if (existing.status === 'archived') {
        continue;
      }
      if (params.excludeDocumentId && existing.documentId === params.excludeDocumentId) {
        continue;
      }
      const existingKsefRef = existing.document.ksefReferenceNumber?.trim();
      const existingIdentity = this.getDocumentEconomicIdentity(params.company, existing);
      const matchesKsef =
        Boolean(ksefRefNorm) && Boolean(existingKsefRef) && ksefRefNorm === existingKsefRef;
      const matchesOpKey = existingIdentity.economicOperationKey === params.candidateKey;
      if (matchesKsef || matchesOpKey) {
        if (existingIdentity.economicSnapshotHash !== params.candidateSnapshotHash) {
          throw new AccountingWorkspaceConflictError(
            'economic_operation_payload_conflict',
            `Operacja gospodarcza dla dokumentu ${params.candidateDocNumber} jest już zarejestrowana z innymi kwotami lub danymi (${existing.document.totalGrossFormatted}, ID: ${existing.documentId}). Utwórz jawną fakturę korygującą zamiast nadpisywania operacji.`,
          );
        }
        throw new AccountingWorkspaceConflictError(
          'duplicate_economic_operation',
          `Dokument ${params.candidateDocNumber} jest już zarejestrowany w tej firmie (status: ${existing.status}, ID: ${existing.documentId}).`,
        );
      }
    }
  }

  private assertNoManualLedgerDuplicateForPosting(params: {
    readonly company: WorkspaceCompanyState;
    readonly direction: 'sales' | 'purchase';
    readonly documentNumber: string;
    readonly counterpartyNip?: string | undefined;
    readonly counterpartyName: string;
    readonly ksefReferenceNumber?: string | undefined;
    readonly isCorrection: boolean;
  }): void {
    if (params.isCorrection) {
      return;
    }
    const docNumNorm = normalizeCanonicalDocNumber(params.documentNumber);
    const cpNipNorm = params.counterpartyNip ? params.counterpartyNip.replace(/\D/g, '') : '';
    const cpNameNorm = params.counterpartyName.trim().replace(/\s+/g, ' ').toUpperCase();
    const ksefNorm = params.ksefReferenceNumber?.trim();

    const matchesCounterparty = (entryNip?: string, entryName?: string): boolean => {
      if (params.direction === 'sales') {
        return true;
      }
      const eNip = entryNip ? entryNip.replace(/\D/g, '') : '';
      if (cpNipNorm && eNip) {
        return cpNipNorm === eNip;
      }
      const eName = (entryName ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
      return cpNameNorm.length > 0 && cpNameNorm === eName;
    };

    const dupKpir = params.company.kpirEntries.find(
      (e) =>
        !e.isCorrection &&
        ((ksefNorm && e.ksefReferenceNumber?.trim() === ksefNorm) ||
          (normalizeCanonicalDocNumber(e.documentNumber) === docNumNorm &&
            matchesCounterparty(e.counterpartyNip, e.counterpartyName))),
    );
    if (dupKpir) {
      throw new AccountingWorkspaceConflictError(
        'duplicate_economic_operation',
        `Ten dokument (${params.documentNumber}) jest już zaksięgowany w KPiR (poz. ${dupKpir.ordinalNumber}). Otwórz istniejący zapis lub utwórz korektę (storno).`,
      );
    }

    if (params.direction === 'sales') {
      const dupRycz = params.company.ryczaltEntries.find(
        (e) =>
          !e.isCorrection &&
          ((ksefNorm && e.ksefReferenceNumber?.trim() === ksefNorm) ||
            normalizeCanonicalDocNumber(e.documentNumber) === docNumNorm),
      );
      if (dupRycz) {
        throw new AccountingWorkspaceConflictError(
          'duplicate_economic_operation',
          `Ten dokument (${params.documentNumber}) jest już zaksięgowany w ewidencji przychodów ryczałtowych (poz. ${dupRycz.ordinalNumber}). Otwórz istniejący zapis lub utwórz korektę.`,
        );
      }
    }

    const dupJournal = params.company.journalEntries.find(
      (je) =>
        !je.lines.some((l) => l.isRedStorno) &&
        normalizeCanonicalDocNumber(je.documentNumber) === docNumNorm &&
        (params.direction === 'sales' ||
          !cpNameNorm ||
          je.description.toUpperCase().includes(cpNameNorm) ||
          params.company.documents.some(
            (d) =>
              d.postingResult?.journalEntryId === je.id &&
              matchesCounterparty(d.document.counterpartyNip, d.document.counterpartyName),
          )),
    );
    if (dupJournal) {
      throw new AccountingWorkspaceConflictError(
        'duplicate_economic_operation',
        `Ten dokument (${params.documentNumber}) jest już zaksięgowany w dzienniku księgowym (${dupJournal.entryNumber}). Otwórz istniejący dekret lub zaksięguj storno czerwone.`,
      );
    }
  }

  createDocument(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: CreateDocumentRequest,
  ): CompanyDocumentItemContract {
    const { company, uId, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'create_document',
    );
    const req = CreateDocumentRequestSchema.parse(rawRequest);
    return this.runWithInMemoryIdempotency(
      `createDocument:${tId}:${leId}:${uId}`,
      actor.idempotencyKey,
      req,
      () => this.executeCreateDocumentInternal(company, uId, tId, leId, req),
    );
  }

  private executeCreateDocumentInternal(
    company: WorkspaceCompanyState,
    uId: UserId,
    tId: TenantId,
    leId: LegalEntityId,
    req: CreateDocumentRequest,
  ): CompanyDocumentItemContract {
    let sha256HashValue: string;
    let record: CompanyDocumentItemContract;

    if (
      'rawPayload' in req &&
      typeof req.rawPayload === 'string' &&
      req.rawPayload.trim().length > 0
    ) {
      const payloadSha = sha256Hex(req.rawPayload.trim());
      sha256HashValue = 'sha256' in req && typeof req.sha256 === 'string' ? req.sha256 : payloadSha;
      if (
        company.documents.some(
          (d) =>
            (d.sha256Hash === sha256HashValue || d.sha256Hash === payloadSha) &&
            d.status !== 'archived',
        )
      ) {
        this.recordAudit({
          channel: 'accounting',
          action: 'create_document_duplicate_rejected',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'deny',
          reasonCode: 'duplicate_document_sha256',
          summaryPl: `Odrzucono duplikat dokumentu (SHA-256: ${sha256HashValue.slice(0, 12)}...).`,
        });
        throw new AccountingWorkspaceConflictError(
          'duplicate_document_sha256',
          `Dokument o identycznym skrócie SHA-256 (${sha256HashValue}) został już zaimportowany w tej firmie.`,
        );
      }

      const trimmedPayload = req.rawPayload.trim();
      const effectiveSourceFormat: 'ksef_xml' | 'csv' | 'json' =
        req.sourceFormat && req.sourceFormat !== 'manual'
          ? req.sourceFormat
          : trimmedPayload.startsWith('<')
            ? 'ksef_xml'
            : trimmedPayload.startsWith('{') || trimmedPayload.startsWith('[')
              ? 'json'
              : 'csv';

      const parsedDraft: ParsedDocumentImportResult =
        effectiveSourceFormat === 'ksef_xml'
          ? parseStrictKsefXml(req.rawPayload, {
              companyNip: company.nip,
              ...(req.direction ? { fallbackDirection: req.direction } : {}),
            })
          : effectiveSourceFormat === 'csv'
            ? parseStrictDocumentCsv(
                req.rawPayload,
                req.direction ? { fallbackDirection: req.direction } : undefined,
              )
            : parseStrictDocumentJson(
                req.rawPayload,
                req.direction ? { fallbackDirection: req.direction } : undefined,
              );

      record = this.buildDocumentRecordInternal({
        company,
        sourceFormat: effectiveSourceFormat,
        status: 'needs_verification',
        sha256Hash: sha256HashValue,
        documentNumber: parsedDraft.documentNumber,
        direction: parsedDraft.direction,
        issueDate: parsedDraft.issueDate,
        eventDate: parsedDraft.saleDate,
        dueDate: parsedDraft.dueDate ?? addDaysIso(parsedDraft.issueDate, 14),
        counterpartyName: parsedDraft.counterpartyName,
        counterpartyNip: parsedDraft.counterpartyNip,
        counterpartyAddress: parsedDraft.counterpartyAddress,
        ksefReferenceNumber: parsedDraft.ksefReferenceNumber,
        ksefMarker: parsedDraft.ksefMarker,
        suggestedCategory: 'suggestedCategory' in req ? req.suggestedCategory : undefined,
        vatDeductionMode: 'vatDeductionMode' in req ? req.vatDeductionMode : undefined,
        ryczaltRate: 'ryczaltRate' in req ? req.ryczaltRate : undefined,
        isCorrection: 'isCorrection' in req ? req.isCorrection : undefined,
        correctedDocumentNumber:
          'correctedDocumentNumber' in req ? req.correctedDocumentNumber : undefined,
        correctionReason: 'correctionReason' in req ? req.correctionReason : undefined,
        verificationSource: 'deterministic_parser',
        kasWhiteListStatus: 'not_checked',
        gtuReviewStatus: 'requires_human_review',
        lines: parsedDraft.lines,
      });
    } else if (
      'sha256' in req &&
      typeof req.sha256 === 'string' &&
      !('rawPayload' in req && req.rawPayload)
    ) {
      const bffReq = req as Extract<
        CreateDocumentRequest,
        { sha256: string; documentNumber: string }
      >;
      sha256HashValue = bffReq.sha256;
      if (
        company.documents.some((d) => d.sha256Hash === sha256HashValue && d.status !== 'archived')
      ) {
        this.recordAudit({
          channel: 'accounting',
          action: 'create_document_duplicate_rejected',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'deny',
          reasonCode: 'duplicate_document_sha256',
          summaryPl: `Odrzucono duplikat dokumentu BFF (SHA-256: ${sha256HashValue.slice(0, 12)}...).`,
        });
        throw new AccountingWorkspaceConflictError(
          'duplicate_document_sha256',
          `Dokument o identycznym skrócie SHA-256 (${sha256HashValue}) już istnieje.`,
        );
      }

      let normalizedBffNip: string | undefined;
      if (bffReq.counterpartyNip !== undefined) {
        const nipCheck = validatePolishNip(bffReq.counterpartyNip);
        if (!nipCheck.valid || !nipCheck.normalizedNip) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_counterparty_nip',
            nipCheck.reason ?? 'Nieprawidłowa suma kontrolna numeru NIP kontrahenta.',
          );
        }
        normalizedBffNip = nipCheck.normalizedNip;
      }

      if (
        bffReq.netGrosze !== undefined &&
        bffReq.vatGrosze !== undefined &&
        bffReq.grossGrosze !== undefined &&
        bffReq.netGrosze + bffReq.vatGrosze !== bffReq.grossGrosze
      ) {
        throw new AccountingWorkspaceValidationError(
          422,
          'invalid_document_amounts',
          `Niezgodność kwot dokumentu ${bffReq.documentNumber}: netto (${bffReq.netGrosze} gr) + VAT (${bffReq.vatGrosze} gr) !== brutto (${bffReq.grossGrosze} gr).`,
        );
      }

      const issueDt = bffReq.issueDate ?? `${DEMO_DEFAULT_PERIOD}-15`;
      const eventDt = bffReq.eventDate ?? issueDt;
      const dueDt = bffReq.dueDate ?? addDaysIso(issueDt, 14);
      if (dueDt < issueDt) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_due_date',
          'Termin płatności (dueDate) nie może być wcześniejszy niż data wystawienia (issueDate).',
        );
      }

      const bffDefaultNet = bffReq.netGrosze ?? 100_00;
      const bffDefaultRate: VatRateCode =
        bffReq.vatRate ??
        (bffReq.vatGrosze === 0 && bffDefaultNet !== 0
          ? company.taxProfile.vatStatus === 'czynny'
            ? '0'
            : 'zw'
          : '23');
      const bffLines =
        bffReq.lines && bffReq.lines.length > 0
          ? bffReq.lines
          : [
              {
                description: bffReq.description ?? `Dokument ${bffReq.documentNumber}`,
                netGrosze: bffDefaultNet,
                vatRate: bffDefaultRate,
                ...(bffReq.vatGrosze !== undefined ? { vatGrosze: bffReq.vatGrosze } : {}),
                ...(bffReq.grossGrosze !== undefined ? { grossGrosze: bffReq.grossGrosze } : {}),
              },
            ];

      record = this.buildDocumentRecordInternal({
        company,
        sourceFormat: bffReq.sourceFormat ?? 'manual',
        status: 'needs_verification',
        sha256Hash: sha256HashValue,
        documentNumber: bffReq.documentNumber,
        direction: bffReq.direction ?? 'purchase',
        issueDate: issueDt,
        eventDate: eventDt,
        dueDate: dueDt,
        counterpartyName: bffReq.counterpartyName ?? 'Kontrahent Testowy',
        counterpartyNip: normalizedBffNip,
        ksefReferenceNumber: bffReq.ksefReferenceNumber,
        ksefMarker: bffReq.ksefMarker,
        suggestedCategory: bffReq.suggestedCategory,
        vatDeductionMode: bffReq.vatDeductionMode,
        ryczaltRate: bffReq.ryczaltRate,
        isCorrection: bffReq.isCorrection,
        correctedDocumentNumber: bffReq.correctedDocumentNumber,
        correctionReason: bffReq.correctionReason,
        lines: bffLines,
      });
    } else {
      const manualReq = req as Extract<
        CreateDocumentRequest,
        { issueDate: string; counterpartyName: string }
      >;
      let normalizedManualNip: string | undefined;
      if (manualReq.counterpartyNip !== undefined) {
        const nipCheck = validatePolishNip(manualReq.counterpartyNip);
        if (!nipCheck.valid || !nipCheck.normalizedNip) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_counterparty_nip',
            nipCheck.reason ?? 'Nieprawidłowa suma kontrolna numeru NIP kontrahenta.',
          );
        }
        normalizedManualNip = nipCheck.normalizedNip;
      }

      for (const line of manualReq.lines) {
        if (
          line.vatGrosze !== undefined &&
          line.grossGrosze !== undefined &&
          line.netGrosze + line.vatGrosze !== line.grossGrosze
        ) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_document_amounts',
            `Niezgodność kwot pozycji (${line.description}): netto + VAT !== brutto.`,
          );
        }
      }

      const canonicalManual = JSON.stringify({
        documentNumber: manualReq.documentNumber,
        direction: manualReq.direction,
        issueDate: manualReq.issueDate,
        counterpartyNip: normalizedManualNip ?? '',
        lines: manualReq.lines,
      });
      sha256HashValue = sha256Hex(canonicalManual);
      if (
        company.documents.some((d) => d.sha256Hash === sha256HashValue && d.status !== 'archived')
      ) {
        this.recordAudit({
          channel: 'accounting',
          action: 'create_document_duplicate_rejected',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'deny',
          reasonCode: 'duplicate_document_sha256',
          summaryPl: `Odrzucono duplikat dokumentu ręcznego (SHA-256: ${sha256HashValue.slice(0, 12)}...).`,
        });
        throw new AccountingWorkspaceConflictError(
          'duplicate_document_sha256',
          `Dokument o identycznym skrócie SHA-256 (${sha256HashValue}) już istnieje.`,
        );
      }

      record = this.buildDocumentRecordInternal({
        company,
        sourceFormat: 'manual',
        status: 'needs_verification',
        sha256Hash: sha256HashValue,
        documentNumber: manualReq.documentNumber,
        direction: manualReq.direction,
        issueDate: manualReq.issueDate,
        eventDate: manualReq.eventDate ?? manualReq.issueDate,
        dueDate: manualReq.dueDate ?? addDaysIso(manualReq.issueDate, 14),
        counterpartyName: manualReq.counterpartyName,
        counterpartyNip: normalizedManualNip,
        counterpartyAddress: manualReq.counterpartyAddress,
        counterpartyIban: manualReq.counterpartyIban,
        ksefReferenceNumber: manualReq.ksefReferenceNumber,
        ksefMarker: manualReq.ksefMarker,
        suggestedCategory: manualReq.suggestedCategory,
        vatDeductionMode: manualReq.vatDeductionMode,
        ryczaltRate: manualReq.ryczaltRate,
        isCorrection: manualReq.isCorrection,
        correctedDocumentNumber: manualReq.correctedDocumentNumber,
        correctionReason: manualReq.correctionReason,
        lines: manualReq.lines,
      });
    }

    const candidateIdentity = this.getDocumentEconomicIdentity(company, record);
    this.assertNoCanonicalDocumentConflict({
      company,
      candidateKey: candidateIdentity.economicOperationKey,
      candidateSnapshotHash: candidateIdentity.economicSnapshotHash,
      candidateKsefReference: record.document.ksefReferenceNumber,
      candidateDocNumber: record.document.documentNumber,
    });

    company.documents.unshift(record);
    this.store.saveCompany(company);
    return record;
  }

  private postDocumentRecordInternal(
    company: WorkspaceCompanyState,
    docIndex: number,
    approverUserId: UserId,
    overrides?: ApproveAndPostDocumentRequest,
  ): CompanyDocumentItemContract {
    const existing = company.documents[docIndex];
    if (!existing) {
      throw new AccountingWorkspaceAccessError(
        404,
        'document_not_found',
        'Nie znaleziono dokumentu.',
      );
    }
    if (existing.status === 'posted') {
      throw new AccountingWorkspaceConflictError(
        'document_already_posted',
        `Dokument ${existing.document.documentNumber} został już wcześniej zaksięgowany.`,
      );
    }

    assertApproveOverridesMatchRegime(company.taxProfile.profileCode, overrides);

    let doc = existing.document;
    const effectiveVatRateOverride = overrides?.vatRate ?? overrides?.vatRateCode;
    const effectiveVatDeductionOverride = overrides?.vatDeductionMode ?? overrides?.deductionMode;
    const mappedColumnQual: KpirExpenseQualificationKind | undefined =
      overrides?.kpirColumnNumber === 10
        ? 'goods_and_materials_col10'
        : overrides?.kpirColumnNumber === 11
          ? 'incidental_purchase_costs_col11'
          : overrides?.kpirColumnNumber === 12
            ? 'remuneration_col12'
            : overrides?.kpirColumnNumber === 13
              ? 'other_expenses_100_col13'
              : undefined;
    const effectiveKpirQualOverride =
      overrides?.kpirQualification ?? overrides?.expenseQualification ?? mappedColumnQual;
    const effectiveRyczaltRateOverride = overrides?.ryczaltRate ?? overrides?.ryczaltRateCode;

    let normalizedOverrideNip = doc.counterpartyNip;
    if (overrides?.counterpartyNip !== undefined) {
      const nipCheck = validatePolishNip(overrides.counterpartyNip);
      if (!nipCheck.valid || !nipCheck.normalizedNip) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_nip',
          nipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta wskazany przy zatwierdzaniu dokumentu.',
        );
      }
      normalizedOverrideNip = nipCheck.normalizedNip;
    }

    const hasDocFieldOverrides =
      overrides?.documentNumber !== undefined ||
      overrides?.issueDate !== undefined ||
      overrides?.eventDate !== undefined ||
      overrides?.dueDate !== undefined ||
      overrides?.counterpartyName !== undefined ||
      overrides?.counterpartyNip !== undefined ||
      overrides?.description !== undefined ||
      overrides?.netPln !== undefined ||
      overrides?.vatPln !== undefined ||
      overrides?.lines !== undefined ||
      effectiveVatRateOverride !== undefined;

    if (hasDocFieldOverrides && overrides) {
      const nextIssueDate = overrides.issueDate ?? doc.issueDate;
      const nextEventDate = overrides.eventDate ?? overrides.issueDate ?? doc.eventDate;
      const nextDueDate: string =
        overrides.dueDate ??
        (doc.dueDate && doc.dueDate >= nextIssueDate ? doc.dueDate : addDaysIso(nextIssueDate, 14));
      if (nextDueDate < nextIssueDate) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_due_date',
          'Termin płatności (dueDate) nie może być wcześniejszy niż data wystawienia (issueDate).',
        );
      }

      const parsedNetOverride =
        overrides.netPln !== undefined ? parsePlnToGrosze(overrides.netPln) : undefined;
      const parsedVatOverride =
        overrides.vatPln !== undefined ? parsePlnToGrosze(overrides.vatPln) : undefined;

      let nextLines: DocumentLineItemContract[];
      let nextNetGrosze: number;
      let nextVatGrosze: number;
      let nextGrossGrosze: number;

      if (overrides.lines && overrides.lines.length > 0) {
        nextLines = overrides.lines.map((line, index) => {
          const calc = calculateInvoiceLineFromNet(line.netGrosze, line.vatRate);
          const lineVat = line.vatGrosze ?? calc.vatGrosze;
          const lineGross = line.grossGrosze ?? line.netGrosze + lineVat;
          validateInvoiceLineVatConsistency({
            netGrosze: line.netGrosze,
            vatRate: line.vatRate,
            vatGrosze: lineVat,
            grossGrosze: lineGross,
            lineLabel: line.description || `pozycja #${index + 1}`,
          });
          return {
            lineNumber: index + 1,
            description: line.description.trim(),
            quantity: line.quantity ?? '1',
            unit: line.unit ?? 'szt.',
            netGrosze: line.netGrosze,
            vatRate: line.vatRate,
            vatGrosze: lineVat,
            grossGrosze: lineGross,
            annex15Item: line.annex15Item ?? false,
          };
        });
        nextNetGrosze = nextLines.reduce((acc, l) => acc + l.netGrosze, 0);
        nextVatGrosze = nextLines.reduce((acc, l) => acc + l.vatGrosze, 0);
        nextGrossGrosze = nextNetGrosze + nextVatGrosze;
        if (parsedNetOverride !== undefined && parsedNetOverride !== nextNetGrosze) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_document_amounts',
            `Suma netto pozycji (${nextNetGrosze} gr) nie zgadza się z nagłówkiem netPln (${parsedNetOverride} gr).`,
          );
        }
        if (parsedVatOverride !== undefined && parsedVatOverride !== nextVatGrosze) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_document_amounts',
            `Suma VAT pozycji (${nextVatGrosze} gr) nie zgadza się z nagłówkiem vatPln (${parsedVatOverride} gr).`,
          );
        }
      } else if (doc.lines.length > 1) {
        const netChanged =
          parsedNetOverride !== undefined && parsedNetOverride !== doc.totalNetGrosze;
        const vatChanged =
          parsedVatOverride !== undefined && parsedVatOverride !== doc.totalVatGrosze;
        const combinedExistingDesc = doc.lines.map((l) => l.description).join('; ');
        const descChanged =
          overrides.description !== undefined &&
          overrides.description.trim() !== combinedExistingDesc &&
          overrides.description.trim() !== doc.lines[0]?.description;
        const distinctRates = new Set(doc.lines.map((l) => l.vatRate));
        const rateChanged =
          effectiveVatRateOverride !== undefined &&
          (distinctRates.size > 1 || !distinctRates.has(effectiveVatRateOverride));

        if (netChanged || vatChanged || descChanged || rateChanged) {
          throw new AccountingWorkspaceValidationError(
            422,
            'ambiguous_multiline_override',
            'Dokument wielopozycyjny wymaga jawnego przekazania tablicy pozycji (lines) przy zmianie kwot netto/VAT, stawek VAT lub opisów pozycji — spłaszczenie wielu stawek do jednej pozycji jest niedozwolone.',
          );
        }

        nextLines = doc.lines;
        nextNetGrosze = doc.totalNetGrosze;
        nextVatGrosze = doc.totalVatGrosze;
        nextGrossGrosze = doc.totalGrossGrosze;
      } else {
        const baseLine = doc.lines[0];
        const nextRate: VatRateCode = effectiveVatRateOverride ?? baseLine?.vatRate ?? '23';
        nextNetGrosze = parsedNetOverride ?? doc.totalNetGrosze;
        nextVatGrosze =
          parsedVatOverride !== undefined
            ? parsedVatOverride
            : parsedNetOverride !== undefined || effectiveVatRateOverride !== undefined
              ? calculateInvoiceLineFromNet(nextNetGrosze, nextRate).vatGrosze
              : doc.totalVatGrosze;
        nextGrossGrosze = nextNetGrosze + nextVatGrosze;
        const lineDesc =
          overrides.description?.trim() ??
          baseLine?.description ??
          `Pozycja ${overrides.documentNumber ?? doc.documentNumber}`;
        if (
          parsedNetOverride !== undefined ||
          parsedVatOverride !== undefined ||
          effectiveVatRateOverride !== undefined
        ) {
          validateInvoiceLineVatConsistency({
            netGrosze: nextNetGrosze,
            vatRate: nextRate,
            vatGrosze: nextVatGrosze,
            grossGrosze: nextGrossGrosze,
            lineLabel: lineDesc,
          });
        }
        nextLines = [
          {
            lineNumber: 1,
            description: lineDesc,
            quantity: baseLine?.quantity ?? '1',
            unit: baseLine?.unit ?? 'szt.',
            netGrosze: nextNetGrosze,
            vatRate: nextRate,
            vatGrosze: nextVatGrosze,
            grossGrosze: nextGrossGrosze,
            annex15Item: baseLine?.annex15Item ?? false,
          },
        ];
      }

      const sanitizedCp =
        overrides.counterpartyName !== undefined
          ? sanitizeUntrustedDocumentTextForMcp(overrides.counterpartyName.trim(), {
              field: 'counterpartyName',
            }).sanitizedText || overrides.counterpartyName.trim()
          : doc.counterpartyName;

      doc = {
        ...doc,
        documentNumber: overrides.documentNumber?.trim() ?? doc.documentNumber,
        issueDate: nextIssueDate,
        eventDate: nextEventDate,
        dueDate: nextDueDate,
        counterpartyName: sanitizedCp,
        ...(normalizedOverrideNip ? { counterpartyNip: normalizedOverrideNip } : {}),
        lines: nextLines,
        totalNetGrosze: nextNetGrosze,
        totalVatGrosze: nextVatGrosze,
        totalGrossGrosze: nextGrossGrosze,
        totalGrossFormatted: formatPlnFromGrosze(nextGrossGrosze),
      };
    }

    if (
      !existing.isCorrection &&
      (doc.totalNetGrosze < 0 ||
        doc.totalVatGrosze < 0 ||
        doc.totalGrossGrosze < 0 ||
        doc.lines.some((l) => l.netGrosze < 0 || l.vatGrosze < 0 || l.grossGrosze < 0))
    ) {
      throw new AccountingWorkspaceValidationError(
        422,
        'negative_amount_requires_correction',
        'Ujemne kwoty netto, VAT lub brutto przy zatwierdzaniu dokumentu są dozwolone wyłącznie dla faktur korygujących (isCorrection = true).',
      );
    }

    const nextEconomicOperationKey = computeEconomicOperationKey({
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      direction: doc.direction,
      documentNumber: doc.documentNumber,
      issueDate: doc.issueDate,
      counterpartyNip: doc.counterpartyNip,
      counterpartyName: doc.counterpartyName,
      companyNip: company.nip,
      isCorrection: existing.isCorrection,
    });
    const nextEconomicSnapshotHash = computeEconomicSnapshotHash({
      direction: doc.direction,
      isCorrection: existing.isCorrection,
      documentNumber: doc.documentNumber,
      issueDate: doc.issueDate,
      counterpartyNip: doc.counterpartyNip,
      totalNetGrosze: doc.totalNetGrosze,
      totalVatGrosze: doc.totalVatGrosze,
      totalGrossGrosze: doc.totalGrossGrosze,
    });

    this.assertNoCanonicalDocumentConflict({
      company,
      candidateKey: nextEconomicOperationKey,
      candidateSnapshotHash: nextEconomicSnapshotHash,
      candidateKsefReference: doc.ksefReferenceNumber,
      candidateDocNumber: doc.documentNumber,
      excludeDocumentId: existing.documentId,
    });
    this.assertNoManualLedgerDuplicateForPosting({
      company,
      direction: doc.direction,
      documentNumber: doc.documentNumber,
      counterpartyNip: doc.counterpartyNip,
      counterpartyName: doc.counterpartyName,
      ksefReferenceNumber: doc.ksefReferenceNumber,
      isCorrection: existing.isCorrection,
    });

    const period = doc.eventDate.slice(0, 7);
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      period,
      `księgowanie dokumentu ${doc.documentNumber}`,
    );
    const vatActive = company.taxProfile.vatStatus === 'czynny';
    if (vatActive) {
      const existingSettlement = company.vatPeriodSettlements?.get(period);
      if (
        existingSettlement?.status === 'finalized' &&
        !existing.isCorrection &&
        !overrides?.correctionReason
      ) {
        throw new AccountingWorkspaceConflictError(
          'vat_period_finalized',
          `Rozliczenie VAT za okres ${period} zostało już sfinalizowane (wersja ${existingSettlement.version}). Aby zmienić kwoty zamkniętego okresu, użyj dokumentu korygującego lub jawnej przyczyny korekty (correctionReason).`,
        );
      }
    }
    const category: ProposedPostingCategory =
      doc.direction === 'sales'
        ? 'przychod_sprzedaz'
        : (overrides?.suggestedCategory ?? existing.aiProposal.suggestedCategory);
    const isCarMixed =
      category === 'eksploatacja_samochodu_mieszana' ||
      effectiveKpirQualOverride === 'vehicle_mixed_75_col13';

    const vatDeductionMode: VatDeductionMode = !vatActive
      ? 'none_0'
      : (effectiveVatDeductionOverride ??
        (isCarMixed ? 'vehicle_mixed_50' : existing.aiProposal.vatDeductionMode));

    const vatEntryIds: string[] = [];
    let totalDeductibleVatGrosze = 0;
    let totalNonDeductibleVatGrosze = 0;

    if (vatActive) {
      const groupedByRate = new Map<
        VatRateCode,
        { netGrosze: number; vatTotalGrosze: number; hasAnnex15: boolean }
      >();
      for (const line of doc.lines) {
        const current = groupedByRate.get(line.vatRate) ?? {
          netGrosze: 0,
          vatTotalGrosze: 0,
          hasAnnex15: false,
        };
        current.netGrosze += line.netGrosze;
        current.vatTotalGrosze += line.vatGrosze;
        current.hasAnnex15 = current.hasAnnex15 || Boolean(line.annex15Item);
        groupedByRate.set(line.vatRate, current);
      }
      if (groupedByRate.size === 0) {
        groupedByRate.set('23', {
          netGrosze: doc.totalNetGrosze,
          vatTotalGrosze: doc.totalVatGrosze,
          hasAnnex15: false,
        });
      }

      for (const [vatRate, group] of groupedByRate.entries()) {
        const vatEntryId = randomUUID();
        const vatEntry = createVatRegisterEntry({
          id: vatEntryId,
          registerType: doc.direction === 'sales' ? 'sales' : 'purchase',
          period,
          taxPointDate: doc.eventDate,
          issueDate: doc.issueDate,
          documentNumber: doc.documentNumber,
          counterpartyName: doc.counterpartyName,
          ...(doc.counterpartyNip ? { counterpartyNip: doc.counterpartyNip } : {}),
          vatRate,
          netGrosze: group.netGrosze,
          vatTotalGrosze: group.vatTotalGrosze,
          invoiceTotalGrossGrosze: doc.totalGrossGrosze,
          deductionMode: doc.direction === 'sales' ? 'full_100' : vatDeductionMode,
          annex15Item: group.hasAnnex15,
          ...(doc.ksefReferenceNumber ? { ksefReferenceNumber: doc.ksefReferenceNumber } : {}),
          ...(doc.ksefMarker ? { ksefMarker: doc.ksefMarker } : {}),
        });
        company.vatEntries.push(vatEntry);
        vatEntryIds.push(vatEntry.id);
        if (doc.direction === 'purchase') {
          totalDeductibleVatGrosze += vatEntry.deductibleVatGrosze;
          totalNonDeductibleVatGrosze += vatEntry.nonDeductibleVatGrosze;
        }
      }
    } else if (doc.direction === 'purchase') {
      totalDeductibleVatGrosze = 0;
      totalNonDeductibleVatGrosze = doc.totalVatGrosze;
    }

    let kpirEntryId: string | null = null;
    let ryczaltEntryId: string | null = null;
    let journalEntryId: string | null = null;
    let postingExplanation: LegalExplanation;
    let kupGrosze = 0;
    let nkupGrosze = 0;

    const combinedDescription = doc.lines.map((l) => l.description).join('; ');
    const effectiveCorrectionReason: string | undefined = existing.isCorrection
      ? overrides?.correctionReason?.trim() ||
        existing.correctionReason?.trim() ||
        (existing.correctedDocumentNumber
          ? `Faktura korygująca do ${existing.correctedDocumentNumber}`
          : `Korekta dokumentu ${doc.documentNumber}`)
      : overrides?.correctionReason?.trim() || existing.correctionReason?.trim() || undefined;
    const correctedDocNorm = existing.correctedDocumentNumber
      ? normalizeCanonicalDocNumber(existing.correctedDocumentNumber)
      : null;
    const originalPostedDoc = correctedDocNorm
      ? (company.documents.find(
          (d) =>
            d.documentId !== existing.documentId &&
            d.status === 'posted' &&
            !d.isCorrection &&
            d.document.direction === doc.direction &&
            normalizeCanonicalDocNumber(d.document.documentNumber) === correctedDocNorm,
        ) ??
        company.documents.find(
          (d) =>
            d.documentId !== existing.documentId &&
            d.status === 'posted' &&
            normalizeCanonicalDocNumber(d.document.documentNumber) === correctedDocNorm,
        ))
      : undefined;

    if (
      company.taxProfile.profileCode === 'jdg_kpir_skala' ||
      company.taxProfile.profileCode === 'jdg_kpir_liniowy'
    ) {
      const nextOrdinal = company.kpirEntries.length + 1;
      const entryId = randomUUID();
      const resolvedKpirCorrectedEntryId: string | undefined = existing.isCorrection
        ? overrides?.correctedEntryId?.trim() ||
          originalPostedDoc?.postingResult?.kpirEntryId ||
          (correctedDocNorm
            ? company.kpirEntries.find(
                (e) =>
                  !e.isCorrection &&
                  normalizeCanonicalDocNumber(e.documentNumber) === correctedDocNorm,
              )?.id
            : undefined) ||
          `corr-ref:${correctedDocNorm ?? existing.documentId}`
        : overrides?.correctedEntryId?.trim();

      if (doc.direction === 'sales') {
        const revGrosze = vatActive ? doc.totalNetGrosze : doc.totalGrossGrosze;
        const kpirEntry = createKpirEntry({
          id: entryId,
          ordinalNumber: nextOrdinal,
          eventDate: doc.eventDate,
          documentNumber: doc.documentNumber,
          ...(doc.ksefReferenceNumber ? { ksefReferenceNumber: doc.ksefReferenceNumber } : {}),
          counterpartyName: doc.counterpartyName,
          ...(doc.counterpartyNip ? { counterpartyNip: doc.counterpartyNip } : {}),
          counterpartyAddress: doc.counterpartyAddress ?? 'Polska',
          eventDescription: combinedDescription,
          col7SalesRevenueGrosze: revGrosze,
          qualificationKind: 'none',
          isCorrection: existing.isCorrection,
          ...(resolvedKpirCorrectedEntryId
            ? { correctedEntryId: resolvedKpirCorrectedEntryId }
            : {}),
          ...(effectiveCorrectionReason ? { correctionReason: effectiveCorrectionReason } : {}),
        });
        company.kpirEntries.push(kpirEntry);
        kpirEntryId = kpirEntry.id;
        postingExplanation = kpirEntry.explanation;
      } else {
        const qualKind: Exclude<KpirExpenseQualificationKind, 'none'> =
          effectiveKpirQualOverride && effectiveKpirQualOverride !== 'none'
            ? effectiveKpirQualOverride
            : isCarMixed
              ? 'vehicle_mixed_75_col13'
              : category === 'towary_i_materialy'
                ? 'goods_and_materials_col10'
                : 'other_expenses_100_col13';
        const hasOppositeSignTotals =
          (doc.totalNetGrosze > 0 && doc.totalVatGrosze < 0) ||
          (doc.totalNetGrosze < 0 && doc.totalVatGrosze > 0);
        let col10 = 0;
        let col11 = 0;
        let col12 = 0;
        let col13 = 0;
        let col16 = 0;
        if (hasOppositeSignTotals) {
          let lastExp: LegalExplanation | null = null;
          for (const line of doc.lines) {
            const lineDedVat = !vatActive
              ? 0
              : vatDeductionMode === 'none_0'
                ? 0
                : vatDeductionMode === 'vehicle_mixed_50'
                  ? multiplyGroszeByBps(line.vatGrosze, 5000, 'half_up')
                  : line.vatGrosze;
            const q = qualifyKpirExpense({
              eventDate: doc.eventDate,
              qualificationKind: qualKind,
              netGrosze: line.netGrosze,
              vatGrosze: line.vatGrosze,
              taxpayerVatActive: vatActive,
              deductibleVatGrosze: lineDedVat,
            });
            kupGrosze += q.deductibleKupGrosze;
            nkupGrosze += q.nonDeductibleNkupGrosze;
            col10 += q.col10GoodsAndMaterialsGrosze;
            col11 += q.col11IncidentalCostsGrosze;
            col12 += q.col12RemunerationGrosze;
            col13 += q.col13OtherExpensesGrosze;
            col16 += q.col16ResearchDevelopmentCostGrosze;
            lastExp = q.explanation;
          }
          postingExplanation = lastExp!;
        } else {
          const qualified = qualifyKpirExpense({
            eventDate: doc.eventDate,
            qualificationKind: qualKind,
            netGrosze: doc.totalNetGrosze,
            vatGrosze: doc.totalVatGrosze,
            taxpayerVatActive: vatActive,
            deductibleVatGrosze: totalDeductibleVatGrosze,
          });
          kupGrosze = qualified.deductibleKupGrosze;
          nkupGrosze = qualified.nonDeductibleNkupGrosze;
          col10 = qualified.col10GoodsAndMaterialsGrosze;
          col11 = qualified.col11IncidentalCostsGrosze;
          col12 = qualified.col12RemunerationGrosze;
          col13 = qualified.col13OtherExpensesGrosze;
          col16 = qualified.col16ResearchDevelopmentCostGrosze;
          postingExplanation = qualified.explanation;
        }
        const kpirEntry = createKpirEntry({
          id: entryId,
          ordinalNumber: nextOrdinal,
          eventDate: doc.eventDate,
          documentNumber: doc.documentNumber,
          ...(doc.ksefReferenceNumber ? { ksefReferenceNumber: doc.ksefReferenceNumber } : {}),
          counterpartyName: doc.counterpartyName,
          ...(doc.counterpartyNip ? { counterpartyNip: doc.counterpartyNip } : {}),
          counterpartyAddress: doc.counterpartyAddress ?? 'Polska',
          eventDescription: combinedDescription,
          col10GoodsAndMaterialsGrosze: col10,
          col11IncidentalCostsGrosze: col11,
          col12RemunerationGrosze: col12,
          col13OtherExpensesGrosze: col13,
          col16ResearchDevelopmentCostGrosze: col16,
          qualificationKind: qualKind,
          isCorrection: existing.isCorrection,
          ...(resolvedKpirCorrectedEntryId
            ? { correctedEntryId: resolvedKpirCorrectedEntryId }
            : {}),
          ...(effectiveCorrectionReason ? { correctionReason: effectiveCorrectionReason } : {}),
        });
        company.kpirEntries.push(kpirEntry);
        kpirEntryId = kpirEntry.id;
      }
    } else if (company.taxProfile.profileCode === 'jdg_ryczalt') {
      const rate: RyczaltRateCode =
        effectiveRyczaltRateOverride ?? existing.aiProposal.ryczaltRate ?? '12';
      const resolvedRyczaltCorrectedEntryId: string | undefined = existing.isCorrection
        ? overrides?.correctedEntryId?.trim() ||
          originalPostedDoc?.postingResult?.ryczaltEntryId ||
          (correctedDocNorm
            ? company.ryczaltEntries.find(
                (e) =>
                  !e.isCorrection &&
                  normalizeCanonicalDocNumber(e.documentNumber) === correctedDocNorm,
              )?.id
            : undefined) ||
          `corr-ref:${correctedDocNorm ?? existing.documentId}`
        : overrides?.correctedEntryId?.trim();
      if (doc.direction === 'sales') {
        const revGrosze = vatActive ? doc.totalNetGrosze : doc.totalGrossGrosze;
        const ryczEntry = createRyczaltEntry({
          id: randomUUID(),
          ordinalNumber: company.ryczaltEntries.length + 1,
          entryDate: doc.issueDate,
          revenueDate: doc.eventDate,
          documentNumber: doc.documentNumber,
          ...(doc.ksefReferenceNumber ? { ksefReferenceNumber: doc.ksefReferenceNumber } : {}),
          counterpartyName: doc.counterpartyName,
          ...(doc.counterpartyNip ? { counterpartyNip: doc.counterpartyNip } : {}),
          rate,
          revenueGrosze: revGrosze,
          remarks: combinedDescription,
          isCorrection: existing.isCorrection,
          ...(resolvedRyczaltCorrectedEntryId
            ? { correctedEntryId: resolvedRyczaltCorrectedEntryId }
            : {}),
          ...(effectiveCorrectionReason ? { correctionReason: effectiveCorrectionReason } : {}),
        });
        company.ryczaltEntries.push(ryczEntry);
        ryczaltEntryId = ryczEntry.id;
      }
      const ryczaltRule = resolveRuleAtDate('RYCZALT_RATES_ART_12', doc.eventDate);
      postingExplanation = buildLegalExplanation({
        calculationType: 'ryczalt_document_posting',
        summary:
          doc.direction === 'sales'
            ? `Ujęto przychód w ewidencji ryczałtu wg stawki ${rate}% (art. 12 ust. 1 u.z.p.d.).`
            : 'Zarejestrowano dowód zakupu w ryczałcie — brak kosztów uzyskania przychodów w podatku dochodowym (art. 12 ust. 1 u.z.p.d.).',
        eventDate: doc.eventDate,
        rules: [ryczaltRule],
        steps: [
          {
            stepNumber: 1,
            label:
              doc.direction === 'sales'
                ? `Przychód opodatkowany stawką ryczałtu ${rate}%`
                : 'Weryfikacja braku KUP w ryczałcie ewidencjonowanym',
            formula: doc.direction === 'sales' ? 'przychód * stawka ryczałtu' : 'KUP = 0 zł',
            inputs: { grossGrosze: doc.totalGrossGrosze, rate },
            resultFormatted:
              doc.direction === 'sales'
                ? formatPlnFromGrosze(vatActive ? doc.totalNetGrosze : doc.totalGrossGrosze)
                : '0,00 zł',
          },
        ],
        inputs: { direction: doc.direction, grossGrosze: doc.totalGrossGrosze },
        outputs: { ryczaltEntryId: ryczaltEntryId ?? 'none' },
      });
    } else {
      // spzoo_pelne_ksiegi — pełne księgi rachunkowe UoR (Wn === Ma)
      const entryNumber = `DK/${period}/${String(company.journalEntries.length + 1).padStart(3, '0')}`;
      const jeId = randomUUID();
      const lines: {
        accountCode: string;
        side: 'Wn' | 'Ma';
        amountGrosze: number;
        description: string;
        isRedStorno?: boolean;
        stornoReason?: string;
      }[] = [];

      const pushSignedJournalLine = (params: {
        accountCode: string;
        side: 'Wn' | 'Ma';
        amountGrosze: number;
        description: string;
      }): void => {
        if (params.amountGrosze === 0) {
          return;
        }
        if (params.amountGrosze < 0) {
          lines.push({
            accountCode: params.accountCode,
            side: params.side,
            amountGrosze: params.amountGrosze,
            description: params.description,
            isRedStorno: true,
            stornoReason:
              effectiveCorrectionReason ?? `Storno czerwone dokumentu ${doc.documentNumber}`,
          });
          return;
        }
        lines.push({
          accountCode: params.accountCode,
          side: params.side,
          amountGrosze: params.amountGrosze,
          description: params.description,
        });
      };

      if (doc.direction === 'sales') {
        const revAccount = overrides?.ledgerAccountCode ?? '700';
        const revAmount = vatActive ? doc.totalNetGrosze : doc.totalGrossGrosze;
        pushSignedJournalLine({
          accountCode: '201',
          side: 'Wn',
          amountGrosze: doc.totalGrossGrosze,
          description: `Należność od odbiorcy ${doc.counterpartyName} (${doc.documentNumber})`,
        });
        pushSignedJournalLine({
          accountCode: revAccount,
          side: 'Ma',
          amountGrosze: revAmount,
          description: `Przychód ze sprzedaży — ${doc.documentNumber}`,
        });
        if (vatActive && doc.totalVatGrosze !== 0) {
          pushSignedJournalLine({
            accountCode: '221-1',
            side: 'Ma',
            amountGrosze: doc.totalVatGrosze,
            description: `VAT należny — ${doc.documentNumber}`,
          });
        }
      } else {
        const costAccount =
          overrides?.ledgerAccountCode ?? (category === 'towary_i_materialy' ? '330' : '402');
        const costBase = doc.totalNetGrosze + totalNonDeductibleVatGrosze;
        kupGrosze = isCarMixed ? multiplyGroszeByBps(costBase, 7500, 'half_up') : costBase;
        nkupGrosze = costBase - kupGrosze;
        pushSignedJournalLine({
          accountCode: costAccount,
          side: 'Wn',
          amountGrosze: costBase,
          description: `Koszt zakupu (${doc.documentNumber}) — ${combinedDescription}`,
        });
        if (vatActive && totalDeductibleVatGrosze !== 0) {
          pushSignedJournalLine({
            accountCode: '221-2',
            side: 'Wn',
            amountGrosze: totalDeductibleVatGrosze,
            description: `VAT naliczony podlegający odliczeniu — ${doc.documentNumber}`,
          });
        }
        pushSignedJournalLine({
          accountCode: '202',
          side: 'Ma',
          amountGrosze: doc.totalGrossGrosze,
          description: `Zobowiązanie wobec dostawcy ${doc.counterpartyName} (${doc.documentNumber})`,
        });
      }

      const uorRule = resolveRuleAtDate('UOR_DOUBLE_ENTRY_AND_BALANCE', doc.eventDate);
      if (existing.isCorrection && lines.length === 0) {
        postingExplanation = buildLegalExplanation({
          calculationType: 'uor_journal_posting',
          summary: `Zarejestrowano korektę formalną ${doc.documentNumber} bez zmiany kwot księgowych (SUM(Wn) === SUM(Ma) === 0,00 zł).`,
          eventDate: doc.eventDate,
          rules: [uorRule],
          steps: [
            {
              stepNumber: 1,
              label: 'Korekta formalna bez zmiany obrotów Wn i Ma (art. 15 UoR)',
              formula: 'SUM(Wn) === SUM(Ma) === 0',
              inputs: { totalWnGrosze: 0, totalMaGrosze: 0 },
              resultFormatted: formatPlnFromGrosze(0),
              resultGrosze: 0,
            },
          ],
          inputs: { entryNumber: 'none', documentNumber: doc.documentNumber },
          outputs: { journalEntryId: 'none' },
        });
      } else {
        const journalEntry = createValidatedJournalEntry({
          id: jeId,
          entryNumber,
          bookingDate: doc.eventDate,
          documentDate: doc.issueDate,
          documentNumber: doc.documentNumber,
          description: `${existing.isCorrection ? 'Faktura korygująca' : doc.direction === 'sales' ? 'Faktura sprzedaży' : 'Faktura zakupu'} ${doc.documentNumber} (${doc.counterpartyName})`,
          lines,
          closedPeriods: listClosedPeriods(company.periodCloseStates),
        });
        company.journalEntries.push(journalEntry);
        journalEntryId = journalEntry.id;

        postingExplanation = buildLegalExplanation({
          calculationType: 'uor_journal_posting',
          summary: `Zaksięgowano dekret ${entryNumber} z zachowaniem równowagi podwójnego zapisu Wn === Ma (${formatPlnFromGrosze(journalEntry.totalWnGrosze)}).`,
          eventDate: doc.eventDate,
          rules: [uorRule],
          steps: [
            {
              stepNumber: 1,
              label: 'Kontrola równowagi obrotów Wn i Ma dekretu (art. 15 UoR)',
              formula: 'SUM(Wn) === SUM(Ma)',
              inputs: {
                totalWnGrosze: journalEntry.totalWnGrosze,
                totalMaGrosze: journalEntry.totalMaGrosze,
              },
              resultFormatted: formatPlnFromGrosze(journalEntry.totalWnGrosze),
              resultGrosze: journalEntry.totalWnGrosze,
            },
          ],
          inputs: { entryNumber, documentNumber: doc.documentNumber },
          outputs: { journalEntryId: jeId },
        });
      }
    }

    let settlementId: string | null = null;
    if (doc.totalGrossGrosze > 0) {
      settlementId = randomUUID();
      const dueDate = doc.dueDate ?? addDaysIso(doc.issueDate, 14);
      const settlementState = deriveSettlementStatus(
        doc.totalGrossGrosze,
        0,
        dueDate,
        this.todayIso(),
      );
      const settlementItem: SettlementItemContract = {
        settlementId,
        documentId: existing.documentId,
        documentNumber: doc.documentNumber,
        direction: doc.direction === 'sales' ? 'receivable' : 'payable',
        counterpartyName: doc.counterpartyName,
        counterpartyNip: doc.counterpartyNip ?? null,
        issueDate: doc.issueDate,
        dueDate,
        grossGrosze: doc.totalGrossGrosze,
        settledGrosze: 0,
        remainingGrosze: doc.totalGrossGrosze,
        remainingFormatted: formatPlnFromGrosze(doc.totalGrossGrosze),
        status: settlementState.status,
        daysOverdue: settlementState.daysOverdue,
        ksefReferenceNumber: doc.ksefReferenceNumber ?? null,
      };
      company.settlements.unshift(settlementItem);
    }

    const accountingItemId = existing.documentId;
    const appliedRuleRefs: LegalBasisReference[] = postingExplanation.appliedRules.map((ar) => ({
      ruleId: ar.ruleCode,
      ruleVersion: ar.version,
      actTitle: ar.actTitle,
      articleRef: ar.article,
      journalOfLawsRef: ar.journalReference,
      officialUrl: ar.sourceUrl,
      effectiveFrom: ar.validFrom,
      effectiveTo: ar.validTo,
      verificationStatus: ar.verificationStatus === 'verified' ? 'verified' : 'experimental',
    }));
    const calcSteps: AccountingCalculationStep[] = postingExplanation.steps.map((st) => ({
      stepNumber: st.stepNumber,
      labelPl: st.label,
      formula: st.formula,
      inputAmountPln: formatGroszeDecimalPln(doc.totalNetGrosze),
      resultAmountPln: formatGroszeDecimalPln(st.resultGrosze ?? kupGrosze),
      appliedRuleId: appliedRuleRefs[0]?.ruleId ?? 'ORDYNACJA_ART_63_TAX_ROUNDING',
    }));

    company.explanationsById.set(accountingItemId, {
      accountingItemId,
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      sourceDocumentSummary: `${doc.documentNumber} — ${doc.counterpartyName} (${combinedDescription})`,
      kupAmountPln: formatGroszeDecimalPln(Math.max(0, kupGrosze)),
      nkupAmountPln: formatGroszeDecimalPln(Math.max(0, nkupGrosze)),
      deductibleVatAmountPln: formatGroszeDecimalPln(Math.max(0, totalDeductibleVatGrosze)),
      nonDeductibleVatAmountPln: formatGroszeDecimalPln(Math.max(0, totalNonDeductibleVatGrosze)),
      taxCategoryCode: category,
      summaryPl: postingExplanation.summary,
      calculationSteps:
        calcSteps.length > 0
          ? calcSteps
          : [
              {
                stepNumber: 1,
                labelPl: 'Zaksięgowanie zatwierdzonego dokumentu',
                formula: 'netto + VAT = brutto',
                inputAmountPln: formatGroszeDecimalPln(doc.totalNetGrosze),
                resultAmountPln: formatGroszeDecimalPln(doc.totalGrossGrosze),
                appliedRuleId: appliedRuleRefs[0]?.ruleId ?? 'ORDYNACJA_ART_63_TAX_ROUNDING',
              },
            ],
      appliedRules:
        appliedRuleRefs.length > 0
          ? appliedRuleRefs
          : [
              mapRuleToLegalBasisRef(
                resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', doc.eventDate),
              ),
            ],
    });

    const postingResult: DocumentPostingResultContract = {
      accountingItemId,
      kpirEntryId,
      ryczaltEntryId,
      vatEntryIds,
      journalEntryId,
      settlementId,
      explanation: toContractExplanation(postingExplanation),
    };

    const nowIso = this.nowIso();
    const updatedDoc = CompanyDocumentItemSchema.parse({
      ...existing,
      correctionReason: effectiveCorrectionReason ?? existing.correctionReason,
      document: doc,
      economicOperationKey: nextEconomicOperationKey,
      economicSnapshotHash: nextEconomicSnapshotHash,
      status: 'posted',
      updatedAt: nowIso,
      approvedByUserId: approverUserId,
      approvedAt: nowIso,
      aiProposal: {
        ...existing.aiProposal,
        status: 'human_approved',
        suggestedCategory: category,
        vatDeductionMode,
      },
      postingResult,
    });

    company.documents[docIndex] = updatedDoc;
    this.store.saveCompany(company);
    return updatedDoc;
  }

  approveAndPostDocument(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    documentId: string,
    rawRequest?: ApproveAndPostDocumentRequest,
  ): CompanyDocumentItemContract {
    const { company, uId, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'approve_and_post_document',
    );
    this.assertHumanApprovalActorScopes(actor, tId, leId, 'approve_and_post_document');

    if (
      rawRequest !== undefined &&
      rawRequest !== null &&
      typeof rawRequest === 'object' &&
      !Array.isArray(rawRequest) &&
      'documentId' in rawRequest &&
      rawRequest.documentId !== undefined &&
      rawRequest.documentId !== documentId
    ) {
      throw new AccountingWorkspaceValidationError(
        400,
        'document_id_mismatch',
        'Identyfikator documentId w treści żądania nie zgadza się z parametrem ścieżki URL.',
      );
    }

    const req = rawRequest ? ApproveAndPostDocumentRequestSchema.parse(rawRequest) : undefined;
    if (req?.documentId !== undefined && req.documentId !== documentId) {
      throw new AccountingWorkspaceValidationError(
        400,
        'document_id_mismatch',
        'Identyfikator documentId w treści żądania nie zgadza się z parametrem ścieżki URL.',
      );
    }

    return this.runWithInMemoryIdempotency(
      `approveAndPostDocument:${tId}:${leId}:${uId}:${documentId}`,
      actor.idempotencyKey,
      req ?? null,
      () => {
        const idx = company.documents.findIndex((d) => d.documentId === documentId);
        if (idx === -1) {
          throw new AccountingWorkspaceAccessError(
            404,
            'document_not_found',
            `Nie znaleziono dokumentu ${documentId} do zatwierdzenia.`,
          );
        }

        const beforeDoc = company.documents[idx]!.document;
        const posted = this.postDocumentRecordInternal(company, idx, uId, req);
        const corrections: string[] = [];
        if (posted.document.totalNetGrosze !== beforeDoc.totalNetGrosze) {
          corrections.push(
            `netto ${formatPlnFromGrosze(beforeDoc.totalNetGrosze)} -> ${formatPlnFromGrosze(posted.document.totalNetGrosze)}`,
          );
        }
        if (posted.document.totalVatGrosze !== beforeDoc.totalVatGrosze) {
          corrections.push(
            `VAT ${formatPlnFromGrosze(beforeDoc.totalVatGrosze)} -> ${formatPlnFromGrosze(posted.document.totalVatGrosze)}`,
          );
        }
        if (posted.document.documentNumber !== beforeDoc.documentNumber) {
          corrections.push(`nr ${beforeDoc.documentNumber} -> ${posted.document.documentNumber}`);
        }
        if (posted.document.counterpartyNip !== beforeDoc.counterpartyNip) {
          corrections.push('skorygowano NIP kontrahenta');
        }

        this.recordAudit({
          channel: 'accounting',
          action: 'document_approved_and_posted_by_human',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'allow',
          reasonCode:
            corrections.length > 0
              ? 'human_corrected_and_approved_posting'
              : 'human_approved_posting',
          summaryPl:
            corrections.length > 0
              ? `Człowiek skorygował propozycję (${corrections.join(', ')}) i zaksięgował dokument ${posted.document.documentNumber} (${posted.document.totalGrossFormatted}).`
              : `Człowiek zatwierdził i zaksięgował dokument ${posted.document.documentNumber} (${posted.document.totalGrossFormatted}).`,
        });
        return posted;
      },
    );
  }

  private mapKpirTotalsToContract(period: string, totals: KpirColumnsTotals) {
    return {
      period,
      col7SalesRevenueGrosze: totals.col7SalesRevenueGrosze,
      col8OtherRevenueGrosze: totals.col8OtherRevenueGrosze,
      col9TotalRevenueGrosze: totals.col9TotalRevenueGrosze,
      col10GoodsAndMaterialsGrosze: totals.col10GoodsAndMaterialsGrosze,
      col11IncidentalCostsGrosze: totals.col11IncidentalCostsGrosze,
      col12RemunerationGrosze: totals.col12RemunerationGrosze,
      col13OtherExpensesGrosze: totals.col13OtherExpensesGrosze,
      col14TotalExpensesGrosze: totals.col14TotalExpensesGrosze,
      col16ResearchDevelopmentCostGrosze: totals.col16ResearchDevelopmentCostGrosze,
      totalTaxDeductibleCostsGrosze: totals.totalTaxDeductibleCostsGrosze,
      incomeOrLossGrosze: totals.accountingIncomeGrosze,
    };
  }

  private computeCompanyZusInternal(
    company: WorkspaceCompanyState,
    period: string,
  ): MonthlyZusContributionsResult | null {
    if (company.taxProfile.zusScheme === 'not_applicable') {
      return null;
    }
    const taxForm =
      company.taxProfile.profileCode === 'jdg_kpir_liniowy'
        ? 'liniowy'
        : company.taxProfile.profileCode === 'jdg_ryczalt'
          ? 'ryczalt'
          : 'skala';

    const prevPeriod = previousMonthPeriod(period);
    const prevKpirSummary = summarizeKpirPeriod(company.kpirEntries, prevPeriod);
    const ytdRyczaltRev = company.ryczaltEntries
      .filter((e) => e.period.slice(0, 4) === period.slice(0, 4) && e.period <= period)
      .reduce((acc, e) => acc + e.revenueGrosze, 0);

    return calculateMonthlyZusContributions({
      period,
      zusScheme: company.taxProfile.zusScheme,
      taxForm,
      voluntarySicknessInsurance: company.taxProfile.voluntarySicknessInsurance,
      previousMonthIncomeGrosze: prevKpirSummary.monthTotals.accountingIncomeGrosze,
      ytdRyczaltRevenueGrosze: ytdRyczaltRev,
      insuredPersonsCount: company.taxProfile.insuredPersonsCount,
      customAccidentRateBps: company.taxProfile.accidentRateBps,
    });
  }

  private computeYtdKpirZusAndPriorPitInternal(
    company: WorkspaceCompanyState,
    period: string,
    taxForm: 'skala' | 'liniowy',
  ): {
    readonly paidSocialZusYtdGrosze: number;
    readonly paidHealthInsuranceYtdGrosze: number;
    readonly previousAdvancesPaidYtdGrosze: number;
  } {
    const yearPrefix = period.slice(0, 4);
    const yearStart = `${yearPrefix}-01-01`;
    const monthNum = Number(period.slice(5, 7));
    const verifiedPayments = company.verifiedTaxPayments ?? [];

    const lastDayOfMonthIso = (targetPeriod: string): string => {
      const [yStr = '2026', mStr = '01'] = targetPeriod.split('-');
      const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
      return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
    };

    let previousAdvancesPaidYtdGrosze = 0;
    for (let m = 1; m < monthNum; m += 1) {
      const priorPeriod = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorCutOff = lastDayOfMonthIso(priorPeriod);
      const priorPaidSocialYtd = verifiedPayments
        .filter(
          (p) =>
            p.obligationKind === 'zus_social' &&
            p.paidDate >= yearStart &&
            p.paidDate <= priorCutOff,
        )
        .reduce((s, p) => s + p.amountGrosze, 0);
      const priorPaidHealthYtd = verifiedPayments
        .filter(
          (p) =>
            p.obligationKind === 'zus_health' &&
            p.paidDate >= yearStart &&
            p.paidDate <= priorCutOff,
        )
        .reduce((s, p) => s + p.amountGrosze, 0);
      const priorSummary = summarizeKpirPeriod(company.kpirEntries, priorPeriod);
      const priorPit = calculateKpirPitAdvance({
        period: priorPeriod,
        taxForm,
        ytdRevenueGrosze: priorSummary.yearToDateTotals.col9TotalRevenueGrosze,
        ytdCostsGrosze: priorSummary.yearToDateTotals.totalTaxDeductibleCostsGrosze,
        paidSocialZusYtdGrosze: priorPaidSocialYtd,
        paidHealthInsuranceYtdGrosze: priorPaidHealthYtd,
        previousAdvancesPaidYtdGrosze,
      });
      previousAdvancesPaidYtdGrosze += priorPit.advanceDueGrosze;
    }

    const currentCutOff = lastDayOfMonthIso(period);
    const paidSocialZusYtdGrosze = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_social' &&
          p.paidDate >= yearStart &&
          p.paidDate <= currentCutOff,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);
    const paidHealthInsuranceYtdGrosze = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_health' &&
          p.paidDate >= yearStart &&
          p.paidDate <= currentCutOff,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);

    return {
      paidSocialZusYtdGrosze,
      paidHealthInsuranceYtdGrosze,
      previousAdvancesPaidYtdGrosze,
    };
  }

  private computeYtdCitNkupGroszeInternal(company: WorkspaceCompanyState, period: string): number {
    const yearPrefix = period.slice(0, 4);
    let totalNkupGrosze = 0;
    for (const docItem of company.documents) {
      if (
        docItem.status !== 'posted' ||
        docItem.document.direction !== 'purchase' ||
        !docItem.document.eventDate.startsWith(yearPrefix) ||
        docItem.document.eventDate.slice(0, 7) > period
      ) {
        continue;
      }
      const explanation = company.explanationsById.get(docItem.documentId);
      if (explanation) {
        const parsedNkup = parsePlnToGrosze(explanation.nkupAmountPln);
        if (parsedNkup > 0) {
          totalNkupGrosze += parsedNkup;
          continue;
        }
      }
      if (docItem.aiProposal?.suggestedCategory === 'eksploatacja_samochodu_mieszana') {
        const vatActive = company.taxProfile.vatStatus === 'czynny';
        const nonDeductibleVat = vatActive
          ? docItem.document.totalVatGrosze -
            multiplyGroszeByBps(docItem.document.totalVatGrosze, 5000, 'half_up')
          : docItem.document.totalVatGrosze;
        const costBase = docItem.document.totalNetGrosze + nonDeductibleVat;
        const kup = multiplyGroszeByBps(costBase, 7500, 'half_up');
        totalNkupGrosze += Math.max(0, costBase - kup);
      }
    }
    return totalNkupGrosze;
  }

  calculateCompanyZus(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period = DEMO_DEFAULT_PERIOD,
  ): MonthlyZusContributionsResult {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'calculate_company_zus',
    );
    const zus = this.computeCompanyZusInternal(company, period);
    if (!zus) {
      throw new AccountingWorkspaceValidationError(
        422,
        'zus_not_applicable_for_spzoo',
        'Składki przedsiębiorcy JDG nie dotyczą spółki z o.o. (brak ZUS właściciela JDG).',
      );
    }
    return zus;
  }

  private computeRegimeComparisonInternal(
    company: WorkspaceCompanyState,
    period: string,
    ytdRevenueGrosze: number,
    ytdCostsGrosze: number,
    socialZusGrosze: number,
  ): RegimeComparisonSummary | null {
    if (company.legalForm !== 'jdg') {
      return null;
    }
    const currentRegime = company.taxRegime;
    const alternativeRegime: CompanyTaxRegimeContract =
      currentRegime === 'kpir_skala' ? 'kpir_liniowy' : 'kpir_skala';

    const skalaZus = calculateMonthlyZusContributions({
      period,
      zusScheme:
        company.taxProfile.zusScheme === 'not_applicable'
          ? 'duzy_zus'
          : company.taxProfile.zusScheme,
      taxForm: 'skala',
      voluntarySicknessInsurance: company.taxProfile.voluntarySicknessInsurance,
      previousMonthIncomeGrosze: ytdRevenueGrosze - ytdCostsGrosze,
    });
    const liniowyZus = calculateMonthlyZusContributions({
      period,
      zusScheme:
        company.taxProfile.zusScheme === 'not_applicable'
          ? 'duzy_zus'
          : company.taxProfile.zusScheme,
      taxForm: 'liniowy',
      voluntarySicknessInsurance: company.taxProfile.voluntarySicknessInsurance,
      previousMonthIncomeGrosze: ytdRevenueGrosze - ytdCostsGrosze,
    });

    const skalaPit = calculateKpirPitAdvance({
      period,
      taxForm: 'skala',
      ytdRevenueGrosze: Math.max(0, ytdRevenueGrosze),
      ytdCostsGrosze: Math.max(0, ytdCostsGrosze),
      paidSocialZusYtdGrosze: socialZusGrosze,
      paidHealthInsuranceYtdGrosze: skalaZus.healthContributionGrosze,
    });
    const liniowyPit = calculateKpirPitAdvance({
      period,
      taxForm: 'liniowy',
      ytdRevenueGrosze: Math.max(0, ytdRevenueGrosze),
      ytdCostsGrosze: Math.max(0, ytdCostsGrosze),
      paidSocialZusYtdGrosze: socialZusGrosze,
      paidHealthInsuranceYtdGrosze: liniowyZus.healthContributionGrosze,
    });

    const skalaTotal = skalaPit.advanceDueGrosze + skalaZus.healthContributionGrosze;
    const liniowyTotal = liniowyPit.advanceDueGrosze + liniowyZus.healthContributionGrosze;
    const currentTotal = currentRegime === 'kpir_liniowy' ? liniowyTotal : skalaTotal;
    const altTotal = currentRegime === 'kpir_liniowy' ? skalaTotal : liniowyTotal;
    const diff = altTotal - currentTotal;

    return {
      currentRegime,
      alternativeRegime,
      currentTaxPlusHealthGrosze: currentTotal,
      currentTaxPlusHealthFormatted: formatPlnFromGrosze(currentTotal),
      alternativeTaxPlusHealthGrosze: altTotal,
      alternativeTaxPlusHealthFormatted: formatPlnFromGrosze(altTotal),
      differenceGrosze: diff,
      differenceFormatted: formatPlnFromGrosze(diff),
      summaryPl:
        diff >= 0
          ? `Obecna forma (${currentRegime}) jest korzystniejsza szacunkowo o ${formatPlnFromGrosze(diff)} w tym okresie.`
          : `Alternatywna forma (${alternativeRegime}) dałaby szacunkowo o ${formatPlnFromGrosze(Math.abs(diff))} niższe obciążenie PIT + zdrowotna.`,
    };
  }

  private computeCompanyPeriodTaxObligationsInternal(
    company: WorkspaceCompanyState,
    period: string,
    options?: {
      readonly requestPreferentialCit9Pct?: boolean | undefined;
      readonly citPreferentialAttestation?: CitPreferentialAttestationContract | undefined;
    },
  ) {
    const vatJpk =
      company.taxProfile.vatStatus === 'czynny'
        ? this.calculateCompanyVatSettlementForPeriod(company, period).jpk
        : null;
    return computeCompanyPeriodTaxObligations({
      period,
      todayIso: this.todayIso(),
      taxProfile: company.taxProfile,
      kpirEntries: company.kpirEntries,
      ryczaltEntries: company.ryczaltEntries,
      journalEntries: company.journalEntries,
      ytdCitNkupGrosze: this.computeYtdCitNkupGroszeInternal(company, period),
      resolveYtdCitNkupGrosze: (targetPeriod) =>
        this.computeYtdCitNkupGroszeInternal(company, targetPeriod),
      vatJpk,
      verifiedPayments: company.verifiedTaxPayments ?? [],
      requestPreferentialCit9Pct: options?.requestPreferentialCit9Pct,
      citPreferentialAttestationOverride: options?.citPreferentialAttestation,
    });
  }

  getKpirView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period = DEMO_DEFAULT_PERIOD,
  ): KpirViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_kpir_view',
    );
    const is2026OrLater = period >= '2026-01';
    const regulationVersion = is2026OrLater ? 'pkpir_2026_ksef' : 'pkpir_2019_17col';
    const layoutObj = getKpirColumnLayout(regulationVersion);
    const columns = layoutObj.columns.map((c) => ({
      columnNumber: c.columnNumber,
      title: c.label,
      description: `Kolumna ${c.columnNumber} PKPiR (${c.semanticKey})`,
    }));

    const summary = summarizeKpirPeriod(company.kpirEntries, period);
    const taxForm: 'skala' | 'liniowy' =
      company.taxProfile.profileCode === 'jdg_kpir_liniowy' ? 'liniowy' : 'skala';

    const verifiedPayments = company.verifiedTaxPayments ?? [];
    const cutOffDate = `${period}-${String(
      new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate(),
    ).padStart(2, '0')}`;
    const yearStart = `${period.slice(0, 4)}-01-01`;
    const confirmedPaidSocialYtd = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_social' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);
    const confirmedPaidHealthYtd = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_health' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);
    const ytdZusAndPit = this.computeYtdKpirZusAndPriorPitInternal(company, period, taxForm);

    const pitAdvance = calculateKpirPitAdvance({
      period,
      taxForm,
      ytdRevenueGrosze: summary.yearToDateTotals.col9TotalRevenueGrosze,
      ytdCostsGrosze: summary.yearToDateTotals.totalTaxDeductibleCostsGrosze,
      paidSocialZusYtdGrosze: confirmedPaidSocialYtd,
      paidHealthInsuranceYtdGrosze: confirmedPaidHealthYtd,
      previousAdvancesPaidYtdGrosze: ytdZusAndPit.previousAdvancesPaidYtdGrosze,
    });

    const periodEntries = company.kpirEntries.filter((e) => e.period === period);
    const regimeComparison = this.computeRegimeComparisonInternal(
      company,
      period,
      summary.yearToDateTotals.col9TotalRevenueGrosze,
      summary.yearToDateTotals.totalTaxDeductibleCostsGrosze,
      confirmedPaidSocialYtd,
    );

    return KpirViewResponseSchema.parse({
      period,
      layout: is2026OrLater ? '2026' : '2019',
      regulationVersion,
      columns,
      entries: periodEntries,
      periodSummary: this.mapKpirTotalsToContract(period, summary.monthTotals),
      ytdSummary: this.mapKpirTotalsToContract(period, summary.yearToDateTotals),
      pitAdvance: {
        period,
        taxForm,
        taxBaseRoundedPlnGrosze: pitAdvance.roundedTaxBaseGrosze,
        advanceDueRoundedPlnGrosze: pitAdvance.advanceDueGrosze,
        advanceDueFormatted: formatPlnFromGrosze(pitAdvance.advanceDueGrosze),
        explanation: pitAdvance.explanation,
      },
      regimeComparison,
    });
  }

  createKpirManualEntry(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: CreateKpirEntryRequest,
  ): KpirEntryContract {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'create_kpir_entry',
    );
    assertAccountingRegimeSupportsAction(company.taxProfile.profileCode, 'kpir_manual_write');
    const req = CreateKpirEntryRequestSchema.parse(rawRequest);
    const nextOrdinal = company.kpirEntries.length + 1;

    if (req.mode === 'storno' || req.originalEntryId || req.targetEntryId) {
      const origId = req.originalEntryId ?? req.targetEntryId;
      const origEntry = company.kpirEntries.find((e) => e.id === origId);
      if (!origEntry) {
        throw new AccountingWorkspaceAccessError(
          404,
          'kpir_entry_not_found',
          `Nie znaleziono oryginalnego wpisu KPiR (${origId ?? 'brak'}) do storna czerwonego.`,
        );
      }
      const corrDate = req.correctionDate ?? req.eventDate ?? `${DEMO_DEFAULT_PERIOD}-28`;
      assertPeriodOpenForWrite(
        company.periodCloseStates,
        corrDate.slice(0, 7),
        `storno wpisu KPiR (${origEntry.documentNumber})`,
      );
      const storno = createKpirStornoEntry({
        id: randomUUID(),
        ordinalNumber: nextOrdinal,
        correctionDate: corrDate,
        originalEntry: origEntry,
        correctionDocumentNumber:
          req.correctionDocumentNumber ??
          req.documentNumber ??
          `STORNO/${origEntry.documentNumber}`,
        correctionReason:
          req.correctionReason ?? 'Korekta zapisu w KPiR — czerwone storno na żądanie księgowego.',
      });
      company.kpirEntries.push(storno);
      this.store.saveCompany(company);
      return KpirEntrySchema.parse(storno);
    }

    const eventDate = req.eventDate ?? `${DEMO_DEFAULT_PERIOD}-20`;
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      eventDate.slice(0, 7),
      `ręczny wpis KPiR (${req.documentNumber ?? eventDate})`,
    );
    const netGrosze = req.netGrosze ?? 100_00;
    const vatRate = req.vatRate ?? '23';
    const calcVat = calculateInvoiceLineFromNet(netGrosze, vatRate);
    const vatGrosze = req.vatGrosze ?? calcVat.vatGrosze;
    const vatActive = company.taxProfile.vatStatus === 'czynny';
    const entryKind = req.entryKind ?? 'other_expenses_100_col13';
    const resolvedDocNumber = req.documentNumber ?? `DW/${eventDate.slice(0, 7)}/${nextOrdinal}`;
    const resolvedCpName = req.counterpartyName ?? 'Kontrahent KPiR';

    this.assertNoManualLedgerDuplicateForPosting({
      company,
      direction:
        entryKind === 'sales_revenue' || entryKind === 'other_revenue' ? 'sales' : 'purchase',
      documentNumber: resolvedDocNumber,
      counterpartyNip: req.counterpartyNip,
      counterpartyName: resolvedCpName,
      ksefReferenceNumber: req.ksefReferenceNumber,
      isCorrection: false,
    });

    let entry: KpirEntry;
    if (entryKind === 'sales_revenue' || entryKind === 'other_revenue') {
      const revAmount = vatActive ? netGrosze : netGrosze + vatGrosze;
      entry = createKpirEntry({
        id: randomUUID(),
        ordinalNumber: nextOrdinal,
        eventDate,
        documentNumber: resolvedDocNumber,
        ...(req.ksefReferenceNumber ? { ksefReferenceNumber: req.ksefReferenceNumber } : {}),
        counterpartyName: resolvedCpName,
        ...(req.counterpartyNip ? { counterpartyNip: req.counterpartyNip } : {}),
        counterpartyAddress: req.counterpartyAddress ?? 'Polska',
        eventDescription: req.eventDescription ?? 'Przychód gospodarczy wpisany ręcznie',
        ...(entryKind === 'sales_revenue'
          ? { col7SalesRevenueGrosze: revAmount }
          : { col8OtherRevenueGrosze: revAmount }),
        qualificationKind: 'none',
      });
    } else {
      const deductibleVat = !vatActive
        ? 0
        : entryKind === 'vehicle_mixed_75_col13'
          ? multiplyGroszeByBps(vatGrosze, 5000, 'half_up')
          : vatGrosze;
      const qual = qualifyKpirExpense({
        eventDate,
        qualificationKind: entryKind,
        netGrosze,
        vatGrosze,
        taxpayerVatActive: vatActive,
        deductibleVatGrosze: deductibleVat,
      });
      entry = createKpirEntry({
        id: randomUUID(),
        ordinalNumber: nextOrdinal,
        eventDate,
        documentNumber: resolvedDocNumber,
        ...(req.ksefReferenceNumber ? { ksefReferenceNumber: req.ksefReferenceNumber } : {}),
        counterpartyName: resolvedCpName,
        ...(req.counterpartyNip ? { counterpartyNip: req.counterpartyNip } : {}),
        counterpartyAddress: req.counterpartyAddress ?? 'Polska',
        eventDescription: req.eventDescription ?? 'Wydatek gospodarczy wpisany ręcznie',
        col10GoodsAndMaterialsGrosze: qual.col10GoodsAndMaterialsGrosze,
        col11IncidentalCostsGrosze: qual.col11IncidentalCostsGrosze,
        col12RemunerationGrosze: qual.col12RemunerationGrosze,
        col13OtherExpensesGrosze: qual.col13OtherExpensesGrosze,
        col16ResearchDevelopmentCostGrosze: qual.col16ResearchDevelopmentCostGrosze,
        qualificationKind: entryKind,
      });
    }

    company.kpirEntries.push(entry);
    this.store.saveCompany(company);
    return KpirEntrySchema.parse(entry);
  }

  getRyczaltView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period = DEMO_DEFAULT_PERIOD,
  ): RyczaltViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_ryczalt_view',
    );
    const periodEntries = company.ryczaltEntries.filter((e) => e.period === period);
    const verifiedPayments = company.verifiedTaxPayments ?? [];
    const cutOffDate = `${period}-${String(
      new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate(),
    ).padStart(2, '0')}`;
    const paidSocialInMonth = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_social' &&
          p.paidDate >= `${period}-01` &&
          p.paidDate <= cutOffDate,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);
    const paidHealthInMonth = verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_health' &&
          p.paidDate >= `${period}-01` &&
          p.paidDate <= cutOffDate,
      )
      .reduce((s, p) => s + p.amountGrosze, 0);
    const calc = calculateMonthlyRyczalt({
      period,
      entries: periodEntries,
      paidSocialZusInMonthGrosze: paidSocialInMonth,
      paidHealthInsuranceInMonthGrosze: paidHealthInMonth,
    });
    const ryczaltTaxObl =
      company.taxProfile.profileCode === 'jdg_ryczalt'
        ? this.computeCompanyPeriodTaxObligationsInternal(company, period)
        : null;
    const dueTaxGrosze = ryczaltTaxObl ? ryczaltTaxObl.incomeTaxAccruedGrosze : calc.taxDueGrosze;

    const revenueByRate: Record<string, number> = {};
    for (const rateCode of RYCZALT_RATE_ORDER) {
      const found = calc.breakdownByRate.find((b) => b.rate === rateCode);
      if (found && found.rawNetRevenueGrosze !== 0) {
        revenueByRate[rateCode] = found.rawNetRevenueGrosze;
      }
    }

    const yearPrefix = period.slice(0, 4);
    const ytdSalesGrosze = Math.max(
      0,
      company.ryczaltEntries
        .filter((e) => e.period.startsWith(yearPrefix) && e.period <= period)
        .reduce((acc, e) => acc + e.revenueGrosze, 0),
    );
    const vatLimitEval = evaluateVatExemptionLimit({
      eventDate: `${period}-28`,
      activityStartDate: company.taxProfile.activityStartDate,
      cumulativeNetSalesBeforeGrosze: ytdSalesGrosze,
      currentTransactionNetGrosze: 0,
    });
    const limitGrosze = vatLimitEval.proportionalLimitGrosze;
    const remaining = Math.max(0, vatLimitEval.remainingLimitGrosze);
    const utilizationBps =
      limitGrosze > 0 ? Math.min(100_000, Math.round((ytdSalesGrosze * 10_000) / limitGrosze)) : 0;
    const limitStatus: 'within_limit' | 'approaching_limit' | 'exceeded' =
      vatLimitEval.status === 'already_exceeded' ||
      vatLimitEval.status === 'exceeded_by_current_transaction'
        ? 'exceeded'
        : utilizationBps >= 8000
          ? 'approaching_limit'
          : 'within_limit';

    return RyczaltViewResponseSchema.parse({
      period,
      entries: periodEntries,
      monthlySummary: {
        grossRevenueGrosze: calc.totalNetRevenueGrosze,
        grossRevenueFormatted: formatPlnFromGrosze(calc.totalNetRevenueGrosze),
        taxDueRoundedPlnGrosze: dueTaxGrosze,
        taxDueFormatted: formatPlnFromGrosze(dueTaxGrosze),
        revenueByRate,
        explanation: ryczaltTaxObl ? ryczaltTaxObl.explanation : calc.explanation,
      },
      vatExemptionLimit: {
        limitGrosze,
        limitFormatted: formatPlnFromGrosze(limitGrosze),
        ytdSalesGrosze,
        ytdSalesFormatted: formatPlnFromGrosze(ytdSalesGrosze),
        remainingLimitGrosze: remaining,
        remainingLimitFormatted: formatPlnFromGrosze(remaining),
        utilizationBps,
        status: limitStatus,
        explanation: vatLimitEval.explanation,
      },
    });
  }

  createRyczaltManualEntry(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: CreateRyczaltEntryRequest,
  ): RyczaltEntryContract {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'create_ryczalt_entry',
    );
    assertAccountingRegimeSupportsAction(company.taxProfile.profileCode, 'ryczalt_manual_write');
    const req = CreateRyczaltEntryRequestSchema.parse(rawRequest);
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      req.revenueDate.slice(0, 7),
      `ręczny wpis ryczałtu (${req.documentNumber})`,
    );
    if (!req.isCorrection && !req.correctedEntryId) {
      this.assertNoManualLedgerDuplicateForPosting({
        company,
        direction: 'sales',
        documentNumber: req.documentNumber,
        counterpartyNip: req.counterpartyNip,
        counterpartyName: req.counterpartyName,
        ksefReferenceNumber: req.ksefReferenceNumber,
        isCorrection: false,
      });
    }
    const entry = createRyczaltEntry({
      id: randomUUID(),
      ordinalNumber: company.ryczaltEntries.length + 1,
      entryDate: req.entryDate ?? req.revenueDate,
      revenueDate: req.revenueDate,
      documentNumber: req.documentNumber,
      ...(req.ksefReferenceNumber ? { ksefReferenceNumber: req.ksefReferenceNumber } : {}),
      counterpartyName: req.counterpartyName,
      ...(req.counterpartyNip ? { counterpartyNip: req.counterpartyNip } : {}),
      rate: req.rate,
      revenueGrosze: req.revenueGrosze,
      ...(req.remarks ? { remarks: req.remarks } : {}),
      ...(req.isCorrection !== undefined ? { isCorrection: req.isCorrection } : {}),
      ...(req.correctedEntryId ? { correctedEntryId: req.correctedEntryId } : {}),
      ...(req.correctionReason ? { correctionReason: req.correctionReason } : {}),
    });
    company.ryczaltEntries.push(entry);
    this.store.saveCompany(company);
    return RyczaltEntrySchema.parse(entry);
  }

  private calculateCompanyVatSettlementForPeriod(
    company: WorkspaceCompanyState,
    targetPeriod: string,
  ): {
    readonly jpk: JpkV7mDeclarationSummary;
    readonly storedSettlement: VatPeriodSettlementState | null;
    readonly requiresCorrection: boolean;
  } {
    const settlementsMap =
      company.vatPeriodSettlements ?? new Map<string, VatPeriodSettlementState>();
    const candidatePeriods = [
      ...company.vatEntries.map((e) => e.period),
      ...settlementsMap.keys(),
    ].filter((p) => /^\d{4}-(0[1-9]|1[0-2])$/.test(p) && p <= targetPeriod);

    if (candidatePeriods.length === 0) {
      const emptyJpk = calculateJpkV7mSummary({
        period: targetPeriod,
        entries: [],
      });
      return { jpk: emptyJpk, storedSettlement: null, requiresCorrection: false };
    }

    candidatePeriods.sort();
    let currentPeriod = candidatePeriods[0]!;
    let carryOverGrosze = 0;
    let lastJpk: JpkV7mDeclarationSummary | null = null;
    let guard = 0;

    while (currentPeriod <= targetPeriod && guard < 240) {
      guard += 1;
      const stored = settlementsMap.get(currentPeriod);
      const periodEntries = company.vatEntries.filter((e) => e.period === currentPeriod);
      const preliminary = calculateJpkV7mSummary({
        period: currentPeriod,
        entries: periodEntries,
        carryOverInputVatFromPreviousPeriodGrosze: carryOverGrosze,
      });
      const requestedRefundGrosze = stored
        ? Math.min(stored.refundRequestedP54Grosze, preliminary.excessInputVatToCarryOverP53Grosze)
        : 0;
      const resolvedJpk =
        requestedRefundGrosze > 0
          ? calculateJpkV7mSummary({
              period: currentPeriod,
              entries: periodEntries,
              carryOverInputVatFromPreviousPeriodGrosze: carryOverGrosze,
              refundRequestedP54Grosze: requestedRefundGrosze,
            })
          : preliminary;

      carryOverGrosze = resolvedJpk.carryForwardToNextPeriodP62Grosze;
      lastJpk = resolvedJpk;
      if (currentPeriod === targetPeriod) {
        break;
      }
      currentPeriod = nextMonthPeriod(currentPeriod);
    }

    const jpk =
      lastJpk ??
      calculateJpkV7mSummary({
        period: targetPeriod,
        entries: company.vatEntries.filter((e) => e.period === targetPeriod),
      });
    const storedSettlement = settlementsMap.get(targetPeriod) ?? null;
    const requiresCorrection =
      storedSettlement?.status === 'finalized' &&
      (storedSettlement.taxDueP51Grosze !== jpk.taxDueToPayP51Grosze ||
        storedSettlement.carryForwardP62Grosze !== jpk.carryForwardToNextPeriodP62Grosze ||
        storedSettlement.carryOverFromPreviousP39Grosze !== jpk.carryOverFromPreviousPlnGrosze ||
        storedSettlement.refundRequestedP54Grosze !== jpk.refundToBankAccountP54Grosze);

    return { jpk, storedSettlement, requiresCorrection };
  }

  configureVatPeriodSettlement(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: ConfigureVatPeriodSettlementRequest,
  ): VatViewResponse {
    const { company, uId, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'configure_vat_period_settlement',
    );
    const req = ConfigureVatPeriodSettlementRequestSchema.parse(rawRequest);
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      req.period,
      `konfiguracja rozliczenia VAT za ${req.period}`,
    );
    if (company.taxProfile.vatStatus !== 'czynny') {
      throw new AccountingWorkspaceValidationError(
        422,
        'vat_settlement_not_applicable',
        'Podmiot zwolniony z VAT nie składa rozliczenia deklaracyjnego JPK_V7M.',
      );
    }

    company.vatPeriodSettlements ??= new Map<string, VatPeriodSettlementState>();
    const existing = company.vatPeriodSettlements.get(req.period) ?? null;
    if (existing?.status === 'finalized' && !req.isCorrection) {
      throw new AccountingWorkspaceConflictError(
        'vat_period_finalized',
        `Rozliczenie VAT za okres ${req.period} zostało już sfinalizowane (wersja ${existing.version}). Przekaż isCorrection=true oraz correctionReason, aby zapisać korektę deklaracji.`,
      );
    }
    if (req.isCorrection && (!req.correctionReason || req.correctionReason.trim().length < 3)) {
      throw new AccountingWorkspaceValidationError(
        422,
        'correction_reason_required',
        'Korekta sfinalizowanego rozliczenia VAT wymaga podania uzasadnienia (correctionReason).',
      );
    }

    // Wylicz bieżącą nadwyżkę P_53 z uwzględnieniem przeniesienia z poprzednich okresów przed walidacją P_54
    const prevPeriod = previousMonthPeriod(req.period);
    const prevCarryForward =
      req.period > '1900-01'
        ? this.calculateCompanyVatSettlementForPeriod(company, prevPeriod).jpk
            .carryForwardToNextPeriodP62Grosze
        : 0;
    const baseJpk = calculateJpkV7mSummary({
      period: req.period,
      entries: company.vatEntries.filter((e) => e.period === req.period),
      carryOverInputVatFromPreviousPeriodGrosze: prevCarryForward,
    });

    const refundRequested = req.refundRequestedP54Grosze ?? existing?.refundRequestedP54Grosze ?? 0;
    let finalJpk: JpkV7mDeclarationSummary;
    try {
      finalJpk = calculateJpkV7mSummary({
        period: req.period,
        entries: company.vatEntries.filter((e) => e.period === req.period),
        carryOverInputVatFromPreviousPeriodGrosze: prevCarryForward,
        refundRequestedP54Grosze: refundRequested,
      });
    } catch (err) {
      throw new AccountingWorkspaceValidationError(
        422,
        'vat_refund_exceeds_excess',
        err instanceof Error
          ? err.message
          : `Wnioskowany zwrot VAT na rachunek bankowy (P_54) przekracza nadwyżkę VAT naliczonego nad należnym (${formatPlnFromGrosze(baseJpk.excessInputVatToCarryOverP53Grosze)}).`,
      );
    }

    const nextStatus: 'draft' | 'finalized' =
      req.finalize === true
        ? 'finalized'
        : req.finalize === false
          ? 'draft'
          : (existing?.status ?? 'draft');
    const nextVersion = existing ? existing.version + 1 : 1;
    const settlementState: VatPeriodSettlementState = {
      period: req.period,
      version: nextVersion,
      status: nextStatus,
      refundRequestedP54Grosze: finalJpk.refundToBankAccountP54Grosze,
      carryOverFromPreviousP39Grosze: finalJpk.carryOverFromPreviousPlnGrosze,
      carryForwardP62Grosze: finalJpk.carryForwardToNextPeriodP62Grosze,
      taxDueP51Grosze: finalJpk.taxDueToPayP51Grosze,
      updatedAt: this.nowIso(),
      updatedByUserId: uId,
      correctionReason: req.correctionReason?.trim() ?? existing?.correctionReason ?? null,
    };
    company.vatPeriodSettlements.set(req.period, settlementState);
    this.store.saveCompany(company);

    this.recordAudit({
      channel: 'accounting',
      action: 'vat_period_settlement_configured',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: req.isCorrection ? 'vat_settlement_corrected' : 'vat_settlement_saved',
      summaryPl: `Zapisano rozliczenie VAT za ${req.period} (status: ${nextStatus}, v${nextVersion}, P_51=${formatPlnFromGrosze(finalJpk.taxDueToPayP51Grosze)}, P_54=${formatPlnFromGrosze(finalJpk.refundToBankAccountP54Grosze)}, P_62=${formatPlnFromGrosze(finalJpk.carryForwardToNextPeriodP62Grosze)}).`,
    });

    return this.getVatView(actor, rawTenantId, rawLegalEntityId, req.period);
  }

  getVatView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period: string = DEMO_DEFAULT_PERIOD,
  ): VatViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_vat_view',
    );
    const periodVat = company.vatEntries.filter((e) => e.period === period);
    const salesEntries = periodVat.filter((e) => e.registerType === 'sales');
    const purchaseEntries = periodVat.filter((e) => e.registerType === 'purchase');

    if (company.taxProfile.vatStatus !== 'czynny') {
      const yearPrefix = period.slice(0, 4);
      const ytdSalesGrosze = Math.max(
        0,
        company.ryczaltEntries
          .filter((e) => e.period.startsWith(yearPrefix) && e.period <= period)
          .reduce((acc, e) => acc + e.revenueGrosze, 0) +
          company.kpirEntries
            .filter((e) => e.period.startsWith(yearPrefix) && e.period <= period)
            .reduce((acc, e) => acc + e.col9TotalRevenueGrosze, 0),
      );
      const limitEval = evaluateVatExemptionLimit({
        eventDate: `${period}-28`,
        activityStartDate: company.taxProfile.activityStartDate,
        cumulativeNetSalesBeforeGrosze: ytdSalesGrosze,
      });
      const limitStatus: 'within_limit' | 'approaching_limit' | 'exceeded' =
        limitEval.status === 'already_exceeded' ||
        limitEval.status === 'exceeded_by_current_transaction'
          ? 'exceeded'
          : ytdSalesGrosze * 100 >= limitEval.proportionalLimitGrosze * 80
            ? 'approaching_limit'
            : 'within_limit';

      return VatViewResponseSchema.parse({
        period,
        vatStatus: company.taxProfile.vatStatus,
        salesEntries,
        purchaseEntries,
        jpkV7m: null,
        vatExemptionLimit: {
          limitGrosze: limitEval.proportionalLimitGrosze,
          ytdSalesGrosze,
          remainingLimitGrosze: Math.max(0, limitEval.remainingLimitGrosze),
          status: limitStatus,
          explanation: limitEval.explanation,
        },
      });
    }

    const { jpk, storedSettlement, requiresCorrection } =
      this.calculateCompanyVatSettlementForPeriod(company, period);
    const df = jpk.declarationFields;

    const ksefMarkersSummary = {
      NrKSeF: periodVat.filter((e) => e.ksefMarker === 'NrKSeF').length,
      OFF: periodVat.filter((e) => e.ksefMarker === 'OFF').length,
      BFK: periodVat.filter((e) => e.ksefMarker === 'BFK').length,
      DI: periodVat.filter((e) => e.ksefMarker === 'DI').length,
    };

    const schemaCode: 'JPK_V7M(2)' | 'JPK_V7M(3)' =
      period >= '2026-02' ? 'JPK_V7M(3)' : 'JPK_V7M(2)';

    return VatViewResponseSchema.parse({
      period,
      vatStatus: company.taxProfile.vatStatus,
      salesEntries,
      purchaseEntries,
      jpkV7m: {
        schemaCode,
        period,
        fields: {
          ...(df.P_10 !== 0 ? { P_10: df.P_10 } : {}),
          ...(df.P_11 !== 0 ? { P_11: df.P_11 } : {}),
          ...(df.P_13 !== 0 ? { P_13: df.P_13 } : {}),
          ...(df.P_15 !== 0 || df.P_16 !== 0 ? { P_15: df.P_15, P_16: df.P_16 } : {}),
          ...(df.P_17 !== 0 || df.P_18 !== 0 ? { P_17: df.P_17, P_18: df.P_18 } : {}),
          P_19: df.P_19,
          P_20: df.P_20,
          P_37: df.P_37,
          P_38: df.P_38,
          P_39: df.P_39,
          ...(df.P_40 !== 0 || df.P_41 !== 0 ? { P_40: df.P_40, P_41: df.P_41 } : {}),
          P_42: df.P_42,
          P_43: df.P_43,
          P_48: df.P_48,
          P_51: df.P_51,
          P_53: df.P_53,
          ...(df.P_54 !== 0 ? { P_54: df.P_54 } : {}),
          P_62: df.P_62,
        },
        outputVatRoundedPlnGrosze: jpk.outputVatRoundedPlnGrosze,
        inputVatDeductibleRoundedPlnGrosze: jpk.totalInputVatPlnGrosze,
        carryOverFromPreviousPeriodP39Grosze: jpk.carryOverFromPreviousPlnGrosze,
        taxDueP51Grosze: jpk.taxDueToPayP51Grosze,
        taxDueP51Formatted: formatPlnFromGrosze(jpk.taxDueToPayP51Grosze),
        excessInputVatP53Grosze: jpk.excessInputVatToCarryOverP53Grosze,
        excessInputVatP53Formatted: formatPlnFromGrosze(jpk.excessInputVatToCarryOverP53Grosze),
        refundToBankAccountP54Grosze: jpk.refundToBankAccountP54Grosze,
        refundToBankAccountP54Formatted: formatPlnFromGrosze(jpk.refundToBankAccountP54Grosze),
        carryForwardToNextPeriodP62Grosze: jpk.carryForwardToNextPeriodP62Grosze,
        carryForwardToNextPeriodP62Formatted: formatPlnFromGrosze(
          jpk.carryForwardToNextPeriodP62Grosze,
        ),
        settlementStatus: storedSettlement?.status ?? 'draft',
        settlementVersion: storedSettlement?.version ?? 1,
        requiresCorrection,
        ksefMarkersSummary,
        explanation: jpk.explanation,
      },
      vatExemptionLimit: null,
    });
  }

  getLedgerView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period = DEMO_DEFAULT_PERIOD,
  ): LedgerViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_ledger_view',
    );

    const chartOfAccounts = STANDARD_SPZOO_CHART_OF_ACCOUNTS.map((acc) => {
      const mapped = mapLedgerNatureToContract(acc.nature);
      return {
        code: acc.code,
        name: acc.name,
        accountClass: acc.classGroup,
        kind: mapped.kind,
        normalBalanceSide: mapped.normalBalanceSide,
      };
    });

    const entriesUpToPeriod = company.journalEntries.filter((je) => je.period <= period);
    const trial = generateTrialBalance(entriesUpToPeriod);
    const bs = generateBalanceSheet(entriesUpToPeriod);
    const pnl = generateProfitAndLoss(entriesUpToPeriod);

    const ytdCitNkupGrosze = this.computeYtdCitNkupGroszeInternal(company, period);
    const citObligations =
      company.taxProfile.profileCode === 'spzoo_pelne_ksiegi'
        ? this.computeCompanyPeriodTaxObligationsInternal(company, period)
        : null;
    const fallbackCit = citObligations
      ? null
      : calculateCitAdvance({
          period,
          ytdTaxableRevenuesGrosze: pnl.totalRevenuesGrosze,
          ytdTaxDeductibleCostsGrosze: Math.max(
            0,
            pnl.totalOperatingAndFinancialExpensesGrosze - ytdCitNkupGrosze,
          ),
          smallTaxpayerStatus: false,
        });
    const appliedCitRatePct =
      citObligations?.citRateDetails?.operatingAppliedRatePct ?? fallbackCit!.appliedRatePct;
    const citTaxableIncomeGrosze =
      citObligations?.citRateDetails?.operatingIncomeYtdGrosze ??
      Math.max(0, fallbackCit!.ytdTaxIncomeGrosze);
    const citAdvanceDueGrosze =
      citObligations?.incomeTaxAccruedGrosze ?? fallbackCit!.advanceDueGrosze;
    const citExplanation = citObligations?.explanation ?? fallbackCit!.explanation;

    return LedgerViewResponseSchema.parse({
      period,
      chartOfAccounts,
      journalEntries: entriesUpToPeriod,
      trialBalance: {
        rows: trial.rows.map((r) => ({
          accountCode: r.accountCode,
          accountName: r.accountName,
          turnoverWnGrosze: r.turnoverWnGrosze,
          turnoverMaGrosze: r.turnoverMaGrosze,
          endingBalanceWnGrosze: r.endingBalanceWnGrosze,
          endingBalanceMaGrosze: r.endingBalanceMaGrosze,
        })),
        totalTurnoverWnGrosze: trial.totalTurnoverWnGrosze,
        totalTurnoverMaGrosze: trial.totalTurnoverMaGrosze,
        totalEndingBalanceWnGrosze: trial.totalEndingBalanceWnGrosze,
        totalEndingBalanceMaGrosze: trial.totalEndingBalanceMaGrosze,
        isBalanced: trial.isBalanced,
      },
      balanceSheet: {
        fixedAssetsGrosze: bs.fixedAssetsNetGrosze,
        currentAssetsGrosze: bs.currentAssetsGrosze,
        totalAssetsGrosze: bs.totalAssetsGrosze,
        totalAssetsFormatted: formatPlnFromGrosze(bs.totalAssetsGrosze),
        equityTotalGrosze: bs.totalEquityGrosze,
        liabilitiesAndProvisionsGrosze: bs.totalLiabilitiesGrosze,
        totalEquityAndLiabilitiesGrosze: bs.totalEquityAndLiabilitiesGrosze,
        totalEquityAndLiabilitiesFormatted: formatPlnFromGrosze(bs.totalEquityAndLiabilitiesGrosze),
        isBalanced: bs.isBalanced,
      },
      profitAndLoss: {
        salesRevenueGrosze: pnl.totalRevenuesGrosze,
        operatingCostsGrosze: pnl.totalOperatingAndFinancialExpensesGrosze,
        grossFinancialResultGrosze: pnl.grossProfitOrLossGrosze,
        incomeTaxCitGrosze: pnl.citTaxBookedGrosze,
        netFinancialResultGrosze: pnl.netProfitOrLossGrosze,
        netFinancialResultFormatted: formatPlnFromGrosze(pnl.netProfitOrLossGrosze),
      },
      citAdvance: {
        citRateKind: appliedCitRatePct === 9 ? 'small_9' : 'standard_19',
        citRateBps: appliedCitRatePct === 9 ? 900 : 1900,
        taxableIncomeGrosze: citTaxableIncomeGrosze,
        citAdvanceDueRoundedPlnGrosze: citAdvanceDueGrosze,
        citAdvanceDueFormatted: formatPlnFromGrosze(citAdvanceDueGrosze),
        explanation: citExplanation,
      },
    });
  }

  createJournalEntry(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: CreateJournalEntryRequest,
  ): JournalEntryContract {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'create_journal_entry',
    );
    assertAccountingRegimeSupportsAction(
      company.taxProfile.profileCode,
      'full_ledger_manual_write',
    );
    const req = CreateJournalEntryRequestSchema.parse(rawRequest);
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      req.bookingDate.slice(0, 7),
      `księgowanie dekretu ${req.documentNumber}`,
    );
    const hasRedStornoLine = req.lines.some((l) => l.isRedStorno === true);
    if (!hasRedStornoLine) {
      const docNumNorm = normalizeCanonicalDocNumber(req.documentNumber);
      const postedDocDup = company.documents.find(
        (d) =>
          d.status === 'posted' &&
          !d.isCorrection &&
          normalizeCanonicalDocNumber(d.document.documentNumber) === docNumNorm,
      );
      if (postedDocDup) {
        throw new AccountingWorkspaceConflictError(
          'duplicate_economic_operation',
          `Ten dokument (${req.documentNumber}) został już zaksięgowany (ID: ${postedDocDup.documentId}). Aby skorygować dekret, użyj linii ze stornem czerwonym (isRedStorno: true).`,
        );
      }
      const existingJeDup = company.journalEntries.find(
        (je) =>
          !je.lines.some((l) => l.isRedStorno) &&
          normalizeCanonicalDocNumber(je.documentNumber) === docNumNorm,
      );
      if (existingJeDup) {
        throw new AccountingWorkspaceConflictError(
          'duplicate_economic_operation',
          `Dokument źródłowy ${req.documentNumber} posiada już dekret w dzienniku (${existingJeDup.entryNumber}). Zaksięguj storno czerwone (isRedStorno: true) zamiast duplikowania operacji.`,
        );
      }
    }
    const period = req.bookingDate.slice(0, 7);
    const entryNumber =
      req.entryNumber ??
      `PK/${period}/${String(company.journalEntries.length + 1).padStart(3, '0')}`;

    let validated: JournalEntry;
    try {
      validated = createValidatedJournalEntry({
        id: randomUUID(),
        entryNumber,
        bookingDate: req.bookingDate,
        documentDate: req.documentDate,
        documentNumber: req.documentNumber,
        description: req.description,
        lines: req.lines.map((l) => ({
          accountCode: l.accountCode,
          side: l.side,
          amountGrosze: l.amountGrosze,
          description: l.description,
          ...(l.isRedStorno !== undefined ? { isRedStorno: l.isRedStorno } : {}),
          ...(l.stornoReason !== undefined ? { stornoReason: l.stornoReason } : {}),
        })),
        closedPeriods: listClosedPeriods(company.periodCloseStates),
      });
    } catch (error) {
      if (error instanceof DoubleEntryValidationError) {
        throw new AccountingWorkspaceValidationError(422, 'double_entry_imbalance', error.message);
      }
      throw error;
    }

    company.journalEntries.push(validated);
    this.store.saveCompany(company);
    return JournalEntrySchema.parse(validated);
  }

  private buildFinanceResponseInternal(company: WorkspaceCompanyState): FinanceViewResponse {
    const asOfDate = this.todayIso();
    const refreshedSettlements = company.settlements.map((s) => {
      const derived = deriveSettlementStatus(s.grossGrosze, s.settledGrosze, s.dueDate, asOfDate);
      return {
        ...s,
        status: derived.status,
        daysOverdue: derived.daysOverdue,
      };
    });
    company.settlements = refreshedSettlements;

    const openReceivablesGrosze = refreshedSettlements
      .filter((s) => s.direction === 'receivable' && s.remainingGrosze > 0)
      .reduce((acc, s) => acc + s.remainingGrosze, 0);
    const openPayablesGrosze = refreshedSettlements
      .filter((s) => s.direction === 'payable' && s.remainingGrosze > 0)
      .reduce((acc, s) => acc + s.remainingGrosze, 0);
    const overdueCount = refreshedSettlements.filter((s) => s.status === 'overdue').length;

    const matchedTxIds = new Set(
      company.reconciliationMatches
        .filter(
          (m) =>
            m.status === 'matched_exact' ||
            m.status === 'matched_partial' ||
            m.status === 'overpaid',
        )
        .map((m) => m.transactionId),
    );
    const unreconciledTransactionsCount = company.bankTransactions.filter(
      (tx) => !matchedTxIds.has(tx.transactionId),
    ).length;

    return FinanceViewResponseSchema.parse({
      settlements: refreshedSettlements,
      bankTransactions: company.bankTransactions,
      reconciliationMatches: company.reconciliationMatches,
      summary: {
        openReceivablesGrosze,
        openReceivablesFormatted: formatPlnFromGrosze(openReceivablesGrosze),
        openPayablesGrosze,
        openPayablesFormatted: formatPlnFromGrosze(openPayablesGrosze),
        overdueCount,
        unreconciledTransactionsCount,
      },
    });
  }

  getFinanceView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): FinanceViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_finance_view',
    );
    return this.buildFinanceResponseInternal(company);
  }

  importBankStatement(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: ImportBankStatementRequest,
  ): ImportBankStatementResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'import_bank_statement',
    );
    const req = ImportBankStatementRequestSchema.parse(rawRequest);
    return this.runWithInMemoryIdempotency(
      `importBankStatement:${company.tenantId}:${company.legalEntityId}:${actor.userId}`,
      actor.idempotencyKey,
      req,
      () => {
        const rawContent = (req.rawContent ?? req.content ?? '').trim();

        let parsedTxs: readonly BankStatementTransaction[];
        try {
          parsedTxs =
            req.format === 'mt940'
              ? parseMt940Statement(rawContent).transactions
              : parsePolishBankCsv(rawContent, { delimiter: req.delimiter ?? ';' });
        } catch (err) {
          throw new AccountingWorkspaceValidationError(
            422,
            'invalid_bank_statement',
            err instanceof Error
              ? err.message
              : 'Nie udało się przetworzyć pliku wyciągu bankowego.',
          );
        }

        const existingById = new Map(
          company.bankTransactions.map((t) => [t.transactionId, t] as const),
        );
        const newlyAdded: BankStatementTransaction[] = [];
        for (const tx of parsedTxs) {
          const existing = existingById.get(tx.transactionId);
          if (existing) {
            if (computeBankTxSemanticSignature(existing) !== computeBankTxSemanticSignature(tx)) {
              throw new AccountingWorkspaceConflictError(
                'bank_transaction_id_collision',
                `Wykryto kolizję referencji transakcji bankowej "${tx.transactionId}" z odmienną treścią (istniejąca kwota: ${existing.amountFormatted}, nowa: ${tx.amountFormatted}).`,
              );
            }
            continue;
          }
          assertPeriodOpenForWrite(
            company.periodCloseStates,
            tx.bookingDate.slice(0, 7),
            `import wyciągu bankowego (${tx.bookingDate})`,
          );
          company.bankTransactions.push(tx);
          newlyAdded.push(tx);
          existingById.set(tx.transactionId, tx);
        }

        const openItems: OpenInvoiceSettlementItem[] = company.settlements
          .filter((s) => s.remainingGrosze > 0)
          .map((s) => ({
            documentId: s.documentId,
            documentNumber: s.documentNumber,
            direction: s.direction === 'receivable' ? 'sales' : 'purchase',
            ...(s.counterpartyNip ? { counterpartyNip: s.counterpartyNip } : {}),
            remainingAmountGrosze: s.remainingGrosze,
          }));

        const matches = reconcileBankTransactions(newlyAdded, openItems);
        const shouldApply = req.applySettlements !== false;

        let matchedExactCount = 0;
        let unmatchedCount = 0;

        for (const match of matches) {
          if (match.status === 'matched_exact') {
            matchedExactCount += 1;
          } else if (match.status === 'unmatched' || match.status === 'ambiguous_manual_review') {
            unmatchedCount += 1;
          }

          let appliedAmountGrosze = 0;
          let nextRemainingForMatch = match.remainingDocumentAmountGrosze;
          let effectiveStatus = match.status;

          if (shouldApply && match.matchedDocumentId && match.settledAmountGrosze > 0) {
            const settlement = company.settlements.find(
              (s) => s.documentId === match.matchedDocumentId,
            );
            if (settlement && settlement.remainingGrosze > 0) {
              appliedAmountGrosze = Math.min(
                settlement.remainingGrosze,
                match.settledAmountGrosze,
                match.transactionAmountGrosze,
              );
              const nextSettled = settlement.settledGrosze + appliedAmountGrosze;
              const nextRemaining = Math.max(0, settlement.grossGrosze - nextSettled);
              const derived = deriveSettlementStatus(
                settlement.grossGrosze,
                nextSettled,
                settlement.dueDate,
                this.todayIso(),
              );
              Object.assign(settlement, {
                settledGrosze: nextSettled,
                remainingGrosze: nextRemaining,
                remainingFormatted: formatPlnFromGrosze(nextRemaining),
                status: derived.status,
                daysOverdue: derived.daysOverdue,
              });
              nextRemainingForMatch = nextRemaining;
              effectiveStatus = nextRemaining === 0 ? 'matched_exact' : 'matched_partial';
            } else {
              effectiveStatus = 'ambiguous_manual_review';
            }
          }
          company.reconciliationMatches.push({
            transactionId: match.transactionId,
            status: shouldApply ? effectiveStatus : match.status,
            ...(match.matchedDocumentId && (!shouldApply || appliedAmountGrosze > 0)
              ? { matchedDocumentId: match.matchedDocumentId }
              : {}),
            ...(match.matchedDocumentNumber && (!shouldApply || appliedAmountGrosze > 0)
              ? { matchedDocumentNumber: match.matchedDocumentNumber }
              : {}),
            candidateDocumentIds: [...match.candidateDocumentIds],
            matchedCriterion: match.matchedCriterion,
            transactionAmountGrosze: match.transactionAmountGrosze,
            settledAmountGrosze: shouldApply ? appliedAmountGrosze : 0,
            remainingDocumentAmountGrosze: nextRemainingForMatch,
            overpaymentGrosze: shouldApply
              ? Math.max(0, match.transactionAmountGrosze - appliedAmountGrosze)
              : match.overpaymentGrosze,
            notes: match.notes,
          });
        }

        if (shouldApply) {
          syncSpzooBankReconciliationJournalEntries({
            profileCode: company.taxProfile.profileCode,
            bankTransactions: company.bankTransactions,
            settlements: company.settlements,
            reconciliationMatches: company.reconciliationMatches,
            journalEntries: company.journalEntries,
            closedPeriods: listClosedPeriods(company.periodCloseStates),
          });
        }

        this.store.saveCompany(company);
        return ImportBankStatementResponseSchema.parse({
          importedTransactionsCount: newlyAdded.length,
          matchedExactCount,
          unmatchedCount,
          finance: this.buildFinanceResponseInternal(company),
        });
      },
    );
  }

  reconcileBank(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: ReconcileBankRequest,
  ): FinanceViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'reconcile_bank_manual',
    );
    const req = ReconcileBankRequestSchema.parse(rawRequest);
    return this.runWithInMemoryIdempotency(
      `reconcileBank:${company.tenantId}:${company.legalEntityId}:${actor.userId}`,
      actor.idempotencyKey,
      req,
      () => {
        const items = 'matches' in req ? req.matches : [req];

        const seenPairs = new Set<string>();
        const itemsByTxId = new Map<string, typeof items>();
        for (const item of items) {
          const pairKey = `${item.transactionId}::${item.settlementId}`;
          if (seenPairs.has(pairKey)) {
            throw new AccountingWorkspaceValidationError(
              422,
              'duplicate_allocation_in_batch',
              `Zduplikowana pozycja alokacji dla transakcji ${item.transactionId} i rozrachunku ${item.settlementId} w jednym żądaniu.`,
            );
          }
          seenPairs.add(pairKey);
          const tx = company.bankTransactions.find((t) => t.transactionId === item.transactionId);
          const settlement = company.settlements.find((s) => s.settlementId === item.settlementId);
          if (!tx || !settlement) {
            throw new AccountingWorkspaceAccessError(
              404,
              'reconcile_target_not_found',
              'Nie znaleziono transakcji bankowej lub rozrachunku do uzgodnienia.',
            );
          }
          const expectedSettlementDir = tx.direction === 'credit' ? 'receivable' : 'payable';
          if (settlement.direction !== expectedSettlementDir) {
            throw new AccountingWorkspaceValidationError(
              422,
              'payment_direction_mismatch',
              `Niezgodność kierunku przepływu: transakcja bankowa (${tx.direction}) nie może rozliczać rozrachunku typu ${settlement.direction}.`,
            );
          }
          assertPeriodOpenForWrite(
            company.periodCloseStates,
            tx.bookingDate.slice(0, 7),
            `uzgodnienie wyciągu bankowego (${tx.bookingDate})`,
          );
          const list = itemsByTxId.get(item.transactionId) ?? [];
          itemsByTxId.set(item.transactionId, [...list, item]);
        }

        // Pracujemy na transakcyjnej kopii roboczej rozrachunków i dopasowań, aby w razie błędu nie zostawić częściowej mutacji
        const workingSettlements = company.settlements.map((s) => ({ ...s }));
        const settlementById = new Map(workingSettlements.map((s) => [s.settlementId, s]));
        const settlementByDocId = new Map(workingSettlements.map((s) => [s.documentId, s]));
        let workingMatches = company.reconciliationMatches.map((m) => ({
          ...m,
          candidateDocumentIds: [...m.candidateDocumentIds],
        }));

        const asOfDate = this.todayIso();

        for (const [txId, txItems] of itemsByTxId.entries()) {
          const tx = company.bankTransactions.find((t) => t.transactionId === txId)!;

          // 1. Odwróć poprzednie aktywne alokacje tej transakcji bankowej (atomowa realokacja / idempotencja)
          const priorMatches = workingMatches.filter((m) => m.transactionId === txId);
          const priorBySettlementId = new Map<string, number>();
          for (const pm of priorMatches) {
            if (pm.matchedDocumentId && pm.settledAmountGrosze > 0) {
              const priorSettlement = settlementByDocId.get(pm.matchedDocumentId);
              if (priorSettlement) {
                const unwoundSettled = Math.max(
                  0,
                  priorSettlement.settledGrosze - pm.settledAmountGrosze,
                );
                const unwoundRemaining = priorSettlement.grossGrosze - unwoundSettled;
                const derived = deriveSettlementStatus(
                  priorSettlement.grossGrosze,
                  unwoundSettled,
                  priorSettlement.dueDate,
                  asOfDate,
                );
                Object.assign(priorSettlement, {
                  settledGrosze: unwoundSettled,
                  remainingGrosze: unwoundRemaining,
                  remainingFormatted: formatPlnFromGrosze(unwoundRemaining),
                  status: derived.status,
                  daysOverdue: derived.daysOverdue,
                });
                priorBySettlementId.set(
                  priorSettlement.settlementId,
                  (priorBySettlementId.get(priorSettlement.settlementId) ?? 0) +
                    pm.settledAmountGrosze,
                );
              }
            }
          }

          workingMatches = workingMatches.filter((m) => m.transactionId !== txId);

          // 2. Wylicz i zwaliduj nowe alokacje dla transakcji tx (suma alokacji + zweryfikowanych płatności publicznoprawnych <= kwota przelewu, każda <= otwarte saldo dokumentu)
          const verifiedTaxAllocatedGrosze = (company.verifiedTaxPayments ?? [])
            .filter((p) => p.bankTransactionId === tx.transactionId)
            .reduce((s, p) => s + p.amountGrosze, 0);
          const availableTxAmountGrosze = Math.max(0, tx.amountGrosze - verifiedTaxAllocatedGrosze);
          let allocatedTxTotalGrosze = 0;
          const plannedAllocations: {
            readonly settlement: SettlementItemContract;
            readonly applyGrosze: number;
          }[] = [];

          for (const item of txItems) {
            const targetSettlement = settlementById.get(item.settlementId)!;
            if (item.amountGrosze === 0) {
              continue;
            }
            const remainingTxBudget = availableTxAmountGrosze - allocatedTxTotalGrosze;
            if (item.amountGrosze !== undefined) {
              if (
                item.amountGrosze > availableTxAmountGrosze ||
                item.amountGrosze > remainingTxBudget
              ) {
                throw new AccountingWorkspaceValidationError(
                  422,
                  'allocation_exceeds_transaction_amount',
                  `Kwota alokacji (${formatPlnFromGrosze(item.amountGrosze)}) przekracza dostępną kwotę transakcji bankowej (${formatPlnFromGrosze(remainingTxBudget)} z ${formatPlnFromGrosze(tx.amountGrosze)}; rozdysponowano na ZUS/podatki: ${formatPlnFromGrosze(verifiedTaxAllocatedGrosze)}).`,
                );
              }
              if (targetSettlement.remainingGrosze <= 0) {
                throw new AccountingWorkspaceConflictError(
                  'settlement_already_settled',
                  `Rozrachunek dla dokumentu ${targetSettlement.documentNumber} jest już w pełni rozliczony.`,
                );
              }
              if (item.amountGrosze > targetSettlement.remainingGrosze) {
                throw new AccountingWorkspaceConflictError(
                  'allocation_exceeds_settlement_remaining',
                  `Kwota alokacji (${formatPlnFromGrosze(item.amountGrosze)}) przekracza otwarte saldo rozrachunku ${targetSettlement.documentNumber} (${formatPlnFromGrosze(targetSettlement.remainingGrosze)}).`,
                );
              }
              allocatedTxTotalGrosze += item.amountGrosze;
              plannedAllocations.push({
                settlement: targetSettlement,
                applyGrosze: item.amountGrosze,
              });
            } else {
              if (targetSettlement.remainingGrosze <= 0) {
                throw new AccountingWorkspaceConflictError(
                  'settlement_already_settled',
                  `Rozrachunek dla dokumentu ${targetSettlement.documentNumber} jest już w pełni rozliczony przez inną płatność.`,
                );
              }
              if (remainingTxBudget <= 0) {
                throw new AccountingWorkspaceValidationError(
                  422,
                  'allocation_exceeds_transaction_amount',
                  `Cała dostępna kwota transakcji bankowej (${formatPlnFromGrosze(availableTxAmountGrosze)} z ${formatPlnFromGrosze(tx.amountGrosze)}) została już rozdysponowana.`,
                );
              }
              const autoApply = Math.min(targetSettlement.remainingGrosze, remainingTxBudget);
              allocatedTxTotalGrosze += autoApply;
              plannedAllocations.push({
                settlement: targetSettlement,
                applyGrosze: autoApply,
              });
            }
          }

          // 3. Zastosuj zatwierdzone alokacje
          if (plannedAllocations.length === 0) {
            workingMatches.push({
              transactionId: tx.transactionId,
              status: 'unmatched',
              candidateDocumentIds: [],
              matchedCriterion: 'none',
              transactionAmountGrosze: tx.amountGrosze,
              settledAmountGrosze: 0,
              remainingDocumentAmountGrosze: 0,
              overpaymentGrosze: 0,
              notes: 'Wycofano ręczne przypisanie płatności — transakcja nierozliczona.',
            });
            continue;
          }

          const totalOverpayment = Math.max(0, availableTxAmountGrosze - allocatedTxTotalGrosze);
          for (let idx = 0; idx < plannedAllocations.length; idx += 1) {
            const alloc = plannedAllocations[idx]!;
            const nextSettled = alloc.settlement.settledGrosze + alloc.applyGrosze;
            const nextRemaining = Math.max(0, alloc.settlement.grossGrosze - nextSettled);
            const derived = deriveSettlementStatus(
              alloc.settlement.grossGrosze,
              nextSettled,
              alloc.settlement.dueDate,
              asOfDate,
            );
            Object.assign(alloc.settlement, {
              settledGrosze: nextSettled,
              remainingGrosze: nextRemaining,
              remainingFormatted: formatPlnFromGrosze(nextRemaining),
              status: derived.status,
              daysOverdue: derived.daysOverdue,
            });

            const status: BankReconciliationMatchContract['status'] =
              nextRemaining === 0
                ? totalOverpayment > 0 && plannedAllocations.length === 1
                  ? 'overpaid'
                  : 'matched_exact'
                : 'matched_partial';
            workingMatches.push({
              transactionId: tx.transactionId,
              status,
              matchedDocumentId: alloc.settlement.documentId,
              matchedDocumentNumber: alloc.settlement.documentNumber,
              candidateDocumentIds: [alloc.settlement.documentId],
              matchedCriterion: 'invoice_number_and_amount',
              transactionAmountGrosze: tx.amountGrosze,
              settledAmountGrosze: alloc.applyGrosze,
              remainingDocumentAmountGrosze: nextRemaining,
              overpaymentGrosze: idx === plannedAllocations.length - 1 ? totalOverpayment : 0,
              notes:
                plannedAllocations.length > 1
                  ? `Ręczne rozliczenie częściowe przelewu (${idx + 1}/${plannedAllocations.length}) na dokument ${alloc.settlement.documentNumber}.`
                  : 'Ręczne uzgodnienie rozrachunku przez księgowego.',
            });
          }
        }

        company.settlements = workingSettlements;
        company.reconciliationMatches = workingMatches;
        syncSpzooBankReconciliationJournalEntries({
          profileCode: company.taxProfile.profileCode,
          bankTransactions: company.bankTransactions,
          settlements: company.settlements,
          reconciliationMatches: company.reconciliationMatches,
          journalEntries: company.journalEntries,
          closedPeriods: listClosedPeriods(company.periodCloseStates),
        });
        this.store.saveCompany(company);
        return this.buildFinanceResponseInternal(company);
      },
    );
  }

  private buildPeriodObligationsInternal(
    company: WorkspaceCompanyState,
    period: string,
    asOfDate = this.todayIso(),
  ): CalendarObligationItemContract[] {
    const generated = generateTaxCalendarObligations(
      {
        profileCode: company.taxProfile.profileCode,
        supportLevel: company.taxProfile.supportLevel,
        vatStatus: company.taxProfile.vatStatus,
        vatSettlementPeriod: company.taxProfile.vatSettlementPeriod,
        zusApplicable:
          company.taxProfile.zusScheme !== 'not_applicable' ||
          (company.legalForm === 'sp_z_o_o' && company.taxProfile.insuredPersonsCount > 0),
        ksefSales2024Above200M: company.taxProfile.ksefSales2024Above200M,
        ...(company.taxProfile.ceidgRegisteredBefore2025 !== undefined
          ? { ceidgRegisteredBefore2025: company.taxProfile.ceidgRegisteredBefore2025 }
          : {}),
        ...(company.taxProfile.krsRegisteredBefore2025 !== undefined
          ? { krsRegisteredBefore2025: company.taxProfile.krsRegisteredBefore2025 }
          : {}),
      },
      period,
    );

    const zus = this.computeCompanyZusInternal(company, period);
    const jpk =
      company.taxProfile.vatStatus === 'czynny'
        ? this.calculateCompanyVatSettlementForPeriod(company, period).jpk
        : null;
    const taxObl = this.computeCompanyPeriodTaxObligationsInternal(company, period);
    const estimatedIncomeTaxGrosze = taxObl.incomeTaxAccruedGrosze;

    return generated.map((ob) => {
      const obligationId = deterministicUuidV4(
        `obligation:${company.tenantId}:${company.legalEntityId}:${ob.period}:${ob.code}`,
      );
      const paidAt =
        company.paidObligationsByKey.get(obligationId) ??
        company.paidObligationsByKey.get(`${ob.period}::${ob.code}`) ??
        null;

      const [y1, m1, d1] = ob.effectiveDueDate.split('-').map(Number);
      const [y2, m2, d2] = asOfDate.split('-').map(Number);
      const diffDays = Math.floor(
        (Date.UTC(y1 ?? 2026, (m1 ?? 1) - 1, d1 ?? 1) -
          Date.UTC(y2 ?? 2026, (m2 ?? 1) - 1, d2 ?? 1)) /
          86_400_000,
      );

      let estGrosze: number | null = null;
      let accruedGrosze: number | null = null;
      let paidGrosze: number | null = null;
      let remainingGrosze: number | null = null;
      if (ob.category === 'zus' && zus) {
        estGrosze = zus.totalZusToPayGrosze;
        const zusItems = taxObl.items.filter(
          (i) =>
            i.obligationKind === 'zus_social' ||
            i.obligationKind === 'zus_health' ||
            i.obligationKind === 'zus_labor_fund',
        );
        if (zusItems.length > 0) {
          accruedGrosze = zusItems.reduce((s, i) => s + i.accruedGrosze, 0);
          paidGrosze = zusItems.reduce((s, i) => s + i.paidGrosze, 0);
          remainingGrosze = zusItems.reduce((s, i) => s + i.remainingGrosze, 0);
        }
      } else if (ob.category === 'vat' && jpk) {
        estGrosze = jpk.taxDueToPayP51Grosze;
        const vatItem = taxObl.items.find((i) => i.obligationKind === 'vat_settlement');
        if (vatItem) {
          accruedGrosze = vatItem.accruedGrosze;
          paidGrosze = vatItem.paidGrosze;
          remainingGrosze = vatItem.remainingGrosze;
        }
      } else if (ob.category === 'pit' || ob.category === 'ryczalt' || ob.category === 'cit') {
        estGrosze = estimatedIncomeTaxGrosze;
        const incItem = taxObl.items.find(
          (i) =>
            i.obligationKind === 'pit_advance' ||
            i.obligationKind === 'ryczalt_advance' ||
            i.obligationKind === 'cit_advance',
        );
        if (incItem) {
          accruedGrosze = incItem.accruedGrosze;
          paidGrosze = incItem.paidGrosze;
          remainingGrosze = incItem.remainingGrosze;
        }
      }

      const settledByVerifiedPayment =
        accruedGrosze !== null &&
        accruedGrosze > 0 &&
        remainingGrosze === 0 &&
        (paidGrosze ?? 0) >= accruedGrosze;

      const workflowStatus: CalendarObligationItemContract['workflowStatus'] =
        paidAt || settledByVerifiedPayment
          ? 'paid'
          : diffDays < 0
            ? 'overdue'
            : diffDays <= 7
              ? 'due_soon'
              : 'upcoming';

      return {
        obligationId,
        code: ob.code,
        title: ob.title,
        category: ob.category,
        period: ob.period,
        statutoryDueDate: ob.statutoryDueDate,
        effectiveDueDate: ob.effectiveDueDate,
        shiftedFromNonWorkingDays: ob.shiftedFromNonWorkingDays.map((s) => ({
          date: s.date,
          reason: s.reason,
        })),
        applicabilityStatus: ob.status,
        workflowStatus,
        estimatedAmountGrosze: estGrosze,
        estimatedAmountFormatted: estGrosze !== null ? formatPlnFromGrosze(estGrosze) : null,
        ...(accruedGrosze !== null ? { accruedGrosze } : {}),
        ...(paidGrosze !== null ? { paidGrosze } : {}),
        ...(remainingGrosze !== null ? { remainingGrosze } : {}),
        paidAt,
        explanation: toContractExplanation(ob.explanation),
      };
    });
  }

  getCalendarView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    year = 2026,
    month: number | null = 3,
  ): CalendarViewResponse {
    const { company } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_calendar_view',
    );
    const periods =
      month !== null
        ? [`${year}-${String(month).padStart(2, '0')}`]
        : Array.from({ length: 12 }, (_, idx) => `${year}-${String(idx + 1).padStart(2, '0')}`);

    const obligations = periods.flatMap((p) => this.buildPeriodObligationsInternal(company, p));
    return CalendarViewResponseSchema.parse({
      year,
      month,
      obligations,
    });
  }

  updateObligationStatus(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    obligationIdOrCode: string,
    rawRequest: UpdateObligationStatusRequest,
    period = DEMO_DEFAULT_PERIOD,
  ): CalendarObligationItemContract {
    const { company, uId, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'update_obligation_status',
    );
    const req = UpdateObligationStatusRequestSchema.parse(rawRequest);
    const targetStatus = req.status ?? 'paid';

    const currentList = this.buildPeriodObligationsInternal(company, period);
    const matched = currentList.find(
      (o) => o.obligationId === obligationIdOrCode || o.code === obligationIdOrCode,
    );
    if (!matched) {
      throw new AccountingWorkspaceAccessError(
        404,
        'obligation_not_found',
        `Nie znaleziono zobowiązania kalendarza (${obligationIdOrCode}) w okresie ${period}.`,
      );
    }

    if (targetStatus === 'paid') {
      const nowIso = this.nowIso();
      company.paidObligationsByKey.set(matched.obligationId, nowIso);
      company.paidObligationsByKey.set(`${period}::${matched.code}`, nowIso);
    } else {
      company.paidObligationsByKey.delete(matched.obligationId);
      company.paidObligationsByKey.delete(`${period}::${matched.code}`);
    }
    this.store.saveCompany(company);

    this.recordAudit({
      channel: 'accounting',
      action: 'obligation_status_updated',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: 'obligation_workflow_updated',
      summaryPl: `Zmieniono status obowiązku ${matched.code} (${period}) na ${targetStatus}.`,
    });

    const refreshed = this.buildPeriodObligationsInternal(company, period).find(
      (o) => o.obligationId === matched.obligationId,
    )!;
    return refreshed;
  }

  getCompanyOverview(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period = DEMO_DEFAULT_PERIOD,
  ): CompanyOverviewResponse {
    const { company, uId, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_company_overview',
    );

    const companyItem = this.toAccessibleCompanyItem(company, uId, this.clock.now())!;
    const finance = this.buildFinanceResponseInternal(company);
    const zus = this.computeCompanyZusInternal(company, period);
    const zusTotalGrosze = zus?.totalZusToPayGrosze ?? 0;

    let revenueGrosze: number;
    let expensesKupGrosze: number;
    let incomeOrProfitGrosze: number;
    let incomeTaxLabelPl: string;
    let incomeTaxGrosze: number;
    let regimeComparison: RegimeComparisonSummary | null = null;

    const taxObl = this.computeCompanyPeriodTaxObligationsInternal(company, period);

    if (
      company.taxProfile.profileCode === 'jdg_kpir_skala' ||
      company.taxProfile.profileCode === 'jdg_kpir_liniowy'
    ) {
      const kpirSummary = summarizeKpirPeriod(company.kpirEntries, period);
      revenueGrosze = kpirSummary.monthTotals.col9TotalRevenueGrosze;
      expensesKupGrosze = kpirSummary.monthTotals.totalTaxDeductibleCostsGrosze;
      incomeOrProfitGrosze = kpirSummary.monthTotals.accountingIncomeGrosze;
      const taxForm = company.taxProfile.profileCode === 'jdg_kpir_liniowy' ? 'liniowy' : 'skala';
      incomeTaxLabelPl =
        taxForm === 'liniowy' ? 'Zaliczka PIT-36L (19%)' : 'Zaliczka PIT-36 (skala 12%/32%)';
      incomeTaxGrosze = taxObl.incomeTaxAccruedGrosze;
      regimeComparison = this.computeRegimeComparisonInternal(
        company,
        period,
        kpirSummary.yearToDateTotals.col9TotalRevenueGrosze,
        kpirSummary.yearToDateTotals.totalTaxDeductibleCostsGrosze,
        taxObl.paidSocialZusUsedInTaxBaseGrosze,
      );
    } else if (company.taxProfile.profileCode === 'jdg_ryczalt') {
      const rycz = calculateMonthlyRyczalt({
        period,
        entries: company.ryczaltEntries.filter((e) => e.period === period),
        paidSocialZusInMonthGrosze: 0,
        paidHealthInsuranceInMonthGrosze: 0,
      });
      revenueGrosze = rycz.totalNetRevenueGrosze;
      expensesKupGrosze = 0;
      incomeOrProfitGrosze = rycz.totalNetRevenueGrosze;
      incomeTaxLabelPl = 'Ryczałt od przychodów ewidencjonowanych (PIT-28)';
      incomeTaxGrosze = taxObl.incomeTaxAccruedGrosze;
    } else {
      const entriesUpTo = company.journalEntries.filter((je) => je.period <= period);
      const pnl = generateProfitAndLoss(entriesUpTo);
      const ytdCitNkupGrosze = this.computeYtdCitNkupGroszeInternal(company, period);
      revenueGrosze = pnl.totalRevenuesGrosze;
      expensesKupGrosze = Math.max(
        0,
        pnl.totalOperatingAndFinancialExpensesGrosze - ytdCitNkupGrosze,
      );
      incomeOrProfitGrosze = pnl.netProfitOrLossGrosze;
      const appliedRate = taxObl.citRateDetails?.operatingAppliedRatePct ?? 19;
      incomeTaxLabelPl = `Zaliczka CIT-8 (${appliedRate}%)`;
      incomeTaxGrosze = taxObl.incomeTaxAccruedGrosze;
    }

    let vatLabelPl = 'Zwolnienie z VAT (art. 113)';
    let vatPayableGrosze = 0;
    let vatCarryForwardGrosze = 0;
    if (company.taxProfile.vatStatus === 'czynny') {
      const { jpk } = this.calculateCompanyVatSettlementForPeriod(company, period);
      vatLabelPl = period >= '2026-02' ? 'VAT JPK_V7M(3)' : 'VAT JPK_V7M(2)';
      vatPayableGrosze = jpk.taxDueToPayP51Grosze;
      vatCarryForwardGrosze = jpk.carryForwardToNextPeriodP62Grosze;
    }

    const aiDocCount = company.documents.filter(
      (d) =>
        d.status === 'needs_verification' || d.status === 'ai_proposed' || d.status === 'draft',
    ).length;
    const mcpPendingCount = this.store
      .listMcpProposals(tId, leId)
      .filter((p) => p.status === 'pending_human_approval').length;

    const upcomingDeadlines = this.buildPeriodObligationsInternal(company, period).filter(
      (o) => o.applicabilityStatus === 'applicable',
    );

    const recentAuditEvents = this.store
      .listAuditEvents({ tenantId: tId, legalEntityId: leId })
      .slice(0, 10)
      .map((ev) => ({
        auditEventId: ev.auditEventId,
        occurredAt: ev.occurredAt,
        channel: ev.channel,
        action: ev.action,
        actorDisplayLabel: ev.actorDisplayLabel,
        outcome: ev.outcome,
        reasonCode: ev.reasonCode,
        summaryPl: ev.summaryPl,
      }));

    return CompanyOverviewResponseSchema.parse({
      company: companyItem,
      taxProfile: company.taxProfile,
      period,
      kpis: {
        revenueGrosze,
        revenueFormatted: formatPlnFromGrosze(revenueGrosze),
        expensesKupGrosze,
        expensesKupFormatted: formatPlnFromGrosze(expensesKupGrosze),
        incomeOrProfitGrosze,
        incomeOrProfitFormatted: formatPlnFromGrosze(incomeOrProfitGrosze),
        unpaidReceivablesGrosze: finance.summary.openReceivablesGrosze,
        unpaidReceivablesFormatted: finance.summary.openReceivablesFormatted,
        unpaidPayablesGrosze: finance.summary.openPayablesGrosze,
        unpaidPayablesFormatted: finance.summary.openPayablesFormatted,
        overdueInvoicesCount: finance.summary.overdueCount,
      },
      taxSummary: {
        incomeTaxLabelPl,
        incomeTaxGrosze,
        incomeTaxFormatted: formatPlnFromGrosze(incomeTaxGrosze),
        vatLabelPl,
        vatPayableGrosze,
        vatCarryForwardGrosze,
        vatFormatted: formatPlnFromGrosze(vatPayableGrosze),
        zusTotalGrosze,
        zusTotalFormatted: formatPlnFromGrosze(zusTotalGrosze),
        regimeComparison,
      },
      upcomingDeadlines,
      unpaidInvoices: finance.settlements.filter((s) => s.remainingGrosze > 0),
      pendingApprovals: {
        aiDocumentProposalsCount: aiDocCount,
        mcpProposalsCount: mcpPendingCount,
        totalPendingCount: aiDocCount + mcpPendingCount,
      },
      recentAuditEvents,
    });
  }

  getPeriodCloseStatus(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period: string,
  ): PeriodCloseStatusResponse {
    assertValidPeriodMonth(period);
    const { company, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_period_close_status',
    );
    const pendingMcpCount = this.store
      .listMcpProposals(tId, leId)
      .filter(
        (p) => p.status === 'pending_human_approval' && p.invoice.issueDate.startsWith(period),
      ).length;
    const evaluated = evaluatePeriodCloseStatus({
      tenantId: tId,
      legalEntityId: leId,
      period,
      profileCode: company.taxProfile.profileCode,
      documents: company.documents,
      pendingMcpProposalsCount: pendingMcpCount,
      bankTransactions: company.bankTransactions,
      reconciliationMatches: company.reconciliationMatches,
      verifiedTaxPayments: company.verifiedTaxPayments,
      journalEntries: company.journalEntries,
      existingState: company.periodCloseStates?.get(period),
    });
    return PeriodCloseStatusResponseSchema.parse(evaluated);
  }

  closeAccountingPeriod(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period: string,
    rawRequest: CloseAccountingPeriodRequest,
  ): PeriodCloseStatusResponse {
    assertValidPeriodMonth(period);
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'close_accounting_period',
    );
    this.assertHumanApprovalActorScopes(actor, tId, leId, 'close_accounting_period');
    const req = CloseAccountingPeriodRequestSchema.parse(rawRequest);

    return this.runWithInMemoryIdempotency(
      `closeAccountingPeriod:${tId}:${leId}:${uId}:${period}`,
      actor.idempotencyKey,
      req,
      () => {
        company.periodCloseStates ??= new Map<string, PeriodCloseState>();
        const pendingMcpCount = this.store
          .listMcpProposals(tId, leId)
          .filter(
            (p) => p.status === 'pending_human_approval' && p.invoice.issueDate.startsWith(period),
          ).length;
        const evaluatedBefore = evaluatePeriodCloseStatus({
          tenantId: tId,
          legalEntityId: leId,
          period,
          profileCode: company.taxProfile.profileCode,
          documents: company.documents,
          pendingMcpProposalsCount: pendingMcpCount,
          bankTransactions: company.bankTransactions,
          reconciliationMatches: company.reconciliationMatches,
          verifiedTaxPayments: company.verifiedTaxPayments,
          journalEntries: company.journalEntries,
          existingState: company.periodCloseStates.get(period),
        });

        const nextState = transitionPeriodCloseState({
          evaluated: evaluatedBefore,
          existingState: company.periodCloseStates.get(period),
          actorUserId: uId,
          nowIso: this.nowIso(),
          confirmClose: req.confirmClose,
          requestedStatus: req.status,
          note: req.note,
        });
        company.periodCloseStates.set(period, nextState);
        this.store.saveCompany(company);

        this.recordAudit({
          channel: 'accounting',
          action:
            nextState.status === 'closed'
              ? 'accounting_period_closed'
              : 'accounting_period_reconciling',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'allow',
          reasonCode:
            nextState.status === 'closed' ? 'period_closed_by_human' : 'period_marked_reconciling',
          summaryPl:
            nextState.status === 'closed'
              ? `Zamknięto okres sprawozdawczy ${period} (v${nextState.version}).${nextState.note ? ` Notatka: ${nextState.note}` : ''}`
              : `Oznaczono okres sprawozdawczy ${period} jako w trakcie uzgadniania (v${nextState.version}).`,
        });

        const evaluatedAfter = evaluatePeriodCloseStatus({
          tenantId: tId,
          legalEntityId: leId,
          period,
          profileCode: company.taxProfile.profileCode,
          documents: company.documents,
          pendingMcpProposalsCount: pendingMcpCount,
          bankTransactions: company.bankTransactions,
          reconciliationMatches: company.reconciliationMatches,
          verifiedTaxPayments: company.verifiedTaxPayments,
          journalEntries: company.journalEntries,
          existingState: nextState,
        });
        return PeriodCloseStatusResponseSchema.parse(evaluatedAfter);
      },
    );
  }

  getPeriodTaxObligations(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    period: string = DEMO_DEFAULT_PERIOD,
    options?: {
      readonly requestPreferentialCit9Pct?: boolean | undefined;
    },
  ): PeriodTaxObligationsResponse {
    assertValidPeriodMonth(period);
    const { company, tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_period_tax_obligations',
    );
    const computed = this.computeCompanyPeriodTaxObligationsInternal(company, period, {
      requestPreferentialCit9Pct: options?.requestPreferentialCit9Pct,
    });
    const periodVerifiedPayments = (company.verifiedTaxPayments ?? []).filter(
      (p) => p.targetPeriod === period || p.paidDate.startsWith(period),
    );
    return PeriodTaxObligationsResponseSchema.parse({
      tenantId: tId,
      legalEntityId: leId,
      period,
      profileCode: computed.profileCode,
      evaluationDate: computed.evaluationDate,
      bindingForDeclaration: computed.bindingForDeclaration,
      items: computed.items,
      verifiedPayments: periodVerifiedPayments,
      totals: computed.totals,
      paidSocialZusUsedInTaxBaseGrosze: computed.paidSocialZusUsedInTaxBaseGrosze,
      paidHealthZusUsedInTaxBaseGrosze: computed.paidHealthZusUsedInTaxBaseGrosze,
      citRateDetails: computed.citRateDetails,
      explanation: toContractExplanation(computed.explanation),
    });
  }

  recordVerifiedTaxPayment(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: RecordVerifiedTaxPaymentRequest,
  ): PeriodTaxObligationsResponse {
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'record_verified_tax_payment',
    );
    const req = RecordVerifiedTaxPaymentRequestSchema.parse(rawRequest);

    return this.runWithInMemoryIdempotency(
      `recordVerifiedTaxPayment:${tId}:${leId}:${uId}`,
      actor.idempotencyKey,
      req,
      () => {
        company.verifiedTaxPayments ??= [];
        const matchedBankTx = company.bankTransactions.find(
          (t) =>
            t.transactionId === req.bankTransactionId ||
            deterministicUuidV4(`bank-tx:${tId}:${leId}:${t.transactionId}`).toLowerCase() ===
              req.bankTransactionId.toLowerCase(),
        );
        if (!matchedBankTx || matchedBankTx.direction !== 'debit') {
          throw new AccountingWorkspaceValidationError(
            422,
            'unverified_bank_transaction_reference',
            `Dowód zapłaty zobowiązania publicznoprawnego wymaga istniejącej transakcji obciążeniowej (debit) na wyciągu bankowym firmy (brak transakcji "${req.bankTransactionId}").`,
          );
        }

        if (req.paidDate !== matchedBankTx.bookingDate) {
          throw new AccountingWorkspaceValidationError(
            422,
            'payment_date_mismatch_with_bank_transaction',
            `Data zapłaty zobowiązania (${req.paidDate}) musi odpowiadać dacie księgowania powiązanego przelewu bankowego (${matchedBankTx.bookingDate}).`,
          );
        }

        const canonicalTxId = matchedBankTx.transactionId;
        const resolvedPaymentId =
          req.paymentId?.trim() ||
          deterministicUuidV4(
            `tax-pay:${tId}:${leId}:${canonicalTxId}:${req.obligationKind}:${req.targetPeriod}`,
          );

        const existingById = company.verifiedTaxPayments.find(
          (p) => p.paymentId === resolvedPaymentId,
        );
        if (existingById) {
          if (
            existingById.obligationKind === req.obligationKind &&
            existingById.targetPeriod === req.targetPeriod &&
            existingById.paidDate === req.paidDate &&
            existingById.amountGrosze === req.amountGrosze &&
            existingById.bankTransactionId === canonicalTxId
          ) {
            return this.getPeriodTaxObligations(
              actor,
              rawTenantId,
              rawLegalEntityId,
              req.targetPeriod,
            );
          }
          throw new AccountingWorkspaceConflictError(
            'duplicate_tax_payment_conflict',
            `Dowód zapłaty "${resolvedPaymentId}" istnieje już z innymi parametrami kwoty lub okresu.`,
          );
        }

        assertPeriodOpenForWrite(
          company.periodCloseStates,
          matchedBankTx.bookingDate.slice(0, 7),
          `rejestracja zapłaty zobowiązania ${req.obligationKind} z przelewu ${canonicalTxId}`,
        );

        const commercialAllocated = company.reconciliationMatches
          .filter((m) => m.transactionId === canonicalTxId && m.settledAmountGrosze > 0)
          .reduce((s, m) => s + m.settledAmountGrosze, 0);
        const taxAllocated = company.verifiedTaxPayments
          .filter((p) => p.bankTransactionId === canonicalTxId)
          .reduce((s, p) => s + p.amountGrosze, 0);
        if (commercialAllocated + taxAllocated + req.amountGrosze > matchedBankTx.amountGrosze) {
          throw new AccountingWorkspaceValidationError(
            422,
            'allocation_exceeds_transaction_amount',
            `Suma przypisanych płatności przekracza kwotę przelewu bankowego (${matchedBankTx.amountFormatted}).`,
          );
        }

        const record: VerifiedTaxOrZusPayment = {
          paymentId: resolvedPaymentId,
          obligationKind: req.obligationKind,
          targetPeriod: req.targetPeriod,
          paidDate: req.paidDate,
          amountGrosze: req.amountGrosze,
          bankTransactionId: canonicalTxId,
        };
        validateVerifiedPaymentRecord(record);
        company.verifiedTaxPayments.push(record);
        this.store.saveCompany(company);

        this.recordAudit({
          channel: 'accounting',
          action: 'verified_tax_payment_recorded',
          actorUserId: uId,
          actorDisplayLabel: this.resolveDisplayLabel(uId),
          tenantId: tId,
          legalEntityId: leId,
          outcome: 'allow',
          reasonCode: 'verified_bank_tax_payment',
          summaryPl: `Powiązano zweryfikowaną płatność ${req.obligationKind} za ${req.targetPeriod} (${formatPlnFromGrosze(req.amountGrosze)}, przelew ${canonicalTxId}).`,
        });

        return this.getPeriodTaxObligations(actor, rawTenantId, rawLegalEntityId, req.targetPeriod);
      },
    );
  }

  private buildNotificationsViewInternal(
    tId: TenantId,
    leId: LegalEntityId,
    uId: UserId,
  ): NotificationsViewResponse {
    const userRecord = this.store.getUserById(uId);
    const defaultRecipient = userRecord?.email ?? 'powiadomienia@syntetyczny.example';
    const preferences = this.notificationsEngine.getOrDefaultPreferences({
      tenantId: tId,
      legalEntityId: leId,
      userId: uId,
      recipientEmail: defaultRecipient,
    });
    const outbox = this.notificationOutboxStore.listEntries({
      tenantId: tId,
      legalEntityId: leId,
    });
    const outboxIds = new Set(outbox.map((o) => o.outboxId));
    const deliveredMailbox: SandboxMailboxMessageContract[] = this.sandboxMailboxTransport
      .listDeliveredMessages()
      .filter((m: StoredSandboxEmailMessage) => outboxIds.has(m.outboxId))
      .map((m: StoredSandboxEmailMessage) => ({
        messageId: m.messageId,
        outboxId: m.outboxId,
        deduplicationKey: m.deduplicationKey,
        deliveredAt: m.deliveredAt,
        from: m.from,
        to: m.to,
        subject: m.subject,
        textBody: m.textBody,
        htmlBody: m.htmlBody,
        headers: { ...m.headers },
        rawRfc822: m.rawRfc822,
      }));

    return NotificationsViewResponseSchema.parse({
      preferences,
      outbox: [...outbox],
      deliveredMailbox,
      sandboxPolicy: {
        allowlistedDomains: [...SANDBOX_ALLOWED_EMAIL_DOMAINS],
        failClosedExternalRecipients: true,
        antiImpersonationFooterPl: MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
      },
    });
  }

  getNotificationsView(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): NotificationsViewResponse {
    const { tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'get_notifications_view',
    );
    return this.buildNotificationsViewInternal(tId, leId, uId);
  }

  async updateNotificationPreferences(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest: UpdateNotificationPreferencesRequest,
  ): Promise<NotificationsViewResponse> {
    const { tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'update_notification_preferences',
    );
    const req = UpdateNotificationPreferencesRequestSchema.parse(rawRequest);
    const existing = this.buildNotificationsViewInternal(tId, leId, uId).preferences;
    const recipientEmail = req.recipientEmail ?? existing.recipientEmail;

    await this.notificationsEngine.configurePreferences({
      tenantId: tId,
      legalEntityId: leId,
      userId: uId,
      recipientEmail,
      frequency: req.frequency,
      optionalRemindersOptedOut: req.optionalRemindersOptedOut,
      explicitDisabledStages: req.explicitDisabledStages,
    });

    return this.buildNotificationsViewInternal(tId, leId, uId);
  }

  private toNotificationObligationInputs(
    company: WorkspaceCompanyState,
    period: string,
    evaluationDate: string,
  ): NotificationObligationInput[] {
    const calendarItems = this.buildPeriodObligationsInternal(company, period, evaluationDate);
    return calendarItems
      .filter((item) => item.applicabilityStatus === 'applicable')
      .map((item) => {
        const firstRule = item.explanation.appliedRules[0];
        const fallbackRule = resolveRuleAtDate(
          'ORDYNACJA_ART_12_DEADLINE_SHIFT',
          item.effectiveDueDate,
        );
        const legalBasis: LegalBasisReference = firstRule
          ? {
              ruleId: firstRule.ruleCode,
              ruleVersion: firstRule.version,
              actTitle: firstRule.actTitle,
              articleRef: firstRule.article,
              journalOfLawsRef: firstRule.journalReference,
              officialUrl: firstRule.sourceUrl,
              effectiveFrom: firstRule.validFrom,
              effectiveTo: firstRule.validTo,
              verificationStatus:
                firstRule.verificationStatus === 'verified' ? 'verified' : 'experimental',
            }
          : mapRuleToLegalBasisRef(fallbackRule);

        return {
          obligationId: item.obligationId,
          tenantId: company.tenantId,
          legalEntityId: company.legalEntityId,
          companyMaskedNip: maskPolishNip(company.nip),
          companyProfileLabelPl: company.displayName,
          code: item.code,
          namePl: item.title,
          dueDate: item.effectiveDueDate,
          completed: item.workflowStatus === 'paid',
          legalBasis,
        };
      });
  }

  async dispatchDueNotifications(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    rawRequest?: DispatchDueNotificationsRequest,
  ): Promise<DispatchDueNotificationsResponse> {
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'dispatch_due_notifications',
    );
    const req = rawRequest ? DispatchDueNotificationsRequestSchema.parse(rawRequest) : undefined;
    const period = req?.period ?? DEMO_DEFAULT_PERIOD;
    const initialEvalDate = req?.evaluationDate ?? DEMO_EVALUATION_DATE;
    const preliminaryObligations = this.toNotificationObligationInputs(
      company,
      period,
      initialEvalDate,
    );
    const firstUnpaidDue = preliminaryObligations.find((o) => !o.completed)?.dueDate;
    const evaluationDate =
      req?.evaluationDate ??
      (period === DEMO_DEFAULT_PERIOD || !firstUnpaidDue
        ? DEMO_EVALUATION_DATE
        : addDaysIso(firstUnpaidDue, -2));
    const prefs = this.buildNotificationsViewInternal(tId, leId, uId).preferences;
    const obligations =
      evaluationDate === initialEvalDate
        ? preliminaryObligations
        : this.toNotificationObligationInputs(company, period, evaluationDate);

    const enqueued = await this.notificationsEngine.enqueueScheduledReminders({
      evaluationDate,
      userId: uId,
      recipientEmail: prefs.recipientEmail,
      obligations,
    });
    const processed = await this.notificationsEngine.processDueOutboxMessages();

    return DispatchDueNotificationsResponseSchema.parse({
      evaluationDate,
      enqueuedCount: enqueued.enqueuedEntries.length,
      skippedDuplicatesCount: enqueued.skippedDuplicatesCount,
      skippedByPreferencesCount: enqueued.skippedByPreferencesCount,
      sentCount: processed.sentCount,
      blockedByPolicyCount: processed.blockedByPolicyCount,
      retryScheduledCount: processed.retryScheduledCount,
      notifications: this.buildNotificationsViewInternal(tId, leId, uId),
    });
  }

  async sendSandboxReminderEmailFailClosed(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    params: {
      readonly toAddress: string;
      readonly stage?: ReminderStage | undefined;
      readonly period?: string | undefined;
    },
  ): Promise<SandboxMailboxMessageContract> {
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'send_sandbox_reminder_email',
    );
    const period = params.period ?? DEMO_DEFAULT_PERIOD;
    const stage: ReminderStage = params.stage ?? 'urgent_2d';
    const obligations = this.toNotificationObligationInputs(company, period, DEMO_EVALUATION_DATE);
    const obligation = obligations[0];
    if (!obligation) {
      throw new AccountingWorkspaceValidationError(
        422,
        'no_applicable_obligations',
        'Brak aktywnych obowiązków podatkowych do wysyłki przypomnienia.',
      );
    }

    const prefs: NotificationPreferences = this.notificationsEngine.getOrDefaultPreferences({
      tenantId: tId,
      legalEntityId: leId,
      userId: uId,
      recipientEmail: params.toAddress,
    });

    const rendered = renderAuxiliaryReminderEmail({
      obligation,
      stage,
      toAddress: params.toAddress,
      fromAddress: DEFAULT_SANDBOX_SENDER_EMAIL,
      preferences: prefs,
    });

    const outboxId = randomUUID();
    const deduplicationKey = `direct:${tId}:${leId}:${obligation.obligationId}:${stage}:${outboxId}`;
    await this.sandboxMailboxTransport.sendEmail(rendered, {
      outboxId,
      deduplicationKey,
      tenantId: tId,
      legalEntityId: leId,
    });

    const delivered = this.sandboxMailboxTransport
      .listDeliveredMessages()
      .find((m) => m.outboxId === outboxId);
    if (!delivered) {
      throw new SandboxRecipientBlockedError(maskEmailForAudit(params.toAddress));
    }

    return SandboxMailboxMessageSchema.parse({
      messageId: delivered.messageId,
      outboxId: delivered.outboxId,
      deduplicationKey: delivered.deduplicationKey,
      deliveredAt: delivered.deliveredAt,
      from: delivered.from,
      to: delivered.to,
      subject: delivered.subject,
      textBody: delivered.textBody,
      htmlBody: delivered.htmlBody,
      headers: { ...delivered.headers },
      rawRfc822: delivered.rawRfc822,
    });
  }

  private toMcpProposalListItem(stored: WorkspaceStoredMcpProposal): McpProposalListItemContract {
    const invNumEnv = sanitizeUntrustedDocumentTextForMcp(stored.invoice.invoiceNumber, {
      field: 'invoiceNumber',
    });
    const cpEnv = sanitizeUntrustedDocumentTextForMcp(stored.invoice.counterpartyName, {
      field: 'counterpartyName',
    });
    const descEnv = sanitizeUntrustedDocumentTextForMcp(stored.invoice.expenseDescription, {
      field: 'expenseDescription',
    });
    const nowMs = this.clock.now().getTime();
    const lifecycleStatus: 'pending_human_approval' | 'confirmed' | 'expired' =
      stored.status === 'confirmed'
        ? 'confirmed'
        : stored.status === 'rejected' || stored.status === 'expired' || nowMs >= stored.expiresAtMs
          ? 'expired'
          : 'pending_human_approval';

    return {
      proposalId: stored.proposalId,
      tenantId: stored.tenantId,
      legalEntityId: stored.legalEntityId,
      status: lifecycleStatus,
      ledgerPosted: stored.ledgerPosted,
      ledgerEntryId: stored.ledgerEntryId,
      payloadHash: stored.payloadHash,
      createdAt: stored.createdAtIso,
      expiresAt: stored.expiresAtIso,
      confirmedAt: stored.confirmedAtIso,
      promptInjectionSuspected:
        invNumEnv.promptInjectionSuspected ||
        cpEnv.promptInjectionSuspected ||
        descEnv.promptInjectionSuspected,
      invoice: {
        direction: stored.invoice.direction,
        invoiceNumber: invNumEnv,
        counterpartyName: cpEnv,
        counterpartyNip: stored.invoice.counterpartyNip,
        issueDate: stored.invoice.issueDate,
        dueDate: stored.invoice.dueDate,
        netAmountPln: stored.invoice.netAmountPln,
        vatAmountPln: stored.invoice.vatAmountPln,
        grossAmountPln: stored.invoice.grossAmountPln,
        expenseDescription: descEnv,
        suggestedCategory: stored.invoice.suggestedCategory,
      },
      proposedPosting: stored.proposedPosting,
    };
  }

  listMcpProposals(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
  ): McpProposalsListResponse {
    const { tId, leId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'read',
      'list_mcp_proposals',
    );
    const items = this.store
      .listMcpProposals(tId, leId)
      .filter((p) => p.status !== 'rejected')
      .map((p) => this.toMcpProposalListItem(p));
    return McpProposalsListResponseSchema.parse({ proposals: items });
  }

  prepareMcpProposal(
    actor: WorkspaceActorContext,
    rawInput: PrepareInvoiceAndPostingProposalInput,
    fixedProposalId?: string,
  ): PrepareInvoiceAndPostingProposalOutput {
    const input = PrepareInvoiceAndPostingProposalInputSchema.parse(rawInput);
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      input.tenantId,
      input.legalEntityId,
      'write',
      'mcp_prepare_invoice_proposal',
    );
    assertPeriodOpenForWrite(
      company.periodCloseStates,
      input.invoice.issueDate.slice(0, 7),
      `przygotowanie propozycji MCP (${input.invoice.invoiceNumber})`,
    );

    const nipCheck = validatePolishNip(input.invoice.counterpartyNip);
    if (!nipCheck.valid) {
      throw new AccountingWorkspaceValidationError(
        422,
        'invalid_counterparty_nip',
        nipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta.',
      );
    }

    const netGrosze = parsePlnToGrosze(input.invoice.netAmountPln);
    const vatGrosze = parsePlnToGrosze(input.invoice.vatAmountPln);
    const grossGrosze = parsePlnToGrosze(input.invoice.grossAmountPln);
    if (netGrosze + vatGrosze !== grossGrosze) {
      throw new AccountingWorkspaceValidationError(
        422,
        'amount_mismatch',
        'Suma netto + VAT musi równać się kwocie brutto.',
      );
    }

    const invNumEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.invoiceNumber, {
      field: 'invoiceNumber',
    });
    const cpEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.counterpartyName, {
      field: 'counterpartyName',
    });
    const descEnv = sanitizeUntrustedDocumentTextForMcp(input.invoice.expenseDescription, {
      field: 'expenseDescription',
    });
    const promptInjectionSuspected =
      invNumEnv.promptInjectionSuspected ||
      cpEnv.promptInjectionSuspected ||
      descEnv.promptInjectionSuspected;

    const sanitizedInvoice: PrepareInvoiceAndPostingProposalInput['invoice'] = {
      ...input.invoice,
      invoiceNumber: invNumEnv.sanitizedText || input.invoice.invoiceNumber,
      counterpartyName: cpEnv.sanitizedText || input.invoice.counterpartyName,
      expenseDescription: descEnv.sanitizedText || input.invoice.expenseDescription,
    };

    const payloadHash = computeCanonicalMcpInvoicePayloadHash(tId, leId, sanitizedInvoice);
    const existingByIdem = this.store
      .listMcpProposals(tId, leId)
      .find((p) => p.idempotencyKey === input.idempotencyKey && p.createdByUserId === uId);

    if (existingByIdem) {
      if (existingByIdem.payloadHash !== payloadHash) {
        throw new AccountingWorkspaceConflictError(
          'idempotency_key_payload_conflict',
          'Klucz idempotencyKey został już użyty z inną treścią propozycji.',
        );
      }
      const replayAudit = this.recordAudit({
        channel: 'mcp',
        action: 'prepare_invoice_draft_replay',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'allow',
        reasonCode: 'idempotent_replay',
        summaryPl: `Powtórzenie idempotentne propozycji MCP ${existingByIdem.proposalId}.`,
      });
      return {
        proposalId: existingByIdem.proposalId,
        tenantId: tId,
        legalEntityId: leId,
        status: existingByIdem.status === 'confirmed' ? 'confirmed' : 'pending_human_approval',
        ledgerPosted: existingByIdem.ledgerPosted,
        idempotencyKey: existingByIdem.idempotencyKey,
        idempotentReplay: true,
        payloadHash: existingByIdem.payloadHash,
        createdAt: existingByIdem.createdAtIso,
        expiresAt: existingByIdem.expiresAtIso,
        approvalUiPath: `/approvals/proposals/${existingByIdem.proposalId}`,
        humanApprovalInstructionsPl:
          'Zweryfikuj szkic faktury w panelu Zatwierdzenia i wygeneruj jednorazowy kod potwierdzenia człowieka przed zaksięgowaniem.',
        promptInjectionSuspected,
        sanitizedFields: {
          invoiceNumber: invNumEnv,
          counterpartyName: cpEnv,
          expenseDescription: descEnv,
        },
        proposedPosting: existingByIdem.proposedPosting,
        auditEventId: replayAudit.auditEventId,
      };
    }

    const proposedPosting = computeProposedAccountingPreview(sanitizedInvoice, {
      taxRegime: company.taxRegime,
      vatStatus: company.vatStatusSimple,
    });
    const now = this.clock.now();
    const createdAtIso = now.toISOString();
    const expiresAtMs = now.getTime() + 24 * 60 * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const proposalId = fixedProposalId ?? randomUUID();

    const storedProposal: WorkspaceStoredMcpProposal = {
      proposalId,
      tenantId: tId,
      legalEntityId: leId,
      createdByUserId: uId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      createdAtIso,
      expiresAtMs,
      expiresAtIso,
      status: 'pending_human_approval',
      ledgerPosted: false,
      ledgerEntryId: null,
      confirmedAtIso: null,
      confirmedByUserId: null,
      rejectedAtIso: null,
      rejectedByUserId: null,
      rejectionReason: null,
      invoice: sanitizedInvoice,
      proposedPosting,
    };
    this.store.upsertMcpProposal(storedProposal);
    for (const gw of this.boundMcpGateways) {
      gw.syncProposalFromWorkspace({
        proposalId: storedProposal.proposalId,
        tenantId: storedProposal.tenantId,
        legalEntityId: storedProposal.legalEntityId,
        createdByUserId: storedProposal.createdByUserId,
        idempotencyKey: storedProposal.idempotencyKey,
        payloadHash: storedProposal.payloadHash,
        createdAtIso: storedProposal.createdAtIso,
        expiresAtMs: storedProposal.expiresAtMs,
        expiresAtIso: storedProposal.expiresAtIso,
        status: storedProposal.status,
        ledgerEntryId: storedProposal.ledgerEntryId,
        confirmedAtIso: storedProposal.confirmedAtIso,
        confirmedByUserId: storedProposal.confirmedByUserId ?? null,
        invoice: storedProposal.invoice,
        proposedPosting: storedProposal.proposedPosting,
      });
    }

    const auditEv = this.recordAudit({
      channel: 'mcp',
      action: 'prepare_invoice_draft',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: 'proposal_prepared_pending_human_approval',
      summaryPl: `Utworzono niezatwierdzoną propozycję MCP ${proposalId} (${sanitizedInvoice.invoiceNumber}) — bez zapisu w księgach.`,
    });

    return {
      proposalId,
      tenantId: tId,
      legalEntityId: leId,
      status: 'pending_human_approval',
      ledgerPosted: false,
      idempotencyKey: input.idempotencyKey,
      idempotentReplay: false,
      payloadHash,
      createdAt: createdAtIso,
      expiresAt: expiresAtIso,
      approvalUiPath: `/approvals/proposals/${proposalId}`,
      humanApprovalInstructionsPl:
        'Zweryfikuj szkic faktury w panelu Zatwierdzenia i wygeneruj jednorazowy kod potwierdzenia człowieka przed zaksięgowaniem.',
      promptInjectionSuspected,
      sanitizedFields: {
        invoiceNumber: invNumEnv,
        counterpartyName: cpEnv,
        expenseDescription: descEnv,
      },
      proposedPosting,
      auditEventId: auditEv.auditEventId,
    };
  }

  issueMcpProposalChallenge(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    proposalId: string,
  ): IssueMcpChallengeResponse {
    const { tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'issue_mcp_proposal_challenge',
    );
    this.assertHumanApprovalActorScopes(actor, tId, leId, 'issue_mcp_proposal_challenge');
    const proposal = this.store.getMcpProposal(proposalId);
    if (!proposal || proposal.tenantId !== tId || proposal.legalEntityId !== leId) {
      throw new AccountingWorkspaceAccessError(
        404,
        'proposal_not_found_or_forbidden',
        'Nie znaleziono propozycji MCP w bieżącej firmie.',
      );
    }
    if (proposal.status !== 'pending_human_approval') {
      throw new AccountingWorkspaceConflictError(
        'proposal_already_processed',
        'Propozycja MCP nie oczekuje już na zatwierdzenie.',
      );
    }
    const now = this.clock.now();
    if (now.getTime() >= proposal.expiresAtMs) {
      proposal.status = 'expired';
      this.store.upsertMcpProposal(proposal);
      throw new AccountingWorkspaceValidationError(
        422,
        'proposal_expired',
        'Ważność propozycji MCP wygasła.',
      );
    }

    const confirmationCode = `PAP-HUMAN-${randomBytes(16).toString('hex')}`;
    const expiresAtMs = now.getTime() + 15 * 60 * 1000;
    const expiresAtIso = new Date(expiresAtMs).toISOString();
    const codeSha256Hex = sha256Hex(confirmationCode);

    this.store.saveHumanChallenge({
      proposalId: proposal.proposalId,
      tenantId: tId,
      legalEntityId: leId,
      humanUserId: uId,
      expectedPayloadHash: proposal.payloadHash,
      codeSha256Hex,
      expiresAtMs,
      expiresAtIso,
      consumedAtIso: null,
    });
    for (const gw of this.boundMcpGateways) {
      gw.syncHumanChallengeFromWorkspace({
        proposalId: proposal.proposalId,
        tenantId: tId,
        legalEntityId: leId,
        authorizedHumanUserId: uId,
        expectedPayloadHash: proposal.payloadHash,
        codeSha256Hex,
        expiresAtMs,
        consumedAtIso: null,
      });
    }

    const auditEv = this.recordAudit({
      channel: 'mcp',
      action: 'issue_human_confirmation_challenge',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: 'human_challenge_issued',
      summaryPl: `Wydano jednorazowy token zatwierdzenia człowieka dla propozycji MCP ${proposal.proposalId}.`,
    });

    return IssueMcpChallengeResponseSchema.parse({
      proposalId: proposal.proposalId,
      confirmationCode,
      payloadHash: proposal.payloadHash,
      expiresAt: expiresAtIso,
      auditEventId: auditEv.auditEventId,
    });
  }

  private postConfirmedMcpInvoiceToCompany(
    company: WorkspaceCompanyState,
    proposal: WorkspaceStoredMcpProposal,
    approverUserId: UserId,
    preferredDocumentId?: string,
  ): CompanyDocumentItemContract {
    const netGrosze = parsePlnToGrosze(proposal.invoice.netAmountPln);
    const vatGrosze = parsePlnToGrosze(proposal.invoice.vatAmountPln);
    const grossGrosze = parsePlnToGrosze(proposal.invoice.grossAmountPln);
    const extendedInvoice = proposal.invoice as Omit<
      PrepareInvoiceAndPostingProposalInput['invoice'],
      'lines'
    > & {
      readonly vatRate?: VatRateCode | undefined;
      readonly ryczaltRate?: RyczaltRateCode | undefined;
      readonly isCorrection?: boolean | undefined;
      readonly correctedDocumentNumber?: string | undefined;
      readonly correctionReason?: string | undefined;
      readonly lines?:
        | readonly {
            readonly description: string;
            readonly quantity?: string | undefined;
            readonly unit?: string | undefined;
            readonly netGrosze?: number | undefined;
            readonly netAmountPln?: string | undefined;
            readonly vatRate: VatRateCode;
            readonly vatGrosze?: number | undefined;
            readonly vatAmountPln?: string | undefined;
            readonly grossGrosze?: number | undefined;
            readonly grossAmountPln?: string | undefined;
            readonly annex15Item?: boolean | undefined;
          }[]
        | undefined;
    };

    const candidateOpKey = computeEconomicOperationKey({
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      direction: proposal.invoice.direction,
      documentNumber: proposal.invoice.invoiceNumber,
      issueDate: proposal.invoice.issueDate,
      counterpartyNip: proposal.invoice.counterpartyNip,
      counterpartyName: proposal.invoice.counterpartyName,
      companyNip: company.nip,
      isCorrection: extendedInvoice.isCorrection,
    });
    const candidateSnapshotHash = computeEconomicSnapshotHash({
      direction: proposal.invoice.direction,
      isCorrection: extendedInvoice.isCorrection,
      documentNumber: proposal.invoice.invoiceNumber,
      issueDate: proposal.invoice.issueDate,
      counterpartyNip: proposal.invoice.counterpartyNip,
      totalNetGrosze: netGrosze,
      totalVatGrosze: vatGrosze,
      totalGrossGrosze: grossGrosze,
    });

    const existingDocIndex = company.documents.findIndex(
      (d) =>
        d.status !== 'archived' &&
        this.getDocumentEconomicIdentity(company, d).economicOperationKey === candidateOpKey,
    );
    if (existingDocIndex !== -1) {
      const existingDoc = company.documents[existingDocIndex]!;
      const existingIdentity = this.getDocumentEconomicIdentity(company, existingDoc);
      if (existingIdentity.economicSnapshotHash !== candidateSnapshotHash) {
        throw new AccountingWorkspaceConflictError(
          'economic_operation_payload_conflict',
          `Dokument ${proposal.invoice.invoiceNumber} istnieje już w firmie z innymi kwotami lub danymi (${existingDoc.document.totalGrossFormatted}, ID: ${existingDoc.documentId}).`,
        );
      }
      if (existingDoc.status === 'posted') {
        return existingDoc;
      }
      return this.postDocumentRecordInternal(company, existingDocIndex, approverUserId, {
        suggestedCategory: proposal.invoice.suggestedCategory,
        ...(extendedInvoice.ryczaltRate ? { ryczaltRate: extendedInvoice.ryczaltRate } : {}),
        ...(extendedInvoice.correctionReason
          ? { correctionReason: extendedInvoice.correctionReason }
          : {}),
      });
    }

    let resolvedLines: readonly {
      readonly description: string;
      readonly quantity?: string | undefined;
      readonly unit?: string | undefined;
      readonly netGrosze: number;
      readonly vatRate: VatRateCode;
      readonly vatGrosze?: number | undefined;
      readonly grossGrosze?: number | undefined;
      readonly annex15Item?: boolean | undefined;
    }[];

    if (extendedInvoice.lines && extendedInvoice.lines.length > 0) {
      resolvedLines = extendedInvoice.lines.map((line, idx) => {
        const lineNet =
          line.netGrosze !== undefined
            ? line.netGrosze
            : line.netAmountPln !== undefined
              ? parsePlnToGrosze(line.netAmountPln)
              : 0;
        const lineVat =
          line.vatGrosze !== undefined
            ? line.vatGrosze
            : line.vatAmountPln !== undefined
              ? parsePlnToGrosze(line.vatAmountPln)
              : undefined;
        const lineGross =
          line.grossGrosze !== undefined
            ? line.grossGrosze
            : line.grossAmountPln !== undefined
              ? parsePlnToGrosze(line.grossAmountPln)
              : undefined;
        return {
          description: line.description || `${proposal.invoice.expenseDescription} (#${idx + 1})`,
          ...(line.quantity !== undefined ? { quantity: line.quantity } : {}),
          ...(line.unit !== undefined ? { unit: line.unit } : {}),
          netGrosze: lineNet,
          vatRate: line.vatRate,
          ...(lineVat !== undefined ? { vatGrosze: lineVat } : {}),
          ...(lineGross !== undefined ? { grossGrosze: lineGross } : {}),
          ...(line.annex15Item !== undefined ? { annex15Item: line.annex15Item } : {}),
        };
      });
    } else {
      let resolvedVatRate: VatRateCode;
      if (extendedInvoice.vatRate !== undefined) {
        resolvedVatRate = extendedInvoice.vatRate;
      } else if (vatGrosze === 0) {
        if (company.taxProfile.vatStatus === 'czynny' && netGrosze !== 0) {
          throw new AccountingWorkspaceValidationError(
            422,
            'explicit_vat_rate_required',
            'Dla czynnego podatnika VAT faktura z kwotą VAT 0,00 zł wymaga jawnego wskazania stawki VAT ("0", "zw" lub "np") albo pozycji (lines).',
          );
        }
        resolvedVatRate = company.taxProfile.vatStatus === 'czynny' ? '0' : 'zw';
      } else if (
        Math.abs(vatGrosze - calculateInvoiceLineFromNet(netGrosze, '23').vatGrosze) <= 2
      ) {
        resolvedVatRate = '23';
      } else if (Math.abs(vatGrosze - calculateInvoiceLineFromNet(netGrosze, '8').vatGrosze) <= 2) {
        resolvedVatRate = '8';
      } else if (Math.abs(vatGrosze - calculateInvoiceLineFromNet(netGrosze, '5').vatGrosze) <= 2) {
        resolvedVatRate = '5';
      } else {
        throw new AccountingWorkspaceValidationError(
          422,
          'explicit_vat_lines_required',
          `Kwota VAT (${formatPlnFromGrosze(vatGrosze)}) przy netto ${formatPlnFromGrosze(netGrosze)} nie odpowiada pojedynczej stawce ustawowej (23%, 8%, 5%) — przekaż jawne rozbicie pozycji (lines).`,
        );
      }

      resolvedLines = [
        {
          description: proposal.invoice.expenseDescription,
          netGrosze,
          vatRate: resolvedVatRate,
          vatGrosze,
          grossGrosze,
        },
      ];
    }

    const docRecord = this.buildDocumentRecordInternal({
      company,
      documentId: preferredDocumentId ?? randomUUID(),
      sourceFormat: 'mcp_confirmed',
      status: 'needs_verification',
      sha256Hash: sha256Hex(`mcp-confirmed:${proposal.proposalId}:${proposal.payloadHash}`),
      documentNumber: proposal.invoice.invoiceNumber,
      direction: proposal.invoice.direction,
      issueDate: proposal.invoice.issueDate,
      eventDate: proposal.invoice.issueDate,
      dueDate: proposal.invoice.dueDate,
      counterpartyName: proposal.invoice.counterpartyName,
      counterpartyNip: proposal.invoice.counterpartyNip,
      suggestedCategory: proposal.invoice.suggestedCategory,
      ryczaltRate: extendedInvoice.ryczaltRate,
      isCorrection: extendedInvoice.isCorrection,
      correctedDocumentNumber: extendedInvoice.correctedDocumentNumber,
      correctionReason: extendedInvoice.correctionReason,
      lines: resolvedLines,
    });

    company.documents.unshift(docRecord);
    return this.postDocumentRecordInternal(company, 0, approverUserId, {
      suggestedCategory: proposal.invoice.suggestedCategory,
      ...(extendedInvoice.ryczaltRate ? { ryczaltRate: extendedInvoice.ryczaltRate } : {}),
      ...(extendedInvoice.correctionReason
        ? { correctionReason: extendedInvoice.correctionReason }
        : {}),
    });
  }

  confirmMcpProposal(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    proposalId: string,
    rawRequest: ConfirmMcpProposalRequest,
  ): ConfirmMcpProposalResponse {
    const { company, tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'confirm_mcp_proposal',
    );
    this.assertHumanApprovalActorScopes(actor, tId, leId, 'confirm_mcp_proposal');
    const parsedReq = ConfirmMcpProposalRequestSchema.safeParse(rawRequest);
    if (!parsedReq.success) {
      throw new AccountingWorkspaceValidationError(
        400,
        'invalid_confirm_mcp_proposal_request',
        parsedReq.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      );
    }
    const req = parsedReq.data;
    const proposal = this.store.getMcpProposal(proposalId);
    if (!proposal || proposal.tenantId !== tId || proposal.legalEntityId !== leId) {
      throw new AccountingWorkspaceAccessError(
        404,
        'proposal_not_found_or_forbidden',
        'Nie znaleziono propozycji MCP w bieżącej firmie.',
      );
    }
    if (proposal.status !== 'pending_human_approval') {
      throw new AccountingWorkspaceConflictError(
        'proposal_already_processed',
        'Propozycja MCP została już wcześniej przetworzona lub odrzucona.',
      );
    }

    const nowMs = this.clock.now().getTime();
    if (nowMs >= proposal.expiresAtMs) {
      proposal.status = 'expired';
      this.store.upsertMcpProposal(proposal);
      throw new AccountingWorkspaceValidationError(
        422,
        'proposal_expired',
        'Ważność propozycji MCP wygasła.',
      );
    }

    if (!constantTimeHexEquals(req.expectedPayloadHash, proposal.payloadHash)) {
      throw new AccountingWorkspaceConflictError(
        'payload_hash_mismatch',
        'Skrót zawartości propozycji (payloadHash) nie zgadza się z przygotowanym szkicem.',
      );
    }

    const challenge = this.store.getHumanChallenge(proposal.proposalId);
    if (!challenge || !req.confirmationCode) {
      this.recordAudit({
        channel: 'mcp',
        action: 'confirm_mcp_proposal_denied',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'human_confirmation_required',
        summaryPl: `Zablokowano próbę księgowania propozycji MCP ${proposal.proposalId} bez ważnego tokenu zatwierdzenia człowieka.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'human_confirmation_required',
        'Księgowanie propozycji MCP wymaga ważnego jednorazowego tokenu zatwierdzenia człowieka (confirmationCode).',
      );
    }

    const providedHash = sha256Hex(req.confirmationCode.trim());
    if (
      challenge.consumedAtIso !== null ||
      nowMs >= challenge.expiresAtMs ||
      challenge.humanUserId !== uId ||
      !constantTimeHexEquals(challenge.expectedPayloadHash, proposal.payloadHash) ||
      !constantTimeHexEquals(challenge.codeSha256Hex, providedHash)
    ) {
      this.recordAudit({
        channel: 'mcp',
        action: 'confirm_mcp_proposal_denied',
        actorUserId: uId,
        actorDisplayLabel: this.resolveDisplayLabel(uId),
        tenantId: tId,
        legalEntityId: leId,
        outcome: 'deny',
        reasonCode: 'invalid_confirmation_code',
        summaryPl: `Odrzucono nieprawidłowy lub wygasły token zatwierdzenia człowieka dla propozycji ${proposal.proposalId}.`,
      });
      throw new AccountingWorkspaceAccessError(
        403,
        'invalid_confirmation_code',
        'Kod zatwierdzenia człowieka jest nieprawidłowy, wygasł lub należy do innego użytkownika.',
      );
    }

    const nowIso = this.nowIso();
    const postedDocument = this.postConfirmedMcpInvoiceToCompany(company, proposal, uId);
    challenge.consumedAtIso = nowIso;
    this.store.saveHumanChallenge(challenge);
    proposal.status = 'confirmed';
    proposal.ledgerPosted = true;
    proposal.ledgerEntryId = postedDocument.documentId;
    proposal.confirmedAtIso = nowIso;
    proposal.confirmedByUserId = uId;
    this.store.upsertMcpProposal(proposal);
    for (const gw of this.boundMcpGateways) {
      gw.markProposalConfirmedFromWorkspace({
        proposalId: proposal.proposalId,
        ledgerEntryId: postedDocument.documentId,
        confirmedAtIso: nowIso,
        confirmedByUserId: uId,
      });
    }

    const auditEv = this.recordAudit({
      channel: 'mcp',
      action: 'confirm_prepared_proposal',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: 'proposal_confirmed_with_human_token',
      summaryPl: `Zatwierdzono i zaksięgowano propozycję MCP ${proposal.proposalId} jako dokument ${postedDocument.document.documentNumber}.`,
    });

    const confirmation: ConfirmPreparedProposalOutput = {
      proposalId: proposal.proposalId,
      tenantId: tId,
      legalEntityId: leId,
      status: 'confirmed',
      ledgerPosted: true,
      ledgerEntryId: postedDocument.documentId,
      confirmedAt: nowIso,
      confirmedPayloadHash: proposal.payloadHash,
      idempotencyKey: req.idempotencyKey ?? randomUUID(),
      idempotentReplay: false,
      auditEventId: auditEv.auditEventId,
    };

    return ConfirmMcpProposalResponseSchema.parse({
      confirmation,
      postedDocument,
    });
  }

  rejectMcpProposal(
    actor: WorkspaceActorContext,
    rawTenantId: string,
    rawLegalEntityId: string,
    proposalId: string,
    rawRequest?: RejectMcpProposalRequest,
  ): RejectMcpProposalResponse {
    const { tId, leId, uId } = this.authorizeCompanyOperation(
      actor,
      rawTenantId,
      rawLegalEntityId,
      'write',
      'reject_mcp_proposal',
    );
    this.assertHumanApprovalActorScopes(actor, tId, leId, 'reject_mcp_proposal');
    const req = rawRequest ? RejectMcpProposalRequestSchema.parse(rawRequest) : undefined;
    const proposal = this.store.getMcpProposal(proposalId);
    if (!proposal || proposal.tenantId !== tId || proposal.legalEntityId !== leId) {
      throw new AccountingWorkspaceAccessError(
        404,
        'proposal_not_found_or_forbidden',
        'Nie znaleziono propozycji MCP w bieżącej firmie.',
      );
    }
    if (proposal.status !== 'pending_human_approval') {
      throw new AccountingWorkspaceConflictError(
        'proposal_already_processed',
        'Propozycja MCP została już wcześniej przetworzona.',
      );
    }

    const nowIso = this.nowIso();
    const reason = req?.reason ?? 'Odrzucono przez człowieka podczas weryfikacji księgowej.';
    proposal.status = 'rejected';
    proposal.rejectedAtIso = nowIso;
    proposal.rejectedByUserId = uId;
    proposal.rejectionReason = reason;
    this.store.upsertMcpProposal(proposal);
    const existingChallenge = this.store.getHumanChallenge(proposal.proposalId);
    if (existingChallenge) {
      existingChallenge.consumedAtIso = nowIso;
      this.store.saveHumanChallenge(existingChallenge);
    }
    for (const gw of this.boundMcpGateways) {
      gw.markProposalRejectedFromWorkspace({ proposalId: proposal.proposalId });
    }

    const auditEv = this.recordAudit({
      channel: 'mcp',
      action: 'reject_mcp_proposal',
      actorUserId: uId,
      actorDisplayLabel: this.resolveDisplayLabel(uId),
      tenantId: tId,
      legalEntityId: leId,
      outcome: 'allow',
      reasonCode: 'proposal_rejected_by_human',
      summaryPl: `Człowiek odrzucił propozycję MCP ${proposal.proposalId}: ${reason}`,
    });

    return RejectMcpProposalResponseSchema.parse({
      proposalId: proposal.proposalId,
      status: 'rejected',
      rejectedAt: nowIso,
      rejectedByUserId: uId,
      reason,
      auditEventId: auditEv.auditEventId,
    });
  }

  createWorkspaceMcpDomainPort(): PapMcpDomainPort {
    const getFacts = async (query: TenantAuthorizationQuery): Promise<TenantAuthorizationFacts> => {
      const membership = this.store.getMembership(query.tenantId, query.userId);
      const grants = this.store
        .listGrantsForCompany(query.tenantId, query.legalEntityId)
        .filter((g) => g.userId === query.userId);
      return {
        membership,
        grants,
        platformRoleAssignments: [],
      };
    };

    const resolveVerifiedIdentity = async (
      identity: VerifiedOidcIdentity,
    ): Promise<{ readonly userId: UserId } | null> => {
      const bySub = this.store.getUserBySubject(identity.subject);
      if (bySub) {
        return bySub.active ? { userId: bySub.userId } : null;
      }
      const persona = resolveDemoPersonaSeed(identity.subject);
      if (persona) {
        const parsedId = parseUserId(persona.userId);
        const byId = this.store.getUserById(parsedId);
        if (byId && !byId.active) {
          return null;
        }
        return { userId: parsedId };
      }
      return null;
    };

    const recordDecision = async (event: SecurityAuditEvent): Promise<void> => {
      this.recordAudit({
        channel: 'security',
        action: `mcp_preflight_${event.action}`,
        actorUserId: event.actorId,
        actorDisplayLabel: event.actorId
          ? this.resolveDisplayLabel(event.actorId)
          : 'MCP Preflight',
        tenantId: event.tenantId,
        legalEntityId: event.legalEntityId,
        outcome: event.decision,
        reasonCode: event.reason,
        summaryPl: `Decyzja autoryzacji MCP (${event.action}): ${event.decision} (${event.reason}).`,
      });
    };

    const recordMcpAudit = (event: McpAuditEvent): void => {
      this.recordAudit({
        channel: 'mcp',
        action: event.toolName,
        actorUserId: event.actorUserId,
        actorDisplayLabel: event.actorUserId
          ? this.resolveDisplayLabel(event.actorUserId)
          : 'Klient MCP',
        tenantId: event.tenantId,
        legalEntityId: event.legalEntityId,
        outcome: event.outcome,
        reasonCode: event.reasonCode,
        summaryPl: `MCP ${event.toolName}: ${event.outcome} (${event.reasonCode})`,
      });
    };

    const listCandidateCompaniesForUser = async (
      uId: UserId,
    ): Promise<readonly CompanyDirectoryRecord[]> => {
      const out: CompanyDirectoryRecord[] = [];
      for (const comp of this.store.listAllCompanies()) {
        const membership = this.store.getMembership(comp.tenantId, uId);
        const grants = this.store
          .listGrantsForCompany(comp.tenantId, comp.legalEntityId)
          .filter((g) => g.userId === uId);
        if (membership || grants.length > 0) {
          out.push({
            tenantId: comp.tenantId,
            legalEntityId: comp.legalEntityId,
            displayName: comp.displayName,
            nip: comp.nip,
            legalForm: comp.legalForm,
            taxRegime: comp.taxRegime,
            vatStatus: comp.vatStatusSimple,
            membership,
            grants,
          });
        }
      }
      return out;
    };

    const getCompanyTaxProfile = async (
      tId: TenantId,
      leId: LegalEntityId,
    ): Promise<CompanyTaxProfile | null> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) return null;
      return {
        legalForm: comp.legalForm,
        taxRegime: comp.taxRegime,
        vatStatus: comp.vatStatusSimple,
      };
    };

    const listUnpaidInvoices = async (
      tId: TenantId,
      leId: LegalEntityId,
    ): Promise<readonly UnpaidInvoiceRecord[]> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) return [];
      return comp.settlements
        .filter((s) => s.remainingGrosze > 0)
        .map((s) => {
          const docItem = comp.documents.find((d) => d.documentId === s.documentId);
          const netGrosze = docItem?.document.totalNetGrosze ?? s.grossGrosze;
          const vatGrosze = docItem?.document.totalVatGrosze ?? 0;
          const desc =
            docItem?.document.lines.map((l) => l.description).join('; ') ??
            `Rozrachunek ${s.documentNumber}`;
          return {
            invoiceId: s.documentId,
            tenantId: tId,
            legalEntityId: leId,
            direction: s.direction === 'receivable' ? 'sales' : 'purchase',
            invoiceNumber: s.documentNumber,
            issueDate: s.issueDate,
            dueDate: s.dueDate,
            counterpartyName: s.counterpartyName,
            description: desc,
            netAmountPln: formatGroszeDecimalPln(Math.max(0, netGrosze)),
            vatAmountPln: formatGroszeDecimalPln(Math.max(0, vatGrosze)),
            grossAmountPln: formatGroszeDecimalPln(Math.max(0, s.grossGrosze)),
            remainingGrossAmountPln: formatGroszeDecimalPln(Math.max(0, s.remainingGrosze)),
            ksefReferenceNumber:
              s.ksefReferenceNumber &&
              KsefReferenceNumberSchema.safeParse(s.ksefReferenceNumber).success
                ? s.ksefReferenceNumber
                : null,
          };
        });
    };

    const listMonthlyTaxObligations = async (
      tId: TenantId,
      leId: LegalEntityId,
      period: string,
    ): Promise<readonly MonthlyTaxObligation[]> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) return [];
      const items = this.buildPeriodObligationsInternal(comp, period);
      return items.map((item) => {
        const mappedCat: MonthlyTaxObligation['category'] =
          item.category === 'ryczalt'
            ? 'pit'
            : item.category === 'jpk_income_tax'
              ? 'jpk'
              : item.category === 'edoreczenia'
                ? 'ksef'
                : item.category;
        const mappedStatus: MonthlyTaxObligation['status'] =
          item.applicabilityStatus !== 'applicable'
            ? 'not_applicable'
            : item.workflowStatus === 'paid'
              ? 'completed'
              : item.workflowStatus;
        const firstRule = item.explanation.appliedRules[0];
        const fallbackRule = resolveRuleAtDate(
          'ORDYNACJA_ART_12_DEADLINE_SHIFT',
          item.effectiveDueDate,
        );
        const legalBasis: LegalBasisReference = firstRule
          ? {
              ruleId: firstRule.ruleCode,
              ruleVersion: firstRule.version,
              actTitle: firstRule.actTitle,
              articleRef: firstRule.article,
              journalOfLawsRef: firstRule.journalReference,
              officialUrl: firstRule.sourceUrl,
              effectiveFrom: firstRule.validFrom,
              effectiveTo: firstRule.validTo,
              verificationStatus:
                firstRule.verificationStatus === 'verified' ? 'verified' : 'experimental',
            }
          : mapRuleToLegalBasisRef(fallbackRule);

        return {
          obligationId: item.obligationId,
          category: mappedCat,
          code: item.code,
          namePl: item.title,
          dueDate: item.effectiveDueDate,
          status: mappedStatus,
          estimatedAmountPln:
            item.estimatedAmountGrosze !== null
              ? formatGroszeDecimalPln(item.estimatedAmountGrosze)
              : null,
          legalBasis,
        };
      });
    };

    const getAccountingItemExplanation = async (
      tId: TenantId,
      leId: LegalEntityId,
      accountingItemId: string,
    ): Promise<AccountingItemExplanationRecord | null> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) return null;
      return comp.explanationsById.get(accountingItemId) ?? null;
    };

    const getLegalBasisEntry = async (
      code: string,
      asOfDate: string,
    ): Promise<LegalBasisCatalogEntry | null> => {
      const direct = VERIFIED_POLISH_LEGAL_BASIS_CATALOG[code];
      if (direct) return direct;
      const rule = POLISH_LEGAL_RULES_REGISTRY.find(
        (r) =>
          (r.ruleCode === code || r.id === code) &&
          r.validFrom <= asOfDate &&
          (r.validTo === null || asOfDate <= r.validTo),
      );
      if (!rule) return null;
      return {
        code: rule.ruleCode,
        titlePl: rule.title,
        summaryPl: rule.description,
        legalBasis: mapRuleToLegalBasisRef(rule),
        exceptionsPl: [...rule.exceptions],
      };
    };

    const getMonthCloseRawData = async (
      tId: TenantId,
      leId: LegalEntityId,
      period: string,
    ): Promise<MonthCloseRawData> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) {
        return { missingDocuments: [], unreconciledBankTransfers: [] };
      }
      const unverifiedDocs = comp.documents.filter(
        (d) =>
          d.document.eventDate.startsWith(period) &&
          (d.status === 'needs_verification' || d.status === 'ai_proposed' || d.status === 'draft'),
      );
      const pendingProposals = this.store
        .listMcpProposals(tId, leId)
        .filter(
          (p) => p.status === 'pending_human_approval' && p.invoice.issueDate.startsWith(period),
        );
      const missingDocuments = [
        ...unverifiedDocs.map((d) => ({
          code: `UNVERIFIED_DOC_${d.documentId.slice(0, 8).toUpperCase()}`,
          descriptionPl: `Dokument ${d.document.documentNumber} oczekuje na weryfikację i zatwierdzenie człowieka.`,
          blocking: true,
          contextNote: `${d.document.counterpartyName} (${d.document.totalGrossFormatted})`,
        })),
        ...pendingProposals.map((p) => ({
          code: `PENDING_MCP_${p.proposalId.slice(0, 8).toUpperCase()}`,
          descriptionPl: `Propozycja MCP ${p.invoice.invoiceNumber} oczekuje na decyzję człowieka.`,
          blocking: true,
          contextNote: `${p.invoice.counterpartyName} (${p.invoice.grossAmountPln} PLN)`,
        })),
      ];

      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const unreconciledItems = computeUnreconciledBankTransactionsForPeriod({
        bankTransactions: comp.bankTransactions,
        reconciliationMatches: comp.reconciliationMatches,
        verifiedTaxPayments: comp.verifiedTaxPayments,
        period,
      });
      const unreconciledBankTransfers = unreconciledItems.map(
        ({ tx, remainingUnallocatedGrosze }) => ({
          bankTransactionId: uuidRegex.test(tx.transactionId)
            ? tx.transactionId.toLowerCase()
            : deterministicUuidV4(`bank-tx:${tId}:${leId}:${tx.transactionId}`),
          bookingDate: tx.bookingDate,
          amountPln: formatGroszeDecimalPln(
            tx.direction === 'debit' ? -remainingUnallocatedGrosze : remainingUnallocatedGrosze,
          ),
          counterpartyName: tx.counterpartyName,
          transferTitle: tx.title,
        }),
      );

      return { missingDocuments, unreconciledBankTransfers };
    };

    const listUnreconciledBankTransactions = async (
      tId: TenantId,
      leId: LegalEntityId,
      period?: string,
    ): Promise<readonly UnreconciledBankTransactionRecord[]> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp) {
        return [];
      }
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const unreconciled = computeUnreconciledBankTransactionsForPeriod({
        bankTransactions: comp.bankTransactions,
        reconciliationMatches: comp.reconciliationMatches,
        verifiedTaxPayments: comp.verifiedTaxPayments,
        period,
      });
      return unreconciled.map(({ tx, remainingUnallocatedGrosze }) => ({
        bankTransactionId: uuidRegex.test(tx.transactionId)
          ? tx.transactionId.toLowerCase()
          : deterministicUuidV4(`bank-tx:${tId}:${leId}:${tx.transactionId}`),
        tenantId: tId,
        legalEntityId: leId,
        bookingDate: tx.bookingDate,
        direction: tx.direction,
        amountPln: formatGroszeDecimalPln(tx.amountGrosze),
        remainingUnallocatedPln: formatGroszeDecimalPln(remainingUnallocatedGrosze),
        counterpartyName: tx.counterpartyName,
        transferTitle: tx.title,
      }));
    };

    const applyConfirmedBankReconciliation = async (params: {
      readonly tenantId: TenantId;
      readonly legalEntityId: LegalEntityId;
      readonly bankTransactionId: string;
      readonly invoiceId: string;
      readonly allocationGrossPln: string;
      readonly confirmedByUserId: UserId;
    }): Promise<{
      readonly reconciliationEntryId: string;
      readonly remainingInvoiceGrossAfterPln: string;
    }> => {
      const comp = this.store.getCompany(params.tenantId, params.legalEntityId);
      if (!comp) {
        throw new AccountingWorkspaceAccessError(
          404,
          'company_not_found',
          'Nie znaleziono firmy dla zatwierdzanego uzgodnienia bankowego MCP.',
        );
      }
      const tx = comp.bankTransactions.find(
        (t) =>
          t.transactionId.toLowerCase() === params.bankTransactionId.toLowerCase() ||
          deterministicUuidV4(
            `bank-tx:${params.tenantId}:${params.legalEntityId}:${t.transactionId}`,
          ).toLowerCase() === params.bankTransactionId.toLowerCase(),
      );
      const settlement = comp.settlements.find(
        (s) =>
          s.documentId.toLowerCase() === params.invoiceId.toLowerCase() ||
          s.settlementId.toLowerCase() === params.invoiceId.toLowerCase(),
      );
      if (!tx || !settlement) {
        throw new AccountingWorkspaceAccessError(
          404,
          'reconcile_target_not_found',
          'Nie znaleziono transakcji bankowej lub rozrachunku faktury dla uzgodnienia MCP.',
        );
      }

      const addGrosze = parsePlnToGrosze(params.allocationGrossPln);
      const existingMatchesForTx = comp.reconciliationMatches.filter(
        (m) =>
          m.transactionId === tx.transactionId &&
          m.matchedDocumentId !== undefined &&
          m.settledAmountGrosze > 0,
      );
      const mergedBySettlementId = new Map<string, number>();
      for (const m of existingMatchesForTx) {
        const sItem = comp.settlements.find((s) => s.documentId === m.matchedDocumentId);
        if (sItem) {
          mergedBySettlementId.set(
            sItem.settlementId,
            (mergedBySettlementId.get(sItem.settlementId) ?? 0) + m.settledAmountGrosze,
          );
        }
      }
      const nextForTarget = (mergedBySettlementId.get(settlement.settlementId) ?? 0) + addGrosze;
      mergedBySettlementId.set(settlement.settlementId, nextForTarget);

      const batchMatches = [...mergedBySettlementId.entries()].map(
        ([settlementId, amountGrosze]) => ({
          transactionId: tx.transactionId,
          settlementId,
          amountGrosze,
        }),
      );

      const finance = this.reconcileBank(
        {
          userId: params.confirmedByUserId,
          scopes: ['pap:ui:accounting'],
        },
        params.tenantId,
        params.legalEntityId,
        { matches: batchMatches },
      );

      const updatedSettlement = finance.settlements.find(
        (s) => s.settlementId === settlement.settlementId,
      );
      return {
        reconciliationEntryId: deterministicUuidV4(
          `mcp-bank-rec:${params.tenantId}:${params.legalEntityId}:${tx.transactionId}:${settlement.settlementId}:${nextForTarget}`,
        ),
        remainingInvoiceGrossAfterPln: formatGroszeDecimalPln(
          updatedSettlement?.remainingGrosze ?? 0,
        ),
      };
    };

    const getVatPeriodPreviewSnapshot = async (
      tId: TenantId,
      leId: LegalEntityId,
      period: string,
    ): Promise<VatPeriodPreviewSnapshot | null> => {
      const comp = this.store.getCompany(tId, leId);
      if (!comp || comp.taxProfile.vatStatus !== 'czynny') {
        return null;
      }
      const periodVat = comp.vatEntries.filter((e) => e.period === period);
      const { jpk } = this.calculateCompanyVatSettlementForPeriod(comp, period);
      return {
        salesEntriesCount: periodVat.filter((e) => e.registerType === 'sales').length,
        purchaseEntriesCount: periodVat.filter((e) => e.registerType === 'purchase').length,
        outputVatPln: formatGroszeDecimalPln(jpk.outputVatRoundedPlnGrosze),
        deductibleInputVatPln: formatGroszeDecimalPln(jpk.totalInputVatPlnGrosze),
        taxDuePln: formatGroszeDecimalPln(jpk.taxDueToPayP51Grosze),
        excessCarryForwardPln: formatGroszeDecimalPln(jpk.carryForwardToNextPeriodP62Grosze),
      };
    };

    const listCompanyAuditEvents = async (
      tId: TenantId,
      leId: LegalEntityId,
    ): Promise<readonly ExternalCompanyAuditRecord[]> => {
      return this.store.listAuditEvents({ tenantId: tId, legalEntityId: leId }).map((ev) => ({
        auditEventId: ev.auditEventId,
        occurredAt: ev.occurredAt,
        channel: ev.channel,
        action: ev.action,
        outcome: ev.outcome,
        reasonCode: ev.reasonCode,
        summaryPl: ev.summaryPl,
      }));
    };

    const isPeriodClosed = async (
      tId: TenantId,
      leId: LegalEntityId,
      period: string,
    ): Promise<boolean> => {
      const comp = this.store.getCompany(tId, leId);
      return comp?.periodCloseStates?.get(period)?.status === 'closed';
    };

    const applyConfirmedMonthClose = async (params: {
      readonly tenantId: TenantId;
      readonly legalEntityId: LegalEntityId;
      readonly period: string;
      readonly confirmedByUserId: UserId;
      readonly note?: string | undefined;
    }): Promise<{ readonly closedAt: string }> => {
      const closed = this.closeAccountingPeriod(
        {
          userId: params.confirmedByUserId,
          scopes: ['pap:ui:accounting'],
        },
        params.tenantId,
        params.legalEntityId,
        params.period,
        {
          confirmClose: true,
          status: 'closed',
          ...(params.note ? { note: params.note } : {}),
        },
      );
      return { closedAt: closed.closedAt ?? this.nowIso() };
    };

    const port: PapMcpDomainPort = {
      getFacts,
      resolveVerifiedIdentity,
      recordDecision,
      record: recordMcpAudit,
      listCandidateCompaniesForUser,
      getCompanyTaxProfile,
      listUnpaidInvoices,
      listMonthlyTaxObligations,
      getAccountingItemExplanation,
      getLegalBasisEntry,
      getMonthCloseRawData,
      listUnreconciledBankTransactions,
      applyConfirmedBankReconciliation,
      getVatPeriodPreviewSnapshot,
      listCompanyAuditEvents,
      isPeriodClosed,
      applyConfirmedMonthClose,
      prepare_invoice_draft: async (actor, input) => this.prepareMcpProposal(actor, input),
      issue_human_confirmation_token: async (actor, tId, leId, propId) =>
        this.issueMcpProposalChallenge(actor, tId, leId, propId),
      confirm_prepared_proposal: async (actor, tId, leId, propId, input) =>
        this.confirmMcpProposal(actor, tId, leId, propId, input),
      createBoundMcpGateway: (verifier, opts) => this.createBoundMcpGateway(verifier, opts),
    };

    return port;
  }

  syncStoreMcpProposalsToBoundGateways(tenantId?: TenantId, legalEntityId?: LegalEntityId): void {
    const companies =
      tenantId && legalEntityId
        ? ([this.store.getCompany(tenantId, legalEntityId)].filter(
            Boolean,
          ) as WorkspaceCompanyState[])
        : this.store.listAllCompanies();
    for (const comp of companies) {
      for (const existing of this.store.listMcpProposals(comp.tenantId, comp.legalEntityId)) {
        for (const gateway of this.boundMcpGateways) {
          gateway.syncProposalFromWorkspace({
            proposalId: existing.proposalId,
            tenantId: existing.tenantId,
            legalEntityId: existing.legalEntityId,
            createdByUserId: existing.createdByUserId,
            idempotencyKey: existing.idempotencyKey,
            payloadHash: existing.payloadHash,
            createdAtIso: existing.createdAtIso,
            expiresAtMs: existing.expiresAtMs,
            expiresAtIso: existing.expiresAtIso,
            status: existing.status,
            ledgerEntryId: existing.ledgerEntryId,
            confirmedAtIso: existing.confirmedAtIso,
            confirmedByUserId: existing.confirmedByUserId ?? null,
            invoice: existing.invoice,
            proposedPosting: existing.proposedPosting,
          });
          const existingChallenge = this.store.getHumanChallenge(existing.proposalId);
          if (existingChallenge) {
            gateway.syncHumanChallengeFromWorkspace({
              proposalId: existingChallenge.proposalId,
              tenantId: existingChallenge.tenantId,
              legalEntityId: existingChallenge.legalEntityId,
              authorizedHumanUserId: existingChallenge.humanUserId,
              expectedPayloadHash: existingChallenge.expectedPayloadHash,
              codeSha256Hex: existingChallenge.codeSha256Hex,
              expiresAtMs: existingChallenge.expiresAtMs,
              consumedAtIso: existingChallenge.consumedAtIso,
            });
          }
        }
      }
    }
  }

  createBoundMcpGateway(
    verifier: OidcAccessTokenVerifier,
    options?: {
      readonly proposalTtlMs?: number | undefined;
      readonly humanConfirmationTtlMs?: number | undefined;
    },
  ): PapMcpGateway {
    const port = this.createWorkspaceMcpDomainPort();
    const gateway = new PapMcpGateway({
      verifier,
      identityResolver: port,
      authorizationDataSource: port,
      dataSource: port,
      securityAudit: port,
      auditSink: port,
      clock: this.clock,
      proposalTtlMs: options?.proposalTtlMs,
      humanConfirmationTtlMs: options?.humanConfirmationTtlMs,
    });

    this.boundMcpGateways.add(gateway);
    this.syncStoreMcpProposalsToBoundGateways();

    const origIssueChallenge = gateway.issueHumanConfirmationChallenge.bind(gateway);
    gateway.issueHumanConfirmationChallenge = async (input) => {
      const result = await origIssueChallenge(input);
      if (result.ok) {
        const chSnap = gateway.getHumanChallengeSnapshot(input.proposalId);
        if (chSnap) {
          this.store.saveHumanChallenge({
            proposalId: chSnap.proposalId,
            tenantId: chSnap.tenantId,
            legalEntityId: chSnap.legalEntityId,
            humanUserId: chSnap.authorizedHumanUserId,
            expectedPayloadHash: chSnap.expectedPayloadHash,
            codeSha256Hex: chSnap.codeSha256Hex,
            expiresAtMs: chSnap.expiresAtMs,
            expiresAtIso: new Date(chSnap.expiresAtMs).toISOString(),
            consumedAtIso: chSnap.consumedAtIso,
          });
          for (const gw of this.boundMcpGateways) {
            if (gw !== gateway) {
              gw.syncHumanChallengeFromWorkspace(chSnap);
            }
          }
        }
      }
      return result;
    };

    const origPrepare = gateway.prepareInvoiceAndPostingProposal.bind(gateway);
    gateway.prepareInvoiceAndPostingProposal = async (
      callContext: McpCallContext,
      rawInput: unknown,
    ): Promise<McpGatewayToolResult<PrepareInvoiceAndPostingProposalOutput>> => {
      const result = await origPrepare(callContext, rawInput);
      if (result.ok) {
        const snapshot = gateway.getStoredProposalSnapshot(result.data.proposalId);
        if (snapshot) {
          this.store.upsertMcpProposal({
            proposalId: snapshot.proposalId,
            tenantId: snapshot.tenantId,
            legalEntityId: snapshot.legalEntityId,
            createdByUserId: snapshot.createdByUserId,
            idempotencyKey: snapshot.idempotencyKey,
            payloadHash: snapshot.payloadHash,
            createdAtIso: snapshot.createdAtIso,
            expiresAtMs: snapshot.expiresAtMs,
            expiresAtIso: snapshot.expiresAtIso,
            status: 'pending_human_approval',
            ledgerPosted: false,
            ledgerEntryId: null,
            confirmedAtIso: null,
            confirmedByUserId: null,
            rejectedAtIso: null,
            rejectedByUserId: null,
            rejectionReason: null,
            invoice: snapshot.invoice,
            proposedPosting: snapshot.proposedPosting,
          });
          for (const gw of this.boundMcpGateways) {
            if (gw !== gateway) {
              gw.syncProposalFromWorkspace(snapshot);
            }
          }
        }
      }
      return result;
    };

    const origConfirm = gateway.confirmPreparedProposal.bind(gateway);
    gateway.confirmPreparedProposal = async (
      callContext: McpCallContext,
      rawInput: unknown,
    ): Promise<McpGatewayToolResult<ConfirmPreparedProposalOutput>> => {
      const result = await origConfirm(callContext, rawInput);
      if (result.ok && !result.data.idempotentReplay) {
        const stored = this.store.getMcpProposal(result.data.proposalId);
        const snapshot = gateway.getStoredProposalSnapshot(result.data.proposalId);
        const approverUserId = snapshot?.confirmedByUserId ?? stored?.createdByUserId;
        const comp = this.store.getCompany(
          parseTenantId(result.data.tenantId),
          parseLegalEntityId(result.data.legalEntityId),
        );
        if (stored && comp && approverUserId && stored.status === 'pending_human_approval') {
          let postedDoc: CompanyDocumentItemContract;
          try {
            postedDoc = this.postConfirmedMcpInvoiceToCompany(
              comp,
              stored,
              approverUserId,
              result.data.ledgerEntryId,
            );
          } catch (err) {
            if (err instanceof AccountingWorkspaceError) {
              return {
                ok: false,
                error: {
                  ok: false,
                  errorCode:
                    err instanceof AccountingWorkspaceValidationError
                      ? 'validation_failed'
                      : 'proposal_already_processed',
                  messagePl: err.message,
                  auditEventId: result.data.auditEventId,
                  retryable: false,
                },
              };
            }
            throw err;
          }
          const existingCh = this.store.getHumanChallenge(stored.proposalId);
          if (existingCh) {
            existingCh.consumedAtIso = result.data.confirmedAt;
            this.store.saveHumanChallenge(existingCh);
          }
          const canonicalDocId = postedDoc.documentId;
          stored.status = 'confirmed';
          stored.ledgerPosted = true;
          stored.ledgerEntryId = canonicalDocId;
          stored.confirmedAtIso = result.data.confirmedAt;
          stored.confirmedByUserId = approverUserId;
          this.store.upsertMcpProposal(stored);
          for (const gw of this.boundMcpGateways) {
            gw.markProposalConfirmedFromWorkspace({
              proposalId: stored.proposalId,
              ledgerEntryId: canonicalDocId,
              confirmedAtIso: result.data.confirmedAt,
              confirmedByUserId: approverUserId,
            });
          }
          if (canonicalDocId !== result.data.ledgerEntryId) {
            return {
              ok: true,
              data: {
                ...result.data,
                ledgerEntryId: canonicalDocId,
              },
            };
          }
        }
      }
      return result;
    };

    return gateway;
  }

  private seedDefaultDemoWorkspace(): void {
    const validFrom = new Date('2025-01-01T00:00:00.000Z');
    const inMemory = this.store instanceof InMemoryAccountingWorkspaceStore ? this.store : null;

    for (const p of DEMO_PERSONAS_SEED) {
      const uId = parseUserId(p.userId);
      const tId = parseTenantId(p.tenantId);
      if (inMemory) {
        inMemory.upsertUser({
          userId: uId,
          subject: p.subject,
          displayName: p.displayName,
          email: p.email,
          active: true,
        });
      }
      const role: TenantRole = p.role;
      this.store.upsertMembership({
        userId: uId,
        tenantId: tId,
        role,
        status: 'active',
        validFrom,
        validUntil: null,
      });
    }

    for (const c of DEMO_COMPANIES_SEED) {
      const tId = parseTenantId(c.tenantId);
      const leId = parseLegalEntityId(c.legalEntityId);
      this.store.saveCompany({
        tenantId: tId,
        legalEntityId: leId,
        displayName: c.displayName,
        nip: c.nip,
        legalForm: c.legalForm,
        taxRegime: c.taxRegime,
        vatStatusSimple: c.vatStatusSimple,
        taxProfile: c.taxProfile,
        settingsHistory: [
          {
            version: 1,
            effectiveFrom: c.taxProfile.activityStartDate,
            changedAt: '2026-01-02T08:00:00.000Z',
            changedByUserId: c.tenantId === TENANT_1_ID ? DEMO_USER_JAN_ID : DEMO_USER_PIOTR_ID,
            changeSummaryPl: 'Inicjalna konfiguracja profilu podatkowego i ZUS (dane syntetyczne).',
            taxProfile: c.taxProfile,
          },
        ],
        documents: [],
        kpirEntries: [],
        ryczaltEntries: [],
        vatEntries: [],
        journalEntries: [],
        settlements: [],
        bankTransactions: [],
        reconciliationMatches: [],
        paidObligationsByKey: new Map(),
        explanationsById: new Map(),
        vatPeriodSettlements: new Map(),
        periodCloseStates: new Map(),
        verifiedTaxPayments: [],
      });
    }

    for (const g of DEMO_INITIAL_GRANTS_SEED) {
      this.store.upsertGrant({
        grantId: g.grantId,
        tenantId: parseTenantId(g.tenantId),
        legalEntityId: parseLegalEntityId(g.legalEntityId),
        userId: parseUserId(g.userId),
        action: g.action,
        validFrom,
        validUntil: null,
        revokedAt: null,
      });
    }

    const janActor = this.resolveActorFromPersona('jan-testowy');
    const piotrActor = this.resolveActorFromPersona('piotr-izolacyjny');

    // Firma 1 (JDG KPiR): 2 zaksięgowane faktury + 1 pojazd mieszany + 1 oczekująca na weryfikację + 1 propozycja MCP
    const f1Sales = this.createDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/2026/03/001',
      direction: 'sales',
      issueDate: '2026-03-05',
      dueDate: '2026-03-19',
      counterpartyName: 'Syntetyczny Software House Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      ksefReferenceNumber: '5250001003-20260305-AA11BB22-CC33DD44',
      ksefMarker: 'NrKSeF',
      lines: [
        {
          description: 'Usługi projektowania architektury systemów chmurowych (marzec 2026)',
          netGrosze: 2_000_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, f1Sales.documentId);

    const f1Cloud = this.createDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV-CHMURA/03/2026',
      direction: 'purchase',
      issueDate: '2026-03-08',
      dueDate: '2026-03-22',
      counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      suggestedCategory: 'uslugi_obce',
      lines: [
        {
          description: 'Utrzymanie klastrów testowych i kopii zapasowych (marzec 2026)',
          netGrosze: 120_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, f1Cloud.documentId);

    const f1Fuel = this.createDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV-PALIWO/2026/03/12',
      direction: 'purchase',
      issueDate: '2026-03-12',
      dueDate: '2026-03-26',
      counterpartyName: 'Flota Paliwa Syntetyczne Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.stacjaPaliwFlota,
      suggestedCategory: 'eksploatacja_samochodu_mieszana',
      vatDeductionMode: 'vehicle_mixed_50',
      lines: [
        {
          description: 'Paliwo do samochodu osobowego w użytku mieszanym (75% KUP / 50% VAT)',
          netGrosze: 40_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, f1Fuel.documentId);

    this.createDocument(janActor, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      sourceFormat: 'ksef_xml',
      direction: 'purchase',
      rawPayload: [
        '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
        '  <Podmiot1><DaneIdentyfikacyjne><NIP>5250006006</NIP><Nazwa>Dostawca Sprzętu Test Sp. z o.o.</Nazwa></DaneIdentyfikacyjne></Podmiot1>',
        '  <Podmiot2><DaneIdentyfikacyjne><NIP>5250001003</NIP><Nazwa>Pracownia Projektowa Jan Testowy</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
        '  <Fa><P_1>2026-03-21</P_1><P_2>FV-KSEF/2026/03/99</P_2><P_6>2026-03-21</P_6>',
        '    <FaWiersz><P_7>Monitor biurowy 4K do stanowiska projektowego</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_11>2500.00</P_11><P_12>23</P_12></FaWiersz>',
        '  </Fa>',
        '</Faktura>',
      ].join('\n'),
    });

    this.prepareMcpProposal(
      janActor,
      DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_INPUT,
      DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
    );

    // Firma 2 (JDG Ryczałt + zwolnienie VAT art. 113)
    const f2Sales = this.createDocument(janActor, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
      documentNumber: 'FV-RYCZ/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-10',
      dueDate: '2026-03-24',
      counterpartyName: 'Klient Ryczałt IT Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
      ryczaltRate: '12',
      lines: [
        {
          description:
            'Usługi programistyczne B2B (PKWiU 62.01 — ryczałt 12%, zwolnienie art. 113 VAT)',
          netGrosze: 1_800_000,
          vatRate: 'zw',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, f2Sales.documentId, {
      ryczaltRate: '12',
    });

    // Firma 3 (Sp. z o.o. — pełne księgi UoR + CIT 9%)
    this.createJournalEntry(janActor, TENANT_1_ID, COMPANY_SPZOO_ID, {
      entryNumber: 'BO/2026/01',
      bookingDate: '2026-01-02',
      documentDate: '2026-01-02',
      documentNumber: 'AKT-NOT/2026/01',
      description: 'Bilans otwarcia — wniesienie kapitału zakładowego na rachunek bankowy',
      lines: [
        {
          accountCode: '130',
          side: 'Wn',
          amountGrosze: 10_000_000,
          description: 'Środki pieniężne na rachunku bieżącym',
        },
        {
          accountCode: '800',
          side: 'Ma',
          amountGrosze: 10_000_000,
          description: 'Kapitał zakładowy spółki z o.o.',
        },
      ],
    });

    const f3Sales = this.createDocument(janActor, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FV-SPZOO/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-09',
      dueDate: '2026-03-23',
      counterpartyName: 'Kontrahent Korporacyjny Test Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
      lines: [
        {
          description: 'Wdrożenie modułu analitycznego i integracji bezpieczeństwa',
          netGrosze: 5_000_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_SPZOO_ID, f3Sales.documentId);

    const f3Cost = this.createDocument(janActor, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FV-KOSZT-SPZOO/03/2026',
      direction: 'purchase',
      issueDate: '2026-03-11',
      dueDate: '2026-03-25',
      counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      suggestedCategory: 'uslugi_obce',
      lines: [
        {
          description: 'Infrastruktura serwerowa dedykowana (marzec 2026)',
          netGrosze: 1_000_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(janActor, TENANT_1_ID, COMPANY_SPZOO_ID, f3Cost.documentId);

    // Firma 4 (Tenant 2 — odizolowana organizacja Piotra Izolacyjnego)
    const f4Sales = this.createDocument(piotrActor, TENANT_2_ID, COMPANY_TENANT_2_ID, {
      documentNumber: 'FV-T2/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-07',
      dueDate: '2026-03-21',
      counterpartyName: 'Odbiorca Hurtowy Tenant 2 Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientECommerce,
      lines: [
        {
          description: 'Sprzedaż hurtowa komponentów testowych (Tenant 2)',
          netGrosze: 1_000_000,
          vatRate: '23',
        },
      ],
    });
    this.approveAndPostDocument(piotrActor, TENANT_2_ID, COMPANY_TENANT_2_ID, f4Sales.documentId);
  }
}
