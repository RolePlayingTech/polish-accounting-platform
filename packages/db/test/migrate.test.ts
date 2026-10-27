import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION_RUNNER = fileURLToPath(new URL('../src/migrate.ts', import.meta.url));
const PASSWORD = 'synthetic-password-must-not-be-logged';

describe('Runner migracji — odmowy i bezpieczne logi', () => {
  it.each([
    ['production', 'test', 'pap_test', '127.0.0.1', 'pap_test', 'NODE_ENV=production'],
    ['test', 'test', 'pap_test', 'database.example.invalid', 'pap_test', 'loopback'],
    ['test', 'test', 'postgres', '127.0.0.1', 'pap_test', 'dedykowanego konta'],
    ['test', 'test', 'pap_test', '127.0.0.1', 'pap_local', 'dedykowanej bazy'],
  ])(
    'odrzuca %s/%s/%s/%s/%s bez ujawniania adresu lub hasła',
    (nodeEnvironment, databaseEnvironment, user, host, database, expectedMessage) => {
      const url = `postgres://${user}:${PASSWORD}@${host}:5432/${database}`;
      const result = spawnSync(process.execPath, ['--import', 'tsx', MIGRATION_RUNNER], {
        env: {
          ...process.env,
          NODE_ENV: nodeEnvironment,
          PAP_DATABASE_ENV: databaseEnvironment,
          DATABASE_URL: url,
        },
        encoding: 'utf8',
        timeout: 10_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(expectedMessage);
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(url);
      expect(output).not.toContain(PASSWORD);
      expect(output).not.toContain('Migracje bazy zostały zastosowane.');
    },
  );
});
