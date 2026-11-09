import { z } from 'zod';
import {
  AcademyCourseSchema,
  FieldHelpEntrySchema,
  GlossaryTermSchema,
  QuizEvaluationResultSchema,
  QuizOptionIndexSchema,
} from './academy.js';
import {
  AccountingDocumentSchema,
  BankReconciliationMatchSchema,
  BankStatementTransactionSchema,
  DocumentLineItemSchema,
  HealthContributionTierSchema,
  JournalEntryLineSchema,
  JournalEntrySchema,
  KpirEntrySchema,
  KpirExpenseQualificationKindSchema,
  KsefInvoiceMarkerSchema,
  NonNegativeGroszeSchema,
  RyczaltEntrySchema,
  RyczaltRateCodeSchema,
  SafeGroszeSchema,
  TaxObligationCategorySchema,
  TaxProfileConfigSchema,
  VatDeductionModeSchema,
  VatRateCodeSchema,
  VatRegisterEntrySchema,
  VatSettlementPeriodSchema,
  VatStatusSchema,
  ZusSchemeSchema,
} from './accounting.js';
import {
  IsoCalendarDateSchema,
  LegalExplanationSchema,
  LegalRuleSchema,
  TaxPeriodMonthSchema,
  TaxProfileCodeSchema,
} from './legal-rules.js';
import {
  ConfirmPreparedProposalOutputSchema,
  IsoDateSchema,
  IsoUtcTimestampSchema,
  LegalBasisReferenceSchema,
  PrepareProposalLifecycleStatusSchema,
  ProposedAccountingPreviewSchema,
  ProposedPostingCategorySchema,
  Sha256HexSchema,
  UntrustedDocumentTextEnvelopeSchema,
  UuidSelectorSchema,
} from './mcp-tools.js';
import {
  NotificationFrequencySchema,
  NotificationOutboxEntrySchema,
  NotificationPreferencesSchema,
  ReminderStageSchema,
  SafeEmailAddressSchema,
} from './notifications.js';

export const CompanyLegalFormSchema = z.enum(['jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna']);
export type CompanyLegalFormContract = z.infer<typeof CompanyLegalFormSchema>;

export const CompanyTaxRegimeSchema = z.enum([
  'kpir_skala',
  'kpir_liniowy',
  'ryczalt',
  'cit_klasyczny',
]);
export type CompanyTaxRegimeContract = z.infer<typeof CompanyTaxRegimeSchema>;

export const CompanyVatStatusSimpleSchema = z.enum(['czynny', 'zwolniony']);
export type CompanyVatStatusSimpleContract = z.infer<typeof CompanyVatStatusSimpleSchema>;

export const TenantMemberRoleSchema = z.enum(['tenant_owner', 'tenant_admin', 'tenant_member']);
export type TenantMemberRoleContract = z.infer<typeof TenantMemberRoleSchema>;

export const SandboxTenantRoleLabelCodeSchema = z.enum(['owner', 'accountant']);
export type SandboxTenantRoleLabelCode = z.infer<typeof SandboxTenantRoleLabelCodeSchema>;

/** 1. Sandbox OIDC (/api/v1/oidc/* & /api/v1/auth/sandbox/*) */
export const SandboxPersonaCompanyAccessSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    displayName: z.string().min(1),
    canRead: z.boolean(),
    canWrite: z.boolean(),
  })
  .strict();

export const SandboxPersonaSchema = z
  .object({
    personaId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(160),
    email: SafeEmailAddressSchema,
    userId: UuidSelectorSchema,
    subject: z.string().min(1).max(160),
    tenantId: UuidSelectorSchema,
    tenantName: z.string().min(1).max(160),
    role: TenantMemberRoleSchema,
    tenantRole: SandboxTenantRoleLabelCodeSchema.optional(),
    defaultLegalEntityId: UuidSelectorSchema.optional(),
    roleLabelPl: z.string().min(1).max(160),
    descriptionPl: z.string().min(1).max(500),
    defaultScopes: z.array(z.string().min(1)).min(1),
    companyAccess: z.array(SandboxPersonaCompanyAccessSchema),
  })
  .strict();

export type SandboxPersonaContract = z.infer<typeof SandboxPersonaSchema>;

export const ListSandboxPersonasResponseSchema = z
  .object({
    issuer: z.string().min(1),
    personas: z.array(SandboxPersonaSchema).min(1),
  })
  .strict();

export type ListSandboxPersonasResponse = z.infer<typeof ListSandboxPersonasResponseSchema>;

export const IssueSandboxTokenRequestSchema = z
  .object({
    personaId: z.string().min(1).max(64),
    scopes: z.array(z.string().min(1).max(80)).min(1).max(16).optional(),
    period: TaxPeriodMonthSchema.optional(),
    sub: z.string().min(1).max(160).optional(),
  })
  .strict();

export type IssueSandboxTokenRequest = z.infer<typeof IssueSandboxTokenRequestSchema>;

export const IssueSandboxTokenResponseSchema = z
  .object({
    accessToken: z.string().min(32),
    token: z.string().min(32),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int().positive(),
    expiresAt: IsoUtcTimestampSchema,
    issuer: z.string().min(1),
    scope: z.string().min(1),
    persona: SandboxPersonaSchema,
  })
  .strict();

export type IssueSandboxTokenResponse = z.infer<typeof IssueSandboxTokenResponseSchema>;

export const OidcSigningAlgSchema = z.enum(['ES256', 'RS256', 'PS256', 'EdDSA']);
export type OidcSigningAlgContract = z.infer<typeof OidcSigningAlgSchema>;

export const OidcDiscoveryDocumentSchema = z
  .object({
    issuer: z.string().min(1),
    authorization_endpoint: z.string().min(1).optional(),
    end_session_endpoint: z.string().min(1).optional(),
    jwks_uri: z.string().min(1),
    token_endpoint: z.string().min(1),
    response_types_supported: z.array(z.string().min(1)),
    grant_types_supported: z.array(z.string().min(1)),
    code_challenge_methods_supported: z.array(z.literal('S256')).min(1).optional(),
    subject_types_supported: z.array(z.string().min(1)),
    id_token_signing_alg_values_supported: z.array(OidcSigningAlgSchema).min(1),
    token_endpoint_auth_methods_supported: z.array(z.string().min(1)),
    scopes_supported: z.array(z.string().min(1)),
  })
  .strict();

export type OidcDiscoveryDocument = z.infer<typeof OidcDiscoveryDocumentSchema>;

/** 2. Actor & Company Directory (/api/v1/me/companies, GET/POST /api/v1/tenants/:tenantId/companies) */
export const AuthenticatedActorSummarySchema = z
  .object({
    userId: UuidSelectorSchema,
    issuer: z.string().min(1),
    subject: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

export type AuthenticatedActorSummary = z.infer<typeof AuthenticatedActorSummarySchema>;

export const CompanyStructuredAddressSchema = z
  .object({
    street: z.string().min(1).max(200),
    buildingNumber: z.string().min(1).max(40),
    unitNumber: z.string().max(40).nullable().optional(),
    postalCode: z.string().regex(/^\d{2}-\d{3}$/, 'Kod pocztowy musi mieć format XX-XXX'),
    city: z.string().min(1).max(120),
    voivodeship: z.string().min(1).max(80).optional(),
    taxOfficeName: z.string().min(1).max(200).optional(),
    countryCode: z.string().length(2).optional(),
  })
  .strict();

export type CompanyStructuredAddressContract = z.infer<typeof CompanyStructuredAddressSchema>;

export const CompanyAddressSchema = z.union([
  z.string().min(2).max(400),
  CompanyStructuredAddressSchema,
]);

export type CompanyAddressContract = z.infer<typeof CompanyAddressSchema>;

export const AccessibleCompanyItemSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    displayName: z.string().min(1).max(240),
    nip: z.string().regex(/^\d{10}$/, 'NIP musi składać się z 10 cyfr'),
    legalForm: CompanyLegalFormSchema,
    taxRegime: CompanyTaxRegimeSchema,
    vatStatus: CompanyVatStatusSimpleSchema,
    zusStage: ZusSchemeSchema,
    role: TenantMemberRoleSchema,
    canRead: z.boolean(),
    canWrite: z.boolean(),
    address: CompanyAddressSchema.optional(),
    street: z.string().min(1).max(240).optional(),
    buildingNumber: z.string().min(1).max(40).optional(),
    unitNumber: z.string().max(40).nullable().optional(),
    postalCode: z.string().min(1).max(20).optional(),
    city: z.string().min(1).max(160).optional(),
    voivodeship: z.string().min(1).max(120).optional(),
    taxOfficeName: z.string().min(1).max(240).optional(),
  })
  .strict();

