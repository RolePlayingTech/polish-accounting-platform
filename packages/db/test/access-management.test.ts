import { legalEntityId, tenantId, userId } from '@pap/domain';
import {
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  executeAuthorizedCompanyAction,
  manageAccess,
  type AccessManagementCommand,
} from '@pap/application';
import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresAccessManagementStore } from '../src/access-management.js';
import { PostgresTransactionalUnitOfWork } from '../src/transactional-unit-of-work.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const target = { operationId: id(1), tenantId: tenantId(id(2)), userId: userId(id(3)) };
const now = '2026-10-28T12:00:00.123Z';

describe('Lifecycle i transakcyjna autoryzacja 6D-3A — rzeczywisty builder i kodowanie parametrów Drizzle', () => {
  it.each(['grant', 'revoke_membership'] as const)(
    '%s nie przekazuje Date do surowego parametru postgres.js',
    async (kind) => {
      const { db, client } = connectDatabase({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
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
        if (query.includes('from "app_user"')) {
          rows = [[id(6), 'active', null]];
        } else if (query.includes('from "legal_entity"')) {
          rows = [[id(5)]];
        } else if (query.includes('from "tenant_membership"')) {
          rows = [
            [
              target.tenantId,
              parameters[1],
              parameters[1] === id(6) ? 'tenant_owner' : 'tenant_member',
              'active',
              '2026-01-01T00:00:00.000Z',
              null,
            ],
          ];
        } else if (query.includes('clock_timestamp()')) {
          rows = [{ now }];
        }
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
        expect(
          await new PostgresAccessManagementStore(db).execute(command, { userId: userId(id(6)) }),
        ).toMatchObject({ ok: true, receipt: { occurredAt: now } });
        expect(rawDates).toEqual([]);
        expect(
          transport.mock.calls.some(
            ([query]) => query.includes('from "app_user"') && query.includes('for share'),
          ),
        ).toBe(true);
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

  it.each(['actor-lower', 'target-lower'] as const)(
    'manageAccess + PostgresAccessManagementStore buduje kanoniczny porządek blokad (%s) i kontekst sesji w 1 transakcji',
    async (ordering) => {
      const actorUuid = userId(ordering === 'actor-lower' ? id(10) : id(90));
      const targetUuid = userId(ordering === 'actor-lower' ? id(20) : id(15));
      const entityUuid = legalEntityId(id(5));
      const tenantUuid = tenantId(id(2));

      const { db, client } = connectDatabase({
        PAP_DATABASE_ENV: 'test',
        DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
      });

      let beginCount = 0;
      vi.spyOn(client, 'begin').mockImplementation((async (
        callback: (sql: typeof client) => Promise<unknown>,
      ) => {
        beginCount += 1;
        return callback(client);
      }) as unknown as typeof client.begin);

      const membershipLockOrder: Array<{ userParam: unknown; mode: 'share' | 'update' }> = [];
      const executedQueries: string[] = [];

      vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
        for (const parameter of parameters) {
          if (parameter instanceof Date) {
            throw new Error('Niezakodowany parametr Date.');
          }
        }
        executedQueries.push(query);

        let rows: unknown[] = [];
        if (query.includes('from "app_user"')) {
          rows = [[actorUuid, 'active', null]];
        } else if (query.includes('from "user_oidc_identity"')) {
          rows = [[id(77), actorUuid, 'https://idp.example.test', 'admin-sub', 'active', null]];
        } else if (query.includes('from "tenant_membership"')) {
          const requestedUser = parameters[1];
          if (query.includes('for share')) {
            membershipLockOrder.push({ userParam: requestedUser, mode: 'share' });
          } else if (query.includes('for update')) {
            membershipLockOrder.push({ userParam: requestedUser, mode: 'update' });
          }
          rows =
            requestedUser === actorUuid
              ? [
                  [
                    tenantUuid,
                    actorUuid,
                    'tenant_admin',
                    'active',
                    '2026-01-01T00:00:00.000Z',
                    null,
                  ],
                ]
              : [
                  [
                    tenantUuid,
                    targetUuid,
                    'tenant_member',
                    'active',
                    '2026-01-01T00:00:00.000Z',
                    null,
                  ],
                ];
        } else if (query.includes('from "legal_entity"')) {
          rows = [[entityUuid]];
        } else if (query.includes('from "company_access_grant"') && query.includes('for share')) {
          rows = [
            [
              id(80),
              tenantUuid,
              actorUuid,
              entityUuid,
              'read',
              '2026-01-01T00:00:00.000Z',
              null,
              null,
            ],
          ];
        } else if (query.includes('clock_timestamp()')) {
          rows = [{ now }];
        }

        const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
        return result as unknown as ReturnType<typeof client.unsafe>;
      });

      try {
        const store = new PostgresAccessManagementStore(db);
        const authorizer = createTenantAccessManagementAuthorizer();
        const actors = createOidcAccessManagementActorSource('valid.jwt.token', {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true,
              identity: { issuer: 'https://idp.example.test', subject: 'admin-sub' },
            }),
          },
          identityResolver: {
            resolveVerifiedIdentity: async () => ({ userId: actorUuid }),
          },
        });

        const result = await manageAccess(
          {
            kind: 'grant',
            operationId: id(100),
            tenantId: tenantUuid,
            userId: targetUuid,
            grantId: id(101),
            legalEntityId: entityUuid,
            action: 'read',
            validFrom: null,
            validUntil: null,
          },
          { store, actors, authorizer },
        );

        expect(result).toEqual({
          ok: true,
          receipt: {
            operationId: id(100),
            occurredAt: now,
            changed: true,
            grantId: id(101),
          },
        });

        // Dokładnie jedna transakcja DB obejmująca rewalidację konta, autoryzację, kontekst sesji, mutację i audyt
        expect(beginCount).toBe(1);

        // Wiersze tenant_membership zawsze blokowane w kolejności rosnącego UUID user_id
        if (ordering === 'actor-lower') {
          expect(membershipLockOrder).toEqual([
            { userParam: actorUuid, mode: 'share' },
            { userParam: targetUuid, mode: 'update' },
          ]);
        } else {
          expect(membershipLockOrder).toEqual([
            { userParam: targetUuid, mode: 'update' },
            { userParam: actorUuid, mode: 'share' },
          ]);
        }

        expect(
          executedQueries.some(
            (q) => q.includes('from "user_oidc_identity"') && q.includes('for share'),
          ),
        ).toBe(true);
        expect(
          executedQueries.some(
            (q) =>
              q.includes('from "company_access_grant"') &&
              q.includes('order by') &&
              q.includes('for share'),
          ),
        ).toBe(true);
        expect(executedQueries.some((q) => q.includes("set_config('pap.current_tenant_id'"))).toBe(
          true,
        );
      } finally {
        vi.restoreAllMocks();
        await client.end({ timeout: 1 });
      }
    },
  );

  it('PostgresTransactionalUnitOfWork wymusza fizyczny rollback (odrzucenie begin), gdy autoryzacja odmawia', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    let beginRolledBack = false;
    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => {
      try {
        return await callback(client);
      } catch (error) {
        beginRolledBack = true;
        throw error;
      }
    }) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query) => {
      let rows: unknown[] = [];
      if (query.includes('from "app_user"')) {
        // Konto wyłączone między krokiem 1 (OIDC) a krokiem 3 (wewnątrz transakcji)
        rows = [[id(31), 'disabled', '2026-10-28T11:00:00.000Z']];
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const uow = new PostgresTransactionalUnitOfWork(db);
      const operation = vi.fn();

      const decision = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid.jwt.token',
          tenantId: tenantId(id(2)),
          legalEntityId: legalEntityId(id(5)),
          action: 'read',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-31' },
            }),
          },
          identityResolver: {
            resolveVerifiedIdentity: async () => ({ userId: userId(id(31)) }),
          },
          unitOfWork: uow,
        },
        operation,
      );

      expect(beginRolledBack).toBe(true);
      expect(operation).not.toHaveBeenCalled();
      expect(decision).toEqual({
        allowed: false,
        status: 'forbidden',
        reason: 'identity_not_provisioned_or_disabled',
      });
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });
});
