import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DatabaseConfigError } from '../src/database-config.js';
import { connectDatabase } from '../src/client.js';
import { loadRootEnvFile } from '../src/load-root-env.js';
import { applyMigrations } from '../src/migrations.js';

loadRootEnvFile();

describe('Migracje PostgreSQL', () => {
  it('migruje pustą bazę testową i nie powiela migracji', async () => {
    const environment = { ...process.env };
    if (environment.PAP_DATABASE_ENV !== 'test') {
      throw new DatabaseConfigError(
        'Test integracyjny wymaga PAP_DATABASE_ENV=test oraz bazy pap_test.',
      );
    }
    const { client: sql, db } = connectDatabase(environment);
    const migrationSchema = `drizzle_test_${randomUUID().replaceAll('-', '')}`;

    try {
      const before = await sql`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type = 'BASE TABLE'
      `;
      expect(before).toHaveLength(0);

      await applyMigrations(db, migrationSchema);

      const afterFirstRun = await sql`
        SELECT count(*)::int AS count
        FROM ${sql(migrationSchema)}.${sql('__drizzle_migrations')}
      `;
      expect(afterFirstRun[0]?.count).toBe(1);

      await applyMigrations(db, migrationSchema);

      const afterSecondRun = await sql`
        SELECT count(*)::int AS count
        FROM ${sql(migrationSchema)}.${sql('__drizzle_migrations')}
      `;
      expect(afterSecondRun[0]?.count).toBe(1);

      const after = await sql`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND table_type = 'BASE TABLE'
      `;
      expect(Array.from(after)).toEqual([
        { table_schema: migrationSchema, table_name: '__drizzle_migrations' },
      ]);
    } finally {
      try {
        await sql`DROP SCHEMA IF EXISTS ${sql(migrationSchema)} CASCADE`;
      } finally {
        await sql.end({ timeout: 1 });
      }
    }
  }, 30_000);
});
