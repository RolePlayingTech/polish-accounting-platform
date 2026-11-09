import { NextResponse, type NextRequest } from 'next/server';
import {
  assertSameOriginMutation,
  sanitizeInternalRedirect,
} from '../../../../lib/request-security';
import { isSyntheticPersonaLoginAllowed } from '../../../../lib/runtime-mode';
import { PersonaIdSchema, writeSessionToResponse } from '../../../../lib/session';
import {
  DEFAULT_ACCOUNTING_PERIOD,
  WorkspaceAccessError,
  issuePersonaSession,
} from '../../../../lib/synthetic-workspace';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  if (!isSyntheticPersonaLoginAllowed()) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'synthetic_persona_disabled',
        error:
          'Syntetyczne persony testowe są wyłączone poza lokalnym trybem deweloperskim (LOCAL_DEV). Zaloguj się przez OIDC.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const contentType = request.headers.get('content-type') ?? '';
  const prefersJson =
    contentType.includes('application/json') ||
    (request.headers.get('accept') ?? '').includes('application/json');

  let rawPersonaId: unknown;
  let rawPeriod: string | undefined;
  let rawRedirectTo: string | undefined;

  try {
    if (contentType.includes('application/json')) {
      const body = (await request.json()) as Record<string, unknown>;
      rawPersonaId = body['personaId'];
      rawPeriod = typeof body['period'] === 'string' ? body['period'] : undefined;
      rawRedirectTo = typeof body['redirectTo'] === 'string' ? body['redirectTo'] : undefined;
    } else {
      const formData = await request.formData();
      rawPersonaId = formData.get('personaId');
      const p = formData.get('period');
      const r = formData.get('redirectTo');
      rawPeriod = typeof p === 'string' ? p : undefined;
      rawRedirectTo = typeof r === 'string' ? r : undefined;
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Nieprawidłowe żądanie logowania sesji testowej.' },
      { status: 400 },
    );
  }

  const parsedPersona = PersonaIdSchema.safeParse(rawPersonaId);
  if (!parsedPersona.success) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Wybierz poprawną syntetyczną personę OIDC (jan-testowy, marta-ksiegowa lub piotr-izolacyjny).',
      },
      { status: 400 },
    );
  }

  let session;
  try {
    session = await issuePersonaSession(parsedPersona.data, rawPeriod ?? DEFAULT_ACCOUNTING_PERIOD);
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { ok: false, reasonCode: err.reasonCode, error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { ok: false, error: 'Nie udało się utworzyć sesji testowej BFF.' },
      { status: 500 },
    );
  }

  const requestOrigin = new URL(request.url).origin;
  const redirectPath = sanitizeInternalRedirect(rawRedirectTo, '/app', requestOrigin);

  if (prefersJson) {
    const response = NextResponse.json({
      ok: true,
      redirectTo: redirectPath,
      context: session.context,
    });
    writeSessionToResponse(response, session);
    return response;
  }

  const redirectTarget = new URL(redirectPath, requestOrigin);
  const safeTarget =
    redirectTarget.origin === requestOrigin ? redirectTarget : new URL('/app', requestOrigin);
  const response = NextResponse.redirect(safeTarget, { status: 303 });
  writeSessionToResponse(response, session);
  return response;
}
