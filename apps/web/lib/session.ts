import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

export const OIDC_TOKEN_COOKIE_NAME = 'pap_oidc_token' as const;
export const SESSION_CONTEXT_COOKIE_NAME = 'pap_session_ctx' as const;

const SESSION_SIGNATURE_VERSION = 'v1' as const;
const GLOBAL_EPHEMERAL_SECRET_KEY = '__PAP_WEB_EPHEMERAL_SESSION_SECRET_V1__' as const;

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PersonaIdSchema = z.enum(['jan-testowy', 'marta-ksiegowa', 'piotr-izolacyjny']);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export const SessionUuidSchema = z.string().regex(STRICT_UUID_REGEX, {
  message: 'Wymagany ścisły identyfikator UUID RFC 4122.',
});

export const SessionContextSchema = z
  .object({
    personaId: PersonaIdSchema,
    userId: SessionUuidSchema,
    displayName: z.string().min(1).max(160),
    email: z.string().email().max(254),
    roleSummaryPl: z.string().min(1).max(240),
    tenantId: SessionUuidSchema,
    legalEntityId: SessionUuidSchema,
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

const CANONICAL_PERSONA_IDENTITY: Readonly<
  Record<
    PersonaId,
    {
      readonly userId: string;
      readonly allowedEmails: readonly string[];
      readonly expectedSyntheticToken: string;
    }
  >
> = {
  'jan-testowy': {
    userId: '00000000-0000-4000-8000-000000000101',
    allowedEmails: ['jan.testowy@syntetyczny.example', 'jan.testowy@example.test'],
    expectedSyntheticToken: 'pap_synth_oidc_jan_testowy_t1_owner_2026',
  },
  'marta-ksiegowa': {
    userId: '00000000-0000-4000-8000-000000000102',
    allowedEmails: ['marta.ksiegowa@biuro-syntetyczne.example', 'marta.ksiegowa@example.test'],
    expectedSyntheticToken: 'pap_synth_oidc_marta_ksiegowa_t1_grant_2026',
  },
  'piotr-izolacyjny': {
    userId: '00000000-0000-4000-8000-000000000201',
    allowedEmails: ['piotr.izolacyjny@tenant2-syntetyczny.example', 'piotr.izolacyjny@example.test'],
    expectedSyntheticToken: 'pap_synth_oidc_piotr_izolacyjny_t2_owner_2026',
  },
};

function getEphemeralProcessSecret(): Buffer {
  const globalObj = globalThis as unknown as Record<string, Buffer | undefined>;
  if (!globalObj[GLOBAL_EPHEMERAL_SECRET_KEY]) {
    globalObj[GLOBAL_EPHEMERAL_SECRET_KEY] = randomBytes(32);
  }
  return globalObj[GLOBAL_EPHEMERAL_SECRET_KEY]!;
}

function resolveSessionHmacKey(): Buffer {
  const configured = process.env.PAP_WEB_SESSION_SECRET?.trim();
  if (configured && configured.length >= 16) {
    return Buffer.from(configured, 'utf8');
  }
  return getEphemeralProcessSecret();
}

function buildCanonicalSigningMessage(
  oidcToken: string,
  context: SessionContext,
  payloadB64Url: string,
): string {
  return [
    SESSION_SIGNATURE_VERSION,
    oidcToken,
    context.userId,
    context.personaId,
    context.tenantId,
    context.legalEntityId,
    context.period,
    payloadB64Url,
  ].join('|');
}

function computeSessionHmacDigest(
  oidcToken: string,
  context: SessionContext,
  payloadB64Url: string,
): Buffer {
  const key = resolveSessionHmacKey();
  const message = buildCanonicalSigningMessage(oidcToken, context, payloadB64Url);
  return createHmac('sha256', key).update(message, 'utf8').digest();
}

function isConsistentPersonaIdentity(oidcToken: string, context: SessionContext): boolean {
  const canonical = CANONICAL_PERSONA_IDENTITY[context.personaId];
  if (
    context.userId !== canonical.userId ||
    !canonical.allowedEmails.includes(context.email)
  ) {
    return false;
  }

  // Jeśli token pochodzi z puli person syntetycznych, musi odpowiadać dokładnie tej personie.
  if (oidcToken.startsWith('pap_synth_oidc_')) {
    const tokenBuf = Buffer.from(oidcToken, 'utf8');
    const expectedBuf = Buffer.from(canonical.expectedSyntheticToken, 'utf8');
    if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
      return false;
    }
  }

  return true;
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

/**
 * Tworzy kryptograficznie podpisany (HMAC-SHA256) ładunek ciasteczka `pap_session_ctx`,
 * wiążąc `oidcToken` + `userId` + `personaId` + `tenantId` + `legalEntityId` + `period`.
 */
export function serializeSignedSessionContext(session: ActiveWebSession): string {
  const trimmedToken = session.oidcToken.trim();
  if (trimmedToken.length < 8) {
    throw new Error('Nieprawidłowy token sesji OIDC (zbyt krótki).');
  }
  const validatedContext = SessionContextSchema.parse(session.context);
  if (!isConsistentPersonaIdentity(trimmedToken, validatedContext)) {
    throw new Error('Niespójność tożsamości persony i tokena OIDC podczas podpisywania sesji.');
  }

  const payloadB64Url = Buffer.from(JSON.stringify(validatedContext), 'utf8').toString('base64url');
  const signatureHex = computeSessionHmacDigest(
    trimmedToken,
    validatedContext,
    payloadB64Url,
  ).toString('hex');

  return `${SESSION_SIGNATURE_VERSION}.${payloadB64Url}.${signatureHex}`;
}

export function parseSessionCookies(raw: {
  readonly oidcToken?: string | undefined;
  readonly sessionContextJson?: string | undefined;
}): ActiveWebSession | null {
  const trimmedToken = raw.oidcToken?.trim();
  const rawEnvelope = raw.sessionContextJson?.trim();

  if (
    !trimmedToken ||
    trimmedToken.length < 8 ||
    trimmedToken.length > 4096 ||
    !rawEnvelope ||
    rawEnvelope.length > 8192
  ) {
    return null;
  }

  const parts = rawEnvelope.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [version, payloadB64Url, signatureHex] = parts;
  if (
    version !== SESSION_SIGNATURE_VERSION ||
    !payloadB64Url ||
    !/^[A-Za-z0-9_-]+$/.test(payloadB64Url) ||
    !signatureHex ||
    !/^[0-9a-f]{64}$/.test(signatureHex)
  ) {
    return null;
  }

  try {
    const decodedJson = Buffer.from(payloadB64Url, 'base64url').toString('utf8');
    const parsedJson: unknown = JSON.parse(decodedJson);
    const validated = SessionContextSchema.safeParse(parsedJson);
    if (!validated.success) {
      return null;
    }

    const expectedDigest = computeSessionHmacDigest(trimmedToken, validated.data, payloadB64Url);
    const providedDigest = Buffer.from(signatureHex, 'hex');
    if (
      providedDigest.length !== expectedDigest.length ||
      !timingSafeEqual(providedDigest, expectedDigest)
    ) {
      return null;
    }

    if (!isConsistentPersonaIdentity(trimmedToken, validated.data)) {
      return null;
    }

    return {
      oidcToken: trimmedToken,
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
  const signedContext = serializeSignedSessionContext(session);
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, session.oidcToken.trim(), opts);
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, signedContext, opts);
}

export function clearSessionFromResponse(
  response: NextResponse,
  isProduction: boolean = process.env.NODE_ENV === 'production',
): void {
  const base = buildSessionCookieOptions(isProduction);
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, '', { ...base, maxAge: 0 });
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, '', { ...base, maxAge: 0 });
}
