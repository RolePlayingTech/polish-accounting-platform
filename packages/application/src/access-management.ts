import {
  decideAccessManagementAuthorization,
  legalEntityId,
  tenantId,
  userId,
  type AccountingAction,
  type CompanyAccessGrant,
  type LegalEntityId,
  type TenantId,
  type TenantMembership,
  type UserId,
} from '@pap/domain';
import {
  authenticateOidcActor,
  type AuthenticateOidcActorDependencies,
} from './oidc-authentication.js';
import { systemClock, type Clock } from './tenant-authorization.js';

interface AccessTarget {
  readonly operationId: string;
  readonly tenantId: TenantId;
  readonly userId: UserId;
}

export type AccessManagementCommand = AccessTarget &
  (
    | { readonly kind: 'revoke_membership' }
    | { readonly kind: 'reactivate_membership'; readonly validUntil: string | null }
    | {
        readonly kind: 'grant';
        readonly grantId: string;
        readonly legalEntityId: LegalEntityId;
        readonly action: AccountingAction;
        readonly validFrom: string | null;
        readonly validUntil: string | null;
      }
    | { readonly kind: 'revoke_grant'; readonly grantId: string }
  );

/** Wyłącznie wynik weryfikacji serwerowej; ten interfejs sam nie uwierzytelnia. */
export interface AccessManagementActor {
  readonly userId: UserId;
}
export interface AccessManagementActorSource {
  getVerifiedActor(): Promise<AccessManagementActor | null>;
}
/** Osobne prawo administracyjne, nigdy wywnioskowane z księgowego read/write. */
export interface AccessManagementAuthorizer {
  authorize(actor: AccessManagementActor, command: AccessManagementCommand): Promise<boolean>;
}

export interface AccessManagementAuthorizationFacts {
  readonly actorMembership: TenantMembership | null;
  readonly actorGrants: readonly CompanyAccessGrant[];
  readonly targetMembership: TenantMembership | null;
  readonly targetGrant: {
    readonly legalEntityId: LegalEntityId;
    readonly action: AccountingAction;
  } | null;
}

export interface AccessManagementAuthorizationDataSource {
  getAuthorizationFacts(
    actor: AccessManagementActor,
    command: AccessManagementCommand,
  ): Promise<AccessManagementAuthorizationFacts>;
}

export interface AccessManagementReceipt {
  readonly operationId: string;
  readonly occurredAt: string;
  readonly changed: boolean;
  readonly grantId: string | null;
}
export type AccessManagementResult =
  | { readonly ok: true; readonly receipt: AccessManagementReceipt }
  | {
      readonly ok: false;
      readonly reason:
        | 'access_management_denied'
        | 'invalid_command'
        | 'membership_unavailable'
        | 'membership_inactive'
        | 'membership_not_revoked'
        | 'grant_unavailable'
        | 'operation_conflict'
        | 'access_management_unavailable';
    };

/** Infrastruktura gwarantuje wspólną blokadę członkostwa, idempotencję i atomowy audyt. */
export interface AccessManagementStore {
  execute(
    command: AccessManagementCommand,
    actor: AccessManagementActor,
  ): Promise<AccessManagementResult>;
}

/**
 * Serwerowe źródło aktora administracyjnego powiązane z pełną weryfikacją OIDC i wewnętrznym resolverem tożsamości.
 */
export function createOidcAccessManagementActorSource(
  rawBearerToken: string | undefined | null,
  dependencies: AuthenticateOidcActorDependencies,
  options?: { readonly requiredScopes?: readonly string[] },
): AccessManagementActorSource {
  return {
    async getVerifiedActor(): Promise<AccessManagementActor | null> {
      const result = await authenticateOidcActor(rawBearerToken, dependencies, options);
      if (!result.authenticated) {
        return null;
      }
      return Object.freeze({ userId: result.userId });
    },
  };
}

/**
 * Serwerowy autoryzator administracyjny egzekwujący domenową politykę delegacji i zakaz self-escalation.
 */
