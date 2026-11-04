import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  POLISH_LEGAL_RULES_REGISTRY,
  STANDARD_SPZOO_CHART_OF_ACCOUNTS,
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
  decideAccountingAccess,
  evaluateVatExemptionLimit,
  formatPlnFromGrosze,
  generateBalanceSheet,
  generateProfitAndLoss,
  generateTaxCalendarObligations,
  generateTrialBalance,
  getKpirColumnLayout,
  legalEntityId as toDomainLegalEntityId,
  parseMt940Statement,
  parsePlnToGrosze,
  parsePolishBankCsv,
  qualifyKpirExpense,
  reconcileBankTransactions,
  summarizeKpirPeriod,
  tenantId as toDomainTenantId,
  userId as toDomainUserId,
  validatePolishNip,
  type BankReconciliationMatch,
  type BankStatementTransaction,
  type CitAdvanceCalculationResult,
  type CompanyAccessGrant,
  type JournalEntry,
  type JpkV7mDeclarationSummary,
  type KpirColumnLayout,
  type KpirEntry,
  type KpirExpenseQualificationKind,
  type KpirPeriodSummary,
  type KpirPitAdvanceResult,
  type LegalRule,
  type MonthlyRyczaltCalculationResult,
  type MonthlyZusContributionsResult,
  type ProfitAndLossReport,
  type RyczaltEntry,
  type RyczaltRateCode,
  type SimplifiedBalanceSheet,
  type TaxCalendarObligation,
  type TaxProfileCode,
  type TenantMembership,
  type TrialBalanceReport,
  type VatDeductionMode,
  type VatExemptionEvaluationResult,
  type VatRateCode,
  type VatRegisterEntry,
} from '@pap/domain';
import { type BffFetchResult, papBffFetch } from './api-url';
import type { ActiveWebSession, PersonaId, SessionContext } from './session';
import {
  AVAILABLE_PERIODS,
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  COMPANY_TENANT_2_ID,
  DEFAULT_ACCOUNTING_PERIOD,
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  PUBLIC_SYNTHETIC_PERSONAS,
  SAMPLE_BANK_CSV,
  TENANT_1_ID,
  TENANT_2_ID,
  type AuditLogEntryRecord,
  type CompanyProfileRecord,
  type CompanyUserGrantRecord,
  type DocumentKind,
  type McpPendingProposalRecord,
  type NotificationFrequency,
  type NotificationOutboxEntry,
  type NotificationPrefsState,
  type PublicPersonaSummary,
  type ReminderStage,
  type SyntheticPersonaDefinition,
  type WorkspaceDocumentRecord,
} from './workspace-types';

export {
  AVAILABLE_PERIODS,
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  COMPANY_TENANT_2_ID,
  DEFAULT_ACCOUNTING_PERIOD,
  PUBLIC_SYNTHETIC_PERSONAS,
  TENANT_1_ID,
  TENANT_2_ID,
  type PublicPersonaSummary,
};

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_RESOURCE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
export const MAX_WORKSPACE_IMPORT_BYTES = 262_144;

export const SYNTHETIC_PERSONAS: readonly SyntheticPersonaDefinition[] = [
  {
    personaId: 'jan-testowy',
    userId: '00000000-0000-4000-8000-000000000101',
    displayName: 'Jan Testowy',
    email: 'jan.testowy@syntetyczny.example',
    roleSummaryPl: 'Właściciel organizacji (Tenant 1) — pełne uprawnienia do 3 firm',
    tenantId: TENANT_1_ID,
    tenantName: 'Grupa Projektowa Jan Testowy (Tenant 1)',
    tenantRole: 'owner',
    defaultLegalEntityId: COMPANY_JDG_KPIR_ID,
    scopes: ['pap:ui:full', 'pap:mcp:read', 'pap:mcp:prepare'],
    descriptionPl:
      'Właściciel 3 syntetycznych podmiotów w Tenant 1: JDG na KPiR + VAT, JDG na ryczałcie (zwolnienie VAT do 240 000 PLN) oraz Sp. z o.o. na pełnych księgach UoR i CIT 9%.',
    syntheticOidcToken: 'pap_synth_oidc_jan_testowy_t1_owner_2026',
  },
  {
    personaId: 'marta-ksiegowa',
    userId: '00000000-0000-4000-8000-000000000102',
    displayName: 'Marta Księgowa',
    email: 'marta.ksiegowa@biuro-syntetyczne.example',
    roleSummaryPl: 'Księgowa z delegowanym grantem (zapis: KPiR i Sp. z o.o., odczyt: Ryczałt)',
    tenantId: TENANT_1_ID,
    tenantName: 'Grupa Projektowa Jan Testowy (Tenant 1)',
    tenantRole: 'accountant',
    defaultLegalEntityId: COMPANY_JDG_KPIR_ID,
    scopes: ['pap:ui:accounting', 'pap:mcp:read', 'pap:mcp:prepare'],
    descriptionPl:
      'Zewnętrzna księgowa z jawnymi grantami podmiotowymi w Tenant 1. Może weryfikować i księgować dokumenty dla firm z grantem write, lecz nie zarządza właścicielskimi grantami organizacji.',
    syntheticOidcToken: 'pap_synth_oidc_marta_ksiegowa_t1_grant_2026',
  },
  {
    personaId: 'piotr-izolacyjny',
    userId: '00000000-0000-4000-8000-000000000201',
    displayName: 'Piotr Izolacyjny',
    email: 'piotr.izolacyjny@tenant2-syntetyczny.example',
    roleSummaryPl: 'Właściciel odrębnego Tenant 2 — izolacja danych między organizacjami',
    tenantId: TENANT_2_ID,
    tenantName: 'Przedsiębiorstwo Piotr Izolacyjny (Tenant 2)',
    tenantRole: 'owner',
    defaultLegalEntityId: COMPANY_TENANT_2_ID,
    scopes: ['pap:ui:full', 'pap:mcp:read', 'pap:mcp:prepare'],
    descriptionPl:
      'Odrębny tenant do weryfikacji twardej izolacji firm. Każda próba odczytu lub zapisu danych podmiotów z Tenant 1 zwraca odmowę dostępu 403 (missing_tenant_membership).',
    syntheticOidcToken: 'pap_synth_oidc_piotr_izolacyjny_t2_owner_2026',
  },
];

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function getPersonaById(personaId: PersonaId): SyntheticPersonaDefinition {
  const found = SYNTHETIC_PERSONAS.find((p) => p.personaId === personaId);
  if (!found) {
    return SYNTHETIC_PERSONAS[0]!;
  }
  return found;
}

export async function listAvailablePersonas(): Promise<readonly PublicPersonaSummary[]> {
  const remote = await papBffFetch<{ personas?: unknown }>('/api/v1/oidc/personas');
  assertApiResponsePermitsFallback(remote);
  if (remote.kind === 'ok' && Array.isArray(remote.data?.personas)) {
    return PUBLIC_SYNTHETIC_PERSONAS;
  }
  return PUBLIC_SYNTHETIC_PERSONAS;
}

export async function issuePersonaSession(
  personaId: PersonaId,
  requestedPeriod: string = DEFAULT_ACCOUNTING_PERIOD,
): Promise<ActiveWebSession> {
  const persona = getPersonaById(personaId);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod)
    ? requestedPeriod
    : DEFAULT_ACCOUNTING_PERIOD;

  let oidcToken = persona.syntheticOidcToken;
  const tokenResp = await papBffFetch<{ accessToken?: string; token?: string }>(
    '/api/v1/oidc/token',
    {
      method: 'POST',
      body: { personaId: persona.personaId, sub: persona.userId },
    },
  );
  assertApiResponsePermitsFallback(tokenResp);
  if (tokenResp.kind === 'ok') {
    const issued = tokenResp.data.accessToken ?? tokenResp.data.token;
    if (typeof issued === 'string' && issued.trim().length >= 16) {
      oidcToken = issued.trim();
    }
  }

  const context: SessionContext = {
    personaId: persona.personaId,
    userId: persona.userId,
    displayName: persona.displayName,
    email: persona.email,
    roleSummaryPl: persona.roleSummaryPl,
    tenantId: persona.tenantId,
    legalEntityId: persona.defaultLegalEntityId,
    period,
  };

  return { oidcToken, context };
}

interface WorkspaceStateStore {
  companies: CompanyProfileRecord[];
  memberships: TenantMembership[];
  grants: CompanyUserGrantRecord[];
  documents: WorkspaceDocumentRecord[];
  kpirEntriesByCompany: Map<string, KpirEntry[]>;
  ryczaltEntriesByCompany: Map<string, RyczaltEntry[]>;
  journalEntriesByCompany: Map<string, JournalEntry[]>;
  bankTransactionsByCompany: Map<string, BankStatementTransaction[]>;
  paidObligationCodesByCompany: Map<string, Set<string>>;
  notificationPrefsByCompany: Map<string, NotificationPrefsState>;
  outboxByCompany: Map<string, NotificationOutboxEntry[]>;
  mcpProposals: McpPendingProposalRecord[];
  auditLog: AuditLogEntryRecord[];
}

