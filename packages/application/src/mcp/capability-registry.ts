import {
  MCP_CAPABILITY_CONTRACT_VERSION,
  type CompanyCapabilityEntry,
  type McpCapabilityStatus,
  type McpToolDescriptor,
} from '@pap/contracts/mcp-tools';
import type { CompanyTaxProfile } from './types.js';

export const PAP_MCP_TOOL_DESCRIPTORS: readonly McpToolDescriptor[] = Object.freeze([
  {
    toolName: 'system_status',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'system.status',
    family: 'system',
    titlePl: 'Status systemu',
    descriptionPl:
      'Zwraca status techniczny aplikacji i informację o dostępności modułów. Nie udostępnia danych firm ani dokumentów.',
    requiredScopes: [],
    requiresCompanySelector: false,
    requiredCompanyAction: 'none',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'list_my_companies',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'companies.directory',
    family: 'companies',
    titlePl: 'Moje firmy i profile podatkowe',
    descriptionPl:
      'Zwraca wyłącznie podmioty prawne i profile podatkowe dostępne dla uwierzytelnionego użytkownika na podstawie aktywnych grantów.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: false,
    requiredCompanyAction: 'none',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'get_company_profile',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'companies.profile',
    family: 'companies',
    titlePl: 'Profil podatkowy i księgowy firmy',
    descriptionPl:
      'Zwraca aktywny profil podatkowy, rodzaj ksiąg, status VAT, obowiązek JPK i status wsparcia modułów dla wybranej firmy.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'list_available_capabilities',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'companies.capabilities_registry',
    family: 'companies',
    titlePl: 'Rejestr dostępnych możliwości MCP (capability registry)',
    descriptionPl:
      'Odkrywa status wsparcia modułów (supported / experimental / unsupported) dla wybranej firmy i roku podatkowego wraz z ograniczeniami.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'list_unpaid_invoices',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'invoicing.unpaid_list',
    family: 'invoicing',
    titlePl: 'Niezapłacone faktury',
    descriptionPl:
      'Zwraca listę niezapłaconych faktur sprzedaży lub zakupu w PLN dla wybranej firmy. Pola tekstowe dokumentów są oznaczone jako niezaufane dane.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'get_monthly_tax_obligations',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'tax.period_obligations',
    family: 'tax',
    titlePl: 'Miesięczne obowiązki podatkowe i ZUS',
    descriptionPl:
      'Zwraca terminy i statusy obowiązków ZUS, PIT/CIT, VAT, JPK oraz KSeF dla wybranej firmy i okresu RRRR-MM wraz ze zweryfikowaną podstawą prawną.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'explain_accounting_item',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'tax.calculation_trace',
    family: 'tax',
    titlePl: 'Wyjaśnienie kwalifikacji księgowej i podatkowej',
    descriptionPl:
      'Wyjaśnia krok po kroku kwalifikację kwoty do KUP/NKUP oraz odliczenia VAT wraz z zastosowanymi przepisami i wyliczeniem.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'get_legal_basis',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'tax.legal_basis',
    family: 'tax',
    titlePl: 'Podstawa prawna obowiązku lub reguły',
    descriptionPl:
      'Zwraca zweryfikowany przepis prawa podatkowego lub ubezpieczeniowego, Dziennik Ustaw, okres obowiązywania, wyjątki i link urzędowy.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: false,
    requiredCompanyAction: 'none',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'preview_jpk_export',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'tax.jpk_preview',
    family: 'tax',
    titlePl: 'Podgląd gotowości i podsumowania JPK (bez wysyłki urzędowej)',
    descriptionPl:
      'Generuje deterministyczny podgląd podsumowania JPK właściwego dla profilu firmy i okresu RRRR-MM bez fikcyjnego UPO i bez wysyłki do urzędu.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'get_month_close_checklist',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'ledger.month_close_checklist',
    family: 'ledger',
    titlePl: 'Lista kontrolna zamknięcia miesiąca',
    descriptionPl:
      'Analizuje brakujące dokumenty, niezatwierdzone propozycje AI, nieuzgodnione przelewy bankowe i zbliżające się deklaracje dla wybranego okresu RRRR-MM.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'prepare_month_close',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'ledger.month_close_prepare',
    family: 'ledger',
    titlePl: 'Przygotuj bezpieczny plan zamknięcia miesiąca (bez zamknięcia okresu)',
    descriptionPl:
      'Weryfikuje blokady zamknięcia okresu i rejestruje idempotentny szkic zamknięcia miesiąca wymagający odrębnego zatwierdzenia człowieka.',
    requiredScopes: ['pap:mcp:prepare'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'write',
    riskClassification: 'safe_prepare',
    requiresIdempotencyKey: true,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'preview_invoice_posting',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'documents.posting_preview',
    family: 'documents',
    titlePl: 'Symulacja (dry-run) dekretacji faktury i stawek VAT',
    descriptionPl:
      'Wylicza deterministyczny podgląd skutków w KPiR/Ryczałcie/UoR oraz VAT (w tym wielostawkowych i 0%/zw/np) bez zapisu i bez tworzenia propozycji.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'prepare_invoice_and_posting_proposal',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'documents.posting_proposal',
    family: 'documents',
    titlePl: 'Przygotuj bezpieczną propozycję faktury i dekretacji (bez księgowania)',
    descriptionPl:
      'Tworzy audytowany, idempotentny szkic faktury (w tym wielostawkowej lub 0%/zw/np z jawną stawką) ze statusem pending_human_approval. Nigdy nie księguje bez człowieka.',
    requiredScopes: ['pap:mcp:prepare'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'write',
    riskClassification: 'safe_prepare',
    requiresIdempotencyKey: true,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'confirm_prepared_proposal',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'documents.posting_confirm',
    family: 'documents',
    titlePl: 'Zatwierdź przygotowaną propozycję (wymaga kodu potwierdzenia człowieka)',
    descriptionPl:
      'Operacja krytyczna: zatwierdza wcześniej przygotowany szkic wyłącznie po podaniu świeżego, jednorazowego tokenu potwierdzenia człowieka (confirmationCode) i zgodnego skrótu expectedPayloadHash.',
    requiredScopes: ['pap:mcp:prepare'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'write',
    riskClassification: 'requires_human_review',
    requiresIdempotencyKey: true,
    requiresIndependentHumanApproval: true,
  },
  {
    toolName: 'list_unreconciled_bank_transactions',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'bank.unreconciled_list',
    family: 'bank',
    titlePl: 'Nieuzgodnione transakcje bankowe',
    descriptionPl:
      'Zwraca stronicowaną listę nieuzgodnionych przelewów bankowych w PLN z ochroną przed prompt injection w tytułach przelewów.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'prepare_bank_reconciliation',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'bank.reconciliation_prepare',
    family: 'bank',
    titlePl: 'Przygotuj propozycję rozliczenia przelewu z fakturą (bez zapisu w banku)',
    descriptionPl:
      'Weryfikuje brak nadpłaty/podwójnej alokacji i tworzy bezpieczną propozycję dopasowania płatności (lub podgląd dryRun) ze skrótem payloadHash.',
    requiredScopes: ['pap:mcp:prepare'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'write',
    riskClassification: 'safe_prepare',
    requiresIdempotencyKey: true,
    requiresIndependentHumanApproval: false,
  },
  {
    toolName: 'confirm_bank_reconciliation_proposal',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'bank.reconciliation_confirm',
    family: 'bank',
    titlePl: 'Wykonaj zatwierdzone rozliczenie bankowe (wymaga kodu potwierdzenia człowieka)',
    descriptionPl:
      'Operacja krytyczna: stosuje alokację przelewu do rozrachunku wyłącznie z ważnym jednorazowym kodem wyzwania człowieka i zgodnym expectedPayloadHash.',
    requiredScopes: ['pap:mcp:prepare'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'write',
    riskClassification: 'requires_human_review',
    requiresIdempotencyKey: true,
    requiresIndependentHumanApproval: true,
  },
  {
    toolName: 'get_audit_lineage',
    schemaVersion: MCP_CAPABILITY_CONTRACT_VERSION,
    capabilityId: 'reporting.audit_lineage',
    family: 'reporting',
    titlePl: 'Ślad audytowy i pochodzenie operacji (z redakcją PII/sekretów)',
    descriptionPl:
      'Zwraca stronicowaną historię zdarzeń audytowych firmy z redakcją tokenów, kodów wyzwań i surowych danych wrażliwych.',
    requiredScopes: ['pap:mcp:read'],
    requiresCompanySelector: true,
    requiredCompanyAction: 'read',
    riskClassification: 'read_only',
    requiresIdempotencyKey: false,
    requiresIndependentHumanApproval: false,
  },
]);

export function resolveCompanyProfileSupportStatus(
  profile: CompanyTaxProfile,
  taxYear: number,
): McpCapabilityStatus {
  if (taxYear !== 2025 && taxYear !== 2026) {
    return 'unsupported';
  }
  if (profile.legalForm !== 'jdg' || profile.taxRegime === 'cit_klasyczny' || taxYear === 2025) {
    return 'experimental';
  }
  return 'supported';
}

export function evaluateCompanyCapabilities(
  profile: CompanyTaxProfile,
  taxYear: number,
): readonly CompanyCapabilityEntry[] {
  const baseSupport = resolveCompanyProfileSupportStatus(profile, taxYear);
  const yearSupported = baseSupport !== 'unsupported';

  const kpirStatus: McpCapabilityStatus = !yearSupported
    ? 'unsupported'
    : profile.taxRegime === 'kpir_skala' || profile.taxRegime === 'kpir_liniowy'
      ? baseSupport
      : 'unsupported';

  const ryczaltStatus: McpCapabilityStatus = !yearSupported
    ? 'unsupported'
    : profile.taxRegime === 'ryczalt'
      ? baseSupport
      : 'unsupported';

  const uorLedgerStatus: McpCapabilityStatus = !yearSupported
    ? 'unsupported'
    : profile.taxRegime === 'cit_klasyczny' && profile.legalForm === 'sp_z_o_o'
      ? baseSupport
      : 'unsupported';

  const jpkVatStatus: McpCapabilityStatus = !yearSupported
    ? 'unsupported'
    : profile.vatStatus === 'czynny'
      ? baseSupport
      : 'unsupported';

  const incomeJpkStatus: McpCapabilityStatus = !yearSupported ? 'unsupported' : 'experimental';

  return [
    {
      capabilityId: 'companies.discovery_and_profile',
      family: 'companies',
      titlePl: 'Odkrywanie firm, profili podatkowych i uprawnień',
      status: baseSupport,
      taxYear,
      applicableTools: ['list_my_companies', 'get_company_profile', 'list_available_capabilities'],
      requiresHumanApproval: false,
      limitationsPl:
        'Zwraca wyłącznie podmioty objęte aktywnym członkostwem i nieodwołanym grantem.',
      legalBasisCode: null,
    },
    {
      capabilityId: 'documents.invoicing_and_posting_proposals',
      family: 'documents',
      titlePl: 'Podgląd i przygotowanie propozycji faktur wielostawkowych oraz 0%/zw/np',
      status: baseSupport,
      taxYear,
      applicableTools: [
        'list_unpaid_invoices',
        'preview_invoice_posting',
        'prepare_invoice_and_posting_proposal',
        'confirm_prepared_proposal',
      ],
      requiresHumanApproval: true,
      limitationsPl:
        'Wymaga jawnej stawki VAT przy VAT=0 lub fakturach wielostawkowych (#112) oraz niezależnego zatwierdzenia człowieka.',
      legalBasisCode:
        profile.taxRegime === 'ryczalt'
          ? 'RYCZALT_PRZYCHOD_EWIDENCJA'
          : profile.taxRegime === 'cit_klasyczny'
            ? 'CIT_KUP_OGOLNE'
            : 'KUP_OGOLNE',
    },
    {
      capabilityId: 'ledger.kpir_bookkeeping',
      family: 'ledger',
      titlePl: 'Podatkowa Księga Przychodów i Rozchodów (PKPiR)',
      status: kpirStatus,
      taxYear,
      applicableTools: ['preview_invoice_posting', 'prepare_invoice_and_posting_proposal'],
      requiresHumanApproval: true,
      limitationsPl:
        kpirStatus === 'unsupported'
          ? 'Niedostępne dla bieżącego reżimu podatkowego firmy lub nieobsługiwanego roku podatkowego.'
          : 'Obsługuje kolumny PKPiR 2026 i limit 75% KUP pojazdów na danych syntetycznych pilota.',
      legalBasisCode: 'KUP_OGOLNE',
    },
    {
      capabilityId: 'ledger.ryczalt_revenue_register',
      family: 'ledger',
      titlePl: 'Ewidencja przychodów (ryczałt od przychodów ewidencjonowanych)',
      status: ryczaltStatus,
      taxYear,
      applicableTools: ['preview_invoice_posting', 'prepare_invoice_and_posting_proposal'],
      requiresHumanApproval: true,
      limitationsPl:
        ryczaltStatus === 'unsupported'
          ? 'Dostępne wyłącznie dla firm opodatkowanych ryczałtem w wspieranym roku podatkowym.'
          : 'Brak KUP w podatku dochodowym; odliczenie VAT dostępne wyłącznie dla czynnego podatnika VAT.',
      legalBasisCode: 'RYCZALT_PRZYCHOD_EWIDENCJA',
    },
    {
      capabilityId: 'ledger.uor_full_books_and_cit',
      family: 'ledger',
      titlePl: 'Pełne księgi rachunkowe (UoR) i CIT klasyczny',
      status: uorLedgerStatus,
      taxYear,
      applicableTools: ['preview_invoice_posting', 'prepare_invoice_and_posting_proposal'],
      requiresHumanApproval: true,
      limitationsPl:
        uorLedgerStatus === 'unsupported'
          ? 'Dostępne wyłącznie dla spółki z o.o. prowadzącej księgi rachunkowe w wspieranym roku podatkowym.'
          : 'Pilot syntetyczny sp. z o.o. bez konsolidacji grup kapitałowych i estońskiego CIT.',
      legalBasisCode: 'CIT_KUP_OGOLNE',
    },
    {
      capabilityId: 'tax.jpk_v7m_preview',
      family: 'tax',
      titlePl: 'Podgląd ewidencji i deklaracji JPK_V7M(3)',
      status: jpkVatStatus,
      taxYear,
      applicableTools: ['preview_jpk_export', 'get_monthly_tax_obligations'],
      requiresHumanApproval: true,
      limitationsPl:
        jpkVatStatus === 'unsupported'
          ? 'Podatnik zwolniony z VAT (art. 113 / art. 43) nie składa deklaracji JPK_V7M.'
          : 'Wyłącznie podgląd i walidacja robocza bez podpisu kwalifikowanego i bez wysyłki do MF.',
      legalBasisCode: 'JPK_V7M',
    },
    {
      capabilityId: 'tax.jpk_income_books_preview',
      family: 'tax',
      titlePl: 'Podgląd struktur JPK podatku dochodowego (JPK_PKPIR / JPK_EWP / JPK_KR_PD)',
      status: incomeJpkStatus,
      taxYear,
      applicableTools: ['preview_jpk_export'],
      requiresHumanApproval: true,
      limitationsPl:
        'Tryb eksperymentalny pilota syntetycznego — wymaga weryfikacji księgowej i odrębnego podpisu przed wysyłką.',
      legalBasisCode: null,
    },
    {
      capabilityId: 'bank.reconciliation_and_settlements',
      family: 'bank',
      titlePl: 'Uzgodnienia przelewów bankowych i rozrachunków PLN',
      status: baseSupport,
      taxYear,
      applicableTools: [
        'list_unreconciled_bank_transactions',
        'prepare_bank_reconciliation',
        'confirm_bank_reconciliation_proposal',
      ],
      requiresHumanApproval: true,
      limitationsPl:
        'Wyłącznie rozrachunki krajowe PLN bez zlecania przelewów wychodzących; confirm_bank_reconciliation_proposal wymaga aktywnego adaptera trwałego zapisu rozrachunków (w przeciwnym razie zwraca capability_unsupported bez pozornego zapisu w RAM).',
      legalBasisCode: null,
    },
    {
      capabilityId: 'ledger.month_close_workflow',
      family: 'ledger',
      titlePl: 'Checklista i przygotowanie zamknięcia okresu sprawozdawczego',
      status: baseSupport,
      taxYear,
      applicableTools: ['get_month_close_checklist', 'prepare_month_close'],
      requiresHumanApproval: true,
      limitationsPl:
        'Zamknięcie okresu wymaga zerowej liczby blokad i zatwierdzenia przez człowieka.',
      legalBasisCode: null,
    },
    {
      capabilityId: 'reporting.audit_lineage',
      family: 'reporting',
      titlePl: 'Ślad audytowy i pochodzenie decyzji z redakcją PII',
      status: baseSupport,
      taxYear,
      applicableTools: ['get_audit_lineage'],
      requiresHumanApproval: false,
      limitationsPl: 'Wszystkie tokeny, pełne numery NIP/PESEL i kody wyzwań są zredagowane.',
      legalBasisCode: null,
    },
    {
      capabilityId: 'hr.payroll_and_estonian_cit',
      family: 'tax',
      titlePl: 'Kadry i płace pracownicze, estoński CIT, OSS/IOSS i akcyza',
      status: 'unsupported',
      taxYear,
      applicableTools: [],
      requiresHumanApproval: true,
      limitationsPl:
        'Poza zakresem zweryfikowanego pilota (status unsupported — brak pozornej obsługi).',
      legalBasisCode: null,
    },
  ];
}
