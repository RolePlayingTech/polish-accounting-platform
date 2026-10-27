export type DatabaseEnvironment = 'local' | 'test';

export interface DatabaseConfig {
  readonly environment: DatabaseEnvironment;
  readonly url: string;
}

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function loadDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DatabaseConfig {
  const environment = env.PAP_DATABASE_ENV;

  if (env.NODE_ENV === 'production') {
    throw new DatabaseConfigError('Pakiet DB nie obsługuje środowiska NODE_ENV=production.');
  }

  if (environment !== 'local' && environment !== 'test') {
    throw new DatabaseConfigError(
      'PAP_DATABASE_ENV musi mieć wartość "local" albo "test". Połączenia produkcyjne są wyłączone.',
    );
  }

  const rawUrl = env.DATABASE_URL;
  if (!rawUrl) {
    throw new DatabaseConfigError('Wybrane środowisko bazy wymaga ustawienia DATABASE_URL.');
  }

  let url: URL;
  try {
    if (rawUrl !== rawUrl.trim()) {
      throw new Error();
    }
    url = new URL(rawUrl);
  } catch {
    throw new DatabaseConfigError('DATABASE_URL musi być poprawnym adresem PostgreSQL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new DatabaseConfigError('DATABASE_URL musi używać protokołu postgres: albo postgresql:.');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new DatabaseConfigError('Połączenie z bazą jest dozwolone wyłącznie przez loopback.');
  }

  const expectedUser = environment === 'local' ? 'pap_local' : 'pap_test';
  const expectedDatabase = environment === 'local' ? 'pap_local' : 'pap_test';
  if (url.username !== expectedUser || !url.password) {
    throw new DatabaseConfigError(
      `Środowisko ${environment} wymaga dedykowanego konta ${expectedUser} oraz hasła.`,
    );
  }

  if (url.pathname !== `/${expectedDatabase}`) {
    throw new DatabaseConfigError(
      `Środowisko ${environment} wymaga dedykowanej bazy ${expectedDatabase}.`,
    );
  }

  if (url.search || url.hash) {
    throw new DatabaseConfigError(
      'Parametry zapytania i fragmenty DATABASE_URL nie są obsługiwane.',
    );
  }

  url.port ||= '5432';
  return { environment, url: url.toString() };
}
