import { z } from 'zod';

export const IsoCalendarDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Wymagany format daty YYYY-MM-DD');

export const TaxPeriodMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Wymagany format okresu podatkowego YYYY-MM');

export const TaxProfileCodeSchema = z.enum([
  'jdg_kpir_skala',
  'jdg_kpir_liniowy',
  'jdg_ryczalt',
  'spzoo_pelne_ksiegi',
]);

export const ProfileSupportLevelSchema = z.enum([
  'supported',
  'reviewed',
  'experimental',
  'planned',
]);

export const LegalSourceTypeSchema = z.enum([
  'statute',
  'regulation',
  'official_guidance',
  'schema',
]);

export const RuleVerificationStatusSchema = z.enum([
  'verified',
  'requires_expert_review',
  'unverified',
]);

export const LegalBasisSchema = z
  .object({
    actTitle: z.string().min(1),
    journalReference: z.string().min(1),
    article: z.string().min(1),
    paragraph: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

export const RuleReferenceTestCaseSchema = z
  .object({
    id: z.string().min(1),
    description: z.string().min(1),
    eventDate: IsoCalendarDateSchema,
    inputSummary: z.string().min(1),
    expectedOutputSummary: z.string().min(1),
  })
  .strict();

export const LegalRuleParameterValueSchema = z.union([z.number(), z.string(), z.boolean()]);

export const LegalRuleSchema = z
  .object({
    id: z.string().min(1),
    ruleCode: z.string().min(1),
    version: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    scope: z.array(TaxProfileCodeSchema).min(1),
    validFrom: IsoCalendarDateSchema,
    validTo: IsoCalendarDateSchema.nullable(),
    legalBasis: LegalBasisSchema,
    sourceUrl: z.url().refine((value) => value.startsWith('https://'), {
      message: 'Źródło urzędowe musi używać protokołu HTTPS',
    }),
    sourceType: LegalSourceTypeSchema,
    verifiedAt: IsoCalendarDateSchema,
    verificationStatus: RuleVerificationStatusSchema,
    exceptions: z.array(z.string().min(1)),
    referenceTestCases: z.array(RuleReferenceTestCaseSchema).min(1),
    parameters: z.record(z.string(), LegalRuleParameterValueSchema).optional(),
  })
  .strict()
  .refine((rule) => rule.validTo === null || rule.validTo >= rule.validFrom, {
    message: 'Data validTo nie może być wcześniejsza niż validFrom',
    path: ['validTo'],
  });

export const AppliedRuleSummarySchema = z
  .object({
    id: z.string().min(1),
    ruleCode: z.string().min(1),
    version: z.string().min(1),
    title: z.string().min(1),
    actTitle: z.string().min(1),
    journalReference: z.string().min(1),
    article: z.string().min(1),
    sourceUrl: z.url(),
    sourceType: LegalSourceTypeSchema,
    verificationStatus: RuleVerificationStatusSchema,
    validFrom: IsoCalendarDateSchema,
    validTo: IsoCalendarDateSchema.nullable(),
  })
  .strict();

export const ExplanationStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    label: z.string().min(1),
    formula: z.string().min(1),
    inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    resultFormatted: z.string().min(1),
    resultGrosze: z.number().int().optional(),
  })
  .strict();

export const ExplanationWarningSeveritySchema = z.enum([
  'info',
  'warning',
  'requires_expert_review',
]);

export const ExplanationWarningSchema = z
  .object({
    code: z.string().min(1),
    severity: ExplanationWarningSeveritySchema,
    message: z.string().min(1),
  })
  .strict();

export const LegalExplanationSchema = z
  .object({
    calculationType: z.string().min(1),
    summary: z.string().min(1),
    eventDate: IsoCalendarDateSchema,
    appliedRules: z.array(AppliedRuleSummarySchema).min(1),
    steps: z.array(ExplanationStepSchema).min(1),
    inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    outputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    warnings: z.array(ExplanationWarningSchema),
    requiresHumanApproval: z.boolean(),
  })
  .strict();

export type IsoCalendarDate = z.infer<typeof IsoCalendarDateSchema>;
export type TaxPeriodMonth = z.infer<typeof TaxPeriodMonthSchema>;
export type TaxProfileCode = z.infer<typeof TaxProfileCodeSchema>;
export type ProfileSupportLevel = z.infer<typeof ProfileSupportLevelSchema>;
export type LegalSourceType = z.infer<typeof LegalSourceTypeSchema>;
export type RuleVerificationStatus = z.infer<typeof RuleVerificationStatusSchema>;
export type LegalBasis = z.infer<typeof LegalBasisSchema>;
export type RuleReferenceTestCase = z.infer<typeof RuleReferenceTestCaseSchema>;
export type LegalRuleParameterValue = z.infer<typeof LegalRuleParameterValueSchema>;
export type LegalRuleContract = z.infer<typeof LegalRuleSchema>;
export type AppliedRuleSummaryContract = z.infer<typeof AppliedRuleSummarySchema>;
export type ExplanationStepContract = z.infer<typeof ExplanationStepSchema>;
export type ExplanationWarningSeverity = z.infer<typeof ExplanationWarningSeveritySchema>;
export type ExplanationWarningContract = z.infer<typeof ExplanationWarningSchema>;
export type LegalExplanationContract = z.infer<typeof LegalExplanationSchema>;