export type AccessibleCompanyItem = z.infer<typeof AccessibleCompanyItemSchema>;

export const GetMyCompaniesResponseSchema = z
  .object({
    actor: AuthenticatedActorSummarySchema,
    companies: z.array(AccessibleCompanyItemSchema),
  })
  .strict();

export type GetMyCompaniesResponse = z.infer<typeof GetMyCompaniesResponseSchema>;

export const CreateCompanyRequestSchema = z
  .object({
    displayName: z.string().min(2).max(240).optional(),
    companyName: z.string().min(2).max(240).optional(),
    address: CompanyAddressSchema.optional(),
    street: z.string().min(1).max(200).optional(),
    buildingNumber: z.string().min(1).max(40).optional(),
    unitNumber: z.string().max(40).nullable().optional(),
    postalCode: z
      .string()
      .regex(/^\d{2}-\d{3}$/, 'Kod pocztowy musi mieć format XX-XXX')
      .optional(),
    city: z.string().min(1).max(120).optional(),
    voivodeship: z.string().min(1).max(80).optional(),
    taxOfficeName: z.string().min(1).max(200).optional(),
    nip: z.string().regex(/^\d{10}$/, 'NIP musi składać się z 10 cyfr'),
    legalForm: CompanyLegalFormSchema,
    taxRegime: CompanyTaxRegimeSchema.optional(),
    profileCode: TaxProfileCodeSchema.optional(),
    vatStatus: z.union([VatStatusSchema, CompanyVatStatusSimpleSchema]).optional(),
    vatPayer: z.boolean().optional(),
    vatSettlementPeriod: VatSettlementPeriodSchema.optional(),
    vatPeriod: VatSettlementPeriodSchema.optional(),
    zusStage: ZusSchemeSchema.optional(),
    zusScheme: ZusSchemeSchema.optional(),
    activityStartDate: IsoCalendarDateSchema.optional(),
    regon: z
      .string()
      .regex(/^(\d{9}|\d{14})$/)
      .optional(),
    krs: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    voluntarySicknessInsurance: z.boolean().optional(),
    smallTaxpayer: z.boolean().optional(),
    ksefEnabled: z.boolean().optional(),
    ryczaltDefaultRate: RyczaltRateCodeSchema.optional(),
    healthContributionTier: HealthContributionTierSchema.optional(),
    accidentRateBps: z.number().int().min(0).max(500).optional(),
    insuredPersonsCount: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.displayName && !val.companyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['displayName'],
        message: 'Wymagane jest podanie nazwy firmy (displayName lub companyName).',
      });
    }
    if (!val.taxRegime && !val.profileCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taxRegime'],
        message: 'Wymagane jest podanie formy opodatkowania (taxRegime lub profileCode).',
      });
    }
    if (val.vatStatus === undefined && val.vatPayer === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['vatStatus'],
        message: 'Wymagane jest podanie statusu VAT (vatStatus lub vatPayer).',
      });
    }
  });

export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequestSchema>;

export const CreateCompanyResponseSchema = z
  .object({
    company: AccessibleCompanyItemSchema,
    taxProfile: TaxProfileConfigSchema,
    address: CompanyAddressSchema.optional(),
  })
  .strict();

export type CreateCompanyResponse = z.infer<typeof CreateCompanyResponseSchema>;

/** 3. Legal Rules & Academy (/api/v1/legal-rules*, /api/v1/academy/*) */
export const LegalBasisCatalogItemSchema = z
  .object({
    code: z.string().min(1),
    titlePl: z.string().min(1),
    summaryPl: z.string().min(1),
    legalBasis: LegalBasisReferenceSchema,
    exceptionsPl: z.array(z.string()),
  })
  .strict();

export const ListLegalRulesResponseSchema = z
  .object({
    asOfDate: IsoCalendarDateSchema,
    rules: z.array(LegalRuleSchema),
    catalogEntries: z.array(LegalBasisCatalogItemSchema),
  })
  .strict();

export type ListLegalRulesResponse = z.infer<typeof ListLegalRulesResponseSchema>;

export const GetLegalRuleDetailResponseSchema = z
  .object({
    code: z.string().min(1),
    asOfDate: IsoCalendarDateSchema,
    rule: LegalRuleSchema.nullable(),
    catalogEntry: LegalBasisCatalogItemSchema.nullable(),
    explanationSummaryPl: z.string().min(1),
  })
  .strict();

export type GetLegalRuleDetailResponse = z.infer<typeof GetLegalRuleDetailResponseSchema>;

export const ExplainLegalRuleRequestSchema = z
  .object({
    ruleCode: z.string().min(1).max(80),
    asOfDate: IsoCalendarDateSchema.optional(),
    amountGrosze: SafeGroszeSchema.optional(),
    contextDescriptionPl: z.string().min(1).max(400).optional(),
  })
  .strict();

export type ExplainLegalRuleRequest = z.infer<typeof ExplainLegalRuleRequestSchema>;

export const ExplainLegalRuleResponseSchema = z
  .object({
    ruleCode: z.string().min(1),
    asOfDate: IsoCalendarDateSchema,
    explanation: LegalExplanationSchema,
  })
  .strict();

export type ExplainLegalRuleResponse = z.infer<typeof ExplainLegalRuleResponseSchema>;

export const GetAcademyCourseResponseSchema = z
  .object({
    course: AcademyCourseSchema,
    glossary: z.array(GlossaryTermSchema),
    fieldHelp: z.array(FieldHelpEntrySchema),
    disclaimer: z.string().min(1),
  })
  .strict();

export type GetAcademyCourseResponse = z.infer<typeof GetAcademyCourseResponseSchema>;

