import { createHash } from 'node:crypto';
import {
  buildSyntheticTestKsefNumber,
  calculateProfileAKpirObligations,
  calculateProfileBRyczaltObligations,
  calculateProfileCCitObligations,
  generateJpkEwp4Xml,
  generateJpkKrPd1Xml,
  generateJpkPkpir3Xml,
  generateJpkSt1Xml,
  generateJpkV7Xml,
  generateKsefFaXml,
  resolveApplicableJpkStructures,
  validateKsefNumber,
  validatePolishNip,
  type ApplicableJpkStructureDescriptor,
  type JpkKsefMarkerChoice,
  type JpkTaxpayerSubject,
  type ObligationLifecycleStatus,
  type OfficialJpkStructureCode,
  type PublicLawObligationKind,
  type TaxProfileCode,
  type VerifiedTaxOrZusPayment,
} from '@pap/domain';
import { type BffFetchResult, isOfflineDemoModeEnabled, papBffFetch } from './api-url';
import { formatUserFacingErrorPl } from './error-messages-pl';
import type { ActiveWebSession } from './session';
import {
  WorkspaceAccessError,
  buildVatRegistersForCompany,
  getDashboardSnapshot,
  getDocumentDetailSnapshot,
  getDocumentsForActiveCompany,
  getFinanceSnapshot,
  getFullLedgerSnapshot,
  getKpirSnapshot,
  getRyczaltSnapshot,
  getWorkspaceShellContext,
} from './synthetic-workspace';
import type { CompanyProfileRecord } from './workspace-types';

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD_YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

const FORBIDDEN_PRODUCTION_KSEF_HOSTS = new Set([
  'ksef.mf.gov.pl',
  'api.ksef.mf.gov.pl',
  'prd.ksef.mf.gov.pl',
  'ksef-prod.mf.gov.pl',
  'www.podatki.gov.pl',
  'e-deklaracje.mf.gov.pl',
  'klient-eformularz.mf.gov.pl',
  'pue.zus.pl',
]);

export type AccountingPeriodStatus = 'open' | 'reconciling' | 'closed';

export interface PeriodCloseChecklistSummary {
  readonly pendingDocumentsCount: number;
  readonly pendingMcpProposalsCount: number;
  readonly unreconciledBankTransactionsCount: number;
  readonly unpaidTaxObligationsCount: number;
}

export interface PeriodCloseSnapshot {
  readonly period: string;
  readonly status: AccountingPeriodStatus;
  readonly closedAt: string | null;
  readonly closedBy: string | null;
  readonly closeNote: string | null;
  readonly readyToClose: boolean;
  readonly blockingItemsCount: number;
  readonly checklist: PeriodCloseChecklistSummary;
  readonly warningsPl: readonly string[];
}

export interface DueVsPaidObligationRow {
  readonly kind: PublicLawObligationKind;
  readonly labelPl: string;
  readonly statutoryDueDate: string;
  readonly accruedDueGrosze: number;
  readonly confirmedPaidGrosze: number;
  readonly remainingUnpaidGrosze: number;
  readonly status: ObligationLifecycleStatus;
  readonly legalNotePl: string;
}

export interface TaxObligationsDueVsPaidSnapshot {
  readonly period: string;
  readonly profileCode: TaxProfileCode;
  readonly rows: readonly DueVsPaidObligationRow[];
  readonly totalAccruedGrosze: number;
  readonly totalConfirmedPaidGrosze: number;
  readonly totalRemainingUnpaidGrosze: number;
  readonly unpaidZusExcludedFromDeductionGrosze: number;
  readonly citAppliedRatePct: 9 | 19 | null;
  readonly warningsPl: readonly string[];
  readonly summaryPl: string;
}

export interface ApplicableJpkSnapshot {
  readonly period: string;
  readonly profileCode: TaxProfileCode;
  readonly vatActive: boolean;
  readonly structures: readonly ApplicableJpkStructureDescriptor[];
}

export interface ExportedJpkXmlView {
  readonly structureCode: OfficialJpkStructureCode;
  readonly period: string;
  readonly purpose: 1 | 2;
  readonly lifecycleStatus: 'exported_xsd_valid_awaiting_signature';
  readonly submissionStatus: 'local_xml_only_not_submitted';
  readonly officialUpoReferenceNumber: null;
  readonly xmlContent: string;
  readonly xmlSha256Hex: string;
  readonly xmlByteLength: number;
  readonly officialNamespace: string;
  readonly fileName: string;
  readonly truthfulnessNoticePl: string;
}

export interface ExportedFa3XmlView {
  readonly documentId: string;
  readonly documentNumber: string;
  readonly schemaVersion: 'FA(3)';
  readonly targetNamespace: string;
  readonly xmlContent: string;
  readonly xmlSha256Hex: string;
  readonly xmlByteLength: number;
  readonly fileName: string;
  readonly submissionStatus: 'local_xml_only_not_submitted';
}

export interface KsefSandboxStatusSnapshot {
  readonly defaultEnvironment: 'test' | 'demo' | 'local_mock';
  readonly productionHostsHardBlocked: true;
  readonly blockedProductionHosts: readonly string[];
  readonly officialTestBaseUrl: string;
  readonly officialDemoBaseUrl: string;
  readonly externalMfTestTokenConfigured: false;
  readonly liveExternalE2eStatus: 'NOT_RUN';
  readonly mandatoryReceiveFrom: string;
  readonly mandatoryIssueLargeFrom: string;
  readonly mandatoryIssueStandardFrom: string;
  readonly microExemptionMonthlyGrossLimitPln: number;
  readonly statusSummaryPl: string;
}

export interface KsefSandboxIssueResult {
  readonly documentId: string;
  readonly documentNumber: string;
  readonly environment: 'test' | 'demo' | 'local_mock';
  readonly liveExternalSubmitted: boolean;
  readonly status: 'mock_simulated_local_only' | 'external_token_not_configured';
  readonly syntheticReferenceNumber: string | null;
  readonly officialUpoReferenceNumber: null;
  readonly fa3XmlSha256Hex: string;
  readonly messagePl: string;
}

export interface KsefSandboxSyncResult {
  readonly environment: 'test' | 'demo' | 'local_mock';
  readonly liveExternalConnected: boolean;
  readonly syncedInvoicesCount: number;
  readonly messagePl: string;
}

export interface SourceArchiveWormRecord {
  readonly archiveId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sha256Hex: string;
  readonly byteLength: number;
  readonly archivedAt: string;
}

interface FallbackClosedPeriodRecord {
  readonly closedAt: string;
  readonly closedBy: string;
  readonly closeNote: string | null;
}

interface FallbackWave2Store {
  readonly closedPeriods: Map<string, FallbackClosedPeriodRecord>;
  readonly wormArchiveByCompany: Map<string, Map<string, SourceArchiveWormRecord>>;
}

const WAVE2_FALLBACK_STORE_KEY = '__PAP_WEB_WAVE2_FALLBACK_STORE_V1__' as const;

function getWave2FallbackStore(): FallbackWave2Store {
  const g = globalThis as unknown as Record<string, FallbackWave2Store | undefined>;
  if (!g[WAVE2_FALLBACK_STORE_KEY]) {
    g[WAVE2_FALLBACK_STORE_KEY] = {
      closedPeriods: new Map(),
      wormArchiveByCompany: new Map(),
    };
  }
  return g[WAVE2_FALLBACK_STORE_KEY]!;
}

export function resetWave2FallbackStoreForTests(): void {
  const g = globalThis as unknown as Record<string, FallbackWave2Store | undefined>;
  g[WAVE2_FALLBACK_STORE_KEY] = {
    closedPeriods: new Map(),
    wormArchiveByCompany: new Map(),
  };
}

export function assertBffFallbackPeriodNotClosed(
  tenantId: string,
  legalEntityId: string,
  period: string,
): void {
  const key = `${tenantId}:${legalEntityId}:${period}`;
  if (getWave2FallbackStore().closedPeriods.has(key)) {
    throw new WorkspaceAccessError(
      409,
      'period_closed',
      formatUserFacingErrorPl({ status: 409, reasonCode: 'period_closed' }),
    );
  }
}

function assertSafeUuid(value: string, label: string): string {
  if (!STRICT_UUID_REGEX.test(value)) {
    throw new WorkspaceAccessError(
      400,
      'invalid_selector',
      `Nieprawidłowy identyfikator UUID (${label}).`,
    );
  }
  return encodeURIComponent(value);
}

function assertSafePeriod(period: string): string {
  const trimmed = period.trim();
  if (!PERIOD_YEAR_MONTH_REGEX.test(trimmed)) {
    throw new WorkspaceAccessError(
      400,
      'invalid_period',
      `Nieprawidłowy okres rozliczeniowy (${trimmed || 'pusty'}) — wymagany format RRRR-MM.`,
    );
  }
  return trimmed;
}

function sha256Utf8(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');
}

