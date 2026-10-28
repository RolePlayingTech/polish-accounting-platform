export type OidcEnvironment = 'local' | 'test' | 'staging';

export type AsymmetricJwsAlgorithm =
  'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512' | 'ES256' | 'ES384' | 'ES512' | 'EdDSA';

export const ALLOWED_ASYMMETRIC_JWS_ALGORITHMS: ReadonlySet<AsymmetricJwsAlgorithm> = new Set([
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

export interface OidcVerifierConfig {
  readonly environment: OidcEnvironment;
  readonly issuer: string;
  readonly jwksUri: string;
  readonly audience: string;
  readonly allowedAlgorithms: readonly AsymmetricJwsAlgorithm[];
  readonly allowedTokenHeaderTypes: readonly string[];
  readonly allowedAuthorizedParties: readonly string[] | null;
  readonly requiredScopes: readonly string[];
  readonly clockToleranceSeconds: number;
  readonly maxTokenAgeSeconds: number;
  readonly jwksCacheTtlMs: number;
  readonly jwksRefreshCooldownMs: number;
  readonly jwksFetchTimeoutMs: number;
}

export class OidcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OidcConfigError';
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateOrLinkLocalHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    LOOPBACK_HOSTS.has(normalized) ||
    normalized.endsWith('.local') ||
    normalized.endsWith('.internal') ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  ) {
    return true;
  }

  const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  if (!ipv4Match) {
    return false;
  }
  const octets = ipv4Match.slice(1).map(Number);
  const [a, b] = octets as [number, number, number, number];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function parseTrustedEndpointUrl(
  rawUrl: string | undefined,
  fieldName: string,
  environment: OidcEnvironment,
): URL {
  if (!rawUrl || rawUrl !== rawUrl.trim()) {
    throw new OidcConfigError(`Wymagane jest poprawne ustawienie ${fieldName}.`);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new OidcConfigError(`${fieldName} musi być poprawnym adresem URL.`);
  }

  if (parsed.username || parsed.password) {
    throw new OidcConfigError(`${fieldName} nie może zawierać poświadczeń.`);
  }

  if (parsed.search || parsed.hash) {
    throw new OidcConfigError(`${fieldName} nie może zawierać parametrów zapytania ani fragmentu.`);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (environment === 'staging') {
    if (parsed.protocol !== 'https:') {
      throw new OidcConfigError(`Środowisko staging wymaga protokołu https: dla ${fieldName}.`);
    }
    if (isPrivateOrLinkLocalHost(host)) {
      throw new OidcConfigError(
        `Środowisko staging nie dopuszcza hostów loopback ani prywatnych w ${fieldName}.`,
      );
    }
    return parsed;
  }

  // local / test
  if (parsed.protocol === 'https:') {
    if (isPrivateOrLinkLocalHost(host) && !LOOPBACK_HOSTS.has(host)) {
      throw new OidcConfigError(
        `${fieldName} nie może wskazywać adresu link-local ani prywatnego.`,
      );
    }
    return parsed;
  }

  if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(host)) {
    return parsed;
  }

  throw new OidcConfigError(
    `W środowisku ${environment} ${fieldName} wymaga protokołu https: albo adresu loopback http:.`,
  );
}

function parseAllowedAlgorithms(raw: string | undefined): readonly AsymmetricJwsAlgorithm[] {
  if (!raw || raw.trim() === '') {
    return Object.freeze(['RS256', 'ES256'] as const);
  }

  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new OidcConfigError('Lista PAP_OIDC_ALLOWED_ALGORITHMS nie może być pusta.');
  }

  const validated: AsymmetricJwsAlgorithm[] = [];
  for (const alg of items) {
    if (
      alg.toLowerCase() === 'none' ||
      alg.toUpperCase().startsWith('HS') ||
      !ALLOWED_ASYMMETRIC_JWS_ALGORITHMS.has(alg as AsymmetricJwsAlgorithm)
    ) {
      throw new OidcConfigError(
        `Niedozwolony algorytm podpisu OIDC: "${alg}". Dozwolone są wyłącznie algorytmy asymetryczne.`,
      );
    }
    if (!validated.includes(alg as AsymmetricJwsAlgorithm)) {
      validated.push(alg as AsymmetricJwsAlgorithm);
    }
  }

  return Object.freeze(validated);
}

