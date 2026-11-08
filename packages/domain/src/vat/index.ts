import {
  assertValidIsoCalendarDate,
  buildLegalExplanation,
  getRequiredNumericParameter,
  getRequiredStringParameter,
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
  roundSignedTaxAmountPln,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
  validatePolishNip,
} from '../money.js';
import type { VatRateCode } from '../money.js';

export type VatDeductionMode = 'full_100' | 'vehicle_mixed_50' | 'none_0';
export type KsefInvoiceMarker = 'NrKSeF' | 'OFF' | 'BFK' | 'DI';

export interface CreateVatRegisterEntryInput {
  readonly id: string;
  readonly registerType: 'sales' | 'purchase';
  readonly period: string;
  readonly taxPointDate: string;
  readonly issueDate: string;
  readonly documentNumber: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly vatRate: VatRateCode;
  readonly netGrosze: number;
  readonly vatTotalGrosze: number;
  readonly deductionMode?: VatDeductionMode;
  readonly annex15Item?: boolean;
  readonly hasVat26AndMileageLog?: boolean;
  readonly isFixedAssetPurchase?: boolean;
  readonly ksefReferenceNumber?: string;
  readonly ksefMarker?: KsefInvoiceMarker;
  readonly customRegistry?: readonly LegalRule[];
}

export interface VatRegisterEntry {
  readonly id: string;
  readonly registerType: 'sales' | 'purchase';
  readonly period: string;
  readonly taxPointDate: string;
  readonly issueDate: string;
  readonly documentNumber: string;
  readonly counterpartyName: string;
  readonly counterpartyNip?: string;
  readonly vatRate: VatRateCode;
  readonly netGrosze: number;
  readonly vatTotalGrosze: number;
  readonly grossGrosze: number;
  readonly deductionMode: VatDeductionMode;
  readonly isFixedAssetPurchase?: boolean;
  readonly deductibleVatGrosze: number;
  readonly nonDeductibleVatGrosze: number;
  readonly mandatorySplitPaymentMpp: boolean;
  readonly ksefMarker: KsefInvoiceMarker;
  readonly ksefReferenceNumber?: string;
  readonly explanation: LegalExplanation;
}

