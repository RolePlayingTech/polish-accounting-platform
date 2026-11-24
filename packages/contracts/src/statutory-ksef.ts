import { z } from 'zod';
import {
  NonNegativeGroszeSchema,
  SafeGroszeSchema,
  VatSettlementPeriodSchema,
  VatStatusSchema,
} from './accounting.js';
import {
  IsoCalendarDateSchema,
  TaxPeriodMonthSchema,
  TaxProfileCodeSchema,
} from './legal-rules.js';
import { IsoUtcTimestampSchema, Sha256HexSchema, UuidSelectorSchema } from './mcp-tools.js';

/**
 * Kontrakty Wave 2 (#82, #98, #99, GLD-09, GLD-10, GLD-11):
 * - Urzędowe eksporty JPK walidowane offline względem XSD MF (`JPK_V7M(3)`, `JPK_V7K(3)`, `JPK_V7M(2)`,
 *   `JPK_PKPIR(3)`, `JPK_EWP(4)`, `JPK_ST(1)`, `JPK_KR_PD(1)`, `JPK_ST_KR(1)`)
 * - Generowanie ustrukturyzowanych faktur sprzedaży `FA(3)` zgodnych z XSD MF (`13775`)
 * - Niemutowalne archiwum dokumentów źródłowych WORM (`ImmutableSourceDocumentArchive`, deduplikacja SHA-256)
 * - Adapter KSeF 2.0 Test/Demo/Local-Mock z twardą blokadą środowisk produkcyjnych (`403`) i potwierdzeniem człowieka
 */

export const OfficialJpkStructureCodeSchema = z.enum([
  'JPK_V7M(2)',
  'JPK_V7M(3)',
  'JPK_V7K(3)',
  'JPK_PKPIR(3)',
  'JPK_EWP(4)',
  'JPK_ST(1)',
  'JPK_KR_PD(1)',
  'JPK_ST_KR(1)',
]);
export type OfficialJpkStructureCodeContract = z.infer<typeof OfficialJpkStructureCodeSchema>;

export const ApplicableJpkStructureItemSchema = z
  .object({
    structureCode: OfficialJpkStructureCodeSchema,
    obligationKind: z.enum(['periodic_statutory', 'annual_statutory', 'on_demand_or_annual']),
    mandatoryForTaxYear: z.boolean(),
    statutoryEffectiveFrom: IsoCalendarDateSchema,
    officialNamespace: z.string().min(1),
    notesPl: z.string().min(1),
  })
  .strict();

export type ApplicableJpkStructureItemContract = z.infer<typeof ApplicableJpkStructureItemSchema>;

export const GetApplicableJpkResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: TaxPeriodMonthSchema,
    profileCode: TaxProfileCodeSchema,
    vatStatus: VatStatusSchema,
    vatSettlementPeriod: VatSettlementPeriodSchema,
    applicableStructures: z.array(ApplicableJpkStructureItemSchema),
  })
  .strict();

export type GetApplicableJpkResponse = z.infer<typeof GetApplicableJpkResponseSchema>;

export const JpkVatRefundTimeframeSchema = z.enum([
  '15_days',
  '25_days_vat_account',
  '25_days_art87_6',
  '40_days',
  '60_days',
  '180_days',
]);
export type JpkVatRefundTimeframeContract = z.infer<typeof JpkVatRefundTimeframeSchema>;

export const JpkFixedAssetInputRowSchema = z
  .object({
    inventoryNumber: z.string().min(1).max(64).optional(),
    assetKind: z.enum(['tangible', 'intangible']).default('tangible'),
    acquisitionDate: IsoCalendarDateSchema,
    acceptanceDate: IsoCalendarDateSchema,
    acceptanceDocumentNumber: z.string().min(1).max(128),
    acquisitionMode: z.enum(['S', 'D', 'N', 'W', 'F', 'I']).default('S'),
    assetName: z.string().min(1).max(256),
    kstSymbol: z.string().min(1).max(16).optional(),
    depreciationMethod: z.enum(['D', 'L', 'J', 'I', 'X']).default('L'),
    depreciationFrequency: z.enum(['M', 'K', 'R', 'J', 'S', 'I', 'X']).default('M'),
    annualRatePercent: z.number().min(0).max(100),
    initialValueGrosze: NonNegativeGroszeSchema,
    periodTaxDepreciationGrosze: NonNegativeGroszeSchema.default(0),
    cumulativeTaxDepreciationGrosze: NonNegativeGroszeSchema.default(0),
    accountingInitialValueGrosze: NonNegativeGroszeSchema.optional(),
    accountingRatePercent: z.number().min(0).max(100).optional(),
    periodAccountingDepreciationGrosze: NonNegativeGroszeSchema.optional(),
    cumulativeAccountingDepreciationGrosze: NonNegativeGroszeSchema.optional(),
    kstReclassifiedInYear: z.union([z.literal(1), z.literal(2)]).optional(),
  })
  .strict();

