-- Runtime Company Provisioning & Discovery (C2-2 / #58 / #60 / #70 / #71):
-- Kontrolowane tworzenie podmiotu prawnego przez rolę runtime pap_*_app (NOBYPASSRLS)
-- bez PAP_MIGRATOR_DATABASE_URL w procesie HTTP API, utrwalanie pełnego profilu
-- w entity_profile_version.profile_json, odkrywanie firm O(1) oraz aktualizacja challenge MCP.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
LOCK TABLE legal_entity, entity_profile_version, tenant_membership, company_access_grant, access_management_event, company_operation_probe, security_decision_event, company_tax_settings, mcp_prepared_proposal IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = current_schema()::regnamespace
    AND relname IN ('legal_entity','entity_profile_version','tenant_membership','company_access_grant',
      'access_management_event','company_operation_probe','security_decision_event','company_tax_settings',
      'mcp_prepared_proposal') AND relowner <> current_user::regrole)
  THEN RAISE EXCEPTION 'Migracja wymaga dotychczasowego właściciela tabel'; END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE "entity_profile_version" ADD COLUMN "profile_json" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "entity_profile_version" ADD CONSTRAINT "entity_profile_version_profile_json_object_check" CHECK (jsonb_typeof("entity_profile_version"."profile_json") = 'object');
