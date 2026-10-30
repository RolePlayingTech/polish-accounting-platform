-- Security Foundation 6D-3: addytywna integracja SEC-01/02/03.
-- Wymaga oryginalnych 0000-0005 z #31; nie stosować do zmienionych fixture #35/#36/#37.
-- Migrator/właściciel i ręczny provisioning ACL; brak deployu i danych rzeczywistych.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '30s';
--> statement-breakpoint
LOCK TABLE tenant_membership, company_access_grant, access_management_event, company_operation_probe, security_decision_event IN ACCESS EXCLUSIVE MODE;
--> statement-breakpoint
-- Nie przenosimy własności definerów ani polityki migratora na innego operatora.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = current_schema()::regnamespace
    AND relname IN ('tenant_membership','company_access_grant','access_management_event',
      'company_operation_probe','security_decision_event') AND relowner <> current_user::regrole)
  THEN RAISE EXCEPTION 'Migracja wymaga dotychczasowego właściciela tabel'; END IF;
END;
$$;
--> statement-breakpoint
-- SEC-05: helper sprawdza tylko podpisany tenant i właściwą fazę administracyjną.
CREATE OR REPLACE FUNCTION pap_admin_allowed(scope_tenant uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE c jsonb := pap_context();
BEGIN
  IF c->>'purpose' IS NULL OR c->>'purpose' NOT IN ('facts','access')
    OR c->>'tenant_id' IS DISTINCT FROM scope_tenant::text
    OR c->'command' IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM tenant_membership m JOIN app_user u ON u.id = m.user_id
    WHERE m.tenant_id = scope_tenant AND m.user_id::text = c->>'actor_user_id'
      AND u.status = 'active' AND u.disabled_at IS NULL
      AND m.status = 'active' AND m.role IN ('tenant_owner','tenant_admin')
      AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp()));
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_company_allowed(scope_tenant uuid, scope_entity uuid, scope_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE c jsonb := pap_context();
BEGIN
  IF c->>'purpose' IS NULL OR c->>'purpose' NOT IN ('facts','company')
    OR c->>'tenant_id' IS DISTINCT FROM scope_tenant::text
    OR c->>'legal_entity_id' IS DISTINCT FROM scope_entity::text
    OR c->>'action' IS DISTINCT FROM scope_action
    OR c->'command' IS NOT NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM tenant_membership m
    JOIN app_user u ON u.id = m.user_id
    JOIN company_access_grant g ON g.tenant_id = m.tenant_id AND g.user_id = m.user_id
    WHERE m.tenant_id = scope_tenant AND m.user_id::text = c->>'actor_user_id'
      AND u.status = 'active' AND u.disabled_at IS NULL
      AND m.status = 'active' AND m.valid_from <= clock_timestamp()
      AND (m.valid_until IS NULL OR m.valid_until > clock_timestamp())
      AND g.legal_entity_id = scope_entity AND g.action = scope_action
      AND g.valid_from <= clock_timestamp()
      AND (g.valid_until IS NULL OR g.valid_until > clock_timestamp())
      AND (g.revoked_at IS NULL OR g.revoked_at > clock_timestamp()));
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pap_guard_access_write() RETURNS trigger LANGUAGE plpgsql AS $$
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
ALTER POLICY pap_probe_insert ON company_operation_probe WITH CHECK (
  pap_context()->>'purpose' = 'company' AND pap_context()->>'action' = 'write'
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND legal_entity_id::text = pap_context()->>'legal_entity_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND operation_id::text = pap_context()->>'operation_id'
  AND created_at = (pap_context()->>'decision_at')::timestamptz
  AND pap_company_allowed(tenant_id, legal_entity_id, 'write'));
--> statement-breakpoint
-- NULL oznacza historyczny receipt sprzed tego protokołu. Nie przypisujemy mu TX migracji.
ALTER TABLE access_management_event ADD COLUMN transaction_id text;
--> statement-breakpoint
ALTER TABLE access_management_event ALTER COLUMN transaction_id SET DEFAULT pg_current_xact_id()::text;
--> statement-breakpoint
CREATE INDEX access_management_event_transaction_idx ON access_management_event (transaction_id,tenant_id,user_id);
--> statement-breakpoint
-- Jedyna ścieżka mutacji dostępu. Decyzja/delegacja pozostaje we wspólnym core TS;
-- funkcja interpretuje dokładną podpisaną komendę i sama tworzy dowód jej efektów.
-- Brak argumentów SQL, dynamicznego SQL i możliwości przekazania receipt przez runtime.
CREATE FUNCTION pap_execute_access() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET timezone = 'UTC' SET datestyle = 'ISO, YMD' AS $$
DECLARE
  c jsonb := pap_context(); cmd jsonb := c->'command';
  op uuid; scope_tenant uuid; target_user uuid; actor uuid; decision_time timestamptz;
  member tenant_membership%ROWTYPE; member_after tenant_membership%ROWTYPE;
  g company_access_grant%ROWTYPE; g_after company_access_grant%ROWTYPE;
  previous access_management_event%ROWTYPE;
  result_grant uuid; from_time timestamptz; until_time timestamptz;
  before_state text; after_state text; changed boolean := false; revoked_count integer := 0;
  effects jsonb := '{}'::jsonb; receipt jsonb; request_key text;
