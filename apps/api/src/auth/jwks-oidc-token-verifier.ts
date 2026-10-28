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
const MAX_JWKS_KEYS = 64;
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
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

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

async function readResponseTextWithLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLengthHeader = response.headers?.get('content-length');
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const declaredLength = Number(contentLengthHeader);
    if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > maxBytes) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      throw new Error('JWKS payload too large');
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error('JWKS payload too large');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new Error('JWKS payload too large');
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes).toString('utf8');
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
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    throw new Error('JWKS HTTP status not 200');
  }

  if (response.url) {
    const requestedOrigin = new URL(jwksUri).origin;
    const finalOrigin = new URL(response.url).origin;
    if (finalOrigin !== requestedOrigin) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      throw new Error('JWKS origin mismatch');
    }
  }

  const text = await readResponseTextWithLimit(response, MAX_JWKS_RESPONSE_BYTES);
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
      // Jeśli klucz pochodził z bufora, a minął już cooldown odświeżania JWKS, dostawca OIDC mógł
      // zrotować materiał klucza z zachowaniem tego samego identyfikatora kid.
      const rotatedKey = !keyResolution.fetchedNow
        ? await this.tryRefreshKeyOnSignatureFailure(kid, alg as AsymmetricJwsAlgorithm)
        : null;
      if (!rotatedKey) {
        return { ok: false, reason: 'invalid_signature' };
      }
      try {
        const verified = await compactVerify(rawBearerToken, rotatedKey, {
          algorithms: [alg],
        });
        verifiedPayloadBytes = verified.payload;
      } catch {
        return { ok: false, reason: 'invalid_signature' };
      }
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

    // Ochrona przed pomyleniem ID Token / Refresh Token / Logout Token z Access Tokenem (RFC 9068, RFC 8725 §3.11, OIDC Core):
    // 1. Odrzucamy claimy właściwe dla ID Tokena, Session/Code Hash oraz Backchannel Logout Tokena.
    if (
      'events' in payload ||
      'at_hash' in payload ||
      'c_hash' in payload ||
      's_hash' in payload ||
      'nonce' in payload
    ) {
      return { ok: false, reason: 'invalid_token_type' };
    }
    // 2. Dla jawnego nagłówka RFC 9068 (at+jwt) opcjonalny claim payload.typ (jeśli występuje) musi mieć wartość 'Bearer'.
    //    Dla nagłówka kompatybilności (jwt, dzielonego ze standardowym OIDC ID Tokenem) claim payload.typ === 'Bearer'
    //    jest bezwzględnie wymagany (konwencja Keycloak Access Token).
    if (normalizedHeaderTyp === 'at+jwt') {
      if ('typ' in payload && payload.typ !== 'Bearer') {
        return { ok: false, reason: 'invalid_token_type' };
      }
    } else if (payload.typ !== 'Bearer') {
      return { ok: false, reason: 'invalid_token_type' };
    }

    // Wymagane claimy standardowe Access Tokena: iss, sub, aud, exp, iat, scope
    if (
      !('iss' in payload) ||
      !('sub' in payload) ||
      !('aud' in payload) ||
      !('exp' in payload) ||
      !('iat' in payload) ||
      !('scope' in payload)
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

    const expectedAudiences =
      this.config.audiences && this.config.audiences.length > 0
        ? this.config.audiences
        : [this.config.audience];

    const audiences = this.extractAudiences(payload.aud);
    if (!audiences) {
      return { ok: false, reason: 'invalid_audience' };
    }
    if (!audiences.some((aud) => expectedAudiences.includes(aud))) {
      return { ok: false, reason: 'invalid_audience' };
    }

    // Walidacja azp (Authorized Party) oraz client_id (RFC 9068 §2.2) i ich separacji od odbiorcy API (aud)
    const azp = payload.azp;
    const clientId = payload.client_id;
    if (azp !== undefined && !isNonBlankExactString(azp)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (clientId !== undefined && !isNonBlankExactString(clientId)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (azp !== undefined && clientId !== undefined && azp !== clientId) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }

    const authorizedParty = azp ?? clientId;
    if (authorizedParty !== undefined && expectedAudiences.includes(authorizedParty)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (audiences.length > 1 && !isNonBlankExactString(authorizedParty)) {
      return { ok: false, reason: 'invalid_authorized_party' };
    }
    if (this.config.allowedAuthorizedParties !== null) {
      if (
        !isNonBlankExactString(authorizedParty) ||
        !this.config.allowedAuthorizedParties.includes(authorizedParty)
      ) {
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

    // Walidacja scopes (Access Token musi zawierać niepusty claim scope)
    const scopes = this.extractScopes(payload.scope);
    if (scopes === null) {
      return { ok: false, reason: 'malformed_token' };
    }
    if (scopes.length === 0) {
      return { ok: false, reason: 'missing_required_claim' };
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

  private canAttemptJwksRefresh(nowMs: number): boolean {
    const config = this.config!;
    return (
      this.lastRefreshAttemptAtMs === null ||
      nowMs - this.lastRefreshAttemptAtMs >= config.jwksRefreshCooldownMs
    );
  }

  private async tryRefreshKeyOnSignatureFailure(
    kid: string,
    alg: AsymmetricJwsAlgorithm,
  ): Promise<CryptoKey | Uint8Array | null> {
    const nowMs = this.clock.now().getTime();
    if (!this.canAttemptJwksRefresh(nowMs)) {
      return null;
    }
    try {
      const keySet = await this.refreshJwks(nowMs);
      const entry = keySet.get(kid);
      if (!entry || (entry.jwk.alg !== undefined && entry.jwk.alg !== alg)) {
        return null;
      }
      return await importJWK(entry.jwk, alg);
    } catch {
      return null;
    }
  }

  private async resolveVerificationKey(
    kid: string,
    alg: AsymmetricJwsAlgorithm,
  ): Promise<
    | { readonly ok: true; readonly key: CryptoKey | Uint8Array; readonly fetchedNow: boolean }
    | { readonly ok: false; readonly reason: 'unknown_key' | 'jwks_unavailable' }
  > {
    const config = this.config!;
    const nowMs = this.clock.now().getTime();

    let keySet = this.cachedKeysByKid;
    let fetchedNow = false;
    const isCacheExpired =
      keySet === null ||
      this.cacheFetchedAtMs === null ||
      nowMs - this.cacheFetchedAtMs >= config.jwksCacheTtlMs;

    if (isCacheExpired) {
      // Jeśli poprzednia próba odświeżenia zakończyła się awarią przed chwilą (w oknie cooldownu),
      // nie zalewamy niedostępnego dostawcy OIDC nowymi żądaniami HTTP.
      const recentlyFailedRefresh =
        this.lastRefreshAttemptAtMs !== null &&
        (this.cacheFetchedAtMs === null || this.lastRefreshAttemptAtMs > this.cacheFetchedAtMs) &&
        nowMs - this.lastRefreshAttemptAtMs < config.jwksRefreshCooldownMs;
      if (recentlyFailedRefresh) {
        return { ok: false, reason: 'jwks_unavailable' };
      }

      try {
        keySet = await this.refreshJwks(nowMs);
        fetchedNow = true;
      } catch {
        return { ok: false, reason: 'jwks_unavailable' };
      }
    }

    let entry = keySet!.get(kid);
    if (!entry && !isCacheExpired) {
      // Nieznany kid może oznaczać rotację kluczy u dostawcy OIDC — odświeżamy z uwzględnieniem cooldownu.
      if (this.canAttemptJwksRefresh(nowMs)) {
        try {
          keySet = await this.refreshJwks(nowMs);
          fetchedNow = true;
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
      return { ok: true, key: imported, fetchedNow };
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
    if (
      !isPlainRecord(rawJwks) ||
      !Array.isArray(rawJwks.keys) ||
      rawJwks.keys.length === 0 ||
      rawJwks.keys.length > MAX_JWKS_KEYS
    ) {
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
      const keyOps = rawKey.key_ops;

      if (!isNonBlankExactString(kid) || !isNonBlankExactString(kty)) {
        continue;
      }
      // Odrzucamy klucze symetryczne (oct), klucze szyfrowania (use !== 'sig'), klucze bez uprawnienia 'verify'
      // w key_ops oraz klucze zawierające materiał prywatny lub symetryczny (d, p, q, dp, dq, qi, oth, k).
      if (
        kty === 'oct' ||
        PRIVATE_JWK_FIELDS.some((field) => field in rawKey) ||
        (use !== undefined && use !== 'sig')
      ) {
        continue;
      }
      if (keyOps !== undefined) {
        if (
          !Array.isArray(keyOps) ||
          !keyOps.every((op) => typeof op === 'string') ||
          !keyOps.includes('verify') ||
          keyOps.includes('sign')
        ) {
          continue;
        }
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
