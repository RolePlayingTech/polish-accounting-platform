import { authorizeCompanyAction, type TenantAuthorizationQuery } from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresTenantAuthorizationDataSource } from '../src/tenant-authorization.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const query: TenantAuthorizationQuery = {
  tenantId: tenantId(id(1)),
  userId: userId(id(31)),
  legalEntityId: legalEntityId(id(11)),
  action: 'read',
};
const start = '2026-01-01T00:00:00.123Z';
const now = new Date('2026-10-28T12:00:00.000Z');
const clock = { now: () => now };
const member = [query.tenantId, query.userId, 'tenant_member', 'active', start, null];
const grant = [
  id(41),
  query.tenantId,
  query.userId,
  query.legalEntityId,
  'read',
  start,
  null,
  null,
];

// Prawdziwy builder i mapowanie Drizzle, zastąpiony wyłącznie transport sterownika.
// connectDatabase jest leniwy: żaden test jednostkowy nie otwiera połączenia.
const clients: ReturnType<typeof connectDatabase>['client'][] = [];
function setup(rows: unknown[][]) {
  const { client, db } = connectDatabase({
    PAP_DATABASE_ENV: 'test',
    DATABASE_URL: 'postgres://pap_test_app:synthetic_only@127.0.0.1:5432/pap_test',
  });
  clients.push(client);
  const values = vi.fn(async () => rows);
  const unsafe = vi.spyOn(client, 'unsafe').mockReturnValue({
    values,
  } as unknown as ReturnType<typeof client.unsafe>);
  return { source: new PostgresTenantAuthorizationDataSource(db), values, unsafe };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.end({ timeout: 1 })));
});

describe('Adapter PostgreSQL autoryzacji bez połączenia DB', () => {
  it('wykonuje jeden parametryzowany SELECT z pełnym zakresem członkostwa i grantu', async () => {
    const { source, unsafe } = setup([[...member, ...grant]]);
    await expect(authorizeCompanyAction(source, query, clock)).resolves.toEqual({
      allowed: true,
      reason: 'explicit_company_grant',
    });
    expect(unsafe).toHaveBeenCalledTimes(1);
    const [sql, params] = unsafe.mock.calls[0]!;
    expect(params).toEqual([query.legalEntityId, 'read', query.tenantId, query.userId]);
    expect(sql).toContain('left join "company_access_grant"');
    expect(sql).toContain('"company_access_grant"."tenant_id" = "tenant_membership"."tenant_id"');
    expect(sql).toContain('"company_access_grant"."user_id" = "tenant_membership"."user_id"');
    expect(sql).toContain('"company_access_grant"."legal_entity_id" = $1');
    expect(sql).toContain('"company_access_grant"."action" = $2');
    expect(sql).toContain(
      'where ("tenant_membership"."tenant_id" = $3 and "tenant_membership"."user_id" = $4)',
    );
    expect(sql).not.toContain(query.userId);
  });

  it('mapuje rekordy, milisekundy i NULL bez tworzenia ról platformowych', async () => {
    const { source } = setup([[...member, ...grant]]);
    expect(await source.getFacts(query)).toEqual({
      membership: {
        tenantId: query.tenantId,
        userId: query.userId,
        role: 'tenant_member',
        status: 'active',
        validFrom: new Date(start),
        validUntil: null,
      },
      grants: [
        {
          grantId: id(41),
          tenantId: query.tenantId,
          userId: query.userId,
          legalEntityId: query.legalEntityId,
          action: 'read',
          validFrom: new Date(start),
          validUntil: null,
          revokedAt: null,
        },
      ],
      platformRoleAssignments: [],
    });
  });

  it('zachowuje status revoked, koniec członkostwa oraz daty obu grantów', async () => {
    const end = '2026-11-01T00:00:00.456Z';
    const revoked = '2026-10-01T00:00:00.789Z';
    const membership = [...member.slice(0, 3), 'revoked', start, end];
    const { source } = setup([
      [...membership, ...grant.slice(0, 6), end, revoked],
      [...membership, id(42), ...grant.slice(1)],
    ]);
    const facts = await source.getFacts(query);
    expect(facts.membership).toMatchObject({ status: 'revoked', validUntil: new Date(end) });
    expect(facts.grants).toHaveLength(2);
    expect(facts.grants[0]).toMatchObject({
      validUntil: new Date(end),
      revokedAt: new Date(revoked),
    });
    expect(facts.grants[1]).toMatchObject({ grantId: id(42), validUntil: null, revokedAt: null });
    expect(await authorizeCompanyAction(source, query, clock)).toEqual({
      allowed: false,
      reason: 'active_membership_required',
    });
  });

  it.each([
    ['brak członkostwa', [], null, 'active_membership_required'],
    [
      'administrator bez grantu',
      [[...member.slice(0, 2), 'tenant_admin', ...member.slice(3), ...Array(8).fill(null)]],
      'tenant_admin',
      'explicit_company_grant_required',
    ],
  ])('%s oznacza odmowę, a nie awarię źródła', async (_label, rows, role, reason) => {
    const { source } = setup(rows as unknown[][]);
    const facts = await source.getFacts(query);
    expect(facts.membership?.role ?? null).toBe(role);
    expect(facts.grants).toEqual([]);
    expect(facts.platformRoleAssignments).toEqual([]);
    expect(await authorizeCompanyAction(source, query, clock)).toEqual({ allowed: false, reason });
  });

  it('odczytuje ponownie po cofnięciu grantu i nie korzysta z cache', async () => {
    const { source, values, unsafe } = setup([[...member, ...grant]]);
    expect((await authorizeCompanyAction(source, query, clock)).allowed).toBe(true);
    values.mockResolvedValue([[...member, ...grant.slice(0, 7), now.toISOString()]]);
    expect(await authorizeCompanyAction(source, query, clock)).toEqual({
      allowed: false,
      reason: 'explicit_company_grant_required',
    });
    expect(unsafe).toHaveBeenCalledTimes(2);
  });

  it('usuwa SQL, parametry i cause błędu, a application service zwraca bezpieczną odmowę', async () => {
    const { source, values } = setup([]);
    values.mockRejectedValue(new Error('SELECT private_data; password=synthetic-secret'));
    const failure = await source.getFacts(query).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Źródło danych autoryzacji jest niedostępne.');
    expect(failure).not.toHaveProperty('cause');
    expect(await authorizeCompanyAction(source, query, clock)).toEqual({
      allowed: false,
      reason: 'authorization_data_unavailable',
    });
  });
});
