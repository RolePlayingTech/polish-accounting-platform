import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';

type Database = ReturnType<typeof connectDatabase>['db'];
const privileges = readFileSync(new URL('../sql/runtime-privileges.sql', import.meta.url), 'utf8');

/** Jawna operacja administracyjna; nie jest wywoływana przy starcie ani migracji. */
export async function configureRuntimePrivileges(
  db: Pick<Database, 'transaction'>,
  runtimeRole: 'pap_local_app' | 'pap_test_app' | 'pap_staging_app',
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('pap.provision_runtime_role', ${runtimeRole}, true)`);
    await tx.execute(sql.raw(privileges));
  });
}

/** Klucz przekazany z chronionego kanału operatora, bez drukowania i bez generowania w migracji. */
export async function provisionDatabaseContextKey(
  db: Pick<Database, 'execute'>,
  input: { readonly keyId: string; readonly keyHex: string; readonly runtimeRole: string },
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(input.keyId) || !/^[a-f0-9]{64}$/i.test(input.keyHex)) {
    throw new Error('Niepoprawna konfiguracja klucza kontekstu.');
  }
  await db.execute(sql`INSERT INTO security_context_key (key_id, secret_hex, runtime_role)
    VALUES (${input.keyId}, ${input.keyHex.toLowerCase()}, ${input.runtimeRole})`);
}
