import {
  POLISH_LEGAL_RULES_REGISTRY,
  resolveRuleAtDate,
  type LegalRule,
  type RyczaltRateCode,
  type TaxProfileCode,
  type VatRateCode,
} from '@pap/domain';
import { ACADEMY_DISCLAIMER } from '@pap/domain/academy';
import type { LegalBasisInfo } from '@pap/ui';
import { getCanonicalLessonHref, mapLegalRuleToBasisInfo } from './field-help';

export interface VatRateGuidanceItem {
  readonly rate: VatRateCode;
  readonly badgeLabel: string;
  readonly titlePl: string;
  readonly whenAppliesPl: string;
  readonly examplesAndConditionsPl: string;
  readonly rightToDeductNotePl: string;
}

export interface RyczaltRateGuidanceItem {
  readonly rate: RyczaltRateCode;
  readonly titlePl: string;
  readonly legalRefPl: string;
  readonly typicalScopePl: string;
  readonly cautionPl: string;
}

const SAFE_ISO_DATE_RX = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function normalizeEventDateForRuleLookup(rawDate?: string): string {
  const trimmed = (rawDate ?? '').trim();
  if (SAFE_ISO_DATE_RX.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d) {
      if (trimmed < '2025-01-01') return '2025-01-01';
      return trimmed;
    }
  }
  return '2026-03-15';
}

function safeResolveRule(ruleCode: string, eventDate: string): LegalRule | undefined {
  try {
    return resolveRuleAtDate(ruleCode, eventDate, { bindingCalculation: false });
  } catch {
    return POLISH_LEGAL_RULES_REGISTRY.find((r) => r.ruleCode === ruleCode);
  }
}

