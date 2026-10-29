import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import {
  executeAuthorizedCompanyAction,
  freezeTransactionActor,
  type CompanyActionTransactionContext,
  type CompanyActionUnitOfWork,
} from '../src/transactional-unit-of-work.js';

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
            unitOfWork: { runCompanyActionInTransaction },
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
          verifyAccessToken: async () => ({ ok: false, reason: 'expired_token' }),
        },
        identityResolver: {
          resolveVerifiedIdentity: vi.fn(),
        },
        unitOfWork: { runCompanyActionInTransaction },
      },
      operation,
    );

    expect(result).toEqual({
      allowed: false,
      status: 'unauthenticated',
      reason: 'expired_token',
    });
    expect(runCompanyActionInTransaction).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });

  it('wykonuje rewalidację konta, blokadę faktów, kontekst sesji i operację w jednej transakcji i commituje tylko przy allow', async () => {
    const events: string[] = [];
    let committed: boolean | undefined;

    const tx: CompanyActionTransactionContext = {
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
      async runCompanyActionInTransaction(work, shouldCommit) {
        events.push('tx:begin');
        const result = await work(tx);
        committed = shouldCommit(result);
        events.push(committed ? 'tx:commit' : 'tx:rollback');
        return result;
      },
    };

    const result = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'valid-jwt',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
        requiredScopes: ['pap:accounting'],
      },
      {
        verifier: {
          verifyAccessToken: async () => {
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
      'tx:commit',
    ]);
  });

  it('wycofuje transakcję (shouldCommit=false) i nie wykonuje operacji, gdy konto lub grant zostały cofnięte w oknie TOCTOU', async () => {
    const operation = vi.fn();
    const decisionsCommitted: boolean[] = [];

    const makeUnitOfWork = (tx: CompanyActionTransactionContext): CompanyActionUnitOfWork => ({
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
});
