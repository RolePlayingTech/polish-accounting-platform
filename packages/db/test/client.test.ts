import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { DatabaseConfigError } from '../src/database-config.js';

vi.mock('postgres', () => ({ default: vi.fn() }));

describe('connectDatabase', () => {
  it.each([
    {
      NODE_ENV: 'production',
      PAP_DATABASE_ENV: 'local',
      DATABASE_URL: 'postgres://pap_local:test_only@127.0.0.1/pap_local',
    },
    {
      PAP_DATABASE_ENV: 'production',
      DATABASE_URL: 'postgres://pap_test:test_only@127.0.0.1/pap_test',
    },
    {
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test:test_only@database.example.invalid/pap_test',
    },
    { PAP_DATABASE_ENV: 'test', DATABASE_URL: 'postgres://pap_test:test_only@127.0.0.1/pap_local' },
    { PAP_DATABASE_ENV: 'test', DATABASE_URL: 'postgres://postgres:test_only@127.0.0.1/pap_test' },
    {
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL:
        'postgres://pap_test:test_only@127.0.0.1/pap_test?host=database.example.invalid',
    },
  ])('odrzuca konfigurację przed utworzeniem klienta PostgreSQL', (environment) => {
    expect(() => connectDatabase(environment)).toThrow(DatabaseConfigError);
    expect(postgres).not.toHaveBeenCalled();
  });
});
