import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { SecurityAuditUnavailableError, type SecurityAuditEvent } from '../src/security-audit.js';
import {
  ConfirmedTransactionRollbackError,
  executeAuthorizedCompanyAction,
  freezeTransactionActor,
  TransactionOutcomeUnknownError,
  type CompanyActionTransactionContext,
  type CompanyActionUnitOfWork,
} from '../src/transactional-unit-of-work.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(1));
const ENTITY_A1 = legalEntityId(id(11));
const USER_A = userId(id(31));
const VALID_FROM = new Date('2026-01-01T00:00:00.000Z');
const DB_NOW = new Date('2026-10-29T12:00:00.000Z');

function activeFacts() {
  return {
    membership: {
      tenantId: TENANT_A,
      userId: USER_A,
      role: 'tenant_member' as const,
      status: 'active' as const,
      validFrom: VALID_FROM,
      validUntil: null,
    },
    grants: [
      {
        grantId: id(90),
        tenantId: TENANT_A,
        userId: USER_A,
        legalEntityId: ENTITY_A1,
        action: 'write' as const,
        validFrom: VALID_FROM,
        validUntil: null,
        revokedAt: null,
      },
    ],
    platformRoleAssignments: [],
    now: DB_NOW,
  };
}

function validAuthDeps() {
  return {
    verifier: {
      verifyAccessToken: async () => ({
        ok: true as const,
        identity: { issuer: 'https://idp.example.test', subject: 'Sub-User-A' },
      }),
    },
    identityResolver: {
      resolveVerifiedIdentity: async () => ({ userId: USER_A }),
    },
  };
}

