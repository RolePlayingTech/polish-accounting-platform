import { z } from 'zod';

export function isRealIsoCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(utcMs)) {
    return false;
  }
  const date = new Date(utcMs);
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isRealIsoUtcTimestamp(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?Z$/.exec(
    value,
  );
  if (!match?.[1]) {
    return false;
  }
  return isRealIsoCalendarDate(match[1]);
}

const OFFICIAL_POLISH_LEGAL_PUBLISHERS: ReadonlySet<string> = new Set([
  'isap.sejm.gov.pl',
  'dziennikustaw.gov.pl',
  'www.dziennikustaw.gov.pl',
  'monitorpolski.gov.pl',
  'www.monitorpolski.gov.pl',
  'podatki.gov.pl',
  'www.podatki.gov.pl',
  'ksef.podatki.gov.pl',
  'gov.pl',
  'www.gov.pl',
  'zus.pl',
  'www.zus.pl',
  'nbp.pl',
  'www.nbp.pl',
  'uodo.gov.pl',
  'www.uodo.gov.pl',
]);

export function isOfficialPolishLegalUrl(value: string): boolean {
  if (!/^https:\/\/[^\s<>"]+$/.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.port !== ''
    ) {
      return false;
    }
    return OFFICIAL_POLISH_LEGAL_PUBLISHERS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const UuidSelectorSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

export const YearMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
  .refine(isRealIsoCalendarDate, {
    message: 'Nieprawidłowa data kalendarzowa RRRR-MM-DD.',
  });

export const IsoUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)
  .refine(isRealIsoUtcTimestamp, {
    message: 'Nieprawidłowy znacznik czasu UTC ISO-8601.',
  });

export const PlnDecimalStringSchema = z.string().regex(/^-?\d+\.\d{2}$/);

export const NonNegativePlnDecimalStringSchema = z.string().regex(/^\d+\.\d{2}$/);

export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const OfficialHttpsUrlSchema = z
  .string()
  .regex(/^https:\/\/[^\s<>"]+$/)
  .refine(isOfficialPolishLegalUrl, {
    message:
      'Wymagany oficjalny adres HTTPS publikatora aktu prawnego lub instytucji (np. isap.sejm.gov.pl, dziennikustaw.gov.pl, podatki.gov.pl, zus.pl).',
  });

export const KsefReferenceNumberSchema = z
  .string()
  .max(80)
  .regex(/^\d{10}-\d{8}-[A-Z0-9]{2,24}(?:-[A-Z0-9]{2,24}){1,3}$/)
  .refine(
    (value) => {
      const dateSegment = value.slice(11, 19);
      const iso = `${dateSegment.slice(0, 4)}-${dateSegment.slice(4, 6)}-${dateSegment.slice(6, 8)}`;
      return isRealIsoCalendarDate(iso);
    },
    { message: 'Nieprawidłowa data w numerze referencyjnym KSeF.' },
  );

export const McpScopeSchema = z.enum(['pap:mcp:read', 'pap:mcp:prepare']);
export type McpScope = z.infer<typeof McpScopeSchema>;

export const UntrustedDocumentTextEnvelopeSchema = z
  .object({
    kind: z.literal('untrusted_document_data'),
    field: z.string().min(1).max(120),
    framedText: z.string(),
    sanitizedText: z.string(),
    promptInjectionSuspected: z.boolean(),
    detectedSignals: z.array(z.string()),
    controlCharsStripped: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export type UntrustedDocumentTextEnvelope = z.infer<typeof UntrustedDocumentTextEnvelopeSchema>;

export const LegalBasisReferenceSchema = z
  .object({
    ruleId: z.string().min(1).max(120),
    ruleVersion: z.string().min(1).max(60),
    actTitle: z.string().min(1).max(500),
    articleRef: z.string().min(1).max(200),
    journalOfLawsRef: z.string().min(1).max(200),
    officialUrl: OfficialHttpsUrlSchema,
    effectiveFrom: IsoDateSchema,
    effectiveTo: IsoDateSchema.nullable(),
    verificationStatus: z.enum(['verified', 'experimental']),
  })
  .strict();

export type LegalBasisReference = z.infer<typeof LegalBasisReferenceSchema>;

export const McpToolErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'insufficient_scope',
  'invalid_selector',
  'validation_failed',
  'resource_not_found',
  'amount_mismatch',
  'idempotency_key_payload_conflict',
  'proposal_not_found_or_forbidden',
  'proposal_expired',
  'proposal_already_processed',
  'payload_hash_mismatch',
  'human_confirmation_required',
  'invalid_confirmation_code',
  'agent_self_approval_forbidden',
  'audit_unavailable',
]);

export type McpToolErrorCode = z.infer<typeof McpToolErrorCodeSchema>;

export const McpToolErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    errorCode: McpToolErrorCodeSchema,
    messagePl: z.string().min(1),
    auditEventId: z.string().min(1).nullable(),
    retryable: z.boolean(),
  })
  .strict();

export type McpToolErrorEnvelope = z.infer<typeof McpToolErrorEnvelopeSchema>;

/** 1. list_my_companies */
export const ListMyCompaniesInputSchema = z.object({}).strict();
export type ListMyCompaniesInput = z.infer<typeof ListMyCompaniesInputSchema>;

export const AccessibleCompanySummarySchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    displayName: z.string().min(1).max(240),
    maskedNip: z.string().regex(/^\*{6}\d{4}$/),
    legalForm: z.enum(['jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna']),
    taxRegime: z.enum(['kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny']),
    vatStatus: z.enum(['czynny', 'zwolniony']),
    grantedActions: z.array(z.enum(['read', 'write'])).min(1),
  })
  .strict();