export const GradeAcademyLessonRequestSchema = z
  .object({
    answers: z.record(z.string(), QuizOptionIndexSchema),
    passingThresholdPercent: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type GradeAcademyLessonRequest = z.infer<typeof GradeAcademyLessonRequestSchema>;

export const GradeAcademyLessonResponseSchema = QuizEvaluationResultSchema;
export type GradeAcademyLessonResponse = z.infer<typeof GradeAcademyLessonResponseSchema>;

/** 4. Shared Company Workspace Entities */
export const SettlementStatusSchema = z.enum(['open', 'partially_paid', 'paid', 'overdue']);
export type SettlementStatusContract = z.infer<typeof SettlementStatusSchema>;

export const SettlementItemSchema = z
  .object({
    settlementId: UuidSelectorSchema,
    documentId: UuidSelectorSchema,
    documentNumber: z.string().min(1),
    direction: z.enum(['receivable', 'payable']),
    counterpartyName: z.string().min(1),
    counterpartyNip: z.string().nullable(),
    issueDate: IsoCalendarDateSchema,
    dueDate: IsoCalendarDateSchema,
    grossGrosze: NonNegativeGroszeSchema,
    settledGrosze: NonNegativeGroszeSchema,
    remainingGrosze: NonNegativeGroszeSchema,
    remainingFormatted: z.string().min(1),
    status: SettlementStatusSchema,
    daysOverdue: z.number().int().nonnegative(),
    ksefReferenceNumber: z.string().nullable(),
  })
  .strict();

export type SettlementItemContract = z.infer<typeof SettlementItemSchema>;

export const CalendarWorkflowStatusSchema = z.enum(['upcoming', 'due_soon', 'overdue', 'paid']);
export type CalendarWorkflowStatusContract = z.infer<typeof CalendarWorkflowStatusSchema>;

export const CalendarObligationItemSchema = z
  .object({
    obligationId: UuidSelectorSchema,
    code: z.string().min(1),
    title: z.string().min(1),
    category: TaxObligationCategorySchema,
    period: TaxPeriodMonthSchema,
    statutoryDueDate: IsoCalendarDateSchema,
    effectiveDueDate: IsoCalendarDateSchema,
    shiftedFromNonWorkingDays: z.array(
      z
        .object({
          date: IsoCalendarDateSchema,
          reason: z.string().min(1),
        })
        .strict(),
    ),
    applicabilityStatus: z.enum(['applicable', 'exempt_transitional', 'informational']),
    workflowStatus: CalendarWorkflowStatusSchema,
    estimatedAmountGrosze: NonNegativeGroszeSchema.nullable(),
    estimatedAmountFormatted: z.string().nullable(),
    paidAt: IsoUtcTimestampSchema.nullable(),
    explanation: LegalExplanationSchema,
  })
  .strict();

export type CalendarObligationItemContract = z.infer<typeof CalendarObligationItemSchema>;

export const CompanyAuditItemSchema = z
  .object({
    auditEventId: z.string().min(1),
    occurredAt: IsoUtcTimestampSchema,
    channel: z.enum(['security', 'access', 'accounting', 'mcp', 'notifications']),
    action: z.string().min(1),
    actorDisplayLabel: z.string().min(1),
    outcome: z.enum(['allow', 'deny', 'error']),
    reasonCode: z.string().min(1),
    summaryPl: z.string().min(1),
  })
  .strict();

export type CompanyAuditItemContract = z.infer<typeof CompanyAuditItemSchema>;

/** 5. Dashboard / Overview (/dashboard, /overview) */
export const RegimeComparisonSummarySchema = z
  .object({
    currentRegime: CompanyTaxRegimeSchema,
    alternativeRegime: CompanyTaxRegimeSchema,
    currentTaxPlusHealthGrosze: NonNegativeGroszeSchema,
    currentTaxPlusHealthFormatted: z.string().min(1),
    alternativeTaxPlusHealthGrosze: NonNegativeGroszeSchema,
    alternativeTaxPlusHealthFormatted: z.string().min(1),
    differenceGrosze: SafeGroszeSchema,
    differenceFormatted: z.string().min(1),
    summaryPl: z.string().min(1),
  })
  .strict();

export const CompanyOverviewResponseSchema = z
  .object({
    company: AccessibleCompanyItemSchema,
    taxProfile: TaxProfileConfigSchema,
    period: TaxPeriodMonthSchema,
    kpis: z
      .object({
        revenueGrosze: SafeGroszeSchema,
        revenueFormatted: z.string().min(1),
        expensesKupGrosze: SafeGroszeSchema,
        expensesKupFormatted: z.string().min(1),
        incomeOrProfitGrosze: SafeGroszeSchema,
        incomeOrProfitFormatted: z.string().min(1),
        unpaidReceivablesGrosze: NonNegativeGroszeSchema,
        unpaidReceivablesFormatted: z.string().min(1),
        unpaidPayablesGrosze: NonNegativeGroszeSchema,
        unpaidPayablesFormatted: z.string().min(1),
        overdueInvoicesCount: z.number().int().nonnegative(),
      })
      .strict(),
    taxSummary: z
      .object({
        incomeTaxLabelPl: z.string().min(1),
        incomeTaxGrosze: NonNegativeGroszeSchema,
        incomeTaxFormatted: z.string().min(1),
        vatLabelPl: z.string().min(1),
        vatPayableGrosze: NonNegativeGroszeSchema,
        vatCarryForwardGrosze: NonNegativeGroszeSchema,
        vatFormatted: z.string().min(1),
        zusTotalGrosze: NonNegativeGroszeSchema,
        zusTotalFormatted: z.string().min(1),
        regimeComparison: RegimeComparisonSummarySchema.nullable(),
      })
      .strict(),
    upcomingDeadlines: z.array(CalendarObligationItemSchema),
    unpaidInvoices: z.array(SettlementItemSchema),
    pendingApprovals: z
      .object({
        aiDocumentProposalsCount: z.number().int().nonnegative(),
        mcpProposalsCount: z.number().int().nonnegative(),
        totalPendingCount: z.number().int().nonnegative(),
      })
      .strict(),
    recentAuditEvents: z.array(CompanyAuditItemSchema),
  })
  .strict();

export type CompanyOverviewResponse = z.infer<typeof CompanyOverviewResponseSchema>;

/** 6. Settings & Access (/settings, /grants*) */
export const CompanySettingsHistoryItemSchema = z
  .object({
    version: z.number().int().positive(),
    effectiveFrom: IsoCalendarDateSchema,
    changedAt: IsoUtcTimestampSchema,
    changedByUserId: UuidSelectorSchema,
    changeSummaryPl: z.string().min(1),
    taxProfile: TaxProfileConfigSchema,
  })
  .strict();

export const CompanySettingsResponseSchema = z
  .object({
    company: AccessibleCompanyItemSchema,
    taxProfile: TaxProfileConfigSchema,
    history: z.array(CompanySettingsHistoryItemSchema).min(1),
  })
  .strict();

export type CompanySettingsResponse = z.infer<typeof CompanySettingsResponseSchema>;

export const UpdateCompanySettingsRequestSchema = z
  .object({
    displayName: z.string().min(2).max(240).optional(),
    companyName: z.string().min(2).max(240).optional(),
    profileCode: TaxProfileCodeSchema.optional(),
    vatStatus: z.union([VatStatusSchema, CompanyVatStatusSimpleSchema]).optional(),
    vatPayer: z.boolean().optional(),
    vatSettlementPeriod: VatSettlementPeriodSchema.optional(),
    vatPeriod: VatSettlementPeriodSchema.optional(),
    zusScheme: ZusSchemeSchema.optional(),
    voluntarySicknessInsurance: z.boolean().optional(),
    accidentRateBps: z.number().int().min(0).max(500).optional(),
    insuredPersonsCount: z.number().int().min(0).optional(),
    smallTaxpayer: z.boolean().optional(),
    ksefEnabled: z.boolean().optional(),
    ryczaltDefaultRate: RyczaltRateCodeSchema.optional(),
    healthContributionTier: HealthContributionTierSchema.optional(),
    address: CompanyAddressSchema.optional(),
    street: z.string().min(1).max(240).optional(),
    buildingNumber: z.string().min(1).max(40).optional(),
    unitNumber: z.string().max(40).nullable().optional(),
    postalCode: z.string().min(1).max(20).optional(),
    city: z.string().min(1).max(160).optional(),
    voivodeship: z.string().min(1).max(120).optional(),
    taxOfficeName: z.string().min(1).max(240).optional(),
    effectiveFrom: IsoCalendarDateSchema.optional(),
    changeSummaryPl: z.string().min(3).max(400).optional(),
  })
  .strict();

export type UpdateCompanySettingsRequest = z.infer<typeof UpdateCompanySettingsRequestSchema>;

export const CompanyAccessMemberItemSchema = z
  .object({
    userId: UuidSelectorSchema,
    displayName: z.string().min(1),
    maskedEmail: z.string().min(3),
    tenantRole: TenantMemberRoleSchema,
    status: z.enum(['active', 'revoked']),
  })
  .strict();

export const CompanyAccessGrantItemSchema = z
  .object({
    grantId: UuidSelectorSchema,
    userId: UuidSelectorSchema,
    displayName: z.string().min(1),
    action: z.enum(['read', 'write']),
    validFrom: IsoUtcTimestampSchema.nullable(),
    validUntil: IsoUtcTimestampSchema.nullable(),
    revokedAt: IsoUtcTimestampSchema.nullable(),
    active: z.boolean(),
  })
  .strict();

export const CompanyAccessResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    members: z.array(CompanyAccessMemberItemSchema),
    grants: z.array(CompanyAccessGrantItemSchema),
  })
  .strict();

export type CompanyAccessResponse = z.infer<typeof CompanyAccessResponseSchema>;

