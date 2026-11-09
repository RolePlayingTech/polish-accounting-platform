import {
  BadRequestException,
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Optional,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { SafeEmailAddressSchema } from '@pap/contracts';
import type {
  IdentityLifecycleStorePort,
  WebBffSessionRecord,
  WebSessionStorePort,
} from '@pap/application';
import type { FastifyRequest } from 'fastify';
import {
  API_RUNTIME_ENV,
  IDENTITY_LIFECYCLE_STORE_PORT,
  WEB_SESSION_STORE_PORT,
} from '../runtime/workspace-runtime.js';

const DETERMINISTIC_TEST_BFF_SECRET =
  'pap-vitest-deterministic-bff-secret-key-min-32-chars!!' as const;
const BFF_INTERNAL_HMAC_INFO = 'pap-bff-internal-rpc-hmac-v1' as const;
const MAX_BFF_TIMESTAMP_SKEW_MS = 60_000;

function canonicalizeJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeJsonValue);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] !== undefined) {
      sorted[key] = canonicalizeJsonValue(record[key]);
    }
  }
  return sorted;
}

export function computeBffCanonicalBodySha256(body: unknown): string {
  const canonical = JSON.stringify(canonicalizeJsonValue(body ?? {}));
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function resolveBffInternalHmacKey(
  env: Readonly<Record<string, string | undefined>>,
): Buffer | null {
  const raw = env.PAP_WEB_SESSION_SECRET?.trim();
  if (raw && Buffer.byteLength(raw, 'utf8') >= 32) {
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(raw, 'utf8'),
        Buffer.alloc(0),
        Buffer.from(BFF_INTERNAL_HMAC_INFO, 'utf8'),
        32,
      ),
    );
  }

  if (env.NODE_ENV === 'test' && env.PAP_REQUIRE_EXPLICIT_WEB_SESSION_SECRET !== 'true' && !raw) {
    return Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(DETERMINISTIC_TEST_BFF_SECRET, 'utf8'),
        Buffer.alloc(0),
        Buffer.from(BFF_INTERNAL_HMAC_INFO, 'utf8'),
        32,
      ),
    );
  }

  return null;
}

export function computeBffInternalSignatureHex(
  hmacKey: Buffer,
  method: string,
  pathname: string,
  timestampMs: string,
  body: unknown,
): string {
  const bodyHash = computeBffCanonicalBodySha256(body);
  const message = `${method.toUpperCase()}|${pathname}|${timestampMs}|${bodyHash}`;
  return createHmac('sha256', hmacKey).update(message, 'utf8').digest('hex');
}

function serializeSessionRecord(session: WebBffSessionRecord) {
  return {
    sessionIdHash: session.sessionIdHash,
    userId: session.userId,
    issuer: session.issuer,
    subject: session.subject,
    displayName: session.displayName,
    email: session.email,
    tenantId: session.tenantId,
    legalEntityId: session.legalEntityId,
    period: session.period,
    encryptedTokens: session.encryptedTokens,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    refreshGeneration: session.refreshGeneration,
    previousEncryptedTokens: session.previousEncryptedTokens,
    previousAccessTokenExpiresAt: session.previousAccessTokenExpiresAt
      ? session.previousAccessTokenExpiresAt.toISOString()
      : null,
    previousGraceUntil: session.previousGraceUntil
      ? session.previousGraceUntil.toISOString()
      : null,
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function parseRequiredIsoDate(raw: unknown, fieldName: string): Date {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      reasonCode: 'invalid_bff_session_payload',
      message: `Brak wymaganego znacznika czasu ISO-8601 w polu ${fieldName}.`,
    });
  }
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'bad_request',
      reasonCode: 'invalid_bff_session_payload',
      message: `Niepoprawny format znacznika czasu ISO-8601 w polu ${fieldName}.`,
    });
  }
  return date;
}

function parseOptionalIsoDate(raw: unknown, fieldName: string): Date | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  return parseRequiredIsoDate(raw, fieldName);
}

@Controller('/api/v1/auth/bff')
export class BffSessionController {
  constructor(
    @Inject(WEB_SESSION_STORE_PORT)
    private readonly sessionStore: WebSessionStorePort,
    @Inject(API_RUNTIME_ENV)
    private readonly env: Readonly<Record<string, string | undefined>>,
    @Optional()
    @Inject(IDENTITY_LIFECYCLE_STORE_PORT)
    private readonly identityLifecycleStore?: IdentityLifecycleStorePort,
  ) {}

