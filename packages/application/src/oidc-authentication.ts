import {
  legalEntityId,
  tenantId,
  userId,
  type AccountingAction,
  type LegalEntityId,
  type TenantId,
  type UserId,
} from '@pap/domain';
import {
  authorizeCompanyAction,
  systemClock,
  type Clock,
  type TenantAuthorizationDataSource,
  type TenantAuthorizationResult,
} from './tenant-authorization.js';

/**
 * Zweryfikowana tożsamość OIDC utworzona wyłącznie przez serwerowy adapter po pełnej weryfikacji kryptograficznej.
 * Para (issuer, subject) jednoznacznie identyfikuje zewnętrznego aktora; subject jest case-sensitive.
 */
export interface VerifiedOidcIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly tokenId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly scopes?: readonly string[] | undefined;
  readonly issuedAt?: Date | undefined;
  readonly expiresAt?: Date | undefined;
}

/**
 * Port mapowania zweryfikowanej tożsamości OIDC na wewnętrzny identyfikator użytkownika.
 * Zwraca null przy braku mapowania, wyłączonym koncie lub cofniętym powiązaniu tożsamości.
 */
export interface UserIdentityResolver {
  resolveVerifiedIdentity(
    identity: VerifiedOidcIdentity,
  ): Promise<{ readonly userId: UserId } | null>;
}

export type OidcTokenFailureReason =
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_signature'
  | 'unsupported_algorithm'
  | 'untrusted_key_header'
  | 'unknown_key'
  | 'jwks_unavailable'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'invalid_authorized_party'
  | 'invalid_token_type'
  | 'token_expired'
  | 'token_not_yet_valid'
  | 'invalid_issued_at'
  | 'missing_required_claim'
  | 'insufficient_scope'
  | 'subject_revoked_or_disabled'
  | 'oidc_configuration_unavailable';

export type OidcTokenVerificationResult =
  | { readonly ok: true; readonly identity: VerifiedOidcIdentity }
  | { readonly ok: false; readonly reason: OidcTokenFailureReason };

export interface OidcAccessTokenVerifier {
  verifyAccessToken(
    rawBearerToken: string,
    options?: { readonly requiredScopes?: readonly string[] | undefined },
  ): Promise<OidcTokenVerificationResult>;
}

export type AuthenticationFailureReason =
  | OidcTokenFailureReason
  | 'oidc_verification_unavailable'
  | 'identity_not_provisioned_or_disabled'
  | 'identity_resolution_unavailable';

export type AuthenticatedActorResult =
  | {
      readonly authenticated: true;
      readonly userId: UserId;
      readonly identity: VerifiedOidcIdentity;
    }
  | {
      readonly authenticated: false;
      readonly status: 'unauthenticated' | 'forbidden';
      readonly reason: AuthenticationFailureReason;
    };

export interface AuthenticateOidcActorDependencies {
  readonly verifier: OidcAccessTokenVerifier;
  readonly identityResolver: UserIdentityResolver;
}

function isNonBlankExactString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/**
 * Weryfikuje token OIDC i rozwiązuje wewnętrzny userId z autorytatywnego źródła.
 * Brak ważnego tokenu, brak mapowania, wyłączone konto lub awaria źródła zawsze skutkują odmową (fail-closed).
 */
