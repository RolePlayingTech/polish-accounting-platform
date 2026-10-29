CREATE TABLE "security_decision_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"operation_id" uuid,
	"access_management_operation_id" uuid,
	"actor_id" uuid,
	"target_user_id" uuid,
	"tenant_id" uuid,
	"legal_entity_id" uuid,
	"action" text NOT NULL,
	"kind" text NOT NULL,
	"decision" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"decided_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	"transaction_id" text DEFAULT pg_current_xact_id()::text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "security_decision_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "security_decision_event" ADD CONSTRAINT "security_decision_event_access_management_operation_id_access_management_event_operation_id_fk" FOREIGN KEY ("access_management_operation_id") REFERENCES "access_management_event"("operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "security_decision_request_idx" ON "security_decision_event" USING btree ("request_id","recorded_at");--> statement-breakpoint
CREATE INDEX "security_decision_scope_idx" ON "security_decision_event" USING btree ("tenant_id","legal_entity_id","recorded_at");--> statement-breakpoint
CREATE INDEX "security_decision_transaction_idx" ON "security_decision_event" USING btree ("transaction_id");
--> statement-breakpoint
ALTER TABLE security_decision_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Porównanie wszystkich 32 bajtów MAC bez wcześniejszego zakończenia na różnicy.
CREATE OR REPLACE FUNCTION pap_context() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER VOLATILE AS $$
DECLARE
  payload text := current_setting('pap.context', true);
  signature text := current_setting('pap.context_signature', true);
  claims jsonb; secret text; expected bytea; supplied bytea;
  difference integer := 0; byte_index integer;
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
    OR NOT ((claims->>'expires')::numeric > now_ms AND (claims->>'expires')::numeric <= now_ms + 60000)
  THEN RETURN NULL; END IF;
  SELECT k.secret_hex INTO secret FROM security_context_key k
    WHERE k.key_id = claims->>'key_id' AND k.enabled AND k.runtime_role = session_user::text;
  IF secret IS NULL THEN RETURN NULL; END IF;
  expected := hmac(convert_to(payload, 'UTF8'), decode(secret, 'hex'), 'sha256');
  supplied := decode(signature, 'hex');
  FOR byte_index IN 0..31 LOOP
    difference := difference | (get_byte(expected, byte_index) # get_byte(supplied, byte_index));
  END LOOP;
  IF difference <> 0 THEN RETURN NULL; END IF;
  RETURN claims;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;
--> statement-breakpoint
ALTER TABLE security_decision_event ADD CONSTRAINT security_decision_codes_check CHECK (
  decision IN ('allow','deny')
  AND kind IN ('company','access','preflight','transport')
  AND action IN ('read','write','revoke_membership','reactivate_membership','grant','revoke_grant','unknown')
  AND outcome IN ('committed','denied','rolled_back','preflight')
  AND (decision <> 'deny' OR outcome = 'denied')
  AND reason IN ('explicit_company_grant','authorized_tenant_administration','authentication_failed',
    'authorization_context_invalid','active_membership_required','explicit_company_grant_required',
    'identity_not_provisioned_or_disabled','authorization_data_unavailable','access_management_denied',
    'invalid_command','membership_unavailable','membership_inactive','membership_not_revoked',
    'grant_unavailable','operation_conflict','access_management_unavailable',
    'authorization_audit_unavailable','transport_rejected','operation_failed')
  AND isfinite(decided_at)
  AND (outcome <> 'committed' OR (decision = 'allow' AND actor_id IS NOT NULL AND tenant_id IS NOT NULL))
  AND (kind <> 'access' OR outcome <> 'committed' OR access_management_operation_id IS NOT NULL)
);
--> statement-breakpoint
CREATE FUNCTION pap_stamp_security_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_at := date_trunc('milliseconds', clock_timestamp());
  NEW.transaction_id := pg_current_xact_id()::text;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER pap_security_event_stamp BEFORE INSERT ON security_decision_event
FOR EACH ROW EXECUTE FUNCTION pap_stamp_security_event();
--> statement-breakpoint
CREATE TRIGGER pap_security_event_append_only BEFORE UPDATE OR DELETE ON security_decision_event
FOR EACH ROW EXECUTE FUNCTION protect_access_management_event();
--> statement-breakpoint
-- Kontrola na COMMIT nie zależy od bieżącej fazy GUC, tylko od rzeczywistej TX i wpisu audytu.
CREATE FUNCTION pap_require_security_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF session_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID))
    THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'company_operation_probe' THEN
    IF NOT EXISTS (SELECT 1 FROM security_decision_event e
      WHERE e.transaction_id = pg_current_xact_id()::text
        AND e.tenant_id = NEW.tenant_id AND e.legal_entity_id = NEW.legal_entity_id
        AND e.actor_id = NEW.actor_id AND e.kind = 'company' AND e.action = 'write'
        AND e.decision = 'allow' AND e.outcome = 'committed')
    THEN RAISE EXCEPTION 'Brak atomowego audytu operacji' USING ERRCODE = '23514'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM security_decision_event e JOIN access_management_event a
      ON a.operation_id = e.access_management_operation_id
      WHERE e.transaction_id = pg_current_xact_id()::text AND e.tenant_id = NEW.tenant_id
        AND e.target_user_id = NEW.user_id AND e.actor_id = a.actor_id
        AND a.tenant_id = NEW.tenant_id AND a.user_id = NEW.user_id
        AND e.kind = 'access' AND e.decision = 'allow' AND e.outcome = 'committed')
    THEN RAISE EXCEPTION 'Brak atomowego audytu zmiany dostępu' USING ERRCODE = '23514'; END IF;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_membership_audit_required
