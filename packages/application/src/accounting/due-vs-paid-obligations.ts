import type {
  CitPreferentialAttestationContract,
  TaxProfileConfigContract,
} from '@pap/contracts/accounting';
import {
  CitPreferentialEligibilityError,
  buildObligationSettlementSnapshot,
  calculateProfileAKpirObligations,
  calculateProfileBRyczaltObligations,
  calculateProfileCCitObligations,
  formatPlnFromGrosze,
  generateProfitAndLoss,
  shiftTaxDeadlineToBusinessDay,
  summarizeKpirPeriod,
  validateVerifiedPaymentRecord,
  type JpkV7mDeclarationSummary,
  type JournalEntry,
  type KpirEntry,
  type LegalExplanation,
  type ObligationLifecycleStatus,
  type ObligationSettlementSnapshot,
  type PublicLawObligationKind,
  type RyczaltEntry,
  type VerifiedTaxOrZusPayment,
} from '@pap/domain';
import { AccountingWorkspaceValidationError } from './errors.js';

function previousMonthPeriod(period: string): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${String(month - 1).padStart(2, '0')}`;
}

function nextMonthDueDateIso(period: string, dueDay: number): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  let year = Number(yStr);
  let month = Number(mStr) + 1;
  if (month > 12) {
    month = 1;
    year += 1;
  }
  const rawIso = `${year}-${String(month).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
  return shiftTaxDeadlineToBusinessDay(rawIso).effectiveDueDate;
}

function lastDayOfPeriodIso(period: string): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

export interface TaxObligationSettlementItem {
  readonly obligationKind: PublicLawObligationKind;
  readonly labelPl: string;
  readonly period: string;
  readonly statutoryDueDate: string;
  readonly accruedGrosze: number;
  readonly accruedFormatted: string;
  readonly paidGrosze: number;
  readonly paidFormatted: string;
  readonly remainingGrosze: number;
  readonly remainingFormatted: string;
  readonly overpaymentGrosze: number;
  readonly status: ObligationLifecycleStatus;
  readonly appliedPaymentIds: readonly string[];
}

export interface ComputedCompanyPeriodObligations {
  readonly period: string;
  readonly profileCode: TaxProfileConfigContract['profileCode'];
  readonly evaluationDate: string;
  readonly bindingForDeclaration: boolean;
  readonly items: readonly TaxObligationSettlementItem[];
  readonly totals: {
    readonly totalAccruedGrosze: number;
    readonly totalAccruedFormatted: string;
    readonly totalPaidGrosze: number;
    readonly totalPaidFormatted: string;
    readonly totalRemainingGrosze: number;
    readonly totalRemainingFormatted: string;
  };
  readonly incomeTaxAccruedGrosze: number;
  readonly zusTotalAccruedGrosze: number;
  readonly paidSocialZusUsedInTaxBaseGrosze: number;
  readonly paidHealthZusUsedInTaxBaseGrosze: number;
  readonly citRateDetails: {
    readonly operatingAppliedRatePct: 9 | 19;
    readonly capitalGainsAppliedRatePct: 19;
    readonly taxYearMonths: number;
    readonly operatingIncomeYtdGrosze: number;
  } | null;
  readonly explanation: LegalExplanation;
}

function toSettlementItem(
  snap: ObligationSettlementSnapshot,
  labelPl: string,
): TaxObligationSettlementItem {
  return {
    obligationKind: snap.obligationKind,
    labelPl,
    period: snap.period,
    statutoryDueDate: snap.statutoryDueDate,
    accruedGrosze: snap.accruedDueGrosze,
    accruedFormatted: formatPlnFromGrosze(snap.accruedDueGrosze),
    paidGrosze: snap.confirmedPaidGrosze,
    paidFormatted: formatPlnFromGrosze(snap.confirmedPaidGrosze),
    remainingGrosze: snap.remainingUnpaidGrosze,
    remainingFormatted: formatPlnFromGrosze(snap.remainingUnpaidGrosze),
    overpaymentGrosze: snap.overpaymentGrosze,
    status: snap.status,
    appliedPaymentIds: [...snap.appliedPaymentIds],
  };
}

