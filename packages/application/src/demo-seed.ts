import type {
  SandboxPersonaContract,
  SandboxTenantRoleLabelCode,
  TenantMemberRoleContract,
} from '@pap/contracts/api';
import type { TaxProfileConfigContract } from '@pap/contracts/accounting';
import type { PrepareInvoiceAndPostingProposalInput } from '@pap/contracts/mcp-tools';

export const TENANT_1_ID = '11111111-1111-4111-8111-111111111100' as const;
export const TENANT_2_ID = '22222222-2222-4222-8222-222222222200' as const;

export const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101' as const;
export const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102' as const;
export const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103' as const;
export const COMPANY_TENANT_2_ID = '22222222-2222-4222-8222-222222222201' as const;

// Aliasy wstecznej kompatybilności dla testów
export const DEMO_TENANT_ALPHA_ID = TENANT_1_ID;
export const DEMO_TENANT_BETA_ID = TENANT_2_ID;
export const DEMO_COMPANY_FIRMA_1_ID = COMPANY_JDG_KPIR_ID;
export const DEMO_COMPANY_FIRMA_2_ID = COMPANY_JDG_RYCZALT_ID;
export const DEMO_COMPANY_FIRMA_3_ID = COMPANY_SPZOO_ID;
export const DEMO_COMPANY_FIRMA_4_ID = COMPANY_TENANT_2_ID;

export const DEMO_USER_JAN_ID = '00000000-0000-4000-8000-000000000101' as const;
export const DEMO_USER_MARTA_ID = '00000000-0000-4000-8000-000000000102' as const;
export const DEMO_USER_PIOTR_ID = '00000000-0000-4000-8000-000000000201' as const;

export const DEMO_DEFAULT_PERIOD = '2026-03' as const;
export const DEMO_EVALUATION_DATE = '2026-04-18' as const;

/**
 * Syntetyczne numery NIP kontrahentów ze zweryfikowaną sumą kontrolną modulo 11 (`validatePolishNip` === true).
 * Wyłącznie dane fikcyjne — zero rzeczywistych danych osobowych.
 */
export const SYNTHETIC_COUNTERPARTY_NIPS = {
  klientSoftwareHouse: '5250002008',
  klientECommerce: '5250003002',
  dostawcaChmura: '5250004007',
  stacjaPaliwFlota: '5250005001',
  dostawcaSprzetu: '5250006006',
  klientRyczaltIt: '5210001008',
  kontrahentSpzoo: '5210002002',
} as const;

export type CanonicalPersonaId = 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny';
export type AcceptedPersonaIdAlias = CanonicalPersonaId | 'piotr-beta';

export interface DemoPersonaSeed {
  readonly personaId: CanonicalPersonaId;
  readonly aliases: readonly string[];
  readonly userId: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly role: TenantMemberRoleContract;
  readonly tenantRole: SandboxTenantRoleLabelCode;
  readonly defaultLegalEntityId: string;
  readonly roleLabelPl: string;
  readonly descriptionPl: string;
  readonly defaultScopes: readonly string[];
}