function createInitialStore(): WorkspaceStateStore {
  const companies: CompanyProfileRecord[] = [
    {
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      demoCompanyCode: 'demo_jdg_kpir_alfa',
      companyName: 'Pracownia Projektowa Jan Testowy',
      shortName: 'Pracownia Projektowa (KPiR + VAT)',
      nip: '5250001003',
      regon: '142536475',
      address: 'ul. Wspólna 40/12, 00-684 Warszawa',
      iban: 'PL61109010140000071219812874',
      legalForm: 'jdg',
      profileCode: 'jdg_kpir_skala',
      profileLabelPl: 'JDG · KPiR (skala 12%/32%) · VAT czynny',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'duzy_zus',
      voluntarySicknessInsurance: true,
      smallTaxpayer: true,
      activityStartDate: '2022-03-01',
      priorYearGrossSalesGrosze: 48_500_000,
      ytdPriorMonthsRevenueGrosze: 9_800_000,
      ytdPriorMonthsCostsGrosze: 3_150_000,
      grantedActions: ['read', 'write'],
    },
    {
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      demoCompanyCode: 'demo_jdg_ryczalt_beta',
      companyName: 'Studio Kodowania Anna Przykładowa',
      shortName: 'Studio Kodowania (Ryczałt 12% + zw. VAT)',
      nip: '5261040828',
      regon: '381920456',
      address: 'ul. Długa 18/4, 31-146 Kraków',
      iban: 'PL27114020040000300201355387',
      legalForm: 'jdg',
      profileCode: 'jdg_ryczalt',
      profileLabelPl: 'JDG · Ryczałt (12% / 8,5%) · Zwolnienie VAT art. 113',
      vatStatus: 'zwolniony_art_113',
      vatSettlementPeriod: 'not_applicable',
      zusScheme: 'preferencyjny_zus',
      voluntarySicknessInsurance: false,
      smallTaxpayer: true,
      activityStartDate: '2025-02-01',
      priorYearGrossSalesGrosze: 16_400_000,
      ytdPriorMonthsRevenueGrosze: 18_200_000,
      ytdPriorMonthsCostsGrosze: 0,
      grantedActions: ['read', 'write'],
    },
    {
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      demoCompanyCode: 'demo_spzoo_gamma',
      companyName: 'Syntetyczna Technologia Test Sp. z o.o.',
      shortName: 'Syntetyczna Technologia Sp. z o.o. (UoR + CIT 9%)',
      nip: '7010001453',
      regon: '524112233',
      krs: '0000987654',
      address: 'ul. Prosta 70, 00-838 Warszawa',
      iban: 'PL83102010260000140202763118',
      legalForm: 'sp_z_o_o',
      profileCode: 'spzoo_pelne_ksiegi',
      profileLabelPl: 'Sp. z o.o. · Pełne księgi UoR · CIT 9% (mały podatnik)',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'not_applicable',
      voluntarySicknessInsurance: false,
      smallTaxpayer: true,
      activityStartDate: '2021-01-15',
      priorYearGrossSalesGrosze: 142_000_000,
      ytdPriorMonthsRevenueGrosze: 64_000_000,
      ytdPriorMonthsCostsGrosze: 41_000_000,
      grantedActions: ['read', 'write'],
    },
    {
      tenantId: TENANT_2_ID,
      legalEntityId: COMPANY_TENANT_2_ID,
      companyName: 'Hurtownia Syntetyczna Piotr Izolacyjny',
      shortName: 'Hurtownia Syntetyczna (Tenant 2)',
      nip: '6760001238',
      regon: '120987654',
      address: 'ul. Fabryczna 9, 53-609 Wrocław',
      iban: 'PL10105000997603123456789123',
      legalForm: 'jdg',
      profileCode: 'jdg_kpir_liniowy',
      profileLabelPl: 'JDG · KPiR (liniowy 19%) · VAT czynny',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'duzy_zus',
      voluntarySicknessInsurance: true,
      smallTaxpayer: true,
      activityStartDate: '2020-05-10',
      priorYearGrossSalesGrosze: 82_000_000,
      ytdPriorMonthsRevenueGrosze: 21_000_000,
      ytdPriorMonthsCostsGrosze: 11_500_000,
      grantedActions: ['read', 'write'],
    },
  ];

  const memberships: TenantMembership[] = [
    {
      tenantId: toDomainTenantId(TENANT_1_ID),
      userId: toDomainUserId('00000000-0000-4000-8000-000000000101'),
      role: 'tenant_owner',
      status: 'active',
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validUntil: null,
    },
    {
      tenantId: toDomainTenantId(TENANT_1_ID),
      userId: toDomainUserId('00000000-0000-4000-8000-000000000102'),
      role: 'tenant_member',
      status: 'active',
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validUntil: null,
    },
    {
      tenantId: toDomainTenantId(TENANT_2_ID),
      userId: toDomainUserId('00000000-0000-4000-8000-000000000201'),
      role: 'tenant_owner',
      status: 'active',
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validUntil: null,
    },
  ];

  const grants: CompanyUserGrantRecord[] = [
    {
      grantId: 'grant-jan-kpir',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      userId: '00000000-0000-4000-8000-000000000101',
      userDisplayName: 'Jan Testowy',
      userEmail: 'jan.testowy@syntetyczny.example',
      roleLabelPl: 'Właściciel organizacji',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-01-02T08:00:00Z',
    },
    {
      grantId: 'grant-jan-ryczalt',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      userId: '00000000-0000-4000-8000-000000000101',
      userDisplayName: 'Jan Testowy',
      userEmail: 'jan.testowy@syntetyczny.example',
      roleLabelPl: 'Właściciel organizacji',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-01-02T08:00:00Z',
    },
    {
      grantId: 'grant-jan-spzoo',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      userId: '00000000-0000-4000-8000-000000000101',
      userDisplayName: 'Jan Testowy',
      userEmail: 'jan.testowy@syntetyczny.example',
      roleLabelPl: 'Właściciel organizacji',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-01-02T08:00:00Z',
    },
    {
      grantId: 'grant-marta-kpir',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      userId: '00000000-0000-4000-8000-000000000102',
      userDisplayName: 'Marta Księgowa',
      userEmail: 'marta.ksiegowa@biuro-syntetyczne.example',
      roleLabelPl: 'Księgowa prowadząca',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-02-01T09:15:00Z',
    },
    {
      grantId: 'grant-marta-ryczalt',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      userId: '00000000-0000-4000-8000-000000000102',
      userDisplayName: 'Marta Księgowa',
      userEmail: 'marta.ksiegowa@biuro-syntetyczne.example',
      roleLabelPl: 'Księgowa (audyt odczytowy)',
      actions: ['read'],
      status: 'active',
      grantedAt: '2026-02-01T09:20:00Z',
    },
    {
      grantId: 'grant-marta-spzoo',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      userId: '00000000-0000-4000-8000-000000000102',
      userDisplayName: 'Marta Księgowa',
      userEmail: 'marta.ksiegowa@biuro-syntetyczne.example',
      roleLabelPl: 'Główna księgowa Sp. z o.o.',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-02-01T09:25:00Z',
    },
    {
      grantId: 'grant-piotr-t2',
      tenantId: TENANT_2_ID,
      legalEntityId: COMPANY_TENANT_2_ID,
      userId: '00000000-0000-4000-8000-000000000201',
      userDisplayName: 'Piotr Izolacyjny',
      userEmail: 'piotr.izolacyjny@tenant2-syntetyczny.example',
      roleLabelPl: 'Właściciel organizacji (Tenant 2)',
      actions: ['read', 'write'],
      status: 'active',
      grantedAt: '2026-01-10T10:00:00Z',
    },
  ];

  const doc1Raw =
    'Faktura ustrukturyzowana FA(3) FV/2026/10/001 · Nordic Design Polska Sp. z o.o. · Netto 12 000,00 PLN + VAT 23% 2 760,00 PLN = 14 760,00 PLN · KSeF: 5250001003-20261005-A1B2C3-D4E5F6-12';
  const doc2Raw =
    'Faktura zakupu FZ/2026/10/042 · Flota Serwis Syntetyczny Sp. z o.o. · Eksploatacja i paliwo samochodu osobowego o użytku mieszanym · Netto 1 600,00 PLN + VAT 23% 368,00 PLN = 1 968,00 PLN (propozycja AI: 50% VAT / 75% KUP)';
  const doc3Raw =
    'Faktura zakupu FZ/2026/10/051 · Hurtownia Elektroniki B2B Sp. z o.o. · Stacja robocza CAD/BIM (załącznik nr 15, obowiązkowy MPP > 15 000 PLN) · Netto 13 000,00 PLN + VAT 23% 2 990,00 PLN = 15 990,00 PLN';
  const doc4Raw =
    'Faktura sprzedaży bez VAT FS/2026/10/008 · Studio Kodowania Anna Przykładowa -> Klient SaaS Sp. z o.o. · Usługi programistyczne PKWiU 62.01 (stawka ryczałtu 12%) · Kwota 18 500,00 PLN (zwolnienie z VAT art. 113 ust. 1)';
  const doc5Raw =
    'Faktura sprzedaży FV-SP/2026/10/011 · Syntetyczna Technologia Test Sp. z o.o. · Licencja i wdrożenie platformy analitycznej · Netto 30 000,00 PLN + VAT 23% 6 900,00 PLN = 36 900,00 PLN';

  const documents: WorkspaceDocumentRecord[] = [
    {
      documentId: 'doc-kpir-sales-001',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
      status: 'approved_posted',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FV/2026/10/001',
      issueDate: '2026-10-05',
      eventDate: '2026-10-05',
      dueDate: '2026-10-19',
      counterpartyName: 'Nordic Design Polska Sp. z o.o.',
      counterpartyNip: '7792301205',
      counterpartyAddress: 'ul. Grunwaldzka 102, 60-307 Poznań',
      counterpartyIban: 'PL61109010140000071219812874',
      description: 'Projekt koncepcyjny interfejsu systemu ewidencyjnego (GTU_12)',
      vatRate: '23',
      netGrosze: 1_200_000,
      vatGrosze: 276_000,
      grossGrosze: 1_476_000,
      paidAmountGrosze: 0,
      sha256: sha256Hex(doc1Raw),
      isDuplicateSha256: false,
      fileName: 'FA3_FV_2026_10_001.xml',
      mimeLabel: 'application/xml · KSeF FA(3)',
      sourceChannel: 'KSeF FA(3) XML',
      ksefMarker: 'NrKSeF',
      ksefReferenceNumber: '5250001003-20261005-A1B2C3-D4E5F6-12',
      gtuCodes: ['GTU_12'],
      procedureCodes: [],
      annex15Item: false,
      whiteListStatus: 'verified_kas',
      whiteListCheckId: 'KAS-WL-20261005-9821A',
      aiConfidence: 'high',
      aiConfidencePercent: 99,
      aiProposed: {
        documentNumber: 'FV/2026/10/001',
        issueDate: '2026-10-05',
        eventDate: '2026-10-05',
        dueDate: '2026-10-19',
        counterpartyName: 'Nordic Design Polska Sp. z o.o.',
        counterpartyNip: '7792301205',
        netGrosze: 1_200_000,
        vatGrosze: 276_000,
        grossGrosze: 1_476_000,
      },
      expenseQualification: 'none',
      vatDeductionMode: 'full_100',
      rawPreviewText: doc1Raw,
      uploadedAtLabel: '05.10.2026 10:14',
      approvedBy: 'Jan Testowy',
      approvedAt: '2026-10-05T11:00:00Z',
      postedEntryId: 'kpir-2026-10-1',
    },
    {
      documentId: 'doc-kpir-car-042',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
      status: 'ai_proposal',
      documentKind: 'purchase',
      direction: 'purchase',
      documentNumber: 'FZ/2026/10/042',
      issueDate: '2026-10-12',
      eventDate: '2026-10-12',
      dueDate: '2026-10-20',
      counterpartyName: 'Flota Serwis Syntetyczny Sp. z o.o.',
      counterpartyNip: '5213004125',
      counterpartyAddress: 'ul. Puławska 210, 02-670 Warszawa',
      counterpartyIban: 'PL27114020040000300201355387',
      description: 'Paliwo i przegląd eksploatacyjny samochodu osobowego (użytek mieszany)',
      vatRate: '23',
      netGrosze: 160_000,
      vatGrosze: 36_800,
      grossGrosze: 196_800,
      paidAmountGrosze: 0,
      sha256: sha256Hex(doc2Raw),
      isDuplicateSha256: false,
      fileName: 'FZ_2026_10_042_skan_ocr.pdf',
      mimeLabel: 'application/pdf · OCR',
      sourceChannel: 'Skan OCR (syntetyczny)',
      ksefMarker: 'NrKSeF',
      ksefReferenceNumber: '5213004125-20261012-CAR042-77B8C9-05',
      gtuCodes: [],
      procedureCodes: [],
      annex15Item: false,
      whiteListStatus: 'verified_kas',
      whiteListCheckId: 'KAS-WL-20261012-4410C',
      aiConfidence: 'medium',
      aiConfidencePercent: 86,
      aiProposed: {
        documentNumber: 'FZ/2026/10/042',
        issueDate: '2026-10-12',
        eventDate: '2026-10-12',
        dueDate: '2026-10-20',
        counterpartyName: 'Flota Serwis Syntetyczny Sp. z o.o.',
        counterpartyNip: '5213004125',
        netGrosze: 160_000,
        vatGrosze: 36_800,
        grossGrosze: 196_800,
      },
      expenseQualification: 'vehicle_mixed_75_col13',
      vatDeductionMode: 'vehicle_mixed_50',
      rawPreviewText: doc2Raw,
      uploadedAtLabel: '12.10.2026 14:22',
    },
    {
      documentId: 'doc-kpir-mpp-051',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
      status: 'draft',
      documentKind: 'purchase',
      direction: 'purchase',
      documentNumber: 'FZ/2026/10/051',
      issueDate: '2026-10-02',
      eventDate: '2026-10-02',
      dueDate: '2026-10-09',
      counterpartyName: 'Hurtownia Elektroniki B2B Sp. z o.o.',
      counterpartyNip: '6340123555',
      counterpartyAddress: 'ul. Chorzowska 50, 40-121 Katowice',
      counterpartyIban: 'PL99114000000000999988887777',
      description: 'Stacja robocza graficzna CAD (załącznik nr 15 — obowiązkowy MPP)',
      vatRate: '23',
      netGrosze: 1_300_000,
      vatGrosze: 299_000,
      grossGrosze: 1_599_000,
      paidAmountGrosze: 0,
      sha256: sha256Hex(doc3Raw),
      isDuplicateSha256: false,
      fileName: 'FA3_FZ_2026_10_051_OFF.xml',
      mimeLabel: 'application/xml · Tryb offline24 (OFF)',
      sourceChannel: 'KSeF FA(3) XML',
      ksefMarker: 'OFF',
      gtuCodes: ['GTU_06'],
      procedureCodes: ['MPP'],
      annex15Item: true,
      whiteListStatus: 'mismatch_alert',
      aiConfidence: 'low',
      aiConfidencePercent: 68,
      aiProposed: {
        documentNumber: 'FZ/2026/10/051',
        issueDate: '2026-10-02',
        eventDate: '2026-10-02',
        dueDate: '2026-10-09',
        counterpartyName: 'Hurtownia Elektroniki B2B Sp. z o.o.',
        counterpartyNip: '6340123555',
        netGrosze: 1_300_000,
        vatGrosze: 299_000,
        grossGrosze: 1_599_000,
      },
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
      rawPreviewText: doc3Raw,
      uploadedAtLabel: '02.10.2026 16:05',
    },
    {
      documentId: 'doc-ryczalt-008',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      period: '2026-10',
      status: 'approved_posted',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FS/2026/10/008',
      issueDate: '2026-10-08',
      eventDate: '2026-10-08',
      dueDate: '2026-10-22',
      counterpartyName: 'Klient SaaS Polska Sp. z o.o.',
      counterpartyNip: '7792301205',
      counterpartyAddress: 'ul. Mogilska 65, 31-545 Kraków',
      counterpartyIban: 'PL27114020040000300201355387',
      description:
        'Rozwój modułu oprogramowania B2B (PKWiU 62.01 — ryczałt 12%, zw. z VAT art. 113)',
      vatRate: 'zw',
      netGrosze: 1_850_000,
      vatGrosze: 0,
      grossGrosze: 1_850_000,
      paidAmountGrosze: 1_850_000,
      sha256: sha256Hex(doc4Raw),
      isDuplicateSha256: false,
      fileName: 'FS_2026_10_008.xml',
      mimeLabel: 'application/xml · KSeF FA(3)',
      sourceChannel: 'KSeF FA(3) XML',
      ksefMarker: 'NrKSeF',
      ksefReferenceNumber: '5261040828-20261008-RYC008-11C2D3-88',
      gtuCodes: [],
      procedureCodes: [],
      annex15Item: false,
      whiteListStatus: 'not_required',
      aiConfidence: 'high',
      aiConfidencePercent: 98,
      aiProposed: {
        documentNumber: 'FS/2026/10/008',
        issueDate: '2026-10-08',
        eventDate: '2026-10-08',
        dueDate: '2026-10-22',
        counterpartyName: 'Klient SaaS Polska Sp. z o.o.',
        counterpartyNip: '7792301205',
        netGrosze: 1_850_000,
        vatGrosze: 0,
        grossGrosze: 1_850_000,
      },
      expenseQualification: 'none',
      vatDeductionMode: 'none_0',
      rawPreviewText: doc4Raw,
      uploadedAtLabel: '08.10.2026 09:40',
      approvedBy: 'Jan Testowy',
      approvedAt: '2026-10-08T10:00:00Z',
      postedEntryId: 'ryczalt-2026-10-1',
    },
    {
      documentId: 'doc-spzoo-011',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      period: '2026-10',
      status: 'approved_posted',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FV-SP/2026/10/011',
      issueDate: '2026-10-06',
      eventDate: '2026-10-06',
      dueDate: '2026-10-20',
      counterpartyName: 'Przemysł Cyfrowy S.A.',
      counterpartyNip: '5213004125',
      counterpartyAddress: 'al. Jana Pawła II 27, 00-867 Warszawa',
      counterpartyIban: 'PL83102010260000140202763118',
      description: 'Wdrożenie i utrzymanie hurtowni danych (GTU_12)',
      vatRate: '23',
      netGrosze: 3_000_000,
      vatGrosze: 690_000,
      grossGrosze: 3_690_000,
      paidAmountGrosze: 0,
      sha256: sha256Hex(doc5Raw),
      isDuplicateSha256: false,
      fileName: 'FV_SP_2026_10_011.xml',
      mimeLabel: 'application/xml · KSeF FA(3)',
      sourceChannel: 'KSeF FA(3) XML',
      ksefMarker: 'NrKSeF',
      ksefReferenceNumber: '7010001453-20261006-SPZ011-55E6F7-33',
      gtuCodes: ['GTU_12'],
      procedureCodes: [],
      annex15Item: false,
      whiteListStatus: 'verified_kas',
      whiteListCheckId: 'KAS-WL-20261006-7712B',
      aiConfidence: 'high',
      aiConfidencePercent: 99,
      aiProposed: {
        documentNumber: 'FV-SP/2026/10/011',
        issueDate: '2026-10-06',
        eventDate: '2026-10-06',
        dueDate: '2026-10-20',
        counterpartyName: 'Przemysł Cyfrowy S.A.',
        counterpartyNip: '5213004125',
        netGrosze: 3_000_000,
        vatGrosze: 690_000,
        grossGrosze: 3_690_000,
      },
      expenseQualification: 'none',
      vatDeductionMode: 'full_100',
      rawPreviewText: doc5Raw,
      uploadedAtLabel: '06.10.2026 11:05',
      approvedBy: 'Marta Księgowa',
      approvedAt: '2026-10-06T12:15:00Z',
      postedEntryId: 'jrn-2026-10-2',
    },
  ];

  // KPiR initial entries for Pracownia Projektowa Jan Testowy
  const kpirEntriesInitial: KpirEntry[] = [
    createKpirEntry({
      id: 'kpir-2026-10-1',
      ordinalNumber: 1,
      eventDate: '2026-10-05',
      documentNumber: 'FV/2026/10/001',
      ksefReferenceNumber: '5250001003-20261005-A1B2C3-D4E5F6-12',
      counterpartyName: 'Nordic Design Polska Sp. z o.o.',
      counterpartyNip: '7792301205',
      counterpartyAddress: 'ul. Grunwaldzka 102, 60-307 Poznań',
      eventDescription: 'Projekt koncepcyjny interfejsu systemu ewidencyjnego',
      col7SalesRevenueGrosze: 1_200_000,
      qualificationKind: 'none',
    }),
    createKpirEntry({
      id: 'kpir-2026-10-2',
      ordinalNumber: 2,
      eventDate: '2026-10-07',
      documentNumber: 'FZ/2026/10/018',
      ksefReferenceNumber: '5213004125-20261007-LIC018-22D4E6-09',
      counterpartyName: 'Oprogramowanie Graficzne Sp. z o.o.',
      counterpartyNip: '5213004125',
      counterpartyAddress: 'ul. Cybernetyki 19, 02-677 Warszawa',
      eventDescription: 'Subskrypcja narzędzi CAD/UX i hostingu dokumentacji',
      col13OtherExpensesGrosze: 280_000,
      qualificationKind: 'other_expenses_100_col13',
    }),
  ];

  const kpirTenant2Entries: KpirEntry[] = [
    createKpirEntry({
      id: 'kpir-t2-2026-10-1',
      ordinalNumber: 1,
      eventDate: '2026-10-04',
      documentNumber: 'FV-T2/2026/10/001',
      counterpartyName: 'Odbiorca Hurtowy Wrocław Sp. z o.o.',
      counterpartyNip: '5213004125',
      counterpartyAddress: 'ul. Legnicka 55, 54-203 Wrocław',
      eventDescription: 'Sprzedaż partii komponentów magazynowych (Tenant 2)',
      col7SalesRevenueGrosze: 2_400_000,
      qualificationKind: 'none',
    }),
  ];

  // Ryczałt initial entries for Studio Kodowania Anna Przykładowa
  const ryczaltEntriesInitial: RyczaltEntry[] = [
    createRyczaltEntry({
      id: 'ryczalt-2026-10-1',
      ordinalNumber: 1,
      entryDate: '2026-10-08',
      revenueDate: '2026-10-08',
      documentNumber: 'FS/2026/10/008',
      ksefReferenceNumber: '5261040828-20261008-RYC008-11C2D3-88',
      counterpartyName: 'Klient SaaS Polska Sp. z o.o.',
      counterpartyNip: '7792301205',
      rate: '12',
      revenueGrosze: 1_850_000,
      remarks: 'Usługi programistyczne PKWiU 62.01 — stawka 12%',
    }),
    createRyczaltEntry({
      id: 'ryczalt-2026-10-2',
      ordinalNumber: 2,
      entryDate: '2026-10-14',
      revenueDate: '2026-10-14',
      documentNumber: 'FS/2026/10/012',
      counterpartyName: 'Akademia Produktu Sp. z o.o.',
      counterpartyNip: '5213004125',
      rate: '8.5',
      revenueGrosze: 350_000,
      remarks: 'Szkolenie warsztatowe z bezpieczeństwa wytwarzania oprogramowania — stawka 8,5%',
    }),
  ];

  // Full UoR Ledger initial journal entries for Syntetyczna Technologia Test Sp. z o.o.
  const journalEntriesInitial: JournalEntry[] = [
    createValidatedJournalEntry({
      id: 'jrn-2026-10-1',
      entryNumber: 'BO/2026/10/001',
      bookingDate: '2026-10-01',
      documentDate: '2026-10-01',
      documentNumber: 'PK/2026/10/BO',
      description: 'Wkład kapitału zakładowego i środki na rachunku bieżącym Sp. z o.o.',
      lines: [
        {
          accountCode: '130',
          side: 'Wn',
          amountGrosze: 5_000_000,
          description: 'Środki pieniężne na rachunku bieżącym PLN',
        },
        {
          accountCode: '800',
          side: 'Ma',
          amountGrosze: 5_000_000,
          description: 'Kapitał zakładowy wpisany do KRS',
        },
      ],
    }),
    createValidatedJournalEntry({
      id: 'jrn-2026-10-2',
      entryNumber: 'DK/2026/10/002',
      bookingDate: '2026-10-06',
      documentDate: '2026-10-06',
      documentNumber: 'FV-SP/2026/10/011',
      description: 'Sprzedaż usług wdrożeniowych — Przemysł Cyfrowy S.A.',
      lines: [
        {
          accountCode: '201',
          side: 'Wn',
          amountGrosze: 3_690_000,
          description: 'Należność brutto od odbiorcy krajowego',
        },
        {
          accountCode: '700',
          side: 'Ma',
          amountGrosze: 3_000_000,
          description: 'Przychód netto ze sprzedaży usług IT',
        },
        {
          accountCode: '221-1',
          side: 'Ma',
          amountGrosze: 690_000,
          description: 'VAT należny 23%',
        },
      ],
    }),
    createValidatedJournalEntry({
      id: 'jrn-2026-10-3',
      entryNumber: 'DK/2026/10/003',
      bookingDate: '2026-10-10',
      documentDate: '2026-10-10',
      documentNumber: 'FZ-SP/2026/10/004',
      description: 'Zakup usług chmurowych i serwerowych (usługi obce)',
      lines: [
        {
          accountCode: '402',
          side: 'Wn',
          amountGrosze: 900_000,
          description: 'Koszt usług obcych (infrastruktura chmurowa)',
        },
        {
          accountCode: '221-2',
          side: 'Wn',
          amountGrosze: 207_000,
          description: 'VAT naliczony podlegający odliczeniu 23%',
        },
        {
          accountCode: '202',
          side: 'Ma',
          amountGrosze: 1_107_000,
          description: 'Zobowiązanie wobec dostawcy krajowego',
        },
      ],
    }),
  ];

  const kpirEntriesByCompany = new Map<string, KpirEntry[]>([
    [COMPANY_JDG_KPIR_ID, kpirEntriesInitial],
    [COMPANY_TENANT_2_ID, kpirTenant2Entries],
  ]);

  const ryczaltEntriesByCompany = new Map<string, RyczaltEntry[]>([
    [COMPANY_JDG_RYCZALT_ID, ryczaltEntriesInitial],
  ]);

  const journalEntriesByCompany = new Map<string, JournalEntry[]>([
    [COMPANY_SPZOO_ID, journalEntriesInitial],
  ]);

  const bankTransactionsByCompany = new Map<string, BankStatementTransaction[]>([
    [COMPANY_JDG_KPIR_ID, [...parsePolishBankCsv(SAMPLE_BANK_CSV).slice(0, 1)]],
  ]);

  const paidObligationCodesByCompany = new Map<string, Set<string>>();

  const defaultPrefs: NotificationPrefsState = {
    recipientEmail: 'jan.testowy@syntetyczny.example',
    frequency: 'standard',
    optionalRemindersOptedOut: false,
    disabledStages: [],
    updatedAt: '2026-10-01T08:00:00Z',
  };

  const notificationPrefsByCompany = new Map<string, NotificationPrefsState>([
    [COMPANY_JDG_KPIR_ID, defaultPrefs],
    [
      COMPANY_JDG_RYCZALT_ID,
      { ...defaultPrefs, recipientEmail: 'anna.przykladowa@syntetyczny.example' },
    ],
    [COMPANY_SPZOO_ID, { ...defaultPrefs, recipientEmail: 'zarzad@syntetyczna-spzoo.example' }],
    [
      COMPANY_TENANT_2_ID,
      { ...defaultPrefs, recipientEmail: 'piotr.izolacyjny@tenant2-syntetyczny.example' },
    ],
  ]);

  const sampleOutboxEntry: NotificationOutboxEntry = {
    outboxId: '33333333-3333-4333-8333-333333333301',
    deduplicationKey: `${TENANT_1_ID}:${COMPANY_JDG_KPIR_ID}:ZUS_DRA_PAYMENT:2026-10:advance_7d`,
    tenantId: TENANT_1_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    userId: '00000000-0000-4000-8000-000000000101',
    obligationId: '44444444-4444-4444-8444-444444444401',
    stage: 'upcoming_7d',
    scheduledForDate: '2026-11-13',
    status: 'sent',
    retryCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    createdAt: '2026-11-04T08:30:00Z',
    lastUpdatedAt: '2026-11-04T08:30:01Z',
    email: {
      fromAddress: 'powiadomienia@powiadomienia-pap.example',
      fromDisplayName: 'Polish Accounting Platform (Powiadomienia)',
      toAddress: 'jan.testowy@syntetyczny.example',
      subject:
        '[PAP Sandbox] Przypomnienie 7 dni przed terminem: ZUS DRA i składki za 2026-10 (termin 20.11.2026)',
      textBody: [
        'Dzień dobry,',
        '',
        'Przypominamy o zbliżającym się ustawowym terminie rozliczeniowym dla firmy Pracownia Projektowa Jan Testowy (NIP ******1003):',
        '- Obowiązek: Deklaracja ZUS DRA i opłacenie składek przedsiębiorcy za okres 2026-10',
        '- Termin ustawowy: 2026-11-20 (piątek)',
        '- Podstawa prawna: art. 47 ust. 1 pkt 1 ustawy o systemie ubezpieczeń społecznych (https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981370887)',
        '',
        'Wyliczenie w aplikacji ma charakter pomocniczy — przed wykonaniem przelewu zweryfikuj deklarację w ewidencji.',
        '',
        MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
      ].join('\n'),
      htmlBody: `<p>Przypomnienie o terminie <strong>ZUS DRA za 2026-10</strong> (20.11.2026) dla podmiotu NIP <code>******1003</code>.</p><p>Podstawa prawna: <a href="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981370887">art. 47 ust. 1 ustawy o SUS (ISAP)</a>.</p><hr/><p><small>${MANDATORY_AUXILIARY_EMAIL_FOOTER_PL}</small></p>`,
      headers: {
        'Message-ID': '<sandbox-20261104-0001@powiadomienia-pap.example>',
        'MIME-Version': '1.0',
        'Content-Type': 'multipart/alternative; boundary="pap-rfc5322-boundary-01"',
        'Auto-Submitted': 'auto-generated',
        'X-PAP-Environment': 'synthetic-sandbox-mailbox',
        'X-PAP-Legal-Source': 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981370887',
      },
    },
    attempts: [
      {
        attemptNumber: 1,
        attemptedAt: '2026-11-04T08:30:01Z',
        outcome: 'sent',
        providerMessageId: 'sandbox-rfc5322-msg-0001',
        errorCode: null,
        errorMessageRedacted: null,
      },
    ],
  };

  const outboxByCompany = new Map<string, NotificationOutboxEntry[]>([
    [COMPANY_JDG_KPIR_ID, [sampleOutboxEntry]],
  ]);

  const mcpProposalPayload = JSON.stringify({
    invoiceNumber: 'FZ/MCP/2026/10/099',
    counterpartyNip: '5213004125',
    grossGrosze: 147_600,
    suggestedCategory: 'eksploatacja_samochodu_mieszana',
  });

  const mcpProposals: McpPendingProposalRecord[] = [
    {
      proposalId: '55555555-5555-4555-8555-555555555501',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      clientName: 'Claude Desktop (Streamable HTTP · pap:mcp:prepare)',
      toolName: 'prepare_invoice_and_posting_proposal',
      scope: 'pap:mcp:prepare',
      status: 'pending_human_approval',
      createdAt: '2026-11-04T09:10:00Z',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      payloadHash: sha256Hex(mcpProposalPayload),
      direction: 'purchase',
      invoiceNumber: 'FZ/MCP/2026/10/099',
      issueDate: '2026-10-24',
      dueDate: '2026-11-07',
      counterpartyName: 'Stacja Paliw Syntetyczna Sp. z o.o.',
      counterpartyNip: '5213004125',
      description: 'Zakup paliwa i płynu eksploatacyjnego do samochodu osobowego (propozycja MCP)',
      netGrosze: 120_000,
      vatGrosze: 27_600,
      grossGrosze: 147_600,
      suggestedCategory: 'eksploatacja_samochodu_mieszana',
      kupPreviewGrosze: 100_350,
      deductibleVatPreviewGrosze: 13_800,
      promptInjectionSuspected: false,
    },
  ];

  const auditLog: AuditLogEntryRecord[] = [
    {
      auditId: 'aud-001',
      timestamp: '2026-10-05T11:00:00Z',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      actorName: 'Jan Testowy',
      actorRole: 'owner',
      channel: 'UI',
      actionCode: 'DOCUMENT_APPROVED_AND_POSTED',
      summaryPl:
        'Zatwierdzono i zaksięgowano fakturę sprzedaży FV/2026/10/001 do PKPiR (poz. 1) i rejestru VAT sprzedaży.',
      correlationId: 'corr-20261005-001',
    },
    {
      auditId: 'aud-002',
      timestamp: '2026-10-06T12:15:00Z',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      actorName: 'Marta Księgowa',
      actorRole: 'accountant',
      channel: 'UI',
      actionCode: 'JOURNAL_ENTRY_POSTED',
      summaryPl:
        'Zaksięgowano zbilansowany dekret DK/2026/10/002 (Wn 36 900,00 PLN = Ma 36 900,00 PLN) w księdze głównej Sp. z o.o.',
      correlationId: 'corr-20261006-014',
    },
    {
      auditId: 'aud-003',
      timestamp: '2026-11-04T09:10:00Z',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      actorName: 'Jan Testowy (delegacja MCP)',
      actorRole: 'owner',
      channel: 'MCP',
      actionCode: 'MCP_PROPOSAL_PREPARED',
      summaryPl:
        'Utworzono niezatwierdzony szkic propozycji MCP FZ/MCP/2026/10/099 (ledgerPosted=false, oczekiwanie na decyzję człowieka).',
      correlationId: 'corr-20261104-mcp-099',
    },
  ];

  return {
    companies,
    memberships,
    grants,
    documents,
    kpirEntriesByCompany,
    ryczaltEntriesByCompany,
    journalEntriesByCompany,
    bankTransactionsByCompany,
    paidObligationCodesByCompany,
    notificationPrefsByCompany,
    outboxByCompany,
    mcpProposals,
    auditLog,
  };
}

