-- Uruchamiać ręcznie w dedykowanej bazie po migracjach, w transakcji administracyjnej.
-- Parametr: SELECT set_config('pap.provision_runtime_role', 'pap_test_app', true);
-- Nie tworzy kont, haseł, członkostw ani usług.
DO $$
DECLARE
  runtime_name text := current_setting('pap.provision_runtime_role');
  db_name text := current_database();
  data_schema text := current_schema();
  role_record record;
  table_name text;
  column_record record;
BEGIN
  IF (db_name, runtime_name) NOT IN (
      ('pap_local','pap_local_app'), ('pap_test','pap_test_app'),
      ('pap_staging','pap_staging_app')) THEN
    RAISE EXCEPTION 'Niedozwolona para bazy i roli runtime';
  END IF;
  IF data_schema <> 'public' AND data_schema !~ '^pap_test_[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Niedozwolony schemat danych';
  END IF;
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
  EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM PUBLIC, %I', data_schema, runtime_name);
  FOREACH table_name IN ARRAY ARRAY['tenant','legal_entity','entity_profile_version','tenant_membership',
    'company_access_grant','access_management_event','app_user','user_oidc_identity','company_operation_probe']
  LOOP
    EXECUTE format('GRANT SELECT ON %I.%I TO %I', data_schema, table_name, runtime_name);
  END LOOP;
  -- UPDATE co najmniej jednej kolumny jest wymagany dla SELECT ... FOR SHARE/UPDATE.
  -- WITH CHECK false i brak polityk INSERT blokują rzeczywiste mutacje tożsamości/firmy.
  EXECUTE format('GRANT UPDATE (id) ON %I.app_user, %I.user_oidc_identity, %I.legal_entity TO %I',
    data_schema, data_schema, data_schema, runtime_name);
  EXECUTE format('GRANT UPDATE (status, valid_from, valid_until) ON %I.tenant_membership TO %I',
    data_schema, runtime_name);
  EXECUTE format('GRANT INSERT ON %I.company_access_grant TO %I',
    data_schema, runtime_name);
  EXECUTE format('GRANT UPDATE (revoked_at) ON %I.company_access_grant TO %I',
    data_schema, runtime_name);
  EXECUTE format('GRANT INSERT ON %I.access_management_event, %I.company_operation_probe TO %I',
    data_schema, data_schema, runtime_name);
  EXECUTE format('GRANT INSERT ON %I.security_decision_event TO %I', data_schema, runtime_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %I.pap_context(), %I.pap_admin_allowed(uuid),
    %I.pap_company_allowed(uuid,uuid,text), %I.pap_resolve_identity(text,text) TO %I',
    data_schema, data_schema, data_schema, data_schema, runtime_name);
  -- Runtime nie uzyskuje USAGE na schemacie rejestru migracji.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') THEN
    EXECUTE format('REVOKE ALL ON SCHEMA drizzle FROM PUBLIC, %I', runtime_name);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM PUBLIC, %I', runtime_name);
  END IF;
END;
$$;
