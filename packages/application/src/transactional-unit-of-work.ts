import {
  decideAccountingAccess,
  legalEntityId,
  tenantId,
  userId,
  type LegalEntityId,
  type TenantId,
  type UserId,
} from '@pap/domain';
import {
  authenticateOidcActor,
  type AuthenticatedCompanyActionContext,
  type AuthenticatedCompanyActionInput,
  type AuthenticationFailureReason,
  type AuthenticateOidcActorDependencies,
  type VerifiedOidcIdentity,
} from './oidc-authentication.js';
import type {
  TenantAuthorizationFacts,
  TenantAuthorizationQuery,
  TenantAuthorizationResult,
} from './tenant-authorization.js';
import {
  auditIdentifier,
  securityAuditReason,
  SecurityAuditUnavailableError,
  type SecurityAuditEvent,
} from './security-audit.js';

const CONFIRMED_ROLLBACK_BRAND = Symbol.for('pap.transaction.confirmed_rollback');
const OUTCOME_UNKNOWN_BRAND = Symbol.for('pap.transaction.outcome_unknown');

export type TransactionEndResolution = 'committed' | 'rolled_back' | 'outcome_unknown';
export type ConfirmedRollbackFailureReason =
  'authorization_audit_unavailable' | 'operation_conflict';

/**
 * Jawny dowód wycofania transakcji bazodanowej (potwierdzony ROLLBACK przed COMMIT
 * lub jawne odrzucenie COMMIT przez serwer PostgreSQL przed utrwaleniem transakcji).
 * Wyłącznie potwierdzony rollback uprawnia do zapisu śladu audytowego `allow/rolled_back`.
 */
export class ConfirmedTransactionRollbackError extends Error {
  readonly [CONFIRMED_ROLLBACK_BRAND] = true;

  constructor(
    override readonly cause?: unknown,
    readonly failureReason?: ConfirmedRollbackFailureReason | undefined,
  ) {
    super('Transakcja została wycofana z potwierdzeniem (ROLLBACK).');
    this.name = 'ConfirmedTransactionRollbackError';
  }
}

/**
 * Niepewny wynik zakończenia transakcji bazodanowej (np. utrata potwierdzenia po wysłaniu COMMIT
 * lub niepotwierdzony ROLLBACK przy zerwanym połączeniu). Nie wolno traktować tego stanu jako
 * potwierdzonego wycofania ani automatycznie ponawiać callbacku biznesowego.
 */
export class TransactionOutcomeUnknownError extends Error {
  readonly [OUTCOME_UNKNOWN_BRAND] = true;

  constructor(override readonly cause?: unknown) {
    super('Wynik zakończenia transakcji jest nieznany.');
    this.name = 'TransactionOutcomeUnknownError';
  }
}

export function isConfirmedTransactionRollbackError(
  error: unknown,
): error is ConfirmedTransactionRollbackError {
  return (
    typeof error === 'object' &&
    error !== null &&
    CONFIRMED_ROLLBACK_BRAND in error &&
    (error as { readonly [CONFIRMED_ROLLBACK_BRAND]?: unknown })[CONFIRMED_ROLLBACK_BRAND] === true
  );
}

export function isTransactionOutcomeUnknownError(
  error: unknown,
): error is TransactionOutcomeUnknownError {
  return (
    typeof error === 'object' &&
    error !== null &&
    OUTCOME_UNKNOWN_BRAND in error &&
    (error as { readonly [OUTCOME_UNKNOWN_BRAND]?: unknown })[OUTCOME_UNKNOWN_BRAND] === true
  );
}

function isNonBlankExactString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/**
 * Serwerowy aktor przekazywany do transakcji UnitOfWork po weryfikacji tokenu poza transakcją.
 */
export interface TransactionActor {
  readonly userId: UserId;
  /**
   * Opcjonalna zweryfikowana tożsamość OIDC. Gdy jest obecna, transakcja DB blokuje i potwierdza
   * także aktywność konkretnego powiązania (issuer, subject) w user_oidc_identity.
   */
  readonly identity?: VerifiedOidcIdentity | undefined;
}

/**
 * Waliduje i zamraża obiekt aktora przekazywany do warstwy transakcyjnej.
 * Rzuca błąd przy niepoprawnym UUID lub uszkodzonej parze (issuer, subject).
 */
