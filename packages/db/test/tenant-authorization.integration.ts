import { authorizeCompanyAction, type TenantAuthorizationQuery } from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../src/migrations.js';
import { companyAccessGrant, legalEntity, tenant, tenantMembership } from '../src/schema.js';
import { PostgresTenantAuthorizationDataSource } from '../src/tenant-authorization.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const A = tenantId(id(1));
const B = tenantId(id(2));
const A1 = legalEntityId(id(11));
const A2 = legalEntityId(id(12));
const B1 = legalEntityId(id(21));
const USER = userId(id(31));
const ADMIN = userId(id(32));
const OTHER = userId(id(33));
const B_USER = userId(id(34));
const from = new Date('2026-01-01T00:00:00.123Z');
const now = new Date('2026-10-28T12:00:00.456Z');
const future = new Date(now.getTime() + 1);
const clock = { now: () => now };
const query: TenantAuthorizationQuery = {
  tenantId: A,
  userId: USER,
  legalEntityId: A1,
  action: 'read',
};
const allow = { allowed: true, reason: 'explicit_company_grant' };
const denyGrant = { allowed: false, reason: 'explicit_company_grant_required' };
const denyMembership = { allowed: false, reason: 'active_membership_required' };

describe('PostgreSQL → port autoryzacji → wspólna polityka (dane syntetyczne)', () => {
  let database: TestDatabase | undefined;
  let source: PostgresTenantAuthorizationDataSource;
  const connection = () => {
    if (!database) throw new Error('Brak izolowanej bazy testowej.');
    return database;
  };
  const authorize = (changes: Partial<TenantAuthorizationQuery> = {}) =>
    authorizeCompanyAction(source, { ...query, ...changes }, clock);
  const updateMember = (changes: Partial<typeof tenantMembership.$inferInsert>) =>
    connection()
      .db.update(tenantMembership)
      .set(changes)
      .where(and(eq(tenantMembership.tenantId, A), eq(tenantMembership.userId, USER)));
  const updateGrant = (changes: Partial<typeof companyAccessGrant.$inferInsert>) =>
    connection()
      .db.update(companyAccessGrant)
      .set(changes)
      .where(eq(companyAccessGrant.grantId, id(41)));

  beforeAll(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.db, database.dataSchema);
    source = new PostgresTenantAuthorizationDataSource(database.db);
    await database.db.insert(tenant).values([
      { id: A, name: 'Tenant A — syntetyczny' },
      { id: B, name: 'Tenant B — syntetyczny' },
    ]);
    await database.db.insert(legalEntity).values([
      { id: A1, tenantId: A, displayName: 'A1 — syntetyczna' },
      { id: A2, tenantId: A, displayName: 'A2 — syntetyczna' },
      { id: B1, tenantId: B, displayName: 'B1 — syntetyczna' },
    ]);
  });

  beforeEach(async () => {
    const { db } = connection();
    // Wyłącznie losowy namespace utworzony i kontrolowany przez createTestDatabase.
    await db.delete(companyAccessGrant);
    await db.delete(tenantMembership);
    await db.insert(tenantMembership).values([
      { tenantId: A, userId: USER, role: 'tenant_member', status: 'active', validFrom: from },
      { tenantId: A, userId: ADMIN, role: 'tenant_admin', status: 'active', validFrom: from },
      { tenantId: A, userId: OTHER, role: 'tenant_member', status: 'active', validFrom: from },
      { tenantId: B, userId: B_USER, role: 'tenant_owner', status: 'active', validFrom: from },
    ]);
    await db.insert(companyAccessGrant).values([
      {
        grantId: id(41),
        tenantId: A,
        userId: USER,
        legalEntityId: A1,
        action: 'read',
        validFrom: from,
      },
      {
        grantId: id(42),
        tenantId: A,
        userId: OTHER,
        legalEntityId: A1,
        action: 'write',
        validFrom: from,
      },
      {
        grantId: id(43),
        tenantId: A,
        userId: OTHER,
        legalEntityId: A2,
        action: 'read',
        validFrom: from,
      },
      {
        grantId: id(44),
        tenantId: B,
        userId: B_USER,
        legalEntityId: B1,
        action: 'read',
        validFrom: from,
      },
    ]);
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  it('pozwala na jawne read A1 i mapuje daty oraz brak źródła ról platformowych', async () => {
    expect(await authorize()).toEqual(allow);
    expect(await source.getFacts(query)).toEqual({
      membership: {
        tenantId: A,
        userId: USER,
        role: 'tenant_member',
        status: 'active',
        validFrom: from,
        validUntil: null,
      },
      grants: [
        {
          grantId: id(41),
          tenantId: A,
          userId: USER,
          legalEntityId: A1,
          action: 'read',
          validFrom: from,
          validUntil: null,
          revokedAt: null,
        },
      ],
      platformRoleAssignments: [],
    });
  });

  it.each(['platform_operator', 'platform_support', 'platform_auditor'])(
    'odrzuca rolę platformy %s jako akcję grantu',
    async (role) => {
      const { client: sql } = connection();
      await expectDatabaseError(
        sql`INSERT INTO company_access_grant
          (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from)
          VALUES (${id(90)}, ${A}, ${ADMIN}, ${A1}, ${role}, ${from.toISOString()})`,
        '23514',
        'company_access_grant_action_check',
      );
      expect(await authorize({ userId: ADMIN })).toEqual(denyGrant);
    },
  );

  it.each([
    ['inna firma A2', { legalEntityId: A2 }, denyGrant],
    ['podmieniona firma B1 w A', { legalEntityId: B1 }, denyGrant],
    ['inny tenant B i firma B1', { tenantId: B, legalEntityId: B1 }, denyMembership],
    ['inny tenant B i firma A1', { tenantId: B }, denyMembership],
    ['write nie wynika z read', { action: 'write' }, denyGrant],
    ['administrator bez grantu', { userId: ADMIN }, denyGrant],
    ['poprawny UUID bez członkostwa', { userId: userId(id(99)) }, denyMembership],
  ] as const)('odmawia: %s; źródło nie ujawnia obcych grantów', async (_label, changes, result) => {
    const scopedQuery = { ...query, ...changes };
    const facts = await source.getFacts(scopedQuery);
    expect(facts.grants).toEqual([]);
    expect(facts.membership?.tenantId ?? scopedQuery.tenantId).toBe(scopedQuery.tenantId);
    expect(facts.membership?.userId ?? scopedQuery.userId).toBe(scopedQuery.userId);
    expect(await authorize(changes)).toEqual(result);
  });

  it.each([
    ['revoked', { status: 'revoked' }],
    ['przyszłe członkostwo', { validFrom: future }],
    ['wygasłe członkostwo (koniec wyłączny)', { validUntil: now }],
  ] as const)('odmawia przy członkostwie: %s', async (_label, changes) => {
    await updateMember(changes);
    expect(await authorize()).toEqual(denyMembership);
  });

  it.each([
    ['cofnięty', { revokedAt: now }],
    ['wygasły (koniec wyłączny)', { validUntil: now }],
    ['przyszły', { validFrom: future }],
    ['cofnięty przed początkiem', { validFrom: future, revokedAt: now }],
  ] as const)('odmawia przy grancie: %s i zachowuje daty źródła', async (_label, changes) => {
    await updateGrant(changes);
    expect((await source.getFacts(query)).grants[0]).toMatchObject(changes);
    expect(await authorize()).toEqual(denyGrant);
  });

  it('uwzględnia granice czasu: początek włącznie, przyszły koniec i cofnięcie', async () => {
    await updateMember({ validFrom: now, validUntil: future });
    await updateGrant({ validFrom: now, validUntil: future, revokedAt: future });
    expect(await authorize()).toEqual(allow);
    expect(await authorizeCompanyAction(source, query, { now: () => future })).toEqual(
      denyMembership,
    );
    await updateMember({ validUntil: null });
    expect(await authorizeCompanyAction(source, query, { now: () => future })).toEqual(denyGrant);
  });

  it('ponownie odczytuje grant i członkostwo po zmianach; brak nieaktualnego cache', async () => {
    expect(await authorize()).toEqual(allow);
    await updateGrant({ revokedAt: now });
    expect(await authorize()).toEqual(denyGrant);
    await updateMember({ status: 'revoked' });
    expect(await authorize()).toEqual(denyMembership);
  });

  it('nie miesza równoległych odczytów tenantów/firm/użytkowników/akcji', async () => {
    // Ta sama osoba w dwóch tenantach: również członkostwo musi pochodzić z pary.
    const { db } = connection();
    await db.insert(tenantMembership).values({
      tenantId: B,
      userId: USER,
      role: 'tenant_admin',
      status: 'revoked',
      validFrom: from,
    });
    await db.insert(companyAccessGrant).values({
      grantId: id(45),
      tenantId: B,
      userId: USER,
      legalEntityId: B1,
      action: 'read',
      validFrom: from,
    });
    const cases = [
      [query, allow],
      [{ ...query, tenantId: B, legalEntityId: B1 }, denyMembership],
      [{ ...query, tenantId: B, legalEntityId: B1, userId: B_USER }, allow],
      [{ ...query, legalEntityId: A2 }, denyGrant],
      [{ ...query, action: 'write' }, denyGrant],
      [{ ...query, legalEntityId: B1 }, denyGrant],
    ] as const;
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        await Promise.all(
          cases.map(async ([request, expected]) => {
            expect(await authorizeCompanyAction(source, request, clock)).toEqual(expected);
            const facts = await source.getFacts(request);
            expect(facts.membership).toMatchObject({
              tenantId: request.tenantId,
              userId: request.userId,
            });
            for (const grant of facts.grants) {
              expect(grant).toMatchObject({
                tenantId: request.tenantId,
                userId: request.userId,
                legalEntityId: request.legalEntityId,
                action: request.action,
              });
            }
          }),
        );
      }),
    );
  });

  it('odmawia po awarii prawdziwego źródła DB bez ujawniania wyjątku', async () => {
    const { client: sql } = connection();
    // RENAME tylko własnej tabeli, zawsze przywracanej; nie zamykamy wspólnej puli.
    await sql`ALTER TABLE company_access_grant RENAME TO temporarily_unavailable_grant`;
    try {
      expect(await authorize()).toEqual({
        allowed: false,
        reason: 'authorization_data_unavailable',
      });
    } finally {
      await sql`ALTER TABLE temporarily_unavailable_grant RENAME TO company_access_grant`;
    }
    expect(await authorize()).toEqual(allow);
  });

  it('regresja PR #20: także SQL active → revoked → active nie przywraca historycznego grantu', async () => {
    expect(await authorize()).toEqual(allow);
    await updateMember({ status: 'revoked' });
    expect(await authorize()).toEqual(denyMembership);
    await updateMember({ status: 'active', validFrom: now });
    // Guard migracji 0002 trwale odwołuje grant przy zmianie statusu.
    expect(await authorize()).toEqual(denyGrant);
    expect((await source.getFacts(query)).grants[0]?.validFrom).toEqual(from);
  });
});
