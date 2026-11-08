import type {
  KpirExpenseQualificationKind,
  KsefInvoiceMarker,
  TaxProfileCode,
  VatDeductionMode,
  VatRateCode,
} from '@pap/domain';
import type { AiConfidenceLevel } from '@pap/ui';
import type { PersonaId } from './session';

export type NotificationFrequency = 'standard' | 'daily_digest' | 'disabled';

export type ReminderStage = 'upcoming_7d' | 'urgent_2d' | 'due_today' | 'overdue_3d';

export const MANDATORY_AUXILIARY_EMAIL_FOOTER_PL =
  'Powiadomienie ma charakter wyłącznie pomocniczy i informacyjny — nie stanowi doradztwa podatkowego ani urzędowego potwierdzenia złożenia deklaracji (UPO). Dane syntetyczne środowiska testowego Polish Accounting Platform.';

export const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
export const TENANT_2_ID = '22222222-2222-4222-8222-222222222200';

export const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
export const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
export const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';
export const COMPANY_TENANT_2_ID = '22222222-2222-4222-8222-222222222201';

export const AVAILABLE_PERIODS = ['2026-03', '2026-06', '2026-10', '2026-11', '2026-12'] as const;
export const DEFAULT_ACCOUNTING_PERIOD = '2026-03' as const;

export interface NotificationOutboxAttempt {
  readonly attemptNumber: number;
  readonly attemptedAt: string;
  readonly outcome: 'sent' | 'suppressed_by_preferences' | 'transient_error';
  readonly providerMessageId: string | null;
  readonly errorCode: string | null;
  readonly errorMessageRedacted: string | null;
}

export interface NotificationOutboxEmail {
  readonly fromAddress: string;
  readonly fromDisplayName: string;
  readonly toAddress: string;
  readonly subject: string;
  readonly textBody: string;
  readonly htmlBody: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface NotificationOutboxEntry {
  readonly outboxId: string;
  readonly deduplicationKey: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly userId: string;
  readonly obligationId: string;
  readonly stage: ReminderStage;
  readonly scheduledForDate: string;
  readonly status: 'queued' | 'sent' | 'suppressed_by_preferences' | 'failed';
  readonly retryCount: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: string | null;
  readonly createdAt: string;
  readonly lastUpdatedAt: string;
  readonly email: NotificationOutboxEmail;
  readonly attempts: readonly NotificationOutboxAttempt[];
}

export interface PublicPersonaSummary {
  readonly personaId: PersonaId;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleSummaryPl: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantRole: 'owner' | 'accountant';
  readonly defaultLegalEntityId: string;
  readonly scopes: readonly string[];
  readonly descriptionPl: string;
}

export interface SyntheticPersonaDefinition extends PublicPersonaSummary {
  readonly syntheticOidcToken: string;
}

export const PUBLIC_SYNTHETIC_PERSONAS: readonly PublicPersonaSummary[] = [
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
  },
];

export type CompanyLegalForm = 'jdg' | 'sp_z_o_o' | 'spolka_cywilna';

export interface CompanyProfileRecord {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly demoCompanyCode?: 'demo_jdg_kpir_alfa' | 'demo_jdg_ryczalt_beta' | 'demo_spzoo_gamma';
  readonly companyName: string;
  readonly shortName: string;
  readonly nip: string;
  readonly regon: string;
  readonly krs?: string;
  readonly address: string;
  readonly iban: string;
  readonly legalForm: CompanyLegalForm;
  readonly profileCode: TaxProfileCode;
  readonly profileLabelPl: string;
  readonly vatStatus: 'czynny' | 'zwolniony_art_113' | 'zwolniony_przedmiotowo';
  readonly vatSettlementPeriod: 'monthly' | 'quarterly' | 'not_applicable';
  readonly zusScheme: 'ulga_na_start' | 'preferencyjny_zus' | 'duzy_zus' | 'not_applicable';
  readonly voluntarySicknessInsurance: boolean;
  readonly smallTaxpayer: boolean;
  readonly activityStartDate: string;
  readonly priorYearGrossSalesGrosze: number;
  readonly ytdPriorMonthsRevenueGrosze: number;
  readonly ytdPriorMonthsCostsGrosze: number;
  readonly grantedActions: readonly ('read' | 'write')[];
}

