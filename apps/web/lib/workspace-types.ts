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

export interface SyntheticPersonaDefinition {
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
  readonly syntheticOidcToken: string;
}

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
    | 'Import CSV'
    | 'Skan OCR (syntetyczny)'
    | 'Formularz ręczny'
    | 'Propozycja MCP';
  readonly ksefMarker: KsefInvoiceMarker;
  readonly ksefReferenceNumber?: string;
  readonly gtuCodes: readonly string[];
  readonly procedureCodes: readonly string[];
  readonly annex15Item: boolean;
  readonly whiteListStatus: 'verified_kas' | 'mismatch_alert' | 'not_required';
  readonly whiteListCheckId?: string;
  readonly aiConfidence: AiConfidenceLevel;
  readonly aiConfidencePercent: number;
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
  readonly status: 'pending_human_approval' | 'confirmed' | 'expired';
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
  readonly suggestedCategory:
    | 'towary_i_materialy'
    | 'pozostale_wydatki_kpir'
    | 'eksploatacja_samochodu_mieszana'
    | 'uslugi_obce'
    | 'przychod_sprzedaz';
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
    <DataWytworzeniaFa>2026-10-16T09:30:00Z</DataWytworzeniaFa>
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

export const SAMPLE_INVOICE_CSV = `Numer;Kierunek;DataWystawienia;TerminPlatnosci;Kontrahent;NIP;Opis;NettoPLN;VatPLN;StawkaVAT;NrKSeF
FV/2026/10/019;sales;2026-10-18;2026-11-02;Innowacje Bałtyckie Sp. z o.o.;7792301205;Projekt makiety produktu cyfrowego UX/UI;8500.00;1955.00;23;5250001003-20261018-UX0190-AB12CD-11`;

export const SAMPLE_BANK_CSV = `Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny
2026-10-19;2026-10-19;Nordic Design Polska Sp. z o.o.;PL61109010140000071219812874;Zapłata za fakturę FV/2026/10/001 NIP 7792301205;14760,00;PLN;BNK-20261019-001
2026-10-20;2026-10-20;Flota Serwis Syntetyczny Sp. z o.o.;PL27114020040000300201355387;Opłata za fakturę FZ/2026/10/042 eksploatacja auta;-1968,00;PLN;BNK-20261020-002
2026-10-21;2026-10-21;Kancelaria Doradcza Syntetyk;PL83102010260000140202763118;Przelew częściowy za usługi październik;-1500,00;PLN;BNK-20261021-003`;

export const SAMPLE_BANK_MT940 = `:20:STMT20261022
:25:PL61109010140000071219812874
:60F:C261001PLN45000,00
:61:2610191019C14760,00NTRFNONREF
:86:/ORDP/Nordic Design Polska Sp. z o.o. /REMI/Zaplata za fakture FV/2026/10/001 NIP 7792301205
:61:2610201020D1968,00NTRFNONREF
:86:/BENM/Flota Serwis Syntetyczny Sp. z o.o. /REMI/Faktura FZ/2026/10/042 serwis i paliwo
:62F:C261022PLN57792,00`;

export interface NotificationOutboxSnapshot {
  readonly preferences: NotificationPrefsState;
  readonly outbox: readonly NotificationOutboxEntry[];
}