function throwFromNon404Remote(remote: BffFetchResult<unknown>, fallbackPl: string): never {
  if (remote.kind === 'unauthorized') {
    throw new WorkspaceAccessError(
      401,
      'api_unauthorized',
      formatUserFacingErrorPl({ status: 401, reasonCode: 'api_unauthorized' }),
    );
  }
  if (remote.kind === 'forbidden') {
    const code = remote.reasonCode ?? 'forbidden';
    throw new WorkspaceAccessError(
      403,
      code,
      formatUserFacingErrorPl({
        status: 403,
        reasonCode: code,
        rawMessage: remote.message,
      }),
    );
  }
  if (remote.kind === 'unavailable') {
    throw new WorkspaceAccessError(
      503,
      'api_unavailable',
      formatUserFacingErrorPl({ status: 503, reasonCode: 'api_unavailable', fallbackPl }),
    );
  }
  if (remote.kind === 'not_found') {
    throw new WorkspaceAccessError(
      404,
      'api_not_found',
      formatUserFacingErrorPl({
        status: 404,
        reasonCode: 'api_not_found',
        rawMessage: remote.message,
        fallbackPl,
      }),
    );
  }
  if (remote.kind === 'validation_error') {
    const code = remote.reasonCode ?? 'validation_error';
    throw new WorkspaceAccessError(
      remote.status,
      code,
      formatUserFacingErrorPl({
        status: remote.status,
        reasonCode: code,
        rawMessage: remote.message,
        fallbackPl,
      }),
    );
  }
  if (remote.kind === 'server_error') {
    const code = remote.reasonCode ?? 'internal_error';
    throw new WorkspaceAccessError(
      remote.status,
      code,
      formatUserFacingErrorPl({
        status: remote.status,
        reasonCode: code,
        rawMessage: remote.message,
        fallbackPl,
      }),
    );
  }
  throw new WorkspaceAccessError(500, 'internal_error', fallbackPl);
}

function isUnmountedWave2Route404(remote: BffFetchResult<unknown>): boolean {
  if (remote.kind !== 'not_found') return false;
  return remote.routeUnmounted !== false;
}

