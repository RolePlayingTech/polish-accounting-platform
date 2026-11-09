import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  decryptBffPayload,
  refreshBffSessionTokens,
  sha256Hex,
  type BffRpcCallOptions,
  type SerializedBffSessionRecord,
  type StoredBffTokenBundle,
} from './oidc-client';
import { isSyntheticPersonaLoginAllowed, shouldUseSecureSessionCookie } from './runtime-mode';

export const BFF_SESSION_COOKIE_NAME = 'pap_session_id' as const;
export const OIDC_FLOW_COOKIE_NAME = 'pap_oidc_flow' as const;
export const OIDC_TOKEN_COOKIE_NAME = 'pap_oidc_token' as const;
export const SESSION_CONTEXT_COOKIE_NAME = 'pap_session_ctx' as const;

const SESSION_SIGNATURE_VERSION = 'v1' as const;
const GLOBAL_EPHEMERAL_SECRET_KEY = '__PAP_WEB_EPHEMERAL_SESSION_SECRET_V1__' as const;
const ACCESS_TOKEN_PROACTIVE_REFRESH_WINDOW_MS = 30_000;

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPAQUE_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

export const PersonaIdSchema = z.enum(['jan-testowy', 'marta-ksiegowa', 'piotr-izolacyjny']);
export type PersonaId = z.infer<typeof PersonaIdSchema>;

export const SessionUuidSchema = z.string().regex(STRICT_UUID_REGEX, {
  message: 'Wymagany ścisły identyfikator UUID RFC 4122.',
});

export const SessionContextSchema = z
  .object({
    personaId: PersonaIdSchema.optional(),
    userId: SessionUuidSchema,
    displayName: z.string().min(1).max(160),
    email: z.string().email().max(254),
    roleSummaryPl: z.string().min(1).max(240),
    tenantId: SessionUuidSchema,
    legalEntityId: SessionUuidSchema,
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  })
  .strict();

export interface SessionContext {
  readonly personaId?: PersonaId | undefined;
  readonly userId: string;
  readonly displayName: string;
  readonly email: string;
  readonly roleSummaryPl: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly period: string;
}

