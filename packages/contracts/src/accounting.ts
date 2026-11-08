import { z } from 'zod';
import {
  IsoCalendarDateSchema,
  LegalExplanationSchema,
  ProfileSupportLevelSchema,
  TaxPeriodMonthSchema,
  TaxProfileCodeSchema,
} from './legal-rules.js';

export const SafeGroszeSchema = z
  .number()
  .int()
  .refine((value) => Number.isSafeInteger(value), {
    message: 'Kwota w groszach musi być bezpieczną liczbą całkowitą (safe integer)',
  });

export const NonNegativeGroszeSchema = SafeGroszeSchema.refine((value) => value >= 0, {
  message: 'Kwota w groszach nie może być ujemna',
});

export const VatRateCodeSchema = z.enum(['23', '8', '5', '0', 'zw', 'np']);

export const RyczaltRateCodeSchema = z.enum([
  '17',
  '15',
  '14',
  '12.5',
  '12',
  '10',
  '8.5',
  '5.5',
  '3',
  '2',
]);

export const VatStatusSchema = z.enum(['czynny', 'zwolniony_art_113', 'zwolniony_przedmiotowo']);

export const VatSettlementPeriodSchema = z.enum(['monthly', 'quarterly', 'not_applicable']);

export const ZusSchemeSchema = z.enum([
  'ulga_na_start',
  'preferencyjny_zus',
  'duzy_zus',
  'not_applicable',
]);

export const HealthContributionTierSchema = z.enum([
  'low',
  'medium',
  'middle',
  'high',
  'standard',
]);
export type HealthContributionTierContract = z.infer<typeof HealthContributionTierSchema>;

export const TaxProfileConfigSchema = z
  .object({
    profileCode: TaxProfileCodeSchema,
    supportLevel: ProfileSupportLevelSchema,
    nip: z.string().regex(/^\d{10}$/, 'NIP musi składać się z 10 cyfr'),
    regon: z
      .string()
      .regex(/^(\d{9}|\d{14})$/)
      .optional(),
    krs: z
      .string()
      .regex(/^\d{10}$/)
      .optional(),
    companyName: z.string().min(1),
    activityStartDate: IsoCalendarDateSchema,
    vatStatus: VatStatusSchema,
    vatSettlementPeriod: VatSettlementPeriodSchema,
    zusScheme: ZusSchemeSchema,
    voluntarySicknessInsurance: z.boolean(),
    accidentRateBps: z.number().int().min(0).max(500),
    insuredPersonsCount: z.number().int().min(0),
    smallTaxpayer: z.boolean(),
    ksefSales2024Above200M: z.boolean(),
    ceidgRegisteredBefore2025: z.boolean().optional(),
    krsRegisteredBefore2025: z.boolean().optional(),
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
    vatPayer: z.boolean().optional(),
    vatPeriod: VatSettlementPeriodSchema.optional(),
    ksefEnabled: z.boolean().optional(),
    ryczaltDefaultRate: RyczaltRateCodeSchema.optional(),
    healthContributionTier: HealthContributionTierSchema.optional(),
  })
  .strict();

export const DocumentLineItemSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    description: z.string().min(1),
    quantity: z.string().min(1),
    unit: z.string().min(1),
    netGrosze: SafeGroszeSchema,
    vatRate: VatRateCodeSchema,
    vatGrosze: SafeGroszeSchema,
    grossGrosze: SafeGroszeSchema,
    annex15Item: z.boolean(),
  })
  .strict()
  .refine((item) => item.netGrosze + item.vatGrosze === item.grossGrosze, {
    message: 'Suma netGrosze + vatGrosze musi być równa grossGrosze',
    path: ['grossGrosze'],
  });

export const KsefInvoiceMarkerSchema = z.enum(['NrKSeF', 'OFF', 'BFK', 'DI']);

