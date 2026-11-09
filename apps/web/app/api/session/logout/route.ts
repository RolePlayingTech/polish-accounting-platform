import { NextResponse, type NextRequest } from 'next/server';
import {
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  resolveTrustedApplicationOrigin,
  sha256Hex,
} from '../../../../lib/oidc-client';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import {
  isSyntheticPersonaLoginAllowed,
  shouldUseSecureSessionCookie,
} from '../../../../lib/runtime-mode';
import { BFF_SESSION_COOKIE_NAME, clearSessionFromResponse } from '../../../../lib/session';

const OPAQUE_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

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

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  const contentType = request.headers.get('content-type') ?? '';
  const prefersJson =
    contentType.includes('application/json') ||
    (request.headers.get('accept') ?? '').includes('application/json');
  const isSecure = shouldUseSecureSessionCookie(request.url);

  const rawSessionId = request.cookies.get(BFF_SESSION_COOKIE_NAME)?.value?.trim();
  let revokeError: OidcServiceUnavailableError | null = null;

  if (rawSessionId && OPAQUE_SESSION_ID_REGEX.test(rawSessionId)) {
    try {
      await callApiBffSessionRpc('/session/revoke', {
        sessionIdHash: sha256Hex(rawSessionId),
      });
    } catch (err) {
      revokeError =
        err instanceof OidcServiceUnavailableError
          ? err
          : new OidcServiceUnavailableError(
              'Nie udało się potwierdzić unieważnienia sesji w magazynie BFF (ciasteczka przeglądarki zostały wyczyszczone).',
            );
    }
  }

  if (prefersJson) {
    if (revokeError) {
      const response = NextResponse.json(
        {
          ok: false,
          reasonCode: 'auth_service_unavailable',
          error: revokeError.message,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
      clearSessionFromResponse(response, isSecure);
      return response;
    }

    const postLogoutRedirect = isSyntheticPersonaLoginAllowed()
      ? '/login'
      : '/login?authState=signed_out';
    const response = NextResponse.json(
      { ok: true, redirectTo: postLogoutRedirect },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    clearSessionFromResponse(response, isSecure);
    return response;
  }

  const trustedOrigin = resolveTrustedApplicationOrigin(resolveCandidateRequestOrigin(request));
  if (!trustedOrigin) {
    const response = NextResponse.json(
      {
        ok: false,
        reasonCode: 'untrusted_request_origin',
        error: 'Odrzucono przekierowanie wylogowania dla niezaufanego originu żądania.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
    clearSessionFromResponse(response, isSecure);
    return response;
  }

  const postLogoutRedirect = isSyntheticPersonaLoginAllowed()
    ? '/login'
    : '/login?authState=signed_out';
  const response = NextResponse.redirect(new URL(postLogoutRedirect, trustedOrigin), {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
  clearSessionFromResponse(response, isSecure);
  return response;
}
