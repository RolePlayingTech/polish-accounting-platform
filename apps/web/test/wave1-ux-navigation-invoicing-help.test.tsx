import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { STANDARD_SPZOO_CHART_OF_ACCOUNTS } from '@pap/domain';
import { POST as postSessionContext } from '../app/api/session/context/route.js';
import { DocumentsWorkbench } from '../app/app/documents/documents-workbench.js';
import { IncompatibleRegimeGateCard } from '../components/regime-context-card.js';
import {
  PurchaseQualificationHelpNotice,
  RyczaltRateGuideTrigger,
  VatRateGuideTrigger,
} from '../components/tax-guide-drawer.js';
import {
  buildWorkspaceNavSections,
  findAccessibleCompaniesForBook,
  getCompanyCapabilities,
  isRouteCompatibleWithCompany,
  resolveCompatibleHrefAfterCompanySwitch,
} from '../lib/company-capabilities.js';
import {
  evaluateJournalSemanticWarnings,
  formatUserFacingErrorPl,
} from '../lib/error-messages-pl.js';
import { mustResolveUiFieldHelp } from '../lib/field-help.js';
import {
  CANONICAL_DOCUMENT_CSV_HEADERS,
  buildEmptyDocumentCsvTemplate,
  buildSampleDocumentJson,
  buildSampleMultiRateDocumentCsv,
  buildSampleSingleRateDocumentCsv,
} from '../lib/sample-import-templates.js';
import {
  RYCZALT_RATE_GUIDANCE_ITEMS,
  VAT_RATE_GUIDANCE_ITEMS,
  buildTemporalTaxContextGuide,
} from '../lib/tax-contextual-help.js';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  TENANT_1_ID,
  type CompanyProfileRecord,
} from '../lib/workspace-types.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

const MOCK_KPIR_COMPANY: CompanyProfileRecord = {
  tenantId: TENANT_1_ID,
  legalEntityId: COMPANY_JDG_KPIR_ID,
  companyName: 'Pracownia Projektowa Jan Testowy',
  shortName: 'Pracownia Projektowa',
  nip: '5250001003',
  regon: '142536475',
  address: 'ul. Wspólna 40, 00-684 Warszawa',
  iban: 'PL61109010140000071219812874',
  legalForm: 'jdg',
  profileCode: 'jdg_kpir_skala',
  profileLabelPl: 'JDG · KPiR (skala 12%/32%) · VAT czynny',
  vatStatus: 'czynny',
  vatSettlementPeriod: 'monthly',
  zusScheme: 'duzy_zus',
  voluntarySicknessInsurance: true,
  smallTaxpayer: true,
  activityStartDate: '2024-01-01',
  priorYearGrossSalesGrosze: 320_000_00,
  ytdPriorMonthsRevenueGrosze: 180_000_00,
  ytdPriorMonthsCostsGrosze: 45_000_00,
  grantedActions: ['read', 'write'],
};

const MOCK_RYCZALT_EXEMPT_COMPANY: CompanyProfileRecord = {
  ...MOCK_KPIR_COMPANY,
  legalEntityId: COMPANY_JDG_RYCZALT_ID,
  companyName: 'Studio Kodowania Anna Przykładowa',
  shortName: 'Studio Kodowania',
  nip: '5213004125',
  profileCode: 'jdg_ryczalt',
  profileLabelPl: 'JDG · Ryczałt ewidencjonowany · Zw. VAT art. 113',
  vatStatus: 'zwolniony_art_113',
  vatSettlementPeriod: 'not_applicable',
  zusScheme: 'preferencyjny_zus',
};

const MOCK_SPZOO_COMPANY: CompanyProfileRecord = {
  ...MOCK_KPIR_COMPANY,
  legalEntityId: COMPANY_SPZOO_ID,
  companyName: 'Syntetyczna Technologia Test Sp. z o.o.',
  shortName: 'Syntetyczna Technologia',
  nip: '7792301205',
  legalForm: 'sp_z_o_o',
  profileCode: 'spzoo_pelne_ksiegi',
  profileLabelPl: 'Sp. z o.o. · Pełne księgi UoR · VAT czynny',
  vatStatus: 'czynny',
  zusScheme: 'not_applicable',
};

