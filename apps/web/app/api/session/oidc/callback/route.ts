import { NextResponse, type NextRequest } from 'next/server';
import { OidcCallbackQuerySchema } from '@pap/contracts';
import { papBffFetch } from '../../../../../lib/api-url';
import {
  OidcConfigurationError,
  OidcSecurityValidationError,
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  decryptBffPayload,
  encryptBffPayload,
  exchangeAuthorizationCode,
  generateOpaqueSessionId,
  loadWebOidcClientConfig,
  resolveOidcProviderMetadata,
  sha256Hex,
  verifyOidcFlowBindingCookie,
  type SerializedBffSessionRecord,
  type StoredBffTokenBundle,
  type StoredOidcFlowPayload,
} from '../../../../../lib/oidc-client';
import { sanitizeInternalRedirect } from '../../../../../lib/request-security';
import {
  OIDC_FLOW_COOKIE_NAME,
  clearSessionFromResponse,
  writeOpaqueBffSessionCookie,
} from '../../../../../lib/session';
import { shouldUseSecureSessionCookie } from '../../../../../lib/runtime-mode';
import { DEFAULT_ACCOUNTING_PERIOD } from '../../../../../lib/synthetic-workspace';

const BFF_SESSION_TTL_SECONDS = 60 * 60 * 8;

interface MeCompaniesRemoteResponse {
  readonly actor: {
    readonly userId: string;
    readonly issuer: string;
    readonly subject: string;
    readonly displayName: string;
  };
  readonly companies: readonly {
    readonly tenantId: string;
    readonly legalEntityId: string;
    readonly companyName: string;
  }[];
}

function resolveCandidateRequestOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const hostHeader = request.headers.get('host')?.trim().toLowerCase();

  const protocol =
    forwardedProto === 'https' || forwardedProto === 'http' ? `${forwardedProto}:` : url.protocol;
  const host = forwardedHost || hostHeader || url.host;
  return `${protocol}//${host}`;
}

