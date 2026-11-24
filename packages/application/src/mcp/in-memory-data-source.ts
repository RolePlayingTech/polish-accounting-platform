import { randomUUID } from 'node:crypto';
import type { MonthlyTaxObligation } from '@pap/contracts/mcp-tools';
import type { LegalEntityId, TenantId, UserId } from '@pap/domain';
import { formatGroszeToPln, parsePlnToGrosze } from './security-and-redaction.js';
import type {
  AccountingItemExplanationRecord,
  CompanyDirectoryRecord,
  CompanyTaxProfile,
  ExternalCompanyAuditRecord,
  LegalBasisCatalogEntry,
  McpJpkPeriodSourceData,
  McpTaxCalculationSourceData,
  MonthCloseRawData,
  PapMcpDataSource,
  UnpaidInvoiceRecord,
  UnreconciledBankTransactionRecord,
  VatPeriodPreviewSnapshot,
} from './types.js';
import { VERIFIED_POLISH_LEGAL_BASIS_CATALOG } from './vat-classification.js';

export class InMemoryPapMcpDataSource implements PapMcpDataSource {
  private readonly companiesByUser = new Map<UserId, CompanyDirectoryRecord[]>();
  private readonly companyProfiles = new Map<string, CompanyTaxProfile>();
  private readonly unpaidInvoices: UnpaidInvoiceRecord[] = [];
  private readonly obligationsByEntityPeriod = new Map<string, MonthlyTaxObligation[]>();
  private readonly explanations = new Map<string, AccountingItemExplanationRecord>();
  private readonly monthCloseData = new Map<string, MonthCloseRawData>();
  private readonly bankTransactions: UnreconciledBankTransactionRecord[] = [];
  private readonly vatSnapshots = new Map<string, VatPeriodPreviewSnapshot>();
  private readonly jpkSources = new Map<string, McpJpkPeriodSourceData>();
  private readonly taxCalcSources = new Map<string, McpTaxCalculationSourceData>();
  private readonly externalAuditByEntity = new Map<string, ExternalCompanyAuditRecord[]>();
  private readonly closedPeriods = new Set<string>();

  seedCompanyForUser(userIdVal: UserId, record: CompanyDirectoryRecord): void {
    const list = this.companiesByUser.get(userIdVal) ?? [];
    list.push(record);
    this.companiesByUser.set(userIdVal, list);
    this.companyProfiles.set(`${record.tenantId}:${record.legalEntityId}`, {
      legalForm: record.legalForm,
      taxRegime: record.taxRegime,
      vatStatus: record.vatStatus,
    });
  }

  seedCompanyTaxProfile(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    profile: CompanyTaxProfile,
  ): void {
    this.companyProfiles.set(`${tenantIdVal}:${legalEntityIdVal}`, profile);
  }

  seedUnpaidInvoice(record: UnpaidInvoiceRecord): void {
    this.unpaidInvoices.push(record);
  }

  seedMonthlyTaxObligations(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
    obligations: readonly MonthlyTaxObligation[],
  ): void {
    this.obligationsByEntityPeriod.set(`${tenantIdVal}:${legalEntityIdVal}:${period}`, [
      ...obligations,
    ]);
  }

  seedAccountingItemExplanation(record: AccountingItemExplanationRecord): void {
    this.explanations.set(
      `${record.tenantId}:${record.legalEntityId}:${record.accountingItemId.toLowerCase()}`,
      record,
    );
  }

