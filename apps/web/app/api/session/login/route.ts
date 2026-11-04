import { NextResponse, type NextRequest } from 'next/server';
import { PersonaIdSchema, writeSessionToResponse } from '../../../../lib/session';
import {
  DEFAULT_ACCOUNTING_PERIOD,
  issuePersonaSession,
} from '../../../../lib/synthetic-workspace';

function sanitizeInternalRedirect(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) {
    return fallback;
  }
  const trimmed = candidate.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return fallback;
  }
  return trimmed;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  const session = await issuePersonaSession(
    parsedPersona.data,
    rawPeriod ?? DEFAULT_ACCOUNTING_PERIOD,
  );
  const redirectPath = sanitizeInternalRedirect(rawRedirectTo, '/app');

  if (prefersJson) {
    const response = NextResponse.json({
      ok: true,
      redirectTo: redirectPath,
      context: session.context,
    });
    writeSessionToResponse(response, session);
    return response;
  }

  const response = NextResponse.redirect(new URL(redirectPath, request.url), { status: 303 });
  writeSessionToResponse(response, session);
  return response;
}
