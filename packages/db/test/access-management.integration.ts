import {
  authorizeCompanyAction,
  manageAccess,
  type AccessManagementCommand,
  type AccessManagementResult,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { and, eq, sql as statement } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresAccessManagementStore } from '../src/access-management.js';
import { applyMigrations } from '../src/migrations.js';
import {
  accessManagementEvent,
  appUser,
  companyAccessGrant,
  legalEntity,
  tenant,
  tenantMembership,
} from '../src/schema.js';
import { PostgresTenantAuthorizationDataSource } from '../src/tenant-authorization.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const A = tenantId(id(1)),
  B = tenantId(id(2));
const USER = userId(id(31)),
  ACTOR = userId(id(32));
const A1 = legalEntityId(id(11)),
  A2 = legalEntityId(id(12)),
  B1 = legalEntityId(id(21));
const from = new Date('2026-01-01T00:00:00.000Z');
let operation = 100;
const base = () => ({ tenantId: A, userId: USER, operationId: id(operation++) });
const revoke = (): AccessManagementCommand => ({ ...base(), kind: 'revoke_membership' });
const reactivate = (): AccessManagementCommand => ({
  ...base(),
  kind: 'reactivate_membership',
  validUntil: null,
});
const grant = (
  changes: Partial<Extract<AccessManagementCommand, { kind: 'grant' }>> = {},
): AccessManagementCommand => ({
  ...base(),
  kind: 'grant',
  grantId: id(operation++),
  legalEntityId: A1,
  action: 'read',
  validFrom: null,
  validUntil: null,
  ...changes,
});

