import { describe, expect, it } from 'vitest';
import {
  authorizeCompanyAction,
  type Clock,
  type TenantAuthorizationDataSource,
  type TenantAuthorizationFacts,
  type TenantAuthorizationQuery,
} from '../src/index.js';
import {
  legalEntityId,
  tenantId,
  userId,
  type CompanyAccessGrant,
  type PlatformRoleAssignment,
  type TenantMembership,
} from '@pap/domain';

const now = new Date('2026-10-27T12:00:00.000Z');
const clock: Clock = { now: () => now };
const actorA = userId('11111111-1111-4111-8111-111111111111');
const tenantA = tenantId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const tenantB = tenantId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const companyA = legalEntityId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
const companyB = legalEntityId('dddddddd-dddd-4ddd-8ddd-dddddddddddd');

class InMemoryTenantAuthorizationSource implements TenantAuthorizationDataSource {
  constructor(private readonly facts: TenantAuthorizationFacts) {}

  async getFacts(query: TenantAuthorizationQuery): Promise<TenantAuthorizationFacts> {
    const membership = this.facts.membership;
    return {
      membership:
        membership?.userId === query.userId && membership.tenantId === query.tenantId
          ? membership
          : null,
      grants: this.facts.grants.filter(
        (grant) =>
          grant.userId === query.userId &&
          grant.tenantId === query.tenantId &&
          grant.legalEntityId === query.legalEntityId,
      ),
      platformRoleAssignments: this.facts.platformRoleAssignments.filter(
        (assignment) => assignment.userId === query.userId,
      ),
    };
  }
}

function activeMembership(overrides: Partial<TenantMembership> = {}): TenantMembership {
  return {
    userId: actorA,
    tenantId: tenantA,
    role: 'tenant_member',
    status: 'active',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    ...overrides,
  };
}

function grant(overrides: Partial<CompanyAccessGrant> = {}): CompanyAccessGrant {
  return {
    grantId: 'grant-synthetic-001',
    userId: actorA,
    tenantId: tenantA,
    legalEntityId: companyA,
    action: 'read',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    revokedAt: null,
    ...overrides,
  };
}

function facts(overrides: Partial<TenantAuthorizationFacts> = {}): TenantAuthorizationFacts {
  return {
    membership: activeMembership(),
    grants: [grant()],
    platformRoleAssignments: [],
    ...overrides,
  };
}

async function decide(
  sourceFacts: TenantAuthorizationFacts,
  queryOverrides: Partial<TenantAuthorizationQuery> = {},
) {
  const query: TenantAuthorizationQuery = {
    userId: actorA,
    tenantId: tenantA,
    legalEntityId: companyA,
    action: 'read',
    ...queryOverrides,
  };

  return authorizeCompanyAction(new InMemoryTenantAuthorizationSource(sourceFacts), query, clock);
}

describe('tenant and company authorization policy', () => {
  it('allows a user with an active membership and explicit grant to the company action', async () => {
    await expect(decide(facts())).resolves.toEqual({
      allowed: true,
      reason: 'explicit_company_grant',
    });
  });

  it('denies a request for a company in another tenant', async () => {
    const sourceFacts = facts({
      grants: [grant()],
    });

    await expect(
      decide(sourceFacts, { tenantId: tenantB, legalEntityId: companyB }),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('does not treat a valid company identifier as authorization', async () => {
    await expect(decide(facts({ grants: [] }))).resolves.toMatchObject({ allowed: false });
  });

  it('denies access when the tenant membership has been revoked', async () => {
    await expect(
      decide(facts({ membership: activeMembership({ status: 'revoked' }) })),
    ).resolves.toMatchObject({ allowed: false, reason: 'active_membership_required' });
  });

  it('denies access when the grant has expired', async () => {
    await expect(
      decide(facts({ grants: [grant({ validUntil: new Date('2026-10-27T11:59:59.999Z') })] })),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('does not infer write access from a read grant', async () => {
    await expect(decide(facts(), { action: 'write' })).resolves.toMatchObject({
      allowed: false,
      reason: 'explicit_company_grant_required',
    });
  });

  it('does not give a tenant administrator accounting access without a company grant', async () => {
    await expect(
      decide(
        facts({
          membership: activeMembership({ role: 'tenant_admin' }),
          grants: [],
        }),
      ),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('does not give a platform operator access to customer accounting data', async () => {
    const operator: PlatformRoleAssignment = { userId: actorA, role: 'platform_operator' };
    await expect(
      decide(
        facts({
          membership: activeMembership(),
          grants: [],
          platformRoleAssignments: [operator],
        }),
      ),
    ).resolves.toMatchObject({ allowed: false, reason: 'explicit_company_grant_required' });
  });

  it('denies a revoked company grant', async () => {
    await expect(
      decide(facts({ grants: [grant({ revokedAt: new Date('2026-10-27T11:00:00.000Z') })] })),
    ).resolves.toMatchObject({ allowed: false });
  });

  it('denies when the trusted authorization source is unavailable', async () => {
    const unavailable: TenantAuthorizationDataSource = {
      getFacts: async () => {
        throw new Error('synthetic source failure');
      },
    };

    await expect(
      authorizeCompanyAction(
        unavailable,
        { userId: actorA, tenantId: tenantA, legalEntityId: companyA, action: 'read' },
        clock,
      ),
    ).resolves.toEqual({ allowed: false, reason: 'authorization_data_unavailable' });
  });
});
