import {
  assertValidIsoCalendarDate,
  buildLegalExplanation,
  getRequiredNumericParameter,
  resolveRuleAtDate,
} from '../legal-rules/index.js';
import type { ExplanationStep, LegalExplanation, LegalRule } from '../legal-rules/index.js';
import {
  addGrosze,
  assertNonNegativeGrosze,
  assertSafeGrosze,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
  multiplyGroszeByRatio,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
  validatePolishNip,
} from '../money.js';

export type RyczaltRateCode =
  | '17'
  | '15'
  | '14'
  | '12.5'
  | '12'
  | '10'
  | '8.5'
  | '5.5'
  | '3'
  | '2';

export const RYCZALT_RATE_ORDER: readonly RyczaltRateCode[] = [
  '17',
  '15',
  '14',
  '12.5',
  '12',
  '10',
  '8.5',
  '5.5',
  '3',
  '2',
];

export function ryczaltRateToBps(rate: RyczaltRateCode): number {
  switch (rate) {
    case '17':
      return 1700;
    case '15':
      return 1500;
    case '14':
      return 1400;
    case '12.5':
      return 1250;
    case '12':
      return 1200;
    case '10':
      return 1000;
    case '8.5':
      return 850;
    case '5.5':
      return 550;
    case '3':
      return 300;
    case '2':
      return 200;
  }
}

export interface RyczaltEntry {
  readonly id: string;
  readonly ordinalNumber: number;
  readonly period: string;
  readonly entryDate: string;
  readonly revenueDate: string;
  readonly documentNumber: string;
  readonly ksefReferenceNumber?: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly rate: RyczaltRateCode;
  readonly revenueGrosze: number;
  readonly revenueFormatted: string;
  readonly remarks?: string;
  readonly isCorrection: boolean;
  readonly correctedEntryId?: string;
  readonly correctionReason?: string;
}

export interface CreateRyczaltEntryInput {
  readonly id: string;
  readonly ordinalNumber: number;
  readonly entryDate: string;
  readonly revenueDate: string;
  readonly documentNumber: string;
  readonly ksefReferenceNumber?: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly rate: RyczaltRateCode;
  readonly revenueGrosze: number;
  readonly remarks?: string;
  readonly isCorrection?: boolean;
  readonly correctedEntryId?: string;
  readonly correctionReason?: string;
}

export function createRyczaltEntry(input: CreateRyczaltEntryInput): RyczaltEntry {
  assertValidIsoCalendarDate(input.entryDate, 'entryDate');
  assertValidIsoCalendarDate(input.revenueDate, 'revenueDate');
  assertSafeGrosze(input.revenueGrosze, 'revenueGrosze');
  if (!Number.isInteger(input.ordinalNumber) || input.ordinalNumber <= 0) {
    throw new Error('Liczba porządkowa wpisu ewidencji przychodów musi być dodatnia.');
  }

  const isCorrection = input.isCorrection === true;
  if (!isCorrection && input.revenueGrosze < 0) {
    throw new Error(
      'Ujemna kwota przychodu w ewidencji ryczałtu wymaga oznaczenia wpisu korygującego (isCorrection = true).',
    );
  }
  if (
    isCorrection &&
    (!input.correctedEntryId || !input.correctionReason || input.correctionReason.trim().length === 0)
  ) {
    throw new Error(
      'Korekta ewidencji ryczałtu wymaga podania correctedEntryId oraz uzasadnienia correctionReason.',
    );
  }

  let normalizedNip: string | undefined;
  if (input.counterpartyNip !== undefined) {
    const check = validatePolishNip(input.counterpartyNip);
    if (!check.valid || check.normalizedNip === undefined) {
      throw new Error(`Nieprawidłowy NIP kontrahenta w ewidencji ryczałtu: ${input.counterpartyNip}`);
    }
    normalizedNip = check.normalizedNip;
  }

  return {
    id: input.id,
    ordinalNumber: input.ordinalNumber,
    period: input.revenueDate.slice(0, 7),
    entryDate: input.entryDate,
    revenueDate: input.revenueDate,
    documentNumber: input.documentNumber,
    ...(input.ksefReferenceNumber !== undefined
      ? { ksefReferenceNumber: input.ksefReferenceNumber }
      : {}),
    counterpartyName: input.counterpartyName,
    ...(normalizedNip !== undefined ? { counterpartyNip: normalizedNip } : {}),
    rate: input.rate,
    revenueGrosze: input.revenueGrosze,
    revenueFormatted: formatPlnFromGrosze(input.revenueGrosze),
    ...(input.remarks !== undefined ? { remarks: input.remarks } : {}),
    isCorrection,
    ...(input.correctedEntryId !== undefined ? { correctedEntryId: input.correctedEntryId } : {}),
    ...(input.correctionReason !== undefined ? { correctionReason: input.correctionReason } : {}),
  };
}