export const AccountingDocumentSchema = z
  .object({
    documentId: z.string().min(1),
    documentNumber: z.string().min(1),
    direction: z.enum(['sales', 'purchase']),
    issueDate: IsoCalendarDateSchema,
    eventDate: IsoCalendarDateSchema,
    dueDate: IsoCalendarDateSchema.optional(),
    counterpartyName: z.string().min(1),
    counterpartyNip: z
      .string()
      .regex(/^[A-Z]{0,2}\d{8,12}$/)
      .optional(),
    counterpartyAddress: z.string().min(1).optional(),
    counterpartyIban: z.string().min(1).optional(),
    currency: z.literal('PLN'),
    ksefReferenceNumber: z.string().min(1).optional(),
    ksefMarker: KsefInvoiceMarkerSchema.optional(),
    lines: z.array(DocumentLineItemSchema).min(1),
    totalNetGrosze: SafeGroszeSchema,
    totalVatGrosze: SafeGroszeSchema,
    totalGrossGrosze: SafeGroszeSchema,
    totalGrossFormatted: z.string().min(1),
  })
  .strict()
  .refine((doc) => doc.totalNetGrosze + doc.totalVatGrosze === doc.totalGrossGrosze, {
    message: 'Suma totalNetGrosze + totalVatGrosze musi być równa totalGrossGrosze',
    path: ['totalGrossGrosze'],
  });

export const KpirExpenseQualificationKindSchema = z.enum([
  'none',
  'goods_and_materials_col10',
  'incidental_purchase_costs_col11',
  'remuneration_col12',
  'other_expenses_100_col13',
  'vehicle_mixed_75_col13',
  'research_development_col16',
  'nkup_excluded',
]);

export const KpirEntrySchema = z
  .object({
    id: z.string().min(1),
    ordinalNumber: z.number().int().positive(),
    period: TaxPeriodMonthSchema,
    eventDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1),
    ksefReferenceNumber: z.string().min(1).optional(),
    counterpartyName: z.string().min(1),
    counterpartyNip: z.string().min(1).optional(),
    counterpartyAddress: z.string().min(1),
    eventDescription: z.string().min(1),
    col7SalesRevenueGrosze: SafeGroszeSchema,
    col8OtherRevenueGrosze: SafeGroszeSchema,
    col9TotalRevenueGrosze: SafeGroszeSchema,
    col10GoodsAndMaterialsGrosze: SafeGroszeSchema,
    col11IncidentalCostsGrosze: SafeGroszeSchema,
    col12RemunerationGrosze: SafeGroszeSchema,
    col13OtherExpensesGrosze: SafeGroszeSchema,
    col14TotalExpensesGrosze: SafeGroszeSchema,
    col15FreeColumnNote: z.string().optional(),
    col16ResearchDevelopmentDescription: z.string().optional(),
    col16ResearchDevelopmentCostGrosze: SafeGroszeSchema,
    col17Remarks: z.string().optional(),
    qualificationKind: KpirExpenseQualificationKindSchema,
    isCorrection: z.boolean(),
    correctedEntryId: z.string().min(1).optional(),
    correctionReason: z.string().min(1).optional(),
    regulationVersion: z.enum(['pkpir_2019_17col', 'pkpir_2026_ksef']),
    explanation: LegalExplanationSchema,
  })
  .strict()
  .refine(
    (entry) =>
      entry.col7SalesRevenueGrosze + entry.col8OtherRevenueGrosze === entry.col9TotalRevenueGrosze,
    {
      message: 'Kolumna 9 KPiR musi równać się sumie kolumn 7 i 8',
      path: ['col9TotalRevenueGrosze'],
    },
  )
  .refine(
    (entry) =>
      entry.col12RemunerationGrosze + entry.col13OtherExpensesGrosze ===
      entry.col14TotalExpensesGrosze,
    {
      message: 'Kolumna 14 KPiR musi równać się sumie kolumn 12 i 13',
      path: ['col14TotalExpensesGrosze'],
    },
  )
  .refine(
    (entry) =>
      !entry.isCorrection ||
      (entry.correctedEntryId !== undefined &&
        entry.correctionReason !== undefined &&
        entry.correctionReason.trim().length > 0),
    {
      message: 'Wpis korygujący KPiR wymaga correctedEntryId oraz uzasadnienia correctionReason',
      path: ['correctionReason'],
    },
  );