export const GrantCompanyAccessRequestSchema = z
  .object({
    targetUserId: UuidSelectorSchema,
    action: z.enum(['read', 'write']),
    grantId: UuidSelectorSchema.optional(),
    validFrom: IsoUtcTimestampSchema.nullable().optional(),
    validUntil: IsoUtcTimestampSchema.nullable().optional(),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict();

export type GrantCompanyAccessRequest = z.infer<typeof GrantCompanyAccessRequestSchema>;

export const RevokeCompanyAccessRequestSchema = z
  .object({
    targetUserId: UuidSelectorSchema.optional(),
    grantId: UuidSelectorSchema.optional(),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict();

export type RevokeCompanyAccessRequest = z.infer<typeof RevokeCompanyAccessRequestSchema>;

export const AccessMutationResponseSchema = z
  .object({
    ok: z.literal(true),
    receipt: z
      .object({
        operationId: UuidSelectorSchema,
        occurredAt: IsoUtcTimestampSchema,
        changed: z.boolean(),
        grantId: z.string().nullable(),
      })
      .strict(),
  })
  .strict();

export type AccessMutationResponse = z.infer<typeof AccessMutationResponseSchema>;

/** 7. Documents & AI Extraction + Human Approval (/documents*) */
export const DocumentStatusSchema = z.enum([
  'draft',
  'needs_verification',
  'ai_proposed',
  'posted',
  'archived',
]);
export type DocumentStatusContract = z.infer<typeof DocumentStatusSchema>;

export const DocumentSourceFormatSchema = z.enum([
  'manual',
  'ksef_xml',
  'json',
  'csv',
  'mcp_confirmed',
]);
export type DocumentSourceFormatContract = z.infer<typeof DocumentSourceFormatSchema>;

export const DocumentVerificationSourceSchema = z.enum([
  'not_checked',
  'deterministic_parser',
  'demo_heuristic',
  'human_verified',
  'manual_entry',
  'mcp_proposal',
]);
export type DocumentVerificationSourceContract = z.infer<typeof DocumentVerificationSourceSchema>;

export const KasWhiteListVerificationStatusSchema = z.enum([
  'not_checked',
  'demo_simulated',
  'demo_simulated_iban_check',
]);
export type KasWhiteListVerificationStatusContract = z.infer<
  typeof KasWhiteListVerificationStatusSchema
>;

export const GtuReviewStatusSchema = z.enum([
  'not_applicable',
  'requires_human_review',
  'human_confirmed',
]);
export type GtuReviewStatusContract = z.infer<typeof GtuReviewStatusSchema>;

export const DocumentAiProposalSchema = z
  .object({
    status: z.enum(['ai_proposed', 'human_approved', 'not_applicable']),
    confidenceScoreBps: z.number().int().min(0).max(10_000),
    suggestedCategory: ProposedPostingCategorySchema,
    vatDeductionMode: VatDeductionModeSchema,
    kpirQualification: KpirExpenseQualificationKindSchema,
    ryczaltRate: RyczaltRateCodeSchema.nullable(),
    ledgerAccountCode: z.string().nullable(),
    extractedSummaryPl: z.string().min(1),
    promptInjectionSuspected: z.boolean(),
    untrustedCounterpartyName: UntrustedDocumentTextEnvelopeSchema,
    untrustedDescription: UntrustedDocumentTextEnvelopeSchema,
    verificationSource: DocumentVerificationSourceSchema.optional(),
    kasWhiteListStatus: KasWhiteListVerificationStatusSchema.optional(),
    gtuReviewStatus: GtuReviewStatusSchema.optional(),
  })
  .strict();

export type DocumentAiProposalContract = z.infer<typeof DocumentAiProposalSchema>;

export const DocumentPostingResultSchema = z
  .object({
    accountingItemId: UuidSelectorSchema,
    kpirEntryId: z.string().nullable(),
    ryczaltEntryId: z.string().nullable(),
    vatEntryIds: z.array(z.string()),
    journalEntryId: z.string().nullable(),
    settlementId: UuidSelectorSchema.nullable(),
    explanation: LegalExplanationSchema,
  })
  .strict();

export type DocumentPostingResultContract = z.infer<typeof DocumentPostingResultSchema>;

export const CompanyDocumentItemSchema = z
  .object({
    documentId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: DocumentStatusSchema,
    sourceFormat: DocumentSourceFormatSchema,
    sha256Hash: Sha256HexSchema,
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
    approvedByUserId: UuidSelectorSchema.nullable(),
    approvedAt: IsoUtcTimestampSchema.nullable(),
    isCorrection: z.boolean(),
    correctedDocumentNumber: z.string().nullable(),
    correctionReason: z.string().nullable(),
    document: AccountingDocumentSchema,
    aiProposal: DocumentAiProposalSchema,
    postingResult: DocumentPostingResultSchema.nullable(),
  })
  .strict();

export type CompanyDocumentItemContract = z.infer<typeof CompanyDocumentItemSchema>;

export const DocumentsListResponseSchema = z
  .object({
    documents: z.array(CompanyDocumentItemSchema),
  })
  .strict();

export type DocumentsListResponse = z.infer<typeof DocumentsListResponseSchema>;

export const CreateDocumentLineInputSchema = z
  .object({
    description: z.string().min(1).max(1000),
    quantity: z.string().min(1).max(32).optional(),
    unit: z.string().min(1).max(16).optional(),
    netGrosze: SafeGroszeSchema,
    vatRate: VatRateCodeSchema,
    vatGrosze: SafeGroszeSchema.optional(),
    grossGrosze: SafeGroszeSchema.optional(),
    annex15Item: z.boolean().optional(),
  })
  .strict();

export const CreateDocumentStructuredInputSchema = z
  .object({
    sourceFormat: z.literal('manual').optional(),
    documentNumber: z.string().min(1).max(128),
    direction: z.enum(['sales', 'purchase']),
    issueDate: IsoCalendarDateSchema,
    eventDate: IsoCalendarDateSchema.optional(),
    dueDate: IsoCalendarDateSchema.optional(),
    counterpartyName: z.string().min(1).max(512),
    counterpartyNip: z
      .string()
      .regex(/^[A-Z]{0,2}\d{8,12}$/)
      .optional(),
    counterpartyAddress: z.string().min(1).max(512).optional(),
    counterpartyIban: z.string().min(1).max(64).optional(),
    ksefReferenceNumber: z.string().min(1).max(80).optional(),
    ksefMarker: KsefInvoiceMarkerSchema.optional(),
    suggestedCategory: ProposedPostingCategorySchema.optional(),
    vatDeductionMode: VatDeductionModeSchema.optional(),
    ryczaltRate: RyczaltRateCodeSchema.optional(),
    isCorrection: z.boolean().optional(),
    correctedDocumentNumber: z.string().min(1).max(128).optional(),
    correctionReason: z.string().min(1).max(500).optional(),
    lines: z.array(CreateDocumentLineInputSchema).min(1),
  })
  .strict();

export const CreateDocumentImportInputSchema = z
  .object({
    sourceFormat: z.enum(['ksef_xml', 'json', 'csv']),
    rawPayload: z.string().min(1).max(262_144),
    sha256: Sha256HexSchema.optional(),
    documentNumber: z.string().min(1).max(128).optional(),
    direction: z.enum(['sales', 'purchase']).optional(),
    issueDate: IsoCalendarDateSchema.optional(),
    eventDate: IsoCalendarDateSchema.optional(),
    dueDate: IsoCalendarDateSchema.optional(),
    counterpartyName: z.string().min(1).max(512).optional(),
    counterpartyNip: z
      .string()
      .regex(/^[A-Z]{0,2}\d{8,12}$/)
      .optional(),
    netGrosze: SafeGroszeSchema.optional(),
    vatGrosze: SafeGroszeSchema.optional(),
    grossGrosze: SafeGroszeSchema.optional(),
    vatRate: VatRateCodeSchema.optional(),
    description: z.string().min(1).max(1000).optional(),
    suggestedCategory: ProposedPostingCategorySchema.optional(),
    vatDeductionMode: VatDeductionModeSchema.optional(),
    ryczaltRate: RyczaltRateCodeSchema.optional(),
  })
  .strict();

export const CreateDocumentBffQuickInputSchema = z
  .object({
    sourceFormat: z.enum(['manual', 'ksef_xml', 'json', 'csv']).optional(),
    rawPayload: z.string().min(1).max(262_144).optional(),
    documentNumber: z.string().min(1).max(128),
    sha256: Sha256HexSchema,
    direction: z.enum(['sales', 'purchase']).optional(),
    issueDate: IsoCalendarDateSchema.optional(),
    eventDate: IsoCalendarDateSchema.optional(),
    dueDate: IsoCalendarDateSchema.optional(),
    counterpartyName: z.string().min(1).max(512).optional(),
    counterpartyNip: z
      .string()
      .regex(/^[A-Z]{0,2}\d{8,12}$/)
      .optional(),
    counterpartyAddress: z.string().min(1).max(512).optional(),
    ksefReferenceNumber: z.string().min(1).max(80).optional(),
    ksefMarker: KsefInvoiceMarkerSchema.optional(),
    netGrosze: SafeGroszeSchema.optional(),
    vatGrosze: SafeGroszeSchema.optional(),
    grossGrosze: SafeGroszeSchema.optional(),
    vatRate: VatRateCodeSchema.optional(),
    description: z.string().min(1).max(1000).optional(),
    suggestedCategory: ProposedPostingCategorySchema.optional(),
    vatDeductionMode: VatDeductionModeSchema.optional(),
    ryczaltRate: RyczaltRateCodeSchema.optional(),
    lines: z.array(CreateDocumentLineInputSchema).min(1).optional(),
  })
  .strict();

export const CreateDocumentRequestSchema = z.union([
  CreateDocumentStructuredInputSchema,
  CreateDocumentImportInputSchema,
  CreateDocumentBffQuickInputSchema,
]);

export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequestSchema>;

export const ApproveAndPostDocumentRequestSchema = z
  .object({
    documentId: z.string().min(1).max(128).optional(),
    documentNumber: z.string().min(1).max(128).optional(),
    issueDate: IsoCalendarDateSchema.optional(),
    eventDate: IsoCalendarDateSchema.optional(),
    dueDate: IsoCalendarDateSchema.optional(),
    counterpartyName: z.string().min(1).max(512).optional(),
    counterpartyNip: z.string().min(1).max(32).optional(),
    description: z.string().min(1).max(1000).optional(),
    netPln: z
      .string()
      .max(15, 'Kwota PLN nie może przekraczać 15 znaków.')
      .regex(/^\d+(\.\d{1,2})?$/, 'Wymagana nieujemna kwota PLN, np. 100.00')
      .optional(),
    vatPln: z
      .string()
      .max(15, 'Kwota PLN nie może przekraczać 15 znaków.')
      .regex(/^\d+(\.\d{1,2})?$/, 'Wymagana nieujemna kwota PLN, np. 23.00')
      .optional(),
    vatRate: VatRateCodeSchema.optional(),
    vatRateCode: VatRateCodeSchema.optional(),
    suggestedCategory: ProposedPostingCategorySchema.optional(),
    vatDeductionMode: VatDeductionModeSchema.optional(),
    deductionMode: VatDeductionModeSchema.optional(),
    kpirQualification: KpirExpenseQualificationKindSchema.optional(),
    expenseQualification: KpirExpenseQualificationKindSchema.optional(),
    kpirColumnNumber: z
      .union([
        z.literal(7),
        z.literal(8),
        z.literal(10),
        z.literal(11),
        z.literal(12),
        z.literal(13),
        z.literal(16),
      ])
      .optional(),
    ryczaltRate: RyczaltRateCodeSchema.optional(),
    ryczaltRateCode: RyczaltRateCodeSchema.optional(),
    ledgerAccountCode: z
      .string()
      .regex(/^\d{3}(-\d{1,4})?$/)
      .optional(),
    correctedEntryId: z.string().min(1).optional(),
    correctionReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type ApproveAndPostDocumentRequest = z.infer<typeof ApproveAndPostDocumentRequestSchema>;

/** 8. KPiR (/kpir*) */
export const KpirColumnDescriptorSchema = z
  .object({
    columnNumber: z.number().int().positive(),
    title: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const KpirPeriodTotalsSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    col7SalesRevenueGrosze: SafeGroszeSchema,
    col8OtherRevenueGrosze: SafeGroszeSchema,
    col9TotalRevenueGrosze: SafeGroszeSchema,
    col10GoodsAndMaterialsGrosze: SafeGroszeSchema,
    col11IncidentalCostsGrosze: SafeGroszeSchema,
    col12RemunerationGrosze: SafeGroszeSchema,
    col13OtherExpensesGrosze: SafeGroszeSchema,
    col14TotalExpensesGrosze: SafeGroszeSchema,
    col16ResearchDevelopmentCostGrosze: SafeGroszeSchema,
    totalTaxDeductibleCostsGrosze: SafeGroszeSchema,
    incomeOrLossGrosze: SafeGroszeSchema,
  })
  .strict();

export const KpirPitAdvanceSummarySchema = z
  .object({
    period: TaxPeriodMonthSchema,
    taxForm: z.enum(['skala', 'liniowy']),
    taxBaseRoundedPlnGrosze: NonNegativeGroszeSchema,
    advanceDueRoundedPlnGrosze: NonNegativeGroszeSchema,
    advanceDueFormatted: z.string().min(1),
    explanation: LegalExplanationSchema,
  })
  .strict();

export const KpirViewResponseSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    layout: z.enum(['2026', '2019']),
    regulationVersion: z.enum(['pkpir_2026_ksef', 'pkpir_2019_17col']),
    columns: z.array(KpirColumnDescriptorSchema).min(17),
    entries: z.array(KpirEntrySchema),
    periodSummary: KpirPeriodTotalsSchema,
    ytdSummary: KpirPeriodTotalsSchema,
    pitAdvance: KpirPitAdvanceSummarySchema,
    regimeComparison: RegimeComparisonSummarySchema.nullable(),
  })
  .strict();

export type KpirViewResponse = z.infer<typeof KpirViewResponseSchema>;

export const CreateKpirEntryRequestSchema = z
  .object({
    mode: z.enum(['standard', 'storno']).optional(),
    originalEntryId: z.string().min(1).optional(),
    targetEntryId: z.string().min(1).optional(),
    correctionDate: IsoCalendarDateSchema.optional(),
    correctionDocumentNumber: z.string().min(1).max(128).optional(),
    correctionReason: z.string().min(1).max(500).optional(),
    eventDate: IsoCalendarDateSchema.optional(),
    documentNumber: z.string().min(1).max(128).optional(),
    ksefReferenceNumber: z.string().min(1).max(80).optional(),
    counterpartyName: z.string().min(1).max(512).optional(),
    counterpartyNip: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    counterpartyAddress: z.string().min(1).max(512).optional(),
    eventDescription: z.string().min(1).max(500).optional(),
    entryKind: z
      .enum([
        'sales_revenue',
        'other_revenue',
        'goods_and_materials_col10',
        'incidental_purchase_costs_col11',
        'remuneration_col12',
        'other_expenses_100_col13',
        'vehicle_mixed_75_col13',
      ])
      .optional(),
    netGrosze: SafeGroszeSchema.optional(),
    vatRate: VatRateCodeSchema.optional(),
    vatGrosze: SafeGroszeSchema.optional(),
  })
  .strict();

export type CreateKpirEntryRequest = z.infer<typeof CreateKpirEntryRequestSchema>;

/** 9. Ryczałt (/ryczalt*) */
export const RyczaltViewResponseSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    entries: z.array(RyczaltEntrySchema),
    monthlySummary: z
      .object({
        grossRevenueGrosze: SafeGroszeSchema,
        grossRevenueFormatted: z.string().min(1),
        taxDueRoundedPlnGrosze: NonNegativeGroszeSchema,
        taxDueFormatted: z.string().min(1),
        revenueByRate: z.record(z.string(), SafeGroszeSchema),
        explanation: LegalExplanationSchema,
      })
      .strict(),
    vatExemptionLimit: z
      .object({
        limitGrosze: NonNegativeGroszeSchema,
        limitFormatted: z.string().min(1),
        ytdSalesGrosze: NonNegativeGroszeSchema,
        ytdSalesFormatted: z.string().min(1),
        remainingLimitGrosze: NonNegativeGroszeSchema,
        remainingLimitFormatted: z.string().min(1),
        utilizationBps: z.number().int().nonnegative(),
        status: z.enum(['within_limit', 'approaching_limit', 'exceeded']),
        explanation: LegalExplanationSchema,
      })
      .strict(),
  })
  .strict();

export type RyczaltViewResponse = z.infer<typeof RyczaltViewResponseSchema>;

export const CreateRyczaltEntryRequestSchema = z
  .object({
    entryDate: IsoCalendarDateSchema.optional(),
    revenueDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1).max(128),
    ksefReferenceNumber: z.string().min(1).max(80).optional(),
    counterpartyName: z.string().min(1).max(512),
    counterpartyNip: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    rate: RyczaltRateCodeSchema,
    revenueGrosze: SafeGroszeSchema,
    remarks: z.string().max(500).optional(),
    isCorrection: z.boolean().optional(),
    correctedEntryId: z.string().min(1).optional(),
    correctionReason: z.string().min(1).max(500).optional(),
  })
  .strict();

export type CreateRyczaltEntryRequest = z.infer<typeof CreateRyczaltEntryRequestSchema>;

/** 10. VAT & JPK_V7M (/vat) */
export const JpkV7mFieldsMapSchema = z.record(z.string().regex(/^P_\d{2}$/), z.number().int());

export const JpkV7mPreviewSchema = z
  .object({
    schemaCode: z.enum(['JPK_V7M(2)', 'JPK_V7M(3)']),
    period: TaxPeriodMonthSchema,
    fields: JpkV7mFieldsMapSchema,
    outputVatRoundedPlnGrosze: SafeGroszeSchema,
    inputVatDeductibleRoundedPlnGrosze: SafeGroszeSchema,
    taxDueP51Grosze: NonNegativeGroszeSchema,
    taxDueP51Formatted: z.string().min(1),
    excessInputVatP53Grosze: NonNegativeGroszeSchema,
    excessInputVatP53Formatted: z.string().min(1),
    carryForwardToNextPeriodP62Grosze: NonNegativeGroszeSchema,
    ksefMarkersSummary: z
      .object({
        NrKSeF: z.number().int().nonnegative(),
        OFF: z.number().int().nonnegative(),
        BFK: z.number().int().nonnegative(),
        DI: z.number().int().nonnegative(),
      })
      .strict(),
    explanation: LegalExplanationSchema,
  })
  .strict();

export const VatViewResponseSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    vatStatus: VatStatusSchema,
    salesEntries: z.array(VatRegisterEntrySchema),
    purchaseEntries: z.array(VatRegisterEntrySchema),
    jpkV7m: JpkV7mPreviewSchema.nullable(),
    vatExemptionLimit: z
      .object({
        limitGrosze: NonNegativeGroszeSchema,
        ytdSalesGrosze: NonNegativeGroszeSchema,
        remainingLimitGrosze: NonNegativeGroszeSchema,
        status: z.enum(['within_limit', 'approaching_limit', 'exceeded']),
        explanation: LegalExplanationSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();

export type VatViewResponse = z.infer<typeof VatViewResponseSchema>;

/** 11. Full Ledger UoR & CIT (/ledger*) */
export const LedgerAccountDefinitionSchema = z
  .object({
    code: z.string().min(3),
    name: z.string().min(1),
    accountClass: z.union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
      z.literal(7),
      z.literal(8),
    ]),
    kind: z.enum([
      'asset',
      'liability',
      'equity',
      'asset_liability',
      'cost_by_nature',
      'revenue',
      'financial_result',
    ]),
    normalBalanceSide: z.enum(['Wn', 'Ma', 'both']),
  })
  .strict();

export const TrialBalanceRowItemSchema = z
  .object({
    accountCode: z.string().min(3),
    accountName: z.string().min(1),
    turnoverWnGrosze: SafeGroszeSchema,
    turnoverMaGrosze: SafeGroszeSchema,
    endingBalanceWnGrosze: NonNegativeGroszeSchema,
    endingBalanceMaGrosze: NonNegativeGroszeSchema,
  })
  .strict();

export const LedgerViewResponseSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    chartOfAccounts: z.array(LedgerAccountDefinitionSchema),
    journalEntries: z.array(JournalEntrySchema),
    trialBalance: z
      .object({
        rows: z.array(TrialBalanceRowItemSchema),
        totalTurnoverWnGrosze: SafeGroszeSchema,
        totalTurnoverMaGrosze: SafeGroszeSchema,
        totalEndingBalanceWnGrosze: NonNegativeGroszeSchema,
        totalEndingBalanceMaGrosze: NonNegativeGroszeSchema,
        isBalanced: z.boolean(),
      })
      .strict(),
    balanceSheet: z
      .object({
        fixedAssetsGrosze: SafeGroszeSchema,
        currentAssetsGrosze: SafeGroszeSchema,
        totalAssetsGrosze: SafeGroszeSchema,
        totalAssetsFormatted: z.string().min(1),
        equityTotalGrosze: SafeGroszeSchema,
        liabilitiesAndProvisionsGrosze: SafeGroszeSchema,
        totalEquityAndLiabilitiesGrosze: SafeGroszeSchema,
        totalEquityAndLiabilitiesFormatted: z.string().min(1),
        isBalanced: z.boolean(),
      })
      .strict(),
    profitAndLoss: z
      .object({
        salesRevenueGrosze: SafeGroszeSchema,
        operatingCostsGrosze: SafeGroszeSchema,
        grossFinancialResultGrosze: SafeGroszeSchema,
        incomeTaxCitGrosze: SafeGroszeSchema,
        netFinancialResultGrosze: SafeGroszeSchema,
        netFinancialResultFormatted: z.string().min(1),
      })
      .strict(),
    citAdvance: z
      .object({
        citRateKind: z.enum(['small_9', 'standard_19']),
        citRateBps: z.union([z.literal(900), z.literal(1900)]),
        taxableIncomeGrosze: NonNegativeGroszeSchema,
        citAdvanceDueRoundedPlnGrosze: NonNegativeGroszeSchema,
        citAdvanceDueFormatted: z.string().min(1),
        explanation: LegalExplanationSchema,
      })
      .strict(),
  })
  .strict();