export type JpkFixedAssetInputRowContract = z.infer<typeof JpkFixedAssetInputRowSchema>;

export const ExportJpkRequestSchema = z
  .object({
    period: TaxPeriodMonthSchema,
    structureCode: OfficialJpkStructureCodeSchema,
    purpose: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
    taxOfficeCode: z
      .string()
      .regex(/^\d{4}$/, 'Kod urzędu skarbowego (TKodUS) musi składać się z 4 cyfr')
      .optional(),
    refundTimeframe: JpkVatRefundTimeframeSchema.optional(),
    correctionJustification: z.string().min(3).max(500).optional(),
    openingInventoryGrosze: NonNegativeGroszeSchema.optional(),
    closingInventoryGrosze: NonNegativeGroszeSchema.optional(),
    fixedAssets: z.array(JpkFixedAssetInputRowSchema).max(500).optional(),
  })
  .strict();

export type ExportJpkRequest = z.infer<typeof ExportJpkRequestSchema>;

export const ExportJpkSummarySchema = z
  .object({
    rowsCount: z.number().int().nonnegative(),
    p39CarryoverPln: z.number().int().nonnegative().optional(),
    p51TaxDuePln: z.number().int().nonnegative().optional(),
    p53ExcessPln: z.number().int().nonnegative().optional(),
    p54RefundPln: z.number().int().nonnegative().optional(),
    p62CarryForwardPln: z.number().int().nonnegative().optional(),
  })
  .strict();

export const ExportJpkResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    period: TaxPeriodMonthSchema,
    structureCode: OfficialJpkStructureCodeSchema,
    purpose: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    submissionStatus: z.literal('local_xml_only_not_submitted'),
    lifecycleStatus: z.literal('exported_xsd_valid_awaiting_signature'),
    officialUpoReferenceNumber: z.null(),
    externalSignatureRequired: z.literal(true),
    externalSubmissionRequired: z.literal(true),
    xsdValid: z.literal(true),
    officialNamespace: z.string().min(1),
    officialSchemaSourceUrl: z.string().url(),
    officialSchemaSha256: Sha256HexSchema,
    xmlSha256Hex: Sha256HexSchema,
    xmlByteLength: z.number().int().positive(),
    xmlContent: z.string().min(1),
    generatedAtIso: IsoUtcTimestampSchema,
    summary: ExportJpkSummarySchema,
    truthfulnessNoticePl: z.string().min(1),
  })
  .strict();

export type ExportJpkResponse = z.infer<typeof ExportJpkResponseSchema>;

/** 2. FA(3) XML Export from Live Company Sales Invoice (#82, #99, GLD-09) */
export const GenerateInvoiceFa3XmlRequestSchema = z
  .object({
    sellerBankAccountIban: z.string().min(15).max(34).optional(),
    paymentMethodCode: z.enum(['1', '2', '3', '4', '5', '6', '7']).optional(),
    buyerJstSubordinateUnit: z.boolean().optional(),
    buyerVatGroupMember: z.boolean().optional(),
  })
  .strict();

export type GenerateInvoiceFa3XmlRequest = z.infer<typeof GenerateInvoiceFa3XmlRequestSchema>;