const PERIOD_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function createVatRegisterEntry(input: CreateVatRegisterEntryInput): VatRegisterEntry {
  if (!PERIOD_MONTH_REGEX.test(input.period)) {
    throw new Error(`Nieprawidłowy okres rozliczeniowy VAT: "${input.period}" (wymagany YYYY-MM)`);
  }
  assertValidIsoCalendarDate(input.taxPointDate, 'taxPointDate');
  assertValidIsoCalendarDate(input.issueDate, 'issueDate');
  assertSafeGrosze(input.netGrosze, 'netGrosze');
  assertSafeGrosze(input.vatTotalGrosze, 'vatTotalGrosze');

  let normalizedNip: string | undefined;
  if (input.counterpartyNip !== undefined) {
    const nipCheck = validatePolishNip(input.counterpartyNip);
    if (!nipCheck.valid || nipCheck.normalizedNip === undefined) {
      throw new Error(
        `Nieprawidłowy NIP kontrahenta "${input.counterpartyNip}": ${nipCheck.reason ?? 'błąd sumy kontrolnej'}`,
      );
    }
    normalizedNip = nipCheck.normalizedNip;
  }

  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;

  const ratesRule = resolveRuleAtDate(
    'VAT_RATES_STANDARD_AND_REDUCED',
    input.taxPointDate,
    ruleOptions,
  );
  const mppRule = resolveRuleAtDate(
    'VAT_SPLIT_PAYMENT_MPP_ART_108A',
    input.taxPointDate,
    ruleOptions,
  );
  const jpkSchemaRule = resolveRuleAtDate(
    'VAT_JPK_V7_DEADLINE_AND_SCHEMA',
    `${input.period}-01`,
    ruleOptions,
  );

  const appliedRules: LegalRule[] = [ratesRule, mppRule, jpkSchemaRule];
  const warnings: ExplanationWarning[] = [];

  const grossGrosze = addGrosze(input.netGrosze, input.vatTotalGrosze);
  const mppThreshold = getRequiredNumericParameter(mppRule, 'thresholdGrossGroszeExclusive');
  const mandatorySplitPaymentMpp =
    input.annex15Item === true && Math.abs(grossGrosze) > mppThreshold;

  if (mandatorySplitPaymentMpp) {
    warnings.push({
      code: 'MANDATORY_MPP_ART_108A',
      severity: 'warning',
      message: `Faktura przekracza 15 000,00 zł brutto (${formatPlnFromGrosze(grossGrosze)}) i obejmuje pozycje z załącznika nr 15 — obowiązkowy Mechanizm Podzielonej Płatności (MPP).`,
    });
  }

  const deductionMode: VatDeductionMode =
    input.registerType === 'sales' ? 'full_100' : (input.deductionMode ?? 'full_100');

  let deductibleVatGrosze = input.vatTotalGrosze;
  let nonDeductibleVatGrosze = 0;

  if (input.registerType === 'purchase') {
    if (deductionMode === 'vehicle_mixed_50') {
      const vehicleRule = resolveRuleAtDate(
        'VAT_VEHICLE_DEDUCTION_ART_86A',
        input.taxPointDate,
        ruleOptions,
      );
      appliedRules.push(vehicleRule);
      const mixedBps = getRequiredNumericParameter(vehicleRule, 'mixedDeductionBps');
      deductibleVatGrosze = multiplyGroszeByBps(input.vatTotalGrosze, mixedBps, 'half_up');
      nonDeductibleVatGrosze = subtractGrosze(input.vatTotalGrosze, deductibleVatGrosze);
    } else if (deductionMode === 'none_0') {
      deductibleVatGrosze = 0;
      nonDeductibleVatGrosze = input.vatTotalGrosze;
    } else if (input.hasVat26AndMileageLog === false) {
      warnings.push({
        code: 'VEHICLE_100_WITHOUT_VAT26_CONFIRMATION',
        severity: 'requires_expert_review',
        message:
          'Wskazano pełne odliczenie 100% VAT przy braku potwierdzenia VAT-26 i ewidencji przebiegu pojazdu — wymagana weryfikacja księgowego (art. 86a ust. 4 ustawy o VAT).',
      });
    }
  }

  const isFixedAssetPurchase =
    input.registerType === 'purchase' && input.isFixedAssetPurchase === true;

  if (
    (input.vatRate === '0' || input.vatRate === 'zw' || input.vatRate === 'np') &&
    input.vatTotalGrosze !== 0
  ) {
    warnings.push({
      code: 'VAT_NONZERO_FOR_ZERO_OR_EXEMPT_RATE',
      severity: 'requires_expert_review',
      message: `Wskazano niezerową kwotę podatku VAT (${formatPlnFromGrosze(input.vatTotalGrosze)}) przy stawce "${input.vatRate}" — wymagana weryfikacja księgowego.`,
    });
  }

  const normalizedKsefRef =
    input.ksefReferenceNumber !== undefined && input.ksefReferenceNumber.trim().length > 0
      ? input.ksefReferenceNumber.trim()
      : undefined;

  const requireKsefMarkers = jpkSchemaRule.parameters?.['requireKsefMarkers'] === true;
  const resolvedKsefMarker: KsefInvoiceMarker =
    input.ksefMarker ?? (normalizedKsefRef !== undefined ? 'NrKSeF' : 'BFK');

  if (requireKsefMarkers && resolvedKsefMarker === 'NrKSeF' && normalizedKsefRef === undefined) {
    throw new Error(
      'W strukturze JPK_V7M(3) oznaczenie NrKSeF wymaga podania numeru identyfikującego fakturę w KSeF.',
    );
  }
  if (requireKsefMarkers && resolvedKsefMarker !== 'NrKSeF' && normalizedKsefRef !== undefined) {
    throw new Error(
      `W strukturze JPK_V7M(3) znacznik "${resolvedKsefMarker}" wyklucza jednoczesne podanie numeru KSeF (<xs:choice> pomiędzy NrKSeF a OFF/BFK/DI).`,
    );
  }

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Wyliczenie wartości brutto dokumentu w groszach',
      formula: 'grossGrosze = netGrosze + vatTotalGrosze',
      inputs: {
        netGrosze: input.netGrosze,
        vatTotalGrosze: input.vatTotalGrosze,
        vatRate: input.vatRate,
      },
      resultFormatted: formatPlnFromGrosze(grossGrosze),
      resultGrosze: grossGrosze,
    },
    {
      stepNumber: 2,
      label:
        input.registerType === 'sales'
          ? 'Ujęcie podatku VAT należnego w ewidencji sprzedaży'
          : 'Kwalifikacja odliczenia podatku VAT naliczonego',
      formula:
        deductionMode === 'vehicle_mixed_50'
          ? 'deductibleVat = round_half_up(vatTotal * 50%), nonDeductibleVat = vatTotal - deductibleVat'
          : deductionMode === 'none_0'
            ? 'deductibleVat = 0, nonDeductibleVat = vatTotal'
            : 'deductibleVat = vatTotal, nonDeductibleVat = 0',
      inputs: {
        registerType: input.registerType,
        deductionMode,
      },
      resultFormatted: `${formatPlnFromGrosze(deductibleVatGrosze)} (nieodliczony: ${formatPlnFromGrosze(nonDeductibleVatGrosze)})`,
      resultGrosze: deductibleVatGrosze,
    },
    {
      stepNumber: 3,
      label: 'Weryfikacja progu obowiązkowego MPP (> 15 000,00 zł brutto i załącznik nr 15)',
      formula: 'mandatoryMpp = annex15Item && abs(grossGrosze) > 1_500_000',
      inputs: {
        annex15Item: input.annex15Item === true,
        grossGrosze,
        thresholdGrossGroszeExclusive: mppThreshold,
      },
      resultFormatted: mandatorySplitPaymentMpp ? 'TAK — obowiązkowy MPP' : 'NIE',
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'vat_register_entry',
    summary: `Wpis ewidencji VAT (${input.registerType === 'sales' ? 'sprzedaż' : 'zakup'}): netto ${formatPlnFromGrosze(input.netGrosze)}, VAT do rozliczenia ${formatPlnFromGrosze(deductibleVatGrosze)}.`,
    eventDate: input.taxPointDate,
    rules: appliedRules,
    steps,
    inputs: {
      registerType: input.registerType,
      period: input.period,
      vatRate: input.vatRate,
      netGrosze: input.netGrosze,
      vatTotalGrosze: input.vatTotalGrosze,
      deductionMode,
    },
    outputs: {
      grossGrosze,
      deductibleVatGrosze,
      nonDeductibleVatGrosze,
      mandatorySplitPaymentMpp,
      jpkSchema: getRequiredStringParameter(jpkSchemaRule, 'schemaVersionM'),
    },
    warnings,
  });

  return {
    id: input.id,
    registerType: input.registerType,
    period: input.period,
    taxPointDate: input.taxPointDate,
    issueDate: input.issueDate,
    documentNumber: input.documentNumber,
    counterpartyName: input.counterpartyName,
    ...(normalizedNip !== undefined ? { counterpartyNip: normalizedNip } : {}),
    vatRate: input.vatRate,
    netGrosze: input.netGrosze,
    vatTotalGrosze: input.vatTotalGrosze,
    grossGrosze,
    deductionMode,
    ...(input.isFixedAssetPurchase !== undefined ? { isFixedAssetPurchase } : {}),
    deductibleVatGrosze,
    nonDeductibleVatGrosze,
    mandatorySplitPaymentMpp,
    ksefMarker: resolvedKsefMarker,
    ...(normalizedKsefRef !== undefined ? { ksefReferenceNumber: normalizedKsefRef } : {}),
    explanation,
  };
}

