import { NextResponse, type NextRequest } from 'next/server';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import { clearSessionFromResponse } from '../../../../lib/session';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  const contentType = request.headers.get('content-type') ?? '';
  const prefersJson =
    contentType.includes('application/json') ||
    (request.headers.get('accept') ?? '').includes('application/json');

  if (prefersJson) {
    const response = NextResponse.json({ ok: true, redirectTo: '/login' });
    clearSessionFromResponse(response);
    return response;
  }

  const requestOrigin = new URL(request.url).origin;
  const response = NextResponse.redirect(new URL('/login', requestOrigin), { status: 303 });
  clearSessionFromResponse(response);
  return response;
}