export const GenerateInvoiceFa3XmlResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    documentId: UuidSelectorSchema,
    documentNumber: z.string().min(1),
    schemaVersion: z.literal('FA(3)'),
    xsdValid: z.literal(true),
    officialNamespace: z.literal('http://crd.gov.pl/wzor/2025/06/25/13775/'),
    officialSchemaSha256: Sha256HexSchema,
    xmlSha256Hex: Sha256HexSchema,
    xmlByteLength: z.number().int().positive(),
    xmlContent: z.string().min(1),
    totalNetGrosze: SafeGroszeSchema,
    totalVatGrosze: SafeGroszeSchema,
    totalGrossGrosze: SafeGroszeSchema,
    generatedAtIso: IsoUtcTimestampSchema,
    submissionStatus: z.literal('local_xml_only_not_submitted'),
  })
  .strict();

export type GenerateInvoiceFa3XmlResponse = z.infer<typeof GenerateInvoiceFa3XmlResponseSchema>;

/** 3. Immutable Source Document Archive (#99, GLD-09) */
export const SourceArtifactKindSchema = z.enum(['ksef_xml', 'pdf', 'jpeg', 'png', 'csv', 'json']);
export const AllowedSourceMimeTypeSchema = z.enum([
  'application/xml',
  'text/xml',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/csv',
  'application/json',
]);

const OcrStringFieldConfidenceSchema = z
  .object({
    value: z.string().min(1).max(512),
    confidenceBps: z.number().int().min(0).max(10_000),
  })
  .strict();

const OcrGroszeFieldConfidenceSchema = z
  .object({
    value: SafeGroszeSchema,
    confidenceBps: z.number().int().min(0).max(10_000),
  })
  .strict();

export const OcrExtractionDraftProposalInputSchema = z
  .object({
    extractorId: z.string().min(1).max(120),
    extractedAtIso: IsoUtcTimestampSchema,
    overallConfidenceBps: z.number().int().min(0).max(10_000),
    documentNumber: OcrStringFieldConfidenceSchema.optional(),
    issueDate: OcrStringFieldConfidenceSchema.optional(),
    saleDate: OcrStringFieldConfidenceSchema.optional(),
    dueDate: OcrStringFieldConfidenceSchema.optional(),
    counterpartyNip: OcrStringFieldConfidenceSchema.optional(),
    counterpartyName: OcrStringFieldConfidenceSchema.optional(),
    netGrosze: OcrGroszeFieldConfidenceSchema.optional(),
    vatGrosze: OcrGroszeFieldConfidenceSchema.optional(),
    grossGrosze: OcrGroszeFieldConfidenceSchema.optional(),
    warningsPl: z.array(z.string().min(1).max(400)).default([]),
  })
  .strict();

export const OcrExtractionDraftProposalResponseSchema =
  OcrExtractionDraftProposalInputSchema.extend({
    requiresHumanApproval: z.literal(true),
  }).strict();

export const SourceArchiveArtifactItemSchema = z
  .object({
    artifactId: UuidSelectorSchema,
    tenantId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    uploadedByUserId: UuidSelectorSchema,
    uploadedAtIso: IsoUtcTimestampSchema,
    fileName: z.string().min(1).max(200),
    mimeType: AllowedSourceMimeTypeSchema,
    kind: SourceArtifactKindSchema,
    byteLength: z.number().int().positive(),
    sha256Hex: Sha256HexSchema,
    linkedDocumentId: UuidSelectorSchema.nullable(),
    ksefReferenceNumber: z.string().min(1).max(80).nullable(),
    immutable: z.literal(true),
    ocrProposal: OcrExtractionDraftProposalResponseSchema.nullable(),
  })
  .strict();

export type SourceArchiveArtifactItemContract = z.infer<typeof SourceArchiveArtifactItemSchema>;

export const StoreSourceArchiveRequestSchema = z
  .object({
    fileName: z.string().min(1).max(200),
    declaredMimeType: AllowedSourceMimeTypeSchema,
    contentBase64: z.string().min(1).max(22_000_000).optional(),
    rawTextContent: z.string().min(1).max(5_000_000).optional(),
    linkedDocumentId: UuidSelectorSchema.optional(),
    ksefReferenceNumber: z.string().min(1).max(80).optional(),
    ocrProposal: OcrExtractionDraftProposalInputSchema.optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasBase64 = val.contentBase64 !== undefined;
    const hasText = val.rawTextContent !== undefined;
    if (!hasBase64 && !hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contentBase64'],
        message:
          'Wymagane jest przekazanie zawartości pliku źródłowego (contentBase64 lub rawTextContent).',
      });
    }
    if (hasBase64 && hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rawTextContent'],
        message: 'Podaj wyłącznie jedno źródło bajtów: contentBase64 albo rawTextContent.',
      });
    }
  });

