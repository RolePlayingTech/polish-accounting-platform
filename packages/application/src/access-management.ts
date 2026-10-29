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
  type VerifiedOidcIdentity,
} from './oidc-authentication.js';
import { systemClock, type Clock } from './tenant-authorization.js';
import {
  freezeTransactionActor,
  isConfirmedTransactionRollbackError,
  isTransactionOutcomeUnknownError,
  type TransactionActor,
  type TransactionEndResolution,
  type TransactionSessionContext,
} from './transactional-unit-of-work.js';
import {
  auditIdentifier,
  securityAuditReason,
  SecurityAuditUnavailableError,
  type SecurityAuditEvent,
} from './security-audit.js';

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
export interface AccessManagementActor extends TransactionActor {
  readonly userId: UserId;
  readonly identity?: VerifiedOidcIdentity | undefined;
}
export interface AccessManagementActorSource {
  getVerifiedActor(): Promise<AccessManagementActor | null>;
}
/** Osobne prawo administracyjne, nigdy wywnioskowane z księgowego read/write. */
export interface AccessManagementAuthorizer {
  authorize(
    actor: AccessManagementActor,
    command: AccessManagementCommand,
    transaction?: AccessManagementAuthorizationDataSource,
  ): Promise<boolean>;
}

export interface AccessManagementAuthorizationFacts {
  readonly actorMembership: TenantMembership | null;
  readonly actorGrants: readonly CompanyAccessGrant[];
  readonly targetMembership: TenantMembership | null;
  readonly targetGrant: {
    readonly legalEntityId: LegalEntityId;
    readonly action: AccountingAction;
  } | null;
  /**
   * Autorytatywny czas z zegara transakcyjnego DB pobrany PO uzyskaniu blokad (6D-3A).
   * Gdy jest obecny, polityka domenowa używa go zamiast zegara procesu aplikacji.
   */
  readonly now?: Date | undefined;
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
        | 'access_management_unavailable'
        | 'authorization_audit_unavailable'
        | 'transaction_outcome_unknown';
    };

/**
 * Kontekst pojedynczej transakcji DB dla operacji administracyjnej (6D-3A).
 * Łączy rewalidację konta aktora, pobranie zablokowanych faktów, decyzję, mutację i audyt.
 */
export interface AccessManagementTransaction extends AccessManagementAuthorizationDataSource {
  verifyActorAccount(actor: AccessManagementActor): Promise<boolean>;
  applySessionContext?(context: TransactionSessionContext): Promise<void>;
  executeAuthorized(
    command: AccessManagementCommand,
    actor: AccessManagementActor,
  ): Promise<AccessManagementResult>;
}

/**
 * Infrastruktura gwarantuje transakcyjne powiązanie autoryzacji z mutacją (runInTransaction),
 * wspólną blokadę faktów i członkostwa, idempotencję oraz atomowy audyt.
 * Wyjątek po potwierdzonym wycofaniu transakcji przed COMMIT powinien być opakowany w
 * `ConfirmedTransactionRollbackError`; niepotwierdzony wynik zakończenia transakcji rzuca
 * `TransactionOutcomeUnknownError`.
 */
export interface AccessManagementStore {
  recordDeniedDecision(event: SecurityAuditEvent): Promise<void>;
  runInTransaction(
    work: (tx: AccessManagementTransaction) => Promise<AccessManagementResult>,
  ): Promise<AccessManagementResult>;
  execute(
    command: AccessManagementCommand,
    actor: AccessManagementActor,
  ): Promise<AccessManagementResult>;
}

/**
 * Serwerowe źródło aktora administracyjnego powiązane z pełną weryfikacją OIDC i wewnętrznym resolverem tożsamości.
 * Zachowuje zweryfikowaną parę (issuer, subject) do ponownej weryfikacji wewnątrz transakcji DB.
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
      return freezeTransactionActor({
        userId: result.userId,
        identity: result.identity,
      });
    },
  };
}

/**
 * Serwerowy autoryzator administracyjny egzekwujący domenową politykę delegacji i zakaz self-escalation.
 * Gdy działa wewnątrz transakcji UnitOfWork (6D-3A), zawsze pobiera zablokowane fakty i zegar bezpośrednio
 * z bieżącej transakcji DB, eliminując okno TOCTOU.
 */
