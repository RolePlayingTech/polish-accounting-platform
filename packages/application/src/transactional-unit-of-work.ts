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
      readonly status: 'unauthenticated' | 'forbidden' | 'invalid_selector';
      readonly reason:
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
export async function executeAuthorizedCompanyAction<
  TOutput,
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
>(
  input: AuthenticatedCompanyActionInput,
  dependencies: ExecuteAuthorizedCompanyActionDependencies<TTx>,
  operation: (context: AuthenticatedCompanyActionContext, tx: TTx) => Promise<TOutput>,
): Promise<ExecuteAuthorizedCompanyActionResult<TOutput>> {
  let parsedTenantId: TenantId;
  let parsedLegalEntityId: LegalEntityId;
  try {
    if (input.action !== 'read' && input.action !== 'write') {
      throw new Error('Niepoprawna akcja księgowa.');
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
    input.rawBearerToken,
    {
      verifier: dependencies.verifier,
      identityResolver: dependencies.identityResolver,
    },
    input.requiredScopes ? { requiredScopes: input.requiredScopes } : undefined,
  );

  if (!actor.authenticated) {
    return {
      allowed: false,
      status: actor.status,
      reason: actor.reason,
    };
  }

  try {
    const txActor = freezeTransactionActor({
      userId: actor.userId,
      identity: actor.identity,
    });

    return await dependencies.unitOfWork.runCompanyActionInTransaction(
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
          action: input.action,
        });

        const facts = await tx.getLockedFacts(query);
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
            actorUserId: txActor.userId,
            tenantId: parsedTenantId,
            legalEntityId: parsedLegalEntityId,
          });
        }

        const context: AuthenticatedCompanyActionContext = Object.freeze({
          userId: txActor.userId,
          tenantId: parsedTenantId,
          legalEntityId: parsedLegalEntityId,
          action: input.action,
          identity: actor.identity,
        });

        const data = await operation(context, tx);
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
  } catch {
    return {
      allowed: false,
      status: 'forbidden',
      reason: 'authorization_data_unavailable',
    };
  }
}
