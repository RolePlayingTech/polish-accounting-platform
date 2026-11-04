import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { legalEntity } from './core-schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });
const grosze = (name: string) => bigint(name, { mode: 'number' });

export const companyTaxSettings = pgTable(
  'company_tax_settings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    nip: text('nip').notNull(),
    regon: text('regon'),
    krs: text('krs'),
    legalForm: text('legal_form', {
      enum: ['jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna'],
    }).notNull(),
    taxRegime: text('tax_regime', {
      enum: ['kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny'],
    }).notNull(),
    vatStatus: text('vat_status', { enum: ['czynny', 'zwolniony'] }).notNull(),
    zusStage: text('zus_stage', {
      enum: ['ulga_na_start', 'preferencyjny', 'maly_zus_plus', 'duzy_zus', 'brak_sp_zoo'],
    }).notNull(),
    ksefMode: text('ksef_mode', {
      enum: ['mandatory_2026_feb', 'mandatory_2026_apr', 'micro_exempt_10k_2026', 'voluntary'],
    }).notNull(),
    defaultIban: text('default_iban'),
    addressSummary: text('address_summary').notNull(),
    smallTaxpayer: boolean('small_taxpayer').notNull().default(true),
    voluntarySicknessInsurance: boolean('voluntary_sickness_insurance').notNull().default(true),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedBy: uuid('updated_by').notNull(),
  },
  (table) => [
    unique('company_tax_settings_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('company_tax_settings_entity_unique').on(table.tenantId, table.legalEntityId),
    foreignKey({
      name: 'company_tax_settings_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('company_tax_settings_nip_check', sql`${table.nip} ~ '^[0-9]{10}$'`),
    check(
      'company_tax_settings_regon_check',
      sql`${table.regon} IS NULL OR ${table.regon} ~ '^([0-9]{9}|[0-9]{14})$'`,
    ),
    check(
      'company_tax_settings_krs_check',
      sql`${table.krs} IS NULL OR ${table.krs} ~ '^[0-9]{10}$'`,
    ),
    check(
      'company_tax_settings_legal_form_check',
      sql`${table.legalForm} IN ('jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna')`,
    ),
    check(
      'company_tax_settings_tax_regime_check',
      sql`${table.taxRegime} IN ('kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny')`,
    ),
    check(
      'company_tax_settings_vat_status_check',
      sql`${table.vatStatus} IN ('czynny', 'zwolniony')`,
    ),
    check(
      'company_tax_settings_zus_stage_check',
      sql`${table.zusStage} IN ('ulga_na_start', 'preferencyjny', 'maly_zus_plus', 'duzy_zus', 'brak_sp_zoo')`,
    ),
    check(
      'company_tax_settings_ksef_mode_check',
      sql`${table.ksefMode} IN ('mandatory_2026_feb', 'mandatory_2026_apr', 'micro_exempt_10k_2026', 'voluntary')`,
    ),
    check(
      'company_tax_settings_iban_check',
      sql`${table.defaultIban} IS NULL OR btrim(${table.defaultIban}) <> ''`,
    ),
    check('company_tax_settings_address_check', sql`btrim(${table.addressSummary}) <> ''`),
    check('company_tax_settings_updated_at_check', sql`isfinite(${table.updatedAt})`),
  ],
).enableRLS();

export const accountingDocument = pgTable(
  'accounting_document',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    documentType: text('document_type', {
      enum: ['sales_invoice', 'purchase_invoice', 'correction_invoice', 'receipt', 'internal_note'],
    }).notNull(),
    documentNumber: text('document_number').notNull(),
    issueDate: text('issue_date').notNull(),
    saleDate: text('sale_date').notNull(),
    dueDate: text('due_date'),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyNip: text('counterparty_nip'),
    counterpartyAddress: text('counterparty_address'),
    currency: text('currency', { enum: ['PLN'] })
      .notNull()
      .default('PLN'),
    netGrosze: grosze('net_grosze').notNull(),
    vatGrosze: grosze('vat_grosze').notNull(),
    grossGrosze: grosze('gross_grosze').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    status: text('status', {
      enum: ['draft', 'ai_proposed', 'verified_posted', 'archived'],
    }).notNull(),
    categoryCode: text('category_code').notNull(),
    description: text('description').notNull().default(''),
    vehicleUsage: text('vehicle_usage', {
      enum: ['none', 'mixed_50_75', 'exclusive_100'],
    })
      .notNull()
      .default('none'),
    ksefReference: text('ksef_reference'),
    ksefMarker: text('ksef_marker', { enum: ['NONE', 'OFF', 'BFK', 'DI'] })
      .notNull()
      .default('NONE'),
    aiProposalJson: jsonb('ai_proposal_json').$type<Readonly<Record<string, unknown>> | null>(),
    verifiedBy: uuid('verified_by'),
    verifiedAt: instant('verified_at'),
    createdBy: uuid('created_by').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('accounting_document_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('accounting_document_sha256_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.sha256Hash,
    ),
    index('accounting_document_status_issue_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.status,
      table.issueDate,
    ),
    foreignKey({
      name: 'accounting_document_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'accounting_document_type_check',
      sql`${table.documentType} IN ('sales_invoice', 'purchase_invoice', 'correction_invoice', 'receipt', 'internal_note')`,
    ),
    check('accounting_document_number_check', sql`btrim(${table.documentNumber}) <> ''`),
    check(
      'accounting_document_dates_check',
      sql`${table.issueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ${table.saleDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND (${table.dueDate} IS NULL OR ${table.dueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')`,
    ),
    check('accounting_document_counterparty_check', sql`btrim(${table.counterpartyName}) <> ''`),
    check(
      'accounting_document_nip_check',
      sql`${table.counterpartyNip} IS NULL OR btrim(${table.counterpartyNip}) <> ''`,
    ),
    check('accounting_document_currency_check', sql`${table.currency} = 'PLN'`),
    check(
      'accounting_document_amounts_check',
      sql`${table.netGrosze} + ${table.vatGrosze} = ${table.grossGrosze} AND (${table.documentType} = 'correction_invoice' OR (${table.netGrosze} >= 0 AND ${table.vatGrosze} >= 0 AND ${table.grossGrosze} >= 0))`,
    ),
    check('accounting_document_sha256_check', sql`${table.sha256Hash} ~ '^[0-9a-f]{64}$'`),
    check(
      'accounting_document_status_check',
      sql`${table.status} IN ('draft', 'ai_proposed', 'verified_posted', 'archived')`,
    ),
    check('accounting_document_category_check', sql`btrim(${table.categoryCode}) <> ''`),
    check(
      'accounting_document_vehicle_check',
      sql`${table.vehicleUsage} IN ('none', 'mixed_50_75', 'exclusive_100')`,
    ),
    check(
      'accounting_document_ksef_marker_check',
      sql`${table.ksefMarker} IN ('NONE', 'OFF', 'BFK', 'DI')`,
    ),
    check(
      'accounting_document_ksef_ref_check',
      sql`${table.ksefReference} IS NULL OR btrim(${table.ksefReference}) <> ''`,
    ),
    check(
      'accounting_document_verification_check',
      sql`isfinite(${table.createdAt}) AND (${table.verifiedAt} IS NULL OR isfinite(${table.verifiedAt})) AND (${table.status} <> 'verified_posted' OR (${table.verifiedBy} IS NOT NULL AND ${table.verifiedAt} IS NOT NULL))`,
    ),
  ],
).enableRLS();

export const kpirEntry = pgTable(
  'kpir_entry',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    lp: integer('lp').notNull(),
    period: text('period').notNull(),
    eventDate: text('event_date').notNull(),
    documentId: uuid('document_id'),
    documentNumber: text('document_number').notNull(),
    ksefReference: text('ksef_reference'),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyNip: text('counterparty_nip'),
    counterpartyAddress: text('counterparty_address').notNull(),
    description: text('description').notNull(),
    regulationVersion: text('regulation_version', {
      enum: ['pkpir_2019_17col', 'pkpir_2026_ksef'],
    })
      .notNull()
      .default('pkpir_2026_ksef'),
    col7SalesRevenueGrosze: grosze('col7_sales_revenue_grosze').notNull().default(0),
    col8OtherRevenueGrosze: grosze('col8_other_revenue_grosze').notNull().default(0),
    col9TotalRevenueGrosze: grosze('col9_total_revenue_grosze').notNull().default(0),
    col10GoodsMaterialsGrosze: grosze('col10_goods_materials_grosze').notNull().default(0),
    col11IncidentalCostsGrosze: grosze('col11_incidental_costs_grosze').notNull().default(0),
    col12RemunerationGrosze: grosze('col12_remuneration_grosze').notNull().default(0),
    col13OtherExpensesGrosze: grosze('col13_other_expenses_grosze').notNull().default(0),
    col14TotalExpensesGrosze: grosze('col14_total_expenses_grosze').notNull().default(0),
    rdCostGrosze: grosze('rd_cost_grosze').notNull().default(0),
    remarks: text('remarks'),
    isStorno: boolean('is_storno').notNull().default(false),
    stornoOfEntryId: uuid('storno_of_entry_id'),
    ruleCode: text('rule_code').notNull(),
    legalExplanationJson: jsonb('legal_explanation_json')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('kpir_entry_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    unique('kpir_entry_period_lp_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.period,
      table.lp,
    ),
    index('kpir_entry_period_idx').on(table.tenantId, table.legalEntityId, table.period),
    foreignKey({
      name: 'kpir_entry_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'kpir_entry_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.documentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'kpir_entry_storno_fk',
      columns: [table.tenantId, table.legalEntityId, table.stornoOfEntryId],
      foreignColumns: [table.tenantId, table.legalEntityId, table.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('kpir_entry_lp_check', sql`${table.lp} > 0`),
    check(
      'kpir_entry_period_date_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${table.eventDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      'kpir_entry_text_fields_check',
      sql`btrim(${table.documentNumber}) <> '' AND btrim(${table.counterpartyName}) <> '' AND btrim(${table.counterpartyAddress}) <> '' AND btrim(${table.description}) <> '' AND btrim(${table.ruleCode}) <> ''`,
    ),
    check(
      'kpir_entry_regulation_version_check',
      sql`${table.regulationVersion} IN ('pkpir_2019_17col', 'pkpir_2026_ksef')`,
    ),
    check(
      'kpir_entry_sums_check',
      sql`${table.col7SalesRevenueGrosze} + ${table.col8OtherRevenueGrosze} = ${table.col9TotalRevenueGrosze} AND ${table.col12RemunerationGrosze} + ${table.col13OtherExpensesGrosze} = ${table.col14TotalExpensesGrosze}`,
    ),
    check(
      'kpir_entry_storno_consistency_check',
      sql`(${table.isStorno} OR (${table.stornoOfEntryId} IS NULL AND ${table.col7SalesRevenueGrosze} >= 0 AND ${table.col8OtherRevenueGrosze} >= 0 AND ${table.col10GoodsMaterialsGrosze} >= 0 AND ${table.col11IncidentalCostsGrosze} >= 0 AND ${table.col12RemunerationGrosze} >= 0 AND ${table.col13OtherExpensesGrosze} >= 0 AND ${table.rdCostGrosze} >= 0)) AND (${table.stornoOfEntryId} IS NULL OR ${table.stornoOfEntryId} <> ${table.id})`,
    ),
    check('kpir_entry_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const ryczaltEntry = pgTable(
  'ryczalt_entry',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    lp: integer('lp').notNull(),
    period: text('period').notNull(),
    eventDate: text('event_date').notNull(),
    documentId: uuid('document_id'),
    documentNumber: text('document_number').notNull(),
    counterpartyName: text('counterparty_name').notNull().default('Kontrahent'),
    counterpartyNip: text('counterparty_nip'),
    ksefReference: text('ksef_reference'),
    rateBps: integer('rate_bps').notNull(),
    revenueGrosze: grosze('revenue_grosze').notNull(),
    isCorrection: boolean('is_correction').notNull().default(false),
    correctedEntryId: uuid('corrected_entry_id'),
    legalExplanationJson: jsonb('legal_explanation_json')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('ryczalt_entry_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    unique('ryczalt_entry_period_lp_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.period,
      table.lp,
    ),
    index('ryczalt_entry_period_idx').on(table.tenantId, table.legalEntityId, table.period),
    foreignKey({
      name: 'ryczalt_entry_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'ryczalt_entry_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.documentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'ryczalt_entry_corrected_fk',
      columns: [table.tenantId, table.legalEntityId, table.correctedEntryId],
      foreignColumns: [table.tenantId, table.legalEntityId, table.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('ryczalt_entry_lp_check', sql`${table.lp} > 0`),
    check(
      'ryczalt_entry_period_date_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${table.eventDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      'ryczalt_entry_text_check',
      sql`btrim(${table.documentNumber}) <> '' AND btrim(${table.counterpartyName}) <> ''`,
    ),
    check(
      'ryczalt_entry_rate_bps_check',
      sql`${table.rateBps} IN (200, 300, 550, 850, 1000, 1200, 1250, 1400, 1500, 1700)`,
    ),
    check(
      'ryczalt_entry_correction_check',
      sql`(${table.isCorrection} OR (${table.revenueGrosze} >= 0 AND ${table.correctedEntryId} IS NULL)) AND (${table.correctedEntryId} IS NULL OR ${table.correctedEntryId} <> ${table.id})`,
    ),
    check('ryczalt_entry_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const vatRegisterEntry = pgTable(
  'vat_register_entry',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    direction: text('direction', { enum: ['sales', 'purchase'] }).notNull(),
    period: text('period').notNull(),
    taxPointDate: text('tax_point_date').notNull(),
    documentId: uuid('document_id'),
    documentNumber: text('document_number').notNull(),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyNip: text('counterparty_nip'),
    vatRateCode: text('vat_rate_code', { enum: ['23', '8', '5', '0', 'zw', 'np'] }).notNull(),
    netGrosze: grosze('net_grosze').notNull(),
    vatTotalGrosze: grosze('vat_total_grosze').notNull(),
    vatDeductibleGrosze: grosze('vat_deductible_grosze').notNull(),
    vatNonDeductibleGrosze: grosze('vat_non_deductible_grosze').notNull(),
    gtuCodes: jsonb('gtu_codes')
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    procedureMarkers: jsonb('procedure_markers')
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    ksefMarker: text('ksef_marker', { enum: ['NONE', 'OFF', 'BFK', 'DI'] })
      .notNull()
      .default('NONE'),
    ksefReference: text('ksef_reference'),
    legalExplanationJson: jsonb('legal_explanation_json')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('vat_register_entry_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    index('vat_register_entry_period_dir_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.period,
      table.direction,
    ),
    foreignKey({
      name: 'vat_register_entry_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'vat_register_entry_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.documentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('vat_register_entry_direction_check', sql`${table.direction} IN ('sales', 'purchase')`),
    check(
      'vat_register_entry_period_date_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${table.taxPointDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      'vat_register_entry_text_check',
      sql`btrim(${table.documentNumber}) <> '' AND btrim(${table.counterpartyName}) <> ''`,
    ),
    check(
      'vat_register_entry_rate_check',
      sql`${table.vatRateCode} IN ('23', '8', '5', '0', 'zw', 'np')`,
    ),
    check(
      'vat_register_entry_amounts_check',
      sql`${table.vatDeductibleGrosze} + ${table.vatNonDeductibleGrosze} = ${table.vatTotalGrosze}`,
    ),
    check(
      'vat_register_entry_json_arrays_check',
      sql`jsonb_typeof(${table.gtuCodes}) = 'array' AND jsonb_typeof(${table.procedureMarkers}) = 'array'`,
    ),
    check(
      'vat_register_entry_ksef_marker_check',
      sql`${table.ksefMarker} IN ('NONE', 'OFF', 'BFK', 'DI')`,
    ),
    check('vat_register_entry_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const ledgerAccount = pgTable(
  'ledger_account',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    accountCode: text('account_code').notNull(),
    namePl: text('name_pl').notNull(),
    teamNumber: integer('team_number').notNull(),
    accountNature: text('account_nature', {
      enum: [
        'asset',
        'contra_asset',
        'liability',
        'equity',
        'revenue',
        'expense',
        'tax_expense',
        'off_balance',
      ],
    }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('ledger_account_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    unique('ledger_account_code_unique').on(table.tenantId, table.legalEntityId, table.accountCode),
    foreignKey({
      name: 'ledger_account_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('ledger_account_code_check', sql`${table.accountCode} ~ '^[0-8][0-9]{2}(-[0-9]{1,4})?$'`),
    check('ledger_account_name_check', sql`btrim(${table.namePl}) <> ''`),
    check('ledger_account_team_check', sql`${table.teamNumber} BETWEEN 0 AND 8`),
    check(
      'ledger_account_nature_check',
      sql`${table.accountNature} IN ('asset', 'contra_asset', 'liability', 'equity', 'revenue', 'expense', 'tax_expense', 'off_balance')`,
    ),
    check('ledger_account_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const journalEntry = pgTable(
  'journal_entry',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    entryNumber: text('entry_number').notNull(),
    period: text('period').notNull(),
    bookingDate: text('booking_date').notNull(),
    documentDate: text('document_date').notNull(),
    documentId: uuid('document_id'),
    documentNumber: text('document_number').notNull(),
    description: text('description').notNull(),
    totalDebitGrosze: grosze('total_debit_grosze').notNull(),
    totalCreditGrosze: grosze('total_credit_grosze').notNull(),
    isStorno: boolean('is_storno').notNull().default(false),
    stornoOfEntryId: uuid('storno_of_entry_id'),
    legalExplanationJson: jsonb('legal_explanation_json').$type<Readonly<
      Record<string, unknown>
    > | null>(),
    createdBy: uuid('created_by').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('journal_entry_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    unique('journal_entry_number_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.period,
      table.entryNumber,
    ),
    index('journal_entry_period_idx').on(table.tenantId, table.legalEntityId, table.period),
    foreignKey({
      name: 'journal_entry_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'journal_entry_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.documentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'journal_entry_storno_fk',
      columns: [table.tenantId, table.legalEntityId, table.stornoOfEntryId],
      foreignColumns: [table.tenantId, table.legalEntityId, table.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'journal_entry_text_check',
      sql`btrim(${table.entryNumber}) <> '' AND btrim(${table.documentNumber}) <> '' AND btrim(${table.description}) <> ''`,
    ),
    check(
      'journal_entry_dates_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${table.bookingDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ${table.documentDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      'journal_entry_balance_check',
      sql`${table.totalDebitGrosze} > 0 AND ${table.totalCreditGrosze} > 0 AND ${table.totalDebitGrosze} = ${table.totalCreditGrosze}`,
    ),
    check(
      'journal_entry_storno_check',
      sql`(${table.isStorno} OR ${table.stornoOfEntryId} IS NULL) AND (${table.stornoOfEntryId} IS NULL OR ${table.stornoOfEntryId} <> ${table.id})`,
    ),
    check('journal_entry_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const journalLine = pgTable(
  'journal_line',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    journalEntryId: uuid('journal_entry_id').notNull(),
    lineNo: integer('line_no').notNull(),
    ledgerAccountId: uuid('ledger_account_id').notNull(),
    accountCode: text('account_code').notNull(),
    side: text('side', { enum: ['Wn', 'Ma'] }).notNull(),
    debitGrosze: grosze('debit_grosze').notNull().default(0),
    creditGrosze: grosze('credit_grosze').notNull().default(0),
    description: text('description').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('journal_line_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    unique('journal_line_entry_lineno_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.journalEntryId,
      table.lineNo,
    ),
    index('journal_line_entry_idx').on(table.tenantId, table.legalEntityId, table.journalEntryId),
    foreignKey({
      name: 'journal_line_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'journal_line_entry_fk',
      columns: [table.tenantId, table.legalEntityId, table.journalEntryId],
      foreignColumns: [journalEntry.tenantId, journalEntry.legalEntityId, journalEntry.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'journal_line_account_fk',
      columns: [table.tenantId, table.legalEntityId, table.ledgerAccountId],
      foreignColumns: [ledgerAccount.tenantId, ledgerAccount.legalEntityId, ledgerAccount.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('journal_line_lineno_check', sql`${table.lineNo} > 0`),
    check(
      'journal_line_text_check',
      sql`btrim(${table.accountCode}) <> '' AND btrim(${table.description}) <> ''`,
    ),
    check(
      'journal_line_side_amounts_check',
      sql`(${table.side} = 'Wn' AND ${table.debitGrosze} > 0 AND ${table.creditGrosze} = 0) OR (${table.side} = 'Ma' AND ${table.creditGrosze} > 0 AND ${table.debitGrosze} = 0)`,
    ),
    check('journal_line_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();

export const settlementItem = pgTable(
  'settlement_item',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    documentId: uuid('document_id'),
    direction: text('direction', { enum: ['receivable', 'payable'] }).notNull(),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyNip: text('counterparty_nip'),
    counterpartyIban: text('counterparty_iban'),
    documentNumber: text('document_number').notNull(),
    issueDate: text('issue_date').notNull(),
    dueDate: text('due_date').notNull(),
    currency: text('currency', { enum: ['PLN'] })
      .notNull()
      .default('PLN'),
    originalGrossGrosze: grosze('original_gross_grosze').notNull(),
    remainingGrossGrosze: grosze('remaining_gross_grosze').notNull(),
    status: text('status', { enum: ['open', 'partial', 'settled'] }).notNull(),
    settledAt: instant('settled_at'),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('settlement_item_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    index('settlement_item_status_due_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.status,
      table.dueDate,
    ),
    foreignKey({
      name: 'settlement_item_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'settlement_item_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.documentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('settlement_item_direction_check', sql`${table.direction} IN ('receivable', 'payable')`),
    check(
      'settlement_item_text_check',
      sql`btrim(${table.counterpartyName}) <> '' AND btrim(${table.documentNumber}) <> '' AND ${table.currency} = 'PLN'`,
    ),
    check(
      'settlement_item_dates_check',
      sql`${table.issueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ${table.dueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'`,
    ),
    check(
      'settlement_item_amounts_status_check',
      sql`${table.originalGrossGrosze} > 0 AND ${table.remainingGrossGrosze} >= 0 AND ${table.remainingGrossGrosze} <= ${table.originalGrossGrosze} AND ((${table.status} = 'open' AND ${table.remainingGrossGrosze} = ${table.originalGrossGrosze}) OR (${table.status} = 'partial' AND ${table.remainingGrossGrosze} > 0 AND ${table.remainingGrossGrosze} < ${table.originalGrossGrosze}) OR (${table.status} = 'settled' AND ${table.remainingGrossGrosze} = 0))`,
    ),
    check(
      'settlement_item_timestamps_check',
      sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND (${table.settledAt} IS NULL OR isfinite(${table.settledAt}))`,
    ),
  ],
).enableRLS();

export const bankStatementImport = pgTable(
  'bank_statement_import',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    sourceFormat: text('source_format', { enum: ['csv', 'mt940'] }).notNull(),
    fileName: text('file_name').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    iban: text('iban'),
    statementReference: text('statement_reference'),
    periodFrom: text('period_from'),
    periodTo: text('period_to'),
    openingBalanceGrosze: grosze('opening_balance_grosze'),
    closingBalanceGrosze: grosze('closing_balance_grosze'),
    transactionsCount: integer('transactions_count').notNull().default(0),
    importedBy: uuid('imported_by').notNull(),
    importedAt: instant('imported_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('bank_statement_import_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('bank_statement_import_sha256_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.sha256Hash,
    ),
    foreignKey({
      name: 'bank_statement_import_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('bank_statement_import_format_check', sql`${table.sourceFormat} IN ('csv', 'mt940')`),
    check('bank_statement_import_filename_check', sql`btrim(${table.fileName}) <> ''`),
    check('bank_statement_import_sha256_check', sql`${table.sha256Hash} ~ '^[0-9a-f]{64}$'`),
    check('bank_statement_import_count_check', sql`${table.transactionsCount} >= 0`),
    check('bank_statement_import_time_check', sql`isfinite(${table.importedAt})`),
  ],
).enableRLS();

export const bankTransaction = pgTable(
  'bank_transaction',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    statementImportId: uuid('statement_import_id').notNull(),
    externalRef: text('external_ref'),
    bookingDate: text('booking_date').notNull(),
    valueDate: text('value_date'),
    direction: text('direction', { enum: ['credit', 'debit'] }).notNull(),
    amountGrosze: grosze('amount_grosze').notNull(),
    currency: text('currency', { enum: ['PLN'] })
      .notNull()
      .default('PLN'),
    counterpartyName: text('counterparty_name').notNull(),
    counterpartyIban: text('counterparty_iban'),
    counterpartyNip: text('counterparty_nip'),
    title: text('title').notNull(),
    matchStatus: text('match_status', {
      enum: [
        'unmatched',
        'matched_exact',
        'matched_partial',
        'overpaid',
        'ambiguous_manual_review',
      ],
    })
      .notNull()
      .default('unmatched'),
    matchedSettlementId: uuid('matched_settlement_id'),
    matchedDocumentId: uuid('matched_document_id'),
    settledAmountGrosze: grosze('settled_amount_grosze').notNull().default(0),
    matchNotes: text('match_notes'),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('bank_transaction_entity_id_unique').on(table.tenantId, table.legalEntityId, table.id),
    index('bank_transaction_status_date_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.matchStatus,
      table.bookingDate,
    ),
    foreignKey({
      name: 'bank_transaction_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'bank_transaction_import_fk',
      columns: [table.tenantId, table.legalEntityId, table.statementImportId],
      foreignColumns: [
        bankStatementImport.tenantId,
        bankStatementImport.legalEntityId,
        bankStatementImport.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'bank_transaction_settlement_fk',
      columns: [table.tenantId, table.legalEntityId, table.matchedSettlementId],
      foreignColumns: [settlementItem.tenantId, settlementItem.legalEntityId, settlementItem.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'bank_transaction_document_fk',
      columns: [table.tenantId, table.legalEntityId, table.matchedDocumentId],
      foreignColumns: [
        accountingDocument.tenantId,
        accountingDocument.legalEntityId,
        accountingDocument.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('bank_transaction_direction_check', sql`${table.direction} IN ('credit', 'debit')`),
    check(
      'bank_transaction_dates_check',
      sql`${table.bookingDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND (${table.valueDate} IS NULL OR ${table.valueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')`,
    ),
    check(
      'bank_transaction_text_check',
      sql`btrim(${table.counterpartyName}) <> '' AND btrim(${table.title}) <> '' AND ${table.currency} = 'PLN'`,
    ),
    check(
      'bank_transaction_amounts_check',
      sql`${table.amountGrosze} > 0 AND ${table.settledAmountGrosze} >= 0 AND ${table.settledAmountGrosze} <= ${table.amountGrosze}`,
    ),
    check(
      'bank_transaction_match_status_check',
      sql`${table.matchStatus} IN ('unmatched', 'matched_exact', 'matched_partial', 'overpaid', 'ambiguous_manual_review')`,
    ),
    check(
      'bank_transaction_timestamps_check',
      sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt})`,
    ),
  ],
).enableRLS();

export const taxObligationItem = pgTable(
  'tax_obligation_item',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    period: text('period').notNull(),
    obligationCode: text('obligation_code').notNull(),
    category: text('category', {
      enum: ['vat', 'pit', 'ryczalt', 'cit', 'zus', 'jpk_income_tax', 'ksef', 'edoreczenia'],
    }).notNull(),
    titlePl: text('title_pl').notNull(),
    statutoryDueDate: text('statutory_due_date').notNull(),
    adjustedDueDate: text('adjusted_due_date').notNull(),
    shiftReason: text('shift_reason'),
    estimatedAmountGrosze: grosze('estimated_amount_grosze'),
    status: text('status', { enum: ['upcoming', 'paid', 'overdue'] })
      .notNull()
      .default('upcoming'),
    legalBasisJson: jsonb('legal_basis_json').$type<Readonly<Record<string, unknown>>>().notNull(),
    paidAt: instant('paid_at'),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('tax_obligation_item_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('tax_obligation_item_period_code_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.period,
      table.obligationCode,
    ),
    index('tax_obligation_item_due_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.adjustedDueDate,
    ),
    foreignKey({
      name: 'tax_obligation_item_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'tax_obligation_item_text_check',
      sql`btrim(${table.obligationCode}) <> '' AND btrim(${table.titlePl}) <> ''`,
    ),
    check(
      'tax_obligation_item_category_check',
      sql`${table.category} IN ('vat', 'pit', 'ryczalt', 'cit', 'zus', 'jpk_income_tax', 'ksef', 'edoreczenia')`,
    ),
    check(
      'tax_obligation_item_dates_check',
      sql`${table.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND ${table.statutoryDueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ${table.adjustedDueDate} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ${table.adjustedDueDate} >= ${table.statutoryDueDate}`,
    ),
    check(
      'tax_obligation_item_amount_check',
      sql`${table.estimatedAmountGrosze} IS NULL OR ${table.estimatedAmountGrosze} >= 0`,
    ),
    check(
      'tax_obligation_item_status_check',
      sql`${table.status} IN ('upcoming', 'paid', 'overdue')`,
    ),
    check(
      'tax_obligation_item_timestamps_check',
      sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND (${table.paidAt} IS NULL OR isfinite(${table.paidAt}))`,
    ),
  ],
).enableRLS();

export const mcpPreparedProposal = pgTable(
  'mcp_prepared_proposal',
  {
    id: uuid('id').primaryKey(),
    proposalId: uuid('proposal_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    status: text('status', {
      enum: ['pending_human_approval', 'confirmed', 'rejected', 'expired'],
    })
      .notNull()
      .default('pending_human_approval'),
    invoiceJson: jsonb('invoice_json').$type<Readonly<Record<string, unknown>>>().notNull(),
    proposedPostingJson: jsonb('proposed_posting_json')
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    confirmationChallengeHash: text('confirmation_challenge_hash').notNull(),
    preparedBy: uuid('prepared_by').notNull(),
    expiresAt: instant('expires_at').notNull(),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: instant('confirmed_at'),
    ledgerEntryId: uuid('ledger_entry_id'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('mcp_prepared_proposal_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('mcp_prepared_proposal_entity_proposal_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.proposalId,
    ),
    unique('mcp_prepared_proposal_idempotency_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.idempotencyKey,
    ),
    index('mcp_prepared_proposal_status_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.status,
      table.expiresAt,
    ),
    foreignKey({
      name: 'mcp_prepared_proposal_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check('mcp_prepared_proposal_id_match_check', sql`${table.proposalId} = ${table.id}`),
    check(
      'mcp_prepared_proposal_hashes_check',
      sql`${table.payloadHash} ~ '^[0-9a-f]{64}$' AND ${table.confirmationChallengeHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'mcp_prepared_proposal_status_check',
      sql`${table.status} IN ('pending_human_approval', 'confirmed', 'rejected', 'expired')`,
    ),
    check(
      'mcp_prepared_proposal_lifecycle_check',
      sql`isfinite(${table.createdAt}) AND isfinite(${table.expiresAt}) AND ${table.expiresAt} > ${table.createdAt} AND ((${table.status} <> 'confirmed' AND ${table.confirmedBy} IS NULL AND ${table.confirmedAt} IS NULL AND ${table.ledgerEntryId} IS NULL) OR (${table.status} = 'confirmed' AND ${table.confirmedBy} IS NOT NULL AND ${table.confirmedAt} IS NOT NULL AND isfinite(${table.confirmedAt}) AND ${table.ledgerEntryId} IS NOT NULL))`,
    ),
  ],
).enableRLS();

export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    userId: uuid('user_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    channel: text('channel', { enum: ['email'] })
      .notNull()
      .default('email'),
    frequency: text('frequency', {
      enum: ['standard', 'urgent_only', 'overdue_only'],
    })
      .notNull()
      .default('standard'),
    optOut: boolean('opt_out').notNull().default(false),
    advanceDays: jsonb('advance_days')
      .$type<readonly number[]>()
      .notNull()
      .default(sql`'[7, 2, -1]'::jsonb`),
    disabledStages: jsonb('disabled_stages')
      .$type<readonly string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('notification_preference_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('notification_preference_user_entity_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.userId,
    ),
    foreignKey({
      name: 'notification_preference_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'notification_preference_email_check',
      sql`btrim(${table.recipientEmail}) <> '' AND position('@' in ${table.recipientEmail}) > 1`,
    ),
    check('notification_preference_channel_check', sql`${table.channel} = 'email'`),
    check(
      'notification_preference_frequency_check',
      sql`${table.frequency} IN ('standard', 'urgent_only', 'overdue_only')`,
    ),
    check(
      'notification_preference_arrays_check',
      sql`jsonb_typeof(${table.advanceDays}) = 'array' AND jsonb_typeof(${table.disabledStages}) = 'array'`,
    ),
    check('notification_preference_updated_at_check', sql`isfinite(${table.updatedAt})`),
  ],
).enableRLS();

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    userId: uuid('user_id').notNull(),
    obligationId: uuid('obligation_id'),
    obligationCode: text('obligation_code').notNull(),
    stage: text('stage', { enum: ['advance_7d', 'urgent_2d', 'overdue_1d'] }).notNull(),
    dedupKey: text('dedup_key').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    subject: text('subject').notNull(),
    payloadJson: jsonb('payload_json').$type<Readonly<Record<string, unknown>>>().notNull(),
    status: text('status', {
      enum: [
        'pending',
        'sent',
        'retry_scheduled',
        'dead_letter',
        'blocked_recipient_policy',
        'suppressed_by_preferences',
      ],
    })
      .notNull()
      .default('pending'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    nextAttemptAt: instant('next_attempt_at'),
    lastErrorRedacted: text('last_error_redacted'),
    updatedAt: instant('updated_at')
      .notNull()
      .default(sql`clock_timestamp()`),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('notification_outbox_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    unique('notification_outbox_dedup_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.dedupKey,
    ),
    index('notification_outbox_dispatch_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.status,
      table.nextAttemptAt,
    ),
    foreignKey({
      name: 'notification_outbox_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'notification_outbox_obligation_fk',
      columns: [table.tenantId, table.legalEntityId, table.obligationId],
      foreignColumns: [
        taxObligationItem.tenantId,
        taxObligationItem.legalEntityId,
        taxObligationItem.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'notification_outbox_text_check',
      sql`btrim(${table.obligationCode}) <> '' AND btrim(${table.dedupKey}) <> '' AND btrim(${table.recipientEmail}) <> '' AND btrim(${table.subject}) <> ''`,
    ),
    check(
      'notification_outbox_stage_check',
      sql`${table.stage} IN ('advance_7d', 'urgent_2d', 'overdue_1d')`,
    ),
    check(
      'notification_outbox_status_check',
      sql`${table.status} IN ('pending', 'sent', 'retry_scheduled', 'dead_letter', 'blocked_recipient_policy', 'suppressed_by_preferences')`,
    ),
    check(
      'notification_outbox_attempts_check',
      sql`${table.attemptCount} >= 0 AND ${table.maxAttempts} > 0`,
    ),
    check(
      'notification_outbox_timestamps_check',
      sql`isfinite(${table.createdAt}) AND isfinite(${table.updatedAt}) AND (${table.nextAttemptAt} IS NULL OR isfinite(${table.nextAttemptAt}))`,
    ),
  ],
).enableRLS();

export const sandboxMailboxMessage = pgTable(
  'sandbox_mailbox_message',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    outboxId: uuid('outbox_id'),
    recipientEmail: text('recipient_email').notNull(),
    subject: text('subject').notNull(),
    rawRfc5322Mime: text('raw_rfc5322_mime').notNull(),
    obligationCode: text('obligation_code').notNull(),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('sandbox_mailbox_message_entity_id_unique').on(
      table.tenantId,
      table.legalEntityId,
      table.id,
    ),
    index('sandbox_mailbox_message_created_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.createdAt,
    ),
    foreignKey({
      name: 'sandbox_mailbox_message_entity_fk',
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntity.tenantId, legalEntity.id],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    foreignKey({
      name: 'sandbox_mailbox_message_outbox_fk',
      columns: [table.tenantId, table.legalEntityId, table.outboxId],
      foreignColumns: [
        notificationOutbox.tenantId,
        notificationOutbox.legalEntityId,
        notificationOutbox.id,
      ],
    })
      .onDelete('restrict')
      .onUpdate('restrict'),
    check(
      'sandbox_mailbox_message_text_check',
      sql`btrim(${table.recipientEmail}) <> '' AND btrim(${table.subject}) <> '' AND btrim(${table.rawRfc5322Mime}) <> '' AND btrim(${table.obligationCode}) <> ''`,
    ),
    check('sandbox_mailbox_message_created_at_check', sql`isfinite(${table.createdAt})`),
  ],
).enableRLS();
