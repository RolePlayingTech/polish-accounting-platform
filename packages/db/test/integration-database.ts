import { randomUUID } from 'node:crypto';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { DatabaseConfigError } from '../src/database-config.js';
import { loadRootEnvFile } from '../src/load-root-env.js';

loadRootEnvFile();

export async function createTestDatabase() {
  if (process.env.PAP_DATABASE_ENV !== 'test') {
    throw new DatabaseConfigError('Test integracyjny wymaga PAP_DATABASE_ENV=test i pap_test.');
  }
  // Kontrola PRZED SQL: kwalifikator public w wygenerowanym FK ominąłby search_path.
  const files = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
  for (const migration of files) {
    const source = migration.sql.join('\n');
    if (/(?:"public"|\bpublic)\s*\.|\b(?:CREATE|DROP)\s+SCHEMA\b/i.test(source)) {
      throw new Error('Migracja omija namespace testowy; test przerwany przed połączeniem.');
    }
  }
  const dataSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;
  const connection = connectDatabase(process.env, dataSchema);
  const { client: sql } = connection;
  let created = false;

  // Inwentaryzacja istniejących obiektów; nie czytamy ani nie kasujemy cudzych danych.
  const inventory = async () => ({
    relations: Array.from(
      await sql`
      SELECT n.nspname, c.relname, c.relkind, c.oid
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      ORDER BY n.nspname, c.relname
    `,
    ),
    schemas: Array.from(
      await sql`
      SELECT nspname FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname
    `,
    ),
    extensions: Array.from(
      await sql`
      SELECT extname, extnamespace FROM pg_extension ORDER BY extname
    `,
    ),
  });

  let before: Awaited<ReturnType<typeof inventory>>;
  try {
    before = await inventory();
    if (before.extensions.some((row) => row.extname === 'btree_gist')) {
      throw new Error(
        'Test wymaga pap_test bez btree_gist; nie usuwa ani nie przenosi zastanego rozszerzenia.',
      );
    }
    // Bez IF NOT EXISTS: w razie kolizji nie przejmujemy własności zastanego schematu.
    await sql`CREATE SCHEMA ${sql(dataSchema)}`;
    created = true;
  } catch (error) {
    await sql.end({ timeout: 1 });
    throw error;
  }

  return {
    ...connection,
    dataSchema,
    async cleanup() {
      try {
        if (created) {
          await sql`DROP SCHEMA ${sql(dataSchema)} CASCADE`;
          created = false;
        }
        expect(await inventory()).toEqual(before);
      } finally {
        await sql.end({ timeout: 1 });
      }
    },
  };
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

export async function expectDatabaseError(
  operation: PromiseLike<unknown>,
  code: string,
  constraint?: string,
) {
  let failure: unknown;
  try {
    await operation;
  } catch (error) {
    failure = error;
  }
  while (failure instanceof Error && 'cause' in failure && failure.cause) {
    failure = failure.cause;
  }
  expect(failure).toMatchObject({ code, ...(constraint ? { constraint_name: constraint } : {}) });
}
