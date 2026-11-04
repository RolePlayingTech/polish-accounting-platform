import { createRequire } from 'node:module';
import type { ReactElement } from 'react';
import type { renderToStaticMarkup as RenderToStaticMarkupFn } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  AcademyLessonView,
  ActionQueue,
  AiProposalField,
  AppShell,
  Card,
  CompanyPeriodHeader,
  CriticalConfirmDialog,
  DataTable,
  FormField,
  InteractiveQuiz,
  LedgerTable,
  LegalBasisPanel,
  MoneyAmount,
  ObligationTimeline,
  SplitVerificationView,
  StatusBadge,
  WhyTrigger,
  formatAccountingPeriod,
  formatCurrencyPln,
  formatNip,
  formatPolishDate,
  isValidNipChecksum,
  type LedgerColumn,
  type LegalBasisInfo,
} from '../src/index.js';

const requireFromWeb = createRequire(new URL('../../../apps/web/package.json', import.meta.url));
const { renderToStaticMarkup } = requireFromWeb('react-dom/server') as {
  renderToStaticMarkup: typeof RenderToStaticMarkupFn;
};

function renderHtml(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

const SAMPLE_LEGAL_BASIS: LegalBasisInfo = {
  title: 'Skala podatkowa PIT 12% z kwotą zmniejszającą podatek',
  provision:
    'Art. 27 ust. 1 ustawy z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
  journalReference: 'Dz.U. 2025 poz. 163 ze zm.',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ruleVersion: 'PIT-SCALE-2026.1',
  verificationStatus: 'verified_official',
  plainExplanation:
    'Do podstawy opodatkowania nieprzekraczającej 120 000 zł rocznie stosuje się stawkę 12% pomniejszoną o kwotę zmniejszającą podatek (300 zł miesięcznie przy złożonym PIT-2 / działalności).',
  calculationSteps: [
    {
      label: 'Dochód narastająco w październiku',
      formula: '18 500,00 PLN − 6 500,00 PLN',
      valueFormatted: '12 000,00 PLN',
    },
    {
      label: 'Podatek wg stawki 12% po odjęciu kwoty zmniejszającej',
      formula: '12 000,00 PLN × 12% − 300,00 PLN',
      valueFormatted: '1 140,00 PLN',
    },
  ],
  officialSourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
  officialSourceLabel: 'Otwórz ustawę o PIT w ISAP',
};

describe('Design System „Księga Współczesna” (@pap/ui)', () => {
  describe('formatowanie kwot PLN, dat, okresów i NIP (w tym scenariusze negatywne)', () => {
    it('formatuje kwoty z groszy bigint i liczb ze znakiem oraz walutą ISO bez błędów zmiennoprzecinkowych', () => {
      expect(formatCurrencyPln(1245075n)).toBe('12\u00A0450,75\u00A0PLN');
      expect(formatCurrencyPln(-35000n)).toBe('-350,00\u00A0PLN');
      expect(formatCurrencyPln(0n)).toBe('0,00\u00A0PLN');
      expect(formatCurrencyPln(49200, { inGrosze: true })).toBe('492,00\u00A0PLN');
      expect(formatCurrencyPln(1230.5)).toBe('1\u00A0230,50\u00A0PLN');
      expect(formatCurrencyPln(250000n, { currency: 'eur', signDisplay: 'always' })).toBe(
        '+2\u00A0500,00\u00A0EUR',
      );
    });

    it('odrzuca nieprawidłowe kwoty i błędne kody walut (scenariusze negatywne)', () => {
      expect(() => formatCurrencyPln(Number.NaN)).toThrow(RangeError);
      expect(() => formatCurrencyPln(Number.POSITIVE_INFINITY)).toThrow(RangeError);
      expect(() => formatCurrencyPln(12.34, { inGrosze: true })).toThrow(RangeError);
      expect(() => formatCurrencyPln(1000n, { currency: 'ZŁOTY' })).toThrow(RangeError);
    });

    it('formatuje polskie daty, okresy RRRR-MM i numery NIP oraz waliduje sumę kontrolną', () => {
      expect(formatPolishDate('2026-10-28')).toBe('28.10.2026');
      expect(formatPolishDate('2026-10-28', { style: 'medium' })).toBe('28 paź 2026');
      expect(formatAccountingPeriod('2026-10')).toBe('2026-10');
      expect(formatAccountingPeriod('2026-10', { style: 'long' })).toBe(
        'Październik 2026 (2026-10)',
      );

      expect(isValidNipChecksum('5261040828')).toBe(true);
      expect(isValidNipChecksum('PL 526-104-08-28')).toBe(true);
      expect(isValidNipChecksum('5261040829')).toBe(false);
      expect(formatNip('PL5261040828', { strict: true })).toBe('526-104-08-28');
    });

    it('odrzuca nieistniejące daty kalendarzowe, błędne okresy i fałszywy NIP w trybie strict', () => {
      expect(() => formatPolishDate('2026-02-30')).toThrow(RangeError);
      expect(() => formatAccountingPeriod('2026-13')).toThrow(RangeError);
      expect(() => formatNip('5261040829', { strict: true })).toThrow(RangeError);
      expect(() => formatNip('12345', { strict: true })).toThrow(RangeError);
    });
  });

  describe('Card, StatusBadge i MoneyAmount — kompatybilność wsteczna i WCAG (nie tylko kolor)', () => {
    it('renderuje wszystkie tony StatusBadge z tekstem po polsku oraz wbudowaną ikoną SVG', () => {
      const tones = [
        ['success', 'Zaksięgowano'],
        ['neutral', 'Planowane'],
        ['warning', 'Do sprawdzenia'],
        ['danger', 'Błąd walidacji'],
        ['info', 'Synchronizacja KSeF'],
        ['accent', 'Aktywny okres'],
        ['legal', 'Podstawa prawna'],
      ] as const;

      for (const [tone, label] of tones) {
        const html = renderHtml(<StatusBadge label={label} tone={tone} />);
        expect(html).toContain(label);
        expect(html).toContain(`data-status-tone="${tone}"`);
        expect(html).toContain(`data-tone-icon="${tone}"`);
        expect(html).toContain('aria-hidden="true"');
      }
    });

    it('zachowuje wsteczną kompatybilność Card oraz prezentuje MoneyAmount z tabular-nums i oznaczeniem zaległości', () => {
      const html = renderHtml(
        <Card eyebrow="Zestawienie" title="Podatek VAT">
          <MoneyAmount amount={184550n} inGrosze variant="overdue" />
        </Card>,
      );

      expect(html).toContain('Zestawienie');
      expect(html).toContain('Podatek VAT');
      expect(html).toContain('tabular-nums');
      expect(html).toContain('1\u00A0845');
      expect(html).toContain(',50');
      expect(html).toContain('PLN');
      expect(html).toContain('Zaległość');
    });
  });

  describe('AppShell i CompanyPeriodHeader — kontekst firmy, nawigacja i granice ADR-003', () => {
    it('renderuje pełną strukturę sekcji nawigacji, pasek kontekstu firmy/okresu oraz szufladę mobilną', () => {
      const html = renderHtml(
        <AppShell
          activeHref="/app/documents"
          contextHeader={
            <CompanyPeriodHeader
              companyName="Pracownia Projektowa „Rytm” Sp. z o.o."
              dataFreshnessLabel="Synchronizacja KSeF: 10:42"
              dataMode="synthetic"
              nip="5261040828"
              period="2026-10"
              taxProfileLabel="Sp. z o.o. · Pełne księgi · VAT czynny"
            />
          }
          defaultMobileMenuOpen
          pageEyebrow="Obieg dokumentów"
          pageTitle="Rejestr faktur zakupowych"
        >
          <p>Zawartość strony</p>
        </AppShell>,
      );

      // Pasek kontekstu firmy i okresu
      expect(html).toContain('Pracownia Projektowa „Rytm” Sp. z o.o.');
      expect(html).toContain('526-104-08-28');
      expect(html).toContain('2026-10');
      expect(html).toContain('Tryb syntetyczny');
      expect(html).toContain('Sp. z o.o. · Pełne księgi · VAT czynny');

      // Sekcje lewej nawigacji
      expect(html).toContain('Praca księgowa');
      expect(html).toContain('Pulpit');
      expect(html).toContain('Dokumenty');
      expect(html).toContain('KPiR / Ewidencja');
      expect(html).toContain('VAT i JPK');
      expect(html).toContain('Pełna księgowość');
      expect(html).toContain('Kalendarz podatkowy');
      expect(html).toContain('Finanse i bank');
      expect(html).toContain('Powiadomienia');
      expect(html).toContain('Centrum MCP');
      expect(html).toContain('Wiedza');
      expect(html).toContain('Akademia Księgowości');
      expect(html).toContain('Rejestr reguł prawnych');
      expect(html).toContain('Zarządzanie');
      expect(html).toContain('Firmy i uprawnienia');
      expect(html).toContain('Administracja');

      // Dostępność: skip-link, aria-current, aria-expanded, dialog mobilny
      expect(html).toContain('href="#main-content"');
      expect(html).toContain('aria-current="page"');
      expect(html).toContain('aria-expanded="true"');
      expect(html).toContain('role="dialog"');
    });

    it('wyświetla ostrzeżenie separacji uprawnień na powierzchni operatora /platform (ADR-003)', () => {
      const html = renderHtml(
        <AppShell activeHref="/platform" surface="platform">
          <p>Widok diagnostyczny</p>
        </AppShell>,
      );

      expect(html).toContain('data-surface="platform"');
      expect(html).toContain(
        'brak automatycznego dostępu do dokumentów, faktur i ksiąg podatkowych klientów',
      );
    });
  });

  describe('LedgerTable (DataTable) — kolumny liczbowe, karty mobilne i stany empty/loading/error/forbidden', () => {
    interface InvoiceRow {
      id: string;
      number: string;
      counterparty: string;
      grossGrosze: bigint;
      statusLabel: string;
    }

    const columns: readonly LedgerColumn<InvoiceRow>[] = [
      {
        id: 'number',
        header: 'Numer dokumentu',
        mobileRole: 'title',
        render: (row) => row.number,
      },
      {
        id: 'counterparty',
        header: 'Kontrahent',
        render: (row) => row.counterparty,
      },
      {
        id: 'status',
        header: 'Status',
        mobileRole: 'status',
        render: (row) => <StatusBadge label={row.statusLabel} size="sm" tone="warning" />,
      },
      {
        id: 'gross',
        header: 'Kwota brutto',
        unit: 'PLN',
        numeric: true,
        mobileRole: 'primaryAmount',
        render: (row) => <MoneyAmount amount={row.grossGrosze} inGrosze size="sm" />,
      },
    ];

    it('renderuje semantyczną tabelę z scope="col", jednostkami, przełącznikiem gęstości i kartami mobilnymi', () => {
      const rows: InvoiceRow[] = [
        {
          id: 'inv-1',
          number: 'FV/2026/10/01',
          counterparty: 'Syntetyczne Usługi Chmurowe Sp. z o.o.',
          grossGrosze: 123000n,
          statusLabel: 'Do weryfikacji',
        },
      ];

      const html = renderHtml(
        <DataTable
          caption="Rejestr dokumentów października 2026"
          columns={columns}
          getRowKey={(row) => row.id}
          rows={rows}
          title="Dokumenty kosztowe"
        />,
      );

      expect(html).toContain(
        '<caption class="sr-only">Rejestr dokumentów października 2026</caption>',
      );
      expect(html).toContain('scope="col"');
      expect(html).toContain('(PLN)');
      expect(html).toContain('Podstawowa');
      expect(html).toContain('Kompaktowa');
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('data-mobile-ledger-cards="true"');
      expect(html).toContain('FV/2026/10/01');
    });

    it('obsługuje dedykowane stany loading, empty, error i forbidden bez wycieku danych wierszy', () => {
      const secretRow: InvoiceRow = {
        id: 'secret-1',
        number: 'TAJNA-FAKTURA-OBCEJ-FIRMY',
        counterparty: 'Ukryty Kontrahent',
        grossGrosze: 999900n,
        statusLabel: 'Zaksięgowano',
      };

      const loadingHtml = renderHtml(
        <LedgerTable
          caption="Tabela ładowania"
          columns={columns}
          getRowKey={(r) => r.id}
          rows={[]}
          state="loading"
        />,
      );
      expect(loadingHtml).toContain('role="status"');
      expect(loadingHtml).toContain('aria-busy="true"');

      const emptyHtml = renderHtml(
        <LedgerTable
          caption="Pusta tabela"
          columns={columns}
          emptyState={{
            title: 'Brak faktur w październiku',
            description: 'Wgraj pierwszy plik PDF lub pobierz dokumenty z KSeF.',
            actionLabel: 'Dodaj pierwszą fakturę',
            actionHref: '/app/documents/upload',
          }}
          getRowKey={(r) => r.id}
          rows={[]}
        />,
      );
      expect(emptyHtml).toContain('Brak faktur w październiku');
      expect(emptyHtml).toContain('Dodaj pierwszą fakturę');

      const errorHtml = renderHtml(
        <LedgerTable
          caption="Tabela błędu"
          columns={columns}
          errorState={{
            message: 'Przekroczono limit czasu odpowiedzi API.',
            correlationId: 'req-synth-9912',
            onRetry: () => undefined,
          }}
          getRowKey={(r) => r.id}
          rows={[]}
          state="error"
        />,
      );
      expect(errorHtml).toContain('role="alert"');
      expect(errorHtml).toContain('req-synth-9912');
      expect(errorHtml).toContain('Ponów próbę');

      const forbiddenHtml = renderHtml(
        <LedgerTable
          caption="Tabela bez grantu"
          columns={columns}
          getRowKey={(r) => r.id}
          rows={[secretRow]}
          state="forbidden"
        />,
      );
      expect(forbiddenHtml).toContain('role="alert"');
      expect(forbiddenHtml).toContain('Brak uprawnień (grantu) do danych tej firmy');
      expect(forbiddenHtml).not.toContain('TAJNA-FAKTURA-OBCEJ-FIRMY');
    });
  });

  describe('ActionQueue, ObligationTimeline oraz panel „Dlaczego? / Podstawa prawna”', () => {
    it('renderuje kolejkę działań oraz oś terminów bez mylącego 0,00 PLN dla nieobsługiwanych obowiązków', () => {
      const queueHtml = renderHtml(
        <ActionQueue
          items={[
            {
              id: 'act-1',
              title: 'FV/10/2026/19 · Zakup paliwa do samochodu mieszanego',
              description: 'Sprawdź limit 50% odliczenia VAT oraz 75% KUP.',
              category: 'document_verify',
              urgency: 'attention',
              amountGrosze: 36900n,
              sourceLabel: 'OCR PDF',
              ctaLabel: 'Sprawdź dokument',
              href: '/app/documents/act-1',
            },
          ]}
        />,
      );
      expect(queueHtml).toContain('Masz 1 zadanie wymagające świadomej decyzji człowieka.');
      expect(queueHtml).toContain('Sprawdź dokument');

      const timelineHtml = renderHtml(
        <ObligationTimeline
          items={[
            {
              id: 'obl-1',
              dueDate: '2026-11-20',
              title: 'Zaliczka na podatek PIT (skala)',
              authority: 'US',
              status: 'due_soon',
              relativeLabel: 'Za 5 dni',
              amountGrosze: 114000n,
              legalBasis: SAMPLE_LEGAL_BASIS,
            },
            {
              id: 'obl-2',
              dueDate: '2026-11-25',
              title: 'Informacja podsumowująca VAT-UE',
              authority: 'US',
              status: 'not_applicable',
              relativeLabel: 'Brak transakcji WNT/WDT',
            },
          ]}
        />,
      );
      expect(timelineHtml).toContain('20.11.2026');
      expect(timelineHtml).toContain('Nie dotyczy aktywnego profilu firmy');
      expect(timelineHtml).toContain('Dlaczego? / Podstawa prawna');
    });

    it('rozwija panel „Dlaczego?” z przepisem, Dz.U., krokami obliczeń, statusem eksperta i blokuje niebezpieczne URL-e', () => {
      const expandedHtml = renderHtml(<WhyTrigger basis={SAMPLE_LEGAL_BASIS} defaultOpen />);

      expect(expandedHtml).toContain('aria-expanded="true"');
      expect(expandedHtml).toContain('Art. 27 ust. 1 ustawy');
      expect(expandedHtml).toContain('Dz.U. 2025 poz. 163 ze zm.');
      expect(expandedHtml).toContain('Zweryfikowano w źródle urzędowym');
      expect(expandedHtml).toContain('12 000,00 PLN × 12% − 300,00 PLN');
      expect(expandedHtml).toContain('https://isap.sejm.gov.pl/');
      expect(expandedHtml).toContain('rel="noopener noreferrer"');

      const unsafeBasis: LegalBasisInfo = {
        ...SAMPLE_LEGAL_BASIS,
        verificationStatus: 'requires_expert_review',
        officialSourceUrl: 'javascript:alert(1)',
      };
      const unsafeHtml = renderHtml(<LegalBasisPanel basis={unsafeBasis} />);
      expect(unsafeHtml).toContain('Wymaga kontroli eksperta');
      expect(unsafeHtml).not.toContain('javascript:alert');
      expect(unsafeHtml).toContain('dozwolone są wyłącznie zweryfikowane adresy HTTPS');
    });
  });

  describe('SplitVerificationView, AiProposalField, FormField i CriticalConfirmDialog', () => {
    it('oznacza propozycję AI, pokazuje różnicę względem decyzji człowieka, hash SHA-256 i blokadę Enter', () => {
      const html = renderHtml(
        <SplitVerificationView
          documentTitle="FV/10/2026/088 — Usługi doradcze"
          fileName="fv-2026-10-088.pdf"
          mimeLabel="PDF · 184 KB"
          sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
          sourceChannel="Upload ręczny"
          uploadedAtLabel="30.10.2026 09:15"
        >
          <AiProposalField
            confidence="medium"
            confidencePercent={78}
            id="net-amount"
            label="Kwota netto (PLN)"
            numeric
            proposedValue="1 000,00"
            value="1 200,00"
          />
          <FormField
            defaultHelpOpen
            error="Numer NIP kontrahenta ma nieprawidłową sumę kontrolną."
            fieldHelp={{
              fieldHelpId: 'counterparty-nip',
              title: 'Weryfikacja NIP na Białej Liście VAT',
              explanation:
                'Przed ujęciem faktury kosztowej sprawdź aktywny status VAT kontrahenta na dzień transakcji.',
              lessonTitle: 'Moduł 4: Faktura zakupowa i należyta staranność',
              lessonHref: '/app/academy/modul-4',
            }}
            hint="Wpisz 10 cyfr bez spacji lub w formacie XXX-XXX-XX-XX."
            id="nip-input"
            label="NIP sprzedawcy"
            required
          >
            {(controlProps) => <input {...controlProps} defaultValue="526-104-08-29" type="text" />}
          </FormField>
        </SplitVerificationView>,
      );

      expect(html).toContain('data-enter-submit-blocked="true"');
      expect(html).toContain('data-prevent-enter-submit="true"');
      expect(html).toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      expect(html).toContain('Propozycja AI / OCR');
      expect(html).toContain('Średnia pewność — sprawdź z oryginałem (78%)');
      expect(html).toContain('data-proposal-diff="modified"');
      expect(html).toContain('Skorygowano przez człowieka:');
      expect(html).toContain('1 000,00');
      expect(html).toContain('Zatwierdzane: 1 200,00');

      // FormField ARIA + FieldHelpButton
      expect(html).toContain('aria-invalid="true"');
      expect(html).toContain('aria-describedby="nip-input-hint nip-input-error"');
      expect(html).toContain('role="alert"');
      expect(html).toContain('data-field-help-id="counterparty-nip"');
      expect(html).toContain('Moduł 4: Faktura zakupowa i należyta staranność');
    });

    it('renderuje CriticalConfirmDialog z podsumowaniem firmy, okresu, kwoty i skutków audytowych', () => {
      const html = renderHtml(
        <CriticalConfirmDialog
          amountGrosze={492000n}
          auditConsequences={[
            'Pozycja otrzyma trwały numer porządkowy w KPiR za okres 2026-10.',
            'Zdarzenie zatwierdzenia zostanie zapisane w dzienniku audytu z identyfikatorem użytkownika.',
          ]}
          companyName="Pracownia Projektowa „Rytm” Sp. z o.o."
          confirmLabel="Zatwierdź i zaksięguj"
          description="Sprawdź poprawność podmiotu, okresu i kwoty przed zapisem księgowym."
          mcpMetadata={{
            clientName: 'Claude Desktop (MCP)',
            scope: 'accounting:draft:prepare',
            expiresAtLabel: '04.11.2026 12:00',
          }}
          nip="5261040828"
          onCancel={() => undefined}
          onConfirm={() => undefined}
          open
          operationType="mcp_approval"
          period="2026-10"
          title="Potwierdź zaksięgowanie propozycji MCP"
        />,
      );

      expect(html).toContain('role="alertdialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('526-104-08-28');
      expect(html).toContain('2026-10');
      expect(html).toContain('4\u00A0920');
      expect(html).toContain('Claude Desktop (MCP)');
      expect(html).toContain('Skutki księgowe i ślad audytowy');
    });
  });

  describe('AcademyLessonView i InteractiveQuiz — komponenty edukacyjne', () => {
    it('renderuje lekcję z przykładem liczbowym, typowymi błędami, ramką zrzutu aplikacji oraz quizem ze wskazówkami', () => {
      const html = renderHtml(
        <AcademyLessonView
          applicableProfiles={['JDG · KPiR', 'JDG · Ryczałt']}
          appScreenshot={{
            caption: 'Widok podzielonego ekranu weryfikacji faktury paliwowej.',
            appRoute: '/app/documents/verify',
            alt: 'Ekran weryfikacji faktury z odliczeniem 50% VAT',
            callouts: ['Hash SHA-256 po lewej', 'Porównanie propozycji AI z decyzją człowieka'],
          }}
          commonMistakes={[
            {
              mistake: 'Odliczenie 100% VAT od paliwa bez ewidencji przebiegu pojazdu (VAT-26).',
              consequence:
                'Zawyżenie podatku naliczonego i konieczność korekty JPK_V7M z odsetkami.',
              prevention:
                'Dla pojazdu używanego mieszanie wybieraj kwalifikację 50% VAT i 75% KUP.',
            },
          ]}
          lead="Poznaj praktyczne zasady rozliczania wydatków eksploatacyjnych samochodu osobowego."
          legalBasis={SAMPLE_LEGAL_BASIS}
          lessonTitle="Samochód osobowy w JDG: 50% VAT i 75% kosztów uzyskania przychodów"
          moduleLabel="Moduł 5 · Lekcja 3"
          numericExample={{
            title: 'Faktura za paliwo 369,00 PLN brutto (23% VAT)',
            scenario:
              'Przedsiębiorca (czynny podatnik VAT) wykorzystuje samochód osobowy w trybie mieszanym.',
            rows: [
              { label: 'Kwota netto na fakturze', amountGrosze: 30000n },
              { label: 'Podatek VAT 23% na fakturze', amountGrosze: 6900n },
              { label: 'VAT do odliczenia (50%)', amountGrosze: 3450n, highlight: true },
              {
                label: 'Koszt podatkowy KPiR — 75% z (netto + nieodliczony VAT)',
                amountGrosze: 25088n,
                highlight: true,
              },
            ],
            conclusion:
              'Nieodliczona połowa VAT powiększa bazę, od której liczymy 75% kosztu w KPiR.',
          }}
          quiz={{
            defaultShowHints: true,
            initialSelectedAnswers: { 'q-vat-car': 'opt-50' },
            questions: [
              {
                id: 'q-vat-car',
                question:
                  'Ile podatku VAT można odliczyć od zakupu paliwa do samochodu osobowego bez zgłoszenia VAT-26?',
                hint: 'Sprawdź art. 86a ust. 1 ustawy o VAT dotyczący użytku mieszanego.',
                correctOptionId: 'opt-50',
                legalNote: 'Art. 86a ust. 1 ustawy o VAT',
                options: [
                  {
                    id: 'opt-100',
                    label: '100% kwoty VAT z faktury',
                    explanation:
                      'Pełne odliczenie wymaga wyłącznego użytku firmowego, VAT-26 i kilometrówki.',
                  },
                  {
                    id: 'opt-50',
                    label: '50% kwoty VAT z faktury',
                    explanation:
                      'Tak — przy użytku mieszanym ustawowy limit odliczenia wynosi 50% VAT.',
                  },
                ],
              },
            ],
          }}
          readingTimeMinutes={8}
          relatedFieldHelpIds={['vat-car-50', 'kpir-col-13-car-75']}
        >
          <p>Treść wprowadzająca lekcji.</p>
        </AcademyLessonView>,
      );

      expect(html).toContain('Moduł 5 · Lekcja 3');
      expect(html).toContain('Faktura za paliwo 369,00 PLN brutto');
      expect(html).toContain('Typowe błędy i jak ich uniknąć');
      expect(html).toContain('/app/documents/verify');
      expect(html).toContain('vat-car-50');
      expect(html).toContain('Wynik: 1/1 (odpowiedziano: 1)');
      expect(html).toContain('Wskazówka:');
      expect(html).toContain('Poprawna odpowiedź');
    });

    it('pokazuje łagodny komunikat korekty i wyjaśnienie dla błędnej odpowiedzi w InteractiveQuiz', () => {
      const quizHtml = renderHtml(
        <InteractiveQuiz
          initialSelectedAnswers={{ 'q-kpir-date': 'wrong' }}
          questions={[
            {
              id: 'q-kpir-date',
              question:
                'Co jest datą poniesienia kosztu przy metodzie uproszczonej (kasowej) w KPiR?',
              hint: 'Sprawdź art. 22 ust. 6b ustawy o PIT.',
              correctOptionId: 'right',
              options: [
                {
                  id: 'wrong',
                  label: 'Zawsze data zapłaty przelewem bankowym',
                  explanation:
                    'Nie — w KPiR dniem poniesienia kosztu jest co do zasady dzień wystawienia faktury (art. 22 ust. 6b ustawy o PIT).',
                },
                {
                  id: 'right',
                  label: 'Dzień wystawienia faktury (rachunku) lub innego dowodu księgowego',
                  explanation:
                    'Poprawnie — decyduje data wystawienia dowodu stanowiącego podstawę zapisu.',
                },
              ],
            },
          ]}
        />,
      );

      expect(quizHtml).toContain('Wynik: 0/1 (odpowiedziano: 1)');
      expect(quizHtml).toContain('Sprawdź wyjaśnienie');
      expect(quizHtml).toContain('art. 22 ust. 6b ustawy o PIT');
    });
  });
});
