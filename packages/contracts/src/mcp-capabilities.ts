import { z } from 'zod';
import {
  AccountingCalculationStepSchema,
  IsoDateSchema,
  IsoUtcTimestampSchema,
  LegalBasisReferenceSchema,
  McpScopeSchema,
  NonNegativePlnDecimalStringSchema,
  OfficialHttpsUrlSchema,
  PlnDecimalStringSchema,
  PrepareInvoiceDraftPayloadSchema,
  ProposedAccountingPreviewSchema,
  Sha256HexSchema,
  UntrustedDocumentTextEnvelopeSchema,
  UuidSelectorSchema,
  YearMonthSchema,
} from './mcp-tools-core.js';

export const MCP_CAPABILITY_CONTRACT_VERSION = '2026-11-24.2' as const;

export const McpCapabilityStatusSchema = z.enum(['supported', 'experimental', 'unsupported']);
export type McpCapabilityStatus = z.infer<typeof McpCapabilityStatusSchema>;

export const McpToolFamilySchema = z.enum([
  'system',
  'companies',
  'documents',
  'invoicing',
  'tax',
  'bank',
  'ledger',
  'accountant',
  'reporting',
]);
export type McpToolFamily = z.infer<typeof McpToolFamilySchema>;

export const McpRiskClassificationSchema = z.enum([
  'read_only',
  'safe_prepare',
  'requires_human_review',
  'external_side_effect',
]);
export type McpRiskClassification = z.infer<typeof McpRiskClassificationSchema>;

export const McpToolDescriptorSchema = z
  .object({
    toolName: z.string().min(1).max(120),
    schemaVersion: z.string().min(1).max(40),
    capabilityId: z.string().min(1).max(120),
    family: McpToolFamilySchema,
    titlePl: z.string().min(1).max(240),
    descriptionPl: z.string().min(1).max(1000),
    requiredScopes: z.array(McpScopeSchema),
    requiresCompanySelector: z.boolean(),
    requiredCompanyAction: z.enum(['none', 'read', 'write']),
    riskClassification: McpRiskClassificationSchema,
    requiresIdempotencyKey: z.boolean(),
    requiresIndependentHumanApproval: z.boolean(),
  })
  .strict();

export type McpToolDescriptor = z.infer<typeof McpToolDescriptorSchema>;

export const CompanyCapabilityEntrySchema = z
  .object({
    capabilityId: z.string().min(1).max(120),
    family: McpToolFamilySchema,
    titlePl: z.string().min(1).max(240),
    status: McpCapabilityStatusSchema,
    taxYear: z.number().int().min(2020).max(2100),
    applicableTools: z.array(z.string().min(1).max(120)),
    requiresHumanApproval: z.boolean(),
    limitationsPl: z.string().min(1).max(800),
    legalBasisCode: z.string().min(1).max(120).nullable(),
  })
  .strict();

export type CompanyCapabilityEntry = z.infer<typeof CompanyCapabilityEntrySchema>;

/** 9. get_company_profile */
export const GetCompanyProfileInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    taxYear: z.number().int().min(2020).max(2100).optional(),
  })
  .strict();

export type GetCompanyProfileInput = z.infer<typeof GetCompanyProfileInputSchema>;

export const GetCompanyProfileOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    displayName: z.string().min(1).max(240),
    maskedNip: z.string().regex(/^\*{6}\d{4}$/),
    legalForm: z.enum(['jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna']),
    taxRegime: z.enum(['kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny']),
    vatStatus: z.enum(['czynny', 'zwolniony']),
    taxYear: z.number().int().min(2020).max(2100),
    profileSupportStatus: McpCapabilityStatusSchema,
    grantedActions: z.array(z.enum(['read', 'write'])).min(1),
    activeBooksKind: z.enum(['kpir', 'ewidencja_przychodow', 'ksiegi_rachunkowe_uor']),
    jpkVatApplicable: z.boolean(),
    jpkIncomeApplicableCode: z.enum(['JPK_PKPIR', 'JPK_EWP', 'JPK_KR_PD']),
    ksefModeSummaryPl: z.string().min(1).max(500),
    auditEventId: z.string().min(1),
  })
  .strict();

