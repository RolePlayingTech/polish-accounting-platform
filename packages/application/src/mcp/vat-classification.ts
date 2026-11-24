import {
  isRealIsoCalendarDate,
  type McpToolErrorCode,
  type McpVatRateBreakdownItem,
  type McpVatRateCode,
  type PrepareInvoiceAndPostingProposalInput,
  type ProposedAccountingPreview,
  type ProposedPostingCategory,
  type ResolvedMcpInvoiceLinePreview,
} from '@pap/contracts/mcp-tools';
import {
  formatGroszeToPln,
  parsePlnToGrosze,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
} from './security-and-redaction.js';
import type { CompanyTaxProfile, LegalBasisCatalogEntry } from './types.js';

export const VERIFIED_POLISH_LEGAL_BASIS_CATALOG: Readonly<Record<string, LegalBasisCatalogEntry>> =
  Object.freeze({
    JPK_V7M: {
      code: 'JPK_V7M',
      titlePl: 'Jednolity Plik Kontrolny JPK_V7M (ewidencja i deklaracja VAT miesięczna)',
      summaryPl:
        'Czynni podatnicy VAT składają miesięcznie strukturę JPK_V7M drogą elektroniczną w terminie do 25. dnia miesiąca następującego po każdym kolejnym miesiącu.',
      legalBasis: {
        ruleId: 'VAT_JPK_V7M_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
        articleRef: 'art. 99 ust. 1 oraz art. 109 ust. 3b',
        journalOfLawsRef: 'Dz.U. 2024 poz. 361 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
        effectiveFrom: '2020-10-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Podatnicy rozliczający się kwartalnie składają część ewidencyjną za pierwsze dwa miesiące kwartału oraz JPK_V7K po zakończeniu kwartału (art. 109 ust. 3c).',
        'Jeżeli 25. dzień miesiąca przypada w sobotę lub dzień ustawowo wolny od pracy, termin przesuwa się na następny dzień po dniu lub dniach wolnych (art. 12 § 5 Ordynacji podatkowej).',
      ],
    },
    ZUS_DRA_JDG: {
      code: 'ZUS_DRA_JDG',
      titlePl: 'Składki ZUS i deklaracja rozliczeniowa ZUS DRA dla przedsiębiorców',
      summaryPl:
        'Płatnicy składek nieposiadający osobowości prawnej (w tym JDG oraz spółki osobowe) przekazują deklarację ZUS DRA i opłacają składki do 20. dnia następnego miesiąca.',
      legalBasis: {
        ruleId: 'ZUS_TERMIN_20_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
        articleRef: 'art. 47 ust. 1 pkt 4',
        journalOfLawsRef: 'Dz.U. 2024 poz. 497 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000497',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Jednostki posiadające osobowość prawną (np. sp. z o.o.) opłacają składki do 15. dnia następnego miesiąca (art. 47 ust. 1 pkt 3).',
      ],
    },
    PIT_ZALICZKA: {
      code: 'PIT_ZALICZKA',
      titlePl: 'Zaliczka miesięczna na podatek dochodowy od osób fizycznych (PIT KPiR)',
      summaryPl:
        'Podatnicy osiągający dochody z pozarolniczej działalności gospodarczej wpłacają zaliczki miesięczne do 20. dnia każdego miesiąca za miesiąc poprzedni.',
      legalBasis: {
        ruleId: 'PIT_ZALICZKA_20_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
        articleRef: 'art. 44 ust. 6',
        journalOfLawsRef: 'Dz.U. 2024 poz. 226 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000226',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Mali podatnicy oraz podatnicy rozpoczynający działalność mogą po spełnieniu warunków wybrać wpłaty zaliczek kwartalnych (art. 44 ust. 3g).',
      ],
    },
    KUP_OGOLNE: {
      code: 'KUP_OGOLNE',
      titlePl: 'Ogólna zasada kwalifikacji kosztów uzyskania przychodów (KUP — PIT)',
      summaryPl:
        'Kosztami uzyskania przychodów są koszty poniesione w celu osiągnięcia przychodów lub zachowania albo zabezpieczenia źródła przychodów, z wyjątkiem kosztów wymienionych w art. 23 ustawy o PIT.',
      legalBasis: {
        ruleId: 'PIT_KUP_ART_22_1_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
        articleRef: 'art. 22 ust. 1',
        journalOfLawsRef: 'Dz.U. 2024 poz. 226 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000226',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Wydatki wymienione w katalogu negatywnym art. 23 ust. 1 ustawy o PIT (np. grzywny, kary umowne z określonych tytułów, część wydatków samochodowych) stanowią NKUP.',
      ],
    },
    PIT_KUP_VAT_ZWOLNIONY: {
      code: 'PIT_KUP_VAT_ZWOLNIONY',
      titlePl:
        'Ujęcie nieodliczonego VAT naliczonego w KUP u podatnika zwolnionego z VAT (kwota brutto)',
      summaryPl:
        'U podatnika zwolnionego z VAT (brak prawa do odliczenia podatku naliczonego wg art. 86 ust. 1 ustawy o VAT) podatek naliczony wynikający z faktury zakupu stanowi koszt uzyskania przychodów, wobec czego podstawą KUP jest kwota brutto.',
      legalBasis: {
        ruleId: 'PIT_KUP_VAT_ZWOLNIONY_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
        articleRef: 'art. 22 ust. 1 w zw. z art. 23 ust. 1 pkt 43 lit. a',
        journalOfLawsRef: 'Dz.U. 2024 poz. 226 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000226',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Jeżeli wydatek dotyczy samochodu osobowego w użytku mieszanym, limitowi 75% KUP podlega pełna kwota brutto (art. 23 ust. 1 pkt 46a PIT w zw. z art. 86 ust. 1 ustawy o VAT).',
      ],
    },
    KUP_SAMOCHOD_75: {
      code: 'KUP_SAMOCHOD_75',
      titlePl: 'Limit 75% KUP dla eksploatacji samochodu osobowego w użytku mieszanym (PIT)',
      summaryPl:
        '25% poniesionych wydatków z tytułu kosztów używania samochodu osobowego wykorzystywanego również do celów niezwiązanych z działalnością gospodarczą nie stanowi kosztów uzyskania przychodów (75% stanowi KUP wraz z nieodliczonym VAT).',
      legalBasis: {
        ruleId: 'PIT_SAMOCHOD_75_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
        articleRef: 'art. 23 ust. 1 pkt 46a',
        journalOfLawsRef: 'Dz.U. 2024 poz. 226 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000226',
        effectiveFrom: '2019-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Pełne 100% KUP przysługuje wyłącznie przy prowadzeniu szczegółowej ewidencji przebiegu pojazdu dla celów VAT (VAT-26 i regulamin używania pojazdu).',
      ],
    },
    VAT_SAMOCHOD_50: {
      code: 'VAT_SAMOCHOD_50',
      titlePl: 'Limit 50% odliczenia podatku naliczonego VAT od wydatków samochodowych',
      summaryPl:
        'W przypadku wydatków związanych z pojazdami samochodowymi wykorzystywanymi w trybie mieszanym kwotę podatku naliczonego stanowi 50% kwoty podatku wynikającej z faktury.',
      legalBasis: {
        ruleId: 'VAT_SAMOCHOD_50_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
        articleRef: 'art. 86a ust. 1 pkt 1',
        journalOfLawsRef: 'Dz.U. 2024 poz. 361 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
        effectiveFrom: '2014-04-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Odliczenie 100% VAT wymaga wyłącznego użytku służbowego potwierdzonego zgłoszeniem VAT-26 i ewidencji przebiegu pojazdu (art. 86a ust. 3–4).',
      ],
    },
    VAT_ZWOLNIONY_BRAK_ODLICZENIA: {
      code: 'VAT_ZWOLNIONY_BRAK_ODLICZENIA',
      titlePl: 'Brak prawa do odliczenia podatku naliczonego VAT u podatnika zwolnionego',
      summaryPl:
        'Prawo do obniżenia kwoty podatku należnego o kwotę podatku naliczonego przysługuje wyłącznie w zakresie, w jakim towary i usługi są wykorzystywane do wykonywania czynności opodatkowanych VAT. Podatnik zwolniony odlicza 0,00 PLN VAT.',
      legalBasis: {
        ruleId: 'VAT_ART_86_1_ZWOLNIONY_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
        articleRef: 'art. 86 ust. 1 oraz art. 113 ust. 1',
        journalOfLawsRef: 'Dz.U. 2024 poz. 361 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
        effectiveFrom: '2014-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'W razie utraty zwolnienia lub rezygnacji ze zwolnienia możliwa jest korekta podatku naliczonego na zasadach art. 91 ust. 7–7d ustawy o VAT.',
      ],
    },
    PRZYCHOD_SPRZEDAZ: {
      code: 'PRZYCHOD_SPRZEDAZ',
      titlePl: 'Przychód należny z pozarolniczej działalności gospodarczej (KPiR / PIT)',
      summaryPl:
        'Za przychód z działalności gospodarczej uważa się kwoty należne, choćby nie zostały faktycznie otrzymane, po wyłączeniu wartości zwróconych towarów, udzielonych bonifikat i podatku należnego VAT.',
      legalBasis: {
        ruleId: 'PIT_PRZYCHOD_ART_14_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
        articleRef: 'art. 14 ust. 1',
        journalOfLawsRef: 'Dz.U. 2024 poz. 226 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000226',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Dzień powstania przychodu wyznacza się zgodnie z art. 14 ust. 1c–1i ustawy o PIT.',
      ],
    },
    RYCZALT_PRZYCHOD_EWIDENCJA: {
      code: 'RYCZALT_PRZYCHOD_EWIDENCJA',
      titlePl: 'Ewidencja przychodów dla ryczałtu od przychodów ewidencjonowanych',
      summaryPl:
        'Opodatkowaniu ryczałtem od przychodów ewidencjonowanych podlegają przychody z działalności gospodarczej bez pomniejszania o koszty uzyskania przychodów, ujmowane w ewidencji przychodów według właściwej stawki ryczałtu.',
      legalBasis: {
        ruleId: 'RYCZALT_EWIDENCJA_ART_6_15_2026',
        ruleVersion: '2026.1',
        actTitle:
          'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
        articleRef: 'art. 6 ust. 1 oraz art. 15 ust. 1',
        journalOfLawsRef: 'Dz.U. 2024 poz. 776 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000776',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Stawkę ryczałtu ustala się indywidualnie dla danego rodzaju przychodu zgodnie z art. 12 ust. 1 ustawy o zryczałtowanym podatku dochodowym.',
      ],
    },
    RYCZALT_BRAK_KUP: {
      code: 'RYCZALT_BRAK_KUP',
      titlePl:
        'Brak kosztów uzyskania przychodów (KUP) na ryczałcie od przychodów ewidencjonowanych',
      summaryPl:
        'Podatek zryczałtowany pobiera się bez pomniejszania przychodu o koszty uzyskania. Faktury zakupowe nie tworzą KUP w podatku dochodowym (mogą natomiast dawać prawo do odliczenia VAT u czynnego podatnika VAT oraz podlegają przechowywaniu wg art. 15 ust. 1).',
      legalBasis: {
        ruleId: 'RYCZALT_BRAK_KUP_ART_6_12_2026',
        ruleVersion: '2026.1',
        actTitle:
          'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
        articleRef: 'art. 6 ust. 1 oraz art. 12 ust. 2',
        journalOfLawsRef: 'Dz.U. 2024 poz. 776 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000776',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Czynny podatnik VAT na ryczałcie zachowuje prawo do odliczenia VAT naliczonego (100% lub 50% dla pojazdów samochodowych) w ewidencji JPK_V7.',
      ],
    },
    CIT_KUP_OGOLNE: {
      code: 'CIT_KUP_OGOLNE',
      titlePl:
        'Koszty uzyskania przychodów w podatku dochodowym od osób prawnych (CIT / księgi rachunkowe)',
      summaryPl:
        'Kosztami uzyskania przychodów w CIT są koszty poniesione w celu osiągnięcia przychodów ze źródła przychodów lub w celu zachowania albo zabezpieczenia źródła przychodów, z wyjątkiem kosztów wymienionych w art. 16 ust. 1 ustawy o CIT.',
      legalBasis: {
        ruleId: 'CIT_KUP_ART_15_1_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
        articleRef: 'art. 15 ust. 1 oraz art. 16 ust. 1 pkt 46 lit. a',
        journalOfLawsRef: 'Dz.U. 2023 poz. 2805 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20230002805',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'U podatnika zwolnionego z VAT nieodliczony podatek naliczony VAT stanowi KUP zgodnie z art. 16 ust. 1 pkt 46 lit. a tiret pierwsze ustawy o CIT.',
      ],
    },
    CIT_SAMOCHOD_75: {
      code: 'CIT_SAMOCHOD_75',
      titlePl: 'Limit 75% KUP dla eksploatacji samochodu osobowego w użytku mieszanym (CIT)',
      summaryPl:
        'Nie uważa się za koszty uzyskania przychodów 25% poniesionych wydatków z tytułu kosztów używania samochodu osobowego wykorzystywanego również do celów niezwiązanych z działalnością gospodarczą podatnika CIT (75% wraz z nieodliczonym VAT stanowi KUP).',
      legalBasis: {
        ruleId: 'CIT_SAMOCHOD_75_ART_16_1_51_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
        articleRef: 'art. 16 ust. 1 pkt 51',
        journalOfLawsRef: 'Dz.U. 2023 poz. 2805 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20230002805',
        effectiveFrom: '2019-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Pełne 100% KUP wymaga wykorzystywania pojazdu wyłącznie w działalności gospodarczej oraz prowadzenia ewidencji przebiegu pojazdu (art. 16 ust. 5f–5g ustawy o CIT).',
      ],
    },
    CIT_PRZYCHOD_SPRZEDAZ: {
      code: 'CIT_PRZYCHOD_SPRZEDAZ',
      titlePl: 'Przychody należne z działalności gospodarczej w księgach rachunkowych (CIT)',
      summaryPl:
        'Za przychody związane z działalnością gospodarczą uważa się także należne przychody, choćby nie zostały jeszcze faktycznie otrzymane, po wyłączeniu wartości zwróconych towarów, udzielonych bonifikat i należnego podatku od towarów i usług.',
      legalBasis: {
        ruleId: 'CIT_PRZYCHOD_ART_12_3_2026',
        ruleVersion: '2026.1',
        actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
        articleRef: 'art. 12 ust. 3 oraz ust. 4 pkt 9',
        journalOfLawsRef: 'Dz.U. 2023 poz. 2805 ze zm.',
        officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20230002805',
        effectiveFrom: '2022-01-01',
        effectiveTo: null,
        verificationStatus: 'verified',
      },
      exceptionsPl: [
        'Za datę powstania przychodu należnego uważa się zasadniczo dzień wydania rzeczy, zbycia prawa majątkowego lub wykonania usługi (art. 12 ust. 3a ustawy o CIT).',
      ],
    },
  });