export type AccessibleCompanySummary = z.infer<typeof AccessibleCompanySummarySchema>;

export const ListMyCompaniesOutputSchema = z
  .object({
    companies: z.array(AccessibleCompanySummarySchema),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ListMyCompaniesOutput = z.infer<typeof ListMyCompaniesOutputSchema>;

/** 2. list_unpaid_invoices */
export const ListUnpaidInvoicesInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    direction: z.enum(['all', 'sales', 'purchase']).optional(),
    overdueOnly: z.boolean().optional(),
    minGrossAmountPln: NonNegativePlnDecimalStringSchema.optional(),
  })
  .strict();

export type ListUnpaidInvoicesInput = z.infer<typeof ListUnpaidInvoicesInputSchema>;

export const UnpaidInvoiceItemSchema = z
  .object({
    invoiceId: UuidSelectorSchema,
    direction: z.enum(['sales', 'purchase']),
    issueDate: IsoDateSchema,
    dueDate: IsoDateSchema,
    isOverdue: z.boolean(),
    daysOverdue: z.number().int().nonnegative(),
    netAmountPln: NonNegativePlnDecimalStringSchema,
    vatAmountPln: NonNegativePlnDecimalStringSchema,
    grossAmountPln: NonNegativePlnDecimalStringSchema,
    remainingGrossAmountPln: NonNegativePlnDecimalStringSchema,
    ksefReferenceNumber: KsefReferenceNumberSchema.nullable(),
    invoiceNumber: UntrustedDocumentTextEnvelopeSchema,
    counterpartyName: UntrustedDocumentTextEnvelopeSchema,
    description: UntrustedDocumentTextEnvelopeSchema,
  })
  .strict();

export type UnpaidInvoiceItem = z.infer<typeof UnpaidInvoiceItemSchema>;

export const ListUnpaidInvoicesOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    asOfDate: IsoDateSchema,
    currency: z.literal('PLN'),
    totalUnpaidGrossPln: NonNegativePlnDecimalStringSchema,
    overdueCount: z.number().int().nonnegative(),
    promptInjectionWarningsCount: z.number().int().nonnegative(),
    invoices: z.array(UnpaidInvoiceItemSchema),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ListUnpaidInvoicesOutput = z.infer<typeof ListUnpaidInvoicesOutputSchema>;

/** 3. get_monthly_tax_obligations */
export const GetMonthlyTaxObligationsInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
  })
  .strict();

export type GetMonthlyTaxObligationsInput = z.infer<typeof GetMonthlyTaxObligationsInputSchema>;

export const MonthlyTaxObligationSchema = z
  .object({
    obligationId: UuidSelectorSchema,
    category: z.enum(['zus', 'pit', 'cit', 'vat', 'jpk', 'ksef']),
    code: z.string().min(1).max(80),
    namePl: z.string().min(1).max(240),
    dueDate: IsoDateSchema,
    status: z.enum(['upcoming', 'due_soon', 'overdue', 'completed', 'not_applicable']),
    estimatedAmountPln: NonNegativePlnDecimalStringSchema.nullable(),
    legalBasis: LegalBasisReferenceSchema,
  })
  .strict();

export type MonthlyTaxObligation = z.infer<typeof MonthlyTaxObligationSchema>;

export const GetMonthlyTaxObligationsOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    obligations: z.array(MonthlyTaxObligationSchema),
    auditEventId: z.string().min(1),
  })
  .strict();

export type GetMonthlyTaxObligationsOutput = z.infer<typeof GetMonthlyTaxObligationsOutputSchema>;

/** 4. explain_accounting_item */
export const ExplainAccountingItemInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    accountingItemId: UuidSelectorSchema,
  })
  .strict();

export type ExplainAccountingItemInput = z.infer<typeof ExplainAccountingItemInputSchema>;

