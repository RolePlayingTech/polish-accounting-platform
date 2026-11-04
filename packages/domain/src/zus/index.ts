import {
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
  sumGrosze,
} from '../money.js';

export type ZusScheme = 'ulga_na_start' | 'preferencyjny_zus' | 'duzy_zus';
export type HealthTaxForm = 'skala' | 'liniowy' | 'ryczalt';

export interface CalculateMonthlyZusInput {
  readonly period: string;
  readonly zusScheme: ZusScheme;
  readonly taxForm: HealthTaxForm;
  readonly voluntarySicknessInsurance: boolean;
  /** Dla skali i liniowego: dochód z działalności z miesiąca poprzedzającego okres składkowy (może być <= 0 przy stracie). */
  readonly previousMonthIncomeGrosze?: number;
  /** Dla ryczałtu: przychód narastająco od początku roku kalendarzowego (pomniejszony o zapłacone składki społeczne). */
  readonly ytdRyczaltRevenueGrosze?: number;
  /** Opcjonalna zadeklarowana wyższa podstawa wymiaru składek społecznych ZUS. */
  readonly declaredHigherSocialBaseGrosze?: number;
  /** Liczba ubezpieczonych zgłaszanych do ubezpieczenia wypadkowego (domyślnie 1 dla JDG). */
  readonly insuredPersonsCount?: number;
  /** Indywidualna stopa wypadkowa w punktach bazowych (np. 167 = 1,67%). */
  readonly customAccidentRateBps?: number;
  /** Zwolnienie wiekowe z FP/FS (kobiety >= 55 lat, mężczyźni >= 60 lat). */
  readonly exemptFromLaborFundByAge?: boolean;
  readonly customRegistry?: readonly LegalRule[];
}

