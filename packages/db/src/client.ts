import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import {
  DatabaseConfigError,
  loadDatabaseConfig,
  type LoadDatabaseConfigOptions,
} from './database-config.js';

export interface ConnectDatabaseOptions extends LoadDatabaseConfigOptions {
  readonly maxConnections?: number;
}

export function connectDatabase(
  env: Readonly<Record<string, string | undefined>> = process.env,
  dataSchema = 'public',
  options: ConnectDatabaseOptions = {},
) {
  const config = loadDatabaseConfig(env, options);
  // Namespace testowy dotyczy wszystkich połączeń puli, także transakcji migratora.
  // Nie jest kontekstem tenanta ani mechanizmem autoryzacji/RLS.
  if (
    dataSchema !== 'public' &&
    !(config.environment === 'test' && /^pap_test_[a-f0-9]{32}$/.test(dataSchema))
  ) {
    throw new DatabaseConfigError('Niedozwolony schemat danych; własny namespace wymaga testu.');
  }

  const maxConnections = options.maxConnections ?? 5;
  if (!Number.isInteger(maxConnections) || maxConnections < 1 || maxConnections > 100) {
    throw new DatabaseConfigError('Niepoprawny limit połączeń puli PostgreSQL.');
  }

  const url = new URL(config.url);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const client = postgres(config.url, {
    // Tablice omijają rozdzielanie host:port w postgres.js 3.4.9 dla IPv6.
    // @ts-expect-error Sterownik obsługuje tablice host/port, ale Options dopuszcza tylko skalar.
    host: [host],
    // @ts-expect-error Jak wyżej: host i port muszą być przekazane razem jako tablice.
    port: [Number(url.port)],
    connect_timeout: 5,
    idle_timeout: 20,
    max: maxConnections,
    connection: { search_path: `${dataSchema},pg_catalog` },
  });

  return { client, db: drizzle(client, { schema }) };
}
