import type {
  AccountingCalculationStep,
  ConfirmBankReconciliationOutput,
  ConfirmMonthCloseOutput,
  ConfirmPreparedProposalOutput,
  LegalBasisReference,
  McpToolErrorEnvelope,
  MonthlyTaxObligation,
  PrepareBankReconciliationOutput,
  PrepareInvoiceAndPostingProposalInput,
  PrepareInvoiceAndPostingProposalOutput,
  PrepareMonthCloseOutput,
  ProposedAccountingPreview,
} from '@pap/contracts/mcp-tools';
import type {
  CitPreferentialEligibilityAttestation,
  CompanyAccessGrant,
  JpkEwpRowInput,
  JpkKrPdJournalEntryInput,
  JpkKrPdRpdSummaryInput,
  JpkKrPdZois7AccountInput,
  JpkPkpirRowInput,
  JpkPolishAddress,
  JpkStEwpAssetRowInput,
  JpkStKrAssetRowInput,
  JpkStPkpirAssetRowInput,
  JpkTaxpayerSubject,
  JpkV7PurchaseRowInput,
  JpkV7SalesRowInput,
  LegalEntityId,
  RyczaltEntry,
  TenantId,
  TenantMembership,
  UserId,
  VerifiedTaxOrZusPayment,
  ZusScheme,
} from '@pap/domain';
import type { AccountantConsultationService } from '../accountant-consultations/index.js';
import type { OidcAccessTokenVerifier, UserIdentityResolver } from '../oidc-authentication.js';
import type { SecurityAuditRecorder } from '../security-audit.js';
import type { Clock, TenantAuthorizationDataSource } from '../tenant-authorization.js';

export interface McpCallContext {
  /** Raw OIDC Bearer token extracted strictly from Authorization header (never logged). */
  readonly rawBearerToken: string | undefined | null;
  readonly correlationId?: string | undefined;
  readonly clientId?: string | undefined;
}

export interface McpAuditEvent {
  readonly auditEventId: string;
  readonly occurredAt: string;
  readonly source: 'mcp';
  readonly toolName: string;
  readonly correlationId: string;
  readonly actorUserId: string | null;
  readonly actorIssuer: string | null;
  readonly actorSubject: string | null;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly outcome: 'allow' | 'deny';
  readonly reasonCode: string;
  readonly idempotencyKey: string | null;
  readonly proposalId: string | null;
  readonly payloadHash: string | null;
  readonly promptInjectionSuspected: boolean;
}

export interface McpAuditSink {
  record(event: McpAuditEvent): Promise<void> | void;
}

export type McpGatewayToolResult<TOutput> =
  | { readonly ok: true; readonly data: TOutput }
  | { readonly ok: false; readonly error: McpToolErrorEnvelope };

export type CompanyTaxRegime = 'kpir_skala' | 'kpir_liniowy' | 'ryczalt' | 'cit_klasyczny';
export type CompanyVatStatus = 'czynny' | 'zwolniony';

export interface CompanyTaxProfile {
  readonly legalForm: 'jdg' | 'sp_z_o_o' | 'spolka_cywilna' | 'spolka_jawna';
  readonly taxRegime: CompanyTaxRegime;
  readonly vatStatus: CompanyVatStatus;
}

export interface CompanyDirectoryRecord extends CompanyTaxProfile {
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly displayName: string;
  readonly nip: string;
  readonly membership: TenantMembership | null;
  readonly grants: readonly CompanyAccessGrant[];
}

export interface UnpaidInvoiceRecord {
  readonly invoiceId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly direction: 'sales' | 'purchase';
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly counterpartyName: string;
  readonly description: string;
  readonly netAmountPln: string;
  readonly vatAmountPln: string;
  readonly grossAmountPln: string;
  readonly remainingGrossAmountPln: string;
  readonly ksefReferenceNumber: string | null;
}

