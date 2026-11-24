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
  multiplyGroszeByRatio,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
} from '../money.js';
import { calculateKpirPitAdvance } from '../kpir/index.js';
import {
  allocateDeductionProportionally,
  ryczaltRateToBps,
  RYCZALT_RATE_ORDER,
} from '../ryczalt/index.js';
import type { RyczaltEntry, RyczaltRateBreakdown, RyczaltRateCode } from '../ryczalt/index.js';
import { calculateMonthlyZusContributions } from '../zus/index.js';
import type { HealthTaxForm, MonthlyZusContributionsResult, ZusScheme } from '../zus/index.js';

// ============================================================================
// 1. Model rozrachunkowy zobowiązań publicznoprawnych: ACCRUED / DUE vs PAID (#81)
// ============================================================================

export type AccountingTaxProfileCode =
  'jdg_kpir_skala' | 'jdg_kpir_liniowy' | 'jdg_ryczalt' | 'spzoo_pelne_ksiegi';

export type ObligationLifecycleStatus =
  'accrued_not_yet_due' | 'due_unpaid' | 'partially_paid' | 'paid' | 'overpaid';

export type PublicLawObligationKind =
  | 'zus_social'
  | 'zus_health'
  | 'zus_labor_fund'
  | 'pit_advance'
  | 'ryczalt_advance'
  | 'cit_advance'
  | 'vat_settlement';

/**
 * Zweryfikowany dowód faktycznej zapłaty składki lub zaliczki podatkowej (#81).
 * Zgodnie z art. 26 ust. 1 pkt 2 i art. 30c ust. 2 pkt 2 PIT oraz art. 11 ust. 1 i 1a u.z.p.d.,
 * odliczeniu od dochodu/przychodu podlegają wyłącznie składki FAKTYCZNIE ZAPŁACONE w roku podatkowym
 * z udokumentowanym identyfikatorem płatności i datą obciążenia rachunku.
 */
export interface VerifiedTaxOrZusPayment {
  readonly paymentId: string;
  readonly obligationKind: PublicLawObligationKind;
  /** Okres, którego dotyczy opłacane zobowiązanie (`YYYY-MM`). */
  readonly targetPeriod: string;
  /** Data faktycznego opłacenia (`YYYY-MM-DD`, obciążenie rachunku bankowego). */
  readonly paidDate: string;
  readonly amountGrosze: number;
  /** Powiązany identyfikator transakcji wyciągu bankowego lub potwierdzenia przelewu. */
  readonly bankTransactionId: string;
}

export interface ObligationSettlementSnapshot {
  readonly obligationKind: PublicLawObligationKind;
  readonly period: string;
  readonly statutoryDueDate: string;
  readonly accruedDueGrosze: number;
  readonly confirmedPaidGrosze: number;
  readonly remainingUnpaidGrosze: number;
  readonly overpaymentGrosze: number;
  readonly status: ObligationLifecycleStatus;
  readonly appliedPaymentIds: readonly string[];
}

export function validateVerifiedPaymentRecord(payment: VerifiedTaxOrZusPayment): void {
  if (payment.paymentId.trim().length === 0) {
    throw new Error('Dowód zapłaty zobowiązania wymaga niepustego paymentId.');
  }
  if (payment.bankTransactionId.trim().length === 0) {
    throw new Error(
      `Dowód zapłaty "${payment.paymentId}" wymaga niepustego identyfikatora transakcji bankowej (bankTransactionId).`,
    );
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payment.targetPeriod)) {
    throw new Error(
      `Nieprawidłowy okres zobowiązania targetPeriod="${payment.targetPeriod}" w płatności "${payment.paymentId}".`,
    );
  }
  assertValidIsoCalendarDate(payment.paidDate, `payment[${payment.paymentId}].paidDate`);
  assertNonNegativeGrosze(payment.amountGrosze, `payment[${payment.paymentId}].amountGrosze`);
  if (payment.amountGrosze === 0) {
    throw new Error(`Kwota dowodu zapłaty "${payment.paymentId}" musi być dodatnia (> 0 gr).`);
  }
}

export function buildObligationSettlementSnapshot(params: {
  readonly obligationKind: PublicLawObligationKind;
  readonly period: string;
  readonly statutoryDueDate: string;
  readonly accruedDueGrosze: number;
  readonly evaluationDate: string;
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
}): ObligationSettlementSnapshot {
  assertValidIsoCalendarDate(params.statutoryDueDate, 'statutoryDueDate');
  assertValidIsoCalendarDate(params.evaluationDate, 'evaluationDate');
  assertNonNegativeGrosze(params.accruedDueGrosze, 'accruedDueGrosze');

  const seenIds = new Set<string>();
  const matchingPayments: VerifiedTaxOrZusPayment[] = [];

  for (const p of params.verifiedPayments) {
    validateVerifiedPaymentRecord(p);
    if (seenIds.has(p.paymentId)) {
      throw new Error(`Zduplikowany identyfikator płatności "${p.paymentId}".`);
    }
    seenIds.add(p.paymentId);
    if (
      p.obligationKind === params.obligationKind &&
      p.targetPeriod === params.period &&
      p.paidDate <= params.evaluationDate
    ) {
      matchingPayments.push(p);
    }
  }

  const confirmedPaidGrosze = sumGrosze(matchingPayments.map((p) => p.amountGrosze));
  const remainingUnpaidGrosze = Math.max(
    0,
    subtractGrosze(params.accruedDueGrosze, confirmedPaidGrosze),
  );
  const overpaymentGrosze = Math.max(
    0,
    subtractGrosze(confirmedPaidGrosze, params.accruedDueGrosze),
  );

  let status: ObligationLifecycleStatus;
  if (params.accruedDueGrosze === 0 && confirmedPaidGrosze === 0) {
    status = 'paid';
  } else if (overpaymentGrosze > 0) {
    status = 'overpaid';
  } else if (remainingUnpaidGrosze === 0) {
    status = 'paid';
  } else if (confirmedPaidGrosze > 0) {
    status = 'partially_paid';
  } else if (params.evaluationDate < params.statutoryDueDate) {
    status = 'accrued_not_yet_due';
  } else {
    status = 'due_unpaid';
  }

  return {
    obligationKind: params.obligationKind,
    period: params.period,
    statutoryDueDate: params.statutoryDueDate,
    accruedDueGrosze: params.accruedDueGrosze,
    confirmedPaidGrosze,
    remainingUnpaidGrosze,
    overpaymentGrosze,
    status,
    appliedPaymentIds: matchingPayments.map((p) => p.paymentId),
  };
}

function lastDayOfPeriodIso(period: string): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

function nextMonthDueDateIso(period: string, dueDay: number): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  let year = Number(yStr);
  let month = Number(mStr) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}

// ============================================================================
// 2. PROFIL A: JDG KPiR (Skala 12%/32% + kwota wolna, Liniowy 19%, ZUS należny vs zapłacony)
// ============================================================================

export type CalculationBindingMode = 'binding_verified_payments_only' | 'what_if_simulation';