const GLOBAL_STORE_KEY = '__PAP_WEB_SYNTHETIC_WORKSPACE_V1__' as const;

function getStore(): WorkspaceStateStore {
  const globalObj = globalThis as unknown as Record<string, WorkspaceStateStore | undefined>;
  if (!globalObj[GLOBAL_STORE_KEY]) {
    globalObj[GLOBAL_STORE_KEY] = createInitialStore();
  }
  return globalObj[GLOBAL_STORE_KEY]!;
}

export function resetSyntheticWorkspaceForTests(): void {
  const globalObj = globalThis as unknown as Record<string, WorkspaceStateStore | undefined>;
  globalObj[GLOBAL_STORE_KEY] = createInitialStore();
}

const AUTH_EVALUATION_NOW = new Date('2026-10-25T12:00:00Z');

function toDomainGrants(records: readonly CompanyUserGrantRecord[]): CompanyAccessGrant[] {
  return records.flatMap((grant) =>
    grant.actions.map((action) => ({
      grantId: `${grant.grantId}:${action}`,
      tenantId: toDomainTenantId(grant.tenantId),
      legalEntityId: toDomainLegalEntityId(grant.legalEntityId),
      userId: toDomainUserId(grant.userId),
      action,
      validFrom: new Date('2025-01-01T00:00:00Z'),
      validUntil: null,
      revokedAt:
        grant.status === 'revoked' ? new Date(grant.revokedAt ?? '2026-06-01T00:00:00Z') : null,
    })),
  );
}

export class WorkspaceAccessError extends Error {
  public readonly statusCode: number;
  public readonly reasonCode: string;

  public constructor(statusCode: number, reasonCode: string, messagePl: string) {
    super(messagePl);
    this.name = 'WorkspaceAccessError';
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
  }
}

function assertUuidPathParam(value: string, label: string): string {
  if (!STRICT_UUID_REGEX.test(value)) {
    throw new WorkspaceAccessError(
      400,
      'invalid_selector',
      `Nieprawidłowy format UUID parametru ${label}.`,
    );
  }
  return encodeURIComponent(value);
}

function assertSafeResourceIdPathParam(value: string, label: string): string {
  if (!SAFE_RESOURCE_ID_REGEX.test(value)) {
    throw new WorkspaceAccessError(
      400,
      'invalid_selector',
      `Nieprawidłowy identyfikator zasobu (${label}).`,
    );
  }
  return encodeURIComponent(value);
}

function assertIsoCalendarDateOrThrow(value: string, labelPl: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(trimmed);
  if (!match) {
    throw new WorkspaceAccessError(
      400,
      'invalid_date',
      `Nieprawidłowy format daty ${labelPl} (${trimmed || 'pusta'}) — wymagany format RRRR-MM-DD.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(utc.getTime()) ||
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new WorkspaceAccessError(
      400,
      'invalid_date',
      `Nieistniejąca data kalendarzowa ${labelPl} (${trimmed}).`,
    );
  }
  return trimmed;
}

function assertPayloadSizeWithinLimit(raw: string, labelPl: string): void {
  if (Buffer.byteLength(raw, 'utf8') > MAX_WORKSPACE_IMPORT_BYTES) {
    throw new WorkspaceAccessError(
      413,
      'payload_too_large',
      `Rozmiar danych wejściowych (${labelPl}) przekracza maksymalny limit 256 KB.`,
    );
  }
}

function parsePlnToGroszeOrThrow(rawPln: string, labelPl: string): number {
  try {
    return parsePlnToGrosze(rawPln);
  } catch (err) {
    throw new WorkspaceAccessError(
      400,
      'invalid_amount',
      err instanceof Error ? err.message : `Nieprawidłowa kwota PLN w polu ${labelPl}.`,
    );
  }
}

function assertApiResponsePermitsFallback(remote: BffFetchResult<unknown>): void {
  if (remote.kind === 'unauthorized') {
    throw new WorkspaceAccessError(
      401,
      'api_unauthorized',
      'Brak autoryzacji w API (401) — zaloguj się ponownie.',
    );
  }
  if (remote.kind === 'forbidden') {
    throw new WorkspaceAccessError(403, remote.reasonCode ?? 'api_forbidden', remote.message);
  }
  if (remote.kind === 'validation_error') {
    throw new WorkspaceAccessError(
      remote.status,
      remote.reasonCode ?? 'api_validation_error',
      remote.message,
    );
  }
  if (remote.kind === 'not_found' && !remote.routeUnmounted) {
    throw new WorkspaceAccessError(
      404,
      'api_not_found',
      'Wskazany zasób nie został znaleziony w usłudze API (404).',
    );
  }
}

function assertValidSessionIdentity(session: ActiveWebSession | null): ActiveWebSession {
  if (!session) {
    throw new WorkspaceAccessError(
      401,
      'unauthenticated',
      'Sesja wygasła lub użytkownik nie jest zalogowany. Wybierz personę testową na ekranie logowania.',
    );
  }

  if (
    !STRICT_UUID_REGEX.test(session.context.userId) ||
    !STRICT_UUID_REGEX.test(session.context.tenantId) ||
    !STRICT_UUID_REGEX.test(session.context.legalEntityId)
  ) {
    throw new WorkspaceAccessError(
      401,
      'invalid_session_context',
      'Kontekst sesji BFF zawiera nieprawidłowy identyfikator UUID — zaloguj się ponownie.',
    );
  }

  const persona = SYNTHETIC_PERSONAS.find((p) => p.personaId === session.context.personaId);
  if (
    !persona ||
    persona.userId !== session.context.userId ||
    persona.email !== session.context.email
  ) {
    throw new WorkspaceAccessError(
      401,
      'session_identity_mismatch',
      'Tożsamość sesji BFF jest niespójna z kanoniczną personą — zaloguj się ponownie.',
    );
  }

  const token = session.oidcToken.trim();
  if (
    token.length < 16 ||
    SYNTHETIC_PERSONAS.some(
      (other) => other.personaId !== persona.personaId && other.syntheticOidcToken === token,
    )
  ) {
    throw new WorkspaceAccessError(
      401,
      'session_token_mismatch',
      'Token uwierzytelniania nie odpowiada aktywnej personie sesji — zaloguj się ponownie.',
    );
  }

  return session;
}

export function verifySessionAccess(
  session: ActiveWebSession | null,
  targetTenantId: string,
  targetLegalEntityId: string,
  action: 'read' | 'write',
): CompanyProfileRecord {
  const verifiedSession = assertValidSessionIdentity(session);
  assertUuidPathParam(targetTenantId, 'tenantId');
  assertUuidPathParam(targetLegalEntityId, 'legalEntityId');

  const store = getStore();
  session = verifiedSession;

  let decision;
  try {
    const actorId = toDomainUserId(session.context.userId);
    const domainTenant = toDomainTenantId(targetTenantId);
    const domainEntity = toDomainLegalEntityId(targetLegalEntityId);
    const membership =
      store.memberships.find((m) => m.userId === actorId && m.tenantId === domainTenant) ?? null;

    decision = decideAccountingAccess({
      userId: actorId,
      tenantId: domainTenant,
      legalEntityId: domainEntity,
      action,
      membership,
      grants: toDomainGrants(store.grants),
      now: AUTH_EVALUATION_NOW,
    });
  } catch {
    throw new WorkspaceAccessError(
      400,
      'invalid_selector',
      'Nieprawidłowy identyfikator organizacji (tenantId) lub podmiotu prawnego (legalEntityId).',
    );
  }

  if (!decision.allowed) {
    store.auditLog.unshift({
      auditId: `aud-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      tenantId: targetTenantId,
      legalEntityId: targetLegalEntityId,
      actorName: session.context.displayName,
      actorRole: session.context.personaId,
      channel: 'UI',
      actionCode: `ACCESS_DENIED_${decision.reason.toUpperCase()}`,
      summaryPl: `Odmowa dostępu (${action}) dla aktora ${session.context.displayName}: ${decision.reason}.`,
      correlationId: `corr-deny-${randomUUID().slice(0, 8)}`,
    });

    throw new WorkspaceAccessError(
      403,
      decision.reason,
      decision.reason === 'active_membership_required'
        ? 'Odmowa dostępu (403): Twoje konto należy do innej organizacji (tenanta) — twarda izolacja danych między firmami.'
        : 'Odmowa dostępu (403): Brak wymaganego grantu podmiotowego (read/write) do wybranej firmy.',
    );
  }

  const company = store.companies.find(
    (c) => c.tenantId === targetTenantId && c.legalEntityId === targetLegalEntityId,
  );
  if (!company) {
    throw new WorkspaceAccessError(
      404,
      'company_not_found',
      'Nie znaleziono wskazanego podmiotu prawnego w aktywnej organizacji.',
    );
  }

  const activeGrant = store.grants.find(
    (g) =>
      g.tenantId === targetTenantId &&
      g.legalEntityId === targetLegalEntityId &&
      g.userId === session.context.userId &&
      g.status === 'active',
  );

  return {
    ...company,
    grantedActions: activeGrant?.actions ?? ['read'],
  };
}

