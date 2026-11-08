import {
  assertValidIsoCalendarDate,
  buildLegalExplanation,
  getRequiredNumericParameter,
  resolveRuleAtDate,
} from '../legal-rules/index.js';
import type {
  ExplanationStep,
  ExplanationWarning,
  LegalExplanation,
  LegalRule,
} from '../legal-rules/index.js';
import {
  addGrosze,
  assertNonNegativeGrosze,
  assertSafeGrosze,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
} from '../money.js';

export type LedgerSide = 'Wn' | 'Ma';
export type AccountClassGroup = 0 | 1 | 2 | 3 | 4 | 7 | 8;
export type AccountNature =
  'asset' | 'contra_asset' | 'liability' | 'equity' | 'revenue' | 'expense' | 'tax_expense';

export interface LedgerAccountDefinition {
  readonly code: string;
  readonly name: string;
  readonly classGroup: AccountClassGroup;
  readonly nature: AccountNature;
}

/**
 * Wzorcowy plan kont dla spółki z o.o. zgodny z Ustawą o rachunkowości (Zespoły 0, 1, 2, 3, 4, 7, 8).
 */
export const STANDARD_SPZOO_CHART_OF_ACCOUNTS: readonly LedgerAccountDefinition[] = [
  // Zespół 0 — Aktywa trwałe
  { code: '010', name: 'Środki trwałe', classGroup: 0, nature: 'asset' },
  { code: '020', name: 'Wartości niematerialne i prawne', classGroup: 0, nature: 'asset' },
  {
    code: '070',
    name: 'Umorzenie środków trwałych oraz WNiP',
    classGroup: 0,
    nature: 'contra_asset',
  },
  { code: '080', name: 'Środki trwałe w budowie', classGroup: 0, nature: 'asset' },

  // Zespół 1 — Środki pieniężne i rachunki bankowe
  { code: '100', name: 'Kasa', classGroup: 1, nature: 'asset' },
  { code: '130', name: 'Bieżący rachunek bankowy', classGroup: 1, nature: 'asset' },
  { code: '131', name: 'Rachunek VAT (Split Payment)', classGroup: 1, nature: 'asset' },
  { code: '135', name: 'Kredyty bankowe', classGroup: 1, nature: 'liability' },

  // Zespół 2 — Rozrachunki i roszczenia
  { code: '201', name: 'Rozrachunki z odbiorcami krajowymi', classGroup: 2, nature: 'asset' },
  { code: '202', name: 'Rozrachunki z dostawcami krajowymi', classGroup: 2, nature: 'liability' },
  {
    code: '220',
    name: 'Rozrachunki publicznoprawne z Urzędem Skarbowym',
    classGroup: 2,
    nature: 'liability',
  },
  { code: '221-1', name: 'VAT należny', classGroup: 2, nature: 'liability' },
  { code: '221-2', name: 'VAT naliczony i jego rozliczenie', classGroup: 2, nature: 'asset' },
  {
    code: '229',
    name: 'Pozostałe rozrachunki publicznoprawne (ZUS)',
    classGroup: 2,
    nature: 'liability',
  },
  { code: '230', name: 'Rozrachunki z tytułu wynagrodzeń', classGroup: 2, nature: 'liability' },
  {
    code: '240',
    name: 'Pozostałe rozrachunki (w tym z udziałowcami)',
    classGroup: 2,
    nature: 'liability',
  },

  // Zespół 3 — Materiały i towary
  { code: '300', name: 'Rozliczenie zakupu', classGroup: 3, nature: 'liability' },
  { code: '310', name: 'Materiały', classGroup: 3, nature: 'asset' },
  { code: '330', name: 'Towary', classGroup: 3, nature: 'asset' },

  // Zespół 4 — Koszty według rodzajów
  { code: '400', name: 'Amortyzacja', classGroup: 4, nature: 'expense' },
  { code: '401', name: 'Zużycie materiałów i energii', classGroup: 4, nature: 'expense' },
  { code: '402', name: 'Usługi obce', classGroup: 4, nature: 'expense' },
  { code: '403', name: 'Podatki i opłaty', classGroup: 4, nature: 'expense' },
  { code: '404', name: 'Wynagrodzenia', classGroup: 4, nature: 'expense' },
  {
    code: '405',
    name: 'Ubezpieczenia społeczne i inne świadczenia',
    classGroup: 4,
    nature: 'expense',
  },
  { code: '409', name: 'Pozostałe koszty rodzajowe', classGroup: 4, nature: 'expense' },

  // Zespół 7 — Przychody i koszty związane z ich osiągnięciem
  { code: '700', name: 'Przychody netto ze sprzedaży usług', classGroup: 7, nature: 'revenue' },
  { code: '730', name: 'Przychody netto ze sprzedaży towarów', classGroup: 7, nature: 'revenue' },
  {
    code: '731',
    name: 'Wartość sprzedanych towarów w cenach zakupu',
    classGroup: 7,
    nature: 'expense',
  },
  { code: '750', name: 'Przychody finansowe', classGroup: 7, nature: 'revenue' },
  { code: '751', name: 'Koszty finansowe', classGroup: 7, nature: 'expense' },
  { code: '760', name: 'Pozostałe przychody operacyjne', classGroup: 7, nature: 'revenue' },
  { code: '761', name: 'Pozostałe koszty operacyjne', classGroup: 7, nature: 'expense' },

  // Zespół 8 — Kapitały (fundusze) własne, wynik finansowy i CIT
  { code: '800', name: 'Kapitał zakładowy', classGroup: 8, nature: 'equity' },
  { code: '811', name: 'Kapitał zapasowy', classGroup: 8, nature: 'equity' },
  {
    code: '820',
    name: 'Rozliczenie wyniku finansowego z lat ubiegłych',
    classGroup: 8,
    nature: 'equity',
  },
  { code: '860', name: 'Wynik finansowy', classGroup: 8, nature: 'equity' },
  {
    code: '870',
    name: 'Podatek dochodowy od osób prawnych (CIT)',
    classGroup: 8,
    nature: 'tax_expense',
  },
];

