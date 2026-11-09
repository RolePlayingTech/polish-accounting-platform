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

function resolveRequestOrigin(request: NextRequest): string {
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

function buildCallbackFailureResponse(input: {
  readonly prefersJson: boolean;
  readonly requestOrigin: string;
  readonly status: number;
  readonly reasonCode: string;
  readonly messagePl: string;
  readonly loginAuthState: string;
}): NextResponse {
  const isSecure = shouldUseSecureSessionCookie(input.requestOrigin);
  if (input.prefersJson) {
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

  const loginUrl = new URL('/login', input.requestOrigin);
  loginUrl.searchParams.set('authState', input.loginAuthState);
  const res = NextResponse.redirect(loginUrl, {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
  clearSessionFromResponse(res, isSecure);
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestOrigin = resolveRequestOrigin(request);
  const prefersJson = (request.headers.get('accept') ?? '').includes('application/json');
  const url = new URL(request.url);

  const oauthError = url.searchParams.get('error');
  if (oauthError) {
    return buildCallbackFailureResponse({
      prefersJson,
      requestOrigin,
      status: 401,
      reasonCode: 'oidc_provider_denied',
      messagePl: 'Logowanie u dostawcy tożsamości OIDC zostało anulowane lub odrzucone.',
      loginAuthState: 'session_expired_or_invalid',
    });
  }

  const parsedQuery = OidcCallbackQuerySchema.safeParse({
    code: url.searchParams.get('code') ?? undefined,
    state: url.searchParams.get('state') ?? undefined,
  });
  if (!parsedQuery.success) {
    return buildCallbackFailureResponse({
      prefersJson,
      requestOrigin,
      status: 400,
      reasonCode: 'invalid_callback_parameters',
      messagePl: 'Brak wymaganych parametrów zwrotnych OIDC (code oraz state).',
      loginAuthState: 'session_expired_or_invalid',
    });
  }

  try {
    const config = loadWebOidcClientConfig();
    const stateHash = sha256Hex(parsedQuery.data.state);
    const flowCookie = request.cookies.get(OIDC_FLOW_COOKIE_NAME)?.value;

    // Ochrona przed Login CSRF: przeglądarka kończąca przepływ OIDC musi posiadać podpisane ciasteczko
    // HttpOnly wiążące sesję inicjującą PKCE ze skrótem SHA-256(state).
    if (!verifyOidcFlowBindingCookie(flowCookie, stateHash)) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 401,
        reasonCode: 'invalid_oidc_flow_binding',
        messagePl:
          'Niezgodność stanu bezpieczeństwa przepływu OIDC (brak lub błędne wiązanie przeglądarki ze state).',
        loginAuthState: 'session_expired_or_invalid',
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
      | { readonly ok: false; readonly reason: 'not_found' | 'already_consumed' | 'expired' }
    >('/oidc-state/consume', { stateHash });

    if (!consumed.ok) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 401,
        reasonCode:
          consumed.reason === 'already_consumed'
            ? 'oidc_state_replayed'
            : 'oidc_state_invalid_or_expired',
        messagePl:
          consumed.reason === 'already_consumed'
            ? 'Wykryto ponowne użycie jednorazowego stanu OIDC (replay) — żądanie odrzucone.'
            : 'Sesja logowania OIDC wygasła lub stan jest nieprawidłowy. Rozpocznij logowanie ponownie.',
        loginAuthState: 'session_expired_or_invalid',
      });
    }

    const flowPayload = decryptBffPayload<StoredOidcFlowPayload>(
      consumed.state.encryptedPayload,
      `oidc_state:${stateHash}`,
    );

    if (
      flowPayload.issuer !== config.issuer ||
      !config.allowedRedirectUris.includes(flowPayload.redirectUri)
    ) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 401,
        reasonCode: 'redirect_uri_or_issuer_mismatch',
        messagePl: 'Niezgodność wystawcy OIDC lub adresu zwrotnego redirect_uri.',
        loginAuthState: 'session_expired_or_invalid',
      });
    }

    const metadata = await resolveOidcProviderMetadata(config);
    const exchanged = await exchangeAuthorizationCode({
      code: parsedQuery.data.code,
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
        requestOrigin,
        status: 401,
        reasonCode: 'access_token_rejected',
        messagePl: 'Weryfikacja tokena dostępowego OIDC w rdzeniu API zakończyła się odmową.',
        loginAuthState: 'session_expired_or_invalid',
      });
    }

    if (meResp.kind !== 'ok') {
      const reasonCode =
        meResp.kind === 'forbidden'
          ? (meResp.reasonCode ?? 'forbidden')
          : 'authorization_validation_failed';
      const isNoMembership = reasonCode === 'identity_not_provisioned';
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 403,
        reasonCode: isNoMembership ? 'no_tenant_membership' : reasonCode,
        messagePl:
          meResp.message ??
          'Twoja tożsamość OIDC nie posiada aktywnego dostępu do platformy księgowej.',
        loginAuthState: isNoMembership ? 'no_tenant_membership' : 'insufficient_permissions',
      });
    }

    const resolvedActor = meResp.data.actor;
    const companies = meResp.data.companies ?? [];
    const primaryCompany = companies[0] ?? null;

    const displayName =
      exchanged.claims.displayName ??
      (resolvedActor.displayName && resolvedActor.displayName !== exchanged.claims.subject
        ? resolvedActor.displayName
        : (exchanged.claims.email ?? resolvedActor.displayName ?? 'Użytkownik OIDC'));
    const email = exchanged.claims.email ?? 'brak-adresu@oidc.invalid';

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
      tenantId: primaryCompany?.tenantId ?? null,
      legalEntityId: primaryCompany?.legalEntityId ?? null,
      period: DEFAULT_ACCOUNTING_PERIOD,
      encryptedTokens,
      accessTokenExpiresAt: exchanged.accessTokenExpiresAt.toISOString(),
      expiresAt: sessionExpiresAt.toISOString(),
    });

    if (!created.ok) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 403,
        reasonCode: 'inactive_user_account',
        messagePl: 'Konto użytkownika jest nieaktywne lub tożsamość OIDC została cofnięta.',
        loginAuthState: 'insufficient_permissions',
      });
    }

    const safeReturnTo = sanitizeInternalRedirect(flowPayload.returnTo, '/app', requestOrigin);

    if (prefersJson) {
      const response = NextResponse.json(
        {
          ok: true,
          redirectTo: safeReturnTo,
          user: {
            userId: resolvedActor.userId,
            displayName,
            email,
            hasTenantMembership: Boolean(primaryCompany),
            tenantId: primaryCompany?.tenantId ?? null,
            legalEntityId: primaryCompany?.legalEntityId ?? null,
          },
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
      writeOpaqueBffSessionCookie(response, sessionId, requestOrigin, BFF_SESSION_TTL_SECONDS);
      return response;
    }

    const redirectTarget = new URL(safeReturnTo, requestOrigin);
    const response = NextResponse.redirect(redirectTarget, {
      status: 303,
      headers: { 'Cache-Control': 'no-store' },
    });
    writeOpaqueBffSessionCookie(response, sessionId, requestOrigin, BFF_SESSION_TTL_SECONDS);
    return response;
  } catch (err) {
    if (err instanceof OidcConfigurationError || err instanceof OidcServiceUnavailableError) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: 503,
        reasonCode: 'auth_service_unavailable',
        messagePl: err.message,
        loginAuthState: 'auth_service_unavailable',
      });
    }
    if (err instanceof OidcSecurityValidationError) {
      return buildCallbackFailureResponse({
        prefersJson,
        requestOrigin,
        status: err.statusCode,
        reasonCode: err.reasonCode,
        messagePl: err.message,
        loginAuthState: 'session_expired_or_invalid',
      });
    }
    return buildCallbackFailureResponse({
      prefersJson,
      requestOrigin,
      status: 503,
      reasonCode: 'auth_service_unavailable',
      messagePl: 'Wystąpił błąd podczas finalizacji logowania OIDC (tryb fail-closed).',
      loginAuthState: 'auth_service_unavailable',
    });
  }
}
