import type { MonthlyTaxObligation } from '@pap/contracts/mcp-tools';
import type { LegalEntityId, TenantId, UserId } from '@pap/domain';
import type {
  AccountingItemExplanationRecord,
  CompanyDirectoryRecord,
  CompanyTaxProfile,
  ExternalCompanyAuditRecord,
  LegalBasisCatalogEntry,
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
      (i) => i.tenantId === tenantIdVal && i.legalEntityId === legalEntityIdVal,
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
    const explicit = this.bankTransactions.filter(
      (t) =>
        t.tenantId === tenantIdVal &&
        t.legalEntityId === legalEntityIdVal &&
        (!period || t.bookingDate.startsWith(period)),
    );
    if (explicit.length > 0) {
      return explicit;
    }
    if (period) {
      const fromChecklist = await this.getMonthCloseRawData(tenantIdVal, legalEntityIdVal, period);
      return fromChecklist.unreconciledBankTransfers.map((tx) => {
        const isDebit = tx.amountPln.startsWith('-');
        const absPln = isDebit ? tx.amountPln.slice(1) : tx.amountPln;
        return {
          bankTransactionId: tx.bankTransactionId,
          tenantId: tenantIdVal,
          legalEntityId: legalEntityIdVal,
          bookingDate: tx.bookingDate,
          direction: isDebit ? 'debit' : 'credit',
          amountPln: tx.amountPln,
          remainingUnallocatedPln: absPln,
          counterpartyName: tx.counterpartyName ?? 'Kontrahent przelewu',
          transferTitle: tx.transferTitle,
        };
      });
    }
    return [];
  }

  async getVatPeriodPreviewSnapshot(
    tenantIdVal: TenantId,
    legalEntityIdVal: LegalEntityId,
    period: string,
  ): Promise<VatPeriodPreviewSnapshot | null> {
    return this.vatSnapshots.get(`${tenantIdVal}:${legalEntityIdVal}:${period}`) ?? null;
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
