-- Uruchamiać ręcznie w dedykowanej bazie po migracjach, w transakcji administracyjnej.
-- Parametr: SELECT set_config('pap.provision_runtime_role', 'pap_test_app', true);
-- Nie tworzy kont, haseł, członkostw ani usług.
DO $$
DECLARE
  runtime_name text := current_setting('pap.provision_runtime_role');
  db_name text := current_database();
  data_schema text := current_schema();
  migrator_name text;
  role_record record;
  table_name text;
  column_record record;
  function_record record;
BEGIN
  IF (db_name, runtime_name) NOT IN (
      ('pap_local','pap_local_app'), ('pap_test','pap_test_app'),
      ('pap_staging','pap_staging_app')) THEN
    RAISE EXCEPTION 'Niedozwolona para bazy i roli runtime';
  END IF;
  IF data_schema <> 'public' AND data_schema !~ '^pap_test_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Niedozwolony schemat danych';
  END IF;
  SELECT r.rolname INTO migrator_name
    FROM pg_database d
    JOIN pg_roles r ON r.oid = d.datdba
   WHERE d.datname = db_name;
  SELECT * INTO role_record FROM pg_roles WHERE rolname = runtime_name;
  IF NOT FOUND OR role_record.rolsuper OR role_record.rolbypassrls
    OR role_record.rolcreatedb OR role_record.rolcreaterole OR role_record.rolreplication
    OR has_parameter_privilege(runtime_name, 'session_replication_role', 'SET')
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = role_record.oid)
    OR EXISTS (SELECT 1 FROM pg_database WHERE oid = (SELECT oid FROM pg_database WHERE datname = db_name)
      AND datdba = role_record.oid)
    OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN (data_schema, 'public', 'drizzle')
      AND nspowner = role_record.oid)
    OR EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = data_schema::regnamespace
      AND relowner = role_record.oid)
  THEN RAISE EXCEPTION 'Rola runtime jest uprzywilejowana, właścicielska lub nie istnieje'; END IF;
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', db_name);
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM %I', db_name, runtime_name);
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', db_name, runtime_name);
  EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC, %I', data_schema, runtime_name);
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', data_schema, runtime_name);
  IF data_schema <> 'public' THEN
    EXECUTE format('REVOKE CREATE ON SCHEMA %I FROM PUBLIC, %I', 'public', runtime_name);
  END IF;
  EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM PUBLIC, %I', data_schema, runtime_name);
  -- REVOKE na tabeli nie usuwa zastanych uprawnień kolumnowych.
  FOR column_record IN SELECT c.relname, a.attname FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid WHERE c.relnamespace = data_schema::regnamespace
      AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    EXECUTE format('REVOKE ALL (%I) ON %I.%I FROM PUBLIC, %I',
      column_record.attname, data_schema, column_record.relname, runtime_name);
  END LOOP;
  EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM PUBLIC, %I', data_schema, runtime_name);
  -- P1-1 (H1): iteracja wyłącznie po funkcjach należących do ról zarządzalnych przez current_user
  -- (bez WARNING 01007 / ERROR 42501 na funkcjach rozszerzeń C należących do superusera postgres
  -- przy migratorze NOSUPERUSER).
  FOR function_record IN
    SELECT p.oid::regprocedure AS regproc
    FROM pg_proc p
    WHERE p.pronamespace = to_regnamespace(data_schema)
      AND pg_has_role(current_user, p.proowner, 'USAGE')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, %I', function_record.regproc, runtime_name);
  END LOOP;
  -- Gdy skrypt wykonuje superuser (właściciel funkcji pgcrypto), zachowujemy EXECUTE na hmac dla migratora (pap_context).
  IF migrator_name IS NOT NULL AND EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_depend dep ON dep.objid = p.oid
      AND dep.classid = 'pg_proc'::regclass
      AND dep.refclassid = 'pg_extension'::regclass
      AND dep.deptype = 'e'
    JOIN pg_extension ext ON ext.oid = dep.refobjid
    WHERE p.pronamespace = to_regnamespace(data_schema)
      AND ext.extname = 'pgcrypto'
      AND p.proname = 'hmac'
      AND pg_get_function_identity_arguments(p.oid) = 'bytea, bytea, text'
      AND pg_has_role(current_user, p.proowner, 'USAGE')
  ) THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %I.hmac(bytea, bytea, text) TO %I', data_schema, migrator_name);
  END IF;
  FOREACH table_name IN ARRAY ARRAY['tenant','legal_entity','entity_profile_version','tenant_membership',
    'company_access_grant','access_management_event','app_user','user_oidc_identity','company_operation_probe']
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO %I', data_schema, table_name, runtime_name);
  END LOOP;
  -- UPDATE co najmniej jednej kolumny jest wymagany dla SELECT ... FOR SHARE/UPDATE.
  -- WITH CHECK false i brak polityk INSERT blokują rzeczywiste mutacje tożsamości/firmy.
  EXECUTE format('GRANT UPDATE (id) ON %I.app_user, %I.user_oidc_identity, %I.legal_entity TO %I',
    data_schema, data_schema, data_schema, runtime_name);
  EXECUTE format('GRANT UPDATE (user_id) ON %I.tenant_membership TO %I',
    data_schema, runtime_name);
  EXECUTE format('GRANT UPDATE (grant_id) ON %I.company_access_grant TO %I',
    data_schema, runtime_name);
  EXECUTE format('GRANT INSERT ON %I.company_operation_probe TO %I', data_schema, runtime_name);
  EXECUTE format('GRANT INSERT ON %I.security_decision_event TO %I', data_schema, runtime_name);
  -- 0007 Accounting Core: biała lista SELECT + INSERT dla 16 tabel księgowych (zero DELETE/TRUNCATE).
  FOREACH table_name IN ARRAY ARRAY[
    'company_tax_settings', 'accounting_document', 'kpir_entry', 'ryczalt_entry',
    'vat_register_entry', 'ledger_account', 'journal_entry', 'journal_line',
    'settlement_item', 'bank_statement_import', 'bank_transaction', 'tax_obligation_item',
    'mcp_prepared_proposal', 'notification_preference', 'notification_outbox',
    'sandbox_mailbox_message'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I.%I TO %I', data_schema, table_name, runtime_name);
  END LOOP;
  -- 0007 Accounting Core: biała lista UPDATE wyłącznie dla tabel ze zmiennym statusem (bez rejestrów append-only).
  FOREACH table_name IN ARRAY ARRAY[
    'company_tax_settings', 'accounting_document', 'ledger_account', 'settlement_item',
    'bank_transaction', 'tax_obligation_item', 'mcp_prepared_proposal',
    'notification_preference', 'notification_outbox'
  ]
  LOOP
    EXECUTE format('GRANT UPDATE ON %I.%I TO %I', data_schema, table_name, runtime_name);
  END LOOP;
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.pap_context(), %I.pap_admin_allowed(uuid),
    %I.pap_company_allowed(uuid,uuid,text), %I.pap_resolve_identity(text,text),
    %I.pap_execute_access(), %I.pap_security_protocol_version() TO %I',
    data_schema, data_schema, data_schema, data_schema, data_schema, data_schema, runtime_name);
  -- Runtime nie uzyskuje USAGE na schemacie rejestru migracji.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    EXECUTE format('REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, %I', runtime_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC, %I', runtime_name);
  END IF;
END;
$$;