export const DEMO_PERSONAS_SEED: readonly DemoPersonaSeed[] = [
  {
    personaId: 'jan-testowy',
    aliases: ['jan-testowy'],
    userId: DEMO_USER_JAN_ID,
    subject: DEMO_USER_JAN_ID,
    displayName: 'Jan Testowy',
    email: 'jan.testowy@example.test',
    tenantId: TENANT_1_ID,
    tenantName: 'Grupa Projektowa Jan Testowy (Tenant 1)',
    role: 'tenant_owner',
    tenantRole: 'owner',
    defaultLegalEntityId: COMPANY_JDG_KPIR_ID,
    roleLabelPl: 'Właściciel organizacji (Tenant 1)',
    descriptionPl:
      'Pełny dostęp odczytu i zapisu (read + write) do wszystkich 3 syntetycznych firm w Tenant 1 oraz uprawnienia zarządzania dostępem.',
    defaultScopes: [
      'openid',
      'profile',
      'email',
      'pap:ui:full',
      'pap:accounting',
      'pap:mcp:read',
      'pap:mcp:prepare',
    ],
  },
  {
    personaId: 'marta-ksiegowa',
    aliases: ['marta-ksiegowa'],
    userId: DEMO_USER_MARTA_ID,
    subject: DEMO_USER_MARTA_ID,
    displayName: 'Marta Księgowa',
    email: 'marta.ksiegowa@example.test',
    tenantId: TENANT_1_ID,
    tenantName: 'Grupa Projektowa Jan Testowy (Tenant 1)',
    role: 'tenant_member',
    tenantRole: 'accountant',
    defaultLegalEntityId: COMPANY_JDG_KPIR_ID,
    roleLabelPl: 'Księgowa z delegowanym grantem',
    descriptionPl:
      'Delegowany dostęp księgowy w Tenant 1: pełny zapis (read + write) w firmie JDG KPiR oraz Sp. z o.o., wyłącznie odczyt (read-only) w firmie JDG Ryczałt.',
    defaultScopes: [
      'openid',
      'profile',
      'email',
      'pap:ui:accounting',
      'pap:accounting',
      'pap:mcp:read',
      'pap:mcp:prepare',
    ],
  },
  {
    personaId: 'piotr-izolacyjny',
    aliases: ['piotr-izolacyjny', 'piotr-beta'],
    userId: DEMO_USER_PIOTR_ID,
    subject: DEMO_USER_PIOTR_ID,
    displayName: 'Piotr Izolacyjny',
    email: 'piotr.izolacyjny@example.test',
    tenantId: TENANT_2_ID,
    tenantName: 'Przedsiębiorstwo Piotr Izolacyjny (Tenant 2)',
    role: 'tenant_owner',
    tenantRole: 'owner',
    defaultLegalEntityId: COMPANY_TENANT_2_ID,
    roleLabelPl: 'Właściciel odrębnego Tenant 2',
    descriptionPl:
      'Właściciel odizolowanego Tenant 2 do testów adwersarialnych izolacji między tenantami (odmowa 403 na wszystkich zasobach Tenant 1).',
    defaultScopes: [
      'openid',
      'profile',
      'email',
      'pap:ui:full',
      'pap:accounting',
      'pap:mcp:read',
      'pap:mcp:prepare',
    ],
  },
] as const;

export function resolveDemoPersonaSeed(personaIdOrAlias: string): DemoPersonaSeed | null {
  const normalized = personaIdOrAlias.trim().toLowerCase();
  for (const persona of DEMO_PERSONAS_SEED) {
    if (
      persona.personaId === normalized ||
      persona.aliases.includes(normalized) ||
      persona.userId.toLowerCase() === normalized ||
      persona.subject.toLowerCase() === normalized
    ) {
      return persona;
    }
  }
  return null;
}

export interface DemoCompanyGrantSeed {
  readonly grantId: string;
  readonly userId: string;
  readonly legalEntityId: string;
  readonly action: 'read' | 'write';
}

export interface DemoCompanySeedDefinition {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly displayName: string;
  readonly nip: string;
  readonly legalForm: 'jdg' | 'sp_z_o_o';
  readonly taxRegime: 'kpir_skala' | 'kpir_liniowy' | 'ryczalt' | 'cit_klasyczny';
  readonly vatStatusSimple: 'czynny' | 'zwolniony';
  readonly taxProfile: TaxProfileConfigContract;
}