BEGIN
  IF c->>'purpose' IS DISTINCT FROM 'access' OR cmd IS NULL
    OR c->>'decision_at' IS NULL OR c->>'actor_user_id' IS NULL
    OR cmd->>'tenantId' IS DISTINCT FROM c->>'tenant_id'
    OR cmd->>'userId' IS DISTINCT FROM c->>'target_user_id'
    OR cmd->>'kind' IS NULL
    OR cmd->>'kind' NOT IN ('grant','revoke_grant','revoke_membership','reactivate_membership')
    OR cmd->>'operationId' IS NULL THEN
    RAISE EXCEPTION 'Brak zatwierdzonej komendy' USING ERRCODE = '42501';
  END IF;
  op := (cmd->>'operationId')::uuid; scope_tenant := (cmd->>'tenantId')::uuid;
  target_user := (cmd->>'userId')::uuid; actor := (c->>'actor_user_id')::uuid;
  decision_time := (c->>'decision_at')::timestamptz;
  IF NOT isfinite(decision_time) OR decision_time > clock_timestamp()
    OR actor = target_user OR NOT pap_admin_allowed(scope_tenant) THEN
    RAISE EXCEPTION 'Niepoprawna decyzja dostępu' USING ERRCODE = '42501';
  END IF;
  -- UoW już trzyma tę blokadę w kanonicznym porządku. Funkcja jej nie zwalnia.
  SELECT * INTO member FROM tenant_membership
    WHERE tenant_id = scope_tenant AND user_id = target_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','membership_unavailable'); END IF;
  request_key := cmd::text;
  SELECT * INTO previous FROM access_management_event WHERE operation_id = op;
  IF FOUND THEN
    IF previous.tenant_id <> scope_tenant OR previous.user_id <> target_user
      OR previous.actor_id <> actor OR previous.request_key::jsonb IS DISTINCT FROM cmd THEN
      RETURN jsonb_build_object('ok',false,'reason','operation_conflict');
    END IF;
    -- Historyczny receipt NIE daje prawa do DML, także po zmianie fazy lub w savepoincie.
    RETURN jsonb_build_object('ok',true,'receipt',previous.receipt);
  END IF;
  before_state := member.status; after_state := member.status;
  IF cmd->>'kind' IN ('revoke_membership','reactivate_membership') THEN
    IF cmd->>'kind' = 'reactivate_membership' THEN
      IF member.status <> 'revoked' THEN
        RETURN jsonb_build_object('ok',false,'reason','membership_not_revoked');
      END IF;
      until_time := (cmd->>'validUntil')::timestamptz;
      IF until_time IS NOT NULL AND (NOT isfinite(until_time) OR until_time <= decision_time) THEN
        RETURN jsonb_build_object('ok',false,'reason','invalid_command');
      END IF;
    END IF;
    -- Obejmuje również granty przyszłe i przyszłe cofnięcia; wcześniejsze cofnięcie zachowujemy.
    FOR g IN SELECT * FROM company_access_grant
      WHERE tenant_id = scope_tenant AND user_id = target_user
        AND (revoked_at IS NULL OR revoked_at > decision_time)
      ORDER BY grant_id FOR UPDATE
    LOOP
      UPDATE company_access_grant SET revoked_at = decision_time WHERE grant_id = g.grant_id
        RETURNING * INTO g_after;
      effects := effects || jsonb_build_object('company_access_grant:' || g.grant_id,
        jsonb_build_object('table','company_access_grant',
          'operation','UPDATE','old',to_jsonb(g),'new',to_jsonb(g_after)));
      revoked_count := revoked_count + 1;
    END LOOP;
    IF cmd->>'kind' = 'revoke_membership' THEN
      after_state := 'revoked';
      IF member.status <> 'revoked' THEN
        UPDATE tenant_membership SET status = 'revoked'
          WHERE tenant_id = scope_tenant AND user_id = target_user RETURNING * INTO member_after;
      END IF;
    ELSE
      after_state := 'active';
      UPDATE tenant_membership SET status = 'active', valid_from = decision_time, valid_until = until_time
        WHERE tenant_id = scope_tenant AND user_id = target_user RETURNING * INTO member_after;
    END IF;
    IF member_after.user_id IS NOT NULL THEN
      effects := effects || jsonb_build_object('tenant_membership:' || scope_tenant || ':' || target_user,
        jsonb_build_object('table','tenant_membership',
          'operation','UPDATE','old',to_jsonb(member),'new',to_jsonb(member_after)));
    END IF;
    changed := effects <> '{}'::jsonb;
  ELSIF cmd->>'kind' = 'grant' THEN
    IF member.status <> 'active' OR member.valid_from > decision_time
      OR (member.valid_until IS NOT NULL AND member.valid_until <= decision_time) THEN
      RETURN jsonb_build_object('ok',false,'reason','membership_inactive');
    END IF;
    from_time := COALESCE((cmd->>'validFrom')::timestamptz, decision_time);
    until_time := (cmd->>'validUntil')::timestamptz;
    IF NOT isfinite(from_time) OR from_time < decision_time
      OR (until_time IS NOT NULL AND (NOT isfinite(until_time) OR until_time <= from_time)) THEN
      RETURN jsonb_build_object('ok',false,'reason','invalid_command');
    END IF;
    IF cmd->>'legalEntityId' IS DISTINCT FROM c->>'legal_entity_id'
      OR cmd->>'action' IS NULL OR cmd->>'action' NOT IN ('read','write') THEN
      RAISE EXCEPTION 'Niepoprawny zakres grantu' USING ERRCODE = '42501';
    END IF;
    PERFORM 1 FROM legal_entity WHERE tenant_id = scope_tenant
      AND id = (cmd->>'legalEntityId')::uuid FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','grant_unavailable'); END IF;
    SELECT * INTO g FROM company_access_grant
      WHERE tenant_id = scope_tenant AND user_id = target_user
        AND legal_entity_id = (cmd->>'legalEntityId')::uuid AND action = cmd->>'action'
        AND revoked_at IS NULL AND valid_until IS NOT DISTINCT FROM until_time
        AND ((cmd->>'validFrom' IS NULL AND valid_from <= decision_time)
          OR (cmd->>'validFrom' IS NOT NULL AND valid_from = from_time))
      ORDER BY grant_id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      result_grant := g.grant_id; before_state := 'granted'; after_state := 'granted';
    ELSE
      IF EXISTS (SELECT 1 FROM company_access_grant WHERE grant_id = (cmd->>'grantId')::uuid) THEN
        RETURN jsonb_build_object('ok',false,'reason','operation_conflict');
      END IF;
      INSERT INTO company_access_grant (grant_id,tenant_id,user_id,legal_entity_id,action,valid_from,valid_until)
        VALUES ((cmd->>'grantId')::uuid,scope_tenant,target_user,(cmd->>'legalEntityId')::uuid,
          cmd->>'action',from_time,until_time) RETURNING * INTO g_after;
      result_grant := g_after.grant_id; before_state := 'absent'; after_state := 'granted'; changed := true;
      effects := jsonb_build_object('company_access_grant:' || g_after.grant_id,
        jsonb_build_object('table','company_access_grant',
          'operation','INSERT','old',NULL,'new',to_jsonb(g_after)));
    END IF;
  ELSE
    SELECT * INTO g FROM company_access_grant WHERE tenant_id = scope_tenant
      AND user_id = target_user AND grant_id = (cmd->>'grantId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','grant_unavailable'); END IF;
    result_grant := g.grant_id;
    before_state := COALESCE(to_char(g.revoked_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'not_revoked');
    after_state := to_char(LEAST(g.revoked_at,decision_time),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    IF g.revoked_at IS NULL OR g.revoked_at > decision_time THEN
      UPDATE company_access_grant SET revoked_at = decision_time WHERE grant_id = g.grant_id
        RETURNING * INTO g_after;
      changed := true; revoked_count := 1;
      effects := jsonb_build_object('company_access_grant:' || g.grant_id,
        jsonb_build_object('table','company_access_grant',
          'operation','UPDATE','old',to_jsonb(g),'new',to_jsonb(g_after)));
    END IF;
  END IF;
  receipt := jsonb_build_object('operationId',op,'occurredAt',
    to_char(decision_time,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'changed',changed,'grantId',result_grant);
  INSERT INTO access_management_event
    (operation_id,tenant_id,user_id,actor_id,kind,grant_id,occurred_at,request_key,state_change,receipt)
    VALUES (op,scope_tenant,target_user,actor,cmd->>'kind',result_grant,decision_time,request_key,
      jsonb_build_object('before',before_state,'after',after_state,'revokedGrants',revoked_count,
        'effects',effects),receipt);
  RETURN jsonb_build_object('ok',true,'receipt',receipt);
END;
$$;
--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE security_decision_event DROP CONSTRAINT security_decision_codes_check;
--> statement-breakpoint
-- NOT VALID zachowuje niezmieniony historyczny audyt dopuszczony przez 0005
-- (np. dawny write bez operation_id). Nowe INSERT-y zawsze podlegają nowemu CHECK.
ALTER TABLE security_decision_event ADD CONSTRAINT security_decision_codes_check CHECK (
  decision IN ('allow','deny')
  AND kind IN ('company','access','preflight','transport')
  AND action IN ('read','write','revoke_membership','reactivate_membership','grant','revoke_grant','unknown')
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
      OR (NEW.receipt->>'occurredAt')::timestamptz IS DISTINCT FROM NEW.occurred_at
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
      WHEN 'tenant_membership' THEN 'tenant_membership:' || NEW.tenant_id || ':' || NEW.user_id
      ELSE 'company_access_grant:' || (to_jsonb(NEW)->>'grant_id') END;
    SELECT count(*) INTO matched FROM access_management_event a
      WHERE a.transaction_id = pg_current_xact_id()::text
        AND a.tenant_id = NEW.tenant_id AND a.user_id = NEW.user_id
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
-- Receipt tworzy wyłącznie kontrolowany executor jako właściciel. Brak runtime INSERT,
-- także pod zachowaną asercją access_event ze starszej wersji aplikacji.
DROP POLICY pap_access_event_insert ON access_management_event;
--> statement-breakpoint
DROP POLICY pap_grant_insert ON company_access_grant;
--> statement-breakpoint
ALTER POLICY pap_membership_update ON tenant_membership WITH CHECK (false);
--> statement-breakpoint
ALTER POLICY pap_grant_update ON company_access_grant WITH CHECK (false);
--> statement-breakpoint
-- Odczyt własnego, dokładnego receipt w facts służy tylko rozpoznaniu retry.
-- Nie rozszerza prawa DML ani nie zastępuje ponownej domenowej autoryzacji aktora.
ALTER POLICY pap_access_event_read ON access_management_event USING (
  pap_context()->>'purpose' IN ('facts','access')
  AND tenant_id::text = pap_context()->>'tenant_id'
  AND actor_id::text = pap_context()->>'actor_user_id'
  AND user_id::text = pap_context()->>'target_user_id'
  AND operation_id::text = pap_context()->'command'->>'operationId'
  AND request_key::jsonb = pap_context()->'command'
  AND pap_admin_allowed(tenant_id));
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_access_receipt_audit_required
AFTER INSERT ON access_management_event DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
-- Audyt retry może odwołać się do historii, ale musi opisywać dokładnie tę samą operację.
CREATE FUNCTION pap_check_committed_decision() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.outcome <> 'committed' THEN RETURN NULL; END IF;
  IF NEW.kind = 'access' AND NOT EXISTS (SELECT 1 FROM access_management_event a
    WHERE a.operation_id = NEW.operation_id AND a.operation_id = NEW.access_management_operation_id
      AND a.tenant_id = NEW.tenant_id AND a.user_id = NEW.target_user_id
      AND a.actor_id = NEW.actor_id AND a.kind = NEW.action
      AND NEW.legal_entity_id IS NOT DISTINCT FROM CASE a.kind
        WHEN 'grant' THEN (a.request_key::jsonb->>'legalEntityId')::uuid
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
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION pap_check_committed_decision() SET search_path = pg_catalog, %I, pg_temp', current_schema());
  REVOKE ALL ON FUNCTION pap_check_committed_decision() FROM PUBLIC;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_committed_decision_consistent
AFTER INSERT ON security_decision_event DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_check_committed_decision();
--> statement-breakpoint
-- Faza firmowa nie ujawnia nawet własnych grantów do innej firmy.
-- Administracyjne facts potrzebują pełnego zakresu delegacji aktora.
DROP POLICY pap_grant_read ON company_access_grant;
--> statement-breakpoint
CREATE POLICY pap_grant_read ON company_access_grant FOR SELECT USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    (user_id::text = pap_context()->>'actor_user_id' AND (
      (pap_context()->'command' IS NOT NULL AND pap_admin_allowed(tenant_id))
      OR (pap_context()->>'purpose' IN ('facts','company')
        AND legal_entity_id::text = pap_context()->>'legal_entity_id'
        AND action = pap_context()->>'action')))
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id))));
--> statement-breakpoint
-- Marker zgodności aplikacji/SQL; uprawnienie runtime wymaga nowego provisioningu.
CREATE FUNCTION pap_security_protocol_version() RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 60301 $$;
--> statement-breakpoint
DO $$
DECLARE signature text; data_schema text := current_schema();
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'pap_execute_access()', 'pap_guard_access_write()',
    'revoke_grants_on_membership_transition()', 'pap_require_security_audit()',
    'pap_check_committed_decision()', 'pap_security_protocol_version()',
    'pap_admin_allowed(uuid)', 'pap_company_allowed(uuid,uuid,text)']
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', signature, data_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', signature);
  END LOOP;
END;
$$;
