import {
  constants as cryptoConstants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey as CryptoJsonWebKey,
} from 'node:crypto';
import { isIP } from 'node:net';
import { resolveValidatedApiBaseUrl } from './api-url';
import { resolveWebRuntimeMode } from './runtime-mode';

const DETERMINISTIC_TEST_BFF_SECRET =
  'pap-vitest-deterministic-bff-secret-key-min-32-chars!!' as const;
const BFF_AEAD_INFO = 'pap-bff-aead-v1' as const;
const BFF_INTERNAL_HMAC_INFO = 'pap-bff-internal-rpc-hmac-v1' as const;
const BFF_FLOW_COOKIE_HMAC_INFO = 'pap-bff-flow-cookie-hmac-v1' as const;
const AEAD_ENVELOPE_VERSION = 'v1' as const;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FORBIDDEN_JWS_HEADER_FIELDS = ['jku', 'jwk', 'x5u', 'x5c', 'crit'] as const;
const FORBIDDEN_ID_TOKEN_HEADER_TYPS = new Set([
  'at+jwt',
  'refresh+jwt',
  'refresh',
  'dpop+jwt',
  'logout+jwt',
  'secevent+jwt',
]);
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

export type AsymmetricJwsAlg =
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';

const ALLOWED_ASYMMETRIC_ALGS: ReadonlySet<AsymmetricJwsAlg> = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);

export class OidcConfigurationError extends Error {
  readonly reasonCode = 'oidc_configuration_unavailable' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OidcConfigurationError';
  }
}

export class OidcServiceUnavailableError extends Error {
  readonly reasonCode = 'auth_service_unavailable' as const;
  constructor(message: string) {
    super(message);
    this.name = 'OidcServiceUnavailableError';
  }
}

export class OidcSecurityValidationError extends Error {
  readonly reasonCode: string;
  readonly statusCode: 400 | 401 | 403;
  constructor(reasonCode: string, message: string, statusCode: 400 | 401 | 403 = 401) {
    super(message);
    this.name = 'OidcSecurityValidationError';
    this.reasonCode = reasonCode;
    this.statusCode = statusCode;
  }
}

export interface WebOidcClientConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret?: string | undefined;
  readonly tokenAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  readonly redirectUri: string;
  readonly allowedRedirectUris: readonly string[];
  readonly scopes: readonly string[];
  readonly authorizationEndpoint?: string | undefined;
  readonly tokenEndpoint?: string | undefined;
  readonly jwksUri?: string | undefined;
  readonly endSessionEndpoint?: string | undefined;
  readonly allowedAlgorithms: readonly AsymmetricJwsAlg[];
  readonly clockToleranceSeconds: number;
  readonly maxTokenAgeSeconds: number;
  readonly fetchTimeoutMs: number;
}

export interface ResolvedOidcProviderMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly endSessionEndpoint?: string | undefined;
}

export interface StoredOidcFlowPayload {
  readonly codeVerifier: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly returnTo: string;
  readonly issuer: string;
}

export interface StoredBffTokenBundle {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly idToken?: string | undefined;
  readonly scope?: string | undefined;
}

export interface VerifiedOidcIdTokenClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly audiences: readonly string[];
  readonly authorizedParty?: string | undefined;
  readonly nonce?: string | undefined;
  readonly email?: string | undefined;
  readonly emailVerified?: boolean | undefined;
  readonly displayName?: string | undefined;
  readonly sessionId?: string | undefined;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface SerializedBffSessionRecord {
  readonly sessionIdHash: string;
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly period: string;
  readonly encryptedTokens: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshGeneration: number;
  readonly previousEncryptedTokens: string | null;
  readonly previousAccessTokenExpiresAt: string | null;
  readonly previousGraceUntil: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function resolveRawWebSessionSecret(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  const configured = env['PAP_WEB_SESSION_SECRET']?.trim();
  if (configured) {
    if (Buffer.byteLength(configured, 'utf8') < 32) {
      throw new OidcServiceUnavailableError(
        'Konfiguracja PAP_WEB_SESSION_SECRET jest za krótka (wymagane co najmniej 32 bajty entropii).',
      );
    }
    return Buffer.from(configured, 'utf8');
  }

  if (
    env['NODE_ENV'] === 'test' &&
    env['PAP_REQUIRE_EXPLICIT_WEB_SESSION_SECRET'] !== 'true'
  ) {
    return Buffer.from(DETERMINISTIC_TEST_BFF_SECRET, 'utf8');
  }

  throw new OidcServiceUnavailableError(
    'Brak wymaganego sekretu PAP_WEB_SESSION_SECRET (>= 32 bajty) — logowanie i sesje BFF zablokowane w trybie fail-closed.',
  );
}

function deriveHkdfKey(
  info: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Buffer {
  const secret = resolveRawWebSessionSecret(env);
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), Buffer.from(info, 'utf8'), 32));
}

export function encryptBffPayload(
  plaintextJson: unknown,
  aadContext: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const key = deriveHkdfKey(BFF_AEAD_INFO, env);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(aadContext, 'utf8'));

  const plaintextBuf = Buffer.from(JSON.stringify(plaintextJson), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintextBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    AEAD_ENVELOPE_VERSION,
    iv.toString('base64url'),
    encrypted.toString('base64url'),
    authTag.toString('base64url'),
  ].join('.');
}

export function decryptBffPayload<T>(
  envelope: string,
  aadContext: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): T {
  const key = deriveHkdfKey(BFF_AEAD_INFO, env);
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== AEAD_ENVELOPE_VERSION) {
    throw new OidcSecurityValidationError(
      'invalid_encrypted_session_payload',
      'Niepoprawny format zaszyfrowanego ładunku sesji BFF.',
    );
  }

  const [, ivB64, ciphertextB64, tagB64] = parts as [string, string, string, string];
  if (!ivB64 || !tagB64) {
    throw new OidcSecurityValidationError(
      'invalid_encrypted_session_payload',
      'Uszkodzony ładunek kryptograficzny sesji BFF.',
    );
  }

  try {
    const iv = Buffer.from(ivB64, 'base64url');
    const ciphertext = Buffer.from(ciphertextB64, 'base64url');
    const authTag = Buffer.from(tagB64, 'base64url');
    if (iv.length !== 12 || authTag.length !== 16) {
      throw new Error('Invalid IV or tag length');
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(aadContext, 'utf8'));
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    throw new OidcSecurityValidationError(
      'invalid_encrypted_session_payload',
      'Weryfikacja integralności AEAD zaszyfrowanego ładunku sesji BFF zakończyła się odmową.',
    );
  }
}

export function signOidcFlowBindingCookie(
  stateHash: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const key = deriveHkdfKey(BFF_FLOW_COOKIE_HMAC_INFO, env);
  const sigHex = createHmac('sha256', key).update(`v1|${stateHash}`, 'utf8').digest('hex');
  return `v1.${stateHash}.${sigHex}`;
}