export interface JournalEntryLine {
  readonly lineNumber: number;
  readonly accountCode: string;
  readonly side: LedgerSide;
  readonly amountGrosze: number;
  readonly description: string;
  readonly isRedStorno: boolean;
  readonly stornoReason?: string;
}

export interface JournalEntry {
  readonly id: string;
  readonly entryNumber: string;
  readonly period: string;
  readonly bookingDate: string;
  readonly documentDate: string;
  readonly documentNumber: string;
  readonly description: string;
  readonly lines: readonly JournalEntryLine[];
  readonly totalWnGrosze: number;
  readonly totalMaGrosze: number;
}

export class DoubleEntryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DoubleEntryValidationError';
  }
}

export interface CreateAndValidateJournalEntryInput {
  readonly id: string;
  readonly entryNumber: string;
  readonly bookingDate: string;
  readonly documentDate: string;
  readonly documentNumber: string;
  readonly description: string;
  readonly lines: readonly {
    readonly accountCode: string;
    readonly side: LedgerSide;
    readonly amountGrosze: number;
    readonly description: string;
    readonly isRedStorno?: boolean;
    readonly stornoReason?: string;
  }[];
  readonly closedPeriods?: readonly string[];
  readonly chartOfAccounts?: readonly LedgerAccountDefinition[];
}

/**
 * Tworzy i rygorystycznie waliduje dekret księgowy zgodnie z Ustawą o rachunkowości:
 * - zasada podwójnego zapisu: `SUM(Wn) === SUM(Ma)` co do 1 grosza
 * - zakaz księgowania w zamkniętym okresie sprawozdawczym (art. 25 ust. 2 UoR)
 * - zakaz kwot niedodatnich bez jawnej flagi storna czerwonego (`isRedStorno = true`) i uzasadnienia
 * - istnienie każdego konta w zatwierdzonym Zakładowym Planie Kont.
 */
export function createValidatedJournalEntry(
  input: CreateAndValidateJournalEntryInput,
): JournalEntry {
  assertValidIsoCalendarDate(input.bookingDate, 'bookingDate');
  assertValidIsoCalendarDate(input.documentDate, 'documentDate');
  const period = input.bookingDate.slice(0, 7);

  if (input.closedPeriods?.includes(period)) {
    throw new DoubleEntryValidationError(
      `Okres sprawozdawczy ${period} jest zamknięty — księgowanie do zamkniętego miesiąca jest zablokowane (art. 25 ust. 2 UoR). Wprowadź dowód korygujący w otwartym okresie.`,
    );
  }

  if (input.lines.length < 2) {
    throw new DoubleEntryValidationError(
      'Dekret podwójnego zapisu musi zawierać co najmniej 2 pozycje księgowe.',
    );
  }

  const chart = input.chartOfAccounts ?? STANDARD_SPZOO_CHART_OF_ACCOUNTS;
  const knownCodes = new Set(chart.map((acc) => acc.code));

  const validatedLines: JournalEntryLine[] = input.lines.map((line, index) => {
    const lineNumber = index + 1;
    assertSafeGrosze(line.amountGrosze, `lines[${String(index)}].amountGrosze`);

    if (!knownCodes.has(line.accountCode)) {
      throw new DoubleEntryValidationError(
        `Nieznane konto "${line.accountCode}" w pozycji #${String(lineNumber)} — brak w Zakładowym Planie Kont.`,
      );
    }

    const isRedStorno = line.isRedStorno === true;
    if (isRedStorno) {
      if (line.amountGrosze >= 0) {
        throw new DoubleEntryValidationError(
          `Pozycja storna czerwonego #${String(lineNumber)} musi mieć ujemną kwotę w groszach.`,
        );
      }
      if (!line.stornoReason || line.stornoReason.trim().length === 0) {
        throw new DoubleEntryValidationError(
          `Pozycja storna czerwonego #${String(lineNumber)} wymaga niepustego uzasadnienia (stornoReason).`,
        );
      }
    } else if (line.amountGrosze <= 0) {
      throw new DoubleEntryValidationError(
        `Kwota w pozycji dekretu #${String(lineNumber)} musi być dodatnia (dla storna czerwonego ustaw isRedStorno = true).`,
      );
    }

    return {
      lineNumber,
      accountCode: line.accountCode,
      side: line.side,
      amountGrosze: line.amountGrosze,
      description: line.description,
      isRedStorno,
      ...(line.stornoReason !== undefined ? { stornoReason: line.stornoReason } : {}),
    };
  });

  const totalWnGrosze = sumGrosze(
    validatedLines.filter((l) => l.side === 'Wn').map((l) => l.amountGrosze),
  );
  const totalMaGrosze = sumGrosze(
    validatedLines.filter((l) => l.side === 'Ma').map((l) => l.amountGrosze),
  );

  if (totalWnGrosze !== totalMaGrosze) {
    throw new DoubleEntryValidationError(
      `Naruszenie zasady podwójnego zapisu (art. 15 ust. 1 UoR): suma Wn (${formatPlnFromGrosze(totalWnGrosze)}) != suma Ma (${formatPlnFromGrosze(totalMaGrosze)}).`,
    );
  }

  return {
    id: input.id,
    entryNumber: input.entryNumber,
    period,
    bookingDate: input.bookingDate,
    documentDate: input.documentDate,
    documentNumber: input.documentNumber,
    description: input.description,
    lines: validatedLines,
    totalWnGrosze,
    totalMaGrosze,
  };
}

