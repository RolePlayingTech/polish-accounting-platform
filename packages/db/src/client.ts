import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
import { loadDatabaseConfig } from './database-config.js';

export function connectDatabase(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = loadDatabaseConfig(env);
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
    max: 5,
  });

  return { client, db: drizzle(client, { schema }) };
}