export interface ProfileAKpirMonthlyInput {
  readonly period: string;
  readonly taxForm: 'skala' | 'liniowy';
  readonly zusScheme: ZusScheme;
  readonly voluntarySicknessInsurance: boolean;
  readonly previousMonthIncomeForHealthGrosze: number;
  readonly ytdRevenueGrosze: number;
  readonly ytdCostsGrosze: number;
  /** Należne zaliczki PIT z poprzednich miesięcy roku podatkowego (wg art. 44 ust. 3 PIT). */
  readonly previousAdvancesAccruedDueYtdGrosze?: number;
  /** Zweryfikowane płatności składek ZUS i zaliczek PIT (z identyfikatorem i datą zapłaty). */
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
  /** Graniczna data weryfikacji zapłaty składek do zaliczki za `period` (domyślnie koniec `period`, np. `2026-03-31`). */
  readonly deductionCutOffDate?: string;
  readonly healthAlreadyIncludedInKupYtdGrosze?: number;
  readonly priorYearsLossDeductionGrosze?: number;
  /** Tryb wyliczenia: domyślnie wiążący (`binding_verified_payments_only`). Symulacja nigdy nie jest wiążąca! */
  readonly mode?: CalculationBindingMode;
  readonly simulatedPaidSocialZusYtdGrosze?: number;
  readonly simulatedPaidHealthYtdGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface ProfileAKpirMonthlyResult {
  readonly profileCode: 'jdg_kpir_skala' | 'jdg_kpir_liniowy';
  readonly period: string;
  readonly mode: CalculationBindingMode;
  readonly isSimulationOnly: boolean;
  readonly bindingForDeclaration: boolean;
  readonly accruedZus: MonthlyZusContributionsResult;
  readonly zusSettlements: {
    readonly social: ObligationSettlementSnapshot;
    readonly health: ObligationSettlementSnapshot;
    readonly laborFund: ObligationSettlementSnapshot;
  };
  readonly confirmedPaidSocialZusInTaxYearYtdGrosze: number;
  readonly confirmedPaidHealthInTaxYearYtdGrosze: number;
  readonly unpaidAccruedZusExcludedFromDeductionGrosze: number;
  readonly pitAdvanceAccruedDueGrosze: number;
  readonly pitAdvanceSettlement: ObligationSettlementSnapshot;
  readonly cumulativePitArrearsFromPriorMonthsGrosze: number;
  readonly totalCashRemainingToPayForPeriodAndArrearsGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Deterministyczny kalkulator Profilu A (JDG KPiR — Skala podatkowa 12%/32% z kwotą wolną 30 000 zł
 * albo Podatek liniowy 19% z limitem zdrowotnej 14 100 zł w 2026 r.), rygorystycznie rozdzielający
 * składki/zaliczki NALEŻNE (`accrued/due`) od FAKTYCZNIE ZAPŁACONYCH (`paid`) (#81).
 */
export function calculateProfileAKpirObligations(
  input: ProfileAKpirMonthlyInput,
): ProfileAKpirMonthlyResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres rozliczeniowy Profilu A: "${input.period}".`);
  }
  const mode: CalculationBindingMode = input.mode ?? 'binding_verified_payments_only';
  const isSimulationOnly = mode === 'what_if_simulation';
  const taxYear = input.period.slice(0, 4);
  const yearStart = `${taxYear}-01-01`;
  const cutOffDate = input.deductionCutOffDate ?? lastDayOfPeriodIso(input.period);
  assertValidIsoCalendarDate(cutOffDate, 'deductionCutOffDate');

  for (const p of input.verifiedPayments) {
    validateVerifiedPaymentRecord(p);
  }

  const accruedZus = calculateMonthlyZusContributions({
    period: input.period,
    zusScheme: input.zusScheme,
    taxForm: input.taxForm,
    voluntarySicknessInsurance: input.voluntarySicknessInsurance,
    previousMonthIncomeGrosze: input.previousMonthIncomeForHealthGrosze,
    ...(input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : {}),
  });

  const zusDueDate = nextMonthDueDateIso(input.period, 20);
  const pitDueDate = nextMonthDueDateIso(input.period, 20);

  const socialSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_social',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.socialContributionsTotalGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });
  const healthSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_health',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.healthContributionGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });
  const laborSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_labor_fund',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.laborAndSolidarityFundGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });

  // Wyłącznie składki faktycznie zapłacone w danym roku podatkowym (yearStart <= paidDate <= cutOffDate)
  const confirmedPaidSocialYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_social' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .map((p) => p.amountGrosze),
  );
  const confirmedPaidHealthYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_health' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .map((p) => p.amountGrosze),
  );

  const deductibleSocialUsed = isSimulationOnly
    ? assertNonNegativeGrosze(
        input.simulatedPaidSocialZusYtdGrosze ?? confirmedPaidSocialYtd,
        'simulatedPaidSocialZusYtdGrosze',
      )
    : confirmedPaidSocialYtd;
  const deductibleHealthUsed = isSimulationOnly
    ? assertNonNegativeGrosze(
        input.simulatedPaidHealthYtdGrosze ?? confirmedPaidHealthYtd,
        'simulatedPaidHealthYtdGrosze',
      )
    : confirmedPaidHealthYtd;

  const prevAdvancesAccruedDueYtd = assertNonNegativeGrosze(
    input.previousAdvancesAccruedDueYtdGrosze ?? 0,
    'previousAdvancesAccruedDueYtdGrosze',
  );
  const prevAdvancesActuallyPaidYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'pit_advance' &&
          p.targetPeriod.startsWith(`${taxYear}-`) &&
          p.targetPeriod < input.period &&
          p.paidDate <= cutOffDate,
      )
      .map((p) => p.amountGrosze),
  );

  const pitCalc = calculateKpirPitAdvance({
    period: input.period,
    taxForm: input.taxForm,
    ytdRevenueGrosze: input.ytdRevenueGrosze,
    ytdCostsGrosze: input.ytdCostsGrosze,
    paidSocialZusYtdGrosze: deductibleSocialUsed,
    paidHealthInsuranceYtdGrosze: deductibleHealthUsed,
    ...(input.healthAlreadyIncludedInKupYtdGrosze !== undefined
      ? { healthAlreadyIncludedInKupYtdGrosze: input.healthAlreadyIncludedInKupYtdGrosze }
      : {}),
    ...(input.priorYearsLossDeductionGrosze !== undefined
      ? { priorYearsLossDeductionGrosze: input.priorYearsLossDeductionGrosze }
      : {}),
    previousAdvancesPaidYtdGrosze: prevAdvancesAccruedDueYtd,
    ...(input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : {}),
  });

  const pitSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'pit_advance',
    period: input.period,
    statutoryDueDate: pitDueDate,
    accruedDueGrosze: pitCalc.advanceDueGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });

  const unpaidAccruedZusExcluded = addGrosze(
    socialSettlement.remainingUnpaidGrosze,
    input.taxForm === 'liniowy' ? healthSettlement.remainingUnpaidGrosze : 0,
  );
  const priorPitArrears = Math.max(
    0,
    subtractGrosze(prevAdvancesAccruedDueYtd, prevAdvancesActuallyPaidYtd),
  );
  const totalCashRemaining = sumGrosze([
    pitSettlement.remainingUnpaidGrosze,
    priorPitArrears,
    socialSettlement.remainingUnpaidGrosze,
    healthSettlement.remainingUnpaidGrosze,
    laborSettlement.remainingUnpaidGrosze,
  ]);

  const extraWarnings: ExplanationWarning[] = [...pitCalc.explanation.warnings];
  if (isSimulationOnly) {
    extraWarnings.push({
      code: 'SIMULATION_NOT_BINDING_FOR_DECLARATION',
      severity: 'requires_expert_review',
      message:
        'Wyliczenie wykonano w trybie symulacji (what_if_simulation) z nieopłaconymi składkami — wynik ma wyłącznie charakter szacunkowy i NIE może stanowić podstawy deklaracji ani księgowania.',
    });
  }
  if (!isSimulationOnly && unpaidAccruedZusExcluded > 0) {
    extraWarnings.push({
      code: 'UNPAID_ZUS_EXCLUDED_FROM_PIT_DEDUCTION',
      severity: 'info',
      message: `Naliczone, lecz nieopłacone do dnia ${cutOffDate} składki ZUS (${formatPlnFromGrosze(unpaidAccruedZusExcluded)}) zostały wyłączone z odliczenia w zaliczce PIT zgodnie z art. 26 ust. 1 pkt 2 / art. 30c ust. 2 pkt 2 ustawy o PIT.`,
    });
  }
  if (priorPitArrears > 0) {
    extraWarnings.push({
      code: 'PRIOR_PERIOD_PIT_ARREARS_DETECTED',
      severity: 'warning',
      message: `Wykryto nieopłacone zaliczki należne PIT za poprzednie miesiące w kwocie ${formatPlnFromGrosze(priorPitArrears)} (należne YTD: ${formatPlnFromGrosze(prevAdvancesAccruedDueYtd)}, wpłacone YTD: ${formatPlnFromGrosze(prevAdvancesActuallyPaidYtd)}).`,
    });
  }

  const explanation: LegalExplanation = {
    ...pitCalc.explanation,
    summary: `${isSimulationOnly ? '[SYMULACJA NIErekordowa] ' : ''}${pitCalc.explanation.summary} Odliczono wyłącznie opłacony ZUS społeczny (${formatPlnFromGrosze(deductibleSocialUsed)}).`,
    warnings: extraWarnings,
    requiresHumanApproval:
      pitCalc.explanation.requiresHumanApproval || isSimulationOnly || priorPitArrears > 0,
  };

  return {
    profileCode: input.taxForm === 'skala' ? 'jdg_kpir_skala' : 'jdg_kpir_liniowy',
    period: input.period,
    mode,
    isSimulationOnly,
    bindingForDeclaration: !isSimulationOnly,
    accruedZus,
    zusSettlements: {
      social: socialSettlement,
      health: healthSettlement,
      laborFund: laborSettlement,
    },
    confirmedPaidSocialZusInTaxYearYtdGrosze: confirmedPaidSocialYtd,
    confirmedPaidHealthInTaxYearYtdGrosze: confirmedPaidHealthYtd,
    unpaidAccruedZusExcludedFromDeductionGrosze: unpaidAccruedZusExcluded,
    pitAdvanceAccruedDueGrosze: pitCalc.advanceDueGrosze,
    pitAdvanceSettlement: pitSettlement,
    cumulativePitArrearsFromPriorMonthsGrosze: priorPitArrears,
    totalCashRemainingToPayForPeriodAndArrearsGrosze: totalCashRemaining,
    explanation,
  };
}

// ============================================================================
// 3. PROFIL B: JDG Ryczałt (koszyki stawek + wyłącznie ZAPŁACONY ZUS + progi zdrowotne)
// ============================================================================

export interface ProfileBRyczaltMonthlyInput {
  readonly period: string;
  readonly zusScheme: ZusScheme;
  readonly voluntarySicknessInsurance: boolean;
  readonly entries: readonly RyczaltEntry[];
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
  /** Kwota zapłaconego wcześniej w tym roku ZUS społecznego wykorzystana już w poprzednich miesiącach ryczałtu. */
  readonly socialZusAlreadyDeductedPriorMonthsYtdGrosze?: number;
  /** Kwota 50% zapłaconej zdrowotnej wykorzystana już w poprzednich miesiącach ryczałtu. */
  readonly health50PctAlreadyDeductedPriorMonthsYtdGrosze?: number;
  readonly deductionCutOffDate?: string;
  readonly mode?: CalculationBindingMode;
  readonly simulatedPaidSocialInMonthGrosze?: number;
  readonly simulatedPaidHealthInMonthGrosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

export interface ProfileBRyczaltMonthlyResult {
  readonly profileCode: 'jdg_ryczalt';
  readonly period: string;
  readonly mode: CalculationBindingMode;
  readonly isSimulationOnly: boolean;
  readonly bindingForDeclaration: boolean;
  readonly accruedZus: MonthlyZusContributionsResult;
  readonly zusSettlements: {
    readonly social: ObligationSettlementSnapshot;
    readonly health: ObligationSettlementSnapshot;
    readonly laborFund: ObligationSettlementSnapshot;
  };
  readonly confirmedPaidSocialZusAvailableGrosze: number;
  readonly confirmedPaidHealth50PctAvailableGrosze: number;
  readonly appliedSocialDeductionGrosze: number;
  readonly appliedHealth50PctDeductionGrosze: number;
  readonly carryForwardUnusedSocialDeductionGrosze: number;
  readonly carryForwardUnusedHealth50PctDeductionGrosze: number;
  readonly breakdownByRate: readonly RyczaltRateBreakdown[];
  readonly ryczaltTaxAccruedDueGrosze: number;
  readonly ryczaltSettlement: ObligationSettlementSnapshot;
  readonly explanation: LegalExplanation;
}

/**
 * Deterministyczny kalkulator Profilu B (JDG Ryczałt od przychodów ewidencjonowanych):
 * - wylicza należny ZUS (z progiem zdrowotnym I/II/III pomniejszonym wyłącznie o ZAPŁACONY ZUS społeczny wg art. 81 ust. 2e u.ś.o.z.),
 * - odlicza od przychodów proporcjonalnie wg koszyków stawek wyłącznie FAKTYCZNIE ZAPŁACONE w roku podatkowym
 *   składki społeczne ZUS oraz 50% zapłaconej składki zdrowotnej (art. 11 ust. 1, 1a i 2 u.z.p.d.),
 * - przenosi niewykorzystaną nadwyżkę zapłaconych składek na kolejne miesiące roku podatkowego (#81, GLD-06).
 */
export function calculateProfileBRyczaltObligations(
  input: ProfileBRyczaltMonthlyInput,
): ProfileBRyczaltMonthlyResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres rozliczeniowy Profilu B: "${input.period}".`);
  }
  const mode: CalculationBindingMode = input.mode ?? 'binding_verified_payments_only';
  const isSimulationOnly = mode === 'what_if_simulation';
  const taxYear = input.period.slice(0, 4);
  const yearStart = `${taxYear}-01-01`;
  const cutOffDate = input.deductionCutOffDate ?? lastDayOfPeriodIso(input.period);
  assertValidIsoCalendarDate(cutOffDate, 'deductionCutOffDate');

