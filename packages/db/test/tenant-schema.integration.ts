import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations } from '../src/migrations.js';
import {
  companyAccessGrant,
  entityProfileVersion,
  legalEntity,
  tenant,
  tenantMembership,
} from '../src/schema.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

// Wyłącznie syntetyczne UUID v4, deterministyczne we wszystkich przypadkach.
const id = (number: number) => `00000000-0000-4000-8000-${number.toString().padStart(12, '0')}`;
const A = id(1);
const B = id(2);
const A1 = id(11);
const A2 = id(12);
const B1 = id(21);
const USER = id(31);
const FROM = '2026-01-01T00:00:00.000Z';
const NEXT = '2026-07-01T00:00:00.000Z';
const from = new Date(FROM);

const rows: Record<string, Record<string, string | null>> = {
  tenant: { id: id(91), name: 'Organizacja syntetyczna', created_at: FROM },
  legal_entity: { id: id(91), tenant_id: A, display_name: 'Podmiot syntetyczny', created_at: FROM },
  tenant_membership: {
    tenant_id: A,
    user_id: id(91),
    role: 'tenant_member',
    status: 'active',
    valid_from: FROM,
    valid_until: null,
  },
  entity_profile_version: {
    id: id(91),
    tenant_id: A,
    legal_entity_id: A2,
    profile_code: 'syntetyczny',
    valid_from: FROM,
    valid_until: null,
  },
  company_access_grant: {
    grant_id: id(91),
    tenant_id: A,
    user_id: USER,
    legal_entity_id: A1,
    action: 'read',
    valid_from: FROM,
    valid_until: null,
    revoked_at: null,
  },
};

