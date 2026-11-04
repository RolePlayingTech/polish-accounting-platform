import {
  ConfirmedTransactionRollbackError,
  executeAuthorizedCompanyAction,
  isConfirmedTransactionRollbackError,
  type AccessManagementCommand,
  type SecurityAuditEvent,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  PostgresAccessManagementAuthorizationDataSource,
  PostgresAccessManagementStore,
} from '../src/access-management.js';
import { connectDatabase } from '../src/client.js';
import {
  ScopeClosedError,
  recordCompanyOperationProbe,
  type PostgresCompanyActionScope,
} from '../src/company-operation-probe.js';
import * as dbPublicExports from '../src/index.js';
import { PostgresSecurityAudit } from '../src/security-audit.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { PostgresTenantAuthorizationDataSource } from '../src/tenant-authorization.js';
import { verifyAndLockActorInTx, type PostgresTransaction } from '../src/transaction-primitives.js';
import * as uowModuleExports from '../src/transactional-unit-of-work.js';
import { PostgresTransactionalUnitOfWork } from '../src/transactional-unit-of-work.js';
import { PostgresUserIdentityResolver, PostgresUserIdentityStore } from '../src/user-identity.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(1));
const ENTITY_A1 = legalEntityId(id(11));
const USER_A = userId(id(31));
const TARGET_USER = userId(id(32));
const NOW_ISO = '2026-10-29T12:00:00.123Z';

const CONTEXT_BINDING_ROW = {
  xid: '2001',
  pid: 77,
  database: 'pap_test',
  role: 'pap_test_app',
  expires: '9999999999999',
};

const createTestSigner = () =>
  new PostgresContextSigner({ keyId: 'sec04-test-key', keyHex: 'cd'.repeat(32) });

function createMockedConnection(options?: { onSecurityAuditInsert?: () => Promise<void> | void }) {
  const { db, client } = connectDatabase({
    PAP_DATABASE_ENV: 'test',
    DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
  });

  let beginCommittedCount = 0;
  let beginRolledBackCount = 0;
  const executedQueries: string[] = [];

  vi.spyOn(client, 'begin').mockImplementation((async (
    callback: (sql: typeof client) => Promise<unknown>,
  ) => {
    try {
      const result = await callback(client);
      beginCommittedCount += 1;
      return result;
    } catch (error) {
      beginRolledBackCount += 1;
      throw error;
    }
  }) as unknown as typeof client.begin);

  vi.spyOn(client, 'unsafe').mockImplementation(((query: string, parameters: unknown[] = []) => {
    executedQueries.push(query);
    const pendingRows = (async () => {
      let rows: unknown[] = [];

      if (query.includes('pg_current_xact_id()')) {
        rows = [CONTEXT_BINDING_ROW];
      } else if (query.includes('from "app_user"')) {
        rows = [[USER_A, 'active', null]];
      } else if (query.includes('from "user_oidc_identity"')) {
        rows = [[id(77), USER_A, 'https://idp.example.test', 'sub-user-a', 'active', null]];
      } else if (query.includes('from "tenant_membership"')) {
        rows = [
          [
            TENANT_A,
            parameters[1] ?? USER_A,
            'tenant_member',
            'active',
            '2026-01-01T00:00:00.000Z',
            null,
          ],
        ];
      } else if (query.includes('from "legal_entity"')) {
        rows = [[ENTITY_A1]];
      } else if (query.includes('from "company_access_grant"')) {
        rows = [
          [
            id(90),
            TENANT_A,
            USER_A,
            ENTITY_A1,
            parameters[3] ?? 'write',
            '2026-01-01T00:00:00.000Z',
            null,
            null,
          ],
        ];
      } else if (query.includes('insert into "company_operation_probe"')) {
        rows = [[parameters[0]]];
      } else if (query.includes('insert into "security_decision_event"')) {
        await options?.onSecurityAuditInsert?.();
        rows = [];
      } else if (query.includes('clock_timestamp()')) {
        rows = [{ now: NOW_ISO }];
      }

      return rows;
    })();

    return Object.assign(pendingRows, { values: () => pendingRows });
  }) as unknown as typeof client.unsafe);

  return {
    db,
    client,
    executedQueries,
    get beginCommittedCount() {
      return beginCommittedCount;
    },
    get beginRolledBackCount() {
      return beginRolledBackCount;
    },
    async cleanup() {
      vi.restoreAllMocks();
      await client.end({ timeout: 1 });
    },
  };
}