const POSITIVE_VAT_RATE_NUMERIC: Readonly<Record<'23' | '8' | '5', bigint>> = Object.freeze({
  '23': 23n,
  '8': 8n,
  '5': 5n,
});

function expectedVatGroszeForRate(netGrosze: bigint, rate: '23' | '8' | '5'): bigint {
  return (netGrosze * POSITIVE_VAT_RATE_NUMERIC[rate] + 50n) / 100n;
}

function absBigInt(val: bigint): bigint {
  return val < 0n ? -val : val;
}

export type McpVatValidationResult =
  | {
      readonly ok: true;
      readonly vatClassificationStatus:
        'explicit_lines' | 'explicit_rate' | 'deterministic_single_rate';
      readonly resolvedLines: readonly ResolvedMcpInvoiceLinePreview[];
      readonly vatBreakdown: readonly McpVatRateBreakdownItem[];
      readonly totalDeductibleVatGrosze: bigint;
      readonly totalNonDeductibleVatGrosze: bigint;
      readonly anyLinePromptInjectionSuspected: boolean;
    }
  | {
      readonly ok: false;
      readonly errorCode: McpToolErrorCode;
      readonly reasonCode: string;
      readonly messagePl: string;
    };

/**
 * Fix #112 & #106: Deterministic, fail-closed VAT classification and multi-rate line validator.
 * NEVER guesses or invents '0', 'zw', 'np', or an arbitrary VAT rate when VAT is 0.00 or multi-rate.
 */