export interface EvaluateVatExemptionInput {
  readonly eventDate: string;
  readonly activityStartDate: string;
  readonly cumulativeNetSalesBeforeGrosze: number;
  readonly currentTransactionNetGrosze?: number;
  readonly excludedActivityArt113Ust13?: boolean;
  readonly customRegistry?: readonly LegalRule[];
}

export interface VatExemptionEvaluationResult {
  readonly eventDate: string;
  readonly taxYear: number;
  readonly annualStatutoryLimitGrosze: number;
  readonly proportionalLimitGrosze: number;
  readonly activeDaysInYear: number;
  readonly totalDaysInYear: number;
  readonly cumulativeNetSalesAfterGrosze: number;
  readonly remainingLimitGrosze: number;
  readonly status:
    | 'exempt_within_limit'
    | 'exceeded_by_current_transaction'
    | 'already_exceeded'
    | 'excluded_art_113_ust_13';
  readonly currentTransactionTaxableVat: boolean;
  readonly explanation: LegalExplanation;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function calculateDaysInclusiveInYear(startDateStr: string, year: number): number {
  const parts = startDateStr.split('-').map(Number);
  const startUtc = Date.UTC(parts[0] ?? year, (parts[1] ?? 1) - 1, parts[2] ?? 1);
  const endUtc = Date.UTC(year, 11, 31);
  const diffDays = Math.floor((endUtc - startUtc) / 86_400_000) + 1;
  return Math.max(1, diffDays);
}

/**
 * Ocenia prawo do zwolnienia podmiotowego z VAT na podstawie art. 113 ust. 1, 5, 9 i 13 ustawy o VAT
 * (200 000 zł do końca 2025 r., 240 000 zł od 1 stycznia 2026 r., z proporcją dni w roku otwarcia firmy).
 */
export function evaluateVatExemptionLimit(
  input: EvaluateVatExemptionInput,
): VatExemptionEvaluationResult {
  assertValidIsoCalendarDate(input.eventDate, 'eventDate');
  assertValidIsoCalendarDate(input.activityStartDate, 'activityStartDate');
  assertNonNegativeGrosze(input.cumulativeNetSalesBeforeGrosze, 'cumulativeNetSalesBeforeGrosze');
  const currentTx = input.currentTransactionNetGrosze ?? 0;
  assertNonNegativeGrosze(currentTx, 'currentTransactionNetGrosze');

  if (input.activityStartDate > input.eventDate) {
    throw new Error(
      `Data rozpoczęcia działalności (${input.activityStartDate}) nie może być późniejsza niż data zdarzenia (${input.eventDate}).`,
    );
  }

  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const limitRule = resolveRuleAtDate('VAT_EXEMPTION_LIMIT_ART_113', input.eventDate, ruleOptions);
  const annualLimitGrosze = getRequiredNumericParameter(limitRule, 'annualLimitGrosze');

  const taxYear = Number(input.eventDate.slice(0, 4));
  const startYear = Number(input.activityStartDate.slice(0, 4));
  const totalDaysInYear = isLeapYear(taxYear) ? 366 : 365;
  const startedInCurrentYear = startYear === taxYear;
  const activeDaysInYear = startedInCurrentYear
    ? calculateDaysInclusiveInYear(input.activityStartDate, taxYear)
    : totalDaysInYear;

  const proportionalLimitGrosze = startedInCurrentYear
    ? multiplyGroszeByRatio(annualLimitGrosze, activeDaysInYear, totalDaysInYear, 'half_up')
    : annualLimitGrosze;

  const cumulativeAfter = addGrosze(input.cumulativeNetSalesBeforeGrosze, currentTx);
  const remainingLimitGrosze = Math.max(
    0,
    subtractGrosze(proportionalLimitGrosze, cumulativeAfter),
  );
  const warnings: ExplanationWarning[] = [];

  let status: VatExemptionEvaluationResult['status'];
  let currentTransactionTaxableVat = false;

  if (input.excludedActivityArt113Ust13 === true) {
    status = 'excluded_art_113_ust_13';
    currentTransactionTaxableVat = true;
    warnings.push({
      code: 'VAT_ART_113_UST_13_EXCLUSION',
      severity: 'warning',
      message:
        'Podatnik wykonuje czynności wyłączone ze zwolnienia podmiotowego na mocy art. 113 ust. 13 ustawy o VAT — obowiązek rejestracji VAT-R od pierwszej sprzedaży.',
    });
  } else if (input.cumulativeNetSalesBeforeGrosze > proportionalLimitGrosze) {
    status = 'already_exceeded';
    currentTransactionTaxableVat = true;
    warnings.push({
      code: 'VAT_LIMIT_ALREADY_EXCEEDED',
      severity: 'warning',
      message:
        'Limit zwolnienia podmiotowego VAT został już przekroczony przed bieżącą transakcją.',
    });
  } else if (cumulativeAfter > proportionalLimitGrosze) {
    status = 'exceeded_by_current_transaction';
    currentTransactionTaxableVat = true;
    warnings.push({
      code: 'VAT_LIMIT_EXCEEDED_BY_TRANSACTION',
      severity: 'warning',
      message: `Bieżąca czynność powoduje przekroczenie limitu ${formatPlnFromGrosze(proportionalLimitGrosze)} — zgodnie z art. 113 ust. 5 opodatkowaniu VAT podlega cała ta czynność.`,
    });
  } else {
    status = 'exempt_within_limit';
    if (proportionalLimitGrosze > 0 && cumulativeAfter * 10 >= proportionalLimitGrosze * 9) {
      warnings.push({
        code: 'VAT_LIMIT_ABOVE_90_PERCENT',
        severity: 'info',
        message: `Wykorzystano ponad 90% limitu zwolnienia podmiotowego VAT (pozostało ${formatPlnFromGrosze(remainingLimitGrosze)}).`,
      });
    }
  }

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: `Ustalenie limitu rocznego i proporcjonalnego na rok ${String(taxYear)}`,
      formula: startedInCurrentYear
        ? 'proportionalLimit = round_half_up(annualLimit * activeDaysInYear / totalDaysInYear)'
        : 'proportionalLimit = annualLimit (działalność kontynuowana z lat poprzednich)',
      inputs: {
        annualLimitGrosze,
        activeDaysInYear,
        totalDaysInYear,
      },
      resultFormatted: formatPlnFromGrosze(proportionalLimitGrosze),
      resultGrosze: proportionalLimitGrosze,
    },
    {
      stepNumber: 2,
      label: 'Porównanie sprzedaży narastająco z przysługującym limitem zwolnienia',
      formula: 'cumulativeAfter = cumulativeBefore + currentTransaction',
      inputs: {
        cumulativeBeforeGrosze: input.cumulativeNetSalesBeforeGrosze,
        currentTransactionNetGrosze: currentTx,
      },
      resultFormatted: `${formatPlnFromGrosze(cumulativeAfter)} wobec limitu ${formatPlnFromGrosze(proportionalLimitGrosze)}`,
      resultGrosze: cumulativeAfter,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'vat_exemption_limit_art_113',
    summary: `Ocena limitu zwolnienia VAT (art. 113) na ${input.eventDate}: status ${status}, limit ${formatPlnFromGrosze(proportionalLimitGrosze)}.`,
    eventDate: input.eventDate,
    rules: [limitRule],
    steps,
    inputs: {
      eventDate: input.eventDate,
      activityStartDate: input.activityStartDate,
      cumulativeNetSalesBeforeGrosze: input.cumulativeNetSalesBeforeGrosze,
      currentTransactionNetGrosze: currentTx,
      excludedActivityArt113Ust13: input.excludedActivityArt113Ust13 === true,
    },
    outputs: {
      proportionalLimitGrosze,
      cumulativeNetSalesAfterGrosze: cumulativeAfter,
      remainingLimitGrosze,
      status,
      currentTransactionTaxableVat,
    },
    warnings,
  });

  return {
    eventDate: input.eventDate,
    taxYear,
    annualStatutoryLimitGrosze: annualLimitGrosze,
    proportionalLimitGrosze,
    activeDaysInYear,
    totalDaysInYear,
    cumulativeNetSalesAfterGrosze: cumulativeAfter,
    remainingLimitGrosze,
    status,
    currentTransactionTaxableVat,
    explanation,
  };
}