export const VAT_RATE_GUIDANCE_ITEMS: readonly VatRateGuidanceItem[] = [
  {
    rate: '23',
    badgeLabel: '23% · podstawowa',
    titlePl: 'Stawka podstawowa 23% (art. 41 ust. 1 w zw. z art. 146ef ust. 1 pkt 1 ustawy o VAT)',
    whenAppliesPl:
      'Stosowana co do zasady do odpłatnej dostawy towarów i świadczenia usług w kraju, o ile przepis szczególny lub załącznik do ustawy nie przewiduje stawki obniżonej albo zwolnienia.',
    examplesAndConditionsPl:
      'Większość usług B2B (IT, doradztwo, projektowanie, marketing, najem komercyjny), sprzęt elektroniczny, licencje, paliwa, usługi telekomunikacyjne.',
    rightToDeductNotePl:
      'Sprzedaż z 23% daje prawo do odliczenia VAT od powiązanych zakupów. Na fakturze zakupu stawka 23% NIE oznacza automatycznego odliczenia — sprawdź związek z działalnością opodatkowaną i wyłączenia z art. 86a / art. 88 VAT.',
  },
  {
    rate: '8',
    badgeLabel: '8% · obniżona',
    titlePl:
      'Stawka obniżona 8% (art. 41 ust. 2 i ust. 12 w zw. z art. 146ef ust. 1 pkt 2 i Zał. nr 3)',
    whenAppliesPl:
      'Wyłącznie dla towarów i usług wprost wymienionych w Załączniku nr 3 do ustawy o VAT, w art. 41 ust. 12 (społeczne budownictwo mieszkaniowe do limitów metrażu) lub w rozporządzeniach MF.',
    examplesAndConditionsPl:
      'Wybrane roboty budowlano-montażowe i remontowe w obiektach mieszkalnych (PKOB 111/112 do 300 m² / 150 m²), wyroby medyczne dopuszczone do obrotu, wybrane usługi gastronomiczne i zakwaterowania, transport pasażerski.',
    rightToDeductNotePl:
      'Uwaga przy zakupach: usługi noclegowe i gastronomiczne (często z 8% VAT na fakturze) co do zasady NIE dają prawa do odliczenia VAT naliczonego wg art. 88 ust. 1 pkt 4 ustawy o VAT (z wyjątkiem m.in. przewozów pasażerskich lub gotowych posiłków dla pasażerów).',
  },
  {
    rate: '5',
    badgeLabel: '5% · obniżona',
    titlePl: 'Stawka obniżona 5% (art. 41 ust. 2a oraz Załącznik nr 10 do ustawy o VAT)',
    whenAppliesPl:
      'Dotyczy ściśle określonego katalogu towarów z Załącznika nr 10 (według kodów CN / PKWiU).',
    examplesAndConditionsPl:
      'Książki, broszury, nuty i mapy (w tym publikacje elektroniczne objęte odpowiednim CN), czasopisma specjalistyczne i regionalne oraz wybrane podstawowe produkty żywnościowe (gdy nie obowiązuje czasowa stawka 0% z rozporządzenia).',
    rightToDeductNotePl:
      'Wymaga weryfikacji klasyfikacji CN (dla towarów) lub PKWiU. Sam ogólny opis na fakturze bez spełnienia definicji ustawowej nie uprawnia do zastosowania 5%.',
  },
  {
    rate: '0',
    badgeLabel: '0% · opodatkowana',
    titlePl: 'Stawka 0% — czynność OPODATKOWANA z zachowaniem prawa do odliczenia VAT',
    whenAppliesPl:
      'To NIE jest zwolnienie z VAT ani czynność poza VAT! Sprzedaż jest opodatkowana stawką 0%, ale jej zastosowanie wymaga spełnienia rygorystycznych warunków dokumentacyjnych przed upływem terminu złożenia JPK_V7.',
    examplesAndConditionsPl:
      'Wewnątrzwspólnotowa dostawa towarów (WDT — art. 41 ust. 3 i art. 42: ważny VAT-UE nabywcy w VIES + dowody wywozu do innego kraju UE), eksport towarów poza UE (art. 41 ust. 4–9: komunikat celny IE-599 / CC599A), wybrane usługi transportu międzynarodowego.',
    rightToDeductNotePl:
      'Kluczowa różnica wobec „zw.”: sprzedaż opodatkowana 0% wlicza się do obrotu opodatkowanego i DAJE prawo do odliczenia podatku VAT naliczonego od zakupów służących tej sprzedaży.',
  },
  {
    rate: 'zw',
    badgeLabel: 'zw. · zwolniona',
    titlePl: '„zw.” — czynność ZWOLNIONA z podatku VAT (przedmiotowo lub podmiotowo)',
    whenAppliesPl:
      'Czynność podlega ustawie o VAT w Polsce, lecz na mocy przepisu szczególnego nie nalicza się od niej podatku należnego.',
    examplesAndConditionsPl:
      '1) Zwolnienie podmiotowe ze względu na limit sprzedaży netto (art. 113 ust. 1 i 9 VAT — 200 000 PLN w 2025 r., 240 000 PLN od 1 stycznia 2026 r., z wyłączeniem m.in. usług doradczych i prawniczych z art. 113 ust. 13!). 2) Zwolnienie przedmiotowe (art. 43 ust. 1 VAT — np. wybrane usługi medyczne, edukacyjne, finansowe i ubezpieczeniowe). Na fakturze przy zwolnieniu z art. 43 ust. 1 lub rozporządzeń wskazuje się podstawę prawną zwolnienia (art. 106e ust. 1 pkt 19 VAT).',
    rightToDeductNotePl:
      'Kluczowa różnica wobec „0%”: sprzedaż zwolniona („zw.”) co do zasady NIE daje prawa do odliczenia VAT naliczonego od zakupów związanych wyłącznie z tą sprzedażą (a przy działalności mieszanej stosuje się proporcję z art. 90 VAT).',
  },
  {
    rate: 'np',
    badgeLabel: 'np. · poza VAT w RP',
    titlePl: '„np.” — czynność NIEPODLEGAJĄCA opodatkowaniu VAT na terytorium Polski',
    whenAppliesPl:
      'Transakcja znajduje się poza zakresem terytorialnym polskiego podatku VAT (miejsce świadczenia poza Polską) albo w ogóle nie podlega ustawie o VAT.',
    examplesAndConditionsPl:
      'Najczęstszy przypadek w B2B: świadczenie usług na rzecz zagranicznego podatnika (UE lub kraj trzeci), dla którego miejscem opodatkowania wg art. 28b ustawy o VAT jest kraj siedziby usługobiorcy (odwrotne obciążenie / reverse charge — wykazywane odpowiednio w P_11 / P_12 JPK_V7 i informacji podsumowującej VAT-UE).',
    rightToDeductNotePl:
      'Kluczowa różnica wobec „zw.”: dla usług świadczonych poza terytorium kraju (art. 28b) art. 86 ust. 8 pkt 1 VAT pozwala odliczyć polski VAT od zakupów, jeżeli te czynności dawałyby prawo do odliczenia, gdyby były wykonywane w Polsce (pod warunkiem posiadania dokumentów potwierdzających związek).',
  },
];

