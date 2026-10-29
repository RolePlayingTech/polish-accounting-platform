import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

describe('Kontrakt plików migracji', () => {
  it('zachowuje znacznik 6A i łańcuch snapshotów oraz journal 6A → 6B → 6D-R → 6D-2', () => {
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
    const journal = readJson('_journal.json');
    expect(migrations).toHaveLength(7);
    expect(migrations[0]?.sql.join('')).toMatch(/SELECT 1;/);
    expect(baseline.tables).toEqual({});
    expect(schema.prevId).toBe(baseline.id);
    expect(lifecycle.prevId).toBe(schema.id);
    expect(identity.prevId).toBe(lifecycle.id);
    expect(runtime.prevId).toBe(identity.id);
    expect(audit.prevId).toBe(runtime.id);
    expect(foundation.prevId).toBe(audit.id);
    expect(foundation.tables['public.access_management_event'].columns.transaction_id).toBeDefined();
    expect(audit.tables['public.access_management_event'].columns.transaction_id).toBeUndefined();
    expect(Object.keys(audit.tables)).toHaveLength(11);
    expect(Object.values(runtime.tables)).toHaveLength(10);
    for (const table of Object.values(runtime.tables) as { isRLSEnabled: boolean }[]) {
      expect(table.isRLSEnabled).toBe(true);
    }
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual([
      '0000_technical-baseline',
      '0001_tenant-schema',
      '0002_access-lifecycle',
      '0003_user-identity',
      '0004_runtime-security',
      '0005_security-audit',
      '0006_security-foundation',
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

  it('0006 łączy dokładne efekty i trzy wyniki TX bez przepisywania historycznego audytu', () => {
    const migration = readFileSync(new URL('../drizzle/0006_security-foundation.sql', import.meta.url), 'utf8');
    for (const fragment of [
      'pap_execute_access()', 'pap_security_protocol_version()',
      'e.operation_id = NEW.operation_id', "a.state_change->'effects'->effect_key = expected_effect",
      'a.transaction_id = pg_current_xact_id()::text', 'WITH CHECK (false)',
      "'outcome_unknown'", "'transaction_outcome_unknown'", 'access_management_operation_id IS NULL',
      ') NOT VALID;', "SET LOCAL lock_timeout = '5s'",
    ]) expect(migration).toContain(fragment);
  });
});
