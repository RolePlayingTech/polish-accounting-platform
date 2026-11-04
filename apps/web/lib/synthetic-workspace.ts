import { createHash, randomUUID } from 'node:crypto';
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
import { papBffFetch } from './api-url';
import type { ActiveWebSession, PersonaId, SessionContext } from './session';
import {
  MANDATORY_AUXILIARY_EMAIL_FOOTER_PL,
  SAMPLE_BANK_CSV,
  type AuditLogEntryRecord,
  type CompanyProfileRecord,
  type CompanyUserGrantRecord,
  type DocumentKind,
  type McpPendingProposalRecord,
  type NotificationFrequency,
  type NotificationOutboxEntry,
  type NotificationPrefsState,
  type ReminderStage,
  type SyntheticPersonaDefinition,
  type WorkspaceDocumentRecord,
} from './workspace-types';

export const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
export const TENANT_2_ID = '22222222-2222-4222-8222-222222222200';

export const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
export const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
export const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';
export const COMPANY_TENANT_2_ID = '22222222-2222-4222-8222-222222222201';

export const AVAILABLE_PERIODS = ['2026-10', '2026-06', '2026-11', '2026-12'] as const;
export const DEFAULT_ACCOUNTING_PERIOD = '2026-10' as const;

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

export async function listAvailablePersonas(): Promise<readonly SyntheticPersonaDefinition[]> {
  const remote = await papBffFetch<{ personas?: unknown }>('/api/v1/oidc/personas');
  if (remote.kind === 'ok' && Array.isArray(remote.data?.personas)) {
    // Zachowujemy kanoniczne definicje syntetyczne wzbogacone o odpowiedź API, jeśli dostępna.
    return SYNTHETIC_PERSONAS;
  }
  return SYNTHETIC_PERSONAS;
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
  if (tokenResp.kind === 'ok') {
    const issued = tokenResp.data.accessToken ?? tokenResp.data.token;
    if (typeof issued === 'string' && issued.trim().length >= 8) {
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
      expiresAt: '2026-11-05T09:10:00Z',
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
  public readonly statusCode: 401 | 403 | 404 | 400;
  public readonly reasonCode: string;

  public constructor(statusCode: 401 | 403 | 404 | 400, reasonCode: string, messagePl: string) {
    super(messagePl);
    this.name = 'WorkspaceAccessError';
    this.statusCode = statusCode;
    this.reasonCode = reasonCode;
  }
}

export function verifySessionAccess(
  session: ActiveWebSession | null,
  targetTenantId: string,
  targetLegalEntityId: string,
  action: 'read' | 'write',
): CompanyProfileRecord {
  if (!session) {
    throw new WorkspaceAccessError(
      401,
      'unauthenticated',
      'Sesja wygasła lub użytkownik nie jest zalogowany. Wybierz personę testową na ekranie logowania.',
    );
  }

  const store = getStore();

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
  if (session.context.personaId === 'marta-ksiegowa') {
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

  const remote = await papBffFetch(`/api/v1/tenants/${session.context.tenantId}/companies`, {
    method: 'POST',
    bearerToken: session.oidcToken,
    body: { ...input, nip: nipCheck.normalizedNip },
  });
  if (remote.kind === 'forbidden') {
    throw new WorkspaceAccessError(403, 'api_forbidden', remote.message);
  }
  if (remote.kind === 'unauthorized') {
    throw new WorkspaceAccessError(401, 'api_unauthorized', 'Brak autoryzacji w API.');
  }

  const store = getStore();
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

  await papBffFetch(
    `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/settings`,
    {
      method: 'PUT',
      bearerToken: session.oidcToken,
      body: input,
    },
  );

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
    issueDate = input.issueDate;
    dueDate = input.dueDate;
    counterpartyName = input.counterpartyName.trim() || 'Kontrahent syntetyczny';
    counterpartyNip = nipValidation.normalizedNip;
    description = input.description.trim() || 'Operacja gospodarcza';
    netGrosze = parsePlnToGrosze(input.netPln);
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
    rawText = input.rawPayload.trim();
    if (!rawText) {
      throw new WorkspaceAccessError(
        400,
        'empty_import',
        'Wklej lub wczytaj treść pliku do importu.',
      );
    }

    if (input.format === 'fa3_xml') {
      docNum = extractXmlTag(rawText, 'P_2') ?? `FA3/${session.context.period}/IMP`;
      issueDate = extractXmlTag(rawText, 'P_1') ?? `${session.context.period}-16`;
      dueDate = extractXmlTag(rawText, 'Termin') ?? `${session.context.period}-30`;
      const sellerNip = extractXmlTag(rawText, 'NIP') ?? '5213004125';
      const sellerName = extractXmlTag(rawText, 'Nazwa') ?? 'Dostawca KSeF FA(3) Sp. z o.o.';
      direction = sellerNip === company.nip ? 'sales' : 'purchase';
      docKind = direction;
      counterpartyNip = sellerNip === company.nip ? '7792301205' : sellerNip;
      counterpartyName = sellerName;
      description =
        extractXmlTag(rawText, 'P_7') ??
        'Pozycja zaimportowana z e-faktury ustrukturyzowanej FA(3)';
      netGrosze = parsePlnToGrosze(extractXmlTag(rawText, 'P_13_1') ?? '1000.00');
      vatGrosze = parsePlnToGrosze(extractXmlTag(rawText, 'P_14_1') ?? '230.00');
      grossGrosze = parsePlnToGrosze(extractXmlTag(rawText, 'P_15') ?? '1230.00');
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
      issueDate = cols[2] || `${session.context.period}-18`;
      dueDate = cols[3] || `${session.context.period}-28`;
      counterpartyName = cols[4] || 'Kontrahent CSV Sp. z o.o.';
      counterpartyNip = cols[5] || '7792301205';
      description = cols[6] || 'Pozycja z pliku CSV';
      netGrosze = parsePlnToGrosze(cols[7] || '1000.00');
      vatGrosze = parsePlnToGrosze(cols[8] || '230.00');
      grossGrosze = netGrosze + vatGrosze;
      vatRate = '23';
      ksefRef = cols[10] || undefined;
      ksefMarker = ksefRef ? 'NrKSeF' : 'DI';
      fileName = 'import_dokumentow.csv';
      mimeLabel = 'text/csv · średnik';
      sourceChannel = 'Import CSV';
    } else {
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      docNum = String(parsed['documentNumber'] ?? `JSON/${session.context.period}/01`);
      direction = parsed['direction'] === 'sales' ? 'sales' : 'purchase';
      docKind = direction;
      issueDate = String(parsed['issueDate'] ?? `${session.context.period}-15`);
      dueDate = String(parsed['dueDate'] ?? `${session.context.period}-29`);
      counterpartyName = String(parsed['counterpartyName'] ?? 'Kontrahent JSON');
      counterpartyNip = String(parsed['counterpartyNip'] ?? '5213004125');
      description = String(parsed['description'] ?? 'Dokument JSON');
      netGrosze = parsePlnToGrosze(String(parsed['netPln'] ?? '1000.00'));
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

  await papBffFetch(
    `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/documents`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: { documentNumber: docNum, sha256: digest },
    },
  );

  const newDoc: WorkspaceDocumentRecord = {
    documentId: `doc-${randomUUID().slice(0, 8)}`,
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

  const netGrosze = parsePlnToGrosze(input.netPln);
  const vatGrosze = parsePlnToGrosze(input.vatPln);
  const grossGrosze = netGrosze + vatGrosze;

  await papBffFetch(
    `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/documents/${input.documentId}/approve-and-post`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: input,
    },
  );

  const current = store.documents[docIndex]!;
  let postedEntryId = current.postedEntryId ?? `post-${randomUUID().slice(0, 8)}`;

  if (
    current.status !== 'approved_posted' &&
    (company.profileCode === 'jdg_kpir_skala' || company.profileCode === 'jdg_kpir_liniowy')
  ) {
    const existingKpir = store.kpirEntriesByCompany.get(company.legalEntityId) ?? [];
    const nextOrdinal = existingKpir.length + 1;
    postedEntryId = `kpir-${current.period}-${String(nextOrdinal)}`;

    if (current.direction === 'sales') {
      const entry = createKpirEntry({
        id: postedEntryId,
        ordinalNumber: nextOrdinal,
        eventDate: input.issueDate,
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
        period: input.issueDate.slice(0, 7),
        taxPointDate: input.issueDate,
        issueDate: input.issueDate,
        documentNumber: input.documentNumber.trim(),
        counterpartyName: input.counterpartyName.trim(),
        counterpartyNip: nipCheck.normalizedNip,
        vatRate: current.vatRate,
        netGrosze,
        vatTotalGrosze: vatGrosze,
        deductionMode: input.vatDeductionMode,
      });

      const qualified = qualifyKpirExpense({
        eventDate: input.issueDate,
        qualificationKind: input.expenseQualification,
        netGrosze,
        vatGrosze,
        taxpayerVatActive: company.vatStatus === 'czynny',
        deductibleVatGrosze: vatEntry.deductibleVatGrosze,
      });

      const entry = createKpirEntry({
        id: postedEntryId,
        ordinalNumber: nextOrdinal,
        eventDate: input.issueDate,
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
  }

  const updated: WorkspaceDocumentRecord = {
    ...current,
    status: 'approved_posted',
    documentNumber: input.documentNumber.trim(),
    counterpartyName: input.counterpartyName.trim(),
    counterpartyNip: nipCheck.normalizedNip,
    issueDate: input.issueDate,
    eventDate: input.issueDate,
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
    const storno = createKpirStornoEntry({
      id: `kpir-storno-${String(nextOrdinal)}`,
      ordinalNumber: nextOrdinal,
      correctionDate: input.correctionDate,
      originalEntry: original,
      correctionDocumentNumber:
        input.correctionDocumentNumber.trim() || `KOR/${original.documentNumber}`,
      correctionReason: input.correctionReason.trim(),
    });
    store.kpirEntriesByCompany.set(company.legalEntityId, [...currentList, storno]);
    appendAudit(
      session,
      company,
      'KPIR_STORNO_POSTED',
      `Utworzono czerwone storno KPiR poz. ${String(storno.ordinalNumber)} do wpisu poz. ${String(original.ordinalNumber)} (${input.correctionReason}).`,
    );
    return storno;
  }

  const created = createKpirEntry({
    id: `kpir-manual-${String(nextOrdinal)}`,
    ordinalNumber: nextOrdinal,
    eventDate: input.eventDate,
    documentNumber: input.documentNumber.trim(),
    ...(input.ksefReferenceNumber?.trim()
      ? { ksefReferenceNumber: input.ksefReferenceNumber.trim() }
      : {}),
    counterpartyName: input.counterpartyName.trim(),
    ...(input.counterpartyNip.trim() ? { counterpartyNip: input.counterpartyNip.trim() } : {}),
    counterpartyAddress: input.counterpartyAddress.trim() || 'Polska',
    eventDescription: input.eventDescription.trim(),
    col7SalesRevenueGrosze: parsePlnToGrosze(input.salesPln || '0.00'),
    col13OtherExpensesGrosze: parsePlnToGrosze(input.otherExpensesPln || '0.00'),
    qualificationKind:
      parsePlnToGrosze(input.otherExpensesPln || '0.00') > 0 ? 'other_expenses_100_col13' : 'none',
  });

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

  const entry = createRyczaltEntry({
    id: `ryczalt-${String(nextOrd)}`,
    ordinalNumber: nextOrd,
    entryDate: input.revenueDate,
    revenueDate: input.revenueDate,
    documentNumber: input.documentNumber.trim(),
    counterpartyName: input.counterpartyName.trim(),
    ...(input.counterpartyNip?.trim() ? { counterpartyNip: input.counterpartyNip.trim() } : {}),
    rate: input.rate,
    revenueGrosze: parsePlnToGrosze(input.revenuePln),
    ...(input.remarks?.trim() ? { remarks: input.remarks.trim() } : {}),
  });

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

  await papBffFetch(
    `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/finance/bank-import`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: input,
    },
  );

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

  const store = getStore();
  store.bankTransactionsByCompany.set(company.legalEntityId, [...parsedTx]);

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
  let matchedCount = 0;

  if (input.applySettlements) {
    await papBffFetch(
      `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/finance/reconcile`,
      {
        method: 'POST',
        bearerToken: session.oidcToken,
        body: { matches },
      },
    );

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

  await papBffFetch(
    `/api/v1/tenants/${company.tenantId}/companies/${company.legalEntityId}/notifications/dispatch-due`,
    {
      method: 'POST',
      bearerToken: session.oidcToken,
      body: { period: session.context.period },
    },
  );

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

  store.mcpProposals[idx] = {
    ...current,
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    confirmedBy: session.context.displayName,
  };
  appendAudit(
    session,
    company,
    'MCP_PROPOSAL_CONFIRMED_BY_HUMAN',
    `Człowiek (${session.context.displayName}) zatwierdził propozycję MCP ${current.invoiceNumber} (hash ${current.payloadHash.slice(0, 12)}…).`,
  );
  return {};
}