export function listAccessibleCompaniesForSession(
  session: ActiveWebSession,
): readonly CompanyProfileRecord[] {
  assertValidSessionIdentity(session);
  const store = getStore();
  const domainGrants = toDomainGrants(store.grants);
  const actorId = toDomainUserId(session.context.userId);
  const result: CompanyProfileRecord[] = [];

  for (const company of store.companies) {
    const domainTenant = toDomainTenantId(company.tenantId);
    const domainEntity = toDomainLegalEntityId(company.legalEntityId);
    const membership =
      store.memberships.find((m) => m.userId === actorId && m.tenantId === domainTenant) ?? null;

    const check = decideAccountingAccess({
      userId: actorId,
      tenantId: domainTenant,
      legalEntityId: domainEntity,
      action: 'read',
      membership,
      grants: domainGrants,
      now: AUTH_EVALUATION_NOW,
    });

    if (check.allowed) {
      const writeCheck = decideAccountingAccess({
        userId: actorId,
        tenantId: domainTenant,
        legalEntityId: domainEntity,
        action: 'write',
        membership,
        grants: domainGrants,
        now: AUTH_EVALUATION_NOW,
      });
      result.push({
        ...company,
        grantedActions: writeCheck.allowed ? ['read', 'write'] : ['read'],
      });
    }
  }

  return result;
}

export interface DashboardSnapshot {
  readonly activeCompany: CompanyProfileRecord;
  readonly accessibleCompanies: readonly CompanyProfileRecord[];
  readonly period: string;
  readonly monthlyRevenueGrosze: number;
  readonly monthlyKupCostsGrosze: number;
  readonly outputVatGrosze: number;
  readonly deductibleInputVatGrosze: number;
  readonly estimatedIncomeTaxGrosze: number;
  readonly incomeTaxLabelPl: string;
  readonly estimatedZusGrosze: number;
  readonly pendingDocuments: readonly WorkspaceDocumentRecord[];
  readonly pendingMcpProposals: readonly McpPendingProposalRecord[];
  readonly obligations: readonly (TaxCalendarObligation & { readonly isPaid: boolean })[];
}

export function buildVatRegistersForCompany(
  company: CompanyProfileRecord,
  period: string,
): {
  readonly salesEntries: readonly VatRegisterEntry[];
  readonly purchaseEntries: readonly VatRegisterEntry[];
  readonly jpkSummary: JpkV7mDeclarationSummary;
} {
  const store = getStore();
  const docs = store.documents.filter(
    (d) =>
      d.tenantId === company.tenantId &&
      d.legalEntityId === company.legalEntityId &&
      d.period === period &&
      d.status !== 'archived',
  );

  const allEntries: VatRegisterEntry[] = docs.map((doc) =>
    createVatRegisterEntry({
      id: `vat-${doc.documentId}`,
      registerType: doc.direction,
      period: doc.period,
      taxPointDate: doc.eventDate,
      issueDate: doc.issueDate,
      documentNumber: doc.documentNumber,
      counterpartyName: doc.counterpartyName,
      counterpartyNip: doc.counterpartyNip,
      vatRate: doc.vatRate,
      netGrosze: doc.netGrosze,
      vatTotalGrosze: doc.vatGrosze,
      deductionMode: doc.vatDeductionMode,
      annex15Item: doc.annex15Item,
      ksefMarker: doc.ksefMarker,
      ...(doc.ksefReferenceNumber !== undefined
        ? { ksefReferenceNumber: doc.ksefReferenceNumber }
        : {}),
    }),
  );

  const salesEntries = allEntries.filter((e) => e.registerType === 'sales');
  const purchaseEntries = allEntries.filter((e) => e.registerType === 'purchase');
  const jpkSummary = calculateJpkV7mSummary({
    period,
    entries: allEntries,
  });

  return { salesEntries, purchaseEntries, jpkSummary };
}

export function getDashboardSnapshot(session: ActiveWebSession): DashboardSnapshot {
  const accessibleCompanies = listAccessibleCompaniesForSession(session);
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const period = session.context.period;
  const store = getStore();

  const vatBundle = buildVatRegistersForCompany(activeCompany, period);

  let monthlyRevenueGrosze: number;
  let monthlyKupCostsGrosze: number;
  let estimatedIncomeTaxGrosze: number;
  let incomeTaxLabelPl: string;
  let estimatedZusGrosze: number;

  if (
    activeCompany.profileCode === 'jdg_kpir_skala' ||
    activeCompany.profileCode === 'jdg_kpir_liniowy'
  ) {
    const entries = store.kpirEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
    const summary = summarizeKpirPeriod(entries, period);
    monthlyRevenueGrosze = summary.monthTotals.col9TotalRevenueGrosze;
    monthlyKupCostsGrosze = summary.monthTotals.totalTaxDeductibleCostsGrosze;

    const taxForm = activeCompany.profileCode === 'jdg_kpir_liniowy' ? 'liniowy' : 'skala';
    const zusCalc = calculateMonthlyZusContributions({
      period,
      zusScheme:
        activeCompany.zusScheme === 'not_applicable' ? 'duzy_zus' : activeCompany.zusScheme,
      taxForm,
      voluntarySicknessInsurance: activeCompany.voluntarySicknessInsurance,
      previousMonthIncomeGrosze: Math.max(0, monthlyRevenueGrosze - monthlyKupCostsGrosze),
    });
    estimatedZusGrosze = zusCalc.totalZusToPayGrosze;

    const pitCalc = calculateKpirPitAdvance({
      period,
      taxForm,
      ytdRevenueGrosze: activeCompany.ytdPriorMonthsRevenueGrosze + monthlyRevenueGrosze,
      ytdCostsGrosze: activeCompany.ytdPriorMonthsCostsGrosze + monthlyKupCostsGrosze,
      paidSocialZusYtdGrosze: zusCalc.socialContributionsTotalGrosze * 9,
      paidHealthInsuranceYtdGrosze: zusCalc.healthContributionGrosze * 9,
      previousAdvancesPaidYtdGrosze: 380_000,
    });
    estimatedIncomeTaxGrosze = pitCalc.advanceDueGrosze;
    incomeTaxLabelPl =
      taxForm === 'liniowy' ? 'Zaliczka PIT-5L (19%)' : 'Zaliczka PIT-5 (skala 12%/32%)';
  } else if (activeCompany.profileCode === 'jdg_ryczalt') {
    const entries = store.ryczaltEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
    const zusCalc = calculateMonthlyZusContributions({
      period,
      zusScheme:
        activeCompany.zusScheme === 'not_applicable'
          ? 'preferencyjny_zus'
          : activeCompany.zusScheme,
      taxForm: 'ryczalt',
      voluntarySicknessInsurance: activeCompany.voluntarySicknessInsurance,
      ytdRyczaltRevenueGrosze: activeCompany.ytdPriorMonthsRevenueGrosze,
    });
    estimatedZusGrosze = zusCalc.totalZusToPayGrosze;

    const rycCalc = calculateMonthlyRyczalt({
      period,
      entries,
      paidSocialZusInMonthGrosze: zusCalc.socialContributionsTotalGrosze,
      paidHealthInsuranceInMonthGrosze: zusCalc.healthContributionGrosze,
    });
    monthlyRevenueGrosze = rycCalc.totalNetRevenueGrosze;
    monthlyKupCostsGrosze = 0;
    estimatedIncomeTaxGrosze = rycCalc.taxDueGrosze;
    incomeTaxLabelPl = 'Ryczałt PPE (art. 12)';
  } else {
    const entries = store.journalEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
    const pnl = generateProfitAndLoss(entries);
    monthlyRevenueGrosze = pnl.totalRevenuesGrosze;
    monthlyKupCostsGrosze = pnl.totalOperatingAndFinancialExpensesGrosze;
    const citCalc = calculateCitAdvance({
      period,
      ytdTaxableRevenuesGrosze: activeCompany.ytdPriorMonthsRevenueGrosze + monthlyRevenueGrosze,
      ytdTaxDeductibleCostsGrosze: activeCompany.ytdPriorMonthsCostsGrosze + monthlyKupCostsGrosze,
      smallTaxpayerStatus: activeCompany.smallTaxpayer,
      priorYearGrossSalesGrosze: activeCompany.priorYearGrossSalesGrosze,
      previousAdvancesPaidYtdGrosze: 1_950_000,
    });
    estimatedIncomeTaxGrosze = citCalc.advanceDueGrosze;
    incomeTaxLabelPl = `Zaliczka CIT (${citCalc.appliedRatePct}%)`;
    estimatedZusGrosze = 0;
  }

  const pendingDocuments = store.documents.filter(
    (d) =>
      d.tenantId === activeCompany.tenantId &&
      d.legalEntityId === activeCompany.legalEntityId &&
      (d.status === 'ai_proposal' || d.status === 'draft'),
  );

  const pendingMcpProposals = store.mcpProposals.filter(
    (p) =>
      p.tenantId === activeCompany.tenantId &&
      p.legalEntityId === activeCompany.legalEntityId &&
      p.status === 'pending_human_approval',
  );

  const paidSet = store.paidObligationCodesByCompany.get(activeCompany.legalEntityId) ?? new Set();
  const rawObligations = generateTaxCalendarObligations(
    {
      profileCode: activeCompany.profileCode,
      vatStatus: activeCompany.vatStatus,
      vatSettlementPeriod: activeCompany.vatSettlementPeriod,
      zusApplicable: activeCompany.zusScheme !== 'not_applicable',
      ksefSales2024Above200M: false,
      monthlyB2bGrossSalesGrosze: Math.max(0, monthlyRevenueGrosze),
      ceidgRegisteredBefore2025: true,
      krsRegisteredBefore2025: true,
    },
    period,
  );

  return {
    activeCompany,
    accessibleCompanies,
    period,
    monthlyRevenueGrosze,
    monthlyKupCostsGrosze,
    outputVatGrosze: vatBundle.jpkSummary.outputVatExactGrosze,
    deductibleInputVatGrosze: vatBundle.jpkSummary.inputVatExactGrosze,
    estimatedIncomeTaxGrosze,
    incomeTaxLabelPl,
    estimatedZusGrosze,
    pendingDocuments,
    pendingMcpProposals,
    obligations: rawObligations.map((ob) => ({
      ...ob,
      isPaid: paidSet.has(`${period}:${ob.code}`),
    })),
  };
}

export function getCompaniesManagementSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly accessibleCompanies: readonly CompanyProfileRecord[];
  readonly grants: readonly CompanyUserGrantRecord[];
  readonly auditLog: readonly AuditLogEntryRecord[];
  readonly zusPreview: MonthlyZusContributionsResult | null;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const accessibleCompanies = listAccessibleCompaniesForSession(session);
  const store = getStore();

  const grants = store.grants.filter(
    (g) => g.tenantId === activeCompany.tenantId && g.legalEntityId === activeCompany.legalEntityId,
  );
  const auditLog = store.auditLog.filter((a) => a.tenantId === activeCompany.tenantId);

  let zusPreview: MonthlyZusContributionsResult | null = null;
  if (activeCompany.zusScheme !== 'not_applicable') {
    const taxForm =
      activeCompany.profileCode === 'jdg_ryczalt'
        ? 'ryczalt'
        : activeCompany.profileCode === 'jdg_kpir_liniowy'
          ? 'liniowy'
          : 'skala';
    zusPreview = calculateMonthlyZusContributions({
      period: session.context.period,
      zusScheme: activeCompany.zusScheme,
      taxForm,
      voluntarySicknessInsurance: activeCompany.voluntarySicknessInsurance,
      previousMonthIncomeGrosze: 850_000,
      ytdRyczaltRevenueGrosze: activeCompany.ytdPriorMonthsRevenueGrosze,
    });
  }

  return { activeCompany, accessibleCompanies, grants, auditLog, zusPreview };
}

export function getDocumentsForActiveCompany(
  session: ActiveWebSession,
): readonly WorkspaceDocumentRecord[] {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  return store.documents.filter(
    (d) => d.tenantId === activeCompany.tenantId && d.legalEntityId === activeCompany.legalEntityId,
  );
}

export function getDocumentDetailSnapshot(
  session: ActiveWebSession,
  documentId: string,
): {
  readonly activeCompany: CompanyProfileRecord;
  readonly document: WorkspaceDocumentRecord;
  readonly kupQualification: ReturnType<typeof qualifyKpirExpense> | null;
  readonly vatEntryPreview: VatRegisterEntry;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const document = store.documents.find(
    (d) =>
      d.documentId === documentId &&
      d.tenantId === activeCompany.tenantId &&
      d.legalEntityId === activeCompany.legalEntityId,
  );

  if (!document) {
    throw new WorkspaceAccessError(
      404,
      'document_not_found',
      'Nie znaleziono dokumentu o podanym identyfikatorze w wybranej firmie.',
    );
  }

  const vatEntryPreview = createVatRegisterEntry({
    id: `preview-vat-${document.documentId}`,
    registerType: document.direction,
    period: document.period,
    taxPointDate: document.eventDate,
    issueDate: document.issueDate,
    documentNumber: document.documentNumber,
    counterpartyName: document.counterpartyName,
    counterpartyNip: document.counterpartyNip,
    vatRate: document.vatRate,
    netGrosze: document.netGrosze,
    vatTotalGrosze: document.vatGrosze,
    deductionMode: document.vatDeductionMode,
    annex15Item: document.annex15Item,
    ksefMarker: document.ksefMarker,
    ...(document.ksefReferenceNumber !== undefined
      ? { ksefReferenceNumber: document.ksefReferenceNumber }
      : {}),
  });

  const kupQualification =
    document.direction === 'purchase' && document.expenseQualification !== 'none'
      ? qualifyKpirExpense({
          eventDate: document.eventDate,
          qualificationKind: document.expenseQualification,
          netGrosze: document.netGrosze,
          vatGrosze: document.vatGrosze,
          taxpayerVatActive: activeCompany.vatStatus === 'czynny',
          deductibleVatGrosze: vatEntryPreview.deductibleVatGrosze,
        })
      : null;

  return {
    activeCompany,
    document,
    kupQualification,
    vatEntryPreview,
  };
}