export interface TrialBalanceAccountRow {
  readonly accountCode: string;
  readonly accountName: string;
  readonly classGroup: AccountClassGroup;
  readonly nature: AccountNature;
  readonly openingBalanceWnGrosze: number;
  readonly openingBalanceMaGrosze: number;
  readonly periodTurnoverWnGrosze: number;
  readonly periodTurnoverMaGrosze: number;
  readonly turnoverWnGrosze: number;
  readonly turnoverMaGrosze: number;
  readonly endingBalanceWnGrosze: number;
  readonly endingBalanceMaGrosze: number;
}

export interface TrialBalanceReport {
  readonly period?: string;
  readonly rows: readonly TrialBalanceAccountRow[];
  readonly totalOpeningBalanceWnGrosze: number;
  readonly totalOpeningBalanceMaGrosze: number;
  readonly totalPeriodTurnoverWnGrosze: number;
  readonly totalPeriodTurnoverMaGrosze: number;
  readonly totalTurnoverWnGrosze: number;
  readonly totalTurnoverMaGrosze: number;
  readonly totalEndingBalanceWnGrosze: number;
  readonly totalEndingBalanceMaGrosze: number;
  readonly isBalanced: boolean;
}

export interface GenerateTrialBalanceOptions {
  /**
   * Opcjonalny okres sprawozdawczy `YYYY-MM`. Gdy podany:
   * - wpisy z okresów wcześniejszych (`entry.period < period`) budują saldo otwarcia okresu (`openingBalanceWnGrosze` / `openingBalanceMaGrosze`),
   * - wpisy z okresu bieżącego (`entry.period === period`) budują obroty okresu (`periodTurnoverWnGrosze` / `periodTurnoverMaGrosze`),
   * - wpisy do końca okresu (`entry.period <= period`) budują obroty narastająco (`turnoverWnGrosze` / `turnoverMaGrosze`) i salda końcowe.
   */
  readonly period?: string;
}

/**
 * Generuje Zestawienie Obrotów i Sald (art. 18 ust. 1 UoR) z obsługą sald otwarcia,
 * obrotów bieżącego okresu, obrotów narastająco oraz sald końcowych Wn/Ma.
 */
