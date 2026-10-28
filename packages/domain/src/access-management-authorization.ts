import type { LegalEntityId, TenantId, UserId } from './identifiers.js';
import type {
  AccountingAction,
  CompanyAccessGrant,
  TenantMembership,
} from './tenant-authorization.js';

export type AccessManagementCommandKind =
  'revoke_membership' | 'reactivate_membership' | 'grant' | 'revoke_grant';

export interface AccessManagementGrantScope {
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
  readonly validFrom: Date | null;
  readonly validUntil: Date | null;
}

export interface AccessManagementRevokedGrantScope {
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
}

export type AccessManagementAuthorizationDecision =
  | { readonly allowed: true; readonly reason: 'authorized_tenant_administration' }
  | {
      readonly allowed: false;
      readonly reason:
        | 'authorization_context_invalid'
        | 'self_access_management_forbidden'
        | 'active_admin_membership_required'
        | 'admin_role_required'
        | 'target_membership_unavailable'
        | 'target_role_not_delegable'
        | 'grant_scope_not_delegable';
    };

export interface DecideAccessManagementAuthorizationInput {
  readonly actorUserId: UserId;
  readonly targetUserId: UserId;
  readonly tenantId: TenantId;
  readonly commandKind: AccessManagementCommandKind;
  readonly actorMembership: TenantMembership | null;
  readonly actorGrants: readonly CompanyAccessGrant[];
  readonly targetMembership: TenantMembership | null;
  readonly requestedValidUntil?: Date | null | undefined;
  readonly grantScope?: AccessManagementGrantScope | undefined;
  readonly revokedGrantScope?: AccessManagementRevokedGrantScope | null | undefined;
  readonly now: Date;
}

/**
 * Czysta polityka domenowa autoryzacji operacji administracyjnych na członkostwach i grantach.
 * Egzekwuje izolację tenanta, zakaz samodzielnego podnoszenia uprawnień (self-dealing)
 * oraz ograniczenie delegacji dla tenant_admin wyłącznie do posiadanych praw.
 */
export function decideAccessManagementAuthorization(
  input: DecideAccessManagementAuthorizationInput,
): AccessManagementAuthorizationDecision {
  if (!isValidDate(input.now)) {
    return { allowed: false, reason: 'authorization_context_invalid' };
  }

  if (input.actorUserId === input.targetUserId) {
    return { allowed: false, reason: 'self_access_management_forbidden' };
  }

  const now = input.now.getTime();
  const actorMembership = input.actorMembership;
  if (
    actorMembership === null ||
    actorMembership.userId !== input.actorUserId ||
    actorMembership.tenantId !== input.tenantId ||
    actorMembership.status !== 'active' ||
    !isWithinValidity(actorMembership.validFrom, actorMembership.validUntil, now)
  ) {
    return { allowed: false, reason: 'active_admin_membership_required' };
  }

  if (actorMembership.role !== 'tenant_owner' && actorMembership.role !== 'tenant_admin') {
    return { allowed: false, reason: 'admin_role_required' };
  }

  const targetMembership = input.targetMembership;
  if (
    targetMembership === null ||
    targetMembership.userId !== input.targetUserId ||
    targetMembership.tenantId !== input.tenantId
  ) {
    return { allowed: false, reason: 'target_membership_unavailable' };
  }

  if (targetMembership.role === 'tenant_owner') {
    return { allowed: false, reason: 'target_role_not_delegable' };
  }

  if (actorMembership.role === 'tenant_admin' && targetMembership.role !== 'tenant_member') {
    return { allowed: false, reason: 'target_role_not_delegable' };
  }

  switch (input.commandKind) {
    case 'revoke_membership':
      return { allowed: true, reason: 'authorized_tenant_administration' };

    case 'reactivate_membership': {
      const requestedEnd = input.requestedValidUntil ?? null;
      if (requestedEnd !== null && !isValidDate(requestedEnd)) {
        return { allowed: false, reason: 'authorization_context_invalid' };
      }
      if (!isEndWithinDelegatorLimit(requestedEnd, actorMembership.validUntil)) {
        return { allowed: false, reason: 'grant_scope_not_delegable' };
      }
      return { allowed: true, reason: 'authorized_tenant_administration' };
    }

    case 'grant': {
      const scope = input.grantScope;
      if (!scope) {
        return { allowed: false, reason: 'authorization_context_invalid' };
      }
      if (
        (scope.validFrom !== null && !isValidDate(scope.validFrom)) ||
        (scope.validUntil !== null && !isValidDate(scope.validUntil))
      ) {
        return { allowed: false, reason: 'authorization_context_invalid' };
      }
      if (!isEndWithinDelegatorLimit(scope.validUntil, actorMembership.validUntil)) {
        return { allowed: false, reason: 'grant_scope_not_delegable' };
      }

      if (actorMembership.role === 'tenant_admin') {
        const hasDelegableGrant = input.actorGrants.some(
          (grant) =>
            grant.userId === input.actorUserId &&
            grant.tenantId === input.tenantId &&
            grant.legalEntityId === scope.legalEntityId &&
            grant.action === scope.action &&
            isWithinValidity(grant.validFrom, grant.validUntil, now) &&
            isNotRevokedAt(grant.revokedAt, now) &&
            isEndWithinDelegatorLimit(scope.validUntil, grant.validUntil),
        );
        if (!hasDelegableGrant) {
          return { allowed: false, reason: 'grant_scope_not_delegable' };
        }
      }

      return { allowed: true, reason: 'authorized_tenant_administration' };
    }

    case 'revoke_grant': {
      if (actorMembership.role === 'tenant_admin') {
        const scope = input.revokedGrantScope;
        if (!scope) {
          return { allowed: false, reason: 'grant_scope_not_delegable' };
        }
        const hasDelegableGrant = input.actorGrants.some(
          (grant) =>
            grant.userId === input.actorUserId &&
            grant.tenantId === input.tenantId &&
            grant.legalEntityId === scope.legalEntityId &&
            grant.action === scope.action &&
            isWithinValidity(grant.validFrom, grant.validUntil, now) &&
            isNotRevokedAt(grant.revokedAt, now),
        );
        if (!hasDelegableGrant) {
          return { allowed: false, reason: 'grant_scope_not_delegable' };
        }
      }

      return { allowed: true, reason: 'authorized_tenant_administration' };
    }

    default:
      return { allowed: false, reason: 'authorization_context_invalid' };
  }
}

function isEndWithinDelegatorLimit(
  requestedValidUntil: Date | null,
  delegatorValidUntil: Date | null,
): boolean {
  if (delegatorValidUntil === null) {
    return true;
  }
  if (!isValidDate(delegatorValidUntil) || requestedValidUntil === null) {
    return false;
  }
  return requestedValidUntil.getTime() <= delegatorValidUntil.getTime();
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