export const RYCZALT_RATE_GUIDANCE_ITEMS: readonly RyczaltRateGuidanceItem[] = [
  {
    rate: '17',
    titlePl: '17% — wolne zawody wykonywane osobiście',
    legalRefPl: 'art. 12 ust. 1 pkt 1 w zw. z art. 4 ust. 1 pkt 11 ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Przychody osiągane w zakresie wolnych zawodów wykonywanych osobiście (np. tłumacze, adwokaci, notariusze, radcowie prawni, biegli rewidenci, księgowi, doradcy podatkowi, agenci ubezpieczeniowi — gdy działalność spełnia ustawową definicję wolnego zawodu).',
    cautionPl:
      'Zatrudnianie osób wykonujących czynności merytoryczne związane z istotą danego zawodu może zmienić kwalifikację na inną stawkę z art. 12 ust. 1 pkt 2 (np. 15%).',
  },
  {
    rate: '15',
    titlePl: '15% — doradztwo, zarządzanie, reklama, pośrednictwo',
    legalRefPl: 'art. 12 ust. 1 pkt 2 ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'M.in. usługi doradztwa w zakresie zarządzania (PKWiU dział 70), usługi reklamowe i badania rynku (dział 73), pośrednictwo w sprzedaży hurtowej, usługi prawne i rachunkowo-księgowe poza wolnym zawodem, przetwarzanie danych i licencje określone w pkt 2.',
    cautionPl:
      'W branży IT usługi doradztwa nietechnicznego lub zarządzania projektami (PM / consulting biznesowy) bywają klasyfikowane pod 15%, a nie 12% — decyduje faktyczny zakres umowy i PKWiU, nie nazwa stanowiska.',
  },
  {
    rate: '14',
    titlePl: '14% — usługi architektoniczne, inżynierskie i opieka zdrowotna',
    legalRefPl: 'art. 12 ust. 1 pkt 2a ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Usługi w zakresie opieki zdrowotnej (PKWiU dział 86), usługi architektoniczne i inżynierskie oraz badania i analizy techniczne (PKWiU dział 71), specjalistyczne projektowanie (PKWiU 74.1).',
    cautionPl:
      'Projektowanie graficzne / UX wymagające rozróżnienia między PKWiU 74.10 (14%) a wytwarzaniem oprogramowania 62.01 (12%) warto w razie wątpliwości potwierdzić informacją klasyfikacyjną GUS lub interpretacją KIS.',
  },
  {
    rate: '12',
    titlePl: '12% — wybrane usługi IT, oprogramowanie i doradztwo sprzętowe/programowe',
    legalRefPl: 'art. 12 ust. 1 pkt 2b lit. b ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Przychody ze świadczenia usług związanych z wydawaniem oprogramowania, doradztwem w zakresie sprzętu komputerowego (PKWiU 62.02.10.0), oprogramowaniem (PKWiU ex 62.01.1), instalowaniem oprogramowania (62.09.20.0) oraz zarządzaniem sieciami i systemami informatycznymi (62.03.1).',
    cautionPl:
      'Nie każda usługa w firmie technologicznej ma stawkę 12%: wybrane czynności pomocnicze/manualne niezwiązane z tworzeniem kodu (np. wybrane testy manualne lub wsparcie helpdesk wg części interpretacji KIS) mogą podlegać 8,5%, a doradztwo biznesowe — 15%.',
  },
  {
    rate: '8.5',
    titlePl:
      '8,5% (oraz 12,5% powyżej 100 000 PLN dla wybranych tytułów) — działalność usługowa ogólna',
    legalRefPl: 'art. 12 ust. 1 pkt 4 i pkt 5 lit. a ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Przychody z działalności usługowej niewymienionej w wyższych stawkach (8,5% bez limitu kwotowego dla usług ogólnych z pkt 5 lit. a), natomiast dla najmu/dzierżawy, zakwaterowania i wybranych usług badawczo-rozwojowych lub edukacyjnych — 8,5% do 100 000 PLN i 12,5% od nadwyżki.',
    cautionPl:
      'Zawsze sprawdź najpierw, czy dana usługa nie jest wymieniona w wyższych punktach art. 12 ust. 1 (17%, 15%, 14%, 12%) — stawka 8,5% dla usług jest stawką dopełniającą.',
  },
  {
    rate: '5.5',
    titlePl: '5,5% — działalność wytwórcza i roboty budowlane',
    legalRefPl: 'art. 12 ust. 1 pkt 6 lit. a ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Przychody z działalności wytwórczej (wytwarzanie nowych wyrobów z materiałów własnych), robót budowlanych oraz przewozów ładunków taborem powyżej 2 ton.',
    cautionPl:
      'Sprzedaż towarów zakupionych w celu odsprzedaży w stanie nieprzetworzonym to działalność handlowa (3%), natomiast usługi projektowe bez wykonawstwa budowlanego mają wyższą stawkę (np. 14%).',
  },
  {
    rate: '3',
    titlePl: '3% — działalność usługowa w zakresie handlu i wybrana gastronomia',
    legalRefPl: 'art. 12 ust. 1 pkt 7 lit. b ustawy o ryczałcie (PPE)',
    typicalScopePl:
      'Sprzedaż uprzednio nabytych towarów w stanie nieprzetworzonym (handel detaliczny i hurtowy, e-commerce towarami fizycznymi) oraz gastronomia z wyjątkiem napojów o zawartości alkoholu powyżej 1,5%.',
    cautionPl:
      'Sprzedaż części zamiennych do pojazdów mechanicznych podlega wyższej stawce 8,5% (wyłączenie z handlu 3%).',
  },
];