export function loadOidcVerifierConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OidcVerifierConfig {
  const environment = env.PAP_OIDC_ENV;

  if (environment !== 'local' && environment !== 'test' && environment !== 'staging') {
    if (env.NODE_ENV === 'production') {
      throw new OidcConfigError('Konfiguracja OIDC nie obsługuje niejawnego trybu produkcyjnego.');
    }
    throw new OidcConfigError('PAP_OIDC_ENV musi mieć wartość "local", "test" albo "staging".');
  }

  if (env.NODE_ENV === 'production' && environment !== 'staging') {
    throw new OidcConfigError(
      'NODE_ENV=production nie może używać konfiguracji PAP_OIDC_ENV=local/test.',
    );
  }

  if (environment === 'staging' && env.NODE_ENV !== 'production') {
    throw new OidcConfigError('Środowisko PAP_OIDC_ENV=staging wymaga NODE_ENV=production.');
  }

  const issuerUrl = parseTrustedEndpointUrl(env.PAP_OIDC_ISSUER, 'PAP_OIDC_ISSUER', environment);
  const jwksUrl = parseTrustedEndpointUrl(env.PAP_OIDC_JWKS_URI, 'PAP_OIDC_JWKS_URI', environment);

  if (issuerUrl.origin !== jwksUrl.origin) {
    throw new OidcConfigError(
      'PAP_OIDC_JWKS_URI musi należeć do tego samego origin co zaufany PAP_OIDC_ISSUER.',
    );
  }

  const rawIssuer = env.PAP_OIDC_ISSUER!.trim();
  if (rawIssuer.endsWith('/')) {
    throw new OidcConfigError('PAP_OIDC_ISSUER nie może kończyć się ukośnikiem.');
  }

  const audience = env.PAP_OIDC_AUDIENCE;
  if (!audience || audience.trim() === '' || audience !== audience.trim()) {
    throw new OidcConfigError('PAP_OIDC_AUDIENCE musi być niepustym identyfikatorem odbiorcy.');
  }

  const allowedAlgorithms = parseAllowedAlgorithms(env.PAP_OIDC_ALLOWED_ALGORITHMS);

  const rawClockTolerance = env.PAP_OIDC_CLOCK_TOLERANCE_SECONDS ?? '30';
  const clockToleranceSeconds = Number(rawClockTolerance);
  if (
    !Number.isInteger(clockToleranceSeconds) ||
    clockToleranceSeconds < 0 ||
    clockToleranceSeconds > 60
  ) {
    throw new OidcConfigError(
      'PAP_OIDC_CLOCK_TOLERANCE_SECONDS musi być liczbą całkowitą z przedziału 0..60.',
    );
  }

  const rawMaxAge = env.PAP_OIDC_MAX_TOKEN_AGE_SECONDS ?? '3600';
  const maxTokenAgeSeconds = Number(rawMaxAge);
  if (
    !Number.isInteger(maxTokenAgeSeconds) ||
    maxTokenAgeSeconds < 60 ||
    maxTokenAgeSeconds > 86_400
  ) {
    throw new OidcConfigError(
      'PAP_OIDC_MAX_TOKEN_AGE_SECONDS musi być liczbą całkowitą z przedziału 60..86400.',
    );
  }

  const allowedAuthorizedParties = env.PAP_OIDC_ALLOWED_AZP
    ? Object.freeze(
        env.PAP_OIDC_ALLOWED_AZP.split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      )
    : null;

  if (allowedAuthorizedParties !== null && allowedAuthorizedParties.length === 0) {
    throw new OidcConfigError('PAP_OIDC_ALLOWED_AZP nie może być pustą listą.');
  }

  const requiredScopes = env.PAP_OIDC_REQUIRED_SCOPES
    ? Object.freeze(
        env.PAP_OIDC_REQUIRED_SCOPES.split(/[\s,]+/)
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      )
    : Object.freeze([] as const);

  return Object.freeze({
    environment,
    issuer: rawIssuer,
    jwksUri: jwksUrl.toString(),
    audience,
    allowedAlgorithms,
    allowedTokenHeaderTypes: Object.freeze(['at+jwt', 'jwt']),
    allowedAuthorizedParties,
    requiredScopes,
    clockToleranceSeconds,
    maxTokenAgeSeconds,
    jwksCacheTtlMs: 300_000,
    jwksRefreshCooldownMs: 10_000,
    jwksFetchTimeoutMs: 5_000,
  });
}
