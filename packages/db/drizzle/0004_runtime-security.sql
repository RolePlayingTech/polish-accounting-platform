-- Addytywny kandydat 6D-3A. Role i klucz provisionowane osobno; brak sekretów w migracji.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = current_schema()
  ) THEN
    RAISE EXCEPTION 'pgcrypto musi należeć do schematu danych';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE security_context_key (
  key_id text PRIMARY KEY,
  secret_hex text NOT NULL CHECK (secret_hex ~ '^[a-f0-9]{64}$'),
  runtime_role text NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE company_operation_probe (
  operation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT company_operation_probe_company_fk FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entity(tenant_id, id)
);
--> statement-breakpoint
-- Funkcja nie przyjmuje asercji jako parametru i nigdy nie ujawnia materiału klucza.
CREATE FUNCTION pap_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE
  payload text := current_setting('pap.context', true);
  signature text := current_setting('pap.context_signature', true);
  claims jsonb;
  secret text;
  now_ms numeric := extract(epoch FROM clock_timestamp()) * 1000;
BEGIN
  IF payload IS NULL OR length(payload) > 8192 OR signature IS NULL
    OR signature !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  claims := payload::jsonb;
  IF claims->>'version' IS DISTINCT FROM '1'
    OR claims->>'xid' IS DISTINCT FROM pg_current_xact_id()::text
    OR claims->>'pid' IS DISTINCT FROM pg_backend_pid()::text
    OR claims->>'role' IS DISTINCT FROM session_user::text
    OR claims->>'database' IS DISTINCT FROM current_database()
    OR claims->>'expires' IS NULL
    OR NOT ((claims->>'expires')::numeric > now_ms
      AND (claims->>'expires')::numeric <= now_ms + 60000)
  THEN RETURN NULL; END IF;
  SELECT k.secret_hex INTO secret FROM security_context_key k
    WHERE k.key_id = claims->>'key_id' AND k.enabled AND k.runtime_role = session_user::text;
  IF secret IS NULL OR encode(hmac(convert_to(payload, 'UTF8'),
      decode(secret, 'hex'), 'sha256'), 'hex') IS DISTINCT FROM signature
  THEN RETURN NULL; END IF;
  RETURN claims;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION pap_admin_allowed(scope_tenant uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER VOLATILE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_membership m JOIN app_user u ON u.id = m.user_id
    WHERE m.tenant_id = scope_tenant AND m.user_id::text = pap_context()->>'actor_user_id'
      AND u.status = 'active' AND u.disabled_at IS NULL
      AND m.status = 'active' AND m.role IN ('tenant_owner', 'tenant_admin')
      AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
  );
$$;
--> statement-breakpoint
CREATE FUNCTION pap_company_allowed(scope_tenant uuid, scope_entity uuid, scope_action text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER VOLATILE AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_membership m
    JOIN app_user u ON u.id = m.user_id
    JOIN company_access_grant g ON g.tenant_id = m.tenant_id AND g.user_id = m.user_id
    WHERE m.tenant_id = scope_tenant AND m.user_id::text = pap_context()->>'actor_user_id'
      AND u.status = 'active' AND u.disabled_at IS NULL
      AND m.status = 'active' AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
      AND g.legal_entity_id = scope_entity AND g.action = scope_action
      AND g.valid_from <= clock_timestamp()
      AND (g.valid_until IS NULL OR g.valid_until > clock_timestamp())
      AND (g.revoked_at IS NULL OR g.revoked_at > clock_timestamp())
  );
$$;
--> statement-breakpoint
-- Minimalne mapowanie wyłącznie dla podpisanej, zweryfikowanej przez serwer pary OIDC.
CREATE FUNCTION pap_resolve_identity(expected_issuer text, expected_subject text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE c jsonb := pap_context(); result uuid;
BEGIN
  IF c->>'purpose' IS DISTINCT FROM 'identity'
    OR c->>'issuer' IS DISTINCT FROM expected_issuer
    OR c->>'subject' IS DISTINCT FROM expected_subject THEN RETURN NULL; END IF;
  SELECT u.id INTO result FROM user_oidc_identity i JOIN app_user u ON u.id = i.user_id
    WHERE i.issuer = expected_issuer AND i.subject = expected_subject
      AND i.status = 'active' AND i.revoked_at IS NULL
      AND u.status = 'active' AND u.disabled_at IS NULL;
  RETURN result;
END;
$$;
--> statement-breakpoint
-- Runtime modyfikuje jedynie pola zgodne z dokładną komendą zatwierdzoną przez domenę.
CREATE FUNCTION pap_guard_access_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb := pap_context(); command jsonb; decision_time timestamptz;
BEGIN
  -- INVOKER: SELECT FOR UPDATE nadal działa, ale runtime nigdy nie wykonuje DML.
  -- Kontrolowana funkcja SECURITY DEFINER wykonuje DML jako właściciel tabeli.
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'Zmiana dostępu wymaga kontrolowanej funkcji' USING ERRCODE = '42501';
  END IF;
  IF session_user = current_user THEN RETURN NEW; END IF;
  IF c->>'purpose' IS DISTINCT FROM 'access' THEN
    RAISE EXCEPTION 'Brak autoryzowanej komendy dostępu' USING ERRCODE = '42501';
  END IF;
  command := c->'command';
  decision_time := (c->>'decision_at')::timestamptz;
  IF NEW.tenant_id::text IS DISTINCT FROM c->>'tenant_id'
    OR NEW.user_id::text IS DISTINCT FROM c->>'target_user_id'
    OR NOT pap_admin_allowed(NEW.tenant_id) THEN
    RAISE EXCEPTION 'Niepoprawny zakres komendy dostępu' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'tenant_membership' THEN
    IF (NEW.tenant_id, NEW.user_id, NEW.role) IS DISTINCT FROM (OLD.tenant_id, OLD.user_id, OLD.role)
      OR NOT (
        (command->>'kind' = 'revoke_membership' AND NEW.status = 'revoked'
          AND NEW.valid_from = OLD.valid_from AND NEW.valid_until IS NOT DISTINCT FROM OLD.valid_until)
        OR (command->>'kind' = 'reactivate_membership' AND OLD.status = 'revoked'
          AND NEW.status = 'active' AND NEW.valid_from = decision_time
          AND NEW.valid_until IS NOT DISTINCT FROM (command->>'validUntil')::timestamptz)
      ) THEN RAISE EXCEPTION 'Zmiana niezgodna z komendą' USING ERRCODE = '42501'; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF command->>'kind' IS DISTINCT FROM 'grant'
      OR NEW.grant_id::text IS DISTINCT FROM command->>'grantId'
      OR NEW.legal_entity_id::text IS DISTINCT FROM command->>'legalEntityId'
      OR NEW.action IS DISTINCT FROM command->>'action'
      OR NEW.valid_from IS DISTINCT FROM COALESCE((command->>'validFrom')::timestamptz, decision_time)
      OR NEW.valid_until IS DISTINCT FROM (command->>'validUntil')::timestamptz
      OR NEW.revoked_at IS NOT NULL
    THEN RAISE EXCEPTION 'Grant niezgodny z komendą' USING ERRCODE = '42501'; END IF;
  ELSE
    IF (to_jsonb(NEW) - 'revoked_at') IS DISTINCT FROM (to_jsonb(OLD) - 'revoked_at')
      OR NEW.revoked_at IS DISTINCT FROM LEAST(OLD.revoked_at, decision_time)
      OR (command->>'kind' NOT IN ('revoke_membership', 'reactivate_membership')
        AND NOT (command->>'kind' = 'revoke_grant' AND NEW.grant_id::text = command->>'grantId'))
    THEN RAISE EXCEPTION 'Cofnięcie niezgodne z komendą' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Zegar kaskady musi być tym samym zegarem decyzji co jawna mutacja.
CREATE OR REPLACE FUNCTION revoke_grants_on_membership_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  c jsonb := pap_context();
  revoked_time timestamptz := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF session_user <> current_user THEN
    IF c->>'purpose' IS DISTINCT FROM 'access' OR c->>'decision_at' IS NULL THEN
      RAISE EXCEPTION 'Brak decyzji kaskady' USING ERRCODE = '42501';
    END IF;
    revoked_time := (c->>'decision_at')::timestamptz;
  ELSIF NEW.status = 'active' THEN
    revoked_time := LEAST(revoked_time, NEW.valid_from);
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE company_access_grant SET revoked_at = revoked_time
      WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id
        AND (revoked_at IS NULL OR revoked_at > revoked_time);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pap_membership_runtime_guard BEFORE UPDATE ON tenant_membership
FOR EACH ROW EXECUTE FUNCTION pap_guard_access_write();
--> statement-breakpoint
CREATE TRIGGER pap_grant_runtime_guard BEFORE INSERT OR UPDATE ON company_access_grant
FOR EACH ROW EXECUTE FUNCTION pap_guard_access_write();
--> statement-breakpoint
-- Migrator jest jawną granicą zaufania. FORCE obowiązuje również właściciela;
-- jawna polityka administracyjna umożliwia migracje i małe funkcje SECURITY DEFINER.
DO $$
DECLARE t text; signature text; data_schema text := current_schema();
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant','legal_entity','tenant_membership','entity_profile_version',
    'company_access_grant','access_management_event','app_user','user_oidc_identity',
    'security_context_key','company_operation_probe']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY pap_migrator ON %I FOR ALL TO PUBLIC USING (current_user = %L) WITH CHECK (current_user = %L)', t, current_user, current_user);
  END LOOP;
  FOREACH signature IN ARRAY ARRAY[
    'pap_context()', 'pap_admin_allowed(uuid)', 'pap_company_allowed(uuid,uuid,text)',
    'pap_resolve_identity(text,text)', 'pap_guard_access_write()',
    'protect_grant_revocation()', 'revoke_grants_on_membership_transition()',
    'protect_access_management_event()', 'protect_user_oidc_identity()',
    'revoke_oidc_identities_on_user_disable()']
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', signature, data_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', signature);
  END LOOP;
  -- Domyślne uprawnienia nie przyznają runtime dostępu do przyszłych obiektów.
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', data_schema);
  EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM PUBLIC', data_schema);
