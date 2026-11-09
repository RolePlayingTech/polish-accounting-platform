import { NextResponse, type NextRequest } from 'next/server';
import {
  OidcConfigurationError,
  OidcSecurityValidationError,
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  refreshBffSessionTokens,
  sha256Hex,
  type SerializedBffSessionRecord,
} from '../../../../lib/oidc-client';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import { shouldUseSecureSessionCookie } from '../../../../lib/runtime-mode';
import {
  BFF_SESSION_COOKIE_NAME,
  clearSessionFromResponse,
} from '../../../../lib/session';

const OPAQUE_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  const isSecure = shouldUseSecureSessionCookie(request.url);
  const rawSessionId = request.cookies.get(BFF_SESSION_COOKIE_NAME)?.value?.trim();
  if (!rawSessionId || !OPAQUE_SESSION_ID_REGEX.test(rawSessionId)) {
    const res = NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Brak aktywnej sesji OIDC BFF do odświeżenia.',
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
    clearSessionFromResponse(res, isSecure);
    return res;
  }

  try {
    const sessionIdHash = sha256Hex(rawSessionId);
    const lookup = await callApiBffSessionRpc<
      | { readonly ok: true; readonly session: SerializedBffSessionRecord }
      | { readonly ok: false; readonly reason: string }
    >('/session/get', { sessionIdHash });

    if (!lookup.ok) {
      const res = NextResponse.json(
        {
          ok: false,
          reasonCode: lookup.reason,
          error: 'Sesja BFF wygasła lub została unieważniona.',
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
      clearSessionFromResponse(res, isSecure);
      return res;
    }

    const refreshed = await refreshBffSessionTokens({
      session: lookup.session,
    });

    if (!refreshed.ok) {
      const res = NextResponse.json(
        {
          ok: false,
          reasonCode: refreshed.reason,
          error: 'Odświeżenie sesji OIDC zakończyło się odmową — zaloguj się ponownie.',
        },
        { status: 401, headers: { 'Cache-Control': 'no-store' } },
      );
      clearSessionFromResponse(res, isSecure);
      return res;
    }

    return NextResponse.json(
      {
        ok: true,
        accessTokenExpiresAt: refreshed.session.accessTokenExpiresAt,
        refreshGeneration: refreshed.session.refreshGeneration,
        alreadyAdvanced: refreshed.alreadyAdvanced,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    if (err instanceof OidcConfigurationError || err instanceof OidcServiceUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: 'auth_service_unavailable',
          error: err.message,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (err instanceof OidcSecurityValidationError) {
      const res = NextResponse.json(
        {
          ok: false,
          reasonCode: err.reasonCode,
          error: err.message,
        },
        { status: err.statusCode, headers: { 'Cache-Control': 'no-store' } },
      );
      clearSessionFromResponse(res, isSecure);
      return res;
    }
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'auth_service_unavailable',
        error: 'Nie udało się odświeżyć sesji OIDC BFF (tryb fail-closed).',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