export function generateTrialBalance(
  entries: readonly JournalEntry[],
  chartOfAccounts: readonly LedgerAccountDefinition[] = STANDARD_SPZOO_CHART_OF_ACCOUNTS,
  options?: GenerateTrialBalanceOptions,
): TrialBalanceReport {
  if (options?.period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(options.period)) {
    throw new DoubleEntryValidationError(
      `Nieprawidłowy okres Zestawienia Obrotów i Sald: "${options.period}" (wymagany YYYY-MM).`,
    );
  }

  const accountMap = new Map<string, LedgerAccountDefinition>();
  for (const acc of chartOfAccounts) {
    accountMap.set(acc.code, acc);
  }

  const targetPeriod = options?.period;
  const openingTurnovers = new Map<string, { wn: number; ma: number }>();
  const periodTurnovers = new Map<string, { wn: number; ma: number }>();
  const cumulativeTurnovers = new Map<string, { wn: number; ma: number }>();

  const accumulateLine = (
    map: Map<string, { wn: number; ma: number }>,
    accountCode: string,
    side: LedgerSide,
    amountGrosze: number,
  ): void => {
    const prev = map.get(accountCode) ?? { wn: 0, ma: 0 };
    if (side === 'Wn') {
      map.set(accountCode, { wn: addGrosze(prev.wn, amountGrosze), ma: prev.ma });
    } else {
      map.set(accountCode, { wn: prev.wn, ma: addGrosze(prev.ma, amountGrosze) });
    }
  };

  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!accountMap.has(line.accountCode)) {
        throw new DoubleEntryValidationError(
          `Konto "${line.accountCode}" użyte w dekrecie "${entry.entryNumber}" nie istnieje w planie kont.`,
        );
      }
    }

    if (targetPeriod !== undefined && entry.period > targetPeriod) {
      continue;
    }

    for (const line of entry.lines) {
      accumulateLine(cumulativeTurnovers, line.accountCode, line.side, line.amountGrosze);
      if (targetPeriod === undefined) {
        accumulateLine(periodTurnovers, line.accountCode, line.side, line.amountGrosze);
      } else if (entry.period < targetPeriod) {
        accumulateLine(openingTurnovers, line.accountCode, line.side, line.amountGrosze);
      } else {
        accumulateLine(periodTurnovers, line.accountCode, line.side, line.amountGrosze);
      }
    }
  }

  const sortedCodes = [...cumulativeTurnovers.keys()].sort((a, b) => a.localeCompare(b));
  const rows: TrialBalanceAccountRow[] = sortedCodes.map((code) => {
    const def = accountMap.get(code)!;
    const op = openingTurnovers.get(code) ?? { wn: 0, ma: 0 };
    const per = periodTurnovers.get(code) ?? { wn: 0, ma: 0 };
    const cum = cumulativeTurnovers.get(code)!;
    const openingNet = subtractGrosze(op.wn, op.ma);
    const endingNet = subtractGrosze(cum.wn, cum.ma);
    return {
      accountCode: code,
      accountName: def.name,
      classGroup: def.classGroup,
      nature: def.nature,
      openingBalanceWnGrosze: openingNet > 0 ? openingNet : 0,
      openingBalanceMaGrosze: openingNet < 0 ? -openingNet : 0,
      periodTurnoverWnGrosze: per.wn,
      periodTurnoverMaGrosze: per.ma,
      turnoverWnGrosze: cum.wn,
      turnoverMaGrosze: cum.ma,
      endingBalanceWnGrosze: endingNet > 0 ? endingNet : 0,
      endingBalanceMaGrosze: endingNet < 0 ? -endingNet : 0,
    };
  });

  const totalOpeningBalanceWnGrosze = sumGrosze(rows.map((r) => r.openingBalanceWnGrosze));
  const totalOpeningBalanceMaGrosze = sumGrosze(rows.map((r) => r.openingBalanceMaGrosze));
  const totalPeriodTurnoverWnGrosze = sumGrosze(rows.map((r) => r.periodTurnoverWnGrosze));
  const totalPeriodTurnoverMaGrosze = sumGrosze(rows.map((r) => r.periodTurnoverMaGrosze));
  const totalTurnoverWnGrosze = sumGrosze(rows.map((r) => r.turnoverWnGrosze));
  const totalTurnoverMaGrosze = sumGrosze(rows.map((r) => r.turnoverMaGrosze));
  const totalEndingBalanceWnGrosze = sumGrosze(rows.map((r) => r.endingBalanceWnGrosze));
  const totalEndingBalanceMaGrosze = sumGrosze(rows.map((r) => r.endingBalanceMaGrosze));

  return {
    ...(targetPeriod !== undefined ? { period: targetPeriod } : {}),
    rows,
    totalOpeningBalanceWnGrosze,
    totalOpeningBalanceMaGrosze,
    totalPeriodTurnoverWnGrosze,
    totalPeriodTurnoverMaGrosze,
    totalTurnoverWnGrosze,
    totalTurnoverMaGrosze,
    totalEndingBalanceWnGrosze,
    totalEndingBalanceMaGrosze,
    isBalanced:
      totalOpeningBalanceWnGrosze === totalOpeningBalanceMaGrosze &&
      totalPeriodTurnoverWnGrosze === totalPeriodTurnoverMaGrosze &&
      totalTurnoverWnGrosze === totalTurnoverMaGrosze &&
      totalEndingBalanceWnGrosze === totalEndingBalanceMaGrosze,
  };
}

export interface ProfitAndLossReport {
  readonly totalRevenuesGrosze: number;
  readonly totalOperatingAndFinancialExpensesGrosze: number;
  readonly grossProfitOrLossGrosze: number;
  readonly citTaxBookedGrosze: number;
  readonly netProfitOrLossGrosze: number;
}

/**
 * Generuje uproszczony Rachunek Zysków i Strat (RZiS) na podstawie obrotów kont wynikowych (Zespoły 4, 7, 870).
 */
export function generateProfitAndLoss(
  entries: readonly JournalEntry[],
  chartOfAccounts: readonly LedgerAccountDefinition[] = STANDARD_SPZOO_CHART_OF_ACCOUNTS,
): ProfitAndLossReport {
  const tb = generateTrialBalance(entries, chartOfAccounts);

  let totalRevenuesGrosze = 0;
  let totalOperatingAndFinancialExpensesGrosze = 0;
  let citTaxBookedGrosze = 0;

  for (const row of tb.rows) {
    if (row.nature === 'revenue') {
      const creditNet = subtractGrosze(row.endingBalanceMaGrosze, row.endingBalanceWnGrosze);
      totalRevenuesGrosze = addGrosze(totalRevenuesGrosze, creditNet);
    } else if (row.nature === 'expense') {
      const debitNet = subtractGrosze(row.endingBalanceWnGrosze, row.endingBalanceMaGrosze);
      totalOperatingAndFinancialExpensesGrosze = addGrosze(
        totalOperatingAndFinancialExpensesGrosze,
        debitNet,
      );
    } else if (row.nature === 'tax_expense') {
      const taxDebitNet = subtractGrosze(row.endingBalanceWnGrosze, row.endingBalanceMaGrosze);
      citTaxBookedGrosze = addGrosze(citTaxBookedGrosze, taxDebitNet);
    }
  }

  const grossProfitOrLossGrosze = subtractGrosze(
    totalRevenuesGrosze,
    totalOperatingAndFinancialExpensesGrosze,
  );
  const netProfitOrLossGrosze = subtractGrosze(grossProfitOrLossGrosze, citTaxBookedGrosze);

  return {
    totalRevenuesGrosze,
    totalOperatingAndFinancialExpensesGrosze,
    grossProfitOrLossGrosze,
    citTaxBookedGrosze,
    netProfitOrLossGrosze,
  };
}

