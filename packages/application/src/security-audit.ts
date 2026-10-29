import { userId } from '@pap/domain';

export const SECURITY_AUDIT_REASONS = [
  'explicit_company_grant',
  'authorized_tenant_administration',
  'authentication_failed',
  'authorization_context_invalid',
  'active_membership_required',
  'explicit_company_grant_required',
  'identity_not_provisioned_or_disabled',
  'authorization_data_unavailable',
  'access_management_denied',
  'invalid_command',
  'membership_unavailable',
  'membership_inactive',
  'membership_not_revoked',
  'grant_unavailable',
  'operation_conflict',
  'access_management_unavailable',
  'authorization_audit_unavailable',
  'transport_rejected',
  'operation_failed',
] as const;
export type SecurityAuditReason = (typeof SECURITY_AUDIT_REASONS)[number];
export type SecurityAuditAction =
  | 'read'
  | 'write'
  | 'revoke_membership'
  | 'reactivate_membership'
  | 'grant'
  | 'revoke_grant'
  | 'unknown';

export interface SecurityAuditEvent {
  readonly requestId?: string | null | undefined;
  readonly operationId?: string | null | undefined;
  readonly accessManagementOperationId?: string | null | undefined;
  readonly actorId: string | null;
  readonly targetUserId?: string | null | undefined;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly action: SecurityAuditAction;
  readonly kind: 'company' | 'access' | 'preflight' | 'transport';
  readonly decision: 'allow' | 'deny';
  readonly outcome: 'committed' | 'denied' | 'rolled_back' | 'preflight';
  readonly reason: SecurityAuditReason;
  readonly decidedAt?: string | undefined;
}

/** Implementacja zapisuje osobną TX; nigdy nie jest używana do atomowego audytu sukcesu. */
export interface SecurityAuditRecorder {
  recordDecision(event: SecurityAuditEvent): Promise<void>;
}

export class SecurityAuditUnavailableError extends Error {
  constructor() {
    super('Audyt decyzji dostępowej jest niedostępny.');
  }
}

/** Selekcja identyfikatora, bez utrwalania surowego selektora, nagłówka lub tokenu. */
export function auditIdentifier(value: unknown): string | null {
  try {
    return typeof value === 'string' ? userId(value) : null;
  } catch {
    return null;
  }
}

export function securityAuditReason(value: string): SecurityAuditReason {
  return (SECURITY_AUDIT_REASONS as readonly string[]).includes(value)
    ? (value as SecurityAuditReason)
    : 'authentication_failed';
}