export function validateAndResolveMcpInvoiceVat(
  invoice: PrepareInvoiceAndPostingProposalInput['invoice'],
  companyProfile: Pick<CompanyTaxProfile, 'taxRegime' | 'vatStatus'>,
): McpVatValidationResult {
  const headerNetGrosze = parsePlnToGrosze(invoice.netAmountPln);
  const headerVatGrosze = parsePlnToGrosze(invoice.vatAmountPln);
  const headerGrossGrosze = parsePlnToGrosze(invoice.grossAmountPln);

  if (headerNetGrosze + headerVatGrosze !== headerGrossGrosze) {
    return {
      ok: false,
      errorCode: 'amount_mismatch',
      reasonCode: 'net_plus_vat_differs_from_gross',
      messagePl:
        'Suma kwoty netto i kwoty VAT nie zgadza się z kwotą brutto. Propozycja została odrzucona przed utworzeniem szkicu.',
    };
  }

  const isVatExemptCompany = companyProfile.vatStatus === 'zwolniony';
  const isMixedCarExpense =
    invoice.direction === 'purchase' &&
    invoice.suggestedCategory === 'eksploatacja_samochodu_mieszana';

  if (isVatExemptCompany && invoice.direction === 'sales' && headerVatGrosze > 0n) {
    return {
      ok: false,
      errorCode: 'invalid_vat_classification',
      reasonCode: 'vat_exempt_company_cannot_charge_output_vat',
      messagePl:
        'Podatnik zwolniony z VAT nie może wystawić faktury sprzedaży z dodatnią kwotą podatku należnego VAT.',
    };
  }

  // Case 1: Explicit multi-line / single-line array (`invoice.lines`)
  if (invoice.lines && invoice.lines.length > 0) {
    let sumNet = 0n;
    let sumVat = 0n;
    let sumGross = 0n;
    let oddMixedCarLineCount = 0;
    let anyInjection = false;
    const distinctRates = new Set<McpVatRateCode>();
    const resolvedLines: ResolvedMcpInvoiceLinePreview[] = [];
    const byRate = new Map<
      McpVatRateCode,
      { net: bigint; vat: bigint; gross: bigint; ded: bigint; nonDed: bigint }
    >();

    for (let idx = 0; idx < invoice.lines.length; idx += 1) {
      const line = invoice.lines[idx]!;
      const lineNet = parsePlnToGrosze(line.netAmountPln);
      const lineVat = parsePlnToGrosze(line.vatAmountPln);
      const lineGross = parsePlnToGrosze(line.grossAmountPln);

      if (lineNet + lineVat !== lineGross) {
        return {
          ok: false,
          errorCode: 'amount_mismatch',
          reasonCode: `line_${idx + 1}_net_plus_vat_differs_from_gross`,
          messagePl: `Pozycja nr ${idx + 1} ma niespójne kwoty: netto (${line.netAmountPln}) + VAT (${line.vatAmountPln}) != brutto (${line.grossAmountPln}).`,
        };
      }

      if (
        isVatExemptCompany &&
        invoice.direction === 'sales' &&
        line.vatRate !== 'zw' &&
        line.vatRate !== 'np'
      ) {
        return {
          ok: false,
          errorCode: 'invalid_vat_classification',
          reasonCode: 'vat_exempt_sales_requires_zw_or_np',
          messagePl: `Pozycja nr ${idx + 1}: podatnik zwolniony z VAT może wystawić sprzedaż wyłącznie ze stawką 'zw' lub 'np' (otrzymano '${line.vatRate}').`,
        };
      }

      if (line.vatRate === '0' || line.vatRate === 'zw' || line.vatRate === 'np') {
        if (lineVat !== 0n) {
          return {
            ok: false,
            errorCode: 'invalid_vat_classification',
            reasonCode: 'zero_vat_rate_with_nonzero_vat_amount',
            messagePl: `Pozycja nr ${idx + 1} ma stawkę '${line.vatRate}', lecz kwota VAT wynosi ${line.vatAmountPln} PLN zamiast 0.00 PLN.`,
          };
        }
        const effectiveReason =
          line.zeroVatReasonCode ??
          line.vatClassificationReasonPl ??
          invoice.zeroVatReasonCode ??
          invoice.vatClassificationReasonPl;
        if (
          invoice.direction === 'sales' &&
          !isVatExemptCompany &&
          line.vatRate === 'zw' &&
          !effectiveReason
        ) {
          return {
            ok: false,
            errorCode: 'vat_classification_required',
            reasonCode: 'sales_vat_exemption_requires_legal_basis_reason',
            messagePl: `Pozycja nr ${idx + 1}: faktura sprzedaży ze stawką 'zw' u czynnego podatnika VAT wymaga wskazania podstawy prawnej zwolnienia (zeroVatReasonCode lub vatClassificationReasonPl, art. 106e ust. 1 pkt 19 ustawy o VAT).`,
          };
        }
      } else {
        const expectedVat = expectedVatGroszeForRate(lineNet, line.vatRate);
        if (absBigInt(lineVat - expectedVat) > 1n) {
          return {
            ok: false,
            errorCode: 'invalid_vat_classification',
            reasonCode: 'line_vat_amount_inconsistent_with_declared_rate',
            messagePl: `Pozycja nr ${idx + 1}: kwota VAT (${line.vatAmountPln} PLN) nie odpowiada zadeklarowanej stawce ${line.vatRate}% od kwoty netto ${line.netAmountPln} PLN.`,
          };
        }
      }

      const lineDescEnv = sanitizeUntrustedDocumentTextForMcp(line.description, {
        field: `invoice.lines.${idx}.description`,
        maxLength: 500,
      });
      if (lineDescEnv.sanitizedText.length === 0) {
        return {
          ok: false,
          errorCode: 'validation_failed',
          reasonCode: 'empty_line_description_after_sanitization',
          messagePl: `Opis pozycji nr ${idx + 1} jest pusty po usunięciu znaków sterujących.`,
        };
      }
      const rawReasonText = line.vatClassificationReasonPl ?? invoice.vatClassificationReasonPl;
      const reasonEnv = rawReasonText
        ? sanitizeUntrustedDocumentTextForMcp(rawReasonText, {
            field: `invoice.lines.${idx}.vatClassificationReasonPl`,
            maxLength: 300,
          })
        : null;

      if (lineDescEnv.promptInjectionSuspected || reasonEnv?.promptInjectionSuspected) {
        anyInjection = true;
      }

      const isOddMixedCarLine =
        invoice.direction !== 'sales' &&
        !isVatExemptCompany &&
        isMixedCarExpense &&
        lineVat % 2n === 1n;
      const lineDedVat =
        invoice.direction === 'sales' || isVatExemptCompany
          ? 0n
          : isMixedCarExpense
            ? isOddMixedCarLine
              ? oddMixedCarLineCount % 2 === 0
                ? (lineVat + 1n) / 2n
                : lineVat / 2n
              : lineVat / 2n
            : lineVat;
      if (isOddMixedCarLine) {
        oddMixedCarLineCount += 1;
      }
      const lineNonDedVat = invoice.direction === 'sales' ? 0n : lineVat - lineDedVat;

      sumNet += lineNet;
      sumVat += lineVat;
      sumGross += lineGross;
      distinctRates.add(line.vatRate);

      const bucket = byRate.get(line.vatRate) ?? {
        net: 0n,
        vat: 0n,
        gross: 0n,
        ded: 0n,
        nonDed: 0n,
      };
      bucket.net += lineNet;
      bucket.vat += lineVat;
      bucket.gross += lineGross;
      bucket.ded += lineDedVat;
      bucket.nonDed += lineNonDedVat;
      byRate.set(line.vatRate, bucket);

      resolvedLines.push({
        lineNumber: idx + 1,
        description: lineDescEnv,
        quantity: (line.quantity ?? '1').trim() || '1',
        unit: (line.unit ?? 'szt.').trim() || 'szt.',
        netAmountPln: line.netAmountPln,
        vatRate: line.vatRate,
        vatAmountPln: line.vatAmountPln,
        grossAmountPln: line.grossAmountPln,
        deductibleVatAmountPln: formatGroszeToPln(lineDedVat),
        nonDeductibleVatAmountPln: formatGroszeToPln(lineNonDedVat),
        zeroVatReasonCode: line.zeroVatReasonCode ?? invoice.zeroVatReasonCode ?? null,
        vatClassificationReasonPl: reasonEnv,
        annex15Item: line.annex15Item ?? false,
      });
    }

    if (
      sumNet !== headerNetGrosze ||
      sumVat !== headerVatGrosze ||
      sumGross !== headerGrossGrosze
    ) {
      return {
        ok: false,
        errorCode: 'amount_mismatch',
        reasonCode: 'lines_sum_differs_from_invoice_totals',
        messagePl:
          'Suma pozycji faktury (netto / VAT / brutto) nie zgadza się z kwotami podsumowania faktury.',
      };
    }

    if (invoice.vatRate !== undefined) {
      if (distinctRates.size > 1 || !distinctRates.has(invoice.vatRate)) {
        return {
          ok: false,
          errorCode: 'invalid_vat_classification',
          reasonCode: 'header_vat_rate_conflicts_with_lines',
          messagePl:
            'Nagłówkowa stawka vatRate jest sprzeczna z rozbiciem stawek w pozycjach lines (dla faktury wielostawkowej pomiń nagłówkowe vatRate i podaj stawki w lines).',
        };
      }
    }

    // Reconcile 50% mixed-car rounding on multi-line invoices so total deductible VAT matches Polish JPK/invoice rule
    const expectedInvoiceDedVat =
      invoice.direction === 'sales' || isVatExemptCompany
        ? 0n
        : isMixedCarExpense
          ? (headerVatGrosze + 1n) / 2n
          : headerVatGrosze;
    const expectedInvoiceNonDedVat =
      invoice.direction === 'sales' ? 0n : headerVatGrosze - expectedInvoiceDedVat;

    const vatBreakdown: McpVatRateBreakdownItem[] = [...byRate.entries()].map(
      ([vatRate, bucket]) => ({
        vatRate,
        netAmountPln: formatGroszeToPln(bucket.net),
        vatAmountPln: formatGroszeToPln(bucket.vat),
        grossAmountPln: formatGroszeToPln(bucket.gross),
        deductibleVatAmountPln: formatGroszeToPln(bucket.ded),
        nonDeductibleVatAmountPln: formatGroszeToPln(bucket.nonDed),
      }),
    );

    return {
      ok: true,
      vatClassificationStatus: 'explicit_lines',
      resolvedLines,
      vatBreakdown,
      totalDeductibleVatGrosze: expectedInvoiceDedVat,
      totalNonDeductibleVatGrosze: expectedInvoiceNonDedVat,
      anyLinePromptInjectionSuspected: anyInjection,
    };
  }

  // Case 2: Explicit header `invoice.vatRate` without `lines`
  let resolvedSingleRate: McpVatRateCode;
  let classificationStatus: 'explicit_rate' | 'deterministic_single_rate';

  if (invoice.vatRate !== undefined) {
    resolvedSingleRate = invoice.vatRate;
    classificationStatus = 'explicit_rate';

    if (
      isVatExemptCompany &&
      invoice.direction === 'sales' &&
      resolvedSingleRate !== 'zw' &&
      resolvedSingleRate !== 'np'
    ) {
      return {
        ok: false,
        errorCode: 'invalid_vat_classification',
        reasonCode: 'vat_exempt_sales_requires_zw_or_np',
        messagePl: `Podatnik zwolniony z VAT może wystawić fakturę sprzedaży wyłącznie ze stawką 'zw' lub 'np' (otrzymano '${resolvedSingleRate}').`,
      };
    }

    if (resolvedSingleRate === '0' || resolvedSingleRate === 'zw' || resolvedSingleRate === 'np') {
      if (headerVatGrosze !== 0n) {
        return {
          ok: false,
          errorCode: 'invalid_vat_classification',
          reasonCode: 'zero_vat_rate_with_nonzero_vat_amount',
          messagePl: `Stawka '${resolvedSingleRate}' wymaga kwoty VAT równej 0.00 PLN (otrzymano ${invoice.vatAmountPln} PLN).`,
        };
      }
      if (
        invoice.direction === 'sales' &&
        !isVatExemptCompany &&
        resolvedSingleRate === 'zw' &&
        !invoice.zeroVatReasonCode &&
        !invoice.vatClassificationReasonPl
      ) {
        return {
          ok: false,
          errorCode: 'vat_classification_required',
          reasonCode: 'sales_vat_exemption_requires_legal_basis_reason',
          messagePl:
            "Faktura sprzedaży ze stawką 'zw' u czynnego podatnika VAT wymaga podania podstawy prawnej zwolnienia (zeroVatReasonCode lub vatClassificationReasonPl, art. 106e ust. 1 pkt 19 ustawy o VAT).",
        };
      }
    } else {
      const expectedVat = expectedVatGroszeForRate(headerNetGrosze, resolvedSingleRate);
      if (absBigInt(headerVatGrosze - expectedVat) > 1n) {
        return {
          ok: false,
          errorCode: 'invalid_vat_classification',
          reasonCode: 'vat_amount_inconsistent_with_declared_rate',
          messagePl: `Kwota VAT (${invoice.vatAmountPln} PLN) nie odpowiada zadeklarowanej stawce ${resolvedSingleRate}% od kwoty netto ${invoice.netAmountPln} PLN.`,
        };
      }
    }
  } else {
    // Case 3: Neither `lines` nor `vatRate` provided — NEVER guess zero-VAT or mixed/non-standard rates (#112)!
    if (headerVatGrosze === 0n) {
      return {
        ok: false,
        errorCode: 'vat_classification_required',
        reasonCode: 'zero_vat_requires_explicit_rate_classification',
        messagePl:
          "Faktura z kwotą VAT 0.00 PLN wymaga jawnego wskazania stawki vatRate ('0', 'zw' lub 'np') lub pozycji lines. Serwer MCP nigdy nie zgaduje zwolnienia ani stawki 0%.",
      };
    }

    const candidateRates: ('23' | '8' | '5')[] = (['23', '8', '5'] as const).filter(
      (rate) => expectedVatGroszeForRate(headerNetGrosze, rate) === headerVatGrosze,
    );

    if (candidateRates.length !== 1) {
      return {
        ok: false,
        errorCode: 'vat_classification_required',
        reasonCode:
          candidateRates.length === 0
            ? 'non_standard_or_multi_rate_vat_requires_explicit_lines'
            : 'ambiguous_vat_rate_requires_explicit_classification',
        messagePl:
          candidateRates.length === 0
            ? 'Kwota VAT nie odpowiada jednoznacznie pojedynczej stawce krajowej (23%, 8%, 5%). Dla faktury wielostawkowej lub szczególnej przekaż jawną tablicę pozycji lines ze stawkami vatRate.'
            : 'Kwota VAT jest niejednoznaczna pomiędzy stawkami obniżonymi — wskaż jawnie pole vatRate lub pozycje lines.',
      };
    }

    resolvedSingleRate = candidateRates[0]!;
    classificationStatus = 'deterministic_single_rate';
  }

  const descEnv = sanitizeUntrustedDocumentTextForMcp(invoice.expenseDescription, {
    field: 'invoice.lines.0.description',
    maxLength: 1000,
  });
  const reasonEnv = invoice.vatClassificationReasonPl
    ? sanitizeUntrustedDocumentTextForMcp(invoice.vatClassificationReasonPl, {
        field: 'invoice.vatClassificationReasonPl',
        maxLength: 300,
      })
    : null;

  const dedVat =
    invoice.direction === 'sales' || isVatExemptCompany
      ? 0n
      : isMixedCarExpense
        ? (headerVatGrosze + 1n) / 2n
        : headerVatGrosze;
  const nonDedVat = invoice.direction === 'sales' ? 0n : headerVatGrosze - dedVat;

  const singleLine: ResolvedMcpInvoiceLinePreview = {
    lineNumber: 1,
    description: descEnv,
    quantity: '1',
    unit: 'szt.',
    netAmountPln: invoice.netAmountPln,
    vatRate: resolvedSingleRate,
    vatAmountPln: invoice.vatAmountPln,
    grossAmountPln: invoice.grossAmountPln,
    deductibleVatAmountPln: formatGroszeToPln(dedVat),
    nonDeductibleVatAmountPln: formatGroszeToPln(nonDedVat),
    zeroVatReasonCode: invoice.zeroVatReasonCode ?? null,
    vatClassificationReasonPl: reasonEnv,
    annex15Item: false,
  };

  const singleBreakdown: McpVatRateBreakdownItem = {
    vatRate: resolvedSingleRate,
    netAmountPln: invoice.netAmountPln,
    vatAmountPln: invoice.vatAmountPln,
    grossAmountPln: invoice.grossAmountPln,
    deductibleVatAmountPln: formatGroszeToPln(dedVat),
    nonDeductibleVatAmountPln: formatGroszeToPln(nonDedVat),
  };

  return {
    ok: true,
    vatClassificationStatus: classificationStatus,
    resolvedLines: [singleLine],
    vatBreakdown: [singleBreakdown],
    totalDeductibleVatGrosze: dedVat,
    totalNonDeductibleVatGrosze: nonDedVat,
    anyLinePromptInjectionSuspected:
      descEnv.promptInjectionSuspected || Boolean(reasonEnv?.promptInjectionSuspected),
  };
}