export type LedgerViewResponse = z.infer<typeof LedgerViewResponseSchema>;

export const CreateJournalEntryLineInputSchema = z
  .object({
    accountCode: z.string().regex(/^\d{3}(-\d{1,4})?$/, 'Wymagany kod konta np. 130 lub 201-01'),
    side: z.enum(['Wn', 'Ma']),
    amountGrosze: SafeGroszeSchema,
    description: z.string().min(1).max(400),
    isRedStorno: z.boolean().optional(),
    stornoReason: z.string().min(1).max(400).optional(),
  })
  .strict();

export const CreateJournalEntryRequestSchema = z
  .object({
    entryNumber: z.string().min(1).max(64).optional(),
    bookingDate: IsoCalendarDateSchema,
    documentDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1).max(128),
    description: z.string().min(1).max(500),
    lines: z.array(CreateJournalEntryLineInputSchema).min(2),
  })
  .strict();

export type CreateJournalEntryRequest = z.infer<typeof CreateJournalEntryRequestSchema>;

/** 12. Finance, Settlements & Bank Reconciliation (/finance*) */
export const FinanceViewResponseSchema = z
  .object({
    settlements: z.array(SettlementItemSchema),
    bankTransactions: z.array(BankStatementTransactionSchema),
    reconciliationMatches: z.array(BankReconciliationMatchSchema),
    summary: z
      .object({
        openReceivablesGrosze: NonNegativeGroszeSchema,
        openReceivablesFormatted: z.string().min(1),
        openPayablesGrosze: NonNegativeGroszeSchema,
        openPayablesFormatted: z.string().min(1),
        overdueCount: z.number().int().nonnegative(),
        unreconciledTransactionsCount: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type FinanceViewResponse = z.infer<typeof FinanceViewResponseSchema>;

export const ImportBankStatementRequestSchema = z
  .object({
    format: z.enum(['csv', 'mt940']),
    rawContent: z.string().min(1).max(524_288).optional(),
    content: z.string().min(1).max(524_288).optional(),
    delimiter: z.enum([';', ',']).optional(),
    applySettlements: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.rawContent && !val.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rawContent'],
        message: 'Wymagane jest podanie treści wyciągu bankowego (rawContent lub content).',
      });
    }
  });

export type ImportBankStatementRequest = z.infer<typeof ImportBankStatementRequestSchema>;

export const ImportBankStatementResponseSchema = z
  .object({
    importedTransactionsCount: z.number().int().nonnegative(),
    matchedExactCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    finance: FinanceViewResponseSchema,
  })
  .strict();

export type ImportBankStatementResponse = z.infer<typeof ImportBankStatementResponseSchema>;

export const ManualReconcileRequestSchema = z
  .object({
    transactionId: z.string().min(1),
    settlementId: UuidSelectorSchema,
    amountGrosze: NonNegativeGroszeSchema.optional(),
  })
  .strict();

export type ManualReconcileRequest = z.infer<typeof ManualReconcileRequestSchema>;

export const BatchReconcileRequestSchema = z
  .object({
    matches: z.array(ManualReconcileRequestSchema).min(1),
  })
  .strict();

export const ReconcileBankRequestSchema = z.union([
  ManualReconcileRequestSchema,
  BatchReconcileRequestSchema,
]);

export type ReconcileBankRequest = z.infer<typeof ReconcileBankRequestSchema>;

/** 13. Tax Calendar (/calendar*) */
export const CalendarViewResponseSchema = z
  .object({
    year: z.number().int().min(2020).max(2100),
    month: z.number().int().min(1).max(12).nullable(),
    obligations: z.array(CalendarObligationItemSchema),
  })
  .strict();

export type CalendarViewResponse = z.infer<typeof CalendarViewResponseSchema>;

export const UpdateObligationStatusRequestSchema = z
  .object({
    status: z.enum(['paid', 'upcoming']).optional(),
  })
  .strict();

export type UpdateObligationStatusRequest = z.infer<typeof UpdateObligationStatusRequestSchema>;

/** 14. Notifications & Controlled Sandbox Mailbox (/notifications*) */
export const SandboxMailboxMessageSchema = z
  .object({
    messageId: z.string().min(1),
    outboxId: UuidSelectorSchema,
    deduplicationKey: z.string().min(1),
    deliveredAt: IsoUtcTimestampSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    subject: z.string().min(1),
    textBody: z.string().min(1),
    htmlBody: z.string().min(1),
    headers: z.record(z.string(), z.string()),
    rawRfc822: z.string().min(1),
  })
  .strict();

export type SandboxMailboxMessageContract = z.infer<typeof SandboxMailboxMessageSchema>;

export const NotificationsViewResponseSchema = z
  .object({
    preferences: NotificationPreferencesSchema,
    outbox: z.array(NotificationOutboxEntrySchema),
    deliveredMailbox: z.array(SandboxMailboxMessageSchema),
    sandboxPolicy: z
      .object({
        allowlistedDomains: z.array(z.string().min(1)),
        failClosedExternalRecipients: z.literal(true),
        antiImpersonationFooterPl: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export type NotificationsViewResponse = z.infer<typeof NotificationsViewResponseSchema>;

export const UpdateNotificationPreferencesRequestSchema = z
  .object({
    recipientEmail: SafeEmailAddressSchema.optional(),
    frequency: NotificationFrequencySchema,
    optionalRemindersOptedOut: z.boolean(),
    explicitDisabledStages: z.array(ReminderStageSchema).optional(),
  })
  .strict();

export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const DispatchDueNotificationsRequestSchema = z
  .object({
    evaluationDate: IsoDateSchema.optional(),
    period: TaxPeriodMonthSchema.optional(),
  })
  .strict();

export type DispatchDueNotificationsRequest = z.infer<typeof DispatchDueNotificationsRequestSchema>;

export const DispatchDueNotificationsResponseSchema = z
  .object({
    evaluationDate: IsoDateSchema,
    enqueuedCount: z.number().int().nonnegative(),
    skippedDuplicatesCount: z.number().int().nonnegative(),
    skippedByPreferencesCount: z.number().int().nonnegative(),
    sentCount: z.number().int().nonnegative(),
    blockedByPolicyCount: z.number().int().nonnegative(),
    retryScheduledCount: z.number().int().nonnegative(),
    notifications: NotificationsViewResponseSchema,
  })
  .strict();

export type DispatchDueNotificationsResponse = z.infer<
  typeof DispatchDueNotificationsResponseSchema
>;

/** 15. MCP Proposals & Human Confirmation Gate (/mcp/proposals*) */
export const McpProposalListItemSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: PrepareProposalLifecycleStatusSchema,
    ledgerPosted: z.boolean(),
    ledgerEntryId: UuidSelectorSchema.nullable(),
    payloadHash: Sha256HexSchema,
    createdAt: IsoUtcTimestampSchema,
    expiresAt: IsoUtcTimestampSchema,
    confirmedAt: IsoUtcTimestampSchema.nullable(),
    promptInjectionSuspected: z.boolean(),
    invoice: z
      .object({
        direction: z.enum(['purchase', 'sales']),
        invoiceNumber: UntrustedDocumentTextEnvelopeSchema,
        counterpartyName: UntrustedDocumentTextEnvelopeSchema,
        counterpartyNip: z.string().regex(/^\d{10}$/),
        issueDate: IsoDateSchema,
        dueDate: IsoDateSchema,
        netAmountPln: z.string().min(1).max(20),
        vatAmountPln: z.string().min(1).max(20),
        grossAmountPln: z.string().min(1).max(20),
        expenseDescription: UntrustedDocumentTextEnvelopeSchema,
        suggestedCategory: ProposedPostingCategorySchema,
      })
      .strict(),
    proposedPosting: ProposedAccountingPreviewSchema,
  })
  .strict();

export type McpProposalListItemContract = z.infer<typeof McpProposalListItemSchema>;

export const McpProposalsListResponseSchema = z
  .object({
    proposals: z.array(McpProposalListItemSchema),
  })
  .strict();

export type McpProposalsListResponse = z.infer<typeof McpProposalsListResponseSchema>;

export const PrepareMcpProposalInvoiceInputSchema = z
  .object({
    direction: z.enum(['purchase', 'sales']),
    invoiceNumber: z.string().min(1).max(120),
    counterpartyName: z.string().min(1).max(240),
    counterpartyNip: z.string().regex(/^\d{10}$/, 'NIP musi składać się z 10 cyfr'),
    issueDate: IsoDateSchema,
    dueDate: IsoDateSchema,
    netAmountPln: z.string().regex(/^\d+\.\d{2}$/, 'Kwota musi mieć postać 0.00'),
    vatAmountPln: z.string().regex(/^\d+\.\d{2}$/, 'Kwota musi mieć postać 0.00'),
    grossAmountPln: z.string().regex(/^\d+\.\d{2}$/, 'Kwota musi mieć postać 0.00'),
    expenseDescription: z.string().min(1).max(1000),
    suggestedCategory: ProposedPostingCategorySchema,
  })
  .strict();

export const PrepareMcpProposalRequestSchema = z
  .object({
    idempotencyKey: UuidSelectorSchema.optional(),
    invoice: PrepareMcpProposalInvoiceInputSchema,
  })
  .strict();

export type PrepareMcpProposalRequest = z.infer<typeof PrepareMcpProposalRequestSchema>;

export const IssueMcpChallengeResponseSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    confirmationCode: z.string().min(16),
    payloadHash: Sha256HexSchema,
    expiresAt: IsoUtcTimestampSchema,
    auditEventId: z.string().min(1),
  })
  .strict();

export type IssueMcpChallengeResponse = z.infer<typeof IssueMcpChallengeResponseSchema>;

export const ConfirmMcpProposalRequestSchema = z
  .object({
    confirmationCode: z.string().min(16).max(256),
    expectedPayloadHash: Sha256HexSchema,
    idempotencyKey: UuidSelectorSchema.optional(),
  })
  .strict();

export type ConfirmMcpProposalRequest = z.infer<typeof ConfirmMcpProposalRequestSchema>;

export const ConfirmMcpProposalResponseSchema = z
  .object({
    confirmation: ConfirmPreparedProposalOutputSchema,
    postedDocument: CompanyDocumentItemSchema,
  })
  .strict();

export type ConfirmMcpProposalResponse = z.infer<typeof ConfirmMcpProposalResponseSchema>;

export const RejectMcpProposalRequestSchema = z
  .object({
    reason: z.string().min(3).max(400).optional(),
  })
  .strict();

export type RejectMcpProposalRequest = z.infer<typeof RejectMcpProposalRequestSchema>;

export const RejectMcpProposalResponseSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    status: z.literal('rejected'),
    rejectedAt: IsoUtcTimestampSchema,
    rejectedByUserId: UuidSelectorSchema,
    reason: z.string().min(1),
    auditEventId: z.string().min(1),
  })
  .strict();

