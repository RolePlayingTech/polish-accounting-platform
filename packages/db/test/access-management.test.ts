import { legalEntityId, tenantId, userId } from '@pap/domain';
import type { AccessManagementCommand } from '@pap/application';
import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresAccessManagementStore } from '../src/access-management.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const target = { operationId: id(1), tenantId: tenantId(id(2)), userId: userId(id(3)) };
const now = '2026-10-28T12:00:00.123Z';
describe('Lifecycle — rzeczywisty builder i kodowanie parametrów Drizzle', () => {
  it.each(['grant', 'revoke_membership'] as const)(
    '%s nie przekazuje Date do surowego parametru postgres.js',
    async (kind) => {
      const { db, client } = connectDatabase({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgres://pap_test:synthetic_only@127.0.0.1:5432/pap_test',
      });
      // Zastąpiony transport: Drizzle rzeczywiście buduje transakcję i zapytania.
      vi.spyOn(client, 'begin').mockImplementation((async (
        callback: (sql: typeof client) => Promise<unknown>,
      ) => callback(client)) as unknown as typeof client.begin);
      const rawDates: unknown[] = [];
      const transport = vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
        for (const parameter of parameters) if (parameter instanceof Date) rawDates.push(parameter);
        // Drizzle wyłącza serializator dat postgres.js; surowy Date nie jest poprawnym parametrem.
        if (rawDates.length) throw new Error('Niezakodowany parametr Date.');
        let rows: unknown[] = [];
        if (query.includes('for update'))
          rows = [
            [
              target.tenantId,
              target.userId,
              'tenant_member',
              'active',
              '2026-01-01T00:00:00.000Z',
              null,
            ],
          ];
        else if (query.includes('clock_timestamp()')) rows = [{ now }];
        const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
        return result as unknown as ReturnType<typeof client.unsafe>;
      });
      try {
        const command: AccessManagementCommand =
          kind === 'grant'
            ? {
                ...target,
                kind,
                grantId: id(4),
                legalEntityId: legalEntityId(id(5)),
                action: 'read',
                validFrom: null,
                validUntil: null,
              }
            : { ...target, kind };
        // Firma musi istnieć w syntetycznym wyniku SELECT.
        const original = transport.getMockImplementation()!;
        transport.mockImplementation((query, params = [], options) =>
          query.includes('from "legal_entity"')
            ? (Object.assign(Promise.resolve([]), {
                values: async () => [[id(5)]],
              }) as unknown as ReturnType<typeof client.unsafe>)
            : original(query, params, options),
        );
        expect(
          await new PostgresAccessManagementStore(db).execute(command, { userId: userId(id(6)) }),
        ).toMatchObject({ ok: true, receipt: { occurredAt: now } });
        expect(rawDates).toEqual([]);
        expect(
          transport.mock.calls.some(([query]) =>
            query.includes('insert into "access_management_event"'),
          ),
        ).toBe(true);
      } finally {
        vi.restoreAllMocks();
        await client.end({ timeout: 1 });
      }
    },
  );
});
