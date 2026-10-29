import {
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  executeAuthorizedCompanyAction,
  manageAccess,
  type AccessManagementCommand,
  type AccessManagementResult,
  type OidcAccessTokenVerifier,
  type UserIdentityResolver,
} from '@pap/application';
import { legalEntityId, tenantId, userId, type UserId } from '@pap/domain';
import { and, eq, sql as statement } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAccessManagementStore } from '../src/access-management.js';
import { connectDatabase } from '../src/client.js';
import { applyMigrations } from '../src/migrations.js';
import {
  accessManagementEvent,
  appUser,
  companyAccessGrant,
  legalEntity,
  tenant,
  tenantMembership,
  userOidcIdentity,
} from '../src/schema.js';
import { PostgresTransactionalUnitOfWork } from '../src/transactional-unit-of-work.js';
import { PostgresUserIdentityResolver, PostgresUserIdentityStore } from '../src/user-identity.js';
import { createTestDatabase, type TestDatabase } from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const TENANT_A = tenantId(id(1));
const TENANT_B = tenantId(id(2));
const ENTITY_A1 = legalEntityId(id(11));
const ENTITY_A2 = legalEntityId(id(12));
const ENTITY_B1 = legalEntityId(id(21));

// Celowo kontrolowane porządki UUID (np. ADMIN_LOW < OWNER_MID < ADMIN_HIGH) pod testy porządku blokad
const ADMIN_LOW = userId(id(30));
const MEMBER_1 = userId(id(31));
const MEMBER_2 = userId(id(32));
const OWNER_A = userId(id(35));
const ADMIN_HIGH = userId(id(40));
const OWNER_B = userId(id(50));
const PLATFORM_OP = userId(id(60));