describe('Integralność tenantów, firm i jawnych grantów PostgreSQL', () => {
  let database: TestDatabase | undefined;
  const connection = () => {
    if (!database) throw new Error('Brak izolowanej bazy testowej.');
    return database;
  };
  const insert = (table: string, changes: Record<string, string | null> = {}) => {
    const { client: sql } = connection();
    return sql`INSERT INTO ${sql(table)} ${sql({ ...rows[table], ...changes })}`;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    const { db, dataSchema } = database;
    await applyMigrations(db, dataSchema);
    await db.insert(tenant).values([
      { id: A, name: 'Tenant A — syntetyczny' },
      { id: B, name: 'Tenant B — syntetyczny' },
    ]);
    await db.insert(legalEntity).values([
      { id: A1, tenantId: A, displayName: 'Firma A1 — syntetyczna' },
      { id: A2, tenantId: A, displayName: 'Firma A2 — syntetyczna' },
      { id: B1, tenantId: B, displayName: 'Firma B1 — syntetyczna' },
    ]);
    await db.insert(tenantMembership).values({
      tenantId: A,
      userId: USER,
      role: 'tenant_admin',
      status: 'active',
      validFrom: from,
    });
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
        userId: USER,
        legalEntityId: A1,
        action: 'write',
        validFrom: from,
      },
    ]);
    await db.insert(entityProfileVersion).values([
      {
        id: id(51),
        tenantId: A,
        legalEntityId: A1,
        profileCode: 'syntetyczny_v1',
        validFrom: from,
        validUntil: new Date(NEXT),
      },
      {
        id: id(52),
        tenantId: A,
        legalEntityId: A1,
        profileCode: 'syntetyczny_v2',
        validFrom: new Date(NEXT),
      },
    ]);
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  it('zapisuje A/B, A1/A2/B1, osobne read/write oraz sąsiednie wersje profilu przez Drizzle', async () => {
    const { db } = connection();
    expect(await db.select().from(tenant)).toHaveLength(2);
    expect(await db.select().from(legalEntity)).toHaveLength(3);
    const grants = await db.select().from(companyAccessGrant);
    expect(grants.map((grant) => grant.action).sort()).toEqual(['read', 'write']);
    expect(grants[0]?.validFrom).toEqual(from);
    const profiles = await db
      .select()
      .from(entityProfileVersion)
      .orderBy(entityProfileVersion.validFrom);
    expect(profiles[0]?.validUntil).toEqual(profiles[1]?.validFrom);
  });

  it('granty A1 nie tworzą wpisu dla A2 ani B1; członkostwo administratora nie tworzy grantów', async () => {
    const { db, client: sql } = connection();
    expect(
      await db.select().from(companyAccessGrant).where(eq(companyAccessGrant.legalEntityId, A2)),
    ).toHaveLength(0);
    expect(
      await db.select().from(companyAccessGrant).where(eq(companyAccessGrant.legalEntityId, B1)),
    ).toHaveLength(0);
    await sql.begin(async (tx) => {
      await tx`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from)
        VALUES (${A}, ${id(32)}, 'tenant_owner', 'active', ${FROM})`;
      expect(await tx`SELECT * FROM company_access_grant WHERE user_id = ${id(32)}`).toHaveLength(
        0,
      );
      // Ta dodatkowa syntetyczna osoba należy wyłącznie do schematu testu.
    });
  });

  it.each([
    ['legal_entity', { tenant_id: id(99) }, 'legal_entity_tenant_id_tenant_id_fk'],
    ['tenant_membership', { tenant_id: id(99) }, 'tenant_membership_tenant_id_tenant_id_fk'],
    ['company_access_grant', { user_id: id(99) }, 'company_access_grant_membership_fk'],
    ['company_access_grant', { legal_entity_id: B1 }, 'company_access_grant_entity_fk'],
    [
      'company_access_grant',
      { tenant_id: B, legal_entity_id: B1 },
      'company_access_grant_membership_fk',
    ],
    ['company_access_grant', { legal_entity_id: id(99) }, 'company_access_grant_entity_fk'],
    ['entity_profile_version', { legal_entity_id: B1 }, 'entity_profile_version_entity_fk'],
  ] as const)('odrzuca niespójny FK %s %j', async (table, changes, constraint) => {
    await expectDatabaseError(insert(table, changes), '23503', constraint);
  });

  it.each([
    ['company_access_grant', 'action', 'approve', 'company_access_grant_action_check'],
    ['company_access_grant', 'action', 'READ', 'company_access_grant_action_check'],
    ['tenant_membership', 'status', 'pending', 'tenant_membership_status_check'],
    ['tenant_membership', 'role', 'superadmin', 'tenant_membership_role_check'],
    ['tenant_membership', 'role', 'platform_operator', 'tenant_membership_role_check'],
    ['tenant', 'name', '  ', 'tenant_name_not_blank'],
    ['legal_entity', 'display_name', '', 'legal_entity_name_not_blank'],
    ['entity_profile_version', 'profile_code', '', 'entity_profile_version_code_not_blank'],
  ])('odrzuca niedozwoloną wartość %s.%s=%s', async (table, column, value, constraint) => {
    await expectDatabaseError(insert(table!, { [column!]: value! }), '23514', constraint);
  });

  for (const table of ['tenant_membership', 'company_access_grant', 'entity_profile_version']) {
    it.each([FROM, '2025-12-31T23:59:59.999Z'])(
      `odrzuca koniec <= początek w ${table}: %s`,
      async (until) => {
        await expectDatabaseError(
          insert(table, { valid_until: until }),
          '23514',
          `${table}_validity_check`,
        );
      },
    );
    it.each(['valid_from', 'valid_until'])(
      `odrzuca nieskończony czas ${table}.%s`,
      async (column) => {
        await expectDatabaseError(
          insert(table, { [column]: 'infinity' }),
          '23514',
          `${table}_validity_check`,
        );
      },
    );
  }

  it('odrzuca nieskończoną datę cofnięcia', async () => {
    await expectDatabaseError(
      insert('company_access_grant', { revoked_at: 'infinity' }),
      '23514',
      'company_access_grant_revoked_at_check',
    );
  });

  it.each([
    ['tenant', { id: A }],
    ['legal_entity', { id: A1 }],
    ['tenant_membership', { user_id: USER }],
    ['company_access_grant', { grant_id: id(41) }],
    ['entity_profile_version', { id: id(51) }],
  ] as const)('odrzuca naruszenie unikalności %s', async (table, changes) => {
    await expectDatabaseError(insert(table, changes), '23505');
  });

  for (const [table, row] of Object.entries(rows)) {
    for (const [column, value] of Object.entries(row)) {
      if (value === null) continue;
      it(`odrzuca NULL w wymaganej kolumnie ${table}.${column}`, async () => {
        await expectDatabaseError(insert(table, { [column]: null }), '23502');
      });
    }
  }

  it.each([
    ['2026-06-01T00:00:00.000Z', NEXT],
    [FROM, null],
    [NEXT, null],
  ])('odrzuca nakładający się profil [%s, %s), także o innym kodzie', async (start, end) => {
    await expectDatabaseError(
      insert('entity_profile_version', {
        legal_entity_id: A1,
        valid_from: start!,
        valid_until: end!,
        profile_code: 'inny_kod',
      }),
      '23P01',
      'entity_profile_version_no_overlap',
    );
  });

  it('chroni profil także przy UPDATE', async () => {
    const { client: sql } = connection();
    await expectDatabaseError(
      sql`UPDATE entity_profile_version
      SET valid_from = '2026-06-01T00:00:00Z' WHERE id = ${id(52)}`,
      '23P01',
      'entity_profile_version_no_overlap',
    );
  });

  it('dopuszcza niezależne profile A2 i B1 oraz chwilę graniczną [od, do)', async () => {
    const { client: sql } = connection();
    await insert('entity_profile_version');
    await insert('entity_profile_version', { id: id(92), tenant_id: B, legal_entity_id: B1 });
    for (const time of [FROM, NEXT]) {
      const matches = await sql`SELECT id FROM entity_profile_version
        WHERE tenant_id = ${A} AND legal_entity_id = ${A1}
          AND tstzrange(valid_from, valid_until, '[)') @> ${time}::timestamptz`;
      expect(Array.from(matches, (row) => row.id)).toEqual([time === FROM ? id(51) : id(52)]);
    }
  });

  it('zapisuje cofnięte członkostwo i grant, także odwołany przed początkiem, bez kasowania historii', async () => {
    const { client: sql } = connection();
    await insert('tenant_membership', { status: 'revoked' });
    await insert('company_access_grant', { user_id: id(91), revoked_at: '2025-12-01T00:00:00Z' });
    const members = await sql`SELECT status FROM tenant_membership WHERE user_id = ${id(91)}`;
    expect(members[0]?.status).toBe('revoked');
    const grants = await sql`SELECT revoked_at < valid_from AS revoked_before_start
      FROM company_access_grant WHERE grant_id = ${id(91)}`;
    expect(grants[0]?.revoked_before_start).toBe(true);
  });

  it('nie usuwa ani nie przenosi referencjonowanego członkostwa i firmy', async () => {
    const { client: sql } = connection();
    // PostgreSQL 18 rozróżnia odmowę RESTRICT (23001) od błędnego FK (23503).
    await expectDatabaseError(
      sql`DELETE FROM tenant_membership WHERE tenant_id = ${A} AND user_id = ${USER}`,
      '23001',
    );
    await expectDatabaseError(sql`DELETE FROM legal_entity WHERE id = ${A1}`, '23001');
    await expectDatabaseError(
      sql`UPDATE legal_entity SET tenant_id = ${B} WHERE id = ${A1}`,
      '23001',
    );
    await expectDatabaseError(
      sql`UPDATE company_access_grant SET legal_entity_id = ${B1} WHERE grant_id = ${id(41)}`,
      '23503',
    );
  });

  it('rozstrzyga konflikt profili między dwoma równoległymi zapisami', async () => {
    const { client: sql } = connection();
    await sql`INSERT INTO legal_entity (id, tenant_id, display_name)
      VALUES (${id(61)}, ${A}, 'Firma do testu współbieżności')`;
    const inserted = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const first = sql.begin(async (tx) => {
      await tx`INSERT INTO entity_profile_version (id, tenant_id, legal_entity_id, profile_code, valid_from)
        VALUES (${id(62)}, ${A}, ${id(61)}, 'syntetyczny', ${FROM})`;
      inserted.resolve();
      await finish.promise;
    });
    first.catch(inserted.reject);
    try {
      await inserted.promise;
      const second = expectDatabaseError(
        sql.begin(async (tx) => {
          await tx`INSERT INTO entity_profile_version (id, tenant_id, legal_entity_id, profile_code, valid_from)
          VALUES (${id(63)}, ${A}, ${id(61)}, 'inny_kod', ${NEXT})`;
        }),
        '23P01',
        'entity_profile_version_no_overlap',
      );
      finish.resolve();
      await Promise.all([first, second]);
      expect(
        await sql`SELECT id FROM entity_profile_version WHERE legal_entity_id = ${id(61)}`,
      ).toHaveLength(1);
    } finally {
      finish.resolve();
      await first;
    }
  });

  it('wycofuje cały zapis transakcyjny po błędzie grantu', async () => {
    const { client: sql } = connection();
    await expectDatabaseError(
      sql.begin(async (tx) => {
        await tx`INSERT INTO tenant (id, name) VALUES (${id(81)}, 'Tenant do rollbacku')`;
        await tx`INSERT INTO legal_entity (id, tenant_id, display_name)
        VALUES (${id(82)}, ${id(81)}, 'Firma do rollbacku')`;
        await tx`INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from)
        VALUES (${id(83)}, ${id(81)}, ${USER}, ${id(82)}, 'read', ${FROM})`;
      }),
      '23503',
    );
    expect(await sql`SELECT id FROM tenant WHERE id = ${id(81)}`).toHaveLength(0);
    expect(await sql`SELECT id FROM legal_entity WHERE id = ${id(82)}`).toHaveLength(0);
    expect(
      await sql`SELECT grant_id FROM company_access_grant WHERE grant_id = ${id(83)}`,
    ).toHaveLength(0);
    expect(await sql`SELECT id FROM legal_entity WHERE id IN (${A1}, ${A2}, ${B1})`).toHaveLength(
      3,
    );
  });
});
