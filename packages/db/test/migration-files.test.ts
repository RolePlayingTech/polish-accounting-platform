import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

describe('Kontrakt plików migracji', () => {
  it('zachowuje znacznik 6A i łańcuch snapshotów oraz journal 6A → 6B', () => {
    const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
    const migrations = readMigrationFiles({ migrationsFolder: folder });
    const readJson = (name: string) => JSON.parse(readFileSync(`${folder}/meta/${name}`, 'utf8'));
    const baseline = readJson('0000_snapshot.json');
    const schema = readJson('0001_snapshot.json');
    const journal = readJson('_journal.json');
    expect(migrations).toHaveLength(2);
    expect(migrations[0]?.sql.join('')).toMatch(/SELECT 1;/);
    expect(baseline.tables).toEqual({});
    expect(schema.prevId).toBe(baseline.id);
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual([
      '0000_technical-baseline',
      '0001_tenant-schema',
    ]);
    expect(Object.keys(schema.tables).sort()).toEqual([
      'public.company_access_grant',
      'public.entity_profile_version',
      'public.legal_entity',
      'public.tenant',
      'public.tenant_membership',
    ]);
  });

  it('nie kieruje SQL do public z pominięciem namespace testowego i zawiera jawny EXCLUDE', () => {
    const migration = readFileSync(
      new URL('../drizzle/0001_tenant-schema.sql', import.meta.url),
      'utf8',
    );
    expect(migration).not.toMatch(/(?:"public"|\bpublic)\s*\./i);
    expect(migration).not.toMatch(/\b(?:CREATE|DROP)\s+SCHEMA\b/i);
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(migration).toContain('EXCLUDE USING gist');
    expect(migration).toContain('tstzrange("valid_from", "valid_until", \'[)\') WITH &&');
  });
});