export interface CompanyUserGrantRecord {
  readonly grantId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly userId: string;
  readonly userDisplayName: string;
  readonly userEmail: string;
  readonly roleLabelPl: string;
  readonly actions: readonly ('read' | 'write')[];
  readonly status: 'active' | 'revoked';
  readonly grantedAt: string;
  readonly revokedAt?: string;
}

export interface AuditLogEntryRecord {
  readonly auditId: string;
  readonly timestamp: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly actorName: string;
  readonly actorRole: string;
  readonly channel: 'UI' | 'API' | 'MCP';
  readonly actionCode: string;
  readonly summaryPl: string;
  readonly correlationId: string;
}

export type DocumentWorkflowStatus = 'draft' | 'ai_proposal' | 'approved_posted' | 'archived';

export type DocumentKind = 'sales' | 'purchase' | 'correction' | 'advance';

export interface AiExtractedFieldsSnapshot {
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly eventDate: string;
  readonly dueDate: string;
  readonly counterpartyName: string;
  readonly counterpartyNip: string;
  readonly netGrosze: number;
  readonly vatGrosze: number;
  readonly grossGrosze: number;
}

export interface WorkspaceDocumentRecord {
  readonly documentId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly period: string;
  readonly status: DocumentWorkflowStatus;
  readonly documentKind: DocumentKind;
  readonly direction: 'sales' | 'purchase';
  readonly documentNumber: string;
  readonly issueDate: string;
  readonly eventDate: string;
  readonly dueDate: string;
  readonly counterpartyName: string;
  readonly counterpartyNip: string;
  readonly counterpartyAddress: string;
  readonly counterpartyIban: string;
  readonly description: string;
  readonly vatRate: VatRateCode;
  readonly netGrosze: number;
  readonly vatGrosze: number;
  readonly grossGrosze: number;
  readonly paidAmountGrosze: number;
  readonly sha256: string;
  readonly isDuplicateSha256: boolean;
  readonly fileName: string;
  readonly mimeLabel: string;
  readonly sourceChannel:
    | 'KSeF FA(3) XML'
    | 'KSeF FA(2) XML'
    | 'Import CSV'
    | 'Import JSON'
    | 'Skan OCR (syntetyczny)'
    | 'Formularz ręczny'
    | 'Propozycja MCP';
  readonly ksefMarker: KsefInvoiceMarker;
  readonly ksefReferenceNumber?: string;
  readonly gtuCodes: readonly string[];
  readonly procedureCodes: readonly string[];
  readonly annex15Item: boolean;
  readonly whiteListStatus:
    | 'unverified'
    | 'verified_kas'
    | 'mismatch_alert'
    | 'not_required'
    | 'not_checked';
  readonly whiteListCheckId?: string;
  readonly aiConfidence: AiConfidenceLevel;
  readonly aiConfidencePercent: number | null;
  readonly extractionMethodLabelPl?: string;
  readonly aiProposed: AiExtractedFieldsSnapshot;
  readonly expenseQualification: KpirExpenseQualificationKind;
  readonly vatDeductionMode: VatDeductionMode;
  readonly rawPreviewText: string;
  readonly uploadedAtLabel: string;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly postedEntryId?: string;
}

export interface McpPendingProposalRecord {
  readonly proposalId: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly clientName: string;
  readonly toolName: 'prepare_invoice_and_posting_proposal';
  readonly scope: 'pap:mcp:prepare';
  readonly status: 'pending_human_approval' | 'confirmed' | 'rejected' | 'expired';
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly payloadHash: string;
  readonly direction: 'purchase' | 'sales';
  readonly invoiceNumber: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly counterpartyName: string;
  readonly counterpartyNip: string;
  readonly description: string;
  readonly netGrosze: number;
  readonly vatGrosze: number;
  readonly grossGrosze: number;
  readonly suggestedCategory: string;
  readonly kupPreviewGrosze: number;
  readonly deductibleVatPreviewGrosze: number;
  readonly promptInjectionSuspected: boolean;
  readonly issuedConfirmationCode?: string;
  readonly confirmedAt?: string;
  readonly confirmedBy?: string;
}

export interface NotificationPrefsState {
  readonly recipientEmail: string;
  readonly frequency: NotificationFrequency;
  readonly optionalRemindersOptedOut: boolean;
  readonly disabledStages: readonly ReminderStage[];
  readonly updatedAt: string;
}

export interface McpToolCatalogItem {
  readonly name: string;
  readonly titlePl: string;
  readonly scope: 'public' | 'pap:mcp:read' | 'pap:mcp:prepare';
  readonly mode: 'read' | 'prepare' | 'confirm';
  readonly descriptionPl: string;
}

