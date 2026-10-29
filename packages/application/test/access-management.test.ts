import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId, type TenantMembership } from '@pap/domain';
import type { SecurityAuditEvent } from '../src/security-audit.js';
import {
  ConfirmedTransactionRollbackError,
  TransactionOutcomeUnknownError,
} from '../src/transactional-unit-of-work.js';
import {
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  manageAccess,
  type AccessManagementAuthorizationDataSource,
  type AccessManagementCommand,
  type AccessManagementReceipt,
  type AccessManagementResult,
  type AccessManagementStore,
  type AccessManagementTransaction,
} from '../src/access-management.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const command: AccessManagementCommand = {
  kind: 'revoke_membership',
  operationId: id(1),
  tenantId: tenantId(id(2)),
  userId: userId(id(3)),
};
const actor = { userId: userId(id(4)) };
function setup() {
  const execute = vi.fn().mockResolvedValue({ ok: true });
  const tx = {
    verifyActorAccount: async () => true,
    getAuthorizationFacts: vi.fn(),
    executeAuthorized: execute,
  };
  return {
    store: {
      recordDeniedDecision: vi.fn().mockResolvedValue(undefined),
      execute,
      runInTransaction: async (work: (value: typeof tx) => Promise<AccessManagementResult>) => {
        try {
          return await work(tx);
        } catch (error) {
          throw new ConfirmedTransactionRollbackError(error);
        }
      },
    },
    actors: { getVerifiedActor: vi.fn().mockResolvedValue(actor) },
    authorizer: { authorize: vi.fn().mockResolvedValue(true) },
  };
}
describe('Zarządzanie dostępem — jawna granica administracyjna', () => {
  it.each(['actors', 'authorizer'] as const)('bez %s odmawia przed mutacją', async (key) => {
    const deps = setup();
    expect(await manageAccess(command, { ...deps, [key]: undefined })).toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(deps.store.execute).not.toHaveBeenCalled();
  });
  it('brak zweryfikowanego aktora blokuje mutację', async () => {
    const deps = setup();
    deps.actors.getVerifiedActor.mockResolvedValue(null);
    expect(await manageAccess(command, deps)).toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(deps.authorizer.authorize).not.toHaveBeenCalled();
    expect(deps.store.execute).not.toHaveBeenCalled();
  });
  it.each([false, undefined, 'true'])(
    'tylko jawne true autoryzatora pozwala; wynik %s odmawia',
    async (decision) => {
      const deps = setup();
      deps.authorizer.authorize.mockResolvedValue(decision);
      expect(await manageAccess(command, deps)).toEqual({
        ok: false,
        reason: 'access_management_denied',
      });
      expect(deps.store.execute).not.toHaveBeenCalled();
    },
  );
  it('przekazuje konkretny zakres i serwerowego aktora do autoryzatora oraz portu', async () => {
    const deps = setup();
    await manageAccess(command, deps);
    expect(deps.authorizer.authorize).toHaveBeenCalledWith(actor, command, expect.any(Object));
    expect(deps.store.execute).toHaveBeenCalledWith(command, actor);
  });
  it('nie ufa actorId/roli w komendzie; kopia jest zamrożona przed await', async () => {
    const deps = setup();
    const malicious = { ...command, actorId: id(99), role: 'tenant_owner' };
    deps.authorizer.authorize.mockImplementation(async (_actor, scoped) => {
      expect(Object.isFrozen(scoped)).toBe(true);
      malicious.tenantId = tenantId(id(99));
      return true;
    });
    await manageAccess(malicious, deps);
    expect(deps.store.execute).toHaveBeenCalledWith(command, actor);
  });
  it.each(['actors', 'authorizer', 'store'] as const)(
    'awaria %s z potwierdzonym rollbackiem jest fail-closed bez surowego wyjątku',
    async (key) => {
      const deps = setup();
      const fn =
        key === 'actors'
          ? deps.actors.getVerifiedActor
          : key === 'authorizer'
            ? deps.authorizer.authorize
            : deps.store.execute;
      fn.mockRejectedValue(new Error('SQL token synthetic-secret'));
      expect(await manageAccess(command, deps)).toEqual({
        ok: false,
        reason: 'access_management_unavailable',
      });
    },
  );
  it.each([
    { ...command, operationId: 'błędny' },
    { ...command, kind: 'unknown' },
    {
      ...command,
      kind: 'grant',
      grantId: id(5),
      legalEntityId: legalEntityId(id(6)),
      action: 'tenant_admin',
      validFrom: null,
      validUntil: null,
    },
    { ...command, kind: 'reactivate_membership', validUntil: 'nie data' },
    {
      ...command,
      kind: 'grant',
      grantId: id(5),
      legalEntityId: legalEntityId(id(6)),
      action: 'read',
      validFrom: '2026-02-01',
      validUntil: '2026-01-01',
    },
  ])('odrzuca niepoprawną komendę %# przed autoryzacją', async (input) => {
    const deps = setup();
    expect(await manageAccess(input as AccessManagementCommand, deps)).toEqual({
      ok: false,
      reason: 'invalid_command',
    });
    expect(deps.store.execute).not.toHaveBeenCalled();
  });

  it('łączy OIDC actor source i domenowy autoryzator administracyjny z manageAccess', async () => {
    const now = new Date('2026-10-28T12:00:00.000Z');
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const entityA1 = legalEntityId(id(11));
    const grantCommand: AccessManagementCommand = {
      kind: 'grant',
      operationId: id(10),
      tenantId: command.tenantId,
      userId: command.userId,
      grantId: id(12),
      legalEntityId: entityA1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    };

    const actors = createOidcAccessManagementActorSource('valid.jwt.token', {
      verifier: {
        verifyAccessToken: async () => ({
          ok: true,
          identity: { issuer: 'https://idp.example.test', subject: 'admin-sub' },
        }),
      },
      identityResolver: {
        resolveVerifiedIdentity: async () => ({ userId: actor.userId }),
      },
    });

    const dataSource: AccessManagementAuthorizationDataSource = {
      getAuthorizationFacts: vi.fn(async (verifiedActor, cmd) => ({
        actorMembership: {
          userId: verifiedActor.userId,
          tenantId: cmd.tenantId,
          role: 'tenant_admin',
          status: 'active',
          validFrom,
          validUntil: null,
        } satisfies TenantMembership,
        actorGrants: [
          {
            grantId: id(80),
            userId: verifiedActor.userId,
            tenantId: cmd.tenantId,
            legalEntityId: entityA1,
            action: 'read',
            validFrom,
            validUntil: null,
            revokedAt: null,
          },
        ],
        targetMembership: {
          userId: cmd.userId,
          tenantId: cmd.tenantId,
          role: 'tenant_member',
          status: 'active',
          validFrom,
          validUntil: null,
        } satisfies TenantMembership,
        targetGrant: null,
      })),
    };

    const authorizer = createTenantAccessManagementAuthorizer(dataSource, { now: () => now });
    const execute = vi.fn().mockResolvedValue({ ok: true });
    const tx = {
      ...dataSource,
      verifyActorAccount: async () => true,
      executeAuthorized: execute,
    };
    const store = {
      recordDeniedDecision: vi.fn().mockResolvedValue(undefined),
      execute,
      runInTransaction: async (work: (value: typeof tx) => Promise<AccessManagementResult>) =>
        work(tx),
    };

    await expect(manageAccess(grantCommand, { store, actors, authorizer })).resolves.toEqual({
      ok: true,
    });
    expect(store.execute).toHaveBeenCalledWith(grantCommand, {
      userId: actor.userId,
      identity: { issuer: 'https://idp.example.test', subject: 'admin-sub' },
    });

    // Próba nadania write przez admina mającego tylko read kończy się odmową przed store.execute
    store.execute.mockClear();
    await expect(
      manageAccess({ ...grantCommand, action: 'write' }, { store, actors, authorizer }),
    ).resolves.toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(store.execute).not.toHaveBeenCalled();

    // Próba podniesienia własnych uprawnień (target === actor) kończy się odmową
    await expect(
      manageAccess({ ...grantCommand, userId: actor.userId }, { store, actors, authorizer }),
    ).resolves.toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(store.execute).not.toHaveBeenCalled();
  });

  it('wykonuje weryfikację konta, autoryzację na zablokowanych faktach, kontekst sesji i mutację w jednej transakcji (6D-3A)', async () => {
    const dbNow = new Date('2026-10-29T10:00:00.000Z');
    const staleClockNow = new Date('2026-01-02T00:00:00.000Z');
    const validFrom = new Date('2026-01-01T00:00:00.000Z');
    const entityA1 = legalEntityId(id(11));
    const grantCommand: AccessManagementCommand = {
      kind: 'grant',
      operationId: id(20),
      tenantId: command.tenantId,
      userId: command.userId,
      grantId: id(21),
      legalEntityId: entityA1,
      action: 'read',
      validFrom: null,
      validUntil: '2026-11-15T00:00:00.000Z',
    };

    const callOrder: string[] = [];
    const actors = createOidcAccessManagementActorSource('valid.jwt.token', {
      verifier: {
        verifyAccessToken: async () => {
          callOrder.push('verifyAccessToken');
          return {
            ok: true,
            identity: { issuer: 'https://idp.example.test', subject: 'admin-sub' },
          };
        },
      },
      identityResolver: {
        resolveVerifiedIdentity: async () => {
          callOrder.push('resolveVerifiedIdentity');
          return { userId: actor.userId };
        },
      },
    });

    // Niezablokowane źródło fallback nie może zostać wywołane wewnątrz transakcji UnitOfWork.
    const staleFallbackSource: AccessManagementAuthorizationDataSource = {
      getAuthorizationFacts: vi.fn(async () => {
        throw new Error('Nie wolno czytać z fallbackSource, gdy aktywna jest transakcja!');
      }),
    };

    const tx = {
      verifyActorAccount: vi.fn(async () => {
        callOrder.push('tx.verifyActorAccount');
        return true;
      }),
      getAuthorizationFacts: vi.fn(async (verifiedActor, cmd) => {
        callOrder.push('tx.getAuthorizationFacts');
        return {
          actorMembership: {
            userId: verifiedActor.userId,
            tenantId: cmd.tenantId,
            role: 'tenant_admin' as const,
            status: 'active' as const,
            validFrom,
            validUntil: null,
          },
          actorGrants: [
            {
              grantId: id(81),
              userId: verifiedActor.userId,
              tenantId: cmd.tenantId,
              legalEntityId: entityA1,
              action: 'read' as const,
              validFrom,
              validUntil: new Date('2026-12-31T00:00:00.000Z'),
              revokedAt: null,
            },
          ],
          targetMembership: {
            userId: cmd.userId,
            tenantId: cmd.tenantId,
            role: 'tenant_member' as const,
            status: 'active' as const,
            validFrom,
            validUntil: null,
          },
          targetGrant: null,
          now: dbNow,
        };
      }),
      applySessionContext: vi.fn(async () => {
        callOrder.push('tx.applySessionContext');
      }),
      executeAuthorized: vi.fn(async () => {
        callOrder.push('tx.executeAuthorized');
        return {
          ok: true as const,
          receipt: {
            operationId: grantCommand.operationId,
            occurredAt: dbNow.toISOString(),
            changed: true,
            grantId: grantCommand.grantId,
          },
        };
      }),
    };

    const store = {
      recordDeniedDecision: vi.fn().mockResolvedValue(undefined),
      runInTransaction: vi.fn(async (work) => {
        callOrder.push('store.runInTransaction:begin');
        const result = await work(tx);
        callOrder.push('store.runInTransaction:end');
        return result;
      }),
      execute: vi.fn(async () => {
        throw new Error(
          'Nie wolno wywoływać niepowiązanego store.execute, gdy jest runInTransaction!',
        );
      }),
    };

    const authorizer = createTenantAccessManagementAuthorizer(staleFallbackSource, {
      now: () => staleClockNow,
    });

    const result = await manageAccess(grantCommand, { store, actors, authorizer });
    expect(result).toEqual({
      ok: true,
      receipt: {
        operationId: grantCommand.operationId,
        occurredAt: dbNow.toISOString(),
        changed: true,
        grantId: grantCommand.grantId,
      },
    });
    expect(callOrder).toEqual([
      'verifyAccessToken',
      'resolveVerifiedIdentity',
      'store.runInTransaction:begin',
      'tx.verifyActorAccount',
      'tx.getAuthorizationFacts',
      'tx.applySessionContext',
      'tx.executeAuthorized',
      'store.runInTransaction:end',
    ]);
    expect(staleFallbackSource.getAuthorizationFacts).not.toHaveBeenCalled();
    expect(store.execute).not.toHaveBeenCalled();
    expect(tx.applySessionContext).toHaveBeenCalledWith({
      actorUserId: actor.userId,
      tenantId: grantCommand.tenantId,
      legalEntityId: entityA1,
    });

    // Zegar transakcyjny facts.now (dbNow), a nie staleClockNow, decyduje o wygaśnięciu delegowalnego grantu
    tx.getAuthorizationFacts.mockResolvedValueOnce({
      actorMembership: {
        userId: actor.userId,
        tenantId: grantCommand.tenantId,
        role: 'tenant_admin',
        status: 'active',
        validFrom,
        validUntil: null,
      },
      actorGrants: [
        {
          grantId: id(81),
          userId: actor.userId,
          tenantId: grantCommand.tenantId,
          legalEntityId: entityA1,
          action: 'read',
          validFrom,
          validUntil: new Date('2026-06-01T00:00:00.000Z'),
          revokedAt: null,
        },
      ],
      targetMembership: {
        userId: grantCommand.userId,
        tenantId: grantCommand.tenantId,
        role: 'tenant_member',
        status: 'active',
        validFrom,
        validUntil: null,
      },
      targetGrant: null,
      now: dbNow,
    });
    tx.executeAuthorized.mockClear();

    await expect(manageAccess(grantCommand, { store, actors, authorizer })).resolves.toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(tx.executeAuthorized).not.toHaveBeenCalled();
  });

  it('przerywa transakcję bez mutacji, gdy konto aktora zostało wyłączone po OIDC lub brak źródła autoryzacji', async () => {
    const tx = {
      verifyActorAccount: vi.fn().mockResolvedValue(false),
      getAuthorizationFacts: vi.fn(),
      applySessionContext: vi.fn(),
      executeAuthorized: vi.fn(),
    };
    const store = {
      recordDeniedDecision: vi.fn().mockResolvedValue(undefined),
      runInTransaction: vi.fn(async (work) => work(tx)),
      execute: vi.fn(),
    };
    const authorizer = createTenantAccessManagementAuthorizer();
    const actors = { getVerifiedActor: vi.fn().mockResolvedValue(actor) };

    await expect(manageAccess(command, { store, actors, authorizer })).resolves.toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    expect(tx.verifyActorAccount).toHaveBeenCalledWith(actor);
    expect(tx.getAuthorizationFacts).not.toHaveBeenCalled();
    expect(tx.applySessionContext).not.toHaveBeenCalled();
    expect(tx.executeAuthorized).not.toHaveBeenCalled();

    // Bez fallbackSource wywołanie autoryzatora poza transakcją jest fail-closed
    await expect(authorizer.authorize(actor, command)).resolves.toBe(false);
  });

  describe('SEC-03 — potwierdzony rollback vs utrata potwierdzenia COMMIT w manageAccess', () => {
    it('zapisuje allow/rolled_back tylko dla potwierdzonego wycofania transakcji przed COMMIT', async () => {
      const recordedAudit: SecurityAuditEvent[] = [];
      const deps = setup();
      deps.store.recordDeniedDecision = vi.fn(async (event: SecurityAuditEvent) => {
        recordedAudit.push(event);
      });

      // Kontrolowana odmowa domenowa wewnątrz executeAuthorized przed COMMIT
      deps.store.execute.mockResolvedValueOnce({ ok: false, reason: 'membership_inactive' });
      expect(await manageAccess(command, deps)).toEqual({
        ok: false,
        reason: 'membership_inactive',
      });
      expect(recordedAudit).toEqual([
        expect.objectContaining({
          operationId: command.operationId,
          actorId: actor.userId,
          targetUserId: command.userId,
          tenantId: command.tenantId,
          kind: 'access',
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'membership_inactive',
        }),
      ]);
    });

    it('nie zapisuje fałszywego rolled_back po utracie potwierdzenia COMMIT i zachowuje idempotencję przy ponowieniu z tym samym operationId', async () => {
      const committedReceipts = new Map<string, AccessManagementReceipt>();
      const auditLog: SecurityAuditEvent[] = [];
      let loseCommitAck = true;
      let executeAuthorizedCalls = 0;

      const grantCommand: AccessManagementCommand = {
        kind: 'grant',
        operationId: id(701),
        tenantId: tenantId(id(2)),
        userId: userId(id(3)),
        grantId: id(702),
        legalEntityId: legalEntityId(id(11)),
        action: 'read',
        validFrom: null,
        validUntil: null,
      };

      const store: AccessManagementStore = {
        recordDeniedDecision: async (event) => {
          auditLog.push(event);
        },
        execute: vi.fn(),
        async runInTransaction(work) {
          const tx: AccessManagementTransaction = {
            verifyActorAccount: async () => true,
            getAuthorizationFacts: vi.fn(),
            applySessionContext: async () => {},
            executeAuthorized: async (cmd) => {
              executeAuthorizedCalls += 1;
              const existing = committedReceipts.get(cmd.operationId);
              if (existing) {
                auditLog.push({
                  requestId: cmd.operationId,
                  operationId: cmd.operationId,
                  accessManagementOperationId: cmd.operationId,
                  actorId: actor.userId,
                  targetUserId: cmd.userId,
                  tenantId: cmd.tenantId,
                  legalEntityId: cmd.kind === 'grant' ? cmd.legalEntityId : null,
                  action: cmd.kind,
                  kind: 'access',
                  decision: 'allow',
                  outcome: 'committed',
                  reason: 'authorized_tenant_administration',
                });
                return { ok: true, receipt: existing };
              }

              const receipt: AccessManagementReceipt = {
                operationId: cmd.operationId,
                occurredAt: '2026-10-29T12:00:00.000Z',
                changed: true,
                grantId: cmd.kind === 'grant' ? cmd.grantId : null,
              };
              // Symulacja atomowego zatwierdzenia mutacji i audytu w PostgreSQL...
              committedReceipts.set(cmd.operationId, receipt);
              auditLog.push({
                requestId: cmd.operationId,
                operationId: cmd.operationId,
                accessManagementOperationId: cmd.operationId,
                actorId: actor.userId,
                targetUserId: cmd.userId,
                tenantId: cmd.tenantId,
                legalEntityId: cmd.kind === 'grant' ? cmd.legalEntityId : null,
                action: cmd.kind,
                kind: 'access',
                decision: 'allow',
                outcome: 'committed',
                reason: 'authorized_tenant_administration',
              });
              return { ok: true, receipt };
            },
          };

          const result = await work(tx);
          if (result.ok && loseCommitAck) {
            throw new TransactionOutcomeUnknownError(new Error('CONNECTION_CLOSED during COMMIT'));
          }
          return result;
        },
      };

      const actors = { getVerifiedActor: async () => actor };
      const authorizer = { authorize: async () => true };

      // 1) Pierwsze wywołanie traci potwierdzenie po skutecznym COMMIT w DB
      const firstResult = await manageAccess(grantCommand, { store, actors, authorizer });
      expect(firstResult).toEqual({
        ok: false,
        reason: 'transaction_outcome_unknown',
      });
      expect(executeAuthorizedCalls).toBe(1);
      expect(committedReceipts.size).toBe(1);
      expect(auditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
      expect(auditLog).toEqual([
        expect.objectContaining({
          operationId: grantCommand.operationId,
          accessManagementOperationId: grantCommand.operationId,
          decision: 'allow',
          outcome: 'committed',
        }),
        expect.objectContaining({
          operationId: grantCommand.operationId,
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        }),
      ]);
      expect(auditLog[1]?.accessManagementOperationId).toBeUndefined();

      // 2) Ponowienie z tym samym operationId nie powiela mutacji i zwraca oryginalny receipt
      loseCommitAck = false;
      const retryResult = await manageAccess(grantCommand, { store, actors, authorizer });
      expect(retryResult).toEqual({
        ok: true,
        receipt: {
          operationId: grantCommand.operationId,
          occurredAt: '2026-10-29T12:00:00.000Z',
          changed: true,
          grantId: grantCommand.grantId,
        },
      });
      expect(executeAuthorizedCalls).toBe(2);
      expect(committedReceipts.size).toBe(1);
      expect(auditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
    });

    it('traktuje niepotwierdzony wyjątek Promise po autoryzacji jako transaction_outcome_unknown, nigdy jako rolled_back', async () => {
      const auditLog: SecurityAuditEvent[] = [];
      const store: AccessManagementStore = {
        recordDeniedDecision: async (event) => {
          auditLog.push(event);
        },
        execute: vi.fn(),
        async runInTransaction(work) {
          const tx: AccessManagementTransaction = {
            verifyActorAccount: async () => true,
            getAuthorizationFacts: vi.fn(),
            executeAuthorized: async () => {
              throw new Error('Niepotwierdzony stan połączenia podczas ROLLBACK');
            },
          };
          // Brak opakowania w ConfirmedTransactionRollbackError -> brak potwierdzenia rollbacku!
          return work(tx);
        },
      };

      const result = await manageAccess(command, {
        store,
        actors: { getVerifiedActor: async () => actor },
        authorizer: { authorize: async () => true },
      });

      expect(result).toEqual({
        ok: false,
        reason: 'transaction_outcome_unknown',
      });
      expect(auditLog).toEqual([
        expect.objectContaining({
          operationId: command.operationId,
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        }),
      ]);
      expect(auditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
    });
  });
});