  for (const p of input.verifiedPayments) {
    validateVerifiedPaymentRecord(p);
  }

  const ytdRyczaltEntries = input.entries.filter(
    (e) => e.period.startsWith(`${taxYear}-`) && e.period <= input.period,
  );
  const ytdRevenueGrosze = Math.max(0, sumGrosze(ytdRyczaltEntries.map((e) => e.revenueGrosze)));

  const confirmedPaidSocialYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_social' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .map((p) => p.amountGrosze),
  );
  const confirmedPaidHealthYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'zus_health' && p.paidDate >= yearStart && p.paidDate <= cutOffDate,
      )
      .map((p) => p.amountGrosze),
  );

  const accruedZus = calculateMonthlyZusContributions({
    period: input.period,
    zusScheme: input.zusScheme,
    taxForm: 'ryczalt' as HealthTaxForm,
    voluntarySicknessInsurance: input.voluntarySicknessInsurance,
    ytdRyczaltRevenueGrosze: ytdRevenueGrosze,
    ytdDeductibleSocialZusGrosze: confirmedPaidSocialYtd,
    ...(input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : {}),
  });

  const zusDueDate = nextMonthDueDateIso(input.period, 20);
  const ryczaltDueDate = nextMonthDueDateIso(input.period, 20);

  const socialSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_social',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.socialContributionsTotalGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });
  const healthSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_health',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.healthContributionGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });
  const laborSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'zus_labor_fund',
    period: input.period,
    statutoryDueDate: zusDueDate,
    accruedDueGrosze: accruedZus.laborAndSolidarityFundGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });

  const socialUsedPrior = assertNonNegativeGrosze(
    input.socialZusAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
    'socialZusAlreadyDeductedPriorMonthsYtdGrosze',
  );
  const health50UsedPrior = assertNonNegativeGrosze(
    input.health50PctAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
    'health50PctAlreadyDeductedPriorMonthsYtdGrosze',
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
  const roundingRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', eventDate, ruleOptions);
  const healthBps = getRequiredNumericParameter(deductionRule, 'healthDeductionBps');

  const totalConfirmedHealth50Ytd = multiplyGroszeByBps(
    confirmedPaidHealthYtd,
    healthBps,
    'half_up',
  );

  const availableSocial = isSimulationOnly
    ? assertNonNegativeGrosze(
        input.simulatedPaidSocialInMonthGrosze ??
          Math.max(0, subtractGrosze(confirmedPaidSocialYtd, socialUsedPrior)),
        'simulatedPaidSocialInMonthGrosze',
      )
    : Math.max(0, subtractGrosze(confirmedPaidSocialYtd, socialUsedPrior));

  const availableHealth50 = isSimulationOnly
    ? multiplyGroszeByBps(
        assertNonNegativeGrosze(
          input.simulatedPaidHealthInMonthGrosze ?? 0,
          'simulatedPaidHealthInMonthGrosze',
        ),
        healthBps,
        'half_up',
      )
    : Math.max(0, subtractGrosze(totalConfirmedHealth50Ytd, health50UsedPrior));

  const periodEntries = input.entries.filter((e) => e.period === input.period);
  const grouped = new Map<RyczaltRateCode, number>();
  for (const entry of periodEntries) {
    grouped.set(entry.rate, addGrosze(grouped.get(entry.rate) ?? 0, entry.revenueGrosze));
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

  const totalPositiveRevenue = sumGrosze(positiveBuckets.map((b) => b.revenueGrosze));
  const appliedSocial = Math.min(totalPositiveRevenue, availableSocial);
  const remainingRevAfterSocial = subtractGrosze(totalPositiveRevenue, appliedSocial);
  const appliedHealth50 = Math.min(remainingRevAfterSocial, availableHealth50);

  const socialAlloc = allocateDeductionProportionally(
    appliedSocial,
    positiveBuckets,
    totalPositiveRevenue,
  );
  const healthAlloc = allocateDeductionProportionally(
    appliedHealth50,
    positiveBuckets,
    totalPositiveRevenue,
  );

  const breakdownByRate: RyczaltRateBreakdown[] = allActiveBuckets.map((bucket) => {
    const rateBps = ryczaltRateToBps(bucket.rate);
    const posRev = Math.max(0, bucket.rawNetRevenueGrosze);
    const negCarry = Math.max(0, -bucket.rawNetRevenueGrosze);
    const allocSoc = socialAlloc.get(bucket.rate) ?? 0;
    const allocHlth = healthAlloc.get(bucket.rate) ?? 0;
    const afterDed = Math.max(0, subtractGrosze(posRev, addGrosze(allocSoc, allocHlth)));
    const roundedBase = roundTaxAmountOrdynacjaArt63(afterDed).roundedGrosze;
    const unroundedTax = multiplyGroszeByBps(roundedBase, rateBps, 'half_up');

    return {
      rate: bucket.rate,
      rateBps,
      revenueGrosze: posRev,
      rawNetRevenueGrosze: bucket.rawNetRevenueGrosze,
      taxableRevenueInPeriodGrosze: posRev,
      carryForwardNegativeRevenueGrosze: negCarry,
      shareRatioDescription:
        posRev > 0 && totalPositiveRevenue > 0
          ? `${formatPlnFromGrosze(posRev)} / ${formatPlnFromGrosze(totalPositiveRevenue)}`
          : '0,00 zł',
      allocatedSocialDeductionGrosze: allocSoc,
      allocatedHealthDeductionGrosze: allocHlth,
      revenueAfterDeductionsGrosze: afterDed,
      roundedBaseGrosze: roundedBase,
      unroundedTaxGrosze: unroundedTax,
    };
  });

  const totalUnroundedTax = sumGrosze(breakdownByRate.map((b) => b.unroundedTaxGrosze));
  const roundedRyczalt = roundTaxAmountOrdynacjaArt63(totalUnroundedTax);

  const ryczaltSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'ryczalt_advance',
    period: input.period,
    statutoryDueDate: ryczaltDueDate,
    accruedDueGrosze: roundedRyczalt.roundedGrosze,
    evaluationDate: cutOffDate,
    verifiedPayments: input.verifiedPayments,
  });

  const warnings: ExplanationWarning[] = [];
  if (isSimulationOnly) {
    warnings.push({
      code: 'SIMULATION_NOT_BINDING_FOR_DECLARATION',
      severity: 'requires_expert_review',
      message:
        'Symulacja ryczałtu na nieopłaconych składkach ZUS nie stanowi podstawy prawnej do pomniejszenia przychodu wg art. 11 u.z.p.d.',
    });
  }
  if (
    !isSimulationOnly &&
    (socialSettlement.remainingUnpaidGrosze > 0 || healthSettlement.remainingUnpaidGrosze > 0)
  ) {
    warnings.push({
      code: 'UNPAID_ZUS_EXCLUDED_FROM_RYCZALT_DEDUCTION',
      severity: 'info',
      message: `Nieopłacone do dnia ${cutOffDate} składki ZUS za ${input.period} (społeczne: ${formatPlnFromGrosze(socialSettlement.remainingUnpaidGrosze)}, zdrowotna: ${formatPlnFromGrosze(healthSettlement.remainingUnpaidGrosze)}) nie pomniejszyły przychodu ryczałtowego (art. 11 ust. 1 i 1a u.z.p.d.).`,
    });
  }

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Weryfikacja faktycznie opłaconych składek ZUS (art. 11 ust. 1 i 1a u.z.p.d.)',
      formula: 'availableDeduction = paidInTaxYearYtd - deductedInPriorMonths',
      inputs: {
        confirmedPaidSocialYtd,
        confirmedPaidHealthYtd,
        availableSocial,
        availableHealth50,
      },
      resultFormatted: `Społeczne: ${formatPlnFromGrosze(appliedSocial)} | 50% zdrowotnej: ${formatPlnFromGrosze(appliedHealth50)}`,
      resultGrosze: addGrosze(appliedSocial, appliedHealth50),
    },
    {
      stepNumber: 2,
      label: 'Obliczenie ryczałtu należnego wg koszyków stawek i zaokrąglenia art. 63 § 1 OP',
      formula: 'ryczaltDue = round_ordynacja(sum_i(round_ordynacja(base_i) * rate_i))',
      inputs: {
        bucketsCount: breakdownByRate.length,
        totalPositiveRevenue,
        totalUnroundedTax,
      },
      resultFormatted: formatPlnFromGrosze(roundedRyczalt.roundedGrosze),
      resultGrosze: roundedRyczalt.roundedGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'profile_b_ryczalt_due_vs_paid',
    summary: `${isSimulationOnly ? '[SYMULACJA] ' : ''}Ryczałt za ${input.period}: przychód ${formatPlnFromGrosze(totalPositiveRevenue)}, odliczono opłacone składki ${formatPlnFromGrosze(addGrosze(appliedSocial, appliedHealth50))}, ryczałt należny ${formatPlnFromGrosze(roundedRyczalt.roundedGrosze)}.`,
    eventDate,
    rules: [ratesRule, deductionRule, roundingRule],
    steps,
    inputs: {
      period: input.period,
      totalPositiveRevenue,
      confirmedPaidSocialYtd,
      confirmedPaidHealthYtd,
    },
    outputs: {
      appliedSocialDeductionGrosze: appliedSocial,
      appliedHealth50PctDeductionGrosze: appliedHealth50,
      ryczaltTaxAccruedDueGrosze: roundedRyczalt.roundedGrosze,
    },
    warnings,
  });

  return {
    profileCode: 'jdg_ryczalt',
    period: input.period,
    mode,
    isSimulationOnly,
    bindingForDeclaration: !isSimulationOnly,
    accruedZus,
    zusSettlements: {
      social: socialSettlement,
      health: healthSettlement,
      laborFund: laborSettlement,
    },
    confirmedPaidSocialZusAvailableGrosze: availableSocial,
    confirmedPaidHealth50PctAvailableGrosze: availableHealth50,
    appliedSocialDeductionGrosze: appliedSocial,
    appliedHealth50PctDeductionGrosze: appliedHealth50,
    carryForwardUnusedSocialDeductionGrosze: subtractGrosze(availableSocial, appliedSocial),
    carryForwardUnusedHealth50PctDeductionGrosze: subtractGrosze(
      availableHealth50,
      appliedHealth50,
    ),
    breakdownByRate,
    ryczaltTaxAccruedDueGrosze: roundedRyczalt.roundedGrosze,
    ryczaltSettlement,
    explanation,
  };
}