describe('6D-R — transakcje cyklu dostępu na PostgreSQL', () => {
  let database: TestDatabase | undefined;
  const connection = () => {
    if (!database) throw new Error('Brak testowej DB.');
    return database;
  };
  const run = (
    command: AccessManagementCommand,
    store = new PostgresAccessManagementStore(connection().db),
  ) =>
    manageAccess(command, {
      store,
      actors: { getVerifiedActor: async () => ({ userId: ACTOR }) },
      authorizer: { authorize: async (_actor, scoped) => scoped.tenantId === A },
    });
  const authorize = (entity = A1, action: 'read' | 'write' = 'read') =>
    authorizeCompanyAction(new PostgresTenantAuthorizationDataSource(connection().db), {
      tenantId: A,
      userId: USER,
      legalEntityId: entity,
      action,
    });
  const grants = () =>
    connection()
      .db.select()
      .from(companyAccessGrant)
      .where(and(eq(companyAccessGrant.tenantId, A), eq(companyAccessGrant.userId, USER)));
  const events = () => connection().db.select().from(accessManagementEvent);
  const member = async () =>
    (
      await connection()
        .db.select()
        .from(tenantMembership)
        .where(and(eq(tenantMembership.tenantId, A), eq(tenantMembership.userId, USER)))
    )[0]!;
  const expectOk = (result: AccessManagementResult) => {
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    return result.receipt;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.db, database.dataSchema);
    await database.db.insert(appUser).values([
      { id: USER, status: 'active', createdAt: from },
      { id: ACTOR, status: 'active', createdAt: from },
    ]);
    await database.db.insert(tenant).values([
      { id: A, name: 'Syntetyczny A' },
      { id: B, name: 'Syntetyczny B' },
    ]);
    await database.db.insert(legalEntity).values([
      { id: A1, tenantId: A, displayName: 'A1' },
      { id: A2, tenantId: A, displayName: 'A2' },
      { id: B1, tenantId: B, displayName: 'B1' },
    ]);
  });
  beforeEach(async () => {
    const { db, client: sql } = connection();
    // Wyłącznie tabela we własnym losowym namespace, nigdy dane zastanej bazy.
    await sql`TRUNCATE access_management_event`;
    await db.delete(companyAccessGrant);
    await db.delete(tenantMembership);
    await db.insert(tenantMembership).values([
      { tenantId: A, userId: USER, role: 'tenant_admin', status: 'active', validFrom: from },
      { tenantId: B, userId: USER, role: 'tenant_owner', status: 'active', validFrom: from },
    ]);
  });
  afterAll(async () => {
    await database?.cleanup();
  });

  it('jawny grant → cofnięcie → reaktywacja bez starego dostępu → osobny nowy grant', async () => {
    const original = expectOk(await run(grant()));
    expect(await authorize()).toMatchObject({ allowed: true });
    const revoked = expectOk(await run(revoke()));
    expect(await authorize()).toMatchObject({
      allowed: false,
      reason: 'active_membership_required',
    });
    expectOk(await run(reactivate()));
    expect(await authorize()).toMatchObject({
      allowed: false,
      reason: 'explicit_company_grant_required',
    });
    expect((await grants())[0]?.revokedAt?.toISOString()).toBe(revoked.occurredAt);
    const fresh = expectOk(await run(grant()));
    expect(await authorize()).toMatchObject({ allowed: true });
    expect(await grants()).toHaveLength(2);
    expect(fresh.grantId).not.toBe(original.grantId);
    expect(await events()).toHaveLength(4);
    expect((await events()).find((event) => event.kind === 'revoke_membership')).toMatchObject({
      tenantId: A,
      userId: USER,
      actorId: ACTOR,
      kind: 'revoke_membership',
      occurredAt: new Date(revoked.occurredAt),
      stateChange: { before: 'active', after: 'revoked', revokedGrants: 1 },
    });
  });
  it('cofa wszystkie firmy/akcje/przyszłe granty; B pozostaje nietknięty', async () => {
    expectOk(await run(grant()));
    expectOk(await run(grant({ legalEntityId: A2, action: 'write' })));
    expectOk(await run(grant({ legalEntityId: A2, validFrom: '2099-01-01T00:00:00.000Z' })));
    await connection()
      .db.insert(companyAccessGrant)
      .values({
        grantId: id(50),
        tenantId: B,
        userId: USER,
        legalEntityId: B1,
        action: 'read',
        validFrom: from,
      });
    const receipt = expectOk(await run(revoke()));
    for (const row of await grants()) expect(row.revokedAt?.toISOString()).toBe(receipt.occurredAt);
    expect(
      (
        await connection()
          .db.select()
          .from(companyAccessGrant)
          .where(eq(companyAccessGrant.tenantId, B))
      )[0]?.revokedAt,
    ).toBeNull();
    expectOk(await run(reactivate()));
    expect(await authorize(A2, 'write')).toMatchObject({ allowed: false });
    const facts = await new PostgresTenantAuthorizationDataSource(connection().db).getFacts({
      tenantId: A,
      userId: USER,
      legalEntityId: B1,
      action: 'read',
    });
    expect(facts.grants).toEqual([]);
  });
  it('powtórzenie operationId zwraca ten sam wynik bez nowego audytu; nowe cofnięcie jest no-op', async () => {
    expectOk(await run(grant()));
    const command = revoke();
    const first = expectOk(await run(command));
    expect(expectOk(await run(command))).toEqual(first);
    expect(expectOk(await run(revoke())).changed).toBe(false);
    expect((await grants())[0]?.revokedAt?.toISOString()).toBe(first.occurredAt);
    expect(await events()).toHaveLength(3);
    expect(await run({ ...reactivate(), operationId: command.operationId })).toEqual({
      ok: false,
      reason: 'operation_conflict',
    });
    expect((await member()).status).toBe('revoked');
  });
  it('ponowienie dawnego grantu po cofnięciu i reaktywacji nigdy nie nadaje go ponownie', async () => {
    const command = grant();
    const original = expectOk(await run(command));
    expectOk(await run(revoke()));
    expectOk(await run(reactivate()));
    expect(expectOk(await run(command))).toEqual(original);
    expect(await authorize()).toMatchObject({ allowed: false });
    expect(await grants()).toHaveLength(1);
  });

  it('nie używa ponownie ID cofniętego grantu dla nowego uprawnienia', async () => {
    const command = grant();
    expectOk(await run(command));
    expectOk(await run(revoke()));
    expectOk(await run(reactivate()));
    expect(await run({ ...command, operationId: id(operation++) })).toEqual({
      ok: false,
      reason: 'operation_conflict',
    });
    expect(await authorize()).toMatchObject({ allowed: false });
  });
  it.each(['revoked', 'expired', 'future', 'missing'] as const)(
    'odmawia grantu: członkostwo %s',
    async (state) => {
      const { db } = connection();
      if (state === 'missing')
        await db.delete(tenantMembership).where(eq(tenantMembership.tenantId, A));
      else
        await db
          .update(tenantMembership)
          .set(
            state === 'revoked'
              ? { status: 'revoked' }
              : state === 'expired'
                ? { validUntil: new Date('2026-02-01') }
                : { validFrom: new Date('2099-01-01') },
          )
          .where(eq(tenantMembership.tenantId, A));
      expect(await run(grant())).toEqual({
        ok: false,
        reason: state === 'missing' ? 'membership_unavailable' : 'membership_inactive',
      });
      expect(await grants()).toHaveLength(0);
      expect(await events()).toHaveLength(0);
    },
  );
  it('odmawia reaktywacji aktywnego członkostwa oraz niepoprawnych dat', async () => {
    expect(await run(reactivate())).toEqual({ ok: false, reason: 'membership_not_revoked' });
    expect(await run(grant({ validFrom: '2026-01-01T00:00:00.000Z' }))).toEqual({
      ok: false,
      reason: 'invalid_command',
    });
    expectOk(await run(revoke()));
    expect(
      await run({ ...base(), kind: 'reactivate_membership', validUntil: '2026-01-01' }),
    ).toEqual({ ok: false, reason: 'invalid_command' });
  });
  it('cofa konkretny grant, w tym przyszły; chroni wcześniejsze revoked_at', async () => {
    const receipt = expectOk(await run(grant({ validFrom: '2099-01-01T00:00:00.000Z' })));
    const command: AccessManagementCommand = {
      ...base(),
      kind: 'revoke_grant',
      grantId: receipt.grantId!,
    };
    const first = expectOk(await run(command));
    expect(expectOk(await run({ ...command, operationId: id(operation++) })).changed).toBe(false);
    expectOk(await run(revoke()));
    expect((await grants())[0]?.revokedAt?.toISOString()).toBe(first.occurredAt);
    expect(await run({ ...command, grantId: id(999), operationId: id(operation++) })).toEqual({
      ok: false,
      reason: 'grant_unavailable',
    });
  });
  it('SQL odrzuca czyszczenie/odsunięcie cofnięcia i modyfikację/usuwanie audytu', async () => {
    expectOk(await run(grant()));
    expectOk(await run(revoke()));
    const { client: sql } = connection();
    await expectDatabaseError(
      sql`UPDATE company_access_grant SET revoked_at = NULL WHERE tenant_id = ${A}`,
      '23514',
    );
    await expectDatabaseError(
      sql`UPDATE company_access_grant SET revoked_at = '2099-01-01' WHERE tenant_id = ${A}`,
      '23514',
    );
    await expectDatabaseError(sql`UPDATE access_management_event SET actor_id = ${USER}`, '23514');
    await expectDatabaseError(sql`DELETE FROM access_management_event`, '23514');
    expectOk(await run(reactivate()));
    expect(await authorize()).toMatchObject({ allowed: false });
  });
  it('nie nadaje grantu przez cudzą firmę/tenant ani nie cofa cudzego grantu', async () => {
    expect(await run(grant({ legalEntityId: B1 }))).toEqual({
      ok: false,
      reason: 'grant_unavailable',
    });
    expect(await run({ ...revoke(), tenantId: B })).toEqual({
      ok: false,
      reason: 'access_management_denied',
    });
    await connection()
      .db.insert(companyAccessGrant)
      .values({
        grantId: id(51),
        tenantId: B,
        userId: USER,
        legalEntityId: B1,
        action: 'read',
        validFrom: from,
      });
    expect(await run({ ...base(), kind: 'revoke_grant', grantId: id(51) })).toEqual({
      ok: false,
      reason: 'grant_unavailable',
    });
    expect(await events()).toHaveLength(0);
  });
  it('tenant_admin bez osobnej autoryzacji oraz brak aktora/autoryzatora nie zmieniają DB', async () => {
    const store = new PostgresAccessManagementStore(connection().db);
    for (const deps of [
      { store },
      {
        store,
        actors: { getVerifiedActor: async () => null },
        authorizer: { authorize: async () => true },
      },
      {
        store,
        actors: { getVerifiedActor: async () => ({ userId: USER }) },
        authorizer: { authorize: async () => false },
      },
    ]) {
      expect(await manageAccess(revoke(), deps)).toEqual({
        ok: false,
        reason: 'access_management_denied',
      });
    }
    expect((await member()).status).toBe('active');
    expect(await events()).toHaveLength(0);
  });

  it.each(['audit', 'grants'] as const)(
    'błąd SQL %s wycofuje członkostwo, wszystkie granty i audyt',
    async (failure) => {
      expectOk(await run(grant()));
      expectOk(await run(grant({ legalEntityId: A2 })));
      const { client: sql } = connection();
      await sql`CREATE FUNCTION fail_lifecycle_test() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''Syntetyczna awaria SQL''; END;'`;
      // Drugi grant, więc awaria następuje w trakcie zmiany zbioru; tabela wyłącznie testowa.
      if (failure === 'audit')
        await sql`CREATE TRIGGER fail_test BEFORE INSERT ON access_management_event FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_test()`;
      else
        await sql`CREATE TRIGGER fail_test BEFORE UPDATE ON company_access_grant FOR EACH ROW WHEN (OLD.legal_entity_id = ${sql.unsafe(`'${A2}'::uuid`)}) EXECUTE FUNCTION fail_lifecycle_test()`;
      try {
        expect(await run(revoke())).toEqual({ ok: false, reason: 'access_management_unavailable' });
        expect((await member()).status).toBe('active');
        expect((await grants()).every((row) => row.revokedAt === null)).toBe(true);
        expect(await events()).toHaveLength(2);
        expect(await authorize()).toMatchObject({ allowed: true });
      } finally {
        if (failure === 'audit') await sql`DROP TRIGGER fail_test ON access_management_event`;
        else await sql`DROP TRIGGER fail_test ON company_access_grant`;
        await sql`DROP FUNCTION fail_lifecycle_test()`;
      }
    },
  );

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }

  it('blokada członkostwa A nie blokuje operacji na innym członkostwie B', async () => {
    const { db } = connection();
    const held = deferred<void>(),
      release = deferred<void>();
    const holder = db.transaction(async (tx) => {
      await tx
        .select()
        .from(tenantMembership)
        .where(and(eq(tenantMembership.tenantId, A), eq(tenantMembership.userId, USER)))
        .for('update');
      held.resolve();
      await release.promise;
    });
    await held.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        manageAccess(grant({ tenantId: B, legalEntityId: B1 }), {
          store: new PostgresAccessManagementStore(db),
          actors: { getVerifiedActor: async () => ({ userId: ACTOR }) },
          authorizer: { authorize: async (_actor, command) => command.tenantId === B },
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Niepotrzebna blokada innego członkostwa')),
            3000,
          );
        }),
      ]);
      expectOk(result);
    } finally {
      if (timer) clearTimeout(timer);
      release.resolve();
      await holder;
    }
  });
  // Pierwsza transakcja trzyma rzeczywistą blokadę; pg_blocking_pids dowodzi,
  // że druga JUŻ próbuje ją uzyskać przed zwolnieniem pierwszej. Bez samego Promise.all.
  async function overlap(first: AccessManagementCommand, second: AccessManagementCommand) {
    const { db, client: sql } = connection();
    const held = deferred<number>(),
      waiting = deferred<number>(),
      release = deferred<void>();
    const wrapped = (holder: boolean): Pick<TestDatabase['db'], 'transaction'> => ({
      transaction: (callback) =>
        db.transaction(async (tx) => {
          await tx.execute(statement`SET LOCAL lock_timeout = '4s'`);
          await tx.execute(statement`SET LOCAL statement_timeout = '5s'`);
          const pid = Number(
            (await tx.execute<{ pid: number }>(statement`SELECT pg_backend_pid() AS pid`))[0]!.pid,
          );
          if (holder) {
            await tx
              .select()
              .from(tenantMembership)
              .where(
                and(
                  eq(tenantMembership.tenantId, first.tenantId),
                  eq(tenantMembership.userId, first.userId),
                ),
              )
              .for('update');
            held.resolve(pid);
            await release.promise;
          } else waiting.resolve(pid);
          return callback(tx);
        }),
    });
    const p1 = run(first, new PostgresAccessManagementStore(wrapped(true)));
    const holderPid = await held.promise;
    const p2 = run(second, new PostgresAccessManagementStore(wrapped(false)));
    try {
      const waiterPid = await waiting.promise;
      const deadline = Date.now() + 3000;
      let observed = false;
      while (Date.now() < deadline) {
        const rows =
          await sql`SELECT ${holderPid}::int = ANY(pg_blocking_pids(${waiterPid}::int)) AS blocked`;
        if (rows[0]?.blocked === true) {
          observed = true;
          break;
        }
        await new Promise((done) => setTimeout(done, 10));
      }
      expect(observed, 'Druga transakcja musi czekać na blokadę pierwszej').toBe(true);
    } finally {
      release.resolve();
    }
    return Promise.all([p1, p2]);
  }
  it.each(['grant-first', 'revoke-first'] as const)(
    'równoległe grant/cofnięcie: %s, rzeczywiste oczekiwanie na blokadę',
    async (order) => {
      const g = grant(),
        r = revoke();
      const results = await overlap(
        order === 'grant-first' ? g : r,
        order === 'grant-first' ? r : g,
      );
      expectOk(results[0]!);
      if (order === 'grant-first') expectOk(results[1]!);
      else expect(results[1]).toEqual({ ok: false, reason: 'membership_inactive' });
      expect((await member()).status).toBe('revoked');
      expect(await authorize()).toMatchObject({ allowed: false });
      expect((await grants()).every((row) => row.revokedAt !== null)).toBe(true);
    },
  );
  it.each(['revoke-first', 'reactivate-first'] as const)(
    'równoległe cofnięcie/reaktywacja: %s, bez zakleszczenia',
    async (order) => {
      expectOk(await run(grant()));
      if (order === 'reactivate-first') expectOk(await run(revoke()));
      const results = await overlap(
        order === 'revoke-first' ? revoke() : reactivate(),
        order === 'revoke-first' ? reactivate() : revoke(),
      );
      results.forEach(expectOk);
      expect(await authorize()).toMatchObject({ allowed: false });
      expect((await member()).status).toBe(order === 'revoke-first' ? 'active' : 'revoked');
      expect((await grants()).every((row) => row.revokedAt !== null)).toBe(true);
    },
  );
  it.each([true, false])(
    'równoległe nadanie: jedno uprawnienie; wspólny operationId=%s',
    async (sameOperation) => {
      const first = grant();
      const second = sameOperation ? first : grant();
      const results = await overlap(first, second);
      const receipts = results.map(expectOk);
      expect(receipts[0]!.grantId).toBe(receipts[1]!.grantId);
      expect(await grants()).toHaveLength(1);
      expect(await events()).toHaveLength(sameOperation ? 1 : 2);
      expect(await authorize()).toMatchObject({ allowed: true });
    },
  );
});
