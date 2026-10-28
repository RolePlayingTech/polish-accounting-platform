import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import type { connectDatabase } from './client.js';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

type Database = ReturnType<typeof connectDatabase>['db'];

/** migrationsSchema wybiera wyłącznie rejestr; namespace tabel ustala connectDatabase. */
export async function applyMigrations(db: Database, migrationsSchema = 'drizzle'): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER, migrationsSchema });
}