// ============================================================================
// 4. PROFIL C: Sp. z o.o. CIT (19% standard, 9% fail-closed + rozdział zysków kapitałowych + limit proporcjonalny roku != 12 mies.)
// ============================================================================

export class CitPreferentialEligibilityError extends Error {
  readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.name = 'CitPreferentialEligibilityError';
    this.reasonCode = reasonCode;
  }
}

export interface CitPreferentialEligibilityAttestation {
  /** Jawne oświadczenie o zweryfikowaniu statusu małego podatnika (art. 4a pkt 10 CIT). */
  readonly smallTaxpayerVerified: boolean;
  /** Przychód ze sprzedaży brutto (wraz z należnym VAT) za poprzedni rok podatkowy — OBOWIĄZKOWY gdy `isFirstTaxYearNewEntityVerified !== true`. */
  readonly priorYearGrossSalesGrosze?: number;
  /** Jawne oświadczenie, czy jest to pierwszy rok podatkowy nowo utworzonego podmiotu (art. 19 ust. 1 pkt 2 CIT). */
  readonly isFirstTaxYearNewEntityVerified: boolean;
  /** Jawna weryfikacja braku wyłączenia restrukturyzacyjnego z art. 19 ust. 1a–1c CIT (przekształcenie, podział, aport > 10 000 EUR). */
  readonly excludedRestructuringArt19Ust1aVerified: boolean;
  /** Jawna weryfikacja braku przynależności do PGK oraz wyłączeń z art. 19 ust. 1b CIT (fundacje rodzinne, podział). */
  readonly excludedTaxCapitalGroupOrSplitVerified: boolean;
}