export function getKpirSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly entries: readonly KpirEntry[];
  readonly summary: KpirPeriodSummary;
  readonly layout2026: KpirColumnLayout;
  readonly layout2019: KpirColumnLayout;
  readonly pitSkala: KpirPitAdvanceResult;
  readonly pitLiniowy: KpirPitAdvanceResult;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const entries = store.kpirEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
  const period = session.context.period;
  const summary = summarizeKpirPeriod(entries, period);

  const ytdRev =
    activeCompany.ytdPriorMonthsRevenueGrosze + summary.monthTotals.col9TotalRevenueGrosze;
  const ytdCosts =
    activeCompany.ytdPriorMonthsCostsGrosze + summary.monthTotals.totalTaxDeductibleCostsGrosze;

  const pitSkala = calculateKpirPitAdvance({
    period,
    taxForm: 'skala',
    ytdRevenueGrosze: ytdRev,
    ytdCostsGrosze: ytdCosts,
    paidSocialZusYtdGrosze: 1_450_000,
    paidHealthInsuranceYtdGrosze: 620_000,
    previousAdvancesPaidYtdGrosze: 380_000,
  });

  const pitLiniowy = calculateKpirPitAdvance({
    period,
    taxForm: 'liniowy',
    ytdRevenueGrosze: ytdRev,
    ytdCostsGrosze: ytdCosts,
    paidSocialZusYtdGrosze: 1_450_000,
    paidHealthInsuranceYtdGrosze: 620_000,
    previousAdvancesPaidYtdGrosze: 380_000,
  });

  return {
    activeCompany,
    entries,
    summary,
    layout2026: getKpirColumnLayout('pkpir_2026_ksef'),
    layout2019: getKpirColumnLayout('pkpir_2019_17col'),
    pitSkala,
    pitLiniowy,
  };
}

export function getRyczaltSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly entries: readonly RyczaltEntry[];
  readonly ryczaltSummary: MonthlyRyczaltCalculationResult;
  readonly vatExemption: VatExemptionEvaluationResult;
  readonly zusResult: MonthlyZusContributionsResult;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const entries = store.ryczaltEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
  const period = session.context.period;

  const zusResult = calculateMonthlyZusContributions({
    period,
    zusScheme:
      activeCompany.zusScheme === 'not_applicable' ? 'preferencyjny_zus' : activeCompany.zusScheme,
    taxForm: 'ryczalt',
    voluntarySicknessInsurance: activeCompany.voluntarySicknessInsurance,
    ytdRyczaltRevenueGrosze: activeCompany.ytdPriorMonthsRevenueGrosze,
  });

  const ryczaltSummary = calculateMonthlyRyczalt({
    period,
    entries,
    paidSocialZusInMonthGrosze: zusResult.socialContributionsTotalGrosze,
    paidHealthInsuranceInMonthGrosze: zusResult.healthContributionGrosze,
  });

  const vatExemption = evaluateVatExemptionLimit({
    eventDate: `${period}-28`,
    activityStartDate: activeCompany.activityStartDate,
    cumulativeNetSalesBeforeGrosze: activeCompany.ytdPriorMonthsRevenueGrosze,
    currentTransactionNetGrosze: Math.max(0, ryczaltSummary.totalNetRevenueGrosze),
  });

  return {
    activeCompany,
    entries,
    ryczaltSummary,
    vatExemption,
    zusResult,
  };
}

export function getFullLedgerSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly chartOfAccounts: typeof STANDARD_SPZOO_CHART_OF_ACCOUNTS;
  readonly journalEntries: readonly JournalEntry[];
  readonly trialBalance: TrialBalanceReport;
  readonly balanceSheet: SimplifiedBalanceSheet;
  readonly profitAndLoss: ProfitAndLossReport;
  readonly cit9: CitAdvanceCalculationResult;
  readonly cit19: CitAdvanceCalculationResult;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const journalEntries = store.journalEntriesByCompany.get(activeCompany.legalEntityId) ?? [];
  const trialBalance = generateTrialBalance(journalEntries);
  const profitAndLoss = generateProfitAndLoss(journalEntries);
  const balanceSheet = generateBalanceSheet(journalEntries);
  const period = session.context.period;

  const ytdRev = activeCompany.ytdPriorMonthsRevenueGrosze + profitAndLoss.totalRevenuesGrosze;
  const ytdCosts =
    activeCompany.ytdPriorMonthsCostsGrosze +
    profitAndLoss.totalOperatingAndFinancialExpensesGrosze;

  const cit9 = calculateCitAdvance({
    period,
    ytdTaxableRevenuesGrosze: ytdRev,
    ytdTaxDeductibleCostsGrosze: ytdCosts,
    smallTaxpayerStatus: true,
    priorYearGrossSalesGrosze: 142_000_000,
    previousAdvancesPaidYtdGrosze: 1_950_000,
  });

  const cit19 = calculateCitAdvance({
    period,
    ytdTaxableRevenuesGrosze: ytdRev,
    ytdTaxDeductibleCostsGrosze: ytdCosts,
    smallTaxpayerStatus: false,
    priorYearGrossSalesGrosze: 142_000_000,
    previousAdvancesPaidYtdGrosze: 1_950_000,
  });

  return {
    activeCompany,
    chartOfAccounts: STANDARD_SPZOO_CHART_OF_ACCOUNTS,
    journalEntries,
    trialBalance,
    balanceSheet,
    profitAndLoss,
    cit9,
    cit19,
  };
}

export function getFinanceSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly openDocuments: readonly WorkspaceDocumentRecord[];
  readonly bankTransactions: readonly BankStatementTransaction[];
  readonly reconciliationMatches: readonly BankReconciliationMatch[];
  readonly asOfDate: string;
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const openDocuments = store.documents.filter(
    (d) =>
      d.tenantId === activeCompany.tenantId &&
      d.legalEntityId === activeCompany.legalEntityId &&
      d.status !== 'archived',
  );
  const bankTransactions = store.bankTransactionsByCompany.get(activeCompany.legalEntityId) ?? [];

  const openItems = openDocuments
    .filter((d) => d.grossGrosze - d.paidAmountGrosze > 0)
    .map((d) => ({
      documentId: d.documentId,
      documentNumber: d.documentNumber,
      direction: d.direction,
      counterpartyNip: d.counterpartyNip,
      counterpartyIban: d.counterpartyIban,
      remainingAmountGrosze: Math.max(0, d.grossGrosze - d.paidAmountGrosze),
    }));

  const reconciliationMatches = reconcileBankTransactions(bankTransactions, openItems);

  return {
    activeCompany,
    openDocuments,
    bankTransactions,
    reconciliationMatches,
    asOfDate: '2026-10-25',
  };
}

export function getLegalRulesCatalog(): readonly LegalRule[] {
  return POLISH_LEGAL_RULES_REGISTRY;
}

export function getNotificationsAndMcpSnapshot(session: ActiveWebSession): {
  readonly activeCompany: CompanyProfileRecord;
  readonly preferences: NotificationPrefsState;
  readonly outbox: readonly NotificationOutboxEntry[];
  readonly mcpProposals: readonly McpPendingProposalRecord[];
} {
  const activeCompany = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'read',
  );
  const store = getStore();
  const preferences = store.notificationPrefsByCompany.get(activeCompany.legalEntityId) ?? {
    recipientEmail: session.context.email,
    frequency: 'standard',
    optionalRemindersOptedOut: false,
    disabledStages: [],
    updatedAt: '2026-10-01T08:00:00Z',
  };
  const outbox = store.outboxByCompany.get(activeCompany.legalEntityId) ?? [];
  const mcpProposals = store.mcpProposals.filter(
    (p) => p.tenantId === activeCompany.tenantId && p.legalEntityId === activeCompany.legalEntityId,
  );

  return { activeCompany, preferences, outbox, mcpProposals };
}

// ---------------------------------------------------------------------------
// Mutacje BFF z walidacją, autoryzacją, próbą forwardingu do API i audytem
// ---------------------------------------------------------------------------