export const RyczaltEntrySchema = z
  .object({
    id: z.string().min(1),
    ordinalNumber: z.number().int().positive(),
    period: TaxPeriodMonthSchema,
    entryDate: IsoCalendarDateSchema,
    revenueDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1),
    ksefReferenceNumber: z.string().min(1).optional(),
    counterpartyName: z.string().min(1),
    counterpartyNip: z.string().min(1).optional(),
    rate: RyczaltRateCodeSchema,
    revenueGrosze: SafeGroszeSchema,
    revenueFormatted: z.string().min(1),
    remarks: z.string().optional(),
    isCorrection: z.boolean(),
    correctedEntryId: z.string().min(1).optional(),
    correctionReason: z.string().min(1).optional(),
  })
  .strict();

export const VatDeductionModeSchema = z.enum(['full_100', 'vehicle_mixed_50', 'none_0']);

export const VatRegisterEntrySchema = z
  .object({
    id: z.string().min(1),
    registerType: z.enum(['sales', 'purchase']),
    period: TaxPeriodMonthSchema,
    taxPointDate: IsoCalendarDateSchema,
    issueDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1),
    counterpartyName: z.string().min(1),
    counterpartyNip: z.string().min(1).optional(),
    vatRate: VatRateCodeSchema,
    netGrosze: SafeGroszeSchema,
    vatTotalGrosze: SafeGroszeSchema,
    grossGrosze: SafeGroszeSchema,
    deductionMode: VatDeductionModeSchema,
    deductibleVatGrosze: SafeGroszeSchema,
    nonDeductibleVatGrosze: SafeGroszeSchema,
    mandatorySplitPaymentMpp: z.boolean(),
    ksefMarker: KsefInvoiceMarkerSchema,
    ksefReferenceNumber: z.string().min(1).optional(),
    explanation: LegalExplanationSchema,
  })
  .strict()
  .refine(
    (entry) => entry.deductibleVatGrosze + entry.nonDeductibleVatGrosze === entry.vatTotalGrosze,
    {
      message: 'Suma VAT odliczanego i nieodliczanego musi być równa kwocie VAT ogółem',
      path: ['deductibleVatGrosze'],
    },
  );

export const LedgerSideSchema = z.enum(['Wn', 'Ma']);

export const JournalEntryLineSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    accountCode: z.string().regex(/^\d{3}(-\d{1,4})?$/, 'Wymagany kod konta np. 130 lub 201-01'),
    side: LedgerSideSchema,
    amountGrosze: SafeGroszeSchema,
    description: z.string().min(1),
    isRedStorno: z.boolean(),
    stornoReason: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (line) =>
      line.isRedStorno
        ? line.amountGrosze < 0 && line.stornoReason !== undefined
        : line.amountGrosze > 0,
    {
      message:
        'Kwota dekretu musi być dodatnia, chyba że jawnie oznaczono storno czerwone z uzasadnieniem',
      path: ['amountGrosze'],
    },
  );

export const JournalEntrySchema = z
  .object({
    id: z.string().min(1),
    entryNumber: z.string().min(1),
    period: TaxPeriodMonthSchema,
    bookingDate: IsoCalendarDateSchema,
    documentDate: IsoCalendarDateSchema,
    documentNumber: z.string().min(1),
    description: z.string().min(1),
    lines: z.array(JournalEntryLineSchema).min(2),
    totalWnGrosze: SafeGroszeSchema,
    totalMaGrosze: SafeGroszeSchema,
  })
  .strict()
  .refine((entry) => entry.totalWnGrosze === entry.totalMaGrosze, {
    message: 'Dekret księgowy narusza zasadę podwójnego zapisu: SUM(Wn) musi równać się SUM(Ma)',
    path: ['totalMaGrosze'],
  });

export const TaxObligationCategorySchema = z.enum([
  'vat',
  'pit',
  'ryczalt',
  'cit',
  'zus',
  'jpk_income_tax',
  'ksef',
  'edoreczenia',
]);