export interface ProfileCCitMonthlyInput {
  readonly period: string;
  /** Początek roku podatkowego Sp. z o.o. (`YYYY-MM-DD`) — obowiązkowy przy ubieganiu się o 9% CIT (do wyznaczenia długości roku != 12 mies.). */
  readonly taxYearStartDate?: string;
  /** Koniec roku podatkowego Sp. z o.o. (`YYYY-MM-DD`). */
  readonly taxYearEndDate?: string;
  /**
   * Przychody podatkowe YTD z innych źródeł niż zyski kapitałowe (działalność operacyjna).
   */
  readonly operatingRevenuesYtdGrosze: number;
  readonly operatingTaxDeductibleCostsYtdGrosze: number;
  readonly operatingPriorYearsLossDeductionGrosze?: number;
  /**
   * Odrębne źródło przychodów: Zyski kapitałowe (art. 7b CIT) — ZAWSZE opodatkowane stawką 19% (art. 19 ust. 1 pkt 1 CIT).
   * Strata na jednym źródle nie pomniejsza dochodu z drugiego źródła (art. 7 ust. 5 CIT).
   */
  readonly capitalGainsRevenuesYtdGrosze?: number;
  readonly capitalGainsTaxDeductibleCostsYtdGrosze?: number;
  readonly capitalGainsPriorYearsLossDeductionGrosze?: number;
  /** Przychody netto bieżącego roku podatkowego (suma wszystkich źródeł bez VAT) do limitu 2 mln EUR z art. 19 ust. 1 pkt 2 CIT. */
  readonly currentTaxYearNetSalesTotalGrosze?: number;
  /** Czy podatnik wnioskuje o zastosowanie stawki preferencyjnej 9% CIT dla dochodów operacyjnych. Domyślnie `false` (stawka podstawowa 19%). */
  readonly requestPreferential9PctRate?: boolean;
  /** Jawne poświadczenie warunków 9% CIT — przy `requestPreferential9PctRate: true` brak kompletnego poświadczenia powoduje bezpieczną odmowę (`CitPreferentialEligibilityError`)! */
  readonly preferentialEligibility?: CitPreferentialEligibilityAttestation;
  /** Należne zaliczki CIT narastająco za poprzednie miesiące roku podatkowego. */
  readonly previousAdvancesAccruedDueYtdGrosze?: number;
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
  readonly evaluationDate?: string;
  readonly customRegistry?: readonly LegalRule[];
}

