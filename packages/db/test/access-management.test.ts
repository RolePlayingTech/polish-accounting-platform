import { legalEntityId, tenantId, userId } from '@pap/domain';
import {
  ConfirmedTransactionRollbackError,
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  executeAuthorizedCompanyAction,
  isConfirmedTransactionRollbackError,
  isTransactionOutcomeUnknownError,
  manageAccess,
  TransactionOutcomeUnknownError,
  type AccessManagementCommand,
  type AccessManagementReceipt,
  type AccessManagementResult,
} from '@pap/application';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresAccessManagementStore } from '../src/access-management.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { runManagedTransaction } from '../src/transaction-primitives.js';
import { PostgresTransactionalUnitOfWork } from '../src/transactional-unit-of-work.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const target = { operationId: id(1), tenantId: tenantId(id(2)), userId: userId(id(3)) };
const now = '2026-10-28T12:00:00.123Z';

const CONTEXT_BINDING_ROW = {
  xid: '1001',
  pid: 42,
  database: 'pap_test',
  role: 'pap_test_app',
  expires: '9999999999999',
};

const createTestSigner = () =>
  new PostgresContextSigner({ keyId: 'test-key-1', keyHex: 'ab'.repeat(32) });

interface SignedContextPayload {
  readonly purpose: string;
  readonly actor_user_id?: string;
  readonly tenant_id?: string;
  readonly legal_entity_id?: string;
  readonly target_user_id?: string;
  readonly decision_at?: string;
  readonly command?: AccessManagementCommand;
}

interface PersistedAccessEventRecord {
  readonly operationId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly actorId: string;
  readonly requestKey: string;
  readonly occurredAt: string;
  readonly receipt: AccessManagementReceipt;
}

const FORBIDDEN_DIRECT_ACCESS_DML = [
  'insert into "company_access_grant"',
  'update "company_access_grant"',
  'update "tenant_membership"',
  'insert into "access_management_event"',
] as const;

function hasForbiddenDirectAccessDml(queries: readonly string[]): boolean {
  return queries.some((q) => {
    const lower = q.toLowerCase();
    return FORBIDDEN_DIRECT_ACCESS_DML.some((pattern) => lower.includes(pattern));
  });
}