export interface AccountingItemExplanationRecord {
  readonly accountingItemId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly sourceDocumentSummary: string;
  readonly kupAmountPln: string;
  readonly nkupAmountPln: string;
  readonly deductibleVatAmountPln: string;
  readonly nonDeductibleVatAmountPln: string;
  readonly taxCategoryCode: string;
  readonly summaryPl: string;
  readonly calculationSteps: readonly AccountingCalculationStep[];
  readonly appliedRules: readonly LegalBasisReference[];
}

export interface LegalBasisCatalogEntry {
  readonly code: string;
  readonly titlePl: string;
  readonly summaryPl: string;
  readonly legalBasis: LegalBasisReference;
  readonly exceptionsPl: readonly string[];
}

export interface MonthCloseRawData {
  readonly missingDocuments: readonly {
    readonly code: string;
    readonly descriptionPl: string;
    readonly blocking: boolean;
    readonly contextNote: string | null;
  }[];
  readonly unreconciledBankTransfers: readonly {
    readonly bankTransactionId: string;
    readonly bookingDate: string;
    readonly amountPln: string;
    readonly counterpartyName?: string | undefined;
    readonly transferTitle: string;
  }[];
}

export interface UnreconciledBankTransactionRecord {
  readonly bankTransactionId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly bookingDate: string;
  readonly direction: 'credit' | 'debit';
  readonly amountPln: string;
  readonly remainingUnallocatedPln: string;
  readonly counterpartyName: string;
  readonly transferTitle: string;
}

export interface VatPeriodPreviewSnapshot {
  readonly salesEntriesCount: number;
  readonly purchaseEntriesCount: number;
  readonly outputVatPln: string;
  readonly deductibleInputVatPln: string;
  readonly taxDuePln: string;
  readonly excessCarryForwardPln: string;
}

export interface ExternalCompanyAuditRecord {
  readonly auditEventId: string;
  readonly occurredAt: string;
  readonly channel: 'security' | 'access' | 'accounting' | 'mcp' | 'notifications';
  readonly action: string;
  readonly outcome: 'allow' | 'deny' | 'error';
  readonly reasonCode: string;
  readonly summaryPl: string;
}

export interface StoredPreparedProposal {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly createdByUserId: UserId;
  readonly idempotencyKey: string;
  payloadHash: string;
  readonly createdAtIso: string;
  readonly expiresAtMs: number;
  readonly expiresAtIso: string;
  status: 'pending_human_approval' | 'confirming' | 'confirmed' | 'rejected' | 'expired';
  ledgerEntryId: string | null;
  confirmedAtIso: string | null;
  confirmedByUserId?: UserId | null | undefined;
  /** Sanitized invoice fields (stripped of Bidi overrides and control characters) for safe human UI review. */
  readonly invoice: PrepareInvoiceAndPostingProposalInput['invoice'];
  readonly proposedPosting: ProposedAccountingPreview;
}

export interface StoredBankReconciliationProposal {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly createdByUserId: UserId;
  readonly idempotencyKey: string;
  payloadHash: string;
  readonly bankTransactionId: string;
  readonly invoiceId: string;
  readonly allocationGrossPln: string;
  readonly remainingInvoiceGrossBeforePln: string;
  readonly remainingInvoiceGrossAfterPln: string;
  readonly remainingTransactionGrossAfterPln: string;
  readonly createdAtIso: string;
  readonly expiresAtMs: number;
  readonly expiresAtIso: string;
  status: 'pending_human_approval' | 'confirming' | 'confirmed' | 'rejected' | 'expired';
  reconciliationEntryId: string | null;
  confirmedAtIso: string | null;
  confirmedByUserId: UserId | null;
  readonly promptInjectionSuspected: boolean;
}

export interface StoredMonthCloseProposal {
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly period: string;
  readonly createdByUserId: UserId;
  readonly idempotencyKey: string;
  payloadHash: string;
  readonly createdAtIso: string;
  readonly expiresAtMs: number;
  readonly expiresAtIso: string;
  status: 'pending_human_approval' | 'confirming' | 'confirmed' | 'rejected' | 'expired';
  closedAtIso: string | null;
  confirmedByUserId: UserId | null;
}