export const TaxCalendarObligationSchema = z
  .object({
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
    status: z.enum(['applicable', 'exempt_transitional', 'informational']),
    explanation: LegalExplanationSchema,
  })
  .strict();

export const BankStatementTransactionSchema = z
  .object({
    transactionId: z.string().min(1),
    bookingDate: IsoCalendarDateSchema,
    valueDate: IsoCalendarDateSchema.optional(),
    direction: z.enum(['credit', 'debit']),
    amountGrosze: NonNegativeGroszeSchema,
    amountFormatted: z.string().min(1),
    currency: z.literal('PLN'),
    counterpartyName: z.string().min(1),
    counterpartyIban: z.string().min(1).optional(),
    counterpartyNip: z.string().min(1).optional(),
    title: z.string().min(1),
    rawReference: z.string().optional(),
  })
  .strict();

export const BankReconciliationStatusSchema = z.enum([
  'matched_exact',
  'matched_partial',
  'overpaid',
  'ambiguous_manual_review',
  'unmatched',
]);

export const BankReconciliationMatchSchema = z
  .object({
    transactionId: z.string().min(1),
    status: BankReconciliationStatusSchema,
    matchedDocumentId: z.string().min(1).optional(),
    matchedDocumentNumber: z.string().min(1).optional(),
    candidateDocumentIds: z.array(z.string().min(1)),
    matchedCriterion: z
      .enum([
        'invoice_number_and_amount',
        'invoice_number_partial_or_overpaid',
        'nip_or_iban_and_exact_amount',
        'ambiguous_candidates',
        'none',
      ])
      .optional(),
    transactionAmountGrosze: NonNegativeGroszeSchema,
    settledAmountGrosze: NonNegativeGroszeSchema,
    remainingDocumentAmountGrosze: NonNegativeGroszeSchema,
    overpaymentGrosze: NonNegativeGroszeSchema,
    notes: z.string().min(1),
  })
  .strict();

export type SafeGrosze = z.infer<typeof SafeGroszeSchema>;
export type VatRateCodeContract = z.infer<typeof VatRateCodeSchema>;
export type RyczaltRateCodeContract = z.infer<typeof RyczaltRateCodeSchema>;
export type VatStatusContract = z.infer<typeof VatStatusSchema>;
export type VatSettlementPeriodContract = z.infer<typeof VatSettlementPeriodSchema>;
export type ZusSchemeContract = z.infer<typeof ZusSchemeSchema>;
export type TaxProfileConfigContract = z.infer<typeof TaxProfileConfigSchema>;
export type DocumentLineItemContract = z.infer<typeof DocumentLineItemSchema>;
export type KsefInvoiceMarkerContract = z.infer<typeof KsefInvoiceMarkerSchema>;
export type AccountingDocumentContract = z.infer<typeof AccountingDocumentSchema>;
export type KpirExpenseQualificationKindContract = z.infer<
  typeof KpirExpenseQualificationKindSchema
>;
export type KpirEntryContract = z.infer<typeof KpirEntrySchema>;
export type RyczaltEntryContract = z.infer<typeof RyczaltEntrySchema>;
export type VatDeductionModeContract = z.infer<typeof VatDeductionModeSchema>;
export type VatRegisterEntryContract = z.infer<typeof VatRegisterEntrySchema>;
export type LedgerSideContract = z.infer<typeof LedgerSideSchema>;
export type JournalEntryLineContract = z.infer<typeof JournalEntryLineSchema>;
export type JournalEntryContract = z.infer<typeof JournalEntrySchema>;
export type TaxObligationCategoryContract = z.infer<typeof TaxObligationCategorySchema>;
export type TaxCalendarObligationContract = z.infer<typeof TaxCalendarObligationSchema>;
export type BankStatementTransactionContract = z.infer<typeof BankStatementTransactionSchema>;
export type BankReconciliationStatusContract = z.infer<typeof BankReconciliationStatusSchema>;
export type BankReconciliationMatchContract = z.infer<typeof BankReconciliationMatchSchema>;
