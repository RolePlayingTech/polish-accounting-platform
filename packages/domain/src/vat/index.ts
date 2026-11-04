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

  const requireKsefMarkers = jpkSchemaRule.parameters?.['requireKsefMarkers'] === true;
  const resolvedKsefMarker: KsefInvoiceMarker =
    input.ksefMarker ?? (input.ksefReferenceNumber !== undefined ? 'NrKSeF' : 'BFK');

  if (requireKsefMarkers && resolvedKsefMarker === 'NrKSeF' && !input.ksefReferenceNumber) {
    throw new Error(
      'W strukturze JPK_V7M(3) oznaczenie NrKSeF wymaga podania numeru identyfikującego fakturę w KSeF.',
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
    deductibleVatGrosze,
    nonDeductibleVatGrosze,
    mandatorySplitPaymentMpp,
    ksefMarker: resolvedKsefMarker,
    ...(input.ksefReferenceNumber !== undefined
      ? { ksefReferenceNumber: input.ksefReferenceNumber }
      : {}),
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
  assertNonNegativeGrosze(
    input.cumulativeNetSalesBeforeGrosze,
    'cumulativeNetSalesBeforeGrosze',
  );
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
  const remainingLimitGrosze = Math.max(0, subtractGrosze(proportionalLimitGrosze, cumulativeAfter));
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
      message: 'Limit zwolnienia podmiotowego VAT został już przekroczony przed bieżącą transakcją.',
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
    if (
      proportionalLimitGrosze > 0 &&
      cumulativeAfter * 10 >= proportionalLimitGrosze * 9
    ) {
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
  readonly customRegistry?: readonly LegalRule[];
}

export interface JpkV7mDeclarationSummary {
  readonly period: string;
  readonly schemaVersion: string;
  readonly salesNetTotalGrosze: number;
  readonly outputVatExactGrosze: number;
  readonly inputVatExactGrosze: number;
  readonly outputVatRoundedPlnGrosze: number;
  readonly inputVatBeforeCarryOverRoundedPlnGrosze: number;
  readonly carryOverFromPreviousPlnGrosze: number;
  readonly totalInputVatPlnGrosze: number;
  readonly taxDueToPayP51Grosze: number;
  readonly excessInputVatToCarryOverP53Grosze: number;
  readonly explanation: LegalExplanation;
}

/**
 * Agreguje rejestry sprzedaży i zakupów za wskazany miesiąc do części deklaracyjnej JPK_V7M
 * (z zaokrągleniem kwot podatku należnego i naliczonego w części deklaracyjnej do pełnych złotych wg art. 63 § 1 OP).
 */
export function calculateJpkV7mSummary(
  input: CalculateJpkV7mSummaryInput,
): JpkV7mDeclarationSummary {
  if (!PERIOD_MONTH_REGEX.test(input.period)) {
    throw new Error(`Nieprawidłowy okres JPK_V7M: "${input.period}"`);
  }
  const carryOverPrev = input.carryOverInputVatFromPreviousPeriodGrosze ?? 0;
  assertNonNegativeGrosze(carryOverPrev, 'carryOverInputVatFromPreviousPeriodGrosze');

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

  const outputVatRounded = roundTaxAmountOrdynacjaArt63(outputVatExactGrosze).roundedGrosze;
  const inputVatCurrentRounded = roundTaxAmountOrdynacjaArt63(inputVatExactGrosze).roundedGrosze;
  const carryOverRounded = roundTaxAmountOrdynacjaArt63(carryOverPrev).roundedGrosze;
  const totalInputVatPlnGrosze = addGrosze(inputVatCurrentRounded, carryOverRounded);

  const diff = subtractGrosze(outputVatRounded, totalInputVatPlnGrosze);
  const taxDueToPayP51Grosze = diff > 0 ? diff : 0;
  const excessInputVatToCarryOverP53Grosze = diff < 0 ? -diff : 0;

  const schemaVersion = getRequiredStringParameter(jpkRule, 'schemaVersionM');

  const steps: ExplanationStep[] = [
    {
      stepNumber: 1,
      label: 'Sumowanie podatku należnego z ewidencji sprzedaży i zaokrąglenie deklaracyjne (art. 63 § 1 OP)',
      formula: 'P_38 = round_ordynacja(sum(sales.vat))',
      inputs: {
        salesCount: salesEntries.length,
        outputVatExactGrosze,
      },
      resultFormatted: formatPlnFromGrosze(outputVatRounded),
      resultGrosze: outputVatRounded,
    },
    {
      stepNumber: 2,
      label: 'Sumowanie podatku naliczonego z ewidencji zakupów wraz z nadwyżką z poprzedniej deklaracji',
      formula: 'P_48 = round_ordynacja(sum(purchases.deductibleVat)) + round_ordynacja(carryOver)',
      inputs: {
        purchasesCount: purchaseEntries.length,
        inputVatExactGrosze,
        carryOverPrevGrosze: carryOverPrev,
      },
      resultFormatted: formatPlnFromGrosze(totalInputVatPlnGrosze),
      resultGrosze: totalInputVatPlnGrosze,
    },
    {
      stepNumber: 3,
      label: 'Wyliczenie zobowiązania podatkowego (P_51) lub nadwyżki podatku naliczonego nad należnym (P_53)',
      formula: 'if (P_38 > P_48) P_51 = P_38 - P_48 else P_53 = P_48 - P_38',
      inputs: {
        outputVatRoundedPlnGrosze: outputVatRounded,
        totalInputVatPlnGrosze,
      },
      resultFormatted:
        taxDueToPayP51Grosze > 0
          ? `Do wpłaty P_51: ${formatPlnFromGrosze(taxDueToPayP51Grosze)}`
          : `Nadwyżka P_53: ${formatPlnFromGrosze(excessInputVatToCarryOverP53Grosze)}`,
      resultGrosze: taxDueToPayP51Grosze > 0 ? taxDueToPayP51Grosze : excessInputVatToCarryOverP53Grosze,
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
    },
    outputs: {
      schemaVersion,
      outputVatRoundedPlnGrosze: outputVatRounded,
      totalInputVatPlnGrosze,
      taxDueToPayP51Grosze,
      excessInputVatToCarryOverP53Grosze,
    },
  });

  return {
    period: input.period,
    schemaVersion,
    salesNetTotalGrosze,
    outputVatExactGrosze,
    inputVatExactGrosze,
    outputVatRoundedPlnGrosze: outputVatRounded,
    inputVatBeforeCarryOverRoundedPlnGrosze: inputVatCurrentRounded,
    carryOverFromPreviousPlnGrosze: carryOverRounded,
    totalInputVatPlnGrosze,
    taxDueToPayP51Grosze,
    excessInputVatToCarryOverP53Grosze,
    explanation,
  };
}