export const MCP_TOOLS_CATALOG: readonly McpToolCatalogItem[] = [
  {
    name: 'system_status',
    titlePl: 'Status techniczny systemu',
    scope: 'public',
    mode: 'read',
    descriptionPl:
      'Zwraca publiczny status usługi i modułów bez ujawniania jakichkolwiek danych firm, NIP czy dokumentów.',
  },
  {
    name: 'list_my_companies',
    titlePl: 'Moje firmy i profile podatkowe',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Zwraca podmioty prawne i zamaskowany NIP dostępne dla uwierzytelnionego użytkownika zgodnie z aktywnymi grantami.',
  },
  {
    name: 'list_unpaid_invoices',
    titlePl: 'Niezapłacone faktury i zaległości',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Zwraca otwarte rozrachunki w PLN wraz z kopertą bezpieczeństwa untrusted_document_data chroniącą przed prompt injection.',
  },
  {
    name: 'get_monthly_tax_obligations',
    titlePl: 'Miesięczne obowiązki podatkowe i ZUS',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Wylicza terminy ZUS DRA, zaliczki PIT/CIT/ryczałtu oraz JPK_V7M z przesunięciami świątecznymi wg art. 12 § 5 OP.',
  },
  {
    name: 'explain_accounting_item',
    titlePl: 'Wyjaśnienie kwalifikacji księgowej („Dlaczego?”)',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Pokazuje krok po kroku wyliczenie KUP/NKUP i odliczenia VAT (np. 50% VAT / 75% KUP dla samochodu osobowego) ze źródłem w Dz.U.',
  },
  {
    name: 'get_legal_basis',
    titlePl: 'Podstawa prawna reguły podatkowej',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Pobiera zweryfikowany przepis z rejestru reguł prawnych 2025–2026 z linkiem do ISAP / podatki.gov.pl / ZUS.',
  },
  {
    name: 'get_month_close_checklist',
    titlePl: 'Lista kontrolna zamknięcia miesiąca',
    scope: 'pap:mcp:read',
    mode: 'read',
    descriptionPl:
      'Wskazuje niezatwierdzone propozycje AI, nieuzgodnione przelewy bankowe i nadchodzące deklaracje przed zamknięciem okresu.',
  },
  {
    name: 'prepare_invoice_and_posting_proposal',
    titlePl: 'Przygotuj propozycję faktury i dekretacji (bez księgowania)',
    scope: 'pap:mcp:prepare',
    mode: 'prepare',
    descriptionPl:
      'Tworzy audytowany, idempotentny szkic ze statusem pending_human_approval. Nigdy nie zapisuje pozycji bezpośrednio w księgach.',
  },
  {
    name: 'confirm_prepared_proposal',
    titlePl: 'Zatwierdź przygotowaną propozycję z kodem człowieka',
    scope: 'pap:mcp:prepare',
    mode: 'confirm',
    descriptionPl:
      'Wymaga jednorazowego kodu potwierdzenia wygenerowanego przez uprawnionego człowieka oraz zgodnego skrótu SHA-256 payloadu.',
  },
];

export const SAMPLE_KSEF_FA3_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>2026-03-16T09:30:00Z</DataWytworzeniaFa>
    <SystemInfo>Syntetyczny Generator KSeF 2.0</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>5213004125</NIP>
      <Nazwa>Chmura Obliczeniowa Syntetyk Sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>ul. Cybernetyki 19, 02-677 Warszawa</AdresL1>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>5250001003</NIP>
      <Nazwa>Pracownia Projektowa Jan Testowy</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2026-10-16</P_1>
    <P_2>FA3/10/2026/084</P_2>
    <P_6>2026-10-16</P_6>
    <P_13_1>2400.00</P_13_1>
    <P_14_1>552.00</P_14_1>
    <P_15>2952.00</P_15>
    <NrKSeF>5213004125-20261016-FA3084-99A1B2-44</NrKSeF>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Infrastruktura serwerowa CI/CD i kopie zapasowe — październik 2026 (dane syntetyczne)</P_7>
      <P_8A>usł.</P_8A>
      <P_8B>1</P_8B>
      <P_11>2400.00</P_11>
      <P_12>23</P_12>
    </FaWiersz>
    <Platnosc>
      <TerminPlatnosci>
        <Termin>2026-10-30</Termin>
      </TerminPlatnosci>
      <RachunekBankowy>
        <NrRB>PL61109010140000071219812874</NrRB>
      </RachunekBankowy>
    </Platnosc>
  </Fa>