export interface SimplifiedBalanceSheet {
  readonly fixedAssetsNetGrosze: number;
  readonly currentAssetsGrosze: number;
  readonly totalAssetsGrosze: number;
  readonly shareAndReserveEquityGrosze: number;
  readonly currentPeriodNetResultGrosze: number;
  readonly totalEquityGrosze: number;
  readonly totalLiabilitiesGrosze: number;
  readonly totalEquityAndLiabilitiesGrosze: number;
  readonly isBalanced: boolean;
}

/**
 * Generuje uproszczony Bilans zgodnie z Ustawą o rachunkowości, weryfikując równowagę `Aktywa === Pasywa`.
 * Konta rozrachunkowe dwustronne prezentowane są wg rzeczywistego charakteru salda (saldo Wn -> należności w aktywach, saldo Ma -> zobowiązania w pasywach).
 */
export function generateBalanceSheet(
  entries: readonly JournalEntry[],
  chartOfAccounts: readonly LedgerAccountDefinition[] = STANDARD_SPZOO_CHART_OF_ACCOUNTS,
): SimplifiedBalanceSheet {
  const tb = generateTrialBalance(entries, chartOfAccounts);
  const pnl = generateProfitAndLoss(entries, chartOfAccounts);

  let fixedAssetsNetGrosze = 0;
  let currentAssetsGrosze = 0;
  let shareAndReserveEquityGrosze = 0;
  let totalLiabilitiesGrosze = 0;

  for (const row of tb.rows) {
    if (row.nature === 'revenue' || row.nature === 'expense' || row.nature === 'tax_expense') {
      continue;
    }

    if (row.nature === 'contra_asset') {
      const creditAccumulatedDep = subtractGrosze(
        row.endingBalanceMaGrosze,
        row.endingBalanceWnGrosze,
      );
      fixedAssetsNetGrosze = subtractGrosze(fixedAssetsNetGrosze, creditAccumulatedDep);
      continue;
    }

    if (row.nature === 'equity') {
      const equityNet = subtractGrosze(row.endingBalanceMaGrosze, row.endingBalanceWnGrosze);
      shareAndReserveEquityGrosze = addGrosze(shareAndReserveEquityGrosze, equityNet);
      continue;
    }

    if (row.classGroup === 0) {
      const fixedNet = subtractGrosze(row.endingBalanceWnGrosze, row.endingBalanceMaGrosze);
      fixedAssetsNetGrosze = addGrosze(fixedAssetsNetGrosze, fixedNet);
      continue;
    }

    // Konta zespołów 1, 2, 3: prezentacja wg strony salda (należności i środki w aktywach, zobowiązania w pasywach)
    if (row.endingBalanceWnGrosze > 0) {
      currentAssetsGrosze = addGrosze(currentAssetsGrosze, row.endingBalanceWnGrosze);
    } else if (row.endingBalanceMaGrosze > 0) {
      totalLiabilitiesGrosze = addGrosze(totalLiabilitiesGrosze, row.endingBalanceMaGrosze);
    }
  }

  const totalAssetsGrosze = addGrosze(fixedAssetsNetGrosze, currentAssetsGrosze);
  const totalEquityGrosze = addGrosze(shareAndReserveEquityGrosze, pnl.netProfitOrLossGrosze);
  const totalEquityAndLiabilitiesGrosze = addGrosze(totalEquityGrosze, totalLiabilitiesGrosze);

  return {
    fixedAssetsNetGrosze,
    currentAssetsGrosze,
    totalAssetsGrosze,
    shareAndReserveEquityGrosze,
    currentPeriodNetResultGrosze: pnl.netProfitOrLossGrosze,
    totalEquityGrosze,
    totalLiabilitiesGrosze,
    totalEquityAndLiabilitiesGrosze,
    isBalanced: totalAssetsGrosze === totalEquityAndLiabilitiesGrosze,
  };
}

export type CitVehicleUsageKind =
  | 'exclusive_business_100'
  | 'mixed_use_75'
  | 'nkup_representation_or_excluded';

export interface QualifyCitVehicleExpenseInput {
  readonly eventDate: string;
  readonly usageKind: CitVehicleUsageKind;
  readonly netGrosze: number;
  readonly vatGrosze: number;
  readonly taxpayerVatActive: boolean;
  readonly deductibleVatGrosze?: number;
  readonly hasVat26AndMileageLog?: boolean;
  readonly customRegistry?: readonly LegalRule[];
}