export function freezeTransactionActor(input: TransactionActor): TransactionActor {
  const canonicalUserId = userId(input.userId);
  if (input.identity === undefined) {
    return Object.freeze({ userId: canonicalUserId });
  }

  const { issuer, subject } = input.identity;
  if (!isNonBlankExactString(issuer) || !isNonBlankExactString(subject)) {
    throw new Error('Niepoprawna tożsamość OIDC aktora.');
  }

  const frozenIdentity: VerifiedOidcIdentity = Object.freeze({
    ...input.identity,
    issuer,
    subject,
    ...(input.identity.scopes ? { scopes: Object.freeze([...input.identity.scopes]) } : {}),
  });

  return Object.freeze({
    userId: canonicalUserId,
    identity: frozenIdentity,
  });
}

/**
 * Kontekst sesji autoryzacyjnej wiązany z bieżącą transakcją bazodanową.
 * Punkt rozszerzenia pod transakcyjne SET LOCAL / set_config(..., true) dla PostgreSQL RLS w 6D-3B.
 * W 6D-3A przekazanie tego kontekstu nie oznacza jeszcze włączonych polityk RLS ani roli runtime DB.
 */
export interface TransactionSessionContext {
  readonly operationId?: string | undefined;
  readonly decisionAt?: string | undefined;
  readonly actorUserId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId?: LegalEntityId | undefined;
}

export interface LockedTenantAuthorizationFacts extends TenantAuthorizationFacts {
  /** Autorytatywny czas z zegara transakcyjnego DB pobrany PO uzyskaniu blokad wierszowych. */
  readonly now: Date;
}

/**
 * Kontekst pojedynczej otwartej transakcji dla operacji na danych firmy (odczyt/zapis dokumentów).
 */
export interface CompanyActionTransactionContext {
  /** Wymagany atomowy INSERT; błąd musi przerwać chronioną transakcję. */
  recordAuthorizationDecision(event: SecurityAuditEvent): Promise<void>;
  /** Sprawdza i blokuje aktualny stan konta app_user (oraz powiązania OIDC, gdy obecne). */
  verifyActorAccount(actor: TransactionActor): Promise<boolean>;

  /** Pobiera i blokuje w kanonicznym porządku członkostwo, firmę i granty oraz zegar DB po blokadach. */
  getLockedFacts(query: TenantAuthorizationQuery): Promise<LockedTenantAuthorizationFacts>;

  /** Opcjonalny hook wiążący kontekst tenanta/aktora ze zmiennymi lokalnymi transakcji (pod 6D-3B RLS). */
  applySessionContext?(context: TransactionSessionContext): Promise<void>;
}

/**
 * Port transakcyjnego UnitOfWork dla autoryzowanych operacji firmowych.
 */
export interface CompanyActionUnitOfWork<
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
> {
  /** Wykonywany dopiero PO rollbacku chronionej transakcji. */
  recordDeniedDecision(event: SecurityAuditEvent): Promise<void>;
  runCompanyActionInTransaction<TResult>(
    work: (tx: TTx) => Promise<TResult>,
    shouldCommit: (result: TResult) => boolean,
  ): Promise<TResult>;
}

export interface ExecuteAuthorizedCompanyActionDependencies<
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
> extends AuthenticateOidcActorDependencies {
  readonly unitOfWork: CompanyActionUnitOfWork<TTx>;
}

export type ExecuteAuthorizedCompanyActionResult<TOutput> =
  | {
      readonly allowed: true;
      readonly status: 'allowed';
      readonly reason: 'explicit_company_grant';
      readonly context: AuthenticatedCompanyActionContext;
      readonly data: TOutput;
    }
  | {
      readonly allowed: false;
      readonly status: 'unauthenticated' | 'forbidden' | 'invalid_selector' | 'unavailable';
      readonly reason:
        | 'authorization_audit_unavailable'
        | 'transaction_outcome_unknown'
        | AuthenticationFailureReason
        | Exclude<TenantAuthorizationResult, { readonly allowed: true }>['reason'];
    };

/**
 * Transakcyjny przepływ 6D-3A eliminujący okno TOCTOU dla odczytu i zapisu danych firmowych:
 * 1) Weryfikacja kryptograficzna OIDC i rozwiązanie userId poza transakcją (bez blokad na sieci JWKS).
 * 2) Jedna transakcja DB: blokada i rewalidacja app_user (+ user_oidc_identity), blokada członkostwa,
 *    firmy i grantów, zegar DB po blokadach, decyzja decideAccountingAccess, opcjonalny kontekst sesji
 *    pod przyszłe RLS oraz wykonanie operacji biznesowej przed COMMIT.
 */