export interface StoredIdempotencyRecord<T> {
  readonly requestCanonicalHash: string;
  readonly responseData: T;
}

export interface StoredHumanConfirmationChallenge {
  readonly challengeId: string;
  readonly proposalKind: 'invoice_posting' | 'bank_reconciliation' | 'month_close';
  readonly proposalId: string;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly authorizedHumanUserId: UserId;
  readonly expectedPayloadHash: string;
  readonly codeSha256Hex: string;
  readonly expiresAtMs: number;
  consumingInFlight: boolean;
  consumedAtIso: string | null;
}

export interface McpJpkPeriodSourceData {
  readonly taxOfficeCode: string;
  readonly subject: JpkTaxpayerSubject;
  readonly corporateAddress?: JpkPolishAddress | undefined;
  readonly companyRegon?: string | undefined;
  readonly vatSalesRows?: readonly JpkV7SalesRowInput[] | undefined;
  readonly vatPurchaseRows?: readonly JpkV7PurchaseRowInput[] | undefined;
  readonly priorExcessCarryoverPln?: number | undefined;
  readonly quarterlyStartPriorExcessCarryoverPln?: number | undefined;
  readonly quarterlyPriorMonthsCarryGrosze?:
    | {
        readonly exemptNetGrosze?: number;
        readonly outsideCountryNetGrosze?: number;
        readonly zeroDomesticNetGrosze?: number;
        readonly net5Grosze?: number;
        readonly vat5Grosze?: number;
        readonly net8Grosze?: number;
        readonly vat8Grosze?: number;
        readonly net23Grosze?: number;
        readonly vat23Grosze?: number;
        readonly fixedAssetsNetGrosze?: number;
        readonly fixedAssetsVatGrosze?: number;
        readonly otherAcquisitionsNetGrosze?: number;
        readonly otherAcquisitionsVatGrosze?: number;
      }
    | undefined;
  readonly requestedRefundPln?: number | undefined;
  readonly pkpirRows?: readonly JpkPkpirRowInput[] | undefined;
  readonly openingInventoryGrosze?: number | undefined;
  readonly closingInventoryGrosze?: number | undefined;
  readonly ewpRows?: readonly JpkEwpRowInput[] | undefined;
  readonly zois7Accounts?: readonly JpkKrPdZois7AccountInput[] | undefined;
  readonly journalEntries?: readonly JpkKrPdJournalEntryInput[] | undefined;
  readonly rpdSummary?: JpkKrPdRpdSummaryInput | undefined;
  readonly stPkpirRows?: readonly JpkStPkpirAssetRowInput[] | undefined;
  readonly stEwpRows?: readonly JpkStEwpAssetRowInput[] | undefined;
  readonly stKrAssets?: readonly JpkStKrAssetRowInput[] | undefined;
}

export interface McpTaxCalculationSourceData {
  readonly zusScheme: ZusScheme;
  readonly voluntarySicknessInsurance: boolean;
  readonly previousMonthIncomeForHealthGrosze: number;
  readonly ytdRevenueGrosze: number;
  readonly ytdTaxDeductibleCostsGrosze: number;
  readonly previousPitOrCitAdvancesAccruedYtdGrosze?: number | undefined;
  readonly ryczaltEntries: readonly RyczaltEntry[];
  readonly socialZusAlreadyDeductedPriorMonthsYtdGrosze?: number | undefined;
  readonly health50PctAlreadyDeductedPriorMonthsYtdGrosze?: number | undefined;
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
  readonly smallTaxpayer?: boolean | undefined;
  readonly citPreferentialEligibility?: CitPreferentialEligibilityAttestation | undefined;
  readonly taxYearStartDate?: string | undefined;
  readonly taxYearEndDate?: string | undefined;
  readonly vatOutputGrosze?: number | undefined;
  readonly vatDeductibleInputGrosze?: number | undefined;
  readonly vatPriorCarryoverP39Grosze?: number | undefined;
  readonly vatDueToPayP51Grosze?: number | undefined;
  readonly vatNextCarryoverP62Grosze?: number | undefined;
}