  private assertInternalBffAuth(request: FastifyRequest, body: unknown): void {
    const hmacKey = resolveBffInternalHmacKey(this.env);
    if (!hmacKey) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message:
          'Usługa sesji BFF jest niedostępna (brak skonfigurowanego sekretu PAP_WEB_SESSION_SECRET >= 32 znaki).',
      });
    }

    const rawTimestamp = request.headers['x-bff-timestamp'];
    const rawSignature = request.headers['x-bff-signature'];
    if (
      typeof rawTimestamp !== 'string' ||
      !/^\d{10,16}$/.test(rawTimestamp.trim()) ||
      typeof rawSignature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(rawSignature.trim())
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: 'invalid_bff_internal_signature',
        message: 'Brak lub niepoprawny podpis wewnętrznego żądania BFF.',
      });
    }

    const tsNum = Number(rawTimestamp.trim());
    const nowMs = Date.now();
    if (!Number.isSafeInteger(tsNum) || Math.abs(nowMs - tsNum) > MAX_BFF_TIMESTAMP_SKEW_MS) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: 'expired_bff_internal_signature',
        message: 'Znacznik czasu wewnętrznego żądania BFF przekroczył dopuszczalne okno 60 sekund.',
      });
    }

    const pathname = (request.url ?? '').split('?')[0] ?? '';
    const expectedHex = computeBffInternalSignatureHex(
      hmacKey,
      request.method,
      pathname,
      rawTimestamp.trim(),
      body ?? {},
    );

    const providedBuf = Buffer.from(rawSignature.trim(), 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: 'invalid_bff_internal_signature',
        message: 'Weryfikacja kryptograficzna podpisu wewnętrznego żądania BFF zakończyła się odmową.',
      });
    }
  }

  private parseAllowedTestNow(raw: unknown): Date | undefined {
    if (this.env['NODE_ENV'] !== 'test') {
      return undefined;
    }
    return parseOptionalIsoDate(raw, 'now');
  }

  private async runStoreOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Współdzielony magazyn sesji BFF jest chwilowo niedostępny (tryb fail-closed).',
      });
    }
  }

  @Post('/oidc-state/create')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async createOidcState(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);

    const expiresAt = parseRequiredIsoDate(body['expiresAt'], 'expiresAt');
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(() =>
      this.sessionStore.createOidcAuthState({
        stateHash: typeof body['stateHash'] === 'string' ? body['stateHash'] : '',
        encryptedPayload:
          typeof body['encryptedPayload'] === 'string' ? body['encryptedPayload'] : '',
        expiresAt,
        now,
      }),
    );
  }

  @Post('/oidc-state/consume')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async consumeOidcState(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(async () => {
      const res = await this.sessionStore.consumeOidcAuthState({
        stateHash: typeof body['stateHash'] === 'string' ? body['stateHash'] : '',
        now,
      });
      if (!res.ok) {
        return res;
      }
      return {
        ok: true,
        state: {
          stateHash: res.state.stateHash,
          encryptedPayload: res.state.encryptedPayload,
          expiresAt: res.state.expiresAt.toISOString(),
          consumedAt: res.state.consumedAt ? res.state.consumedAt.toISOString() : null,
          createdAt: res.state.createdAt.toISOString(),
        },
      };
    });
  }

  @Post('/session/create')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async createSession(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);

    const accessTokenExpiresAt = parseRequiredIsoDate(
      body['accessTokenExpiresAt'],
      'accessTokenExpiresAt',
    );
    const expiresAt = parseRequiredIsoDate(body['expiresAt'], 'expiresAt');
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(async () => {
      const res = await this.sessionStore.createSession({
        sessionIdHash: typeof body['sessionIdHash'] === 'string' ? body['sessionIdHash'] : '',
        userId: typeof body['userId'] === 'string' ? body['userId'] : '',
        issuer: typeof body['issuer'] === 'string' ? body['issuer'] : '',
        subject: typeof body['subject'] === 'string' ? body['subject'] : '',
        displayName: typeof body['displayName'] === 'string' ? body['displayName'] : '',
        email: typeof body['email'] === 'string' ? body['email'] : '',
        tenantId: typeof body['tenantId'] === 'string' ? body['tenantId'] : null,
        legalEntityId: typeof body['legalEntityId'] === 'string' ? body['legalEntityId'] : null,
        period: typeof body['period'] === 'string' ? body['period'] : '',
        encryptedTokens:
          typeof body['encryptedTokens'] === 'string' ? body['encryptedTokens'] : '',
        accessTokenExpiresAt,
        expiresAt,
        now,
      });
      if (!res.ok) {
        return res;
      }
      const normalizedEmail = res.session.email.trim().toLowerCase();
      if (
        this.identityLifecycleStore &&
        !normalizedEmail.endsWith('.invalid') &&
        SafeEmailAddressSchema.safeParse(normalizedEmail).success
      ) {
        await this.identityLifecycleStore.upsertUserProfile({
          userId: res.session.userId,
          displayName: res.session.displayName,
          email: normalizedEmail,
          now,
        });
      }
      return {
        ok: true,
        session: serializeSessionRecord(res.session),
      };
    });
  }

  @Post('/session/get')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async getSession(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(async () => {
      const res = await this.sessionStore.getSession({
        sessionIdHash: typeof body['sessionIdHash'] === 'string' ? body['sessionIdHash'] : '',
        now,
      });
      if (!res.ok) {
        return res;
      }
      return {
        ok: true,
        session: serializeSessionRecord(res.session),
      };
    });
  }

  @Post('/session/context')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async updateSessionContext(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(async () => {
      const res = await this.sessionStore.updateSessionContext({
        sessionIdHash: typeof body['sessionIdHash'] === 'string' ? body['sessionIdHash'] : '',
        tenantId: typeof body['tenantId'] === 'string' ? body['tenantId'] : null,
        legalEntityId: typeof body['legalEntityId'] === 'string' ? body['legalEntityId'] : null,
        period: typeof body['period'] === 'string' ? body['period'] : '',
        now,
      });
      if (!res.ok) {
        return res;
      }
      return {
        ok: true,
        session: serializeSessionRecord(res.session),
      };
    });
  }

  @Post('/session/rotate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async rotateSessionTokens(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);

    const accessTokenExpiresAt = parseRequiredIsoDate(
      body['accessTokenExpiresAt'],
      'accessTokenExpiresAt',
    );
    const sessionExpiresAt = parseOptionalIsoDate(body['sessionExpiresAt'], 'sessionExpiresAt');
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(async () => {
      const res = await this.sessionStore.rotateSessionTokens({
        sessionIdHash: typeof body['sessionIdHash'] === 'string' ? body['sessionIdHash'] : '',
        expectedGeneration:
          typeof body['expectedGeneration'] === 'number' ? body['expectedGeneration'] : -1,
        encryptedTokens:
          typeof body['encryptedTokens'] === 'string' ? body['encryptedTokens'] : '',
        accessTokenExpiresAt,
        sessionExpiresAt,
        gracePeriodMs:
          typeof body['gracePeriodMs'] === 'number' ? body['gracePeriodMs'] : undefined,
        now,
      });
      if (!res.ok) {
        return res;
      }
      return {
        ok: true,
        rotated: res.rotated,
        alreadyAdvanced: res.alreadyAdvanced,
        session: serializeSessionRecord(res.session),
      };
    });
  }

  @Post('/session/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeSession(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(() =>
      this.sessionStore.revokeSession({
        sessionIdHash: typeof body['sessionIdHash'] === 'string' ? body['sessionIdHash'] : '',
        now,
      }),
    );
  }

  @Post('/session/revoke-user')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeUserSessions(
    @Req() request: FastifyRequest,
    @Body() rawBody: unknown,
  ) {
    const body = (typeof rawBody === 'object' && rawBody !== null ? rawBody : {}) as Record<
      string,
      unknown
    >;
    this.assertInternalBffAuth(request, body);
    const now = this.parseAllowedTestNow(body['now']);

    return this.runStoreOperation(() =>
      this.sessionStore.revokeAllSessionsForUser({
        userId: typeof body['userId'] === 'string' ? body['userId'] : '',
        now,
      }),
    );
  }
}
