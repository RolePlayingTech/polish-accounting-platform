-- Jawne, ręczne wykonanie przez administratora klastra w dedykowanej bazie PAP.
-- Nie przejmuje istniejącej roli, nie ustawia hasła i nie zmienia usług.
DO $$
DECLARE db_name text := current_database(); runtime_name text; migrator_name text;
BEGIN
  CASE db_name
    WHEN 'pap_local' THEN runtime_name := 'pap_local_app'; migrator_name := 'pap_local';
    WHEN 'pap_test' THEN runtime_name := 'pap_test_app'; migrator_name := 'pap_test';
    WHEN 'pap_staging' THEN runtime_name := 'pap_staging_app'; migrator_name := 'pap_staging_migrator';
    ELSE RAISE EXCEPTION 'Bootstrap wymaga dedykowanej bazy PAP';
  END CASE;
  IF NOT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
    WHERE d.datname = db_name AND r.rolname = migrator_name) THEN
    RAISE EXCEPTION 'Baza musi należeć do oddzielnego migratora PAP';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_name) THEN
    RAISE EXCEPTION 'Rola już istnieje; wymagany odczytowy audyt zamiast jej przejęcia';
  END IF;
  EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', runtime_name);
END;
$$;