function appendAudit(
  session: ActiveWebSession,
  company: CompanyProfileRecord,
  actionCode: string,
  summaryPl: string,
  channel: 'UI' | 'API' | 'MCP' = 'UI',
): void {
  const store = getStore();
  store.auditLog.unshift({
    auditId: `aud-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    tenantId: company.tenantId,
    legalEntityId: company.legalEntityId,
    actorName: session.context.displayName,
    actorRole: session.context.personaId,
    channel,
    actionCode,
    summaryPl,
    correlationId: `corr-${randomUUID().slice(0, 10)}`,
  });
}

export async function createCompanyMutation(
  session: ActiveWebSession,
  input: {
    readonly companyName: string;
    readonly nip: string;
    readonly address: string;
    readonly legalForm: 'jdg' | 'sp_z_o_o';
    readonly profileCode: TaxProfileCode;
    readonly vatStatus: 'czynny' | 'zwolniony_art_113';
  },
): Promise<CompanyProfileRecord> {
  assertValidSessionIdentity(session);
  const safeTenantId = assertUuidPathParam(session.context.tenantId, 'tenantId');
  const store = getStore();
  const actorId = toDomainUserId(session.context.userId);
  const domainTenant = toDomainTenantId(session.context.tenantId);
  const membership = store.memberships.find(
    (m) => m.userId === actorId && m.tenantId === domainTenant && m.status === 'active',
  );
  if (!membership) {
    throw new WorkspaceAccessError(
      403,
      'active_membership_required',
      'Odmowa dostępu (403): Twoje konto nie należy do wskazanej organizacji (tenanta).',
    );
  }
  if (membership.role !== 'tenant_owner' || session.context.personaId === 'marta-ksiegowa') {
    throw new WorkspaceAccessError(
      403,
      'owner_required',
      'Tworzenie nowego podmiotu prawnego w organizacji wymaga roli właściciela (owner).',
    );
  }

  const nipCheck = validatePolishNip(input.nip);
  if (!nipCheck.valid || !nipCheck.normalizedNip) {
    throw new WorkspaceAccessError(
      400,
      'invalid_nip',
      nipCheck.reason ?? 'Nieprawidłowy numer NIP (wymagane 10 cyfr i poprawna suma kontrolna).',
    );
  }

  const nameTrimmed = input.companyName.trim();
  if (nameTrimmed.length < 3) {
    throw new WorkspaceAccessError(
      400,
      'invalid_name',
      'Nazwa firmy musi mieć co najmniej 3 znaki.',
    );
  }

  const remote = await papBffFetch(`/api/v1/tenants/${safeTenantId}/companies`, {
    method: 'POST',
    bearerToken: session.oidcToken,
    body: { ...input, nip: nipCheck.normalizedNip },
  });
  assertApiResponsePermitsFallback(remote);
  const newEntityId = randomUUID();
  const profileLabelMap: Record<TaxProfileCode, string> = {
    jdg_kpir_skala: 'JDG · KPiR (skala 12%/32%)',
    jdg_kpir_liniowy: 'JDG · KPiR (liniowy 19%)',
    jdg_ryczalt: 'JDG · Ryczałt ewidencjonowany',
    spzoo_pelne_ksiegi: 'Sp. z o.o. · Pełne księgi UoR',
  };

  const created: CompanyProfileRecord = {
    tenantId: session.context.tenantId,
    legalEntityId: newEntityId,
    companyName: nameTrimmed,
    shortName: nameTrimmed.slice(0, 32),
    nip: nipCheck.normalizedNip,
    regon: '149998877',
    address: input.address.trim() || 'ul. Syntetyczna 1, 00-001 Warszawa',
    iban: 'PL61109010140000071219812874',
    legalForm: input.legalForm,
    profileCode: input.profileCode,
    profileLabelPl: `${profileLabelMap[input.profileCode]} · ${input.vatStatus === 'czynny' ? 'VAT czynny' : 'Zw. VAT art. 113'}`,
    vatStatus: input.vatStatus,
    vatSettlementPeriod: input.vatStatus === 'czynny' ? 'monthly' : 'not_applicable',
    zusScheme: input.legalForm === 'sp_z_o_o' ? 'not_applicable' : 'preferencyjny_zus',
    voluntarySicknessInsurance: false,
    smallTaxpayer: true,
    activityStartDate: '2026-01-01',
    priorYearGrossSalesGrosze: 0,
    ytdPriorMonthsRevenueGrosze: 0,
    ytdPriorMonthsCostsGrosze: 0,
    grantedActions: ['read', 'write'],
  };

  store.companies.push(created);
  store.grants.push({
    grantId: `grant-${randomUUID().slice(0, 8)}`,
    tenantId: created.tenantId,
    legalEntityId: created.legalEntityId,
    userId: session.context.userId,
    userDisplayName: session.context.displayName,
    userEmail: session.context.email,
    roleLabelPl: 'Właściciel podmiotu',
    actions: ['read', 'write'],
    status: 'active',
    grantedAt: new Date().toISOString(),
  });

  appendAudit(
    session,
    created,
    'COMPANY_CREATED',
    `Utworzono nowy podmiot syntetyczny "${created.companyName}" (NIP ${created.nip}, profil ${created.profileCode}).`,
  );

  return created;
}

export async function updateCompanyTaxSettingsMutation(
  session: ActiveWebSession,
  input: {
    readonly profileCode: TaxProfileCode;
    readonly vatStatus: 'czynny' | 'zwolniony_art_113';
    readonly zusScheme: 'ulga_na_start' | 'preferencyjny_zus' | 'duzy_zus' | 'not_applicable';
    readonly smallTaxpayer: boolean;
  },
): Promise<CompanyProfileRecord> {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );

  const safeTenantId = assertUuidPathParam(company.tenantId, 'tenantId');
  const safeEntityId = assertUuidPathParam(company.legalEntityId, 'legalEntityId');
  const remote = await papBffFetch(
    `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/settings`,
    {
      method: 'PUT',
      bearerToken: session.oidcToken,
      body: input,
    },
  );
  assertApiResponsePermitsFallback(remote);

  const store = getStore();
  const idx = store.companies.findIndex((c) => c.legalEntityId === company.legalEntityId);
  if (idx >= 0) {
    const existing = store.companies[idx]!;
    const updated: CompanyProfileRecord = {
      ...existing,
      profileCode: input.profileCode,
      vatStatus: input.vatStatus,
      vatSettlementPeriod: input.vatStatus === 'czynny' ? 'monthly' : 'not_applicable',
      zusScheme: input.zusScheme,
      smallTaxpayer: input.smallTaxpayer,
    };
    store.companies[idx] = updated;
    appendAudit(
      session,
      updated,
      'TAX_SETTINGS_UPDATED',
      `Zaktualizowano profil podatkowy firmy na ${input.profileCode}, VAT: ${input.vatStatus}, ZUS: ${input.zusScheme}.`,
    );
    return updated;
  }

  return company;
}

export function manageCompanyGrantMutation(
  session: ActiveWebSession,
  input:
    | {
        readonly op: 'grant';
        readonly userEmail: string;
        readonly userDisplayName: string;
        readonly actions: readonly ('read' | 'write')[];
      }
    | {
        readonly op: 'revoke';
        readonly grantId: string;
      },
): void {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  if (session.context.personaId === 'marta-ksiegowa') {
    throw new WorkspaceAccessError(
      403,
      'owner_required',
      'Zarządzanie grantami dostępu do podmiotu wymaga uprawnień właściciela organizacji (ADR-003).',
    );
  }

  const store = getStore();
  if (input.op === 'grant') {
    store.grants.push({
      grantId: `grant-${randomUUID().slice(0, 8)}`,
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      userId: `00000000-0000-4000-8000-${String(Date.now()).slice(-12)}`,
      userDisplayName: input.userDisplayName.trim() || 'Współpracownik księgowy',
      userEmail: input.userEmail.trim() || 'wspolpracownik@syntetyczny.example',
      roleLabelPl: input.actions.includes('write')
        ? 'Księgowy (odczyt i zapis)'
        : 'Audytor (tylko odczyt)',
      actions: input.actions,
      status: 'active',
      grantedAt: new Date().toISOString(),
    });
    appendAudit(
      session,
      company,
      'COMPANY_GRANT_ISSUED',
      `Nadano grant (${input.actions.join('+')}) dla użytkownika ${input.userEmail}.`,
    );
  } else {
    const target = store.grants.find(
      (g) => g.grantId === input.grantId && g.legalEntityId === company.legalEntityId,
    );
    if (target) {
      const idx = store.grants.indexOf(target);
      store.grants[idx] = {
        ...target,
        status: 'revoked',
        revokedAt: new Date().toISOString(),
      };
      appendAudit(
        session,
        company,
        'COMPANY_GRANT_REVOKED',
        `Cofnięto grant dostępu (${target.grantId}) dla ${target.userDisplayName}.`,
      );
    }
  }
}

function extractXmlTag(xml: string, tag: string): string | undefined {
  const rx = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
  return rx.exec(xml)?.[1]?.trim();
}

export async function createOrImportDocumentMutation(
  session: ActiveWebSession,
  input:
    | {
        readonly mode: 'manual';
        readonly documentKind: DocumentKind;
        readonly direction: 'sales' | 'purchase';
        readonly documentNumber: string;
        readonly issueDate: string;
        readonly dueDate: string;
        readonly counterpartyName: string;
        readonly counterpartyNip: string;
        readonly description: string;
        readonly netPln: string;
        readonly vatRate: VatRateCode;
        readonly ksefMarker: 'NrKSeF' | 'OFF' | 'BFK' | 'DI';
        readonly ksefReferenceNumber?: string;
        readonly annex15Item: boolean;
      }
    | {
        readonly mode: 'import_xml_or_csv';
        readonly format: 'fa3_xml' | 'csv' | 'json';
        readonly rawPayload: string;
      },
): Promise<WorkspaceDocumentRecord> {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();

  let docNum: string;
  let direction: 'sales' | 'purchase';
  let docKind: DocumentKind;
  let issueDate: string;
  let dueDate: string;
  let counterpartyName: string;
  let counterpartyNip: string;
  let description: string;
  let netGrosze: number;
  let vatRate: VatRateCode = '23';
  let vatGrosze: number;
  let grossGrosze: number;
  let ksefMarker: 'NrKSeF' | 'OFF' | 'BFK' | 'DI';
  let ksefRef: string | undefined;
  let annex15Item = false;
  let rawText: string;
  let fileName: string;
  let mimeLabel: string;
  let sourceChannel: WorkspaceDocumentRecord['sourceChannel'];

  if (input.mode === 'manual') {
    const nipValidation = validatePolishNip(input.counterpartyNip);
    if (!nipValidation.valid || !nipValidation.normalizedNip) {
      throw new WorkspaceAccessError(
        400,
        'invalid_nip',
        nipValidation.reason ?? 'Nieprawidłowy NIP kontrahenta.',
      );
    }
    docNum = input.documentNumber.trim();
    if (!docNum) {
      throw new WorkspaceAccessError(
        400,
        'missing_doc_number',
        'Podaj numer dokumentu księgowego.',
      );
    }
    direction = input.direction;
    docKind = input.documentKind;
    issueDate = assertIsoCalendarDateOrThrow(input.issueDate, 'wystawienia');
    dueDate = assertIsoCalendarDateOrThrow(input.dueDate, 'płatności');
    counterpartyName = input.counterpartyName.trim() || 'Kontrahent syntetyczny';
    counterpartyNip = nipValidation.normalizedNip;
    description = input.description.trim() || 'Operacja gospodarcza';
    netGrosze = parsePlnToGroszeOrThrow(input.netPln, 'kwota netto');
    if (docKind === 'correction' && netGrosze > 0) {
      netGrosze = -netGrosze;
    }
    vatRate = input.vatRate;
    const calc = calculateInvoiceLineFromNet(netGrosze, vatRate);
    vatGrosze = calc.vatGrosze;
    grossGrosze = calc.grossGrosze;
    ksefMarker = input.ksefMarker;
    ksefRef = input.ksefReferenceNumber?.trim() || undefined;
    annex15Item = input.annex15Item;
    rawText = `${docNum}|${counterpartyNip}|${issueDate}|${String(grossGrosze)}`;
    fileName = `${docNum.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
    mimeLabel = 'application/json · Formularz';
    sourceChannel = 'Formularz ręczny';
  } else {
    assertPayloadSizeWithinLimit(input.rawPayload, 'import dokumentu');
    rawText = input.rawPayload.trim();
    if (!rawText) {
      throw new WorkspaceAccessError(
        400,
        'empty_import',
        'Wklej lub wczytaj treść pliku do importu.',
      );
    }

    if (input.format === 'fa3_xml') {
      docNum = (extractXmlTag(rawText, 'P_2') ?? `FA3/${session.context.period}/IMP`).trim();
      issueDate = assertIsoCalendarDateOrThrow(
        extractXmlTag(rawText, 'P_1') ?? `${session.context.period}-16`,
        'wystawienia (P_1)',
      );
      dueDate = assertIsoCalendarDateOrThrow(
        extractXmlTag(rawText, 'Termin') ?? `${session.context.period}-28`,
        'płatności (Termin)',
      );
      const sellerNipRaw = extractXmlTag(rawText, 'NIP') ?? '5213004125';
      const sellerNipCheck = validatePolishNip(sellerNipRaw);
      if (!sellerNipCheck.valid || !sellerNipCheck.normalizedNip) {
        throw new WorkspaceAccessError(
          400,
          'invalid_nip',
          sellerNipCheck.reason ?? 'Nieprawidłowy NIP sprzedawcy w pliku FA(3) XML.',
        );
      }
      const sellerNip = sellerNipCheck.normalizedNip;
      const sellerName = extractXmlTag(rawText, 'Nazwa') ?? 'Dostawca KSeF FA(3) Sp. z o.o.';
      direction = sellerNip === company.nip ? 'sales' : 'purchase';
      docKind = direction;
      counterpartyNip = sellerNip === company.nip ? '7792301205' : sellerNip;
      counterpartyName = sellerName;
      description =
        extractXmlTag(rawText, 'P_7') ??
        'Pozycja zaimportowana z e-faktury ustrukturyzowanej FA(3)';
      netGrosze = parsePlnToGroszeOrThrow(
        extractXmlTag(rawText, 'P_13_1') ?? '1000.00',
        'P_13_1 (netto)',
      );
      vatGrosze = parsePlnToGroszeOrThrow(
        extractXmlTag(rawText, 'P_14_1') ?? '230.00',
        'P_14_1 (VAT)',
      );
      grossGrosze = parsePlnToGroszeOrThrow(
        extractXmlTag(rawText, 'P_15') ?? '1230.00',
        'P_15 (brutto)',
      );
      vatRate = '23';
      ksefRef = extractXmlTag(rawText, 'NrKSeF');
      ksefMarker = ksefRef ? 'NrKSeF' : 'OFF';
      annex15Item = /<P_18A>\s*1\s*<\/P_18A>/i.test(rawText);
      fileName = `${docNum.replace(/[^A-Za-z0-9_-]/g, '_')}.xml`;
      mimeLabel = 'application/xml · KSeF FA(3)';
      sourceChannel = 'KSeF FA(3) XML';
    } else if (input.format === 'csv') {
      const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const dataRow = (lines.length > 1 ? lines[1] : lines[0]) ?? '';
      const cols = dataRow.split(';').map((c) => c.trim());
      docNum = cols[0] || `CSV/${session.context.period}/01`;
      direction = cols[1] === 'sales' ? 'sales' : 'purchase';
      docKind = direction;
      issueDate = assertIsoCalendarDateOrThrow(
        cols[2] || `${session.context.period}-18`,
        'wystawienia (CSV)',
      );
      dueDate = assertIsoCalendarDateOrThrow(
        cols[3] || `${session.context.period}-28`,
        'płatności (CSV)',
      );
      counterpartyName = cols[4] || 'Kontrahent CSV Sp. z o.o.';
      const csvNipCheck = validatePolishNip(cols[5] || '7792301205');
      if (!csvNipCheck.valid || !csvNipCheck.normalizedNip) {
        throw new WorkspaceAccessError(
          400,
          'invalid_nip',
          csvNipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta w pliku CSV.',
        );
      }
      counterpartyNip = csvNipCheck.normalizedNip;
      description = cols[6] || 'Pozycja z pliku CSV';
      netGrosze = parsePlnToGroszeOrThrow(cols[7] || '1000.00', 'NettoPLN (CSV)');
      vatGrosze = parsePlnToGroszeOrThrow(cols[8] || '230.00', 'VatPLN (CSV)');
      grossGrosze = netGrosze + vatGrosze;
      vatRate = '23';
      ksefRef = cols[10] || undefined;
      ksefMarker = ksefRef ? 'NrKSeF' : 'DI';
      fileName = 'import_dokumentow.csv';
      mimeLabel = 'text/csv · średnik';
      sourceChannel = 'Import CSV';
    } else {
      let parsed: Record<string, unknown>;
      try {
        const candidate: unknown = JSON.parse(rawText);
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
          throw new Error('Wymagany obiekt JSON.');
        }
        parsed = candidate as Record<string, unknown>;
      } catch {
        throw new WorkspaceAccessError(
          400,
          'invalid_json',
          'Nieprawidłowy format JSON dokumentu do importu.',
        );
      }
      docNum = String(parsed['documentNumber'] ?? `JSON/${session.context.period}/01`).trim();
      direction = parsed['direction'] === 'sales' ? 'sales' : 'purchase';
      docKind = direction;
      issueDate = assertIsoCalendarDateOrThrow(
        String(parsed['issueDate'] ?? `${session.context.period}-15`),
        'wystawienia (JSON)',
      );
      dueDate = assertIsoCalendarDateOrThrow(
        String(parsed['dueDate'] ?? `${session.context.period}-28`),
        'płatności (JSON)',
      );
      counterpartyName = String(parsed['counterpartyName'] ?? 'Kontrahent JSON').trim();
      const jsonNipCheck = validatePolishNip(String(parsed['counterpartyNip'] ?? '5213004125'));
      if (!jsonNipCheck.valid || !jsonNipCheck.normalizedNip) {
        throw new WorkspaceAccessError(
          400,
          'invalid_nip',
          jsonNipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta w pliku JSON.',
        );
      }
      counterpartyNip = jsonNipCheck.normalizedNip;
      description = String(parsed['description'] ?? 'Dokument JSON').trim();
      netGrosze = parsePlnToGroszeOrThrow(String(parsed['netPln'] ?? '1000.00'), 'netPln (JSON)');
      const calc = calculateInvoiceLineFromNet(netGrosze, '23');
      vatGrosze = calc.vatGrosze;
      grossGrosze = calc.grossGrosze;
      ksefMarker = 'DI';
      fileName = 'import.json';
      mimeLabel = 'application/json';
      sourceChannel = 'Import CSV';
    }
  }

  const digest = sha256Hex(rawText);
  const isDuplicateSha256 = store.documents.some(
    (existing) => existing.legalEntityId === company.legalEntityId && existing.sha256 === digest,
  );

  const safeTenantId = assertUuidPathParam(company.tenantId, 'tenantId');
  const safeEntityId = assertUuidPathParam(company.legalEntityId, 'legalEntityId');
  const remote = await papBffFetch<{ documentId?: string }>(
    `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/documents`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: {
        documentNumber: docNum,
        sha256: digest,
        direction,
        issueDate,
        dueDate,
        counterpartyName,
        counterpartyNip,
        netGrosze: Math.abs(netGrosze),
        vatRate,
        description,
      },
    },
  );
  if (!(
    remote.kind === 'validation_error' &&
    remote.status === 409 &&
    remote.reasonCode === 'duplicate_document_sha256'
  )) {
    assertApiResponsePermitsFallback(remote);
  }

  const remoteDocumentId =
    remote.kind === 'ok' &&
    typeof remote.data?.documentId === 'string' &&
    SAFE_RESOURCE_ID_REGEX.test(remote.data.documentId)
      ? remote.data.documentId
      : undefined;

  const newDoc: WorkspaceDocumentRecord = {
    documentId: remoteDocumentId ?? `doc-${randomUUID().slice(0, 8)}`,
    tenantId: company.tenantId,
    legalEntityId: company.legalEntityId,
    period: issueDate.slice(0, 7),
    status: 'ai_proposal',
    documentKind: docKind,
    direction,
    documentNumber: docNum,
    issueDate,
    eventDate: issueDate,
    dueDate,
    counterpartyName,
    counterpartyNip,
    counterpartyAddress: 'ul. Syntetyczna 12, 00-100 Warszawa',
    counterpartyIban: 'PL61109010140000071219812874',
    description,
    vatRate,
    netGrosze,
    vatGrosze,
    grossGrosze,
    paidAmountGrosze: 0,
    sha256: digest,
    isDuplicateSha256,
    fileName,
    mimeLabel,
    sourceChannel,
    ksefMarker,
    ...(ksefRef !== undefined ? { ksefReferenceNumber: ksefRef } : {}),
    gtuCodes: direction === 'sales' ? ['GTU_12'] : [],
    procedureCodes: annex15Item ? ['MPP'] : [],
    annex15Item,
    whiteListStatus: 'verified_kas',
    whiteListCheckId: `KAS-WL-${issueDate.replace(/-/g, '')}-AUTO`,
    aiConfidence: isDuplicateSha256 ? 'low' : 'high',
    aiConfidencePercent: isDuplicateSha256 ? 55 : 95,
    aiProposed: {
      documentNumber: docNum,
      issueDate,
      eventDate: issueDate,
      dueDate,
      counterpartyName,
      counterpartyNip,
      netGrosze,
      vatGrosze,
      grossGrosze,
    },
    expenseQualification: direction === 'purchase' ? 'other_expenses_100_col13' : 'none',
    vatDeductionMode: direction === 'purchase' ? 'full_100' : 'full_100',
    rawPreviewText: rawText,
    uploadedAtLabel: new Date().toISOString().slice(0, 16).replace('T', ' '),
  };

  store.documents.unshift(newDoc);
  appendAudit(
    session,
    company,
    'DOCUMENT_INGESTED',
    `Zarejestrowano dokument ${newDoc.documentNumber} (${newDoc.sourceChannel}, SHA-256 ${digest.slice(0, 12)}…${isDuplicateSha256 ? ', wykryto duplikat SHA-256!' : ''}).`,
  );

  return newDoc;
}