export interface CalculateJpkV7mSummaryInput {
  readonly period: string;
  readonly entries: readonly VatRegisterEntry[];
  readonly carryOverInputVatFromPreviousPeriodGrosze?: number;
  /** Opcjonalna kwota zwrotu na rachunek bankowy wykazywana w polu P_54 (w groszach; pomniejsza P_62 = P_53 - P_54). */
  readonly refundRequestedP54Grosze?: number;
  readonly customRegistry?: readonly LegalRule[];
}

/**
 * Pola części deklaracyjnej JPK_V7M(2) / JPK_V7M(3) w pełnych złotych (zgodnie z typami XSD TKwotaC / TKwotaCNieujemna).
 */
export interface JpkV7mDeclarationFields {
  /** Dostawa towarów oraz świadczenie usług na terytorium kraju, zwolnione od podatku (zw). */
  readonly P_10: number;
  /** Dostawa towarów oraz świadczenie usług poza terytorium kraju (np). */
  readonly P_11: number;
  /** Dostawa towarów oraz świadczenie usług na terytorium kraju opodatkowane stawką 0%. */
  readonly P_13: number;
  /** Podstawa opodatkowania stawką 5% w pełnych złotych. */
  readonly P_15: number;
  /** Podatek należny wg stawki 5% w pełnych złotych. */
  readonly P_16: number;
  /** Podstawa opodatkowania stawką 7% albo 8% w pełnych złotych. */
  readonly P_17: number;
  /** Podatek należny wg stawki 7% albo 8% w pełnych złotych. */
  readonly P_18: number;
  /** Podstawa opodatkowania stawką 22% albo 23% w pełnych złotych. */
  readonly P_19: number;
  /** Podatek należny wg stawki 22% albo 23% w pełnych złotych. */
  readonly P_20: number;
  /** Łączna podstawa opodatkowania (P_10 + P_11 + P_13 + P_15 + P_17 + P_19) w pełnych złotych. */
  readonly P_37: number;
  /** Łączna wysokość podatku należnego (P_16 + P_18 + P_20) w pełnych złotych. */
  readonly P_38: number;
  /** Wysokość nadwyżki podatku naliczonego nad należnym z poprzedniej deklaracji w pełnych złotych. */
  readonly P_39: number;
  /** Wartość netto nabycia towarów i usług zaliczanych do środków trwałych (w części z prawem do odliczenia). */
  readonly P_40: number;
  /** Wysokość podatku naliczonego od nabycia środków trwałych w pełnych złotych. */
  readonly P_41: number;
  /** Wartość netto nabycia pozostałych towarów i usług (w części z prawem do odliczenia, bez none_0 i z 50% dla art. 86a). */
  readonly P_42: number;
  /** Wysokość podatku naliczonego od nabycia pozostałych towarów i usług w pełnych złotych. */
  readonly P_43: number;
  /** Łączna wysokość podatku naliczonego do odliczenia (P_39 + P_41 + P_43) w pełnych złotych. */
  readonly P_48: number;
  /** Wysokość podatku podlegająca wpłacie do urzędu skarbowego: max(0, P_38 - P_48). */
  readonly P_51: number;
  /** Wysokość nadwyżki podatku naliczonego nad należnym: max(0, P_48 - P_38). */
  readonly P_53: number;
  /** Kwota nadwyżki do zwrotu na rachunek bankowy podatnika (P_54 <= P_53). */
  readonly P_54: number;
  /** Kwota nadwyżki do przeniesienia na następny okres rozliczeniowy (P_62 = P_53 - P_54). */
  readonly P_62: number;
}