--> statement-breakpoint
ALTER TABLE "access_management_event" DROP CONSTRAINT "access_management_event_kind_check";
--> statement-breakpoint
ALTER TABLE "access_management_event" ADD CONSTRAINT "access_management_event_kind_check" CHECK ("access_management_event"."kind" IN ('revoke_membership', 'reactivate_membership', 'grant', 'revoke_grant', 'provision_company'));
--> statement-breakpoint
ALTER TABLE security_decision_event DROP CONSTRAINT security_decision_codes_check;
--> statement-breakpoint
ALTER TABLE security_decision_event ADD CONSTRAINT security_decision_codes_check CHECK (
  decision IN ('allow','deny')
  AND kind IN ('company','access','preflight','transport')
  AND action IN ('read','write','revoke_membership','reactivate_membership','grant','revoke_grant','provision_company','unknown')
  AND outcome IN ('committed','denied','rolled_back','outcome_unknown','preflight')
  AND ((decision = 'deny' AND outcome = 'denied') OR (decision = 'allow' AND outcome <> 'denied'))
  AND reason IN ('explicit_company_grant','authorized_tenant_administration','authentication_failed',
    'authorization_context_invalid','active_membership_required','explicit_company_grant_required',
    'identity_not_provisioned_or_disabled','authorization_data_unavailable','access_management_denied',
    'invalid_command','membership_unavailable','membership_inactive','membership_not_revoked',
    'grant_unavailable','operation_conflict','access_management_unavailable',
    'authorization_audit_unavailable','transport_rejected','operation_failed',
    'transaction_outcome_unknown')
  AND isfinite(decided_at)
  AND (outcome NOT IN ('committed','rolled_back','outcome_unknown')
    OR (decision = 'allow' AND kind IN ('company','access') AND actor_id IS NOT NULL AND tenant_id IS NOT NULL))
  AND (kind <> 'company' OR outcome <> 'committed' OR action <> 'write'
    OR (operation_id IS NOT NULL AND legal_entity_id IS NOT NULL))
  AND (kind <> 'access' OR outcome <> 'committed' OR access_management_operation_id IS NOT NULL)
  AND (outcome NOT IN ('rolled_back','outcome_unknown') OR access_management_operation_id IS NULL)
  AND (outcome <> 'outcome_unknown' OR reason = 'transaction_outcome_unknown')
  AND (reason <> 'transaction_outcome_unknown' OR outcome = 'outcome_unknown')
) NOT VALID;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_admin_allowed(scope_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE c jsonb := pap_context();
BEGIN
  IF c->>'purpose' IS NULL OR c->>'purpose' NOT IN ('facts','access','provision_company')
    OR c->>'tenant_id' IS DISTINCT FROM scope_tenant::text
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM tenant_membership m JOIN app_user u ON u.id = m.user_id
    WHERE m.tenant_id = scope_tenant AND m.user_id::text = c->>'actor_user_id'
      AND u.status = 'active' AND u.disabled_at IS NULL
      AND m.status = 'active' AND m.role IN ('tenant_owner','tenant_admin')
      AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp()));
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_guard_access_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb := pap_context(); command jsonb; decision_time timestamptz(3);
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'Zmiana dostępu wymaga kontrolowanej funkcji' USING ERRCODE = '42501';
  END IF;
  IF session_user = current_user THEN RETURN NEW; END IF;
  IF c->>'purpose' = 'provision_company' THEN
    IF TG_TABLE_NAME <> 'company_access_grant'
      OR TG_OP <> 'INSERT'
      OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
      OR c->>'decision_at' IS NULL
      OR (c->'command'->>'kind') IS DISTINCT FROM 'provision_company'
      OR NEW.tenant_id::text IS DISTINCT FROM c->>'tenant_id'
      OR NEW.legal_entity_id::text IS DISTINCT FROM (c->'command'->>'legalEntityId')
      OR NEW.action NOT IN ('read', 'write')
      OR NEW.valid_from IS DISTINCT FROM (c->>'decision_at')::timestamptz(3)
      OR NEW.valid_until IS NOT NULL
      OR NEW.revoked_at IS NOT NULL
      OR NOT pap_admin_allowed(NEW.tenant_id)
    THEN
      RAISE EXCEPTION 'Grant provisioningu firmy niezgodny z komendą' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF c->>'purpose' IS DISTINCT FROM 'access'
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
    OR c->>'decision_at' IS NULL THEN
    RAISE EXCEPTION 'Brak autoryzowanej komendy dostępu' USING ERRCODE = '42501';
  END IF;
  command := c->'command';
  decision_time := (c->>'decision_at')::timestamptz(3);
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
          AND NEW.valid_until IS NOT DISTINCT FROM (command->>'validUntil')::timestamptz(3))
      ) THEN RAISE EXCEPTION 'Zmiana niezgodna z komendą' USING ERRCODE = '42501'; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF command->>'kind' IS DISTINCT FROM 'grant'
      OR NEW.grant_id::text IS DISTINCT FROM command->>'grantId'
      OR NEW.legal_entity_id::text IS DISTINCT FROM command->>'legalEntityId'
      OR NEW.action IS DISTINCT FROM command->>'action'
      OR NEW.valid_from IS DISTINCT FROM COALESCE((command->>'validFrom')::timestamptz(3), decision_time)
      OR NEW.valid_until IS DISTINCT FROM (command->>'validUntil')::timestamptz(3)
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
CREATE FUNCTION pap_guard_entity_provision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c jsonb := pap_context(); command jsonb; decision_time timestamptz(3);
BEGIN
  IF current_user <> pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN
    RAISE EXCEPTION 'Rejestracja podmiotu prawnego wymaga kontrolowanej funkcji' USING ERRCODE = '42501';
  END IF;
  IF session_user = current_user THEN RETURN NEW; END IF;
  IF c->>'purpose' IS DISTINCT FROM 'provision_company'
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
    OR c->>'decision_at' IS NULL THEN
    RAISE EXCEPTION 'Brak autoryzowanej komendy provisioningu firmy' USING ERRCODE = '42501';
  END IF;
  command := c->'command';
  decision_time := (c->>'decision_at')::timestamptz(3);
  IF command->>'kind' IS DISTINCT FROM 'provision_company'
    OR NEW.tenant_id::text IS DISTINCT FROM c->>'tenant_id'
    OR NOT pap_admin_allowed(NEW.tenant_id) THEN
    RAISE EXCEPTION 'Niepoprawny zakres komendy provisioningu firmy' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'legal_entity' THEN
    IF NEW.id::text IS DISTINCT FROM (command->>'legalEntityId')
      OR NEW.created_at IS DISTINCT FROM decision_time THEN
      RAISE EXCEPTION 'Podmiot prawny niezgodny z komendą provisioningu' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'entity_profile_version' THEN
    IF NEW.legal_entity_id::text IS DISTINCT FROM (command->>'legalEntityId')
      OR NEW.valid_from IS DISTINCT FROM decision_time
      OR NEW.valid_until IS NOT NULL THEN
      RAISE EXCEPTION 'Wersja profilu podmiotu niezgodna z komendą provisioningu' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pap_legal_entity_provision_guard