export function createTenantAccessManagementAuthorizer(
  fallbackSource?: AccessManagementAuthorizationDataSource,
  clock: Clock = systemClock,
): AccessManagementAuthorizer {
  return {
    async authorize(
      actor: AccessManagementActor,
      command: AccessManagementCommand,
      transaction?: AccessManagementAuthorizationDataSource,
    ): Promise<boolean> {
      let canonicalActor: AccessManagementActor;
      let canonicalCommand: AccessManagementCommand;
      try {
        canonicalActor = freezeTransactionActor(actor);
        canonicalCommand = copyAccessManagementCommand(command);
      } catch {
        return false;
      }

      const activeSource = transaction ?? fallbackSource;
      if (!activeSource) {
        return false;
      }

      const facts = await activeSource.getAuthorizationFacts(canonicalActor, canonicalCommand);
      const decisionTime = facts.now ?? clock.now();
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
        now: decisionTime,
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

async function manageAccessCore(
  input: AccessManagementCommand,
  dependencies: {
    readonly store: AccessManagementStore;
    readonly actors?: AccessManagementActorSource;
    readonly authorizer?: AccessManagementAuthorizer;
  },
  audit: {
    actorId: string | null;
    authorized: boolean;
    commitPhaseEntered: boolean;
    resolution: 'not_started' | TransactionEndResolution;
  },
): Promise<AccessManagementResult> {
  let command: AccessManagementCommand;
  try {
    command = copyAccessManagementCommand(input);
  } catch {
    return { ok: false, reason: 'invalid_command' };
  }
  try {
    const { actors, authorizer, store } = dependencies;
    if (!actors || !authorizer) return { ok: false, reason: 'access_management_denied' };
    const verified = await actors.getVerifiedActor();
    if (!verified) return { ok: false, reason: 'access_management_denied' };
    const actor = freezeTransactionActor(verified);
    audit.actorId = actor.userId;

    if (typeof store.runInTransaction === 'function') {
      const txResult = await store.runInTransaction(async (tx): Promise<AccessManagementResult> => {
        if ((await tx.verifyActorAccount(actor)) !== true) {
          return { ok: false, reason: 'access_management_denied' };
        }
        if ((await authorizer.authorize(actor, command, tx)) !== true) {
          return { ok: false, reason: 'access_management_denied' };
        }
        if (tx.applySessionContext) {
          await tx.applySessionContext({
            actorUserId: actor.userId,
            tenantId: command.tenantId,
            ...(command.kind === 'grant' ? { legalEntityId: command.legalEntityId } : {}),
          });
        }
        audit.authorized = true;
        const executionResult = await tx.executeAuthorized(command, actor);
        if (executionResult.ok) {
          audit.commitPhaseEntered = true;
        }
        return executionResult;
      });

      if (txResult.ok) {
        audit.resolution = 'committed';
        return txResult;
      }

      if (!audit.authorized) {
        return txResult;
      }

      if (audit.commitPhaseEntered || txResult.reason === 'transaction_outcome_unknown') {
        audit.resolution = 'outcome_unknown';
        return { ok: false, reason: 'transaction_outcome_unknown' };
      }

      audit.resolution = 'rolled_back';
      return txResult;
    }

    // Brak adaptera transakcyjnego nigdy nie uruchamia starej ścieżki check-then-write.
    return { ok: false, reason: 'access_management_unavailable' };
  } catch (error) {
    const rootError =
      isConfirmedTransactionRollbackError(error) || isTransactionOutcomeUnknownError(error)
        ? error.cause
        : error;

    if (!audit.authorized) {
      return {
        ok: false,
        reason:
          rootError instanceof SecurityAuditUnavailableError
            ? 'authorization_audit_unavailable'
            : 'access_management_unavailable',
      };
    }

    if (isConfirmedTransactionRollbackError(error)) {
      audit.resolution = 'rolled_back';
      return {
        ok: false,
        reason:
          error.cause instanceof SecurityAuditUnavailableError
            ? 'authorization_audit_unavailable'
            : 'access_management_unavailable',
      };
    }

    audit.resolution = 'outcome_unknown';
    return { ok: false, reason: 'transaction_outcome_unknown' };
  }
}

export async function manageAccess(
  input: AccessManagementCommand,
  dependencies: Parameters<typeof manageAccessCore>[1],
): Promise<AccessManagementResult> {
  // Metadane selektorów kopiujemy przed await; klient nigdy nie dostarcza actorId audytu.
  try {
    input = copyAccessManagementCommand(input);
  } catch {
    /* Core zwróci invalid_command. */
  }
  const tenant = auditIdentifier(input?.tenantId);
  const operation = auditIdentifier(input?.operationId);
  const target = auditIdentifier(input?.userId);
  const entity = input?.kind === 'grant' ? auditIdentifier(input.legalEntityId) : null;
  const action = ['revoke_membership', 'reactivate_membership', 'grant', 'revoke_grant'].includes(
    input?.kind,
  )
    ? input.kind
    : 'unknown';
  const audit = {
    actorId: null as string | null,
    authorized: false,
    commitPhaseEntered: false,
    resolution: 'not_started' as 'not_started' | TransactionEndResolution,
  };
  const result = await manageAccessCore(input, dependencies, audit);
  if (!result.ok) {
    if (
      audit.resolution === 'outcome_unknown' ||
      (audit.authorized && audit.resolution !== 'rolled_back')
    ) {
      try {
        await dependencies.store.recordDeniedDecision({
          requestId: operation,
          operationId: operation,
          actorId: audit.actorId,
          targetUserId: target,
          tenantId: tenant,
          legalEntityId: entity,
          action,
          kind: 'access',
          decision: 'allow',
          outcome: 'outcome_unknown',
          reason: 'transaction_outcome_unknown',
        });
      } catch {
        // Baza danych może być nadal niedostępna po utracie potwierdzenia COMMIT;
        // nie zastępujemy niepewności fałszywym rolled_back ani dostępem.
      }
      return { ok: false, reason: 'transaction_outcome_unknown' };
    }

    try {
      await dependencies.store.recordDeniedDecision({
        requestId: operation,
        operationId: operation,
        actorId: audit.actorId,
        targetUserId: target,
        tenantId: tenant,
        legalEntityId: entity,
        action,
        kind: 'access',
        decision: audit.authorized ? 'allow' : 'deny',
        outcome: audit.authorized ? 'rolled_back' : 'denied',
        reason: securityAuditReason(result.reason),
      });
    } catch {
      return { ok: false, reason: 'authorization_audit_unavailable' };
    }
  }
  return result;
}