export type RejectMcpProposalResponse = z.infer<typeof RejectMcpProposalResponseSchema>;

/** 16. Company Audit Trail (/audit-log) */
export const CompanyAuditListResponseSchema = z
  .object({
    events: z.array(CompanyAuditItemSchema),
  })
  .strict();

export type CompanyAuditListResponse = z.infer<typeof CompanyAuditListResponseSchema>;

/** 17. Wave 2: Real OIDC Authentication, BFF Sessions, Owner Bootstrap & Tenant Invitations */
export const RuntimeModeSchema = z.enum([
  'LOCAL_DEV',
  'STAGING_PRIVATE',
  'PUBLIC_DEMO',
  'PRODUCTION',
]);
export type RuntimeModeContract = z.infer<typeof RuntimeModeSchema>;
export type RuntimeMode = RuntimeModeContract;

export const AuthSessionStateCodeSchema = z.enum([
  'authenticated',
  'signed_out',
  'signing_in',
  'session_expired_or_invalid',
  'no_tenant_membership',
  'invitation_pending_or_expired',
  'insufficient_permissions',
  'auth_service_unavailable',
]);
export type AuthSessionStateCode = z.infer<typeof AuthSessionStateCodeSchema>;

export const SafeRelativeRedirectPathSchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (val) =>
      val.startsWith('/') &&
      !val.startsWith('//') &&
      !val.includes('\\') &&
      ![...val].some((ch) => {
        const code = ch.charCodeAt(0);
        return code <= 0x1f || code === 0x7f;
      }),
    'Dozwolona jest wyłącznie wewnętrzna ścieżka względna zaczynająca się od pojedynczego ukośnika (/).',
  );