export interface PapMcpDataSource {
  listCandidateCompaniesForUser(userId: UserId): Promise<readonly CompanyDirectoryRecord[]>;
  getCompanyTaxProfile?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): Promise<CompanyTaxProfile | null>;
  listUnpaidInvoices(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): Promise<readonly UnpaidInvoiceRecord[]>;
  listMonthlyTaxObligations(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<readonly MonthlyTaxObligation[]>;
  getAccountingItemExplanation(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    accountingItemId: string,
  ): Promise<AccountingItemExplanationRecord | null>;
  getLegalBasisEntry(code: string, asOfDate: string): Promise<LegalBasisCatalogEntry | null>;
  getMonthCloseRawData(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<MonthCloseRawData>;
  listUnreconciledBankTransactions?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period?: string,
  ): Promise<readonly UnreconciledBankTransactionRecord[]>;
  applyConfirmedBankReconciliation?(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly bankTransactionId: string;
    readonly invoiceId: string;
    readonly allocationGrossPln: string;
    readonly confirmedByUserId: UserId;
  }): Promise<{
    readonly reconciliationEntryId: string;
    readonly remainingInvoiceGrossAfterPln: string;
  }>;
  applyConfirmedMonthClose?(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly period: string;
    readonly confirmedByUserId: UserId;
    readonly note?: string | undefined;
  }): Promise<{
    readonly closedAt?: string | undefined;
    readonly closeEventId?: string | undefined;
  } | void>;
  getVatPeriodPreviewSnapshot?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<VatPeriodPreviewSnapshot | null>;
  getJpkPeriodSourceData?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<McpJpkPeriodSourceData | null>;
  getTaxCalculationSourceData?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<McpTaxCalculationSourceData | null>;
  listCompanyAuditEvents?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
  ): Promise<readonly ExternalCompanyAuditRecord[]>;
  isPeriodClosed?(
    tenantId: TenantId,
    legalEntityId: LegalEntityId,
    period: string,
  ): Promise<boolean>;
}

export interface PapMcpGatewayDependencies {
  readonly verifier: OidcAccessTokenVerifier;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly dataSource: PapMcpDataSource;
  readonly consultationService?: AccountantConsultationService | undefined;
  readonly securityAudit?: SecurityAuditRecorder | undefined;
  readonly auditSink?: McpAuditSink | undefined;
  readonly clock?: Clock | undefined;
  readonly proposalTtlMs?: number | undefined;
  readonly humanConfirmationTtlMs?: number | undefined;
  readonly rateLimitMaxCallsPerMinute?: number | undefined;
}

export interface PapMcpMutableState {
  readonly proposalsById: Map<string, StoredPreparedProposal>;
  readonly prepareIdempotency: Map<
    string,
    StoredIdempotencyRecord<PrepareInvoiceAndPostingProposalOutput>
  >;
  readonly confirmIdempotency: Map<string, StoredIdempotencyRecord<ConfirmPreparedProposalOutput>>;
  readonly bankProposalsById: Map<string, StoredBankReconciliationProposal>;
  readonly bankPrepareIdempotency: Map<
    string,
    StoredIdempotencyRecord<PrepareBankReconciliationOutput>
  >;
  readonly bankConfirmIdempotency: Map<
    string,
    StoredIdempotencyRecord<ConfirmBankReconciliationOutput>
  >;
  readonly monthCloseProposalsById: Map<string, StoredMonthCloseProposal>;
  readonly monthCloseIdempotency: Map<string, StoredIdempotencyRecord<PrepareMonthCloseOutput>>;
  readonly monthCloseConfirmIdempotency: Map<
    string,
    StoredIdempotencyRecord<ConfirmMonthCloseOutput>
  >;
  readonly humanChallengesByProposal: Map<string, StoredHumanConfirmationChallenge>;
  readonly recordedAuditHistory: McpAuditEvent[];
}
