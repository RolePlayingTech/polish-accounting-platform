-- Jawne, ręczne wykonanie przez administratora klastra (superuser postgres) w dedykowanej bazie PAP.
-- Nie przejmuje istniejącej roli, nie ustawia hasła i nie zmienia usług.
DO $$
DECLARE
  db_name text := current_database();
  runtime_name text;
  migrator_name text;
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

-- P1-1 (H1): blokada domyślnego PUBLIC EXECUTE na funkcjach rozszerzenia pgcrypto należących do superusera,
-- z zachowaniem EXECUTE wyłącznie na hmac(bytea, bytea, text) dla właściciela bazy (migratora pap_context).
-- Działa zarówno dla rozszerzenia już zainstalowanego, jak i przyszłych migracji 0004 wykonywanych przez
-- migratora NOSUPERUSER (w schemacie public lub izolowanym schemacie pap_test_<hex>).
CREATE OR REPLACE FUNCTION public.pap_apply_pgcrypto_lockdown()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
DECLARE
  db_name text := pg_catalog.current_database();
  migrator_name text;
  runtime_name text;
  fn_rec record;
BEGIN
  SELECT r.rolname INTO migrator_name
    FROM pg_catalog.pg_database d
    JOIN pg_catalog.pg_roles r ON r.oid = d.datdba
   WHERE d.datname = db_name;

  runtime_name := CASE db_name
    WHEN 'pap_local' THEN 'pap_local_app'
    WHEN 'pap_test' THEN 'pap_test_app'
    WHEN 'pap_staging' THEN 'pap_staging_app'
    ELSE NULL
  END;

  FOR fn_rec IN
    SELECT p.oid::pg_catalog.regprocedure AS regproc,
           p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_catalog.pg_depend dep
      JOIN pg_catalog.pg_extension ext ON ext.oid = dep.refobjid
      JOIN pg_catalog.pg_proc p ON p.oid = dep.objid
     WHERE dep.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
       AND dep.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
       AND dep.deptype = 'e'
       AND ext.extname = 'pgcrypto'
       AND pg_catalog.pg_has_role(current_user, p.proowner, 'USAGE')
  LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn_rec.regproc);
    IF runtime_name IS NOT NULL AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = runtime_name) THEN
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %I', fn_rec.regproc, runtime_name);
    END IF;
    IF migrator_name IS NOT NULL AND fn_rec.proname = 'hmac' AND fn_rec.args = 'bytea, bytea, text' THEN
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %I', fn_rec.regproc, migrator_name);
    END IF;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.pap_apply_pgcrypto_lockdown() FROM PUBLIC;

DO $$
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    CREATE OR REPLACE FUNCTION public.pap_on_create_extension_lockdown()
    RETURNS event_trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog
    AS $et$
    BEGIN
      PERFORM public.pap_apply_pgcrypto_lockdown();
    END;
    $et$;

    REVOKE ALL ON FUNCTION public.pap_on_create_extension_lockdown() FROM PUBLIC;

    DROP EVENT TRIGGER IF EXISTS pap_lockdown_pgcrypto_on_extension;
    CREATE EVENT TRIGGER pap_lockdown_pgcrypto_on_extension
      ON ddl_command_end
      WHEN TAG IN ('CREATE EXTENSION')
      EXECUTE FUNCTION public.pap_on_create_extension_lockdown();
  END IF;

  PERFORM public.pap_apply_pgcrypto_lockdown();
END;
$$;
