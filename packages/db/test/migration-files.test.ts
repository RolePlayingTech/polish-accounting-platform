import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

const accountingCoreTables = [
  'company_tax_settings',
  'accounting_document',
  'kpir_entry',
  'ryczalt_entry',
  'vat_register_entry',
  'ledger_account',
  'journal_entry',
  'journal_line',
  'settlement_item',
  'bank_statement_import',
  'bank_transaction',
  'tax_obligation_item',
  'mcp_prepared_proposal',
  'notification_preference',
  'notification_outbox',
  'sandbox_mailbox_message',
] as const;

const mutableAccountingTables = [
  'company_tax_settings',
  'accounting_document',
  'ledger_account',
  'settlement_item',
  'bank_transaction',
  'tax_obligation_item',
  'mcp_prepared_proposal',
  'notification_preference',
  'notification_outbox',
] as const;

const appendOnlyAccountingTables = [
  'kpir_entry',
  'ryczalt_entry',
  'vat_register_entry',
  'journal_entry',
  'journal_line',
  'bank_statement_import',
  'sandbox_mailbox_message',
] as const;

describe('Kontrakt plików migracji', () => {
  it('zachowuje znacznik 6A i łańcuch snapshotów oraz journal 6A → 6B → 6D-R → 6D-2 → 6D-3 → C2-1', () => {
    const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    const readJson = (name: string) => JSON.parse(readFileSync(`${folder}/meta/${name}`, 'utf8'));
    const baseline = readJson('0000_snapshot.json');
    const schema = readJson('0001_snapshot.json');
    const lifecycle = readJson('0002_snapshot.json');
    const identity = readJson('0003_snapshot.json');
    const runtime = readJson('0004_snapshot.json');
    const audit = readJson('0005_snapshot.json');
    const foundation = readJson('0006_snapshot.json');
    const accounting = readJson('0007_snapshot.json');
    const journal = readJson('_journal.json');
    expect(migrations).toHaveLength(8);
    expect(migrations[0]?.sql.join('')).toMatch(/SELECT 1;/);
    expect(baseline.tables).toEqual({});
    expect(schema.prevId).toBe(baseline.id);
    expect(lifecycle.prevId).toBe(schema.id);
    expect(identity.prevId).toBe(lifecycle.id);
    expect(runtime.prevId).toBe(identity.id);
    expect(audit.prevId).toBe(runtime.id);
    expect(foundation.prevId).toBe(audit.id);
    expect(accounting.prevId).toBe(foundation.id);
    expect(
      foundation.tables['public.access_management_event'].columns.transaction_id,
    ).toBeDefined();
    expect(audit.tables['public.access_management_event'].columns.transaction_id).toBeUndefined();
    expect(Object.keys(audit.tables)).toHaveLength(11);
    expect(Object.values(runtime.tables)).toHaveLength(10);
    expect(Object.keys(accounting.tables)).toHaveLength(27);
    for (const table of Object.values(runtime.tables) as { isRLSEnabled: boolean }[]) {
      expect(table.isRLSEnabled).toBe(true);
    }
    for (const table of Object.values(accounting.tables) as { isRLSEnabled: boolean }[]) {
      expect(table.isRLSEnabled).toBe(true);
    }
    for (const tableName of accountingCoreTables) {
      expect(accounting.tables[`public.${tableName}`]).toBeDefined();
    }
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual([
      '0000_technical-baseline',
      '0001_tenant-schema',
      '0002_access-lifecycle',
      '0003_user-identity',
      '0004_runtime-security',
      '0005_security-audit',
      '0006_security-foundation',
      '0007_accounting-core',
    ]);
    expect(Object.keys(schema.tables).sort()).toEqual([
      'public.company_access_grant',
      'public.entity_profile_version',
      'public.legal_entity',
      'public.tenant',
      'public.tenant_membership',
    ]);
    expect(lifecycle.tables['public.access_management_event']).toBeDefined();
    expect(identity.tables['public.app_user']).toBeDefined();
    expect(identity.tables['public.user_oidc_identity']).toBeDefined();
  });

  it('nie kieruje SQL do public z pominięciem namespace testowego i zawiera jawny EXCLUDE oraz guardy tożsamości', () => {
    for (const fileName of [
      '0001_tenant-schema.sql',
      '0002_access-lifecycle.sql',
      '0003_user-identity.sql',
      '0004_runtime-security.sql',
      '0005_security-audit.sql',
      '0006_security-foundation.sql',
      '0007_accounting-core.sql',
    ]) {
      const migration = readFileSync(new URL(`../drizzle/${fileName}`, import.meta.url), 'utf8');
      expect(migration).not.toMatch(/(?:"public"|\bpublic)\s*\./i);
      expect(migration).not.toMatch(/\b(?:CREATE|DROP)\s+SCHEMA\b/i);
    }

    const schemaMigration = readFileSync(
      new URL('../drizzle/0001_tenant-schema.sql', import.meta.url),
      'utf8',
    );
    expect(schemaMigration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(schemaMigration).toContain('EXCLUDE USING gist');
    expect(schemaMigration).toContain('tstzrange("valid_from", "valid_until", \'[)\') WITH &&');

    const identityMigration = readFileSync(
      new URL('../drizzle/0003_user-identity.sql', import.meta.url),
      'utf8',
    );
    expect(identityMigration).toContain('user_oidc_identity_issuer_subject_unique');
    expect(identityMigration).toContain('protect_user_oidc_identity');
    expect(identityMigration).toContain('revoke_oidc_identities_on_user_disable');
  });

  it('RLS wymaga podpisu związanej transakcji i pinowanych definerów, bez klucza w migracji', () => {
    const migration = readFileSync(
      new URL('../drizzle/0004_runtime-security.sql', import.meta.url),
      'utf8',
    );
    for (const fragment of [
      'FORCE ROW LEVEL SECURITY',
      'pg_current_xact_id()',
      'pg_backend_pid()',
      'session_user',
      "current_setting('pap.context_signature'",
      "decode(secret, 'hex')",
      'SET search_path = pg_catalog, %I, pg_temp',
      'REVOKE ALL ON FUNCTION',
    ]) {
      expect(migration).toContain(fragment);
    }
    expect(migration).not.toMatch(/INSERT INTO security_context_key/i);
  });

  it('audyt jest append-only, wiąże TX i wymaga śladu przy COMMIT', () => {
    const migration = readFileSync(
      new URL('../drizzle/0005_security-audit.sql', import.meta.url),
      'utf8',
    );
    for (const fragment of [
      'DEFERRABLE INITIALLY DEFERRED',
      'pap_require_security_audit',
      'NEW.transaction_id := pg_current_xact_id()::text',
      'BEFORE UPDATE OR DELETE',
      "pap_context()->>'purpose' = 'audit'",
      'FOR byte_index IN 0..31',
      'pap_access_event_insert',
      'access_management_operation_id',
    ]) {
      expect(migration).toContain(fragment);
    }
  });

  it('0006 łączy dokładne efekty, trzy wyniki TX i poprawki P1/P2 bez pustych statement-breakpointów', () => {
    const migration = readFileSync(
      new URL('../drizzle/0006_security-foundation.sql', import.meta.url),
      'utf8',
    );
    for (const fragment of [
      'pap_execute_access()',
      'pap_security_protocol_version()',
      'e.operation_id = NEW.operation_id',
      "a.state_change->'effects'->effect_key = expected_effect",
      'a.transaction_id = pg_current_xact_id()::text',
      'WITH CHECK (false)',
      "'outcome_unknown'",
      "'transaction_outcome_unknown'",
      'access_management_operation_id IS NULL',
      ') NOT VALID;',
      "SET LOCAL lock_timeout = '5s'",
      // P1-2: rzutowania UUID ::text przed operatorem || (ochrona przed shadowingiem pg_temp)
      "'company_access_grant:' || g.grant_id::text",
      "'company_access_grant:' || g_after.grant_id::text",
      "'tenant_membership:' || scope_tenant::text || ':' || target_user::text",
      "'tenant_membership:' || NEW.tenant_id::text || ':' || NEW.user_id::text",
      "'company_access_grant:' || (to_jsonb(NEW)->>'grant_id')::text",
      // P2-1: walidacja jsonb_typeof(c->'command') oraz NULL dla identyfikatorów przed deduplikacją
      "jsonb_typeof(c->'command') IS DISTINCT FROM 'object'",
      "c->>'tenant_id' IS NULL OR c->>'target_user_id' IS NULL",
      'IF target_entity IS NULL OR requested_grant IS NULL THEN',
      'IF requested_grant IS NULL THEN',
      // P2-2: precyzja timestamptz(3) zgodna z zegarem JS Date
      'timestamptz(3)',
      "decision_time := (c->>'decision_at')::timestamptz(3)",
      // P2-3: reset lokalnych timeoutów po migracji
      'RESET lock_timeout;',
      'RESET statement_timeout;',
    ]) {
      expect(migration).toContain(fragment);
    }

    // P2-3: brak pustych chunków między --> statement-breakpoint i brak duplikatu ALTER FUNCTION pap_check_committed_decision()
    const statements = migration.split('--> statement-breakpoint');
    for (const stmt of statements) {
      expect(stmt.trim().length).toBeGreaterThan(0);
    }
    const alterCommittedDecisionMatches = migration.match(/'pap_check_committed_decision\(\)'/g);
    expect(alterCommittedDecisionMatches).toHaveLength(1);

    // P1-1: runtime-privileges.sql filtruje funkcje po pg_has_role(current_user, p.proowner, 'USAGE') bez globalnego REVOKE ALL ON ALL FUNCTIONS
    const runtimePrivileges = readFileSync(
      new URL('../sql/runtime-privileges.sql', import.meta.url),
      'utf8',
    );
    expect(runtimePrivileges).not.toMatch(/REVOKE\s+ALL\s+ON\s+ALL\s+FUNCTIONS\s+IN\s+SCHEMA/i);
    expect(runtimePrivileges).toContain("pg_has_role(current_user, p.proowner, 'USAGE')");

    const bootstrapRole = readFileSync(
      new URL('../sql/bootstrap-runtime-role.sql', import.meta.url),
      'utf8',
    );
    expect(bootstrapRole).toContain('CREATE SCHEMA IF NOT EXISTS pap_lockdown');
    expect(bootstrapRole).toContain('REVOKE ALL ON SCHEMA pap_lockdown FROM PUBLIC');
    expect(bootstrapRole).toContain('pap_lockdown.pap_on_create_extension_lockdown()');
    expect(bootstrapRole).toContain('pap_lockdown_pgcrypto_on_extension');
    expect(bootstrapRole).not.toContain('public.pap_apply_pgcrypto_lockdown');
    expect(bootstrapRole).not.toContain('public.pap_on_create_extension_lockdown');
  });

  it('0007 wymusza FORCE RLS, polityki migratora i pap_company_allowed, audyt TX oraz białą listę ACL bez DELETE', () => {
    const migration = readFileSync(
      new URL('../drizzle/0007_accounting-core.sql', import.meta.url),
      'utf8',
    );

    const statements = migration.split('--> statement-breakpoint');
    for (const stmt of statements) {
      expect(stmt.trim().length).toBeGreaterThan(0);
    }

    for (const fragment of [
      "SET LOCAL lock_timeout = '5s';",
      "SET LOCAL statement_timeout = '30s';",
      'ALTER TABLE %I ENABLE ROW LEVEL SECURITY',
      'ALTER TABLE %I FORCE ROW LEVEL SECURITY',
      'CREATE POLICY pap_migrator ON %I FOR ALL TO PUBLIC USING (current_user = %L) WITH CHECK (current_user = %L)',
      'pap_require_accounting_write_audit()',
      'pap_protect_append_only_accounting()',
      'pap_forbid_accounting_delete()',
      'pap_guard_posted_document()',
      'SET search_path = pg_catalog, %I, pg_temp',
      'RESET lock_timeout;',
      'RESET statement_timeout;',
    ]) {
      expect(migration).toContain(fragment);
    }

    expect(migration).not.toMatch(/\b(?:double\s+precision|real|float4|float8)\b/i);
    expect(migration).not.toMatch(/FOR\s+DELETE/i);

    for (const tableName of accountingCoreTables) {
      expect(migration).toContain(`REFERENCES "legal_entity"("tenant_id","id")`);
      expect(migration).toContain(
        `CREATE POLICY pap_${tableName}_read ON "${tableName}" FOR SELECT`,
      );
      expect(migration).toContain(
        `CREATE POLICY pap_${tableName}_insert ON "${tableName}" FOR INSERT`,
      );
      expect(migration).toContain("pap_company_allowed(tenant_id, legal_entity_id, 'read')");
      expect(migration).toContain("pap_company_allowed(tenant_id, legal_entity_id, 'write')");
    }

    for (const tableName of mutableAccountingTables) {
      expect(migration).toContain(
        `CREATE POLICY pap_${tableName}_update ON "${tableName}" FOR UPDATE`,
      );
    }

    for (const tableName of appendOnlyAccountingTables) {
      expect(migration).not.toContain(`ON "${tableName}" FOR UPDATE`);
    }

    const runtimePrivileges = readFileSync(
      new URL('../sql/runtime-privileges.sql', import.meta.url),
      'utf8',
    );
    expect(runtimePrivileges).not.toMatch(/GRANT\s+[^;]*\b(?:DELETE|TRUNCATE)\b/i);
    expect(runtimePrivileges).toContain('GRANT SELECT, INSERT ON %I.%I TO %I');
    for (const tableName of accountingCoreTables) {
      expect(runtimePrivileges).toContain(`'${tableName}'`);
    }
  });
});