export interface JpkV7mDeclarationSummary {
  readonly period: string;
  readonly schemaVersion: string;
  readonly salesNetTotalGrosze: number;
  readonly salesBaseRoundedPlnP37Grosze: number;
  readonly deductiblePurchaseNetTotalGrosze: number;
  readonly outputVatExactGrosze: number;
  readonly inputVatExactGrosze: number;
  readonly outputVatRoundedPlnGrosze: number;
  readonly inputVatBeforeCarryOverRoundedPlnGrosze: number;
  readonly carryOverFromPreviousPlnGrosze: number;
  readonly totalInputVatPlnGrosze: number;
  readonly taxDueToPayP51Grosze: number;
  readonly excessInputVatToCarryOverP53Grosze: number;
  readonly refundToBankAccountP54Grosze: number;
  readonly carryForwardToNextPeriodP62Grosze: number;
  readonly declarationFields: JpkV7mDeclarationFields;
  readonly explanation: LegalExplanation;
}

function getDeductiblePurchaseNetGrosze(entry: VatRegisterEntry): number {
  if (entry.deductionMode === 'none_0') {
    return 0;
  }
  if (entry.deductionMode === 'vehicle_mixed_50') {
    return multiplyGroszeByBps(entry.netGrosze, 5000, 'half_up');
  }
  return entry.netGrosze;
}