export type StoreSourceArchiveRequest = z.infer<typeof StoreSourceArchiveRequestSchema>;

export const SplitVerificationPreviewSchema = z
  .object({
    artifactId: UuidSelectorSchema,
    fileName: z.string().min(1).max(200),
    mimeType: AllowedSourceMimeTypeSchema,
    kind: SourceArtifactKindSchema,
    byteLength: z.number().int().positive(),
    sha256Hex: Sha256HexSchema,
    previewMode: z.enum(['pdf_embed', 'image_viewer', 'xml_source', 'structured_text']),
    authorizedDownloadPath: z.string().min(1),
    requiresHumanApproval: z.literal(true),
    ocrProposal: OcrExtractionDraftProposalResponseSchema.nullable(),
  })
  .strict();

export const StoreSourceArchiveResponseSchema = z
  .object({
    artifact: SourceArchiveArtifactItemSchema,
    splitVerificationPreview: SplitVerificationPreviewSchema,
  })
  .strict();

export type StoreSourceArchiveResponse = z.infer<typeof StoreSourceArchiveResponseSchema>;

export const ListSourceArchiveResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    artifacts: z.array(SourceArchiveArtifactItemSchema),
  })
  .strict();

export type ListSourceArchiveResponse = z.infer<typeof ListSourceArchiveResponseSchema>;

/** 4. KSeF 2.0 Test/Demo Sandbox API (GLD-10) */
export const KsefNonProductionEnvironmentSchema = z.enum(['test', 'demo', 'local_mock']);
export type KsefNonProductionEnvironmentContract = z.infer<
  typeof KsefNonProductionEnvironmentSchema
>;

export const KsefPublicEndpointProbeSummarySchema = z
  .object({
    checkedAtIso: IsoUtcTimestampSchema,
    environment: KsefNonProductionEnvironmentSchema,
    baseUrl: z.string().min(1),
    reachable: z.boolean(),
    httpStatus: z.number().int().nullable(),
    certificatesCount: z.number().int().nonnegative(),
    hasKsefTokenEncryptionKey: z.boolean(),
    hasSymmetricKeyEncryptionKey: z.boolean(),
    verificationMode: z.enum([
      'live_readonly_probe_ok_auth_not_configured',
      'live_readonly_probe_ok_auth_configured',
      'probe_unreachable',
      'cached_baseline_probe',
    ]),
    detail: z.string().min(1),
  })
  .strict();

export const GetKsefStatusResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    companyNip: z.string().regex(/^\d{10}$/),
    defaultEnvironment: KsefNonProductionEnvironmentSchema,
    productionEndpointsHardBlocked: z.literal(true),
    allowedNonProductionHosts: z.array(z.string().min(1)),
    blockedProductionHosts: z.array(z.string().min(1)),
    liveAuthCredentialsConfigured: z.boolean(),
    externalAuthenticatedE2eStatus: z.enum([
      'not_run_missing_owner_sandbox_credentials',
      'configured_ready',
    ]),
    readOnlyPublicEndpointProbe: KsefPublicEndpointProbeSummarySchema,
    truthfulnessNoticePl: z.string().min(1),
  })
  .strict();

export type GetKsefStatusResponse = z.infer<typeof GetKsefStatusResponseSchema>;

export const KsefHumanConfirmationSchema = z
  .object({
    confirmedByHuman: z.boolean(),
    confirmationNote: z.string().min(1).max(500).optional(),
  })
  .strict();

