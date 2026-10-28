import {
  legalEntityId,
  tenantId,
  userId,
  type AccountingAction,
  type LegalEntityId,
  type TenantId,
  type UserId,
} from '@pap/domain';

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