export async function approveAndPostDocumentMutation(
  session: ActiveWebSession,
  input: {
    readonly documentId: string;
    readonly documentNumber: string;
    readonly counterpartyName: string;
    readonly counterpartyNip: string;
    readonly issueDate: string;
    readonly netPln: string;
    readonly vatPln: string;
    readonly expenseQualification: KpirExpenseQualificationKind;
    readonly vatDeductionMode: VatDeductionMode;
  },
): Promise<WorkspaceDocumentRecord> {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const safeTenantId = assertUuidPathParam(company.tenantId, 'tenantId');
  const safeEntityId = assertUuidPathParam(company.legalEntityId, 'legalEntityId');
  const safeDocId = assertSafeResourceIdPathParam(input.documentId, 'documentId');
  const validatedIssueDate = assertIsoCalendarDateOrThrow(input.issueDate, 'wystawienia');

  const store = getStore();
  const docIndex = store.documents.findIndex(
    (d) =>
      d.documentId === input.documentId &&
      d.tenantId === company.tenantId &&
      d.legalEntityId === company.legalEntityId,
  );
  if (docIndex < 0) {
    throw new WorkspaceAccessError(404, 'document_not_found', 'Dokument nie istnieje.');
  }

  const nipCheck = validatePolishNip(input.counterpartyNip);
  if (!nipCheck.valid || !nipCheck.normalizedNip) {
    throw new WorkspaceAccessError(
      400,
      'invalid_nip',
      nipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta — popraw przed zatwierdzeniem.',
    );
  }

  const netGrosze = parsePlnToGroszeOrThrow(input.netPln, 'kwota netto');
  const vatGrosze = parsePlnToGroszeOrThrow(input.vatPln, 'kwota VAT');
  const grossGrosze = netGrosze + vatGrosze;

  const current = store.documents[docIndex]!;
  let remoteDocId = safeDocId;
  if (!STRICT_UUID_REGEX.test(safeDocId)) {
    const seedRemote = await papBffFetch<{ documentId?: string }>(
      `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/documents`,
      {
        method: 'POST',
        bearerToken: session.oidcToken,
        body: {
          documentNumber: input.documentNumber.trim(),
          sha256: current.sha256,
          direction: current.direction,
          issueDate: validatedIssueDate,
          dueDate: current.dueDate,
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          netGrosze: Math.abs(netGrosze),
          vatRate: current.vatRate,
          description: current.description,
        },
      },
    );
    if (!(
      seedRemote.kind === 'validation_error' &&
      seedRemote.status === 409 &&
      seedRemote.reasonCode === 'duplicate_document_sha256'
    )) {
      assertApiResponsePermitsFallback(seedRemote);
    }
    if (
      seedRemote.kind === 'ok' &&
      typeof seedRemote.data?.documentId === 'string' &&
      STRICT_UUID_REGEX.test(seedRemote.data.documentId)
    ) {
      remoteDocId = seedRemote.data.documentId;
    }
  }

  const remote = await papBffFetch(
    `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/documents/${remoteDocId}/approve-and-post`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: {
        documentNumber: input.documentNumber.trim(),
        counterpartyName: input.counterpartyName.trim(),
        counterpartyNip: nipCheck.normalizedNip,
        issueDate: validatedIssueDate,
        netPln: (Math.abs(netGrosze) / 100).toFixed(2),
        vatPln: (Math.abs(vatGrosze) / 100).toFixed(2),
        expenseQualification: input.expenseQualification,
        vatDeductionMode: input.vatDeductionMode,
      },
    },
  );
  assertApiResponsePermitsFallback(remote);

  const postedPeriod = validatedIssueDate.slice(0, 7);
  let postedEntryId = current.postedEntryId ?? `post-${randomUUID().slice(0, 8)}`;

  if (current.status !== 'approved_posted') {
    if (company.profileCode === 'jdg_kpir_skala' || company.profileCode === 'jdg_kpir_liniowy') {
      const existingKpir = store.kpirEntriesByCompany.get(company.legalEntityId) ?? [];
      const nextOrdinal = existingKpir.length + 1;
      postedEntryId = `kpir-${postedPeriod}-${String(nextOrdinal)}`;

      if (current.direction === 'sales') {
        const entry = createKpirEntry({
          id: postedEntryId,
          ordinalNumber: nextOrdinal,
          eventDate: validatedIssueDate,
          documentNumber: input.documentNumber.trim(),
          ...(current.ksefReferenceNumber !== undefined
            ? { ksefReferenceNumber: current.ksefReferenceNumber }
            : {}),
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          counterpartyAddress: current.counterpartyAddress,
          eventDescription: current.description,
          col7SalesRevenueGrosze: netGrosze,
          qualificationKind: 'none',
        });
        store.kpirEntriesByCompany.set(company.legalEntityId, [...existingKpir, entry]);
      } else if (input.expenseQualification !== 'none') {
        const vatEntry = createVatRegisterEntry({
          id: `vat-post-${current.documentId}`,
          registerType: 'purchase',
          period: postedPeriod,
          taxPointDate: validatedIssueDate,
          issueDate: validatedIssueDate,
          documentNumber: input.documentNumber.trim(),
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          vatRate: current.vatRate,
          netGrosze,
          vatTotalGrosze: vatGrosze,
          deductionMode: input.vatDeductionMode,
        });

        const qualified = qualifyKpirExpense({
          eventDate: validatedIssueDate,
          qualificationKind: input.expenseQualification,
          netGrosze,
          vatGrosze,
          taxpayerVatActive: company.vatStatus === 'czynny',
          deductibleVatGrosze: vatEntry.deductibleVatGrosze,
        });

        const entry = createKpirEntry({
          id: postedEntryId,
          ordinalNumber: nextOrdinal,
          eventDate: validatedIssueDate,
          documentNumber: input.documentNumber.trim(),
          ...(current.ksefReferenceNumber !== undefined
            ? { ksefReferenceNumber: current.ksefReferenceNumber }
            : {}),
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          counterpartyAddress: current.counterpartyAddress,
          eventDescription: current.description,
          col10GoodsAndMaterialsGrosze: qualified.col10GoodsAndMaterialsGrosze,
          col11IncidentalCostsGrosze: qualified.col11IncidentalCostsGrosze,
          col12RemunerationGrosze: qualified.col12RemunerationGrosze,
          col13OtherExpensesGrosze: qualified.col13OtherExpensesGrosze,
          col16ResearchDevelopmentCostGrosze: qualified.col16ResearchDevelopmentCostGrosze,
          qualificationKind: input.expenseQualification,
        });
        store.kpirEntriesByCompany.set(company.legalEntityId, [...existingKpir, entry]);
      }
    } else if (company.profileCode === 'jdg_ryczalt') {
      if (current.direction === 'sales' && netGrosze > 0) {
        const existingRyczalt = store.ryczaltEntriesByCompany.get(company.legalEntityId) ?? [];
        const nextOrd = existingRyczalt.length + 1;
        postedEntryId = `ryczalt-${postedPeriod}-${String(nextOrd)}`;
        const rycEntry = createRyczaltEntry({
          id: postedEntryId,
          ordinalNumber: nextOrd,
          entryDate: validatedIssueDate,
          revenueDate: validatedIssueDate,
          documentNumber: input.documentNumber.trim(),
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          rate: '12',
          revenueGrosze: netGrosze,
          remarks: current.description,
        });
        store.ryczaltEntriesByCompany.set(company.legalEntityId, [...existingRyczalt, rycEntry]);
      } else {
        postedEntryId = `ryczalt-ewidencja-zakupu-${current.documentId}`;
      }
    } else if (company.profileCode === 'spzoo_pelne_ksiegi' && grossGrosze !== 0) {
      const existingJournal = store.journalEntriesByCompany.get(company.legalEntityId) ?? [];
      const nextNo = existingJournal.length + 1;
      const entryNumber = `DK/${postedPeriod}/${String(nextNo).padStart(3, '0')}`;
      postedEntryId = `jrn-${postedPeriod}-${String(nextNo)}`;
      const isCorrection = grossGrosze < 0;
      const stornoMeta = isCorrection
        ? { isRedStorno: true, stornoReason: 'Faktura korygująca' }
        : {};

      const journalLines: {
        accountCode: string;
        side: 'Wn' | 'Ma';
        amountGrosze: number;
        description: string;
        isRedStorno?: boolean;
        stornoReason?: string;
      }[] = [];

      if (current.direction === 'sales') {
        journalLines.push({
          accountCode: '201',
          side: 'Wn',
          amountGrosze: grossGrosze,
          description: `Należność brutto — ${input.counterpartyName.trim()}`,
          ...stornoMeta,
        });
        if (netGrosze !== 0) {
          journalLines.push({
            accountCode: '700',
            side: 'Ma',
            amountGrosze: netGrosze,
            description: `Przychód netto ze sprzedaży — ${input.documentNumber.trim()}`,
            ...stornoMeta,
          });
        }
        if (vatGrosze !== 0) {
          journalLines.push({
            accountCode: '221-1',
            side: 'Ma',
            amountGrosze: vatGrosze,
            description: `VAT należny — ${input.documentNumber.trim()}`,
            ...stornoMeta,
          });
        }
      } else {
        const vatEntry = createVatRegisterEntry({
          id: `vat-jrn-${current.documentId}`,
          registerType: 'purchase',
          period: postedPeriod,
          taxPointDate: validatedIssueDate,
          issueDate: validatedIssueDate,
          documentNumber: input.documentNumber.trim(),
          counterpartyName: input.counterpartyName.trim(),
          counterpartyNip: nipCheck.normalizedNip,
          vatRate: current.vatRate,
          netGrosze,
          vatTotalGrosze: vatGrosze,
          deductionMode: company.vatStatus === 'czynny' ? input.vatDeductionMode : 'none_0',
        });
        const deductibleVat = company.vatStatus === 'czynny' ? vatEntry.deductibleVatGrosze : 0;
        const costAmount = grossGrosze - deductibleVat;
        const expenseAccount =
          input.expenseQualification === 'goods_and_materials_col10' ? '330' : '402';

        if (costAmount !== 0) {
          journalLines.push({
            accountCode: expenseAccount,
            side: 'Wn',
            amountGrosze: costAmount,
            description: `Koszt rodzajowy — ${current.description}`,
            ...stornoMeta,
          });
        }
        if (deductibleVat !== 0) {
          journalLines.push({
            accountCode: '221-2',
            side: 'Wn',
            amountGrosze: deductibleVat,
            description: `VAT naliczony podlegający odliczeniu — ${input.documentNumber.trim()}`,
            ...stornoMeta,
          });
        }
        journalLines.push({
          accountCode: '202',
          side: 'Ma',
          amountGrosze: grossGrosze,
          description: `Zobowiązanie wobec dostawcy — ${input.counterpartyName.trim()}`,
          ...stornoMeta,
        });
      }

      const journalEntry = createValidatedJournalEntry({
        id: postedEntryId,
        entryNumber,
        bookingDate: validatedIssueDate,
        documentDate: validatedIssueDate,
        documentNumber: input.documentNumber.trim(),
        description: `${current.description} (${input.counterpartyName.trim()})`,
        lines: journalLines,
      });
      store.journalEntriesByCompany.set(company.legalEntityId, [...existingJournal, journalEntry]);
    }
  }

  const updated: WorkspaceDocumentRecord = {
    ...current,
    period: postedPeriod,
    status: 'approved_posted',
    documentNumber: input.documentNumber.trim(),
    counterpartyName: input.counterpartyName.trim(),
    counterpartyNip: nipCheck.normalizedNip,
    issueDate: validatedIssueDate,
    eventDate: validatedIssueDate,
    netGrosze,
    vatGrosze,
    grossGrosze,
    expenseQualification: input.expenseQualification,
    vatDeductionMode: input.vatDeductionMode,
    approvedBy: session.context.displayName,
    approvedAt: new Date().toISOString(),
    postedEntryId,
  };

  store.documents[docIndex] = updated;
  appendAudit(
    session,
    company,
    'DOCUMENT_APPROVED_AND_POSTED',
    `Człowiek (${session.context.displayName}) zatwierdził i zaksięgował dokument ${updated.documentNumber} na kwotę brutto ${formatPlnFromGrosze(updated.grossGrosze)} (ref: ${postedEntryId}).`,
  );

  return updated;
}

export function addManualKpirEntryMutation(
  session: ActiveWebSession,
  input:
    | {
        readonly mode: 'entry';
        readonly eventDate: string;
        readonly documentNumber: string;
        readonly ksefReferenceNumber?: string;
        readonly counterpartyName: string;
        readonly counterpartyNip: string;
        readonly counterpartyAddress: string;
        readonly eventDescription: string;
        readonly salesPln: string;
        readonly otherExpensesPln: string;
      }
    | {
        readonly mode: 'storno';
        readonly targetEntryId: string;
        readonly correctionDate: string;
        readonly correctionDocumentNumber: string;
        readonly correctionReason: string;
      },
): KpirEntry {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();
  const currentList = store.kpirEntriesByCompany.get(company.legalEntityId) ?? [];
  const nextOrdinal = currentList.length + 1;

  if (input.mode === 'storno') {
    const original = currentList.find((e) => e.id === input.targetEntryId);
    if (!original) {
      throw new WorkspaceAccessError(
        404,
        'entry_not_found',
        'Nie znaleziono korygowanego wpisu KPiR.',
      );
    }
    let storno: KpirEntry;
    try {
      storno = createKpirStornoEntry({
        id: `kpir-storno-${String(nextOrdinal)}`,
        ordinalNumber: nextOrdinal,
        correctionDate: assertIsoCalendarDateOrThrow(input.correctionDate, 'korekty (storno)'),
        originalEntry: original,
        correctionDocumentNumber:
          input.correctionDocumentNumber.trim() || `KOR/${original.documentNumber}`,
        correctionReason: input.correctionReason.trim(),
      });
    } catch (err) {
      if (err instanceof WorkspaceAccessError) {
        throw err;
      }
      throw new WorkspaceAccessError(
        400,
        'kpir_storno_validation_error',
        err instanceof Error ? err.message : 'Błąd walidacji storna KPiR.',
      );
    }
    store.kpirEntriesByCompany.set(company.legalEntityId, [...currentList, storno]);
    appendAudit(
      session,
      company,
      'KPIR_STORNO_POSTED',
      `Utworzono czerwone storno KPiR poz. ${String(storno.ordinalNumber)} do wpisu poz. ${String(original.ordinalNumber)} (${input.correctionReason}).`,
    );
    return storno;
  }

  let created: KpirEntry;
  try {
    const validatedDate = assertIsoCalendarDateOrThrow(input.eventDate, 'zdarzenia gospodarczego');
    const salesGrosze = parsePlnToGroszeOrThrow(input.salesPln || '0.00', 'przychód KPiR');
    const expensesGrosze = parsePlnToGroszeOrThrow(
      input.otherExpensesPln || '0.00',
      'pozostałe wydatki KPiR',
    );
    let normalizedNip: string | undefined;
    if (input.counterpartyNip.trim()) {
      const nipCheck = validatePolishNip(input.counterpartyNip.trim());
      if (!nipCheck.valid || !nipCheck.normalizedNip) {
        throw new WorkspaceAccessError(
          400,
          'invalid_nip',
          nipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta we wpisie KPiR.',
        );
      }
      normalizedNip = nipCheck.normalizedNip;
    }

    created = createKpirEntry({
      id: `kpir-manual-${String(nextOrdinal)}`,
      ordinalNumber: nextOrdinal,
      eventDate: validatedDate,
      documentNumber: input.documentNumber.trim(),
      ...(input.ksefReferenceNumber?.trim()
        ? { ksefReferenceNumber: input.ksefReferenceNumber.trim() }
        : {}),
      counterpartyName: input.counterpartyName.trim(),
      ...(normalizedNip !== undefined ? { counterpartyNip: normalizedNip } : {}),
      counterpartyAddress: input.counterpartyAddress.trim() || 'Polska',
      eventDescription: input.eventDescription.trim(),
      col7SalesRevenueGrosze: salesGrosze,
      col13OtherExpensesGrosze: expensesGrosze,
      qualificationKind: expensesGrosze > 0 ? 'other_expenses_100_col13' : 'none',
    });
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      throw err;
    }
    throw new WorkspaceAccessError(
      400,
      'kpir_entry_validation_error',
      err instanceof Error ? err.message : 'Błąd walidacji wpisu KPiR.',
    );
  }

  store.kpirEntriesByCompany.set(company.legalEntityId, [...currentList, created]);
  appendAudit(
    session,
    company,
    'KPIR_MANUAL_ENTRY_POSTED',
    `Dodano wpis ręczny KPiR poz. ${String(created.ordinalNumber)} (${created.documentNumber}).`,
  );
  return created;
}

export function addRyczaltEntryMutation(
  session: ActiveWebSession,
  input: {
    readonly revenueDate: string;
    readonly documentNumber: string;
    readonly counterpartyName: string;
    readonly counterpartyNip?: string;
    readonly rate: RyczaltRateCode;
    readonly revenuePln: string;
    readonly remarks?: string;
  },
): RyczaltEntry {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();
  const list = store.ryczaltEntriesByCompany.get(company.legalEntityId) ?? [];
  const nextOrd = list.length + 1;

  let entry: RyczaltEntry;
  try {
    const validatedDate = assertIsoCalendarDateOrThrow(input.revenueDate, 'przychodu (ryczałt)');
    let normalizedNip: string | undefined;
    if (input.counterpartyNip?.trim()) {
      const nipCheck = validatePolishNip(input.counterpartyNip.trim());
      if (!nipCheck.valid || !nipCheck.normalizedNip) {
        throw new WorkspaceAccessError(
          400,
          'invalid_nip',
          nipCheck.reason ?? 'Nieprawidłowy NIP kontrahenta we wpisie ryczałtu.',
        );
      }
      normalizedNip = nipCheck.normalizedNip;
    }

    entry = createRyczaltEntry({
      id: `ryczalt-${String(nextOrd)}`,
      ordinalNumber: nextOrd,
      entryDate: validatedDate,
      revenueDate: validatedDate,
      documentNumber: input.documentNumber.trim(),
      counterpartyName: input.counterpartyName.trim(),
      ...(normalizedNip !== undefined ? { counterpartyNip: normalizedNip } : {}),
      rate: input.rate,
      revenueGrosze: parsePlnToGroszeOrThrow(input.revenuePln, 'przychód ryczałtowy'),
      ...(input.remarks?.trim() ? { remarks: input.remarks.trim() } : {}),
    });
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      throw err;
    }
    throw new WorkspaceAccessError(
      400,
      'ryczalt_entry_validation_error',
      err instanceof Error ? err.message : 'Błąd walidacji wpisu ewidencji ryczałtu.',
    );
  }

  store.ryczaltEntriesByCompany.set(company.legalEntityId, [...list, entry]);
  appendAudit(
    session,
    company,
    'RYCZALT_ENTRY_POSTED',
    `Dodano przychód ${entry.revenueFormatted} w stawce ryczałtu ${entry.rate}% (${entry.documentNumber}).`,
  );
  return entry;
}