export type GetCompanyProfileOutput = z.infer<typeof GetCompanyProfileOutputSchema>;

/** 10. list_available_capabilities */
export const ListAvailableCapabilitiesInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    taxYear: z.number().int().min(2020).max(2100).optional(),
  })
  .strict();

export type ListAvailableCapabilitiesInput = z.infer<typeof ListAvailableCapabilitiesInputSchema>;

export const ListAvailableCapabilitiesOutputSchema = z
  .object({
    contractVersion: z.string().min(1).max(40),
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    taxYear: z.number().int().min(2020).max(2100),
    companyProfile: z
      .object({
        legalForm: z.enum(['jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna']),
        taxRegime: z.enum(['kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny']),
        vatStatus: z.enum(['czynny', 'zwolniony']),
        grantedActions: z.array(z.enum(['read', 'write'])).min(1),
      })
      .strict(),
    capabilities: z.array(CompanyCapabilityEntrySchema).min(1),
    registeredTools: z.array(McpToolDescriptorSchema).min(1),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ListAvailableCapabilitiesOutput = z.infer<typeof ListAvailableCapabilitiesOutputSchema>;

/** 11. preview_invoice_posting */
export const PreviewInvoicePostingInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    invoice: PrepareInvoiceDraftPayloadSchema,
  })
  .strict();

export type PreviewInvoicePostingInput = z.infer<typeof PreviewInvoicePostingInputSchema>;

export const PreviewInvoicePostingOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    dryRun: z.literal(true),
    ledgerPosted: z.literal(false),
    payloadHash: Sha256HexSchema,
    vatClassificationStatus: z.enum([
      'explicit_lines',
      'explicit_rate',
      'deterministic_single_rate',
    ]),
    promptInjectionSuspected: z.boolean(),
    sanitizedFields: z
      .object({
        invoiceNumber: UntrustedDocumentTextEnvelopeSchema,
        counterpartyName: UntrustedDocumentTextEnvelopeSchema,
        expenseDescription: UntrustedDocumentTextEnvelopeSchema,
      })
      .strict(),
    proposedPosting: ProposedAccountingPreviewSchema,
    auditEventId: z.string().min(1),
  })
  .strict();

export type PreviewInvoicePostingOutput = z.infer<typeof PreviewInvoicePostingOutputSchema>;

/** 12. preview_jpk_export */
export const JpkSchemaFamilySchema = z.enum([
  'JPK_V7M',
  'JPK_V7K',
  'JPK_PKPIR',
  'JPK_EWP',
  'JPK_KR_PD',
  'JPK_ST',
  'JPK_ST_KR',
]);
export type JpkSchemaFamily = z.infer<typeof JpkSchemaFamilySchema>;

export const PreviewJpkExportInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    schemaFamily: JpkSchemaFamilySchema.optional(),
    purpose: z.union([z.literal(1), z.literal(2)]).optional(),
    includeXml: z.boolean().optional(),
  })
  .strict();

export type PreviewJpkExportInput = z.infer<typeof PreviewJpkExportInputSchema>;

export const JpkXsdValidationIssueSchema = z
  .object({
    line: z.number().int().nonnegative(),
    column: z.number().int().nonnegative(),
    message: z.string().min(1).max(600),
  })
  .strict();

export const JpkXsdValidationReportSchema = z
  .object({
    performed: z.boolean(),
    valid: z.boolean(),
    officialSchemaCode: z.string().min(1).max(40),
    targetNamespace: z.string().min(1).max(240),
    schemaSha256: Sha256HexSchema,
    officialSourceUrl: OfficialHttpsUrlSchema,
    issues: z.array(JpkXsdValidationIssueSchema),
  })
  .strict();

export type JpkXsdValidationReport = z.infer<typeof JpkXsdValidationReportSchema>;

