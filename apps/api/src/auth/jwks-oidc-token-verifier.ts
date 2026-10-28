import {
  systemClock,
  type Clock,
  type OidcAccessTokenVerifier,
  type OidcTokenVerificationResult,
} from '@pap/application';
import { compactVerify, importJWK, type CryptoKey, type JWK } from 'jose';
import {
  ALLOWED_ASYMMETRIC_JWS_ALGORITHMS,
  type AsymmetricJwsAlgorithm,
  type OidcVerifierConfig,
} from './oidc-config.js';

export interface OidcRevocationCheckInput {
  readonly issuer: string;
  readonly subject: string;
  readonly tokenId?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly issuedAt: Date;
}

export interface OidcTokenRevocationChecker {
  isRevoked(input: OidcRevocationCheckInput): Promise<boolean>;
}

export type JwksFetcher = (jwksUri: string, signal: AbortSignal) => Promise<unknown>;

export interface JwksOidcAccessTokenVerifierOptions {
  readonly clock?: Clock | undefined;
  readonly fetchJwks?: JwksFetcher | undefined;
  readonly revocationChecker?: OidcTokenRevocationChecker | undefined;
}

interface CachedJwkEntry {
  readonly jwk: JWK;
}

const MAX_TOKEN_LENGTH = 8_192;
const MAX_JWKS_RESPONSE_BYTES = 65_536;
const FORBIDDEN_HEADER_FIELDS = ['jku', 'jwk', 'x5u', 'x5c', 'crit'] as const;
const FORBIDDEN_HEADER_TYP_VALUES = new Set([
  'id+jwt',
  'id',
  'refresh+jwt',
  'refresh',
  'dpop+jwt',
  'logout+jwt',
  'secevent+jwt',
]);