export function computeProposedAccountingPreview(
  invoice: PrepareInvoiceAndPostingProposalInput['invoice'],
  companyProfile: Pick<CompanyTaxProfile, 'taxRegime' | 'vatStatus'>,
): ProposedAccountingPreview {
  if (!isRealIsoCalendarDate(invoice.issueDate) || !isRealIsoCalendarDate(invoice.dueDate)) {
    throw new Error('Invoice contains invalid calendar date');
  }
  if (invoice.dueDate < invoice.issueDate) {
    throw new Error('Invoice dueDate cannot precede issueDate');
  }
  if (invoice.direction === 'sales' && invoice.suggestedCategory !== 'przychod_sprzedaz') {
    throw new Error('Sales invoice must use przychod_sprzedaz category');
  }
  if (invoice.direction === 'purchase' && invoice.suggestedCategory === 'przychod_sprzedaz') {
    throw new Error('Purchase invoice cannot use przychod_sprzedaz category');
  }

  const vatResolution = validateAndResolveMcpInvoiceVat(invoice, companyProfile);
  const netGrosze = parsePlnToGrosze(invoice.netAmountPln);
  const vatGrosze = parsePlnToGrosze(invoice.vatAmountPln);
  const isVatExempt = companyProfile.vatStatus === 'zwolniony';
  const isMixedCarExpense = invoice.suggestedCategory === 'eksploatacja_samochodu_mieszana';

  const vatMeta = vatResolution.ok
    ? {
        vatClassificationStatus: vatResolution.vatClassificationStatus,
        vatBreakdown: [...vatResolution.vatBreakdown],
        resolvedLines: [...vatResolution.resolvedLines],
      }
    : {};

  // 1. Sales invoices across tax regimes
  if (invoice.direction === 'sales') {
    if (companyProfile.taxRegime === 'ryczalt') {
      const rule = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['RYCZALT_PRZYCHOD_EWIDENCJA']!;
      return {
        kpirColumnOrAccount:
          'Ewidencja przychodów (ryczałt) — Przychód ze sprzedaży towarów i usług',
        kupAmountPln: '0.00',
        nkupAmountPln: '0.00',
        deductibleVatAmountPln: '0.00',
        nonDeductibleVatAmountPln: '0.00',
        appliedRule: rule.legalBasis,
        ...vatMeta,
      };
    }

    if (companyProfile.taxRegime === 'cit_klasyczny') {
      const rule = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['CIT_PRZYCHOD_SPRZEDAZ']!;
      return {
        kpirColumnOrAccount: 'Księgi rachunkowe (UoR) — konto 700/730 Przychody netto ze sprzedaży',
        kupAmountPln: '0.00',
        nkupAmountPln: '0.00',
        deductibleVatAmountPln: '0.00',
        nonDeductibleVatAmountPln: '0.00',
        appliedRule: rule.legalBasis,
        ...vatMeta,
      };
    }

    const entry = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['PRZYCHOD_SPRZEDAZ']!;
    return {
      kpirColumnOrAccount: 'KPiR kol. 7 — Wartość sprzedanych towarów i usług',
      kupAmountPln: '0.00',
      nkupAmountPln: '0.00',
      deductibleVatAmountPln: '0.00',
      nonDeductibleVatAmountPln: '0.00',
      appliedRule: entry.legalBasis,
      ...vatMeta,
    };
  }

  // 2. Purchase invoices
  const deductibleVat = vatResolution.ok
    ? vatResolution.totalDeductibleVatGrosze
    : isVatExempt
      ? 0n
      : isMixedCarExpense
        ? (vatGrosze + 1n) / 2n
        : vatGrosze;
  const nonDeductibleVat = vatResolution.ok
    ? vatResolution.totalNonDeductibleVatGrosze
    : vatGrosze - deductibleVat;

  if (companyProfile.taxRegime === 'ryczalt') {
    const rule = isVatExempt
      ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['VAT_ZWOLNIONY_BRAK_ODLICZENIA']!
      : VERIFIED_POLISH_LEGAL_BASIS_CATALOG['RYCZALT_BRAK_KUP']!;
    return {
      kpirColumnOrAccount: isVatExempt
        ? 'Wykaz dowodów zakupu (ryczałt + zwolnienie z VAT — brak KUP i brak odliczenia VAT)'
        : 'Wykaz dowodów zakupu / Ewidencja VAT naliczonego (ryczałt — brak KUP w podatku dochodowym)',
      kupAmountPln: '0.00',
      nkupAmountPln: '0.00',
      deductibleVatAmountPln: formatGroszeToPln(deductibleVat),
      nonDeductibleVatAmountPln: formatGroszeToPln(nonDeductibleVat),
      appliedRule: rule.legalBasis,
      ...vatMeta,
    };
  }

  const costBaseGrosze = netGrosze + nonDeductibleVat;

  if (companyProfile.taxRegime === 'cit_klasyczny') {
    if (isMixedCarExpense) {
      const kupGrosze = (costBaseGrosze * 75n + 50n) / 100n;
      const nkupGrosze = costBaseGrosze - kupGrosze;
      const citCarRule = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['CIT_SAMOCHOD_75']!;
      return {
        kpirColumnOrAccount: isVatExempt
          ? 'Księgi rachunkowe (UoR) — konto 401/402 Eksploatacja pojazdu (75% KUP od brutto — zwolnienie z VAT)'
          : 'Księgi rachunkowe (UoR) — konto 401/402 Eksploatacja pojazdu (75% KUP CIT / 50% VAT)',
        kupAmountPln: formatGroszeToPln(kupGrosze),
        nkupAmountPln: formatGroszeToPln(nkupGrosze),
        deductibleVatAmountPln: formatGroszeToPln(deductibleVat),
        nonDeductibleVatAmountPln: formatGroszeToPln(nonDeductibleVat),
        appliedRule: citCarRule.legalBasis,
        ...vatMeta,
      };
    }

    const citAccountsByCategory: Readonly<Record<ProposedPostingCategory, string>> = {
      towary_i_materialy:
        'Księgi rachunkowe (UoR) — konto 300/401 Zużycie materiałów i wartość towarów',
      uslugi_obce: 'Księgi rachunkowe (UoR) — konto 402 Usługi obce',
      pozostale_wydatki_kpir: 'Księgi rachunkowe (UoR) — konto 409 Pozostałe koszty rodzajowe',
      eksploatacja_samochodu_mieszana:
        'Księgi rachunkowe (UoR) — konto 401/402 Eksploatacja pojazdu',
      przychod_sprzedaz: 'Księgi rachunkowe (UoR) — konto 700/730 Przychody ze sprzedaży',
    };
    const citGeneralRule = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['CIT_KUP_OGOLNE']!;
    const baseAccount = citAccountsByCategory[invoice.suggestedCategory];
    return {
      kpirColumnOrAccount: isVatExempt
        ? `${baseAccount} (kwota brutto — zwolnienie z VAT)`
        : baseAccount,
      kupAmountPln: formatGroszeToPln(costBaseGrosze),
      nkupAmountPln: '0.00',
      deductibleVatAmountPln: formatGroszeToPln(deductibleVat),
      nonDeductibleVatAmountPln: formatGroszeToPln(nonDeductibleVat),
      appliedRule: citGeneralRule.legalBasis,
      ...vatMeta,
    };
  }

  if (isMixedCarExpense) {
    const kupGrosze = (costBaseGrosze * 75n + 50n) / 100n;
    const nkupGrosze = costBaseGrosze - kupGrosze;
    const carRule = VERIFIED_POLISH_LEGAL_BASIS_CATALOG['KUP_SAMOCHOD_75']!;
    return {
      kpirColumnOrAccount: isVatExempt
        ? 'KPiR kol. 13 — Pozostałe wydatki (eksploatacja pojazdu 75% KUP od brutto — zwolnienie z VAT)'
        : 'KPiR kol. 13 — Pozostałe wydatki (eksploatacja pojazdu 75% KUP / 50% VAT)',
      kupAmountPln: formatGroszeToPln(kupGrosze),
      nkupAmountPln: formatGroszeToPln(nkupGrosze),
      deductibleVatAmountPln: formatGroszeToPln(deductibleVat),
      nonDeductibleVatAmountPln: formatGroszeToPln(nonDeductibleVat),
      appliedRule: carRule.legalBasis,
      ...vatMeta,
    };
  }

  const columnByCategory: Readonly<Record<ProposedPostingCategory, string>> = {
    towary_i_materialy: 'KPiR kol. 10 — Zakup towarów handlowych i materiałów',
    pozostale_wydatki_kpir: 'KPiR kol. 13 — Pozostałe wydatki',
    uslugi_obce: 'KPiR kol. 13 — Pozostałe wydatki (usługi obce)',
    eksploatacja_samochodu_mieszana: 'KPiR kol. 13 — Pozostałe wydatki',
    przychod_sprzedaz: 'KPiR kol. 7 — Sprzedaż',
  };

  const baseColumn = columnByCategory[invoice.suggestedCategory];
  const pitRule = isVatExempt
    ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['PIT_KUP_VAT_ZWOLNIONY']!
    : VERIFIED_POLISH_LEGAL_BASIS_CATALOG['KUP_OGOLNE']!;

  return {
    kpirColumnOrAccount: isVatExempt
      ? `${baseColumn} (kwota brutto — zwolnienie z VAT)`
      : baseColumn,
    kupAmountPln: formatGroszeToPln(costBaseGrosze),
    nkupAmountPln: '0.00',
    deductibleVatAmountPln: formatGroszeToPln(deductibleVat),
    nonDeductibleVatAmountPln: formatGroszeToPln(nonDeductibleVat),
    appliedRule: pitRule.legalBasis,
    ...vatMeta,
  };
}