function buildUntrustedOriginFailureResponse(): NextResponse {
  const isSecure = shouldUseSecureSessionCookie();
  const res = NextResponse.json(
    {
      ok: false,
      reasonCode: 'untrusted_request_origin',
      error:
        'Odrzucono callback OIDC dla niezaufanego nagłówka Host / X-Forwarded-Host / X-Forwarded-Proto.',
    },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
  clearSessionFromResponse(res, isSecure);
  return res;
}

function buildCallbackFailureResponse(input: {
  readonly prefersJson: boolean;
  readonly trustedOrigin: string | null;
  readonly status: number;
  readonly reasonCode: string;
  readonly messagePl: string;
  readonly loginAuthState: string;
}): NextResponse {
  const isSecure = shouldUseSecureSessionCookie(input.trustedOrigin ?? undefined);
  if (input.prefersJson || !input.trustedOrigin) {
    const res = NextResponse.json(
      {
        ok: false,
        reasonCode: input.reasonCode,
        error: input.messagePl,
      },
      { status: input.status, headers: { 'Cache-Control': 'no-store' } },
    );
    clearSessionFromResponse(res, isSecure);
    return res;
  }

  const loginUrl = new URL('/login', input.trustedOrigin);
  loginUrl.searchParams.set('authState', input.loginAuthState);
  const res = NextResponse.redirect(loginUrl, {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
  clearSessionFromResponse(res, isSecure);
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const prefersJson = (request.headers.get('accept') ?? '').includes('application/json');
  const candidateOrigin = resolveCandidateRequestOrigin(request);
  let trustedOrigin: string | null = null;

  try {
    const config = loadWebOidcClientConfig();
    const allowedOrigins = new Set<string>();
    for (const allowedUri of config.allowedRedirectUris) {
      allowedOrigins.add(new URL(allowedUri).origin);
    }

    let normalizedCandidate: string;
    try {
      normalizedCandidate = new URL(candidateOrigin).origin;
    } catch {
      return buildUntrustedOriginFailureResponse();
    }

    if (!allowedOrigins.has(normalizedCandidate)) {
      return buildUntrustedOriginFailureResponse();
    }
    trustedOrigin = normalizedCandidate;

    const url = new URL(request.url);
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode: 'oidc_provider_denied',
        messagePl: 'Logowanie u dostawcy tożsamości OIDC zostało anulowane lub odrzucone.',
        loginAuthState: 'oidc_denied_or_cancelled',
      });
    }

    const parsedQuery = OidcCallbackQuerySchema.safeParse({
      code: url.searchParams.get('code') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
    });
    const authCode = parsedQuery.success ? parsedQuery.data.code : undefined;
    const authState = parsedQuery.success ? parsedQuery.data.state : undefined;
    if (!parsedQuery.success || !authCode || !authState) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 400,
        reasonCode: 'invalid_callback_parameters',
        messagePl: 'Brak wymaganych parametrów zwrotnych OIDC (code oraz state).',
        loginAuthState: 'invalid_callback_state',
      });
    }

    const stateHash = sha256Hex(authState);
    const flowCookie = request.cookies.get(OIDC_FLOW_COOKIE_NAME)?.value;

    // Ochrona przed Login CSRF: przeglądarka kończąca przepływ OIDC musi posiadać podpisane ciasteczko
    // HttpOnly wiążące sesję inicjującą PKCE ze skrótem SHA-256(state).
    if (!verifyOidcFlowBindingCookie(flowCookie, stateHash)) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode: 'invalid_oidc_flow_binding',
        messagePl:
          'Niezgodność stanu bezpieczeństwa przepływu OIDC (brak lub błędne wiązanie przeglądarki ze state).',
        loginAuthState: 'invalid_callback_state',
      });
    }

    const consumed = await callApiBffSessionRpc<
      | {
          readonly ok: true;
          readonly state: {
            readonly stateHash: string;
            readonly encryptedPayload: string;
            readonly expiresAt: string;
          };
        }
      | {
          readonly ok: false;
          readonly reason:
            | 'invalid_state_hash'
            | 'state_not_found'
            | 'state_already_consumed'
            | 'state_expired';
        }
    >('/oidc-state/consume', { stateHash });

    if (!consumed.ok) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode:
          consumed.reason === 'state_already_consumed'
            ? 'oidc_state_replayed'
            : 'oidc_state_invalid_or_expired',
        messagePl:
          consumed.reason === 'state_already_consumed'
            ? 'Wykryto ponowne użycie jednorazowego stanu OIDC (replay) — żądanie odrzucone.'
            : 'Sesja logowania OIDC wygasła lub stan jest nieprawidłowy. Rozpocznij logowanie ponownie.',
        loginAuthState: 'invalid_callback_state',
      });
    }

    const flowPayload = decryptBffPayload<StoredOidcFlowPayload>(
      consumed.state.encryptedPayload,
      `oidc_state:${stateHash}`,
    );

    let flowRedirectOrigin: string;
    try {
      flowRedirectOrigin = new URL(flowPayload.redirectUri).origin;
    } catch {
      flowRedirectOrigin = '';
    }

    if (
      flowPayload.issuer !== config.issuer ||
      !config.allowedRedirectUris.includes(flowPayload.redirectUri) ||
      flowRedirectOrigin !== trustedOrigin
    ) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode: 'redirect_uri_or_issuer_mismatch',
        messagePl: 'Niezgodność wystawcy OIDC lub adresu zwrotnego redirect_uri.',
        loginAuthState: 'invalid_callback_state',
      });
    }

    const metadata = await resolveOidcProviderMetadata(config);
    const exchanged = await exchangeAuthorizationCode({
      code: authCode,
      codeVerifier: flowPayload.codeVerifier,
      redirectUri: flowPayload.redirectUri,
      expectedNonce: flowPayload.nonce,
      config,
      metadata,
    });

    const meResp = await papBffFetch<MeCompaniesRemoteResponse>('/api/v1/me/companies', {
      method: 'GET',
      bearerToken: exchanged.accessToken,
    });

    if (meResp.kind === 'unavailable' || meResp.kind === 'server_error') {
      throw new OidcServiceUnavailableError(
        'Usługa autoryzacji rdzenia API jest chwilowo niedostępna (tryb fail-closed).',
      );
    }

    if (meResp.kind === 'unauthorized') {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode: 'access_token_rejected',
        messagePl: 'Weryfikacja tokena dostępowego OIDC w rdzeniu API zakończyła się odmową.',
        loginAuthState: 'session_expired_or_invalid',
      });
    }

    let resolvedActor: MeCompaniesRemoteResponse['actor'];
    let companies: MeCompaniesRemoteResponse['companies'] = [];

    if (meResp.kind === 'ok') {
      resolvedActor = meResp.data.actor;
      companies = meResp.data.companies ?? [];
    } else if (meResp.kind === 'forbidden' && meResp.reasonCode === 'identity_not_provisioned') {
      const ensured = await callApiBffSessionRpc<
        | {
            readonly ok: true;
            readonly userId: string;
            readonly issuer: string;
            readonly subject: string;
            readonly profile: { readonly displayName: string; readonly email: string };
          }
        | { readonly ok: false; readonly reason: string }
      >('/identity/ensure', {
        accessToken: exchanged.accessToken,
        ...(exchanged.claims.displayName ? { displayName: exchanged.claims.displayName } : {}),
        ...(exchanged.claims.email ? { email: exchanged.claims.email } : {}),
      });

      if (!ensured.ok) {
        return buildCallbackFailureResponse({
          prefersJson,
          trustedOrigin,
          status: 403,
          reasonCode: 'inactive_user_account',
          messagePl: 'Konto użytkownika jest nieaktywne lub tożsamość OIDC została cofnięta.',
          loginAuthState: 'insufficient_permissions',
        });
      }

      resolvedActor = {
        userId: ensured.userId,
        issuer: ensured.issuer,
        subject: ensured.subject,
        displayName: ensured.profile.displayName,
      };
      companies = [];
    } else {
      const reasonCode =
        meResp.kind === 'forbidden'
          ? (meResp.reasonCode ?? 'forbidden')
          : 'authorization_validation_failed';
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 403,
        reasonCode,
        messagePl:
          meResp.message ??
          'Twoja tożsamość OIDC nie posiada aktywnego dostępu do platformy księgowej.',
        loginAuthState: 'insufficient_permissions',
      });
    }

    if (
      typeof resolvedActor?.userId !== 'string' ||
      resolvedActor.userId.trim().length === 0 ||
      resolvedActor.issuer !== exchanged.claims.issuer ||
      resolvedActor.subject !== exchanged.claims.subject
    ) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 401,
        reasonCode: 'token_actor_mismatch',
        messagePl:
          'Niezgodność tożsamości (issuer, subject) między id_token a zweryfikowanym tokenem dostępowym API.',
        loginAuthState: 'session_expired_or_invalid',
      });
    }

    const primaryCompany = companies[0] ?? null;

    let sessionTenantId: string | null = primaryCompany?.tenantId ?? null;
    let sessionProfileEmail: string | undefined;
    if (!primaryCompany || !exchanged.claims.email) {
      const meSessionResp = await papBffFetch<{
        readonly state: string;
        readonly userId: string;
        readonly issuer: string;
        readonly subject: string;
        readonly email: string;
        readonly tenantId: string | null;
        readonly memberships: readonly {
          readonly tenantId: string;
          readonly status: string;
        }[];
      }>('/api/v1/me/session', {
        method: 'GET',
        bearerToken: exchanged.accessToken,
      });

      if (meSessionResp.kind === 'unavailable' || meSessionResp.kind === 'server_error') {
        throw new OidcServiceUnavailableError(
          'Usługa sesji i tożsamości rdzenia API jest chwilowo niedostępna (tryb fail-closed).',
        );
      }
      if (meSessionResp.kind === 'unauthorized') {
        return buildCallbackFailureResponse({
          prefersJson,
          trustedOrigin,
          status: 401,
          reasonCode: 'access_token_rejected',
          messagePl: 'Weryfikacja tokena dostępowego OIDC w rdzeniu API zakończyła się odmową.',
          loginAuthState: 'session_expired_or_invalid',
        });
      }
      if (meSessionResp.kind === 'forbidden') {
        return buildCallbackFailureResponse({
          prefersJson,
          trustedOrigin,
          status: 403,
          reasonCode: meSessionResp.reasonCode ?? 'forbidden',
          messagePl:
            meSessionResp.message ??
            'Twoja tożsamość OIDC nie posiada aktywnego dostępu do platformy księgowej.',
          loginAuthState: 'insufficient_permissions',
        });
      }
      if (meSessionResp.kind === 'ok') {
        if (
          meSessionResp.data.userId !== resolvedActor.userId ||
          meSessionResp.data.issuer !== exchanged.claims.issuer ||
          meSessionResp.data.subject !== exchanged.claims.subject
        ) {
          return buildCallbackFailureResponse({
            prefersJson,
            trustedOrigin,
            status: 401,
            reasonCode: 'token_actor_mismatch',
            messagePl:
              'Niezgodność tożsamości (issuer, subject) między id_token a widokiem sesji API.',
            loginAuthState: 'session_expired_or_invalid',
          });
        }
        if (!sessionTenantId && meSessionResp.data.state === 'authenticated') {
          const activeMembership = meSessionResp.data.memberships.find(
            (m) => m.status === 'active',
          );
          sessionTenantId = meSessionResp.data.tenantId ?? activeMembership?.tenantId ?? null;
        }
        if (
          typeof meSessionResp.data.email === 'string' &&
          !meSessionResp.data.email.includes('***@') &&
          !meSessionResp.data.email.endsWith('@oidc.invalid')
        ) {
          sessionProfileEmail = meSessionResp.data.email;
        }
      }
    }

    const displayName =
      exchanged.claims.displayName ??
      (resolvedActor.displayName && resolvedActor.displayName !== exchanged.claims.subject
        ? resolvedActor.displayName
        : (exchanged.claims.email ??
          sessionProfileEmail ??
          resolvedActor.displayName ??
          'Użytkownik OIDC'));
    const email = exchanged.claims.email ?? sessionProfileEmail ?? 'brak-adresu@oidc.invalid';

    const { sessionId, sessionIdHash } = generateOpaqueSessionId();
    const tokenBundle: StoredBffTokenBundle = {
      accessToken: exchanged.accessToken,
      ...(exchanged.refreshToken ? { refreshToken: exchanged.refreshToken } : {}),
      idToken: exchanged.idToken,
      ...(exchanged.scope ? { scope: exchanged.scope } : {}),
    };
    const encryptedTokens = encryptBffPayload(tokenBundle, `bff_session:${sessionIdHash}`);
    const sessionExpiresAt = new Date(Date.now() + BFF_SESSION_TTL_SECONDS * 1000);

    const created = await callApiBffSessionRpc<
      | { readonly ok: true; readonly session: SerializedBffSessionRecord }
      | { readonly ok: false; readonly reason: string }
    >('/session/create', {
      sessionIdHash,
      userId: resolvedActor.userId,
      issuer: exchanged.claims.issuer,
      subject: exchanged.claims.subject,
      displayName,
      email,
      tenantId: sessionTenantId,
      legalEntityId: primaryCompany?.legalEntityId ?? null,
      period: DEFAULT_ACCOUNTING_PERIOD,
      encryptedTokens,
      accessTokenExpiresAt: exchanged.accessTokenExpiresAt.toISOString(),
      expiresAt: sessionExpiresAt.toISOString(),
    });

    if (!created.ok) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 403,
        reasonCode: 'inactive_user_account',
        messagePl: 'Konto użytkownika jest nieaktywne lub tożsamość OIDC została cofnięta.',
        loginAuthState: 'insufficient_permissions',
      });
    }

    const safeReturnTo = sanitizeInternalRedirect(flowPayload.returnTo, '/app', trustedOrigin);

    if (prefersJson) {
      const response = NextResponse.json(
        {
          ok: true,
          redirectTo: safeReturnTo,
          user: {
            userId: resolvedActor.userId,
            displayName,
            email,
            hasTenantMembership: Boolean(sessionTenantId),
            tenantId: sessionTenantId,
            legalEntityId: primaryCompany?.legalEntityId ?? null,
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
      writeOpaqueBffSessionCookie(response, sessionId, trustedOrigin, BFF_SESSION_TTL_SECONDS);
      return response;
    }

    const redirectTarget = new URL(safeReturnTo, trustedOrigin);
    const response = NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: { 'Cache-Control': 'no-store' },
    });
    writeOpaqueBffSessionCookie(response, sessionId, trustedOrigin, BFF_SESSION_TTL_SECONDS);
    return response;
  } catch (err) {
    if (err instanceof OidcConfigurationError || err instanceof OidcServiceUnavailableError) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: 503,
        reasonCode: 'auth_service_unavailable',
        messagePl: err.message,
        loginAuthState: 'auth_service_unavailable',
      });
    }
    if (err instanceof OidcSecurityValidationError) {
      return buildCallbackFailureResponse({
        prefersJson,
        trustedOrigin,
        status: err.statusCode,
        reasonCode: err.reasonCode,
        messagePl: err.message,
        loginAuthState: 'session_expired_or_invalid',
      });
    }
    return buildCallbackFailureResponse({
      prefersJson,
      trustedOrigin,
      status: 503,
      reasonCode: 'auth_service_unavailable',
      messagePl: 'Wystąpił błąd podczas finalizacji logowania OIDC (tryb fail-closed).',
      loginAuthState: 'auth_service_unavailable',
    });
  }
}
