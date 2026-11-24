import {
  ExplainAccountingItemInputSchema,
  ExplainAccountingItemOutputSchema,
  ExplainTaxCalculationInputSchema,
  ExplainTaxCalculationOutputSchema,
  GetLegalBasisInputSchema,
  GetLegalBasisOutputSchema,
  GetMonthlyTaxObligationsInputSchema,
  GetMonthlyTaxObligationsOutputSchema,
  OfficialHttpsUrlSchema,
  PreviewJpkExportInputSchema,
  PreviewJpkExportOutputSchema,
  isValidPolishNip,
  type AccountingCalculationStep,
  type ExplainAccountingItemOutput,
  type ExplainTaxCalculationOutput,
  type GetLegalBasisOutput,
  type GetMonthlyTaxObligationsOutput,
  type JpkSchemaFamily,
  type LegalBasisReference,
  type MonthlyTaxObligation,
  type PreviewJpkExportOutput,
} from '@pap/contracts/mcp-tools';
import {
  CitPreferentialEligibilityError,
  calculateProfileAKpirObligations,
  calculateProfileBRyczaltObligations,
  calculateProfileCCitObligations,
  type AppliedRuleSummary,
  type JpkPolishAddress,
  type JpkTaxpayerSubject,
  type JpkV7PurchaseRowInput,
  type JpkV7SalesRowInput,
  type LegalExplanation,
  type OfficialJpkStructureCode,
} from '@pap/domain';
import { prepareValidatedJpkExport, type PreparedJpkExportArtifact } from '../../jpk/index.js';
import { getOfficialMfSchemaEntry } from '../../xsd/index.js';
import { resolveCompanyProfileSupportStatus } from '../capability-registry.js';
import {
  authenticateGlobalMcpToolActor,
  authorizeCompanyScopedMcpTool,
  buildAuditUnavailableError,
  denyMcpToolCall,
  recordMcpAuditFailClosed,
  resolveAuthorizedCompanyTaxProfile,
  type McpGateEnvironment,
} from '../gate-runner.js';
import {
  formatGroszeToPln,
  parsePlnToGrosze,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
} from '../security-and-redaction.js';
import type {
  CompanyTaxProfile,
  McpCallContext,
  McpGatewayToolResult,
  McpJpkPeriodSourceData,
  McpTaxCalculationSourceData,
} from '../types.js';
import { VERIFIED_POLISH_LEGAL_BASIS_CATALOG } from '../vat-classification.js';

function formatSafeNumberGroszeToPln(grosze: number): string {
  return formatGroszeToPln(BigInt(Math.trunc(grosze)));
}

function mapDomainLegalRuleToMcpRef(rule: AppliedRuleSummary): LegalBasisReference {
  const validUrl = OfficialHttpsUrlSchema.safeParse(rule.sourceUrl);
  return {
    ruleId: rule.ruleCode,
    ruleVersion: rule.version,
    actTitle: rule.actTitle,
    articleRef: rule.article,
    journalOfLawsRef: rule.journalReference,
    officialUrl: validUrl.success ? validUrl.data : 'https://isap.sejm.gov.pl/',
    effectiveFrom: rule.validFrom,
    effectiveTo: rule.validTo,
    verificationStatus: rule.verificationStatus === 'verified' ? 'verified' : 'experimental',
  };
}

function mapDomainExplanationStepsToMcp(
  explanation: LegalExplanation,
): AccountingCalculationStep[] {
  const defaultRuleId = explanation.appliedRules[0]?.ruleCode ?? 'POLISH_TAX_RULE';
  if (explanation.steps.length === 0) {
    return [
      {
        stepNumber: 1,
        labelPl: explanation.summary.slice(0, 280),
        formula: explanation.calculationType,
        inputAmountPln: '0.00',
        resultAmountPln: '0.00',
        appliedRuleId: defaultRuleId,
      },
    ];
  }
  return explanation.steps.map((step) => {
    const firstNumericInput = Object.values(step.inputs).find(
      (v): v is number => typeof v === 'number' && Number.isSafeInteger(v),
    );
    return {
      stepNumber: step.stepNumber,
      labelPl: step.label.slice(0, 290),
      formula: step.formula.slice(0, 290),
      inputAmountPln: formatSafeNumberGroszeToPln(firstNumericInput ?? 0),
      resultAmountPln: formatSafeNumberGroszeToPln(step.resultGrosze ?? 0),
      appliedRuleId: defaultRuleId,
    };
  });
}

