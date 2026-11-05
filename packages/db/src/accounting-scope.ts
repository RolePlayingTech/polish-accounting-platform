import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray } from 'drizzle-orm';
import {
  accountingDocument,
  bankStatementImport,
  bankTransaction,
  companyTaxSettings,
  journalEntry,
  journalLine,
  kpirEntry,
  ledgerAccount,
  mcpPreparedProposal,
  notificationOutbox,
  notificationPreference,
  ryczaltEntry,
  sandboxMailboxMessage,
  settlementItem,
  taxObligationItem,
  vatRegisterEntry,
} from './accounting-schema.js';
import {
  createPostgresCompanyActionScope,
  type PostgresCompanyActionScope,
  type PostgresCompanyActionScopeDriver,
} from './company-operation-probe.js';
import { companyAccessGrant, legalEntity } from './core-schema.js';

export type GroszeInput = number | bigint;

export type LegalEntityDirectoryRecord = typeof legalEntity.$inferSelect;
export type CompanyAccessGrantRecord = typeof companyAccessGrant.$inferSelect;

export type CompanyTaxSettingsRecord = typeof companyTaxSettings.$inferSelect;
export type AccountingDocumentRecord = typeof accountingDocument.$inferSelect;
export type KpirEntryRecord = typeof kpirEntry.$inferSelect;
export type RyczaltEntryRecord = typeof ryczaltEntry.$inferSelect;
export type VatRegisterEntryRecord = typeof vatRegisterEntry.$inferSelect;
export type LedgerAccountRecord = typeof ledgerAccount.$inferSelect;
export type JournalEntryRecord = typeof journalEntry.$inferSelect;
export type JournalLineRecord = typeof journalLine.$inferSelect;
export type SettlementItemRecord = typeof settlementItem.$inferSelect;
export type BankStatementImportRecord = typeof bankStatementImport.$inferSelect;
export type BankTransactionRecord = typeof bankTransaction.$inferSelect;
export type TaxObligationItemRecord = typeof taxObligationItem.$inferSelect;
export type McpPreparedProposalRecord = typeof mcpPreparedProposal.$inferSelect;
export type NotificationPreferenceRecord = typeof notificationPreference.$inferSelect;
export type NotificationOutboxRecord = typeof notificationOutbox.$inferSelect;
export type SandboxMailboxMessageRecord = typeof sandboxMailboxMessage.$inferSelect;

export interface JournalEntryWithLinesRecord {
  readonly entry: JournalEntryRecord;
  readonly lines: readonly JournalLineRecord[];
}

export interface UpsertCompanyTaxSettingsInput {
  readonly id?: string;
  readonly nip: string;
  readonly regon?: string | null;
  readonly krs?: string | null;
  readonly legalForm: CompanyTaxSettingsRecord['legalForm'];
  readonly taxRegime: CompanyTaxSettingsRecord['taxRegime'];
  readonly vatStatus: CompanyTaxSettingsRecord['vatStatus'];
  readonly zusStage: CompanyTaxSettingsRecord['zusStage'];
  readonly ksefMode: CompanyTaxSettingsRecord['ksefMode'];
  readonly defaultIban?: string | null;
  readonly addressSummary: string;
  readonly smallTaxpayer?: boolean;
  readonly voluntarySicknessInsurance?: boolean;
  readonly updatedAt?: Date;
}

export interface ListAccountingDocumentsFilter {
  readonly status?: AccountingDocumentRecord['status'];
  readonly documentType?: AccountingDocumentRecord['documentType'];
}

export interface CreateAccountingDocumentInput {
  readonly id?: string;
  readonly documentType: AccountingDocumentRecord['documentType'];
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly saleDate: string;
  readonly dueDate?: string | null;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string | null;
  readonly counterpartyAddress?: string | null;
  readonly netGrosze: GroszeInput;
  readonly vatGrosze: GroszeInput;
  readonly grossGrosze: GroszeInput;
  readonly sha256Hash: string;
  readonly status?: 'draft' | 'ai_proposed' | 'verified_posted';
  readonly categoryCode: string;
  readonly description?: string;
  readonly vehicleUsage?: AccountingDocumentRecord['vehicleUsage'];
  readonly ksefReference?: string | null;
  readonly ksefMarker?: AccountingDocumentRecord['ksefMarker'];
  readonly aiProposalJson?: Readonly<Record<string, unknown>> | null;
  readonly verifiedAt?: Date;
}

export interface VerifyAccountingDocumentInput {
  readonly documentId: string;
  readonly documentNumber?: string;
  readonly issueDate?: string;
  readonly saleDate?: string;
  readonly dueDate?: string | null;
  readonly counterpartyName?: string;
  readonly counterpartyNip?: string | null;
  readonly counterpartyAddress?: string | null;
  readonly netGrosze?: GroszeInput;
  readonly vatGrosze?: GroszeInput;
  readonly grossGrosze?: GroszeInput;
  readonly categoryCode?: string;
  readonly vehicleUsage?: AccountingDocumentRecord['vehicleUsage'];
  readonly description?: string;
  readonly ksefReference?: string | null;
  readonly ksefMarker?: AccountingDocumentRecord['ksefMarker'];
  readonly verifiedAt?: Date;
}

export type VerifyAndPostAccountingDocumentInput = VerifyAccountingDocumentInput;

export interface AppendKpirEntryInput {
  readonly id?: string;
  readonly lp: number;
  readonly period: string;
  readonly eventDate: string;
  readonly documentId?: string | null;
  readonly documentNumber: string;
  readonly ksefReference?: string | null;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string | null;
  readonly counterpartyAddress: string;
  readonly description: string;
  readonly regulationVersion?: KpirEntryRecord['regulationVersion'];
  readonly col7SalesRevenueGrosze?: GroszeInput;
  readonly col8OtherRevenueGrosze?: GroszeInput;
  readonly col10GoodsMaterialsGrosze?: GroszeInput;
  readonly col11IncidentalCostsGrosze?: GroszeInput;
  readonly col12RemunerationGrosze?: GroszeInput;
  readonly col13OtherExpensesGrosze?: GroszeInput;
  readonly rdCostGrosze?: GroszeInput;
  readonly remarks?: string | null;
  readonly isStorno?: boolean;
  readonly stornoOfEntryId?: string | null;
  readonly ruleCode: string;
  readonly legalExplanationJson: Readonly<Record<string, unknown>>;
}

export interface AppendRyczaltEntryInput {
  readonly id?: string;
  readonly lp: number;
  readonly period: string;
  readonly eventDate: string;
  readonly documentId?: string | null;
  readonly documentNumber: string;
  readonly counterpartyName?: string;
  readonly counterpartyNip?: string | null;
  readonly ksefReference?: string | null;
  readonly rateBps: number;
  readonly revenueGrosze: GroszeInput;
  readonly isCorrection?: boolean;
  readonly correctedEntryId?: string | null;
  readonly legalExplanationJson: Readonly<Record<string, unknown>>;
}

export interface AppendVatRegisterEntryInput {
  readonly id?: string;
  readonly direction: VatRegisterEntryRecord['direction'];
  readonly period: string;
  readonly taxPointDate: string;
  readonly documentId?: string | null;
  readonly documentNumber: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string | null;
  readonly vatRateCode: VatRegisterEntryRecord['vatRateCode'];
  readonly netGrosze: GroszeInput;
  readonly vatTotalGrosze: GroszeInput;
  readonly vatDeductibleGrosze: GroszeInput;
  readonly vatNonDeductibleGrosze: GroszeInput;
  readonly gtuCodes?: readonly string[];
  readonly procedureMarkers?: readonly string[];
  readonly ksefMarker?: VatRegisterEntryRecord['ksefMarker'];
  readonly ksefReference?: string | null;
  readonly legalExplanationJson: Readonly<Record<string, unknown>>;
}

export interface UpsertLedgerAccountInput {
  readonly id?: string;
  readonly accountCode: string;
  readonly namePl: string;
  readonly teamNumber: number;
  readonly accountNature: LedgerAccountRecord['accountNature'];
  readonly isActive?: boolean;
}

export interface PostJournalLineInput {
  readonly id?: string;
  readonly ledgerAccountId: string;
  readonly accountCode: string;
  readonly side: 'Wn' | 'Ma';
  readonly amountGrosze: GroszeInput;
  readonly description: string;
}

export interface PostJournalEntryInput {
  readonly id?: string;
  readonly entryNumber: string;
  readonly period: string;
  readonly bookingDate: string;
  readonly documentDate: string;
  readonly documentId?: string | null;
  readonly documentNumber: string;
  readonly description: string;
  readonly isStorno?: boolean;
  readonly stornoOfEntryId?: string | null;
  readonly legalExplanationJson?: Readonly<Record<string, unknown>> | null;
  readonly lines: readonly PostJournalLineInput[];
}

export interface CreateSettlementItemInput {
  readonly id?: string;
  readonly documentId?: string | null;
  readonly direction: SettlementItemRecord['direction'];
  readonly counterpartyName: string;
  readonly counterpartyNip?: string | null;
  readonly counterpartyIban?: string | null;
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly originalGrossGrosze: GroszeInput;
}

export interface ApplySettlementPaymentInput {
  readonly settlementId: string;
  readonly paidAmountGrosze: GroszeInput;
  readonly settledAt?: Date;
}

export interface ImportBankTransactionItemInput {
  readonly id?: string;
  readonly externalRef?: string | null;
  readonly bookingDate: string;
  readonly valueDate?: string | null;
  readonly direction: BankTransactionRecord['direction'];
  readonly amountGrosze: GroszeInput;
  readonly counterpartyName: string;
  readonly counterpartyIban?: string | null;
  readonly counterpartyNip?: string | null;
  readonly title: string;
}