async function executeAuthorizedCompanyActionCore<
  TOutput,
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
>(
  input: AuthenticatedCompanyActionInput,
  dependencies: ExecuteAuthorizedCompanyActionDependencies<TTx>,
  operation: (context: AuthenticatedCompanyActionContext, tx: TTx) => Promise<TOutput>,
  audit: {
    actorId: string | null;
    authorized: boolean;
    commitPhaseEntered: boolean;
    resolution: 'not_started' | TransactionEndResolution;
    decidedAt: string | undefined;
    event(
      decision: 'allow' | 'deny',
      outcome: SecurityAuditEvent['outcome'],
      reason: string,
    ): SecurityAuditEvent;
  },
): Promise<ExecuteAuthorizedCompanyActionResult<TOutput>> {
  let parsedTenantId: TenantId;
  let parsedLegalEntityId: LegalEntityId;
  // Kopia wszystkich selektorów przed pierwszym await, także akcji i zakresów.
  const action = input.action;
  const operationId = auditIdentifier(input.operationId);
  const rawBearerToken = input.rawBearerToken;
  const requiredScopes = input.requiredScopes
    ? Object.freeze([...input.requiredScopes])
    : undefined;
  try {
    if (action !== 'read' && action !== 'write') {
      throw new Error('Niepoprawna akcja księgowa.');
    }
    if (action === 'write' && operationId === null) {
      throw new Error('Zapis wymaga identyfikatora operacji.');
    }
    parsedTenantId = tenantId(input.tenantId);
    parsedLegalEntityId = legalEntityId(input.legalEntityId);
  } catch {
    return {
      allowed: false,
      status: 'invalid_selector',
      reason: 'authorization_context_invalid',
    };
  }

  const actor = await authenticateOidcActor(
    rawBearerToken,
    {
      verifier: dependencies.verifier,
      identityResolver: dependencies.identityResolver,
    },
    requiredScopes ? { requiredScopes } : undefined,
  );

  if (!actor.authenticated) {
    return {
      allowed: false,
      status: actor.status,
      reason: actor.reason,
    };
  }
  audit.actorId = actor.userId;

  try {
    const txActor = freezeTransactionActor({
      userId: actor.userId,
      identity: actor.identity,
    });

    const txResult = await dependencies.unitOfWork.runCompanyActionInTransaction(
      async (tx): Promise<ExecuteAuthorizedCompanyActionResult<TOutput>> => {
        if ((await tx.verifyActorAccount(txActor)) !== true) {
          return {
            allowed: false,
            status: 'forbidden',
            reason: 'identity_not_provisioned_or_disabled',
          };
        }

        const query: TenantAuthorizationQuery = Object.freeze({
          userId: txActor.userId,
          tenantId: parsedTenantId,
          legalEntityId: parsedLegalEntityId,
          action,
        });

        const facts = await tx.getLockedFacts(query);
        audit.decidedAt = facts.now.toISOString();
        const decision = decideAccountingAccess({
          ...query,
          membership: facts.membership,
          grants: facts.grants,
          now: facts.now,
        });

        if (!decision.allowed) {
          return {
            allowed: false,
            status: 'forbidden',
            reason: decision.reason,
          };
        }

        if (tx.applySessionContext) {
          await tx.applySessionContext({
            operationId: operationId ?? undefined,
            decisionAt: facts.now.toISOString(),
            actorUserId: txActor.userId,
            tenantId: parsedTenantId,
            legalEntityId: parsedLegalEntityId,
          });
        }

        const context: AuthenticatedCompanyActionContext = Object.freeze({
          operationId: operationId ?? undefined,
          decisionAt: facts.now.toISOString(),
          userId: txActor.userId,
          tenantId: parsedTenantId,
          legalEntityId: parsedLegalEntityId,
          action,
          identity: actor.identity,
        });

        audit.authorized = true;
        const data = await operation(context, tx);
        await tx.recordAuthorizationDecision(audit.event('allow', 'committed', decision.reason));
        audit.commitPhaseEntered = true;
        return Object.freeze({
          allowed: true,
          status: 'allowed',
          reason: decision.reason,
          context,
          data,
        });
      },
      (result) => result.allowed === true,
    );

    if (txResult.allowed) {
      audit.resolution = 'committed';
      return txResult;
    }

    if (audit.authorized) {
      // Po autoryzacji brak potwierdzonego rollbacku nie pozwala uznać operacji za wycofaną.
      audit.resolution = 'outcome_unknown';
      return {
        allowed: false,
        status: 'unavailable',
        reason: 'transaction_outcome_unknown',
      };
    }

    return txResult;
  } catch (error) {
    if (!audit.authorized) {
      const cause =
        isConfirmedTransactionRollbackError(error) || isTransactionOutcomeUnknownError(error)
          ? error.cause
          : error;
      return {
        allowed: false,
        status: isTransactionOutcomeUnknownError(error) ? 'unavailable' : 'forbidden',
        reason:
          cause instanceof SecurityAuditUnavailableError
            ? 'authorization_audit_unavailable'
            : 'authorization_data_unavailable',
      };
    }

    if (isConfirmedTransactionRollbackError(error)) {
      audit.resolution = 'rolled_back';
      return {
        allowed: false,
        status: 'forbidden',
        reason:
          error.failureReason === 'authorization_audit_unavailable' ||
          error.cause instanceof SecurityAuditUnavailableError
            ? 'authorization_audit_unavailable'
            : 'authorization_data_unavailable',
      };
    }

    audit.resolution = 'outcome_unknown';
    return {
      allowed: false,
      status: 'unavailable',
      reason: 'transaction_outcome_unknown',
    };
  }
}