END;
$$;
--> statement-breakpoint
CREATE POLICY pap_actor_read ON app_user FOR SELECT USING (
  id::text = pap_context()->>'actor_user_id');
--> statement-breakpoint
CREATE POLICY pap_actor_lock ON app_user FOR UPDATE USING (
  id::text = pap_context()->>'actor_user_id') WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY pap_identity_read ON user_oidc_identity FOR SELECT USING (
  user_id::text = pap_context()->>'actor_user_id');
--> statement-breakpoint
CREATE POLICY pap_identity_lock ON user_oidc_identity FOR UPDATE USING (
  user_id::text = pap_context()->>'actor_user_id') WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY pap_tenant_read ON tenant FOR SELECT USING (
  id::text = pap_context()->>'tenant_id' AND EXISTS (
    SELECT 1 FROM tenant_membership m WHERE m.tenant_id = id
      AND m.user_id::text = pap_context()->>'actor_user_id'
      AND m.status = 'active' AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())));
--> statement-breakpoint
CREATE POLICY pap_membership_read ON tenant_membership FOR SELECT USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    user_id::text = pap_context()->>'actor_user_id'
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id))));
--> statement-breakpoint
CREATE POLICY pap_membership_update ON tenant_membership FOR UPDATE USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    user_id::text = pap_context()->>'actor_user_id'
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id)))
) WITH CHECK (
  pap_context()->>'purpose' = 'access' AND tenant_id::text = pap_context()->>'tenant_id'
  AND user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id));