export function verifyOidcFlowBindingCookie(
  cookieValue: string | undefined,
  expectedStateHash: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!cookieValue || typeof cookieValue !== 'string' || !/^[0-9a-f]{64}$/.test(expectedStateHash)) {
    return false;
  }
  const parts = cookieValue.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return false;
  }
  const [, cookieStateHash, providedSigHex] = parts as [string, string, string];
  if (!/^[0-9a-f]{64}$/.test(cookieStateHash) || !/^[0-9a-f]{64}$/.test(providedSigHex)) {
    return false;
  }

  const stateHashBuf = Buffer.from(cookieStateHash, 'hex');
  const expectedStateBuf = Buffer.from(expectedStateHash, 'hex');
  if (
    stateHashBuf.length !== expectedStateBuf.length ||
    !timingSafeEqual(stateHashBuf, expectedStateBuf)
  ) {
    return false;
  }

  const key = deriveHkdfKey(BFF_FLOW_COOKIE_HMAC_INFO, env);
  const expectedSigHex = createHmac('sha256', key)
    .update(`v1|${cookieStateHash}`, 'utf8')
    .digest('hex');
  const providedSigBuf = Buffer.from(providedSigHex, 'hex');
  const expectedSigBuf = Buffer.from(expectedSigHex, 'hex');
  return (
    providedSigBuf.length === expectedSigBuf.length &&
    timingSafeEqual(providedSigBuf, expectedSigBuf)
  );
}

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

export interface BffRpcCallOptions {
  readonly apiBaseUrl?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly fetcher?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export async function callApiBffSessionRpc<T>(
  subPath:
    | '/oidc-state/create'
    | '/oidc-state/consume'
    | '/identity/ensure'
    | '/session/create'
    | '/session/get'
    | '/session/context'
    | '/session/rotate'
    | '/session/revoke'
    | '/session/revoke-user',
  body: Record<string, unknown>,
  options: BffRpcCallOptions = {},
): Promise<T> {
  const env = options.env ?? process.env;
  const hmacKey = deriveHkdfKey(BFF_INTERNAL_HMAC_INFO, env);
  const baseUrl = resolveValidatedApiBaseUrl({
    apiBaseUrl: options.apiBaseUrl ?? env['API_BASE_URL'],
    isProduction: env['NODE_ENV'] === 'production',
  });
  if (!baseUrl) {
    throw new OidcServiceUnavailableError(
      'Brak poprawnego adresu API_BASE_URL do komunikacji z magazynem sesji BFF.',
    );
  }

  const pathname = `/api/v1/auth/bff${subPath}`;
  const targetUrl = new URL(pathname, baseUrl);
  const canonicalBodyText = JSON.stringify(canonicalizeJsonValue(body));
  const bodySha256 = createHash('sha256').update(canonicalBodyText, 'utf8').digest('hex');
  const timestampMs = String(Date.now());
  const signatureHex = createHmac('sha256', hmacKey)
    .update(`POST|${pathname}|${timestampMs}|${bodySha256}`, 'utf8')
    .digest('hex');

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-bff-timestamp': timestampMs,
        'x-bff-signature': signatureHex,
      },
      body: canonicalBodyText,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    throw new OidcServiceUnavailableError(
      'Współdzielony magazyn sesji BFF w API jest nieosiągalny (tryb fail-closed).',
    );
  }

  if (response.status !== 200) {
    throw new OidcServiceUnavailableError(
      `Magazyn sesji BFF zwrócił błąd HTTP ${String(response.status)} (tryb fail-closed).`,
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new OidcServiceUnavailableError(
      'Nieprawidłowa odpowiedź JSON z magazynu sesji BFF (tryb fail-closed).',
    );
  }
}

function isPrivateOrLinkLocalHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    normalized.length === 0 ||
    LOOPBACK_HOSTS.has(normalized) ||
    normalized.endsWith('.') ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.home.arpa')
  ) {
    return true;
  }

  const ipVer = isIP(normalized);
  if (ipVer === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return true;
    }
    const [a, b, c] = octets as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }

  if (ipVer === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('::ffff:') ||
      /^f[cd][0-9a-f]{2}:/i.test(normalized) ||
      /^fe[89ab][0-9a-f]:/i.test(normalized) ||
      normalized.startsWith('ff')
    );
  }

  return !normalized.includes('.');
}