export const PreviewJpkExportOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    schemaFamily: JpkSchemaFamilySchema,
    schemaVersionCode: z.string().min(1).max(60),
    capabilityStatus: z.enum(['supported', 'experimental']),
    officialSubmissionPerformed: z.literal(false),
    upoReferenceNumber: z.null(),
    summary: z
      .object({
        salesEntriesCount: z.number().int().nonnegative(),
        purchaseEntriesCount: z.number().int().nonnegative(),
        outputVatPln: NonNegativePlnDecimalStringSchema,
        deductibleInputVatPln: NonNegativePlnDecimalStringSchema,
        taxDuePln: NonNegativePlnDecimalStringSchema,
        excessCarryForwardPln: NonNegativePlnDecimalStringSchema,
        priorExcessCarryoverP39Pln: NonNegativePlnDecimalStringSchema.optional(),
        requestedRefundP54Pln: NonNegativePlnDecimalStringSchema.optional(),
        unverifiedProposalsBlockingCount: z.number().int().nonnegative(),
      })
      .strict(),
    xsdValidation: JpkXsdValidationReportSchema,
    xmlSha256Hex: Sha256HexSchema.nullable(),
    xmlByteLength: z.number().int().nonnegative(),
    xmlContent: z.string().nullable(),
    readinessWarningsPl: z.array(z.string().min(1).max(500)),
    legalBasis: LegalBasisReferenceSchema,
    disclaimerPl: z.string().min(1).max(800),
    auditEventId: z.string().min(1),
  })
  .strict();

export type PreviewJpkExportOutput = z.infer<typeof PreviewJpkExportOutputSchema>;

/** 12b. explain_tax_calculation (#81 due-vs-paid & Profile A/B/C calculation trace) */
export const CitPreferentialAttestationInputSchema = z
  .object({
    taxYearStartDate: IsoDateSchema,
    taxYearEndDate: IsoDateSchema,
    smallTaxpayerVerified: z.boolean(),
    priorYearGrossSalesPln: NonNegativePlnDecimalStringSchema.optional(),
    isFirstTaxYearNewEntityVerified: z.boolean(),
    excludedRestructuringArt19Ust1aVerified: z.boolean(),
    excludedTaxCapitalGroupOrSplitVerified: z.boolean(),
  })
  .strict();

export const ExplainTaxCalculationInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    simulationOnly: z.boolean().optional(),
    simulatedPaidSocialZusPln: NonNegativePlnDecimalStringSchema.optional(),
    simulatedPaidHealthZusPln: NonNegativePlnDecimalStringSchema.optional(),
    requestPreferentialCit9Pct: z.boolean().optional(),
    citPreferentialAttestation: CitPreferentialAttestationInputSchema.optional(),
  })
  .strict();

export type ExplainTaxCalculationInput = z.infer<typeof ExplainTaxCalculationInputSchema>;

export const ExplainTaxCalculationOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    profileCode: z.enum([
      'jdg_kpir_skala',
      'jdg_kpir_liniowy',
      'jdg_ryczalt',
      'spzoo_pelne_ksiegi',
    ]),
    mode: z.enum(['binding_verified_payments_only', 'what_if_simulation']),
    bindingForDeclaration: z.boolean(),
    dueVsPaidSummary: z
      .object({
        zusAccruedTotalPln: NonNegativePlnDecimalStringSchema,
        zusConfirmedPaidTotalPln: NonNegativePlnDecimalStringSchema,
        zusRemainingUnpaidPln: NonNegativePlnDecimalStringSchema,
        unpaidZusExcludedFromTaxDeductionPln: NonNegativePlnDecimalStringSchema,
        incomeTaxOrRyczaltAccruedPln: NonNegativePlnDecimalStringSchema,
        incomeTaxOrRyczaltConfirmedPaidPln: NonNegativePlnDecimalStringSchema,
        incomeTaxOrRyczaltRemainingUnpaidPln: NonNegativePlnDecimalStringSchema,
        appliedCitRatePct: z.union([z.literal(9), z.literal(19)]).nullable(),
        vatOutputPln: NonNegativePlnDecimalStringSchema,
        vatDeductibleInputPln: NonNegativePlnDecimalStringSchema,
        vatPriorCarryoverP39Pln: NonNegativePlnDecimalStringSchema,
        vatDueToPayP51Pln: NonNegativePlnDecimalStringSchema,
        vatNextCarryoverP62Pln: NonNegativePlnDecimalStringSchema,
      })
      .strict(),
    summaryPl: z.string().min(1).max(1500),
    warningsPl: z.array(z.string().min(1).max(600)),
    calculationSteps: z.array(AccountingCalculationStepSchema).min(1),
    appliedRules: z.array(LegalBasisReferenceSchema).min(1),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ExplainTaxCalculationOutput = z.infer<typeof ExplainTaxCalculationOutputSchema>;