function lastDayOfPeriodIso(period: string): string {
  const [yStr = '2026', mStr = '01'] = period.split('-');
  const lastDay = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
  return `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;
}

export async function handleGetMonthlyTaxObligations(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetMonthlyTaxObligationsOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetMonthlyTaxObligationsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_monthly_tax_obligations',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe parametry zapytania o obowiązki podatkowe (wymagany okres RRRR-MM).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'get_monthly_tax_obligations',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const baseObligations = await env.dataSource.listMonthlyTaxObligations(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );

  let enrichedObligations: MonthlyTaxObligation[] = [...baseObligations];

  if (env.dataSource.getTaxCalculationSourceData) {
    const profile = await resolveAuthorizedCompanyTaxProfile(
      env,
      auth.actor.userId,
      auth.actor.tenantId,
      auth.actor.legalEntityId,
    );
    const calcSource = await env.dataSource.getTaxCalculationSourceData(
      auth.actor.tenantId,
      auth.actor.legalEntityId,
      input.period,
    );
    if (profile && calcSource) {
      let zusAccrued = 0;
      let zusPaid = 0;
      let zusRem = 0;
      let zusLifecycle: MonthlyTaxObligation['settlementLifecycleStatus'] = 'accrued_not_yet_due';
      let incomeAccrued = 0;
      let incomePaid = 0;
      let incomeRem = 0;
      let incomeLifecycle: MonthlyTaxObligation['settlementLifecycleStatus'] =
        'accrued_not_yet_due';

      if (profile.taxRegime === 'kpir_skala' || profile.taxRegime === 'kpir_liniowy') {
        const res = calculateProfileAKpirObligations({
          period: input.period,
          taxForm: profile.taxRegime === 'kpir_liniowy' ? 'liniowy' : 'skala',
          zusScheme: calcSource.zusScheme,
          voluntarySicknessInsurance: calcSource.voluntarySicknessInsurance,
          previousMonthIncomeForHealthGrosze: calcSource.previousMonthIncomeForHealthGrosze,
          ytdRevenueGrosze: calcSource.ytdRevenueGrosze,
          ytdCostsGrosze: calcSource.ytdTaxDeductibleCostsGrosze,
          previousAdvancesAccruedDueYtdGrosze:
            calcSource.previousPitOrCitAdvancesAccruedYtdGrosze ?? 0,
          verifiedPayments: calcSource.verifiedPayments,
        });
        zusAccrued = res.accruedZus.totalZusToPayGrosze;
        zusPaid =
          res.zusSettlements.social.confirmedPaidGrosze +
          res.zusSettlements.health.confirmedPaidGrosze +
          res.zusSettlements.laborFund.confirmedPaidGrosze;
        zusRem = Math.max(0, zusAccrued - zusPaid);
        zusLifecycle =
          zusRem === 0 ? 'paid' : zusPaid > 0 ? 'partially_paid' : res.zusSettlements.social.status;
        incomeAccrued = res.pitAdvanceSettlement.accruedDueGrosze;
        incomePaid = res.pitAdvanceSettlement.confirmedPaidGrosze;
        incomeRem = res.pitAdvanceSettlement.remainingUnpaidGrosze;
        incomeLifecycle = res.pitAdvanceSettlement.status;
      } else if (profile.taxRegime === 'ryczalt') {
        const res = calculateProfileBRyczaltObligations({
          period: input.period,
          zusScheme: calcSource.zusScheme,
          voluntarySicknessInsurance: calcSource.voluntarySicknessInsurance,
          entries: calcSource.ryczaltEntries,
          verifiedPayments: calcSource.verifiedPayments,
          socialZusAlreadyDeductedPriorMonthsYtdGrosze:
            calcSource.socialZusAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
          health50PctAlreadyDeductedPriorMonthsYtdGrosze:
            calcSource.health50PctAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
        });
        zusAccrued = res.accruedZus.totalZusToPayGrosze;
        zusPaid =
          res.zusSettlements.social.confirmedPaidGrosze +
          res.zusSettlements.health.confirmedPaidGrosze +
          res.zusSettlements.laborFund.confirmedPaidGrosze;
        zusRem = Math.max(0, zusAccrued - zusPaid);
        zusLifecycle =
          zusRem === 0 ? 'paid' : zusPaid > 0 ? 'partially_paid' : res.zusSettlements.social.status;
        incomeAccrued = res.ryczaltSettlement.accruedDueGrosze;
        incomePaid = res.ryczaltSettlement.confirmedPaidGrosze;
        incomeRem = res.ryczaltSettlement.remainingUnpaidGrosze;
        incomeLifecycle = res.ryczaltSettlement.status;
      } else {
        try {
          const res = calculateProfileCCitObligations({
            period: input.period,
            operatingRevenuesYtdGrosze: calcSource.ytdRevenueGrosze,
            operatingTaxDeductibleCostsYtdGrosze: calcSource.ytdTaxDeductibleCostsGrosze,
            previousAdvancesAccruedDueYtdGrosze:
              calcSource.previousPitOrCitAdvancesAccruedYtdGrosze ?? 0,
            verifiedPayments: calcSource.verifiedPayments,
            ...(calcSource.taxYearStartDate && calcSource.taxYearEndDate
              ? {
                  taxYearStartDate: calcSource.taxYearStartDate,
                  taxYearEndDate: calcSource.taxYearEndDate,
                }
              : {}),
            ...(calcSource.smallTaxpayer &&
            calcSource.citPreferentialEligibility &&
            calcSource.taxYearStartDate &&
            calcSource.taxYearEndDate
              ? {
                  requestPreferential9PctRate: true,
                  preferentialEligibility: calcSource.citPreferentialEligibility,
                }
              : {}),
          });
          incomeAccrued = res.citAdvanceSettlement.accruedDueGrosze;
          incomePaid = res.citAdvanceSettlement.confirmedPaidGrosze;
          incomeRem = res.citAdvanceSettlement.remainingUnpaidGrosze;
          incomeLifecycle = res.citAdvanceSettlement.status;
        } catch (err) {
          if (err instanceof CitPreferentialEligibilityError) {
            return denyMcpToolCall(env, {
              toolName: 'get_monthly_tax_obligations',
              correlationId,
              actorUserId: auth.actor.userId,
              actorIssuer: auth.actor.identity.issuer,
              actorSubject: auth.actor.identity.subject,
              tenantId: auth.actor.tenantId,
              legalEntityId: auth.actor.legalEntityId,
              errorCode: 'validation_failed',
              reasonCode: err.reasonCode,
              messagePl: err.message,
            });
          }
          throw err;
        }
      }

      enrichedObligations = baseObligations.map((ob) => {
        if (ob.status === 'not_applicable') {
          return ob;
        }
        if (ob.category === 'zus' && profile.legalForm === 'jdg') {
          return {
            ...ob,
            estimatedAmountPln: formatSafeNumberGroszeToPln(zusAccrued),
            accruedAmountPln: formatSafeNumberGroszeToPln(zusAccrued),
            confirmedPaidAmountPln: formatSafeNumberGroszeToPln(zusPaid),
            remainingUnpaidAmountPln: formatSafeNumberGroszeToPln(zusRem),
            settlementLifecycleStatus: zusLifecycle,
          };
        }
        if (ob.category === 'pit' || ob.category === 'cit') {
          return {
            ...ob,
            estimatedAmountPln: formatSafeNumberGroszeToPln(incomeAccrued),
            accruedAmountPln: formatSafeNumberGroszeToPln(incomeAccrued),
            confirmedPaidAmountPln: formatSafeNumberGroszeToPln(incomePaid),
            remainingUnpaidAmountPln: formatSafeNumberGroszeToPln(incomeRem),
            settlementLifecycleStatus: incomeLifecycle,
          };
        }
        if (ob.category === 'vat' && calcSource.vatDueToPayP51Grosze !== undefined) {
          const vatDue = Math.max(0, calcSource.vatDueToPayP51Grosze);
          const vatPaid = calcSource.verifiedPayments
            .filter((p) => p.obligationKind === 'vat_settlement' && p.targetPeriod === input.period)
            .reduce((acc, p) => acc + p.amountGrosze, 0);
          const vatRem = Math.max(0, vatDue - vatPaid);
          return {
            ...ob,
            estimatedAmountPln: formatSafeNumberGroszeToPln(vatDue),
            accruedAmountPln: formatSafeNumberGroszeToPln(vatDue),
            confirmedPaidAmountPln: formatSafeNumberGroszeToPln(vatPaid),
            remainingUnpaidAmountPln: formatSafeNumberGroszeToPln(vatRem),
            settlementLifecycleStatus:
              vatRem === 0 ? 'paid' : vatPaid > 0 ? 'partially_paid' : 'accrued_not_yet_due',
          };
        }
        return ob;
      });
    }
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_monthly_tax_obligations',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: auth.actor.reason,
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: false,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: GetMonthlyTaxObligationsOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      obligations: enrichedObligations,
      auditEventId,
    }),
  };
}

export async function handleExplainTaxCalculation(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ExplainTaxCalculationOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ExplainTaxCalculationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'explain_tax_calculation',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry wywołania explain_tax_calculation.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'explain_tax_calculation',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const profile = await resolveAuthorizedCompanyTaxProfile(
    env,
    auth.actor.userId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  if (!profile) {
    return denyMcpToolCall(env, {
      toolName: 'explain_tax_calculation',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'company_tax_profile_not_found',
      messagePl: 'Nie znaleziono profilu podatkowego wybranej firmy.',
    });
  }

  const taxYear = Number(input.period.slice(0, 4));
  if (resolveCompanyProfileSupportStatus(profile, taxYear) === 'unsupported') {
    return denyMcpToolCall(env, {
      toolName: 'explain_tax_calculation',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'tax_year_unsupported',
      messagePl: `Kalkulacja podatkowa dla roku ${taxYear} ma status unsupported.`,
    });
  }

  const calcSource = env.dataSource.getTaxCalculationSourceData
    ? await env.dataSource.getTaxCalculationSourceData(
        auth.actor.tenantId,
        auth.actor.legalEntityId,
        input.period,
      )
    : null;

  const effectiveSource: McpTaxCalculationSourceData = calcSource ?? {
    zusScheme: 'duzy_zus',
    voluntarySicknessInsurance: false,
    previousMonthIncomeForHealthGrosze: 0,
    ytdRevenueGrosze: 0,
    ytdTaxDeductibleCostsGrosze: 0,
    ryczaltEntries: [],
    verifiedPayments: [],
  };

  const mode =
    input.simulationOnly === true
      ? ('what_if_simulation' as const)
      : ('binding_verified_payments_only' as const);

  let profileCode: ExplainTaxCalculationOutput['profileCode'];
  let bindingForDeclaration: boolean;
  let zusAccrued = 0;
  let zusPaid = 0;
  let zusRem = 0;
  let unpaidZusExcluded = 0;
  let taxAccrued: number;
  let taxPaid: number;
  let taxRem: number;
  let appliedCitRatePct: 9 | 19 | null = null;
  let explanation: LegalExplanation;

  try {
    if (profile.taxRegime === 'kpir_skala' || profile.taxRegime === 'kpir_liniowy') {
      const taxForm = profile.taxRegime === 'kpir_liniowy' ? 'liniowy' : 'skala';
      const res = calculateProfileAKpirObligations({
        period: input.period,
        taxForm,
        zusScheme: effectiveSource.zusScheme,
        voluntarySicknessInsurance: effectiveSource.voluntarySicknessInsurance,
        previousMonthIncomeForHealthGrosze: effectiveSource.previousMonthIncomeForHealthGrosze,
        ytdRevenueGrosze: effectiveSource.ytdRevenueGrosze,
        ytdCostsGrosze: effectiveSource.ytdTaxDeductibleCostsGrosze,
        previousAdvancesAccruedDueYtdGrosze:
          effectiveSource.previousPitOrCitAdvancesAccruedYtdGrosze ?? 0,
        verifiedPayments: effectiveSource.verifiedPayments,
        mode,
        ...(input.simulatedPaidSocialZusPln !== undefined
          ? {
              simulatedPaidSocialZusYtdGrosze: Number(
                parsePlnToGrosze(input.simulatedPaidSocialZusPln),
              ),
            }
          : {}),
        ...(input.simulatedPaidHealthZusPln !== undefined
          ? {
              simulatedPaidHealthYtdGrosze: Number(
                parsePlnToGrosze(input.simulatedPaidHealthZusPln),
              ),
            }
          : {}),
      });
      profileCode = res.profileCode;
      bindingForDeclaration = res.bindingForDeclaration;
      zusAccrued = res.accruedZus.totalZusToPayGrosze;
      zusPaid =
        res.zusSettlements.social.confirmedPaidGrosze +
        res.zusSettlements.health.confirmedPaidGrosze +
        res.zusSettlements.laborFund.confirmedPaidGrosze;
      zusRem = Math.max(0, zusAccrued - zusPaid);
      unpaidZusExcluded = res.unpaidAccruedZusExcludedFromDeductionGrosze;
      taxAccrued = res.pitAdvanceSettlement.accruedDueGrosze;
      taxPaid = res.pitAdvanceSettlement.confirmedPaidGrosze;
      taxRem = res.pitAdvanceSettlement.remainingUnpaidGrosze;
      explanation = res.explanation;
    } else if (profile.taxRegime === 'ryczalt') {
      const res = calculateProfileBRyczaltObligations({
        period: input.period,
        zusScheme: effectiveSource.zusScheme,
        voluntarySicknessInsurance: effectiveSource.voluntarySicknessInsurance,
        entries: effectiveSource.ryczaltEntries,
        verifiedPayments: effectiveSource.verifiedPayments,
        socialZusAlreadyDeductedPriorMonthsYtdGrosze:
          effectiveSource.socialZusAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
        health50PctAlreadyDeductedPriorMonthsYtdGrosze:
          effectiveSource.health50PctAlreadyDeductedPriorMonthsYtdGrosze ?? 0,
        mode,
        ...(input.simulatedPaidSocialZusPln !== undefined
          ? {
              simulatedPaidSocialInMonthGrosze: Number(
                parsePlnToGrosze(input.simulatedPaidSocialZusPln),
              ),
            }
          : {}),
        ...(input.simulatedPaidHealthZusPln !== undefined
          ? {
              simulatedPaidHealthInMonthGrosze: Number(
                parsePlnToGrosze(input.simulatedPaidHealthZusPln),
              ),
            }
          : {}),
      });
      profileCode = res.profileCode;
      bindingForDeclaration = res.bindingForDeclaration;
      zusAccrued = res.accruedZus.totalZusToPayGrosze;
      zusPaid =
        res.zusSettlements.social.confirmedPaidGrosze +
        res.zusSettlements.health.confirmedPaidGrosze +
        res.zusSettlements.laborFund.confirmedPaidGrosze;
      zusRem = Math.max(0, zusAccrued - zusPaid);
      unpaidZusExcluded =
        res.zusSettlements.social.remainingUnpaidGrosze +
        Math.floor((res.zusSettlements.health.remainingUnpaidGrosze + 1) / 2);
      taxAccrued = res.ryczaltSettlement.accruedDueGrosze;
      taxPaid = res.ryczaltSettlement.confirmedPaidGrosze;
      taxRem = res.ryczaltSettlement.remainingUnpaidGrosze;
      explanation = res.explanation;
    } else {
      const request9Pct =
        input.requestPreferentialCit9Pct !== undefined
          ? input.requestPreferentialCit9Pct
          : Boolean(
              effectiveSource.smallTaxpayer &&
              effectiveSource.citPreferentialEligibility &&
              effectiveSource.taxYearStartDate &&
              effectiveSource.taxYearEndDate,
            );

      const explicitAttest = input.citPreferentialAttestation;
      const res = calculateProfileCCitObligations({
        period: input.period,
        operatingRevenuesYtdGrosze: effectiveSource.ytdRevenueGrosze,
        operatingTaxDeductibleCostsYtdGrosze: effectiveSource.ytdTaxDeductibleCostsGrosze,
        previousAdvancesAccruedDueYtdGrosze:
          effectiveSource.previousPitOrCitAdvancesAccruedYtdGrosze ?? 0,
        verifiedPayments: effectiveSource.verifiedPayments,
        requestPreferential9PctRate: request9Pct,
        ...(explicitAttest
          ? {
              taxYearStartDate: explicitAttest.taxYearStartDate,
              taxYearEndDate: explicitAttest.taxYearEndDate,
              preferentialEligibility: {
                smallTaxpayerVerified: explicitAttest.smallTaxpayerVerified,
                ...(explicitAttest.priorYearGrossSalesPln !== undefined
                  ? {
                      priorYearGrossSalesGrosze: Number(
                        parsePlnToGrosze(explicitAttest.priorYearGrossSalesPln),
                      ),
                    }
                  : {}),
                isFirstTaxYearNewEntityVerified: explicitAttest.isFirstTaxYearNewEntityVerified,
                excludedRestructuringArt19Ust1aVerified:
                  explicitAttest.excludedRestructuringArt19Ust1aVerified,
                excludedTaxCapitalGroupOrSplitVerified:
                  explicitAttest.excludedTaxCapitalGroupOrSplitVerified,
              },
            }
          : effectiveSource.taxYearStartDate && effectiveSource.taxYearEndDate
            ? {
                taxYearStartDate: effectiveSource.taxYearStartDate,
                taxYearEndDate: effectiveSource.taxYearEndDate,
                ...(effectiveSource.citPreferentialEligibility
                  ? { preferentialEligibility: effectiveSource.citPreferentialEligibility }
                  : {}),
              }
            : {}),
      });
      profileCode = res.profileCode;
      bindingForDeclaration = !input.simulationOnly;
      appliedCitRatePct = res.operatingAppliedRatePct;
      taxAccrued = res.citAdvanceSettlement.accruedDueGrosze;
      taxPaid = res.citAdvanceSettlement.confirmedPaidGrosze;
      taxRem = res.citAdvanceSettlement.remainingUnpaidGrosze;
      explanation = res.explanation;
    }
  } catch (err) {
    if (err instanceof CitPreferentialEligibilityError) {
      return denyMcpToolCall(env, {
        toolName: 'explain_tax_calculation',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        errorCode: 'validation_failed',
        reasonCode: err.reasonCode,
        messagePl: err.message,
      });
    }
    throw err;
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'explain_tax_calculation',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: 'tax_calculation_explained_due_vs_paid',
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: false,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  const mappedRules =
    explanation.appliedRules.length > 0
      ? explanation.appliedRules.map(mapDomainLegalRuleToMcpRef)
      : [VERIFIED_POLISH_LEGAL_BASIS_CATALOG['KUP_OGOLNE']!.legalBasis];

  return {
    ok: true,
    data: ExplainTaxCalculationOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      profileCode,
      mode,
      bindingForDeclaration,
      dueVsPaidSummary: {
        zusAccruedTotalPln: formatSafeNumberGroszeToPln(zusAccrued),
        zusConfirmedPaidTotalPln: formatSafeNumberGroszeToPln(zusPaid),
        zusRemainingUnpaidPln: formatSafeNumberGroszeToPln(zusRem),
        unpaidZusExcludedFromTaxDeductionPln: formatSafeNumberGroszeToPln(unpaidZusExcluded),
        incomeTaxOrRyczaltAccruedPln: formatSafeNumberGroszeToPln(taxAccrued),
        incomeTaxOrRyczaltConfirmedPaidPln: formatSafeNumberGroszeToPln(taxPaid),
        incomeTaxOrRyczaltRemainingUnpaidPln: formatSafeNumberGroszeToPln(taxRem),
        appliedCitRatePct,
        vatOutputPln: formatSafeNumberGroszeToPln(effectiveSource.vatOutputGrosze ?? 0),
        vatDeductibleInputPln: formatSafeNumberGroszeToPln(
          effectiveSource.vatDeductibleInputGrosze ?? 0,
        ),
        vatPriorCarryoverP39Pln: formatSafeNumberGroszeToPln(
          effectiveSource.vatPriorCarryoverP39Grosze ?? 0,
        ),
        vatDueToPayP51Pln: formatSafeNumberGroszeToPln(effectiveSource.vatDueToPayP51Grosze ?? 0),
        vatNextCarryoverP62Pln: formatSafeNumberGroszeToPln(
          effectiveSource.vatNextCarryoverP62Grosze ?? 0,
        ),
      },
      summaryPl: explanation.summary.slice(0, 1450),
      warningsPl: explanation.warnings.map((w) => w.message.slice(0, 580)),
      calculationSteps: mapDomainExplanationStepsToMcp(explanation),
      appliedRules: mappedRules,
      auditEventId,
    }),
  };
}

export async function handleExplainAccountingItem(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ExplainAccountingItemOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ExplainAccountingItemInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'explain_accounting_item',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry zapytania o kwalifikację pozycji księgowej.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'explain_accounting_item',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const item = await env.dataSource.getAccountingItemExplanation(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.accountingItemId.toLowerCase(),
  );

  if (
    !item ||
    item.tenantId !== auth.actor.tenantId ||
    item.legalEntityId !== auth.actor.legalEntityId
  ) {
    return denyMcpToolCall(env, {
      toolName: 'explain_accounting_item',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'accounting_item_not_found',
      messagePl: 'Nie znaleziono wskazanej pozycji księgowej w wybranej firmie.',
    });
  }

  const sanitizedSummary = sanitizeUntrustedDocumentTextForMcp(item.sourceDocumentSummary, {
    field: 'accountingItem.sourceDocumentSummary',
    maxLength: 800,
  });

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'explain_accounting_item',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: auth.actor.reason,
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: sanitizedSummary.promptInjectionSuspected,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: ExplainAccountingItemOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      accountingItemId: item.accountingItemId.toLowerCase(),
      classification: {
        kupAmountPln: item.kupAmountPln,
        nkupAmountPln: item.nkupAmountPln,
        deductibleVatAmountPln: item.deductibleVatAmountPln,
        nonDeductibleVatAmountPln: item.nonDeductibleVatAmountPln,
        taxCategoryCode: item.taxCategoryCode,
        summaryPl: item.summaryPl,
      },
      calculationSteps: [...item.calculationSteps],
      appliedRules: [...item.appliedRules],
      sourceDocumentSummary: sanitizedSummary,
      auditEventId,
    }),
  };
}

export async function handleGetLegalBasis(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetLegalBasisOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetLegalBasisInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_legal_basis',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry zapytania o podstawę prawną.',
    });
  }

  const input = parsed.data;
  let actorUserId: string;
  let actorIssuer: string;
  let actorSubject: string;
  let verifiedTenantId: string | null = null;
  let verifiedLegalEntityId: string | null = null;

  if (input.tenantId !== undefined || input.legalEntityId !== undefined) {
    if (!input.tenantId || !input.legalEntityId) {
      return denyMcpToolCall(env, {
        toolName: 'get_legal_basis',
        correlationId,
        errorCode: 'invalid_selector',
        reasonCode: 'incomplete_company_selector',
        messagePl: 'Podając kontekst firmy, wskaż jednocześnie tenantId i legalEntityId.',
      });
    }
    const auth = await authorizeCompanyScopedMcpTool(env, {
      toolName: 'get_legal_basis',
      correlationId,
      rawBearerToken: callContext.rawBearerToken,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      action: 'read',
      requiredScopes: ['pap:mcp:read'],
    });
    if (!auth.ok) {
      return auth;
    }
    actorUserId = auth.actor.userId;
    actorIssuer = auth.actor.identity.issuer;
    actorSubject = auth.actor.identity.subject;
    verifiedTenantId = auth.actor.tenantId;
    verifiedLegalEntityId = auth.actor.legalEntityId;
  } else {
    const actor = await authenticateGlobalMcpToolActor(env, {
      toolName: 'get_legal_basis',
      correlationId,
      rawBearerToken: callContext.rawBearerToken,
      requiredScopes: ['pap:mcp:read'],
    });
    if (!actor.ok) {
      return actor;
    }
    actorUserId = actor.userId;
    actorIssuer = actor.identity.issuer;
    actorSubject = actor.identity.subject;
  }

  const asOfDate = input.asOfDate ?? env.clock.now().toISOString().slice(0, 10);
  const normalizedCode = input.obligationOrRuleCode.trim().toUpperCase();
  const entry =
    (await env.dataSource.getLegalBasisEntry(normalizedCode, asOfDate)) ??
    VERIFIED_POLISH_LEGAL_BASIS_CATALOG[normalizedCode] ??
    null;

  if (!entry) {
    return denyMcpToolCall(env, {
      toolName: 'get_legal_basis',
      correlationId,
      actorUserId,
      actorIssuer,
      actorSubject,
      tenantId: verifiedTenantId,
      legalEntityId: verifiedLegalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'legal_basis_rule_not_found',
      messagePl: `Brak zweryfikowanej reguły prawnej o kodzie ${normalizedCode} na dzień ${asOfDate}.`,
    });
  }

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_legal_basis',
    correlationId,
    actorUserId,
    actorIssuer,
    actorSubject,
    tenantId: verifiedTenantId,
    legalEntityId: verifiedLegalEntityId,
    outcome: 'allow',
    reasonCode: 'verified_legal_basis_returned',
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: false,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: GetLegalBasisOutputSchema.parse({
      code: entry.code,
      titlePl: entry.titlePl,
      summaryPl: entry.summaryPl,
      legalBasis: entry.legalBasis,
      exceptionsPl: [...entry.exceptionsPl],
      disclaimerPl:
        'Informacja oparta na zweryfikowanym katalogu reguł Polish Accounting Platform. Nie stanowi indywidualnej interpretacji podatkowej; ostateczna kwalifikacja i wysyłka deklaracji wymagają zatwierdzenia przez osobę uprawnioną.',
      auditEventId,
    }),
  };
}

const DEFAULT_FALLBACK_POLISH_ADDRESS: JpkPolishAddress = {
  voivodeship: 'MAZOWIECKIE',
  county: 'WARSZAWA',
  municipality: 'WARSZAWA',
  street: 'UL. TESTOWA',
  buildingNumber: '10',
  city: 'WARSZAWA',
  postalCode: '00-001',
};

function resolveFallbackSubject(
  profile: CompanyTaxProfile,
  displayName: string,
  rawNip: string,
): { readonly subject: JpkTaxpayerSubject; readonly usedFallbackNip: boolean } {
  const cleanNip = isValidPolishNip(rawNip) ? rawNip : '5260250995';
  const usedFallbackNip = cleanNip !== rawNip;
  if (profile.legalForm === 'jdg') {
    return {
      subject: {
        kind: 'natural_person',
        nip: cleanNip,
        firstName: 'Jan',
        lastName: 'Testowy',
        birthDate: '1985-05-15',
        email: 'biuro@syntetyczny.example',
      },
      usedFallbackNip,
    };
  }
  return {
    subject: {
      kind: 'legal_entity',
      nip: cleanNip,
      fullName: displayName || 'Podmiot Syntetyczny Sp. z o.o.',
      email: 'biuro@syntetyczny.example',
    },
    usedFallbackNip,
  };
}

function roundGroszeHalfUpPlnInt(grosze: number): number {
  const sign = grosze < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(Math.trunc(grosze)) + 50) / 100);
}

export async function handlePreviewJpkExport(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PreviewJpkExportOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PreviewJpkExportInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry podglądu JPK (wymagany okres RRRR-MM).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'preview_jpk_export',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const profile = await resolveAuthorizedCompanyTaxProfile(
    env,
    auth.actor.userId,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
  );
  if (!profile) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'resource_not_found',
      reasonCode: 'company_tax_profile_not_found',
      messagePl: 'Nie znaleziono profilu podatkowego firmy.',
    });
  }

  const [yearStr = '2026', monthStr = '01'] = input.period.split('-');
  const taxYear = Number(yearStr);
  const taxMonth = Number(monthStr);
  const yearSupport = resolveCompanyProfileSupportStatus(profile, taxYear);
  if (yearSupport === 'unsupported') {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_tax_year_unsupported',
      messagePl: `Podgląd JPK dla roku ${taxYear} ma status unsupported.`,
    });
  }

  const expectedIncomeFamily: JpkSchemaFamily =
    profile.taxRegime === 'ryczalt'
      ? 'JPK_EWP'
      : profile.taxRegime === 'cit_klasyczny'
        ? 'JPK_KR_PD'
        : 'JPK_PKPIR';
  const expectedAssetsFamily: JpkSchemaFamily =
    profile.taxRegime === 'cit_klasyczny' ? 'JPK_ST_KR' : 'JPK_ST';

  const schemaFamily: JpkSchemaFamily =
    input.schemaFamily ?? (profile.vatStatus === 'czynny' ? 'JPK_V7M' : expectedIncomeFamily);

  if (
    (schemaFamily === 'JPK_V7M' || schemaFamily === 'JPK_V7K') &&
    profile.vatStatus !== 'czynny'
  ) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_v7_unsupported_for_vat_exempt_company',
      messagePl:
        'Podatnik zwolniony z VAT nie składa deklaracji JPK_V7M/JPK_V7K — użyj struktury ewidencji dochodowej właściwej dla reżimu firmy.',
    });
  }

  if (
    schemaFamily !== 'JPK_V7M' &&
    schemaFamily !== 'JPK_V7K' &&
    schemaFamily !== expectedIncomeFamily &&
    schemaFamily !== expectedAssetsFamily
  ) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_schema_family_mismatch_for_regime',
      messagePl: `Struktura ${schemaFamily} jest niezgodna z reżimem podatkowym firmy (${profile.taxRegime}; właściwe struktury: ${expectedIncomeFamily}, ${expectedAssetsFamily}).`,
    });
  }

  if (schemaFamily === 'JPK_V7K' && (taxYear < 2026 || (taxYear === 2026 && taxMonth < 2))) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'capability_unsupported',
      reasonCode: 'jpk_v7k3_not_effective_before_2026_02',
      messagePl: 'Struktura JPK_V7K(3) obowiązuje od rozliczenia za luty 2026 r.',
    });
  }

  const isFromFeb2026 = taxYear > 2026 || (taxYear === 2026 && taxMonth >= 2);
  const officialSchemaCode: OfficialJpkStructureCode =
    schemaFamily === 'JPK_V7M'
      ? isFromFeb2026
        ? 'JPK_V7M(3)'
        : 'JPK_V7M(2)'
      : schemaFamily === 'JPK_V7K'
        ? 'JPK_V7K(3)'
        : schemaFamily === 'JPK_PKPIR'
          ? 'JPK_PKPIR(3)'
          : schemaFamily === 'JPK_EWP'
            ? 'JPK_EWP(4)'
            : schemaFamily === 'JPK_KR_PD'
              ? 'JPK_KR_PD(1)'
              : schemaFamily === 'JPK_ST'
                ? 'JPK_ST(1)'
                : 'JPK_ST_KR(1)';

  const nowMs = env.clock.now().getTime();
  let unverifiedProposalsBlockingCount = 0;
  for (const prop of env.state.proposalsById.values()) {
    if (
      prop.tenantId === auth.actor.tenantId &&
      prop.legalEntityId === auth.actor.legalEntityId &&
      (prop.status === 'pending_human_approval' || prop.status === 'confirming') &&
      nowMs < prop.expiresAtMs &&
      prop.invoice.issueDate.startsWith(input.period)
    ) {
      unverifiedProposalsBlockingCount += 1;
    }
  }

  const jpkSource: McpJpkPeriodSourceData | null = env.dataSource.getJpkPeriodSourceData
    ? await env.dataSource.getJpkPeriodSourceData(
        auth.actor.tenantId,
        auth.actor.legalEntityId,
        input.period,
      )
    : null;

  const candidateCompanies = await env.dataSource.listCandidateCompaniesForUser(auth.actor.userId);
  const directoryEntry = candidateCompanies.find(
    (c) => c.tenantId === auth.actor.tenantId && c.legalEntityId === auth.actor.legalEntityId,
  );
  const fallbackSubj = resolveFallbackSubject(
    profile,
    directoryEntry?.displayName ?? 'Podmiot Syntetyczny',
    directoryEntry?.nip ?? '5260250995',
  );

  const taxpayerSubject = jpkSource?.subject ?? fallbackSubj.subject;
  const taxOfficeCode = jpkSource?.taxOfficeCode ?? '1435';
  const purpose: 1 | 2 = input.purpose ?? 1;
  const rawClockIso = env.clock.now().toISOString();
  const generatedAtIso =
    (officialSchemaCode === 'JPK_V7M(3)' || officialSchemaCode === 'JPK_V7K(3)') &&
    rawClockIso < '2026-02-01T00:00:00.000Z'
      ? '2026-02-01T00:00:00.000Z'
      : rawClockIso;
  const dateTo = lastDayOfPeriodIso(input.period);

  const readinessWarningsPl: string[] = [];
  if (unverifiedProposalsBlockingCount > 0) {
    readinessWarningsPl.push(
      `W okresie ${input.period} oczekują niezatwierdzone propozycje MCP (${unverifiedProposalsBlockingCount}) — zatwierdź lub odrzuć je przed generowaniem ostatecznego pliku JPK.`,
    );
  }
  const monthCloseRaw = await env.dataSource.getMonthCloseRawData(
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );
  if (monthCloseRaw.missingDocuments.some((d) => d.blocking)) {
    readinessWarningsPl.push(
      'Wykryto dokumenty oczekujące na weryfikację człowieka na liście kontrolnej zamknięcia okresu.',
    );
  }
  if (!jpkSource && fallbackSubj.usedFallbackNip) {
    readinessWarningsPl.push(
      'Zastosowano zastępczy poprawny numer NIP w nagłówku podglądu XML dla danych testowych bez pełnego rekordu podatnika.',
    );
  }

  let salesEntriesCount = 0;
  let purchaseEntriesCount = 0;
  let outputVatPln: string;
  let deductibleInputVatPln: string;
  let taxDuePln = '0.00';
  let excessCarryForwardPln = '0.00';
  const isQuarterlyMonth3 = schemaFamily === 'JPK_V7K' && taxMonth % 3 === 0;
  const isNonDeclarationQuarterly = schemaFamily === 'JPK_V7K' && taxMonth % 3 !== 0;
  const qCarry = isQuarterlyMonth3 ? jpkSource?.quarterlyPriorMonthsCarryGrosze : undefined;
  const priorCarryP39Pln = isNonDeclarationQuarterly
    ? 0
    : isQuarterlyMonth3
      ? (jpkSource?.quarterlyStartPriorExcessCarryoverPln ??
        jpkSource?.priorExcessCarryoverPln ??
        0)
      : (jpkSource?.priorExcessCarryoverPln ?? 0);
  const requestedRefundP54Pln = isNonDeclarationQuarterly
    ? 0
    : (jpkSource?.requestedRefundPln ?? 0);
  let clampedP54 = 0;

  let fallbackVatSalesRows: JpkV7SalesRowInput[] = [];
  let fallbackVatPurchaseRows: JpkV7PurchaseRowInput[] = [];

  if (jpkSource?.vatSalesRows || jpkSource?.vatPurchaseRows || qCarry) {
    const sRows = jpkSource?.vatSalesRows ?? [];
    const pRows = jpkSource?.vatPurchaseRows ?? [];
    salesEntriesCount = sRows.length;
    purchaseEntriesCount = pRows.length;
    const sumVat5 =
      sRows.reduce((acc, r) => acc + (r.vat5Grosze ?? 0), 0) + (qCarry?.vat5Grosze ?? 0);
    const sumVat8 =
      sRows.reduce((acc, r) => acc + (r.vat8Grosze ?? 0), 0) + (qCarry?.vat8Grosze ?? 0);
    const sumVat23 =
      sRows.reduce((acc, r) => acc + (r.vat23Grosze ?? 0), 0) + (qCarry?.vat23Grosze ?? 0);
    const outGrosze = sumVat5 + sumVat8 + sumVat23;
    const sumFixedVat =
      pRows.reduce((acc, r) => acc + (r.fixedAssetsVatGrosze ?? 0), 0) +
      (qCarry?.fixedAssetsVatGrosze ?? 0);
    const sumOtherVat =
      pRows.reduce((acc, r) => acc + (r.otherAcquisitionsVatGrosze ?? 0), 0) +
      (qCarry?.otherAcquisitionsVatGrosze ?? 0);
    const inGrosze = sumFixedVat + sumOtherVat;
    outputVatPln = formatSafeNumberGroszeToPln(outGrosze);
    deductibleInputVatPln = formatSafeNumberGroszeToPln(inGrosze);
    if (isNonDeclarationQuarterly) {
      taxDuePln = '0.00';
      excessCarryForwardPln = '0.00';
      clampedP54 = 0;
    } else {
      const p38 =
        roundGroszeHalfUpPlnInt(sumVat5) +
        roundGroszeHalfUpPlnInt(sumVat8) +
        roundGroszeHalfUpPlnInt(sumVat23);
      const p48 =
        priorCarryP39Pln +
        roundGroszeHalfUpPlnInt(sumFixedVat) +
        roundGroszeHalfUpPlnInt(sumOtherVat);
      const p51 = Math.max(0, p38 - p48);
      const p53 = Math.max(0, p48 - p38);
      clampedP54 = Math.min(p53, Math.max(0, requestedRefundP54Pln));
      const p62 = p53 - clampedP54;
      taxDuePln = formatSafeNumberGroszeToPln(p51 * 100);
      excessCarryForwardPln = formatSafeNumberGroszeToPln(p62 * 100);
    }
    fallbackVatSalesRows = [...sRows];
    fallbackVatPurchaseRows = [...pRows];
  } else {
    const vatSnapshot = env.dataSource.getVatPeriodPreviewSnapshot
      ? await env.dataSource.getVatPeriodPreviewSnapshot(
          auth.actor.tenantId,
          auth.actor.legalEntityId,
          input.period,
        )
      : null;

    if (vatSnapshot) {
      salesEntriesCount = vatSnapshot.salesEntriesCount;
      purchaseEntriesCount = vatSnapshot.purchaseEntriesCount;
      outputVatPln = vatSnapshot.outputVatPln;
      deductibleInputVatPln = vatSnapshot.deductibleInputVatPln;
      taxDuePln = vatSnapshot.taxDuePln;
      excessCarryForwardPln = vatSnapshot.excessCarryForwardPln;
      const outGrosze = Number(parsePlnToGrosze(vatSnapshot.outputVatPln));
      const inGrosze = Number(parsePlnToGrosze(vatSnapshot.deductibleInputVatPln));
      if (outGrosze > 0) {
        const approxNet = Math.round((outGrosze * 100) / 23);
        fallbackVatSalesRows = [
          {
            counterpartyName: 'Sprzedaż zagregowana okresu',
            counterpartyTin: '5260258904',
            documentNumber: `RO/${input.period}/01`,
            issueDate: dateTo,
            ksefMarker: { kind: 'BFK' },
            documentType: 'RO',
            net23Grosze: approxNet,
            vat23Grosze: outGrosze,
          },
        ];
      }
      if (inGrosze > 0) {
        const approxNet = Math.round((inGrosze * 100) / 23);
        fallbackVatPurchaseRows = [
          {
            supplierName: 'Zakupy zagregowane okresu',
            supplierTin: '5260258904',
            documentNumber: `WEW/${input.period}/01`,
            purchaseDate: dateTo,
            ksefMarker: { kind: 'BFK' },
            documentType: 'WEW',
            otherAcquisitionsNetGrosze: approxNet,
            otherAcquisitionsVatGrosze: inGrosze,
          },
        ];
      }
    } else {
      const unpaid = await env.dataSource.listUnpaidInvoices(
        auth.actor.tenantId,
        auth.actor.legalEntityId,
      );
      let outVatGrosze = 0n;
      let inVatGrosze = 0n;
      for (const inv of unpaid) {
        if (!inv.issueDate.startsWith(input.period)) {
          continue;
        }
        const netGr = Number(parsePlnToGrosze(inv.netAmountPln));
        const vatGr = parsePlnToGrosze(inv.vatAmountPln);
        if (inv.direction === 'sales') {
          salesEntriesCount += 1;
          outVatGrosze += vatGr;
          fallbackVatSalesRows.push({
            counterpartyName: inv.counterpartyName,
            counterpartyTin: '5260258904',
            documentNumber: inv.invoiceNumber,
            issueDate: inv.issueDate,
            ksefMarker: inv.ksefReferenceNumber
              ? { kind: 'KSEF', ksefNumber: inv.ksefReferenceNumber }
              : { kind: 'BFK' },
            ...(Number(vatGr) > 0
              ? { net23Grosze: netGr, vat23Grosze: Number(vatGr) }
              : { exemptNetGrosze: netGr }),
          });
        } else {
          purchaseEntriesCount += 1;
          if (profile.vatStatus === 'czynny') {
            inVatGrosze += vatGr;
            fallbackVatPurchaseRows.push({
              supplierName: inv.counterpartyName,
              supplierTin: '5260258904',
              documentNumber: inv.invoiceNumber,
              purchaseDate: inv.issueDate,
              ksefMarker: inv.ksefReferenceNumber
                ? { kind: 'KSEF', ksefNumber: inv.ksefReferenceNumber }
                : { kind: 'BFK' },
              otherAcquisitionsNetGrosze: netGr,
              otherAcquisitionsVatGrosze: Number(vatGr),
            });
          }
        }
      }
      outputVatPln = formatGroszeToPln(outVatGrosze);
      deductibleInputVatPln = formatGroszeToPln(inVatGrosze);
      if (outVatGrosze >= inVatGrosze) {
        taxDuePln = formatGroszeToPln(outVatGrosze - inVatGrosze);
      } else {
        excessCarryForwardPln = formatGroszeToPln(inVatGrosze - outVatGrosze);
      }
    }
  }

  const schemaEntry = getOfficialMfSchemaEntry(officialSchemaCode);
  const validManifestUrl = OfficialHttpsUrlSchema.safeParse(schemaEntry.officialSourceUrl);
  const officialSourceUrl = validManifestUrl.success
    ? validManifestUrl.data
    : 'https://www.gov.pl/web/kas/struktury-jpk';

  let preparedArtifact: PreparedJpkExportArtifact | null = null;

  try {
    if (
      officialSchemaCode === 'JPK_V7M(3)' ||
      officialSchemaCode === 'JPK_V7K(3)' ||
      officialSchemaCode === 'JPK_V7M(2)'
    ) {
      preparedArtifact = prepareValidatedJpkExport({
        structureCode: officialSchemaCode,
        payload: {
          generatedAtIso,
          purpose,
          taxOfficeCode,
          year: taxYear,
          month: taxMonth,
          subject: taxpayerSubject,
          salesRows: fallbackVatSalesRows,
          purchaseRows: fallbackVatPurchaseRows,
          priorExcessCarryoverPln: priorCarryP39Pln,
          requestedRefundPln: clampedP54,
          ...(isQuarterlyMonth3 && qCarry ? { quarterlyPriorMonthsCarryGrosze: qCarry } : {}),
          ...(purpose === 2
            ? { correctionJustification: 'Korekta podglądu roboczego JPK_VAT w systemie PAP.' }
            : {}),
        },
      });
    } else if (officialSchemaCode === 'JPK_PKPIR(3)') {
      const rows = jpkSource?.pkpirRows ?? [];
      if (rows.length > 0) {
        preparedArtifact = prepareValidatedJpkExport({
          structureCode: 'JPK_PKPIR(3)',
          payload: {
            purpose,
            generatedAtIso,
            dateFrom: `${taxYear}-01-01`,
            dateTo,
            taxOfficeCode,
            subject: taxpayerSubject,
            openingInventoryGrosze: jpkSource?.openingInventoryGrosze ?? 0,
            closingInventoryGrosze: jpkSource?.closingInventoryGrosze ?? 0,
            rows,
          },
        });
      } else {
        readinessWarningsPl.push(
          'Brak zaksięgowanych zapisów KPiR w wybranym okresie — oficjalna schema XSD JPK_PKPIR(3) wymaga co najmniej 1 wiersza (TNaturalnyJPK >= 1).',
        );
      }
    } else if (officialSchemaCode === 'JPK_EWP(4)') {
      const rows = jpkSource?.ewpRows ?? [];
      if (rows.length > 0) {
        preparedArtifact = prepareValidatedJpkExport({
          structureCode: 'JPK_EWP(4)',
          payload: {
            purpose,
            generatedAtIso,
            dateFrom: `${taxYear}-01-01`,
            dateTo,
            taxOfficeCode,
            subject: taxpayerSubject,
            rows,
          },
        });
      } else {
        readinessWarningsPl.push(
          'Brak zaksięgowanych przychodów ryczałtowych w wybranym okresie — oficjalna schema XSD JPK_EWP(4) wymaga co najmniej 1 wiersza (TNaturalnyJPK >= 1).',
        );
      }
    } else if (officialSchemaCode === 'JPK_KR_PD(1)') {
      const zois7 = jpkSource?.zois7Accounts ?? [];
      const jeRows = jpkSource?.journalEntries ?? [];
      if (zois7.length > 0 && jeRows.length > 0) {
        const corpNip = taxpayerSubject.nip;
        const corpName =
          taxpayerSubject.kind === 'legal_entity'
            ? taxpayerSubject.fullName
            : `${taxpayerSubject.firstName} ${taxpayerSubject.lastName}`;
        preparedArtifact = prepareValidatedJpkExport({
          structureCode: 'JPK_KR_PD(1)',
          payload: {
            purpose,
            generatedAtIso,
            dateFrom: `${taxYear}-01-01`,
            dateTo,
            financialYearFrom: `${taxYear}-01-01`,
            financialYearTo: `${taxYear}-12-31`,
            taxOfficeCode,
            companyNip: corpNip,
            companyFullName: corpName,
            ...(jpkSource?.companyRegon ? { companyRegon: jpkSource.companyRegon } : {}),
            address: jpkSource?.corporateAddress ?? DEFAULT_FALLBACK_POLISH_ADDRESS,
            zois7Accounts: zois7,
            journalEntries: jeRows,
            ...(jpkSource?.rpdSummary ? { rpd: jpkSource.rpdSummary } : {}),
          },
        });
      } else {
        readinessWarningsPl.push(
          'Brak zaksięgowanych dekretów Dziennika lub zestawienia ZOiS7 w wybranym okresie — oficjalna schema XSD JPK_KR_PD(1) wymaga niepustego ZOiS i Dziennika.',
        );
      }
    } else if (officialSchemaCode === 'JPK_ST(1)') {
      const isRyczalt = profile.taxRegime === 'ryczalt';
      preparedArtifact = prepareValidatedJpkExport({
        structureCode: 'JPK_ST(1)',
        payload: isRyczalt
          ? {
              purpose,
              generatedAtIso,
              dateFrom: `${taxYear}-01-01`,
              dateTo,
              taxOfficeCode,
              subject: taxpayerSubject,
              registerBranch: 'EWP',
              rows: jpkSource?.stEwpRows ?? [],
            }
          : {
              purpose,
              generatedAtIso,
              dateFrom: `${taxYear}-01-01`,
              dateTo,
              taxOfficeCode,
              subject: taxpayerSubject,
              registerBranch: 'PKPIR',
              rows: jpkSource?.stPkpirRows ?? [],
            },
      });
    } else {
      const stKrRows = jpkSource?.stKrAssets ?? [];
      if (stKrRows.length > 0) {
        const corpName =
          taxpayerSubject.kind === 'legal_entity'
            ? taxpayerSubject.fullName
            : `${taxpayerSubject.firstName} ${taxpayerSubject.lastName}`;
        preparedArtifact = prepareValidatedJpkExport({
          structureCode: 'JPK_ST_KR(1)',
          payload: {
            purpose,
            generatedAtIso,
            financialYearFrom: `${taxYear}-01-01`,
            financialYearTo: `${taxYear}-12-31`,
            taxOfficeCode,
            companyNip: taxpayerSubject.nip,
            companyFullName: corpName,
            address: jpkSource?.corporateAddress ?? DEFAULT_FALLBACK_POLISH_ADDRESS,
            assets: stKrRows,
          },
        });
      } else {
        readinessWarningsPl.push(
          'Brak ujętych środków trwałych w ewidencji ksiąg rachunkowych — oficjalna schema XSD JPK_ST_KR(1) wymaga co najmniej 1 pozycji ST_KR.',
        );
      }
    }
  } catch (err) {
    return denyMcpToolCall(env, {
      toolName: 'preview_jpk_export',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      errorCode: 'xsd_validation_failed',
      reasonCode: 'official_mf_xsd_validation_failed',
      messagePl:
        err instanceof Error
          ? `Walidacja offline wygenerowanego pliku ${officialSchemaCode} względem oficjalnej schemy XSD MF zakończyła się błędem: ${err.message.slice(0, 350)}`
          : `Walidacja offline XSD MF dla ${officialSchemaCode} nie powiodła się.`,
    });
  }

  const schemaVersionCode =
    officialSchemaCode === 'JPK_V7M(3)'
      ? 'JPK_V7M(3) 1-0E'
      : officialSchemaCode === 'JPK_V7K(3)'
        ? 'JPK_V7K(3) 1-0E'
        : officialSchemaCode === 'JPK_V7M(2)'
          ? 'JPK_V7M(2) 1-0E'
          : officialSchemaCode;

  const legalBasis =
    schemaFamily === 'JPK_V7M' || schemaFamily === 'JPK_V7K'
      ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['JPK_V7M']!.legalBasis
      : schemaFamily === 'JPK_EWP'
        ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['RYCZALT_PRZYCHOD_EWIDENCJA']!.legalBasis
        : schemaFamily === 'JPK_KR_PD' || schemaFamily === 'JPK_ST_KR'
          ? VERIFIED_POLISH_LEGAL_BASIS_CATALOG['CIT_PRZYCHOD_SPRZEDAZ']!.legalBasis
          : VERIFIED_POLISH_LEGAL_BASIS_CATALOG['KUP_OGOLNE']!.legalBasis;

  const capabilityStatus: 'supported' | 'experimental' =
    (schemaFamily === 'JPK_V7M' || schemaFamily === 'JPK_V7K') && yearSupport === 'supported'
      ? 'supported'
      : 'experimental';

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'preview_jpk_export',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: preparedArtifact
      ? 'jpk_xml_generated_and_xsd_validated_offline_no_submission'
      : 'jpk_preview_summary_generated_awaiting_ledger_rows',
    idempotencyKey: null,
    proposalId: null,
    payloadHash: preparedArtifact?.xmlSha256Hex ?? null,
    promptInjectionSuspected: false,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: PreviewJpkExportOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      schemaFamily,
      schemaVersionCode,
      capabilityStatus,
      officialSubmissionPerformed: false,
      upoReferenceNumber: null,
      summary: {
        salesEntriesCount,
        purchaseEntriesCount,
        outputVatPln,
        deductibleInputVatPln,
        taxDuePln,
        excessCarryForwardPln,
        ...(schemaFamily === 'JPK_V7M' ||
        (schemaFamily === 'JPK_V7K' && Number(input.period.slice(5, 7)) % 3 === 0)
          ? {
              priorExcessCarryoverP39Pln: formatSafeNumberGroszeToPln(priorCarryP39Pln * 100),
              requestedRefundP54Pln: formatSafeNumberGroszeToPln(clampedP54 * 100),
            }
          : {}),
        unverifiedProposalsBlockingCount,
      },
      xsdValidation: {
        performed: Boolean(preparedArtifact),
        valid: preparedArtifact ? preparedArtifact.xsdValidation.valid : false,
        officialSchemaCode,
        targetNamespace: schemaEntry.targetNamespace,
        schemaSha256: schemaEntry.sha256,
        officialSourceUrl,
        issues: preparedArtifact
          ? preparedArtifact.xsdValidation.issues.map((i) => ({
              line: Math.max(0, i.line),
              column: Math.max(0, i.column),
              message: i.message.slice(0, 580),
            }))
          : [],
      },
      xmlSha256Hex: preparedArtifact ? preparedArtifact.xmlSha256Hex : null,
      xmlByteLength: preparedArtifact ? preparedArtifact.xmlByteLength : 0,
      xmlContent:
        input.includeXml === true && preparedArtifact ? preparedArtifact.xmlContent : null,
      readinessWarningsPl,
      legalBasis,
      disclaimerPl: preparedArtifact
        ? preparedArtifact.truthfulnessNoticePl
        : 'Podgląd roboczy JPK wygenerowany przez MCP bez podpisu elektronicznego i bez wysyłki do Ministerstwa Finansów (brak UPO).',
      auditEventId,
    }),
  };
}