export interface RyczaltRateBreakdown {
  readonly rate: RyczaltRateCode;
  readonly rateBps: number;
  readonly revenueGrosze: number;
  readonly shareRatioDescription: string;
  readonly allocatedSocialDeductionGrosze: number;
  readonly allocatedHealthDeductionGrosze: number;
  readonly revenueAfterDeductionsGrosze: number;
  readonly roundedBaseGrosze: number;
  readonly unroundedTaxGrosze: number;
}

export interface CalculateMonthlyRyczaltInput {
  readonly period: string;
  readonly entries: readonly RyczaltEntry[];
  readonly paidSocialZusInMonthGrosze?: number;
  readonly paidHealthInsuranceInMonthGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface MonthlyRyczaltCalculationResult {
  readonly period: string;
  readonly totalRevenueGrosze: number;
  readonly deductibleSocialZusGrosze: number;
  readonly deductibleHealth50PctGrosze: number;
  readonly totalEffectiveDeductionGrosze: number;
  readonly breakdownByRate: readonly RyczaltRateBreakdown[];
  readonly totalUnroundedTaxGrosze: number;
  readonly taxDueRoundedPln: number;
  readonly taxDueGrosze: number;
  readonly explanation: LegalExplanation;
}

function allocateDeductionProportionally(
  totalDeductionToAllocate: number,
  revenuesByRate: readonly { readonly rate: RyczaltRateCode; readonly revenueGrosze: number }[],
  totalPositiveRevenue: number,
): Map<RyczaltRateCode, number> {
  const result = new Map<RyczaltRateCode, number>();
  if (totalDeductionToAllocate <= 0 || totalPositiveRevenue <= 0 || revenuesByRate.length === 0) {
    for (const bucket of revenuesByRate) {
      result.set(bucket.rate, 0);
    }
    return result;
  }

  let allocatedSoFar = 0;
  for (let i = 0; i < revenuesByRate.length; i += 1) {
    const bucket = revenuesByRate[i];
    if (bucket === undefined) {
      continue;
    }
    if (i === revenuesByRate.length - 1) {
      const remainder = Math.max(0, subtractGrosze(totalDeductionToAllocate, allocatedSoFar));
      result.set(bucket.rate, Math.min(bucket.revenueGrosze, remainder));
    } else {
      const share = multiplyGroszeByRatio(
        totalDeductionToAllocate,
        bucket.revenueGrosze,
        totalPositiveRevenue,
        'half_up',
      );
      const capped = Math.min(bucket.revenueGrosze, share);
      result.set(bucket.rate, capped);
      allocatedSoFar = addGrosze(allocatedSoFar, capped);
    }
  }
  return result;
}

/**
 * Oblicza miesięczny ryczałt od przychodów ewidencjonowanych:
 * - grupuje przychody wg stawek ryczałtu (art. 12 ust. 1)
 * - rozlicza zapłacone składki społeczne ZUS oraz 50% zapłaconej składki zdrowotnej proporcjonalnie
 *   do udziału poszczególnych stawek w ogólnej kwocie przychodów (art. 11 ust. 1, ust. 1a i ust. 2)
 * - zaokrągla podstawy opodatkowania każdej stawki oraz należny ryczałt do pełnych złotych (art. 63 § 1 OP).
 */
export function calculateMonthlyRyczalt(
  input: CalculateMonthlyRyczaltInput,
): MonthlyRyczaltCalculationResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres rozliczenia ryczałtu: "${input.period}"`);
  }
  const socialPaid = assertNonNegativeGrosze(
    input.paidSocialZusInMonthGrosze ?? 0,
    'paidSocialZusInMonthGrosze',
  );
  const healthPaid = assertNonNegativeGrosze(
    input.paidHealthInsuranceInMonthGrosze ?? 0,
    'paidHealthInsuranceInMonthGrosze',
  );

  const eventDate = `${input.period}-01`;
  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const ratesRule = resolveRuleAtDate('RYCZALT_RATES_ART_12', eventDate, ruleOptions);
  const deductionRule = resolveRuleAtDate(
    'RYCZALT_HEALTH_DEDUCTION_50_ART_11',
    eventDate,
    ruleOptions,
  );
  const deadlineRule = resolveRuleAtDate('RYCZALT_DEADLINE_ART_21', eventDate, ruleOptions);
  const roundingRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', eventDate, ruleOptions);

  const healthDeductionBps = getRequiredNumericParameter(deductionRule, 'healthDeductionBps');
  const maxHealth50PctGrosze = multiplyGroszeByBps(healthPaid, healthDeductionBps, 'half_up');

  const periodEntries = input.entries.filter((e) => e.period === input.period);
  const grouped = new Map<RyczaltRateCode, number>();

  for (const entry of periodEntries) {
    const current = grouped.get(entry.rate) ?? 0;
    grouped.set(entry.rate, addGrosze(current, entry.revenueGrosze));
  }

  const positiveBuckets: { readonly rate: RyczaltRateCode; readonly revenueGrosze: number }[] = [];
  for (const rate of RYCZALT_RATE_ORDER) {
    const rev = grouped.get(rate);
    if (rev !== undefined && rev > 0) {
      positiveBuckets.push({ rate, revenueGrosze: rev });
    }
  }

  const totalRevenueGrosze = sumGrosze(positiveBuckets.map((b) => b.revenueGrosze));
  const effectiveSocialDeduction = Math.min(totalRevenueGrosze, socialPaid);
  const revenueRemainingAfterSocial = subtractGrosze(totalRevenueGrosze, effectiveSocialDeduction);
  const effectiveHealthDeduction = Math.min(revenueRemainingAfterSocial, maxHealth50PctGrosze);
  const totalEffectiveDeductionGrosze = addGrosze(
    effectiveSocialDeduction,
    effectiveHealthDeduction,
  );

  const socialAlloc = allocateDeductionProportionally(
    effectiveSocialDeduction,
    positiveBuckets,
    totalRevenueGrosze,
  );
  const healthAlloc = allocateDeductionProportionally(
    effectiveHealthDeduction,
    positiveBuckets,
    totalRevenueGrosze,
  );

  const breakdownByRate: RyczaltRateBreakdown[] = positiveBuckets.map((bucket) => {
    const rateBps = ryczaltRateToBps(bucket.rate);
    const allocSocial = socialAlloc.get(bucket.rate) ?? 0;
    const allocHealth = healthAlloc.get(bucket.rate) ?? 0;
    const afterDeductions = Math.max(
      0,
      subtractGrosze(bucket.revenueGrosze, addGrosze(allocSocial, allocHealth)),
    );
    const roundedBaseGrosze = roundTaxAmountOrdynacjaArt63(afterDeductions).roundedGrosze;
    const unroundedTaxGrosze = multiplyGroszeByBps(roundedBaseGrosze, rateBps, 'half_up');

    return {
      rate: bucket.rate,
      rateBps,
      revenueGrosze: bucket.revenueGrosze,
      shareRatioDescription: `${formatPlnFromGrosze(bucket.revenueGrosze)} / ${formatPlnFromGrosze(totalRevenueGrosze)}`,
      allocatedSocialDeductionGrosze: allocSocial,
      allocatedHealthDeductionGrosze: allocHealth,
      revenueAfterDeductionsGrosze: afterDeductions,
      roundedBaseGrosze,
      unroundedTaxGrosze,
    };
  });

  const totalUnroundedTaxGrosze = sumGrosze(breakdownByRate.map((b) => b.unroundedTaxGrosze));
  const roundedTax = roundTaxAmountOrdynacjaArt63(totalUnroundedTaxGrosze);

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Zsumowanie przychodów ewidencjonowanych w okresie i wyliczenie 50% zapłaconej składki zdrowotnej',
      formula: 'health50Pct = round_half_up(paidHealth * 50%)',
      inputs: {
        totalRevenueGrosze,
        paidSocialZusInMonthGrosze: socialPaid,
        paidHealthInsuranceInMonthGrosze: healthPaid,
      },
      resultFormatted: `Przychód: ${formatPlnFromGrosze(totalRevenueGrosze)}, 50% zdrowotnej: ${formatPlnFromGrosze(maxHealth50PctGrosze)}`,
      resultGrosze: maxHealth50PctGrosze,
    },
    {
      stepNumber: 2,
      label: 'Proporcjonalne odliczenie składek ZUS i 50% zdrowotnej wg udziału poszczególnych stawek przychodu (art. 11 ust. 2)',
      formula: 'deduction_i = totalDeduction * (revenue_i / totalRevenue)',
      inputs: {
        ratesCount: breakdownByRate.length,
        totalEffectiveDeductionGrosze,
      },
      resultFormatted: formatPlnFromGrosze(totalEffectiveDeductionGrosze),
      resultGrosze: totalEffectiveDeductionGrosze,
    },
    {
      stepNumber: 3,
      label: 'Zaokrąglenie podstaw opodatkowania dla stawek oraz obliczenie i zaokrąglenie należnego ryczałtu (art. 63 § 1 OP)',
      formula: 'ryczaltDue = round_ordynacja(sum_i(round_ordynacja(base_i) * rate_i))',
      inputs: {
        totalUnroundedTaxGrosze,
      },
      resultFormatted: formatPlnFromGrosze(roundedTax.roundedGrosze),
      resultGrosze: roundedTax.roundedGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'monthly_ryczalt_tax',
    summary: `Ryczałt za ${input.period}: przychód ${formatPlnFromGrosze(totalRevenueGrosze)}, odliczenia ${formatPlnFromGrosze(totalEffectiveDeductionGrosze)}, ryczałt należny ${formatPlnFromGrosze(roundedTax.roundedGrosze)}.`,
    eventDate,
    rules: [ratesRule, deductionRule, deadlineRule, roundingRule],
    steps,
    inputs: {
      period: input.period,
      totalRevenueGrosze,
      paidSocialZusInMonthGrosze: socialPaid,
      paidHealthInsuranceInMonthGrosze: healthPaid,
    },
    outputs: {
      deductibleSocialZusGrosze: effectiveSocialDeduction,
      deductibleHealth50PctGrosze: effectiveHealthDeduction,
      taxDueGrosze: roundedTax.roundedGrosze,
    },
  });

  return {
    period: input.period,
    totalRevenueGrosze,
    deductibleSocialZusGrosze: effectiveSocialDeduction,
    deductibleHealth50PctGrosze: effectiveHealthDeduction,
    totalEffectiveDeductionGrosze,
    breakdownByRate,
    totalUnroundedTaxGrosze,
    taxDueRoundedPln: roundedTax.roundedFullPln,
    taxDueGrosze: roundedTax.roundedGrosze,
    explanation,
  };
}
