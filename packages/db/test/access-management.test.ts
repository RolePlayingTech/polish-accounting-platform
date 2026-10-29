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
} from '@pap/application';
import postgres from 'postgres';
import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresAccessManagementStore } from '../src/access-management.js';
import { runManagedTransaction } from '../src/transaction-primitives.js';
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

  it('SEC-03: PostgresAccessManagementStore po utracie potwierdzenia COMMIT nie zapisuje fałszywego rolled_back i przy ponowieniu z tym samym operationId zwraca pierwotny receipt bez duplikacji mutacji', async () => {
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

    let persistedAccessEventRow: unknown[] | null = null;
    let grantInsertCount = 0;
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
      let rows: unknown[] = [];
      if (query.includes('from "app_user"')) {
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
        rows = persistedAccessEventRow ? [persistedAccessEventRow] : [];
      } else if (query.includes('insert into "company_access_grant"')) {
        grantInsertCount += 1;
      } else if (query.includes('insert into "access_management_event"')) {
        // Kolumny w porządku schematu Drizzle `accessManagementEvent`
        persistedAccessEventRow = [
          parameters[0],
          parameters[1],
          parameters[2],
          parameters[3],
          parameters[4],
          parameters[5],
          parameters[6],
          parameters[7],
          typeof parameters[8] === 'string' ? JSON.parse(parameters[8]) : parameters[8],
          typeof parameters[9] === 'string' ? JSON.parse(parameters[9]) : parameters[9],
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
      const store = new PostgresAccessManagementStore(db);
      const command: AccessManagementCommand = {
        kind: 'grant',
        operationId: opId,
        tenantId: tenantUuid,
        userId: targetUuid,
        grantId: grantUuid,
        legalEntityId: entityUuid,
        action: 'read',
        validFrom: null,
        validUntil: null,
      };

      // Pierwsza próba: serwer wykonał COMMIT, klient stracił potwierdzenie
      const first = await store.execute(command, { userId: actorUuid });
      expect(first).toEqual({
        ok: false,
        reason: 'transaction_outcome_unknown',
      });
      expect(grantInsertCount).toBe(1);
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

      // Jawne ponowienie z tym samym operationId: brak drugiego INSERT do company_access_grant, zwraca pierwotny receipt
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
      expect(grantInsertCount).toBe(1);
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
