CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp (3) with time zone,
	CONSTRAINT "app_user_status_check" CHECK ("app_user"."status" IN ('active', 'disabled')),
	CONSTRAINT "app_user_created_at_check" CHECK (isfinite("app_user"."created_at")),
	CONSTRAINT "app_user_disabled_state_check" CHECK (("app_user"."status" = 'active' AND "app_user"."disabled_at" IS NULL) OR ("app_user"."status" = 'disabled' AND "app_user"."disabled_at" IS NOT NULL AND isfinite("app_user"."disabled_at") AND "app_user"."disabled_at" >= "app_user"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "user_oidc_identity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"linked_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	CONSTRAINT "user_oidc_identity_issuer_subject_unique" UNIQUE("issuer","subject"),
	CONSTRAINT "user_oidc_identity_issuer_check" CHECK (btrim("user_oidc_identity"."issuer") <> '' AND "user_oidc_identity"."issuer" = btrim("user_oidc_identity"."issuer")),
	CONSTRAINT "user_oidc_identity_subject_check" CHECK (btrim("user_oidc_identity"."subject") <> '' AND "user_oidc_identity"."subject" = btrim("user_oidc_identity"."subject")),
	CONSTRAINT "user_oidc_identity_status_check" CHECK ("user_oidc_identity"."status" IN ('active', 'revoked')),
	CONSTRAINT "user_oidc_identity_linked_at_check" CHECK (isfinite("user_oidc_identity"."linked_at")),
	CONSTRAINT "user_oidc_identity_revoked_state_check" CHECK (("user_oidc_identity"."status" = 'active' AND "user_oidc_identity"."revoked_at" IS NULL) OR ("user_oidc_identity"."status" = 'revoked' AND "user_oidc_identity"."revoked_at" IS NOT NULL AND isfinite("user_oidc_identity"."revoked_at") AND "user_oidc_identity"."revoked_at" >= "user_oidc_identity"."linked_at"))
);
--> statement-breakpoint
ALTER TABLE "user_oidc_identity" ADD CONSTRAINT "user_oidc_identity_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "user_oidc_identity_user_idx" ON "user_oidc_identity" USING btree ("user_id");
--> statement-breakpoint
-- Defense in depth: powiązanie (user_id, issuer, subject) jest niezmienne po utworzeniu,
-- a cofniętego powiązania OIDC nie wolno ponownie aktywować ani przesunąć revoked_at w przyszłość.
CREATE FUNCTION protect_user_oidc_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR
     NEW.user_id IS DISTINCT FROM OLD.user_id OR
     NEW.issuer IS DISTINCT FROM OLD.issuer OR
     NEW.subject IS DISTINCT FROM OLD.subject OR
     NEW.linked_at IS DISTINCT FROM OLD.linked_at THEN
    RAISE EXCEPTION 'Nie można zmienić klucza ani właściciela powiązania tożsamości OIDC' USING ERRCODE = '23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.status <> 'revoked' OR NEW.revoked_at IS NULL OR NEW.revoked_at > OLD.revoked_at) THEN
    RAISE EXCEPTION 'Nie można przywrócić cofniętego powiązania tożsamości OIDC' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER user_oidc_identity_immutability_guard
BEFORE UPDATE ON user_oidc_identity FOR EACH ROW EXECUTE FUNCTION protect_user_oidc_identity();
--> statement-breakpoint
-- Wyłączenie konta użytkownika trwale odwołuje wszystkie jego aktywne powiązania OIDC w tej samej transakcji.
CREATE FUNCTION revoke_oidc_identities_on_user_disable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revoked_time timestamptz := GREATEST(date_trunc('milliseconds', clock_timestamp()), COALESCE(NEW.disabled_at, date_trunc('milliseconds', clock_timestamp())));
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Nie można zmienić identyfikatora ani daty utworzenia użytkownika' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'disabled' AND OLD.status IS DISTINCT FROM 'disabled' THEN
    UPDATE user_oidc_identity
      SET status = 'revoked',
          revoked_at = GREATEST(revoked_time, linked_at)
      WHERE user_id = OLD.id
        AND (status <> 'revoked' OR revoked_at IS NULL OR revoked_at > GREATEST(revoked_time, linked_at));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER app_user_disable_transition_guard
AFTER UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION revoke_oidc_identities_on_user_disable();
