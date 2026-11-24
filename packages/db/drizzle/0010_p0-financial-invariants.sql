-- Wave 1 P0 Financial Invariants & Anti-Double-Posting Indexes (#106, #107, #108, #110, #118):
-- Wymusza na poziomie schematu PostgreSQL 18 niezmienniki jednoznaczności księgowań:
-- 1) pojedynczy dokument źródłowy (`document_id IS NOT NULL`) może utworzyć co najwyżej jeden
--    niebędący stornem/korektą wpis w KPiR, ewidencji ryczałtu, dzienniku księgowym (UoR)
--    oraz pozycję rozrachunkową (`settlement_item`),
-- 2) w rejestrze VAT pojedynczy dokument może posiadać wiele stawek VAT (`23`, `8`, `5`, `0`, `zw`, `np`),
--    lecz co najwyżej jeden wpis na parę `(document_id, direction, vat_rate_code)`,
-- 3) aktywny (niezarchiwizowany) dokument księgowy posiada unikalny klucz kanonicznej operacji
--    ekonomicznej `_papEconomicOpKey` w obrębie `(tenant_id, legal_entity_id)`.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
LOCK TABLE accounting_document, kpir_entry, ryczalt_entry, vat_register_entry, journal_entry, settlement_item IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = current_schema()::regnamespace
      AND relname IN (
        'accounting_document',
        'kpir_entry',
        'ryczalt_entry',
        'vat_register_entry',
        'journal_entry',
        'settlement_item'
      )
      AND relowner <> current_user::regrole
  ) THEN
    RAISE EXCEPTION 'Migracja wymaga dotychczasowego właściciela tabel';
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  dup_rec RECORD;
BEGIN
  SELECT k.tenant_id, k.legal_entity_id, k.document_id
  INTO dup_rec
  FROM kpir_entry k
  WHERE k.document_id IS NOT NULL AND k.is_storno = false
  GROUP BY k.tenant_id, k.legal_entity_id, k.document_id
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowane księgowanie dokumentu w kpir_entry dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;

  SELECT r.tenant_id, r.legal_entity_id, r.document_id
  INTO dup_rec
  FROM ryczalt_entry r
  WHERE r.document_id IS NOT NULL AND r.is_correction = false
  GROUP BY r.tenant_id, r.legal_entity_id, r.document_id
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowane księgowanie dokumentu w ryczalt_entry dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;

  SELECT j.tenant_id, j.legal_entity_id, j.document_id
  INTO dup_rec
  FROM journal_entry j
  WHERE j.document_id IS NOT NULL AND j.is_storno = false
  GROUP BY j.tenant_id, j.legal_entity_id, j.document_id
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowane księgowanie dokumentu w journal_entry dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;

  SELECT s.tenant_id, s.legal_entity_id, s.document_id
  INTO dup_rec
  FROM settlement_item s
  WHERE s.document_id IS NOT NULL
  GROUP BY s.tenant_id, s.legal_entity_id, s.document_id
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowany rozrachunek dokumentu w settlement_item dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;

  SELECT v.tenant_id, v.legal_entity_id, v.document_id
  INTO dup_rec
  FROM vat_register_entry v
  WHERE v.document_id IS NOT NULL
  GROUP BY v.tenant_id, v.legal_entity_id, v.document_id, v.direction, v.vat_rate_code
  HAVING COUNT(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowany wpis stawki VAT w vat_register_entry dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;

  SELECT d.tenant_id, d.legal_entity_id, d.id AS document_id
  INTO dup_rec
  FROM (
    SELECT
      tenant_id,
      legal_entity_id,
      (array_agg(id ORDER BY created_at))[1] AS id
    FROM accounting_document
    WHERE status <> 'archived'
      AND btrim(COALESCE(ai_proposal_json->>'_papEconomicOpKey', '')) <> ''
    GROUP BY tenant_id, legal_entity_id, btrim(ai_proposal_json->>'_papEconomicOpKey')
    HAVING COUNT(*) > 1
    LIMIT 1
  ) d;
  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto zduplikowany klucz operacji ekonomicznej w accounting_document dla tenant_id=% legal_entity_id=% document_id=% przed migracją 0010.',
      dup_rec.tenant_id, dup_rec.legal_entity_id, dup_rec.document_id
      USING ERRCODE = '23505';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "kpir_entry_unique_document_posting_uidx" ON "kpir_entry" ("tenant_id", "legal_entity_id", "document_id") WHERE "document_id" IS NOT NULL AND "is_storno" = false;
--> statement-breakpoint
CREATE UNIQUE INDEX "ryczalt_entry_unique_document_posting_uidx" ON "ryczalt_entry" ("tenant_id", "legal_entity_id", "document_id") WHERE "document_id" IS NOT NULL AND "is_correction" = false;
--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entry_unique_document_posting_uidx" ON "journal_entry" ("tenant_id", "legal_entity_id", "document_id") WHERE "document_id" IS NOT NULL AND "is_storno" = false;
--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_item_unique_document_uidx" ON "settlement_item" ("tenant_id", "legal_entity_id", "document_id") WHERE "document_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "vat_register_entry_unique_doc_rate_uidx" ON "vat_register_entry" ("tenant_id", "legal_entity_id", "document_id", "direction", "vat_rate_code") WHERE "document_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "accounting_document_economic_op_uidx" ON "accounting_document" ("tenant_id", "legal_entity_id", (btrim("ai_proposal_json"->>'_papEconomicOpKey'))) WHERE "status" <> 'archived' AND btrim(COALESCE("ai_proposal_json"->>'_papEconomicOpKey', '')) <> '';
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