/** 13. list_unreconciled_bank_transactions */
export const ListUnreconciledBankTransactionsInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema.optional(),
    cursor: z.string().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListUnreconciledBankTransactionsInput = z.infer<
  typeof ListUnreconciledBankTransactionsInputSchema
>;

export const UnreconciledBankTransactionItemSchema = z
  .object({
    bankTransactionId: UuidSelectorSchema,
    bookingDate: IsoDateSchema,
    direction: z.enum(['credit', 'debit']),
    amountPln: PlnDecimalStringSchema,
    remainingUnallocatedPln: NonNegativePlnDecimalStringSchema,
    currency: z.literal('PLN'),
    counterpartyName: UntrustedDocumentTextEnvelopeSchema,
    transferTitle: UntrustedDocumentTextEnvelopeSchema,
  })
  .strict();

export type UnreconciledBankTransactionItem = z.infer<typeof UnreconciledBankTransactionItemSchema>;

export const ListUnreconciledBankTransactionsOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    transactions: z.array(UnreconciledBankTransactionItemSchema),
    nextCursor: z.string().min(1).max(128).nullable(),
    promptInjectionWarningsCount: z.number().int().nonnegative(),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ListUnreconciledBankTransactionsOutput = z.infer<
  typeof ListUnreconciledBankTransactionsOutputSchema
>;

/** 14. prepare_bank_reconciliation */
export const PrepareBankReconciliationInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    bankTransactionId: UuidSelectorSchema,
    invoiceId: UuidSelectorSchema,
    allocationGrossPln: NonNegativePlnDecimalStringSchema,
    dryRun: z.boolean().optional(),
  })
  .strict();

export type PrepareBankReconciliationInput = z.infer<typeof PrepareBankReconciliationInputSchema>;

export const PrepareBankReconciliationOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema.nullable(),
    dryRun: z.boolean(),
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: z.enum(['dry_run_preview', 'pending_human_approval', 'confirmed', 'expired']),
    bankWriteExecuted: z.literal(false),
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    payloadHash: Sha256HexSchema,
    bankTransactionId: UuidSelectorSchema,
    invoiceId: UuidSelectorSchema,
    allocationGrossPln: NonNegativePlnDecimalStringSchema,
    remainingInvoiceGrossBeforePln: NonNegativePlnDecimalStringSchema,
    remainingInvoiceGrossAfterPln: NonNegativePlnDecimalStringSchema,
    remainingTransactionGrossAfterPln: NonNegativePlnDecimalStringSchema,
    createdAt: IsoUtcTimestampSchema,
    expiresAt: IsoUtcTimestampSchema.nullable(),
    promptInjectionSuspected: z.boolean(),
    humanApprovalInstructionsPl: z.string().min(1).max(800),
    auditEventId: z.string().min(1),
  })
  .strict();

export type PrepareBankReconciliationOutput = z.infer<typeof PrepareBankReconciliationOutputSchema>;

/** 15. confirm_bank_reconciliation_proposal */
export const ConfirmBankReconciliationInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    proposalId: UuidSelectorSchema,
    expectedPayloadHash: Sha256HexSchema,
    confirmationCode: z.string().min(16).max(256),
  })
  .strict();

export type ConfirmBankReconciliationInput = z.infer<typeof ConfirmBankReconciliationInputSchema>;

export const ConfirmBankReconciliationOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: z.literal('confirmed'),
    allocationApplied: z.literal(true),
    reconciliationEntryId: UuidSelectorSchema,
    bankTransactionId: UuidSelectorSchema,
    invoiceId: UuidSelectorSchema,
    allocatedGrossPln: NonNegativePlnDecimalStringSchema,
    remainingInvoiceGrossAfterPln: NonNegativePlnDecimalStringSchema,
    confirmedAt: IsoUtcTimestampSchema,
    confirmedPayloadHash: Sha256HexSchema,
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ConfirmBankReconciliationOutput = z.infer<typeof ConfirmBankReconciliationOutputSchema>;

/** 16. prepare_month_close */
export const PrepareMonthCloseInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    idempotencyKey: UuidSelectorSchema,
    dryRun: z.boolean().optional(),
  })
  .strict();

export type PrepareMonthCloseInput = z.infer<typeof PrepareMonthCloseInputSchema>;

export const PrepareMonthCloseOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema.nullable(),
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    status: z.enum([
      'blocked_by_checklist',
      'dry_run_ready',
      'pending_human_approval',
      'confirmed',
      'expired',
    ]),
    periodClosed: z.boolean(),
    readyToClose: z.boolean(),
    blockingItemsCount: z.number().int().nonnegative(),
    blockingReasonsPl: z.array(z.string().min(1).max(500)),
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    payloadHash: Sha256HexSchema,
    expiresAt: IsoUtcTimestampSchema.nullable().optional(),
    checklistSummary: z
      .object({
        missingDocumentsCount: z.number().int().nonnegative(),
        unverifiedAiProposalsCount: z.number().int().nonnegative(),
        unreconciledBankTransfersCount: z.number().int().nonnegative(),
      })
      .strict(),
    humanApprovalInstructionsPl: z.string().min(1).max(800),
    auditEventId: z.string().min(1),
  })
  .strict();

export type PrepareMonthCloseOutput = z.infer<typeof PrepareMonthCloseOutputSchema>;

/** 16b. confirm_month_close_proposal (#116 maker-checker period close) */
export const ConfirmMonthCloseInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    proposalId: UuidSelectorSchema,
    expectedPayloadHash: Sha256HexSchema,
    confirmationCode: z.string().min(16).max(256),
    note: z.string().min(1).max(500).optional(),
  })
  .strict();

export type ConfirmMonthCloseInput = z.infer<typeof ConfirmMonthCloseInputSchema>;

export const ConfirmMonthCloseOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    status: z.literal('confirmed'),
    periodClosed: z.literal(true),
    closedAt: IsoUtcTimestampSchema,
    confirmedPayloadHash: Sha256HexSchema,
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ConfirmMonthCloseOutput = z.infer<typeof ConfirmMonthCloseOutputSchema>;

/** 17. get_audit_lineage */
export const GetAuditLineageInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    outcomeFilter: z.enum(['all', 'allow', 'deny']).optional(),
    cursor: z.string().min(1).max(128).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type GetAuditLineageInput = z.infer<typeof GetAuditLineageInputSchema>;

export const McpAuditLineageItemSchema = z
  .object({
    auditEventId: z.string().min(1).max(128),
    occurredAt: IsoUtcTimestampSchema,
    channel: z.enum(['security', 'access', 'accounting', 'mcp', 'notifications']),
    toolOrAction: z.string().min(1).max(160),
    outcome: z.enum(['allow', 'deny', 'error']),
    reasonCode: z.string().min(1).max(160),
    correlationId: z.string().min(1).max(128).nullable(),
    proposalId: UuidSelectorSchema.nullable(),
    payloadHash: Sha256HexSchema.nullable(),
    promptInjectionSuspected: z.boolean(),
    redactedSummaryPl: z.string().min(1).max(600),
  })
  .strict();

export type McpAuditLineageItem = z.infer<typeof McpAuditLineageItemSchema>;

export const GetAuditLineageOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    piiRedacted: z.literal(true),
    events: z.array(McpAuditLineageItemSchema),
    nextCursor: z.string().min(1).max(128).nullable(),
    auditEventId: z.string().min(1),
  })
  .strict();

export type GetAuditLineageOutput = z.infer<typeof GetAuditLineageOutputSchema>;
