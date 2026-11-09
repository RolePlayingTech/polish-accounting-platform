import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrations.js';
import { createTestDatabase, expectDatabaseError } from './integration-database.js';

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));
const expectedTables = [
  '__drizzle_migrations',
  'access_management_event',
  'accounting_document',
  'app_user',
  'bank_statement_import',
  'bank_transaction',
  'company_access_grant',
  'company_operation_probe',
  'company_tax_settings',
  'entity_profile_version',
  'journal_entry',
  'journal_line',
  'kpir_entry',
  'ledger_account',
  'legal_entity',
  'mcp_prepared_proposal',
  'notification_outbox',
  'notification_preference',
  'ryczalt_entry',
  'sandbox_mailbox_message',
  'security_context_key',
  'security_decision_event',
  'settlement_item',
  'tax_obligation_item',
  'tenant',
  'tenant_membership',
  'user_oidc_identity',
  'vat_register_entry',
];

describe('Migracje PostgreSQL 6A → 6B → 6D-R → 6D-2 → 6D-3 → C2-1', () => {
  it('stosuje od zera dokładnie osiem migracji w kolejności i nie powiela obiektów', async () => {
    const database = await createTestDatabase();
    const { client: sql, db, dataSchema } = database;
    try {
      const migrations = readMigrationFiles({ migrationsFolder });
      expect(migrations).toHaveLength(10);
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

      // Usuwamy wyłącznie własną tabelę konfliktową; ponowienie stosuje cały łańcuch.
      await sql`DROP TABLE tenant`;
      await applyMigrations(db, dataSchema);
      expect(await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations`).toHaveLength(10);
    } finally {
      await database.cleanup();
    }
  }, 30_000);

  it('addytywne 0002..0007 zachowują dane i hashe wcześniejszych migracji; reaktywacja starego revoked nie wznawia grantu', async () => {
    const database = await createTestDatabase();
    const prefix = join(tmpdir(), 'pap-6d-r-');
    const folder = await mkdtemp(prefix);
    const { client: sql, db, dataSchema } = database;
    try {
      await mkdir(join(folder, 'meta'));
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
      );
      await writeFile(
        join(folder, 'meta', '_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 2) }),
      );
      for (const name of ['0000_technical-baseline.sql', '0001_tenant-schema.sql'])
        await writeFile(join(folder, name), readFileSync(join(migrationsFolder, name)));
      await migrate(db, { migrationsFolder: folder, migrationsSchema: dataSchema });
      const registry = await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations ORDER BY id`;
      const tenant = '00000000-0000-4000-8000-000000000001';
      const user = '00000000-0000-4000-8000-000000000002';
      const entity = '00000000-0000-4000-8000-000000000003';
      await sql`INSERT INTO tenant (id, name) VALUES (${tenant}, 'Dane syntetyczne sprzed 0002')`;
      await sql`INSERT INTO legal_entity (id, tenant_id, display_name) VALUES (${entity}, ${tenant}, 'Firma syntetyczna')`;
      await sql`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from) VALUES (${tenant}, ${user}, 'tenant_member', 'revoked', '2026-01-01')`;
      await sql`INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from) VALUES ('00000000-0000-4000-8000-000000000004', ${tenant}, ${user}, '00000000-0000-4000-8000-000000000003', 'read', '2026-01-01')`;
      await applyMigrations(db, dataSchema);
      expect(
        Array.from(
          await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations ORDER BY id`,
        ).slice(0, 2),
      ).toEqual(Array.from(registry));
      expect(await sql`SELECT name FROM tenant WHERE id = ${tenant}`).toMatchObject([
        { name: 'Dane syntetyczne sprzed 0002' },
      ]);
      expect(await sql`SELECT * FROM company_access_grant`).toHaveLength(1);
      await sql`UPDATE tenant_membership SET status = 'active' WHERE tenant_id = ${tenant} AND user_id = ${user}`;
      expect(
        (await sql`SELECT revoked_at FROM company_access_grant`)[0]?.revoked_at,
      ).not.toBeNull();
    } finally {
      await database.cleanup();
      // Wyłącznie losowy katalog utworzony przez ten test, z kontrolą przed rekurencją.
      if (folder.startsWith(prefix)) await rm(folder, { recursive: true });
    }
  }, 30_000);

  it('0009 wykrywa istniejące duplikaty (tenant_id, nip) w preflight bez wycieku NIP i przechodzi po ich rozwiązaniu', async () => {
    const database = await createTestDatabase();
    const prefix = join(tmpdir(), 'pap-0009-dup-');
    const folder = await mkdtemp(prefix);
    const { client: sql, db, dataSchema } = database;
    try {
      await mkdir(join(folder, 'meta'));
      const journal = JSON.parse(
        readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
      );
      await writeFile(
        join(folder, 'meta', '_journal.json'),
        JSON.stringify({ ...journal, entries: journal.entries.slice(0, 9) }),
      );
      for (const entry of journal.entries.slice(0, 9)) {
        const name = `${entry.tag}.sql`;
        await writeFile(join(folder, name), readFileSync(join(migrationsFolder, name)));
      }
      await migrate(db, { migrationsFolder: folder, migrationsSchema: dataSchema });

      const tenantId = '00000000-0000-4000-8000-000000000901';
      const userId = '00000000-0000-4000-8000-000000000902';
      const entityA = '00000000-0000-4000-8000-000000000903';
      const entityB = '00000000-0000-4000-8000-000000000904';
      const duplicateNip = '5261040828';

      await sql`INSERT INTO tenant (id, name) VALUES (${tenantId}, 'Tenant z duplikatem NIP sprzed 0009')`;
      await sql`INSERT INTO app_user (id, status) VALUES (${userId}, 'active')`;
      await sql`INSERT INTO legal_entity (id, tenant_id, display_name) VALUES (${entityA}, ${tenantId}, 'Podmiot A'), (${entityB}, ${tenantId}, 'Podmiot B')`;
      await sql`
        INSERT INTO company_tax_settings (
          id, tenant_id, legal_entity_id, nip, legal_form, tax_regime, vat_status,
          zus_stage, ksef_mode, address_summary, small_taxpayer, voluntary_sickness_insurance, updated_by
        ) VALUES
          ('00000000-0000-4000-8000-000000000905', ${tenantId}, ${entityA}, ${duplicateNip}, 'jdg', 'kpir_skala', 'czynny', 'duzy_zus', 'mandatory_2026_apr', 'Warszawa', true, true, ${userId}),
          ('00000000-0000-4000-8000-000000000906', ${tenantId}, ${entityB}, ${duplicateNip}, 'jdg', 'kpir_skala', 'czynny', 'duzy_zus', 'mandatory_2026_apr', 'Kraków', true, true, ${userId})
      `;

      let migrationErr: unknown = null;
      try {
        await applyMigrations(db, dataSchema);
      } catch (err) {
        migrationErr = err;
      }
      expect(migrationErr).not.toBeNull();
      const errText = JSON.stringify(migrationErr) + String(migrationErr);
      expect(errText).toContain('23505');
      expect(errText).toContain(tenantId);
      expect(errText).toContain(entityA);
      expect(errText).toContain(entityB);
      expect(errText).not.toContain(duplicateNip);

      // Po korekcie duplikatu migracja 0009 przechodzi i zakłada ograniczenie UNIQUE (tenant_id, nip).
      await sql`
        UPDATE company_tax_settings
        SET nip = '5213017228'
        WHERE tenant_id = ${tenantId} AND legal_entity_id = ${entityB}
      `;
      await applyMigrations(db, dataSchema);
      expect(await sql`SELECT * FROM ${sql(dataSchema)}.__drizzle_migrations`).toHaveLength(10);

      await expectDatabaseError(
        sql`
          UPDATE company_tax_settings
          SET nip = ${duplicateNip}
          WHERE tenant_id = ${tenantId} AND legal_entity_id = ${entityB}
        `,
        '23505',
      );
    } finally {
      await database.cleanup();
      if (folder.startsWith(prefix)) await rm(folder, { recursive: true });
    }
  }, 30_000);
});