export const DEMO_COMPANIES_SEED: readonly DemoCompanySeedDefinition[] = [
  {
    tenantId: TENANT_1_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    displayName: 'Pracownia Projektowa Jan Testowy',
    nip: '5250001003',
    legalForm: 'jdg',
    taxRegime: 'kpir_skala',
    vatStatusSimple: 'czynny',
    taxProfile: {
      profileCode: 'jdg_kpir_skala',
      supportLevel: 'supported',
      nip: '5250001003',
      regon: '140001003',
      companyName: 'Pracownia Projektowa Jan Testowy',
      activityStartDate: '2021-03-01',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'duzy_zus',
      voluntarySicknessInsurance: true,
      accidentRateBps: 167,
      insuredPersonsCount: 1,
      smallTaxpayer: true,
      ksefSales2024Above200M: false,
      ceidgRegisteredBefore2025: true,
    },
  },
  {
    tenantId: TENANT_1_ID,
    legalEntityId: COMPANY_JDG_RYCZALT_ID,
    displayName: 'Studio Kodowania Anna Przykładowa (Ryczałt)',
    nip: '5260002004',
    legalForm: 'jdg',
    taxRegime: 'ryczalt',
    vatStatusSimple: 'zwolniony',
    taxProfile: {
      profileCode: 'jdg_ryczalt',
      supportLevel: 'supported',
      nip: '5260002004',
      regon: '140002004',
      companyName: 'Studio Kodowania Anna Przykładowa (Ryczałt)',
      activityStartDate: '2025-02-01',
      vatStatus: 'zwolniony_art_113',
      vatSettlementPeriod: 'not_applicable',
      zusScheme: 'preferencyjny_zus',
      voluntarySicknessInsurance: true,
      accidentRateBps: 167,
      insuredPersonsCount: 1,
      smallTaxpayer: true,
      ksefSales2024Above200M: false,
      ceidgRegisteredBefore2025: false,
    },
  },
  {
    tenantId: TENANT_1_ID,
    legalEntityId: COMPANY_SPZOO_ID,
    displayName: 'Syntetyczna Technologia Test Sp. z o.o.',
    nip: '5210003007',
    legalForm: 'sp_z_o_o',
    taxRegime: 'cit_klasyczny',
    vatStatusSimple: 'czynny',
    taxProfile: {
      profileCode: 'spzoo_pelne_ksiegi',
      supportLevel: 'supported',
      nip: '5210003007',
      regon: '140003007',
      krs: '0000999103',
      companyName: 'Syntetyczna Technologia Test Sp. z o.o.',
      activityStartDate: '2022-01-10',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'not_applicable',
      voluntarySicknessInsurance: false,
      accidentRateBps: 167,
      insuredPersonsCount: 4,
      smallTaxpayer: true,
      ksefSales2024Above200M: false,
      krsRegisteredBefore2025: true,
    },
  },
  {
    tenantId: TENANT_2_ID,
    legalEntityId: COMPANY_TENANT_2_ID,
    displayName: 'Hurtownia Syntetyczna Piotr Izolacyjny',
    nip: '5270003005',
    legalForm: 'jdg',
    taxRegime: 'kpir_skala',
    vatStatusSimple: 'czynny',
    taxProfile: {
      profileCode: 'jdg_kpir_skala',
      supportLevel: 'supported',
      nip: '5270003005',
      regon: '140004005',
      companyName: 'Hurtownia Syntetyczna Piotr Izolacyjny',
      activityStartDate: '2023-06-01',
      vatStatus: 'czynny',
      vatSettlementPeriod: 'monthly',
      zusScheme: 'duzy_zus',
      voluntarySicknessInsurance: true,
      accidentRateBps: 167,
      insuredPersonsCount: 1,
      smallTaxpayer: true,
      ksefSales2024Above200M: false,
      ceidgRegisteredBefore2025: true,
    },
  },
] as const;

export const DEMO_INITIAL_GRANTS_SEED: readonly (DemoCompanyGrantSeed & {
  readonly tenantId: string;
})[] = [
  // Jan Testowy (Owner Tenant 1) — read + write na wszystkich 3 firmach Tenant 1
  {
    grantId: '00000000-0000-4000-8000-000000001001',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000001002',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    action: 'write',
  },
  {
    grantId: '00000000-0000-4000-8000-000000001003',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_JDG_RYCZALT_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000001004',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_JDG_RYCZALT_ID,
    action: 'write',
  },
  {
    grantId: '00000000-0000-4000-8000-000000001005',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_SPZOO_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000001006',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_JAN_ID,
    legalEntityId: COMPANY_SPZOO_ID,
    action: 'write',
  },
  // Marta Księgowa (Accountant w Tenant 1) — read+write na KPiR i Sp. z o.o., read-only na Ryczałcie!
  {
    grantId: '00000000-0000-4000-8000-000000002001',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_MARTA_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000002002',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_MARTA_ID,
    legalEntityId: COMPANY_JDG_KPIR_ID,
    action: 'write',
  },
  {
    grantId: '00000000-0000-4000-8000-000000002003',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_MARTA_ID,
    legalEntityId: COMPANY_JDG_RYCZALT_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000002004',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_MARTA_ID,
    legalEntityId: COMPANY_SPZOO_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000002005',
    tenantId: TENANT_1_ID,
    userId: DEMO_USER_MARTA_ID,
    legalEntityId: COMPANY_SPZOO_ID,
    action: 'write',
  },
  // Piotr Izolacyjny (Owner Tenant 2) — read+write na COMPANY_TENANT_2_ID, zero dostępu do Tenant 1
  {
    grantId: '00000000-0000-4000-8000-000000003001',
    tenantId: TENANT_2_ID,
    userId: DEMO_USER_PIOTR_ID,
    legalEntityId: COMPANY_TENANT_2_ID,
    action: 'read',
  },
  {
    grantId: '00000000-0000-4000-8000-000000003002',
    tenantId: TENANT_2_ID,
    userId: DEMO_USER_PIOTR_ID,
    legalEntityId: COMPANY_TENANT_2_ID,
    action: 'write',
  },
] as const;