  seedMonthCloseRawData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
    data: MonthCloseRawData,
  ): void {
    this.monthCloseData.set(`${tenantIdVal}:${legalEntityIdVal}:${period}`, data);
  }

  seedUnreconciledBankTransaction(record: UnreconciledBankTransactionRecord): void {
    this.bankTransactions.push(record);
  }

  seedVatPeriodPreviewSnapshot(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
    snapshot: VatPeriodPreviewSnapshot,
  ): void {
    this.vatSnapshots.set(`${tenantIdVal}:${legalEntityIdVal}:${period}`, snapshot);
  }

  seedJpkPeriodSourceData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
    source: McpJpkPeriodSourceData,
  ): void {
    this.jpkSources.set(`${tenantIdVal}:${legalEntityIdVal}:${period}`, source);
  }

  seedTaxCalculationSourceData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
    source: McpTaxCalculationSourceData,
  ): void {
    this.taxCalcSources.set(`${tenantIdVal}:${legalEntityIdVal}:${period}`, source);
  }

  seedExternalAuditEvents(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    events: readonly ExternalCompanyAuditRecord[],
  ): void {
    this.externalAuditByEntity.set(`${tenantIdVal}:${legalEntityIdVal}`, [...events]);
  }

  seedClosedPeriod(tenantIdVal: TenantId, legalEntityIdVal: LegalEntityId, period: string): void {
    this.closedPeriods.add(`${tenantIdVal}:${legalEntityIdVal}:${period}`);
  }

  async listCandidateCompaniesForUser(
    userIdVal: UserId,
  ): Promise<readonly CompanyDirectoryRecord[]> {
    return [...(this.companiesByUser.get(userIdVal) ?? [])];
  }

  async getCompanyTaxProfile(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
  ): Promise<CompanyTaxProfile | null> {
    return this.companyProfiles.get(`${tenantIdVal}:${legalEntityIdVal}`) ?? null;
  }

  async listUnpaidInvoices(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
  ): Promise<readonly UnpaidInvoiceRecord[]> {
    return this.unpaidInvoices.filter(
      (i) =>
        i.tenantId === tenantIdVal &&
        i.legalEntityId === legalEntityIdVal &&
        parsePlnToGrosze(i.remainingGrossAmountPln) > 0n,
    );
  }

  async listMonthlyTaxObligations(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<readonly MonthlyTaxObligation[]> {
    return [
      ...(this.obligationsByEntityPeriod.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? []),
    ];
  }

  async getAccountingItemExplanation(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    accountingItemId: string,
  ): Promise<AccountingItemExplanationRecord | null> {
    return (
      this.explanations.get(
        `${tenantIdVal}:${legalEntityIdVal}:${accountingItemId.toLowerCase()}`,
      ) ?? null
    );
  }

  async getLegalBasisEntry(code: string, asOfDate: string): Promise<LegalBasisCatalogEntry | null> {
    const entry = VERIFIED_POLISH_LEGAL_BASIS_CATALOG[code.toUpperCase()] ?? null;
    if (!entry) {
      return null;
    }
    if (entry.legalBasis.effectiveFrom > asOfDate) {
      return null;
    }
    if (entry.legalBasis.effectiveTo !== null && asOfDate > entry.legalBasis.effectiveTo) {
      return null;
    }
    return entry;
  }

  async getMonthCloseRawData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<MonthCloseRawData> {
    return (
      this.monthCloseData.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? {
        missingDocuments: [],
        unreconciledBankTransfers: [],
      }
    );
  }

  async listUnreconciledBankTransactions(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period?: string,
  ): Promise<readonly UnreconciledBankTransactionRecord[]> {
    const entityExplicit = this.bankTransactions.filter(
      (t) => t.tenantId === tenantIdVal && t.legalEntityId === legalEntityIdVal,
    );
    const knownExplicitIds = new Set(entityExplicit.map((t) => t.bankTransactionId.toLowerCase()));
    const result: UnreconciledBankTransactionRecord[] = entityExplicit.filter(
      (t) =>
        (!period || t.bookingDate.startsWith(period)) &&
        parsePlnToGrosze(t.remainingUnallocatedPln) > 0n,
    );
    const seenIds = new Set(result.map((t) => t.bankTransactionId.toLowerCase()));

    const keyPrefix = `${tenantIdVal}:${legalEntityIdVal}:`;
    for (const [key, rawChecklist] of this.monthCloseData.entries()) {
      if (!key.startsWith(keyPrefix)) {
        continue;
      }
      const checklistPeriod = key.slice(keyPrefix.length);
      if (period && checklistPeriod !== period) {
        continue;
      }
      for (const tx of rawChecklist.unreconciledBankTransfers) {
        const normalizedId = tx.bankTransactionId.toLowerCase();
        if (knownExplicitIds.has(normalizedId) || seenIds.has(normalizedId)) {
          continue;
        }
        const signedGrosze = parsePlnToGrosze(tx.amountPln);
        const absGrosze = signedGrosze < 0n ? -signedGrosze : signedGrosze;
        if (absGrosze <= 0n) {
          continue;
        }
        seenIds.add(normalizedId);
        result.push({
          bankTransactionId: tx.bankTransactionId,
          tenantId: tenantIdVal,
          legalEntityId: legalEntityIdVal,
          bookingDate: tx.bookingDate,
          direction: signedGrosze < 0n ? 'debit' : 'credit',
          amountPln: tx.amountPln,
          remainingUnallocatedPln: formatGroszeToPln(absGrosze),
          counterpartyName: tx.counterpartyName ?? 'Kontrahent przelewu',
          transferTitle: tx.transferTitle,
        });
      }
    }

    return result;
  }

  async applyConfirmedBankReconciliation(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly bankTransactionId: string;
    readonly invoiceId: string;
    readonly allocationGrossPln: string;
    readonly confirmedByUserId: UserId;
  }): Promise<{
    readonly reconciliationEntryId: string;
    readonly remainingInvoiceGrossAfterPln: string;
  }> {
    const allocationGrosze = parsePlnToGrosze(params.allocationGrossPln);
    if (allocationGrosze <= 0n) {
      throw new Error('zero_allocation_amount');
    }

    const normalizedInvoiceId = params.invoiceId.toLowerCase();
    const normalizedTxId = params.bankTransactionId.toLowerCase();

    const invIdx = this.unpaidInvoices.findIndex(
      (i) =>
        i.tenantId === params.tenantId &&
        i.legalEntityId === params.legalEntityId &&
        i.invoiceId.toLowerCase() === normalizedInvoiceId,
    );
    if (invIdx < 0) {
      throw new Error('unpaid_invoice_not_found');
    }
    const targetInvoice = this.unpaidInvoices[invIdx]!;
    const invRemGrosze = parsePlnToGrosze(targetInvoice.remainingGrossAmountPln);
    if (invRemGrosze < allocationGrosze) {
      throw new Error('concurrent_allocation_exhausted_invoice_balance');
    }

    const expectedTxDir = targetInvoice.direction === 'purchase' ? 'debit' : 'credit';
    const explicitTxIdx = this.bankTransactions.findIndex(
      (t) =>
        t.tenantId === params.tenantId &&
        t.legalEntityId === params.legalEntityId &&
        t.bankTransactionId.toLowerCase() === normalizedTxId,
    );

    const keyPrefix = `${params.tenantId}:${params.legalEntityId}:`;
    let checklistCurrentRemGrosze: bigint | null = null;
    let checklistDirection: 'credit' | 'debit' | null = null;
    for (const [key, rawChecklist] of this.monthCloseData.entries()) {
      if (!key.startsWith(keyPrefix)) {
        continue;
      }
      const found = rawChecklist.unreconciledBankTransfers.find(
        (tx) => tx.bankTransactionId.toLowerCase() === normalizedTxId,
      );
      if (found) {
        const signed = parsePlnToGrosze(found.amountPln);
        checklistDirection = signed < 0n ? 'debit' : 'credit';
        checklistCurrentRemGrosze = signed < 0n ? -signed : signed;
        break;
      }
    }

    let txRemGrosze: bigint;
    let txDirection: 'credit' | 'debit';
    if (explicitTxIdx >= 0) {
      const explicitTx = this.bankTransactions[explicitTxIdx]!;
      txRemGrosze = parsePlnToGrosze(explicitTx.remainingUnallocatedPln);
      txDirection = explicitTx.direction;
    } else if (checklistCurrentRemGrosze !== null && checklistDirection !== null) {
      txRemGrosze = checklistCurrentRemGrosze;
      txDirection = checklistDirection;
    } else {
      throw new Error('unreconciled_bank_transaction_not_found');
    }

    if (txDirection !== expectedTxDir) {
      throw new Error('bank_transaction_direction_mismatch');
    }
    if (txRemGrosze < allocationGrosze) {
      throw new Error('concurrent_allocation_exhausted_bank_transaction_balance');
    }

    const newInvRemPln = formatGroszeToPln(invRemGrosze - allocationGrosze);
    const newTxRemGrosze = txRemGrosze - allocationGrosze;
    const newTxRemPln = formatGroszeToPln(newTxRemGrosze);

    this.unpaidInvoices[invIdx] = {
      ...targetInvoice,
      remainingGrossAmountPln: newInvRemPln,
    };

    if (explicitTxIdx >= 0) {
      const explicitTx = this.bankTransactions[explicitTxIdx]!;
      this.bankTransactions[explicitTxIdx] = {
        ...explicitTx,
        remainingUnallocatedPln: newTxRemPln,
      };
    }

    for (const [key, rawChecklist] of this.monthCloseData.entries()) {
      if (!key.startsWith(keyPrefix)) {
        continue;
      }
      const hasMatch = rawChecklist.unreconciledBankTransfers.some(
        (tx) => tx.bankTransactionId.toLowerCase() === normalizedTxId,
      );
      if (!hasMatch) {
        continue;
      }
      const updatedTransfers = rawChecklist.unreconciledBankTransfers.flatMap((tx) => {
        if (tx.bankTransactionId.toLowerCase() !== normalizedTxId) {
          return [tx];
        }
        if (newTxRemGrosze <= 0n) {
          return [];
        }
        const isDebit = tx.amountPln.startsWith('-');
        return [
          {
            ...tx,
            amountPln: isDebit ? `-${newTxRemPln}` : newTxRemPln,
          },
        ];
      });
      this.monthCloseData.set(key, {
        ...rawChecklist,
        unreconciledBankTransfers: updatedTransfers,
      });
    }

    return {
      reconciliationEntryId: randomUUID(),
      remainingInvoiceGrossAfterPln: newInvRemPln,
    };
  }

  async getVatPeriodPreviewSnapshot(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<VatPeriodPreviewSnapshot | null> {
    return this.vatSnapshots.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? null;
  }

  async getJpkPeriodSourceData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<McpJpkPeriodSourceData | null> {
    return this.jpkSources.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? null;
  }

  async getTaxCalculationSourceData(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<McpTaxCalculationSourceData | null> {
    return this.taxCalcSources.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? null;
  }

  async applyConfirmedMonthClose(params: {
    readonly tenantId: TenantId;
    readonly legalEntityId: LegalEntityId;
    readonly period: string;
    readonly confirmedByUserId: UserId;
    readonly note?: string | undefined;
  }): Promise<{ readonly closedAt: string; readonly closeEventId: string }> {
    this.closedPeriods.add(`${params.tenantId}:${params.legalEntityId}:${params.period}`);
    return {
      closedAt: new Date().toISOString(),
      closeEventId: randomUUID(),
    };
  }

  async listCompanyAuditEvents(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
  ): Promise<readonly ExternalCompanyAuditRecord[]> {
    return [...(this.externalAuditByEntity.get(`${tenantIdVal}:${legalEntityIdVal}`) ?? [])];
  }

  async isPeriodClosed(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<boolean> {
    return this.closedPeriods.has(`${tenantIdVal}:${legalEntityIdVal}:${period}`);
  }
}
