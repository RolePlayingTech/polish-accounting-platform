import { legalEntityId, tenantId, userId } from '@pap/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresAccessManagementAuthorizationDataSource } from '../src/access-management.js';
import { PostgresUserIdentityResolver, PostgresUserIdentityStore } from '../src/user-identity.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const USER_A = userId(id(31));
const IDENTITY_1 = id(41);
const ISSUER_1 = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const SUBJECT_1 = 'Opaque-Subject-Case-Sensitive-001';
const nowIso = '2026-10-28T12:00:00.123Z';

const clients: ReturnType<typeof connectDatabase>['client'][] = [];

function createTestClient() {
  const connection = connectDatabase({
    PAP_DATABASE_ENV: 'test',
    DATABASE_URL: 'postgres://pap_test:synthetic_only@127.0.0.1:5432/pap_test',
  });
  clients.push(connection.client);
  return connection;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 1 })));
});

describe('Adaptery PostgreSQL tożsamości i autoryzacji administracyjnej (bez połączenia DB)', () => {
  it('PostgresUserIdentityResolver wykonuje jeden parametryzowany SELECT z INNER JOIN i sprawdza case-sensitive subject oraz statusy', async () => {
    const { client, db } = createTestClient();
    const row = [USER_A, 'active', null, 'active', null, ISSUER_1, SUBJECT_1];
    const values = vi.fn(async () => [row]);
    const unsafe = vi.spyOn(client, 'unsafe').mockReturnValue({
      values,
    } as unknown as ReturnType<typeof client.unsafe>);

    const resolver = new PostgresUserIdentityResolver(db);
    await expect(
      resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: SUBJECT_1 }),
    ).resolves.toEqual({ userId: USER_A });

    expect(unsafe).toHaveBeenCalledTimes(1);
    const [sql, params] = unsafe.mock.calls[0]!;
    expect(params).toEqual([ISSUER_1, SUBJECT_1]);
    expect(sql).toContain('from "user_oidc_identity"');
    expect(sql).toContain(
      'inner join "app_user" on "app_user"."id" = "user_oidc_identity"."user_id"',
    );
    expect(sql).toContain(
      'where ("user_oidc_identity"."issuer" = $1 and "user_oidc_identity"."subject" = $2)',
    );
    expect(sql).not.toContain(SUBJECT_1);

    // Nawet gdyby baza zwróciła rekord o innej wielkości liter (np. przez błędny collation), resolver odrzuca go w pamięci
    await expect(
      resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: SUBJECT_1.toLowerCase() }),
    ).resolves.toBeNull();
  });

  it.each([
    [
      'konto wyłączone (disabled)',
      [USER_A, 'disabled', nowIso, 'active', null, ISSUER_1, SUBJECT_1],
    ],
    [
      'powiązanie cofnięte (revoked)',
      [USER_A, 'active', null, 'revoked', nowIso, ISSUER_1, SUBJECT_1],
    ],
    [
      'ustawione disabledAt mimo active',
      [USER_A, 'active', nowIso, 'active', null, ISSUER_1, SUBJECT_1],
    ],
    [
      'ustawione revokedAt mimo active',
      [USER_A, 'active', null, 'active', nowIso, ISSUER_1, SUBJECT_1],
    ],
    ['brak rekordu', []],
  ])('PostgresUserIdentityResolver zwraca null: %s', async (_label, row) => {
    const { client, db } = createTestClient();
    vi.spyOn(client, 'unsafe').mockReturnValue({
      values: vi.fn(async () => (row.length ? [row] : [])),
    } as unknown as ReturnType<typeof client.unsafe>);

    const resolver = new PostgresUserIdentityResolver(db);
    await expect(
      resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: SUBJECT_1 }),
    ).resolves.toBeNull();
  });

  it('PostgresUserIdentityResolver redaguje błędy bazy bez ujawniania SQL, parametrów i cause', async () => {
    const { client, db } = createTestClient();
    vi.spyOn(client, 'unsafe').mockReturnValue({
      values: vi.fn(async () => {
        throw new Error('SELECT * FROM user_oidc_identity password=synthetic-secret');
      }),
    } as unknown as ReturnType<typeof client.unsafe>);

    const resolver = new PostgresUserIdentityResolver(db);
    const err = await resolver
      .resolveVerifiedIdentity({ issuer: ISSUER_1, subject: SUBJECT_1 })
      .catch((error: unknown) => error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Źródło tożsamości użytkowników jest niedostępne.');
    expect(err).not.toHaveProperty('cause');
  });

  it('PostgresUserIdentityStore koduje daty w transakcjach bez przekazywania surowego Date do postgres.js', async () => {
    const { client, db } = createTestClient();
    vi.spyOn(client, 'begin').mockImplementation((async (
      callback: (sql: typeof client) => Promise<unknown>,
    ) => callback(client)) as unknown as typeof client.begin);

    const rawDates: unknown[] = [];
    const transport = vi.spyOn(client, 'unsafe').mockImplementation((query, parameters = []) => {
      for (const parameter of parameters) {
        if (parameter instanceof Date) rawDates.push(parameter);
      }
      if (rawDates.length) throw new Error('Niezakodowany parametr Date.');
      let rows: unknown[] = [];
      if (query.includes('clock_timestamp()')) {
        rows = [{ now: nowIso }];
      }
      const result = Object.assign(Promise.resolve(rows), { values: async () => rows });
      return result as unknown as ReturnType<typeof client.unsafe>;
    });

    const store = new PostgresUserIdentityStore(db);
    const provisioned = await store.provisionUserWithOidcIdentity({
      userId: USER_A,
      identityId: IDENTITY_1,
      issuer: ISSUER_1,
      subject: SUBJECT_1,
    });
    expect(provisioned).toEqual({ ok: true, userId: USER_A });
    expect(rawDates).toEqual([]);
    expect(transport.mock.calls.some(([q]) => q.includes('insert into "app_user"'))).toBe(true);
    expect(transport.mock.calls.some(([q]) => q.includes('insert into "user_oidc_identity"'))).toBe(
      true,
    );
  });

  it('PostgresAccessManagementAuthorizationDataSource pobiera fakty w obrębie tenanta i redaguje błędy DB', async () => {
    const { client, db } = createTestClient();
    const tenantA = tenantId(id(1));
    const entityA1 = legalEntityId(id(11));
    const actorUser = userId(id(21));
    const targetUser = userId(id(22));

    const unsafe = vi.spyOn(client, 'unsafe').mockImplementation((query) => {
      let rows: unknown[][] = [];
      if (query.includes('from "tenant_membership"')) {
        rows = [
          [tenantA, actorUser, 'tenant_admin', 'active', nowIso, null],
          [tenantA, targetUser, 'tenant_member', 'active', nowIso, null],
        ];
      } else if (query.includes('from "company_access_grant"')) {
        rows = [[id(90), tenantA, actorUser, entityA1, 'read', nowIso, null, null]];
      }
      return Object.assign(Promise.resolve(rows), {
        values: async () => rows,
      }) as unknown as ReturnType<typeof client.unsafe>;
    });

    const dataSource = new PostgresAccessManagementAuthorizationDataSource(db);
    const facts = await dataSource.getAuthorizationFacts(
      { userId: actorUser },
      {
        kind: 'grant',
        operationId: id(99),
        tenantId: tenantA,
        userId: targetUser,
        grantId: id(98),
        legalEntityId: entityA1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
    );

    expect(facts.actorMembership).toMatchObject({ userId: actorUser, role: 'tenant_admin' });
    expect(facts.targetMembership).toMatchObject({ userId: targetUser, role: 'tenant_member' });
    expect(facts.actorGrants).toHaveLength(1);
    expect(unsafe).toHaveBeenCalledTimes(2);
  });
});