export interface ProfileCCitMonthlyResult {
  readonly profileCode: 'spzoo_pelne_ksiegi';
  readonly period: string;
  readonly taxYearMonths: number;
  readonly operatingAppliedRatePct: 9 | 19;
  readonly capitalGainsAppliedRatePct: 19;
  readonly priorYearSmallTaxpayerLimitGrossGrosze: number;
  readonly proportionalCurrentYearNetLimitGrosze: number;
  readonly operatingIncomeYtdGrosze: number;
  readonly operatingRoundedBaseGrosze: number;
  readonly operatingCumulativeCitGrosze: number;
  readonly capitalGainsIncomeYtdGrosze: number;
  readonly capitalGainsRoundedBaseGrosze: number;
  readonly capitalGainsCumulativeCitGrosze: number;
  readonly totalCumulativeCitGrosze: number;
  readonly citAdvanceAccruedDueGrosze: number;
  readonly citAdvanceSettlement: ObligationSettlementSnapshot;
  readonly cumulativeCitArrearsFromPriorMonthsGrosze: number;
  readonly explanation: LegalExplanation;
}

function countTaxYearFullMonths(startDate: string, endDate: string): number {
  assertValidIsoCalendarDate(startDate, 'taxYearStartDate');
  assertValidIsoCalendarDate(endDate, 'taxYearEndDate');
  if (endDate <= startDate) {
    throw new CitPreferentialEligibilityError(
      'invalid_cit_tax_year_bounds',
      `Data końca roku podatkowego CIT (${endDate}) musi być późniejsza niż początek roku (${startDate}).`,
    );
  }
  const [sy = 2026, sm = 1, sd = 1] = startDate.split('-').map(Number);
  const [ey = 2026, em = 12, ed = 31] = endDate.split('-').map(Number);
  const monthSpan = (ey - sy) * 12 + (em - sm) + (ed >= sd ? 1 : 0);
  if (monthSpan < 1 || monthSpan > 23) {
    throw new CitPreferentialEligibilityError(
      'invalid_cit_tax_year_length',
      `Nieprawidłowa długość roku podatkowego CIT (${String(monthSpan)} mies.) dla zakresu ${startDate}..${endDate}.`,
    );
  }
  return monthSpan;
}

/**
 * Zaokrągla kwotę w groszach do pełnych 1 000 zł (100 000 gr) zgodnie z art. 4a pkt 10 i art. 19 ust. 1 pkt 2 ustawy o CIT
 * (końcówki < 500 zł pomija się, końcówki >= 500 zł podwyższa się do pełnych tysięcy złotych).
 */
export function roundLimitToNearestThousandPlnGrosze(rawGrosze: number): number {
  assertNonNegativeGrosze(rawGrosze, 'rawGrosze');
  const unit = 100_000; // 1 000,00 zł w groszach
  const remainder = rawGrosze % unit;
  const base = rawGrosze - remainder;
  return remainder >= 50_000 ? base + unit : base;
}

/**
 * Deterministyczny kalkulator Profilu C (Sp. z o.o. — CIT klasyczny wg art. 7, art. 19 i art. 25 ustawy o CIT):
 * - domyślnie stosuje stawkę podstawową **19%**,
 * - stawkę **9%** dla przychodów innych niż z zysków kapitałowych dopuszcza **WYŁĄCZNIE** po jawnej weryfikacji wszystkich przesłanek ustawowych (fail-closed przy braku danych roku podatkowego lub statusu małego podatnika!),
 * - rozdziela koszyk zysków kapitałowych (zawsze 19%, zakaz kompensacji strat między źródłami wg art. 7 ust. 5 CIT),
 * - proporcjonalnie skaluje bieżący limit 2 000 000 EUR dla roku podatkowego krótszego lub dłuższego niż 12 miesięcy (#81),
 * - rozdziela zaliczki należne (`accrued/due`) od faktycznie wpłaconych (`paid`).
 */
