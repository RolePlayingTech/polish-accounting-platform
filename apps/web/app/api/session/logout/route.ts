import { NextResponse, type NextRequest } from 'next/server';
import {
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  sha256Hex,
} from '../../../../lib/oidc-client';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import { shouldUseSecureSessionCookie } from '../../../../lib/runtime-mode';
import { BFF_SESSION_COOKIE_NAME, clearSessionFromResponse } from '../../../../lib/session';

const OPAQUE_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

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

    const response = NextResponse.json(
      { ok: true, redirectTo: '/login' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
    clearSessionFromResponse(response, isSecure);
    return response;
  }

  const requestOrigin = new URL(request.url).origin;
  const response = NextResponse.redirect(new URL('/login', requestOrigin), {
    status: 303,
    headers: { 'Cache-Control': 'no-store' },
  });
  clearSessionFromResponse(response, isSecure);
  return response;
}