describe('Lifecycle i transakcyjna autoryzacja 6D-3A/SEC-01/02/03 — kontrolowany executor SQL pap_execute_access() i Drizzle', () => {
  it.each(['grant', 'revoke_membership'] as const)(
    '%s wykonuje SELECT pap_execute_access() AS result z podpisanym kontekstem bez surowego DML i bez niezakodowanego Date',
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
      const executedQueries: string[] = [];
      let lastSignedContext = null as SignedContextPayload | null;
      const transport = vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
        for (const parameter of parameters) if (parameter instanceof Date) rawDates.push(parameter);
        // Drizzle wyłącza serializator dat postgres.js; surowy Date nie jest poprawnym parametrem.
        if (rawDates.length) throw new Error('Niezakodowany parametr Date.');
        executedQueries.push(query);
        let rows: unknown[] = [];
        if (query.includes('pg_current_xact_id()')) {
          rows = [CONTEXT_BINDING_ROW];
        } else if (query.includes("set_config('pap.context'")) {
          const rawPayload = parameters[0];
          if (typeof rawPayload === 'string') {
            lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
          }
        } else if (query.includes('pap_execute_access()')) {
          expect(lastSignedContext?.purpose).toBe('access');
          const cmd = lastSignedContext?.command;
          expect(cmd?.operationId).toBe(target.operationId);
          const result: AccessManagementResult = {
            ok: true,
            receipt: {
              operationId: target.operationId,
              occurredAt: lastSignedContext?.decision_at ?? now,
              changed: true,
              grantId: cmd?.kind === 'grant' ? cmd.grantId : null,
            },
          };
          rows = [{ result }];
        } else if (query.includes('from "app_user"')) {
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
        } else if (query.includes('from "access_management_event"')) {
          rows = [];
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
          await new PostgresAccessManagementStore(db, createTestSigner()).execute(command, {
            userId: userId(id(6)),
          }),
        ).toEqual({
          ok: true,
          receipt: {
            operationId: target.operationId,
            occurredAt: now,
            changed: true,
            grantId: kind === 'grant' ? id(4) : null,
          },
        });
        expect(rawDates).toEqual([]);
        expect(
          transport.mock.calls.some(
            ([query]) => query.includes('from "app_user"') && query.includes('for share'),
          ),
        ).toBe(true);
        expect(
          transport.mock.calls.some(([query]) =>
            query.includes('SELECT pap_execute_access() AS result'),
          ),
        ).toBe(true);
        expect(
          transport.mock.calls.some(([query]) =>
            query.includes('insert into "security_decision_event"'),
          ),
        ).toBe(true);
        expect(hasForbiddenDirectAccessDml(executedQueries)).toBe(false);
      } finally {
        vi.restoreAllMocks();
        await client.end({ timeout: 1 });
      }
    },
  );

  it.each(['actor-lower', 'target-lower'] as const)(
    'manageAccess + PostgresAccessManagementStore buduje kanoniczny porządek blokad (%s), kontekst sesji i wywołuje pap_execute_access() w 1 transakcji',
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
      let lastSignedContext = null as SignedContextPayload | null;

      vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
        for (const parameter of parameters) {
          if (parameter instanceof Date) {
            throw new Error('Niezakodowany parametr Date.');
          }
        }
        executedQueries.push(query);

        let rows: unknown[] = [];
        if (query.includes('pg_current_xact_id()')) {
          rows = [CONTEXT_BINDING_ROW];
        } else if (query.includes("set_config('pap.context'")) {
          const rawPayload = parameters[0];
          if (typeof rawPayload === 'string') {
            lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
          }
        } else if (query.includes('pap_execute_access()')) {
          expect(lastSignedContext?.purpose).toBe('access');
          const cmd = lastSignedContext?.command;
          expect(cmd).toMatchObject({
            kind: 'grant',
            operationId: id(100),
            tenantId: tenantUuid,
            userId: targetUuid,
            grantId: id(101),
            legalEntityId: entityUuid,
            action: 'read',
          });
          rows = [
            {
              result: {
                ok: true,
                receipt: {
                  operationId: id(100),
                  occurredAt: lastSignedContext?.decision_at ?? now,
                  changed: true,
                  grantId: id(101),
                },
              } satisfies AccessManagementResult,
            },
          ];
        } else if (query.includes('from "app_user"')) {
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
        } else if (query.includes('from "access_management_event"')) {
          rows = [];
        } else if (query.includes('clock_timestamp()')) {
          rows = [{ now }];
        }

        const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
        return result as unknown as ReturnType<typeof client.unsafe>;
      });

      try {
        const store = new PostgresAccessManagementStore(db, createTestSigner());
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

        // Dokładnie jedna transakcja DB obejmująca rewalidację konta, autoryzację, kontekst sesji, pap_execute_access() i audyt
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
        expect(
          executedQueries.some((q) => q.includes('SELECT pap_execute_access() AS result')),
        ).toBe(true);
        expect(hasForbiddenDirectAccessDml(executedQueries)).toBe(false);
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

  it('PostgresAccessManagementStore odmawia autoryzacji bez wywołania pap_execute_access(), wycofuje transakcję i zapisuje audyt deny/denied', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    const memberActorUuid = userId(id(40));
    const disabledActorUuid = userId(id(41));
    const targetUuid = userId(id(3));
    const tenantUuid = tenantId(id(2));
    const entityUuid = legalEntityId(id(5));

    let abortedBeginCount = 0;
    let executorCalls = 0;
    const executedQueries: string[] = [];
    const securityAuditRows: Array<{
      accessManagementOperationId: unknown;
      decision: unknown;
      outcome: unknown;
      reason: unknown;
    }> = [];

    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => {
      try {
        return await callback(client);
      } catch (error) {
        abortedBeginCount += 1;
        throw error;
      }
    }) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      executedQueries.push(query);
      let rows: unknown[] = [];
      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes('pap_execute_access()')) {
        executorCalls += 1;
      } else if (query.includes('from "app_user"')) {
        const requestedActor = parameters[0];
        rows =
          requestedActor === disabledActorUuid
            ? [[disabledActorUuid, 'disabled', '2026-10-28T11:00:00.000Z']]
            : [[memberActorUuid, 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            tenantUuid,
            parameters[1],
            'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('insert into "security_decision_event"')) {
        securityAuditRows.push({
          accessManagementOperationId: parameters[3],
          decision: parameters[10],
          outcome: parameters[11],
          reason: parameters[12],
        });
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const store = new PostgresAccessManagementStore(db, createTestSigner());

      const deniedRoleResult = await store.execute(
        {
          kind: 'grant',
          operationId: id(710),
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(711),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: memberActorUuid },
      );

      const deniedDisabledResult = await store.execute(
        {
          kind: 'revoke_membership',
          operationId: id(712),
          tenantId: tenantUuid,
          userId: targetUuid,
        },
        { userId: disabledActorUuid },
      );

      expect(deniedRoleResult).toEqual({ ok: false, reason: 'access_management_denied' });
      expect(deniedDisabledResult).toEqual({ ok: false, reason: 'access_management_denied' });
      expect(executorCalls).toBe(0);
      expect(abortedBeginCount).toBe(2);
      expect(hasForbiddenDirectAccessDml(executedQueries)).toBe(false);
      expect(securityAuditRows).toEqual([
        {
          accessManagementOperationId: null,
          decision: 'deny',
          outcome: 'denied',
          reason: 'access_management_denied',
        },
        {
          accessManagementOperationId: null,
          decision: 'deny',
          outcome: 'denied',
          reason: 'access_management_denied',
        },
      ]);
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });

  it('PostgresAccessManagementStore odrzuca konflikt operationId w pap_execute_access() oraz konflikt klucza 23505 przez potwierdzony rollback i zapisuje allow/rolled_back', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    const actorUuid = userId(id(6));
    const targetUuid = userId(id(3));
    const tenantUuid = tenantId(id(2));
    const entityUuid = legalEntityId(id(5));
    const opId = id(720);

    const persistedEvents = new Map<string, PersistedAccessEventRecord>();
    let executorMutationCount = 0;
    let simulateDuplicateGrantKeyOnce = false;
    let lastSignedContext = null as SignedContextPayload | null;
    const executedQueries: string[] = [];
    const securityAuditRows: Array<{
      accessManagementOperationId: unknown;
      decision: unknown;
      outcome: unknown;
      reason: unknown;
    }> = [];

    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => callback(client)) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      executedQueries.push(query);
      let rows: unknown[] = [];
      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes("set_config('pap.context'")) {
        const rawPayload = parameters[0];
        if (typeof rawPayload === 'string') {
          lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
        }
      } else if (query.includes('pap_execute_access()')) {
        if (simulateDuplicateGrantKeyOnce) {
          simulateDuplicateGrantKeyOnce = false;
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint_name: 'company_access_grant_pkey',
          });
        }
        const cmd = lastSignedContext?.command!;
        const actor = lastSignedContext?.actor_user_id!;
        const decisionAt = lastSignedContext?.decision_at ?? now;
        const serializedCommand = JSON.stringify(cmd);
        const existing = persistedEvents.get(cmd.operationId);
        if (existing) {
          if (
            existing.tenantId !== cmd.tenantId ||
            existing.userId !== cmd.userId ||
            existing.actorId !== actor ||
            existing.requestKey !== serializedCommand
          ) {
            rows = [{ result: { ok: false, reason: 'operation_conflict' } satisfies AccessManagementResult }];
          } else {
            rows = [{ result: { ok: true, receipt: existing.receipt } satisfies AccessManagementResult }];
          }
        } else {
          executorMutationCount += 1;
          const receipt: AccessManagementReceipt = {
            operationId: cmd.operationId,
            occurredAt: decisionAt,
            changed: true,
            grantId: cmd.kind === 'grant' ? cmd.grantId : null,
          };
          persistedEvents.set(cmd.operationId, {
            operationId: cmd.operationId,
            tenantId: cmd.tenantId,
            userId: cmd.userId,
            actorId: actor,
            requestKey: serializedCommand,
            occurredAt: decisionAt,
            receipt,
          });
          rows = [{ result: { ok: true, receipt } satisfies AccessManagementResult }];
        }
      } else if (query.includes('from "app_user"')) {
        rows = [[actorUuid, 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            tenantUuid,
            parameters[1],
            parameters[1] === actorUuid ? 'tenant_owner' : 'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('from "legal_entity"')) {
        rows = [[entityUuid]];
      } else if (query.includes('from "access_management_event"')) {
        const lookupOpId = typeof parameters[0] === 'string' ? parameters[0] : '';
        const found = persistedEvents.get(lookupOpId);
        rows = found
          ? [[found.actorId, found.tenantId, found.userId, found.requestKey, found.occurredAt]]
          : [];
      } else if (query.includes('insert into "security_decision_event"')) {
        securityAuditRows.push({
          accessManagementOperationId: parameters[3],
          decision: parameters[10],
          outcome: parameters[11],
          reason: parameters[12],
        });
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const store = new PostgresAccessManagementStore(db, createTestSigner());

      const initialGrant = await store.execute(
        {
          kind: 'grant',
          operationId: opId,
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(721),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );
      expect(initialGrant).toMatchObject({ ok: true, receipt: { operationId: opId, grantId: id(721) } });
      expect(executorMutationCount).toBe(1);

      // Ten sam operationId z inną komendą (action: 'write' zamiast 'read') -> operation_conflict w pap_execute_access()
      const conflictingOperation = await store.execute(
        {
          kind: 'grant',
          operationId: opId,
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(721),
          legalEntityId: entityUuid,
          action: 'write',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );
      expect(conflictingOperation).toEqual({ ok: false, reason: 'operation_conflict' });
      expect(executorMutationCount).toBe(1);

      // Konflikt klucza głównego grant_id (23505) w pap_execute_access() -> potwierdzony rollback i operation_conflict
      simulateDuplicateGrantKeyOnce = true;
      const duplicateGrantKey = await store.execute(
        {
          kind: 'grant',
          operationId: id(722),
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(721),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );
      expect(duplicateGrantKey).toEqual({ ok: false, reason: 'operation_conflict' });
      expect(hasForbiddenDirectAccessDml(executedQueries)).toBe(false);
      expect(securityAuditRows).toEqual([
        {
          accessManagementOperationId: opId,
          decision: 'allow',
          outcome: 'committed',
          reason: 'authorized_tenant_administration',
        },
        {
          accessManagementOperationId: null,
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'operation_conflict',
        },
        {
          accessManagementOperationId: null,
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'operation_conflict',
        },
      ]);
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });

  it('PostgresAccessManagementStore wycofuje transakcję przy błędzie audytu po pap_execute_access() i zwraca fail-closed authorization_audit_unavailable', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    const actorUuid = userId(id(6));
    const targetUuid = userId(id(3));
    const tenantUuid = tenantId(id(2));
    const entityUuid = legalEntityId(id(5));

    const committedEvents = new Map<string, PersistedAccessEventRecord>();
    const committedAuditRows: Array<{
      accessManagementOperationId: unknown;
      decision: unknown;
      outcome: unknown;
      reason: unknown;
    }> = [];
    let stagedEvent = null as PersistedAccessEventRecord | null;
    let stagedAuditRows: typeof committedAuditRows = [];
    let failAuditMode: 'once' | 'always' = 'once';
    let lastSignedContext = null as SignedContextPayload | null;

    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => {
      stagedEvent = null;
      stagedAuditRows = [];
      const res = await callback(client);
      if (stagedEvent) {
        committedEvents.set(stagedEvent.operationId, stagedEvent);
      }
      committedAuditRows.push(...stagedAuditRows);
      return res;
    }) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      let rows: unknown[] = [];
      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes("set_config('pap.context'")) {
        const rawPayload = parameters[0];
        if (typeof rawPayload === 'string') {
          lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
        }
      } else if (query.includes('pap_execute_access()')) {
        const cmd = lastSignedContext?.command!;
        const decisionAt = lastSignedContext?.decision_at ?? now;
        const receipt: AccessManagementReceipt = {
          operationId: cmd.operationId,
          occurredAt: decisionAt,
          changed: true,
          grantId: cmd.kind === 'grant' ? cmd.grantId : null,
        };
        stagedEvent = {
          operationId: cmd.operationId,
          tenantId: cmd.tenantId,
          userId: cmd.userId,
          actorId: lastSignedContext?.actor_user_id ?? actorUuid,
          requestKey: JSON.stringify(cmd),
          occurredAt: decisionAt,
          receipt,
        };
        rows = [{ result: { ok: true, receipt } satisfies AccessManagementResult }];
      } else if (query.includes('from "app_user"')) {
        rows = [[actorUuid, 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            tenantUuid,
            parameters[1],
            parameters[1] === actorUuid ? 'tenant_owner' : 'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('from "legal_entity"')) {
        rows = [[entityUuid]];
      } else if (query.includes('from "access_management_event"')) {
        rows = [];
      } else if (query.includes('insert into "security_decision_event"')) {
        if (failAuditMode === 'once') {
          failAuditMode = 'always';
          // Symulujemy błąd atomowego audytu w TX, po którym pozwalamy przejść diagnostycznemu audytowi po rollbacku
          throw new Error('INSERT INTO security_decision_event failed -- secret');
        }
        if (failAuditMode === 'always' && committedAuditRows.length >= 1) {
          throw new Error('audit storage down');
        }
        stagedAuditRows.push({
          accessManagementOperationId: parameters[3],
          decision: parameters[10],
          outcome: parameters[11],
          reason: parameters[12],
        });
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const store = new PostgresAccessManagementStore(db, createTestSigner());

      // 1) Błąd atomowego audytu po pap_execute_access() wycofuje całą transakcję (efekt nie zostaje utrwalony)
      const firstResult = await store.execute(
        {
          kind: 'grant',
          operationId: id(730),
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(731),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );

      expect(firstResult).toEqual({ ok: false, reason: 'authorization_audit_unavailable' });
      expect(committedEvents.size).toBe(0);
      expect(committedAuditRows).toEqual([
        {
          accessManagementOperationId: null,
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'authorization_audit_unavailable',
        },
      ]);

      // 2) Całkowita niedostępność audytu także poza transakcją nadal zwraca fail-closed authorization_audit_unavailable
      const secondResult = await store.execute(
        {
          kind: 'grant',
          operationId: id(732),
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(733),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );

      expect(secondResult).toEqual({ ok: false, reason: 'authorization_audit_unavailable' });
      expect(committedEvents.size).toBe(0);
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });

  it('SEC-03: runManagedTransaction rozróżnia potwierdzony ROLLBACK (przed COMMIT i przy serwerowym 23514/40001) od niepewnego wyniku (08007, 40003, 57P01, FATAL, zerwane gniazdo)', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    vi.spyOn(client, 'unsafe').mockImplementation(() => {
      const result = Object.assign(Promise.resolve([]), { values: async () => [] });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    const beginSpy = vi.spyOn(client, 'begin');

    try {
      // 1) Awaria przed wejściem do callbacku nie dowodzi potwierdzenia ROLLBACK.
      beginSpy.mockImplementationOnce((async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      }) as unknown as typeof client.begin);
      await expect(
        runManagedTransaction(
          db,
          async () => 'ok',
          () => true,
        ),
      ).rejects.toSatisfy(isTransactionOutcomeUnknownError);

      // 2) Błąd w callbacku + potwierdzony ROLLBACK (postgres.js rethrowuje wyjątek z callbacku po `await sql\`rollback\``)
      beginSpy.mockImplementationOnce((async (callback: (sql: typeof client) => Promise<unknown>) =>
        callback(client)) as unknown as typeof client.begin);
      const callbackErr = new Error('błąd przed COMMIT');
      await expect(
        runManagedTransaction(
          db,
          async () => {
            throw callbackErr;
          },
          () => true,
        ),
      ).rejects.toSatisfy(
        (err: unknown) =>
          isConfirmedTransactionRollbackError(err) &&
          (err as ConfirmedTransactionRollbackError).cause === callbackErr,
      );

      // 3) Błąd w callbacku, ale zerwane połączenie podczas `ROLLBACK` -> TransactionOutcomeUnknownError
      beginSpy.mockImplementationOnce((async (
        callback: (sql: typeof client) => Promise<unknown>,
      ) => {
        try {
          return await callback(client);
        } catch {
          throw Object.assign(new Error('CONNECTION_CLOSED podczas ROLLBACK'), {
            code: 'CONNECTION_CLOSED',
          });
        }
      }) as unknown as typeof client.begin);
      await expect(
        runManagedTransaction(
          db,
          async () => {
            throw new Error('błąd przed COMMIT');
          },
          () => true,
        ),
      ).rejects.toSatisfy(isTransactionOutcomeUnknownError);

      // 4) Odroczony constraint trigger PostgreSQL (23514) oraz serialization_failure (40001) o severity = 'ERROR' na COMMIT -> ConfirmedTransactionRollbackError
      for (const code of ['23514', '40001']) {
        beginSpy.mockImplementationOnce((async (
          callback: (sql: typeof client) => Promise<unknown>,
        ) => {
          await callback(client);
          throw new postgres.PostgresError({
            severity_local: 'BŁĄD',
            severity: 'ERROR',
            code,
            message: 'Transakcja odrzucona przez serwer na COMMIT',
          } as never);
        }) as unknown as typeof client.begin);

        await expect(
          runManagedTransaction(
            db,
            async () => 'done',
            () => true,
          ),
        ).rejects.toSatisfy(isConfirmedTransactionRollbackError);
      }

      // 5) Niepewne błędy podczas COMMIT: 08007, 40003, 57P01, FATAL oraz zerwane gniazdo TCP -> TransactionOutcomeUnknownError
      for (const uncertainCommitError of [
        new postgres.PostgresError({
          severity_local: 'ERROR',
          severity: 'ERROR',
          code: '08007',
          message: 'transaction_resolution_unknown',
        } as never),
        new postgres.PostgresError({
          severity_local: 'ERROR',
          severity: 'ERROR',
          code: '40003',
          message: 'statement_completion_unknown',
        } as never),
        new postgres.PostgresError({
          severity_local: 'FATAL',
          severity: 'FATAL',
          code: '57P01',
          message: 'terminating connection due to administrator command',
        } as never),
        new postgres.PostgresError({
          severity_local: 'FATAL',
          severity: 'FATAL',
          code: '23514',
          message: 'fatal mimo kodu 23514 nie jest czystym ReadyForQuery',
        } as never),
        Object.assign(new Error('write ECONNRESET'), { code: 'ECONNRESET' }),
      ]) {
        beginSpy.mockImplementationOnce((async (
          callback: (sql: typeof client) => Promise<unknown>,
        ) => {
          await callback(client);
          throw uncertainCommitError;
        }) as unknown as typeof client.begin);

        await expect(
          runManagedTransaction(
            db,
            async () => 'done',
            () => true,
          ),
        ).rejects.toSatisfy(
          (err: unknown) =>
            isTransactionOutcomeUnknownError(err) &&
            (err as TransactionOutcomeUnknownError).cause === uncertainCommitError,
        );
      }
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });

  it('SEC-03: PostgresAccessManagementStore przy potwierdzonym rollbacku (serwerowe odrzucenie COMMIT 23514 po pap_execute_access()) wycofuje efekt i zapisuje wyłącznie allow/rolled_back', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    const actorUuid = userId(id(6));
    const targetUuid = userId(id(3));
    const tenantUuid = tenantId(id(2));
    const entityUuid = legalEntityId(id(5));

    const committedEvents = new Map<string, PersistedAccessEventRecord>();
    const committedAuditRows: Array<{
      accessManagementOperationId: unknown;
      decision: unknown;
      outcome: unknown;
      reason: unknown;
    }> = [];
    let stagedEvent = null as PersistedAccessEventRecord | null;
    let stagedAuditRows: typeof committedAuditRows = [];
    let rejectNextCommitWith23514 = true;
    let lastSignedContext = null as SignedContextPayload | null;

    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => {
      stagedEvent = null;
      stagedAuditRows = [];
      const res = await callback(client);
      if (rejectNextCommitWith23514) {
        rejectNextCommitWith23514 = false;
        throw new postgres.PostgresError({
          severity_local: 'BŁĄD',
          severity: 'ERROR',
          code: '23514',
          message: 'Brak atomowego audytu operacji',
        } as never);
      }
      if (stagedEvent) {
        committedEvents.set(stagedEvent.operationId, stagedEvent);
      }
      committedAuditRows.push(...stagedAuditRows);
      return res;
    }) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      let rows: unknown[] = [];
      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes("set_config('pap.context'")) {
        const rawPayload = parameters[0];
        if (typeof rawPayload === 'string') {
          lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
        }
      } else if (query.includes('pap_execute_access()')) {
        const cmd = lastSignedContext?.command!;
        const decisionAt = lastSignedContext?.decision_at ?? now;
        const receipt: AccessManagementReceipt = {
          operationId: cmd.operationId,
          occurredAt: decisionAt,
          changed: true,
          grantId: cmd.kind === 'grant' ? cmd.grantId : null,
        };
        stagedEvent = {
          operationId: cmd.operationId,
          tenantId: cmd.tenantId,
          userId: cmd.userId,
          actorId: lastSignedContext?.actor_user_id ?? actorUuid,
          requestKey: JSON.stringify(cmd),
          occurredAt: decisionAt,
          receipt,
        };
        rows = [{ result: { ok: true, receipt } satisfies AccessManagementResult }];
      } else if (query.includes('from "app_user"')) {
        rows = [[actorUuid, 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            tenantUuid,
            parameters[1],
            parameters[1] === actorUuid ? 'tenant_owner' : 'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('from "legal_entity"')) {
        rows = [[entityUuid]];
      } else if (query.includes('from "access_management_event"')) {
        rows = [];
      } else if (query.includes('insert into "security_decision_event"')) {
        stagedAuditRows.push({
          accessManagementOperationId: parameters[3],
          decision: parameters[10],
          outcome: parameters[11],
          reason: parameters[12],
        });
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const store = new PostgresAccessManagementStore(db, createTestSigner());
      const res = await store.execute(
        {
          kind: 'grant',
          operationId: id(801),
          tenantId: tenantUuid,
          userId: targetUuid,
          grantId: id(802),
          legalEntityId: entityUuid,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
        { userId: actorUuid },
      );

      expect(res).toEqual({
        ok: false,
        reason: 'access_management_unavailable',
      });
      expect(committedEvents.size).toBe(0);
      expect(committedAuditRows).toEqual([
        {
          accessManagementOperationId: null,
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'access_management_unavailable',
        },
      ]);
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });

  it('SEC-03: PostgresAccessManagementStore po utracie potwierdzenia COMMIT nie zapisuje fałszywego rolled_back i przy ponowieniu z tym samym operationId zwraca pierwotny receipt z pap_execute_access() bez duplikacji mutacji', async () => {
    const { db, client } = connectDatabase({
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
    });

    const actorUuid = userId(id(6));
    const targetUuid = userId(id(3));
    const tenantUuid = tenantId(id(2));
    const entityUuid = legalEntityId(id(5));
    const opId = id(901);
    const grantUuid = id(902);
    const retryNow = '2026-10-28T12:05:00.123Z';

    let persistedAccessEvent = null as PersistedAccessEventRecord | null;
    let executorMutationCount = 0;
    let currentDbNow = now;
    let lastSignedContext = null as SignedContextPayload | null;
    const executedQueries: string[] = [];
    const securityAuditRows: Array<{
      decision: unknown;
      outcome: unknown;
      reason: unknown;
      accessManagementOperationId: unknown;
    }> = [];
    let dropFirstCommitAck = true;

    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => {
      const res = await callback(client);
      if (dropFirstCommitAck) {
        dropFirstCommitAck = false;
        // Symulacja: serwer PostgreSQL zatwierdził TX, ale połączenie zerwało się przed dostarczeniem potwierdzenia COMMIT
        throw Object.assign(new Error('CONNECTION_CLOSED po COMMIT'), {
          code: 'CONNECTION_CLOSED',
        });
      }
      return res;
    }) as unknown as typeof client.begin);

    vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      executedQueries.push(query);
      let rows: unknown[] = [];
      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes("set_config('pap.context'")) {
        const rawPayload = parameters[0];
        if (typeof rawPayload === 'string') {
          lastSignedContext = JSON.parse(rawPayload) as SignedContextPayload;
        }
      } else if (query.includes('pap_execute_access()')) {
        expect(lastSignedContext?.purpose).toBe('access');
        const cmd = lastSignedContext?.command!;
        const actor = lastSignedContext?.actor_user_id!;
        const decisionAt = lastSignedContext?.decision_at ?? currentDbNow;
        const serializedCommand = JSON.stringify(cmd);
        if (persistedAccessEvent && persistedAccessEvent.operationId === cmd.operationId) {
          if (
            persistedAccessEvent.tenantId !== cmd.tenantId ||
            persistedAccessEvent.userId !== cmd.userId ||
            persistedAccessEvent.actorId !== actor ||
            persistedAccessEvent.requestKey !== serializedCommand
          ) {
            rows = [{ result: { ok: false, reason: 'operation_conflict' } satisfies AccessManagementResult }];
          } else {
            // Idempotentny odczyt pierwotnego receipt bez ponownego DML
            rows = [
              {
                result: {
                  ok: true,
                  receipt: persistedAccessEvent.receipt,
                } satisfies AccessManagementResult,
              },
            ];
          }
        } else {
          executorMutationCount += 1;
          const receipt: AccessManagementReceipt = {
            operationId: cmd.operationId,
            occurredAt: decisionAt,
            changed: true,
            grantId: cmd.kind === 'grant' ? cmd.grantId : null,
          };
          persistedAccessEvent = {
            operationId: cmd.operationId,
            tenantId: cmd.tenantId,
            userId: cmd.userId,
            actorId: actor,
            requestKey: serializedCommand,
            occurredAt: decisionAt,
            receipt,
          };
          rows = [{ result: { ok: true, receipt } satisfies AccessManagementResult }];
        }
      } else if (query.includes('from "app_user"')) {
        rows = [[actorUuid, 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            tenantUuid,
            parameters[1],
            parameters[1] === actorUuid ? 'tenant_owner' : 'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('from "legal_entity"')) {
        rows = [[entityUuid]];
      } else if (query.includes('from "access_management_event"')) {
        // 5-kolumnowy SELECT z packages/db/src/access-management.ts:
        // [actorId, tenantId, userId, requestKey, occurredAt]
        rows = persistedAccessEvent
          ? [
              [
                persistedAccessEvent.actorId,
                persistedAccessEvent.tenantId,
                persistedAccessEvent.userId,
                persistedAccessEvent.requestKey,
                persistedAccessEvent.occurredAt,
              ],
            ]
          : [];
      } else if (query.includes('insert into "security_decision_event"')) {
        securityAuditRows.push({
          accessManagementOperationId: parameters[3],
          decision: parameters[10],
          outcome: parameters[11],
          reason: parameters[12],
        });
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now: currentDbNow }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    try {
      const store = new PostgresAccessManagementStore(db, createTestSigner());
      const command: AccessManagementCommand = {
        kind: 'grant',
        operationId: opId,
        tenantId: tenantUuid,
        userId: targetUuid,
        grantId: grantUuid,
        legalEntityId: entityUuid,
        action: 'read',
        validFrom: now,
        validUntil: null,
      };

      // Pierwsza próba: serwer wykonał COMMIT z pap_execute_access(), klient stracił potwierdzenie
      const first = await store.execute(command, { userId: actorUuid });
      expect(first).toEqual({
        ok: false,
        reason: 'transaction_outcome_unknown',
      });
      expect(executorMutationCount).toBe(1);
      expect(securityAuditRows.some((r) => r.outcome === 'rolled_back')).toBe(false);
      expect(securityAuditRows).toEqual([
        {
          accessManagementOperationId: opId,
          decision: 'allow',
          outcome: 'committed',
          reason: 'authorized_tenant_administration',
        },
        {
          accessManagementOperationId: null,
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        },
      ]);

      // Jawne ponowienie 5 minut później z tym samym operationId i jawnym validFrom z czasu pierwszej próby:
      // rozpoznaje własny receipt (committedOperationAt), nie wykonuje drugiego DML i zwraca pierwotny receipt
      currentDbNow = retryNow;
      const second = await store.execute(command, { userId: actorUuid });
      expect(second).toEqual({
        ok: true,
        receipt: {
          operationId: opId,
          occurredAt: now,
          changed: true,
          grantId: grantUuid,
        },
      });
      expect(executorMutationCount).toBe(1);
      expect(hasForbiddenDirectAccessDml(executedQueries)).toBe(false);
      expect(securityAuditRows.some((r) => r.outcome === 'rolled_back')).toBe(false);
      expect(securityAuditRows).toHaveLength(3);
      expect(securityAuditRows[2]).toEqual({
        accessManagementOperationId: opId,
        decision: 'allow',
        outcome: 'committed',
        reason: 'authorized_tenant_administration',
      });
    } finally {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    }
  });
});