const ISSUER_1 = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const ISSUER_2 = 'https://backup-idp.example.test/realms/pap';
const VALID_FROM = new Date('2026-01-01T00:00:00.000Z');

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('6D-3A — transakcyjna autoryzacja, UnitOfWork i eliminacja TOCTOU na PostgreSQL', () => {
  let database: TestDatabase | undefined;
  let seq = 1000;
  const nextId = () => id(seq++);

  const connection = () => {
    if (!database) {
      throw new Error('Brak testowej bazy PostgreSQL.');
    }
    return database;
  };

  const verifier: OidcAccessTokenVerifier = {
    async verifyAccessToken(rawToken) {
      if (!rawToken.startsWith('token:')) {
        return { ok: false, reason: 'invalid_signature' };
      }
      const payload = rawToken.slice('token:'.length);
      const separator = payload.indexOf('|');
      const issuer = separator >= 0 ? payload.slice(0, separator) : ISSUER_1;
      const subject = separator >= 0 ? payload.slice(separator + 1) : payload;
      return {
        ok: true,
        identity: {
          issuer,
          subject,
          scopes: ['openid', 'pap:accounting'],
        },
      };
    },
  };

  async function waitForBlockedBy(holderPid: number, waiterPid: number): Promise<void> {
    const { client: sql } = connection();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const rows =
        await sql`SELECT ${holderPid}::int = ANY(pg_blocking_pids(${waiterPid}::int)) AS blocked`;
      if (rows[0]?.blocked === true) {
        return;
      }
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(
      `Transakcja backendu ${waiterPid} nie zablokowała się deterministycznie na blokadzie ${holderPid}.`,
    );
  }

  function wrapDbWithTimeouts(
    baseDb: Pick<TestDatabase['db'], 'transaction'>,
    onBegin?: (
      tx: Parameters<Parameters<TestDatabase['db']['transaction']>[0]>[0],
      pid: number,
    ) => Promise<void>,
  ): Pick<TestDatabase['db'], 'transaction'> {
    return {
      transaction: (callback) =>
        baseDb.transaction(async (tx) => {
          await tx.execute(statement`SET LOCAL lock_timeout = '4s'`);
          await tx.execute(statement`SET LOCAL statement_timeout = '5s'`);
          await tx.execute(statement`SET LOCAL deadlock_timeout = '50ms'`);
          const pid = Number(
            (await tx.execute<{ pid: number }>(statement`SELECT pg_backend_pid() AS pid`))[0]!.pid,
          );
          if (onBegin) {
            await onBegin(tx, pid);
          }
          return callback(tx);
        }),
    };
  }

  async function seedStandardTenantState() {
    const { db } = connection();
    const identityStore = new PostgresUserIdentityStore(db);

    const users: Array<{ uid: UserId; sub: string }> = [
      { uid: ADMIN_LOW, sub: 'sub-admin-low' },
      { uid: MEMBER_1, sub: 'sub-member-1' },
      { uid: MEMBER_2, sub: 'sub-member-2' },
      { uid: OWNER_A, sub: 'sub-owner-a' },
      { uid: ADMIN_HIGH, sub: 'sub-admin-high' },
      { uid: OWNER_B, sub: 'sub-owner-b' },
      { uid: PLATFORM_OP, sub: 'sub-platform-op' },
    ];

    for (const entry of users) {
      const res = await identityStore.provisionUserWithOidcIdentity({
        userId: entry.uid,
        identityId: nextId(),
        issuer: ISSUER_1,
        subject: entry.sub,
      });
      expect(res).toEqual({ ok: true, userId: entry.uid });
    }

    await db.insert(tenantMembership).values([
      {
        tenantId: TENANT_A,
        userId: OWNER_A,
        role: 'tenant_owner',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        role: 'tenant_admin',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_A,
        userId: ADMIN_HIGH,
        role: 'tenant_admin',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_A,
        userId: MEMBER_1,
        role: 'tenant_member',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_A,
        userId: MEMBER_2,
        role: 'tenant_member',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_B,
        userId: OWNER_B,
        role: 'tenant_owner',
        status: 'active',
        validFrom: VALID_FROM,
      },
      {
        tenantId: TENANT_B,
        userId: MEMBER_1,
        role: 'tenant_member',
        status: 'active',
        validFrom: VALID_FROM,
      },
    ]);
  }

  function runOidcManageAccess(
    token: string,
    command: AccessManagementCommand,
    options?: {
      readonly store?: PostgresAccessManagementStore;
      readonly identityResolver?: UserIdentityResolver;
    },
  ): Promise<AccessManagementResult> {
    const { db } = connection();
    const store = options?.store ?? new PostgresAccessManagementStore(db);
    const identityResolver = options?.identityResolver ?? new PostgresUserIdentityResolver(db);
    const authorizer = createTenantAccessManagementAuthorizer();
    return manageAccess(command, {
      store,
      actors: createOidcAccessManagementActorSource(token, {
        verifier,
        identityResolver,
      }),
      authorizer,
    });
  }

  beforeAll(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.db, database.dataSchema);
    await database.db.insert(tenant).values([
      { id: TENANT_A, name: 'Syntetyczny Tenant A (6D-3A)' },
      { id: TENANT_B, name: 'Syntetyczny Tenant B (6D-3A)' },
    ]);
    await database.db.insert(legalEntity).values([
      { id: ENTITY_A1, tenantId: TENANT_A, displayName: 'Spółka A1' },
      { id: ENTITY_A2, tenantId: TENANT_A, displayName: 'Spółka A2' },
      { id: ENTITY_B1, tenantId: TENANT_B, displayName: 'Spółka B1' },
    ]);
  });

  beforeEach(async () => {
    const { db, client: sql } = connection();
    await sql`TRUNCATE access_management_event`;
    await db.delete(companyAccessGrant);
    await db.delete(tenantMembership);
    await db.delete(userOidcIdentity);
    await db.delete(appUser);
    await seedStandardTenantState();
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  it('Scenariusz 1A/1B/1C: cofnięcie członkostwa aktora po OIDC lub w trakcie wyścigu blokad uniemożliwia zapis na nieaktualnej decyzji', async () => {
    const { db } = connection();

    // Właściciel nadaje ADMIN_HIGH delegowalny grant read na ENTITY_A1
    const seedAdminGrant = await runOidcManageAccess('token:sub-owner-a', {
      kind: 'grant',
      operationId: nextId(),
      tenantId: TENANT_A,
      userId: ADMIN_HIGH,
      grantId: nextId(),
      legalEntityId: ENTITY_A1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    });
    expect(seedAdminGrant).toMatchObject({ ok: true });

    // --- 1A: Bariera po rozwiązaniu OIDC (przed otwarciem transakcji DB) ---
    const afterOidcResolved = deferred();
    const resumeAfterRevoke = deferred();
    const baseResolver = new PostgresUserIdentityResolver(db);
    const barrierResolver: UserIdentityResolver = {
      async resolveVerifiedIdentity(identity) {
        const resolved = await baseResolver.resolveVerifiedIdentity(identity);
        afterOidcResolved.resolve();
        await resumeAfterRevoke.promise;
        return resolved;
      },
    };

    const adminAttempt1A = runOidcManageAccess(
      'token:sub-admin-high',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { identityResolver: barrierResolver },
    );

    await afterOidcResolved.promise;

    // Właściciel cofa członkostwo ADMIN_HIGH zanim transakcja ADMIN_HIGH wystartuje
    const revokeAdmin1A = await runOidcManageAccess('token:sub-owner-a', {
      kind: 'revoke_membership',
      operationId: nextId(),
      tenantId: TENANT_A,
      userId: ADMIN_HIGH,
    });
    expect(revokeAdmin1A).toMatchObject({ ok: true });

    resumeAfterRevoke.resolve();
    expect(await adminAttempt1A).toEqual({ ok: false, reason: 'access_management_denied' });

    const member1GrantsAfter1A = await db
      .select()
      .from(companyAccessGrant)
      .where(
        and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
      );
    expect(member1GrantsAfter1A).toHaveLength(0);

    // --- 1B: Rzeczywista konkurencja na blokadzie wierszowej (pg_blocking_pids) ---
    // Przygotowujemy ADMIN_LOW z aktywnym członkostwem i grantem read na ENTITY_A1
    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    const ownerHold = deferred<number>();
    const releaseOwnerHold = deferred();
    const adminWait = deferred<number>();

    const ownerStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (tx, pid) => {
        // Właściciel zajmuje FOR UPDATE na wierszu członkostwa ADMIN_LOW (jeszcze PRZED UPDATE status='revoked'!)
        await tx
          .select()
          .from(tenantMembership)
          .where(
            and(eq(tenantMembership.tenantId, TENANT_A), eq(tenantMembership.userId, ADMIN_LOW)),
          )
          .for('update');
        ownerHold.resolve(pid);
        await releaseOwnerHold.promise;
      }),
    );

    const adminStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        adminWait.resolve(pid);
      }),
    );

    const ownerRevoking = runOidcManageAccess(
      'token:sub-owner-a',
      {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
      },
      { store: ownerStore },
    );

    const holderPid = await ownerHold.promise;

    // ADMIN_LOW otwiera transakcję, w snapshot MVCC widzi jeszcze status='active', ale blokuje się na FOR SHARE!
    const adminGrantingWhileRevoked = runOidcManageAccess(
      'token:sub-admin-low',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { store: adminStore },
    );

    try {
      const waiterPid = await adminWait.promise;
      await waitForBlockedBy(holderPid, waiterPid);
    } finally {
      releaseOwnerHold.resolve();
    }

    const [ownerRes1B, adminRes1B] = await Promise.all([ownerRevoking, adminGrantingWhileRevoked]);
    expect(ownerRes1B).toMatchObject({ ok: true });
    expect(adminRes1B).toEqual({ ok: false, reason: 'access_management_denied' });

    const member1GrantsAfter1B = await db
      .select()
      .from(companyAccessGrant)
      .where(
        and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
      );
    expect(member1GrantsAfter1B).toHaveLength(0);

    // --- 1C: Odwrotna kolejność — ADMIN trzyma już FOR SHARE, więc revoke_membership czeka aż ADMIN zakończy ---
    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'reactivate_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    const adminLockedFacts = deferred<number>();
    const releaseAdminCommit = deferred();
    const ownerRevokePid = deferred<number>();
    let currentAdminPid = 0;

    const adminHoldingStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        currentAdminPid = pid;
      }),
    );
    const ownerWaitingStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        ownerRevokePid.resolve(pid);
      }),
    );

    const baseAuthorizer = createTenantAccessManagementAuthorizer();
    const pausingAuthorizer = {
      async authorize(
        actor: Parameters<typeof baseAuthorizer.authorize>[0],
        cmd: Parameters<typeof baseAuthorizer.authorize>[1],
        tx?: Parameters<typeof baseAuthorizer.authorize>[2],
      ) {
        const decision = await baseAuthorizer.authorize(actor, cmd, tx);
        adminLockedFacts.resolve(currentAdminPid);
        await releaseAdminCommit.promise;
        return decision;
      },
    };

    const adminFirstPromise = manageAccess(
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_2,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      {
        store: adminHoldingStore,
        actors: createOidcAccessManagementActorSource('token:sub-admin-low', {
          verifier,
          identityResolver: baseResolver,
        }),
        authorizer: pausingAuthorizer,
      },
    );

    const adminPid = await adminLockedFacts.promise;
    const ownerSecondPromise = runOidcManageAccess(
      'token:sub-owner-a',
      {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
      },
      { store: ownerWaitingStore },
    );

    try {
      const waiterPid = await ownerRevokePid.promise;
      await waitForBlockedBy(adminPid, waiterPid);
    } finally {
      releaseAdminCommit.resolve();
    }

    const [adminFirstRes, ownerSecondRes] = await Promise.all([
      adminFirstPromise,
      ownerSecondPromise,
    ]);
    expect(adminFirstRes).toMatchObject({ ok: true });
    expect(ownerSecondRes).toMatchObject({ ok: true });
    if (adminFirstRes.ok && ownerSecondRes.ok) {
      expect(ownerSecondRes.receipt.occurredAt >= adminFirstRes.receipt.occurredAt).toBe(true);
    }
  });

  it('Scenariusz 2: równoległe cofnięcie delegowalnego grantu aktora (przez manageAccess oraz bezpośrednią blokadę wiersza) blokuje delegację', async () => {
    const { db } = connection();
    const adminGrantId = nextId();

    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: adminGrantId,
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    // Bezpośrednia transakcja konkurencyjna trzyma FOR UPDATE wyłącznie na wierszu company_access_grant ADMIN_LOW
    const grantHeld = deferred<number>();
    const releaseGrantHold = deferred();
    const adminTxStarted = deferred<number>();

    const directRevokeTx = wrapDbWithTimeouts(db).transaction(async (tx) => {
      const pid = Number(
        (await tx.execute<{ pid: number }>(statement`SELECT pg_backend_pid() AS pid`))[0]!.pid,
      );
      await tx
        .select()
        .from(companyAccessGrant)
        .where(eq(companyAccessGrant.grantId, adminGrantId))
        .for('update');
      grantHeld.resolve(pid);
      await releaseGrantHold.promise;
      const nowRows = await tx.execute<{ now: string }>(
        statement`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
      );
      await tx
        .update(companyAccessGrant)
        .set({ revokedAt: new Date(nowRows[0]!.now) })
        .where(eq(companyAccessGrant.grantId, adminGrantId));
    });

    const holderPid = await grantHeld.promise;

    const adminStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        adminTxStarted.resolve(pid);
      }),
    );

    const adminDelegationAttempt = runOidcManageAccess(
      'token:sub-admin-low',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { store: adminStore },
    );

    try {
      const waiterPid = await adminTxStarted.promise;
      await waitForBlockedBy(holderPid, waiterPid);
    } finally {
      releaseGrantHold.resolve();
    }

    await directRevokeTx;
    expect(await adminDelegationAttempt).toEqual({
      ok: false,
      reason: 'access_management_denied',
    });

    const member1Grants = await db
      .select()
      .from(companyAccessGrant)
      .where(
        and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
      );
    expect(member1Grants).toHaveLength(0);
  });

  it('Scenariusz 3: wyłączenie konta app_user lub cofnięcie powiązania OIDC między uwierzytelnieniem a transakcją blokuje operację', async () => {
    const { db } = connection();
    const identityStore = new PostgresUserIdentityStore(db);
    const baseResolver = new PostgresUserIdentityResolver(db);

    // 3A: Równoległe disableUserAccount trzymające FOR UPDATE na app_user blokuje FOR SHARE w verifyActorAccount
    const oidcPassed = deferred();
    const continueToTx = deferred();
    const userRowHeld = deferred<number>();
    const releaseUserRow = deferred();
    const actorTxPid = deferred<number>();

    const pausingResolver: UserIdentityResolver = {
      async resolveVerifiedIdentity(identity) {
        const res = await baseResolver.resolveVerifiedIdentity(identity);
        oidcPassed.resolve();
        await continueToTx.promise;
        return res;
      },
    };

    const actorStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        actorTxPid.resolve(pid);
      }),
    );

    const ownerAction = runOidcManageAccess(
      'token:sub-owner-a',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { store: actorStore, identityResolver: pausingResolver },
    );

    await oidcPassed.promise;

    const disablingStore = new PostgresUserIdentityStore(
      wrapDbWithTimeouts(db, async (tx, pid) => {
        await tx.select().from(appUser).where(eq(appUser.id, OWNER_A)).for('update');
        userRowHeld.resolve(pid);
        await releaseUserRow.promise;
      }),
    );
    const disablePromise = disablingStore.disableUserAccount({ userId: OWNER_A });
    const holderPid = await userRowHeld.promise;

    continueToTx.resolve();

    try {
      const waiterPid = await actorTxPid.promise;
      await waitForBlockedBy(holderPid, waiterPid);
    } finally {
      releaseUserRow.resolve();
    }

    expect(await disablePromise).toEqual({ ok: true, userId: OWNER_A });
    expect(await ownerAction).toEqual({ ok: false, reason: 'access_management_denied' });

    const member1Grants = await db
      .select()
      .from(companyAccessGrant)
      .where(
        and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
      );
    expect(member1Grants).toHaveLength(0);

    // 3B: Cofnięcie konkretnego powiązania user_oidc_identity przy wciąż aktywnym app_user (drugi link nadal działa)
    const secondOwner = userId(nextId());
    const primaryLinkId = nextId();
    const backupLinkId = nextId();
    await identityStore.provisionUserWithOidcIdentity({
      userId: secondOwner,
      identityId: primaryLinkId,
      issuer: ISSUER_1,
      subject: 'sub-second-owner-primary',
    });
    await identityStore.linkAdditionalOidcIdentity({
      userId: secondOwner,
      identityId: backupLinkId,
      issuer: ISSUER_2,
      subject: 'sub-second-owner-backup',
    });
    await db.insert(tenantMembership).values({
      tenantId: TENANT_A,
      userId: secondOwner,
      role: 'tenant_owner',
      status: 'active',
      validFrom: VALID_FROM,
    });

    const linkPassed = deferred();
    const resumeLinkTx = deferred();
    const linkBarrierResolver: UserIdentityResolver = {
      async resolveVerifiedIdentity(identity) {
        const res = await baseResolver.resolveVerifiedIdentity(identity);
        linkPassed.resolve();
        await resumeLinkTx.promise;
        return res;
      },
    };

    const revokedLinkAttempt = runOidcManageAccess(
      'token:sub-second-owner-primary',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { identityResolver: linkBarrierResolver },
    );

    await linkPassed.promise;
    expect(
      await identityStore.revokeOidcIdentity({ userId: secondOwner, identityId: primaryLinkId }),
    ).toEqual({ ok: true, userId: secondOwner });
    resumeLinkTx.resolve();

    expect(await revokedLinkAttempt).toEqual({ ok: false, reason: 'access_management_denied' });

    // Drugie aktywne powiązanie OIDC tego samego konta nadal działa poprawnie
    expect(
      await runOidcManageAccess(`token:${ISSUER_2}|sub-second-owner-backup`, {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });
  });

  it('Scenariusz 4: dwaj administratorzy równocześnie modyfikują dostęp w tym samym tenancie (serializacja na wspólnym celu, brak blokowania różnych celów)', async () => {
    const { db } = connection();

    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    // 4A: Wspólny cel MEMBER_1 — OWNER_A cofa członkostwo, a ADMIN_LOW równolegle nadaje grant -> serializacja na MEMBER_1
    const member1Held = deferred<number>();
    const releaseMember1 = deferred();
    const adminWaitPid = deferred<number>();

    const ownerStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (tx, pid) => {
        await tx
          .select()
          .from(tenantMembership)
          .where(
            and(eq(tenantMembership.tenantId, TENANT_A), eq(tenantMembership.userId, MEMBER_1)),
          )
          .for('update');
        member1Held.resolve(pid);
        await releaseMember1.promise;
      }),
    );
    const adminStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        adminWaitPid.resolve(pid);
      }),
    );

    const pOwnerRevoke = runOidcManageAccess(
      'token:sub-owner-a',
      {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
      },
      { store: ownerStore },
    );

    const holderPid = await member1Held.promise;

    // 4B: W trakcie gdy MEMBER_1 jest zablokowany przez OWNER_A, operacja na MEMBER_2 (nawet tego samego aktora OWNER_A!)
    // przechodzi bez czekania, ponieważ na wierszu aktora trzymana jest kompatybilna blokada FOR SHARE!
    const concurrentMember2Grant = await runOidcManageAccess('token:sub-owner-a', {
      kind: 'grant',
      operationId: nextId(),
      tenantId: TENANT_A,
      userId: MEMBER_2,
      grantId: nextId(),
      legalEntityId: ENTITY_A1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    });
    expect(concurrentMember2Grant).toMatchObject({ ok: true });

    const pAdminGrantMember1 = runOidcManageAccess(
      'token:sub-admin-low',
      {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      { store: adminStore },
    );

    try {
      const waiterPid = await adminWaitPid.promise;
      await waitForBlockedBy(holderPid, waiterPid);
    } finally {
      releaseMember1.resolve();
    }

    const [resOwner, resAdmin] = await Promise.all([pOwnerRevoke, pAdminGrantMember1]);
    expect(resOwner).toMatchObject({ ok: true });
    expect(resAdmin).toEqual({ ok: false, reason: 'membership_inactive' });

    const member1Grants = await db
      .select()
      .from(companyAccessGrant)
      .where(
        and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
      );
    expect(member1Grants).toHaveLength(0);
  });

  it('Scenariusz 5: reaktywacja członkostwa nie pozwala wykorzystać starych grantów ani do odczytu danych, ani do delegacji administracyjnej', async () => {
    const { db } = connection();
    const uow = new PostgresTransactionalUnitOfWork(db);
    const identityResolver = new PostgresUserIdentityResolver(db);

    // Nadajemy grant read zarówno dla ADMIN_LOW, jak i dla MEMBER_1
    for (const uid of [ADMIN_LOW, MEMBER_1]) {
      expect(
        await runOidcManageAccess('token:sub-owner-a', {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: uid,
          grantId: nextId(),
          legalEntityId: ENTITY_A1,
          action: 'read',
          validFrom: null,
          validUntil: null,
        }),
      ).toMatchObject({ ok: true });
    }

    // Cofamy i reaktywujemy członkostwa obu użytkowników
    for (const uid of [ADMIN_LOW, MEMBER_1]) {
      expect(
        await runOidcManageAccess('token:sub-owner-a', {
          kind: 'revoke_membership',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: uid,
        }),
      ).toMatchObject({ ok: true });
      expect(
        await runOidcManageAccess('token:sub-owner-a', {
          kind: 'reactivate_membership',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: uid,
          validUntil: null,
        }),
      ).toMatchObject({ ok: true });
    }

    // 1) MEMBER_1 nie może odczytać danych przez executeAuthorizedCompanyAction na podstawie starego grantu
    let readExecuted = false;
    const memberReadAfterReactivate = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'token:sub-member-1',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      { verifier, identityResolver, unitOfWork: uow },
      async () => {
        readExecuted = true;
        return 'forbidden-data';
      },
    );
    expect(readExecuted).toBe(false);
    expect(memberReadAfterReactivate).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'explicit_company_grant_required',
    });

    // 2) Reaktywowany ADMIN_LOW nie może delegować dawnego grantu do MEMBER_2
    expect(
      await runOidcManageAccess('token:sub-admin-low', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_2,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toEqual({ ok: false, reason: 'access_management_denied' });

    // 3) Dopiero nowy jawny grant od właściciela dla ADMIN_LOW pozwala mu ponownie delegować to uprawnienie
    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    expect(
      await runOidcManageAccess('token:sub-admin-low', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_2,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });
  });

  it('Scenariusz 6: zmiana i blokady w innym tenancie nie wpływają na decyzję ani nie blokują operacji; outsider nie zakłada blokad FOR UPDATE', async () => {
    const { db } = connection();

    // Trzymamy otwartą blokadę FOR UPDATE w TENANT_B na wspólnym użytkowniku MEMBER_1
    const tenantBHeld = deferred();
    const releaseTenantB = deferred();
    const holderTenantB = wrapDbWithTimeouts(db).transaction(async (tx) => {
      await tx
        .select()
        .from(tenantMembership)
        .where(and(eq(tenantMembership.tenantId, TENANT_B), eq(tenantMembership.userId, MEMBER_1)))
        .for('update');
      tenantBHeld.resolve();
      await releaseTenantB.promise;
    });

    await tenantBHeld.promise;

    try {
      // Operacja w TENANT_A na tym samym użytkowniku MEMBER_1 przechodzi natychmiast bez blokady
      const grantInTenantA = await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      });
      expect(grantInTenantA).toMatchObject({ ok: true });
    } finally {
      releaseTenantB.resolve();
      await holderTenantB;
    }

    // Cofnięcie członkostwa MEMBER_1 w TENANT_B nie wpływa na jego uprawnienia w TENANT_A
    expect(
      await runOidcManageAccess('token:sub-owner-b', {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_B,
        userId: MEMBER_1,
      }),
    ).toMatchObject({ ok: true });

    const uow = new PostgresTransactionalUnitOfWork(db);
    const identityResolver = new PostgresUserIdentityResolver(db);
    const readInTenantA = await executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'token:sub-member-1',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      { verifier, identityResolver, unitOfWork: uow },
      async () => 'ok-tenant-a',
    );
    expect(readInTenantA).toMatchObject({ allowed: true, data: 'ok-tenant-a' });

    // Outsider z TENANT_B nie czeka na blokadzie FOR UPDATE w TENANT_A (odrzucony na pre-checku)
    const tenantAHeld = deferred();
    const releaseTenantA = deferred();
    const holderTenantA = wrapDbWithTimeouts(db).transaction(async (tx) => {
      await tx
        .select()
        .from(tenantMembership)
        .where(and(eq(tenantMembership.tenantId, TENANT_A), eq(tenantMembership.userId, MEMBER_1)))
        .for('update');
      tenantAHeld.resolve();
      await releaseTenantA.promise;
    });
    await tenantAHeld.promise;

    try {
      const crossTenantAttempt = await runOidcManageAccess('token:sub-owner-b', {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
      });
      expect(crossTenantAttempt).toEqual({ ok: false, reason: 'access_management_denied' });
    } finally {
      releaseTenantA.resolve();
      await holderTenantA;
    }
  });

  it('Scenariusz 7: brak dostępu we wszystkich wektorach eskalacji powoduje odmowę bez wykonania mutacji i bez wpisu audytu', async () => {
    const { db } = connection();

    // ADMIN_LOW otrzymuje tylko read na ENTITY_A1
    const seedRes = await runOidcManageAccess('token:sub-owner-a', {
      kind: 'grant',
      operationId: nextId(),
      tenantId: TENANT_A,
      userId: ADMIN_LOW,
      grantId: nextId(),
      legalEntityId: ENTITY_A1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    });
    expect(seedRes).toMatchObject({ ok: true });

    const baselineEvents = await db.select().from(accessManagementEvent);
    const baselineGrants = await db.select().from(companyAccessGrant);

    const deniedAttempts: Array<[string, AccessManagementCommand]> = [
      // Niezmapowany token OIDC
      [
        'token:unmapped-subject',
        { kind: 'revoke_membership', operationId: nextId(), tenantId: TENANT_A, userId: MEMBER_1 },
      ],
      // Niepoprawny podpis tokenu
      [
        'forged-jwt',
        { kind: 'revoke_membership', operationId: nextId(), tenantId: TENANT_A, userId: MEMBER_1 },
      ],
      // Zwykły członek tenanta
      [
        'token:sub-member-1',
        {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: MEMBER_2,
          grantId: nextId(),
          legalEntityId: ENTITY_A1,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
      ],
      // Operator platformy bez członkostwa w tenancie
      [
        'token:sub-platform-op',
        {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: MEMBER_1,
          grantId: nextId(),
          legalEntityId: ENTITY_A1,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
      ],
      // Właściciel próbuje nadać grant samemu sobie (self-dealing)
      [
        'token:sub-owner-a',
        {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: OWNER_A,
          grantId: nextId(),
          legalEntityId: ENTITY_A1,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
      ],
      // tenant_admin próbuje zarządzać właścicielem lub innym tenant_admin
      [
        'token:sub-admin-low',
        { kind: 'revoke_membership', operationId: nextId(), tenantId: TENANT_A, userId: OWNER_A },
      ],
      [
        'token:sub-admin-low',
        {
          kind: 'revoke_membership',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: ADMIN_HIGH,
        },
      ],
      // tenant_admin próbuje nadać write mając tylko read lub dostęp do innej spółki ENTITY_A2
      [
        'token:sub-admin-low',
        {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: MEMBER_1,
          grantId: nextId(),
          legalEntityId: ENTITY_A1,
          action: 'write',
          validFrom: null,
          validUntil: null,
        },
      ],
      [
        'token:sub-admin-low',
        {
          kind: 'grant',
          operationId: nextId(),
          tenantId: TENANT_A,
          userId: MEMBER_1,
          grantId: nextId(),
          legalEntityId: ENTITY_A2,
          action: 'read',
          validFrom: null,
          validUntil: null,
        },
      ],
    ];

    for (const [token, cmd] of deniedAttempts) {
      expect(await runOidcManageAccess(token, cmd)).toEqual({
        ok: false,
        reason: 'access_management_denied',
      });
    }

    // Domyślny brak dostępu księgowego dla tenant_owner, tenant_admin i platform_operator w UnitOfWork
    const uow = new PostgresTransactionalUnitOfWork(db);
    const identityResolver = new PostgresUserIdentityResolver(db);
    for (const token of ['token:sub-owner-a', 'token:sub-admin-high', 'token:sub-platform-op']) {
      const decision = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: token,
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        { verifier, identityResolver, unitOfWork: uow },
        async () => 'never',
      );
      expect(decision.allowed).toBe(false);
    }

    expect(await db.select().from(accessManagementEvent)).toHaveLength(baselineEvents.length);
    expect(await db.select().from(companyAccessGrant)).toHaveLength(baselineGrants.length);
  });

  it('Scenariusz 8: awaria zapisu audytu wycofuje całą transakcyjną operację (członkostwo, granty i event)', async () => {
    const { db, client: sql } = connection();

    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    await sql`CREATE FUNCTION fail_audit_6d3a() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Awaria audytu 6D-3A''; END;'`;
    await sql`CREATE TRIGGER trg_fail_audit_6d3a BEFORE INSERT ON access_management_event FOR EACH ROW EXECUTE FUNCTION fail_audit_6d3a()`;

    try {
      const failedRevoke = await runOidcManageAccess('token:sub-owner-a', {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
      });
      expect(failedRevoke).toEqual({ ok: false, reason: 'access_management_unavailable' });

      const [memberRow] = await db
        .select()
        .from(tenantMembership)
        .where(and(eq(tenantMembership.tenantId, TENANT_A), eq(tenantMembership.userId, MEMBER_1)));
      expect(memberRow?.status).toBe('active');

      const [grantRow] = await db
        .select()
        .from(companyAccessGrant)
        .where(
          and(eq(companyAccessGrant.tenantId, TENANT_A), eq(companyAccessGrant.userId, MEMBER_1)),
        );
      expect(grantRow?.revokedAt).toBeNull();
      expect(await db.select().from(accessManagementEvent)).toHaveLength(1);
    } finally {
      await sql`DROP TRIGGER IF EXISTS trg_fail_audit_6d3a ON access_management_event`;
      await sql`DROP FUNCTION IF EXISTS fail_audit_6d3a()`;
    }
  });

  it('Scenariusz 9: ponowienie tej samej operacji zachowuje idempotencję, ale aktor pozbawiony uprawnień nie może odpytać dawnego potwierdzenia', async () => {
    const { db } = connection();

    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
        grantId: nextId(),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    const opId = nextId();
    const grantCmd: AccessManagementCommand = {
      kind: 'grant',
      operationId: opId,
      tenantId: TENANT_A,
      userId: MEMBER_1,
      grantId: nextId(),
      legalEntityId: ENTITY_A1,
      action: 'read',
      validFrom: null,
      validUntil: null,
    };

    const first = await runOidcManageAccess('token:sub-admin-low', grantCmd);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.reason);

    // Idempotentne powtórzenie przez uprawnionego aktora zwraca identyczny receipt bez nowego wiersza audytu
    const second = await runOidcManageAccess('token:sub-admin-low', grantCmd);
    expect(second).toEqual(first);
    expect(await db.select().from(accessManagementEvent)).toHaveLength(2);

    // Ten sam operationId z innym zakresem lub innym aktorem -> operation_conflict
    expect(await runOidcManageAccess('token:sub-owner-a', grantCmd)).toEqual({
      ok: false,
      reason: 'operation_conflict',
    });
    expect(
      await runOidcManageAccess('token:sub-admin-low', {
        kind: 'revoke_membership',
        operationId: opId,
        tenantId: TENANT_A,
        userId: MEMBER_1,
      }),
    ).toEqual({ ok: false, reason: 'operation_conflict' });

    // Po cofnięciu członkostwa ADMIN_LOW próba powtórzenia dawnego operationId jest blokowana na etapie autoryzacji!
    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'revoke_membership',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: ADMIN_LOW,
      }),
    ).toMatchObject({ ok: true });

    expect(await runOidcManageAccess('token:sub-admin-low', grantCmd)).toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
  });

  it.each(['owner-higher-than-admin', 'owner-lower-than-admin'] as const)(
    'Scenariusz 10: brak zakleszczenia (deadlock 40P01) przy równoległych operacjach krzyżowych na powiązanych członkostwach (%s)',
    async (uuidOrder) => {
      const { db } = connection();
      const identityStore = new PostgresUserIdentityStore(db);

      // Tworzymy parę (OWNER, ADMIN) o zadanym porządku UUID, żeby przetestować oba kierunki actor < target i target < actor
      const lowUser = userId(id(700 + (uuidOrder === 'owner-lower-than-admin' ? 1 : 3)));
      const highUser = userId(id(700 + (uuidOrder === 'owner-lower-than-admin' ? 4 : 6)));
      const ownerUid = uuidOrder === 'owner-lower-than-admin' ? lowUser : highUser;
      const adminUid = uuidOrder === 'owner-lower-than-admin' ? highUser : lowUser;
      const ownerSub = `sub-deadlock-owner-${uuidOrder}`;
      const adminSub = `sub-deadlock-admin-${uuidOrder}`;

      await identityStore.provisionUserWithOidcIdentity({
        userId: ownerUid,
        identityId: nextId(),
        issuer: ISSUER_1,
        subject: ownerSub,
      });
      await identityStore.provisionUserWithOidcIdentity({
        userId: adminUid,
        identityId: nextId(),
        issuer: ISSUER_1,
        subject: adminSub,
      });
      await db.insert(tenantMembership).values([
        {
          tenantId: TENANT_A,
          userId: ownerUid,
          role: 'tenant_owner',
          status: 'active',
          validFrom: VALID_FROM,
        },
        {
          tenantId: TENANT_A,
          userId: adminUid,
          role: 'tenant_admin',
          status: 'active',
          validFrom: VALID_FROM,
        },
      ]);

      // Bariera synchronizująca obie transakcje JUŻ po otwarciu transakcji i blokadzie app_user,
      // bezpośrednio przed blokadami wierszy w tenant_membership!
      let arrived = 0;
      const bothInsideTx = deferred();
      const syncedStore = new PostgresAccessManagementStore(
        wrapDbWithTimeouts(db, async () => {
          arrived += 1;
          if (arrived === 2) {
            bothInsideTx.resolve();
          }
          await bothInsideTx.promise;
        }),
      );

      // OWNER cofa członkostwo ADMINA (actor=ownerUid, target=adminUid),
      // podczas gdy ADMIN jednocześnie próbuje cofnąć członkostwo OWNERA (actor=adminUid, target=ownerUid)!
      // Naiwne blokowanie "najpierw actor, potem target" dałoby tu gwarantowany deadlock 40P01.
      const [ownerRes, adminRes] = await Promise.all([
        runOidcManageAccess(
          `token:${ownerSub}`,
          {
            kind: 'revoke_membership',
            operationId: nextId(),
            tenantId: TENANT_A,
            userId: adminUid,
          },
          { store: syncedStore },
        ),
        runOidcManageAccess(
          `token:${adminSub}`,
          {
            kind: 'revoke_membership',
            operationId: nextId(),
            tenantId: TENANT_A,
            userId: ownerUid,
          },
          { store: syncedStore },
        ),
      ]);

      // Zero błędów 40P01 (access_management_unavailable): właściciel wygrywa, admin dostaje czystą odmowę!
      expect(ownerRes).toMatchObject({ ok: true });
      expect(adminRes).toEqual({ ok: false, reason: 'access_management_denied' });
    },
  );

  it('Scenariusz 11: po odmowie autoryzacji lub błędzie SQL połączenie z puli (maxConnections: 1) jest bezpiecznie reużywane bez wycieku kontekstu SET LOCAL', async () => {
    const { dataSchema } = connection();
    const singlePool = connectDatabase(process.env, dataSchema, { maxConnections: 1 });

    try {
      const store = new PostgresAccessManagementStore(singlePool.db);
      const uow = new PostgresTransactionalUnitOfWork(singlePool.db);
      const identityResolver = new PostgresUserIdentityResolver(singlePool.db);

      const initialPidRows = await singlePool.client<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      const singlePid = Number(initialPidRows[0]!.pid);

      // 1) Kontrolowana odmowa w manageAccess -> fizyczny ROLLBACK na tym połączeniu
      expect(
        await manageAccess(
          {
            kind: 'revoke_membership',
            operationId: nextId(),
            tenantId: TENANT_A,
            userId: OWNER_A,
          },
          {
            store,
            actors: createOidcAccessManagementActorSource('token:sub-admin-low', {
              verifier,
              identityResolver,
            }),
            authorizer: createTenantAccessManagementAuthorizer(),
          },
        ),
      ).toEqual({ ok: false, reason: 'access_management_denied' });

      // 2) Nadajemy MEMBER_1 grant read na ENTITY_A1 na tej samej 1-połączeniowej puli
      expect(
        await manageAccess(
          {
            kind: 'grant',
            operationId: nextId(),
            tenantId: TENANT_A,
            userId: MEMBER_1,
            grantId: nextId(),
            legalEntityId: ENTITY_A1,
            action: 'read',
            validFrom: null,
            validUntil: null,
          },
          {
            store,
            actors: createOidcAccessManagementActorSource('token:sub-owner-a', {
              verifier,
              identityResolver,
            }),
            authorizer: createTenantAccessManagementAuthorizer(),
          },
        ),
      ).toMatchObject({ ok: true });

      // 3) Błąd SQL wewnątrz operacji po ustawieniu applyLocalRlsSessionContext -> ROLLBACK i wyczyszczenie GUC
      const abortedAction = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'token:sub-member-1',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        { verifier, identityResolver, unitOfWork: uow },
        async (_ctx, txCtx) => {
          // Wymuszamy rzeczywisty błąd SQL PostgreSQL (dzielenie przez zero 22012), który przerywa transakcję na serwerze
          await txCtx.tx.execute(statement`SELECT 1 / 0`);
          return 'unreachable';
        },
      );
      expect(abortedAction).toEqual({
        allowed: false,
        status: 'forbidden',
        reason: 'authorization_data_unavailable',
      });

      // 4) To samo połączenie (ten sam pg_backend_pid!) nie jest w stanie aborted (25P02) i nie ma wycieku zmiennych pap.current_*
      const checkAfterRollback = await singlePool.client<
        { pid: number; tenant_ctx: string | null; actor_ctx: string | null }[]
      >`SELECT
          pg_backend_pid() AS pid,
          current_setting('pap.current_tenant_id', true) AS tenant_ctx,
          current_setting('pap.current_actor_user_id', true) AS actor_ctx`;

      expect(Number(checkAfterRollback[0]!.pid)).toBe(singlePid);
      expect(checkAfterRollback[0]!.tenant_ctx ?? '').toBe('');
      expect(checkAfterRollback[0]!.actor_ctx ?? '').toBe('');

      // 5) Kolejna poprawna transakcja na tym samym połączeniu widzi poprawny kontekst lokalny i po COMMIT go czyści
      const validAction = await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'token:sub-member-1',
          tenantId: TENANT_A,
          legalEntityId: ENTITY_A1,
          action: 'read',
        },
        { verifier, identityResolver, unitOfWork: uow },
        async (_ctx, txCtx) => {
          const rows = await txCtx.tx.execute<{
            pid: number;
            tenant_ctx: string;
            actor_ctx: string;
            entity_ctx: string;
          }>(statement`SELECT
            pg_backend_pid() AS pid,
            current_setting('pap.current_tenant_id', true) AS tenant_ctx,
            current_setting('pap.current_actor_user_id', true) AS actor_ctx,
            current_setting('pap.current_legal_entity_id', true) AS entity_ctx`);
          return {
            ...rows[0]!,
            pid: Number(rows[0]!.pid),
          };
        },
      );

      expect(validAction).toMatchObject({
        allowed: true,
        data: {
          pid: singlePid,
          tenant_ctx: TENANT_A,
          actor_ctx: MEMBER_1,
          entity_ctx: ENTITY_A1,
        },
      });

      const checkAfterCommit = await singlePool.client<
        { pid: number; tenant_ctx: string | null }[]
      >`
        SELECT pg_backend_pid() AS pid, current_setting('pap.current_tenant_id', true) AS tenant_ctx
      `;
      expect(Number(checkAfterCommit[0]!.pid)).toBe(singlePid);
      expect(checkAfterCommit[0]!.tenant_ctx ?? '').toBe('');
    } finally {
      await singlePool.client.end({ timeout: 1 });
    }
  });

  it('Scenariusz 12: executeAuthorizedCompanyAction eliminuje TOCTOU dla odczytu/zapisu danych firmy przy równoległym cofnięciu grantu', async () => {
    const { db } = connection();
    const identityResolver = new PostgresUserIdentityResolver(db);
    const memberGrantId = nextId();

    expect(
      await runOidcManageAccess('token:sub-owner-a', {
        kind: 'grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: memberGrantId,
        legalEntityId: ENTITY_A1,
        action: 'write',
        validFrom: null,
        validUntil: null,
      }),
    ).toMatchObject({ ok: true });

    const ownerHold = deferred<number>();
    const releaseOwner = deferred();
    const memberTxPid = deferred<number>();

    const ownerStore = new PostgresAccessManagementStore(
      wrapDbWithTimeouts(db, async (tx, pid) => {
        await tx
          .select()
          .from(tenantMembership)
          .where(
            and(eq(tenantMembership.tenantId, TENANT_A), eq(tenantMembership.userId, MEMBER_1)),
          )
          .for('update');
        ownerHold.resolve(pid);
        await releaseOwner.promise;
      }),
    );

    const memberUow = new PostgresTransactionalUnitOfWork(
      wrapDbWithTimeouts(db, async (_tx, pid) => {
        memberTxPid.resolve(pid);
      }),
    );

    const revokeGrantPromise = runOidcManageAccess(
      'token:sub-owner-a',
      {
        kind: 'revoke_grant',
        operationId: nextId(),
        tenantId: TENANT_A,
        userId: MEMBER_1,
        grantId: memberGrantId,
      },
      { store: ownerStore },
    );

    const holderPid = await ownerHold.promise;

    let writeOperationExecuted = false;
    const writeAttemptPromise = executeAuthorizedCompanyAction(
      {
        rawBearerToken: 'token:sub-member-1',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      { verifier, identityResolver, unitOfWork: memberUow },
      async () => {
        writeOperationExecuted = true;
        return { saved: true };
      },
    );

    try {
      const waiterPid = await memberTxPid.promise;
      await waitForBlockedBy(holderPid, waiterPid);
    } finally {
      releaseOwner.resolve();
    }

    const [revokeRes, writeRes] = await Promise.all([revokeGrantPromise, writeAttemptPromise]);
    expect(revokeRes).toMatchObject({ ok: true });
    expect(writeOperationExecuted).toBe(false);
    expect(writeRes).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'explicit_company_grant_required',
    });
  });
});
