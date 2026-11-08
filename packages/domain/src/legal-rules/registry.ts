import type { LegalRule, TaxProfileCode } from './types.js';

const ALL_PROFILES: readonly TaxProfileCode[] = [
  'jdg_kpir_skala',
  'jdg_kpir_liniowy',
  'jdg_ryczalt',
  'spzoo_pelne_ksiegi',
];

const KPIR_PROFILES: readonly TaxProfileCode[] = ['jdg_kpir_skala', 'jdg_kpir_liniowy'];

const JDG_PROFILES: readonly TaxProfileCode[] = [
  'jdg_kpir_skala',
  'jdg_kpir_liniowy',
  'jdg_ryczalt',
];

export const POLISH_LEGAL_RULES_REGISTRY: readonly LegalRule[] = [
  // 1. Ordynacja podatkowa — zaokrąglenia podatkowe art. 63 § 1
  {
    id: 'ordynacja-art-63-rounding-2025',
    ruleCode: 'ORDYNACJA_ART_63_TAX_ROUNDING',
    version: '2025.1',
    title: 'Zaokrąglanie podstaw opodatkowania i kwot podatków do pełnych złotych',
    description:
      'Podstawy opodatkowania oraz kwoty podatków zaokrągla się do pełnych złotych w ten sposób, że końcówki kwot wynoszące mniej niż 50 groszy pomija się, a końcówki kwot wynoszące 50 i więcej groszy podwyższa się do pełnych złotych.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
      journalReference: 'Dz.U. z 2025 r. poz. 111',
      article: 'art. 63 § 1',
      notes:
        'Nie stosuje się do kwot na fakturach VAT i zapisów w KPiR, które prowadzi się w złotych i groszach.',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000111',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Nie dotyczy opłat skarbowych/lokalnych oraz zryczałtowanego podatku od przychodów kapitałowych (art. 63 § 1a i § 2).',
      'Kwoty VAT na fakturach oraz księgowania w KPiR i księgach rachunkowych wykazuje się z dokładnością do 1 grosza.',
    ],
    referenceTestCases: [
      {
        id: 'tc-ord-63-below-50',
        description: 'Końcówka 49 gr pomijana w dół do pełnego złotego',
        eventDate: '2026-03-31',
        inputSummary: '1 200,49 zł (120049 gr)',
        expectedOutputSummary: '1 200 zł (120000 gr)',
      },
      {
        id: 'tc-ord-63-at-50',
        description: 'Końcówka 50 gr podwyższana w górę do pełnego złotego',
        eventDate: '2026-03-31',
        inputSummary: '1 200,50 zł (120050 gr)',
        expectedOutputSummary: '1 201 zł (120100 gr)',
      },
    ],
    parameters: {
      thresholdUpGrosze: 50,
    },
  },

  // 2. Ordynacja podatkowa — przesuwanie terminów z dni wolnych art. 12 § 5
  {
    id: 'ordynacja-art-12-deadline-shift-2025',
    ruleCode: 'ORDYNACJA_ART_12_DEADLINE_SHIFT',
    version: '2025.1',
    title: 'Przesunięcie terminu przypadającego na sobotę lub dzień ustawowo wolny od pracy',
    description:
      'Jeżeli ostatni dzień terminu przypada na sobotę lub dzień ustawowo wolny od pracy, za ostatni dzień terminu uważa się następny dzień po dniu lub dniach wolnych od pracy.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
      journalReference: 'Dz.U. z 2025 r. poz. 111',
      article: 'art. 12 § 5',
      notes:
        'Analogiczna zasada dla składek ZUS wynika z art. 31 ustawy o sus odsyłającego do art. 12 § 5 Ordynacji podatkowej.',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000111',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Nie dotyczy terminów materialnoprawnych o charakterze zawitym, jeżeli przepis szczególny wyłącza przesunięcie (np. niektóre oświadczenia o wyborze formy opodatkowania składane do 20. dnia miesiąca również podlegają art. 12 § 5).',
    ],
    referenceTestCases: [
      {
        id: 'tc-ord-12-weekend',
        description:
          'Termin 20. dnia miesiąca wypadający w niedzielę 2026-09-20 przesuwa się na poniedziałek 2026-09-21',
        eventDate: '2026-09-20',
        inputSummary: 'statutoryDueDate = 2026-09-20 (niedziela)',
        expectedOutputSummary: 'effectiveDueDate = 2026-09-21',
      },
    ],
  },

  // 3. Dni ustawowo wolne od pracy w Polsce (z uwzględnieniem wolnej Wigilii od 2025 r.)
  {
    id: 'statutory-holidays-pl-2025',
    ruleCode: 'STATUTORY_HOLIDAYS_POLAND',
    version: '2025.2',
    title: 'Katalog dni ustawowo wolnych od pracy w Polsce (w tym Wigilia 24 grudnia od 2025 r.)',
    description:
      'Określa święta stałe i ruchome (Wielkanoc, Poniedziałek Wielkanocny, Zielone Świątki, Boże Ciało) oraz ustanowienie 24 grudnia dniem wolnym od pracy od 1 lutego 2025 r.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 18 stycznia 1951 r. o dniach wolnych od pracy (ze zm. z dnia 6 grudnia 2024 r.)',
      journalReference: 'Dz.U. z 2024 r. poz. 1965',
      article: 'art. 1 pkt 1',
      notes:
        'Nowelizacja z 6 grudnia 2024 r. (Dz.U. 2024 poz. 1965) weszła w życie 1 lutego 2025 r., dodając 24 grudnia (Wigilię Bożego Narodzenia).',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001965',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-holiday-christmas-25',
        description:
          'Termin JPK_V7M 25 grudnia (I dzień Bożego Narodzenia) i 26 grudnia przesuwa się po świętach i weekendzie',
        eventDate: '2026-12-25',
        inputSummary: '2026-12-25 (piątek, Boże Narodzenie)',
        expectedOutputSummary: '2026-12-28 (poniedziałek)',
      },
    ],
    parameters: {
      christmasEveFreeFromYear: 2025,
    },
  },

  // 4. Stawki VAT 23%, 8%, 5%, 0%, zw., np.
  {
    id: 'vat-rates-2025-2026',
    ruleCode: 'VAT_RATES_STANDARD_AND_REDUCED',
    version: '2025.1',
    title: 'Stawki podatku od towarów i usług (23%, 8%, 5%, 0%, zw., np.)',
    description:
      'Stawka podstawowa VAT wynosi 23%, a stawki obniżone 8% i 5% (zgodnie z art. 41 ust. 1, 2 i 2a w zw. z art. 146ef ust. 1 ustawy o VAT).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2024 r. poz. 361 z późn. zm. (t.j. Dz.U. z 2025 r. poz. 775)',
      article: 'art. 41 ust. 1, ust. 2, ust. 2a oraz art. 146ef ust. 1 pkt 1–2',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Zastosowanie stawek 8%, 5%, 0% oraz zwolnienia przedmiotowego wymaga spełnienia warunków PKWiU/CN z załączników nr 3 i 10 lub warunków eksportu/WDT.',
    ],
    referenceTestCases: [
      {
        id: 'tc-vat-23-net-1000',
        description: 'Faktura 1 000,00 zł netto ze stawką 23%',
        eventDate: '2026-05-10',
        inputSummary: 'netto = 100 000 gr, stawka = 23%',
        expectedOutputSummary: 'VAT = 23 000 gr, brutto = 123 000 gr',
      },
    ],
    parameters: {
      standardRateBps: 2300,
      reducedRate8Bps: 800,
      reducedRate5Bps: 500,
    },
  },

  // 5A. Limit zwolnienia podmiotowego VAT 2025 (200 000 zł)
  {
    id: 'vat-exemption-limit-art-113-2025',
    ruleCode: 'VAT_EXEMPTION_LIMIT_ART_113',
    version: '2025.1',
    title: 'Limit zwolnienia podmiotowego VAT w 2025 r. (200 000 zł)',
    description:
      'Zwalnia się od podatku sprzedaż dokonywaną przez podatników, u których wartość sprzedaży nie przekroczyła łącznie w poprzednim ani bieżącym roku podatkowym kwoty 200 000 zł netto (w roku rozpoczęcia działalności — w proporcji do okresu prowadzenia działalności).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2024 r. poz. 361 z późn. zm.',
      article: 'art. 113 ust. 1, ust. 5, ust. 9 i ust. 13',
    },
    sourceUrl: 'https://www.podatki.gov.pl/vat/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Zwolnienia nie stosuje się do podatników wykonujących czynności z art. 113 ust. 13 (m.in. usługi prawnicze, doradcze, jubilerskie, ściąganie długów, towary akcyzowe, nowe środki transportu).',
      'Zwolnienie traci moc począwszy od czynności, którą przekroczono kwotę limitu (art. 113 ust. 5).',
    ],
    referenceTestCases: [
      {
        id: 'tc-vat-113-2025-full-year',
        description: 'Limit całoroczny w 2025 r. wynosi 200 000,00 zł',
        eventDate: '2025-06-15',
        inputSummary: 'działalność od 2024-01-01, sprzedaż 2025 = 195 000 zł',
        expectedOutputSummary: 'limit = 20 000 000 gr, status = within_limit',
      },
    ],
    parameters: {
      annualLimitGrosze: 20_000_000,
      daysInYear: 365,
    },
  },

  // 5B. Limit zwolnienia podmiotowego VAT od 2026-01-01 (240 000 zł)
  {
    id: 'vat-exemption-limit-art-113-2026',
    ruleCode: 'VAT_EXEMPTION_LIMIT_ART_113',
    version: '2026.1',
    title: 'Podwyższony limit zwolnienia podmiotowego VAT od 2026 r. (240 000 zł)',
    description:
      'Od 1 stycznia 2026 r. limit zwolnienia podmiotowego z VAT został podwyższony z 200 000 zł do 240 000 zł wartości sprzedaży netto (w pierwszym roku działalności liczony proporcjonalnie do liczby dni prowadzenia działalności).',
    scope: ALL_PROFILES,
    validFrom: '2026-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 24 czerwca 2025 r. o zmianie ustawy o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2025 r. poz. 896',
      article: 'art. 1 pkt 1 (zmieniający art. 113 ust. 1 i ust. 9 ustawy o VAT)',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000896',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Wyłączenia przedmiotowe i podmiotowe z art. 113 ust. 13 ustawy o VAT (m.in. usługi doradcze, prawnicze, jubilerskie) wykluczają zwolnienie niezależnie od obrotu.',
      'Przekroczenie limitu powoduje opodatkowanie całej czynności przekraczającej próg (art. 113 ust. 5).',
    ],
    referenceTestCases: [
      {
        id: 'tc-vat-113-2026-220k',
        description: 'Sprzedaż 220 000 zł w 2026 r. mieści się w nowym limicie 240 000 zł',
        eventDate: '2026-08-20',
        inputSummary: 'działalność od 2025-01-01, sprzedaż 2026 = 220 000 zł',
        expectedOutputSummary: 'limit = 24 000 000 gr, pozostało 2 000 000 gr',
      },
    ],
    parameters: {
      annualLimitGrosze: 24_000_000,
      daysInYear: 365,
    },
  },

  // 6. Odliczenie VAT 50% vs 100% od pojazdów samochodowych art. 86a
  {
    id: 'vat-vehicle-deduction-art-86a-2025',
    ruleCode: 'VAT_VEHICLE_DEDUCTION_ART_86A',
    version: '2025.1',
    title: 'Odliczenie 50% lub 100% VAT od wydatków na pojazdy samochodowe',
    description:
      'W przypadku wydatków związanych z pojazdami samochodowymi do 3,5 t wykorzystywanymi w trybie mieszanym kwotę podatku naliczonego stanowi 50% kwoty podatku z faktury. Odliczenie 100% wymaga wyłącznego użytku służbowego (ewidencja przebiegu, regulamin i zgłoszenie VAT-26 lub konstrukcyjnego wyłączenia z art. 86a ust. 4 pkt 2).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2025 r. poz. 775',
      article: 'art. 86a ust. 1, ust. 3 i ust. 4',
    },
    sourceUrl: 'https://www.podatki.gov.pl/vat/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Odliczenie 100% dla samochodu osobowego wymaga terminowego złożenia informacji VAT-26 oraz prowadzenia szczegółowej kilometrówki VAT.',
    ],
    referenceTestCases: [
      {
        id: 'tc-vat-86a-50pct',
        description:
          'Paliwo 200,00 zł netto + 46,00 zł VAT w użytku mieszanym daje 23,00 zł odliczenia VAT',
        eventDate: '2026-04-12',
        inputSummary: 'vatTotal = 4 600 gr, tryb = vehicle_mixed_50',
        expectedOutputSummary: 'deductible = 2 300 gr, nonDeductible = 2 300 gr',
      },
    ],
    parameters: {
      mixedDeductionBps: 5000,
      fullDeductionBps: 10000,
    },
  },

  // 7. Mechanizm Podzielonej Płatności MPP > 15 000 zł brutto art. 108a ust. 1a
  {
    id: 'vat-mpp-art-108a-2025',
    ruleCode: 'VAT_SPLIT_PAYMENT_MPP_ART_108A',
    version: '2025.1',
    title: 'Obowiązkowy Mechanizm Podzielonej Płatności (MPP) powyżej 15 000 zł brutto',
    description:
      'Przy dokonywaniu płatności za nabyte towary lub usługi wymienione w załączniku nr 15 do ustawy o VAT, udokumentowane fakturą, w której kwota należności ogółem przekracza kwotę 15 000 zł brutto, podatnicy mają obowiązek zastosowania mechanizmu podzielonej płatności.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2025 r. poz. 775',
      article: 'art. 108a ust. 1a oraz art. 106e ust. 1 pkt 18a',
    },
    sourceUrl:
      'https://www.podatki.gov.pl/vat/bezpieczna-transakcja/mechanizm-podzielonej-platnosci-mpp/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Obowiązek zachodzi wyłącznie wtedy, gdy wartość faktury brutto PRZEKRACZA 15 000,00 zł (tj. od 15 000,01 zł wzwyż) i co najmniej jedna pozycja należy do załącznika nr 15.',
    ],
    referenceTestCases: [
      {
        id: 'tc-vat-mpp-exact-15000',
        description: 'Faktura dokładnie na 15 000,00 zł brutto nie przekracza progu MPP',
        eventDate: '2026-02-10',
        inputSummary: 'gross = 1 500 000 gr, annex15 = true',
        expectedOutputSummary: 'mandatoryMpp = false',
      },
      {
        id: 'tc-vat-mpp-15000-01',
        description:
          'Faktura na 15 000,01 zł brutto z towarem z załącznika nr 15 objęta obowiązkowym MPP',
        eventDate: '2026-02-10',
        inputSummary: 'gross = 1 500 001 gr, annex15 = true',
        expectedOutputSummary: 'mandatoryMpp = true',
      },
    ],
    parameters: {
      thresholdGrossGroszeExclusive: 1_500_000,
    },
  },

  // 8A. Termin i schema JPK_V7 do 2026-01-31 — JPK_V7M(2) / JPK_V7K(2)
  {
    id: 'vat-jpk-v7-schema-v2-2025',
    ruleCode: 'VAT_JPK_V7_DEADLINE_AND_SCHEMA',
    version: '2025.1',
    title: 'Termin składania i struktura JPK_V7M(2) / JPK_V7K(2) do stycznia 2026 r.',
    description:
      'Czynni podatnicy VAT składają JPK_V7M / część ewidencyjną JPK_V7K do 25. dnia miesiąca następującego po każdym kolejnym miesiącu w wersji schemy (2).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2026-01-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      journalReference: 'Dz.U. z 2025 r. poz. 775',
      article: 'art. 99 ust. 1–3 i ust. 11c oraz art. 109 ust. 3b',
    },
    sourceUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/jpk-vat-z-deklaracja/',
    sourceType: 'schema',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-jpk-v7-jan-2026',
        description:
          'Rozliczenie za styczeń 2026 r. składane na schemie JPK_V7M(2) do 25 lutego 2026 r.',
        eventDate: '2026-01-31',
        inputSummary: 'period = 2026-01',
        expectedOutputSummary: 'schema = JPK_V7M(2), statutoryDueDay = 25',
      },
    ],
    parameters: {
      dueDayOfMonth: 25,
      schemaVersionM: 'JPK_V7M(2)',
      schemaVersionK: 'JPK_V7K(2)',
      requireKsefMarkers: false,
    },
  },

  // 8B. Termin i schema JPK_V7 od 2026-02-01 — JPK_V7M(3) / JPK_V7K(3)
  {
    id: 'vat-jpk-v7-schema-v3-2026',
    ruleCode: 'VAT_JPK_V7_DEADLINE_AND_SCHEMA',
    version: '2026.1',
    title: 'Termin składania i nowa struktura JPK_V7M(3) / JPK_V7K(3) od lutego 2026 r.',
    description:
      'Od rozliczenia za luty 2026 r. (I kwartał 2026 r.) obowiązuje struktura JPK_V7M(3) / JPK_V7K(3) wprowadzająca obowiązkowe oznaczenia powiązania z KSeF (NrKSeF, OFF, BFK, DI), składana do 25. dnia następnego miesiąca.',
    scope: ALL_PROFILES,
    validFrom: '2026-02-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Rozporządzenie Ministra Finansów i Gospodarki z dnia 12 grudnia 2025 r. zmieniające rozporządzenie w sprawie JPK_VAT z deklaracją',
      journalReference: 'Dz.U. z 2025 r. poz. 1800',
      article: '§ 1 oraz art. 99 ust. 11c i art. 109 ust. 3b ustawy o VAT',
    },
    sourceUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/jpk-vat-z-deklaracja/',
    sourceType: 'regulation',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-jpk-v7-feb-2026',
        description: 'Rozliczenie za luty 2026 r. wymaga struktury JPK_V7M(3) z oznaczeniem KSeF',
        eventDate: '2026-02-28',
        inputSummary: 'period = 2026-02',
        expectedOutputSummary: 'schema = JPK_V7M(3), requireKsefMarkers = true',
      },
    ],
    parameters: {
      dueDayOfMonth: 25,
      schemaVersionM: 'JPK_V7M(3)',
      schemaVersionK: 'JPK_V7K(3)',
      requireKsefMarkers: true,
    },
  },

  // 9A. Limit małego podatnika 2 mln EUR w 2025 r. (8 569 000 zł)
  {
    id: 'small-taxpayer-limit-2025',
    ruleCode: 'SMALL_TAXPAYER_LIMIT_2M_EUR',
    version: '2025.1',
    title: 'Limit statusu małego podatnika w 2025 r. (2 mln EUR = 8 569 000 zł brutto)',
    description:
      'Status małego podatnika w PIT, CIT i VAT w 2025 r. przysługuje podatnikom, których przychód ze sprzedaży z VAT w 2024 r. nie przekroczył 8 569 000 zł po zaokrągleniu do 1 000 zł (kurs NBP 4,2846 zł/EUR z 1 października 2024 r., tabela 191/A/NBP/2024). Uwaga: dla prawa do ryczałtu (art. 6 ust. 4 u.z.p.d.) limit 2 000 000 EUR przelicza się bez zaokrąglania do 1 000 zł i wynosi 8 569 200 zł przychodów netto.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle: 'Ustawa o CIT / Ustawa o PIT / Ustawa o VAT',
      journalReference: 'Dz.U. z 2025 r. poz. 278 (CIT), poz. 163 (PIT), poz. 775 (VAT)',
      article: 'art. 4a pkt 10 CIT / art. 5a pkt 20 PIT / art. 2 pkt 25 VAT',
    },
    sourceUrl: 'https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/tabela-a/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Dla ryczałtu od przychodów ewidencjonowanych limit 2 000 000 EUR z art. 6 ust. 4 przelicza się bez zaokrąglania do 1 000 zł (8 569 200 zł na 2025 r.).',
      'Dla przedsiębiorstw maklerskich i zarządzających funduszami w VAT obowiązuje odrębny limit prowizji 45 000 EUR.',
    ],
    referenceTestCases: [
      {
        id: 'tc-small-taxpayer-2025',
        description:
          'Przychód brutto z 2024 r. równy 8 500 000 zł zachowuje status małego podatnika na 2025 r.',
        eventDate: '2025-03-01',
        inputSummary: 'priorYearGrossSales = 850 000 000 gr',
        expectedOutputSummary: 'limit = 856 900 000 gr',
      },
    ],
    parameters: {
      limitGrossGrosze: 856_900_000,
      ryczaltExactLimitNetGrosze: 856_920_000,
      eurRateBps: 42846,
    },
  },

  // 9B. Limit małego podatnika 2 mln EUR w 2026 r. (8 517 000 zł)
  {
    id: 'small-taxpayer-limit-2026',
    ruleCode: 'SMALL_TAXPAYER_LIMIT_2M_EUR',
    version: '2026.1',
    title: 'Limit statusu małego podatnika w 2026 r. (2 mln EUR = 8 517 000 zł brutto)',
    description:
      'Status małego podatnika w PIT, CIT i VAT w 2026 r. przysługuje podatnikom, których przychód ze sprzedaży z VAT w 2025 r. nie przekroczył 8 517 000 zł po zaokrągleniu do 1 000 zł (kurs NBP 4,2586 zł/EUR z 1 października 2025 r., tabela 190/A/NBP/2025). Uwaga: dla prawa do ryczałtu (art. 6 ust. 4 u.z.p.d.) limit 2 000 000 EUR przelicza się bez zaokrąglania do 1 000 zł i wynosi 8 517 200 zł przychodów netto.',
    scope: ALL_PROFILES,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle: 'Ustawa o CIT / Ustawa o PIT / Ustawa o VAT',
      journalReference: 'Dz.U. z 2025 r. poz. 278 (CIT), poz. 163 (PIT), poz. 775 (VAT)',
      article: 'art. 4a pkt 10 CIT / art. 5a pkt 20 PIT / art. 2 pkt 25 VAT',
    },
    sourceUrl: 'https://nbp.pl/statystyka-i-sprawozdawczosc/kursy/tabela-a/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Dla ryczałtu od przychodów ewidencjonowanych limit 2 000 000 EUR z art. 6 ust. 4 przelicza się bez zaokrąglania do 1 000 zł (8 517 200 zł na 2026 r.).',
      'W CIT 9% dodatkowo wymagane jest nieprzekroczenie równowartości 2 mln EUR netto przychodów bieżących (art. 19 ust. 1 pkt 2 CIT).',
    ],
    referenceTestCases: [
      {
        id: 'tc-small-taxpayer-2026',
        description: 'Limit małego podatnika w 2026 r. wynosi 8 517 000 zł',
        eventDate: '2026-03-01',
        inputSummary: 'priorYearGrossSales = 851 700 000 gr',
        expectedOutputSummary: 'limit = 851 700 000 gr',
      },
    ],
    parameters: {
      limitGrossGrosze: 851_700_000,
      ryczaltExactLimitNetGrosze: 851_720_000,
      eurRateBps: 42586,
    },
  },

  // 10. Skala podatkowa PIT art. 27 ust. 1 (12% / 32%, kwota wolna 30 000 zł)
  {
    id: 'pit-tax-scale-art-27-2025-2026',
    ruleCode: 'PIT_TAX_SCALE_ART_27',
    version: '2025.1',
    title: 'Skala podatkowa PIT: 12% do 120 000 zł (kwota wolna 30 000 zł) i 32% ponad 120 000 zł',
    description:
      'Podatek dochodowy na zasadach ogólnych wynosi: do 120 000 zł podstawy obliczenia podatku — 12% minus kwota zmniejszająca podatek 3 600 zł (co odpowiada kwocie wolnej 30 000 zł); ponad 120 000 zł — 10 800 zł + 32% nadwyżki ponad 120 000 zł.',
    scope: ['jdg_kpir_skala'],
    validFrom: '2025-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      journalReference: 'Dz.U. z 2025 r. poz. 163',
      article: 'art. 27 ust. 1 oraz art. 44 ust. 3',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000163',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Składka zdrowotna płacona przy skali podatkowej (9%) nie podlega odliczeniu ani od dochodu, ani zaliczeniu do KUP.',
      'Rozliczenie wspólne z małżonkiem lub jako osoba samotnie wychowująca dziecko następuje w zeznaniu rocznym PIT-36 (art. 6).',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-scale-below-30k',
        description:
          'Dochód narastająco 25 000 zł mieści się w kwocie wolnej 30 000 zł — zaliczka 0 zł',
        eventDate: '2026-03-31',
        inputSummary: 'podstawa = 25 000 zł',
        expectedOutputSummary: 'zaliczka = 0 zł',
      },
      {
        id: 'tc-pit-scale-above-120k',
        description:
          'Podstawa 150 000 zł: 10 800 zł + 32% * 30 000 zł = 20 400 zł podatku narastająco',
        eventDate: '2026-10-31',
        inputSummary: 'podstawa = 150 000 zł',
        expectedOutputSummary: 'podatek narastająco = 20 400 zł (2 040 000 gr)',
      },
    ],
    parameters: {
      taxFreeBaseGrosze: 3_000_000,
      taxReducingAmountGrosze: 360_000,
      firstBracketLimitGrosze: 12_000_000,
      firstBracketRateBps: 1200,
      secondBracketRateBps: 3200,
      firstBracketFullTaxGrosze: 1_080_000,
    },
  },

  // 11. Podatek liniowy 19% art. 30c
  {
    id: 'pit-flat-tax-art-30c-2025-2026',
    ruleCode: 'PIT_FLAT_TAX_ART_30C',
    version: '2025.1',
    title: 'Podatek liniowy PIT 19% dla pozarolniczej działalności gospodarczej',
    description:
      'Podatek dochodowy od dochodów z pozarolniczej działalności gospodarczej opodatkowanych liniowo wynosi 19% podstawy obliczenia podatku (bez kwoty wolnej od podatku).',
    scope: ['jdg_kpir_liniowy'],
    validFrom: '2025-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      journalReference: 'Dz.U. z 2025 r. poz. 163',
      article: 'art. 30c ust. 1 i ust. 2',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000163',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Wykluczone przy świadczeniu usług na rzecz byłego lub obecnego pracodawcy odpowiadających czynnościom z umowy o pracę w tym samym roku podatkowym (art. 9a ust. 3).',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-flat-100k',
        description: 'Podstawa 100 000 zł na podatku liniowym daje 19 000 zł podatku',
        eventDate: '2026-06-30',
        inputSummary: 'podstawa = 100 000 zł',
        expectedOutputSummary: 'podatek = 19 000 zł (1 900 000 gr)',
      },
    ],
    parameters: {
      flatRateBps: 1900,
    },
  },

  // 12A. Limit odliczenia składki zdrowotnej na podatku liniowym w 2025 r. (12 900 zł)
  {
    id: 'pit-flat-health-limit-2025',
    ruleCode: 'PIT_FLAT_HEALTH_DEDUCTION_LIMIT',
    version: '2025.1',
    title: 'Limit odliczenia składki zdrowotnej na podatku liniowym w 2025 r. (12 900 zł)',
    description:
      'Łączna wysokość składek na ubezpieczenie zdrowotne zaliczonych do KUP lub odliczonych od dochodu na podatku liniowym w 2025 r. nie może przekroczyć 12 900 zł.',
    scope: ['jdg_kpir_liniowy'],
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle:
        'Obwieszczenie Ministra Finansów z dnia 17 grudnia 2024 r. w sprawie wysokości kwoty składek na ubezpieczenie zdrowotne w 2025 r.',
      journalReference:
        'M.P. z 2024 r. poz. 1084 (w zw. z art. 23 ust. 1 pkt 58 i art. 30c ust. 2 pkt 2 ustawy o PIT)',
      article: 'art. 30c ust. 2 pkt 2 i ust. 2b ustawy o PIT',
    },
    sourceUrl: 'https://www.podatki.gov.pl/pit/',
    sourceType: 'official_guidance',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Limit 12 900 zł jest łączny dla składek ujętych w kosztach uzyskania przychodów (KUP) oraz odliczanych od podstawy opodatkowania.',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-flat-health-2025-cap',
        description:
          'Zapłacone 15 000 zł składki zdrowotnej w 2025 r. zostaje ograniczone do 12 900 zł',
        eventDate: '2025-11-30',
        inputSummary: 'paidHealth = 1 500 000 gr',
        expectedOutputSummary: 'deductibleHealth = 1 290 000 gr',
      },
    ],
    parameters: {
      annualLimitGrosze: 1_290_000,
    },
  },

  // 12B. Limit odliczenia składki zdrowotnej na podatku liniowym w 2026 r. (14 100 zł)
  {
    id: 'pit-flat-health-limit-2026',
    ruleCode: 'PIT_FLAT_HEALTH_DEDUCTION_LIMIT',
    version: '2026.1',
    title: 'Limit odliczenia składki zdrowotnej na podatku liniowym w 2026 r. (14 100 zł)',
    description:
      'Łączna wysokość składek na ubezpieczenie zdrowotne zaliczonych do KUP lub odliczonych od dochodu na podatku liniowym w 2026 r. nie może przekroczyć 14 100 zł.',
    scope: ['jdg_kpir_liniowy'],
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle:
        'Obwieszczenie Ministra Finansów z dnia 12 grudnia 2025 r. w sprawie wysokości kwoty składek na ubezpieczenie zdrowotne w 2026 r.',
      journalReference:
        'M.P. z 2025 r. poz. 1274 (w zw. z art. 23 ust. 1 pkt 58 i art. 30c ust. 2 pkt 2 ustawy o PIT)',
      article: 'art. 30c ust. 2 pkt 2 i ust. 2b ustawy o PIT',
    },
    sourceUrl: 'https://www.podatki.gov.pl/pit/',
    sourceType: 'official_guidance',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Limit 14 100 zł jest łączny dla składek ujętych w KUP oraz odliczanych bezpośrednio od dochodu.',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-flat-health-2026-cap',
        description:
          'Zapłacone 16 000 zł składki zdrowotnej w 2026 r. zostaje ograniczone do 14 100 zł',
        eventDate: '2026-11-30',
        inputSummary: 'paidHealth = 1 600 000 gr',
        expectedOutputSummary: 'deductibleHealth = 1 410 000 gr',
      },
    ],
    parameters: {
      annualLimitGrosze: 1_410_000,
    },
  },

  // 13. Termin zaliczek PIT art. 44 ust. 6
  {
    id: 'pit-advance-deadline-art-44-2025',
    ruleCode: 'PIT_ADVANCE_DEADLINE_ART_44',
    version: '2025.1',
    title: 'Termin wpłaty zaliczek miesięcznych i kwartalnych na podatek dochodowy PIT',
    description:
      'Zaliczki miesięczne (i kwartalne) od dochodów z działalności gospodarczej wpłaca się w terminie do 20. dnia każdego miesiąca za miesiąc poprzedni (za grudzień / IV kwartał — do 20 stycznia następnego roku podatkowego).',
    scope: KPIR_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      journalReference: 'Dz.U. z 2025 r. poz. 163',
      article: 'art. 44 ust. 6',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000163',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Podatnik może nie wpłacać zaliczki, jeżeli podatek należny od dochodu osiągniętego od początku roku pomniejszony o sumę zaliczek nie przekracza 1 000 zł (art. 44 ust. 15 — dobrowolne zwolnienie z wpłaty bieżącej).',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-44-due-day-20',
        description: 'Zaliczka PIT za marzec 2026 r. płatna do 20 kwietnia 2026 r.',
        eventDate: '2026-03-31',
        inputSummary: 'period = 2026-03',
        expectedOutputSummary: 'dueDate = 2026-04-20',
      },
    ],
    parameters: {
      dueDayOfMonth: 20,
    },
  },

  // 14A. Rozporządzenie PKPiR w 2025 r. (Dz.U. 2019 poz. 2544 — 17 kolumn)
  {
    id: 'kpir-regulation-2019-2025',
    ruleCode: 'KPIR_REGULATION_COLUMNS',
    version: '2019.1',
    title: 'Prowadzenie PKPiR w 2025 r. (wzór 17-kolumnowy)',
    description:
      'Określa zasady prowadzenia podatkowej księgi przychodów i rozchodów do 31 grudnia 2025 r. z podziałem na przychody (kol. 7, 8, 9) oraz koszty (kol. 10, 11, 12, 13, 14) i koszty B+R (kol. 16).',
    scope: KPIR_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle:
        'Rozporządzenie Ministra Finansów z dnia 23 grudnia 2019 r. w sprawie prowadzenia podatkowej księgi przychodów i rozchodów',
      journalReference: 'Dz.U. z 2019 r. poz. 2544 z późn. zm.',
      article: '§ 2, § 11 oraz Załącznik nr 1',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20190002544',
    sourceType: 'regulation',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-kpir-2025-reg',
        description: 'Wpis z 2025 r. kwalifikowany wg wzoru rozporządzenia z 2019 r.',
        eventDate: '2025-09-15',
        inputSummary: 'eventDate = 2025-09-15',
        expectedOutputSummary: 'regulationVersion = pkpir_2019_17col',
      },
    ],
    parameters: {
      regulationVersion: 'pkpir_2019_17col',
    },
  },

  // 14B. Nowe rozporządzenie PKPiR od 2026-01-01 (Dz.U. 2025 poz. 1299)
  {
    id: 'kpir-regulation-2026',
    ruleCode: 'KPIR_REGULATION_COLUMNS',
    version: '2026.1',
    title:
      'Nowe rozporządzenie w sprawie prowadzenia PKPiR od 1 stycznia 2026 r. (19 kolumn, KSeF i JPK_PKPIR)',
    description:
      'Od 1 stycznia 2026 r. obowiązuje nowe 19-kolumnowe rozporządzenie PKPiR dostosowane do KSeF i JPK_PKPIR, dodające kol. 3 (numer identyfikujący fakturę w KSeF) oraz kol. 5 (identyfikator podatkowy NIP kontrahenta) i przesuwające przychody do kol. 9–11 oraz wydatki do kol. 12–16 (B+R w kol. 18, uwagi w kol. 19).',
    scope: KPIR_PROFILES,
    validFrom: '2026-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Rozporządzenie Ministra Finansów i Gospodarki z dnia 6 września 2025 r. w sprawie prowadzenia podatkowej księgi przychodów i rozchodów',
      journalReference: 'Dz.U. z 2025 r. poz. 1299',
      article: '§ 2, § 6 oraz Załącznik nr 1',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250001299',
    sourceType: 'regulation',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Numer KSeF podaje się wyłącznie wtedy, gdy dowód księgowy został wystawiony przy użyciu Krajowego Systemu e-Faktur.',
    ],
    referenceTestCases: [
      {
        id: 'tc-kpir-2026-reg',
        description:
          'Wpis z 2026 r. kwalifikowany wg nowego rozporządzenia PKPiR Dz.U. 2025 poz. 1299',
        eventDate: '2026-02-15',
        inputSummary: 'eventDate = 2026-02-15, ksefReferenceNumber = obecny',
        expectedOutputSummary: 'regulationVersion = pkpir_2026_ksef',
      },
    ],
    parameters: {
      regulationVersion: 'pkpir_2026_ksef',
    },
  },

  // 15. Samochód osobowy w użytku mieszanym 75% KUP + nieodliczone 50% VAT
  {
    id: 'pit-car-mixed-75-art-23-2025',
    ruleCode: 'PIT_CAR_MIXED_EXPENSE_75_ART_23',
    version: '2025.1',
    title:
      'Ograniczenie do 75% KUP wydatków eksploatacyjnych samochodu osobowego w użytku mieszanym',
    description:
      'Z kosztów uzyskania przychodów wyłącza się 25% poniesionych wydatków z tytułu używania samochodu osobowego wykorzystywanego również do celów niezwiązanych z działalnością gospodarczą (75% stanowi KUP). Podstawę 75% powiększa nieodliczona na podstawie art. 86a ustawy o VAT połowa podatku VAT.',
    scope: KPIR_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      journalReference: 'Dz.U. z 2025 r. poz. 163',
      article: 'art. 23 ust. 1 pkt 46a oraz art. 23 ust. 1 pkt 43 lit. a',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000163',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Składki na ubezpieczenie AC samochodu osobowego podlegają odrębnemu limitowi proporcjonalnemu do wartości 150 000 zł (art. 23 ust. 1 pkt 47).',
      'Opłaty leasingowe części kapitałowej podlegają limitowi 150 000 zł / 225 000 zł EV (lub od 2026 r. zróżnicowanym limitom emisji CO2: 100 000 zł / 150 000 zł / 225 000 zł — art. 23 ust. 1 pkt 47a).',
    ],
    referenceTestCases: [
      {
        id: 'tc-pit-car-75-active-vat',
        description:
          'Faktura 200,00 zł netto + 46,00 zł VAT: 50% nieodliczonego VAT = 23,00 zł; 75% z 223,00 zł = 167,25 zł KUP',
        eventDate: '2026-04-12',
        inputSummary: 'netto = 20 000 gr, nonDeductibleVat = 2 300 gr',
        expectedOutputSummary: 'kupCol13 = 16 725 gr (167,25 zł)',
      },
    ],
    parameters: {
      deductibleExpenseBps: 7500,
    },
  },

  // 16. Wyłączenia z KUP (NKUP) art. 23 ust. 1
  {
    id: 'pit-nkup-exclusions-art-23-2025',
    ruleCode: 'PIT_NKUP_EXCLUSIONS_ART_23',
    version: '2025.1',
    title: 'Wyłączenia wydatków z kosztów uzyskania przychodów (NKUP — art. 23 ust. 1)',
    description:
      'Nie uważa się za koszty uzyskania przychodów m.in. kosztów reprezentacji (w szczególności usług gastronomicznych, zakupu żywności i napojów, w tym alkoholowych — pkt 23), grzywien i kar pieniężnych (pkt 15) oraz odsetek za zwłokę od zaległości budżetowych (pkt 18).',
    scope: KPIR_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      journalReference: 'Dz.U. z 2025 r. poz. 163',
      article: 'art. 23 ust. 1 pkt 15, pkt 18, pkt 23',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000163',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-pit-nkup-representation',
        description: 'Wydatek na reprezentację 500,00 zł daje 0,00 zł KUP',
        eventDate: '2026-05-05',
        inputSummary: 'netto = 50 000 gr, qualification = nkup_excluded',
        expectedOutputSummary: 'kup = 0 gr',
      },
    ],
  },

  // 17. Ryczałt od przychodów ewidencjonowanych — stawki art. 12 ust. 1
  {
    id: 'ryczalt-rates-art-12-2025',
    ruleCode: 'RYCZALT_RATES_ART_12',
    version: '2025.1',
    title: 'Stawki ryczałtu od przychodów ewidencjonowanych (art. 12 ust. 1)',
    description:
      'Określa stawki ryczałtu od przychodów ewidencjonowanych: 17% (wolne zawody), 15%, 14% (m.in. opieka zdrowotna, architektura), 12% (m.in. oprogramowanie i doradztwo IT), 10%, 8,5% / 12,5% ponad 100 000 zł (m.in. najem, usługi ogólne), 5,5% (roboty budowlane, wytwórczość), 3% (handel, gastronomia bez alkoholu), 2%.',
    scope: ['jdg_ryczalt'],
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
      journalReference: 'Dz.U. z 2025 r. poz. 843',
      article: 'art. 12 ust. 1 pkt 1–8',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000843',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Wyłączenia z opodatkowania ryczałtem określa art. 8 ust. 1 (m.in. prowadzenie aptek, kantorów, handel częściami samochodowymi).',
      'Limit przychodów uprawniający do ryczałtu wynosi równowartość 2 000 000 EUR w roku poprzednim (art. 6 ust. 4).',
    ],
    referenceTestCases: [
      {
        id: 'tc-ryczalt-12pct-it',
        description: 'Przychód IT 10 000 zł opodatkowany stawką 12%',
        eventDate: '2026-03-31',
        inputSummary: 'przychód = 1 000 000 gr, stawka = 12%',
        expectedOutputSummary: 'ryczałt przed odliczeniami = 1 200 zł',
      },
    ],
  },

  // 18. Odliczenie 50% składki zdrowotnej i ZUS społecznego na ryczałcie art. 11 ust. 1, 1a i 2
  {
    id: 'ryczalt-health-deduction-50-art-11-2025',
    ruleCode: 'RYCZALT_HEALTH_DEDUCTION_50_ART_11',
    version: '2025.1',
    title:
      'Proporcjonalne odliczenie składek społecznych i 50% składki zdrowotnej od przychodu na ryczałcie',
    description:
      'Przychody opodatkowane ryczałtem pomniejsza się o zapłacone składki na ubezpieczenia społeczne oraz o 50% zapłaconych składek na ubezpieczenie zdrowotne z tytułu działalności opodatkowanej ryczałtem. Przy wielu stawkach ryczałtu odliczeń dokonuje się od każdego rodzaju przychodu w takim stosunku, w jakim w roku podatkowym pozostają poszczególne przychody w ogólnej kwocie przychodów.',
    scope: ['jdg_ryczalt'],
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
      journalReference: 'Dz.U. z 2025 r. poz. 843',
      article: 'art. 11 ust. 1, ust. 1a oraz ust. 2',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000843',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Odliczeniu podlegają wyłącznie składki faktycznie zapłacone w roku podatkowym i nieodliczone w innej formie opodatkowania.',
    ],
    referenceTestCases: [
      {
        id: 'tc-ryczalt-50pct-health',
        description:
          'Zapłacona składka zdrowotna 498,35 zł w 2026 r. daje 249,18 zł odliczenia od przychodu',
        eventDate: '2026-04-30',
        inputSummary: 'paidHealth = 49 835 gr',
        expectedOutputSummary: 'healthDeduction50 = 24 918 gr (249,18 zł)',
      },
    ],
    parameters: {
      healthDeductionBps: 5000,
    },
  },

  // 19. Termin płatności ryczałtu art. 21 ust. 1 i 1a
  {
    id: 'ryczalt-deadline-art-21-2025',
    ruleCode: 'RYCZALT_DEADLINE_ART_21',
    version: '2025.1',
    title: 'Termin wpłaty ryczałtu od przychodów ewidencjonowanych do 20. dnia następnego miesiąca',
    description:
      'Podatnicy obliczają ryczałt i wpłacają go na rachunek urzędu skarbowego w terminie do 20. dnia następnego miesiąca, a za miesiąc grudzień (oraz ostatni kwartał) — do 20 stycznia następnego roku podatkowego.',
    scope: ['jdg_ryczalt'],
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
      journalReference: 'Dz.U. z 2025 r. poz. 843',
      article: 'art. 21 ust. 1 i ust. 1a',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000843',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-ryczalt-december-due',
        description: 'Ryczałt za grudzień 2025 r. płatny do 20 stycznia 2026 r.',
        eventDate: '2025-12-31',
        inputSummary: 'period = 2025-12',
        expectedOutputSummary: 'dueDate = 2026-01-20',
      },
    ],
    parameters: {
      dueDayOfMonth: 20,
    },
  },

  // 20. Ulga na start art. 18 Prawa przedsiębiorców
  {
    id: 'zus-ulga-na-start-2025',
    ruleCode: 'ZUS_ULGA_NA_START_ART_18_PP',
    version: '2025.1',
    title: 'Ulga na start — zwolnienie ze składek społecznych ZUS przez 6 pełnych miesięcy',
    description:
      'Przedsiębiorca będący osobą fizyczną, który podejmuje działalność gospodarczą po raz pierwszy albo po upływie co najmniej 60 miesięcy i nie wykonuje jej na rzecz byłego pracodawcy, nie podlega obowiązkowym ubezpieczeniom społecznym przez okres 6 miesięcy kalendarzowych (opłaca wyłącznie składkę zdrowotną).',
    scope: JDG_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 6 marca 2018 r. — Prawo przedsiębiorców',
      journalReference: 'Dz.U. z 2025 r. poz. 1480',
      article: 'art. 18 ust. 1',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250001480',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Jeżeli rozpoczęcie działalności nastąpiło w trakcie miesiąca (np. 2. dnia miesiąca), 6 pełnych miesięcy liczy się począwszy od kolejnego miesiąca kalendarzowego.',
      'Nie zwalnia z obowiązku opłacania składki na ubezpieczenie zdrowotne.',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-ulga-na-start',
        description: 'W okresie Ulgi na start składki społeczne i FP wynoszą 0,00 zł',
        eventDate: '2026-03-31',
        inputSummary: 'zusScheme = ulga_na_start',
        expectedOutputSummary: 'socialTotalGrosze = 0 gr',
      },
    ],
    parameters: {
      socialBaseGrosze: 0,
      fullCalendarMonths: 6,
    },
  },

  // 21A. Preferencyjny ZUS w 2025 r. (min. wynagrodzenie 4 666 zł -> podstawa 1 399,80 zł)
  {
    id: 'zus-preferencyjny-2025',
    ruleCode: 'ZUS_PREFERENCYJNY_ART_18A',
    version: '2025.1',
    title: 'Preferencyjne składki ZUS w 2025 r. (30% z 4 666 zł = podstawa 1 399,80 zł)',
    description:
      'Przez pierwsze 24 miesiące kalendarzowe od rozpoczęcia działalności (lub zakończenia Ulgi na start) minimalną podstawę wymiaru składek społecznych stanowi 30% minimalnego wynagrodzenia za pracę (w 2025 r.: 30% * 4 666,00 zł = 1 399,80 zł). Brak obowiązku opłacania FP/FS.',
    scope: JDG_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle:
        'Ustawa o systemie ubezpieczeń społecznych (art. 18a ust. 1) oraz Rozporządzenie Rady Ministrów z dnia 12 września 2024 r.',
      journalReference: 'Dz.U. z 2025 r. poz. 350 oraz Dz.U. z 2024 r. poz. 1362',
      article: 'art. 18a ust. 1 ustawy o sus',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001362',
    sourceType: 'regulation',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Nie przysługuje osobom wykonującym działalność na rzecz byłego pracodawcy w zakresie czynności z etatu w bieżącym lub poprzednim roku kalendarzowym (art. 18a ust. 2).',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-pref-2025',
        description: 'Preferencyjny ZUS 2025 z chorobowym wynosi 442,90 zł miesięcznie',
        eventDate: '2025-05-31',
        inputSummary: 'podstawa = 139 980 gr, chorobowe = true',
        expectedOutputSummary: 'społeczne łącznie = 44 290 gr (442,90 zł), FP = 0 gr',
      },
    ],
    parameters: {
      minimumWageGrosze: 466_600,
      socialBaseGrosze: 139_980,
      durationMonths: 24,
    },
  },

  // 21B. Preferencyjny ZUS w 2026 r. (min. wynagrodzenie 4 806 zł -> podstawa 1 441,80 zł)
  {
    id: 'zus-preferencyjny-2026',
    ruleCode: 'ZUS_PREFERENCYJNY_ART_18A',
    version: '2026.1',
    title: 'Preferencyjne składki ZUS w 2026 r. (30% z 4 806 zł = podstawa 1 441,80 zł)',
    description:
      'W 2026 r. minimalne wynagrodzenie za pracę wynosi 4 806,00 zł, w związku z czym podstawa preferencyjnych składek społecznych ZUS (30%) wynosi 1 441,80 zł. Brak obowiązku opłacania FP/FS.',
    scope: JDG_PROFILES,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle:
        'Ustawa o systemie ubezpieczeń społecznych (art. 18a ust. 1) oraz Rozporządzenie Rady Ministrów z dnia 11 września 2025 r.',
      journalReference: 'Dz.U. z 2025 r. poz. 350 oraz Dz.U. z 2025 r. poz. 1242',
      article: 'art. 18a ust. 1 ustawy o sus',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250001242',
    sourceType: 'regulation',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Nie przysługuje przy świadczeniu usług tożsamych z etatem na rzecz byłego pracodawcy (art. 18a ust. 2).',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-pref-2026',
        description: 'Preferencyjny ZUS 2026 z chorobowym wynosi 456,18 zł miesięcznie',
        eventDate: '2026-05-31',
        inputSummary: 'podstawa = 144 180 gr, chorobowe = true',
        expectedOutputSummary: 'społeczne łącznie = 45 618 gr (456,18 zł), FP = 0 gr',
      },
    ],
    parameters: {
      minimumWageGrosze: 480_600,
      socialBaseGrosze: 144_180,
      durationMonths: 24,
    },
  },

  // 22A. Duży ZUS w 2025 r. (60% z 8 673 zł = podstawa 5 203,80 zł)
  {
    id: 'zus-duzy-2025',
    ruleCode: 'ZUS_DUZY_ART_18_UST_8',
    version: '2025.1',
    title: 'Duży ZUS przedsiębiorcy w 2025 r. (60% z 8 673,00 zł = podstawa 5 203,80 zł)',
    description:
      'Minimalna podstawa wymiaru składek społecznych dla przedsiębiorców na zasadach ogólnych w 2025 r. wynosi 60% prognozowanego przeciętnego wynagrodzenia miesięcznego (8 673,00 zł), tj. 5 203,80 zł.',
    scope: JDG_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
      journalReference: 'Dz.U. z 2025 r. poz. 350',
      article: 'art. 18 ust. 8',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/wysokosc-skladek-na-ubezpieczenia-spoleczne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Uprawnieni przedsiębiorcy o przychodzie do 120 000 zł mogą korzystać z Małego ZUS Plus (art. 18c ustawy o sus) przez maks. 36 miesięcy w ciągu 60 miesięcy.',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-duzy-2025',
        description: 'Duży ZUS 2025 z chorobowym i FP/FS wynosi 1 773,96 zł miesięcznie',
        eventDate: '2025-07-31',
        inputSummary: 'podstawa = 520 380 gr, chorobowe = true, FP = true',
        expectedOutputSummary: 'społeczne = 164 647 gr, FP/FS = 12 749 gr, razem = 177 396 gr',
      },
    ],
    parameters: {
      forecastAverageWageGrosze: 867_300,
      socialBaseGrosze: 520_380,
      minimumWageGrosze: 466_600,
    },
  },

  // 22B. Duży ZUS w 2026 r. (60% z 9 420 zł = podstawa 5 652,00 zł)
  {
    id: 'zus-duzy-2026',
    ruleCode: 'ZUS_DUZY_ART_18_UST_8',
    version: '2026.1',
    title: 'Duży ZUS przedsiębiorcy w 2026 r. (60% z 9 420,00 zł = podstawa 5 652,00 zł)',
    description:
      'Minimalna podstawa wymiaru składek społecznych dla przedsiębiorców na zasadach ogólnych w 2026 r. wynosi 60% prognozowanego przeciętnego wynagrodzenia miesięcznego (9 420,00 zł), tj. 5 652,00 zł.',
    scope: JDG_PROFILES,
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
      journalReference: 'Dz.U. z 2025 r. poz. 350',
      article: 'art. 18 ust. 8',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/wysokosc-skladek-na-ubezpieczenia-spoleczne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Zwolnienie z FP/FS przysługuje kobietom od 55. roku życia oraz mężczyznom od 60. roku życia.',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-duzy-2026',
        description: 'Duży ZUS 2026 z chorobowym i FP/FS wynosi 1 926,76 zł miesięcznie',
        eventDate: '2026-07-31',
        inputSummary: 'podstawa = 565 200 gr, chorobowe = true, FP = true',
        expectedOutputSummary: 'społeczne = 178 829 gr, FP/FS = 13 847 gr, razem = 192 676 gr',
      },
    ],
    parameters: {
      forecastAverageWageGrosze: 942_000,
      socialBaseGrosze: 565_200,
      minimumWageGrosze: 480_600,
    },
  },

  // 23. Stopy procentowe składek społecznych ZUS i FP/FS art. 22 ust. 1
  {
    id: 'zus-social-rates-art-22-2025-2026',
    ruleCode: 'ZUS_SOCIAL_RATES_ART_22',
    version: '2025.1',
    title: 'Stopy procentowe składek społecznych ZUS oraz Funduszu Pracy i Solidarnościowego',
    description:
      'Stopy składek wynoszą: emerytalna 19,52%, rentowa 8,00%, chorobowa 2,45% (dobrowolna dla JDG), wypadkowa ryczałtowa dla płatników zgłaszających do 9 ubezpieczonych 1,67%, Fundusz Pracy (1,00%) i Fundusz Solidarnościowy (1,45%) łącznie 2,45%.',
    scope: JDG_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2027-03-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych oraz ustawa o ubezpieczeniu wypadkowym',
      journalReference: 'Dz.U. z 2025 r. poz. 350',
      article: 'art. 22 ust. 1 pkt 1–3',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/stopy-procentowe-skladek',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Płatnicy zgłaszający co najmniej 10 ubezpieczonych ustalają indywidualną stopę wypadkową wg grupy PKD lub zawiadomienia ZUS (ZUS IWA).',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-rates-standard',
        description: 'Stawka wypadkowa dla JDG do 9 ubezpieczonych wynosi 1,67% (167 bps)',
        eventDate: '2026-04-15',
        inputSummary: 'insuredPersonsCount = 1',
        expectedOutputSummary: 'accidentRateBps = 167',
      },
    ],
    parameters: {
      pensionRateBps: 1952,
      disabilityRateBps: 800,
      sicknessRateBps: 245,
      defaultAccidentRateBps: 167,
      laborAndSolidarityFundRateBps: 245,
    },
  },

  // 24. Indywidualna stopa składki wypadkowej (>= 10 ubezpieczonych / ZUS IWA) — requires_expert_review!
  {
    id: 'zus-individual-accident-rate-iwa-2025',
    ruleCode: 'ZUS_INDIVIDUAL_ACCIDENT_RATE_IWA',
    version: '2025.1',
    title: 'Indywidualna stopa procentowa składki wypadkowej dla płatników >= 10 ubezpieczonych',
    description:
      'Dla płatników zgłaszających co najmniej 10 ubezpieczonych lub posługujących się niestandardową stopą wypadkową wymiar składki zależy od kategorii ryzyka PKD lub zawiadomienia ZUS na podstawie ZUS IWA i wymaga weryfikacji zawiadomienia PUE ZUS przez księgowego.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 30 października 2002 r. o ubezpieczeniu społecznym z tytułu wypadków przy pracy i chorób zawodowych',
      journalReference: 'Dz.U. z 2022 r. poz. 2189 z późn. zm.',
      article: 'art. 28 ust. 2 oraz art. 31',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/ubezpieczenie-wypadkowe',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'requires_expert_review',
    exceptions: [
      'Wymaga potwierdzenia zawiadomienia o wysokości stopy procentowej składki na ubezpieczenie wypadkowe na dany rok składkowy (1 kwietnia – 31 marca).',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-iwa-review',
        description: 'Płatnik z 12 ubezpieczonymi otrzymuje flagę requiresHumanApproval = true',
        eventDate: '2026-05-01',
        inputSummary: 'insuredPersonsCount = 12, accidentRateBps = 226',
        expectedOutputSummary: 'requiresHumanApproval = true',
      },
    ],
  },

  // 25A. Składka zdrowotna Skala / Liniowy — styczeń 2025 (koniec roku składkowego 2024)
  {
    id: 'zus-health-scale-flat-jan-2025',
    ruleCode: 'ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81',
    version: '2024.12',
    title:
      'Składka zdrowotna na skali (9%) i liniowym (4,9%) w styczniu 2025 r. (rok składkowy 2024)',
    description:
      'Styczeń 2025 r. należy do roku składkowego trwającego od 1 lutego 2024 r. do 31 stycznia 2025 r. Minimalną podstawę wymiaru stanowi minimalne wynagrodzenie z 2024 r. (4 242,00 zł), a minimalna składka wynosi 381,78 zł.',
    scope: KPIR_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2025-01-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
      journalReference: 'Dz.U. z 2025 r. poz. 1461',
      article: 'art. 79a ust. 1 oraz art. 81 ust. 2 i ust. 2c',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/skladka-na-ubezpieczenie-zdrowotne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [],
    referenceTestCases: [
      {
        id: 'tc-health-jan-2025-min',
        description:
          'Przy stracie w grudniu 2024 r. składka zdrowotna za styczeń 2025 r. wynosi 381,78 zł',
        eventDate: '2025-01-31',
        inputSummary: 'dochód = 0 gr, okres = 2025-01',
        expectedOutputSummary: 'healthGrosze = 38 178 gr',
      },
    ],
    parameters: {
      scaleRateBps: 900,
      flatRateBps: 490,
      minimumBaseGrosze: 424_200,
      minimumContributionGrosze: 38_178,
    },
  },

  // 25B. Składka zdrowotna Skala / Liniowy — rok składkowy 2025 (2025-02-01 do 2026-01-31)
  {
    id: 'zus-health-scale-flat-2025',
    ruleCode: 'ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81',
    version: '2025.1',
    title:
      'Składka zdrowotna na skali (9%) i liniowym (4,9%) w roku składkowym 2025 (min. 314,96 zł)',
    description:
      'W roku składkowym od 1 lutego 2025 r. do 31 stycznia 2026 r. minimalna podstawa wymiaru składki zdrowotnej została obniżona do 75% minimalnego wynagrodzenia z 2025 r. (75% * 4 666,00 zł = 3 499,50 zł), co daje minimalną składkę 314,96 zł miesięcznie zarówno na skali, jak i na podatku liniowym.',
    scope: KPIR_PROFILES,
    validFrom: '2025-02-01',
    validTo: '2026-01-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
      journalReference: 'Dz.U. z 2025 r. poz. 1461',
      article: 'art. 79a ust. 1 oraz art. 81 ust. 2, ust. 2c i ust. 2d',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/skladka-na-ubezpieczenie-zdrowotne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'W styczniu 2026 r. nadal obowiązuje minimalna składka 314,96 zł (koniec roku składkowego 2025).',
    ],
    referenceTestCases: [
      {
        id: 'tc-health-2025-min-31496',
        description: 'Przy dochodzie 0 zł w marcu 2025 r. składka zdrowotna wynosi 314,96 zł',
        eventDate: '2025-04-30',
        inputSummary: 'dochód z poprzedniego miesiąca = 0 gr',
        expectedOutputSummary: 'healthGrosze = 31 496 gr (314,96 zł)',
      },
    ],
    parameters: {
      scaleRateBps: 900,
      flatRateBps: 490,
      minimumBaseGrosze: 349_950,
      minimumContributionGrosze: 31_496,
    },
  },

  // 25C. Składka zdrowotna Skala / Liniowy — rok składkowy 2026 (2026-02-01 do 2027-01-31)
  {
    id: 'zus-health-scale-flat-2026',
    ruleCode: 'ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81',
    version: '2026.1',
    title:
      'Składka zdrowotna na skali (9%) i liniowym (4,9%) w roku składkowym 2026 (min. 432,54 zł)',
    description:
      'W roku składkowym od 1 lutego 2026 r. do 31 stycznia 2027 r. minimalna podstawa wymiaru składki zdrowotnej wynosi 100% minimalnego wynagrodzenia za pracę w 2026 r. (4 806,00 zł), a minimalna składka zdrowotna wynosi 432,54 zł miesięcznie (9% z 4 806,00 zł).',
    scope: KPIR_PROFILES,
    validFrom: '2026-02-01',
    validTo: '2027-01-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
      journalReference: 'Dz.U. z 2025 r. poz. 1461 oraz Dz.U. z 2025 r. poz. 1242',
      article: 'art. 79a ust. 1 oraz art. 81 ust. 2 i ust. 2c',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/skladka-na-ubezpieczenie-zdrowotne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Na podatku liniowym stawka wynosi 4,9% dochodu z poprzedniego miesiąca, lecz kwota składki nie może być niższa niż 9% minimalnego wynagrodzenia (432,54 zł).',
    ],
    referenceTestCases: [
      {
        id: 'tc-health-2026-min-43254',
        description:
          'Przy dochodzie 2 000 zł na liniowym w marcu 2026 r. (4,9% = 98 zł) obowiązuje minimum 432,54 zł',
        eventDate: '2026-04-30',
        inputSummary: 'liniowy, dochód = 200 000 gr',
        expectedOutputSummary: 'healthGrosze = 43 254 gr (432,54 zł)',
      },
    ],
    parameters: {
      scaleRateBps: 900,
      flatRateBps: 490,
      minimumBaseGrosze: 480_600,
      minimumContributionGrosze: 43_254,
    },
  },

  // 26A. Składka zdrowotna Ryczałt w 2025 r.
  {
    id: 'zus-health-ryczalt-2025',
    ruleCode: 'ZUS_HEALTH_RYCZALT_ART_81_UST_2E',
    version: '2025.1',
    title: 'Składka zdrowotna na ryczałcie w 2025 r. (461,66 zł / 769,43 zł / 1 384,97 zł)',
    description:
      'W 2025 r. (na bazie przeciętnego wynagrodzenia z IV kw. 2024 r. = 8 549,18 zł) składka zdrowotna na ryczałcie wynosi: do 60 000 zł przychodu — 461,66 zł; od 60 000,01 zł do 300 000 zł — 769,43 zł; powyżej 300 000 zł — 1 384,97 zł.',
    scope: ['jdg_ryczalt'],
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
      journalReference: 'Dz.U. z 2025 r. poz. 1461',
      article: 'art. 81 ust. 2e i ust. 2f',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/skladka-na-ubezpieczenie-zdrowotne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Przekroczenie progu w trakcie roku rodzi obowiązek dopłaty różnicy składek za poprzednie miesiące w rozliczeniu rocznym składki zdrowotnej (do 20 maja następnego roku), o ile nie zastosowano uproszczonej bazy z roku poprzedniego (art. 81 ust. 2f).',
    ],
    referenceTestCases: [
      {
        id: 'tc-health-ryczalt-2025-t2',
        description: 'Przychód roczny 120 000 zł w 2025 r. kwalifikuje do II progu 769,43 zł',
        eventDate: '2025-06-30',
        inputSummary: 'annualRevenue = 12 000 000 gr',
        expectedOutputSummary: 'healthGrosze = 76 943 gr',
      },
    ],
    parameters: {
      q4AverageWageGrosze: 854_918,
      tier1LimitGrosze: 6_000_000,
      tier2LimitGrosze: 30_000_000,
      tier1BaseGrosze: 512_951,
      tier2BaseGrosze: 854_918,
      tier3BaseGrosze: 1_538_852,
      tier1ContributionGrosze: 46_166,
      tier2ContributionGrosze: 76_943,
      tier3ContributionGrosze: 138_497,
    },
  },

  // 26B. Składka zdrowotna Ryczałt w 2026 r.
  {
    id: 'zus-health-ryczalt-2026',
    ruleCode: 'ZUS_HEALTH_RYCZALT_ART_81_UST_2E',
    version: '2026.1',
    title: 'Składka zdrowotna na ryczałcie w 2026 r. (498,35 zł / 830,58 zł / 1 495,04 zł)',
    description:
      'W 2026 r. (na bazie przeciętnego wynagrodzenia z IV kw. 2025 r. = 9 228,64 zł) składka zdrowotna na ryczałcie wynosi: do 60 000 zł przychodu — 498,35 zł; od 60 000,01 zł do 300 000 zł — 830,58 zł; powyżej 300 000 zł — 1 495,04 zł.',
    scope: ['jdg_ryczalt'],
    validFrom: '2026-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
      journalReference: 'Dz.U. z 2025 r. poz. 1461',
      article: 'art. 81 ust. 2e i ust. 2f',
    },
    sourceUrl:
      'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/skladka-na-ubezpieczenie-zdrowotne',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Przychód dla celów progów zdrowotnych pomniejsza się o zapłacone składki na ubezpieczenia społeczne nieodliczone w PIT.',
    ],
    referenceTestCases: [
      {
        id: 'tc-health-ryczalt-2026-t1',
        description: 'Przychód 45 000 zł w 2026 r. kwalifikuje do I progu 498,35 zł',
        eventDate: '2026-06-30',
        inputSummary: 'annualRevenue = 4 500 000 gr',
        expectedOutputSummary: 'healthGrosze = 49 835 gr',
      },
    ],
    parameters: {
      q4AverageWageGrosze: 922_864,
      tier1LimitGrosze: 6_000_000,
      tier2LimitGrosze: 30_000_000,
      tier1BaseGrosze: 553_718,
      tier2BaseGrosze: 922_864,
      tier3BaseGrosze: 1_661_155,
      tier1ContributionGrosze: 49_835,
      tier2ContributionGrosze: 83_058,
      tier3ContributionGrosze: 149_504,
    },
  },

  // 27. Terminy deklaracji i wpłat ZUS DRA art. 47 ust. 1 ustawy o sus
  {
    id: 'zus-dra-deadline-art-47-2025',
    ruleCode: 'ZUS_DRA_DEADLINE_ART_47',
    version: '2025.2',
    title:
      'Terminy przekazywania deklaracji ZUS DRA i opłacania składek (5., 15. oraz 20. dzień miesiąca)',
    description:
      'Jednostki budżetowe i samorządowe zakłady budżetowe opłacają składki i składają deklaracje do 5. dnia następnego miesiąca (pkt 2), płatnicy składek posiadający osobowość prawną (w tym spółki z o.o.) — do 15. dnia następnego miesiąca (pkt 3), a pozostali płatnicy składek (w tym przedsiębiorcy JDG, spółki osobowe oraz wspólnik jednoosobowej Sp. z o.o. rozliczający własne składki) — do 20. dnia następnego miesiąca (pkt 4).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
      journalReference: 'Dz.U. z 2025 r. poz. 350',
      article: 'art. 47 ust. 1 pkt 2, pkt 3 i pkt 4',
    },
    sourceUrl: 'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/terminy-oplacania-skladek',
    sourceType: 'statute',
    verifiedAt: '2026-11-07',
    verificationStatus: 'verified',
    exceptions: [
      'Jednostki budżetowe i samorządowe zakłady budżetowe rozliczają ZUS do 5. dnia następnego miesiąca (art. 47 ust. 1 pkt 2).',
      'Sp. z o.o. jednoosobowa nieposiadająca pracowników ani zleceniobiorców (gdy jedyny wspólnik płaci ZUS za siebie na własnym koncie płatnika) rozlicza składki wspólnika do 20. dnia miesiąca (art. 47 ust. 1 pkt 4).',
    ],
    referenceTestCases: [
      {
        id: 'tc-zus-dra-spzoo-15',
        description: 'Sp. z o.o. składa ZUS DRA do 15. dnia następnego miesiąca',
        eventDate: '2026-04-30',
        inputSummary: 'profile = spzoo_pelne_ksiegi, period = 2026-04',
        expectedOutputSummary: 'statutoryDueDate = 2026-05-15',
      },
      {
        id: 'tc-zus-dra-jdg-20',
        description: 'JDG składa ZUS DRA do 20. dnia następnego miesiąca',
        eventDate: '2026-04-30',
        inputSummary: 'profile = jdg_kpir_skala, period = 2026-04',
        expectedOutputSummary: 'statutoryDueDate = 2026-05-20',
      },
    ],
    parameters: {
      budgetEntityDueDay: 5,
      legalPersonDueDay: 15,
      otherPayersDueDay: 20,
    },
  },

  // 28. Harmonogram obowiązkowego KSeF 2.0 w 2026 r.
  {
    id: 'ksef-mandatory-schedule-2026',
    ruleCode: 'KSEF_MANDATORY_SCHEDULE_2026',
    version: '2025.2',
    title: 'Harmonogram obowiązkowego Krajowego Systemu e-Faktur (KSeF 2.0) w 2026 r.',
    description:
      'Odbiór faktur w KSeF obowiązuje wszystkich podatników od 1 lutego 2026 r. Wystawianie faktur ustrukturyzowanych obowiązuje od 1 lutego 2026 r. podatników o sprzedaży > 200 mln zł z VAT w 2024 r., a od 1 kwietnia 2026 r. pozostałych przedsiębiorców (z przejściowym wyłączeniem do 31 grudnia 2026 r. dla podatników o miesięcznej sprzedaży fakturowanej <= 10 000 zł brutto).',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2026-12-31',
    legalBasis: {
      actTitle:
        'Ustawa z dnia 5 sierpnia 2025 r. o zmianie ustawy o podatku od towarów i usług oraz ustawy o zmianie ustawy o podatku od towarów i usług oraz niektórych innych ustaw',
      journalReference: 'Dz.U. z 2025 r. poz. 1203',
      article: 'art. 106ga ust. 1–2 ustawy o VAT oraz przepisy przejściowe',
    },
    sourceUrl: 'https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Faktury konsumenckie B2C są wyłączone z obowiązku wystawiania w KSeF (możliwość dobrowolnego wystawienia).',
      'Przekroczenie limitu 10 000 zł brutto w danym miesiącu 2026 r. powoduje obowiązek wystawienia w KSeF już tej faktury, którą przekroczono próg.',
    ],
    referenceTestCases: [
      {
        id: 'tc-ksef-small-apr-2026',
        description:
          'Standardowe JDG (sprzedaż > 10 000 zł/mies.) podlega obowiązkowi wystawiania w KSeF od 1 kwietnia 2026 r.',
        eventDate: '2026-04-01',
        inputSummary: 'sales2024Above200M = false, monthlyB2bGross = 25 000 zł',
        expectedOutputSummary: 'issuingMandatoryFrom = 2026-04-01',
      },
    ],
    parameters: {
      receivingMandatoryFrom: '2026-02-01',
      largeTaxpayerIssuingFrom: '2026-02-01',
      generalIssuingFrom: '2026-04-01',
      microExemptionMonthlyGrossLimitGrosze: 1_000_000,
      microExemptionValidUntil: '2026-12-31',
    },
  },

  // 29. Harmonogram JPK w podatkach dochodowych (JPK_KR_PD, JPK_PKPIR, JPK_EWP)
  {
    id: 'jpk-income-tax-schedule-2025-2027',
    ruleCode: 'JPK_INCOME_TAX_SCHEDULE',
    version: '2025.1',
    title: 'Harmonogram JPK w podatkach dochodowych (JPK_PKPIR, JPK_EWP, JPK_KR_PD)',
    description:
      'Elektroniczne prowadzenie i roczne przesyłanie ksiąg podatkowych obowiązuje: od roku 2025 największych podatników CIT (> 50 mln EUR oraz PGK); od roku 2026 czynnych podatników VAT składających JPK_V7M (prowadzących PKPiR, EWP lub księgi rachunkowe — pierwsza wysyłka w 2027 r.); od roku 2027 pozostałych podatników.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: '2027-12-31',
    legalBasis: {
      actTitle:
        'Ustawa o PIT (art. 24a ust. 1e) / Ustawa o ryczałcie (art. 15 ust. 12) / Ustawa o CIT (art. 9 ust. 1c)',
      journalReference:
        'Dz.U. z 2025 r. poz. 163, poz. 843 i poz. 278 (przepisy epizodyczne i wdrożeniowe)',
      article: 'art. 24a ust. 1e PIT / art. 15 ust. 12 ryczałt / art. 9 ust. 1c CIT',
    },
    sourceUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/jpk_pd/',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Podatnicy zwolnieni z VAT oraz rozliczający VAT kwartalnie (JPK_V7K) wchodzą w obowiązek JPK_PKPIR / JPK_EWP dopiero od roku podatkowego 2027.',
    ],
    referenceTestCases: [
      {
        id: 'tc-jpk-pkpir-2026-v7m',
        description:
          'JDG KPiR na JPK_V7M prowadzi księgę wg struktury JPK_PKPIR za rok 2026 (wysyłka do 30.04.2027)',
        eventDate: '2026-01-31',
        inputSummary: 'profile = jdg_kpir_skala, vatSettlementPeriod = monthly',
        expectedOutputSummary: 'jpkPdRequiredForYear = true',
      },
    ],
  },

  // 30. Harmonogram e-Doręczeń dla podmiotów w KRS i CEIDG
  {
    id: 'edoreczenia-schedule-2025-2026',
    ruleCode: 'EDORECZENIA_SCHEDULE',
    version: '2025.1',
    title: 'Harmonogram obowiązku posiadania adresu do e-Doręczeń (KRS i CEIDG)',
    description:
      'Podmioty wpisane do KRS przed 1 stycznia 2025 r. mają obowiązek posiadania adresu do e-Doręczeń od 1 kwietnia 2025 r. Przedsiębiorcy wpisani do CEIDG przed 1 stycznia 2025 r. podlegają obowiązkowi najpóźniej od 1 października 2026 r. (lub wcześniej przy aktualizacji wpisu po 30 czerwca 2025 r.). Nowe podmioty zakładają adres przy rejestracji od 1 stycznia 2025 r.',
    scope: ALL_PROFILES,
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 18 listopada 2020 r. o doręczeniach elektronicznych (ze zm. z dnia 21 listopada 2024 r.)',
      journalReference: 'Dz.U. z 2024 r. poz. 1045 oraz Dz.U. z 2024 r. poz. 1841',
      article: 'art. 9 oraz art. 151–152',
    },
    sourceUrl: 'https://www.gov.pl/web/e-doreczenia/harmonogram',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Osoby wykonujące zawody zaufania publicznego (adwokat, radca prawny, doradca podatkowy) objęte są obowiązkiem od 1 stycznia 2025 r.',
    ],
    referenceTestCases: [
      {
        id: 'tc-edoreczenia-ceidg-oct-2026',
        description:
          'JDG zarejestrowane przed 2025 r. objęte powszechnym obowiązkiem e-Doręczeń od 2026-10-01',
        eventDate: '2026-10-01',
        inputSummary: 'ceidgRegisteredBefore2025 = true',
        expectedOutputSummary: 'edoreczeniaMandatory = true',
      },
    ],
    parameters: {
      krsExistingMandatoryFrom: '2025-04-01',
      ceidgExistingMandatoryFrom: '2026-10-01',
      newEntitiesMandatoryFrom: '2025-01-01',
    },
  },

  // 31. Ustawa o rachunkowości — podwójny zapis, równowaga bilansowa i Zespoły kont
  {
    id: 'uor-double-entry-and-balance-2025',
    ruleCode: 'UOR_DOUBLE_ENTRY_AND_BALANCE',
    version: '2025.1',
    title: 'Zasada podwójnego zapisu (Wn = Ma) i równowagi bilansowej (Aktywa = Pasywa) w UoR',
    description:
      'Zapisów w księgach rachunkowych dokonuje się zgodnie z zasadą podwójnego zapisu (suma obrotów Wn równa sumie obrotów Ma w każdym dowodzie księgowym i zestawie obrotów i sald), zachowując nienaruszalność zamkniętych okresów sprawozdawczych oraz równowagę Aktywów i Pasywów w Bilansie.',
    scope: ['spzoo_pelne_ksiegi'],
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle:
        'Ustawa z dnia 29 września 1994 r. o rachunkowości (ze zm. z dnia 6 grudnia 2024 r.)',
      journalReference: 't.j. Dz.U. z 2023 r. poz. 120 ze zm., w tym Dz.U. z 2024 r. poz. 1863',
      article: 'art. 5 ust. 1, art. 15 ust. 1, art. 18 ust. 1 oraz art. 25 ust. 1 pkt 2',
      notes:
        'Od 1 stycznia 2025 r. limit przychodów dla osób fizycznych i spółek osobowych zobowiązujący do pełnych ksiąg wzrósł do 2,5 mln EUR; spółki z o.o. prowadzą księgi rachunkowe zawsze niezależnie od przychodów (art. 2 ust. 1 pkt 1).',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240001863',
    sourceType: 'statute',
    verifiedAt: '2026-11-04',
    verificationStatus: 'verified',
    exceptions: [
      'Poprawianie błędów w zamkniętych miesiącach odbywa się wyłącznie przez wprowadzenie dowodu korygującego (storno czarne lub czerwone) w bieżącym otwartym okresie (art. 25 ust. 2 UoR).',
    ],
    referenceTestCases: [
      {
        id: 'tc-uor-unbalanced-reject',
        description: 'Dekret z Wn = 1 230,00 zł i Ma = 1 000,00 zł zostaje odrzucony',
        eventDate: '2026-03-15',
        inputSummary: 'Wn = 123 000 gr, Ma = 100 000 gr',
        expectedOutputSummary: 'błąd walidacji podwójnego zapisu',
      },
    ],
  },

  // 32A. Stawki CIT 9% vs 19% i bieżący limit 2 mln EUR w 2025 r. (art. 19 ust. 1 pkt 2 — 8 534 000 zł netto)
  {
    id: 'cit-rates-art-19-2025',
    ruleCode: 'CIT_RATES_ART_19',
    version: '2025.1',
    title:
      'Stawki CIT w 2025 r. (9% mały podatnik vs 19%) i bieżący limit 2 mln EUR netto (8 534 000 zł)',
    description:
      'W 2025 r. podatek CIT wynosi 19% podstawy opodatkowania albo 9% od przychodów innych niż z zysków kapitałowych u małych podatników i podatników rozpoczynających działalność, u których przychody osiągnięte w 2025 r. (bez VAT) nie przekroczyły równowartości 2 000 000 EUR wg kursu NBP z 2 stycznia 2025 r. (4,2668 zł/EUR, tab. 001/A/NBP/2025), tj. 8 534 000 zł po zaokrągleniu do 1 000 zł.',
    scope: ['spzoo_pelne_ksiegi'],
    validFrom: '2025-01-01',
    validTo: '2025-12-31',
    legalBasis: {
      actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
      journalReference: 'Dz.U. z 2025 r. poz. 278',
      article: 'art. 19 ust. 1 pkt 1–2 oraz art. 25 ust. 1a i ust. 1g',
      notes:
        'Tabela nr 001/A/NBP/2025 z dnia 2025-01-02: 1 EUR = 4,2668 PLN -> 2 000 000 EUR = 8 533 600 PLN, w zaokrągleniu do 1 000 zł: 8 534 000 PLN netto.',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000278',
    sourceType: 'statute',
    verifiedAt: '2026-11-07',
    verificationStatus: 'verified',
    exceptions: [
      'Stawki 9% nie stosuje się do podatników utworzonych w wyniku przekształcenia, połączenia lub podziału w roku utworzenia i roku następnym (art. 19 ust. 1a–1c CIT).',
      'Po przekroczeniu bieżącego limitu 8 534 000 zł netto podatnik oblicza zaliczki wg stawki 19% począwszy od miesiąca przekroczenia (art. 25 ust. 1g CIT).',
    ],
    referenceTestCases: [
      {
        id: 'tc-cit-9pct-2025-current-cap',
        description:
          'Mały podatnik w 2025 r. po przekroczeniu 8 534 000 zł przychodu netto przechodzi z 9% na 19% CIT',
        eventDate: '2025-10-31',
        inputSummary: 'ytdNetRev = 853 500 000 gr, smallTaxpayer = true',
        expectedOutputSummary: 'appliedRatePct = 19',
      },
    ],
    parameters: {
      smallTaxpayerRateBps: 900,
      standardRateBps: 1900,
      dueDayOfMonth: 20,
      januaryEurRateBps: 42_668,
      currentYearNetLimitPln: 8_534_000,
      currentYearNetLimitGrosze: 853_400_000,
    },
  },

  // 32B. Stawki CIT 9% vs 19% i bieżący limit 2 mln EUR w 2026 r. (art. 19 ust. 1 pkt 2 — 8 431 000 zł netto)
  {
    id: 'cit-rates-art-19-2026',
    ruleCode: 'CIT_RATES_ART_19',
    version: '2026.1',
    title:
      'Stawki CIT w 2026 r. (9% mały podatnik vs 19%) i bieżący limit 2 mln EUR netto (8 431 000 zł)',
    description:
      'W 2026 r. podatek CIT wynosi 19% podstawy opodatkowania albo 9% od przychodów innych niż z zysków kapitałowych u małych podatników i podatników rozpoczynających działalność, u których przychody osiągnięte w 2026 r. (bez VAT) nie przekroczyły równowartości 2 000 000 EUR wg kursu NBP z 2 stycznia 2026 r. (4,2156 zł/EUR, tab. 001/A/NBP/2026), tj. 8 431 000 zł po zaokrągleniu do 1 000 zł.',
    scope: ['spzoo_pelne_ksiegi'],
    validFrom: '2026-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
      journalReference: 'Dz.U. z 2025 r. poz. 278',
      article: 'art. 19 ust. 1 pkt 1–2 oraz art. 25 ust. 1a i ust. 1g',
      notes:
        'Tabela nr 001/A/NBP/2026 z dnia 2026-01-02: 1 EUR = 4,2156 PLN -> 2 000 000 EUR = 8 431 200 PLN, w zaokrągleniu do 1 000 zł: 8 431 000 PLN netto.',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000278',
    sourceType: 'statute',
    verifiedAt: '2026-11-07',
    verificationStatus: 'verified',
    exceptions: [
      'Stawki 9% nie stosuje się do podatników utworzonych w wyniku przekształcenia, połączenia lub podziału w roku utworzenia i roku następnym (art. 19 ust. 1a–1c CIT).',
      'Przychody z zysków kapitałowych podlegają zawsze stawce 19%.',
      'Po przekroczeniu bieżącego limitu 8 431 000 zł netto podatnik traci prawo do 9% CIT i oblicza zaliczki wg stawki 19% (art. 25 ust. 1g CIT).',
    ],
    referenceTestCases: [
      {
        id: 'tc-cit-9pct-small',
        description:
          'Sp. z o.o. ze statusem małego podatnika i dochodem 50 000 zł płaci 4 500 zł zaliczki CIT (9%)',
        eventDate: '2026-04-30',
        inputSummary: 'dochód = 5 000 000 gr, smallTaxpayer = true',
        expectedOutputSummary: 'zaliczka CIT = 450 000 gr (4 500 zł)',
      },
    ],
    parameters: {
      smallTaxpayerRateBps: 900,
      standardRateBps: 1900,
      dueDayOfMonth: 20,
      januaryEurRateBps: 42_156,
      currentYearNetLimitPln: 8_431_000,
      currentYearNetLimitGrosze: 843_100_000,
    },
  },

  // 33. Samochód osobowy w CIT — wyłączenie 25% NKUP z wydatków eksploatacyjnych (art. 16 ust. 1 pkt 51 CIT)
  {
    id: 'cit-car-mixed-75-art-16-2025',
    ruleCode: 'CIT_CAR_MIXED_EXPENSE_75_ART_16',
    version: '2025.1',
    title: 'Ograniczenie do 75% KUP (25% NKUP) wydatków eksploatacyjnych samochodu osobowego w CIT',
    description:
      'Nie uważa się za koszty uzyskania przychodów w CIT 25% poniesionych wydatków z tytułu kosztów używania samochodu osobowego na potrzeby działalności gospodarczej, jeżeli samochód ten nie jest wykorzystywany wyłącznie do działalności gospodarczej (75% stanowi KUP, 25% stanowi trwałe wyłączenie NKUP; kwota obejmuje także nieodliczony 50% podatek VAT wg art. 16 ust. 1 pkt 46 lit. a CIT).',
    scope: ['spzoo_pelne_ksiegi'],
    validFrom: '2025-01-01',
    validTo: null,
    legalBasis: {
      actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
      journalReference: 'Dz.U. z 2025 r. poz. 278',
      article: 'art. 16 ust. 1 pkt 51 oraz art. 16 ust. 1 pkt 46 lit. a',
    },
    sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000278',
    sourceType: 'statute',
    verifiedAt: '2026-11-07',
    verificationStatus: 'verified',
    exceptions: [
      'Pełne 100% KUP przysługuje wyłącznie przy prowadzeniu szczegółowej ewidencji przebiegu pojazdu (VAT-26) potwierdzającej brak użytku mieszanego (art. 16 ust. 5f–5g CIT).',
    ],
    referenceTestCases: [
      {
        id: 'tc-cit-car-mixed-75-nkup-25',
        description:
          'Faktura 1 000,00 zł netto + 230,00 zł VAT w Sp. z o.o.: koszt bilansowy 1 115,00 zł -> KUP 836,25 zł (75%) i NKUP 278,75 zł (25%)',
        eventDate: '2026-03-20',
        inputSummary: 'netGrosze = 100 000 gr, vatGrosze = 23 000 gr, mixed_use_75',
        expectedOutputSummary: 'kup = 83 625 gr, nkup = 27 875 gr',
      },
    ],
    parameters: {
      deductibleExpenseBps: 7500,
      nkupExcludedBps: 2500,
    },
  },
];
