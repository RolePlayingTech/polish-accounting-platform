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
  | 'asset'
  | 'contra_asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'tax_expense';

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
  { code: '070', name: 'Umorzenie środków trwałych oraz WNiP', classGroup: 0, nature: 'contra_asset' },
  { code: '080', name: 'Środki trwałe w budowie', classGroup: 0, nature: 'asset' },

  // Zespół 1 — Środki pieniężne i rachunki bankowe
  { code: '100', name: 'Kasa', classGroup: 1, nature: 'asset' },
  { code: '130', name: 'Bieżący rachunek bankowy', classGroup: 1, nature: 'asset' },
  { code: '131', name: 'Rachunek VAT (Split Payment)', classGroup: 1, nature: 'asset' },
  { code: '135', name: 'Kredyty bankowe', classGroup: 1, nature: 'liability' },

  // Zespół 2 — Rozrachunki i roszczenia
  { code: '201', name: 'Rozrachunki z odbiorcami krajowymi', classGroup: 2, nature: 'asset' },
  { code: '202', name: 'Rozrachunki z dostawcami krajowymi', classGroup: 2, nature: 'liability' },
  { code: '220', name: 'Rozrachunki publicznoprawne z Urzędem Skarbowym', classGroup: 2, nature: 'liability' },
  { code: '221-1', name: 'VAT należny', classGroup: 2, nature: 'liability' },
  { code: '221-2', name: 'VAT naliczony i jego rozliczenie', classGroup: 2, nature: 'asset' },
  { code: '229', name: 'Pozostałe rozrachunki publicznoprawne (ZUS)', classGroup: 2, nature: 'liability' },
  { code: '230', name: 'Rozrachunki z tytułu wynagrodzeń', classGroup: 2, nature: 'liability' },
  { code: '240', name: 'Pozostałe rozrachunki (w tym z udziałowcami)', classGroup: 2, nature: 'liability' },

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
  { code: '405', name: 'Ubezpieczenia społeczne i inne świadczenia', classGroup: 4, nature: 'expense' },
  { code: '409', name: 'Pozostałe koszty rodzajowe', classGroup: 4, nature: 'expense' },

  // Zespół 7 — Przychody i koszty związane z ich osiągnięciem
  { code: '700', name: 'Przychody netto ze sprzedaży usług', classGroup: 7, nature: 'revenue' },
  { code: '730', name: 'Przychody netto ze sprzedaży towarów', classGroup: 7, nature: 'revenue' },
  { code: '731', name: 'Wartość sprzedanych towarów w cenach zakupu', classGroup: 7, nature: 'expense' },
  { code: '750', name: 'Przychody finansowe', classGroup: 7, nature: 'revenue' },
  { code: '751', name: 'Koszty finansowe', classGroup: 7, nature: 'expense' },
  { code: '760', name: 'Pozostałe przychody operacyjne', classGroup: 7, nature: 'revenue' },
  { code: '761', name: 'Pozostałe koszty operacyjne', classGroup: 7, nature: 'expense' },

  // Zespół 8 — Kapitały (fundusze) własne, wynik finansowy i CIT
  { code: '800', name: 'Kapitał zakładowy', classGroup: 8, nature: 'equity' },
  { code: '811', name: 'Kapitał zapasowy', classGroup: 8, nature: 'equity' },
  { code: '820', name: 'Rozliczenie wyniku finansowego z lat ubiegłych', classGroup: 8, nature: 'equity' },
  { code: '860', name: 'Wynik finansowy', classGroup: 8, nature: 'equity' },
  { code: '870', name: 'Podatek dochodowy od osób prawnych (CIT)', classGroup: 8, nature: 'tax_expense' },
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
  readonly turnoverWnGrosze: number;
  readonly turnoverMaGrosze: number;
  readonly endingBalanceWnGrosze: number;
  readonly endingBalanceMaGrosze: number;
}

export interface TrialBalanceReport {
  readonly rows: readonly TrialBalanceAccountRow[];
  readonly totalTurnoverWnGrosze: number;
  readonly totalTurnoverMaGrosze: number;
  readonly totalEndingBalanceWnGrosze: number;
  readonly totalEndingBalanceMaGrosze: number;
  readonly isBalanced: boolean;
}

/**
 * Generuje Zestawienie Obrotów i Sald (art. 18 ust. 1 UoR).
 */
