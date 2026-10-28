CREATE TABLE "access_management_event" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"grant_id" uuid,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"request_key" text NOT NULL,
	"state_change" jsonb NOT NULL,
	"receipt" jsonb NOT NULL,
	CONSTRAINT "access_management_event_kind_check" CHECK ("access_management_event"."kind" IN ('revoke_membership', 'reactivate_membership', 'grant', 'revoke_grant')),
	CONSTRAINT "access_management_event_time_check" CHECK (isfinite("access_management_event"."occurred_at"))
);
--> statement-breakpoint
CREATE INDEX "access_management_event_target_idx" ON "access_management_event" USING btree ("tenant_id","user_id","occurred_at");
--> statement-breakpoint
-- Defense in depth: cofnięcia nie wolno wyczyścić ani przesunąć w przyszłość.
-- Nie jest to zamiennik ograniczonej roli runtime ani autoryzacji mutacji.
CREATE FUNCTION protect_grant_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.revoked_at IS NULL OR NEW.revoked_at > OLD.revoked_at) THEN
    RAISE EXCEPTION 'Nie można przywrócić historycznego grantu' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER company_access_grant_revocation_guard
BEFORE UPDATE ON company_access_grant FOR EACH ROW EXECUTE FUNCTION protect_grant_revocation();
--> statement-breakpoint
-- Także zwykły UPDATE statusu nie może odnowić starych grantów.
-- UPDATE członkostwa posiada już blokadę wiersza; kolejność pozostaje członkostwo → granty.
CREATE FUNCTION revoke_grants_on_membership_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revoked_time timestamptz := date_trunc('milliseconds', clock_timestamp());
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      revoked_time := LEAST(revoked_time, NEW.valid_from);
    END IF;
    UPDATE company_access_grant SET revoked_at = revoked_time
      WHERE tenant_id = OLD.tenant_id AND user_id = OLD.user_id
        AND (revoked_at IS NULL OR revoked_at > revoked_time);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tenant_membership_transition_guard
AFTER UPDATE OF status ON tenant_membership FOR EACH ROW EXECUTE FUNCTION revoke_grants_on_membership_transition();
--> statement-breakpoint
CREATE FUNCTION protect_access_management_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rejestr dostępu jest append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER access_management_event_append_only
BEFORE UPDATE OR DELETE ON access_management_event FOR EACH ROW EXECUTE FUNCTION protect_access_management_event();
