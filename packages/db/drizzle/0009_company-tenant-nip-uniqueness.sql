-- Schema-level Tenant/NIP Uniqueness Enforcement (#80 / ADR-010):
-- Wymusza na poziomie schematu PostgreSQL niezmiennik biznesowy: w obrębie jednego
-- tenanta (`tenant_id`) żadne dwa podmioty prawne (`legal_entity_id`) nie mogą posiadać
-- tego samego 10-cyfrowego numeru NIP — zarówno w `company_tax_settings`, jak i w aktywnej
-- wersji profilu `entity_profile_version` (`valid_until IS NULL`).
-- Przed założeniem ograniczeń migracja wykonuje deterministyczną kontrolę preflight
-- wykrywającą istniejące duplikaty (bez ujawniania surowego NIP w komunikacie błędu).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
LOCK TABLE company_tax_settings, entity_profile_version IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relnamespace = current_schema()::regnamespace
      AND relname IN ('company_tax_settings', 'entity_profile_version')
      AND relowner <> current_user::regrole
  ) THEN
    RAISE EXCEPTION 'Migracja wymaga dotychczasowego właściciela tabel';
  END IF;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  duplicate_tax_settings RECORD;
  duplicate_profile_nip RECORD;
BEGIN
  SELECT
    cts.tenant_id,
    string_agg(cts.legal_entity_id::text, ', ' ORDER BY cts.legal_entity_id::text) AS entity_ids
  INTO duplicate_tax_settings
  FROM company_tax_settings cts
  GROUP BY cts.tenant_id, cts.nip
  HAVING COUNT(*) > 1
  ORDER BY cts.tenant_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto istniejący duplikat (tenant_id, nip) w company_tax_settings dla tenant_id=% (legal_entity_ids: %). Rozwiąż duplikaty przed migracją 0009.',
      duplicate_tax_settings.tenant_id,
      duplicate_tax_settings.entity_ids
      USING ERRCODE = '23505';
  END IF;

  SELECT
    epv.tenant_id,
    string_agg(epv.legal_entity_id::text, ', ' ORDER BY epv.legal_entity_id::text) AS entity_ids
  INTO duplicate_profile_nip
  FROM entity_profile_version epv
  WHERE epv.valid_until IS NULL
    AND btrim(COALESCE(epv.profile_json->>'nip', '')) ~ '^[0-9]{10}$'
  GROUP BY epv.tenant_id, btrim(epv.profile_json->>'nip')
  HAVING COUNT(*) > 1
  ORDER BY epv.tenant_id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Wykryto istniejący duplikat (tenant_id, nip) w aktywnym entity_profile_version dla tenant_id=% (legal_entity_ids: %). Rozwiąż duplikaty przed migracją 0009.',
      duplicate_profile_nip.tenant_id,
      duplicate_profile_nip.entity_ids
      USING ERRCODE = '23505';
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "company_tax_settings" ADD CONSTRAINT "company_tax_settings_tenant_nip_unique" UNIQUE ("tenant_id", "nip");
--> statement-breakpoint
CREATE UNIQUE INDEX "entity_profile_version_active_tenant_nip_uidx" ON "entity_profile_version" ("tenant_id", (btrim("profile_json"->>'nip'))) WHERE "valid_until" IS NULL AND btrim("profile_json"->>'nip') ~ '^[0-9]{10}$';
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