BEFORE INSERT ON "legal_entity"
FOR EACH ROW EXECUTE FUNCTION pap_guard_entity_provision();
--> statement-breakpoint
CREATE TRIGGER pap_entity_profile_provision_guard
BEFORE INSERT ON "entity_profile_version"
FOR EACH ROW EXECUTE FUNCTION pap_guard_entity_provision();
--> statement-breakpoint
CREATE FUNCTION pap_provision_company() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET timezone = 'UTC' SET datestyle = 'ISO, YMD' AS $$
DECLARE
  c jsonb := pap_context();
  cmd jsonb := c->'command';
  op uuid;
  scope_tenant uuid;
  actor uuid;
  target_entity uuid;
  profile_ver_id uuid;
  decision_time timestamptz(3);
  actor_member tenant_membership%ROWTYPE;
  previous access_management_event%ROWTYPE;
  entity_after legal_entity%ROWTYPE;
  profile_after entity_profile_version%ROWTYPE;
  g_after company_access_grant%ROWTYPE;
  grantee_id uuid;
  grant_action text;
  primary_grant_id uuid;
  effects jsonb := '{}'::jsonb;
  receipt jsonb;
  request_key text;
  display_name_clean text;
  profile_code_clean text;
  nip_clean text;
  merged_profile_json jsonb;
