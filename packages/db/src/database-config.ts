export type DatabaseEnvironment = 'local' | 'test' | 'staging';
export type DatabaseRoleScope = 'runtime' | 'migrator';

export interface DatabaseConfig {
  readonly environment: DatabaseEnvironment;
  readonly url: string;
}

export interface LoadDatabaseConfigOptions {
  readonly roleScope?: DatabaseRoleScope;
}

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const STAGING_LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

function expectedDatabaseUser(
  environment: DatabaseEnvironment,
  roleScope: DatabaseRoleScope,
): string {
  if (environment === 'local') {
    return 'pap_local';
  }
  if (environment === 'test') {
    return 'pap_test';
  }
  return roleScope === 'migrator' ? 'pap_staging_migrator' : 'pap_staging_app';
}

function expectedDatabaseName(environment: DatabaseEnvironment): string {
  if (environment === 'local') {
    return 'pap_local';
  }
  if (environment === 'test') {
    return 'pap_test';
  }
  return 'pap_staging';
}

export function loadDatabaseConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options: LoadDatabaseConfigOptions = {},
): DatabaseConfig {
  const environment = env.PAP_DATABASE_ENV;
  const roleScope: DatabaseRoleScope = options.roleScope ?? 'runtime';

  if (environment !== 'local' && environment !== 'test' && environment !== 'staging') {
    if (env.NODE_ENV === 'production') {
      throw new DatabaseConfigError('Pakiet DB nie obsługuje środowiska NODE_ENV=production.');
    }
    throw new DatabaseConfigError(
      'PAP_DATABASE_ENV musi mieć wartość "local", "test" albo "staging". Połączenia produkcyjne są wyłączone.',
    );
  }

  if (env.NODE_ENV === 'production' && environment !== 'staging') {
    throw new DatabaseConfigError(
      'Pakiet DB nie obsługuje środowiska NODE_ENV=production dla konfiguracji local/test.',
    );
  }

  if (environment === 'staging' && env.NODE_ENV !== 'production') {
    throw new DatabaseConfigError('Środowisko staging wymaga ustawienia NODE_ENV=production.');
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
  const allowedHosts = environment === 'staging' ? STAGING_LOOPBACK_HOSTS : LOOPBACK_HOSTS;
  if (!allowedHosts.has(host)) {
    throw new DatabaseConfigError('Połączenie z bazą jest dozwolone wyłącznie przez loopback.');
  }

  const expectedUser = expectedDatabaseUser(environment, roleScope);
  const expectedDatabase = expectedDatabaseName(environment);

  if (
    environment === 'staging' &&
    roleScope === 'runtime' &&
    url.username === 'pap_staging_migrator'
  ) {
    throw new DatabaseConfigError(
      'Aplikacja runtime w środowisku staging nie może używać konta migracyjnego DDL pap_staging_migrator; wymagane jest konto pap_staging_app.',
    );
  }

  if (environment === 'staging' && roleScope === 'migrator' && url.username === 'pap_staging_app') {
    throw new DatabaseConfigError(
      'Migracje w środowisku staging wymagają dedykowanego konta pap_staging_migrator, a nie konta runtime pap_staging_app.',
    );
  }

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