export interface TemporalTaxContextGuide {
  readonly referenceDate: string;
  readonly effectiveYear: number;
  readonly vatExemptionLimitPln: number;
  readonly vatRatesBasis: LegalBasisInfo;
  readonly vatExemptionBasis: LegalBasisInfo;
  readonly ryczaltBasis: LegalBasisInfo;
  readonly purchaseKupBasis: LegalBasisInfo;
  readonly purchaseVatDeductionBasis: LegalBasisInfo;
  readonly dueVsPaidSummaryPl: string;
  readonly rulesCatalogHref: string;
  readonly vatLessonHref: string;
  readonly ryczaltLessonHref: string;
  readonly kupLessonHref: string;
  readonly disclaimerPl: string;
}

/**
 * Buduje przewodnik podatkowy na konkretną datę dokumentu (`2025` vs `2026+`) z powiązaniem
 * do wersjonowanego rejestru `@pap/domain`, `/app/rules` i lekcji Akademii (#103).
 */
export function buildTemporalTaxContextGuide(
  rawEventDate?: string,
  profileCode?: TaxProfileCode,
): TemporalTaxContextGuide {
  const referenceDate = normalizeEventDateForRuleLookup(rawEventDate);
  const effectiveYear = Number(referenceDate.slice(0, 4));

  const vatRatesRule = safeResolveRule('VAT_RATES_STANDARD_AND_REDUCED', referenceDate);
  const vatExemptionRule = safeResolveRule('VAT_EXEMPTION_LIMIT_ART_113', referenceDate);
  const ryczaltRule = safeResolveRule('RYCZALT_RATES_ART_12', referenceDate);
  const kupRule =
    profileCode === 'spzoo_pelne_ksiegi'
      ? safeResolveRule('CIT_CAR_MIXED_EXPENSE_75_ART_16', referenceDate)
      : safeResolveRule('PIT_NKUP_EXCLUSIONS_ART_23', referenceDate);
  const vatDeductionRule = safeResolveRule('VAT_VEHICLE_DEDUCTION_ART_86A', referenceDate);

  const rawLimitParam = vatExemptionRule?.parameters?.['annualLimitPln'];
  const rawLimitGroszeParam = vatExemptionRule?.parameters?.['annualLimitGrosze'];
  const vatExemptionLimitPln =
    typeof rawLimitParam === 'number'
      ? rawLimitParam
      : typeof rawLimitGroszeParam === 'number'
        ? Math.round(rawLimitGroszeParam / 100)
        : effectiveYear >= 2026
          ? 240_000
          : 200_000;

  const fallbackBasis = (title: string, provision: string, url: string): LegalBasisInfo => ({
    title,
    provision,
    journalReference: 'Dz.U. RP (rejestr reguł prawnych PAP)',
    effectiveFrom: `${String(effectiveYear)}-01-01`,
    effectiveTo: null,
    ruleVersion: `fallback-${String(effectiveYear)}`,
    verificationStatus: 'requires_expert_review',
    plainExplanation: ACADEMY_DISCLAIMER,
    calculationSteps: [],
    officialSourceUrl: url,
  });

  return {
    referenceDate,
    effectiveYear,
    vatExemptionLimitPln,
    vatRatesBasis: vatRatesRule
      ? mapLegalRuleToBasisInfo(vatRatesRule)
      : fallbackBasis(
          'Stawki podatku VAT (23%, 8%, 5%, 0%, zw., np.)',
          'Ustawa o VAT — art. 41, art. 43, art. 113 i art. 146ef',
          'https://www.podatki.gov.pl/vat/stawki-podatkowe/',
        ),
    vatExemptionBasis: vatExemptionRule
      ? mapLegalRuleToBasisInfo(vatExemptionRule)
      : fallbackBasis(
          `Zwolnienie podmiotowe z VAT (limit ${String(vatExemptionLimitPln)} PLN)`,
          'Ustawa o VAT — art. 113 ust. 1 i 9',
          'https://www.podatki.gov.pl/vat/',
        ),
    ryczaltBasis: ryczaltRule
      ? mapLegalRuleToBasisInfo(ryczaltRule)
      : fallbackBasis(
          'Stawki ryczałtu od przychodów ewidencjonowanych wg rodzaju czynności / PKWiU',
          'Ustawa o zryczałtowanym podatku dochodowym — art. 12 ust. 1',
          'https://www.podatki.gov.pl/pit/stawki-podatkowe/',
        ),
    purchaseKupBasis: kupRule
      ? mapLegalRuleToBasisInfo(kupRule)
      : fallbackBasis(
          'Kwalifikacja wydatku do kosztów uzyskania przychodów (KUP / NKUP)',
          'Ustawa o PIT — art. 22 ust. 1 i art. 23 ust. 1 / Ustawa o CIT — art. 15 i art. 16',
          'https://www.podatki.gov.pl/pit/',
        ),
    purchaseVatDeductionBasis: vatDeductionRule
      ? mapLegalRuleToBasisInfo(vatDeductionRule)
      : fallbackBasis(
          'Prawo do odliczenia podatku VAT naliczonego (100% / 50% pojazd / 0%)',
          'Ustawa o VAT — art. 86 ust. 1, art. 86a i art. 88',
          'https://www.podatki.gov.pl/vat/',
        ),
    dueVsPaidSummaryPl:
      'Rozróżniaj kwotę naliczoną z ksiąg (zobowiązanie wynikające z dokumentów danego okresu) od kwoty faktycznie zapłaconej przelewem. Składki ZUS społeczne i odliczalna część składki zdrowotnej pomniejszają podstawę/przychód PIT lub ryczałtu dopiero w okresie ich faktycznej zapłaty (metoda kasowa — art. 26 ust. 1 pkt 2 PIT oraz art. 11 ust. 1 PPE).',
    rulesCatalogHref: '/app/rules',
    vatLessonHref: getCanonicalLessonHref('rejestry-vat-sprzedazy-i-zakupow-stawki-23-8-5-0-zw'),
    ryczaltLessonHref: getCanonicalLessonHref('ewidencja-przychodow-stawki-ryczaltu-pkwiu'),
    kupLessonHref: getCanonicalLessonHref('koszty-uzyskania-przychodow-kup-vs-nkup'),
    disclaimerPl:
      'Przewodnik ma charakter informacyjno-edukacyjny na datę dokumentu — właściwa stawka i prawo do odliczenia zależą od rzeczywistego stanu faktycznego, kodu CN/PKWiU i spełnienia warunków ustawowych. System ani AI nie zatwierdzają klasyfikacji podatkowej za człowieka.',
  };
}