--> statement-breakpoint
CREATE POLICY pap_grant_read ON company_access_grant FOR SELECT USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    user_id::text = pap_context()->>'actor_user_id'
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id))));
--> statement-breakpoint
CREATE POLICY pap_grant_update ON company_access_grant FOR UPDATE USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    user_id::text = pap_context()->>'actor_user_id'
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id)))
) WITH CHECK (
  pap_context()->>'purpose' = 'access' AND tenant_id::text = pap_context()->>'tenant_id'
  AND user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id));
--> statement-breakpoint
CREATE POLICY pap_grant_insert ON company_access_grant FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'access' AND tenant_id::text = pap_context()->>'tenant_id'
  AND user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id));
--> statement-breakpoint
CREATE POLICY pap_entity_read ON legal_entity FOR SELECT USING (
  tenant_id::text = pap_context()->>'tenant_id'
  AND id::text = pap_context()->>'legal_entity_id' AND (
    pap_company_allowed(tenant_id, id, pap_context()->>'action')
    OR (pap_context()->'command' IS NOT NULL AND pap_admin_allowed(tenant_id))));
--> statement-breakpoint
CREATE POLICY pap_entity_lock ON legal_entity FOR UPDATE USING (
  tenant_id::text = pap_context()->>'tenant_id'
  AND id::text = pap_context()->>'legal_entity_id' AND (
    pap_company_allowed(tenant_id, id, pap_context()->>'action')
    OR (pap_context()->'command' IS NOT NULL AND pap_admin_allowed(tenant_id)))
) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY pap_profile_read ON entity_profile_version FOR SELECT USING (
  pap_context()->>'purpose' = 'company'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND pap_company_allowed(tenant_id, legal_entity_id, pap_context()->>'action'));
--> statement-breakpoint
CREATE POLICY pap_access_event_read ON access_management_event FOR SELECT USING (
  pap_context()->>'purpose' = 'access' AND tenant_id::text = pap_context()->>'tenant_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND user_id::text = pap_context()->>'target_user_id'
  AND operation_id::text = pap_context()->'command'->>'operationId');
--> statement-breakpoint
CREATE POLICY pap_access_event_insert ON access_management_event FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'access' AND tenant_id::text = pap_context()->>'tenant_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND user_id::text = pap_context()->>'target_user_id'
  AND operation_id::text = pap_context()->'command'->>'operationId'
  AND kind = pap_context()->'command'->>'kind'
  AND request_key::jsonb = pap_context()->'command'
  AND occurred_at = (pap_context()->>'decision_at')::timestamptz);
--> statement-breakpoint
CREATE POLICY pap_probe_read ON company_operation_probe FOR SELECT USING (
  pap_context()->>'purpose' = 'company' AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND pap_company_allowed(tenant_id, legal_entity_id, pap_context()->>'action'));
--> statement-breakpoint
CREATE POLICY pap_probe_insert ON company_operation_probe FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_context()->>'action' = 'write'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND operation_id::text = pap_context()->>'operation_id'
  AND created_at = (pap_context()->>'decision_at')::timestamptz
  AND pap_company_allowed(tenant_id, legal_entity_id, 'write'));
