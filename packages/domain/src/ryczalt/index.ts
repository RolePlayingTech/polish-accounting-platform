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
  validatePolishNip,
} from '../money.js';

export type RyczaltRateCode = '17' | '15' | '14' | '12.5' | '12' | '10' | '8.5' | '5.5' | '3' | '2';

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
    (!input.correctedEntryId ||
      !input.correctionReason ||
      input.correctionReason.trim().length === 0)
  ) {
    throw new Error(
      'Korekta ewidencji ryczałtu wymaga podania correctedEntryId oraz uzasadnienia correctionReason.',
    );
  }

  let normalizedNip: string | undefined;
  if (input.counterpartyNip !== undefined) {
    const check = validatePolishNip(input.counterpartyNip);
    if (!check.valid || check.normalizedNip === undefined) {
      throw new Error(
        `Nieprawidłowy NIP kontrahenta w ewidencji ryczałtu: ${input.counterpartyNip}`,
      );
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
  /** Dodatni przychód podlegający opodatkowaniu w bieżącym okresie dla tej stawki (`max(0, rawNetRevenueGrosze)`). */
  readonly revenueGrosze: number;
  /** Algebraiczna suma zapisów w danej stawce za okres (może być ujemna przy przewadze korekt `in minus`). */
  readonly rawNetRevenueGrosze: number;
  /** Dodatni przychód w okresie wchodzący do proporcji odliczeń z art. 11 (`= revenueGrosze`). */
  readonly taxableRevenueInPeriodGrosze: number;
  /** Nierozliczona nadwyżka korekty `in minus` w tej stawce do przeniesienia na kolejne okresy / PIT-28 (art. 6 ust. 1c). */
  readonly carryForwardNegativeRevenueGrosze: number;
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
  /** Suma dodatnich koszyków przychodowych stanowiąca podstawę proporcji odliczeń z art. 11. */
  readonly totalRevenueGrosze: number;
  /** Suma dodatnich koszyków przychodowych (alias jawny obok `totalRevenueGrosze`). */
  readonly totalPositiveBucketRevenueGrosze: number;
  /** Algebraiczna suma wszystkich wpisów w okresie (uwzględniająca ujemne salda stawek po korektach `in minus`). */
  readonly totalNetRevenueGrosze: number;
  /** Łączna kwota nierozliczonych korekt zmniejszających przychód (`in minus`) do przeniesienia wg art. 6 ust. 1c u.z.p.d. */
  readonly unappliedNegativeCorrectionGrosze: number;
  readonly deductibleSocialZusGrosze: number;
  readonly deductibleHealth50PctGrosze: number;
  readonly totalEffectiveDeductionGrosze: number;
  readonly breakdownByRate: readonly RyczaltRateBreakdown[];
  readonly totalUnroundedTaxGrosze: number;
  readonly taxDueRoundedPln: number;
  readonly taxDueGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Iteracyjnie rozdziela kwotę odliczenia proporcjonalnie do dodatnich przychodów stawek ryczałtu
 * metodą największych reszt (Hamiltona) z twardym ograniczeniem pojemności każdego koszyka
 * (`allocated[i] <= revenue[i]`), gwarantując konserwację co do 1 grosza zawsze, gdy `sum(revenue) >= deduction`.
 */
export function allocateDeductionProportionally(
  totalDeductionToAllocate: number,
  revenuesByRate: readonly { readonly rate: RyczaltRateCode; readonly revenueGrosze: number }[],
  totalPositiveRevenue: number,
): Map<RyczaltRateCode, number> {
  const result = new Map<RyczaltRateCode, number>();
  for (const bucket of revenuesByRate) {
    result.set(bucket.rate, 0);
  }

  if (totalDeductionToAllocate <= 0 || totalPositiveRevenue <= 0 || revenuesByRate.length === 0) {
    return result;
  }

  if (totalDeductionToAllocate >= totalPositiveRevenue) {
    for (const bucket of revenuesByRate) {
      result.set(bucket.rate, bucket.revenueGrosze);
    }
    return result;
  }

  let remainingToAllocate = totalDeductionToAllocate;

  while (remainingToAllocate > 0) {
    const uncapped = revenuesByRate.filter(
      (bucket) => (result.get(bucket.rate) ?? 0) < bucket.revenueGrosze,
    );
    if (uncapped.length === 0) {
      break;
    }

    const weightSum = sumGrosze(uncapped.map((b) => b.revenueGrosze));
    if (weightSum <= 0) {
      break;
    }

    const weightBig = BigInt(weightSum);
    const remToAllocBig = BigInt(remainingToAllocate);

    const quotas = uncapped.map((bucket, idx) => {
      const currentAlloc = result.get(bucket.rate) ?? 0;
      const freeCapacity = subtractGrosze(bucket.revenueGrosze, currentAlloc);
      const numer = remToAllocBig * BigInt(bucket.revenueGrosze);
      const floorShare = Number(numer / weightBig);
      const remainder = numer % weightBig;
      return {
        rate: bucket.rate,
        revenueGrosze: bucket.revenueGrosze,
        freeCapacity,
        floorShare,
        remainder,
        idx,
      };
    });

    const anyHitsCap = quotas.some((q) => q.floorShare >= q.freeCapacity);
    if (anyHitsCap) {
      for (const q of quotas) {
        if (q.floorShare >= q.freeCapacity) {
          const prev = result.get(q.rate) ?? 0;
          result.set(q.rate, addGrosze(prev, q.freeCapacity));
          remainingToAllocate = subtractGrosze(remainingToAllocate, q.freeCapacity);
        }
      }
      continue;
    }

    // Żaden koszyk nie nasycił się samą częścią całkowitą — każdy ma jeszcze co najmniej 1 gr pojemności na resztę!
    for (const q of quotas) {
      if (q.floorShare > 0) {
        const prev = result.get(q.rate) ?? 0;
        result.set(q.rate, addGrosze(prev, q.floorShare));
        remainingToAllocate = subtractGrosze(remainingToAllocate, q.floorShare);
      }
    }

    if (remainingToAllocate > 0) {
      const sortedByRemainder = [...quotas].sort((a, b) => {
        if (b.remainder !== a.remainder) {
          return b.remainder > a.remainder ? 1 : -1;
        }
        if (b.revenueGrosze !== a.revenueGrosze) {
          return b.revenueGrosze - a.revenueGrosze;
        }
        return a.idx - b.idx;
      });

      for (let k = 0; k < remainingToAllocate && k < sortedByRemainder.length; k += 1) {
        const target = sortedByRemainder[k];
        if (target !== undefined) {
          const prev = result.get(target.rate) ?? 0;
          result.set(target.rate, addGrosze(prev, 1));
        }
      }
      remainingToAllocate = 0;
    }
  }

  return result;
}

/**
 * Oblicza miesięczny ryczałt od przychodów ewidencjonowanych:
 * - grupuje przychody wg stawek ryczałtu (art. 12 ust. 1) z zachowaniem ujemnych korekt `in minus` wg art. 6 ust. 1c
 * - rozlicza zapłacone składki społeczne ZUS oraz 50% zapłaconej składki zdrowotnej proporcjonalnie
 *   do udziału poszczególnych dodatnich stawek w ogólnej kwocie dodatnich przychodów (art. 11 ust. 1, ust. 1a i ust. 2)
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

  const allActiveBuckets: {
    readonly rate: RyczaltRateCode;
    readonly rawNetRevenueGrosze: number;
  }[] = [];
  const positiveBuckets: { readonly rate: RyczaltRateCode; readonly revenueGrosze: number }[] = [];

  for (const rate of RYCZALT_RATE_ORDER) {
    const rawRev = grouped.get(rate);
    if (rawRev !== undefined && rawRev !== 0) {
      allActiveBuckets.push({ rate, rawNetRevenueGrosze: rawRev });
      if (rawRev > 0) {
        positiveBuckets.push({ rate, revenueGrosze: rawRev });
      }
    }
  }

  const totalNetRevenueGrosze = sumGrosze(periodEntries.map((e) => e.revenueGrosze));
  const totalPositiveBucketRevenueGrosze = sumGrosze(positiveBuckets.map((b) => b.revenueGrosze));
  const totalRevenueGrosze = totalPositiveBucketRevenueGrosze;

  const unappliedNegativeCorrectionGrosze = sumGrosze(
    allActiveBuckets.filter((b) => b.rawNetRevenueGrosze < 0).map((b) => -b.rawNetRevenueGrosze),
  );

  const warnings: ExplanationWarning[] = [];
  if (unappliedNegativeCorrectionGrosze > 0) {
    const negDescriptions = allActiveBuckets
      .filter((b) => b.rawNetRevenueGrosze < 0)
      .map((b) => `${b.rate}%: ${formatPlnFromGrosze(-b.rawNetRevenueGrosze)}`)
      .join(', ');
    warnings.push({
      code: 'RYCZALT_NEGATIVE_CORRECTION_CARRY_FORWARD_ART_6_1C',
      severity: 'requires_expert_review',
      message: `W okresie wystąpiła nierozliczona nadwyżka korekty zmniejszającej przychód (in minus) ponad przychody danej stawki (${negDescriptions}; łącznie ${formatPlnFromGrosze(unappliedNegativeCorrectionGrosze)}). Zgodnie z art. 6 ust. 1c ustawy o zryczałtowanym podatku dochodowym nadwyżka podlega przeniesieniu do rozliczenia w kolejnych okresach lub w zeznaniu rocznym PIT-28 — wymagana weryfikacja księgowa.`,
    });
  }

  const effectiveSocialDeduction = Math.min(totalPositiveBucketRevenueGrosze, socialPaid);
  const revenueRemainingAfterSocial = subtractGrosze(
    totalPositiveBucketRevenueGrosze,
    effectiveSocialDeduction,
  );
  const effectiveHealthDeduction = Math.min(revenueRemainingAfterSocial, maxHealth50PctGrosze);
  const totalEffectiveDeductionGrosze = addGrosze(
    effectiveSocialDeduction,
    effectiveHealthDeduction,
  );

  const socialAlloc = allocateDeductionProportionally(
    effectiveSocialDeduction,
    positiveBuckets,
    totalPositiveBucketRevenueGrosze,
  );
  const healthAlloc = allocateDeductionProportionally(
    effectiveHealthDeduction,
    positiveBuckets,
    totalPositiveBucketRevenueGrosze,
  );

  const breakdownByRate: RyczaltRateBreakdown[] = allActiveBuckets.map((bucket) => {
    const rateBps = ryczaltRateToBps(bucket.rate);
    const taxableRevenueInPeriodGrosze = Math.max(0, bucket.rawNetRevenueGrosze);
    const carryForwardNegativeRevenueGrosze = Math.max(0, -bucket.rawNetRevenueGrosze);
    const allocSocial = socialAlloc.get(bucket.rate) ?? 0;
    const allocHealth = healthAlloc.get(bucket.rate) ?? 0;
    const afterDeductions = Math.max(
      0,
      subtractGrosze(taxableRevenueInPeriodGrosze, addGrosze(allocSocial, allocHealth)),
    );
    const roundedBaseGrosze = roundTaxAmountOrdynacjaArt63(afterDeductions).roundedGrosze;
    const unroundedTaxGrosze = multiplyGroszeByBps(roundedBaseGrosze, rateBps, 'half_up');

    return {
      rate: bucket.rate,
      rateBps,
      revenueGrosze: taxableRevenueInPeriodGrosze,
      rawNetRevenueGrosze: bucket.rawNetRevenueGrosze,
      taxableRevenueInPeriodGrosze,
      carryForwardNegativeRevenueGrosze,
      shareRatioDescription:
        taxableRevenueInPeriodGrosze > 0 && totalPositiveBucketRevenueGrosze > 0
          ? `${formatPlnFromGrosze(taxableRevenueInPeriodGrosze)} / ${formatPlnFromGrosze(totalPositiveBucketRevenueGrosze)}`
          : `0,00 zł (korekta in minus do przeniesienia: ${formatPlnFromGrosze(carryForwardNegativeRevenueGrosze)})`,
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
      label:
        'Zsumowanie przychodów wg stawek (z kontrolą korekt in minus wg art. 6 ust. 1c) i wyliczenie 50% zapłaconej zdrowotnej',
      formula: 'health50Pct = round_half_up(paidHealth * 50%)',
      inputs: {
        totalNetRevenueGrosze,
        totalPositiveBucketRevenueGrosze,
        unappliedNegativeCorrectionGrosze,
        paidSocialZusInMonthGrosze: socialPaid,
        paidHealthInsuranceInMonthGrosze: healthPaid,
      },
      resultFormatted: `Dodatnie koszyki: ${formatPlnFromGrosze(totalPositiveBucketRevenueGrosze)} (netto: ${formatPlnFromGrosze(totalNetRevenueGrosze)}), 50% zdrowotnej: ${formatPlnFromGrosze(maxHealth50PctGrosze)}`,
      resultGrosze: maxHealth50PctGrosze,
    },
    {
      stepNumber: 2,
      label:
        'Proporcjonalne odliczenie składek ZUS i 50% zdrowotnej wg udziału dodatnich stawek przychodu (art. 11 ust. 2)',
      formula:
        'deduction_i = largest_remainder_capped(totalDeduction, revenue_i / totalPositiveRevenue)',
      inputs: {
        positiveRatesCount: positiveBuckets.length,
        totalEffectiveDeductionGrosze,
      },
      resultFormatted: formatPlnFromGrosze(totalEffectiveDeductionGrosze),
      resultGrosze: totalEffectiveDeductionGrosze,
    },
    {
      stepNumber: 3,
      label:
        'Zaokrąglenie podstaw opodatkowania dla stawek oraz obliczenie i zaokrąglenie należnego ryczałtu (art. 63 § 1 OP)',
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
    summary: `Ryczałt za ${input.period}: przychód dodatni ${formatPlnFromGrosze(totalPositiveBucketRevenueGrosze)}, odliczenia ${formatPlnFromGrosze(totalEffectiveDeductionGrosze)}, ryczałt należny ${formatPlnFromGrosze(roundedTax.roundedGrosze)}.`,
    eventDate,
    rules: [ratesRule, deductionRule, deadlineRule, roundingRule],
    steps,
    inputs: {
      period: input.period,
      totalNetRevenueGrosze,
      totalPositiveBucketRevenueGrosze,
      paidSocialZusInMonthGrosze: socialPaid,
      paidHealthInsuranceInMonthGrosze: healthPaid,
    },
    outputs: {
      totalPositiveBucketRevenueGrosze,
      unappliedNegativeCorrectionGrosze,
      deductibleSocialZusGrosze: effectiveSocialDeduction,
      deductibleHealth50PctGrosze: effectiveHealthDeduction,
      taxDueGrosze: roundedTax.roundedGrosze,
    },
    warnings,
  });

  return {
    period: input.period,
    totalRevenueGrosze,
    totalPositiveBucketRevenueGrosze,
    totalNetRevenueGrosze,
    unappliedNegativeCorrectionGrosze,
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