export interface MonthlyZusContributionsResult {
  readonly period: string;
  readonly zusScheme: ZusScheme;
  readonly taxForm: HealthTaxForm;
  readonly socialContributionBaseGrosze: number;
  readonly pensionContributionGrosze: number;
  readonly disabilityContributionGrosze: number;
  readonly sicknessContributionGrosze: number;
  readonly accidentContributionGrosze: number;
  readonly accidentRateBps: number;
  readonly socialContributionsTotalGrosze: number;
  readonly laborAndSolidarityFundGrosze: number;
  readonly healthContributionBaseGrosze: number;
  readonly healthContributionGrosze: number;
  readonly ryczaltHealthTier?: 1 | 2 | 3;
  readonly totalZusToPayGrosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Oblicza miesięczne składki społeczne ZUS, Fundusz Pracy / Solidarnościowy oraz składkę zdrowotną
 * dla przedsiębiorcy JDG w danym okresie `YYYY-MM` (2025–2026) wraz z pełnym wyjaśnieniem podstawy prawnej.
 */
export function calculateMonthlyZusContributions(
  input: CalculateMonthlyZusInput,
): MonthlyZusContributionsResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) {
    throw new Error(`Nieprawidłowy okres ZUS: "${input.period}" (wymagany format YYYY-MM)`);
  }

  const eventDate = `${input.period}-01`;
  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;

  const ratesRule = resolveRuleAtDate('ZUS_SOCIAL_RATES_ART_22', eventDate, ruleOptions);
  const draDeadlineRule = resolveRuleAtDate('ZUS_DRA_DEADLINE_ART_47', eventDate, ruleOptions);
  const appliedRules: LegalRule[] = [ratesRule, draDeadlineRule];
  const warnings: ExplanationWarning[] = [];

  const pensionRateBps = getRequiredNumericParameter(ratesRule, 'pensionRateBps');
  const disabilityRateBps = getRequiredNumericParameter(ratesRule, 'disabilityRateBps');
  const sicknessRateBps = getRequiredNumericParameter(ratesRule, 'sicknessRateBps');
  const defaultAccidentRateBps = getRequiredNumericParameter(ratesRule, 'defaultAccidentRateBps');
  const laborFundRateBps = getRequiredNumericParameter(ratesRule, 'laborAndSolidarityFundRateBps');

  const insuredCount = input.insuredPersonsCount ?? 1;
  const accidentRateBps = input.customAccidentRateBps ?? defaultAccidentRateBps;

  if (insuredCount >= 10 || accidentRateBps !== defaultAccidentRateBps) {
    const iwaRule = resolveRuleAtDate('ZUS_INDIVIDUAL_ACCIDENT_RATE_IWA', eventDate, ruleOptions);
    appliedRules.push(iwaRule);
  }

  let minimumSocialBaseGrosze: number;
  let minimumWageForLaborFundGrosze = 0;

  if (input.zusScheme === 'ulga_na_start') {
    const ulgaRule = resolveRuleAtDate('ZUS_ULGA_NA_START_ART_18_PP', eventDate, ruleOptions);
    appliedRules.push(ulgaRule);
    minimumSocialBaseGrosze = 0;
  } else if (input.zusScheme === 'preferencyjny_zus') {
    const prefRule = resolveRuleAtDate('ZUS_PREFERENCYJNY_ART_18A', eventDate, ruleOptions);
    appliedRules.push(prefRule);
    minimumSocialBaseGrosze = getRequiredNumericParameter(prefRule, 'socialBaseGrosze');
    minimumWageForLaborFundGrosze = getRequiredNumericParameter(prefRule, 'minimumWageGrosze');
  } else {
    const duzyRule = resolveRuleAtDate('ZUS_DUZY_ART_18_UST_8', eventDate, ruleOptions);
    appliedRules.push(duzyRule);
    minimumSocialBaseGrosze = getRequiredNumericParameter(duzyRule, 'socialBaseGrosze');
    minimumWageForLaborFundGrosze = getRequiredNumericParameter(duzyRule, 'minimumWageGrosze');
  }

  let socialContributionBaseGrosze = minimumSocialBaseGrosze;
  if (input.zusScheme !== 'ulga_na_start' && input.declaredHigherSocialBaseGrosze !== undefined) {
    assertNonNegativeGrosze(input.declaredHigherSocialBaseGrosze, 'declaredHigherSocialBaseGrosze');
    if (input.declaredHigherSocialBaseGrosze < minimumSocialBaseGrosze) {
      throw new Error(
        `Zadeklarowana podstawa wymiaru ZUS (${formatPlnFromGrosze(input.declaredHigherSocialBaseGrosze)}) nie może być niższa od minimum ustawowego (${formatPlnFromGrosze(minimumSocialBaseGrosze)}).`,
      );
    }
    socialContributionBaseGrosze = input.declaredHigherSocialBaseGrosze;
  }

  const pensionContributionGrosze = multiplyGroszeByBps(
    socialContributionBaseGrosze,
    pensionRateBps,
    'half_up',
  );
  const disabilityContributionGrosze = multiplyGroszeByBps(
    socialContributionBaseGrosze,
    disabilityRateBps,
    'half_up',
  );
  const sicknessContributionGrosze =
    input.zusScheme !== 'ulga_na_start' && input.voluntarySicknessInsurance
      ? multiplyGroszeByBps(socialContributionBaseGrosze, sicknessRateBps, 'half_up')
      : 0;
  const accidentContributionGrosze =
    input.zusScheme !== 'ulga_na_start'
      ? multiplyGroszeByBps(socialContributionBaseGrosze, accidentRateBps, 'half_up')
      : 0;

  const socialContributionsTotalGrosze = sumGrosze([
    pensionContributionGrosze,
    disabilityContributionGrosze,
    sicknessContributionGrosze,
    accidentContributionGrosze,
  ]);

  const laborFundApplicable =
    input.zusScheme !== 'ulga_na_start' &&
    input.exemptFromLaborFundByAge !== true &&
    minimumWageForLaborFundGrosze > 0 &&
    socialContributionBaseGrosze >= minimumWageForLaborFundGrosze;

  const laborAndSolidarityFundGrosze = laborFundApplicable
    ? multiplyGroszeByBps(socialContributionBaseGrosze, laborFundRateBps, 'half_up')
    : 0;

  // Składka zdrowotna
  let healthContributionBaseGrosze: number;
  let healthContributionGrosze: number;
  let ryczaltHealthTier: 1 | 2 | 3 | undefined;

  if (input.taxForm === 'ryczalt') {
    const ryczaltHealthRule = resolveRuleAtDate(
      'ZUS_HEALTH_RYCZALT_ART_81_UST_2E',
      eventDate,
      ruleOptions,
    );
    appliedRules.push(ryczaltHealthRule);
    const ytdRev = assertNonNegativeGrosze(
      input.ytdRyczaltRevenueGrosze ?? 0,
      'ytdRyczaltRevenueGrosze',
    );
    const tier1Limit = getRequiredNumericParameter(ryczaltHealthRule, 'tier1LimitGrosze');
    const tier2Limit = getRequiredNumericParameter(ryczaltHealthRule, 'tier2LimitGrosze');

    if (ytdRev <= tier1Limit) {
      ryczaltHealthTier = 1;
      healthContributionBaseGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier1BaseGrosze',
      );
      healthContributionGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier1ContributionGrosze',
      );
    } else if (ytdRev <= tier2Limit) {
      ryczaltHealthTier = 2;
      healthContributionBaseGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier2BaseGrosze',
      );
      healthContributionGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier2ContributionGrosze',
      );
    } else {
      ryczaltHealthTier = 3;
      healthContributionBaseGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier3BaseGrosze',
      );
      healthContributionGrosze = getRequiredNumericParameter(
        ryczaltHealthRule,
        'tier3ContributionGrosze',
      );
    }
  } else {
    const scaleFlatHealthRule = resolveRuleAtDate(
      'ZUS_HEALTH_SCALE_AND_FLAT_ART_79A_81',
      eventDate,
      ruleOptions,
    );
    appliedRules.push(scaleFlatHealthRule);
    const prevIncome = assertSafeGrosze(
      input.previousMonthIncomeGrosze ?? 0,
      'previousMonthIncomeGrosze',
    );
    const minBase = getRequiredNumericParameter(scaleFlatHealthRule, 'minimumBaseGrosze');
    const minContribution = getRequiredNumericParameter(
      scaleFlatHealthRule,
      'minimumContributionGrosze',
    );
    const rateBps =
      input.taxForm === 'skala'
        ? getRequiredNumericParameter(scaleFlatHealthRule, 'scaleRateBps')
        : getRequiredNumericParameter(scaleFlatHealthRule, 'flatRateBps');

    const positiveIncome = Math.max(0, prevIncome);
    healthContributionBaseGrosze = Math.max(minBase, positiveIncome);
    const calculatedFromIncome = multiplyGroszeByBps(positiveIncome, rateBps, 'half_up');

    if (calculatedFromIncome < minContribution) {
      healthContributionGrosze = minContribution;
      warnings.push({
        code: 'HEALTH_MINIMUM_CONTRIBUTION_APPLIED',
        severity: 'info',
        message: `Wyliczona składka zdrowotna (${formatPlnFromGrosze(calculatedFromIncome)}) jest niższa od ustawowej składki minimalnej za rok składkowy — zastosowano minimum ${formatPlnFromGrosze(minContribution)}.`,
      });
    } else {
      healthContributionGrosze = calculatedFromIncome;
    }
  }

  const totalZusToPayGrosze = addGrosze(
    addGrosze(socialContributionsTotalGrosze, laborAndSolidarityFundGrosze),
    healthContributionGrosze,
  );

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: `Ustalenie podstawy i kwot składek społecznych ZUS (${input.zusScheme})`,
      formula:
        'społeczne = emerytalna (19,52%) + rentowa (8,00%) + chorobowa (2,45% opcj.) + wypadkowa',
      inputs: {
        zusScheme: input.zusScheme,
        socialContributionBaseGrosze,
        voluntarySicknessInsurance: input.voluntarySicknessInsurance,
        accidentRateBps,
      },
      resultFormatted: formatPlnFromGrosze(socialContributionsTotalGrosze),
      resultGrosze: socialContributionsTotalGrosze,
    },
    {
      stepNumber: 2,
      label: 'Ustalenie składki na Fundusz Pracy i Fundusz Solidarnościowy (2,45%)',
      formula: 'if (podstawa >= płacaMinimalna && brakZwolnieniaWiekowego) podstawa * 2,45% else 0',
      inputs: {
        laborFundApplicable,
        socialContributionBaseGrosze,
      },
      resultFormatted: formatPlnFromGrosze(laborAndSolidarityFundGrosze),
      resultGrosze: laborAndSolidarityFundGrosze,
    },
    {
      stepNumber: 3,
      label: `Obliczenie miesięcznej składki na ubezpieczenie zdrowotne (${input.taxForm})`,
      formula:
        input.taxForm === 'ryczalt'
          ? 'ryczałt: 9% od 60% / 100% / 180% przeciętnego wynagrodzenia wg progu przychodu'
          : input.taxForm === 'skala'
            ? 'skala: max(minSkładkaRokuSkładkowego, dochódPoprzMies * 9%)'
            : 'liniowy: max(minSkładkaRokuSkładkowego, dochódPoprzMies * 4,9%)',
      inputs: {
        taxForm: input.taxForm,
        healthContributionBaseGrosze,
      },
      resultFormatted: formatPlnFromGrosze(healthContributionGrosze),
      resultGrosze: healthContributionGrosze,
    },
    {
      stepNumber: 4,
      label: 'Łączna kwota przelewu do ZUS za dany miesiąc (ZUS DRA)',
      formula: 'totalZus = społeczne + FP_FS + zdrowotna',
      inputs: {
        socialContributionsTotalGrosze,
        laborAndSolidarityFundGrosze,
        healthContributionGrosze,
      },
      resultFormatted: formatPlnFromGrosze(totalZusToPayGrosze),
      resultGrosze: totalZusToPayGrosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'monthly_zus_contributions',
    summary: `Składki ZUS za ${input.period} (${input.zusScheme}, ${input.taxForm}): społeczne ${formatPlnFromGrosze(socialContributionsTotalGrosze)}, FP/FS ${formatPlnFromGrosze(laborAndSolidarityFundGrosze)}, zdrowotna ${formatPlnFromGrosze(healthContributionGrosze)}, łącznie ${formatPlnFromGrosze(totalZusToPayGrosze)}.`,
    eventDate,
    rules: appliedRules,
    steps,
    inputs: {
      period: input.period,
      zusScheme: input.zusScheme,
      taxForm: input.taxForm,
      voluntarySicknessInsurance: input.voluntarySicknessInsurance,
    },
    outputs: {
      socialContributionsTotalGrosze,
      laborAndSolidarityFundGrosze,
      healthContributionGrosze,
      totalZusToPayGrosze,
    },
    warnings,
  });

  return {
    period: input.period,
    zusScheme: input.zusScheme,
    taxForm: input.taxForm,
    socialContributionBaseGrosze,
    pensionContributionGrosze,
    disabilityContributionGrosze,
    sicknessContributionGrosze,
    accidentContributionGrosze,
    accidentRateBps,
    socialContributionsTotalGrosze,
    laborAndSolidarityFundGrosze,
    healthContributionBaseGrosze,
    healthContributionGrosze,
    ...(ryczaltHealthTier !== undefined ? { ryczaltHealthTier } : {}),
    totalZusToPayGrosze,
    explanation,
  };
}
