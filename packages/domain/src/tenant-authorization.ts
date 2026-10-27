import type { LegalEntityId, TenantId, UserId } from './identifiers.js';

export type AccountingAction = 'read' | 'write';

export type TenantRole = 'tenant_owner' | 'tenant_admin' | 'tenant_member';

export type PlatformRole = 'platform_operator' | 'platform_support' | 'platform_auditor';

export interface TenantMembership {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly role: TenantRole;
  readonly status: 'active' | 'revoked';
  readonly validFrom: Date;
  /** Exclusive end of the membership validity period; null means no scheduled end. */
  readonly validUntil: Date | null;
}

export interface CompanyAccessGrant {
  readonly grantId: string;
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
  readonly validFrom: Date;
  /** Exclusive end of the grant validity period; null means no scheduled end. */
  readonly validUntil: Date | null;
  /** A revocation takes effect at this instant. */
  readonly revokedAt: Date | null;
}

export interface PlatformRoleAssignment {
  readonly userId: UserId;
  readonly role: PlatformRole;
}

export type AccountingAccessDecision =
  | { readonly allowed: true; readonly reason: 'explicit_company_grant' }
  | {
      readonly allowed: false;
      readonly reason:
        | 'authorization_context_invalid'
        | 'active_membership_required'
        | 'explicit_company_grant_required';
    };

export interface DecideAccountingAccessInput {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
  readonly membership: TenantMembership | null;
  readonly grants: readonly CompanyAccessGrant[];
  readonly now: Date;
}

/**
 * Makes a deny-by-default decision from trusted membership and grant records.
 * Tenant and company identifiers only select the scope to check; they do not grant it.
 */
export function decideAccountingAccess(
  input: DecideAccountingAccessInput,
): AccountingAccessDecision {
  if (!isValidDate(input.now)) {
    return { allowed: false, reason: 'authorization_context_invalid' };
  }

  const now = input.now.getTime();
  const membership = input.membership;
  if (
    membership === null ||
    membership.userId !== input.userId ||
    membership.tenantId !== input.tenantId ||
    membership.status !== 'active' ||
    !isWithinValidity(membership.validFrom, membership.validUntil, now)
  ) {
    return { allowed: false, reason: 'active_membership_required' };
  }

  const hasGrant = input.grants.some(
    (grant) =>
      grant.userId === input.userId &&
      grant.tenantId === input.tenantId &&
      grant.legalEntityId === input.legalEntityId &&
      grant.action === input.action &&
      isWithinValidity(grant.validFrom, grant.validUntil, now) &&
      isNotRevokedAt(grant.revokedAt, now),
  );

  return hasGrant
    ? { allowed: true, reason: 'explicit_company_grant' }
    : { allowed: false, reason: 'explicit_company_grant_required' };
}

function isWithinValidity(validFrom: Date, validUntil: Date | null, now: number): boolean {
  if (!isValidDate(validFrom) || validFrom.getTime() > now) {
    return false;
  }

  return validUntil === null || (isValidDate(validUntil) && now < validUntil.getTime());
}

function isNotRevokedAt(revokedAt: Date | null, now: number): boolean {
  return revokedAt === null || (isValidDate(revokedAt) && now < revokedAt.getTime());
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
