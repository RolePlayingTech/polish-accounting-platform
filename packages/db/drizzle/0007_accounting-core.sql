-- Accounting Core C2-1 (0007): 16 tabel księgowych JDG/UoR/VAT/rozrachunki/MCP/powiadomienia.
-- Każda tabela wymusza FORCE ROW LEVEL SECURITY, politykę migratora, izolację (tenant_id, legal_entity_id)
-- oraz atomowy ślad audytu security_decision_event + company_operation_probe przy zapisie runtime.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = current_schema()::regnamespace
      AND relname IN ('tenant', 'legal_entity', 'company_operation_probe', 'security_decision_event')
      AND relowner <> current_user::regrole
  ) THEN
    RAISE EXCEPTION 'Migracja 0007 wymaga dotychczasowego właściciela tabel schematu';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE "accounting_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"document_number" text NOT NULL,
	"issue_date" text NOT NULL,
	"sale_date" text NOT NULL,
	"due_date" text,
	"counterparty_name" text NOT NULL,
	"counterparty_nip" text,
	"counterparty_address" text,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"net_grosze" bigint NOT NULL,
	"vat_grosze" bigint NOT NULL,
	"gross_grosze" bigint NOT NULL,
	"sha256_hash" text NOT NULL,
	"status" text NOT NULL,
	"category_code" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"vehicle_usage" text DEFAULT 'none' NOT NULL,
	"ksef_reference" text,
	"ksef_marker" text DEFAULT 'NONE' NOT NULL,
	"ai_proposal_json" jsonb,
	"verified_by" uuid,
	"verified_at" timestamp (3) with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "accounting_document_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "accounting_document_sha256_unique" UNIQUE("tenant_id","legal_entity_id","sha256_hash"),
	CONSTRAINT "accounting_document_type_check" CHECK ("accounting_document"."document_type" IN ('sales_invoice', 'purchase_invoice', 'correction_invoice', 'receipt', 'internal_note')),
	CONSTRAINT "accounting_document_number_check" CHECK (btrim("accounting_document"."document_number") <> ''),
	CONSTRAINT "accounting_document_dates_check" CHECK ("accounting_document"."issue_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "accounting_document"."sale_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ("accounting_document"."due_date" IS NULL OR "accounting_document"."due_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')),
	CONSTRAINT "accounting_document_counterparty_check" CHECK (btrim("accounting_document"."counterparty_name") <> ''),
	CONSTRAINT "accounting_document_nip_check" CHECK ("accounting_document"."counterparty_nip" IS NULL OR btrim("accounting_document"."counterparty_nip") <> ''),
	CONSTRAINT "accounting_document_currency_check" CHECK ("accounting_document"."currency" = 'PLN'),
	CONSTRAINT "accounting_document_amounts_check" CHECK ("accounting_document"."net_grosze" + "accounting_document"."vat_grosze" = "accounting_document"."gross_grosze" AND ("accounting_document"."document_type" = 'correction_invoice' OR ("accounting_document"."net_grosze" >= 0 AND "accounting_document"."vat_grosze" >= 0 AND "accounting_document"."gross_grosze" >= 0))),
	CONSTRAINT "accounting_document_sha256_check" CHECK ("accounting_document"."sha256_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "accounting_document_status_check" CHECK ("accounting_document"."status" IN ('draft', 'ai_proposed', 'verified_posted', 'archived')),
	CONSTRAINT "accounting_document_category_check" CHECK (btrim("accounting_document"."category_code") <> ''),
	CONSTRAINT "accounting_document_vehicle_check" CHECK ("accounting_document"."vehicle_usage" IN ('none', 'mixed_50_75', 'exclusive_100')),
	CONSTRAINT "accounting_document_ksef_marker_check" CHECK ("accounting_document"."ksef_marker" IN ('NONE', 'OFF', 'BFK', 'DI')),
	CONSTRAINT "accounting_document_ksef_ref_check" CHECK ("accounting_document"."ksef_reference" IS NULL OR btrim("accounting_document"."ksef_reference") <> ''),
	CONSTRAINT "accounting_document_verification_check" CHECK (isfinite("accounting_document"."created_at") AND ("accounting_document"."verified_at" IS NULL OR isfinite("accounting_document"."verified_at")) AND ("accounting_document"."status" <> 'verified_posted' OR ("accounting_document"."verified_by" IS NOT NULL AND "accounting_document"."verified_at" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "accounting_document" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_statement_import" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"source_format" text NOT NULL,
	"file_name" text NOT NULL,
	"sha256_hash" text NOT NULL,
	"iban" text,
	"statement_reference" text,
	"period_from" text,
	"period_to" text,
	"opening_balance_grosze" bigint,
	"closing_balance_grosze" bigint,
	"transactions_count" integer DEFAULT 0 NOT NULL,
	"imported_by" uuid NOT NULL,
	"imported_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bank_statement_import_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "bank_statement_import_sha256_unique" UNIQUE("tenant_id","legal_entity_id","sha256_hash"),
	CONSTRAINT "bank_statement_import_format_check" CHECK ("bank_statement_import"."source_format" IN ('csv', 'mt940')),
	CONSTRAINT "bank_statement_import_filename_check" CHECK (btrim("bank_statement_import"."file_name") <> ''),
	CONSTRAINT "bank_statement_import_sha256_check" CHECK ("bank_statement_import"."sha256_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "bank_statement_import_count_check" CHECK ("bank_statement_import"."transactions_count" >= 0),
	CONSTRAINT "bank_statement_import_time_check" CHECK (isfinite("bank_statement_import"."imported_at"))
);
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "bank_transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"statement_import_id" uuid NOT NULL,
	"external_ref" text,
	"booking_date" text NOT NULL,
	"value_date" text,
	"direction" text NOT NULL,
	"amount_grosze" bigint NOT NULL,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"counterparty_name" text NOT NULL,
	"counterparty_iban" text,
	"counterparty_nip" text,
	"title" text NOT NULL,
	"match_status" text DEFAULT 'unmatched' NOT NULL,
	"matched_settlement_id" uuid,
	"matched_document_id" uuid,
	"settled_amount_grosze" bigint DEFAULT 0 NOT NULL,
	"match_notes" text,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "bank_transaction_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "bank_transaction_direction_check" CHECK ("bank_transaction"."direction" IN ('credit', 'debit')),
	CONSTRAINT "bank_transaction_dates_check" CHECK ("bank_transaction"."booking_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND ("bank_transaction"."value_date" IS NULL OR "bank_transaction"."value_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')),
	CONSTRAINT "bank_transaction_text_check" CHECK (btrim("bank_transaction"."counterparty_name") <> '' AND btrim("bank_transaction"."title") <> '' AND "bank_transaction"."currency" = 'PLN'),
	CONSTRAINT "bank_transaction_amounts_check" CHECK ("bank_transaction"."amount_grosze" > 0 AND "bank_transaction"."settled_amount_grosze" >= 0 AND "bank_transaction"."settled_amount_grosze" <= "bank_transaction"."amount_grosze"),
	CONSTRAINT "bank_transaction_match_status_check" CHECK ("bank_transaction"."match_status" IN ('unmatched', 'matched_exact', 'matched_partial', 'overpaid', 'ambiguous_manual_review')),
	CONSTRAINT "bank_transaction_timestamps_check" CHECK (isfinite("bank_transaction"."created_at") AND isfinite("bank_transaction"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "bank_transaction" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "company_tax_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"nip" text NOT NULL,
	"regon" text,
	"krs" text,
	"legal_form" text NOT NULL,
	"tax_regime" text NOT NULL,
	"vat_status" text NOT NULL,
	"zus_stage" text NOT NULL,
	"ksef_mode" text NOT NULL,
	"default_iban" text,
	"address_summary" text NOT NULL,
	"small_taxpayer" boolean DEFAULT true NOT NULL,
	"voluntary_sickness_insurance" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "company_tax_settings_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "company_tax_settings_entity_unique" UNIQUE("tenant_id","legal_entity_id"),
	CONSTRAINT "company_tax_settings_nip_check" CHECK ("company_tax_settings"."nip" ~ '^[0-9]{10}$'),
	CONSTRAINT "company_tax_settings_regon_check" CHECK ("company_tax_settings"."regon" IS NULL OR "company_tax_settings"."regon" ~ '^([0-9]{9}|[0-9]{14})$'),
	CONSTRAINT "company_tax_settings_krs_check" CHECK ("company_tax_settings"."krs" IS NULL OR "company_tax_settings"."krs" ~ '^[0-9]{10}$'),
	CONSTRAINT "company_tax_settings_legal_form_check" CHECK ("company_tax_settings"."legal_form" IN ('jdg', 'sp_z_o_o', 'spolka_cywilna', 'spolka_jawna')),
	CONSTRAINT "company_tax_settings_tax_regime_check" CHECK ("company_tax_settings"."tax_regime" IN ('kpir_skala', 'kpir_liniowy', 'ryczalt', 'cit_klasyczny')),
	CONSTRAINT "company_tax_settings_vat_status_check" CHECK ("company_tax_settings"."vat_status" IN ('czynny', 'zwolniony')),
	CONSTRAINT "company_tax_settings_zus_stage_check" CHECK ("company_tax_settings"."zus_stage" IN ('ulga_na_start', 'preferencyjny', 'maly_zus_plus', 'duzy_zus', 'brak_sp_zoo')),
	CONSTRAINT "company_tax_settings_ksef_mode_check" CHECK ("company_tax_settings"."ksef_mode" IN ('mandatory_2026_feb', 'mandatory_2026_apr', 'micro_exempt_10k_2026', 'voluntary')),
	CONSTRAINT "company_tax_settings_iban_check" CHECK ("company_tax_settings"."default_iban" IS NULL OR btrim("company_tax_settings"."default_iban") <> ''),
	CONSTRAINT "company_tax_settings_address_check" CHECK (btrim("company_tax_settings"."address_summary") <> ''),
	CONSTRAINT "company_tax_settings_updated_at_check" CHECK (isfinite("company_tax_settings"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "company_tax_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "journal_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"entry_number" text NOT NULL,
	"period" text NOT NULL,
	"booking_date" text NOT NULL,
	"document_date" text NOT NULL,
	"document_id" uuid,
	"document_number" text NOT NULL,
	"description" text NOT NULL,
	"total_debit_grosze" bigint NOT NULL,
	"total_credit_grosze" bigint NOT NULL,
	"is_storno" boolean DEFAULT false NOT NULL,
	"storno_of_entry_id" uuid,
	"legal_explanation_json" jsonb,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "journal_entry_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "journal_entry_number_unique" UNIQUE("tenant_id","legal_entity_id","period","entry_number"),
	CONSTRAINT "journal_entry_text_check" CHECK (btrim("journal_entry"."entry_number") <> '' AND btrim("journal_entry"."document_number") <> '' AND btrim("journal_entry"."description") <> ''),
	CONSTRAINT "journal_entry_dates_check" CHECK ("journal_entry"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "journal_entry"."booking_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "journal_entry"."document_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "journal_entry_balance_check" CHECK ("journal_entry"."total_debit_grosze" > 0 AND "journal_entry"."total_credit_grosze" > 0 AND "journal_entry"."total_debit_grosze" = "journal_entry"."total_credit_grosze"),
	CONSTRAINT "journal_entry_storno_check" CHECK (("journal_entry"."is_storno" OR "journal_entry"."storno_of_entry_id" IS NULL) AND ("journal_entry"."storno_of_entry_id" IS NULL OR "journal_entry"."storno_of_entry_id" <> "journal_entry"."id")),
	CONSTRAINT "journal_entry_created_at_check" CHECK (isfinite("journal_entry"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "journal_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "journal_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"side" text NOT NULL,
	"debit_grosze" bigint DEFAULT 0 NOT NULL,
	"credit_grosze" bigint DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "journal_line_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "journal_line_entry_lineno_unique" UNIQUE("tenant_id","legal_entity_id","journal_entry_id","line_no"),
	CONSTRAINT "journal_line_lineno_check" CHECK ("journal_line"."line_no" > 0),
	CONSTRAINT "journal_line_text_check" CHECK (btrim("journal_line"."account_code") <> '' AND btrim("journal_line"."description") <> ''),
	CONSTRAINT "journal_line_side_amounts_check" CHECK (("journal_line"."side" = 'Wn' AND "journal_line"."debit_grosze" > 0 AND "journal_line"."credit_grosze" = 0) OR ("journal_line"."side" = 'Ma' AND "journal_line"."credit_grosze" > 0 AND "journal_line"."debit_grosze" = 0)),
	CONSTRAINT "journal_line_created_at_check" CHECK (isfinite("journal_line"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "journal_line" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "kpir_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"lp" integer NOT NULL,
	"period" text NOT NULL,
	"event_date" text NOT NULL,
	"document_id" uuid,
	"document_number" text NOT NULL,
	"ksef_reference" text,
	"counterparty_name" text NOT NULL,
	"counterparty_nip" text,
	"counterparty_address" text NOT NULL,
	"description" text NOT NULL,
	"regulation_version" text DEFAULT 'pkpir_2026_ksef' NOT NULL,
	"col7_sales_revenue_grosze" bigint DEFAULT 0 NOT NULL,
	"col8_other_revenue_grosze" bigint DEFAULT 0 NOT NULL,
	"col9_total_revenue_grosze" bigint DEFAULT 0 NOT NULL,
	"col10_goods_materials_grosze" bigint DEFAULT 0 NOT NULL,
	"col11_incidental_costs_grosze" bigint DEFAULT 0 NOT NULL,
	"col12_remuneration_grosze" bigint DEFAULT 0 NOT NULL,
	"col13_other_expenses_grosze" bigint DEFAULT 0 NOT NULL,
	"col14_total_expenses_grosze" bigint DEFAULT 0 NOT NULL,
	"rd_cost_grosze" bigint DEFAULT 0 NOT NULL,
	"remarks" text,
	"is_storno" boolean DEFAULT false NOT NULL,
	"storno_of_entry_id" uuid,
	"rule_code" text NOT NULL,
	"legal_explanation_json" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "kpir_entry_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "kpir_entry_period_lp_unique" UNIQUE("tenant_id","legal_entity_id","period","lp"),
	CONSTRAINT "kpir_entry_lp_check" CHECK ("kpir_entry"."lp" > 0),
	CONSTRAINT "kpir_entry_period_date_check" CHECK ("kpir_entry"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "kpir_entry"."event_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "kpir_entry_text_fields_check" CHECK (btrim("kpir_entry"."document_number") <> '' AND btrim("kpir_entry"."counterparty_name") <> '' AND btrim("kpir_entry"."counterparty_address") <> '' AND btrim("kpir_entry"."description") <> '' AND btrim("kpir_entry"."rule_code") <> ''),
	CONSTRAINT "kpir_entry_regulation_version_check" CHECK ("kpir_entry"."regulation_version" IN ('pkpir_2019_17col', 'pkpir_2026_ksef')),
	CONSTRAINT "kpir_entry_sums_check" CHECK ("kpir_entry"."col7_sales_revenue_grosze" + "kpir_entry"."col8_other_revenue_grosze" = "kpir_entry"."col9_total_revenue_grosze" AND "kpir_entry"."col12_remuneration_grosze" + "kpir_entry"."col13_other_expenses_grosze" = "kpir_entry"."col14_total_expenses_grosze"),
	CONSTRAINT "kpir_entry_storno_consistency_check" CHECK (("kpir_entry"."is_storno" OR ("kpir_entry"."storno_of_entry_id" IS NULL AND "kpir_entry"."col7_sales_revenue_grosze" >= 0 AND "kpir_entry"."col8_other_revenue_grosze" >= 0 AND "kpir_entry"."col10_goods_materials_grosze" >= 0 AND "kpir_entry"."col11_incidental_costs_grosze" >= 0 AND "kpir_entry"."col12_remuneration_grosze" >= 0 AND "kpir_entry"."col13_other_expenses_grosze" >= 0 AND "kpir_entry"."rd_cost_grosze" >= 0)) AND ("kpir_entry"."storno_of_entry_id" IS NULL OR "kpir_entry"."storno_of_entry_id" <> "kpir_entry"."id")),
	CONSTRAINT "kpir_entry_created_at_check" CHECK (isfinite("kpir_entry"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "kpir_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "ledger_account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"name_pl" text NOT NULL,
	"team_number" integer NOT NULL,
	"account_nature" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ledger_account_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "ledger_account_code_unique" UNIQUE("tenant_id","legal_entity_id","account_code"),
	CONSTRAINT "ledger_account_code_check" CHECK ("ledger_account"."account_code" ~ '^[0-8][0-9]{2}(-[0-9]{1,4})?$'),
	CONSTRAINT "ledger_account_name_check" CHECK (btrim("ledger_account"."name_pl") <> ''),
	CONSTRAINT "ledger_account_team_check" CHECK ("ledger_account"."team_number" BETWEEN 0 AND 8),
	CONSTRAINT "ledger_account_nature_check" CHECK ("ledger_account"."account_nature" IN ('asset', 'contra_asset', 'liability', 'equity', 'revenue', 'expense', 'tax_expense', 'off_balance')),
	CONSTRAINT "ledger_account_created_at_check" CHECK (isfinite("ledger_account"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "ledger_account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "mcp_prepared_proposal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposal_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'pending_human_approval' NOT NULL,
	"invoice_json" jsonb NOT NULL,
	"proposed_posting_json" jsonb NOT NULL,
	"confirmation_challenge_hash" text NOT NULL,
	"prepared_by" uuid NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp (3) with time zone,
	"ledger_entry_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "mcp_prepared_proposal_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "mcp_prepared_proposal_entity_proposal_unique" UNIQUE("tenant_id","legal_entity_id","proposal_id"),
	CONSTRAINT "mcp_prepared_proposal_idempotency_unique" UNIQUE("tenant_id","legal_entity_id","idempotency_key"),
	CONSTRAINT "mcp_prepared_proposal_id_match_check" CHECK ("mcp_prepared_proposal"."proposal_id" = "mcp_prepared_proposal"."id"),
	CONSTRAINT "mcp_prepared_proposal_hashes_check" CHECK ("mcp_prepared_proposal"."payload_hash" ~ '^[0-9a-f]{64}$' AND "mcp_prepared_proposal"."confirmation_challenge_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "mcp_prepared_proposal_status_check" CHECK ("mcp_prepared_proposal"."status" IN ('pending_human_approval', 'confirmed', 'expired')),
	CONSTRAINT "mcp_prepared_proposal_lifecycle_check" CHECK (isfinite("mcp_prepared_proposal"."created_at") AND isfinite("mcp_prepared_proposal"."expires_at") AND "mcp_prepared_proposal"."expires_at" > "mcp_prepared_proposal"."created_at" AND (("mcp_prepared_proposal"."status" <> 'confirmed' AND "mcp_prepared_proposal"."confirmed_by" IS NULL AND "mcp_prepared_proposal"."confirmed_at" IS NULL AND "mcp_prepared_proposal"."ledger_entry_id" IS NULL) OR ("mcp_prepared_proposal"."status" = 'confirmed' AND "mcp_prepared_proposal"."confirmed_by" IS NOT NULL AND "mcp_prepared_proposal"."confirmed_at" IS NOT NULL AND isfinite("mcp_prepared_proposal"."confirmed_at") AND "mcp_prepared_proposal"."ledger_entry_id" IS NOT NULL)))
);
--> statement-breakpoint
ALTER TABLE "mcp_prepared_proposal" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"obligation_id" uuid,
	"obligation_code" text NOT NULL,
	"stage" text NOT NULL,
	"dedup_key" text NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp (3) with time zone,
	"last_error_redacted" text,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "notification_outbox_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "notification_outbox_dedup_unique" UNIQUE("tenant_id","legal_entity_id","dedup_key"),
	CONSTRAINT "notification_outbox_text_check" CHECK (btrim("notification_outbox"."obligation_code") <> '' AND btrim("notification_outbox"."dedup_key") <> '' AND btrim("notification_outbox"."recipient_email") <> '' AND btrim("notification_outbox"."subject") <> ''),
	CONSTRAINT "notification_outbox_stage_check" CHECK ("notification_outbox"."stage" IN ('advance_7d', 'urgent_2d', 'overdue_1d')),
	CONSTRAINT "notification_outbox_status_check" CHECK ("notification_outbox"."status" IN ('pending', 'sent', 'retry_scheduled', 'dead_letter', 'blocked_recipient_policy', 'suppressed_by_preferences')),
	CONSTRAINT "notification_outbox_attempts_check" CHECK ("notification_outbox"."attempt_count" >= 0 AND "notification_outbox"."max_attempts" > 0),
	CONSTRAINT "notification_outbox_timestamps_check" CHECK (isfinite("notification_outbox"."created_at") AND isfinite("notification_outbox"."updated_at") AND ("notification_outbox"."next_attempt_at" IS NULL OR isfinite("notification_outbox"."next_attempt_at")))
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"frequency" text DEFAULT 'standard' NOT NULL,
	"opt_out" boolean DEFAULT false NOT NULL,
	"advance_days" jsonb DEFAULT '[7, 2, -1]'::jsonb NOT NULL,
	"disabled_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "notification_preference_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "notification_preference_user_entity_unique" UNIQUE("tenant_id","legal_entity_id","user_id"),
	CONSTRAINT "notification_preference_email_check" CHECK (btrim("notification_preference"."recipient_email") <> '' AND position('@' in "notification_preference"."recipient_email") > 1),
	CONSTRAINT "notification_preference_channel_check" CHECK ("notification_preference"."channel" = 'email'),
	CONSTRAINT "notification_preference_frequency_check" CHECK ("notification_preference"."frequency" IN ('standard', 'urgent_only', 'overdue_only')),
	CONSTRAINT "notification_preference_arrays_check" CHECK (jsonb_typeof("notification_preference"."advance_days") = 'array' AND jsonb_typeof("notification_preference"."disabled_stages") = 'array'),
	CONSTRAINT "notification_preference_updated_at_check" CHECK (isfinite("notification_preference"."updated_at"))
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "ryczalt_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"lp" integer NOT NULL,
	"period" text NOT NULL,
	"event_date" text NOT NULL,
	"document_id" uuid,
	"document_number" text NOT NULL,
	"counterparty_name" text DEFAULT 'Kontrahent' NOT NULL,
	"counterparty_nip" text,
	"ksef_reference" text,
	"rate_bps" integer NOT NULL,
	"revenue_grosze" bigint NOT NULL,
	"is_correction" boolean DEFAULT false NOT NULL,
	"corrected_entry_id" uuid,
	"legal_explanation_json" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "ryczalt_entry_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "ryczalt_entry_period_lp_unique" UNIQUE("tenant_id","legal_entity_id","period","lp"),
	CONSTRAINT "ryczalt_entry_lp_check" CHECK ("ryczalt_entry"."lp" > 0),
	CONSTRAINT "ryczalt_entry_period_date_check" CHECK ("ryczalt_entry"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "ryczalt_entry"."event_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "ryczalt_entry_text_check" CHECK (btrim("ryczalt_entry"."document_number") <> '' AND btrim("ryczalt_entry"."counterparty_name") <> ''),
	CONSTRAINT "ryczalt_entry_rate_bps_check" CHECK ("ryczalt_entry"."rate_bps" IN (200, 300, 550, 850, 1000, 1200, 1250, 1400, 1500, 1700)),
	CONSTRAINT "ryczalt_entry_correction_check" CHECK (("ryczalt_entry"."is_correction" OR ("ryczalt_entry"."revenue_grosze" >= 0 AND "ryczalt_entry"."corrected_entry_id" IS NULL)) AND ("ryczalt_entry"."corrected_entry_id" IS NULL OR "ryczalt_entry"."corrected_entry_id" <> "ryczalt_entry"."id")),
	CONSTRAINT "ryczalt_entry_created_at_check" CHECK (isfinite("ryczalt_entry"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "ryczalt_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "sandbox_mailbox_message" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"outbox_id" uuid,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"raw_rfc5322_mime" text NOT NULL,
	"obligation_code" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sandbox_mailbox_message_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "sandbox_mailbox_message_text_check" CHECK (btrim("sandbox_mailbox_message"."recipient_email") <> '' AND btrim("sandbox_mailbox_message"."subject") <> '' AND btrim("sandbox_mailbox_message"."raw_rfc5322_mime") <> '' AND btrim("sandbox_mailbox_message"."obligation_code") <> ''),
	CONSTRAINT "sandbox_mailbox_message_created_at_check" CHECK (isfinite("sandbox_mailbox_message"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "sandbox_mailbox_message" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "settlement_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"document_id" uuid,
	"direction" text NOT NULL,
	"counterparty_name" text NOT NULL,
	"counterparty_nip" text,
	"counterparty_iban" text,
	"document_number" text NOT NULL,
	"issue_date" text NOT NULL,
	"due_date" text NOT NULL,
	"currency" text DEFAULT 'PLN' NOT NULL,
	"original_gross_grosze" bigint NOT NULL,
	"remaining_gross_grosze" bigint NOT NULL,
	"status" text NOT NULL,
	"settled_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "settlement_item_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "settlement_item_direction_check" CHECK ("settlement_item"."direction" IN ('receivable', 'payable')),
	CONSTRAINT "settlement_item_text_check" CHECK (btrim("settlement_item"."counterparty_name") <> '' AND btrim("settlement_item"."document_number") <> '' AND "settlement_item"."currency" = 'PLN'),
	CONSTRAINT "settlement_item_dates_check" CHECK ("settlement_item"."issue_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "settlement_item"."due_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "settlement_item_amounts_status_check" CHECK ("settlement_item"."original_gross_grosze" > 0 AND "settlement_item"."remaining_gross_grosze" >= 0 AND "settlement_item"."remaining_gross_grosze" <= "settlement_item"."original_gross_grosze" AND (("settlement_item"."status" = 'open' AND "settlement_item"."remaining_gross_grosze" = "settlement_item"."original_gross_grosze") OR ("settlement_item"."status" = 'partial' AND "settlement_item"."remaining_gross_grosze" > 0 AND "settlement_item"."remaining_gross_grosze" < "settlement_item"."original_gross_grosze") OR ("settlement_item"."status" = 'settled' AND "settlement_item"."remaining_gross_grosze" = 0))),
	CONSTRAINT "settlement_item_timestamps_check" CHECK (isfinite("settlement_item"."created_at") AND isfinite("settlement_item"."updated_at") AND ("settlement_item"."settled_at" IS NULL OR isfinite("settlement_item"."settled_at")))
);
--> statement-breakpoint
ALTER TABLE "settlement_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "tax_obligation_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"period" text NOT NULL,
	"obligation_code" text NOT NULL,
	"category" text NOT NULL,
	"title_pl" text NOT NULL,
	"statutory_due_date" text NOT NULL,
	"adjusted_due_date" text NOT NULL,
	"shift_reason" text,
	"estimated_amount_grosze" bigint,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"legal_basis_json" jsonb NOT NULL,
	"paid_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "tax_obligation_item_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "tax_obligation_item_period_code_unique" UNIQUE("tenant_id","legal_entity_id","period","obligation_code"),
	CONSTRAINT "tax_obligation_item_text_check" CHECK (btrim("tax_obligation_item"."obligation_code") <> '' AND btrim("tax_obligation_item"."title_pl") <> ''),
	CONSTRAINT "tax_obligation_item_category_check" CHECK ("tax_obligation_item"."category" IN ('vat', 'pit', 'ryczalt', 'cit', 'zus', 'jpk_income_tax', 'ksef', 'edoreczenia')),
	CONSTRAINT "tax_obligation_item_dates_check" CHECK ("tax_obligation_item"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "tax_obligation_item"."statutory_due_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "tax_obligation_item"."adjusted_due_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND "tax_obligation_item"."adjusted_due_date" >= "tax_obligation_item"."statutory_due_date"),
	CONSTRAINT "tax_obligation_item_amount_check" CHECK ("tax_obligation_item"."estimated_amount_grosze" IS NULL OR "tax_obligation_item"."estimated_amount_grosze" >= 0),
	CONSTRAINT "tax_obligation_item_status_check" CHECK ("tax_obligation_item"."status" IN ('upcoming', 'paid', 'overdue')),
	CONSTRAINT "tax_obligation_item_timestamps_check" CHECK (isfinite("tax_obligation_item"."created_at") AND isfinite("tax_obligation_item"."updated_at") AND ("tax_obligation_item"."paid_at" IS NULL OR isfinite("tax_obligation_item"."paid_at")))
);
--> statement-breakpoint
ALTER TABLE "tax_obligation_item" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "vat_register_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"period" text NOT NULL,
	"tax_point_date" text NOT NULL,
	"document_id" uuid,
	"document_number" text NOT NULL,
	"counterparty_name" text NOT NULL,
	"counterparty_nip" text,
	"vat_rate_code" text NOT NULL,
	"net_grosze" bigint NOT NULL,
	"vat_total_grosze" bigint NOT NULL,
	"vat_deductible_grosze" bigint NOT NULL,
	"vat_non_deductible_grosze" bigint NOT NULL,
	"gtu_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"procedure_markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ksef_marker" text DEFAULT 'NONE' NOT NULL,
	"ksef_reference" text,
	"legal_explanation_json" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "vat_register_entry_entity_id_unique" UNIQUE("tenant_id","legal_entity_id","id"),
	CONSTRAINT "vat_register_entry_direction_check" CHECK ("vat_register_entry"."direction" IN ('sales', 'purchase')),
	CONSTRAINT "vat_register_entry_period_date_check" CHECK ("vat_register_entry"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND "vat_register_entry"."tax_point_date" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
	CONSTRAINT "vat_register_entry_text_check" CHECK (btrim("vat_register_entry"."document_number") <> '' AND btrim("vat_register_entry"."counterparty_name") <> ''),
	CONSTRAINT "vat_register_entry_rate_check" CHECK ("vat_register_entry"."vat_rate_code" IN ('23', '8', '5', '0', 'zw', 'np')),
	CONSTRAINT "vat_register_entry_amounts_check" CHECK ("vat_register_entry"."vat_deductible_grosze" + "vat_register_entry"."vat_non_deductible_grosze" = "vat_register_entry"."vat_total_grosze"),
	CONSTRAINT "vat_register_entry_json_arrays_check" CHECK (jsonb_typeof("vat_register_entry"."gtu_codes") = 'array' AND jsonb_typeof("vat_register_entry"."procedure_markers") = 'array'),
	CONSTRAINT "vat_register_entry_ksef_marker_check" CHECK ("vat_register_entry"."ksef_marker" IN ('NONE', 'OFF', 'BFK', 'DI')),
	CONSTRAINT "vat_register_entry_created_at_check" CHECK (isfinite("vat_register_entry"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "vat_register_entry" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounting_document" ADD CONSTRAINT "accounting_document_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "bank_statement_import" ADD CONSTRAINT "bank_statement_import_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_import_fk" FOREIGN KEY ("tenant_id","legal_entity_id","statement_import_id") REFERENCES "bank_statement_import"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_settlement_fk" FOREIGN KEY ("tenant_id","legal_entity_id","matched_settlement_id") REFERENCES "settlement_item"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "bank_transaction" ADD CONSTRAINT "bank_transaction_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","matched_document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_entry" ADD CONSTRAINT "journal_entry_storno_fk" FOREIGN KEY ("tenant_id","legal_entity_id","storno_of_entry_id") REFERENCES "journal_entry"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_entry_fk" FOREIGN KEY ("tenant_id","legal_entity_id","journal_entry_id") REFERENCES "journal_entry"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "journal_line" ADD CONSTRAINT "journal_line_account_fk" FOREIGN KEY ("tenant_id","legal_entity_id","ledger_account_id") REFERENCES "ledger_account"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "kpir_entry" ADD CONSTRAINT "kpir_entry_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "kpir_entry" ADD CONSTRAINT "kpir_entry_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "kpir_entry" ADD CONSTRAINT "kpir_entry_storno_fk" FOREIGN KEY ("tenant_id","legal_entity_id","storno_of_entry_id") REFERENCES "kpir_entry"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "ledger_account" ADD CONSTRAINT "ledger_account_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "mcp_prepared_proposal" ADD CONSTRAINT "mcp_prepared_proposal_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_obligation_fk" FOREIGN KEY ("tenant_id","legal_entity_id","obligation_id") REFERENCES "tax_obligation_item"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "ryczalt_entry" ADD CONSTRAINT "ryczalt_entry_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "ryczalt_entry" ADD CONSTRAINT "ryczalt_entry_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "ryczalt_entry" ADD CONSTRAINT "ryczalt_entry_corrected_fk" FOREIGN KEY ("tenant_id","legal_entity_id","corrected_entry_id") REFERENCES "ryczalt_entry"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "sandbox_mailbox_message" ADD CONSTRAINT "sandbox_mailbox_message_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "sandbox_mailbox_message" ADD CONSTRAINT "sandbox_mailbox_message_outbox_fk" FOREIGN KEY ("tenant_id","legal_entity_id","outbox_id") REFERENCES "notification_outbox"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "settlement_item" ADD CONSTRAINT "settlement_item_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "tax_obligation_item" ADD CONSTRAINT "tax_obligation_item_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "vat_register_entry" ADD CONSTRAINT "vat_register_entry_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
ALTER TABLE "vat_register_entry" ADD CONSTRAINT "vat_register_entry_document_fk" FOREIGN KEY ("tenant_id","legal_entity_id","document_id") REFERENCES "accounting_document"("tenant_id","legal_entity_id","id") ON DELETE restrict ON UPDATE restrict;
--> statement-breakpoint
CREATE INDEX "accounting_document_status_issue_idx" ON "accounting_document" USING btree ("tenant_id","legal_entity_id","status","issue_date");
--> statement-breakpoint
CREATE INDEX "bank_transaction_status_date_idx" ON "bank_transaction" USING btree ("tenant_id","legal_entity_id","match_status","booking_date");
--> statement-breakpoint
CREATE INDEX "journal_entry_period_idx" ON "journal_entry" USING btree ("tenant_id","legal_entity_id","period");
--> statement-breakpoint
CREATE INDEX "journal_line_entry_idx" ON "journal_line" USING btree ("tenant_id","legal_entity_id","journal_entry_id");
--> statement-breakpoint
CREATE INDEX "kpir_entry_period_idx" ON "kpir_entry" USING btree ("tenant_id","legal_entity_id","period");
--> statement-breakpoint
CREATE INDEX "mcp_prepared_proposal_status_idx" ON "mcp_prepared_proposal" USING btree ("tenant_id","legal_entity_id","status","expires_at");
--> statement-breakpoint
CREATE INDEX "notification_outbox_dispatch_idx" ON "notification_outbox" USING btree ("tenant_id","legal_entity_id","status","next_attempt_at");
--> statement-breakpoint
CREATE INDEX "ryczalt_entry_period_idx" ON "ryczalt_entry" USING btree ("tenant_id","legal_entity_id","period");
--> statement-breakpoint
CREATE INDEX "sandbox_mailbox_message_created_idx" ON "sandbox_mailbox_message" USING btree ("tenant_id","legal_entity_id","created_at");
--> statement-breakpoint
CREATE INDEX "settlement_item_status_due_idx" ON "settlement_item" USING btree ("tenant_id","legal_entity_id","status","due_date");
--> statement-breakpoint
CREATE INDEX "tax_obligation_item_due_idx" ON "tax_obligation_item" USING btree ("tenant_id","legal_entity_id","adjusted_due_date");
--> statement-breakpoint
CREATE INDEX "vat_register_entry_period_dir_idx" ON "vat_register_entry" USING btree ("tenant_id","legal_entity_id","period","direction");
--> statement-breakpoint
CREATE FUNCTION pap_protect_append_only_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rejestr księgowy jest append-only — korekta wyłącznie przez storno lub wpis korygujący' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION pap_forbid_accounting_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Usuwanie rekordów księgowych jest zabronione' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION pap_guard_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified_posted' AND (
    NEW.status NOT IN ('verified_posted', 'archived')
    OR NEW.net_grosze IS DISTINCT FROM OLD.net_grosze
    OR NEW.vat_grosze IS DISTINCT FROM OLD.vat_grosze
    OR NEW.gross_grosze IS DISTINCT FROM OLD.gross_grosze
    OR NEW.sha256_hash IS DISTINCT FROM OLD.sha256_hash
    OR NEW.document_number IS DISTINCT FROM OLD.document_number
    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
  ) THEN
    RAISE EXCEPTION 'Zaksięgowany dokument może przejść wyłącznie do archiwum bez zmiany kwot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER accounting_document_posted_guard
BEFORE UPDATE ON "accounting_document"
FOR EACH ROW EXECUTE FUNCTION pap_guard_posted_document();
--> statement-breakpoint
CREATE FUNCTION pap_require_accounting_write_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF session_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID))
    THEN RETURN NULL; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM security_decision_event e
    JOIN company_operation_probe p ON p.operation_id = e.operation_id
      AND p.tenant_id = e.tenant_id AND p.legal_entity_id = e.legal_entity_id
      AND p.actor_id = e.actor_id
    WHERE e.transaction_id = pg_current_xact_id()::text
      AND e.tenant_id = NEW.tenant_id
      AND e.legal_entity_id = NEW.legal_entity_id
      AND e.kind = 'company'
      AND e.action = 'write'
      AND e.decision = 'allow'
      AND e.outcome = 'committed'
  ) THEN
    RAISE EXCEPTION 'Brak atomowego audytu operacji księgowej' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
  signature text;
  data_schema text := current_schema();
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'company_tax_settings', 'accounting_document', 'kpir_entry', 'ryczalt_entry',
    'vat_register_entry', 'ledger_account', 'journal_entry', 'journal_line',
    'settlement_item', 'bank_statement_import', 'bank_transaction', 'tax_obligation_item',
    'mcp_prepared_proposal', 'notification_preference', 'notification_outbox',
    'sandbox_mailbox_message'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY pap_migrator ON %I FOR ALL TO PUBLIC USING (current_user = %L) WITH CHECK (current_user = %L)',
      t,
      current_user,
      current_user
    );
    EXECUTE format(
      'CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pap_require_accounting_write_audit()',
      t || '_audit_required',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'kpir_entry', 'ryczalt_entry', 'vat_register_entry', 'journal_entry',
    'journal_line', 'bank_statement_import', 'sandbox_mailbox_message'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pap_protect_append_only_accounting()',
      t || '_append_only',
      t
    );
  END LOOP;

  FOREACH t IN ARRAY ARRAY[
    'company_tax_settings', 'accounting_document', 'ledger_account', 'settlement_item',
    'bank_transaction', 'tax_obligation_item', 'mcp_prepared_proposal',
    'notification_preference', 'notification_outbox'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pap_forbid_accounting_delete()',
      t || '_no_delete',
      t
    );
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'pap_protect_append_only_accounting()',
    'pap_forbid_accounting_delete()',
    'pap_guard_posted_document()',
    'pap_require_accounting_write_audit()'
  ]
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', signature, data_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', signature);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE POLICY pap_company_tax_settings_read ON "company_tax_settings" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_company_tax_settings_insert ON "company_tax_settings" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_company_tax_settings_update ON "company_tax_settings" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_accounting_document_read ON "accounting_document" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_accounting_document_insert ON "accounting_document" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_accounting_document_update ON "accounting_document" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_kpir_entry_read ON "kpir_entry" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_kpir_entry_insert ON "kpir_entry" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_ryczalt_entry_read ON "ryczalt_entry" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_ryczalt_entry_insert ON "ryczalt_entry" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_vat_register_entry_read ON "vat_register_entry" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_vat_register_entry_insert ON "vat_register_entry" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_ledger_account_read ON "ledger_account" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_ledger_account_insert ON "ledger_account" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_ledger_account_update ON "ledger_account" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_journal_entry_read ON "journal_entry" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_journal_entry_insert ON "journal_entry" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_journal_line_read ON "journal_line" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_journal_line_insert ON "journal_line" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_settlement_item_read ON "settlement_item" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_settlement_item_insert ON "settlement_item" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_settlement_item_update ON "settlement_item" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_bank_statement_import_read ON "bank_statement_import" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_bank_statement_import_insert ON "bank_statement_import" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_bank_transaction_read ON "bank_transaction" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_bank_transaction_insert ON "bank_transaction" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_bank_transaction_update ON "bank_transaction" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_tax_obligation_item_read ON "tax_obligation_item" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_tax_obligation_item_insert ON "tax_obligation_item" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_tax_obligation_item_update ON "tax_obligation_item" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_mcp_prepared_proposal_read ON "mcp_prepared_proposal" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_mcp_prepared_proposal_insert ON "mcp_prepared_proposal" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_mcp_prepared_proposal_update ON "mcp_prepared_proposal" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_notification_preference_read ON "notification_preference" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_notification_preference_insert ON "notification_preference" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_notification_preference_update ON "notification_preference" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_notification_outbox_read ON "notification_outbox" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_notification_outbox_insert ON "notification_outbox" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_notification_outbox_update ON "notification_outbox" FOR UPDATE USING (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE POLICY pap_sandbox_mailbox_message_read ON "sandbox_mailbox_message" FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND (pap_company_allowed(tenant_id, legal_entity_id, 'read') OR pap_company_allowed(tenant_id, legal_entity_id, 'write'))
);
--> statement-breakpoint
CREATE POLICY pap_sandbox_mailbox_message_insert ON "sandbox_mailbox_message" FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