</Faktura>`;

export const SAMPLE_KSEF_FA2_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (2)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>2</WariantFormularza>
    <DataWytworzeniaFa>2026-03-14T11:15:00Z</DataWytworzeniaFa>
    <SystemInfo>Syntetyczny Generator KSeF FA(2)</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>5250006006</NIP>
      <Nazwa>Dostawca Sprzętu Test Sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
    <Adres>
      <KodKraju>PL</KodKraju>
      <AdresL1>ul. Prosta 51, 00-838 Warszawa</AdresL1>
    </Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>5250001003</NIP>
      <Nazwa>Pracownia Projektowa Jan Testowy</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>2026-03-14</P_1>
    <P_2>FA2/03/2026/051</P_2>
    <P_6>2026-03-14</P_6>
    <P_13_1>1600.00</P_13_1>
    <P_14_1>368.00</P_14_1>
    <P_15>1968.00</P_15>
    <NrKSeF>5250006006-20260314-FA2051-77C3D4-22</NrKSeF>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Stacja dokująca USB-C i akcesoria stanowiskowe (dane syntetyczne)</P_7>
      <P_8A>szt.</P_8A>
      <P_8B>1</P_8B>
      <P_11>1600.00</P_11>
      <P_12>23</P_12>
    </FaWiersz>
    <Platnosc>
      <TerminPlatnosci>
        <Termin>2026-03-28</Termin>
      </TerminPlatnosci>
    </Platnosc>
  </Fa>
</Faktura>`;

export const SAMPLE_INVOICE_CSV = `Numer;Data wystawienia;Kontrahent;Kwota netto;Stawka VAT;NIP;Opis
FV/2026/03/019;2026-03-18;Innowacje Bałtyckie Sp. z o.o.;8500.00;23;7792301205;Projekt makiety produktu cyfrowego UX/UI`;

export const SAMPLE_INVOICE_JSON = JSON.stringify(
  {
    documentNumber: 'FV-JSON/2026/03/012',
    direction: 'purchase',
    issueDate: '2026-03-19',
    eventDate: '2026-03-19',
    dueDate: '2026-04-02',
    counterpartyName: 'Audyt Systemowy Syntetyk Sp. z o.o.',
    counterpartyNip: '5250004007',
    netGrosze: 320000,
    vatRate: '23',
    description: 'Audyt bezpieczeństwa aplikacji i przegląd konfiguracji KSeF (dane syntetyczne)',
  },
  null,
  2,
);

export const SAMPLE_BANK_CSV = `Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny
2026-03-19;2026-03-19;Syntetyczny Software House Sp. z o.o.;PL61109010140000071219812874;Zapłata za fakturę FV/2026/03/001 NIP 5250002008;24600,00;PLN;BNK-20260319-001
2026-03-20;2026-03-20;Chmura Polska Infrastruktur Test S.A.;PL27114020040000300201355387;Opłata za fakturę FV-CHMURA/03/2026 NIP 5250004007;-1476,00;PLN;BNK-20260320-002
2026-03-21;2026-03-21;Nordic Design Polska Sp. z o.o.;PL61109010140000071219812874;Zapłata za fakturę FV/2026/10/001 NIP 7792301205;14760,00;PLN;BNK-20261019-001
2026-03-22;2026-03-22;Kancelaria Doradcza Syntetyk;PL83102010260000140202763118;Przelew częściowy za usługi marzec;-1500,00;PLN;BNK-20260322-003`;

export const SAMPLE_BANK_MT940 = `:20:STMT20260322
:25:PL61109010140000071219812874
:60F:C260301PLN45000,00
:61:2603190319C24600,00NTRFNONREF
:86:/ORDP/Syntetyczny Software House Sp. z o.o. /REMI/Zaplata za fakture FV/2026/03/001 NIP 5250002008
:61:2603200320D1476,00NTRFNONREF
:86:/BENM/Chmura Polska Infrastruktur Test S.A. /REMI/Faktura FV-CHMURA/03/2026 chmura i kopie
:62F:C260322PLN68124,00`;

export interface NotificationOutboxSnapshot {
  readonly preferences: NotificationPrefsState;
  readonly outbox: readonly NotificationOutboxEntry[];
}
