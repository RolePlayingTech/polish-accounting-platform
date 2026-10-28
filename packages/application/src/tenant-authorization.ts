import {
  decideAccountingAccess,
  type AccountingAccessDecision,
  type CompanyAccessGrant,
  type PlatformRoleAssignment,
  type TenantMembership,
  type TenantId,
  type LegalEntityId,
  type UserId,
  type AccountingAction,
} from '@pap/domain';

export interface TenantAuthorizationQuery {
  /** Must come from verified server-side identity, never from a request role or body claim. */
  readonly userId: UserId;
  /** Selectors only; the trusted data source must resolve them against current grants. */
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
}

export interface TenantAuthorizationFacts {
  readonly membership: TenantMembership | null;
  readonly grants: readonly CompanyAccessGrant[];
  /** Kept separate from tenant/company grants; platform roles do not authorize ledger access. */
  readonly platformRoleAssignments: readonly PlatformRoleAssignment[];
}

/**
 * Port for an authoritative server-side source (implemented by infrastructure adapters).
 * Request selectors must never be treated as authorization facts by an implementation.
 */
export interface TenantAuthorizationDataSource {
  getFacts(query: TenantAuthorizationQuery): Promise<TenantAuthorizationFacts>;
}

export interface Clock {
  now(): Date;
}

export type TenantAuthorizationResult =
  | AccountingAccessDecision
  | { readonly allowed: false; readonly reason: 'authorization_data_unavailable' };

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Uses current trusted records for each call and fails closed if the source or clock fails. */
export async function authorizeCompanyAction(
  source: TenantAuthorizationDataSource,
  query: TenantAuthorizationQuery,
  clock: Clock = systemClock,
): Promise<TenantAuthorizationResult> {
  try {
    const facts = await source.getFacts(query);
    return decideAccountingAccess({
      ...query,
      membership: facts.membership,
      grants: facts.grants,
      now: clock.now(),
    });
  } catch {
    return { allowed: false, reason: 'authorization_data_unavailable' };
  }
}