describe('Transakcyjny UnitOfWork (6D-3A) — freezeTransactionActor i executeAuthorizedCompanyAction', () => {
  it('waliduje i głęboko zamraża aktora transakcyjnego oraz jego tożsamość OIDC', () => {
    const frozen = freezeTransactionActor({
      userId: userId(USER_A.toUpperCase()),
      identity: {
        issuer: 'https://idp.example.test',
        subject: 'Sub-User-A',
        scopes: ['openid', 'pap:accounting'],
      },
    });

    expect(frozen.userId).toBe(USER_A);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.identity)).toBe(true);
    expect(Object.isFrozen(frozen.identity?.scopes)).toBe(true);

    expect(() =>
      freezeTransactionActor({
        userId: USER_A,
        identity: { issuer: ' ', subject: 'Sub-User-A' },
      }),
    ).toThrow('Niepoprawna tożsamość OIDC aktora.');

    expect(() =>
      freezeTransactionActor({
        userId: USER_A,
        identity: { issuer: 'https://idp.example.test', subject: ' Sub-User-A ' },
      }),
    ).toThrow('Niepoprawna tożsamość OIDC aktora.');
  });

  it('odrzuca niepoprawny selektor tenanta/firmy/akcji przed weryfikacją OIDC i otwarciem transakcji', async () => {
    const verifyAccessToken = vi.fn();
    const resolveVerifiedIdentity = vi.fn();
    const runCompanyActionInTransaction = vi.fn();
    const operation = vi.fn();

    for (const invalidInput of [
      {
        rawBearerToken: 'token',
        tenantId: 'zly',
        legalEntityId: ENTITY_A1,
        action: 'read' as const,
      },
      {
        rawBearerToken: 'token',
        tenantId: TENANT_A,
        legalEntityId: 'zly',
        action: 'read' as const,
      },
      {
        rawBearerToken: 'token',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'admin' as unknown as 'read',
      },
    ]) {
      await expect(
        executeAuthorizedCompanyAction(
          invalidInput,
          {
            verifier: { verifyAccessToken },
            identityResolver: { resolveVerifiedIdentity },
            unitOfWork: { runCompanyActionInTransaction, recordDeniedDecision: async () => {} },
          },
          operation,
        ),
      ).resolves.toEqual({
        allowed: false,
        status: 'invalid_selector',
        reason: 'authorization_context_invalid',
      });
    }

    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(resolveVerifiedIdentity).not.toHaveBeenCalled();
    expect(runCompanyActionInTransaction).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('odrzuca niepoprawny token OIDC poza transakcją (bez blokad w DB)', async () => {
    const runCompanyActionInTransaction = vi.fn();
    const operation = vi.fn();

    const result = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'expired-token',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      {
        verifier: {
          verifyAccessToken: async () => ({ ok: false, reason: 'token_expired' }),
        },
        identityResolver: {
          resolveVerifiedIdentity: vi.fn(),
        },
        unitOfWork: { runCompanyActionInTransaction, recordDeniedDecision: async () => {} },
      },
      operation,
    );

    expect(result).toEqual({
      allowed: false,
      status: 'unauthenticated',
      reason: 'token_expired',
    });
    expect(runCompanyActionInTransaction).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('wykonuje rewalidację konta, blokadę faktów, kontekst sesji i operację w jednej transakcji i commituje tylko przy allow', async () => {
    const events: string[] = [];
    let committed: boolean | undefined;

    const tx: CompanyActionTransactionContext = {
      recordAuthorizationDecision: async () => {
        events.push('audit:allow');
      },
      verifyActorAccount: vi.fn(async (txActor) => {
        events.push(`verifyActorAccount:${txActor.userId}:${txActor.identity?.subject}`);
        return true;
      }),
      getLockedFacts: vi.fn(async () => {
        events.push('getLockedFacts');
        return activeFacts();
      }),
      applySessionContext: vi.fn(async (sessionCtx) => {
        events.push(`applySessionContext:${sessionCtx.tenantId}:${sessionCtx.legalEntityId}`);
      }),
    };

    const unitOfWork: CompanyActionUnitOfWork = {
      recordDeniedDecision: async () => {},
      async runCompanyActionInTransaction(work, shouldCommit) {
        events.push('tx:begin');
        const result = await work(tx);
        committed = shouldCommit(result);
        events.push(committed ? 'tx:commit' : 'tx:rollback');
        return result;
      },
    };

    const mutableInput = {
      rawBearerToken: 'valid-jwt',
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A1,
      action: 'write' as 'read' | 'write',
      requiredScopes: ['pap:accounting'],
    };
    const result = await executeAuthorizedCompanyAction(
      mutableInput,
      {
        verifier: {
          verifyAccessToken: async () => {
            mutableInput.action = 'read';
            mutableInput.tenantId = tenantId(id(999));
            events.push('verifyAccessToken');
            return {
              ok: true,
              identity: {
                issuer: 'https://idp.example.test',
                subject: 'Sub-User-A',
                scopes: ['openid', 'pap:accounting'],
              },
            };
          },
        },
        identityResolver: {
          resolveVerifiedIdentity: async () => {
            events.push('resolveVerifiedIdentity');
            return { userId: USER_A };
          },
        },
        unitOfWork,
      },
      async (context, activeTx) => {
        expect(activeTx).toBe(tx);
        expect(Object.isFrozen(context)).toBe(true);
        events.push(`operation:${context.action}`);
        return { invoiceCount: 3 };
      },
    );

    expect(committed).toBe(true);
    expect(result).toEqual({
      allowed: true,
      status: 'allowed',
      reason: 'explicit_company_grant',
      context: {
        userId: USER_A,
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
        identity: {
          issuer: 'https://idp.example.test',
          subject: 'Sub-User-A',
          scopes: ['openid', 'pap:accounting'],
        },
      },
      data: { invoiceCount: 3 },
    });
    expect(events).toEqual([
      'verifyAccessToken',
      'resolveVerifiedIdentity',
      'tx:begin',
      `verifyActorAccount:${USER_A}:Sub-User-A`,
      'getLockedFacts',
      `applySessionContext:${TENANT_A}:${ENTITY_A1}`,
      'operation:write',
      'audit:allow',
      'tx:commit',
    ]);
  });

  it('wycofuje transakcję (shouldCommit=false) i nie wykonuje operacji, gdy konto lub grant zostały cofnięte w oknie TOCTOU', async () => {
    const operation = vi.fn();
    const decisionsCommitted: boolean[] = [];

    const makeUnitOfWork = (tx: CompanyActionTransactionContext): CompanyActionUnitOfWork => ({
      recordDeniedDecision: async () => {},
      async runCompanyActionInTransaction(work, shouldCommit) {
        const result = await work(tx);
        decisionsCommitted.push(shouldCommit(result));
        return result;
      },
    });

    const baseDeps = validAuthDeps();

    // 1) Konto wyłączone między resolveVerifiedIdentity a tx.verifyActorAccount
    const disabledTx: CompanyActionTransactionContext = {
      recordAuthorizationDecision: async () => {},
      verifyActorAccount: vi.fn().mockResolvedValue(false),
      getLockedFacts: vi.fn(),
      applySessionContext: vi.fn(),
    };

    await expect(
      executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        { ...baseDeps, unitOfWork: makeUnitOfWork(disabledTx) },
        operation,
      ),
    ).resolves.toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'identity_not_provisioned_or_disabled',
    });
    expect(disabledTx.getLockedFacts).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();

    // 2) Grant cofnięty tuż przed pobraniem zablokowanych faktów w transakcji
    const revokedGrantTx: CompanyActionTransactionContext = {
      recordAuthorizationDecision: async () => {},
      verifyActorAccount: vi.fn().mockResolvedValue(true),
      getLockedFacts: vi.fn().mockResolvedValue({
        membership: {
          tenantId: TENANT_A,
          userId: USER_A,
          role: 'tenant_member',
          status: 'active',
          validFrom: VALID_FROM,
          validUntil: null,
        },
        grants: [
          {
            grantId: id(91),
            tenantId: TENANT_A,
            userId: USER_A,
            legalEntityId: ENTITY_A1,
            action: 'read',
            validFrom: VALID_FROM,
            validUntil: null,
            revokedAt: DB_NOW,
          },
        ],
        platformRoleAssignments: [],
        now: DB_NOW,
      }),
      applySessionContext: vi.fn(),
    };

    await expect(
      executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        { ...baseDeps, unitOfWork: makeUnitOfWork(revokedGrantTx) },
        operation,
      ),
    ).resolves.toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'explicit_company_grant_required',
    });
    expect(revokedGrantTx.applySessionContext).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
    expect(decisionsCommitted).toEqual([false, false]);
  });

  it('awaria wewnątrz transakcji przed autoryzacją jest fail-closed bez wycieku szczegółów SQL', async () => {
    const result = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      {
        ...validAuthDeps(),
        unitOfWork: {
          recordDeniedDecision: async () => {},
          async runCompanyActionInTransaction() {
            throw new Error('SELECT * FROM app_user password=synthetic-secret');
          },
        },
      },
      async () => 'never',
    );

    expect(result).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_data_unavailable',
    });
  });

  it('zapisuje odmowę dopiero po rollbacku i blokuje odpowiedź przy awarii trwałego audytu', async () => {
    const order: string[] = [];
    const recordDeniedDecision = vi.fn(async (event) => {
      expect(order.at(-1)).toBe('rollback');
      expect(event).toMatchObject({ actorId: USER_A, decision: 'deny', outcome: 'denied' });
      expect(JSON.stringify(event)).not.toContain('synthetic-secret-token');
      order.push('durable-audit');
    });
    const tx: CompanyActionTransactionContext = {
      verifyActorAccount: async () => false,
      getLockedFacts: vi.fn(),
      recordAuthorizationDecision: vi.fn(),
    };
    const unitOfWork: CompanyActionUnitOfWork = {
      recordDeniedDecision,
      async runCompanyActionInTransaction(work, commit) {
        const result = await work(tx);
        expect(commit(result)).toBe(false);
        order.push('rollback');
        return result;
      },
    };
    const input = {
      rawBearerToken: 'synthetic-secret-token',
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A1,
      action: 'read' as const,
    };
    const dependencies = {
      unitOfWork,
      verifier: {
        verifyAccessToken: async () => ({
          ok: true as const,
          identity: { issuer: 'https://idp.example.test', subject: 'subject' },
        }),
      },
      identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
    };
    const operation = vi.fn();
    expect(await executeAuthorizedCompanyAction(input, dependencies, operation)).toMatchObject({
      allowed: false,
      reason: 'identity_not_provisioned_or_disabled',
    });
    expect(order).toEqual(['rollback', 'durable-audit']);
    recordDeniedDecision.mockRejectedValueOnce(new Error('SQL secret'));
    expect(await executeAuthorizedCompanyAction(input, dependencies, operation)).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_audit_unavailable',
    });
    expect(operation).not.toHaveBeenCalled();
  });

  describe('SEC-03 — rozróżnienie potwierdzonego rollbacku, potwierdzonego COMMIT i niepewnego wyniku', () => {
    it('zapisuje allow/rolled_back wyłącznie wtedy, gdy błąd wystąpił przed COMMIT i rollback został potwierdzony', async () => {
      const persistedAudit: SecurityAuditEvent[] = [];
      let stagedEffect = false;

      const makeTx = (failAtomicAudit: boolean): CompanyActionTransactionContext => ({
        verifyActorAccount: async () => true,
        getLockedFacts: async () => activeFacts(),
        applySessionContext: async () => {},
        recordAuthorizationDecision: async (event) => {
          if (failAtomicAudit) {
            throw new SecurityAuditUnavailableError();
          }
          persistedAudit.push(event);
        },
      });

      // 1) Błąd callbacku biznesowego przed COMMIT + potwierdzony ROLLBACK
      const uowOperationFailure: CompanyActionUnitOfWork = {
        recordDeniedDecision: async (event) => {
          persistedAudit.push(event);
        },
        async runCompanyActionInTransaction(work) {
          try {
            return await work(makeTx(false));
          } catch (error) {
            stagedEffect = false;
            throw new ConfirmedTransactionRollbackError(error);
          }
        },
      };

      const opResult = await executeAuthorizedCompanyAction(
        {
          requestId: id(201),
          operationId: id(301),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        { ...validAuthDeps(), unitOfWork: uowOperationFailure },
        async () => {
          stagedEffect = true;
          throw new Error('Błąd walidacji biznesowej przed COMMIT');
        },
      );

      expect(stagedEffect).toBe(false);
      expect(opResult).toEqual({
        allowed: false,
        status: 'forbidden',
        reason: 'authorization_data_unavailable',
      });
      expect(persistedAudit).toEqual([
        expect.objectContaining({
          requestId: id(201),
          operationId: id(301),
          actorId: USER_A,
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'operation_failed',
        }),
      ]);

      // 2) Awaria atomowego INSERT audytu przed COMMIT + potwierdzony ROLLBACK
      persistedAudit.length = 0;
      const uowAuditFailure: CompanyActionUnitOfWork = {
        recordDeniedDecision: async (event) => {
          persistedAudit.push(event);
        },
        async runCompanyActionInTransaction(work) {
          try {
            return await work(makeTx(true));
          } catch (error) {
            stagedEffect = false;
            throw new ConfirmedTransactionRollbackError(error);
          }
        },
      };

      const auditFailResult = await executeAuthorizedCompanyAction(
        {
          requestId: id(202),
          operationId: id(302),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        { ...validAuthDeps(), unitOfWork: uowAuditFailure },
        async () => {
          stagedEffect = true;
          return { ok: true };
        },
      );

      expect(stagedEffect).toBe(false);
      expect(auditFailResult).toEqual({
        allowed: false,
        status: 'forbidden',
        reason: 'authorization_audit_unavailable',
      });
      expect(persistedAudit).toEqual([
        expect.objectContaining({
          requestId: id(202),
          operationId: id(302),
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'authorization_audit_unavailable',
        }),
      ]);
    });

    it('przy utracie potwierdzenia po skutecznym COMMIT nie tworzy fałszywego rolled_back, nie ponawia callbacku i obsługuje ponowienie idempotentnie', async () => {
      const committedProbes = new Set<string>();
      const committedAuditLog: SecurityAuditEvent[] = [];
      let loseCommitAckOnAttempt = true;
      let callbackInvocations = 0;

      const unitOfWork: CompanyActionUnitOfWork = {
        recordDeniedDecision: async (event) => {
          committedAuditLog.push(event);
        },
        async runCompanyActionInTransaction(work, shouldCommit) {
          const txStagedProbes: string[] = [];
          const txStagedAudit: SecurityAuditEvent[] = [];
          const tx: CompanyActionTransactionContext = {
            verifyActorAccount: async () => true,
            getLockedFacts: async () => activeFacts(),
            applySessionContext: async () => {},
            recordAuthorizationDecision: async (event) => {
              txStagedAudit.push(event);
            },
          };

          const result = await work(tx);
          if (shouldCommit(result)) {
            // PostgreSQL zatwierdził mutację oraz atomowy wpis allow/committed...
            for (const opId of txStagedProbes) committedProbes.add(opId);
            committedAuditLog.push(...txStagedAudit);
            if (loseCommitAckOnAttempt) {
              // ...ale połączenie zostało zerwane zanim klient otrzymał potwierdzenie COMMIT.
              throw new TransactionOutcomeUnknownError(
                Object.assign(new Error('08007: transaction_resolution_unknown'), {
                  code: '08007',
                }),
              );
            }
          }
          return result;
        },
      };

      const operationId = id(401);
      const executeProbe = (requestId: string) =>
        executeAuthorizedCompanyAction(
          {
            requestId,
            operationId,
            rawBearerToken: 'synthetic-jwt-secret',
            tenantId: TENANT_A,
            legalEntityId: ENTITY_A1,
            action: 'write',
          },
          { ...validAuthDeps(), unitOfWork },
          async () => {
            callbackInvocations += 1;
            const alreadyCommitted = committedProbes.has(operationId);
            if (!alreadyCommitted) {
              committedProbes.add(operationId);
            }
            return { operationId, created: !alreadyCommitted };
          },
        );

      // Próba 1: PG wykonał COMMIT, klient utracił potwierdzenie
      const firstAttempt = await executeProbe(id(501));
      expect(firstAttempt).toEqual({
        allowed: false,
        status: 'unavailable',
        reason: 'transaction_outcome_unknown',
      });
      // Brak automatycznego retry callbacku biznesowego
      expect(callbackInvocations).toBe(1);
      expect(committedProbes.size).toBe(1);
      // Brak fałszywego allow/rolled_back — zachowany atomowy committed oraz jawny ślad niepewności
      expect(committedAuditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
      expect(committedAuditLog).toEqual([
        expect.objectContaining({
          requestId: id(501),
          operationId,
          actorId: USER_A,
          decision: 'allow',
          outcome: 'committed',
          reason: 'explicit_company_grant',
        }),
        expect.objectContaining({
          requestId: id(501),
          operationId,
          actorId: USER_A,
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        }),
      ]);

      // Próba 2: jawne ponowienie operacji przez klienta z tym samym operationId
      loseCommitAckOnAttempt = false;
      const retryAttempt = await executeProbe(id(502));
      expect(retryAttempt).toMatchObject({
        allowed: true,
        status: 'allowed',
        reason: 'explicit_company_grant',
        data: { operationId, created: false },
      });
      expect(callbackInvocations).toBe(2);
      expect(committedProbes.size).toBe(1);
      expect(committedAuditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
      expect(committedAuditLog).toHaveLength(3);
      expect(committedAuditLog[2]).toMatchObject({
        requestId: id(502),
        operationId,
        decision: 'allow',
        outcome: 'committed',
        reason: 'explicit_company_grant',
      });
      expect(JSON.stringify(committedAuditLog)).not.toContain('synthetic-jwt-secret');
    });

    it('nie utożsamia niepotwierdzonego odrzucenia Promise po autoryzacji z rollbackiem, nawet gdy DB pozostaje niedostępna', async () => {
      const recordedOutsideTx: SecurityAuditEvent[] = [];

      // Zwykły Error rzucony po wejściu w callback bez ConfirmedTransactionRollbackError (np. zerwanie gniazda podczas ROLLBACK)
      const uowUnconfirmed: CompanyActionUnitOfWork = {
        recordDeniedDecision: async (event) => {
          recordedOutsideTx.push(event);
          throw new Error('DB nadal niedostępna po zerwaniu połączenia');
        },
        async runCompanyActionInTransaction(work) {
          const tx: CompanyActionTransactionContext = {
            verifyActorAccount: async () => true,
            getLockedFacts: async () => activeFacts(),
            recordAuthorizationDecision: async () => {},
          };
          await work(tx);
          throw new Error('write ECONNRESET 127.0.0.1:5432');
        },
      };

      const callback = vi.fn(async () => ({ ok: true }));
      const result = await executeAuthorizedCompanyAction(
        {
          requestId: id(601),
          operationId: id(602),
          rawBearerToken: 'valid-jwt',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'write',
        },
        { ...validAuthDeps(), unitOfWork: uowUnconfirmed },
        callback,
      );

      expect(callback).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        allowed: false,
        status: 'unavailable',
        reason: 'transaction_outcome_unknown',
      });
      expect(recordedOutsideTx).toEqual([
        expect.objectContaining({
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        }),
      ]);
      expect(recordedOutsideTx.some((e) => e.outcome === 'rolled_back')).toBe(false);
    });
  });
});