export function generateTrialBalance(
  entries: readonly JournalEntry[],
  chartOfAccounts: readonly LedgerAccountDefinition[] = STANDARD_SPZOO_CHART_OF_ACCOUNTS,
): TrialBalanceReport {
  const accountMap = new Map<string, LedgerAccountDefinition>();
  for (const acc of chartOfAccounts) {
    accountMap.set(acc.code, acc);
  }

  const turnovers = new Map<string, { wn: number; ma: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (!accountMap.has(line.accountCode)) {
        throw new DoubleEntryValidationError(
          `Konto "${line.accountCode}" użyte w dekrecie "${entry.entryNumber}" nie istnieje w planie kont.`,
        );
      }
      const prev = turnovers.get(line.accountCode) ?? { wn: 0, ma: 0 };
      if (line.side === 'Wn') {
        turnovers.set(line.accountCode, { wn: addGrosze(prev.wn, line.amountGrosze), ma: prev.ma });
      } else {
        turnovers.set(line.accountCode, { wn: prev.wn, ma: addGrosze(prev.ma, line.amountGrosze) });
      }
    }
  }

  const sortedCodes = [...turnovers.keys()].sort((a, b) => a.localeCompare(b));
  const rows: TrialBalanceAccountRow[] = sortedCodes.map((code) => {
    const def = accountMap.get(code)!;
    const t = turnovers.get(code)!;
    const net = subtractGrosze(t.wn, t.ma);
    return {
      accountCode: code,
      accountName: def.name,
      classGroup: def.classGroup,
      nature: def.nature,
      turnoverWnGrosze: t.wn,
      turnoverMaGrosze: t.ma,
      endingBalanceWnGrosze: net > 0 ? net : 0,
      endingBalanceMaGrosze: net < 0 ? -net : 0,
    };
  });

  const totalTurnoverWnGrosze = sumGrosze(rows.map((r) => r.turnoverWnGrosze));
  const totalTurnoverMaGrosze = sumGrosze(rows.map((r) => r.turnoverMaGrosze));
  const totalEndingBalanceWnGrosze = sumGrosze(rows.map((r) => r.endingBalanceWnGrosze));
  const totalEndingBalanceMaGrosze = sumGrosze(rows.map((r) => r.endingBalanceMaGrosze));

  return {
    rows,
    totalTurnoverWnGrosze,
    totalTurnoverMaGrosze,
    totalEndingBalanceWnGrosze,
    totalEndingBalanceMaGrosze,
    isBalanced:
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

export interface CalculateCitAdvanceInput {
  readonly period: string;
  readonly ytdTaxableRevenuesGrosze: number;
  readonly ytdTaxDeductibleCostsGrosze: number;
  readonly smallTaxpayerStatus: boolean;
  readonly priorYearGrossSalesGrosze?: number;
  readonly previousAdvancesPaidYtdGrosze?: number;
  readonly priorYearsLossDeductionGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface CitAdvanceCalculationResult {
  readonly period: string;
  readonly appliedRatePct: 9 | 19;
  readonly appliedRateBps: number;
  readonly ytdTaxIncomeGrosze: number;
  readonly roundedTaxBaseGrosze: number;
  readonly cumulativeCitGrosze: number;
  readonly advanceDueRoundedPln: number;
  readonly advanceDueGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Oblicza zaliczkę na podatek dochodowy od osób prawnych CIT (9% mały podatnik vs 19% stawka podstawowa,
 * z kontrolą limitu 2 mln EUR w 2025/2026 oraz zaokrągleniem art. 63 § 1 OP).
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
  const warnings: ExplanationWarning[] = [];

  let eligibleFor9Pct = input.smallTaxpayerStatus;
  if (
    eligibleFor9Pct &&
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
      smallTaxpayerStatus: input.smallTaxpayerStatus,
    },
    outputs: {
      appliedRatePct,
      roundedTaxBaseGrosze: roundedBase.roundedGrosze,
      advanceDueGrosze: roundedAdvance.roundedGrosze,
    },
    warnings,
  });

  return {
    period: input.period,
    appliedRatePct,
    appliedRateBps,
    ytdTaxIncomeGrosze,
    roundedTaxBaseGrosze: roundedBase.roundedGrosze,
    cumulativeCitGrosze,
    advanceDueRoundedPln: roundedAdvance.roundedFullPln,
    advanceDueGrosze: roundedAdvance.roundedGrosze,
    explanation,
  };
}