function isNonBlankExactString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64UrlJson(segment: string): Record<string, unknown> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    return null;
  }
  try {
    const text = Buffer.from(segment, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(text);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeHeaderTyp(rawTyp: string): string {
  const lower = rawTyp.trim().toLowerCase();
  return lower.startsWith('application/') ? lower.slice('application/'.length) : lower;
}

async function defaultFetchJwks(jwksUri: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(jwksUri, {
    method: 'GET',
    headers: {
      accept: 'application/jwk-set+json, application/json',
    },
    redirect: 'error',
    signal,
  });

  if (response.status !== 200) {
    throw new Error('JWKS HTTP status not 200');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_JWKS_RESPONSE_BYTES) {
    throw new Error('JWKS payload too large');
  }

  return JSON.parse(text) as unknown;
}

/**
 * Serwerowy adapter OIDC/OAuth 2.0 weryfikujący tokeny dostępowe JWT względem zaufanego JWKS.
 * Zapewnia ochronę przed alg=none, algorithm confusion (HS*), niezaufanymi nagłówkami jku/jwk/x5u,
 * podmianą ID Token za Access Token oraz rotacją kluczy JWKS.
 */
export class JwksOidcAccessTokenVerifier implements OidcAccessTokenVerifier {
  private readonly clock: Clock;
  private readonly fetchJwks: JwksFetcher;
  private readonly revocationChecker: OidcTokenRevocationChecker | undefined;
  private cachedKeysByKid: ReadonlyMap<string, CachedJwkEntry> | null = null;
  private cacheFetchedAtMs: number | null = null;
  private lastRefreshAttemptAtMs: number | null = null;
  private inFlightRefresh: Promise<ReadonlyMap<string, CachedJwkEntry>> | null = null;

  constructor(
    private readonly config: OidcVerifierConfig | null,
    options: JwksOidcAccessTokenVerifierOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.fetchJwks = options.fetchJwks ?? defaultFetchJwks;
    this.revocationChecker = options.revocationChecker;
  }

  async verifyAccessToken(
    rawBearerToken: string,
    options?: { readonly requiredScopes?: readonly string[] | undefined },
  ): Promise<OidcTokenVerificationResult> {
    if (!this.config) {
      return { ok: false, reason: 'oidc_configuration_unavailable' };
    }

    if (
      !isNonBlankExactString(rawBearerToken) ||
      rawBearerToken.length > MAX_TOKEN_LENGTH ||
      /\s/.test(rawBearerToken)
    ) {
      return { ok: false, reason: 'missing_token' };
    }

    const segments = rawBearerToken.split('.');
    if (segments.length !== 3) {
      return { ok: false, reason: 'malformed_token' };
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
    if (!headerSegment || !payloadSegment) {
      return { ok: false, reason: 'malformed_token' };
    }

    const protectedHeader = decodeBase64UrlJson(headerSegment);
    if (!protectedHeader) {
      return { ok: false, reason: 'malformed_token' };
    }

    for (const forbiddenField of FORBIDDEN_HEADER_FIELDS) {
      if (forbiddenField in protectedHeader) {
        return { ok: false, reason: 'untrusted_key_header' };
      }
    }

    const alg = protectedHeader.alg;
    if (
      !isNonBlankExactString(alg) ||
      alg.toLowerCase() === 'none' ||
      alg.toUpperCase().startsWith('HS') ||
      !ALLOWED_ASYMMETRIC_JWS_ALGORITHMS.has(alg as AsymmetricJwsAlgorithm) ||
      !this.config.allowedAlgorithms.includes(alg as AsymmetricJwsAlgorithm)
    ) {
      return { ok: false, reason: 'unsupported_algorithm' };
    }

    if (!signatureSegment || !/^[A-Za-z0-9_-]+$/.test(signatureSegment)) {
      return { ok: false, reason: 'malformed_token' };
    }

    const headerTyp = protectedHeader.typ;
    if (!isNonBlankExactString(headerTyp)) {
      return { ok: false, reason: 'invalid_token_type' };
    }
    const normalizedHeaderTyp = normalizeHeaderTyp(headerTyp);
    if (
      FORBIDDEN_HEADER_TYP_VALUES.has(normalizedHeaderTyp) ||
      !this.config.allowedTokenHeaderTypes
        .map((allowed) => normalizeHeaderTyp(allowed))
        .includes(normalizedHeaderTyp)
    ) {
      return { ok: false, reason: 'invalid_token_type' };
    }

    const kid = protectedHeader.kid;
    if (!isNonBlankExactString(kid)) {
      return { ok: false, reason: 'unknown_key' };
    }

    const keyResolution = await this.resolveVerificationKey(kid, alg as AsymmetricJwsAlgorithm);
    if (!keyResolution.ok) {
      return { ok: false, reason: keyResolution.reason };
    }

    let verifiedPayloadBytes: Uint8Array;
    try {
      const verified = await compactVerify(rawBearerToken, keyResolution.key, {
        algorithms: [alg],
      });
      verifiedPayloadBytes = verified.payload;
    } catch {
      return { ok: false, reason: 'invalid_signature' };
    }

    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(verifiedPayloadBytes).toString('utf8'));
      if (!isPlainRecord(parsed)) {
        return { ok: false, reason: 'malformed_token' };
      }
      payload = parsed;
    } catch {
      return { ok: false, reason: 'malformed_token' };
    }

    // Ochrona przed pomyleniem ID Token / Refresh Token / Logout Token z Access Tokenem
    if ('typ' in payload) {
      if (payload.typ !== 'Bearer') {
        return { ok: false, reason: 'invalid_token_type' };
      }
    }
    if ('events' in payload || 'at_hash' in payload || 'c_hash' in payload) {
      return { ok: false, reason: 'invalid_token_type' };
    }

    // Wymagane claimy standardowe: iss, sub, aud, exp, iat
    if (
      !('iss' in payload) ||
      !('sub' in payload) ||
      !('aud' in payload) ||
      !('exp' in payload) ||
      !('iat' in payload)
    ) {
      return { ok: false, reason: 'missing_required_claim' };
    }

    const issuer = payload.iss;
    const subject = payload.sub;
    if (!isNonBlankExactString(issuer) || !isNonBlankExactString(subject)) {
      return { ok: false, reason: 'missing_required_claim' };
    }

    if (issuer !== this.config.issuer) {
      return { ok: false, reason: 'invalid_issuer' };
    }

    const audiences = this.extractAudiences(payload.aud);
    if (!audiences) {
      return { ok: false, reason: 'invalid_audience' };
    }
    if (!audiences.includes(this.config.audience)) {
      return { ok: false, reason: 'invalid_audience' };
    }

    // Walidacja azp (Authorized Party)
    const azp = payload.azp;
    if (azp !== undefined && !isNonBlankExactString(azp)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (audiences.length > 1 && !isNonBlankExactString(azp)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (this.config.allowedAuthorizedParties !== null) {
      if (!isNonBlankExactString(azp) || !this.config.allowedAuthorizedParties.includes(azp)) {
        return { ok: false, reason: 'invalid_authorized_party' };
      }
    }

    // Walidacja exp, nbf, iat i dopuszczalnej różnicy czasu (clock skew)
    const exp = payload.exp;
    const iat = payload.iat;
    const nbf = payload.nbf;

    if (
      typeof exp !== 'number' ||
      !Number.isSafeInteger(exp) ||
      typeof iat !== 'number' ||
      !Number.isSafeInteger(iat)
    ) {
      return { ok: false, reason: 'missing_required_claim' };
    }
    if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isSafeInteger(nbf))) {
      return { ok: false, reason: 'malformed_token' };
    }
    if (exp <= iat || (nbf !== undefined && exp <= nbf)) {
      return { ok: false, reason: 'malformed_token' };
    }

    const nowMs = this.clock.now().getTime();
    if (!Number.isFinite(nowMs)) {
      return { ok: false, reason: 'oidc_configuration_unavailable' };
    }
    const nowSeconds = Math.floor(nowMs / 1000);
    const skew = this.config.clockToleranceSeconds;

    if (nowSeconds >= exp + skew) {
      return { ok: false, reason: 'token_expired' };
    }
    if (nbf !== undefined && nowSeconds + skew < nbf) {
      return { ok: false, reason: 'token_not_yet_valid' };
    }
    if (iat > nowSeconds + skew) {
      return { ok: false, reason: 'invalid_issued_at' };
    }
    if (nowSeconds - iat > this.config.maxTokenAgeSeconds + skew) {
      return { ok: false, reason: 'token_expired' };
    }

    // Walidacja scopes
    const scopes = this.extractScopes(payload.scope);
    if (scopes === null) {
      return { ok: false, reason: 'malformed_token' };
    }

    const requiredScopes = new Set<string>([
      ...this.config.requiredScopes,
      ...(options?.requiredScopes ?? []),
    ]);
    for (const requiredScope of requiredScopes) {
      if (!scopes.includes(requiredScope)) {
        return { ok: false, reason: 'insufficient_scope' };
      }
    }

    // Walidacja jti / sid oraz sprawdzenie odwołania sesji / tokenu
    const jti = payload.jti;
    const sid = payload.sid;
    if (jti !== undefined && !isNonBlankExactString(jti)) {
      return { ok: false, reason: 'malformed_token' };
    }
    if (sid !== undefined && !isNonBlankExactString(sid)) {
      return { ok: false, reason: 'malformed_token' };
    }

    const issuedAtDate = new Date(iat * 1000);
    const expiresAtDate = new Date(exp * 1000);

    if (this.revocationChecker) {
      try {
        const revoked = await this.revocationChecker.isRevoked({
          issuer,
          subject,
          tokenId: jti,
          sessionId: sid,
          issuedAt: issuedAtDate,
        });
        if (revoked === true) {
          return { ok: false, reason: 'subject_revoked_or_disabled' };
        }
      } catch {
        return { ok: false, reason: 'subject_revoked_or_disabled' };
      }
    }

    return Object.freeze({
      ok: true,
      identity: Object.freeze({
        issuer,
        subject,
        ...(jti ? { tokenId: jti } : {}),
        ...(sid ? { sessionId: sid } : {}),
        scopes: Object.freeze(scopes),
        issuedAt: issuedAtDate,
        expiresAt: expiresAtDate,
      }),
    });
  }

  private extractAudiences(aud: unknown): readonly string[] | null {
    if (isNonBlankExactString(aud)) {
      return [aud];
    }
    if (Array.isArray(aud) && aud.length > 0 && aud.every(isNonBlankExactString)) {
      return aud;
    }
    return null;
  }

  private extractScopes(rawScope: unknown): readonly string[] | null {
    if (rawScope === undefined) {
      return [];
    }
    if (typeof rawScope !== 'string') {
      return null;
    }
    if (rawScope.trim() === '') {
      return [];
    }
    return rawScope
      .split(' ')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private async resolveVerificationKey(
    kid: string,
    alg: AsymmetricJwsAlgorithm,
  ): Promise<
    | { readonly ok: true; readonly key: CryptoKey | Uint8Array }
    | { readonly ok: false; readonly reason: 'unknown_key' | 'jwks_unavailable' }
  > {
    const config = this.config!;
    const nowMs = this.clock.now().getTime();

    let keySet = this.cachedKeysByKid;
    const isCacheExpired =
      keySet === null ||
      this.cacheFetchedAtMs === null ||
      nowMs - this.cacheFetchedAtMs >= config.jwksCacheTtlMs;

    if (isCacheExpired) {
      try {
        keySet = await this.refreshJwks(nowMs);
      } catch {
        return { ok: false, reason: 'jwks_unavailable' };
      }
    }

    let entry = keySet!.get(kid);
    if (!entry && !isCacheExpired) {
      // Nieznany kid może oznaczać rotację kluczy u dostawcy OIDC — odświeżamy z uwzględnieniem cooldownu.
      const canForceRefresh =
        this.lastRefreshAttemptAtMs === null ||
        nowMs - this.lastRefreshAttemptAtMs >= config.jwksRefreshCooldownMs;

      if (canForceRefresh) {
        try {
          keySet = await this.refreshJwks(nowMs);
          entry = keySet.get(kid);
        } catch {
          return { ok: false, reason: 'jwks_unavailable' };
        }
      }
    }

    if (!entry) {
      return { ok: false, reason: 'unknown_key' };
    }

    if (entry.jwk.alg !== undefined && entry.jwk.alg !== alg) {
      return { ok: false, reason: 'unknown_key' };
    }

    try {
      const imported = await importJWK(entry.jwk, alg);
      return { ok: true, key: imported };
    } catch {
      return { ok: false, reason: 'unknown_key' };
    }
  }

  private async refreshJwks(nowMs: number): Promise<ReadonlyMap<string, CachedJwkEntry>> {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }

    const config = this.config!;
    this.lastRefreshAttemptAtMs = nowMs;

    const promise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.jwksFetchTimeoutMs);
      try {
        const rawJwks = await this.fetchJwks(config.jwksUri, controller.signal);
        const parsed = this.parseJwksPayload(rawJwks);
        this.cachedKeysByKid = parsed;
        this.cacheFetchedAtMs = this.clock.now().getTime();
        return parsed;
      } finally {
        clearTimeout(timeout);
        this.inFlightRefresh = null;
      }
    })();

    this.inFlightRefresh = promise;
    return promise;
  }

  private parseJwksPayload(rawJwks: unknown): ReadonlyMap<string, CachedJwkEntry> {
    if (!isPlainRecord(rawJwks) || !Array.isArray(rawJwks.keys) || rawJwks.keys.length === 0) {
      throw new Error('Invalid JWKS document');
    }

    const map = new Map<string, CachedJwkEntry>();
    for (const rawKey of rawJwks.keys) {
      if (!isPlainRecord(rawKey)) {
        throw new Error('Invalid JWK entry');
      }
      const kid = rawKey.kid;
      const kty = rawKey.kty;
      const use = rawKey.use;

      if (!isNonBlankExactString(kid) || !isNonBlankExactString(kty)) {
        continue;
      }
      // Odrzucamy klucze symetryczne (oct), klucze szyfrowania (use !== 'sig') oraz klucze zawierające materiał prywatny ('d')
      if (kty === 'oct' || 'd' in rawKey || (use !== undefined && use !== 'sig')) {
        continue;
      }
      if (map.has(kid)) {
        throw new Error('Duplicate kid in JWKS');
      }
      map.set(kid, { jwk: Object.freeze({ ...rawKey }) as JWK });
    }

    if (map.size === 0) {
      throw new Error('No usable verification keys in JWKS');
    }

    return map;
  }
}