function parseTrustedOidcEndpoint(
  rawUrl: string | undefined,
  fieldName: string,
  isNodeProduction: boolean,
): URL {
  if (!rawUrl || rawUrl !== rawUrl.trim()) {
    throw new OidcConfigurationError(`Brak wymaganego parametru konfiguracji OIDC: ${fieldName}.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OidcConfigurationError(`Parametr ${fieldName} musi być poprawnym adresem URL.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new OidcConfigurationError(
      `Parametr ${fieldName} nie może zawierać poświadczeń, query string ani fragmentu URL.`,
    );
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (isNodeProduction) {
    if (parsed.protocol !== 'https:' || isPrivateOrLinkLocalHost(host)) {
      throw new OidcConfigurationError(
        `W trybie produkcyjnym ${fieldName} wymaga publicznego adresu HTTPS.`,
      );
    }
    return parsed;
  }

  if (parsed.protocol === 'https:') {
    if (isPrivateOrLinkLocalHost(host) && !LOOPBACK_HOSTS.has(host)) {
      throw new OidcConfigurationError(
        `Parametr ${fieldName} nie może wskazywać prywatnego ani link-local adresu IP.`,
      );
    }
    return parsed;
  }

  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(host)) {
    return parsed;
  }

  throw new OidcConfigurationError(
    `Parametr ${fieldName} wymaga protokołu https: albo adresu loopback http:.`,
  );
}

function validateRedirectUri(rawRedirectUri: string, isNodeProduction: boolean): string {
  const parsed = parseTrustedOidcEndpoint(
    rawRedirectUri,
    'PAP_OIDC_REDIRECT_URI',
    isNodeProduction,
  );
  if (parsed.pathname !== '/api/session/oidc/callback') {
    throw new OidcConfigurationError(
      'Adres PAP_OIDC_REDIRECT_URI musi kończyć się dokładną ścieżką /api/session/oidc/callback.',
    );
  }
  return parsed.toString();
}

export function loadWebOidcClientConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WebOidcClientConfig {
  // Weryfikacja poprawności PAP_RUNTIME_MODE (rzuca błąd w trybie fail-closed dla nieznanych wartości)
  try {
    resolveWebRuntimeMode(env);
  } catch (err) {
    throw new OidcConfigurationError(
      err instanceof Error ? err.message : 'Niepoprawna konfiguracja PAP_RUNTIME_MODE.',
    );
  }

  const isNodeProduction = env['NODE_ENV'] === 'production';
  const rawIssuer = env['PAP_OIDC_ISSUER'];
  if (!rawIssuer || rawIssuer.trim().endsWith('/')) {
    throw new OidcConfigurationError(
      'Wymagany jest parametr PAP_OIDC_ISSUER (bez końcowego ukośnika).',
    );
  }
  const issuerUrl = parseTrustedOidcEndpoint(rawIssuer, 'PAP_OIDC_ISSUER', isNodeProduction);

  const clientId = env['PAP_OIDC_CLIENT_ID']?.trim();
  if (!clientId || /\s/.test(clientId)) {
    throw new OidcConfigurationError('Wymagany jest niepusty parametr PAP_OIDC_CLIENT_ID.');
  }

  const clientSecret = env['PAP_OIDC_CLIENT_SECRET']?.trim() || undefined;
  const rawAuthMethod = env['PAP_OIDC_TOKEN_AUTH_METHOD']?.trim();
  let tokenAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
  if (
    rawAuthMethod === 'client_secret_basic' ||
    rawAuthMethod === 'client_secret_post' ||
    rawAuthMethod === 'none'
  ) {
    tokenAuthMethod = rawAuthMethod;
  } else {
    tokenAuthMethod = clientSecret ? 'client_secret_basic' : 'none';
  }
  if (tokenAuthMethod !== 'none' && !clientSecret) {
    throw new OidcConfigurationError(
      `Metoda uwierzytelnienia klienta ${tokenAuthMethod} wymaga ustawienia PAP_OIDC_CLIENT_SECRET.`,
    );
  }

  const primaryRedirectUri = validateRedirectUri(
    env['PAP_OIDC_REDIRECT_URI'] ?? '',
    isNodeProduction,
  );
  const allowedRedirectSet = new Set<string>([primaryRedirectUri]);
  const extraRedirectsRaw = env['PAP_OIDC_ALLOWED_REDIRECT_URIS']?.trim();
  if (extraRedirectsRaw) {
    for (const candidate of extraRedirectsRaw.split(',')) {
      const trimmed = candidate.trim();
      if (trimmed) {
        allowedRedirectSet.add(validateRedirectUri(trimmed, isNodeProduction));
      }
    }
  }

  const rawScopes =
    env['PAP_OIDC_SCOPES']?.trim() ||
    'openid profile email pap:ui:full pap:mcp:read pap:mcp:prepare';
  const scopes = Array.from(
    new Set(
      rawScopes
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
  if (!scopes.includes('openid')) {
    throw new OidcConfigurationError('Zakresy PAP_OIDC_SCOPES muszą zawierać "openid".');
  }

  const checkSameIssuerOrigin = (endpoint: URL, name: string): string => {
    if (endpoint.origin !== issuerUrl.origin) {
      throw new OidcConfigurationError(
        `Punkt końcowy ${name} musi należeć do tego samego origin co PAP_OIDC_ISSUER.`,
      );
    }
    return endpoint.toString();
  };

  const authorizationEndpoint = env['PAP_OIDC_AUTHORIZATION_ENDPOINT']?.trim()
    ? checkSameIssuerOrigin(
        parseTrustedOidcEndpoint(
          env['PAP_OIDC_AUTHORIZATION_ENDPOINT'],
          'PAP_OIDC_AUTHORIZATION_ENDPOINT',
          isNodeProduction,
        ),
        'PAP_OIDC_AUTHORIZATION_ENDPOINT',
      )
    : undefined;
  const tokenEndpoint = env['PAP_OIDC_TOKEN_ENDPOINT']?.trim()
    ? checkSameIssuerOrigin(
        parseTrustedOidcEndpoint(
          env['PAP_OIDC_TOKEN_ENDPOINT'],
          'PAP_OIDC_TOKEN_ENDPOINT',
          isNodeProduction,
        ),
        'PAP_OIDC_TOKEN_ENDPOINT',
      )
    : undefined;
  const jwksUri = env['PAP_OIDC_JWKS_URI']?.trim()
    ? checkSameIssuerOrigin(
        parseTrustedOidcEndpoint(env['PAP_OIDC_JWKS_URI'], 'PAP_OIDC_JWKS_URI', isNodeProduction),
        'PAP_OIDC_JWKS_URI',
      )
    : undefined;
  const endSessionEndpoint = env['PAP_OIDC_END_SESSION_ENDPOINT']?.trim()
    ? checkSameIssuerOrigin(
        parseTrustedOidcEndpoint(
          env['PAP_OIDC_END_SESSION_ENDPOINT'],
          'PAP_OIDC_END_SESSION_ENDPOINT',
          isNodeProduction,
        ),
        'PAP_OIDC_END_SESSION_ENDPOINT',
      )
    : undefined;

  const rawAlgs = env['PAP_OIDC_ALLOWED_ALGORITHMS']?.trim();
  const allowedAlgorithms: AsymmetricJwsAlg[] = [];
  if (!rawAlgs) {
    allowedAlgorithms.push('RS256', 'ES256');
  } else {
    for (const part of rawAlgs.split(',')) {
      const alg = part.trim();
      if (!alg) continue;
      if (
        alg.toLowerCase() === 'none' ||
        alg.toUpperCase().startsWith('HS') ||
        !ALLOWED_ASYMMETRIC_ALGS.has(alg as AsymmetricJwsAlg)
      ) {
        throw new OidcConfigurationError(`Niedozwolony algorytm podpisu OIDC: "${alg}".`);
      }
      if (!allowedAlgorithms.includes(alg as AsymmetricJwsAlg)) {
        allowedAlgorithms.push(alg as AsymmetricJwsAlg);
      }
    }
    if (allowedAlgorithms.length === 0) {
      throw new OidcConfigurationError('Lista PAP_OIDC_ALLOWED_ALGORITHMS nie może być pusta.');
    }
  }

  return Object.freeze({
    issuer: rawIssuer.trim(),
    clientId,
    ...(clientSecret ? { clientSecret } : {}),
    tokenAuthMethod,
    redirectUri: primaryRedirectUri,
    allowedRedirectUris: Object.freeze(Array.from(allowedRedirectSet)),
    scopes: Object.freeze(scopes),
    ...(authorizationEndpoint ? { authorizationEndpoint } : {}),
    ...(tokenEndpoint ? { tokenEndpoint } : {}),
    ...(jwksUri ? { jwksUri } : {}),
    ...(endSessionEndpoint ? { endSessionEndpoint } : {}),
    allowedAlgorithms: Object.freeze(allowedAlgorithms),
    clockToleranceSeconds: 30,
    maxTokenAgeSeconds: 3_600,
    fetchTimeoutMs: 8_000,
  });
}

export function resolveRedirectUriForOrigin(
  config: WebOidcClientConfig,
  requestOrigin: string,
): string {
  const candidate = `${requestOrigin}/api/session/oidc/callback`;
  if (config.allowedRedirectUris.includes(candidate)) {
    return candidate;
  }
  throw new OidcSecurityValidationError(
    'redirect_uri_mismatch',
    'Adres zwrotny OIDC (redirect_uri) żądania nie znajduje się na zatwierdzonej białej liście.',
    400,
  );
}

/**
 * Weryfikuje origin kandydujący z żądania HTTP względem skonfigurowanej białej listy originów aplikacji
 * (`PAP_OIDC_REDIRECT_URI`, `PAP_OIDC_ALLOWED_REDIRECT_URIS`, `PAP_APP_PUBLIC_ORIGIN`), a w `LOCAL_DEV`
 * bez skonfigurowanego OIDC dopuszcza wyłącznie loopback (`localhost` / `127.0.0.1`).
 */
export function resolveTrustedApplicationOrigin(
  candidateOrigin: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  let normalizedCandidate: string;
  try {
    const u = new URL(candidateOrigin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return null;
    }
    normalizedCandidate = u.origin;
  } catch {
    return null;
  }

  const allowedOrigins = new Set<string>();
  const rawPrimary = env['PAP_OIDC_REDIRECT_URI']?.trim();
  const rawExtra = env['PAP_OIDC_ALLOWED_REDIRECT_URIS']?.trim();
  const rawPublicOrigin = env['PAP_APP_PUBLIC_ORIGIN']?.trim();

  for (const raw of [rawPrimary, ...(rawExtra ? rawExtra.split(',') : []), rawPublicOrigin]) {
    if (!raw?.trim()) continue;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        allowedOrigins.add(parsed.origin);
      }
    } catch {
      // Niepoprawne wpisy konfiguracji zostaną odrzucone przez loadWebOidcClientConfig.
    }
  }

  if (allowedOrigins.size > 0) {
    return allowedOrigins.has(normalizedCandidate) ? normalizedCandidate : null;
  }

  try {
    const mode = resolveWebRuntimeMode(env);
    if (mode === 'LOCAL_DEV' && env['NODE_ENV'] !== 'production') {
      const parsed = new URL(normalizedCandidate);
      if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
        return normalizedCandidate;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function generatePkceAndFlowMaterial(): {
  readonly state: string;
  readonly stateHash: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
} {
  const state = randomBytes(32).toString('base64url');
  const stateHash = sha256Hex(state);
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');

  return {
    state,
    stateHash,
    nonce,
    codeVerifier,
    codeChallenge,
  };
}

export function generateOpaqueSessionId(): {
  readonly sessionId: string;
  readonly sessionIdHash: string;
} {
  const sessionId = randomBytes(32).toString('base64url');
  return {
    sessionId,
    sessionIdHash: sha256Hex(sessionId),
  };
}

interface DiscoveryCacheEntry {
  readonly metadata: ResolvedOidcProviderMetadata;
  readonly expiresAtMs: number;
}

const discoveryCacheByIssuer = new Map<string, DiscoveryCacheEntry>();
const jwksCacheByUri = new Map<
  string,
  { readonly keysByKid: ReadonlyMap<string, Record<string, unknown>>; readonly expiresAtMs: number }
>();

export function clearWebOidcMetadataCachesForTesting(): void {
  discoveryCacheByIssuer.clear();
  jwksCacheByUri.clear();
}

export async function resolveOidcProviderMetadata(
  config: WebOidcClientConfig,
  options?: { readonly fetcher?: typeof fetch | undefined; readonly isProduction?: boolean | undefined },
): Promise<ResolvedOidcProviderMetadata> {
  if (config.authorizationEndpoint && config.tokenEndpoint && config.jwksUri) {
    return {
      issuer: config.issuer,
      authorizationEndpoint: config.authorizationEndpoint,
      tokenEndpoint: config.tokenEndpoint,
      jwksUri: config.jwksUri,
      ...(config.endSessionEndpoint ? { endSessionEndpoint: config.endSessionEndpoint } : {}),
    };
  }

  const nowMs = Date.now();
  const cached = discoveryCacheByIssuer.get(config.issuer);
  if (cached && cached.expiresAtMs > nowMs) {
    return cached.metadata;
  }

  const discoveryUrl = `${config.issuer}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await (options?.fetcher ?? fetch)(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
  } catch {
    throw new OidcServiceUnavailableError(
      'Dostawca tożsamości OIDC jest nieosiągalny (błąd pobierania dokumentu Discovery).',
    );
  }

  if (response.status !== 200) {
    throw new OidcServiceUnavailableError(
      `Dostawca tożsamości OIDC zwrócił błąd HTTP ${String(response.status)} dla dokumentu Discovery.`,
    );
  }

  let doc: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid discovery object');
    }
    doc = parsed as Record<string, unknown>;
  } catch {
    throw new OidcServiceUnavailableError('Nieprawidłowy dokument OIDC Discovery JSON.');
  }

  if (doc['issuer'] !== config.issuer) {
    throw new OidcSecurityValidationError(
      'invalid_issuer',
      'Niezgodność pola issuer w dokumencie OIDC Discovery z oczekiwanym PAP_OIDC_ISSUER.',
    );
  }

  const isProd = options?.isProduction ?? process.env.NODE_ENV === 'production';
  const issuerOrigin = new URL(config.issuer).origin;
  const checkEndpoint = (raw: unknown, fieldName: string): string => {
    if (typeof raw !== 'string') {
      throw new OidcServiceUnavailableError(`Brak pola ${fieldName} w dokumencie OIDC Discovery.`);
    }
    const parsed = parseTrustedOidcEndpoint(raw, fieldName, isProd);
    if (parsed.origin !== issuerOrigin) {
      throw new OidcSecurityValidationError(
        'untrusted_oidc_endpoint_origin',
        `Punkt końcowy ${fieldName} w OIDC Discovery wskazuje na niezaufany origin.`,
      );
    }
    return parsed.toString();
  };

  const metadata: ResolvedOidcProviderMetadata = {
    issuer: config.issuer,
    authorizationEndpoint:
      config.authorizationEndpoint ??
      checkEndpoint(doc['authorization_endpoint'], 'authorization_endpoint'),
    tokenEndpoint:
      config.tokenEndpoint ?? checkEndpoint(doc['token_endpoint'], 'token_endpoint'),
    jwksUri: config.jwksUri ?? checkEndpoint(doc['jwks_uri'], 'jwks_uri'),
    ...(config.endSessionEndpoint
      ? { endSessionEndpoint: config.endSessionEndpoint }
      : typeof doc['end_session_endpoint'] === 'string'
        ? { endSessionEndpoint: checkEndpoint(doc['end_session_endpoint'], 'end_session_endpoint') }
        : {}),
  };

  discoveryCacheByIssuer.set(config.issuer, {
    metadata,
    expiresAtMs: nowMs + 300_000,
  });
  return metadata;
}

async function fetchJwksKeysByKid(
  jwksUri: string,
  timeoutMs: number,
  forceRefresh: boolean,
  fetcher?: typeof fetch,
): Promise<ReadonlyMap<string, Record<string, unknown>>> {
  const nowMs = Date.now();
  const cached = jwksCacheByUri.get(jwksUri);
  if (!forceRefresh && cached && cached.expiresAtMs > nowMs) {
    return cached.keysByKid;
  }

  let response: Response;
  try {
    response = await (fetcher ?? fetch)(jwksUri, {
      method: 'GET',
      headers: { Accept: 'application/jwk-set+json, application/json' },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new OidcServiceUnavailableError('Nie udało się pobrać kluczy publicznych JWKS z IdP.');
  }

  if (response.status !== 200) {
    throw new OidcServiceUnavailableError(
      `Punkt końcowy JWKS zwrócił status HTTP ${String(response.status)}.`,
    );
  }

  let rawJwks: Record<string, unknown>;
  try {
    const parsed: unknown = await response.json();
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>)['keys'])
    ) {
      throw new Error('Invalid JWKS');
    }
    rawJwks = parsed as Record<string, unknown>;
  } catch {
    throw new OidcServiceUnavailableError('Nieprawidłowy dokument JWKS dostawcy OIDC.');
  }

  const keysArray = rawJwks['keys'] as unknown[];
  if (keysArray.length === 0 || keysArray.length > 64) {
    throw new OidcServiceUnavailableError('Dokument JWKS nie zawiera prawidłowego zbioru kluczy.');
  }

  const map = new Map<string, Record<string, unknown>>();
  for (const item of keysArray) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      continue;
    }
    const keyObj = item as Record<string, unknown>;
    const kid = keyObj['kid'];
    const kty = keyObj['kty'];
    const use = keyObj['use'];
    if (typeof kid !== 'string' || !kid.trim() || typeof kty !== 'string' || kty === 'oct') {
      continue;
    }
    if (PRIVATE_JWK_FIELDS.some((f) => f in keyObj) || (use !== undefined && use !== 'sig')) {
      continue;
    }
    if (map.has(kid)) {
      throw new OidcSecurityValidationError(
        'duplicate_jwks_kid',
        'Zduplikowany identyfikator klucza (kid) w zbiorze JWKS.',
      );
    }
    map.set(kid, keyObj);
  }

  if (map.size === 0) {
    throw new OidcServiceUnavailableError('Brak użytecznych kluczy weryfikacyjnych w JWKS.');
  }

  jwksCacheByUri.set(jwksUri, {
    keysByKid: map,
    expiresAtMs: nowMs + 300_000,
  });
  return map;
}

function verifyJwsSignatureWithNodeCrypto(
  alg: AsymmetricJwsAlg,
  jwk: Record<string, unknown>,
  signingInput: Buffer,
  signatureBytes: Buffer,
): boolean {
  if (jwk['alg'] !== undefined && jwk['alg'] !== alg) {
    return false;
  }

  const pubKey = createPublicKey({
    key: jwk as CryptoJsonWebKey,
    format: 'jwk',
  });

  switch (alg) {
    case 'RS256':
    case 'RS384':
    case 'RS512': {
      if (jwk['kty'] !== 'RSA') return false;
      const digest = alg === 'RS256' ? 'RSA-SHA256' : alg === 'RS384' ? 'RSA-SHA384' : 'RSA-SHA512';
      return cryptoVerify(digest, signingInput, pubKey, signatureBytes);
    }
    case 'PS256':
    case 'PS384':
    case 'PS512': {
      if (jwk['kty'] !== 'RSA') return false;
      const digest = alg === 'PS256' ? 'RSA-SHA256' : alg === 'PS384' ? 'RSA-SHA384' : 'RSA-SHA512';
      const saltLength = alg === 'PS256' ? 32 : alg === 'PS384' ? 48 : 64;
      return cryptoVerify(
        digest,
        signingInput,
        {
          key: pubKey,
          padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
          saltLength,
        },
        signatureBytes,
      );
    }
    case 'ES256':
    case 'ES384':
    case 'ES512': {
      if (jwk['kty'] !== 'EC') return false;
      const expectedCrv = alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521';
      const expectedSigLen = alg === 'ES256' ? 64 : alg === 'ES384' ? 96 : 132;
      if (jwk['crv'] !== expectedCrv || signatureBytes.length !== expectedSigLen) {
        return false;
      }
      const digest = alg === 'ES256' ? 'sha256' : alg === 'ES384' ? 'sha384' : 'sha512';
      return cryptoVerify(
        digest,
        signingInput,
        { key: pubKey, dsaEncoding: 'ieee-p1363' },
        signatureBytes,
      );
    }
    case 'EdDSA': {
      if (jwk['kty'] !== 'OKP' || jwk['crv'] !== 'Ed25519' || signatureBytes.length !== 64) {
        return false;
      }
      return cryptoVerify(null, signingInput, pubKey, signatureBytes);
    }
  }
}

function decodeJwtSegment(segment: string): Record<string, unknown> {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new OidcSecurityValidationError('malformed_id_token', 'Nieprawidłowy segment tokena JWS.');
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Not plain object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new OidcSecurityValidationError('malformed_id_token', 'Niepoprawny JSON w tokenie JWS.');
  }
}

export async function verifyOidcIdToken(input: {
  readonly rawIdToken: string;
  readonly config: WebOidcClientConfig;
  readonly jwksUri: string;
  readonly expectedNonce?: string | undefined;
  readonly now?: Date | undefined;
  readonly fetcher?: typeof fetch | undefined;
}): Promise<VerifiedOidcIdTokenClaims> {
  const { rawIdToken, config, jwksUri, expectedNonce, fetcher } = input;
  if (!rawIdToken || rawIdToken.length > 8_192 || /\s/.test(rawIdToken)) {
    throw new OidcSecurityValidationError('malformed_id_token', 'Brak lub uszkodzony ID Token OIDC.');
  }

  const parts = rawIdToken.split('.');
  if (parts.length !== 3) {
    throw new OidcSecurityValidationError(
      'malformed_id_token',
      'ID Token OIDC musi mieć trzy segmenty JWS.',
    );
  }
  const [headerSeg, payloadSeg, sigSeg] = parts as [string, string, string];
  if (!sigSeg || !/^[A-Za-z0-9_-]+$/.test(sigSeg)) {
    throw new OidcSecurityValidationError(
      'malformed_id_token',
      'Brak poprawnego podpisu kryptograficznego w ID Tokenie.',
    );
  }

  const header = decodeJwtSegment(headerSeg);
  for (const forbidden of FORBIDDEN_JWS_HEADER_FIELDS) {
    if (forbidden in header) {
      throw new OidcSecurityValidationError(
        'untrusted_key_header',
        'Niedozwolony nagłówek klucza w ID Tokenie OIDC.',
      );
    }
  }

  const alg = header['alg'];
  if (
    typeof alg !== 'string' ||
    alg.toLowerCase() === 'none' ||
    alg.toUpperCase().startsWith('HS') ||
    !config.allowedAlgorithms.includes(alg as AsymmetricJwsAlg)
  ) {
    throw new OidcSecurityValidationError(
      'unsupported_algorithm',
      'Algorytm podpisu ID Tokena jest niedozwolony.',
    );
  }

  if (header['typ'] !== undefined) {
    if (typeof header['typ'] !== 'string') {
      throw new OidcSecurityValidationError('invalid_token_type', 'Nieprawidłowy nagłówek typ.');
    }
    const normTyp = header['typ'].trim().toLowerCase().replace(/^application\//, '');
    if (FORBIDDEN_ID_TOKEN_HEADER_TYPS.has(normTyp)) {
      throw new OidcSecurityValidationError(
        'invalid_token_type',
        'Odrzucono próbę użycia tokena innego typu jako ID Tokena.',
      );
    }
  }

  const kid = header['kid'];
  if (typeof kid !== 'string' || !kid.trim()) {
    throw new OidcSecurityValidationError(
      'unknown_key',
      'ID Token nie zawiera identyfikatora klucza (kid).',
    );
  }

  const signingInput = Buffer.from(`${headerSeg}.${payloadSeg}`, 'ascii');
  const signatureBytes = Buffer.from(sigSeg, 'base64url');

  let keysByKid = await fetchJwksKeysByKid(jwksUri, config.fetchTimeoutMs, false, fetcher);
  let jwk = keysByKid.get(kid);
  if (!jwk) {
    keysByKid = await fetchJwksKeysByKid(jwksUri, config.fetchTimeoutMs, true, fetcher);
    jwk = keysByKid.get(kid);
  }
  if (!jwk) {
    throw new OidcSecurityValidationError(
      'unknown_key',
      'Nieznany klucz podpisu (kid) w zbiorze JWKS dostawcy OIDC.',
    );
  }

  let signatureValid: boolean;
  try {
    signatureValid = verifyJwsSignatureWithNodeCrypto(
      alg as AsymmetricJwsAlg,
      jwk,
      signingInput,
      signatureBytes,
    );
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    throw new OidcSecurityValidationError(
      'invalid_signature',
      'Podpis kryptograficzny ID Tokena jest nieprawidłowy.',
    );
  }

  const payload = decodeJwtSegment(payloadSeg);
  if ('events' in payload || payload['typ'] === 'Bearer') {
    throw new OidcSecurityValidationError(
      'invalid_token_type',
      'Odrzucono ładunek niebędący standardowym OIDC ID Tokenem.',
    );
  }

  if (payload['iss'] !== config.issuer) {
    throw new OidcSecurityValidationError(
      'invalid_issuer',
      'Pole iss w ID Tokenie nie odpowiada zaufanemu PAP_OIDC_ISSUER.',
    );
  }

  const sub = payload['sub'];
  if (typeof sub !== 'string' || !sub.trim() || sub !== sub.trim() || sub.length > 255) {
    throw new OidcSecurityValidationError(
      'invalid_subject',
      'Brak poprawnego pola sub w ID Tokenie OIDC.',
    );
  }

  const rawAud = payload['aud'];
  const audiences =
    typeof rawAud === 'string' && rawAud.trim()
      ? [rawAud]
      : Array.isArray(rawAud) &&
          rawAud.length > 0 &&
          rawAud.every((a): a is string => typeof a === 'string' && a.trim().length > 0)
        ? rawAud
        : null;

  if (!audiences || !audiences.includes(config.clientId)) {
    throw new OidcSecurityValidationError(
      'invalid_audience',
      'Pole aud w ID Tokenie nie zawiera identyfikatora klienta PAP_OIDC_CLIENT_ID.',
    );
  }

  const azp = payload['azp'];
  if (audiences.length > 1 && typeof azp !== 'string') {
    throw new OidcSecurityValidationError(
      'invalid_authorized_party',
      'ID Token z wieloma odbiorcami wymaga pola azp zgodnego z PAP_OIDC_CLIENT_ID.',
    );
  }
  if (azp !== undefined && azp !== config.clientId) {
    throw new OidcSecurityValidationError(
      'invalid_authorized_party',
      'Pole azp w ID Tokenie nie odpowiada identyfikatorowi klienta PAP_OIDC_CLIENT_ID.',
    );
  }

  if (expectedNonce !== undefined) {
    const tokenNonce = payload['nonce'];
    if (typeof tokenNonce !== 'string' || !tokenNonce) {
      throw new OidcSecurityValidationError(
        'invalid_nonce',
        'Brak wymaganego pola nonce w ID Tokenie OIDC.',
      );
    }
    const tokenNonceBuf = Buffer.from(tokenNonce, 'utf8');
    const expectedNonceBuf = Buffer.from(expectedNonce, 'utf8');
    if (
      tokenNonceBuf.length !== expectedNonceBuf.length ||
      !timingSafeEqual(tokenNonceBuf, expectedNonceBuf)
    ) {
      throw new OidcSecurityValidationError(
        'invalid_nonce',
        'Niezgodność kryptograficznego parametru nonce w ID Tokenie OIDC.',
      );
    }
  }

  const exp = payload['exp'];
  const iat = payload['iat'];
  const nbf = payload['nbf'];
  if (
    typeof exp !== 'number' ||
    !Number.isSafeInteger(exp) ||
    typeof iat !== 'number' ||
    !Number.isSafeInteger(iat) ||
    exp <= iat
  ) {
    throw new OidcSecurityValidationError(
      'invalid_token_timestamps',
      'Brak poprawnych znaczników czasu exp/iat w ID Tokenie OIDC.',
    );
  }
  if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isSafeInteger(nbf) || exp <= nbf)) {
    throw new OidcSecurityValidationError(
      'invalid_token_timestamps',
      'Nieprawidłowe pole nbf w ID Tokenie OIDC.',
    );
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const skew = config.clockToleranceSeconds;
  if (nowSeconds >= exp + skew) {
    throw new OidcSecurityValidationError('token_expired', 'ID Token OIDC wygasł.');
  }
  if (nbf !== undefined && nowSeconds + skew < nbf) {
    throw new OidcSecurityValidationError(
      'token_not_yet_valid',
      'ID Token OIDC nie jest jeszcze ważny (nbf).',
    );
  }
  if (iat > nowSeconds + skew || nowSeconds - iat > config.maxTokenAgeSeconds + skew) {
    throw new OidcSecurityValidationError(
      'invalid_issued_at',
      'Znacznik czasu wystawienia (iat) ID Tokena przekracza dopuszczalne okno.',
    );
  }

  const email =
    typeof payload['email'] === 'string' && payload['email'].includes('@')
      ? payload['email'].trim()
      : undefined;
  const emailVerified =
    typeof payload['email_verified'] === 'boolean' ? payload['email_verified'] : undefined;
  const displayName =
    typeof payload['name'] === 'string' && payload['name'].trim()
      ? payload['name'].trim()
      : typeof payload['preferred_username'] === 'string' && payload['preferred_username'].trim()
        ? payload['preferred_username'].trim()
        : undefined;
  const sessionId =
    typeof payload['sid'] === 'string' && payload['sid'].trim() ? payload['sid'].trim() : undefined;

  return {
    issuer: config.issuer,
    subject: sub,
    audiences,
    ...(typeof azp === 'string' ? { authorizedParty: azp } : {}),
    ...(typeof payload['nonce'] === 'string' ? { nonce: payload['nonce'] } : {}),
    ...(email ? { email } : {}),
    ...(emailVerified !== undefined ? { emailVerified } : {}),
    ...(displayName ? { displayName } : {}),
    ...(sessionId ? { sessionId } : {}),
    issuedAt: new Date(iat * 1000),
    expiresAt: new Date(exp * 1000),
  };
}

function buildTokenEndpointHeadersAndBody(
  config: WebOidcClientConfig,
  params: URLSearchParams,
): { readonly headers: Record<string, string>; readonly body: string } {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (config.tokenAuthMethod === 'client_secret_basic' && config.clientSecret) {
    const encodedId = encodeURIComponent(config.clientId);
    const encodedSecret = encodeURIComponent(config.clientSecret);
    const basic = Buffer.from(`${encodedId}:${encodedSecret}`, 'utf8').toString('base64');
    headers['Authorization'] = `Basic ${basic}`;
  } else {
    params.set('client_id', config.clientId);
    if (config.tokenAuthMethod === 'client_secret_post' && config.clientSecret) {
      params.set('client_secret', config.clientSecret);
    }
  }

  return {
    headers,
    body: params.toString(),
  };
}

export async function exchangeAuthorizationCode(input: {
  readonly code: string;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expectedNonce: string;
  readonly config: WebOidcClientConfig;
  readonly metadata: ResolvedOidcProviderMetadata;
  readonly now?: Date | undefined;
  readonly fetcher?: typeof fetch | undefined;
}): Promise<{
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly idToken: string;
  readonly accessTokenExpiresAt: Date;
  readonly scope?: string | undefined;
  readonly claims: VerifiedOidcIdTokenClaims;
}> {
  const params = new URLSearchParams();
  params.set('grant_type', 'authorization_code');
  params.set('code', input.code);
  params.set('redirect_uri', input.redirectUri);
  params.set('code_verifier', input.codeVerifier);

  const reqData = buildTokenEndpointHeadersAndBody(input.config, params);
  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(input.metadata.tokenEndpoint, {
      method: 'POST',
      headers: reqData.headers,
      body: reqData.body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(input.config.fetchTimeoutMs),
    });
  } catch {
    throw new OidcServiceUnavailableError(
      'Wymiana kodu autoryzacyjnego OIDC nie powiodła się — dostawca tożsamości jest nieosiągalny.',
    );
  }

  let tokenJson: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      tokenJson = parsed as Record<string, unknown>;
    }
  } catch {
    tokenJson = {};
  }

  if (response.status >= 500) {
    throw new OidcServiceUnavailableError(
      'Dostawca tożsamości OIDC zwrócił błąd wewnętrzny podczas wymiany kodu autoryzacyjnego.',
    );
  }

  if (response.status !== 200) {
    const oauthErr =
      typeof tokenJson['error'] === 'string' ? tokenJson['error'] : 'authorization_code_rejected';
    throw new OidcSecurityValidationError(
      oauthErr === 'invalid_grant' ? 'invalid_or_expired_authorization_code' : 'token_exchange_denied',
      'Kod autoryzacyjny OIDC jest nieprawidłowy, wygasł lub został już wcześniej wykorzystany.',
      401,
    );
  }

  const accessToken = tokenJson['access_token'];
  const tokenType = tokenJson['token_type'];
  const idToken = tokenJson['id_token'];
  if (
    typeof accessToken !== 'string' ||
    accessToken.trim().length < 16 ||
    typeof tokenType !== 'string' ||
    tokenType.trim().toLowerCase() !== 'bearer' ||
    typeof idToken !== 'string' ||
    idToken.trim().length < 16
  ) {
    throw new OidcSecurityValidationError(
      'invalid_token_response',
      'Odpowiedź punktu końcowego /token nie zawiera wymaganych tokenów Bearer/OIDC.',
      401,
    );
  }

  const claims = await verifyOidcIdToken({
    rawIdToken: idToken.trim(),
    config: input.config,
    jwksUri: input.metadata.jwksUri,
    expectedNonce: input.expectedNonce,
    now: input.now,
    fetcher: input.fetcher,
  });

  const nowMs = (input.now ?? new Date()).getTime();
  const rawExpiresIn = tokenJson['expires_in'];
  const expiresInSeconds =
    typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn) && rawExpiresIn > 0
      ? Math.min(Math.floor(rawExpiresIn), 86_400)
      : 300;
  const accessTokenExpiresAt = new Date(nowMs + expiresInSeconds * 1000);
  const refreshToken =
    typeof tokenJson['refresh_token'] === 'string' && tokenJson['refresh_token'].trim().length > 0
      ? tokenJson['refresh_token'].trim()
      : undefined;
  const scope =
    typeof tokenJson['scope'] === 'string' && tokenJson['scope'].trim().length > 0
      ? tokenJson['scope'].trim()
      : undefined;

  return {
    accessToken: accessToken.trim(),
    ...(refreshToken ? { refreshToken } : {}),
    idToken: idToken.trim(),
    accessTokenExpiresAt,
    ...(scope ? { scope } : {}),
    claims,
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function refreshBffSessionTokens(input: {
  readonly session: SerializedBffSessionRecord;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly apiBaseUrl?: string | undefined;
  readonly fetcher?: typeof fetch | undefined;
  readonly now?: Date | undefined;
}): Promise<
  | {
      readonly ok: true;
      readonly session: SerializedBffSessionRecord;
      readonly tokens: StoredBffTokenBundle;
      readonly alreadyAdvanced: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: 'missing_refresh_token' | 'refresh_rejected' | 'session_revoked_or_expired';
    }
> {
  const env = input.env ?? process.env;
  const aad = `bff_session:${input.session.sessionIdHash}`;
  const currentTokens = decryptBffPayload<StoredBffTokenBundle>(
    input.session.encryptedTokens,
    aad,
    env,
  );

  if (!currentTokens.refreshToken) {
    return { ok: false, reason: 'missing_refresh_token' };
  }

  let config: WebOidcClientConfig;
  try {
    config = loadWebOidcClientConfig(env);
  } catch {
    throw new OidcServiceUnavailableError(
      'Brak poprawnej konfiguracji klienta OIDC do odświeżenia sesji BFF.',
    );
  }

  const metadata = await resolveOidcProviderMetadata(config, {
    fetcher: input.fetcher,
    isProduction: env['NODE_ENV'] === 'production',
  });

  const params = new URLSearchParams();
  params.set('grant_type', 'refresh_token');
  params.set('refresh_token', currentTokens.refreshToken);
  const reqData = buildTokenEndpointHeadersAndBody(config, params);

  let response: Response;
  try {
    response = await (input.fetcher ?? fetch)(metadata.tokenEndpoint, {
      method: 'POST',
      headers: reqData.headers,
      body: reqData.body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(config.fetchTimeoutMs),
    });
  } catch {
    throw new OidcServiceUnavailableError(
      'Dostawca tożsamości OIDC jest nieosiągalny podczas odświeżania sesji BFF (tryb fail-closed).',
    );
  }

  if (response.status >= 500) {
    throw new OidcServiceUnavailableError(
      'Dostawca tożsamości OIDC zwrócił błąd wewnętrzny podczas odświeżania tokena (tryb fail-closed).',
    );
  }

  if (response.status !== 200) {
    // Obsługa współbieżnego odświeżania między wieloma instancjami Web BFF:
    // jeżeli równoległe żądanie z innej instancji właśnie zrotowało jednorazowy refresh_token u IdP,
    // w bazie danych generacja sesji (refreshGeneration) wzrosła lub wzrośnie w ciągu kilkudziesięciu ms.
    for (const delay of [0, 40, 100]) {
      if (delay > 0) {
        await sleepMs(delay);
      }
      const latest = await callApiBffSessionRpc<
        | { readonly ok: true; readonly session: SerializedBffSessionRecord }
        | { readonly ok: false; readonly reason: string }
      >(
        '/session/get',
        {
          sessionIdHash: input.session.sessionIdHash,
          ...(input.now ? { now: input.now.toISOString() } : {}),
        },
        { apiBaseUrl: input.apiBaseUrl, env, fetcher: input.fetcher },
      );

      if (
        latest.ok &&
        latest.session.refreshGeneration > input.session.refreshGeneration
      ) {
        const winningTokens = decryptBffPayload<StoredBffTokenBundle>(
          latest.session.encryptedTokens,
          aad,
          env,
        );
        return {
          ok: true,
          session: latest.session,
          tokens: winningTokens,
          alreadyAdvanced: true,
        };
      }
    }

    // Żadna inna instancja nie zrotowała sesji — refresh_token został cofnięty, wygasł lub uległ replayowi.
    await callApiBffSessionRpc(
      '/session/revoke',
      {
        sessionIdHash: input.session.sessionIdHash,
        ...(input.now ? { now: input.now.toISOString() } : {}),
      },
      { apiBaseUrl: input.apiBaseUrl, env, fetcher: input.fetcher },
    );
    return { ok: false, reason: 'refresh_rejected' };
  }

  let tokenJson: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      tokenJson = parsed as Record<string, unknown>;
    }
  } catch {
    tokenJson = {};
  }

  const newAccessToken = tokenJson['access_token'];
  const tokenType = tokenJson['token_type'];
  if (
    typeof newAccessToken !== 'string' ||
    newAccessToken.trim().length < 16 ||
    typeof tokenType !== 'string' ||
    tokenType.trim().toLowerCase() !== 'bearer'
  ) {
    await callApiBffSessionRpc(
      '/session/revoke',
      { sessionIdHash: input.session.sessionIdHash },
      { apiBaseUrl: input.apiBaseUrl, env, fetcher: input.fetcher },
    );
    return { ok: false, reason: 'refresh_rejected' };
  }

  let verifiedIdToken: string | undefined = currentTokens.idToken;
  if (typeof tokenJson['id_token'] === 'string' && tokenJson['id_token'].trim().length >= 16) {
    const candidateIdToken = tokenJson['id_token'].trim();
    const claims = await verifyOidcIdToken({
      rawIdToken: candidateIdToken,
      config,
      jwksUri: metadata.jwksUri,
      now: input.now,
      fetcher: input.fetcher,
    });
    if (claims.issuer !== input.session.issuer || claims.subject !== input.session.subject) {
      await callApiBffSessionRpc(
        '/session/revoke',
        { sessionIdHash: input.session.sessionIdHash },
        { apiBaseUrl: input.apiBaseUrl, env, fetcher: input.fetcher },
      );
      throw new OidcSecurityValidationError(
        'refresh_subject_mismatch',
        'Odświeżony ID Token wskazuje inną tożsamość (issuer, subject) niż aktywna sesja — sesja unieważniona.',
      );
    }
    verifiedIdToken = candidateIdToken;
  }

  const nextRefreshToken =
    typeof tokenJson['refresh_token'] === 'string' && tokenJson['refresh_token'].trim().length > 0
      ? tokenJson['refresh_token'].trim()
      : currentTokens.refreshToken;
  const nextScope =
    typeof tokenJson['scope'] === 'string' && tokenJson['scope'].trim().length > 0
      ? tokenJson['scope'].trim()
      : currentTokens.scope;

  const updatedBundle: StoredBffTokenBundle = {
    accessToken: newAccessToken.trim(),
    ...(nextRefreshToken ? { refreshToken: nextRefreshToken } : {}),
    ...(verifiedIdToken ? { idToken: verifiedIdToken } : {}),
    ...(nextScope ? { scope: nextScope } : {}),
  };

  const nowMs = (input.now ?? new Date()).getTime();
  const rawExpiresIn = tokenJson['expires_in'];
  const expiresInSeconds =
    typeof rawExpiresIn === 'number' && Number.isFinite(rawExpiresIn) && rawExpiresIn > 0
      ? Math.min(Math.floor(rawExpiresIn), 86_400)
      : 300;
  const accessTokenExpiresAt = new Date(nowMs + expiresInSeconds * 1000);
  const encryptedTokens = encryptBffPayload(updatedBundle, aad, env);

  const rotated = await callApiBffSessionRpc<
    | {
        readonly ok: true;
        readonly rotated: boolean;
        readonly alreadyAdvanced: boolean;
        readonly session: SerializedBffSessionRecord;
      }
    | { readonly ok: false; readonly reason: string }
  >(
    '/session/rotate',
    {
      sessionIdHash: input.session.sessionIdHash,
      expectedGeneration: input.session.refreshGeneration,
      encryptedTokens,
      accessTokenExpiresAt: accessTokenExpiresAt.toISOString(),
      ...(input.now ? { now: input.now.toISOString() } : {}),
    },
    { apiBaseUrl: input.apiBaseUrl, env, fetcher: input.fetcher },
  );

  if (!rotated.ok) {
    return { ok: false, reason: 'session_revoked_or_expired' };
  }

  const effectiveTokens = rotated.alreadyAdvanced
    ? decryptBffPayload<StoredBffTokenBundle>(rotated.session.encryptedTokens, aad, env)
    : updatedBundle;

  return {
    ok: true,
    session: rotated.session,
    tokens: effectiveTokens,
    alreadyAdvanced: rotated.alreadyAdvanced,
  };
}