/**
 * Agreguje rejestry sprzedaży i zakupów za wskazany miesiąc do części deklaracyjnej JPK_V7M
 * zgodnie z zasadami zaokrąglania per wiersz stawki/kategorii (`P_10`–`P_62`, art. 63 § 1 OP oraz broszura MF JPK_VAT).
 */
export function calculateJpkV7mSummary(
  input: CalculateJpkV7mSummaryInput,
): JpkV7mDeclarationSummary {
  if (!PERIOD_MONTH_REGEX.test(input.period)) {
    throw new Error(`Nieprawidłowy okres JPK_V7M: "${input.period}"`);
  }
  const carryOverPrev = input.carryOverInputVatFromPreviousPeriodGrosze ?? 0;
  assertNonNegativeGrosze(carryOverPrev, 'carryOverInputVatFromPreviousPeriodGrosze');
  const requestedRefundPrevGrosze = input.refundRequestedP54Grosze ?? 0;
  assertNonNegativeGrosze(requestedRefundPrevGrosze, 'refundRequestedP54Grosze');

  const eventDate = `${input.period}-01`;
  const ruleOptions =
    input.customRegistry !== undefined ? { customRegistry: input.customRegistry } : undefined;
  const jpkRule = resolveRuleAtDate('VAT_JPK_V7_DEADLINE_AND_SCHEMA', eventDate, ruleOptions);
  const roundingRule = resolveRuleAtDate('ORDYNACJA_ART_63_TAX_ROUNDING', eventDate, ruleOptions);

  const periodEntries = input.entries.filter((entry) => entry.period === input.period);
  const salesEntries = periodEntries.filter((entry) => entry.registerType === 'sales');
  const purchaseEntries = periodEntries.filter((entry) => entry.registerType === 'purchase');

  const salesNetTotalGrosze = sumGrosze(salesEntries.map((item) => item.netGrosze));
  const outputVatExactGrosze = sumGrosze(salesEntries.map((item) => item.deductibleVatGrosze));
  const inputVatExactGrosze = sumGrosze(purchaseEntries.map((item) => item.deductibleVatGrosze));

  const salesZwNetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === 'zw').map((e) => e.netGrosze),
  );
  const salesNpNetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === 'np').map((e) => e.netGrosze),
  );
  const sales0NetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '0').map((e) => e.netGrosze),
  );
  const sales5NetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '5').map((e) => e.netGrosze),
  );
  const sales5VatGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '5').map((e) => e.deductibleVatGrosze),
  );
  const sales8NetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '8').map((e) => e.netGrosze),
  );
  const sales8VatGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '8').map((e) => e.deductibleVatGrosze),
  );
  const sales23NetGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '23').map((e) => e.netGrosze),
  );
  const sales23VatGrosze = sumGrosze(
    salesEntries.filter((e) => e.vatRate === '23').map((e) => e.deductibleVatGrosze),
  );

  // Zaokrąglenia do pełnych złotych wykonywane są dla każdego pola stawki z osobna (art. 63 § 1 OP + XSD JPK_V7M)
  const P_10 = roundSignedTaxAmountPln(salesZwNetGrosze).roundedFullPln;
  const P_11 = roundSignedTaxAmountPln(salesNpNetGrosze).roundedFullPln;
  const P_13 = roundSignedTaxAmountPln(sales0NetGrosze).roundedFullPln;
  const P_15 = roundSignedTaxAmountPln(sales5NetGrosze).roundedFullPln;
  const P_16 = roundSignedTaxAmountPln(sales5VatGrosze).roundedFullPln;
  const P_17 = roundSignedTaxAmountPln(sales8NetGrosze).roundedFullPln;
  const P_18 = roundSignedTaxAmountPln(sales8VatGrosze).roundedFullPln;
  const P_19 = roundSignedTaxAmountPln(sales23NetGrosze).roundedFullPln;
  const P_20 = roundSignedTaxAmountPln(sales23VatGrosze).roundedFullPln;

  const P_37 = P_10 + P_11 + P_13 + P_15 + P_17 + P_19;
  const P_38 = P_16 + P_18 + P_20;

  const fixedAssetPurchases = purchaseEntries.filter((e) => e.isFixedAssetPurchase);
  const otherPurchases = purchaseEntries.filter((e) => !e.isFixedAssetPurchase);

  const fixedAssetNetGrosze = sumGrosze(fixedAssetPurchases.map(getDeductiblePurchaseNetGrosze));
  const fixedAssetVatGrosze = sumGrosze(fixedAssetPurchases.map((e) => e.deductibleVatGrosze));
  const otherPurchaseNetGrosze = sumGrosze(otherPurchases.map(getDeductiblePurchaseNetGrosze));
  const otherPurchaseVatGrosze = sumGrosze(otherPurchases.map((e) => e.deductibleVatGrosze));
  const deductiblePurchaseNetTotalGrosze = addGrosze(fixedAssetNetGrosze, otherPurchaseNetGrosze);

  const P_39 = roundTaxAmountOrdynacjaArt63(carryOverPrev).roundedFullPln;
  const P_40 = roundSignedTaxAmountPln(fixedAssetNetGrosze).roundedFullPln;
  const P_41 = roundSignedTaxAmountPln(fixedAssetVatGrosze).roundedFullPln;
  const P_42 = roundSignedTaxAmountPln(otherPurchaseNetGrosze).roundedFullPln;
  const P_43 = roundSignedTaxAmountPln(otherPurchaseVatGrosze).roundedFullPln;
  const P_48 = P_39 + P_41 + P_43;

  const outputVatRounded = P_38 * 100;
  const inputVatCurrentRounded = (P_41 + P_43) * 100;
  const carryOverRounded = P_39 * 100;
  const totalInputVatPlnGrosze = P_48 * 100;
  const salesBaseRoundedPlnP37Grosze = P_37 * 100;

  const netDiffPln = P_38 - P_48;
  const P_51 = netDiffPln > 0 ? netDiffPln : 0;
  const P_53 = netDiffPln < 0 ? -netDiffPln : 0;

  const requestedRefundPln = roundTaxAmountOrdynacjaArt63(requestedRefundPrevGrosze).roundedFullPln;
  if (requestedRefundPln > P_53) {
    throw new Error(
      `Wnioskowany zwrot VAT na rachunek bankowy P_54 (${String(requestedRefundPln)} zł) nie może przekraczać nadwyżki podatku naliczonego nad należnym P_53 (${String(P_53)} zł).`,
    );
  }
  const P_54 = requestedRefundPln;
  const P_62 = P_53 - P_54;

  const taxDueToPayP51Grosze = P_51 * 100;
  const excessInputVatToCarryOverP53Grosze = P_53 * 100;
  const refundToBankAccountP54Grosze = P_54 * 100;
  const carryForwardToNextPeriodP62Grosze = P_62 * 100;

  const declarationFields: JpkV7mDeclarationFields = {
    P_10,
    P_11,
    P_13,
    P_15,
    P_16,
    P_17,
    P_18,
    P_19,
    P_20,
    P_37,
    P_38,
    P_39,
    P_40,
    P_41,
    P_42,
    P_43,
    P_48,
    P_51,
    P_53,
    P_54,
    P_62,
  };

  const warnings: ExplanationWarning[] = [];
  if (outputVatRounded < 0 || totalInputVatPlnGrosze < 0) {
    warnings.push({
      code: 'JPK_V7M_SIGNED_NEGATIVE_CORRECTION_TKWOTAC',
      severity: 'info',
      message:
        'W okresie wystąpiła przewaga korekt zmniejszających (in minus) — pola deklaracyjne P_38 / P_48 wykazano ze znakiem ujemnym zgodnie z typem TKwotaC schemy JPK_V7M.',
    });
  }

  const unmappedExemptOrZeroVatGrosze = sumGrosze(
    salesEntries
      .filter((e) => e.vatRate === '0' || e.vatRate === 'zw' || e.vatRate === 'np')
      .map((e) => e.deductibleVatGrosze),
  );
  if (unmappedExemptOrZeroVatGrosze !== 0) {
    warnings.push({
      code: 'JPK_V7M_UNMAPPED_OUTPUT_VAT_ON_EXEMPT_OR_ZERO_RATE',
      severity: 'requires_expert_review',
      message: `W ewidencji sprzedaży wykryto niezerowy VAT (${formatPlnFromGrosze(unmappedExemptOrZeroVatGrosze)}) przypisany do stawki 0% / zw / np — pozycja wymaga korekty przed wysyłką JPK_V7M.`,
    });
  }

  const schemaVersion = getRequiredStringParameter(jpkRule, 'schemaVersionM');

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label:
        'Wyznaczenie zaokrąglonych podstaw opodatkowania (P_10–P_19 -> P_37) oraz podatku należnego per stawka (P_16 + P_18 + P_20 -> P_38)',
      formula: 'P_38 = round_pln(VAT_5%) + round_pln(VAT_8%) + round_pln(VAT_23%)',
      inputs: {
        salesCount: salesEntries.length,
        outputVatExactGrosze,
        P_16,
        P_18,
        P_20,
      },
      resultFormatted: formatPlnFromGrosze(outputVatRounded),
      resultGrosze: outputVatRounded,
    },
    {
      stepNumber: 2,
      label:
        'Sumowanie podatku naliczonego z ewidencji zakupów (P_41 środki trwałe + P_43 pozostałe) wraz z nadwyżką z poprzedniej deklaracji (P_39)',
      formula: 'P_48 = P_39 + P_41 + P_43',
      inputs: {
        purchasesCount: purchaseEntries.length,
        inputVatExactGrosze,
        carryOverPrevGrosze: carryOverPrev,
        P_39,
        P_41,
        P_43,
      },
      resultFormatted: formatPlnFromGrosze(totalInputVatPlnGrosze),
      resultGrosze: totalInputVatPlnGrosze,
    },
    {
      stepNumber: 3,
      label:
        'Wyliczenie zobowiązania podatkowego (P_51) lub nadwyżki podatku naliczonego nad należnym (P_53 -> P_54 zwrot / P_62 przeniesienie)',
      formula:
        'netDiff = P_38 - P_48; if (netDiff > 0) P_51 = netDiff else { P_53 = -netDiff; P_62 = P_53 - P_54 }',
      inputs: {
        outputVatRoundedPlnGrosze: outputVatRounded,
        totalInputVatPlnGrosze,
        refundToBankAccountP54Grosze,
      },
      resultFormatted:
        taxDueToPayP51Grosze > 0
          ? `Do wpłaty P_51: ${formatPlnFromGrosze(taxDueToPayP51Grosze)}`
          : `Nadwyżka P_53: ${formatPlnFromGrosze(excessInputVatToCarryOverP53Grosze)} (P_62: ${formatPlnFromGrosze(carryForwardToNextPeriodP62Grosze)})`,
      resultGrosze:
        taxDueToPayP51Grosze > 0 ? taxDueToPayP51Grosze : excessInputVatToCarryOverP53Grosze,
    },
  ];

  const explanation = buildLegalExplanation({
    calculationType: 'jpk_v7m_declaration_summary',
    summary: `Podsumowanie ${schemaVersion} za ${input.period}: VAT należny ${formatPlnFromGrosze(outputVatRounded)}, VAT naliczony ${formatPlnFromGrosze(totalInputVatPlnGrosze)}, do wpłaty ${formatPlnFromGrosze(taxDueToPayP51Grosze)}.`,
    eventDate,
    rules: [jpkRule, roundingRule],
    steps,
    inputs: {
      period: input.period,
      entriesCount: periodEntries.length,
      carryOverInputVatFromPreviousPeriodGrosze: carryOverPrev,
      refundRequestedP54Grosze: requestedRefundPrevGrosze,
    },
    outputs: {
      schemaVersion,
      salesBaseRoundedPlnP37Grosze,
      outputVatRoundedPlnGrosze: outputVatRounded,
      totalInputVatPlnGrosze,
      taxDueToPayP51Grosze,
      excessInputVatToCarryOverP53Grosze,
      refundToBankAccountP54Grosze,
      carryForwardToNextPeriodP62Grosze,
    },
    warnings,
  });

  return {
    period: input.period,
    schemaVersion,
    salesNetTotalGrosze,
    salesBaseRoundedPlnP37Grosze,
    deductiblePurchaseNetTotalGrosze,
    outputVatExactGrosze,
    inputVatExactGrosze,
    outputVatRoundedPlnGrosze: outputVatRounded,
    inputVatBeforeCarryOverRoundedPlnGrosze: inputVatCurrentRounded,
    carryOverFromPreviousPlnGrosze: carryOverRounded,
    totalInputVatPlnGrosze,
    taxDueToPayP51Grosze,
    excessInputVatToCarryOverP53Grosze,
    refundToBankAccountP54Grosze,
    carryForwardToNextPeriodP62Grosze,
    declarationFields,
    explanation,
  };
}