export interface QualifiedCitVehicleExpenseResult {
  readonly usageKind: CitVehicleUsageKind;
  readonly deductibleVatGrosze: number;
  readonly nonDeductibleVatGrosze: number;
  readonly accountingExpenseBaseGrosze: number;
  readonly taxDeductibleKupGrosze: number;
  readonly nonDeductibleNkupGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Kwalifikuje wydatki eksploatacyjne samochodu osobowego w pełnych księgach rachunkowych (CIT — Sp. z o.o.)
 * zgodnie z art. 16 ust. 1 pkt 51 oraz art. 16 ust. 1 pkt 46 lit. a ustawy o CIT i art. 86a ustawy o VAT:
 * - w użytku mieszanym (`mixed_use_75`): 50% odliczenia VAT, a koszt bilansowy (`netto + nieodliczone 50% VAT`)
 *   dzieli się podatkowo na `75% KUP` oraz `25% trwałe NKUP`.
 */
export function qualifyCitVehicleExpense(
  input: QualifyCitVehicleExpenseInput,
): QualifiedCitVehicleExpenseResult {
  assertValidIsoCalendarDate(input.eventDate, 'eventDate');
  assertSafeGrosze(input.netGrosze, 'netGrosze');
  assertSafeGrosze(input.vatGrosze, 'vatGrosze');

  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const citCarRule = resolveRuleAtDate(
    'CIT_CAR_MIXED_EXPENSE_75_ART_16',
    input.eventDate,
    ruleOptions,
  );
  const vatVehicleRule = resolveRuleAtDate(
    'VAT_VEHICLE_DEDUCTION_ART_86A',
    input.eventDate,
    ruleOptions,
  );

  const appliedRules: LegalRule[] = [citCarRule, vatVehicleRule];
  const warnings: ExplanationWarning[] = [];

  let deductibleVatGrosze = 0;
  if (input.taxpayerVatActive) {
    if (input.deductibleVatGrosze !== undefined) {
      assertSafeGrosze(input.deductibleVatGrosze, 'deductibleVatGrosze');
      deductibleVatGrosze = input.deductibleVatGrosze;
    } else if (input.usageKind === 'mixed_use_75') {
      const mixedVatBps = getRequiredNumericParameter(vatVehicleRule, 'mixedDeductionBps');
      deductibleVatGrosze = multiplyGroszeByBps(input.vatGrosze, mixedVatBps, 'half_up');
    } else if (input.usageKind === 'exclusive_business_100') {
      deductibleVatGrosze = input.vatGrosze;
      if (input.hasVat26AndMileageLog === false) {
        warnings.push({
          code: 'CIT_VEHICLE_100_WITHOUT_VAT26_CONFIRMATION',
          severity: 'requires_expert_review',
          message:
            'Wskazano 100% odliczenia VAT i 100% KUP w CIT dla samochodu osobowego bez potwierdzenia VAT-26 i ewidencji przebiegu pojazdu (art. 16 ust. 5f CIT).',
        });
      }
    }
  }

  const nonDeductibleVatGrosze = subtractGrosze(input.vatGrosze, deductibleVatGrosze);
  const accountingExpenseBaseGrosze = addGrosze(input.netGrosze, nonDeductibleVatGrosze);

  let taxDeductibleKupGrosze: number;
  if (input.usageKind === 'mixed_use_75') {
    const kupBps = getRequiredNumericParameter(citCarRule, 'deductibleExpenseBps');
    taxDeductibleKupGrosze = multiplyGroszeByBps(accountingExpenseBaseGrosze, kupBps, 'half_up');
  } else if (input.usageKind === 'exclusive_business_100') {
    taxDeductibleKupGrosze = accountingExpenseBaseGrosze;
  } else {
    taxDeductibleKupGrosze = 0;
  }

  const nonDeductibleNkupGrosze = subtractGrosze(
    accountingExpenseBaseGrosze,
    taxDeductibleKupGrosze,
  );

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Ustalenie kosztu bilansowego (netto + nieodliczony podatek VAT wg art. 16 ust. 1 pkt 46 lit. a CIT)',
      formula: 'accountingExpenseBase = netGrosze + nonDeductibleVatGrosze',
      inputs: {
        netGrosze: input.netGrosze,
        vatGrosze: input.vatGrosze,
        deductibleVatGrosze,
        nonDeductibleVatGrosze,
      },
      resultFormatted: formatPlnFromGrosze(accountingExpenseBaseGrosze),
      resultGrosze: accountingExpenseBaseGrosze,
    },
    {
      stepNumber: 2,
      label: 'Podział kosztu bilansowego na koszt podatkowy KUP (75%) oraz wyłączenie NKUP (25% wg art. 16 ust. 1 pkt 51 CIT)',
      formula:
        input.usageKind === 'mixed_use_75'
          ? 'kup = round_half_up(accountingExpenseBase * 75%); nkup = accountingExpenseBase - kup'
          : input.usageKind === 'exclusive_business_100'
            ? 'kup = 100% * accountingExpenseBase; nkup = 0'
            : 'kup = 0; nkup = 100% * accountingExpenseBase',
      inputs: {
        usageKind: input.usageKind,
        accountingExpenseBaseGrosze,
      },
      resultFormatted: `KUP: ${formatPlnFromGrosze(taxDeductibleKupGrosze)} | NKUP: ${formatPlnFromGrosze(nonDeductibleNkupGrosze)}`,
      resultGrosze: taxDeductibleKupGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'cit_vehicle_expense_qualification',
    summary: `Kwalifikacja kosztu samochodu w CIT (${input.usageKind}): koszt bilansowy ${formatPlnFromGrosze(accountingExpenseBaseGrosze)}, KUP ${formatPlnFromGrosze(taxDeductibleKupGrosze)}, NKUP ${formatPlnFromGrosze(nonDeductibleNkupGrosze)}.`,
    eventDate: input.eventDate,
    rules: appliedRules,
    steps,
    inputs: {
      usageKind: input.usageKind,
      netGrosze: input.netGrosze,
      vatGrosze: input.vatGrosze,
      taxpayerVatActive: input.taxpayerVatActive,
    },
    outputs: {
      deductibleVatGrosze,
      nonDeductibleVatGrosze,
      accountingExpenseBaseGrosze,
      taxDeductibleKupGrosze,
      nonDeductibleNkupGrosze,
    },
    warnings,
  });

  return {
    usageKind: input.usageKind,
    deductibleVatGrosze,
    nonDeductibleVatGrosze,
    accountingExpenseBaseGrosze,
    taxDeductibleKupGrosze,
    nonDeductibleNkupGrosze,
    explanation,
  };
}

