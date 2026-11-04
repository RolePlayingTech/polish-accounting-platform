import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

export const OIDC_TOKEN_COOKIE_NAME = 'pap_oidc_token' as const;
export const SESSION_CONTEXT_COOKIE_NAME = 'pap_session_ctx' as const;

export const PersonaIdSchema = z.enum(['jan-testowy', 'marta-ksiegowa', 'piotr-izolacyjny']);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export const SessionContextSchema = z
  .object({
    personaId: PersonaIdSchema,
    userId: z.string().min(1),
    displayName: z.string().min(1),
    email: z.string().email(),
    roleSummaryPl: z.string().min(1),
    tenantId: z.string().min(1),
    legalEntityId: z.string().min(1),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict();

export type SessionContext = z.infer<typeof SessionContextSchema>;

export interface ActiveWebSession {
  readonly oidcToken: string;
  readonly context: SessionContext;
}

export interface SessionCookieSecurityOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly secure: boolean;
  readonly maxAge: number;
}

export function buildSessionCookieOptions(
  isProduction: boolean = process.env.NODE_ENV === 'production',
): SessionCookieSecurityOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isProduction,
    maxAge: 60 * 60 * 8,
  };
}

export function parseSessionCookies(raw: {
  readonly oidcToken?: string | undefined;
  readonly sessionContextJson?: string | undefined;
}): ActiveWebSession | null {
  if (!raw.oidcToken || raw.oidcToken.trim().length < 8 || !raw.sessionContextJson) {
    return null;
  }

  try {
    const parsedJson: unknown = JSON.parse(raw.sessionContextJson);
    const validated = SessionContextSchema.safeParse(parsedJson);
    if (!validated.success) {
      return null;
    }
    return {
      oidcToken: raw.oidcToken.trim(),
      context: validated.data,
    };
  } catch {
    return null;
  }
}

export async function readServerSession(): Promise<ActiveWebSession | null> {
  const cookieStore = await cookies();
  const oidcToken = cookieStore.get(OIDC_TOKEN_COOKIE_NAME)?.value;
  const sessionContextJson = cookieStore.get(SESSION_CONTEXT_COOKIE_NAME)?.value;
  return parseSessionCookies({ oidcToken, sessionContextJson });
}

export function writeSessionToResponse(
  response: NextResponse,
  session: ActiveWebSession,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): void {
  const opts = buildSessionCookieOptions(isProduction);
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, session.oidcToken, opts);
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, JSON.stringify(session.context), opts);
}

export function clearSessionFromResponse(
  response: NextResponse,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): void {
  const base = buildSessionCookieOptions(isProduction);
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, '', { ...base, maxAge: 0 });
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, '', { ...base, maxAge: 0 });
}