export function calculateProfileCCitObligations(
  input: ProfileCCitMonthlyInput,
): ProfileCCitMonthlyResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres zaliczki CIT Profilu C: "${input.period}".`);
  }
  assertSafeGrosze(input.operatingRevenuesYtdGrosze, 'operatingRevenuesYtdGrosze');
  assertSafeGrosze(
    input.operatingTaxDeductibleCostsYtdGrosze,
    'operatingTaxDeductibleCostsYtdGrosze',
  );

  const capRev = assertSafeGrosze(
    input.capitalGainsRevenuesYtdGrosze ?? 0,
    'capitalGainsRevenuesYtdGrosze',
  );
  const capCost = assertSafeGrosze(
    input.capitalGainsTaxDeductibleCostsYtdGrosze ?? 0,
    'capitalGainsTaxDeductibleCostsYtdGrosze',
  );
  const opLoss = assertNonNegativeGrosze(
    input.operatingPriorYearsLossDeductionGrosze ?? 0,
    'operatingPriorYearsLossDeductionGrosze',
  );
  const capLoss = assertNonNegativeGrosze(
    input.capitalGainsPriorYearsLossDeductionGrosze ?? 0,
    'capitalGainsPriorYearsLossDeductionGrosze',
  );
  const prevAdvancesDue = assertNonNegativeGrosze(
    input.previousAdvancesAccruedDueYtdGrosze ?? 0,
    'previousAdvancesAccruedDueYtdGrosze',
  );

  for (const p of input.verifiedPayments) {
    validateVerifiedPaymentRecord(p);
  }

  const evaluationDate = input.evaluationDate ?? lastDayOfPeriodIso(input.period);
  assertValidIsoCalendarDate(evaluationDate, 'evaluationDate');

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

  const priorYearSmallLimitGross = getRequiredNumericParameter(
    smallTaxpayerRule,
    'limitGrossGrosze',
  );
  const januaryEurRateBps = getRequiredNumericParameter(citRule, 'januaryEurRateBps');
  const standard12MonthLimitNet = getRequiredNumericParameter(citRule, 'currentYearNetLimitGrosze');

  // Ustalenie długości roku podatkowego i proporcjonalnego limitu 2 mln EUR netto (art. 19 ust. 1 pkt 2 CIT)
  let taxYearMonths = 12;
  if (input.taxYearStartDate !== undefined || input.taxYearEndDate !== undefined) {
    if (!input.taxYearStartDate || !input.taxYearEndDate) {
      throw new CitPreferentialEligibilityError(
        'incomplete_cit_tax_year_dates',
        'Podanie zakresu roku podatkowego CIT wymaga jednoczesnego wskazania taxYearStartDate oraz taxYearEndDate.',
      );
    }
    taxYearMonths = countTaxYearFullMonths(input.taxYearStartDate, input.taxYearEndDate);
    const startPeriod = input.taxYearStartDate.slice(0, 7);
    const endPeriod = input.taxYearEndDate.slice(0, 7);
    if (input.period < startPeriod || input.period > endPeriod) {
      throw new CitPreferentialEligibilityError(
        'cit_period_outside_tax_year',
        `Okres zaliczki CIT (${input.period}) wykracza poza zadeklarowany rok podatkowy spółki (${input.taxYearStartDate}..${input.taxYearEndDate}).`,
      );
    }
  } else if (input.requestPreferential9PctRate === true) {
    throw new CitPreferentialEligibilityError(
      'missing_cit_tax_year_dates',
      'Zastosowanie preferencyjnej stawki 9% CIT wymaga jawnego podania granic roku podatkowego (taxYearStartDate i taxYearEndDate) w celu weryfikacji proporcji limitu 2 000 000 EUR.',
    );
  }

  // 2 000 000 EUR * kurs NBP w punktach bazowych (1 EUR = januaryEurRateBps / 10 000 PLN => w groszach: 2_000_000 * januaryEurRateBps / 100)
  const rawAnnual2mEurGrosze = 20_000 * januaryEurRateBps;
  const proportionalCurrentYearNetLimitGrosze =
    taxYearMonths === 12
      ? standard12MonthLimitNet
      : roundLimitToNearestThousandPlnGrosze(
          multiplyGroszeByRatio(rawAnnual2mEurGrosze, taxYearMonths, 12, 'half_up'),
        );

  const positiveTotalNetSales =
    input.currentTaxYearNetSalesTotalGrosze !== undefined
      ? assertNonNegativeGrosze(
          input.currentTaxYearNetSalesTotalGrosze,
          'currentTaxYearNetSalesTotalGrosze',
        )
      : Math.max(0, addGrosze(Math.max(0, input.operatingRevenuesYtdGrosze), Math.max(0, capRev)));

  const warnings: ExplanationWarning[] = [];
  let operatingAppliedRatePct: 9 | 19 = 19;

  if (input.requestPreferential9PctRate === true) {
    const elig = input.preferentialEligibility;
    if (!elig) {
      throw new CitPreferentialEligibilityError(
        'missing_cit_9pct_attestation',
        'Odmowa zastosowania stawki 9% CIT (fail-closed): brak wymaganego obiektu weryfikacji przesłanek preferentialEligibility.',
      );
    }
    if (!elig.smallTaxpayerVerified && !elig.isFirstTaxYearNewEntityVerified) {
      throw new CitPreferentialEligibilityError(
        'cit_9pct_not_small_or_new_taxpayer',
        'Odmowa zastosowania stawki 9% CIT: podatnik nie posiada zweryfikowanego statusu małego podatnika ani nie rozpoczyna działalności w pierwszym roku podatkowym.',
      );
    }
    if (!elig.isFirstTaxYearNewEntityVerified && elig.priorYearGrossSalesGrosze === undefined) {
      throw new CitPreferentialEligibilityError(
        'missing_prior_year_gross_sales_for_cit_9pct',
        'Odmowa zastosowania stawki 9% CIT (fail-closed): dla podmiotu kontynuującego działalność wymagane jest jawne podanie przychodu brutto ze sprzedaży za poprzedni rok podatkowy (priorYearGrossSalesGrosze).',
      );
    }

    let eligible = true;
    if (
      elig.excludedRestructuringArt19Ust1aVerified ||
      elig.excludedTaxCapitalGroupOrSplitVerified
    ) {
      eligible = false;
      warnings.push({
        code: 'CIT_9PCT_EXCLUDED_RESTRUCTURING_OR_PGK',
        severity: 'warning',
        message:
          'Wyłączenie ustawowe z art. 19 ust. 1a–1c ustawy o CIT (restrukturyzacja, przekształcenie, aport lub podział/PGK) — zastosowano stawkę podstawową 19% CIT.',
      });
    }
    if (
      eligible &&
      !elig.isFirstTaxYearNewEntityVerified &&
      elig.priorYearGrossSalesGrosze !== undefined
    ) {
      assertNonNegativeGrosze(elig.priorYearGrossSalesGrosze, 'priorYearGrossSalesGrosze');
      if (elig.priorYearGrossSalesGrosze > priorYearSmallLimitGross) {
        eligible = false;
        warnings.push({
          code: 'CIT_PRIOR_YEAR_2M_EUR_GROSS_EXCEEDED',
          severity: 'warning',
          message: `Przychód brutto ze sprzedaży za poprzedni rok podatkowy (${formatPlnFromGrosze(elig.priorYearGrossSalesGrosze)}) przekroczył limit małego podatnika (${formatPlnFromGrosze(priorYearSmallLimitGross)}) — zastosowano stawkę 19% CIT.`,
        });
      }
    }
    if (eligible && positiveTotalNetSales > proportionalCurrentYearNetLimitGrosze) {
      eligible = false;
      warnings.push({
        code: 'CIT_CURRENT_TAX_YEAR_LIMIT_EXCEEDED',
        severity: 'warning',
        message: `Przychody netto bieżącego roku podatkowego (${formatPlnFromGrosze(positiveTotalNetSales)}) przekroczyły limit 2 mln EUR dla ${String(taxYearMonths)}-miesięcznego roku podatkowego (${formatPlnFromGrosze(proportionalCurrentYearNetLimitGrosze)}) — utrata prawa do 9% CIT i przejście na 19% (art. 19 ust. 1 pkt 2 oraz art. 25 ust. 1g CIT).`,
      });
    }

    if (eligible) {
      operatingAppliedRatePct = 9;
    }
  }

  // Koszyk 1: Działalność operacyjna (inne źródła niż zyski kapitałowe)
  const rawOperatingDiff = subtractGrosze(
    input.operatingRevenuesYtdGrosze,
    input.operatingTaxDeductibleCostsYtdGrosze,
  );
  const operatingIncomeYtdGrosze = Math.max(0, rawOperatingDiff);
  const operatingAfterLoss = Math.max(0, subtractGrosze(operatingIncomeYtdGrosze, opLoss));
  const operatingRoundedBase = roundTaxAmountOrdynacjaArt63(operatingAfterLoss);
  const operatingRateBps =
    operatingAppliedRatePct === 9
      ? getRequiredNumericParameter(citRule, 'smallTaxpayerRateBps')
      : getRequiredNumericParameter(citRule, 'standardRateBps');
  const operatingCumulativeCitGrosze = multiplyGroszeByBps(
    operatingRoundedBase.roundedGrosze,
    operatingRateBps,
    'half_up',
  );

  // Koszyk 2: Zyski kapitałowe (art. 7b CIT) — ZAWSZE 19%, bez kompensacji ze stratą operacyjną!
  const rawCapDiff = subtractGrosze(capRev, capCost);
  const capitalGainsIncomeYtdGrosze = Math.max(0, rawCapDiff);
  const capAfterLoss = Math.max(0, subtractGrosze(capitalGainsIncomeYtdGrosze, capLoss));
  const capitalGainsRoundedBase = roundTaxAmountOrdynacjaArt63(capAfterLoss);
  const standardRateBps = getRequiredNumericParameter(citRule, 'standardRateBps');
  const capitalGainsCumulativeCitGrosze = multiplyGroszeByBps(
    capitalGainsRoundedBase.roundedGrosze,
    standardRateBps,
    'half_up',
  );

  if ((rawOperatingDiff < 0 && rawCapDiff > 0) || (rawCapDiff < 0 && rawOperatingDiff > 0)) {
    warnings.push({
      code: 'CIT_BASKET_LOSS_ISOLATION_ART_7_UST_5',
      severity: 'info',
      message:
        'Strata poniesiona w jednym źródle przychodów CIT (operacyjne vs zyski kapitałowe art. 7b) nie pomniejsza dochodu z drugiego źródła (art. 7 ust. 1–2 i ust. 5 ustawy o CIT).',
    });
  }

  const totalCumulativeCitGrosze = addGrosze(
    operatingCumulativeCitGrosze,
    capitalGainsCumulativeCitGrosze,
  );
  const advanceBeforeRounding = Math.max(
    0,
    subtractGrosze(totalCumulativeCitGrosze, prevAdvancesDue),
  );
  const roundedCitAdvance = roundTaxAmountOrdynacjaArt63(advanceBeforeRounding);

  const citDueDate = nextMonthDueDateIso(input.period, 20);
  const citSettlement = buildObligationSettlementSnapshot({
    obligationKind: 'cit_advance',
    period: input.period,
    statutoryDueDate: citDueDate,
    accruedDueGrosze: roundedCitAdvance.roundedGrosze,
    evaluationDate,
    verifiedPayments: input.verifiedPayments,
  });

  const taxYearStartPeriod = input.taxYearStartDate
    ? input.taxYearStartDate.slice(0, 7)
    : `${input.period.slice(0, 4)}-01`;
  const prevAdvancesPaidYtd = sumGrosze(
    input.verifiedPayments
      .filter(
        (p) =>
          p.obligationKind === 'cit_advance' &&
          p.targetPeriod >= taxYearStartPeriod &&
          p.targetPeriod < input.period &&
          p.paidDate <= evaluationDate,
      )
      .map((p) => p.amountGrosze),
  );
  const priorCitArrears = Math.max(0, subtractGrosze(prevAdvancesDue, prevAdvancesPaidYtd));

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: `Weryfikacja limitu bieżącego 2 mln EUR netto dla ${String(taxYearMonths)}-miesięcznego roku podatkowego i stawki operacyjnej (${String(operatingAppliedRatePct)}%)`,
      formula:
        'proportionalLimit = round_1000pln(2_000_000 EUR * kurs_NBP_styczeń * taxYearMonths / 12)',
      inputs: {
        taxYearMonths,
        proportionalCurrentYearNetLimitGrosze,
        positiveTotalNetSales,
        operatingAppliedRatePct,
      },
      resultFormatted: `Limit bieżący: ${formatPlnFromGrosze(proportionalCurrentYearNetLimitGrosze)} | Stawka operacyjna: ${String(operatingAppliedRatePct)}%`,
      resultGrosze: proportionalCurrentYearNetLimitGrosze,
    },
    {
      stepNumber: 2,
      label:
        'Obliczenie podatku CIT w koszyku operacyjnym (inne źródła) oraz koszyku zysków kapitałowych (19%, art. 7b CIT)',
      formula:
        'totalCit = round_ordynacja(opIncome) * opRate + round_ordynacja(capGainsIncome) * 19%',
      inputs: {
        operatingRoundedBaseGrosze: operatingRoundedBase.roundedGrosze,
        operatingCumulativeCitGrosze,
        capitalGainsRoundedBaseGrosze: capitalGainsRoundedBase.roundedGrosze,
        capitalGainsCumulativeCitGrosze,
      },
      resultFormatted: `Operacyjny: ${formatPlnFromGrosze(operatingCumulativeCitGrosze)} + Kapitałowy (19%): ${formatPlnFromGrosze(capitalGainsCumulativeCitGrosze)}`,
      resultGrosze: totalCumulativeCitGrosze,
    },
    {
      stepNumber: 3,
      label: 'Wyliczenie zaliczki należnej CIT za okres oraz kontrola wpłat',
      formula: 'advanceDue = round_ordynacja(max(0, totalCumulativeCit - previousAdvancesDue))',
      inputs: {
        totalCumulativeCitGrosze,
        previousAdvancesAccruedDueYtdGrosze: prevAdvancesDue,
        confirmedPaidForPeriodGrosze: citSettlement.confirmedPaidGrosze,
      },
      resultFormatted: formatPlnFromGrosze(roundedCitAdvance.roundedGrosze),
      resultGrosze: roundedCitAdvance.roundedGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'profile_c_cit_baskets_and_due_vs_paid',
    summary: `Zaliczka CIT za ${input.period} (operacyjny ${String(operatingAppliedRatePct)}%, zyski kapitałowe 19%, rok ${String(taxYearMonths)} mies.): należna ${formatPlnFromGrosze(roundedCitAdvance.roundedGrosze)}, wpłacona ${formatPlnFromGrosze(citSettlement.confirmedPaidGrosze)}.`,
    eventDate,
    rules: [citRule, smallTaxpayerRule, roundingRule],
    steps,
    inputs: {
      period: input.period,
      taxYearMonths,
      operatingRevenuesYtdGrosze: input.operatingRevenuesYtdGrosze,
      operatingTaxDeductibleCostsYtdGrosze: input.operatingTaxDeductibleCostsYtdGrosze,
      capitalGainsRevenuesYtdGrosze: capRev,
      capitalGainsTaxDeductibleCostsYtdGrosze: capCost,
    },
    outputs: {
      operatingAppliedRatePct,
      proportionalCurrentYearNetLimitGrosze,
      operatingCumulativeCitGrosze,
      capitalGainsCumulativeCitGrosze,
      citAdvanceAccruedDueGrosze: roundedCitAdvance.roundedGrosze,
    },
    warnings,
  });

  return {
    profileCode: 'spzoo_pelne_ksiegi',
    period: input.period,
    taxYearMonths,
    operatingAppliedRatePct,
    capitalGainsAppliedRatePct: 19,
    priorYearSmallTaxpayerLimitGrossGrosze: priorYearSmallLimitGross,
    proportionalCurrentYearNetLimitGrosze,
    operatingIncomeYtdGrosze,
    operatingRoundedBaseGrosze: operatingRoundedBase.roundedGrosze,
    operatingCumulativeCitGrosze,
    capitalGainsIncomeYtdGrosze,
    capitalGainsRoundedBaseGrosze: capitalGainsRoundedBase.roundedGrosze,
    capitalGainsCumulativeCitGrosze,
    totalCumulativeCitGrosze,
    citAdvanceAccruedDueGrosze: roundedCitAdvance.roundedGrosze,
    citAdvanceSettlement: citSettlement,
    cumulativeCitArrearsFromPriorMonthsGrosze: priorCitArrears,
    explanation,
  };
}