AFTER UPDATE ON tenant_membership DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_grant_audit_required
AFTER INSERT OR UPDATE ON company_access_grant DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pap_probe_audit_required
AFTER INSERT ON company_operation_probe DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pap_require_security_audit();
--> statement-breakpoint
DO $$
DECLARE signature text; data_schema text := current_schema();
BEGIN
  EXECUTE format('CREATE POLICY pap_migrator ON security_decision_event FOR ALL TO PUBLIC USING (current_user = %L) WITH CHECK (current_user = %L)', current_user, current_user);
  FOREACH signature IN ARRAY ARRAY['pap_context()', 'pap_stamp_security_event()', 'pap_require_security_audit()']
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, %I, pg_temp', signature, data_schema);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', signature);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE POLICY pap_security_event_insert ON security_decision_event FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'audit'
  AND (to_jsonb(security_decision_event) - ARRAY['decided_at','recorded_at','transaction_id'])
    = ((pap_context()->'audit_event') - 'decided_at')
  AND decided_at = (pap_context()->'audit_event'->>'decided_at')::timestamptz
);
--> statement-breakpoint
-- Komenda operacji nie daje prawa sfałszowania jej potwierdzenia i state_change.
DROP POLICY pap_access_event_insert ON access_management_event;
--> statement-breakpoint
CREATE POLICY pap_access_event_insert ON access_management_event FOR INSERT WITH CHECK (
  pap_context()->>'purpose' = 'access_event'
  AND (to_jsonb(access_management_event) - 'occurred_at')
    = ((pap_context()->'access_event') - 'occurred_at')
  AND occurred_at = (pap_context()->'access_event'->>'occurred_at')::timestamptz
);
--> statement-breakpoint
-- Faza firmowa nie ujawnia nawet własnych grantów do innej firmy.
-- Administracyjne facts potrzebują pełnego zakresu delegacji aktora.
DROP POLICY pap_grant_read ON company_access_grant;
--> statement-breakpoint
CREATE POLICY pap_grant_read ON company_access_grant FOR SELECT USING (
  tenant_id::text = pap_context()->>'tenant_id' AND (
    (user_id::text = pap_context()->>'actor_user_id' AND (
      pap_context()->'command' IS NOT NULL
      OR legal_entity_id::text = pap_context()->>'legal_entity_id'))
    OR (user_id::text = pap_context()->>'target_user_id' AND pap_admin_allowed(tenant_id))));