export interface CalculateCitAdvanceInput {
  readonly period: string;
  readonly ytdTaxableRevenuesGrosze: number;
  readonly ytdTaxDeductibleCostsGrosze: number;
  readonly smallTaxpayerStatus: boolean;
  /** Przychód ze sprzedaży brutto (wraz z należnym VAT) za poprzedni rok podatkowy — do weryfikacji statusu małego podatnika (art. 4a pkt 10 CIT). */
  readonly priorYearGrossSalesGrosze?: number;
  /**
   * Przychody osiągnięte w bieżącym roku podatkowym netto (bez VAT) — do weryfikacji bieżącego limitu 2 000 000 EUR
   * wg kursu NBP z pierwszego dnia roboczego stycznia w zaokrągleniu do 1 000 zł (art. 19 ust. 1 pkt 2 i art. 25 ust. 1g CIT).
   * Domyślnie równe `max(0, ytdTaxableRevenuesGrosze)`.
   */
  readonly currentYearNetRevenueGrosze?: number;
  /** Czy podatnik rozpoczął działalność w bieżącym (pierwszym) roku podatkowym (art. 19 ust. 1 pkt 2 CIT). */
  readonly isFirstTaxYearNewEntity?: boolean;
  /** Wyłączenie prawa do 9% CIT dla podmiotów powstałych w wyniku przekształcenia, podziału lub aportu (art. 19 ust. 1a–1c CIT). */
  readonly excludedRestructuringArt19Ust1a?: boolean;
  readonly previousAdvancesPaidYtdGrosze?: number;
  readonly priorYearsLossDeductionGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface CitAdvanceCalculationResult {
  readonly period: string;
  readonly appliedRatePct: 9 | 19;
  readonly appliedRateBps: number;
  readonly priorYearSmallTaxpayerLimitGrossGrosze: number;
  readonly currentYearSmallTaxpayerLimitNetGrosze: number;
  readonly ytdTaxIncomeGrosze: number;
  readonly roundedTaxBaseGrosze: number;
  readonly cumulativeCitGrosze: number;
  readonly advanceDueRoundedPln: number;
  readonly advanceDueGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Oblicza zaliczkę na podatek dochodowy od osób prawnych CIT (9% mały podatnik / podmiot rozpoczynający działalność vs 19% stawka podstawowa,
 * z podwójną kontrolą limitu 2 mln EUR: za rok poprzedni brutto wg kursu z października oraz za rok bieżący netto wg kursu ze stycznia — art. 19 ust. 1 pkt 2 i art. 25 ust. 1g CIT).
 */
export function calculateCitAdvance(input: CalculateCitAdvanceInput): CitAdvanceCalculationResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres zaliczki CIT: "${input.period}"`);
  }
  assertSafeGrosze(input.ytdTaxableRevenuesGrosze, 'ytdTaxableRevenuesGrosze');
  assertSafeGrosze(input.ytdTaxDeductibleCostsGrosze, 'ytdTaxDeductibleCostsGrosze');

  const prevAdvances = assertNonNegativeGrosze(
    input.previousAdvancesPaidYtdGrosze ?? 0,
    'previousAdvancesPaidYtdGrosze',
  );
  const lossDeduction = assertNonNegativeGrosze(
    input.priorYearsLossDeductionGrosze ?? 0,
    'priorYearsLossDeductionGrosze',
  );
  const currentYearNetRev =
    input.currentYearNetRevenueGrosze !== undefined
      ? assertNonNegativeGrosze(input.currentYearNetRevenueGrosze, 'currentYearNetRevenueGrosze')
      : Math.max(0, input.ytdTaxableRevenuesGrosze);

  const eventDate = `${input.period}-01`;
  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const citRule = resolveRuleAtDate('CIT_RATES_ART_19', eventDate, ruleOptions);
  const smallTaxpayerRule = resolveRuleAtDate(
    'SMALL_TAXPAYER_LIMIT_2M_EUR',
    eventDate,
    ruleOptions,
  );
  const roundingRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', eventDate, ruleOptions);
  const uorRule = resolveRuleAtDate('UOR_DOUBLE_ENTRY_AND_BALANCE', eventDate, ruleOptions);

  const smallLimitGross = getRequiredNumericParameter(smallTaxpayerRule, 'limitGrossGrosze');
  const currentYearLimitNet = getRequiredNumericParameter(citRule, 'currentYearNetLimitGrosze');
  const warnings: ExplanationWarning[] = [];

  let eligibleFor9Pct = input.smallTaxpayerStatus || input.isFirstTaxYearNewEntity === true;

  if (eligibleFor9Pct && input.excludedRestructuringArt19Ust1a === true) {
    eligibleFor9Pct = false;
    warnings.push({
      code: 'CIT_RESTRUCTURING_EXCLUSION_ART_19_1A',
      severity: 'warning',
      message:
        'Podatnik utworzony w wyniku przekształcenia, połączenia, podziału lub aportu jest wyłączony z prawa do stawki 9% CIT (art. 19 ust. 1a–1c ustawy o CIT) — zastosowano stawkę 19%.',
    });
  }

  if (
    eligibleFor9Pct &&
    input.isFirstTaxYearNewEntity !== true &&
    input.priorYearGrossSalesGrosze !== undefined &&
    input.priorYearGrossSalesGrosze > smallLimitGross
  ) {
    eligibleFor9Pct = false;
    warnings.push({
      code: 'CIT_SMALL_TAXPAYER_LIMIT_EXCEEDED',
      severity: 'warning',
      message: `Przychód brutto za rok poprzedni (${formatPlnFromGrosze(input.priorYearGrossSalesGrosze)}) przekroczył limit małego podatnika 2 mln EUR (${formatPlnFromGrosze(smallLimitGross)}) — zastosowano stawkę podstawową 19% CIT.`,
    });
  }

  if (eligibleFor9Pct && currentYearNetRev > currentYearLimitNet) {
    eligibleFor9Pct = false;
    warnings.push({
      code: 'CIT_CURRENT_YEAR_2M_EUR_NET_LIMIT_EXCEEDED',
      severity: 'warning',
      message: `Przychody bieżącego roku podatkowego netto (${formatPlnFromGrosze(currentYearNetRev)}) przekroczyły limit 2 mln EUR przeliczony wg kursu NBP z pierwszego dnia roboczego stycznia (${formatPlnFromGrosze(currentYearLimitNet)}) — utrata prawa do stawki 9% i przejście na 19% CIT (art. 19 ust. 1 pkt 2 oraz art. 25 ust. 1g ustawy o CIT).`,
    });
  }

  const appliedRatePct: 9 | 19 = eligibleFor9Pct ? 9 : 19;
  const appliedRateBps = eligibleFor9Pct
    ? getRequiredNumericParameter(citRule, 'smallTaxpayerRateBps')
    : getRequiredNumericParameter(citRule, 'standardRateBps');

  const ytdTaxIncomeGrosze = Math.max(
    0,
    subtractGrosze(input.ytdTaxableRevenuesGrosze, input.ytdTaxDeductibleCostsGrosze),
  );
  const baseBeforeRounding = Math.max(0, subtractGrosze(ytdTaxIncomeGrosze, lossDeduction));
  const roundedBase = roundTaxAmountOrdynacjaArt63(baseBeforeRounding);

  const cumulativeCitGrosze = multiplyGroszeByBps(
    roundedBase.roundedGrosze,
    appliedRateBps,
    'half_up',
  );
  const advanceBeforeRounding = Math.max(0, subtractGrosze(cumulativeCitGrosze, prevAdvances));
  const roundedAdvance = roundTaxAmountOrdynacjaArt63(advanceBeforeRounding);

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Ustalenie dochodu podatkowego CIT narastająco i odliczenie straty z lat ubiegłych',
      formula: 'taxBase = round_ordynacja(max(0, ytdRevenues - ytdCosts - lossDeduction))',
      inputs: {
        ytdTaxableRevenuesGrosze: input.ytdTaxableRevenuesGrosze,
        ytdTaxDeductibleCostsGrosze: input.ytdTaxDeductibleCostsGrosze,
        priorYearsLossDeductionGrosze: lossDeduction,
      },
      resultFormatted: formatPlnFromGrosze(roundedBase.roundedGrosze),
      resultGrosze: roundedBase.roundedGrosze,
    },
    {
      stepNumber: 2,
      label: `Zastosowanie stawki CIT (${String(appliedRatePct)}%) i pomniejszenie o dotychczasowe zaliczki`,
      formula: 'advanceDue = round_ordynacja(max(0, taxBase * rate - previousAdvances))',
      inputs: {
        appliedRatePct,
        currentYearNetRevenueGrosze: currentYearNetRev,
        currentYearSmallTaxpayerLimitNetGrosze: currentYearLimitNet,
        previousAdvancesPaidYtdGrosze: prevAdvances,
      },
      resultFormatted: formatPlnFromGrosze(roundedAdvance.roundedGrosze),
      resultGrosze: roundedAdvance.roundedGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'cit_advance',
    summary: `Zaliczka CIT (${String(appliedRatePct)}%) za ${input.period}: podstawa ${formatPlnFromGrosze(roundedBase.roundedGrosze)}, do wpłaty ${formatPlnFromGrosze(roundedAdvance.roundedGrosze)}.`,
    eventDate,
    rules: [citRule, smallTaxpayerRule, roundingRule, uorRule],
    steps,
    inputs: {
      period: input.period,
      ytdTaxableRevenuesGrosze: input.ytdTaxableRevenuesGrosze,
      ytdTaxDeductibleCostsGrosze: input.ytdTaxDeductibleCostsGrosze,
      currentYearNetRevenueGrosze: currentYearNetRev,
      smallTaxpayerStatus: input.smallTaxpayerStatus,
    },
    outputs: {
      appliedRatePct,
      priorYearSmallTaxpayerLimitGrossGrosze: smallLimitGross,
      currentYearSmallTaxpayerLimitNetGrosze: currentYearLimitNet,
      roundedTaxBaseGrosze: roundedBase.roundedGrosze,
      advanceDueGrosze: roundedAdvance.roundedGrosze,
    },
    warnings,
  });

  return {
    period: input.period,
    appliedRatePct,
    appliedRateBps,
    priorYearSmallTaxpayerLimitGrossGrosze: smallLimitGross,
    currentYearSmallTaxpayerLimitNetGrosze: currentYearLimitNet,
    ytdTaxIncomeGrosze,
    roundedTaxBaseGrosze: roundedBase.roundedGrosze,
    cumulativeCitGrosze,
    advanceDueRoundedPln: roundedAdvance.roundedFullPln,
    advanceDueGrosze: roundedAdvance.roundedGrosze,
    explanation,
  };
}