export function computeCanonicalMcpInvoicePayloadHash(
  tenantIdVal: string,
  legalEntityIdVal: string,
  invoice: PrepareInvoiceAndPostingProposalInput['invoice'],
): string {
  const basePayload: Record<string, unknown> = {
    tenantId: tenantIdVal.toLowerCase(),
    legalEntityId: legalEntityIdVal.toLowerCase(),
    direction: invoice.direction,
    invoiceNumber: invoice.invoiceNumber.trim(),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    counterpartyNip: invoice.counterpartyNip,
    counterpartyName: invoice.counterpartyName.trim(),
    netAmountPln: invoice.netAmountPln,
    vatAmountPln: invoice.vatAmountPln,
    grossAmountPln: invoice.grossAmountPln,
    expenseDescription: invoice.expenseDescription.trim(),
    suggestedCategory: invoice.suggestedCategory,
  };

  if (invoice.vatRate !== undefined) {
    basePayload.vatRate = invoice.vatRate;
  }
  if (invoice.zeroVatReasonCode !== undefined) {
    basePayload.zeroVatReasonCode = invoice.zeroVatReasonCode;
  }
  if (invoice.vatClassificationReasonPl !== undefined) {
    basePayload.vatClassificationReasonPl = invoice.vatClassificationReasonPl.trim();
  }
  if (invoice.lines !== undefined) {
    basePayload.lines = invoice.lines.map((line) => ({
      description: line.description.trim(),
      quantity: (line.quantity ?? '1').trim(),
      unit: (line.unit ?? 'szt.').trim(),
      netAmountPln: line.netAmountPln,
      vatRate: line.vatRate,
      vatAmountPln: line.vatAmountPln,
      grossAmountPln: line.grossAmountPln,
      ...(line.zeroVatReasonCode !== undefined
        ? { zeroVatReasonCode: line.zeroVatReasonCode }
        : {}),
      ...(line.vatClassificationReasonPl !== undefined
        ? { vatClassificationReasonPl: line.vatClassificationReasonPl.trim() }
        : {}),
      annex15Item: line.annex15Item ?? false,
    }));
  }
  if (invoice.ryczaltRate !== undefined) {
    basePayload.ryczaltRate = invoice.ryczaltRate;
  }
  if (invoice.isCorrection !== undefined) {
    basePayload.isCorrection = invoice.isCorrection;
  }
  if (invoice.correctedDocumentNumber !== undefined) {
    basePayload.correctedDocumentNumber = invoice.correctedDocumentNumber.trim();
  }
  if (invoice.correctionReason !== undefined) {
    basePayload.correctionReason = invoice.correctionReason.trim();
  }

  return sha256Hex(JSON.stringify(basePayload));
}