BEGIN
  IF c->>'purpose' IS DISTINCT FROM 'provision_company'
    OR jsonb_typeof(c->'command') IS DISTINCT FROM 'object'
    OR c->>'decision_at' IS NULL
    OR c->>'actor_user_id' IS NULL
    OR c->>'tenant_id' IS NULL
    OR c->>'legal_entity_id' IS NULL
    OR cmd->>'kind' IS DISTINCT FROM 'provision_company'
    OR cmd->>'operationId' IS NULL
    OR cmd->>'tenantId' IS DISTINCT FROM c->>'tenant_id'
    OR cmd->>'userId' IS DISTINCT FROM c->>'actor_user_id'
    OR cmd->>'legalEntityId' IS DISTINCT FROM c->>'legal_entity_id'
  THEN
    RAISE EXCEPTION 'Brak zatwierdzonej komendy provisioningu firmy' USING ERRCODE = '42501';
  END IF;

  op := (cmd->>'operationId')::uuid;
  scope_tenant := (cmd->>'tenantId')::uuid;
  actor := (c->>'actor_user_id')::uuid;
  target_entity := (cmd->>'legalEntityId')::uuid;
  profile_ver_id := COALESCE((cmd->>'profileVersionId')::uuid, gen_random_uuid());
  decision_time := (c->>'decision_at')::timestamptz(3);
  display_name_clean := btrim(COALESCE(cmd->>'displayName', ''));
  profile_code_clean := btrim(COALESCE(cmd->>'profileCode', ''));
  nip_clean := btrim(COALESCE(cmd->>'nip', ''));

  IF op IS NULL OR scope_tenant IS NULL OR actor IS NULL OR target_entity IS NULL
    OR NOT isfinite(decision_time) OR decision_time > clock_timestamp() + interval '5 seconds'
    OR display_name_clean = '' OR profile_code_clean = ''
    OR nip_clean !~ '^[0-9]{10}$'
    OR (cmd->'profileJson' IS NOT NULL AND jsonb_typeof(cmd->'profileJson') IS DISTINCT FROM 'object')
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_command');
  END IF;

  PERFORM 1 FROM tenant WHERE id = scope_tenant FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'membership_unavailable');
  END IF;

  SELECT * INTO actor_member FROM tenant_membership
    WHERE tenant_id = scope_tenant AND user_id = actor FOR SHARE;
  IF NOT FOUND OR actor_member.status <> 'active'
    OR actor_member.valid_from > clock_timestamp()
    OR (actor_member.valid_until IS NOT NULL AND actor_member.valid_until <= clock_timestamp())
  THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'active_membership_required');
  END IF;

  IF actor_member.role NOT IN ('tenant_owner', 'tenant_admin') OR NOT pap_admin_allowed(scope_tenant) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'access_management_denied');
  END IF;

  request_key := cmd::text;
  SELECT * INTO previous FROM access_management_event WHERE operation_id = op;
  IF FOUND THEN
    IF previous.tenant_id <> scope_tenant OR previous.actor_id <> actor
      OR previous.request_key::jsonb IS DISTINCT FROM cmd THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
    END IF;
    RETURN jsonb_build_object('ok', true, 'receipt', previous.receipt);
  END IF;

  IF EXISTS (
    SELECT 1 FROM company_tax_settings
    WHERE tenant_id = scope_tenant
      AND nip = nip_clean
      AND legal_entity_id <> target_entity
  ) OR EXISTS (
    SELECT 1 FROM entity_profile_version
    WHERE tenant_id = scope_tenant
      AND profile_json->>'nip' = nip_clean
      AND legal_entity_id <> target_entity
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_company_nip');
  END IF;

  IF EXISTS (SELECT 1 FROM legal_entity WHERE id = target_entity) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  END IF;

  INSERT INTO legal_entity (id, tenant_id, display_name, created_at)
  VALUES (target_entity, scope_tenant, display_name_clean, decision_time)
  RETURNING * INTO entity_after;

  effects := effects || jsonb_build_object(
    'legal_entity:' || entity_after.id::text,
    jsonb_build_object('table', 'legal_entity', 'operation', 'INSERT', 'old', NULL, 'new', to_jsonb(entity_after))
  );

  merged_profile_json := COALESCE(cmd->'profileJson', '{}'::jsonb) || jsonb_build_object(
    'nip', nip_clean,
    'displayName', display_name_clean
  );

  INSERT INTO entity_profile_version (id, tenant_id, legal_entity_id, profile_code, profile_json, valid_from)
  VALUES (profile_ver_id, scope_tenant, target_entity, profile_code_clean, merged_profile_json, decision_time)
  RETURNING * INTO profile_after;

  effects := effects || jsonb_build_object(
    'entity_profile_version:' || profile_after.id::text,
    jsonb_build_object('table', 'entity_profile_version', 'operation', 'INSERT', 'old', NULL, 'new', to_jsonb(profile_after))
  );

  FOR grantee_id IN
    SELECT m.user_id
    FROM tenant_membership m
    JOIN app_user u ON u.id = m.user_id
    WHERE m.tenant_id = scope_tenant
      AND u.status = 'active'
      AND u.disabled_at IS NULL
      AND m.status = 'active'
      AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
      AND (m.user_id = actor OR m.role = 'tenant_owner')
    ORDER BY m.user_id
  LOOP
    FOREACH grant_action IN ARRAY ARRAY['read', 'write']
    LOOP
      INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from, valid_until)
      VALUES (gen_random_uuid(), scope_tenant, grantee_id, target_entity, grant_action, decision_time, NULL)
      RETURNING * INTO g_after;

      IF grantee_id = actor AND grant_action = 'write' THEN
        primary_grant_id := g_after.grant_id;
      END IF;

      effects := effects || jsonb_build_object(
        'company_access_grant:' || g_after.grant_id::text,
        jsonb_build_object('table', 'company_access_grant', 'operation', 'INSERT', 'old', NULL, 'new', to_jsonb(g_after))
      );
    END LOOP;
  END LOOP;

  receipt := jsonb_build_object(
    'operationId', op,
    'occurredAt', to_char(decision_time, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'changed', true,
    'grantId', primary_grant_id,
    'legalEntityId', target_entity
  );

  INSERT INTO access_management_event
    (operation_id, tenant_id, user_id, actor_id, kind, grant_id, occurred_at, request_key, state_change, receipt)
  VALUES (
    op,
    scope_tenant,
    actor,
    actor,
    'provision_company',
    primary_grant_id,
    decision_time,
    request_key,
    jsonb_build_object('before', 'absent', 'after', 'provisioned', 'revokedGrants', 0, 'effects', effects),
    receipt
  );

  RETURN jsonb_build_object('ok', true, 'receipt', receipt);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION pap_list_actor_accessible_entities() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET timezone = 'UTC' SET datestyle = 'ISO, YMD' AS $$
DECLARE
  c jsonb := pap_context();
  actor uuid;
  filter_tenant uuid;
  memberships_json jsonb;
  grants_json jsonb;
  entities_json jsonb;
BEGIN
  IF c->>'purpose' IS NULL OR c->>'purpose' NOT IN ('actor', 'facts')
    OR c->>'actor_user_id' IS NULL THEN
    RETURN jsonb_build_object('memberships', '[]'::jsonb, 'grants', '[]'::jsonb, 'entities', '[]'::jsonb);
  END IF;

  actor := (c->>'actor_user_id')::uuid;
  IF c->>'tenant_id' IS NOT NULL THEN
    filter_tenant := (c->>'tenant_id')::uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app_user u WHERE u.id = actor AND u.status = 'active' AND u.disabled_at IS NULL
  ) THEN
    RETURN jsonb_build_object('memberships', '[]'::jsonb, 'grants', '[]'::jsonb, 'entities', '[]'::jsonb);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.tenant_id, m.user_id), '[]'::jsonb)
  INTO memberships_json
  FROM tenant_membership m
  WHERE (filter_tenant IS NULL OR m.tenant_id = filter_tenant)
    AND (
      m.user_id = actor
      OR EXISTS (
        SELECT 1 FROM tenant_membership am
        WHERE am.tenant_id = m.tenant_id
          AND am.user_id = actor
          AND am.status = 'active'
          AND am.role IN ('tenant_owner', 'tenant_admin')
          AND am.valid_from <= clock_timestamp()
          AND (am.valid_until IS NULL OR am.valid_until > clock_timestamp())
      )
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.valid_from, g.grant_id), '[]'::jsonb)
  INTO grants_json
  FROM company_access_grant g
  WHERE (filter_tenant IS NULL OR g.tenant_id = filter_tenant)
    AND (
      g.user_id = actor
      OR EXISTS (
        SELECT 1 FROM tenant_membership am
        WHERE am.tenant_id = g.tenant_id
          AND am.user_id = actor
          AND am.status = 'active'
          AND am.role IN ('tenant_owner', 'tenant_admin')
          AND am.valid_from <= clock_timestamp()
          AND (am.valid_until IS NULL OR am.valid_until > clock_timestamp())
      )
    );

  SELECT COALESCE(jsonb_agg(to_jsonb(le) ORDER BY le.created_at, le.id), '[]'::jsonb)
  INTO entities_json
  FROM legal_entity le
  WHERE (filter_tenant IS NULL OR le.tenant_id = filter_tenant)
    AND EXISTS (
      SELECT 1 FROM tenant_membership m
      WHERE m.tenant_id = le.tenant_id
        AND m.user_id = actor
        AND m.status = 'active'
        AND m.valid_from <= clock_timestamp()
        AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
        AND (
          m.role IN ('tenant_owner', 'tenant_admin')
          OR EXISTS (
            SELECT 1 FROM company_access_grant g
            WHERE g.tenant_id = le.tenant_id
              AND g.legal_entity_id = le.id
              AND g.user_id = actor
              AND g.valid_from <= clock_timestamp()
              AND (g.valid_until IS NULL OR g.valid_until > clock_timestamp())
              AND (g.revoked_at IS NULL OR g.revoked_at > clock_timestamp())
          )
        )
    );

  RETURN jsonb_build_object(
    'memberships', memberships_json,
    'grants', grants_json,
    'entities', entities_json
  );
