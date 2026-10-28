import { DatabaseConfigError } from './database-config.js';
import { connectDatabase } from './client.js';
import { loadRootEnvFile } from './load-root-env.js';
import { applyMigrations } from './migrations.js';

async function main(): Promise<void> {
  let connection: ReturnType<typeof connectDatabase> | undefined;

  try {
    loadRootEnvFile();
    connection = connectDatabase(process.env, 'public', { roleScope: 'migrator' });
    await applyMigrations(connection.db);
    console.info('Migracje bazy zostały zastosowane.');
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      console.error(error.message);
    } else {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[A-Z0-9_]{1,20}$/.test(error.code)
          ? ` (kod ${error.code})`
          : '';
      console.error(`Nie udało się zastosować migracji${code}; szczegóły połączenia pominięto.`);
    }
    process.exitCode = 1;
  } finally {
    try {
      await connection?.client.end({ timeout: 1 });
    } catch {
      console.error('Nie udało się zamknąć połączenia z bazą; szczegóły połączenia pominięto.');
      process.exitCode = 1;
    }
  }
}

await main();