export interface ImportBankStatementInput {
  readonly id?: string;
  readonly sourceFormat: BankStatementImportRecord['sourceFormat'];
  readonly fileName: string;
  readonly sha256Hash: string;
  readonly iban?: string | null;
  readonly statementReference?: string | null;
  readonly periodFrom?: string | null;
  readonly periodTo?: string | null;
  readonly openingBalanceGrosze?: GroszeInput | null;
  readonly closingBalanceGrosze?: GroszeInput | null;
  readonly transactions: readonly ImportBankTransactionItemInput[];
}

export interface RecordBankTransactionMatchInput {
  readonly transactionId: string;
  readonly matchStatus: BankTransactionRecord['matchStatus'];
  readonly matchedSettlementId?: string | null;
  readonly matchedDocumentId?: string | null;
  readonly settledAmountGrosze: GroszeInput;
  readonly matchNotes?: string | null;
  readonly updatedAt?: Date;
}

export interface UpsertTaxObligationInput {
  readonly id?: string;
  readonly period: string;
  readonly obligationCode: string;
  readonly category: TaxObligationItemRecord['category'];
  readonly titlePl: string;
  readonly statutoryDueDate: string;
  readonly adjustedDueDate: string;
  readonly shiftReason?: string | null;
  readonly estimatedAmountGrosze?: GroszeInput | null;
  readonly status?: TaxObligationItemRecord['status'];
  readonly legalBasisJson: Readonly<Record<string, unknown>>;
  readonly paidAt?: Date | null;
}

export interface UpdateTaxObligationStatusInput {
  readonly obligationId: string;
  readonly status: TaxObligationItemRecord['status'];
  readonly paidAt?: Date | null;
}

export interface SaveMcpPreparedProposalInput {
  readonly proposalId?: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly invoiceJson: Readonly<Record<string, unknown>>;
  readonly proposedPostingJson: Readonly<Record<string, unknown>>;
  readonly confirmationChallengeHash: string;
  readonly expiresAt: Date;
}

export interface ConfirmMcpPreparedProposalInput {
  readonly proposalId: string;
  readonly confirmationChallengeHash: string;
  readonly ledgerEntryId: string;
  readonly confirmedAt?: Date;
}

export interface UpsertNotificationPreferenceInput {
  readonly id?: string;
  readonly userId?: string;
  readonly recipientEmail: string;
  readonly frequency?: NotificationPreferenceRecord['frequency'];
  readonly optOut?: boolean;
  readonly advanceDays?: readonly number[];
  readonly disabledStages?: readonly string[];
  readonly updatedAt?: Date;
}

export interface EnqueueNotificationOutboxInput {
  readonly id?: string;
  readonly userId?: string;
  readonly obligationId?: string | null;
  readonly obligationCode: string;
  readonly stage: NotificationOutboxRecord['stage'];
  readonly dedupKey: string;
  readonly recipientEmail: string;
  readonly subject: string;
  readonly payloadJson: Readonly<Record<string, unknown>>;
  readonly status?: NotificationOutboxRecord['status'];
  readonly maxAttempts?: number;
  readonly nextAttemptAt?: Date | null;
}

export interface UpdateNotificationOutboxStatusInput {
  readonly outboxId: string;
  readonly status: NotificationOutboxRecord['status'];
  readonly attemptCount: number;
  readonly nextAttemptAt?: Date | null;
  readonly lastErrorRedacted?: string | null;
  readonly updatedAt?: Date;
}

export interface AppendSandboxMailboxMessageInput {
  readonly id?: string;
  readonly outboxId?: string | null;
  readonly recipientEmail: string;
  readonly subject: string;
  readonly rawRfc5322Mime: string;
  readonly obligationCode: string;
}

/**
 * Izolowany uchwyt repozytorium księgowego przekazywany wewnątrz `executeAuthorizedCompanyAction`.
 * Wymusza:
 * - kontrolę aktywności zakresu (`ScopeClosedError`) przed i po każdym zapytaniu,
 * - automatyczny, idempotentny zapis `company_operation_probe` w każdej transakcji `write`
 *   (wymagany przez wyzwalacze `pap_committed_decision_consistent` oraz `pap_require_accounting_write_audit`),
 * - jawne wiązanie `(tenantId, legalEntityId)` obok `FORCE ROW LEVEL SECURITY`,
 * - brak ekspozycji `PostgresTransaction` (`tx`) na zewnątrz.
 */
export interface PostgresAccountingScope extends PostgresCompanyActionScope {
  getLegalEntitySummary(): Promise<LegalEntityDirectoryRecord | null>;
  listActorTenantCompanyGrants(): Promise<readonly CompanyAccessGrantRecord[]>;
  getCompanyTaxSettings(): Promise<CompanyTaxSettingsRecord | null>;
  upsertCompanyTaxSettings(input: UpsertCompanyTaxSettingsInput): Promise<CompanyTaxSettingsRecord>;

  listAccountingDocuments(
    filter?: ListAccountingDocumentsFilter,
  ): Promise<readonly AccountingDocumentRecord[]>;
  getAccountingDocumentById(documentId: string): Promise<AccountingDocumentRecord | null>;
  findAccountingDocumentBySha256(sha256Hash: string): Promise<AccountingDocumentRecord | null>;
  createAccountingDocument(input: CreateAccountingDocumentInput): Promise<{
    readonly document: AccountingDocumentRecord;
    readonly deduplicated: boolean;
  }>;
  verifyAndPostAccountingDocument(
    input: VerifyAccountingDocumentInput,
  ): Promise<AccountingDocumentRecord>;
  archiveAccountingDocument(documentId: string): Promise<AccountingDocumentRecord>;

  listKpirEntries(filter?: { readonly period?: string }): Promise<readonly KpirEntryRecord[]>;
  appendKpirEntry(input: AppendKpirEntryInput): Promise<KpirEntryRecord>;

  listRyczaltEntries(filter?: { readonly period?: string }): Promise<readonly RyczaltEntryRecord[]>;
  appendRyczaltEntry(input: AppendRyczaltEntryInput): Promise<RyczaltEntryRecord>;

  listVatRegisterEntries(filter?: {
    readonly period?: string;
    readonly direction?: 'sales' | 'purchase';
  }): Promise<readonly VatRegisterEntryRecord[]>;
  appendVatRegisterEntry(input: AppendVatRegisterEntryInput): Promise<VatRegisterEntryRecord>;

  listLedgerAccounts(): Promise<readonly LedgerAccountRecord[]>;
  upsertLedgerAccount(input: UpsertLedgerAccountInput): Promise<LedgerAccountRecord>;
  listJournalEntries(filter?: {
    readonly period?: string;
  }): Promise<readonly JournalEntryWithLinesRecord[]>;
  postJournalEntry(input: PostJournalEntryInput): Promise<JournalEntryWithLinesRecord>;

  listSettlementItems(filter?: {
    readonly status?: SettlementItemRecord['status'];
    readonly direction?: SettlementItemRecord['direction'];
  }): Promise<readonly SettlementItemRecord[]>;
  createSettlementItem(input: CreateSettlementItemInput): Promise<SettlementItemRecord>;
  applySettlementPayment(input: ApplySettlementPaymentInput): Promise<SettlementItemRecord>;

  importBankStatement(input: ImportBankStatementInput): Promise<{
    readonly statement: BankStatementImportRecord;
    readonly transactions: readonly BankTransactionRecord[];
    readonly deduplicated: boolean;
  }>;
  listBankTransactions(filter?: {
    readonly matchStatus?: BankTransactionRecord['matchStatus'];
  }): Promise<readonly BankTransactionRecord[]>;
  recordBankTransactionMatch(
    input: RecordBankTransactionMatchInput,
  ): Promise<BankTransactionRecord>;

  listTaxObligations(filter?: {
    readonly period?: string;
    readonly status?: TaxObligationItemRecord['status'];
  }): Promise<readonly TaxObligationItemRecord[]>;
  upsertTaxObligation(input: UpsertTaxObligationInput): Promise<TaxObligationItemRecord>;
  updateTaxObligationStatus(
    input: UpdateTaxObligationStatusInput,
  ): Promise<TaxObligationItemRecord>;

  getMcpPreparedProposal(proposalId: string): Promise<McpPreparedProposalRecord | null>;
  saveMcpPreparedProposal(input: SaveMcpPreparedProposalInput): Promise<{
    readonly proposal: McpPreparedProposalRecord;
    readonly deduplicated: boolean;
  }>;
  confirmMcpPreparedProposal(
    input: ConfirmMcpPreparedProposalInput,
  ): Promise<McpPreparedProposalRecord>;
  rejectMcpPreparedProposal(proposalId: string): Promise<McpPreparedProposalRecord>;
  expireMcpPreparedProposal(proposalId: string): Promise<McpPreparedProposalRecord>;

  getNotificationPreference(targetUserId?: string): Promise<NotificationPreferenceRecord | null>;
  upsertNotificationPreference(
    input: UpsertNotificationPreferenceInput,
  ): Promise<NotificationPreferenceRecord>;
  listNotificationOutbox(filter?: {
    readonly status?: NotificationOutboxRecord['status'];
  }): Promise<readonly NotificationOutboxRecord[]>;
  enqueueNotificationOutbox(input: EnqueueNotificationOutboxInput): Promise<{
    readonly item: NotificationOutboxRecord;
    readonly deduplicated: boolean;
  }>;
  updateNotificationOutboxStatus(
    input: UpdateNotificationOutboxStatusInput,
  ): Promise<NotificationOutboxRecord>;
  appendSandboxMailboxMessage(
    input: AppendSandboxMailboxMessageInput,
  ): Promise<SandboxMailboxMessageRecord>;
  listSandboxMailboxMessages(): Promise<readonly SandboxMailboxMessageRecord[]>;
}