export function addJournalEntryMutation(
  session: ActiveWebSession,
  input: {
    readonly bookingDate: string;
    readonly documentNumber: string;
    readonly description: string;
    readonly lines: readonly {
      readonly accountCode: string;
      readonly side: 'Wn' | 'Ma';
      readonly amountPln: string;
      readonly description: string;
    }[];
  },
): JournalEntry {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();
  const list = store.journalEntriesByCompany.get(company.legalEntityId) ?? [];
  const nextNo = list.length + 1;

  let entry: JournalEntry;
  try {
    entry = createValidatedJournalEntry({
      id: `jrn-${String(nextNo)}-${randomUUID().slice(0, 6)}`,
      entryNumber: `DK/${input.bookingDate.slice(0, 7)}/${String(nextNo).padStart(3, '0')}`,
      bookingDate: input.bookingDate,
      documentDate: input.bookingDate,
      documentNumber: input.documentNumber.trim(),
      description: input.description.trim(),
      lines: input.lines.map((l) => ({
        accountCode: l.accountCode.trim(),
        side: l.side,
        amountGrosze: parsePlnToGrosze(l.amountPln),
        description: l.description.trim() || input.description.trim(),
      })),
    });
  } catch (err) {
    throw new WorkspaceAccessError(
      400,
      'double_entry_violation',
      err instanceof Error ? err.message : 'Błąd walidacji podwójnego zapisu Wn = Ma.',
    );
  }

  store.journalEntriesByCompany.set(company.legalEntityId, [...list, entry]);
  appendAudit(
    session,
    company,
    'JOURNAL_ENTRY_POSTED',
    `Zaksięgowano dekret ${entry.entryNumber} na kwotę Wn = Ma = ${formatPlnFromGrosze(entry.totalWnGrosze)}.`,
  );
  return entry;
}

export async function importAndReconcileBankStatementMutation(
  session: ActiveWebSession,
  input: {
    readonly format: 'csv' | 'mt940';
    readonly content: string;
    readonly applySettlements: boolean;
  },
): Promise<{
  readonly importedCount: number;
  readonly matchedCount: number;
}> {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );

  assertPayloadSizeWithinLimit(input.content, 'wyciąg bankowy');
  const safeTenantId = assertUuidPathParam(company.tenantId, 'tenantId');
  const safeEntityId = assertUuidPathParam(company.legalEntityId, 'legalEntityId');

  let parsedTx: readonly BankStatementTransaction[];
  try {
    parsedTx =
      input.format === 'mt940'
        ? parseMt940Statement(input.content).transactions
        : parsePolishBankCsv(input.content);
  } catch (err) {
    throw new WorkspaceAccessError(
      400,
      'invalid_bank_statement',
      err instanceof Error ? err.message : 'Nie udało się sparsować wyciągu bankowego.',
    );
  }

  const importRemote = await papBffFetch(
    `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/finance/bank-import`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: { ...input, applySettlements: false },
    },
  );
  assertApiResponsePermitsFallback(importRemote);

  const store = getStore();
  const companyDocs = store.documents.filter(
    (d) => d.tenantId === company.tenantId && d.legalEntityId === company.legalEntityId,
  );
  const openItems = companyDocs
    .filter((d) => d.grossGrosze - d.paidAmountGrosze > 0)
    .map((d) => ({
      documentId: d.documentId,
      documentNumber: d.documentNumber,
      direction: d.direction,
      counterpartyNip: d.counterpartyNip,
      counterpartyIban: d.counterpartyIban,
      remainingAmountGrosze: Math.max(0, d.grossGrosze - d.paidAmountGrosze),
    }));

  const matches = reconcileBankTransactions(parsedTx, openItems);
  const settledMatches = matches.filter(
    (m) => typeof m.matchedDocumentId === 'string' && m.settledAmountGrosze > 0,
  );
  let matchedCount = 0;

  if (input.applySettlements && settledMatches.length > 0) {
    const reconcileRemote = await papBffFetch(
      `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/finance/reconcile`,
      {
        method: 'POST',
        bearerToken: session.oidcToken,
        body: { matches: settledMatches },
      },
    );
    assertApiResponsePermitsFallback(reconcileRemote);
  }

  store.bankTransactionsByCompany.set(company.legalEntityId, [...parsedTx]);

  if (input.applySettlements) {
    for (const match of matches) {
      if (match.matchedDocumentId && match.settledAmountGrosze > 0) {
        matchedCount += 1;
        const idx = store.documents.findIndex((d) => d.documentId === match.matchedDocumentId);
        if (idx >= 0) {
          const doc = store.documents[idx]!;
          store.documents[idx] = {
            ...doc,
            paidAmountGrosze: Math.min(
              doc.grossGrosze,
              doc.paidAmountGrosze + match.settledAmountGrosze,
            ),
          };
        }
      }
    }
  }

  appendAudit(
    session,
    company,
    'BANK_STATEMENT_RECONCILED',
    `Zaimportowano wyciąg ${input.format.toUpperCase()} (${String(parsedTx.length)} poz.) i uzgodniono ${String(matchedCount)} płatności.`,
  );

  return { importedCount: parsedTx.length, matchedCount };
}

export function toggleObligationPaidMutation(
  session: ActiveWebSession,
  obligationCode: string,
): boolean {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();
  const key = `${session.context.period}:${obligationCode}`;
  const set = store.paidObligationCodesByCompany.get(company.legalEntityId) ?? new Set<string>();
  const nextPaid = !set.has(key);
  if (nextPaid) {
    set.add(key);
  } else {
    set.delete(key);
  }
  store.paidObligationCodesByCompany.set(company.legalEntityId, set);
  appendAudit(
    session,
    company,
    nextPaid ? 'OBLIGATION_MARKED_PAID' : 'OBLIGATION_REOPENED',
    `${nextPaid ? 'Oznaczono jako opłacony' : 'Przywrócono do opłacenia'} obowiązek ${obligationCode} za ${session.context.period}.`,
  );
  return nextPaid;
}

export async function updateNotificationPrefsAndDispatchMutation(
  session: ActiveWebSession,
  input:
    | {
        readonly op: 'update_prefs';
        readonly frequency: NotificationFrequency;
        readonly optionalRemindersOptedOut: boolean;
        readonly disabledStages: readonly ReminderStage[];
      }
    | {
        readonly op: 'dispatch_due';
      },
): Promise<void> {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();

  if (input.op === 'update_prefs') {
    const current = store.notificationPrefsByCompany.get(company.legalEntityId);
    store.notificationPrefsByCompany.set(company.legalEntityId, {
      recipientEmail: current?.recipientEmail ?? session.context.email,
      frequency: input.frequency,
      optionalRemindersOptedOut: input.optionalRemindersOptedOut,
      disabledStages: input.disabledStages,
      updatedAt: new Date().toISOString(),
    });
    appendAudit(
      session,
      company,
      'NOTIFICATION_PREFERENCES_UPDATED',
      `Zaktualizowano preferencje przypomnień e-mail (${input.frequency}, opt-out: ${String(input.optionalRemindersOptedOut)}).`,
    );
    return;
  }

  const safeTenantId = assertUuidPathParam(company.tenantId, 'tenantId');
  const safeEntityId = assertUuidPathParam(company.legalEntityId, 'legalEntityId');
  const dispatchRemote = await papBffFetch(
    `/api/v1/tenants/${safeTenantId}/companies/${safeEntityId}/notifications/dispatch-due`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: {},
    },
  );
  assertApiResponsePermitsFallback(dispatchRemote);

  const prefs = store.notificationPrefsByCompany.get(company.legalEntityId);
  const existingOutbox = store.outboxByCompany.get(company.legalEntityId) ?? [];
  const maskedNip = `******${company.nip.slice(-4)}`;
  const status = prefs?.optionalRemindersOptedOut ? 'suppressed_by_preferences' : 'sent';

  const generated: NotificationOutboxEntry = {
    outboxId: randomUUID(),
    deduplicationKey: `${company.tenantId}:${company.legalEntityId}:VAT_JPK:${session.context.period}:${String(existingOutbox.length + 1)}`,
    tenantId: company.tenantId,
    legalEntityId: company.legalEntityId,
    userId: session.context.userId,
    obligationId: randomUUID(),
    stage: 'urgent_2d',
    scheduledForDate: `${session.context.period}-23`,
    status,
    retryCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    createdAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    email: {
      fromAddress: 'powiadomienia@powiadomienia-pap.example',
      fromDisplayName: 'Polish Accounting Platform (Powiadomienia)',
      toAddress: prefs?.recipientEmail ?? session.context.email,
      subject: `[PAP Sandbox] Pilne przypomnienie (2 dni): Rozliczenie podatkowe za okres ${session.context.period} (${company.shortName})`,
      textBody: [
        `Powiadomienie dla firmy ${company.companyName} (NIP ${maskedNip}):`,
        `- Okres rozliczeniowy: ${session.context.period}`,
        '- Obowiązek: Weryfikacja ewidencji i wysyłka deklaracji miesięcznej / zaliczki podatkowej',
        '- Podstawa prawna: art. 99 ust. 1 i art. 109 ust. 3b ustawy o VAT (https://www.podatki.gov.pl/jednolity-plik-kontrolny/)',
        '',
        MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
      ].join('\n'),
      htmlBody: `<p>Pilne przypomnienie dla firmy <strong>${company.companyName}</strong> (NIP <code>${maskedNip}</code>) za okres <code>${session.context.period}</code>.</p><p>Źródło prawa: <a href="https://www.podatki.gov.pl/jednolity-plik-kontrolny/">Portal Podatkowy MF — JPK_VAT</a>.</p><hr/><p><small>${MANDATORY_AUXILIARY_EMAIL_FOOTER_PL}</small></p>`,
      headers: {
        'Message-ID': `<sandbox-${randomUUID()}@powiadomienia-pap.example>`,
        'MIME-Version': '1.0',
        'Content-Type': 'multipart/alternative; boundary="pap-rfc5322-boundary-live"',
        'Auto-Submitted': 'auto-generated',
        'X-PAP-Environment': 'synthetic-sandbox-mailbox',
        'X-PAP-Legal-Source': 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/',
      },
    },
    attempts: [
      {
        attemptNumber: 1,
        attemptedAt: new Date().toISOString(),
        outcome: status === 'sent' ? 'sent' : 'suppressed_by_preferences',
        providerMessageId: status === 'sent' ? `sandbox-msg-${randomUUID().slice(0, 8)}` : null,
        errorCode: null,
        errorMessageRedacted: null,
      },
    ],
  };

  store.outboxByCompany.set(company.legalEntityId, [generated, ...existingOutbox]);
  appendAudit(
    session,
    company,
    'NOTIFICATIONS_DISPATCHED_SANDBOX',
    `Wygenerowano wiadomość RFC 5322 w skrzynce Sandbox Mailbox (status: ${status}).`,
  );
}

export function manageMcpProposalMutation(
  session: ActiveWebSession,
  input:
    | { readonly op: 'issue_code'; readonly proposalId: string }
    | { readonly op: 'confirm'; readonly proposalId: string; readonly confirmationCode?: string }
    | { readonly op: 'create_demo_proposal' },
): { readonly confirmationCode?: string } {
  const company = verifySessionAccess(
    session,
    session.context.tenantId,
    session.context.legalEntityId,
    'write',
  );
  const store = getStore();

  if (input.op === 'create_demo_proposal') {
    const seq = store.mcpProposals.length + 100;
    const invNo = `FZ/MCP/${session.context.period}/${String(seq)}`;
    const payloadHash = sha256Hex(`${invNo}:${company.legalEntityId}`);
    store.mcpProposals.unshift({
      proposalId: randomUUID(),
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      clientName: 'Cursor IDE Agent (Streamable HTTP · pap:mcp:prepare)',
      toolName: 'prepare_invoice_and_posting_proposal',
      scope: 'pap:mcp:prepare',
      status: 'pending_human_approval',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      payloadHash,
      direction: 'purchase',
      invoiceNumber: invNo,
      issueDate: `${session.context.period}-22`,
      dueDate: `${session.context.period}-29`,
      counterpartyName: 'Dostawca Chmury Syntetycznej Sp. z o.o.',
      counterpartyNip: '5213004125',
      description: 'Subskrypcja API i środowiska testowego — szkic przygotowany przez klienta MCP',
      netGrosze: 90_000,
      vatGrosze: 20_700,
      grossGrosze: 110_700,
      suggestedCategory: 'pozostale_wydatki_kpir',
      kupPreviewGrosze: 90_000,
      deductibleVatPreviewGrosze: 20_700,
      promptInjectionSuspected: false,
    });
    appendAudit(
      session,
      company,
      'MCP_PROPOSAL_PREPARED',
      `Zarejestrowano nową propozycję MCP ${invNo} oczekującą na zatwierdzenie człowieka.`,
      'MCP',
    );
    return {};
  }

  const idx = store.mcpProposals.findIndex(
    (p) =>
      p.proposalId === input.proposalId &&
      p.tenantId === company.tenantId &&
      p.legalEntityId === company.legalEntityId,
  );
  if (idx < 0) {
    throw new WorkspaceAccessError(404, 'proposal_not_found', 'Nie znaleziono propozycji MCP.');
  }

  const current = store.mcpProposals[idx]!;
  if (current.status !== 'pending_human_approval') {
    throw new WorkspaceAccessError(
      400,
      'proposal_not_pending',
      `Propozycja MCP ${current.invoiceNumber} nie oczekuje już na zatwierdzenie (aktualny status: ${current.status}).`,
    );
  }

  const expiresAtMs = Date.parse(current.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    store.mcpProposals[idx] = {
      ...current,
      status: 'expired',
    };
    throw new WorkspaceAccessError(
      400,
      'proposal_expired',
      `Propozycja MCP ${current.invoiceNumber} wygasła (${current.expiresAt}) i wymaga ponownego przygotowania.`,
    );
  }

  if (input.op === 'issue_code') {
    const code = `PAP-HUMAN-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
    store.mcpProposals[idx] = {
      ...current,
      issuedConfirmationCode: code,
    };
    appendAudit(
      session,
      company,
      'MCP_HUMAN_CONFIRMATION_CODE_ISSUED',
      `Człowiek (${session.context.displayName}) wygenerował jednorazowy kod potwierdzenia dla propozycji MCP ${current.invoiceNumber}.`,
    );
    return { confirmationCode: code };
  }

  const expectedCode = current.issuedConfirmationCode;
  const providedCode =
    typeof input.confirmationCode === 'string' ? input.confirmationCode.trim() : '';
  if (!expectedCode || providedCode.length === 0) {
    throw new WorkspaceAccessError(
      400,
      'missing_confirmation_code',
      'Zatwierdzenie propozycji MCP wymaga najpierw wygenerowania wyzwania i podania jednorazowego kodu potwierdzenia człowieka.',
    );
  }

  const expectedBuf = Buffer.from(expectedCode, 'utf8');
  const providedBuf = Buffer.from(providedCode, 'utf8');
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    appendAudit(
      session,
      company,
      'MCP_CONFIRMATION_CODE_MISMATCH',
      `Odrzucono zatwierdzenie propozycji MCP ${current.invoiceNumber} — nieprawidłowy kod potwierdzenia człowieka.`,
      'UI',
    );
    throw new WorkspaceAccessError(
      400,
      'invalid_confirmation_code',
      'Nieprawidłowy jednorazowy kod potwierdzenia człowieka — sprawdź przepisany kod wyzwania.',
    );
  }

  const { issuedConfirmationCode: _consumedCode, ...restProposal } = current;
  void _consumedCode;
  store.mcpProposals[idx] = {
    ...restProposal,
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    confirmedBy: session.context.displayName,
  };
  appendAudit(
    session,
    company,
    'MCP_PROPOSAL_CONFIRMED_BY_HUMAN',
    `Człowiek (${session.context.displayName}) zweryfikował kod wyzwania i zatwierdził propozycję MCP ${current.invoiceNumber} (hash ${current.payloadHash.slice(0, 12)}…).`,
  );
  return {};
}
