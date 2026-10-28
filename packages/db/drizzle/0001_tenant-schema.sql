-- Drizzle generuje kwalifikator public w FK. Celowo usunięto go tylko w tej
-- nowej migracji: wszystkie obiekty trafiają do jednego namespace z search_path.
-- Nie zmieniać 0000 ani historii zastosowanych migracji.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_extension
    WHERE extname = 'btree_gist' AND extnamespace <> current_schema()::regnamespace
  ) THEN
    RAISE EXCEPTION 'btree_gist musi należeć do schematu danych migracji'
      USING ERRCODE = '55000';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "company_access_grant" (
	"grant_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	CONSTRAINT "company_access_grant_action_check" CHECK ("company_access_grant"."action" IN ('read', 'write')),
	CONSTRAINT "company_access_grant_validity_check" CHECK (isfinite("company_access_grant"."valid_from") AND ("company_access_grant"."valid_until" IS NULL OR (isfinite("company_access_grant"."valid_until") AND "company_access_grant"."valid_until" > "company_access_grant"."valid_from"))),
	CONSTRAINT "company_access_grant_revoked_at_check" CHECK ("company_access_grant"."revoked_at" IS NULL OR isfinite("company_access_grant"."revoked_at"))
);
--> statement-breakpoint
CREATE TABLE "entity_profile_version" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"profile_code" text NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	CONSTRAINT "entity_profile_version_code_not_blank" CHECK (btrim("entity_profile_version"."profile_code") <> ''),
	CONSTRAINT "entity_profile_version_validity_check" CHECK (isfinite("entity_profile_version"."valid_from") AND ("entity_profile_version"."valid_until" IS NULL OR (isfinite("entity_profile_version"."valid_until") AND "entity_profile_version"."valid_until" > "entity_profile_version"."valid_from")))
);
--> statement-breakpoint
CREATE TABLE "legal_entity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_entity_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "legal_entity_name_not_blank" CHECK (btrim("legal_entity"."display_name") <> '')
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_name_not_blank" CHECK (btrim("tenant"."name") <> '')
);
--> statement-breakpoint
CREATE TABLE "tenant_membership" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	CONSTRAINT "tenant_membership_pk" PRIMARY KEY("tenant_id","user_id"),
	CONSTRAINT "tenant_membership_role_check" CHECK ("tenant_membership"."role" IN ('tenant_owner', 'tenant_admin', 'tenant_member')),
	CONSTRAINT "tenant_membership_status_check" CHECK ("tenant_membership"."status" IN ('active', 'revoked')),
	CONSTRAINT "tenant_membership_validity_check" CHECK (isfinite("tenant_membership"."valid_from") AND ("tenant_membership"."valid_until" IS NULL OR (isfinite("tenant_membership"."valid_until") AND "tenant_membership"."valid_until" > "tenant_membership"."valid_from")))
);
--> statement-breakpoint
ALTER TABLE "company_access_grant" ADD CONSTRAINT "company_access_grant_membership_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "tenant_membership"("tenant_id","user_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "company_access_grant" ADD CONSTRAINT "company_access_grant_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "entity_profile_version" ADD CONSTRAINT "entity_profile_version_entity_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "legal_entity"("tenant_id","id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "legal_entity" ADD CONSTRAINT "legal_entity_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "tenant_membership" ADD CONSTRAINT "tenant_membership_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "company_access_grant_lookup_idx" ON "company_access_grant" USING btree ("tenant_id","user_id","legal_entity_id","action");--> statement-breakpoint
CREATE INDEX "company_access_grant_entity_idx" ON "company_access_grant" USING btree ("tenant_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "entity_profile_version_lookup_idx" ON "entity_profile_version" USING btree ("tenant_id","legal_entity_id","valid_from");
--> statement-breakpoint
-- Jedna wersja profilu firmy w danej chwili, niezależnie od profile_code.
-- Constraint chroni też UPDATE i równoległe transakcje; NULL oznacza brak końca.
ALTER TABLE "entity_profile_version"
  ADD CONSTRAINT "entity_profile_version_no_overlap"
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    "legal_entity_id" WITH =,
    tstzrange("valid_from", "valid_until", '[)') WITH &&
  );