function resolveSettlementEvalDate(
  period: string,
  todayIso: string,
  verifiedPayments: readonly VerifiedTaxOrZusPayment[],
): string {
  let maxDate = lastDayOfPeriodIso(period) > todayIso ? lastDayOfPeriodIso(period) : todayIso;
  for (const p of verifiedPayments) {
    if (p.targetPeriod === period && p.paidDate > maxDate) {
      maxDate = p.paidDate;
    }
  }
  return maxDate;
}

/**
 * Wylicza kompletne rozrachunki publicznoprawne (`naliczone` vs `opłacone`) dla wybranego okresu (#81, GLD-06, GLD-07):
 * - JDG KPiR (Skala / Liniowy): odlicza wyłącznie zweryfikowany opłacony ZUS,
 * - JDG Ryczałt: odlicza wyłącznie opłacony ZUS społeczny i 50% opłaconej zdrowotnej z przeniesieniem nadwyżki,
 * - Sp. z o.o. (CIT): domyślnie stosuje 19% CIT, a stawkę 9% wyłącznie przy kompletnym poświadczeniu przesłanek (fail-closed 422),
 * - VAT czynny: uwzględnia należny P_51 (po przeniesieniu P_39/P_62) oraz wpłaty na podatek VAT.
 */
export function computeCompanyPeriodTaxObligations(params: {
  readonly period: string;
  readonly todayIso: string;
  readonly taxProfile: TaxProfileConfigContract;
  readonly kpirEntries: readonly KpirEntry[];
  readonly ryczaltEntries: readonly RyczaltEntry[];
  readonly journalEntries: readonly JournalEntry[];
  readonly ytdCitNkupGrosze: number;
  readonly resolveYtdCitNkupGrosze?: ((targetPeriod: string) => number) | undefined;
  readonly vatJpk: JpkV7mDeclarationSummary | null;
  readonly verifiedPayments: readonly VerifiedTaxOrZusPayment[];
  readonly requestPreferentialCit9Pct?: boolean | undefined;
  readonly citPreferentialAttestationOverride?: CitPreferentialAttestationContract | undefined;
}): ComputedCompanyPeriodObligations {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(params.period)) {
    throw new AccountingWorkspaceValidationError(
      400,
      'invalid_period',
      `Nieprawidłowy okres zobowiązań podatkowych "${params.period}" (wymagany YYYY-MM).`,
    );
  }

  for (const p of params.verifiedPayments) {
    validateVerifiedPaymentRecord(p);
  }

  const evalDate = resolveSettlementEvalDate(
    params.period,
    params.todayIso,
    params.verifiedPayments,
  );
  const yearPrefix = params.period.slice(0, 4);
  const monthNum = Number(params.period.slice(5, 7));
  const items: TaxObligationSettlementItem[] = [];

  let incomeTaxAccruedGrosze: number;
  let zusTotalAccruedGrosze = 0;
  let paidSocialUsed = 0;
  let paidHealthUsed = 0;
  let citRateDetails: ComputedCompanyPeriodObligations['citRateDetails'] = null;
  let primaryExplanation: LegalExplanation;

  if (
    params.taxProfile.profileCode === 'jdg_kpir_skala' ||
    params.taxProfile.profileCode === 'jdg_kpir_liniowy'
  ) {
    const taxForm: 'skala' | 'liniowy' =
      params.taxProfile.profileCode === 'jdg_kpir_liniowy' ? 'liniowy' : 'skala';
    const zusScheme =
      params.taxProfile.zusScheme === 'not_applicable' ? 'duzy_zus' : params.taxProfile.zusScheme;

    let priorPitAccruedYtd = 0;
    for (let m = 1; m < monthNum; m += 1) {
      const priorPeriod = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorPrevMonth = previousMonthPeriod(priorPeriod);
      const priorPrevInc = summarizeKpirPeriod(params.kpirEntries, priorPrevMonth).monthTotals
        .accountingIncomeGrosze;
      const priorSum = summarizeKpirPeriod(params.kpirEntries, priorPeriod);
      const priorCalc = calculateProfileAKpirObligations({
        period: priorPeriod,
        taxForm,
        zusScheme,
        voluntarySicknessInsurance: params.taxProfile.voluntarySicknessInsurance,
        previousMonthIncomeForHealthGrosze: priorPrevInc,
        ytdRevenueGrosze: priorSum.yearToDateTotals.col9TotalRevenueGrosze,
        ytdCostsGrosze: priorSum.yearToDateTotals.totalTaxDeductibleCostsGrosze,
        previousAdvancesAccruedDueYtdGrosze: priorPitAccruedYtd,
        verifiedPayments: params.verifiedPayments,
      });
      priorPitAccruedYtd += priorCalc.pitAdvanceAccruedDueGrosze;
    }

    const prevInc = summarizeKpirPeriod(params.kpirEntries, previousMonthPeriod(params.period))
      .monthTotals.accountingIncomeGrosze;
    const sum = summarizeKpirPeriod(params.kpirEntries, params.period);
    const kpirRes = calculateProfileAKpirObligations({
      period: params.period,
      taxForm,
      zusScheme,
      voluntarySicknessInsurance: params.taxProfile.voluntarySicknessInsurance,
      previousMonthIncomeForHealthGrosze: prevInc,
      ytdRevenueGrosze: sum.yearToDateTotals.col9TotalRevenueGrosze,
      ytdCostsGrosze: sum.yearToDateTotals.totalTaxDeductibleCostsGrosze,
      previousAdvancesAccruedDueYtdGrosze: priorPitAccruedYtd,
      verifiedPayments: params.verifiedPayments,
    });

    const zusDue = nextMonthDueDateIso(params.period, 20);
    const pitDue = nextMonthDueDateIso(params.period, 20);
    items.push(
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_social',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: kpirRes.accruedZus.socialContributionsTotalGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Składki ZUS społeczne przedsiębiorcy',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_health',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: kpirRes.accruedZus.healthContributionGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Składka zdrowotna ZUS przedsiębiorcy',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_labor_fund',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: kpirRes.accruedZus.laborAndSolidarityFundGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Fundusz Pracy i Fundusz Solidarnościowy',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'pit_advance',
          period: params.period,
          statutoryDueDate: pitDue,
          accruedDueGrosze: kpirRes.pitAdvanceAccruedDueGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        taxForm === 'liniowy' ? 'Zaliczka PIT-36L (19%)' : 'Zaliczka PIT-36 (skala 12%/32%)',
      ),
    );

    incomeTaxAccruedGrosze = kpirRes.pitAdvanceAccruedDueGrosze;
    zusTotalAccruedGrosze = kpirRes.accruedZus.totalZusToPayGrosze;
    paidSocialUsed = kpirRes.confirmedPaidSocialZusInTaxYearYtdGrosze;
    paidHealthUsed = kpirRes.confirmedPaidHealthInTaxYearYtdGrosze;
    primaryExplanation = kpirRes.explanation;
  } else if (params.taxProfile.profileCode === 'jdg_ryczalt') {
    const zusScheme =
      params.taxProfile.zusScheme === 'not_applicable'
        ? 'preferencyjny_zus'
        : params.taxProfile.zusScheme;

    let socialUsedPriorYtd = 0;
    let health50UsedPriorYtd = 0;
    for (let m = 1; m < monthNum; m += 1) {
      const priorPeriod = `${yearPrefix}-${String(m).padStart(2, '0')}`;
      const priorRes = calculateProfileBRyczaltObligations({
        period: priorPeriod,
        zusScheme,
        voluntarySicknessInsurance: params.taxProfile.voluntarySicknessInsurance,
        entries: params.ryczaltEntries,
        verifiedPayments: params.verifiedPayments,
        socialZusAlreadyDeductedPriorMonthsYtdGrosze: socialUsedPriorYtd,
        health50PctAlreadyDeductedPriorMonthsYtdGrosze: health50UsedPriorYtd,
      });
      socialUsedPriorYtd += priorRes.appliedSocialDeductionGrosze;
      health50UsedPriorYtd += priorRes.appliedHealth50PctDeductionGrosze;
    }

    const ryczRes = calculateProfileBRyczaltObligations({
      period: params.period,
      zusScheme,
      voluntarySicknessInsurance: params.taxProfile.voluntarySicknessInsurance,
      entries: params.ryczaltEntries,
      verifiedPayments: params.verifiedPayments,
      socialZusAlreadyDeductedPriorMonthsYtdGrosze: socialUsedPriorYtd,
      health50PctAlreadyDeductedPriorMonthsYtdGrosze: health50UsedPriorYtd,
    });

    const zusDue = nextMonthDueDateIso(params.period, 20);
    const ryczDue = nextMonthDueDateIso(params.period, 20);
    items.push(
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_social',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: ryczRes.accruedZus.socialContributionsTotalGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Składki ZUS społeczne przedsiębiorcy',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_health',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: ryczRes.accruedZus.healthContributionGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Składka zdrowotna ZUS (ryczałt)',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'zus_labor_fund',
          period: params.period,
          statutoryDueDate: zusDue,
          accruedDueGrosze: ryczRes.accruedZus.laborAndSolidarityFundGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Fundusz Pracy i Fundusz Solidarnościowy',
      ),
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'ryczalt_advance',
          period: params.period,
          statutoryDueDate: ryczDue,
          accruedDueGrosze: ryczRes.ryczaltTaxAccruedDueGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Ryczałt od przychodów ewidencjonowanych (PIT-28)',
      ),
    );

    incomeTaxAccruedGrosze = ryczRes.ryczaltTaxAccruedDueGrosze;
    zusTotalAccruedGrosze = ryczRes.accruedZus.totalZusToPayGrosze;
    paidSocialUsed = ryczRes.appliedSocialDeductionGrosze;
    paidHealthUsed = ryczRes.appliedHealth50PctDeductionGrosze;
    primaryExplanation = ryczRes.explanation;
  } else {
    // spzoo_pelne_ksiegi — CIT 19% domyślnie, 9% wyłącznie przy poświadczonych przesłankach (fail-closed)
    const attestation =
      params.citPreferentialAttestationOverride ?? params.taxProfile.citPreferentialAttestation;
    const request9Pct =
      params.requestPreferentialCit9Pct !== undefined
        ? params.requestPreferentialCit9Pct
        : Boolean(attestation);

    const taxYearStart = attestation?.taxYearStartDate;
    const taxYearEnd = attestation?.taxYearEndDate;
    const startPeriod = taxYearStart ? taxYearStart.slice(0, 7) : `${yearPrefix}-01`;

    const domainAttestation = attestation
      ? {
          smallTaxpayerVerified: attestation.smallTaxpayerVerified,
          ...(attestation.priorYearGrossSalesGrosze !== undefined
            ? { priorYearGrossSalesGrosze: attestation.priorYearGrossSalesGrosze }
            : {}),
          isFirstTaxYearNewEntityVerified: attestation.isFirstTaxYearNewEntityVerified,
          excludedRestructuringArt19Ust1aVerified:
            attestation.excludedRestructuringArt19Ust1aVerified,
          excludedTaxCapitalGroupOrSplitVerified:
            attestation.excludedTaxCapitalGroupOrSplitVerified,
        }
      : undefined;

    const computeCitForPeriod = (targetPeriod: string, prevAdvancesDue: number) => {
      const entriesInYearUpTo = params.journalEntries.filter(
        (je) => je.period >= startPeriod && je.period <= targetPeriod,
      );
      const pnl = generateProfitAndLoss(entriesInYearUpTo);
      const nkup = params.resolveYtdCitNkupGrosze
        ? params.resolveYtdCitNkupGrosze(targetPeriod)
        : targetPeriod === params.period
          ? params.ytdCitNkupGrosze
          : 0;
      const kupCosts = Math.max(0, pnl.totalOperatingAndFinancialExpensesGrosze - nkup);
      try {
        return calculateProfileCCitObligations({
          period: targetPeriod,
          ...(taxYearStart ? { taxYearStartDate: taxYearStart } : {}),
          ...(taxYearEnd ? { taxYearEndDate: taxYearEnd } : {}),
          operatingRevenuesYtdGrosze: pnl.totalRevenuesGrosze,
          operatingTaxDeductibleCostsYtdGrosze: kupCosts,
          requestPreferential9PctRate: request9Pct,
          ...(domainAttestation ? { preferentialEligibility: domainAttestation } : {}),
          previousAdvancesAccruedDueYtdGrosze: prevAdvancesDue,
          verifiedPayments: params.verifiedPayments,
          evaluationDate: evalDate,
        });
      } catch (err) {
        if (err instanceof CitPreferentialEligibilityError) {
          throw new AccountingWorkspaceValidationError(422, err.reasonCode, err.message);
        }
        throw err;
      }
    };

    let priorCitAccruedDue = 0;
    const distinctPriorPeriods = Array.from(
      new Set(
        params.journalEntries
          .map((je) => je.period)
          .filter((p) => p >= startPeriod && p < params.period),
      ),
    ).sort();
    for (const priorP of distinctPriorPeriods) {
      const priorCit = computeCitForPeriod(priorP, priorCitAccruedDue);
      priorCitAccruedDue += priorCit.citAdvanceAccruedDueGrosze;
    }

    const citRes = computeCitForPeriod(params.period, priorCitAccruedDue);
    const citDue = nextMonthDueDateIso(params.period, 20);
    items.push(
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'cit_advance',
          period: params.period,
          statutoryDueDate: citDue,
          accruedDueGrosze: citRes.citAdvanceAccruedDueGrosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        `Zaliczka CIT-8 (${citRes.operatingAppliedRatePct}%)`,
      ),
    );

    incomeTaxAccruedGrosze = citRes.citAdvanceAccruedDueGrosze;
    citRateDetails = {
      operatingAppliedRatePct: citRes.operatingAppliedRatePct,
      capitalGainsAppliedRatePct: citRes.capitalGainsAppliedRatePct,
      taxYearMonths: citRes.taxYearMonths,
      operatingIncomeYtdGrosze: citRes.operatingIncomeYtdGrosze,
    };
    primaryExplanation = citRes.explanation;
  }

  if (params.taxProfile.vatStatus === 'czynny' && params.vatJpk) {
    const vatDue = nextMonthDueDateIso(params.period, 25);
    items.push(
      toSettlementItem(
        buildObligationSettlementSnapshot({
          obligationKind: 'vat_settlement',
          period: params.period,
          statutoryDueDate: vatDue,
          accruedDueGrosze: params.vatJpk.taxDueToPayP51Grosze,
          evaluationDate: evalDate,
          verifiedPayments: params.verifiedPayments,
        }),
        'Podatek VAT do zapłaty (JPK_V7M P_51)',
      ),
    );
  }

  const totalAccruedGrosze = items.reduce((s, i) => s + i.accruedGrosze, 0);
  const totalPaidGrosze = items.reduce((s, i) => s + i.paidGrosze, 0);
  const totalRemainingGrosze = items.reduce((s, i) => s + i.remainingGrosze, 0);

  return {
    period: params.period,
    profileCode: params.taxProfile.profileCode,
    evaluationDate: evalDate,
    bindingForDeclaration: true,
    items,
    totals: {
      totalAccruedGrosze,
      totalAccruedFormatted: formatPlnFromGrosze(totalAccruedGrosze),
      totalPaidGrosze,
      totalPaidFormatted: formatPlnFromGrosze(totalPaidGrosze),
      totalRemainingGrosze,
      totalRemainingFormatted: formatPlnFromGrosze(totalRemainingGrosze),
    },
    incomeTaxAccruedGrosze,
    zusTotalAccruedGrosze,
    paidSocialZusUsedInTaxBaseGrosze: paidSocialUsed,
    paidHealthZusUsedInTaxBaseGrosze: paidHealthUsed,
    citRateDetails,
    explanation: primaryExplanation,
  };
}