describe('Wave 1 UX, profile-aware navigation, editable invoicing & Polish tax guidance', () => {
  it('#120: filtruje sekcje nawigacji wg profilu podatkowego i statusu VAT oraz wyznacza zgodną trasę po przełączeniu firmy', () => {
    const kpirSections = buildWorkspaceNavSections(MOCK_KPIR_COMPANY);
    const kpirHrefs = kpirSections[0]!.items.map((i) => i.href);
    expect(kpirHrefs).toContain('/app/kpir');
    expect(kpirHrefs).not.toContain('/app/ryczalt');
    expect(kpirHrefs).not.toContain('/app/ledger');
    expect(kpirSections[0]!.items.find((i) => i.id === 'vat')?.label).toBe(
      'Rejestry VAT i JPK_V7M',
    );
    expect(kpirSections[1]?.collapsible).toBe(true);
    expect(kpirSections[1]?.defaultCollapsed).toBe(true);

    const ryczaltSections = buildWorkspaceNavSections(MOCK_RYCZALT_EXEMPT_COMPANY);
    const ryczaltHrefs = ryczaltSections[0]!.items.map((i) => i.href);
    expect(ryczaltHrefs).toContain('/app/ryczalt');
    expect(ryczaltHrefs).not.toContain('/app/kpir');
    expect(ryczaltHrefs).not.toContain('/app/ledger');
    expect(ryczaltSections[0]!.items.find((i) => i.id === 'vat')?.label).toBe(
      'Status VAT i limit zwolnienia',
    );

    const spzooSections = buildWorkspaceNavSections(MOCK_SPZOO_COMPANY);
    const spzooHrefs = spzooSections[0]!.items.map((i) => i.href);
    expect(spzooHrefs).toContain('/app/ledger');
    expect(spzooHrefs).not.toContain('/app/kpir');
    expect(spzooHrefs).not.toContain('/app/ryczalt');

    expect(isRouteCompatibleWithCompany('/app/ledger', MOCK_KPIR_COMPANY)).toBe(false);
    expect(isRouteCompatibleWithCompany('/app/ledger', MOCK_SPZOO_COMPANY)).toBe(true);
    expect(resolveCompatibleHrefAfterCompanySwitch('/app/ledger', MOCK_KPIR_COMPANY)).toBe(
      '/app/kpir',
    );
    expect(resolveCompatibleHrefAfterCompanySwitch('/app/kpir', MOCK_RYCZALT_EXEMPT_COMPANY)).toBe(
      '/app/ryczalt',
    );
    expect(
      resolveCompatibleHrefAfterCompanySwitch('/app/documents', MOCK_SPZOO_COMPANY),
    ).toBeNull();
  });

  it('#102 & #115: renderuje edytowalny wielopozycyjny formularz faktury bez zaszytych danych CAD/NIP i bez fikcyjnego domyślnego NrKSeF', () => {
    const html = renderToStaticMarkup(
      <DocumentsWorkbench
        activeCompany={MOCK_KPIR_COMPANY}
        documents={[]}
        period="2026-03"
        canWrite={true}
        helpMap={{
          nip: mustResolveUiFieldHelp('nip'),
          ksefReference: mustResolveUiFieldHelp('ksef_reference'),
          gtuCode: mustResolveUiFieldHelp('gtu_code'),
          mpp: mustResolveUiFieldHelp('split_payment_mpp'),
        }}
      />,
    );

    // Zero zaszytych na sztywno danych w pustym formularzu ręcznym
    expect(html).not.toContain('Usługi doradztwa inżynieryjnego i licencje CAD');
    expect(html).not.toContain('Biuro Projektowe Syntetyka Sp. z o.o.');
    expect(html).not.toContain('5213004125-20261018-778899AABBCC-12');

    // Pełna obsługa stawek VAT (w tym np. i zw.) oraz przycisk dodawania pozycji
    expect(html).toContain('data-testid="invoice-multiline-editor"');
    expect(html).toContain('data-testid="add-invoice-line-button"');
    expect(html).toContain('value="np"');
    expect(html).toContain('value="zw"');
    // Domyślny znacznik KSeF to BFK (bez ukrytego pola z fałszywym NrKSeF)
    expect(html).not.toContain('id="manual-ksef-ref"');
  });

  it('#114: generuje kanoniczne szablony CSV (jednostawkowy i wielostawkowy) zgodne z wymaganymi nagłówkami i sumą netto + VAT === brutto', () => {
    for (const csv of [
      buildEmptyDocumentCsvTemplate('2026-03'),
      buildSampleSingleRateDocumentCsv('2026-03'),
      buildSampleMultiRateDocumentCsv('2026-03'),
    ]) {
      const lines = csv.trim().split('\n');
      expect(lines[0]).toBe(CANONICAL_DOCUMENT_CSV_HEADERS.join(';'));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const row of lines.slice(1)) {
        const cols = row.split(';');
        expect(cols).toHaveLength(CANONICAL_DOCUMENT_CSV_HEADERS.length);
        const net = Math.round(Number(cols[10]) * 100);
        const vat = Math.round(Number(cols[11]) * 100);
        const gross = Math.round(Number(cols[12]) * 100);
        expect(net + vat).toBe(gross);
      }
    }

    const multiRows = buildSampleMultiRateDocumentCsv('2026-03').trim().split('\n').slice(1);
    expect(multiRows).toHaveLength(3);
    expect(multiRows.map((r) => r.split(';')[9])).toEqual(['23', '5', '8']);

    const parsedJson = JSON.parse(buildSampleDocumentJson('2026-03')) as {
      lines: { vatRate: string; netGrosze: number; vatGrosze: number; grossGrosze: number }[];
    };
    expect(parsedJson.lines).toHaveLength(2);
    for (const l of parsedJson.lines) {
      expect(l.netGrosze + l.vatGrosze).toBe(l.grossGrosze);
    }
  });

  it('#105: tłumaczy surowe błędy Zod, SQL i sieciowe na zrozumiały język polski oraz zgłasza ostrzeżenia semantyczne kont', () => {
    expect(
      formatUserFacingErrorPl({
        status: 400,
        rawMessage: 'Too small: expected string to have >=1 characters',
      }),
    ).toContain('Uzupełnij wymagane pole tekstowe');

    expect(
      formatUserFacingErrorPl({
        status: 500,
        rawMessage:
          'PostgresError: SELECT * FROM accounting_entries WHERE id = $1\n    at Pool.query (/app/db.js:12:3)',
      }),
    ).not.toContain('SELECT');

    expect(
      formatUserFacingErrorPl({
        status: 400,
        rawMessage: '[{"code":"too_small","minimum":1,"type":"string","path":["description"]}]',
      }),
    ).not.toContain('"code"');

    const warnings = evaluateJournalSemanticWarnings(
      [
        { accountCode: '402', side: 'Wn', amountGrosze: 100_000, description: 'Usługi obce' },
        { accountCode: '221-2', side: 'Wn', amountGrosze: 50_000, description: 'VAT naliczony' },
        {
          accountCode: '010',
          side: 'Ma',
          amountGrosze: 150_000,
          description: 'Zobowiązanie wobec dostawcy',
        },
      ],
      STANDARD_SPZOO_CHART_OF_ACCOUNTS,
    );
    expect(warnings.some((w) => w.id.startsWith('payable-non-class2'))).toBe(true);
    expect(warnings.some((w) => w.id === 'vat-rate-proportion-check')).toBe(true);
  });

  it('#101 & #104: renderuje uczciwą bramkę reżimu wyłącznie dla realnych dostępnych firm i kieruje do /app/companies przy braku dopasowania', () => {
    expect(
      findAccessibleCompaniesForBook(
        [MOCK_KPIR_COMPANY, MOCK_RYCZALT_EXEMPT_COMPANY, MOCK_SPZOO_COMPANY],
        'full_ledger',
      ),
    ).toHaveLength(1);

    const htmlWithMatch = renderToStaticMarkup(
      <IncompatibleRegimeGateCard
        activeCompany={MOCK_KPIR_COMPANY}
        accessibleCompanies={[MOCK_KPIR_COMPANY, MOCK_SPZOO_COMPANY]}
        requiredBook="full_ledger"
      />,
    );
    expect(htmlWithMatch).toContain('Przełącz na: Syntetyczna Technologia Test Sp. z o.o.');
    expect(htmlWithMatch).toContain('/app/kpir');

    const htmlWithoutMatch = renderToStaticMarkup(
      <IncompatibleRegimeGateCard
        activeCompany={MOCK_KPIR_COMPANY}
        accessibleCompanies={[MOCK_KPIR_COMPANY]}
        requiredBook="full_ledger"
      />,
    );
    expect(htmlWithoutMatch).not.toContain('Przełącz na:');
    expect(htmlWithoutMatch).toContain('/app/companies');

    // Zgodny reżim nie renderuje ostrzeżenia
    const htmlCompatible = renderToStaticMarkup(
      <IncompatibleRegimeGateCard
        activeCompany={MOCK_SPZOO_COMPANY}
        accessibleCompanies={[MOCK_SPZOO_COMPANY]}
        requiredBook="full_ledger"
      />,
    );
    expect(htmlCompatible).toBe('');

    expect(getCompanyCapabilities(null).canWrite).toBe(false);
  });

  it('#101: /api/session/context działa w trybie fail-closed (503 poza zakresem żądania BFF) bez ujawniania surowych błędów', async () => {
    const req = new NextRequest('http://127.0.0.1:31680/api/session/context', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://127.0.0.1:31680',
        Host: '127.0.0.1:31680',
      },
      body: JSON.stringify({ demoCompanyCode: 'demo_spzoo_gamma' }),
    });
    const res = await postSessionContext(req);
    expect([401, 503]).toContain(res.status);
    const payload = (await res.json()) as { ok: boolean; error: string };
    expect(payload.ok).toBe(false);
    expect(payload.error).toMatch(/sesj/i);
    expect(payload.error).not.toContain('cookies was called outside');
  });

  it('#103: rozróżnia temporalnie limit zwolnienia VAT 200 000 PLN (2025) vs 240 000 PLN (2026) oraz 0% vs zw. vs np. i stawki ryczałtu PKWiU', () => {
    const guide2025 = buildTemporalTaxContextGuide('2025-11-15', 'jdg_ryczalt');
    const guide2026 = buildTemporalTaxContextGuide('2026-03-18', 'jdg_ryczalt');

    expect(guide2025.effectiveYear).toBe(2025);
    expect(guide2025.vatExemptionLimitPln).toBe(200_000);
    expect(guide2026.effectiveYear).toBe(2026);
    expect(guide2026.vatExemptionLimitPln).toBe(240_000);

    expect(VAT_RATE_GUIDANCE_ITEMS.map((i) => i.rate)).toEqual(['23', '8', '5', '0', 'zw', 'np']);
    expect(RYCZALT_RATE_GUIDANCE_ITEMS.some((r) => r.rate === '12')).toBe(true);

    const vatTriggerHtml = renderToStaticMarkup(
      <VatRateGuideTrigger selectedRate="23" eventDate="2026-03-18" />,
    );
    expect(vatTriggerHtml).toContain('Kiedy stosuje się tę stawkę?');

    const rycTriggerHtml = renderToStaticMarkup(
      <RyczaltRateGuideTrigger selectedRate="12" eventDate="2026-03-18" />,
    );
    expect(rycTriggerHtml).toContain('Stawka ryczałtu a rodzaj usługi / PKWiU');

    const purchaseNoticeHtml = renderToStaticMarkup(
      <PurchaseQualificationHelpNotice
        profileCode="jdg_kpir_skala"
        vatStatus="czynny"
        eventDate="2026-03-18"
      />,
    );
    expect(purchaseNoticeHtml).toContain('Dwie niezależne decyzje podatkowe przy zakupie');
    expect(purchaseNoticeHtml).toContain('art. 88');
  });
});