export function createTenantAccessManagementAuthorizer(
  source: AccessManagementAuthorizationDataSource,
  clock: Clock = systemClock,
): AccessManagementAuthorizer {
  return {
    async authorize(
      actor: AccessManagementActor,
      command: AccessManagementCommand,
    ): Promise<boolean> {
      let canonicalActor: AccessManagementActor;
      let canonicalCommand: AccessManagementCommand;
      try {
        canonicalActor = Object.freeze({ userId: userId(actor.userId) });
        canonicalCommand = copyAccessManagementCommand(command);
      } catch {
        return false;
      }

      const facts = await source.getAuthorizationFacts(canonicalActor, canonicalCommand);
      const decision = decideAccessManagementAuthorization({
        actorUserId: canonicalActor.userId,
        targetUserId: canonicalCommand.userId,
        tenantId: canonicalCommand.tenantId,
        commandKind: canonicalCommand.kind,
        actorMembership: facts.actorMembership,
        actorGrants: facts.actorGrants,
        targetMembership: facts.targetMembership,
        requestedValidUntil:
          canonicalCommand.kind === 'reactivate_membership' && canonicalCommand.validUntil !== null
            ? new Date(canonicalCommand.validUntil)
            : null,
        grantScope:
          canonicalCommand.kind === 'grant'
            ? {
                legalEntityId: canonicalCommand.legalEntityId,
                action: canonicalCommand.action,
                validFrom:
                  canonicalCommand.validFrom === null ? null : new Date(canonicalCommand.validFrom),
                validUntil:
                  canonicalCommand.validUntil === null
                    ? null
                    : new Date(canonicalCommand.validUntil),
              }
            : undefined,
        revokedGrantScope: canonicalCommand.kind === 'revoke_grant' ? facts.targetGrant : undefined,
        now: clock.now(),
      });
      return decision.allowed === true;
    },
  };
}

// Kanoniczna kopia przed pierwszym await: brak zmiany selektorów po autoryzacji.
export function copyAccessManagementCommand(
  input: AccessManagementCommand,
): AccessManagementCommand {
  const base = {
    operationId: userId(input.operationId),
    tenantId: tenantId(input.tenantId),
    userId: userId(input.userId),
  };
  const date = (value: string | null) => {
    if (value === null) return null;
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
      throw new Error('Niepoprawna data.');
    return new Date(value).toISOString();
  };
  switch (input.kind) {
    case 'revoke_membership':
      return Object.freeze({ ...base, kind: input.kind });
    case 'reactivate_membership':
      return Object.freeze({ ...base, kind: input.kind, validUntil: date(input.validUntil) });
    case 'revoke_grant':
      return Object.freeze({ ...base, kind: input.kind, grantId: userId(input.grantId) });
    case 'grant': {
      if (input.action !== 'read' && input.action !== 'write')
        throw new Error('Niepoprawna akcja.');
      const validFrom = date(input.validFrom);
      const validUntil = date(input.validUntil);
      if (validFrom && validUntil && validUntil <= validFrom) throw new Error('Niepoprawny okres.');
      return Object.freeze({
        ...base,
        kind: input.kind,
        grantId: userId(input.grantId),
        legalEntityId: legalEntityId(input.legalEntityId),
        action: input.action,
        validFrom,
        validUntil,
      });
    }
    default:
      throw new Error('Nieznana operacja.');
  }
}

export async function manageAccess(
  input: AccessManagementCommand,
  dependencies: {
    readonly store: AccessManagementStore;
    readonly actors?: AccessManagementActorSource;
    readonly authorizer?: AccessManagementAuthorizer;
  },
): Promise<AccessManagementResult> {
  let command: AccessManagementCommand;
  try {
    command = copyAccessManagementCommand(input);
  } catch {
    return { ok: false, reason: 'invalid_command' };
  }
  try {
    if (!dependencies.actors || !dependencies.authorizer)
      return { ok: false, reason: 'access_management_denied' };
    const verified = await dependencies.actors.getVerifiedActor();
    if (!verified) return { ok: false, reason: 'access_management_denied' };
    const actor = Object.freeze({ userId: userId(verified.userId) });
    if ((await dependencies.authorizer.authorize(actor, command)) !== true)
      return { ok: false, reason: 'access_management_denied' };
    return await dependencies.store.execute(command, actor);
  } catch {
    return { ok: false, reason: 'access_management_unavailable' };
  }
}