export const AccountingCalculationStepSchema = z
  .object({
    stepNumber: z.number().int().positive(),
    labelPl: z.string().min(1).max(300),
    formula: z.string().min(1).max(300),
    inputAmountPln: PlnDecimalStringSchema,
    resultAmountPln: PlnDecimalStringSchema,
    appliedRuleId: z.string().min(1).max(120),
  })
  .strict();

export type AccountingCalculationStep = z.infer<typeof AccountingCalculationStepSchema>;

export const ExplainAccountingItemOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    accountingItemId: UuidSelectorSchema,
    classification: z
      .object({
        kupAmountPln: NonNegativePlnDecimalStringSchema,
        nkupAmountPln: NonNegativePlnDecimalStringSchema,
        deductibleVatAmountPln: NonNegativePlnDecimalStringSchema,
        nonDeductibleVatAmountPln: NonNegativePlnDecimalStringSchema,
        taxCategoryCode: z.string().min(1).max(100),
        summaryPl: z.string().min(1).max(1000),
      })
      .strict(),
    calculationSteps: z.array(AccountingCalculationStepSchema).min(1),
    appliedRules: z.array(LegalBasisReferenceSchema).min(1),
    sourceDocumentSummary: UntrustedDocumentTextEnvelopeSchema,
    auditEventId: z.string().min(1),
  })
  .strict();

export type ExplainAccountingItemOutput = z.infer<typeof ExplainAccountingItemOutputSchema>;

/** 5. get_legal_basis */
export const GetLegalBasisInputSchema = z
  .object({
    obligationOrRuleCode: z.string().min(1).max(120),
    asOfDate: IsoDateSchema.optional(),
    tenantId: UuidSelectorSchema.optional(),
    legalEntityId: UuidSelectorSchema.optional(),
  })
  .strict();

export type GetLegalBasisInput = z.infer<typeof GetLegalBasisInputSchema>;

export const GetLegalBasisOutputSchema = z
  .object({
    code: z.string().min(1).max(120),
    titlePl: z.string().min(1).max(300),
    summaryPl: z.string().min(1).max(1500),
    legalBasis: LegalBasisReferenceSchema,
    exceptionsPl: z.array(z.string()),
    disclaimerPl: z.string().min(1),
    auditEventId: z.string().min(1),
  })
  .strict();

export type GetLegalBasisOutput = z.infer<typeof GetLegalBasisOutputSchema>;

/** 6. get_month_close_checklist */
export const GetMonthCloseChecklistInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
  })
  .strict();

export type GetMonthCloseChecklistInput = z.infer<typeof GetMonthCloseChecklistInputSchema>;

export const MonthCloseMissingDocumentSchema = z
  .object({
    code: z.string().min(1).max(100),
    descriptionPl: z.string().min(1).max(500),
    blocking: z.boolean(),
    contextNote: UntrustedDocumentTextEnvelopeSchema.nullable(),
  })
  .strict();

export const MonthCloseUnverifiedProposalSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    createdAt: IsoUtcTimestampSchema,
    grossAmountPln: NonNegativePlnDecimalStringSchema,
    counterpartyName: UntrustedDocumentTextEnvelopeSchema,
  })
  .strict();

export const MonthCloseUnreconciledTransferSchema = z
  .object({
    bankTransactionId: UuidSelectorSchema,
    bookingDate: IsoDateSchema,
    amountPln: PlnDecimalStringSchema,
    transferTitle: UntrustedDocumentTextEnvelopeSchema,
  })
  .strict();

export const MonthCloseDeclarationStatusSchema = z
  .object({
    code: z.string().min(1).max(80),
    namePl: z.string().min(1).max(240),
    dueDate: IsoDateSchema,
    status: z.enum(['upcoming', 'due_soon', 'overdue', 'completed', 'not_applicable']),
  })
  .strict();

export const GetMonthCloseChecklistOutputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: YearMonthSchema,
    readyToClose: z.boolean(),
    blockingItemsCount: z.number().int().nonnegative(),
    missingDocuments: z.array(MonthCloseMissingDocumentSchema),
    unverifiedAiProposals: z.array(MonthCloseUnverifiedProposalSchema),
    unreconciledBankTransfers: z.array(MonthCloseUnreconciledTransferSchema),
    upcomingDeclarations: z.array(MonthCloseDeclarationStatusSchema),
    auditEventId: z.string().min(1),
  })
  .strict();

export type GetMonthCloseChecklistOutput = z.infer<typeof GetMonthCloseChecklistOutputSchema>;

/** 7. prepare_invoice_and_posting_proposal */
export const ProposedPostingCategorySchema = z.enum([
  'towary_i_materialy',
  'pozostale_wydatki_kpir',
  'eksploatacja_samochodu_mieszana',
  'uslugi_obce',
  'przychod_sprzedaz',
]);