export const IssueKsefSandboxRequestSchema = z
  .object({
    documentId: UuidSelectorSchema.optional(),
    fa3Xml: z.string().min(1).max(262_144).optional(),
    environment: KsefNonProductionEnvironmentSchema.default('local_mock'),
    targetBaseUrl: z.string().min(1).max(512).optional(),
    idempotencyKey: z.string().min(1).max(128).optional(),
    sandboxAccessToken: z.string().min(1).max(4096).optional(),
    symmetricKeyEncryptionCertOrPem: z.string().min(1).max(16_384).optional(),
    humanConfirmation: KsefHumanConfirmationSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.documentId && !val.fa3Xml) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['documentId'],
        message:
          'Wymagane jest wskazanie identyfikatora faktury sprzedaży (documentId) lub przekazanie dokumentu XML FA(3) (fa3Xml).',
      });
    }
  });

export type IssueKsefSandboxRequest = z.infer<typeof IssueKsefSandboxRequestSchema>;

export const IssueKsefSandboxResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    environment: KsefNonProductionEnvironmentSchema,
    executionMode: z.enum(['remote_mf_sandbox', 'local_sandbox_mock']),
    outcome: z.enum([
      'accepted_ksef_number_assigned',
      'accepted_pending_upo',
      'duplicate_reconciled',
      'rejected_by_ksef',
    ]),
    idempotencyKey: z.string().min(1),
    replayedFromOutbox: z.boolean(),
    sessionReferenceNumber: z.string().min(1),
    invoiceReferenceNumber: z.string().min(1),
    ksefNumber: z.string().min(1).nullable(),
    invoiceSha256Hex: Sha256HexSchema,
    invoiceSha256Base64: z.string().min(1),
    acquisitionDate: z.string().min(1).nullable(),
    upoStatus: z.enum(['validated_v4_3', 'pending_external_upo', 'not_applicable']),
    upoSha256Hex: Sha256HexSchema.nullable(),
    ksefStatusCode: z.number().int(),
    ksefStatusDescription: z.string().min(1),
    archivedArtifactId: UuidSelectorSchema.nullable(),
    truthfulnessNoticePl: z.string().min(1),
  })
  .strict();

export type IssueKsefSandboxResponse = z.infer<typeof IssueKsefSandboxResponseSchema>;

export const SyncKsefIncomingRequestSchema = z
  .object({
    fromIso: IsoUtcTimestampSchema,
    toIso: IsoUtcTimestampSchema,
    dateType: z.enum(['PermanentStorage', 'Invoicing', 'Issue']).default('PermanentStorage'),
    environment: KsefNonProductionEnvironmentSchema.default('local_mock'),
    targetBaseUrl: z.string().min(1).max(512).optional(),
    sandboxAccessToken: z.string().min(1).max(4096).optional(),
    createVerificationDrafts: z.boolean().default(true),
    mockIncomingFaXmls: z.array(z.string().min(1).max(262_144)).max(25).optional(),
  })
  .strict();

export type SyncKsefIncomingRequest = z.infer<typeof SyncKsefIncomingRequestSchema>;

export const SyncedKsefIncomingInvoiceSummarySchema = z
  .object({
    ksefNumber: z.string().min(1),
    invoiceNumber: z.string().min(1),
    sellerNip: z.string().regex(/^\d{10}$/),
    buyerNip: z.string().nullable(),
    schemaVersion: z.enum(['FA(2)', 'FA(3)']),
    netAmountGrosze: SafeGroszeSchema,
    vatAmountGrosze: SafeGroszeSchema,
    grossAmountGrosze: SafeGroszeSchema,
    currency: z.string().min(1),
    archivedArtifactId: UuidSelectorSchema.nullable(),
    deduplicatedInArchive: z.boolean(),
    draftDocumentId: UuidSelectorSchema.nullable(),
  })
  .strict();

export const SyncKsefIncomingResponseSchema = z
  .object({
    tenantId: UuidSelectorSchema,
    companyId: UuidSelectorSchema,
    legalEntityId: UuidSelectorSchema,
    environment: KsefNonProductionEnvironmentSchema,
    executionMode: z.enum(['remote_mf_sandbox', 'local_sandbox_mock']),
    fetchedCount: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    isTruncated: z.boolean(),
    permanentStorageHwmDate: z.string().nullable(),
    items: z.array(SyncedKsefIncomingInvoiceSummarySchema),
    truthfulnessNoticePl: z.string().min(1),
  })
  .strict();

export type SyncKsefIncomingResponse = z.infer<typeof SyncKsefIncomingResponseSchema>;
