import { NextResponse, type NextRequest } from 'next/server';
import {
  RejectTenantInvitationRequestSchema,
  type RejectTenantInvitationResponse,
} from '@pap/contracts';
import { papBffFetch } from '../../../../../lib/api-url';
import { OidcServiceUnavailableError } from '../../../../../lib/oidc-client';
import { assertSameOriginMutation } from '../../../../../lib/request-security';
import { readServerSessionOrThrowUnavailable } from '../../../../../lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  let session;
  try {
    session = await readServerSessionOrThrowUnavailable();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'auth_service_unavailable',
        error:
          err instanceof OidcServiceUnavailableError
            ? err.message
            : 'Usługa sesji BFF jest chwilowo niedostępna (tryb fail-closed).',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Brak aktywnej sesji BFF — zaloguj się ponownie przed odrzuceniem zaproszenia.',
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'invalid_json',
        error: 'Nieprawidłowy format żądania JSON.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const parsed = RejectTenantInvitationRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'invalid_invitation_input',
        error: parsed.error.issues[0]?.message ?? 'Nieprawidłowe dane odrzucenia zaproszenia.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const remote = await papBffFetch<RejectTenantInvitationResponse>('/api/v1/invitations/reject', {
    method: 'POST',
    bearerToken: session.oidcToken,
    body: {
      invitationToken: parsed.data.invitationToken.trim(),
      ...(parsed.data.reason ? { reason: parsed.data.reason.trim() } : {}),
    },
  });

  if (remote.kind === 'unavailable') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'auth_service_unavailable',
        error: 'Usługa zaproszeń API jest chwilowo niedostępna (tryb fail-closed).',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (remote.kind === 'unauthorized') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Token sesji OIDC wygasł lub został odrzucony — zaloguj się ponownie.',
      },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (remote.kind === 'forbidden') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: remote.reasonCode ?? 'forbidden',
        error: remote.message,
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (remote.kind === 'not_found') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'invitation_not_found',
        error: remote.message ?? 'Zaproszenie nie istnieje lub token jest niepoprawny.',
      },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (remote.kind === 'validation_error' || remote.kind === 'server_error') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: remote.reasonCode ?? 'invitation_reject_failed',
        error: remote.message,
      },
      { status: remote.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(remote.data, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