export type ProposedPostingCategory = z.infer<typeof ProposedPostingCategorySchema>;

export const PrepareInvoiceDraftPayloadSchema = z
  .object({
    direction: z.enum(['purchase', 'sales']),
    invoiceNumber: z.string().min(1).max(128),
    issueDate: IsoDateSchema,
    dueDate: IsoDateSchema,
    counterpartyNip: z.string().regex(/^\d{10}$/),
    counterpartyName: z.string().min(1).max(512),
    netAmountPln: NonNegativePlnDecimalStringSchema,
    vatAmountPln: NonNegativePlnDecimalStringSchema,
    grossAmountPln: NonNegativePlnDecimalStringSchema,
    expenseDescription: z.string().min(1).max(2000),
    suggestedCategory: ProposedPostingCategorySchema,
  })
  .strict()
  .superRefine((invoice, ctx) => {
    if (invoice.dueDate < invoice.issueDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message:
          'Termin płatności (dueDate) nie może być wcześniejszy niż data wystawienia (issueDate).',
      });
    }
    if (invoice.direction === 'sales' && invoice.suggestedCategory !== 'przychod_sprzedaz') {
      ctx.addIssue({
        code: 'custom',
        path: ['suggestedCategory'],
        message: 'Dla faktury sprzedaży (sales) jedyną spójną kategorią jest przychod_sprzedaz.',
      });
    }
    if (invoice.direction === 'purchase' && invoice.suggestedCategory === 'przychod_sprzedaz') {
      ctx.addIssue({
        code: 'custom',
        path: ['suggestedCategory'],
        message: 'Faktura zakupu (purchase) nie może używać kategorii przychod_sprzedaz.',
      });
    }
  });

export type PrepareInvoiceDraftPayload = z.infer<typeof PrepareInvoiceDraftPayloadSchema>;

export const PrepareInvoiceAndPostingProposalInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    requestId: UuidSelectorSchema.optional(),
    invoice: PrepareInvoiceDraftPayloadSchema,
  })
  .strict();

export type PrepareInvoiceAndPostingProposalInput = z.infer<
  typeof PrepareInvoiceAndPostingProposalInputSchema
>;

export const ProposedAccountingPreviewSchema = z
  .object({
    kpirColumnOrAccount: z.string().min(1).max(160),
    kupAmountPln: NonNegativePlnDecimalStringSchema,
    nkupAmountPln: NonNegativePlnDecimalStringSchema,
    deductibleVatAmountPln: NonNegativePlnDecimalStringSchema,
    nonDeductibleVatAmountPln: NonNegativePlnDecimalStringSchema,
    appliedRule: LegalBasisReferenceSchema,
  })
  .strict();

export type ProposedAccountingPreview = z.infer<typeof ProposedAccountingPreviewSchema>;

export const PrepareProposalLifecycleStatusSchema = z.enum([
  'pending_human_approval',
  'confirmed',
  'expired',
]);

export type PrepareProposalLifecycleStatus = z.infer<typeof PrepareProposalLifecycleStatusSchema>;

export const PrepareInvoiceAndPostingProposalOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: PrepareProposalLifecycleStatusSchema,
    ledgerPosted: z.boolean(),
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    payloadHash: Sha256HexSchema,
    createdAt: IsoUtcTimestampSchema,
    expiresAt: IsoUtcTimestampSchema,
    approvalUiPath: z.string().regex(/^\/approvals\/proposals\/[0-9a-f-]{36}$/i),
    humanApprovalInstructionsPl: z.string().min(1),
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

export type PrepareInvoiceAndPostingProposalOutput = z.infer<
  typeof PrepareInvoiceAndPostingProposalOutputSchema
>;

/** 8. confirm_prepared_proposal */
export const ConfirmPreparedProposalInputSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    idempotencyKey: UuidSelectorSchema,
    proposalId: UuidSelectorSchema,
    expectedPayloadHash: Sha256HexSchema,
    confirmationCode: z.string().min(16).max(256),
  })
  .strict();

export type ConfirmPreparedProposalInput = z.infer<typeof ConfirmPreparedProposalInputSchema>;

export const ConfirmPreparedProposalOutputSchema = z
  .object({
    proposalId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    status: z.literal('confirmed'),
    ledgerPosted: z.literal(true),
    ledgerEntryId: UuidSelectorSchema,
    confirmedAt: IsoUtcTimestampSchema,
    confirmedPayloadHash: Sha256HexSchema,
    idempotencyKey: UuidSelectorSchema,
    idempotentReplay: z.boolean(),
    auditEventId: z.string().min(1),
  })
  .strict();

export type ConfirmPreparedProposalOutput = z.infer<typeof ConfirmPreparedProposalOutputSchema>;