describe('SEC-04 residual — izolacja uchwytu TScope, zamknięcie po callbacku i wymuszenie tożsamości/audytu', () => {
  it('NEG-SEC04-01: publiczny eksport @pap/db ukrywa niskopoziomowe prymitywy transakcyjne, a domyślny i niestandardowy TScope są zamrożone i nie wystawiają tx/signera/sesji', async () => {
    for (const hiddenPrimitive of [
      'runManagedTransaction',
      'applyLocalRlsSessionContext',
      'lockCompanyActionFactsInTx',
      'verifyAndLockActorInTx',
      'readTransactionClockNow',
    ]) {
      expect(dbPublicExports).not.toHaveProperty(hiddenPrimitive);
      expect(uowModuleExports).not.toHaveProperty(hiddenPrimitive);
    }

    const conn = createMockedConnection();
    try {
      const defaultUow = new PostgresTransactionalUnitOfWork(conn.db, createTestSigner());
      expect(Object.isFrozen(defaultUow)).toBe(true);
      expect(Object.keys(defaultUow)).toEqual([]);

      let inspectedDefaultScope: PostgresCompanyActionScope | undefined;
      const opId = id(501);
      const defaultResult = await executeAuthorizedCompanyAction(
        {
          operationId: opId,
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: defaultUow,
        },
        async (ctx, scope) => {
          inspectedDefaultScope = scope;
          expect(Object.isFrozen(scope)).toBe(true);
          expect(Object.getOwnPropertyNames(scope)).toEqual(['recordOperationProbe']);
          expect(Object.getOwnPropertySymbols(scope)).toEqual([]);
          for (const forbidden of [
            'tx',
            'db',
            'signer',
            'transaction',
            'execute',
            'rollback',
            'setTransaction',
            'verifyActorAccount',
            'getLockedFacts',
            'enterAuthorizedCompanyScope',
            'closeScope',
            'recordAuthorizationDecision',
          ]) {
            expect(scope).not.toHaveProperty(forbidden);
          }
          return recordCompanyOperationProbe(ctx, scope, opId);
        },
      );

      expect(defaultResult).toMatchObject({
        allowed: true,
        data: { created: true },
      });
      expect(inspectedDefaultScope).toBeDefined();
      expect(conn.beginCommittedCount).toBe(1);

      // Rozszerzalna fabryka TScope dla przyszłych repozytoriów księgowych (kwoty w groszach bigint)
      const customUow = new PostgresTransactionalUnitOfWork(
        conn.db,
        createTestSigner(),
        (driver) => {
          expect(Object.isFrozen(driver)).toBe(true);
          expect(Object.isFrozen(driver.context)).toBe(true);
          return Object.freeze({
            readCompanyBalanceGrosze: async () => {
              driver.assertActive();
              return { balanceGrosze: 245_900n, tenantId: driver.context.tenantId };
            },
          });
        },
      );

      const customResult = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: customUow,
        },
        async (_ctx, scope) => {
          expect(Object.getOwnPropertyNames(scope)).toEqual(['readCompanyBalanceGrosze']);
          return scope.readCompanyBalanceGrosze();
        },
      );

      expect(customResult).toMatchObject({
        allowed: true,
        data: { balanceGrosze: 245_900n, tenantId: TENANT_A },
      });
      expect(conn.beginCommittedCount).toBe(2);
    } finally {
      await conn.cleanup();
    }
  });

  it('NEG-SEC04-02: uchwyt scope zamyka się natychmiast po wyjściu z operation (przed recordAuthorizationDecision i po błędzie), a wielokrotny zapis audytu jest odrzucany', async () => {
    let leakedScopeDuringAudit: PostgresCompanyActionScope | undefined;
    let errorDuringAuditWindow: unknown;

    const conn = createMockedConnection({
      onSecurityAuditInsert: async () => {
        if (leakedScopeDuringAudit) {
          try {
            await leakedScopeDuringAudit.recordOperationProbe(id(602));
          } catch (err) {
            errorDuringAuditWindow = err;
          }
        }
      },
    });

    try {
      const uow = new PostgresTransactionalUnitOfWork(conn.db, createTestSigner());
      const opId = id(601);

      const okRes = await executeAuthorizedCompanyAction(
        {
          operationId: opId,
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        async (_ctx, scope) => {
          leakedScopeDuringAudit = scope;
          return scope.recordOperationProbe();
        },
      );

      expect(okRes).toMatchObject({ allowed: true, data: { inserted: true } });
      // Nawet w oknie przed zakończeniem INSERT audytu uchwyt scope był już zamknięty!
      expect(errorDuringAuditWindow).toBeInstanceOf(ScopeClosedError);
      // Po zakończeniu transakcji również rzuca ScopeClosedError
      await expect(leakedScopeDuringAudit!.recordOperationProbe()).rejects.toBeInstanceOf(
        ScopeClosedError,
      );

      // Również po wyjątku w callbacku biznesowym zachowany uchwyt scope jest natychmiast zamknięty
      let leakedScopeOnFailure: PostgresCompanyActionScope | undefined;
      leakedScopeDuringAudit = undefined;
      const failRes = await executeAuthorizedCompanyAction(
        {
          operationId: id(603),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        {
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
            }),
          },
          identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
          unitOfWork: uow,
        },
        async (_ctx, scope) => {
          leakedScopeOnFailure = scope;
          throw new Error('Syntetyczny błąd biznesowy');
        },
      );
      expect(failRes).toMatchObject({ allowed: false, reason: 'authorization_data_unavailable' });
      await expect(leakedScopeOnFailure!.recordOperationProbe()).rejects.toBeInstanceOf(
        ScopeClosedError,
      );

      // Wielokrotne (w tym równoległe) wywołanie recordAuthorizationDecision w sesji rzuca błąd i wycofuje TX
      const duplicateAuditOpId = id(604);
      await expect(
        uow.runCompanyActionInTransaction(
          async (session) => {
            await session.verifyActorAccount({
              userId: USER_A,
              identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
            });
            const facts = await session.getLockedFacts({
              userId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'write',
            });
            await session.enterAuthorizedCompanyScope({
              operationId: duplicateAuditOpId,
              decisionAt: facts.now.toISOString(),
              actorUserId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'write',
            });
            const auditEvent: SecurityAuditEvent = {
              requestId: id(605),
              operationId: duplicateAuditOpId,
              actorId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'write',
              kind: 'company',
              decision: 'allow',
              outcome: 'committed',
              reason: 'explicit_company_grant',
              decidedAt: facts.now.toISOString(),
            };
            await Promise.all([
              session.recordAuthorizationDecision(auditEvent),
              session.recordAuthorizationDecision(auditEvent),
            ]);
            return true;
          },
          () => true,
        ),
      ).rejects.toSatisfy(
        (err: unknown) =>
          isConfirmedTransactionRollbackError(err) &&
          ((err as ConfirmedTransactionRollbackError).cause as Error).message.includes(
            'Decyzja autoryzacyjna została już zapisana w tej transakcji.',
          ),
      );
    } finally {
      await conn.cleanup();
    }
  });

  it('NEG-SEC04-03: brak zweryfikowanego actor.identity blokuje verifyAndLockActorInTx, session.verifyActorAccount oraz PostgresAccessManagementStore.execute', async () => {
    const fakeTx = {
      select: vi.fn(),
    } as unknown as PostgresTransaction;
    expect(await verifyAndLockActorInTx(fakeTx, { userId: USER_A })).toBe(false);
    expect(fakeTx.select).not.toHaveBeenCalled();

    const conn = createMockedConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(conn.db, createTestSigner());

      await expect(
        uow.runCompanyActionInTransaction(
          async (session) => session.verifyActorAccount({ userId: USER_A }),
          () => true,
        ),
      ).rejects.toSatisfy(
        (err: unknown) =>
          isConfirmedTransactionRollbackError(err) &&
          ((err as ConfirmedTransactionRollbackError).cause as Error).message ===
            'Wymagana zweryfikowana tożsamość OIDC aktora.',
      );
      expect(conn.executedQueries.some((q) => q.includes("set_config('pap.context'"))).toBe(false);
      expect(conn.beginCommittedCount).toBe(0);
      expect(conn.beginRolledBackCount).toBe(1);

      const store = new PostgresAccessManagementStore(conn.db, createTestSigner());
      const command: AccessManagementCommand = {
        kind: 'revoke_membership',
        operationId: id(701),
        tenantId: TENANT_A,
        userId: TARGET_USER,
      };
      const storeResult = await store.execute(command, { userId: USER_A });
      expect(storeResult).toEqual({ ok: false, reason: 'access_management_denied' });
      expect(conn.executedQueries.some((q) => q.includes('pap_execute_access()'))).toBe(false);
      expect(conn.beginRolledBackCount).toBe(2);

      // P2-1: wszystkie sąsiednie klasy @pap/db ukrywają #db i #signer przed refleksją i są zamrożone
      const testSigner = createTestSigner();
      for (const instance of [
        store,
        new PostgresAccessManagementAuthorizationDataSource(conn.db),
        new PostgresUserIdentityResolver(conn.db, testSigner),
        new PostgresUserIdentityStore(conn.db),
        new PostgresTenantAuthorizationDataSource(conn.db, testSigner),
        new PostgresSecurityAudit(conn.db, testSigner),
      ]) {
        expect(Object.isFrozen(instance)).toBe(true);
        expect(Object.getOwnPropertyNames(instance)).toEqual([]);
        expect(Object.getOwnPropertySymbols(instance)).toEqual([]);
      }
    } finally {
      await conn.cleanup();
    }
  });

  it('NEG-SEC04-04: bezpośrednie runCompanyActionInTransaction (także dla action=read) wycofuje TX i rzuca ConfirmedTransactionRollbackError bez zwracania niezaudytowanego wyniku', async () => {
    const conn = createMockedConnection();
    try {
      const uow = new PostgresTransactionalUnitOfWork(conn.db, createTestSigner());

      // 1) Pominięty recordAuthorizationDecision przy action='read' mimo shouldCommit=() => true
      await expect(
        uow.runCompanyActionInTransaction(
          async (session) => {
            expect(
              await session.verifyActorAccount({
                userId: USER_A,
                identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
              }),
            ).toBe(true);
            const facts = await session.getLockedFacts({
              userId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'read',
            });
            await session.enterAuthorizedCompanyScope({
              decisionAt: facts.now.toISOString(),
              actorUserId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'read',
            });
            return { readWithoutAudit: true };
          },
          () => true,
        ),
      ).rejects.toBeInstanceOf(ConfirmedTransactionRollbackError);
      expect(conn.beginCommittedCount).toBe(0);
      expect(conn.beginRolledBackCount).toBe(1);

      // 2) Pominięty enterAuthorizedCompanyScope przy action='read' mimo shouldCommit=() => true
      await expect(
        uow.runCompanyActionInTransaction(
          async (session) => {
            expect(
              await session.verifyActorAccount({
                userId: USER_A,
                identity: { issuer: 'https://idp.example.test', subject: 'sub-user-a' },
              }),
            ).toBe(true);
            await session.getLockedFacts({
              userId: USER_A,
              tenantId: TENANT_A,
              legalEntityId: ENTITY_A1,
              action: 'read',
            });
            return { readWithoutScope: true };
          },
          () => true,
        ),
      ).rejects.toBeInstanceOf(ConfirmedTransactionRollbackError);
      expect(conn.beginCommittedCount).toBe(0);
      expect(conn.beginRolledBackCount).toBe(2);
    } finally {
      await conn.cleanup();
    }
  });
});
