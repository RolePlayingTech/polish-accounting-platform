import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, loadDatabaseConfig } from '../src/database-config.js';

describe('loadDatabaseConfig', () => {
  it.each(['local', 'test'] as const)('rozdziela runtime i migratora także w %s', (environment) => {
    const env = {
      PAP_DATABASE_ENV: environment,
      DATABASE_URL: `postgres://pap_${environment}:synthetic@127.0.0.1/pap_${environment}`,
    };
    expect(() => loadDatabaseConfig(env)).toThrow('dedykowanego konta');
    expect(loadDatabaseConfig(env, { roleScope: 'migrator' }).environment).toBe(environment);
  });
  it('accepts the dedicated local database on loopback', () => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'local',
        DATABASE_URL: 'postgres://pap_local_app:local_only@127.0.0.1:5432/pap_local',
      }),
    ).toEqual({
      environment: 'local',
      url: 'postgres://pap_local_app:local_only@127.0.0.1:5432/pap_local',
    });
  });

  it('accepts the dedicated test database on loopback', () => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgresql://pap_test_app:test_only@localhost:5433/pap_test',
      }).environment,
    ).toBe('test');
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts loopback host %s in test', (host) => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: `postgres://pap_test_app:test_only@${host}/pap_test`,
      }).url,
    ).toContain(':5432/pap_test');
  });

  it('accepts staging runtime configuration on IP loopback with pap_staging_app', () => {
    expect(
      loadDatabaseConfig({
        NODE_ENV: 'production',
        PAP_DATABASE_ENV: 'staging',
        DATABASE_URL: 'postgres://pap_staging_app:staging_only@127.0.0.1:5432/pap_staging',
      }),
    ).toEqual({
      environment: 'staging',
      url: 'postgres://pap_staging_app:staging_only@127.0.0.1:5432/pap_staging',
    });
  });

  it('accepts staging migrator configuration on IPv6 loopback with pap_staging_migrator', () => {
    expect(
      loadDatabaseConfig(
        {
          NODE_ENV: 'production',
          PAP_DATABASE_ENV: 'staging',
          DATABASE_URL: 'postgresql://pap_staging_migrator:staging_only@[::1]:5432/pap_staging',
        },
        { roleScope: 'migrator' },
      ),
    ).toEqual({
      environment: 'staging',
      url: 'postgresql://pap_staging_migrator:staging_only@[::1]:5432/pap_staging',
    });
  });

  it('rejects DDL migrator role in staging runtime scope', () => {
    expect(() =>
      loadDatabaseConfig({
        NODE_ENV: 'production',
        PAP_DATABASE_ENV: 'staging',
        DATABASE_URL: 'postgres://pap_staging_migrator:staging_only@127.0.0.1:5432/pap_staging',
      }),
    ).toThrow('Aplikacja runtime w środowisku staging nie może używać konta migracyjnego DDL');
  });

  it('rejects runtime role in staging migrator scope', () => {
    expect(() =>
      loadDatabaseConfig(
        {
          NODE_ENV: 'production',
          PAP_DATABASE_ENV: 'staging',
          DATABASE_URL: 'postgres://pap_staging_app:staging_only@127.0.0.1:5432/pap_staging',
        },
        { roleScope: 'migrator' },
      ),
    ).toThrow('Migracje w środowisku staging wymagają dedykowanego konta pap_staging_migrator');
  });

  it('rejects NODE_ENV=production with local or test database settings', () => {
    for (const [environment, user, dbName] of [
      ['local', 'pap_local', 'pap_local'],
      ['test', 'pap_test', 'pap_test'],
    ] as const) {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          PAP_DATABASE_ENV: environment,
          DATABASE_URL: `postgres://${user}:secret@127.0.0.1:5432/${dbName}`,
        }),
      ).toThrow(DatabaseConfigError);
    }
  });

  it.each([undefined, '', 'staging', 'preview', 'development', 'test'])(
    'rejects staging when NODE_ENV is not strictly production (%s)',
    (nodeEnv) => {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: nodeEnv,
          PAP_DATABASE_ENV: 'staging',
          DATABASE_URL: 'postgres://pap_staging_app:secret@127.0.0.1:5432/pap_staging',
        }),
      ).toThrow('Środowisko staging wymaga ustawienia NODE_ENV=production.');

      expect(() =>
        loadDatabaseConfig(
          {
            NODE_ENV: nodeEnv,
            PAP_DATABASE_ENV: 'staging',
            DATABASE_URL: 'postgres://pap_staging_migrator:secret@127.0.0.1:5432/pap_staging',
          },
          { roleScope: 'migrator' },
        ),
      ).toThrow('Środowisko staging wymaga ustawienia NODE_ENV=production.');
    },
  );

  it('rejects production and unspecified environments before opening a connection', () => {
    for (const environment of ['production', undefined]) {
      expect(() =>
        loadDatabaseConfig({
          PAP_DATABASE_ENV: environment,
          DATABASE_URL: 'postgres://pap_local_app:secret@127.0.0.1:5432/pap_local',
        }),
      ).toThrow(DatabaseConfigError);
    }
  });

  it('rejects remote hosts and ambiguous localhost hostname in staging', () => {
    for (const host of ['db.example.invalid', 'localhost', '10.0.0.1', '0.0.0.0']) {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: 'production',
          PAP_DATABASE_ENV: 'staging',
          DATABASE_URL: `postgres://pap_staging_app:secret@${host}:5432/pap_staging`,
        }),
      ).toThrow('loopback');
    }
  });

  it('rejects the wrong database, account, protocol, malformed URL, and connection options', () => {
    const cases = [
      ['local', 'postgres://pap_local_app:secret@127.0.0.1:5432/pap_test'],
      ['local', 'postgres://pap_local_app:secret@127.0.0.1:5432/pap_staging'],
      ['local', 'postgres://pap_staging_app:secret@127.0.0.1:5432/pap_local'],
      ['test', 'postgres://pap_local_app:secret@127.0.0.1:5432/pap_test'],
      ['test', 'postgres://pap_test_app:secret@127.0.0.1:5432/pap_local'],
      ['test', 'postgres://pap_test_app:secret@127.0.0.1:5432/pap_staging'],
      ['staging', 'postgres://pap_local_app:secret@127.0.0.1:5432/pap_staging'],
      ['staging', 'postgres://pap_test_app:secret@127.0.0.1:5432/pap_staging'],
      ['staging', 'postgres://postgres:secret@127.0.0.1:5432/pap_staging'],
      ['staging', 'postgres://pap_staging_app:secret@127.0.0.1:5432/pap_local'],
      ['staging', 'postgres://pap_staging_app:secret@127.0.0.1:5432/pap_test'],
      ['staging', 'postgres://pap_staging_app@127.0.0.1:5432/pap_staging'],
      ['staging', 'postgres://pap_staging_app:secret@127.0.0.1:5432/pap_staging?sslmode=disable'],
      ['test', 'https://pap_test:secret@127.0.0.1:5432/pap_test'],
      ['test', 'not-a-url'],
      ['test', 'postgres://pap_test_app:secret@127.0.0.1:5432/%ZZ'],
      ['test', 'postgres://pap_test@127.0.0.1:5432/pap_test'],
      ['test', 'postgres://pap_test_app:secret@127.0.0.1:5432/pap_test?sslmode=require'],
      ['test', 'postgres://pap_test_app:secret@127.0.0.1:5432/pap_test#fragment'],
      ['test', undefined],
    ] as const;

    for (const [environment, url] of cases) {
      expect(() =>
        loadDatabaseConfig({
          NODE_ENV: environment === 'staging' ? 'production' : undefined,
          PAP_DATABASE_ENV: environment,
          DATABASE_URL: url,
        }),
      ).toThrow(DatabaseConfigError);
    }
  });

  it('does not expose credentials in validation errors', () => {
    expect.assertions(3);
    try {
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'local',
        DATABASE_URL: 'postgres://pap_local_app:private-value@database.example.invalid/pap_local',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DatabaseConfigError);
      if (!(error instanceof DatabaseConfigError)) {
        throw error;
      }
      expect(error.message).not.toContain('private-value');
      expect(error.message).not.toContain('database.example.invalid');
    }
  });
});
