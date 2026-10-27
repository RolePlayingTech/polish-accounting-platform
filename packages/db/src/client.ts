import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { loadDatabaseConfig } from './database-config.js';

export function connectDatabase(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = loadDatabaseConfig(env);
  const client = postgres(config.url, {
    connect_timeout: 5,
    idle_timeout: 20,
    max: 5,
  });

  return { client, db: drizzle(client, { schema }) };
}