export type SafeRelativeRedirectPath = z.infer<typeof SafeRelativeRedirectPathSchema>;

export const OidcAuthorizeRequestSchema = z
  .object({
    returnTo: SafeRelativeRedirectPathSchema.optional(),
    invitationToken: z.string().min(24).max(256).optional(),
  })
  .strict();
export type OidcAuthorizeRequest = z.infer<typeof OidcAuthorizeRequestSchema>;

export const OidcAuthorizeResponseSchema = z
  .object({
    authorizationUrl: z.string().url(),
    state: z.string().min(16).max(256),
    expiresAt: IsoUtcTimestampSchema,
  })
  .strict();
export type OidcAuthorizeResponse = z.infer<typeof OidcAuthorizeResponseSchema>;

export const OidcCallbackQuerySchema = z
  .object({
    code: z.string().min(8).max(2048).optional(),
    state: z.string().min(16).max(256).optional(),
    error: z.string().min(1).max(120).optional(),
    error_description: z.string().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.error && val.code) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message:
          'Callback OIDC nie może zawierać jednocześnie kodu autoryzacyjnego (code) oraz błędu dostawcy (error).',
      });
      return;
    }
    if (!val.error && (!val.code || !val.state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['code'],
        message: 'Callback OIDC wymaga pary (code, state) lub kodu błędu dostawcy (error).',
      });
    }
  });