EXCEPTION WHEN invalid_text_representation THEN
  RETURN jsonb_build_object('memberships', '[]'::jsonb, 'grants', '[]'::jsonb, 'entities', '[]'::jsonb);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_require_security_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET timezone = 'UTC' SET datestyle = 'ISO, YMD' AS $$
DECLARE expected_effect jsonb; effect_key text; matched integer;
BEGIN
  IF session_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID))
    THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'company_operation_probe' THEN
    IF NOT EXISTS (SELECT 1 FROM security_decision_event e
      WHERE e.transaction_id = pg_current_xact_id()::text AND e.operation_id = NEW.operation_id
        AND e.tenant_id = NEW.tenant_id AND e.legal_entity_id = NEW.legal_entity_id
        AND e.actor_id = NEW.actor_id AND e.kind = 'company' AND e.action = 'write'
        AND e.decided_at = NEW.created_at AND e.decision = 'allow' AND e.outcome = 'committed')
    THEN RAISE EXCEPTION 'Brak atomowego audytu operacji' USING ERRCODE = '23514'; END IF;
  ELSIF TG_TABLE_NAME = 'access_management_event' THEN
    IF NEW.transaction_id IS DISTINCT FROM pg_current_xact_id()::text
      OR jsonb_typeof(NEW.state_change->'effects') IS DISTINCT FROM 'object'
      OR (NEW.receipt->>'changed')::boolean IS DISTINCT FROM (NEW.state_change->'effects' <> '{}'::jsonb)
      OR NEW.receipt->>'operationId' IS DISTINCT FROM NEW.operation_id::text
      OR NEW.receipt->>'grantId' IS DISTINCT FROM NEW.grant_id::text
      OR (NEW.receipt->>'occurredAt')::timestamptz(3) IS DISTINCT FROM NEW.occurred_at
      OR NEW.request_key::jsonb->>'kind' IS DISTINCT FROM NEW.kind
      OR NEW.request_key::jsonb->>'operationId' IS DISTINCT FROM NEW.operation_id::text
      OR NEW.request_key::jsonb->>'tenantId' IS DISTINCT FROM NEW.tenant_id::text
      OR NEW.request_key::jsonb->>'userId' IS DISTINCT FROM NEW.user_id::text
      OR NOT EXISTS (SELECT 1 FROM security_decision_event e
        WHERE e.transaction_id = NEW.transaction_id AND e.operation_id = NEW.operation_id
          AND e.access_management_operation_id = NEW.operation_id
          AND e.tenant_id = NEW.tenant_id AND e.target_user_id = NEW.user_id AND e.actor_id = NEW.actor_id
          AND e.kind = 'access' AND e.action = NEW.kind AND e.decided_at = NEW.occurred_at
          AND e.decision = 'allow' AND e.outcome = 'committed')
    THEN RAISE EXCEPTION 'Niezgodny receipt lub brak audytu' USING ERRCODE = '23514'; END IF;
  ELSE
    expected_effect := jsonb_build_object('table',TG_TABLE_NAME,'operation',TG_OP,
      'old',CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,'new',to_jsonb(NEW));
    effect_key := CASE TG_TABLE_NAME
      WHEN 'tenant_membership' THEN 'tenant_membership:' || (to_jsonb(NEW)->>'tenant_id') || ':' || (to_jsonb(NEW)->>'user_id')
      WHEN 'legal_entity' THEN 'legal_entity:' || (to_jsonb(NEW)->>'id')
      WHEN 'entity_profile_version' THEN 'entity_profile_version:' || (to_jsonb(NEW)->>'id')
      ELSE 'company_access_grant:' || (to_jsonb(NEW)->>'grant_id') END;
    SELECT count(*) INTO matched FROM access_management_event a
      WHERE a.transaction_id = pg_current_xact_id()::text
        AND a.tenant_id = NEW.tenant_id
        AND (
          a.user_id::text = (to_jsonb(NEW)->>'user_id')
          OR a.kind = 'provision_company'
        )
        AND a.state_change->'effects'->effect_key = expected_effect
        AND EXISTS (SELECT 1 FROM security_decision_event e
          WHERE e.transaction_id = a.transaction_id AND e.operation_id = a.operation_id
            AND e.access_management_operation_id = a.operation_id
            AND e.actor_id = a.actor_id AND e.tenant_id = a.tenant_id AND e.target_user_id = a.user_id
            AND e.kind = 'access' AND e.action = a.kind AND e.decided_at = a.occurred_at
            AND e.decision = 'allow' AND e.outcome = 'committed');
    IF matched <> 1 THEN
      RAISE EXCEPTION 'Brak jednoznacznego audytu rzeczywistego przejścia' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_entity_provision_audit_required