/** Pełna granica bezpieczeństwa: sukces z audytem w TX, odmowa po jej rollbacku. */
export async function executeAuthorizedCompanyAction<
  TOutput,
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
>(
  input: AuthenticatedCompanyActionInput,
  dependencies: ExecuteAuthorizedCompanyActionDependencies<TTx>,
  operation: (context: AuthenticatedCompanyActionContext, tx: TTx) => Promise<TOutput>,
): Promise<ExecuteAuthorizedCompanyActionResult<TOutput>> {
  const snapshot = {
    ...input,
    requiredScopes: input.requiredScopes ? [...input.requiredScopes] : undefined,
  };
  const audit = {
    actorId: null as string | null,
    authorized: false,
    commitPhaseEntered: false,
    resolution: 'not_started' as 'not_started' | TransactionEndResolution,
    decidedAt: undefined as string | undefined,
    event(
      decision: 'allow' | 'deny',
      outcome: SecurityAuditEvent['outcome'],
      reason: string,
    ): SecurityAuditEvent {
      return {
        requestId: auditIdentifier(snapshot.requestId),
        operationId: auditIdentifier(snapshot.operationId),
        actorId: this.actorId,
        tenantId: auditIdentifier(snapshot.tenantId),
        legalEntityId: auditIdentifier(snapshot.legalEntityId),
        action:
          snapshot.action === 'read' || snapshot.action === 'write' ? snapshot.action : 'unknown',
        kind: 'company',
        decision,
        outcome,
        reason: securityAuditReason(reason),
        ...(this.decidedAt ? { decidedAt: this.decidedAt } : {}),
      };
    },
  };
  const result = await executeAuthorizedCompanyActionCore(snapshot, dependencies, operation, audit);
  if (!result.allowed) {
    if (audit.resolution === 'outcome_unknown') {
      try {
        await dependencies.unitOfWork.recordDeniedDecision(
          audit.event('allow', 'outcome_unknown', 'transaction_outcome_unknown'),
        );
      } catch {
        // Przy utracie połączenia po COMMIT baza może pozostać chwilowo niedostępna;
        // zachowujemy fail-closed status `unavailable` / `transaction_outcome_unknown`
        // bez tworzenia fałszywego śladu `rolled_back`.
      }
      return result;
    }

    try {
      await dependencies.unitOfWork.recordDeniedDecision(
        audit.event(
          audit.resolution === 'rolled_back' ? 'allow' : 'deny',
          audit.resolution === 'rolled_back' ? 'rolled_back' : 'denied',
          audit.resolution === 'rolled_back' && result.reason !== 'authorization_audit_unavailable'
            ? 'operation_failed'
            : result.reason,
        ),
      );
    } catch {
      return { allowed: false, status: 'forbidden', reason: 'authorization_audit_unavailable' };
    }
  }
  return result;
}