export const DEMO_FIRMA_1_BANK_CSV = [
  'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
  '2026-03-14;2026-03-14;Syntetyczny Software House Sp. z o.o.;PL61109010140000071219812874;Zapłata za fakturę FV/2026/03/001 NIP 5250002008;24600,00;PLN;DEMO-CSV-TX-001',
  '2026-03-16;2026-03-16;Chmura Polska Infrastruktur Test S.A.;PL27114020040000300201355387;Opłata FV-CHMURA/03/2026 serwery produkcyjne;-1476,00;PLN;DEMO-CSV-TX-002',
  '2026-03-25;2026-03-25;Nieznany Nadawca Testowy;PL83102010260000140202763126;Przelew zaliczkowy do wyjaśnienia marzec 2026;1845,00;PLN;DEMO-CSV-TX-003',
].join('\n');

export const DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID = '00000000-0000-4000-8000-000000009101' as const;

export const DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_INPUT: PrepareInvoiceAndPostingProposalInput = {
  tenantId: TENANT_1_ID,
  legalEntityId: COMPANY_JDG_KPIR_ID,
  idempotencyKey: '00000000-0000-4000-8000-000000009102',
  invoice: {
    direction: 'purchase',
    invoiceNumber: 'FV-MCP/2026/03/77',
    counterpartyName: 'Narzędzia Deweloperskie Test Sp. z o.o.',
    counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
    issueDate: '2026-03-24',
    dueDate: '2026-04-07',
    netAmountPln: '1200.00',
    vatAmountPln: '276.00',
    grossAmountPln: '1476.00',
    expenseDescription: 'Subskrypcja licencji IDE i analizatora bezpieczeństwa kodu (marzec 2026)',
    suggestedCategory: 'uslugi_obce',
  },
};

export function buildSandboxPersonasManifest(issuer: string): readonly SandboxPersonaContract[] {
  void issuer;
  return DEMO_PERSONAS_SEED.map((persona) => {
    const tenantCompanies = DEMO_COMPANIES_SEED.filter((c) => c.tenantId === persona.tenantId);
    const companyAccess = tenantCompanies.map((comp) => {
      const userGrants = DEMO_INITIAL_GRANTS_SEED.filter(
        (g) => g.userId === persona.userId && g.legalEntityId === comp.legalEntityId,
      );
      return {
        tenantId: comp.tenantId,
        legalEntityId: comp.legalEntityId,
        displayName: comp.displayName,
        canRead: userGrants.some((g) => g.action === 'read'),
        canWrite: userGrants.some((g) => g.action === 'write'),
      };
    });

    return {
      personaId: persona.personaId,
      displayName: persona.displayName,
      email: persona.email,
      userId: persona.userId,
      subject: persona.subject,
      tenantId: persona.tenantId,
      tenantName: persona.tenantName,
      role: persona.role,
      tenantRole: persona.tenantRole,
      defaultLegalEntityId: persona.defaultLegalEntityId,
      roleLabelPl: persona.roleLabelPl,
      descriptionPl: persona.descriptionPl,
      defaultScopes: [...persona.defaultScopes],
      companyAccess,
    };
  });
}
