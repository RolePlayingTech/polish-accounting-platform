import { describe, expect, it } from 'vitest';
import { connectDatabase } from '../src/client.js';

describe('Opcje klienta PostgreSQL (bez otwierania połączenia)', () => {
  it.each([
    ['127.0.0.1', '127.0.0.1'],
    ['localhost', 'localhost'],
    ['[::1]', '::1'],
  ])('przekazuje poprawny host loopback %s do sterownika', async (urlHost, expectedHost) => {
    const { client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: `postgres://pap_test:test_only@${urlHost}:5433/pap_test`,
    });

    try {
      expect(client.options.host).toEqual([expectedHost]);
      expect(client.options.port).toEqual([5433]);
      expect(client.options.user).toBe('pap_test');
      expect(client.options.database).toBe('pap_test');
      expect(client.options.max).toBe(5);
      expect(client.options.connection.search_path).toBe('public,pg_catalog');
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it('pozwala jawnie ograniczyć rozmiar puli połączeń (np. maxConnections: 1) i odrzuca błędne limity', async () => {
    const env = {
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test:test_only@127.0.0.1:5432/pap_test',
    };
    const { client } = connectDatabase(env, 'public', { maxConnections: 1 });
    try {
      expect(client.options.max).toBe(1);
    } finally {
      await client.end({ timeout: 1 });
    }

    for (const invalidMax of [0, -1, 1.5, 101]) {
      expect(() => connectDatabase(env, 'public', { maxConnections: invalidMax })).toThrow(
        'Niepoprawny limit połączeń puli PostgreSQL.',
      );
    }
  });

  it('ustawia namespace testowy na wszystkich połączeniach puli', async () => {
    const dataSchema = 'pap_test_0123456789abcdef0123456789abcdef';
    const { client } = connectDatabase(
      {
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgres://pap_test:test_only@127.0.0.1:5432/pap_test',
      },
      dataSchema,
    );
    try {
      expect(client.options.connection.search_path).toBe(`${dataSchema},pg_catalog`);
    } finally {
      await client.end({ timeout: 1 });
    }
  });

  it.each(['pg_catalog', 'public,pg_catalog', 'public; DROP SCHEMA public', 'pap_test_short'])(
    'odrzuca niekontrolowany namespace %s',
    (dataSchema) => {
      expect(() =>
        connectDatabase(
          {
            PAP_DATABASE_ENV: 'test',
            DATABASE_URL: 'postgres://pap_test:test_only@127.0.0.1:5432/pap_test',
          },
          dataSchema,
        ),
      ).toThrow('Niedozwolony schemat');
    },
  );

  it('nie dopuszcza namespace testowego do konfiguracji local ani staging', () => {
    expect(() =>
      connectDatabase(
        {
          PAP_DATABASE_ENV: 'local',
          DATABASE_URL: 'postgres://pap_local:test_only@127.0.0.1:5432/pap_local',
        },
        'pap_test_0123456789abcdef0123456789abcdef',
      ),
    ).toThrow('Niedozwolony schemat');

    expect(() =>
      connectDatabase(
        {
          NODE_ENV: 'production',
          PAP_DATABASE_ENV: 'staging',
          DATABASE_URL: 'postgres://pap_staging_app:test_only@127.0.0.1:5432/pap_staging',
        },
        'pap_test_0123456789abcdef0123456789abcdef',
      ),
    ).toThrow('Niedozwolony schemat');
  });
});
