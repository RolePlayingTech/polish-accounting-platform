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
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