function toSafeGrosze(value: GroszeInput, fieldName: string): number {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`Kwota ${fieldName} przekracza bezpieczny zakres całkowity groszy.`);
    }
    return Number(value);
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Kwota ${fieldName} musi być liczbą całkowitą w groszach (nigdy float).`);
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function createPostgresAccountingScope(
  driver: PostgresCompanyActionScopeDriver,
): PostgresAccountingScope {
  const { tx, context, assertActive } = driver;
  const baseScope = createPostgresCompanyActionScope(driver);
  let probePromise: Promise<{ readonly inserted: boolean }> | undefined;

  const decisionTimestamp = (): Date =>
    context.decisionAt ? new Date(context.decisionAt) : new Date();

  const ensureWriteOperationProbe = async (): Promise<{ readonly inserted: boolean }> => {
    assertActive();
    if (context.action !== 'write') {
      throw new Error('Operacja zapisu księgowego wymaga jawnego prawa zapisu.');
    }
    probePromise ??= baseScope.recordOperationProbe(context.operationId);
    const probe = await probePromise;
    assertActive();
    return probe;
  };

  return Object.freeze<PostgresAccountingScope>({
    async recordOperationProbe(rawOperationId?: string) {
      assertActive();
      if (rawOperationId !== undefined && rawOperationId !== context.operationId) {
        return baseScope.recordOperationProbe(rawOperationId);
      }
      probePromise ??= baseScope.recordOperationProbe(rawOperationId);
      const probe = await probePromise;
      assertActive();
      return probe;
    },

    async getLegalEntitySummary() {
      assertActive();
      const [row] = await tx
        .select()
        .from(legalEntity)
        .where(
          and(
            eq(legalEntity.tenantId, context.tenantId),
            eq(legalEntity.id, context.legalEntityId),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async listActorTenantCompanyGrants() {
      assertActive();
      const rows = await tx
        .select()
        .from(companyAccessGrant)
        .where(
          and(
            eq(companyAccessGrant.tenantId, context.tenantId),
            eq(companyAccessGrant.userId, context.actorUserId),
          ),
        )
        .orderBy(asc(companyAccessGrant.validFrom), asc(companyAccessGrant.grantId));
      assertActive();
      return deepFreeze(rows);
    },

    async getCompanyTaxSettings() {
      assertActive();
      const [row] = await tx
        .select()
        .from(companyTaxSettings)
        .where(
          and(
            eq(companyTaxSettings.tenantId, context.tenantId),
            eq(companyTaxSettings.legalEntityId, context.legalEntityId),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async upsertCompanyTaxSettings(input) {
      const probe = await ensureWriteOperationProbe();
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(companyTaxSettings)
          .where(
            and(
              eq(companyTaxSettings.tenantId, context.tenantId),
              eq(companyTaxSettings.legalEntityId, context.legalEntityId),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error(
            'Powtórzenie operacji nie znalazło zapisanego profilu podatkowego firmy.',
          );
        }
        return deepFreeze(existing);
      }
      const now = input.updatedAt ?? decisionTimestamp();
      const [saved] = await tx
        .insert(companyTaxSettings)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          nip: input.nip,
          regon: input.regon ?? null,
          krs: input.krs ?? null,
          legalForm: input.legalForm,
          taxRegime: input.taxRegime,
          vatStatus: input.vatStatus,
          zusStage: input.zusStage,
          ksefMode: input.ksefMode,
          defaultIban: input.defaultIban ?? null,
          addressSummary: input.addressSummary,
          smallTaxpayer: input.smallTaxpayer ?? true,
          voluntarySicknessInsurance: input.voluntarySicknessInsurance ?? true,
          updatedAt: now,
          updatedBy: context.actorUserId,
        })
        .onConflictDoUpdate({
          target: [companyTaxSettings.tenantId, companyTaxSettings.legalEntityId],
          set: {
            nip: input.nip,
            regon: input.regon ?? null,
            krs: input.krs ?? null,
            legalForm: input.legalForm,
            taxRegime: input.taxRegime,
            vatStatus: input.vatStatus,
            zusStage: input.zusStage,
            ksefMode: input.ksefMode,
            defaultIban: input.defaultIban ?? null,
            addressSummary: input.addressSummary,
            smallTaxpayer: input.smallTaxpayer ?? true,
            voluntarySicknessInsurance: input.voluntarySicknessInsurance ?? true,
            updatedAt: now,
            updatedBy: context.actorUserId,
          },
        })
        .returning();
      assertActive();
      if (!saved) {
        throw new Error('Nie udało się zapisać profilu podatkowego firmy.');
      }
      return deepFreeze(saved);
    },

    async listAccountingDocuments(filter) {
      assertActive();
      const conditions = [
        eq(accountingDocument.tenantId, context.tenantId),
        eq(accountingDocument.legalEntityId, context.legalEntityId),
      ];
      if (filter?.status) {
        conditions.push(eq(accountingDocument.status, filter.status));
      }
      if (filter?.documentType) {
        conditions.push(eq(accountingDocument.documentType, filter.documentType));
      }
      const rows = await tx
        .select()
        .from(accountingDocument)
        .where(and(...conditions))
        .orderBy(desc(accountingDocument.issueDate), desc(accountingDocument.createdAt));
      assertActive();
      return deepFreeze(rows);
    },

    async getAccountingDocumentById(documentId) {
      assertActive();
      const [row] = await tx
        .select()
        .from(accountingDocument)
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.id, documentId),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async findAccountingDocumentBySha256(sha256Hash) {
      assertActive();
      const [row] = await tx
        .select()
        .from(accountingDocument)
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.sha256Hash, sha256Hash),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async createAccountingDocument(input) {
      const probe = await ensureWriteOperationProbe();
      const netGrosze = toSafeGrosze(input.netGrosze, 'netGrosze');
      const vatGrosze = toSafeGrosze(input.vatGrosze, 'vatGrosze');
      const grossGrosze = toSafeGrosze(input.grossGrosze, 'grossGrosze');
      if (netGrosze + vatGrosze !== grossGrosze) {
        throw new Error(
          'Niespójność kwot dokumentu: netGrosze + vatGrosze musi równać się grossGrosze.',
        );
      }
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(accountingDocument)
          .where(
            and(
              eq(accountingDocument.tenantId, context.tenantId),
              eq(accountingDocument.legalEntityId, context.legalEntityId),
              eq(accountingDocument.sha256Hash, input.sha256Hash),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error(
            'Powtórzenie operacji nie znalazło dokumentu o wskazanym skrócie SHA-256.',
          );
        }
        return deepFreeze({ document: existing, deduplicated: true });
      }

      const status = input.status ?? (input.aiProposalJson ? 'ai_proposed' : 'draft');
      const now = decisionTimestamp();
      const inserted = await tx
        .insert(accountingDocument)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          documentType: input.documentType,
          documentNumber: input.documentNumber,
          issueDate: input.issueDate,
          saleDate: input.saleDate,
          dueDate: input.dueDate ?? null,
          counterpartyName: input.counterpartyName,
          counterpartyNip: input.counterpartyNip ?? null,
          counterpartyAddress: input.counterpartyAddress ?? null,
          currency: 'PLN',
          netGrosze,
          vatGrosze,
          grossGrosze,
          sha256Hash: input.sha256Hash,
          status,
          categoryCode: input.categoryCode,
          description: input.description ?? '',
          vehicleUsage: input.vehicleUsage ?? 'none',
          ksefReference: input.ksefReference ?? null,
          ksefMarker: input.ksefMarker ?? 'NONE',
          aiProposalJson: input.aiProposalJson ?? null,
          verifiedBy: status === 'verified_posted' ? context.actorUserId : null,
          verifiedAt: status === 'verified_posted' ? (input.verifiedAt ?? now) : null,
          createdBy: context.actorUserId,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [
            accountingDocument.tenantId,
            accountingDocument.legalEntityId,
            accountingDocument.sha256Hash,
          ],
        })
        .returning();
      assertActive();

      if (inserted[0]) {
        return deepFreeze({ document: inserted[0], deduplicated: false });
      }
      const [existing] = await tx
        .select()
        .from(accountingDocument)
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.sha256Hash, input.sha256Hash),
          ),
        );
      assertActive();
      if (!existing) {
        throw new Error('Nie udało się odczytać zdeduplikowanego dokumentu księgowego.');
      }
      return deepFreeze({ document: existing, deduplicated: true });
    },

    async verifyAndPostAccountingDocument(input) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(accountingDocument)
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.id, input.documentId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono dokumentu księgowego do zatwierdzenia.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'verified_posted') {
        throw new Error('Dokument księgowy został już zatwierdzony i zaksięgowany.');
      }
      if (current.status === 'archived') {
        throw new Error('Nie można zaksięgować zarchiwizowanego dokumentu.');
      }
      const netGrosze =
        input.netGrosze === undefined
          ? Number(current.netGrosze)
          : toSafeGrosze(input.netGrosze, 'netGrosze');
      const vatGrosze =
        input.vatGrosze === undefined
          ? Number(current.vatGrosze)
          : toSafeGrosze(input.vatGrosze, 'vatGrosze');
      const grossGrosze =
        input.grossGrosze === undefined
          ? Number(current.grossGrosze)
          : toSafeGrosze(input.grossGrosze, 'grossGrosze');
      if (netGrosze + vatGrosze !== grossGrosze) {
        throw new Error(
          'Niespójność kwot dokumentu przy zatwierdzaniu: netGrosze + vatGrosze musi równać się grossGrosze.',
        );
      }
      const verifiedAt = input.verifiedAt ?? decisionTimestamp();
      const [updated] = await tx
        .update(accountingDocument)
        .set({
          status: 'verified_posted',
          documentNumber: input.documentNumber ?? current.documentNumber,
          issueDate: input.issueDate ?? current.issueDate,
          saleDate: input.saleDate ?? current.saleDate,
          dueDate: input.dueDate === undefined ? current.dueDate : input.dueDate,
          counterpartyName: input.counterpartyName ?? current.counterpartyName,
          counterpartyNip:
            input.counterpartyNip === undefined ? current.counterpartyNip : input.counterpartyNip,
          counterpartyAddress:
            input.counterpartyAddress === undefined
              ? current.counterpartyAddress
              : input.counterpartyAddress,
          netGrosze,
          vatGrosze,
          grossGrosze,
          categoryCode: input.categoryCode ?? current.categoryCode,
          vehicleUsage: input.vehicleUsage ?? current.vehicleUsage,
          description: input.description ?? current.description,
          ksefReference:
            input.ksefReference === undefined ? current.ksefReference : input.ksefReference,
          ksefMarker: input.ksefMarker ?? current.ksefMarker,
          verifiedBy: context.actorUserId,
          verifiedAt,
        })
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.id, input.documentId),
            inArray(accountingDocument.status, ['draft', 'ai_proposed']),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error('Nie udało się zatwierdzić dokumentu księgowego — nieprawidłowy stan.');
      }
      return deepFreeze(updated);
    },

    async archiveAccountingDocument(documentId) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(accountingDocument)
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.id, documentId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono dokumentu księgowego do archiwizacji.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'archived') {
        throw new Error('Dokument księgowy został już zarchiwizowany.');
      }
      const [updated] = await tx
        .update(accountingDocument)
        .set({ status: 'archived' })
        .where(
          and(
            eq(accountingDocument.tenantId, context.tenantId),
            eq(accountingDocument.legalEntityId, context.legalEntityId),
            eq(accountingDocument.id, documentId),
            inArray(accountingDocument.status, ['draft', 'ai_proposed', 'verified_posted']),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error('Nie udało się zarchiwizować dokumentu księgowego — nieprawidłowy stan.');
      }
      return deepFreeze(updated);
    },

    async listKpirEntries(filter) {
      assertActive();
      const conditions = [
        eq(kpirEntry.tenantId, context.tenantId),
        eq(kpirEntry.legalEntityId, context.legalEntityId),
      ];
      if (filter?.period) {
        conditions.push(eq(kpirEntry.period, filter.period));
      }
      const rows = await tx
        .select()
        .from(kpirEntry)
        .where(and(...conditions))
        .orderBy(asc(kpirEntry.period), asc(kpirEntry.lp));
      assertActive();
      return deepFreeze(rows);
    },

    async appendKpirEntry(input) {
      const probe = await ensureWriteOperationProbe();
      const col7 = toSafeGrosze(input.col7SalesRevenueGrosze ?? 0, 'col7SalesRevenueGrosze');
      const col8 = toSafeGrosze(input.col8OtherRevenueGrosze ?? 0, 'col8OtherRevenueGrosze');
      const col9 = toSafeGrosze(col7 + col8, 'col9TotalRevenueGrosze');
      const col10 = toSafeGrosze(input.col10GoodsMaterialsGrosze ?? 0, 'col10GoodsMaterialsGrosze');
      const col11 = toSafeGrosze(
        input.col11IncidentalCostsGrosze ?? 0,
        'col11IncidentalCostsGrosze',
      );
      const col12 = toSafeGrosze(input.col12RemunerationGrosze ?? 0, 'col12RemunerationGrosze');
      const col13 = toSafeGrosze(input.col13OtherExpensesGrosze ?? 0, 'col13OtherExpensesGrosze');
      const col14 = toSafeGrosze(col12 + col13, 'col14TotalExpensesGrosze');
      const rdCost = toSafeGrosze(input.rdCostGrosze ?? 0, 'rdCostGrosze');

      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(kpirEntry)
          .where(
            and(
              eq(kpirEntry.tenantId, context.tenantId),
              eq(kpirEntry.legalEntityId, context.legalEntityId),
              eq(kpirEntry.period, input.period),
              eq(kpirEntry.lp, input.lp),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło wpisu KPiR.');
        }
        return deepFreeze(existing);
      }

      const [created] = await tx
        .insert(kpirEntry)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          lp: input.lp,
          period: input.period,
          eventDate: input.eventDate,
          documentId: input.documentId ?? null,
          documentNumber: input.documentNumber,
          ksefReference: input.ksefReference ?? null,
          counterpartyName: input.counterpartyName,
          counterpartyNip: input.counterpartyNip ?? null,
          counterpartyAddress: input.counterpartyAddress,
          description: input.description,
          regulationVersion: input.regulationVersion ?? 'pkpir_2026_ksef',
          col7SalesRevenueGrosze: col7,
          col8OtherRevenueGrosze: col8,
          col9TotalRevenueGrosze: col9,
          col10GoodsMaterialsGrosze: col10,
          col11IncidentalCostsGrosze: col11,
          col12RemunerationGrosze: col12,
          col13OtherExpensesGrosze: col13,
          col14TotalExpensesGrosze: col14,
          rdCostGrosze: rdCost,
          remarks: input.remarks ?? null,
          isStorno: input.isStorno ?? false,
          stornoOfEntryId: input.stornoOfEntryId ?? null,
          ruleCode: input.ruleCode,
          legalExplanationJson: input.legalExplanationJson,
          createdBy: context.actorUserId,
          createdAt: decisionTimestamp(),
        })
        .returning();
      assertActive();
      if (!created) {
        throw new Error('Nie udało się dopisać pozycji KPiR.');
      }
      return deepFreeze(created);
    },

    async listRyczaltEntries(filter) {
      assertActive();
      const conditions = [
        eq(ryczaltEntry.tenantId, context.tenantId),
        eq(ryczaltEntry.legalEntityId, context.legalEntityId),
      ];
      if (filter?.period) {
        conditions.push(eq(ryczaltEntry.period, filter.period));
      }
      const rows = await tx
        .select()
        .from(ryczaltEntry)
        .where(and(...conditions))
        .orderBy(asc(ryczaltEntry.period), asc(ryczaltEntry.lp));
      assertActive();
      return deepFreeze(rows);
    },

    async appendRyczaltEntry(input) {
      const probe = await ensureWriteOperationProbe();
      const revenueGrosze = toSafeGrosze(input.revenueGrosze, 'revenueGrosze');
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(ryczaltEntry)
          .where(
            and(
              eq(ryczaltEntry.tenantId, context.tenantId),
              eq(ryczaltEntry.legalEntityId, context.legalEntityId),
              eq(ryczaltEntry.period, input.period),
              eq(ryczaltEntry.lp, input.lp),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło wpisu ewidencji ryczałtu.');
        }
        return deepFreeze(existing);
      }

      const [created] = await tx
        .insert(ryczaltEntry)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          lp: input.lp,
          period: input.period,
          eventDate: input.eventDate,
          documentId: input.documentId ?? null,
          documentNumber: input.documentNumber,
          counterpartyName: input.counterpartyName ?? 'Kontrahent',
          counterpartyNip: input.counterpartyNip ?? null,
          ksefReference: input.ksefReference ?? null,
          rateBps: input.rateBps,
          revenueGrosze,
          isCorrection: input.isCorrection ?? false,
          correctedEntryId: input.correctedEntryId ?? null,
          legalExplanationJson: input.legalExplanationJson,
          createdBy: context.actorUserId,
          createdAt: decisionTimestamp(),
        })
        .returning();
      assertActive();
      if (!created) {
        throw new Error('Nie udało się dopisać pozycji ewidencji ryczałtu.');
      }
      return deepFreeze(created);
    },

    async listVatRegisterEntries(filter) {
      assertActive();
      const conditions = [
        eq(vatRegisterEntry.tenantId, context.tenantId),
        eq(vatRegisterEntry.legalEntityId, context.legalEntityId),
      ];
      if (filter?.period) {
        conditions.push(eq(vatRegisterEntry.period, filter.period));
      }
      if (filter?.direction) {
        conditions.push(eq(vatRegisterEntry.direction, filter.direction));
      }
      const rows = await tx
        .select()
        .from(vatRegisterEntry)
        .where(and(...conditions))
        .orderBy(asc(vatRegisterEntry.taxPointDate), asc(vatRegisterEntry.createdAt));
      assertActive();
      return deepFreeze(rows);
    },

    async appendVatRegisterEntry(input) {
      const probe = await ensureWriteOperationProbe();
      const netGrosze = toSafeGrosze(input.netGrosze, 'netGrosze');
      const vatTotalGrosze = toSafeGrosze(input.vatTotalGrosze, 'vatTotalGrosze');
      const vatDeductibleGrosze = toSafeGrosze(input.vatDeductibleGrosze, 'vatDeductibleGrosze');
      const vatNonDeductibleGrosze = toSafeGrosze(
        input.vatNonDeductibleGrosze,
        'vatNonDeductibleGrosze',
      );
      if (vatDeductibleGrosze + vatNonDeductibleGrosze !== vatTotalGrosze) {
        throw new Error(
          'Niespójność kwot rejestru VAT: vatDeductibleGrosze + vatNonDeductibleGrosze musi równać się vatTotalGrosze.',
        );
      }

      if (!probe.inserted && input.id) {
        const [existing] = await tx
          .select()
          .from(vatRegisterEntry)
          .where(
            and(
              eq(vatRegisterEntry.tenantId, context.tenantId),
              eq(vatRegisterEntry.legalEntityId, context.legalEntityId),
              eq(vatRegisterEntry.id, input.id),
            ),
          );
        assertActive();
        if (existing) {
          return deepFreeze(existing);
        }
      }
      if (!probe.inserted) {
        const [existingByDoc] = await tx
          .select()
          .from(vatRegisterEntry)
          .where(
            and(
              eq(vatRegisterEntry.tenantId, context.tenantId),
              eq(vatRegisterEntry.legalEntityId, context.legalEntityId),
              eq(vatRegisterEntry.period, input.period),
              eq(vatRegisterEntry.direction, input.direction),
              eq(vatRegisterEntry.documentNumber, input.documentNumber),
              eq(vatRegisterEntry.vatRateCode, input.vatRateCode),
            ),
          );
        assertActive();
        if (!existingByDoc) {
          throw new Error('Powtórzenie operacji nie znalazło wpisu rejestru VAT.');
        }
        return deepFreeze(existingByDoc);
      }

      const [created] = await tx
        .insert(vatRegisterEntry)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          direction: input.direction,
          period: input.period,
          taxPointDate: input.taxPointDate,
          documentId: input.documentId ?? null,
          documentNumber: input.documentNumber,
          counterpartyName: input.counterpartyName,
          counterpartyNip: input.counterpartyNip ?? null,
          vatRateCode: input.vatRateCode,
          netGrosze,
          vatTotalGrosze,
          vatDeductibleGrosze,
          vatNonDeductibleGrosze,
          gtuCodes: input.gtuCodes ? [...input.gtuCodes] : [],
          procedureMarkers: input.procedureMarkers ? [...input.procedureMarkers] : [],
          ksefMarker: input.ksefMarker ?? 'NONE',
          ksefReference: input.ksefReference ?? null,
          legalExplanationJson: input.legalExplanationJson,
          createdBy: context.actorUserId,
          createdAt: decisionTimestamp(),
        })
        .returning();
      assertActive();
      if (!created) {
        throw new Error('Nie udało się dopisać pozycji rejestru VAT.');
      }
      return deepFreeze(created);
    },

    async listLedgerAccounts() {
      assertActive();
      const rows = await tx
        .select()
        .from(ledgerAccount)
        .where(
          and(
            eq(ledgerAccount.tenantId, context.tenantId),
            eq(ledgerAccount.legalEntityId, context.legalEntityId),
          ),
        )
        .orderBy(asc(ledgerAccount.accountCode));
      assertActive();
      return deepFreeze(rows);
    },

    async upsertLedgerAccount(input) {
      const probe = await ensureWriteOperationProbe();
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(ledgerAccount)
          .where(
            and(
              eq(ledgerAccount.tenantId, context.tenantId),
              eq(ledgerAccount.legalEntityId, context.legalEntityId),
              eq(ledgerAccount.accountCode, input.accountCode),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło konta księgowego.');
        }
        return deepFreeze(existing);
      }

      const [saved] = await tx
        .insert(ledgerAccount)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          accountCode: input.accountCode,
          namePl: input.namePl,
          teamNumber: input.teamNumber,
          accountNature: input.accountNature,
          isActive: input.isActive ?? true,
          createdAt: decisionTimestamp(),
        })
        .onConflictDoUpdate({
          target: [ledgerAccount.tenantId, ledgerAccount.legalEntityId, ledgerAccount.accountCode],
          set: {
            namePl: input.namePl,
            teamNumber: input.teamNumber,
            accountNature: input.accountNature,
            isActive: input.isActive ?? true,
          },
        })
        .returning();
      assertActive();
      if (!saved) {
        throw new Error('Nie udało się zapisać konta księgowego planu kont.');
      }
      return deepFreeze(saved);
    },

    async listJournalEntries(filter) {
      assertActive();
      const conditions = [
        eq(journalEntry.tenantId, context.tenantId),
        eq(journalEntry.legalEntityId, context.legalEntityId),
      ];
      if (filter?.period) {
        conditions.push(eq(journalEntry.period, filter.period));
      }
      const entries = await tx
        .select()
        .from(journalEntry)
        .where(and(...conditions))
        .orderBy(asc(journalEntry.bookingDate), asc(journalEntry.entryNumber));
      assertActive();
      if (entries.length === 0) {
        return deepFreeze([]);
      }
      const entryIds = entries.map((entry) => entry.id);
      const lines = await tx
        .select()
        .from(journalLine)
        .where(
          and(
            eq(journalLine.tenantId, context.tenantId),
            eq(journalLine.legalEntityId, context.legalEntityId),
            inArray(journalLine.journalEntryId, entryIds),
          ),
        )
        .orderBy(asc(journalLine.lineNo));
      assertActive();
      const linesByEntryId = new Map<string, JournalLineRecord[]>();
      for (const line of lines) {
        const bucket = linesByEntryId.get(line.journalEntryId) ?? [];
        bucket.push(line);
        linesByEntryId.set(line.journalEntryId, bucket);
      }
      return deepFreeze(
        entries.map((entry) => ({
          entry,
          lines: linesByEntryId.get(entry.id) ?? [],
        })),
      );
    },

    async postJournalEntry(input) {
      const probe = await ensureWriteOperationProbe();
      if (input.lines.length < 2) {
        throw new Error('Dekret dziennika księgowego wymaga co najmniej dwóch linii (Wn i Ma).');
      }

      let totalDebit = 0;
      let totalCredit = 0;
      const normalizedLines = input.lines.map((line, index) => {
        if (line.side !== 'Wn' && line.side !== 'Ma') {
          throw new Error(
            `Nieprawidłowa strona dekretu w linii ${index + 1}: oczekiwano 'Wn' lub 'Ma'.`,
          );
        }
        const amount = toSafeGrosze(line.amountGrosze, `lines[${index}].amountGrosze`);
        if (amount <= 0) {
          throw new Error('Kwota pojedynczej linii dekretu musi być dodatnia (w groszach).');
        }
        if (line.side === 'Wn') {
          totalDebit = toSafeGrosze(totalDebit + amount, 'totalDebitGrosze');
          return {
            id: line.id ?? randomUUID(),
            lineNo: index + 1,
            ledgerAccountId: line.ledgerAccountId,
            accountCode: line.accountCode,
            side: 'Wn' as const,
            debitGrosze: amount,
            creditGrosze: 0,
            description: line.description,
          };
        }
        totalCredit = toSafeGrosze(totalCredit + amount, 'totalCreditGrosze');
        return {
          id: line.id ?? randomUUID(),
          lineNo: index + 1,
          ledgerAccountId: line.ledgerAccountId,
          accountCode: line.accountCode,
          side: 'Ma' as const,
          debitGrosze: 0,
          creditGrosze: amount,
          description: line.description,
        };
      });

      if (totalDebit <= 0 || totalDebit !== totalCredit) {
        throw new Error(
          'Niezbilansowany dekret księgowy: suma strony Wn musi być dodatnia i równa sumie strony Ma.',
        );
      }

      if (!probe.inserted) {
        const [existingEntry] = await tx
          .select()
          .from(journalEntry)
          .where(
            and(
              eq(journalEntry.tenantId, context.tenantId),
              eq(journalEntry.legalEntityId, context.legalEntityId),
              eq(journalEntry.period, input.period),
              eq(journalEntry.entryNumber, input.entryNumber),
            ),
          );
        assertActive();
        if (!existingEntry) {
          throw new Error('Powtórzenie operacji nie znalazło dekretu dziennika.');
        }
        const existingLines = await tx
          .select()
          .from(journalLine)
          .where(
            and(
              eq(journalLine.tenantId, context.tenantId),
              eq(journalLine.legalEntityId, context.legalEntityId),
              eq(journalLine.journalEntryId, existingEntry.id),
            ),
          )
          .orderBy(asc(journalLine.lineNo));
        assertActive();
        return deepFreeze({ entry: existingEntry, lines: existingLines });
      }

      const now = decisionTimestamp();
      const entryId = input.id ?? randomUUID();
      const [createdEntry] = await tx
        .insert(journalEntry)
        .values({
          id: entryId,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          entryNumber: input.entryNumber,
          period: input.period,
          bookingDate: input.bookingDate,
          documentDate: input.documentDate,
          documentId: input.documentId ?? null,
          documentNumber: input.documentNumber,
          description: input.description,
          totalDebitGrosze: totalDebit,
          totalCreditGrosze: totalCredit,
          isStorno: input.isStorno ?? false,
          stornoOfEntryId: input.stornoOfEntryId ?? null,
          legalExplanationJson: input.legalExplanationJson ?? null,
          createdBy: context.actorUserId,
          createdAt: now,
        })
        .returning();
      assertActive();
      if (!createdEntry) {
        throw new Error('Nie udało się zapisać nagłówka dekretu księgowego.');
      }

      const createdLines = await tx
        .insert(journalLine)
        .values(
          normalizedLines.map((line) => ({
            ...line,
            tenantId: context.tenantId,
            legalEntityId: context.legalEntityId,
            journalEntryId: createdEntry.id,
            createdAt: now,
          })),
        )
        .returning();
      assertActive();
      return deepFreeze({ entry: createdEntry, lines: createdLines });
    },

    async listSettlementItems(filter) {
      assertActive();
      const conditions = [
        eq(settlementItem.tenantId, context.tenantId),
        eq(settlementItem.legalEntityId, context.legalEntityId),
      ];
      if (filter?.status) {
        conditions.push(eq(settlementItem.status, filter.status));
      }
      if (filter?.direction) {
        conditions.push(eq(settlementItem.direction, filter.direction));
      }
      const rows = await tx
        .select()
        .from(settlementItem)
        .where(and(...conditions))
        .orderBy(asc(settlementItem.dueDate), asc(settlementItem.createdAt));
      assertActive();
      return deepFreeze(rows);
    },

    async createSettlementItem(input) {
      const probe = await ensureWriteOperationProbe();
      const originalGrossGrosze = toSafeGrosze(input.originalGrossGrosze, 'originalGrossGrosze');
      if (originalGrossGrosze <= 0) {
        throw new Error('Kwota rozrachunku musi być dodatnia (w groszach).');
      }

      if (!probe.inserted && input.id) {
        const [existing] = await tx
          .select()
          .from(settlementItem)
          .where(
            and(
              eq(settlementItem.tenantId, context.tenantId),
              eq(settlementItem.legalEntityId, context.legalEntityId),
              eq(settlementItem.id, input.id),
            ),
          );
        assertActive();
        if (existing) {
          return deepFreeze(existing);
        }
      }
      if (!probe.inserted) {
        const [existingByDoc] = await tx
          .select()
          .from(settlementItem)
          .where(
            and(
              eq(settlementItem.tenantId, context.tenantId),
              eq(settlementItem.legalEntityId, context.legalEntityId),
              eq(settlementItem.documentNumber, input.documentNumber),
              eq(settlementItem.direction, input.direction),
            ),
          );
        assertActive();
        if (!existingByDoc) {
          throw new Error('Powtórzenie operacji nie znalazło pozycji rozrachunkowej.');
        }
        return deepFreeze(existingByDoc);
      }

      const now = decisionTimestamp();
      const [created] = await tx
        .insert(settlementItem)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          documentId: input.documentId ?? null,
          direction: input.direction,
          counterpartyName: input.counterpartyName,
          counterpartyNip: input.counterpartyNip ?? null,
          counterpartyIban: input.counterpartyIban ?? null,
          documentNumber: input.documentNumber,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          currency: 'PLN',
          originalGrossGrosze,
          remainingGrossGrosze: originalGrossGrosze,
          status: 'open',
          settledAt: null,
          updatedAt: now,
          createdAt: now,
        })
        .returning();
      assertActive();
      if (!created) {
        throw new Error('Nie udało się utworzyć pozycji rozrachunkowej.');
      }
      return deepFreeze(created);
    },

    async applySettlementPayment(input) {
      const probe = await ensureWriteOperationProbe();
      const paidAmountGrosze = toSafeGrosze(input.paidAmountGrosze, 'paidAmountGrosze');
      if (paidAmountGrosze <= 0) {
        throw new Error('Kwota rozliczenia płatności musi być dodatnia (w groszach).');
      }

      const [current] = await tx
        .select()
        .from(settlementItem)
        .where(
          and(
            eq(settlementItem.tenantId, context.tenantId),
            eq(settlementItem.legalEntityId, context.legalEntityId),
            eq(settlementItem.id, input.settlementId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono pozycji rozrachunkowej.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'settled' || current.remainingGrossGrosze <= 0) {
        throw new Error('Rozrachunek jest już w pełni rozliczony.');
      }
      if (paidAmountGrosze > current.remainingGrossGrosze) {
        throw new Error('Kwota rozliczenia przekracza pozostałe saldo rozrachunku.');
      }

      const nextRemaining = current.remainingGrossGrosze - paidAmountGrosze;
      const nextStatus: SettlementItemRecord['status'] =
        nextRemaining === 0 ? 'settled' : 'partial';
      const now = input.settledAt ?? decisionTimestamp();
      const [updated] = await tx
        .update(settlementItem)
        .set({
          remainingGrossGrosze: nextRemaining,
          status: nextStatus,
          settledAt: nextStatus === 'settled' ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(settlementItem.tenantId, context.tenantId),
            eq(settlementItem.legalEntityId, context.legalEntityId),
            eq(settlementItem.id, input.settlementId),
            inArray(settlementItem.status, ['open', 'partial']),
            eq(settlementItem.remainingGrossGrosze, current.remainingGrossGrosze),
            gte(settlementItem.remainingGrossGrosze, paidAmountGrosze),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error(
          'Nie udało się zaktualizować salda rozrachunku — wykryto równoległą zmianę.',
        );
      }
      return deepFreeze(updated);
    },

    async importBankStatement(input) {
      const probe = await ensureWriteOperationProbe();
      const openingBalanceGrosze =
        input.openingBalanceGrosze == null
          ? null
          : toSafeGrosze(input.openingBalanceGrosze, 'openingBalanceGrosze');
      const closingBalanceGrosze =
        input.closingBalanceGrosze == null
          ? null
          : toSafeGrosze(input.closingBalanceGrosze, 'closingBalanceGrosze');

      const loadExistingImport = async () => {
        const [existingStmt] = await tx
          .select()
          .from(bankStatementImport)
          .where(
            and(
              eq(bankStatementImport.tenantId, context.tenantId),
              eq(bankStatementImport.legalEntityId, context.legalEntityId),
              eq(bankStatementImport.sha256Hash, input.sha256Hash),
            ),
          );
        assertActive();
        if (!existingStmt) {
          throw new Error('Nie znaleziono zaimportowanego wyciągu bankowego.');
        }
        const existingTxs = await tx
          .select()
          .from(bankTransaction)
          .where(
            and(
              eq(bankTransaction.tenantId, context.tenantId),
              eq(bankTransaction.legalEntityId, context.legalEntityId),
              eq(bankTransaction.statementImportId, existingStmt.id),
            ),
          )
          .orderBy(asc(bankTransaction.bookingDate), asc(bankTransaction.createdAt));
        assertActive();
        return deepFreeze({
          statement: existingStmt,
          transactions: existingTxs,
          deduplicated: true,
        });
      };

      if (!probe.inserted) {
        return loadExistingImport();
      }

      const now = decisionTimestamp();
      const insertedStmts = await tx
        .insert(bankStatementImport)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          sourceFormat: input.sourceFormat,
          fileName: input.fileName,
          sha256Hash: input.sha256Hash,
          iban: input.iban ?? null,
          statementReference: input.statementReference ?? null,
          periodFrom: input.periodFrom ?? null,
          periodTo: input.periodTo ?? null,
          openingBalanceGrosze,
          closingBalanceGrosze,
          transactionsCount: input.transactions.length,
          importedBy: context.actorUserId,
          importedAt: now,
        })
        .onConflictDoNothing({
          target: [
            bankStatementImport.tenantId,
            bankStatementImport.legalEntityId,
            bankStatementImport.sha256Hash,
          ],
        })
        .returning();
      assertActive();

      const createdStmt = insertedStmts[0];
      if (!createdStmt) {
        return loadExistingImport();
      }

      const createdTxs =
        input.transactions.length === 0
          ? []
          : await tx
              .insert(bankTransaction)
              .values(
                input.transactions.map((item, idx) => ({
                  id: item.id ?? randomUUID(),
                  tenantId: context.tenantId,
                  legalEntityId: context.legalEntityId,
                  statementImportId: createdStmt.id,
                  externalRef: item.externalRef ?? null,
                  bookingDate: item.bookingDate,
                  valueDate: item.valueDate ?? null,
                  direction: item.direction,
                  amountGrosze: toSafeGrosze(
                    item.amountGrosze,
                    `transactions[${idx}].amountGrosze`,
                  ),
                  currency: 'PLN' as const,
                  counterpartyName: item.counterpartyName,
                  counterpartyIban: item.counterpartyIban ?? null,
                  counterpartyNip: item.counterpartyNip ?? null,
                  title: item.title,
                  matchStatus: 'unmatched' as const,
                  matchedSettlementId: null,
                  matchedDocumentId: null,
                  settledAmountGrosze: 0,
                  matchNotes: null,
                  updatedAt: now,
                  createdAt: now,
                })),
              )
              .returning();
      assertActive();
      return deepFreeze({
        statement: createdStmt,
        transactions: createdTxs,
        deduplicated: false,
      });
    },

    async listBankTransactions(filter) {
      assertActive();
      const conditions = [
        eq(bankTransaction.tenantId, context.tenantId),
        eq(bankTransaction.legalEntityId, context.legalEntityId),
      ];
      if (filter?.matchStatus) {
        conditions.push(eq(bankTransaction.matchStatus, filter.matchStatus));
      }
      const rows = await tx
        .select()
        .from(bankTransaction)
        .where(and(...conditions))
        .orderBy(desc(bankTransaction.bookingDate), desc(bankTransaction.createdAt));
      assertActive();
      return deepFreeze(rows);
    },

    async recordBankTransactionMatch(input) {
      const probe = await ensureWriteOperationProbe();
      const settledAmountGrosze = toSafeGrosze(input.settledAmountGrosze, 'settledAmountGrosze');
      if (settledAmountGrosze < 0) {
        throw new Error('Kwota rozliczenia transakcji bankowej nie może być ujemna.');
      }
      const [current] = await tx
        .select()
        .from(bankTransaction)
        .where(
          and(
            eq(bankTransaction.tenantId, context.tenantId),
            eq(bankTransaction.legalEntityId, context.legalEntityId),
            eq(bankTransaction.id, input.transactionId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono transakcji bankowej.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (settledAmountGrosze > current.amountGrosze) {
        throw new Error('Kwota rozliczenia przekracza kwotę transakcji bankowej.');
      }

      const [updated] = await tx
        .update(bankTransaction)
        .set({
          matchStatus: input.matchStatus,
          matchedSettlementId: input.matchedSettlementId ?? null,
          matchedDocumentId: input.matchedDocumentId ?? null,
          settledAmountGrosze,
          matchNotes: input.matchNotes ?? null,
          updatedAt: input.updatedAt ?? decisionTimestamp(),
        })
        .where(
          and(
            eq(bankTransaction.tenantId, context.tenantId),
            eq(bankTransaction.legalEntityId, context.legalEntityId),
            eq(bankTransaction.id, input.transactionId),
            eq(bankTransaction.matchStatus, current.matchStatus),
            eq(bankTransaction.settledAmountGrosze, current.settledAmountGrosze),
            gte(bankTransaction.amountGrosze, settledAmountGrosze),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error(
          'Nie udało się zapisać dopasowania transakcji bankowej — wykryto równoległą zmianę.',
        );
      }
      return deepFreeze(updated);
    },

    async listTaxObligations(filter) {
      assertActive();
      const conditions = [
        eq(taxObligationItem.tenantId, context.tenantId),
        eq(taxObligationItem.legalEntityId, context.legalEntityId),
      ];
      if (filter?.period) {
        conditions.push(eq(taxObligationItem.period, filter.period));
      }
      if (filter?.status) {
        conditions.push(eq(taxObligationItem.status, filter.status));
      }
      const rows = await tx
        .select()
        .from(taxObligationItem)
        .where(and(...conditions))
        .orderBy(asc(taxObligationItem.adjustedDueDate), asc(taxObligationItem.obligationCode));
      assertActive();
      return deepFreeze(rows);
    },

    async upsertTaxObligation(input) {
      const probe = await ensureWriteOperationProbe();
      const estimatedAmountGrosze =
        input.estimatedAmountGrosze == null
          ? null
          : toSafeGrosze(input.estimatedAmountGrosze, 'estimatedAmountGrosze');

      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(taxObligationItem)
          .where(
            and(
              eq(taxObligationItem.tenantId, context.tenantId),
              eq(taxObligationItem.legalEntityId, context.legalEntityId),
              eq(taxObligationItem.period, input.period),
              eq(taxObligationItem.obligationCode, input.obligationCode),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło pozycji obowiązku podatkowego.');
        }
        return deepFreeze(existing);
      }

      const now = decisionTimestamp();
      const status = input.status ?? 'upcoming';
      const [saved] = await tx
        .insert(taxObligationItem)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          period: input.period,
          obligationCode: input.obligationCode,
          category: input.category,
          titlePl: input.titlePl,
          statutoryDueDate: input.statutoryDueDate,
          adjustedDueDate: input.adjustedDueDate,
          shiftReason: input.shiftReason ?? null,
          estimatedAmountGrosze,
          status,
          legalBasisJson: input.legalBasisJson,
          paidAt: status === 'paid' ? (input.paidAt ?? now) : null,
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [
            taxObligationItem.tenantId,
            taxObligationItem.legalEntityId,
            taxObligationItem.period,
            taxObligationItem.obligationCode,
          ],
          set: {
            category: input.category,
            titlePl: input.titlePl,
            statutoryDueDate: input.statutoryDueDate,
            adjustedDueDate: input.adjustedDueDate,
            shiftReason: input.shiftReason ?? null,
            estimatedAmountGrosze,
            status,
            legalBasisJson: input.legalBasisJson,
            paidAt: status === 'paid' ? (input.paidAt ?? now) : null,
            updatedAt: now,
          },
        })
        .returning();
      assertActive();
      if (!saved) {
        throw new Error('Nie udało się zapisać pozycji obowiązku podatkowego.');
      }
      return deepFreeze(saved);
    },

    async updateTaxObligationStatus(input) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(taxObligationItem)
        .where(
          and(
            eq(taxObligationItem.tenantId, context.tenantId),
            eq(taxObligationItem.legalEntityId, context.legalEntityId),
            eq(taxObligationItem.id, input.obligationId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono pozycji obowiązku podatkowego.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }

      const now = decisionTimestamp();
      const [updated] = await tx
        .update(taxObligationItem)
        .set({
          status: input.status,
          paidAt: input.status === 'paid' ? (input.paidAt ?? now) : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(taxObligationItem.tenantId, context.tenantId),
            eq(taxObligationItem.legalEntityId, context.legalEntityId),
            eq(taxObligationItem.id, input.obligationId),
            eq(taxObligationItem.status, current.status),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error(
          'Nie udało się zmienić statusu obowiązku podatkowego — wykryto równoległą zmianę.',
        );
      }
      return deepFreeze(updated);
    },

    async getMcpPreparedProposal(proposalId) {
      assertActive();
      const [row] = await tx
        .select()
        .from(mcpPreparedProposal)
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, proposalId),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async saveMcpPreparedProposal(input) {
      const probe = await ensureWriteOperationProbe();
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(mcpPreparedProposal)
          .where(
            and(
              eq(mcpPreparedProposal.tenantId, context.tenantId),
              eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
              eq(mcpPreparedProposal.idempotencyKey, input.idempotencyKey),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło propozycji MCP.');
        }
        if (existing.payloadHash !== input.payloadHash) {
          throw new Error('Konflikt klucza idempotencji MCP dla innego ładunku propozycji.');
        }
        return deepFreeze({ proposal: existing, deduplicated: true });
      }

      const id = input.proposalId ?? randomUUID();
      const inserted = await tx
        .insert(mcpPreparedProposal)
        .values({
          id,
          proposalId: id,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          idempotencyKey: input.idempotencyKey,
          payloadHash: input.payloadHash,
          status: 'pending_human_approval',
          invoiceJson: input.invoiceJson,
          proposedPostingJson: input.proposedPostingJson,
          confirmationChallengeHash: input.confirmationChallengeHash,
          preparedBy: context.actorUserId,
          expiresAt: input.expiresAt,
          confirmedBy: null,
          confirmedAt: null,
          ledgerEntryId: null,
          createdAt: decisionTimestamp(),
        })
        .onConflictDoNothing({
          target: [
            mcpPreparedProposal.tenantId,
            mcpPreparedProposal.legalEntityId,
            mcpPreparedProposal.idempotencyKey,
          ],
        })
        .returning();
      assertActive();

      if (inserted[0]) {
        return deepFreeze({ proposal: inserted[0], deduplicated: false });
      }

      const [existing] = await tx
        .select()
        .from(mcpPreparedProposal)
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.idempotencyKey, input.idempotencyKey),
          ),
        );
      assertActive();
      if (!existing) {
        throw new Error('Nie udało się pobrać zdeduplikowanej propozycji MCP.');
      }
      if (existing.payloadHash !== input.payloadHash) {
        throw new Error('Konflikt klucza idempotencji MCP dla innego ładunku propozycji.');
      }
      return deepFreeze({ proposal: existing, deduplicated: true });
    },

    async confirmMcpPreparedProposal(input) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(mcpPreparedProposal)
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, input.proposalId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono propozycji MCP do zatwierdzenia.');
      }
      if (current.confirmationChallengeHash !== input.confirmationChallengeHash) {
        throw new Error('Niezgodny skrót wyzwania zatwierdzającego propozycję MCP.');
      }
      if (!probe.inserted) {
        if (current.status !== 'confirmed') {
          throw new Error('Powtórzenie operacji nie znalazło zatwierdzonej propozycji MCP.');
        }
        return deepFreeze(current);
      }
      if (current.status === 'confirmed') {
        throw new Error('Propozycja MCP została już wcześniej zatwierdzona.');
      }
      if (current.status === 'rejected') {
        throw new Error('Odrzucona propozycja MCP nie może zostać zatwierdzona.');
      }
      if (current.status === 'expired') {
        throw new Error('Propozycja MCP wygasła i nie może zostać zatwierdzona.');
      }
      if (current.status !== 'pending_human_approval') {
        throw new Error('Propozycja MCP nie oczekuje na zatwierdzenie człowieka.');
      }

      const confirmedAt = input.confirmedAt ?? decisionTimestamp();
      if (confirmedAt >= current.expiresAt) {
        throw new Error('Propozycja MCP przekroczyła czas ważności zatwierdzenia.');
      }

      const [updated] = await tx
        .update(mcpPreparedProposal)
        .set({
          status: 'confirmed',
          confirmedBy: context.actorUserId,
          confirmedAt,
          ledgerEntryId: input.ledgerEntryId,
        })
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, input.proposalId),
            eq(mcpPreparedProposal.status, 'pending_human_approval'),
            eq(mcpPreparedProposal.confirmationChallengeHash, input.confirmationChallengeHash),
            gt(mcpPreparedProposal.expiresAt, confirmedAt),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error('Nie udało się zatwierdzić propozycji MCP — nieprawidłowy stan.');
      }
      return deepFreeze(updated);
    },

    async rejectMcpPreparedProposal(proposalId) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(mcpPreparedProposal)
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, proposalId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono propozycji MCP do odrzucenia.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'confirmed') {
        throw new Error('Zatwierdzona propozycja MCP nie może zostać odrzucona.');
      }
      if (current.status !== 'pending_human_approval') {
        throw new Error('Propozycja MCP znajduje się już w stanie terminalnym.');
      }

      const [updated] = await tx
        .update(mcpPreparedProposal)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, proposalId),
            eq(mcpPreparedProposal.status, 'pending_human_approval'),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error('Nie udało się odrzucić propozycji MCP — nieprawidłowy stan.');
      }
      return deepFreeze(updated);
    },

    async expireMcpPreparedProposal(proposalId) {
      const probe = await ensureWriteOperationProbe();
      const [current] = await tx
        .select()
        .from(mcpPreparedProposal)
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, proposalId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono propozycji MCP.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'confirmed') {
        throw new Error('Zatwierdzona propozycja MCP nie może zostać oznaczona jako wygasła.');
      }
      if (current.status !== 'pending_human_approval') {
        throw new Error('Propozycja MCP znajduje się już w stanie terminalnym.');
      }

      const [updated] = await tx
        .update(mcpPreparedProposal)
        .set({ status: 'expired' })
        .where(
          and(
            eq(mcpPreparedProposal.tenantId, context.tenantId),
            eq(mcpPreparedProposal.legalEntityId, context.legalEntityId),
            eq(mcpPreparedProposal.proposalId, proposalId),
            eq(mcpPreparedProposal.status, 'pending_human_approval'),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error('Nie udało się wygasić propozycji MCP — nieprawidłowy stan.');
      }
      return deepFreeze(updated);
    },

    async getNotificationPreference(targetUserId) {
      assertActive();
      const userIdToRead = targetUserId ?? context.actorUserId;
      const [row] = await tx
        .select()
        .from(notificationPreference)
        .where(
          and(
            eq(notificationPreference.tenantId, context.tenantId),
            eq(notificationPreference.legalEntityId, context.legalEntityId),
            eq(notificationPreference.userId, userIdToRead),
          ),
        );
      assertActive();
      return deepFreeze(row ?? null);
    },

    async upsertNotificationPreference(input) {
      const probe = await ensureWriteOperationProbe();
      const targetUserId = input.userId ?? context.actorUserId;
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(notificationPreference)
          .where(
            and(
              eq(notificationPreference.tenantId, context.tenantId),
              eq(notificationPreference.legalEntityId, context.legalEntityId),
              eq(notificationPreference.userId, targetUserId),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło preferencji powiadomień.');
        }
        return deepFreeze(existing);
      }

      const now = input.updatedAt ?? decisionTimestamp();
      const advanceDays = input.advanceDays ? [...input.advanceDays] : [7, 2, -1];
      const disabledStages = input.disabledStages ? [...input.disabledStages] : [];
      const [saved] = await tx
        .insert(notificationPreference)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          userId: targetUserId,
          recipientEmail: input.recipientEmail,
          channel: 'email',
          frequency: input.frequency ?? 'standard',
          optOut: input.optOut ?? false,
          advanceDays,
          disabledStages,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            notificationPreference.tenantId,
            notificationPreference.legalEntityId,
            notificationPreference.userId,
          ],
          set: {
            recipientEmail: input.recipientEmail,
            frequency: input.frequency ?? 'standard',
            optOut: input.optOut ?? false,
            advanceDays,
            disabledStages,
            updatedAt: now,
          },
        })
        .returning();
      assertActive();
      if (!saved) {
        throw new Error('Nie udało się zapisać preferencji powiadomień.');
      }
      return deepFreeze(saved);
    },

    async listNotificationOutbox(filter) {
      assertActive();
      const conditions = [
        eq(notificationOutbox.tenantId, context.tenantId),
        eq(notificationOutbox.legalEntityId, context.legalEntityId),
      ];
      if (filter?.status) {
        conditions.push(eq(notificationOutbox.status, filter.status));
      }
      const rows = await tx
        .select()
        .from(notificationOutbox)
        .where(and(...conditions))
        .orderBy(asc(notificationOutbox.createdAt));
      assertActive();
      return deepFreeze(rows);
    },

    async enqueueNotificationOutbox(input) {
      const probe = await ensureWriteOperationProbe();
      if (!probe.inserted) {
        const [existing] = await tx
          .select()
          .from(notificationOutbox)
          .where(
            and(
              eq(notificationOutbox.tenantId, context.tenantId),
              eq(notificationOutbox.legalEntityId, context.legalEntityId),
              eq(notificationOutbox.dedupKey, input.dedupKey),
            ),
          );
        assertActive();
        if (!existing) {
          throw new Error('Powtórzenie operacji nie znalazło pozycji kolejki powiadomień.');
        }
        return deepFreeze({ item: existing, deduplicated: true });
      }

      const now = decisionTimestamp();
      const inserted = await tx
        .insert(notificationOutbox)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          userId: input.userId ?? context.actorUserId,
          obligationId: input.obligationId ?? null,
          obligationCode: input.obligationCode,
          stage: input.stage,
          dedupKey: input.dedupKey,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          payloadJson: input.payloadJson,
          status: input.status ?? 'pending',
          attemptCount: 0,
          maxAttempts: input.maxAttempts ?? 3,
          nextAttemptAt: input.nextAttemptAt ?? now,
          lastErrorRedacted: null,
          updatedAt: now,
          createdAt: now,
        })
        .onConflictDoNothing({
          target: [
            notificationOutbox.tenantId,
            notificationOutbox.legalEntityId,
            notificationOutbox.dedupKey,
          ],
        })
        .returning();
      assertActive();

      if (inserted[0]) {
        return deepFreeze({ item: inserted[0], deduplicated: false });
      }

      const [existing] = await tx
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.tenantId, context.tenantId),
            eq(notificationOutbox.legalEntityId, context.legalEntityId),
            eq(notificationOutbox.dedupKey, input.dedupKey),
          ),
        );
      assertActive();
      if (!existing) {
        throw new Error('Nie udało się odczytać zdeduplikowanej pozycji kolejki Outbox.');
      }
      return deepFreeze({ item: existing, deduplicated: true });
    },

    async updateNotificationOutboxStatus(input) {
      const probe = await ensureWriteOperationProbe();
      if (!Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
        throw new Error('Licznik prób wysyłki Outbox musi być nieujemną liczbą całkowitą.');
      }
      const [current] = await tx
        .select()
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.tenantId, context.tenantId),
            eq(notificationOutbox.legalEntityId, context.legalEntityId),
            eq(notificationOutbox.id, input.outboxId),
          ),
        )
        .for('update');
      assertActive();
      if (!current) {
        throw new Error('Nie znaleziono pozycji kolejki Outbox.');
      }
      if (!probe.inserted) {
        return deepFreeze(current);
      }
      if (current.status === 'sent') {
        throw new Error('Wysłana pozycja kolejki Outbox nie może zmienić statusu.');
      }
      if (input.attemptCount < current.attemptCount) {
        throw new Error('Licznik prób wysyłki Outbox nie może maleć.');
      }

      const [updated] = await tx
        .update(notificationOutbox)
        .set({
          status: input.status,
          attemptCount: input.attemptCount,
          nextAttemptAt: input.nextAttemptAt ?? null,
          lastErrorRedacted: input.lastErrorRedacted ?? null,
          updatedAt: input.updatedAt ?? decisionTimestamp(),
        })
        .where(
          and(
            eq(notificationOutbox.tenantId, context.tenantId),
            eq(notificationOutbox.legalEntityId, context.legalEntityId),
            eq(notificationOutbox.id, input.outboxId),
            eq(notificationOutbox.status, current.status),
            eq(notificationOutbox.attemptCount, current.attemptCount),
          ),
        )
        .returning();
      assertActive();
      if (!updated) {
        throw new Error(
          'Nie udało się zaktualizować statusu kolejki Outbox — wykryto równoległą zmianę.',
        );
      }
      return deepFreeze(updated);
    },

    async appendSandboxMailboxMessage(input) {
      const probe = await ensureWriteOperationProbe();
      if (!probe.inserted && input.outboxId) {
        const [existing] = await tx
          .select()
          .from(sandboxMailboxMessage)
          .where(
            and(
              eq(sandboxMailboxMessage.tenantId, context.tenantId),
              eq(sandboxMailboxMessage.legalEntityId, context.legalEntityId),
              eq(sandboxMailboxMessage.outboxId, input.outboxId),
            ),
          );
        assertActive();
        if (existing) {
          return deepFreeze(existing);
        }
      }
      if (!probe.inserted && input.id) {
        const [existingById] = await tx
          .select()
          .from(sandboxMailboxMessage)
          .where(
            and(
              eq(sandboxMailboxMessage.tenantId, context.tenantId),
              eq(sandboxMailboxMessage.legalEntityId, context.legalEntityId),
              eq(sandboxMailboxMessage.id, input.id),
            ),
          );
        assertActive();
        if (existingById) {
          return deepFreeze(existingById);
        }
      }
      if (!probe.inserted) {
        throw new Error('Powtórzenie operacji nie znalazło wiadomości w skrzynce testowej.');
      }

      const [created] = await tx
        .insert(sandboxMailboxMessage)
        .values({
          id: input.id ?? randomUUID(),
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          outboxId: input.outboxId ?? null,
          recipientEmail: input.recipientEmail,
          subject: input.subject,
          rawRfc5322Mime: input.rawRfc5322Mime,
          obligationCode: input.obligationCode,
          createdAt: decisionTimestamp(),
        })
        .returning();
      assertActive();
      if (!created) {
        throw new Error('Nie udało się zapisać wiadomości RFC 5322 w skrzynce testowej.');
      }
      return deepFreeze(created);
    },

    async listSandboxMailboxMessages() {
      assertActive();
      const rows = await tx
        .select()
        .from(sandboxMailboxMessage)
        .where(
          and(
            eq(sandboxMailboxMessage.tenantId, context.tenantId),
            eq(sandboxMailboxMessage.legalEntityId, context.legalEntityId),
          ),
        )
        .orderBy(desc(sandboxMailboxMessage.createdAt));
      assertActive();
      return deepFreeze(rows);
    },
  });
}
