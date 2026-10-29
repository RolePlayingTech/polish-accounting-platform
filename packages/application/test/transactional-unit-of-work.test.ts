import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import {
  ConfirmedTransactionRollbackError,
  executeAuthorizedCompanyAction,
  freezeTransactionActor,
  TransactionOutcomeUnknownError,
  type CompanyActionTransactionContext,
  type CompanyActionUnitOfWork,
} from '../src/transactional-unit-of-work.js';
import { SecurityAuditUnavailableError, type SecurityAuditEvent } from '../src/security-audit.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(1));
const ENTITY_A1 = legalEntityId(id(11));
const USER_A = userId(id(31));
const VALID_FROM = new Date('2026-01-01T00:00:00.000Z');
const DB_NOW = new Date('2026-10-29T12:00:00.000Z');

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
        return {
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
              grantId: id(90),
              tenantId: TENANT_A,
              userId: USER_A,
              legalEntityId: ENTITY_A1,
              action: 'write',
              validFrom: VALID_FROM,
              validUntil: null,
              revokedAt: null,
            },
          ],
          platformRoleAssignments: [],
          now: DB_NOW,
        };
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

    const baseDeps = {
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

  it('awaria wewnątrz transakcji lub operacji jest fail-closed bez wycieku szczegółów SQL', async () => {
    const result = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      {
        verifier: {
          verifyAccessToken: async () => ({
            ok: true,
            identity: { issuer: 'https://idp.example.test', subject: 'Sub-User-A' },
          }),
        },
        identityResolver: {
          resolveVerifiedIdentity: async () => ({ userId: USER_A }),
        },
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

  it('SEC-03: zapisuje allow/rolled_back wyłącznie przy potwierdzonym rollbacku (przed COMMIT oraz przy serwerowym odrzuceniu COMMIT)', async () => {
    const durableEvents: SecurityAuditEvent[] = [];
    const baseFacts = {
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
          grantId: id(95),
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

    const baseDeps = {
      verifier: {
        verifyAccessToken: async () => ({
          ok: true as const,
          identity: { issuer: 'https://idp.example.test', subject: 'Sub-User-A' },
        }),
      },
      identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
    };

    // 1) Błąd biznesowy przed COMMIT + potwierdzony ROLLBACK -> allow/rolled_back (operation_failed)
    const preCommitRollbackUoW: CompanyActionUnitOfWork = {
      recordDeniedDecision: async (ev) => {
        durableEvents.push(ev);
      },
      async runCompanyActionInTransaction(work) {
        const tx: CompanyActionTransactionContext = {
          verifyActorAccount: async () => true,
          getLockedFacts: async () => baseFacts,
          recordAuthorizationDecision: vi.fn(),
        };
        try {
          return await work(tx);
        } catch (err) {
          throw new ConfirmedTransactionRollbackError(err);
        }
      },
    };

    const preCommitRes = await executeAuthorizedCompanyAction(
      {
        requestId: id(201),
        operationId: id(301),
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      { ...baseDeps, unitOfWork: preCommitRollbackUoW },
      async () => {
        throw new Error('Błąd walidacji w callbacku przed COMMIT');
      },
    );
    expect(preCommitRes).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_data_unavailable',
    });

    // 2) Awaria atomowego INSERT audytu przed COMMIT + potwierdzony ROLLBACK -> allow/rolled_back (authorization_audit_unavailable)
    const auditFailUoW: CompanyActionUnitOfWork = {
      recordDeniedDecision: async (ev) => {
        durableEvents.push(ev);
      },
      async runCompanyActionInTransaction(work) {
        const tx: CompanyActionTransactionContext = {
          verifyActorAccount: async () => true,
          getLockedFacts: async () => baseFacts,
          recordAuthorizationDecision: async () => {
            throw new SecurityAuditUnavailableError();
          },
        };
        try {
          return await work(tx);
        } catch (err) {
          throw new ConfirmedTransactionRollbackError(err);
        }
      },
    };

    const auditFailRes = await executeAuthorizedCompanyAction(
      {
        requestId: id(202),
        operationId: id(302),
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      { ...baseDeps, unitOfWork: auditFailUoW },
      async () => ({ ok: true }),
    );
    expect(auditFailRes).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_audit_unavailable',
    });

    // 3) Odroczony constraint trigger PostgreSQL (23514) odrzucający COMMIT z potwierdzonym rollbackiem serwera
    const deferredTriggerAbortUoW: CompanyActionUnitOfWork = {
      recordDeniedDecision: async (ev) => {
        durableEvents.push(ev);
      },
      async runCompanyActionInTransaction(work, shouldCommit) {
        const stagedEvents: SecurityAuditEvent[] = [];
        const tx: CompanyActionTransactionContext = {
          verifyActorAccount: async () => true,
          getLockedFacts: async () => baseFacts,
          recordAuthorizationDecision: async (ev) => {
            stagedEvents.push(ev);
          },
        };
        const result = await work(tx);
        expect(shouldCommit(result)).toBe(true);
        expect(stagedEvents).toHaveLength(1);
        // Serwer odrzucił COMMIT przed WAL -> stagedEvents wycofane, potwierdzony rollback
        throw new ConfirmedTransactionRollbackError(
          Object.assign(new Error('Brak atomowego audytu operacji'), { code: '23514' }),
        );
      },
    };

    const deferredAbortRes = await executeAuthorizedCompanyAction(
      {
        requestId: id(203),
        operationId: id(303),
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      { ...baseDeps, unitOfWork: deferredTriggerAbortUoW },
      async () => ({ ok: true }),
    );
    expect(deferredAbortRes).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_data_unavailable',
    });

    expect(durableEvents).toEqual([
      expect.objectContaining({
        requestId: id(201),
        operationId: id(301),
        decision: 'allow',
        outcome: 'rolled_back',
        reason: 'operation_failed',
      }),
      expect.objectContaining({
        requestId: id(202),
        operationId: id(302),
        decision: 'allow',
        outcome: 'rolled_back',
        reason: 'authorization_audit_unavailable',
      }),
      expect.objectContaining({
        requestId: id(203),
        operationId: id(303),
        decision: 'allow',
        outcome: 'rolled_back',
        reason: 'operation_failed',
      }),
    ]);
  });

  it('SEC-03: utrata potwierdzenia po skutecznym COMMIT nie tworzy fałszywego rolled_back, nie ponawia callbacku i obsługuje idempotentny retry z tym samym operationId', async () => {
    const persistedOperations = new Map<string, { readonly probe: string }>();
    const persistedAuditLog: SecurityAuditEvent[] = [];
    let simulateLostCommitAck = true;
    let failDiagnosticAuditOnce = false;

    const unitOfWork: CompanyActionUnitOfWork = {
      async recordDeniedDecision(event) {
        if (failDiagnosticAuditOnce) {
          failDiagnosticAuditOnce = false;
          throw new SecurityAuditUnavailableError();
        }
        persistedAuditLog.push(event);
      },
      async runCompanyActionInTransaction(work, shouldCommit) {
        const stagedOps = new Map<string, { readonly probe: string }>();
        const stagedAudit: SecurityAuditEvent[] = [];
        const tx: CompanyActionTransactionContext = {
          verifyActorAccount: async () => true,
          getLockedFacts: async () => ({
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
                grantId: id(96),
                tenantId: TENANT_A,
                userId: USER_A,
                legalEntityId: ENTITY_A1,
                action: 'write',
                validFrom: VALID_FROM,
                validUntil: null,
                revokedAt: null,
              },
            ],
            platformRoleAssignments: [],
            now: DB_NOW,
          }),
          recordAuthorizationDecision: async (event) => {
            stagedAudit.push(event);
          },
        };

        const txWithStore = Object.assign(tx, {
          upsertIdempotentProbe(opId: string, payload: { readonly probe: string }) {
            const existing = persistedOperations.get(opId) ?? stagedOps.get(opId);
            if (existing) {
              return { created: false, record: existing };
            }
            stagedOps.set(opId, payload);
            return { created: true, record: payload };
          },
        });

        const result = await work(txWithStore);
        if (!shouldCommit(result)) {
          return result;
        }

        // PostgreSQL zatwierdził transakcję (efekt biznesowy + atomowy allow/committed w WAL):
        for (const [key, value] of stagedOps) {
          persistedOperations.set(key, value);
        }
        persistedAuditLog.push(...stagedAudit);

        if (simulateLostCommitAck) {
          simulateLostCommitAck = false;
          throw new TransactionOutcomeUnknownError(
            Object.assign(new Error('utracono potwierdzenie COMMIT'), { code: '08007' }),
          );
        }
        return result;
      },
    };

    const deps = {
      verifier: {
        verifyAccessToken: async () => ({
          ok: true as const,
          identity: { issuer: 'https://idp.example.test', subject: 'Sub-User-A' },
        }),
      },
      identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
      unitOfWork,
    };

    const opId = id(401);
    let callbackInvocations = 0;

    // Pierwsze wywołanie: serwer wykonał COMMIT, klient stracił potwierdzenie
    const firstAttempt = await executeAuthorizedCompanyAction(
      {
        requestId: id(501),
        operationId: opId,
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      deps as Parameters<typeof executeAuthorizedCompanyAction>[1],
      async (_ctx, rawTx) => {
        callbackInvocations += 1;
        const txStore = rawTx as CompanyActionTransactionContext & {
          upsertIdempotentProbe(
            key: string,
            payload: { readonly probe: string },
          ): { created: boolean; record: { readonly probe: string } };
        };
        return txStore.upsertIdempotentProbe(opId, { probe: 'syntetyczny-zapis' });
      },
    );

    // Brak automatycznego ponowienia callbacku i brak fałszywego rolled_back
    expect(callbackInvocations).toBe(1);
    expect(firstAttempt).toEqual({
      allowed: false,
      status: 'unavailable',
      reason: 'transaction_outcome_unknown',
    });
    expect(persistedOperations.size).toBe(1);
    expect(persistedAuditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
    expect(persistedAuditLog).toEqual([
      expect.objectContaining({
        requestId: id(501),
        operationId: opId,
        decision: 'allow',
        outcome: 'committed',
        reason: 'explicit_company_grant',
      }),
      expect.objectContaining({
        requestId: id(501),
        operationId: opId,
        decision: 'allow',
        outcome: 'outcome_unknown',
        reason: 'transaction_outcome_unknown',
      }),
    ]);

    // Jawne ponowienie operacji przez klienta z tym samym operationId: brak duplikacji efektu
    const retryAttempt = await executeAuthorizedCompanyAction(
      {
        requestId: id(502),
        operationId: opId,
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      deps as Parameters<typeof executeAuthorizedCompanyAction>[1],
      async (_ctx, rawTx) => {
        callbackInvocations += 1;
        const txStore = rawTx as CompanyActionTransactionContext & {
          upsertIdempotentProbe(
            key: string,
            payload: { readonly probe: string },
          ): { created: boolean; record: { readonly probe: string } };
        };
        return txStore.upsertIdempotentProbe(opId, { probe: 'syntetyczny-zapis' });
      },
    );

    expect(callbackInvocations).toBe(2);
    expect(retryAttempt).toMatchObject({
      allowed: true,
      status: 'allowed',
      reason: 'explicit_company_grant',
      data: { created: false, record: { probe: 'syntetyczny-zapis' } },
    });
    expect(persistedOperations.size).toBe(1);
    expect(persistedAuditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);

    // Także gdy baza pozostaje niedostępna dla diagnostycznego audytu po zerwaniu COMMIT,
    // zachowany jest fail-closed `transaction_outcome_unknown` (bez nadpisania i bez rolled_back)
    simulateLostCommitAck = true;
    failDiagnosticAuditOnce = true;
    const outageAttempt = await executeAuthorizedCompanyAction(
      {
        requestId: id(503),
        operationId: id(402),
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      deps,
      async () => 'zapis',
    );
    expect(outageAttempt).toEqual({
      allowed: false,
      status: 'unavailable',
      reason: 'transaction_outcome_unknown',
    });
    expect(persistedAuditLog.some((e) => e.outcome === 'rolled_back')).toBe(false);
  });

  it('SEC-03: niepotwierdzone odrzucenie Promise transakcji po autoryzacji nigdy nie jest klasyfikowane jako rolled_back', async () => {
    const recorded: SecurityAuditEvent[] = [];
    const result = await executeAuthorizedCompanyAction(
      {
        requestId: id(601),
        operationId: id(602),
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      {
        verifier: {
          verifyAccessToken: async () => ({
            ok: true as const,
            identity: { issuer: 'https://idp.example.test', subject: 'Sub-User-A' },
          }),
        },
        identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
        unitOfWork: {
          recordDeniedDecision: async (event) => {
            recorded.push(event);
          },
          async runCompanyActionInTransaction(work) {
            await work({
              verifyActorAccount: async () => true,
              getLockedFacts: async () => ({
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
                    grantId: id(97),
                    tenantId: TENANT_A,
                    userId: USER_A,
                    legalEntityId: ENTITY_A1,
                    action: 'write',
                    validFrom: VALID_FROM,
                    validUntil: null,
                    revokedAt: null,
                  },
                ],
                platformRoleAssignments: [],
                now: DB_NOW,
              }),
              recordAuthorizationDecision: async () => {},
            });
            // Surowy wyjątek bez dowodu potwierdzonego ROLLBACKu
            throw new Error('ECONNRESET po wysłaniu COMMIT');
          },
        },
      },
      async () => ({ saved: true }),
    );

    expect(result).toEqual({
      allowed: false,
      status: 'unavailable',
      reason: 'transaction_outcome_unknown',
    });
    expect(recorded).toEqual([
      expect.objectContaining({
        decision: 'allow',
        outcome: 'outcome_unknown',
        reason: 'transaction_outcome_unknown',
      }),
    ]);
  });
});