export interface ActiveWebSession {
  readonly oidcToken: string;
  readonly context: SessionContext;
  readonly authMethod?: 'oidc' | 'synthetic_local_dev' | undefined;
  readonly bffSessionIdHash?: string | undefined;
  readonly issuer?: string | undefined;
  readonly subject?: string | undefined;
  readonly hasTenantMembership?: boolean | undefined;
  readonly refreshGeneration?: number | undefined;
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
    allowedEmails: [
      'piotr.izolacyjny@tenant2-syntetyczny.example',
      'piotr.izolacyjny@example.test',
    ],
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
    context.personaId ?? '',
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
  if (!context.personaId) {
    return false;
  }
  const canonical = CANONICAL_PERSONA_IDENTITY[context.personaId];
  if (context.userId !== canonical.userId || !canonical.allowedEmails.includes(context.email)) {
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

export function buildOpaqueBffSessionCookieOptions(
  requestUrl?: string | undefined,
  maxAgeSeconds = 60 * 60 * 8,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SessionCookieSecurityOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: shouldUseSecureSessionCookie(requestUrl, env),
    maxAge: maxAgeSeconds,
  };
}

/**
 * Tworzy kryptograficznie podpisany (HMAC-SHA256) ładunek ciasteczka `pap_session_ctx`,
 * wiążąc `oidcToken` + `userId` + `personaId` + `tenantId` + `legalEntityId` + `period`.
 * Używane wyłącznie dla lokalnych person testowych (`LOCAL_DEV`).
 */
export function serializeSignedSessionContext(session: ActiveWebSession): string {
  const trimmedToken = session.oidcToken.trim();
  if (trimmedToken.length < 8) {
    throw new Error('Nieprawidłowy token sesji OIDC (zbyt krótki).');
  }
  const validatedContext = SessionContextSchema.parse(session.context);
  if (!validatedContext.personaId || !isConsistentPersonaIdentity(trimmedToken, validatedContext)) {
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
    if (!validated.success || !validated.data.personaId) {
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

function mapBffRecordToActiveSession(
  record: SerializedBffSessionRecord,
  tokens: StoredBffTokenBundle,
): ActiveWebSession {
  const hasMembership = Boolean(record.tenantId);
  return {
    oidcToken: tokens.accessToken,
    authMethod: 'oidc',
    bffSessionIdHash: record.sessionIdHash,
    issuer: record.issuer,
    subject: record.subject,
    hasTenantMembership: hasMembership,
    refreshGeneration: record.refreshGeneration,
    context: {
      userId: record.userId,
      displayName: record.displayName,
      email: record.email,
      roleSummaryPl: !hasMembership
        ? 'Konto OIDC bez przypisanej organizacji'
        : record.legalEntityId
          ? 'Użytkownik uwierzytelniony OIDC'
          : 'Użytkownik OIDC (wybór lub utworzenie podmiotu)',
      tenantId: record.tenantId ?? '',
      legalEntityId: record.legalEntityId ?? '',
      period: record.period,
    },
  };
}

export async function resolveOpaqueBffSessionFromId(
  rawOpaqueSessionId: string,
  options: BffRpcCallOptions & { readonly now?: Date | undefined } = {},
): Promise<ActiveWebSession | null> {
  const trimmed = rawOpaqueSessionId.trim();
  if (!OPAQUE_SESSION_ID_REGEX.test(trimmed)) {
    return null;
  }

  const env = options.env ?? process.env;
  const sessionIdHash = sha256Hex(trimmed);
  const aad = `bff_session:${sessionIdHash}`;

  const lookup = await callApiBffSessionRpc<
    | { readonly ok: true; readonly session: SerializedBffSessionRecord }
    | { readonly ok: false; readonly reason: string }
  >(
    '/session/get',
    {
      sessionIdHash,
      ...(options.now ? { now: options.now.toISOString() } : {}),
    },
    options,
  );

  if (!lookup.ok) {
    return null;
  }

  let activeRecord = lookup.session;
  let activeTokens: StoredBffTokenBundle;
  try {
    activeTokens = decryptBffPayload<StoredBffTokenBundle>(activeRecord.encryptedTokens, aad, env);
  } catch {
    return null;
  }

  const nowMs = (options.now ?? new Date()).getTime();
  const accessExpiresMs = new Date(activeRecord.accessTokenExpiresAt).getTime();

  if (
    !Number.isFinite(accessExpiresMs) ||
    accessExpiresMs <= nowMs + ACCESS_TOKEN_PROACTIVE_REFRESH_WINDOW_MS
  ) {
    if (!activeTokens.refreshToken) {
      if (!Number.isFinite(accessExpiresMs) || accessExpiresMs <= nowMs) {
        return null;
      }
      return mapBffRecordToActiveSession(activeRecord, activeTokens);
    }

    const refreshed = await refreshBffSessionTokens({
      session: activeRecord,
      env,
      apiBaseUrl: options.apiBaseUrl,
      fetcher: options.fetcher,
      now: options.now,
    });
    if (!refreshed.ok) {
      return null;
    }
    activeRecord = refreshed.session;
    activeTokens = refreshed.tokens;
  }

  return mapBffRecordToActiveSession(activeRecord, activeTokens);
}

/**
 * Odczytuje aktywną sesję na potrzeby tras HTTP BFF (`apps/web/app/api/**`).
 * Rzuca `OidcServiceUnavailableError` (HTTP 503 `auth_service_unavailable`), gdy przesłano ciasteczko
 * `pap_session_id`, a magazyn sesji lub sekret kryptograficzny jest niedostępny (tryb fail-closed).
 */
export async function readServerSessionOrThrowUnavailable(): Promise<ActiveWebSession | null> {
  const cookieStore = await cookies();
  const opaqueSessionId = cookieStore.get(BFF_SESSION_COOKIE_NAME)?.value;
  if (opaqueSessionId !== undefined && opaqueSessionId.trim().length > 0) {
    // Gdy klient przedstawia ciasteczko `pap_session_id`, NIGDY nie wolno cicho spaść do syntetycznych ciasteczek.
    return resolveOpaqueBffSessionFromId(opaqueSessionId);
  }

  if (!isSyntheticPersonaLoginAllowed()) {
    return null;
  }

  const oidcToken = cookieStore.get(OIDC_TOKEN_COOKIE_NAME)?.value;
  const sessionContextJson = cookieStore.get(SESSION_CONTEXT_COOKIE_NAME)?.value;
  return parseSessionCookies({ oidcToken, sessionContextJson });
}

/**
 * Odczytuje aktywną sesję w komponentach serwerowych Next.js (`apps/web/app/**`).
 * W przypadku niedostępności magazynu sesji zwraca `null` (odmowa dostępu fail-closed bez wyjątku 500
 * na stronach publicznych i bez fallbacku do person syntetycznych).
 */
export async function readServerSession(): Promise<ActiveWebSession | null> {
  try {
    return await readServerSessionOrThrowUnavailable();
  } catch (err) {
    if (err instanceof OidcServiceUnavailableError) {
      return null;
    }
    return null;
  }
}

export function writeOpaqueBffSessionCookie(
  response: NextResponse,
  rawOpaqueSessionId: string,
  requestUrl?: string | undefined,
  maxAgeSeconds = 60 * 60 * 8,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const opts = buildOpaqueBffSessionCookieOptions(requestUrl, maxAgeSeconds, env);
  response.cookies.set(BFF_SESSION_COOKIE_NAME, rawOpaqueSessionId.trim(), opts);
  // Zawsze czyścimy ewentualne stare ciasteczka person syntetycznych oraz ciasteczko wiązania przepływu PKCE.
  response.cookies.set(OIDC_FLOW_COOKIE_NAME, '', { ...opts, maxAge: 0 });
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, '', { ...opts, maxAge: 0 });
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, '', { ...opts, maxAge: 0 });
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
  response.cookies.set(BFF_SESSION_COOKIE_NAME, '', { ...base, maxAge: 0 });
  response.cookies.set(OIDC_FLOW_COOKIE_NAME, '', { ...base, maxAge: 0 });
  response.cookies.set(OIDC_TOKEN_COOKIE_NAME, '', { ...base, maxAge: 0 });
  response.cookies.set(SESSION_CONTEXT_COOKIE_NAME, '', { ...base, maxAge: 0 });
}

export async function persistUpdatedSessionContext(
  response: NextResponse,
  session: ActiveWebSession,
  updatedContext: SessionContext,
  options: BffRpcCallOptions = {},
): Promise<void> {
  if (session.authMethod === 'oidc' && session.bffSessionIdHash) {
    const updated = await callApiBffSessionRpc<
      | { readonly ok: true; readonly session: SerializedBffSessionRecord }
      | { readonly ok: false; readonly reason: string }
    >(
      '/session/context',
      {
        sessionIdHash: session.bffSessionIdHash,
        tenantId: updatedContext.tenantId || null,
        legalEntityId: updatedContext.legalEntityId || null,
        period: updatedContext.period,
      },
      options,
    );
    if (!updated.ok) {
      throw new OidcServiceUnavailableError(
        'Nie udało się zapisać kontekstu sesji BFF (sesja wygasła lub została unieważniona).',
      );
    }
    return;
  }

  writeSessionToResponse(response, {
    oidcToken: session.oidcToken,
    context: updatedContext,
  });
}