AFTER INSERT ON legal_entity DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_profile_provision_audit_required
AFTER INSERT ON entity_profile_version DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER entity_profile_version_audit_required
AFTER UPDATE ON entity_profile_version DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_accounting_write_audit();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_check_committed_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.outcome <> 'committed' THEN RETURN NULL; END IF;
  IF NEW.kind = 'access' AND NOT EXISTS (SELECT 1 FROM access_management_event a
    WHERE a.operation_id = NEW.operation_id AND a.operation_id = NEW.access_management_operation_id
      AND a.tenant_id = NEW.tenant_id AND a.user_id = NEW.target_user_id
      AND a.actor_id = NEW.actor_id AND a.kind = NEW.action
      AND NEW.legal_entity_id IS NOT DISTINCT FROM CASE a.kind
        WHEN 'grant' THEN (a.request_key::jsonb->>'legalEntityId')::uuid
        WHEN 'provision_company' THEN (a.request_key::jsonb->>'legalEntityId')::uuid
        WHEN 'revoke_grant' THEN (SELECT g.legal_entity_id FROM company_access_grant g
          WHERE g.grant_id = a.grant_id AND g.tenant_id = a.tenant_id AND g.user_id = a.user_id)
        ELSE NULL::uuid END) THEN
    RAISE EXCEPTION 'Audyt nie odpowiada operacji dostępu' USING ERRCODE = '23514';
  END IF;
  IF NEW.kind = 'company' AND NEW.action = 'write' AND NOT EXISTS (SELECT 1 FROM company_operation_probe p
    WHERE p.operation_id = NEW.operation_id AND p.tenant_id = NEW.tenant_id
      AND p.legal_entity_id = NEW.legal_entity_id AND p.actor_id = NEW.actor_id) THEN
    RAISE EXCEPTION 'Audyt nie odpowiada operacji firmowej' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER POLICY pap_access_event_read ON access_management_event USING (
  pap_context()->>'purpose' IN ('facts','access','provision_company')
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND user_id::text = pap_context()->>'target_user_id'
  AND operation_id::text = pap_context()->'command'->>'operationId'
  AND request_key::jsonb = pap_context()->'command'
  AND pap_admin_allowed(tenant_id));
