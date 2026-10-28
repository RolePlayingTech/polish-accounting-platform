import { readFileSync } from 'node:fs';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrations.js';
import { createTestDatabase, expectDatabaseError } from './integration-database.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const expectedTables = [
  '__drizzle_migrations',
  'company_access_grant',
  'entity_profile_version',
  'legal_entity',
  'tenant',
  'tenant_membership',
];

describe.sequential('Migracje PostgreSQL 6A → 6B', () => {
  it('stosuje od zera dokładnie dwie migracje w kolejności i nie powiela obiektów', async () => {
    const database = await createTestDatabase();
    const { client: sql, db, dataSchema } = database;
    try {
      const migrations = readMigrationFiles({ migrationsFolder });
      expect(migrations).toHaveLength(2);
      expect(
        readFileSync(new URL('../drizzle/0000_technical-baseline.sql', import.meta.url), 'utf8'),
      ).toContain('SELECT 1;');

      const before = await sql`
        SELECT table_name FROM information_schema.tables WHERE table_schema = ${dataSchema}
      `;
      expect(before).toHaveLength(0);
      await applyMigrations(db, dataSchema);

      const registry = () => sql`
        SELECT hash, created_at FROM ${sql(dataSchema)}.__drizzle_migrations ORDER BY id
      `;
      const first = await registry();
      expect(
        Array.from(first, (row) => ({ hash: row.hash, time: Number(row.created_at) })),
      ).toEqual(
        migrations.map((migration) => ({ hash: migration.hash, time: migration.folderMillis })),
      );
      expect(Number(first[0]?.created_at)).toBeLessThan(Number(first[1]?.created_at));

      const relations = () => sql`
        SELECT relname, relkind, oid FROM pg_class
        WHERE relnamespace = ${dataSchema}::regnamespace ORDER BY relname
      `;
      const firstRelations = await relations();
      await applyMigrations(db, dataSchema);
      expect(Array.from(await registry())).toEqual(Array.from(first));
      expect(Array.from(await relations())).toEqual(Array.from(firstRelations));

      const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ${dataSchema} AND table_type = 'BASE TABLE' ORDER BY table_name
      `;
      expect(Array.from(tables, (row) => row.table_name)).toEqual(expectedTables);
      const misplacedForeignKeys = await sql`
        SELECT c.conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.confrelid
        WHERE c.contype = 'f' AND c.connamespace = ${dataSchema}::regnamespace
          AND t.relnamespace <> ${dataSchema}::regnamespace
      `;
      expect(misplacedForeignKeys).toHaveLength(0);
      const extension = await sql`
        SELECT extnamespace::regnamespace::text AS namespace FROM pg_extension
        WHERE extname = 'btree_gist'
      `;
      expect(Array.from(extension)).toEqual([{ namespace: dataSchema }]);
      await expect(createTestDatabase()).rejects.toThrow('nie usuwa ani nie przenosi');

      // Druga sesja puli ma ten sam namespace; sprawdzenie nie polega na SET jednej sesji.
      const paths = await Promise.all(
        Array.from({ length: 5 }, () => sql`SELECT current_schema() AS namespace`),
      );
      for (const rows of paths) expect(rows[0]?.namespace).toBe(dataSchema);
    } finally {
      await database.cleanup();
    }
  }, 30_000);

  it('wycofuje nieudaną migrację i pozostawia zastane dane bez zmian', async () => {
    const database = await createTestDatabase();
    const { client: sql, db, dataSchema } = database;
    try {
      // Konflikt kontrolowany przez test; migrator nie może przejąć tej tabeli.
      await sql`CREATE TABLE tenant (marker text NOT NULL)`;
      await sql`INSERT INTO tenant VALUES ('syntetyczny znacznik przed migracją')`;
      await expectDatabaseError(applyMigrations(db, dataSchema), '42P07');
      expect(Array.from(await sql`SELECT marker FROM tenant`)).toEqual([
        { marker: 'syntetyczny znacznik przed migracją' },
      ]);
      const registry = await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations`;
      expect(registry).toHaveLength(0);
      const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ${dataSchema} AND table_type = 'BASE TABLE' ORDER BY table_name
      `;
      expect(Array.from(tables, (row) => row.table_name)).toEqual([
        '__drizzle_migrations',
        'tenant',
      ]);
      expect(await sql`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`).toHaveLength(0);

      // Usuwamy wyłącznie własną tabelę konfliktową; ponowienie naprawdę stosuje oba pliki.
      await sql`DROP TABLE tenant`;
      await applyMigrations(db, dataSchema);
      expect(await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations`).toHaveLength(2);
    } finally {
      await database.cleanup();
    }
  }, 30_000);
});