export type OidcCallbackQuery = z.infer<typeof OidcCallbackQuerySchema>;

export const TenantMembershipSummarySchema = z
  .object({
    tenantId: UuidSelectorSchema,
    tenantName: z.string().min(1).max(240),
    role: TenantMemberRoleSchema,
    status: z.enum(['active', 'revoked']),
    validFrom: IsoUtcTimestampSchema,
    validUntil: IsoUtcTimestampSchema.nullable(),
  })
  .strict();
export type TenantMembershipSummaryContract = z.infer<typeof TenantMembershipSummarySchema>;

export const AuthenticatedSessionViewSchema = z
  .object({
    state: AuthSessionStateCodeSchema,
    authMethod: z.enum(['oidc', 'sandbox_persona']),
    userId: UuidSelectorSchema,
    issuer: z.string().min(1),
    subject: z.string().min(1),
    displayName: z.string().min(1).max(160),
    email: SafeEmailAddressSchema,
    tenantId: UuidSelectorSchema.nullable(),
    legalEntityId: UuidSelectorSchema.nullable(),
    period: TaxPeriodMonthSchema,
    memberships: z.array(TenantMembershipSummarySchema),
    companies: z.array(AccessibleCompanyItemSchema),
    sessionExpiresAt: IsoUtcTimestampSchema,
    accessTokenExpiresAt: IsoUtcTimestampSchema,
    personaId: z.string().min(1).max(64).optional(),
  })
  .strict();
export type AuthenticatedSessionView = z.infer<typeof AuthenticatedSessionViewSchema>;

export const UpdateSessionContextRequestSchema = z
  .object({
    tenantId: UuidSelectorSchema.optional(),
    legalEntityId: UuidSelectorSchema.optional(),
    period: TaxPeriodMonthSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.tenantId && !val.legalEntityId && !val.period) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tenantId'],
        message:
          'Wymagane jest podanie co najmniej jednego pola kontekstu (tenantId, legalEntityId lub period).',
      });
    }
  });
export type UpdateSessionContextRequest = z.infer<typeof UpdateSessionContextRequestSchema>;

export const BootstrapOwnerRequestSchema = z
  .object({
    issuer: z.string().min(1).max(512),
    subject: z.string().min(1).max(256),
    displayName: z.string().min(2).max(160),
    email: SafeEmailAddressSchema,
    tenantName: z.string().min(2).max(240),
    tenantId: UuidSelectorSchema.optional(),
    userId: UuidSelectorSchema.optional(),
    initialCompany: CreateCompanyRequestSchema.optional(),
    reason: z.string().min(3).max(400),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict();
export type BootstrapOwnerRequest = z.infer<typeof BootstrapOwnerRequestSchema>;

export const BootstrapOwnerResponseSchema = z
  .object({
    ok: z.literal(true),
    idempotentReplay: z.boolean(),
    userId: UuidSelectorSchema,
    issuer: z.string().min(1),
    subject: z.string().min(1),
    displayName: z.string().min(1),
    email: SafeEmailAddressSchema,
    tenantId: UuidSelectorSchema,
    tenantName: z.string().min(1),
    role: z.literal('tenant_owner'),
    legalEntityId: UuidSelectorSchema.nullable(),
    operationId: UuidSelectorSchema,
    auditEventId: z.string().min(1),
    occurredAt: IsoUtcTimestampSchema,
  })
  .strict();
export type BootstrapOwnerResponse = z.infer<typeof BootstrapOwnerResponseSchema>;

export const TenantInvitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'expired',
  'revoked',
  'rejected',
]);
export type TenantInvitationStatusContract = z.infer<typeof TenantInvitationStatusSchema>;

export const InvitationCompanyGrantDraftSchema = z
  .object({
    legalEntityId: UuidSelectorSchema,
    actions: z.array(z.enum(['read', 'write'])).min(1).max(2),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (new Set(val.actions).size !== val.actions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actions'],
        message: 'Lista akcji uprawnień do firmy nie może zawierać duplikatów.',
      });
    }
    if (val.actions.includes('write') && !val.actions.includes('read')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['actions'],
        message: 'Uprawnienie zapisu (write) do firmy wymaga jednoczesnego uprawnienia odczytu (read).',
      });
    }
  });
export type InvitationCompanyGrantDraft = z.infer<typeof InvitationCompanyGrantDraftSchema>;

export const CreateTenantInvitationRequestSchema = z
  .object({
    inviteeEmail: SafeEmailAddressSchema,
    inviteeDisplayName: z.string().min(2).max(160).optional(),
    intendedRole: TenantMemberRoleSchema,
    initialCompanyGrants: z.array(InvitationCompanyGrantDraftSchema).max(50).optional(),
    expiresInHours: z.number().int().min(1).max(336).optional(),
    reason: z.string().min(3).max(400),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.initialCompanyGrants) {
      const ids = val.initialCompanyGrants.map((g) => g.legalEntityId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['initialCompanyGrants'],
          message: 'Lista initialCompanyGrants nie może zawierać zduplikowanego legalEntityId.',
        });
      }
    }
  });
export type CreateTenantInvitationRequest = z.infer<typeof CreateTenantInvitationRequestSchema>;

export const TenantInvitationItemSchema = z
  .object({
    invitationId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    tenantName: z.string().min(1).max(240),
    inviteeMaskedEmail: z.string().min(3).max(160),
    inviteeDisplayName: z.string().min(1).max(160).nullable(),
    intendedRole: TenantMemberRoleSchema,
    initialCompanyGrants: z.array(InvitationCompanyGrantDraftSchema),
    status: TenantInvitationStatusSchema,
    invitedByUserId: UuidSelectorSchema,
    invitedByDisplayName: z.string().min(1).max(160),
    createdAt: IsoUtcTimestampSchema,
    expiresAt: IsoUtcTimestampSchema,
    acceptedAt: IsoUtcTimestampSchema.nullable(),
    acceptedByUserId: UuidSelectorSchema.nullable(),
    revokedAt: IsoUtcTimestampSchema.nullable(),
    rejectedAt: IsoUtcTimestampSchema.nullable(),
  })
  .strict();
export type TenantInvitationItemContract = z.infer<typeof TenantInvitationItemSchema>;

export const CreateTenantInvitationResponseSchema = z
  .object({
    invitation: TenantInvitationItemSchema,
    invitationToken: z.string().min(24).max(256),
    acceptPath: SafeRelativeRedirectPathSchema,
    auditEventId: z.string().min(1),
  })
  .strict();
export type CreateTenantInvitationResponse = z.infer<typeof CreateTenantInvitationResponseSchema>;

export const ListTenantInvitationsResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    invitations: z.array(TenantInvitationItemSchema),
  })
  .strict();
export type ListTenantInvitationsResponse = z.infer<typeof ListTenantInvitationsResponseSchema>;

export const AcceptTenantInvitationRequestSchema = z
  .object({
    invitationToken: z.string().min(24).max(256),
    displayName: z.string().min(2).max(160).optional(),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict();
export type AcceptTenantInvitationRequest = z.infer<typeof AcceptTenantInvitationRequestSchema>;

export const AcceptTenantInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: TenantInvitationItemSchema,
    membership: TenantMembershipSummarySchema,
    grantedCompanyIds: z.array(UuidSelectorSchema),
    auditEventId: z.string().min(1),
  })
  .strict();
export type AcceptTenantInvitationResponse = z.infer<typeof AcceptTenantInvitationResponseSchema>;

export const RevokeTenantInvitationRequestSchema = z
  .object({
    reason: z.string().min(3).max(400),
    operationId: UuidSelectorSchema.optional(),
  })
  .strict();
export type RevokeTenantInvitationRequest = z.infer<typeof RevokeTenantInvitationRequestSchema>;

export const RevokeTenantInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: TenantInvitationItemSchema,
    auditEventId: z.string().min(1),
  })
  .strict();
export type RevokeTenantInvitationResponse = z.infer<typeof RevokeTenantInvitationResponseSchema>;

export const RejectTenantInvitationRequestSchema = z
  .object({
    invitationToken: z.string().min(24).max(256),
    reason: z.string().min(3).max(400).optional(),
  })
  .strict();
export type RejectTenantInvitationRequest = z.infer<typeof RejectTenantInvitationRequestSchema>;

export const RejectTenantInvitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: TenantInvitationItemSchema,
    auditEventId: z.string().min(1),
  })
  .strict();
export type RejectTenantInvitationResponse = z.infer<typeof RejectTenantInvitationResponseSchema>;

export { DocumentLineItemSchema, JournalEntryLineSchema };