--> statement-breakpoint
CREATE POLICY pap_entity_provision_insert ON legal_entity FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'provision_company'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND id::text = pap_context()->>'legal_entity_id'
  AND pap_admin_allowed(tenant_id)
);
--> statement-breakpoint
CREATE POLICY pap_profile_provision_insert ON entity_profile_version FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'provision_company'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND pap_admin_allowed(tenant_id)
);
--> statement-breakpoint
CREATE POLICY pap_profile_company_update ON entity_profile_version FOR UPDATE USING (
  pap_context()->>'purpose' = 'company'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
) WITH CHECK (
  pap_context()->>'purpose' = 'company'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND pap_company_allowed(tenant_id, legal_entity_id, 'write')
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_guard_mcp_prepared_proposal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'rejected', 'expired') AND (
    NEW IS DISTINCT FROM OLD
    OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
  ) THEN
    RAISE EXCEPTION 'Propozycja MCP w stanie terminalnym jest niezmienna' USING ERRCODE = '23514';
  END IF;

  IF (NEW.invoice_json - '_papChallenge') IS DISTINCT FROM (OLD.invoice_json - '_papChallenge') THEN
    RAISE EXCEPTION 'Ładunek i metadane przygotowanej propozycji MCP są niezmienne' USING ERRCODE = '23514';
  END IF;

  IF (to_jsonb(NEW) - 'status' - 'confirmed_by' - 'confirmed_at' - 'ledger_entry_id' - 'confirmation_challenge_hash' - 'invoice_json')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'confirmed_by' - 'confirmed_at' - 'ledger_entry_id' - 'confirmation_challenge_hash' - 'invoice_json')
  THEN
    RAISE EXCEPTION 'Ładunek i metadane przygotowanej propozycji MCP są niezmienne' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE signature text; data_schema text := current_schema();
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'pap_admin_allowed(uuid)',
    'pap_guard_access_write()',
    'pap_guard_entity_provision()',
    'pap_provision_company()',
    'pap_list_actor_accessible_entities()',
    'pap_require_security_audit()',
    'pap_check_committed_decision()',
    'pap_guard_mcp_prepared_proposal()'
  ]
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', signature, data_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', signature);
  END LOOP;
END;
$$;
--> statement-breakpoint
RESET lock_timeout;
--> statement-breakpoint
RESET statement_timeout;