export async function authenticateOidcActor(
  rawBearerToken: string | undefined | null,
  dependencies: AuthenticateOidcActorDependencies,
  options?: { readonly requiredScopes?: readonly string[] | undefined },
): Promise<AuthenticatedActorResult> {
  if (!isNonBlankExactString(rawBearerToken)) {
    return {
      authenticated: false,
      status: 'unauthenticated',
      reason: 'missing_token',
    };
  }

  let verification: OidcTokenVerificationResult;
  try {
    verification = await dependencies.verifier.verifyAccessToken(rawBearerToken, options);
  } catch {
    return {
      authenticated: false,
      status: 'unauthenticated',
      reason: 'oidc_verification_unavailable',
    };
  }

  if (!verification.ok) {
    return {
      authenticated: false,
      status: verification.reason === 'insufficient_scope' ? 'forbidden' : 'unauthenticated',
      reason: verification.reason,
    };
  }

  const { issuer, subject } = verification.identity;
  if (!isNonBlankExactString(issuer) || !isNonBlankExactString(subject)) {
    return {
      authenticated: false,
      status: 'unauthenticated',
      reason: 'missing_required_claim',
    };
  }

  try {
    const resolved = await dependencies.identityResolver.resolveVerifiedIdentity(
      Object.freeze({
        issuer,
        subject,
      }),
    );

    if (!resolved) {
      return {
        authenticated: false,
        status: 'forbidden',
        reason: 'identity_not_provisioned_or_disabled',
      };
    }

    const internalUserId = userId(resolved.userId);
    const frozenIdentity: VerifiedOidcIdentity = Object.freeze({
      ...verification.identity,
      issuer,
      subject,
      ...(verification.identity.scopes
        ? { scopes: Object.freeze([...verification.identity.scopes]) }
        : {}),
    });

    return Object.freeze({
      authenticated: true,
      userId: internalUserId,
      identity: frozenIdentity,
    });
  } catch {
    return {
      authenticated: false,
      status: 'forbidden',
      reason: 'identity_resolution_unavailable',
    };
  }
}

export interface AuthenticatedCompanyActionContext {
  readonly userId: UserId;
  readonly tenantId: TenantId;
  readonly legalEntityId: LegalEntityId;
  readonly action: AccountingAction;
  readonly identity: VerifiedOidcIdentity;
}

export interface AuthenticatedCompanyActionInput {
  readonly rawBearerToken: string | undefined | null;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly action: AccountingAction;
  readonly requiredScopes?: readonly string[] | undefined;
}

export interface AuthenticatedCompanyActionDependencies extends AuthenticateOidcActorDependencies {
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly clock?: Clock | undefined;
}

export type AuthenticatedCompanyActionResult =
  | {
      readonly allowed: true;
      readonly status: 'allowed';
      readonly reason: 'explicit_company_grant';
      readonly context: AuthenticatedCompanyActionContext;
    }
  | {
      readonly allowed: false;
      readonly status: 'unauthenticated' | 'forbidden' | 'invalid_selector';
      readonly reason:
        | AuthenticationFailureReason
        | Exclude<TenantAuthorizationResult, { readonly allowed: true }>['reason'];
    };

/**
 * Pełny serwerowy przepływ 6D-2:
 * Verified OIDC identity -> Internal userId -> TenantAuthorizationDataSource -> authorizeCompanyAction.
 * Selektory tenantId i legalEntityId służą wyłącznie do wskazania zasobu; userId pochodzi wyłącznie z serwera.
 */
export async function authorizeAuthenticatedCompanyAction(
  input: AuthenticatedCompanyActionInput,
  dependencies: AuthenticatedCompanyActionDependencies,
): Promise<AuthenticatedCompanyActionResult> {
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

  let parsedTenantId: TenantId;
  let parsedLegalEntityId: LegalEntityId;
  try {
    if (input.action !== 'read' && input.action !== 'write') {
      throw new Error('Invalid accounting action');
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

  const decision = await authorizeCompanyAction(
    dependencies.authorizationDataSource,
    {
      userId: actor.userId,
      tenantId: parsedTenantId,
      legalEntityId: parsedLegalEntityId,
      action: input.action,
    },
    dependencies.clock ?? systemClock,
  );

  if (!decision.allowed) {
    return {
      allowed: false,
      status: 'forbidden',
      reason: decision.reason,
    };
  }

  return Object.freeze({
    allowed: true,
    status: 'allowed',
    reason: decision.reason,
    context: Object.freeze({
      userId: actor.userId,
      tenantId: parsedTenantId,
      legalEntityId: parsedLegalEntityId,
      action: input.action,
      identity: actor.identity,
    }),
  });
}
