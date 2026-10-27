import { describe, expect, it } from 'vitest';
import { DatabaseConfigError, loadDatabaseConfig } from '../src/database-config.js';

describe('loadDatabaseConfig', () => {
  it('accepts the dedicated local database on loopback', () => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'local',
        DATABASE_URL: 'postgres://pap_local:local_only@127.0.0.1:5432/pap_local',
      }),
    ).toEqual({
      environment: 'local',
      url: 'postgres://pap_local:local_only@127.0.0.1:5432/pap_local',
    });
  });

  it('accepts the dedicated test database on loopback', () => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgresql://pap_test:test_only@localhost:5433/pap_test',
      }).environment,
    ).toBe('test');
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('accepts loopback host %s', (host) => {
    expect(
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: `postgres://pap_test:test_only@${host}/pap_test`,
      }).url,
    ).toContain(':5432/pap_test');
  });

  it('rejects NODE_ENV=production even with local database settings', () => {
    expect(() =>
      loadDatabaseConfig({
        NODE_ENV: 'production',
        PAP_DATABASE_ENV: 'local',
        DATABASE_URL: 'postgres://pap_local:local_only@127.0.0.1:5432/pap_local',
      }),
    ).toThrow(DatabaseConfigError);
  });

  it('rejects production and unspecified environments before opening a connection', () => {
    for (const environment of ['production', undefined]) {
      expect(() =>
        loadDatabaseConfig({
          PAP_DATABASE_ENV: environment,
          DATABASE_URL: 'postgres://pap_local:secret@127.0.0.1:5432/pap_local',
        }),
      ).toThrow(DatabaseConfigError);
    }
  });

  it('rejects remote hosts even when the URL uses the test database name', () => {
    expect(() =>
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgres://pap_test:test_only@db.example.invalid:5432/pap_test',
      }),
    ).toThrow('loopback');
  });

  it('rejects the wrong database, account, protocol, malformed URL, and connection options', () => {
    const cases = [
      ['local', 'postgres://pap_local:secret@127.0.0.1:5432/pap_test'],
      ['test', 'postgres://pap_local:secret@127.0.0.1:5432/pap_test'],
      ['test', 'postgres://pap_test:secret@127.0.0.1:5432/pap_local'],
      ['test', 'https://pap_test:secret@127.0.0.1:5432/pap_test'],
      ['test', 'not-a-url'],
      ['test', 'postgres://pap_test:secret@127.0.0.1:5432/%ZZ'],
      ['test', 'postgres://pap_test@127.0.0.1:5432/pap_test'],
      ['test', 'postgres://pap_test:secret@127.0.0.1:5432/pap_test?sslmode=require'],
      ['test', 'postgres://pap_test:secret@127.0.0.1:5432/pap_test#fragment'],
      ['test', undefined],
    ] as const;

    for (const [environment, url] of cases) {
      expect(() =>
        loadDatabaseConfig({ PAP_DATABASE_ENV: environment, DATABASE_URL: url }),
      ).toThrow(DatabaseConfigError);
    }
  });

  it('does not expose credentials in validation errors', () => {
    expect.assertions(3);
    try {
      loadDatabaseConfig({
        PAP_DATABASE_ENV: 'local',
        DATABASE_URL: 'postgres://pap_local:private-value@database.example.invalid/pap_local',
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
