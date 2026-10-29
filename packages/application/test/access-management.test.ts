import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId, type TenantMembership } from '@pap/domain';
import {
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  manageAccess,
  type AccessManagementAuthorizationDataSource,
  type AccessManagementCommand,
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
  return {
    store: { execute: vi.fn().mockResolvedValue({ ok: true }) },
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
    expect(deps.authorizer.authorize).toHaveBeenCalledWith(actor, command);
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
    'awaria %s jest fail-closed bez surowego wyjątku',
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
    const store = { execute: vi.fn().mockResolvedValue({ ok: true }) };

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
});