async function callWave2CompanyEndpoint<T>(
  session: ActiveWebSession,
  subPath: string,
  options: {
    readonly method: 'GET' | 'POST';
    readonly body?: unknown;
    readonly fallbackErrorPl: string;
  },
): Promise<{ readonly handledByApi: true; readonly data: T } | { readonly handledByApi: false }> {
  if (isOfflineDemoModeEnabled()) {
    return { handledByApi: false };
  }
  const safeTenantId = assertSafeUuid(session.context.tenantId, 'tenantId');
  const safeEntityId = assertSafeUuid(session.context.legalEntityId, 'legalEntityId');

  const canonicalUrl = `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}${subPath}`;
  const primary = await papBffFetch<T>(canonicalUrl, {
    method: options.method,
    bearerToken: session.oidcToken,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
  if (primary.kind === 'ok') {
    return { handledByApi: true, data: primary.data };
  }
  if (!isUnmountedWave2Route404(primary)) {
    throwFromNon404Remote(primary, options.fallbackErrorPl);
  }

  const shorthandUrl = `/api/v1/companies/${safeEntityId}${subPath}`;
  const secondary = await papBffFetch<T>(shorthandUrl, {
    method: options.method,
    bearerToken: session.oidcToken,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
  if (secondary.kind === 'ok') {
    return { handledByApi: true, data: secondary.data };
  }
  if (!isUnmountedWave2Route404(secondary)) {
    throwFromNon404Remote(secondary, options.fallbackErrorPl);
  }

  return { handledByApi: false };
}

async function authorizeCompanyForFallback(
  session: ActiveWebSession,
  requiredAction: 'read' | 'write',
): Promise<CompanyProfileRecord> {
  const shell = await getWorkspaceShellContext(session);
  if (requiredAction === 'write' && !shell.activeCompany.grantedActions.includes('write')) {
    throw new WorkspaceAccessError(
      403,
      'company_grant_required',
      formatUserFacingErrorPl({ status: 403, reasonCode: 'company_grant_required' }),
    );
  }
  return shell.activeCompany;
}

function lastDayOfPeriodIso(period: string): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

function buildJpkSubjectFromCompany(
  company: CompanyProfileRecord,
  contactEmail?: string,
): JpkTaxpayerSubject {
  const nipCheck = validatePolishNip(company.nip);
  const validNip = nipCheck.valid && nipCheck.normalizedNip ? nipCheck.normalizedNip : '5250001003';
  const email = contactEmail?.trim() || 'kontakt@syntetyczny.example';
  if (company.legalForm === 'sp_z_o_o') {
    return {
      kind: 'legal_entity',
      nip: validNip,
      fullName: company.companyName,
      regon: company.regon,
      email,
    };
  }
  const tokens = company.companyName.trim().split(/\s+/);
  const lastName = tokens[tokens.length - 1] || 'Testowy';
  const firstName = tokens[tokens.length - 2] || 'Jan';
  return {
    kind: 'natural_person',
    nip: validNip,
    firstName,
    lastName,
    birthDate: '1985-04-12',
    email,
  };
}

function mapMarkerForJpkV7(marker: string, ksefRef?: string): JpkKsefMarkerChoice {
  if (marker === 'NrKSeF' && ksefRef && validateKsefNumber(ksefRef).valid) {
    return { kind: 'KSEF', ksefNumber: ksefRef };
  }
  if (marker === 'OFF') return { kind: 'OFF' };
  if (marker === 'DI') return { kind: 'DI' };
  return { kind: 'BFK' };
}

// ============================================================================
// 1. Zamknięcie okresu rozliczeniowego (#116, GLD-08)
// ============================================================================

export async function getPeriodCloseSnapshot(
  session: ActiveWebSession,
  rawPeriod?: string,
): Promise<PeriodCloseSnapshot> {
  const period = assertSafePeriod(rawPeriod ?? session.context.period);
  const remote = await callWave2CompanyEndpoint<{
    readonly period?: string;
    readonly status?: AccountingPeriodStatus;
    readonly closedAt?: string | null;
    readonly closedBy?: string | null;
    readonly closedByUserId?: string | null;
    readonly note?: string | null;
    readonly closeNote?: string | null;
    readonly readyToClose?: boolean;
    readonly blockingItemsCount?: number;
    readonly checklist?:
      | Partial<PeriodCloseChecklistSummary>
      | ReadonlyArray<{
          readonly code: string;
          readonly passed: boolean;
          readonly count: number;
          readonly detailsPl: string;
        }>;
    readonly warningsPl?: readonly string[];
  }>(session, `/periods/${encodeURIComponent(period)}/close-status`, {
    method: 'GET',
    fallbackErrorPl: 'Nie udało się pobrać statusu zamknięcia okresu rozliczeniowego.',
  });

  const [dash, fin] = await Promise.all([
    getDashboardSnapshot(session),
    getFinanceSnapshot(session),
  ]);

  const matchedTxIds = new Set(
    fin.reconciliationMatches
      .filter((m) => m.matchedDocumentId && m.settledAmountGrosze > 0)
      .map((m) => m.transactionId),
  );
  const unreconciledBankCount = fin.bankTransactions.filter(
    (tx) => tx.bookingDate.startsWith(period) && !matchedTxIds.has(tx.transactionId),
  ).length;
  const pendingDocsInPeriod = dash.pendingDocuments.filter((d) => d.period === period).length;
  const pendingMcpCount = dash.pendingMcpProposals.length;
  const unpaidApplicableCount = dash.obligations.filter(
    (o) => o.status === 'applicable' && !o.isPaid,
  ).length;

  if (remote.handledByApi) {
    const status: AccountingPeriodStatus = remote.data.status ?? 'open';
    const rawChecklist = remote.data.checklist;
    let checklist: PeriodCloseChecklistSummary;
    let derivedWarnings: readonly string[] = [];
    if (Array.isArray(rawChecklist)) {
      const arr = rawChecklist as ReadonlyArray<{
        readonly code: string;
        readonly passed: boolean;
        readonly count: number;
        readonly detailsPl: string;
      }>;
      const findCount = (code: string, fallback: number): number => {
        const item = arr.find((c) => c.code === code);
        return item ? item.count : fallback;
      };
      checklist = {
        pendingDocumentsCount: findCount('UNVERIFIED_DOCUMENTS', pendingDocsInPeriod),
        pendingMcpProposalsCount: findCount('PENDING_MCP_PROPOSALS', pendingMcpCount),
        unreconciledBankTransactionsCount: findCount(
          'UNRECONCILED_BANK_TRANSACTIONS',
          unreconciledBankCount,
        ),
        unpaidTaxObligationsCount: unpaidApplicableCount,
      };
      derivedWarnings = arr.filter((c) => !c.passed).map((c) => c.detailsPl);
    } else {
      const objChecklist = rawChecklist as Partial<PeriodCloseChecklistSummary> | undefined;
      checklist = {
        pendingDocumentsCount: objChecklist?.pendingDocumentsCount ?? pendingDocsInPeriod,
        pendingMcpProposalsCount: objChecklist?.pendingMcpProposalsCount ?? pendingMcpCount,
        unreconciledBankTransactionsCount:
          objChecklist?.unreconciledBankTransactionsCount ?? unreconciledBankCount,
        unpaidTaxObligationsCount: objChecklist?.unpaidTaxObligationsCount ?? unpaidApplicableCount,
      };
    }
    const blocking =
      remote.data.blockingItemsCount ??
      checklist.pendingDocumentsCount + checklist.pendingMcpProposalsCount;
    return {
      period,
      status,
      closedAt: remote.data.closedAt ?? null,
      closedBy: remote.data.closedBy ?? remote.data.closedByUserId ?? null,
      closeNote: remote.data.closeNote ?? remote.data.note ?? null,
      readyToClose: remote.data.readyToClose ?? blocking === 0,
      blockingItemsCount: blocking,
      checklist,
      warningsPl: remote.data.warningsPl ?? derivedWarnings,
    };
  }

  const key = `${dash.activeCompany.tenantId}:${dash.activeCompany.legalEntityId}:${period}`;
  const fallbackClosed = getWave2FallbackStore().closedPeriods.get(key);
  const blockingItemsCount = pendingDocsInPeriod + pendingMcpCount;
  const warningsPl: string[] = [];
  if (pendingDocsInPeriod > 0) {
    warningsPl.push(
      `W okresie ${period} pozostaje ${String(pendingDocsInPeriod)} niezatwierdzony(ch) dokument(ów) w kolejce Split-View.`,
    );
  }
  if (pendingMcpCount > 0) {
    warningsPl.push(
      `W kolejce MCP oczekuje ${String(pendingMcpCount)} niezatwierdzona propozycja agenta AI.`,
    );
  }
  if (unreconciledBankCount > 0) {
    warningsPl.push(
      `W wyciągach bankowych wykryto ${String(unreconciledBankCount)} nierozliczoną operację za ${period}.`,
    );
  }

  return {
    period,
    status: fallbackClosed ? 'closed' : blockingItemsCount > 0 ? 'reconciling' : 'open',
    closedAt: fallbackClosed?.closedAt ?? null,
    closedBy: fallbackClosed?.closedBy ?? null,
    closeNote: fallbackClosed?.closeNote ?? null,
    readyToClose: blockingItemsCount === 0,
    blockingItemsCount,
    checklist: {
      pendingDocumentsCount: pendingDocsInPeriod,
      pendingMcpProposalsCount: pendingMcpCount,
      unreconciledBankTransactionsCount: unreconciledBankCount,
      unpaidTaxObligationsCount: unpaidApplicableCount,
    },
    warningsPl,
  };
}

export async function closeAccountingPeriodMutation(
  session: ActiveWebSession,
  input: {
    readonly period?: string;
    readonly confirmClose: boolean;
    readonly note?: string;
  },
): Promise<PeriodCloseSnapshot> {
  if (!input.confirmClose) {
    throw new WorkspaceAccessError(
      400,
      'human_confirmation_required',
      'Zamknięcie okresu księgowego wymaga jawnego potwierdzenia człowieka (confirmClose: true).',
    );
  }
  const period = assertSafePeriod(input.period ?? session.context.period);
  const cleanNote = input.note?.trim() || undefined;

  const remote = await callWave2CompanyEndpoint<unknown>(
    session,
    `/periods/${encodeURIComponent(period)}/close`,
    {
      method: 'POST',
      body: {
        confirmClose: true,
        ...(cleanNote ? { note: cleanNote } : {}),
      },
      fallbackErrorPl: `Nie udało się zamknąć okresu rozliczeniowego ${period}.`,
    },
  );

  if (!remote.handledByApi) {
    const company = await authorizeCompanyForFallback(session, 'write');
    const key = `${company.tenantId}:${company.legalEntityId}:${period}`;
    const store = getWave2FallbackStore();
    if (store.closedPeriods.has(key)) {
      throw new WorkspaceAccessError(
        409,
        'period_closed',
        formatUserFacingErrorPl({ status: 409, reasonCode: 'period_closed' }),
      );
    }
    store.closedPeriods.set(key, {
      closedAt: new Date().toISOString(),
      closedBy: session.context.displayName,
      closeNote: cleanNote ?? null,
    });
  }

  return getPeriodCloseSnapshot(session, period);
}

// ============================================================================
// 2. Zobowiązania Naliczone (Accrued/Due) vs Faktycznie Opłacone (Paid) (#81)
// ============================================================================

export async function getTaxObligationsDueVsPaidSnapshot(
  session: ActiveWebSession,
  rawPeriod?: string,
): Promise<TaxObligationsDueVsPaidSnapshot> {
  const period = assertSafePeriod(rawPeriod ?? session.context.period);

  const remote = await callWave2CompanyEndpoint<{
    readonly rows?: readonly DueVsPaidObligationRow[];
    readonly items?: ReadonlyArray<{
      readonly obligationKind: PublicLawObligationKind;
      readonly labelPl: string;
      readonly statutoryDueDate: string;
      readonly accruedGrosze: number;
      readonly paidGrosze: number;
      readonly remainingGrosze: number;
      readonly status: ObligationLifecycleStatus;
    }>;
    readonly totals?: {
      readonly totalAccruedGrosze: number;
      readonly totalPaidGrosze: number;
      readonly totalRemainingGrosze: number;
    };
    readonly citRateDetails?: {
      readonly operatingAppliedRatePct: 9 | 19;
    } | null;
    readonly explanation?: {
      readonly summary?: string;
      readonly warnings?: ReadonlyArray<{ readonly message: string }>;
    };
    readonly totalAccruedGrosze?: number;
    readonly totalConfirmedPaidGrosze?: number;
    readonly totalRemainingUnpaidGrosze?: number;
    readonly unpaidZusExcludedFromDeductionGrosze?: number;
    readonly citAppliedRatePct?: 9 | 19 | null;
    readonly warningsPl?: readonly string[];
    readonly summaryPl?: string;
  }>(session, `/taxes/obligations?period=${encodeURIComponent(period)}`, {
    method: 'GET',
    fallbackErrorPl: 'Nie udało się pobrać rozliczenia zobowiązań (naliczone vs opłacone).',
  });

  const dash = await getDashboardSnapshot(session);
  const company = dash.activeCompany;

  if (
    remote.handledByApi &&
    (Array.isArray(remote.data.items) || Array.isArray(remote.data.rows))
  ) {
    const mappedRows: readonly DueVsPaidObligationRow[] = Array.isArray(remote.data.items)
      ? remote.data.items.map((item) => ({
          kind: item.obligationKind,
          labelPl: item.labelPl,
          statutoryDueDate: item.statutoryDueDate,
          accruedDueGrosze: item.accruedGrosze,
          confirmedPaidGrosze: item.paidGrosze,
          remainingUnpaidGrosze: item.remainingGrosze,
          status: item.status,
          legalNotePl:
            'Rozliczenie należne vs faktycznie opłacone wg potwierdzonych operacji bankowych.',
        }))
      : (remote.data.rows ?? []);
    const zusUnpaidFromItems = mappedRows
      .filter((r) => r.kind === 'zus_social')
      .reduce((s, r) => s + r.remainingUnpaidGrosze, 0);
    return {
      period,
      profileCode: company.profileCode,
      rows: mappedRows,
      totalAccruedGrosze:
        remote.data.totals?.totalAccruedGrosze ?? remote.data.totalAccruedGrosze ?? 0,
      totalConfirmedPaidGrosze:
        remote.data.totals?.totalPaidGrosze ?? remote.data.totalConfirmedPaidGrosze ?? 0,
      totalRemainingUnpaidGrosze:
        remote.data.totals?.totalRemainingGrosze ?? remote.data.totalRemainingUnpaidGrosze ?? 0,
      unpaidZusExcludedFromDeductionGrosze:
        remote.data.unpaidZusExcludedFromDeductionGrosze ?? zusUnpaidFromItems,
      citAppliedRatePct:
        remote.data.citRateDetails?.operatingAppliedRatePct ??
        remote.data.citAppliedRatePct ??
        null,
      warningsPl:
        remote.data.warningsPl ?? remote.data.explanation?.warnings?.map((w) => w.message) ?? [],
      summaryPl:
        remote.data.summaryPl ??
        remote.data.explanation?.summary ??
        `Rozliczenie należnych i opłaconych zobowiązań publicznoprawnych za ${period}.`,
    };
  }

  const [fin, vat] = await Promise.all([
    getFinanceSnapshot(session),
    buildVatRegistersForCompany(company, period, session),
  ]);

  const cutOffDate = lastDayOfPeriodIso(period);
  const verifiedPayments: VerifiedTaxOrZusPayment[] = [];
  for (const tx of fin.bankTransactions) {
    if (tx.direction !== 'debit' || tx.amountGrosze <= 0) continue;
    const upper = `${tx.title} ${tx.counterpartyName}`.toUpperCase();
    if (upper.includes('ZUS')) {
      verifiedPayments.push({
        paymentId: `pay-zus-${tx.transactionId}`,
        obligationKind: 'zus_social',
        targetPeriod: period,
        paidDate: tx.bookingDate <= cutOffDate ? tx.bookingDate : cutOffDate,
        amountGrosze: tx.amountGrosze,
        bankTransactionId: tx.transactionId,
      });
    } else if (upper.includes('VAT-7') || upper.includes('JPK_V7')) {
      verifiedPayments.push({
        paymentId: `pay-vat-${tx.transactionId}`,
        obligationKind: 'vat_settlement',
        targetPeriod: period,
        paidDate: tx.bookingDate <= cutOffDate ? tx.bookingDate : cutOffDate,
        amountGrosze: tx.amountGrosze,
        bankTransactionId: tx.transactionId,
      });
    }
  }

  const rows: DueVsPaidObligationRow[] = [];
  const warningsPl: string[] = [];
  let unpaidZusExcluded = 0;
  let citAppliedRatePct: 9 | 19 | null = null;
  let summaryPl: string;

  if (company.profileCode === 'jdg_kpir_skala' || company.profileCode === 'jdg_kpir_liniowy') {
    const kpir = await getKpirSnapshot(session);
    const taxForm = company.profileCode === 'jdg_kpir_liniowy' ? 'liniowy' : 'skala';
    const profileA = calculateProfileAKpirObligations({
      period,
      taxForm,
      zusScheme: company.zusScheme === 'not_applicable' ? 'duzy_zus' : company.zusScheme,
      voluntarySicknessInsurance: company.voluntarySicknessInsurance,
      previousMonthIncomeForHealthGrosze: Math.max(
        0,
        kpir.summary.monthTotals.col9TotalRevenueGrosze -
          kpir.summary.monthTotals.totalTaxDeductibleCostsGrosze,
      ),
      ytdRevenueGrosze:
        company.ytdPriorMonthsRevenueGrosze + kpir.summary.monthTotals.col9TotalRevenueGrosze,
      ytdCostsGrosze:
        company.ytdPriorMonthsCostsGrosze + kpir.summary.monthTotals.totalTaxDeductibleCostsGrosze,
      verifiedPayments,
      deductionCutOffDate: cutOffDate,
    });
    unpaidZusExcluded = profileA.unpaidAccruedZusExcludedFromDeductionGrosze;
    summaryPl = profileA.explanation.summary;
    for (const w of profileA.explanation.warnings) {
      warningsPl.push(w.message);
    }

    rows.push(
      {
        kind: 'zus_social',
        labelPl: 'Składki ZUS społeczne (emerytalna, rentowa, wypadkowa, chorobowa)',
        statutoryDueDate: profileA.zusSettlements.social.statutoryDueDate,
        accruedDueGrosze: profileA.zusSettlements.social.accruedDueGrosze,
        confirmedPaidGrosze: profileA.zusSettlements.social.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileA.zusSettlements.social.remainingUnpaidGrosze,
        status: profileA.zusSettlements.social.status,
        legalNotePl:
          'Odliczeniu od dochodu PIT podlegają wyłącznie składki faktycznie opłacone w roku podatkowym (art. 26 ust. 1 pkt 2 PIT).',
      },
      {
        kind: 'zus_health',
        labelPl: 'Składka zdrowotna ZUS (NFZ)',
        statutoryDueDate: profileA.zusSettlements.health.statutoryDueDate,
        accruedDueGrosze: profileA.zusSettlements.health.accruedDueGrosze,
        confirmedPaidGrosze: profileA.zusSettlements.health.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileA.zusSettlements.health.remainingUnpaidGrosze,
        status: profileA.zusSettlements.health.status,
        legalNotePl:
          taxForm === 'liniowy'
            ? 'Na podatku liniowym 19% zapłacona składka zdrowotna podlega odliczeniu do limitu rocznego 14 100 zł w 2026 r. (art. 30c ust. 2 pkt 2 PIT).'
            : 'Na skali podatkowej 12%/32% składka zdrowotna 9% nie podlega odliczeniu od dochodu ani od podatku.',
      },
      {
        kind: 'zus_labor_fund',
        labelPl: 'Fundusz Pracy i Fundusz Solidarnościowy',
        statutoryDueDate: profileA.zusSettlements.laborFund.statutoryDueDate,
        accruedDueGrosze: profileA.zusSettlements.laborFund.accruedDueGrosze,
        confirmedPaidGrosze: profileA.zusSettlements.laborFund.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileA.zusSettlements.laborFund.remainingUnpaidGrosze,
        status: profileA.zusSettlements.laborFund.status,
        legalNotePl: 'Ujmowany w KUP w dacie faktycznej zapłaty.',
      },
      {
        kind: 'pit_advance',
        labelPl:
          taxForm === 'liniowy'
            ? 'Zaliczka miesięczna PIT-36L (liniowy 19%)'
            : 'Zaliczka miesięczna PIT-36 (skala 12%/32%)',
        statutoryDueDate: profileA.pitAdvanceSettlement.statutoryDueDate,
        accruedDueGrosze: profileA.pitAdvanceSettlement.accruedDueGrosze,
        confirmedPaidGrosze: profileA.pitAdvanceSettlement.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileA.pitAdvanceSettlement.remainingUnpaidGrosze,
        status: profileA.pitAdvanceSettlement.status,
        legalNotePl: 'Termin wpłaty na mikrorachunek podatkowy do 20. dnia następnego miesiąca.',
      },
    );
  } else if (company.profileCode === 'jdg_ryczalt') {
    const ryc = await getRyczaltSnapshot(session);
    const profileB = calculateProfileBRyczaltObligations({
      period,
      zusScheme: company.zusScheme === 'not_applicable' ? 'preferencyjny_zus' : company.zusScheme,
      voluntarySicknessInsurance: company.voluntarySicknessInsurance,
      entries: ryc.entries,
      verifiedPayments,
      deductionCutOffDate: cutOffDate,
    });
    unpaidZusExcluded =
      profileB.zusSettlements.social.remainingUnpaidGrosze +
      Math.round(profileB.zusSettlements.health.remainingUnpaidGrosze / 2);
    summaryPl = profileB.explanation.summary;
    for (const w of profileB.explanation.warnings) {
      warningsPl.push(w.message);
    }

    rows.push(
      {
        kind: 'zus_social',
        labelPl: 'Składki ZUS społeczne (ryczałt)',
        statutoryDueDate: profileB.zusSettlements.social.statutoryDueDate,
        accruedDueGrosze: profileB.zusSettlements.social.accruedDueGrosze,
        confirmedPaidGrosze: profileB.zusSettlements.social.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileB.zusSettlements.social.remainingUnpaidGrosze,
        status: profileB.zusSettlements.social.status,
        legalNotePl:
          'Pomniejszają przychód proporcjonalnie wg stawek wyłącznie po faktycznej zapłacie (art. 11 ust. 1 PPE).',
      },
      {
        kind: 'zus_health',
        labelPl: 'Składka zdrowotna ZUS (ryczałt — progi 60 tys. / 300 tys. zł)',
        statutoryDueDate: profileB.zusSettlements.health.statutoryDueDate,
        accruedDueGrosze: profileB.zusSettlements.health.accruedDueGrosze,
        confirmedPaidGrosze: profileB.zusSettlements.health.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileB.zusSettlements.health.remainingUnpaidGrosze,
        status: profileB.zusSettlements.health.status,
        legalNotePl:
          '50% faktycznie zapłaconej składki zdrowotnej pomniejsza przychód na ryczałcie (art. 11 ust. 1a PPE).',
      },
      {
        kind: 'ryczalt_advance',
        labelPl: 'Ryczałt od przychodów ewidencjonowanych (PPE)',
        statutoryDueDate: profileB.ryczaltSettlement.statutoryDueDate,
        accruedDueGrosze: profileB.ryczaltSettlement.accruedDueGrosze,
        confirmedPaidGrosze: profileB.ryczaltSettlement.confirmedPaidGrosze,
        remainingUnpaidGrosze: profileB.ryczaltSettlement.remainingUnpaidGrosze,
        status: profileB.ryczaltSettlement.status,
        legalNotePl: 'Termin wpłaty ryczałtu do 20. dnia miesiąca następującego po miesiącu.',
      },
    );
  } else {
    const ledger = await getFullLedgerSnapshot(session);
    const hasVerified9PctAttestation =
      company.smallTaxpayer && company.priorYearGrossSalesGrosze > 0;
    const taxYear = period.slice(0, 4);
    const profileC = calculateProfileCCitObligations({
      period,
      taxYearStartDate: `${taxYear}-01-01`,
      taxYearEndDate: `${taxYear}-12-31`,
      operatingRevenuesYtdGrosze:
        company.ytdPriorMonthsRevenueGrosze + ledger.profitAndLoss.totalRevenuesGrosze,
      operatingTaxDeductibleCostsYtdGrosze:
        company.ytdPriorMonthsCostsGrosze +
        ledger.profitAndLoss.totalOperatingAndFinancialExpensesGrosze,
      requestPreferential9PctRate: hasVerified9PctAttestation,
      ...(hasVerified9PctAttestation
        ? {
            preferentialEligibility: {
              smallTaxpayerVerified: true,
              priorYearGrossSalesGrosze: company.priorYearGrossSalesGrosze,
              isFirstTaxYearNewEntityVerified: false,
              excludedRestructuringArt19Ust1aVerified: true,
              excludedTaxCapitalGroupOrSplitVerified: true,
            },
          }
        : {}),
      verifiedPayments,
      evaluationDate: cutOffDate,
    });
    citAppliedRatePct = profileC.operatingAppliedRatePct;
    summaryPl = profileC.explanation.summary;
    if (!hasVerified9PctAttestation) {
      warningsPl.push(
        'Zastosowano stawkę podstawową 19% CIT — brak kompletnego poświadczenia przychodów brutto za rok poprzedni oraz wyłączeń z art. 19 ust. 1a–1c CIT dla stawki 9%.',
      );
    }
    for (const w of profileC.explanation.warnings) {
      warningsPl.push(w.message);
    }

    rows.push({
      kind: 'cit_advance',
      labelPl: `Zaliczka miesięczna CIT-8 (stawka operacyjna ${String(profileC.operatingAppliedRatePct)}%, zyski kapitałowe 19%)`,
      statutoryDueDate: profileC.citAdvanceSettlement.statutoryDueDate,
      accruedDueGrosze: profileC.citAdvanceSettlement.accruedDueGrosze,
      confirmedPaidGrosze: profileC.citAdvanceSettlement.confirmedPaidGrosze,
      remainingUnpaidGrosze: profileC.citAdvanceSettlement.remainingUnpaidGrosze,
      status: profileC.citAdvanceSettlement.status,
      legalNotePl:
        'Rozdział dochodów operacyjnych od zysków kapitałowych (art. 7b i art. 7 ust. 5 CIT — zakaz kompensacji strat między źródłami).',
    });
  }

  if (company.vatStatus === 'czynny') {
    const vatDueGrosze = vat.jpkSummary.taxDueToPayP51Grosze;
    const vatPaidGrosze = verifiedPayments
      .filter((p) => p.obligationKind === 'vat_settlement' && p.targetPeriod === period)
      .reduce((acc, p) => acc + p.amountGrosze, 0);
    const vatRemaining = Math.max(0, vatDueGrosze - vatPaidGrosze);
    const [yStr = '2026', mStr = '01'] = period.split('-');
    const nextMonth = Number(mStr) === 12 ? 1 : Number(mStr) + 1;
    const nextYear = Number(mStr) === 12 ? Number(yStr) + 1 : Number(yStr);
    const vatDueDate = `${String(nextYear)}-${String(nextMonth).padStart(2, '0')}-25`;

    rows.push({
      kind: 'vat_settlement',
      labelPl: `Podatek VAT do wpłaty z deklaracji ${vat.jpkSummary.schemaVersion} (pole P_51)`,
      statutoryDueDate: vatDueDate,
      accruedDueGrosze: vatDueGrosze,
      confirmedPaidGrosze: vatPaidGrosze,
      remainingUnpaidGrosze: vatRemaining,
      status:
        vatDueGrosze === 0 || vatRemaining === 0
          ? 'paid'
          : vatPaidGrosze > 0
            ? 'partially_paid'
            : 'accrued_not_yet_due',
      legalNotePl: 'Termin złożenia JPK_V7M i wpłaty podatku P_51 do 25. dnia następnego miesiąca.',
    });
  }

  const totalAccruedGrosze = rows.reduce((s, r) => s + r.accruedDueGrosze, 0);
  const totalConfirmedPaidGrosze = rows.reduce((s, r) => s + r.confirmedPaidGrosze, 0);
  const totalRemainingUnpaidGrosze = rows.reduce((s, r) => s + r.remainingUnpaidGrosze, 0);

  return {
    period,
    profileCode: company.profileCode,
    rows,
    totalAccruedGrosze,
    totalConfirmedPaidGrosze,
    totalRemainingUnpaidGrosze,
    unpaidZusExcludedFromDeductionGrosze: unpaidZusExcluded,
    citAppliedRatePct,
    warningsPl,
    summaryPl,
  };
}

// ============================================================================
// 3. Eksport JPK zgodny z XSD MF (#98, GLD-11)
// ============================================================================

export async function getApplicableJpkSnapshot(
  session: ActiveWebSession,
  rawPeriod?: string,
): Promise<ApplicableJpkSnapshot> {
  const period = assertSafePeriod(rawPeriod ?? session.context.period);

  const remote = await callWave2CompanyEndpoint<{
    readonly structures?: readonly ApplicableJpkStructureDescriptor[];
    readonly applicableStructures?: readonly ApplicableJpkStructureDescriptor[];
  }>(session, `/jpk/applicable?period=${encodeURIComponent(period)}`, {
    method: 'GET',
    fallbackErrorPl: 'Nie udało się ustalić listy obowiązujących struktur JPK dla firmy.',
  });

  const company = await authorizeCompanyForFallback(session, 'read');
  const vatActive = company.vatStatus === 'czynny';

  const remoteStructures = remote.handledByApi
    ? (remote.data.applicableStructures ?? remote.data.structures)
    : undefined;
  if (remote.handledByApi && Array.isArray(remoteStructures)) {
    return {
      period,
      profileCode: company.profileCode,
      vatActive,
      structures: remoteStructures,
    };
  }

  const structures = resolveApplicableJpkStructures({
    profile: company.profileCode,
    vatPayer: vatActive,
    vatCadence: vatActive
      ? company.vatSettlementPeriod === 'quarterly'
        ? 'quarterly'
        : 'monthly'
      : 'not_applicable',
    periodYearMonth: period,
  });

  return {
    period,
    profileCode: company.profileCode,
    vatActive,
    structures,
  };
}

export async function exportValidatedJpkXmlMutation(
  session: ActiveWebSession,
  input: {
    readonly period?: string;
    readonly structureCode: OfficialJpkStructureCode;
    readonly purpose?: 1 | 2;
  },
): Promise<ExportedJpkXmlView> {
  const period = assertSafePeriod(input.period ?? session.context.period);
  const purpose: 1 | 2 = input.purpose === 2 ? 2 : 1;

  const remote = await callWave2CompanyEndpoint<{
    readonly structureCode?: OfficialJpkStructureCode;
    readonly xmlContent?: string;
    readonly xml?: string;
    readonly xmlSha256Hex?: string;
    readonly sha256?: string;
    readonly xmlByteLength?: number;
    readonly officialNamespace?: string;
    readonly truthfulnessNoticePl?: string;
  }>(session, '/jpk/export', {
    method: 'POST',
    body: {
      period,
      structureCode: input.structureCode,
      purpose,
      ...(purpose === 2
        ? { correctionJustification: 'Korekta ewidencji i deklaracji podatkowej' }
        : {}),
    },
    fallbackErrorPl: `Nie udało się wygenerować pliku ${input.structureCode}.`,
  });

  const safeCodeSlug = input.structureCode.replace(/[^A-Za-z0-9_-]/g, '_');

  if (remote.handledByApi && (remote.data.xmlContent || remote.data.xml)) {
    const xmlContent = (remote.data.xmlContent ?? remote.data.xml)!;
    const sha = remote.data.xmlSha256Hex ?? remote.data.sha256 ?? sha256Utf8(xmlContent);
    return {
      structureCode: remote.data.structureCode ?? input.structureCode,
      period,
      purpose,
      lifecycleStatus: 'exported_xsd_valid_awaiting_signature',
      submissionStatus: 'local_xml_only_not_submitted',
      officialUpoReferenceNumber: null,
      xmlContent,
      xmlSha256Hex: sha,
      xmlByteLength: remote.data.xmlByteLength ?? Buffer.byteLength(xmlContent, 'utf8'),
      officialNamespace: remote.data.officialNamespace ?? 'http://crd.gov.pl/wzor/',
      fileName: `${safeCodeSlug}_${period}.xml`,
      truthfulnessNoticePl:
        remote.data.truthfulnessNoticePl ??
        'Wygenerowano lokalny plik XML zgodny z urzędową schemą XSD MF. Plik NIE został podpisany ani przesłany do bramki MF (brak numeru UPO).',
    };
  }

  const company = await authorizeCompanyForFallback(session, 'read');
  const [yearStr = '2026', monthStr = '03'] = period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const dateFrom = `${period}-01`;
  const dateTo = lastDayOfPeriodIso(period);
  const generatedAtIso = `${new Date().toISOString().slice(0, 19)}Z`;
  const taxOfficeCode = '1435';
  const subject = buildJpkSubjectFromCompany(company, session.context.email);

  let xmlContent = '';
  let officialNamespace = '';

  switch (input.structureCode) {
    case 'JPK_V7M(3)':
    case 'JPK_V7M(2)':
    case 'JPK_V7K(3)': {
      if (company.vatStatus !== 'czynny') {
        throw new WorkspaceAccessError(
          422,
          'incompatible_tax_regime',
          'Podatnik zwolniony podmiotowo z VAT (art. 113) nie składa rutynowej deklaracji JPK_V7.',
        );
      }
      const vat = await buildVatRegistersForCompany(company, period, session);
      xmlContent = generateJpkV7Xml({
        variant: input.structureCode,
        generatedAtIso,
        purpose,
        taxOfficeCode,
        year,
        month,
        subject,
        salesRows: vat.salesEntries.map((s) => ({
          counterpartyName: s.counterpartyName,
          ...(s.counterpartyNip && s.counterpartyNip !== 'BrakID'
            ? { counterpartyTin: s.counterpartyNip }
            : {}),
          documentNumber: s.documentNumber,
          issueDate: s.issueDate,
          saleDate: s.taxPointDate,
          ksefMarker: mapMarkerForJpkV7(s.ksefMarker, s.ksefReferenceNumber),
          ...(s.vatRate === 'zw' ? { exemptNetGrosze: s.netGrosze } : {}),
          ...(s.vatRate === '0' ? { zeroDomesticNetGrosze: s.netGrosze } : {}),
          ...(s.vatRate === '5'
            ? { net5Grosze: s.netGrosze, vat5Grosze: s.deductibleVatGrosze }
            : {}),
          ...(s.vatRate === '8'
            ? { net8Grosze: s.netGrosze, vat8Grosze: s.deductibleVatGrosze }
            : {}),
          ...(s.vatRate === '23'
            ? { net23Grosze: s.netGrosze, vat23Grosze: s.deductibleVatGrosze }
            : {}),
        })),
        purchaseRows: vat.purchaseEntries.map((p) => ({
          supplierTin: p.counterpartyNip || 'BrakID',
          supplierName: p.counterpartyName,
          documentNumber: p.documentNumber,
          purchaseDate: p.issueDate,
          receiptDate: p.taxPointDate,
          ksefMarker: mapMarkerForJpkV7(p.ksefMarker, p.ksefReferenceNumber),
          otherAcquisitionsNetGrosze: p.netGrosze,
          otherAcquisitionsVatGrosze: p.deductibleVatGrosze,
        })),
        ...(purpose === 2 ? { correctionJustification: 'Korekta ewidencji i deklaracji VAT' } : {}),
      });
      officialNamespace =
        input.structureCode === 'JPK_V7M(2)'
          ? 'http://crd.gov.pl/wzor/2021/12/27/11148/'
          : 'http://crd.gov.pl/wzor/2025/12/19/14090/';
      break;
    }
    case 'JPK_PKPIR(3)': {
      const kpir = await getKpirSnapshot(session);
      if (kpir.entries.length === 0) {
        throw new WorkspaceAccessError(
          422,
          'empty_jpk_register',
          'Struktura JPK_PKPIR(3) wymaga co najmniej jednego zaksięgowanego wiersza w KPiR (LiczbaWierszy >= 1 wg XSD MF).',
        );
      }
      xmlContent = generateJpkPkpir3Xml({
        purpose,
        generatedAtIso,
        dateFrom,
        dateTo,
        taxOfficeCode,
        subject,
        openingInventoryGrosze: 0,
        closingInventoryGrosze: 0,
        rows: kpir.entries.map((e) => ({
          entryDate: e.eventDate,
          documentNumber: e.documentNumber,
          ...(e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
            ? { ksefNumber: e.ksefReferenceNumber }
            : {}),
          ...(e.counterpartyNip ? { counterpartyTin: e.counterpartyNip } : {}),
          counterpartyName: e.counterpartyName,
          counterpartyAddress: e.counterpartyAddress || 'Polska',
          description: e.eventDescription,
          salesRevenueGrosze: e.col7SalesRevenueGrosze,
          otherRevenueGrosze: e.col8OtherRevenueGrosze,
          goodsPurchaseGrosze: e.col10GoodsAndMaterialsGrosze,
          incidentalPurchaseCostsGrosze: e.col11IncidentalCostsGrosze,
          remunerationGrosze: e.col12RemunerationGrosze,
          otherExpensesGrosze: e.col13OtherExpensesGrosze,
          ...(e.col16ResearchDevelopmentCostGrosze > 0
            ? {
                rdCostDescription: 'Koszty działalności badawczo-rozwojowej',
                rdCostGrosze: e.col16ResearchDevelopmentCostGrosze,
              }
            : {}),
        })),
      });
      officialNamespace = 'http://jpk.mf.gov.pl/wzor/2024/10/30/10302/';
      break;
    }
    case 'JPK_EWP(4)': {
      const ryc = await getRyczaltSnapshot(session);
      if (ryc.entries.length === 0) {
        throw new WorkspaceAccessError(
          422,
          'empty_jpk_register',
          'Struktura JPK_EWP(4) wymaga co najmniej jednego wpisu w ewidencji przychodów (LiczbaWierszy >= 1 wg XSD MF).',
        );
      }
      xmlContent = generateJpkEwp4Xml({
        purpose,
        generatedAtIso,
        dateFrom,
        dateTo,
        taxOfficeCode,
        subject,
        rows: ryc.entries.map((e) => ({
          entryDate: e.entryDate,
          revenueDate: e.revenueDate,
          documentNumber: e.documentNumber,
          ...(e.ksefReferenceNumber && validateKsefNumber(e.ksefReferenceNumber).valid
            ? { ksefNumber: e.ksefReferenceNumber }
            : {}),
          ...(e.counterpartyNip ? { counterpartyTin: e.counterpartyNip } : {}),
          revenueGrosze: e.revenueGrosze,
          ratePercent: e.rate,
          ...(e.remarks ? { remarks: e.remarks } : {}),
        })),
      });
      officialNamespace = 'http://jpk.mf.gov.pl/wzor/2024/10/30/10301/';
      break;
    }
    case 'JPK_ST(1)': {
      xmlContent = generateJpkSt1Xml(
        company.profileCode === 'jdg_ryczalt'
          ? {
              purpose,
              generatedAtIso,
              dateFrom,
              dateTo,
              taxOfficeCode,
              subject,
              registerBranch: 'EWP',
              rows: [],
            }
          : {
              purpose,
              generatedAtIso,
              dateFrom,
              dateTo,
              taxOfficeCode,
              subject,
              registerBranch: 'PKPIR',
              rows: [],
            },
      );
      officialNamespace = 'http://jpk.mf.gov.pl/wzor/2024/11/26/11262/';
      break;
    }
    case 'JPK_KR_PD(1)': {
      const ledger = await getFullLedgerSnapshot(session);
      if (ledger.journalEntries.length === 0) {
        throw new WorkspaceAccessError(
          422,
          'empty_jpk_register',
          'Struktura JPK_KR_PD(1) wymaga co najmniej jednego dekretu w Dzienniku ksiąg rachunkowych.',
        );
      }
      const nipCheck = validatePolishNip(company.nip);
      xmlContent = generateJpkKrPd1Xml({
        purpose,
        generatedAtIso,
        dateFrom,
        dateTo,
        financialYearFrom: `${yearStr}-01-01`,
        financialYearTo: `${yearStr}-12-31`,
        taxOfficeCode,
        companyNip: nipCheck.normalizedNip ?? '5250003002',
        companyFullName: company.companyName,
        companyRegon: company.regon,
        address: {
          voivodeship: 'MAZOWIECKIE',
          county: 'WARSZAWA',
          municipality: 'WARSZAWA',
          street: 'WSPÓLNA',
          buildingNumber: '40',
          city: 'WARSZAWA',
          postalCode: '00-684',
        },
        zois7Accounts: ledger.trialBalance.rows.map((row) => ({
          accountId: row.accountCode,
          accountName: row.accountName,
          parentAccountId: row.accountCode.slice(0, 3),
          openingDebitGrosze: 0,
          openingCreditGrosze: 0,
          turnoverPeriodDebitGrosze: row.turnoverWnGrosze,
          turnoverPeriodCreditGrosze: row.turnoverMaGrosze,
          turnoverCumulativeDebitGrosze: row.turnoverWnGrosze,
          turnoverCumulativeCreditGrosze: row.turnoverMaGrosze,
          closingDebitGrosze: row.endingBalanceWnGrosze,
          closingCreditGrosze: row.endingBalanceMaGrosze,
          balanceSheetTagS12_1: 'BAAI1_W',
        })),
        journalEntries: ledger.journalEntries.map((je) => ({
          journalName: 'Dziennik główny',
          documentNumber: je.documentNumber,
          documentKind: 'PK',
          operationDate: je.documentDate,
          documentDate: je.documentDate,
          postingDate: je.bookingDate,
          operatorName: session.context.displayName,
          description: je.description,
          journalAmountGrosze: je.totalWnGrosze,
          postings: je.lines.map((l) => ({
            description: l.description,
            accountId: l.accountCode,
            side: l.side,
            amountGrosze: l.amountGrosze,
          })),
        })),
      });
      officialNamespace = 'http://jpk.mf.gov.pl/wzor/2024/09/04/09041/';
      break;
    }
    case 'JPK_ST_KR(1)': {
      throw new WorkspaceAccessError(
        422,
        'empty_jpk_register',
        'Struktura JPK_ST_KR(1) wymaga co najmniej jednej karty środka trwałego w ewidencji ST_KR (XSD MF nie dopuszcza pustego rejestru środków trwałych).',
      );
    }
  }

  return {
    structureCode: input.structureCode,
    period,
    purpose,
    lifecycleStatus: 'exported_xsd_valid_awaiting_signature',
    submissionStatus: 'local_xml_only_not_submitted',
    officialUpoReferenceNumber: null,
    xmlContent,
    xmlSha256Hex: sha256Utf8(xmlContent),
    xmlByteLength: Buffer.byteLength(xmlContent, 'utf8'),
    officialNamespace,
    fileName: `${safeCodeSlug}_${period}.xml`,
    truthfulnessNoticePl:
      'Wygenerowano plik XML wg urzędowego wzorca MF. Plik ma status lokalnego eksportu do podpisu zewnętrznego — NIE został wysłany do bramki MF i nie posiada numeru UPO.',
  };
}

// ============================================================================
// 4. Eksport e-Faktury FA(3) XML, KSeF 2.0 Sandbox i Archiwum WORM (#82, #99, GLD-09, GLD-10)
// ============================================================================

export async function exportInvoiceFa3XmlMutation(
  session: ActiveWebSession,
  documentId: string,
): Promise<ExportedFa3XmlView> {
  const safeDocId = encodeURIComponent(documentId.trim());
  if (!safeDocId) {
    throw new WorkspaceAccessError(400, 'missing_doc_id', 'Wskaż identyfikator dokumentu.');
  }

  const remote = await callWave2CompanyEndpoint<{
    readonly xmlContent?: string;
    readonly xml?: string;
    readonly xmlSha256Hex?: string;
    readonly officialNamespace?: string;
    readonly targetNamespace?: string;
    readonly documentNumber?: string;
  }>(session, `/invoices/${safeDocId}/fa3-xml`, {
    method: 'POST',
    body: {},
    fallbackErrorPl: 'Nie udało się wygenerować ustrukturyzowanego pliku XML FA(3).',
  });

  if (remote.handledByApi && (remote.data.xmlContent || remote.data.xml)) {
    const xmlContent = (remote.data.xmlContent ?? remote.data.xml)!;
    const docNum = remote.data.documentNumber ?? documentId;
    const safeStem = docNum.replace(/[^A-Za-z0-9_-]/g, '_');
    return {
      documentId,
      documentNumber: docNum,
      schemaVersion: 'FA(3)',
      targetNamespace:
        remote.data.officialNamespace ??
        remote.data.targetNamespace ??
        'http://crd.gov.pl/wzor/2025/06/25/13775/',
      xmlContent,
      xmlSha256Hex: remote.data.xmlSha256Hex ?? sha256Utf8(xmlContent),
      xmlByteLength: Buffer.byteLength(xmlContent, 'utf8'),
      fileName: `FA3_${safeStem}.xml`,
      submissionStatus: 'local_xml_only_not_submitted',
    };
  }

  const detail = await getDocumentDetailSnapshot(session, documentId);
  const doc = detail.document;
  const company = detail.activeCompany;
  const companyNipCheck = validatePolishNip(company.nip);
  const cpNipCheck = doc.counterpartyNip ? validatePolishNip(doc.counterpartyNip) : null;

  const isSales = doc.direction === 'sales';
  const sellerNip = isSales
    ? (companyNipCheck.normalizedNip ?? '5250001003')
    : cpNipCheck?.valid && cpNipCheck.normalizedNip
      ? cpNipCheck.normalizedNip
      : '5250001003';
  const sellerName = isSales ? company.companyName : doc.counterpartyName;
  const sellerAddr = isSales ? company.address : doc.counterpartyAddress || 'Polska';

  const buyerIdentifier = isSales
    ? cpNipCheck?.valid && cpNipCheck.normalizedNip
      ? ({ kind: 'nip', nip: cpNipCheck.normalizedNip } as const)
      : ({ kind: 'brak_id' } as const)
    : ({ kind: 'nip', nip: companyNipCheck.normalizedNip ?? '5250001003' } as const);
  const buyerName = isSales ? doc.counterpartyName : company.companyName;
  const buyerAddr = isSales ? doc.counterpartyAddress || 'Polska' : company.address;

  const sourceLines =
    doc.lines && doc.lines.length > 0
      ? doc.lines
      : [
          {
            lineNumber: 1,
            description: doc.description,
            quantity: '1',
            unit: 'usł.',
            netGrosze: doc.netGrosze,
            vatRate: doc.vatRate,
            vatGrosze: doc.vatGrosze,
            grossGrosze: doc.grossGrosze,
            annex15Item: doc.annex15Item,
          },
        ];

  const hasZwLine = sourceLines.some((l) => l.vatRate === 'zw');
  const isCorr = Boolean(doc.isCorrection) || doc.documentKind === 'correction';

  const generated = generateKsefFaXml({
    schemaVersion: 'FA(3)',
    createdAtIsoUtc: `${new Date().toISOString().slice(0, 19)}Z`,
    seller: {
      nip: sellerNip,
      name: sellerName,
      address: { countryCode: 'PL', addressLine1: sellerAddr },
    },
    buyer: {
      identifier: buyerIdentifier,
      name: buyerName,
      address: { countryCode: 'PL', addressLine1: buyerAddr },
    },
    invoiceNumber: doc.documentNumber,
    issueDate: doc.issueDate,
    saleDate: doc.eventDate,
    dueDate: doc.dueDate,
    invoiceKind: isCorr ? 'KOR' : 'VAT',
    splitPaymentMppP18A: doc.annex15Item && Math.abs(doc.grossGrosze) > 1_500_000,
    ...(hasZwLine ? { vatExemptionLegalBasisP19A: 'art. 113 ust. 1 i 9 ustawy o VAT' } : {}),
    ...(isCorr
      ? {
          correction: {
            reason: doc.correctionReason || 'Korekta faktury',
            correctedInvoices: [
              {
                originalIssueDate: doc.issueDate,
                originalInvoiceNumber: doc.correctedDocumentNumber || `REF-${doc.documentNumber}`,
              },
            ],
          },
        }
      : {}),
    lines: sourceLines.map((l, idx) => ({
      lineNumber: idx + 1,
      description: l.description,
      quantity: l.quantity || '1',
      unit: l.unit || 'szt.',
      netGrosze: l.netGrosze,
      vatRate: l.vatRate,
      vatGrosze: l.vatGrosze,
      annex15Item: l.annex15Item,
    })),
  });

  const safeStem = doc.documentNumber.replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    documentId: doc.documentId,
    documentNumber: doc.documentNumber,
    schemaVersion: 'FA(3)',
    targetNamespace: generated.targetNamespace,
    xmlContent: generated.xml,
    xmlSha256Hex: sha256Utf8(generated.xml),
    xmlByteLength: Buffer.byteLength(generated.xml, 'utf8'),
    fileName: `FA3_${safeStem}.xml`,
    submissionStatus: 'local_xml_only_not_submitted',
  };
}

export async function getKsefSandboxStatusSnapshot(
  session: ActiveWebSession,
): Promise<KsefSandboxStatusSnapshot> {
  const remote = await callWave2CompanyEndpoint<
    Partial<KsefSandboxStatusSnapshot> & {
      readonly truthfulnessNoticePl?: string;
    }
  >(session, '/ksef/status', {
    method: 'GET',
    fallbackErrorPl: 'Nie udało się odczytać statusu adaptera KSeF 2.0 Sandbox.',
  });
  await authorizeCompanyForFallback(session, 'read');

  return {
    defaultEnvironment: remote.handledByApi
      ? (remote.data.defaultEnvironment ?? 'local_mock')
      : 'local_mock',
    productionHostsHardBlocked: true,
    blockedProductionHosts: [
      'ksef.mf.gov.pl',
      'api.ksef.mf.gov.pl',
      'e-deklaracje.mf.gov.pl',
      'pue.zus.pl',
    ],
    officialTestBaseUrl: 'https://api-test.ksef.mf.gov.pl/v2',
    officialDemoBaseUrl: 'https://api-demo.ksef.mf.gov.pl/v2',
    externalMfTestTokenConfigured: false,
    liveExternalE2eStatus: 'NOT_RUN',
    mandatoryReceiveFrom: '2026-02-01',
    mandatoryIssueLargeFrom: '2026-02-01',
    mandatoryIssueStandardFrom: '2026-04-01',
    microExemptionMonthlyGrossLimitPln: 10_000,
    statusSummaryPl:
      (remote.handledByApi
        ? (remote.data.truthfulnessNoticePl ?? remote.data.statusSummaryPl)
        : undefined) ??
      'Bramki produkcyjne MF są sprzętowo zablokowane (HTTP 403). Brak skonfigurowanego zewnętrznego tokenu testowego MF — zewnętrzna sesja online ma status NOT RUN; dostępny jest lokalny symulator kontraktu KSeF 2.0 z walidacją FA(3).',
  };
}

export async function issueToKsefSandboxMutation(
  session: ActiveWebSession,
  input: {
    readonly documentId: string;
    readonly environment: 'test' | 'demo' | 'local_mock';
    readonly confirmHumanSend: boolean;
    readonly targetEndpointUrl?: string;
  },
): Promise<KsefSandboxIssueResult> {
  if (!input.confirmHumanSend) {
    throw new WorkspaceAccessError(
      400,
      'human_confirmation_required',
      'Wysłanie dokumentu do bramki testowej KSeF 2.0 wymaga jawnego potwierdzenia człowieka.',
    );
  }

  if (input.targetEndpointUrl) {
    let parsedHost: string;
    try {
      parsedHost = new URL(input.targetEndpointUrl).hostname.toLowerCase();
    } catch {
      throw new WorkspaceAccessError(
        400,
        'invalid_ksef_endpoint',
        'Nieprawidłowy adres URL punktu końcowego KSeF.',
      );
    }
    if (FORBIDDEN_PRODUCTION_KSEF_HOSTS.has(parsedHost)) {
      throw new WorkspaceAccessError(
        403,
        'ksef_production_endpoint_blocked',
        `Połączenie z produkcyjną bramką rządową (${parsedHost}) jest trwale zablokowane (HTTP 403). Dozwolone są wyłącznie środowiska testowe/demo oraz lokalny mock.`,
      );
    }
  }

  const remote = await callWave2CompanyEndpoint<
    Partial<KsefSandboxIssueResult> & {
      readonly executionMode?: 'remote_mf_sandbox' | 'local_sandbox_mock';
      readonly ksefNumber?: string | null;
      readonly invoiceReferenceNumber?: string;
      readonly invoiceSha256Hex?: string;
      readonly truthfulnessNoticePl?: string;
    }
  >(session, '/ksef/sandbox/issue', {
    method: 'POST',
    body: {
      documentId: input.documentId,
      environment: input.environment,
      ...(input.targetEndpointUrl ? { targetBaseUrl: input.targetEndpointUrl } : {}),
      humanConfirmation: {
        confirmedByHuman: true,
        confirmationNote:
          'Potwierdzam wysłanie faktury do nieprodukcyjnego środowiska KSeF Sandbox',
      },
    },
    fallbackErrorPl: 'Błąd komunikacji z adapterem KSeF 2.0 Sandbox.',
  });

  if (remote.handledByApi) {
    const isRemoteMf = remote.data.executionMode === 'remote_mf_sandbox';
    return {
      documentId: remote.data.documentId ?? input.documentId,
      documentNumber:
        remote.data.documentNumber ?? remote.data.invoiceReferenceNumber ?? input.documentId,
      environment: remote.data.environment ?? input.environment,
      liveExternalSubmitted: remote.data.liveExternalSubmitted ?? isRemoteMf,
      status:
        remote.data.status ??
        (isRemoteMf ? 'mock_simulated_local_only' : 'mock_simulated_local_only'),
      syntheticReferenceNumber:
        remote.data.syntheticReferenceNumber ?? remote.data.ksefNumber ?? null,
      officialUpoReferenceNumber: null,
      fa3XmlSha256Hex: remote.data.fa3XmlSha256Hex ?? remote.data.invoiceSha256Hex ?? '',
      messagePl:
        remote.data.messagePl ??
        remote.data.truthfulnessNoticePl ??
        'Operacja w środowisku testowym KSeF 2.0 zakończona.',
    };
  }

  const company = await authorizeCompanyForFallback(session, 'write');
  const exportedFa3 = await exportInvoiceFa3XmlMutation(session, input.documentId);

  if (input.environment === 'test' || input.environment === 'demo') {
    return {
      documentId: exportedFa3.documentId,
      documentNumber: exportedFa3.documentNumber,
      environment: input.environment,
      liveExternalSubmitted: false,
      status: 'external_token_not_configured',
      syntheticReferenceNumber: null,
      officialUpoReferenceNumber: null,
      fa3XmlSha256Hex: exportedFa3.xmlSha256Hex,
      messagePl: `Zweryfikowano strukturę XML FA(3) (SHA-256: ${exportedFa3.xmlSha256Hex.slice(0, 12)}…), lecz wysyłka zewnętrzna na api-${input.environment}.ksef.mf.gov.pl ma status NOT RUN (brak skonfigurowanego tokenu testowego NIP właściciela).`,
    };
  }

  const nipCheck = validatePolishNip(company.nip);
  const hex12 = exportedFa3.xmlSha256Hex.slice(0, 12).toUpperCase();
  const mockRef = buildSyntheticTestKsefNumber(
    nipCheck.normalizedNip ?? '5250001003',
    `${session.context.period}-20`,
    hex12,
  );

  return {
    documentId: exportedFa3.documentId,
    documentNumber: exportedFa3.documentNumber,
    environment: 'local_mock',
    liveExternalSubmitted: false,
    status: 'mock_simulated_local_only',
    syntheticReferenceNumber: mockRef,
    officialUpoReferenceNumber: null,
    fa3XmlSha256Hex: exportedFa3.xmlSha256Hex,
    messagePl: `Symulacja w lokalnym mocku KSeF 2.0 zakończona (testowy nr składniowy CRC-8: ${mockRef}). Dokument NIE został przesłany do Ministerstwa Finansów i nie posiada urzędowego UPO.`,
  };
}

export async function syncIncomingKsefSandboxMutation(
  session: ActiveWebSession,
  input: { readonly environment: 'test' | 'demo' | 'local_mock' },
): Promise<KsefSandboxSyncResult> {
  const safePeriod = assertSafePeriod(session.context.period);
  const remote = await callWave2CompanyEndpoint<
    Partial<KsefSandboxSyncResult> & {
      readonly executionMode?: 'remote_mf_sandbox' | 'local_sandbox_mock';
      readonly fetchedCount?: number;
      readonly truthfulnessNoticePl?: string;
    }
  >(session, '/ksef/sandbox/sync-incoming', {
    method: 'POST',
    body: {
      fromIso: `${safePeriod}-01T00:00:00Z`,
      toIso: `${lastDayOfPeriodIso(safePeriod)}T23:59:59Z`,
      environment: input.environment,
    },
    fallbackErrorPl: 'Nie udało się wykonać synchronizacji odbioru KSeF 2.0 Sandbox.',
  });
  if (remote.handledByApi) {
    return {
      environment: remote.data.environment ?? input.environment,
      liveExternalConnected:
        remote.data.liveExternalConnected ?? remote.data.executionMode === 'remote_mf_sandbox',
      syncedInvoicesCount: remote.data.syncedInvoicesCount ?? remote.data.fetchedCount ?? 0,
      messagePl:
        remote.data.messagePl ??
        remote.data.truthfulnessNoticePl ??
        'Synchronizacja odbioru KSeF Sandbox zakończona.',
    };
  }

  await authorizeCompanyForFallback(session, 'write');
  if (input.environment !== 'local_mock') {
    return {
      environment: input.environment,
      liveExternalConnected: false,
      syncedInvoicesCount: 0,
      messagePl: `Odbiór faktur zakupowych (Podmiot2) ze środowiska api-${input.environment}.ksef.mf.gov.pl ma status NOT RUN — brak skonfigurowanego tokenu uwierzytelniającego MF.`,
    };
  }

  const docs = await getDocumentsForActiveCompany(session);
  const xmlCount = docs.filter((d) => d.sourceChannel === 'KSeF FA(3) XML').length;
  return {
    environment: 'local_mock',
    liveExternalConnected: false,
    syncedInvoicesCount: xmlCount,
    messagePl: `Sprawdzono lokalną kolejkę odbiorczą Podmiot2 (mock nieprodukcyjny): ${String(xmlCount)} e-faktur XML FA(3) dostępnych do weryfikacji człowieka.`,
  };
}

export async function archiveSourceDocumentWormMutation(
  session: ActiveWebSession,
  input: {
    readonly fileName: string;
    readonly mimeType: string;
    readonly content: string;
  },
): Promise<SourceArchiveWormRecord> {
  const cleanName = input.fileName.trim() || 'zalacznik-zrodlowy.pdf';
  const allowedMimes = new Set([
    'application/xml',
    'text/xml',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'text/csv',
    'application/json',
  ]);
  const rawMime = input.mimeType.trim();
  const cleanMime = allowedMimes.has(rawMime) ? rawMime : 'application/pdf';
  if (!input.content.trim()) {
    throw new WorkspaceAccessError(
      400,
      'empty_archive_payload',
      'Załącznik źródłowy do archiwum WORM nie może być pusty.',
    );
  }
  if (Buffer.byteLength(input.content, 'utf8') > 262_144) {
    throw new WorkspaceAccessError(
      413,
      'payload_too_large',
      formatUserFacingErrorPl({ status: 413, reasonCode: 'payload_too_large' }),
    );
  }

  const remote = await callWave2CompanyEndpoint<
    Partial<SourceArchiveWormRecord> & {
      readonly artifact?: {
        readonly artifactId: string;
        readonly fileName: string;
        readonly mimeType: string;
        readonly sha256Hex: string;
        readonly byteLength: number;
        readonly uploadedAtIso: string;
      };
    }
  >(session, '/source-archive', {
    method: 'POST',
    body: {
      fileName: cleanName,
      declaredMimeType: cleanMime,
      rawTextContent: input.content,
    },
    fallbackErrorPl: 'Nie udało się zapisać załącznika w archiwum źródłowym WORM.',
  });
  if (remote.handledByApi) {
    if (remote.data.artifact) {
      return {
        archiveId: remote.data.artifact.artifactId,
        fileName: remote.data.artifact.fileName,
        mimeType: remote.data.artifact.mimeType,
        sha256Hex: remote.data.artifact.sha256Hex,
        byteLength: remote.data.artifact.byteLength,
        archivedAt: remote.data.artifact.uploadedAtIso,
      };
    }
    return remote.data as SourceArchiveWormRecord;
  }

  const company = await authorizeCompanyForFallback(session, 'write');
  const sha = sha256Utf8(input.content);
  const store = getWave2FallbackStore();
  const compKey = `${company.tenantId}:${company.legalEntityId}`;
  const companyArchive =
    store.wormArchiveByCompany.get(compKey) ?? new Map<string, SourceArchiveWormRecord>();
  if (companyArchive.has(sha)) {
    throw new WorkspaceAccessError(
      409,
      'duplicate_document_sha256',
      formatUserFacingErrorPl({ status: 409, reasonCode: 'duplicate_document_sha256' }),
    );
  }

  const record: SourceArchiveWormRecord = {
    archiveId: `worm-${sha.slice(0, 12)}`,
    fileName: cleanName,
    mimeType: cleanMime,
    sha256Hex: sha,
    byteLength: Buffer.byteLength(input.content, 'utf8'),
    archivedAt: new Date().toISOString(),
  };
  companyArchive.set(sha, record);
  store.wormArchiveByCompany.set(compKey, companyArchive);
  return record;
}
