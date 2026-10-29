import { describe, expect, it, vi, beforeAll } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from 'jose';
import {
  JwksOidcAccessTokenVerifier,
  loadOidcVerifierConfig,
  OidcConfigError,
  type OidcVerifierConfig,
} from '../src/auth/index.js';

const ISSUER = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const JWKS_URI =
  'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/certs';
const AUDIENCE = 'pap-api';
const NOW = new Date('2026-10-28T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function baseConfig(overrides: Partial<OidcVerifierConfig> = {}): OidcVerifierConfig {
  return {
    environment: 'test',
    issuer: ISSUER,
    jwksUri: JWKS_URI,
    audience: AUDIENCE,
    allowedAlgorithms: ['RS256', 'ES256'],
    allowedTokenHeaderTypes: ['at+jwt', 'jwt'],
    allowedAuthorizedParties: ['pap-web-client'],
    requiredScopes: ['openid', 'pap:accounting'],
    clockToleranceSeconds: 30,
    maxTokenAgeSeconds: 3600,
    jwksCacheTtlMs: 300_000,
    jwksRefreshCooldownMs: 10_000,
    jwksFetchTimeoutMs: 5_000,
    ...overrides,
  };
}

function makeUnsecuredToken(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.synthetic-signature`;
}

describe('loadOidcVerifierConfig i JwksOidcAccessTokenVerifier (6D-2)', () => {
  let rsaPair1: Awaited<ReturnType<typeof generateKeyPair>>;
  let rsaPublicJwk: JWK;
  let rsaPair2: Awaited<ReturnType<typeof generateKeyPair>>;
  let ecPair1: Awaited<ReturnType<typeof generateKeyPair>>;
  let ecPublicJwk: JWK;

  beforeAll(async () => {
    rsaPair1 = await generateKeyPair('RS256');
    rsaPublicJwk = {
      ...(await exportJWK(rsaPair1.publicKey)),
      kid: 'kid-rsa-1',
      use: 'sig',
      alg: 'RS256',
    };

    rsaPair2 = await generateKeyPair('RS256');

    ecPair1 = await generateKeyPair('ES256');
    ecPublicJwk = {
      ...(await exportJWK(ecPair1.publicKey)),
      kid: 'kid-ec-1',
      use: 'sig',
      alg: 'ES256',
    };
  });

  async function signAccessToken(
    claims: Record<string, unknown> = {},
    headerOverrides: Record<string, unknown> = {},
    signer: CryptoKey = rsaPair1.privateKey,
  ): Promise<string> {
    const payload = {
      iss: ISSUER,
      sub: 'User-Sub-CaseSensitive-01',
      aud: AUDIENCE,
      azp: 'pap-web-client',
      typ: 'Bearer',
      scope: 'openid profile pap:accounting',
      iat: NOW_SEC - 60,
      exp: NOW_SEC + 300,
      jti: 'jti-synthetic-001',
      sid: 'sid-synthetic-001',
      ...claims,
    };

    return new SignJWT(payload)
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'at+jwt',
        kid: 'kid-rsa-1',
        ...headerOverrides,
      })
      .sign(signer);
  }

  describe('loadOidcVerifierConfig', () => {
    it('akceptuje poprawną konfigurację staging (HTTPS, wspólny origin) oraz local loopback', () => {
      const staging = loadOidcVerifierConfig({
        NODE_ENV: 'production',
        PAP_OIDC_ENV: 'staging',
        PAP_OIDC_ISSUER: ISSUER,
        PAP_OIDC_JWKS_URI: JWKS_URI,
        PAP_OIDC_AUDIENCE: AUDIENCE,
        PAP_OIDC_ALLOWED_ALGORITHMS: 'RS256,ES256',
        PAP_OIDC_ALLOWED_AZP: 'pap-web',
        PAP_OIDC_REQUIRED_SCOPES: 'openid pap:accounting',
      });
      expect(staging.environment).toBe('staging');
      expect(staging.allowedAlgorithms).toEqual(['RS256', 'ES256']);
      expect(staging.allowedAuthorizedParties).toEqual(['pap-web']);
      expect(staging.requiredScopes).toEqual(['openid', 'pap:accounting']);

      const local = loadOidcVerifierConfig({
        NODE_ENV: 'development',
        PAP_OIDC_ENV: 'local',
        PAP_OIDC_ISSUER: 'http://127.0.0.1:8080/realms/pap',
        PAP_OIDC_JWKS_URI: 'http://127.0.0.1:8080/realms/pap/protocol/openid-connect/certs',
        PAP_OIDC_AUDIENCE: 'pap-api,pap-mcp',
        PAP_OIDC_ALLOWED_ALGS: 'ES256',
      });
      expect(local.environment).toBe('local');
      expect(local.audience).toBe('pap-api');
      expect(local.audiences).toEqual(['pap-api', 'pap-mcp']);
      expect(local.allowedAlgorithms).toEqual(['ES256']);
      expect(local.requiredScopes).toEqual(['openid']);

      // Publiczna domena zaczynająca się od liter "fc" lub "fd" nie może być błędnie traktowana jako adres IPv6 ULA
      const fdDomain = loadOidcVerifierConfig({
        NODE_ENV: 'production',
        PAP_OIDC_ENV: 'staging',
        PAP_OIDC_ISSUER: 'https://fcorp.example.com/realms/pap',
        PAP_OIDC_JWKS_URI: 'https://fcorp.example.com/realms/pap/certs',
        PAP_OIDC_AUDIENCE: AUDIENCE,
      });
      expect(fdDomain.issuer).toBe('https://fcorp.example.com/realms/pap');
    });

    it.each([
      ['alg=none', { PAP_OIDC_ALLOWED_ALGORITHMS: 'none' }],
      ['alg=HS256', { PAP_OIDC_ALLOWED_ALGORITHMS: 'RS256,HS256' }],
      ['alias PAP_OIDC_ALLOWED_ALGS=none', { PAP_OIDC_ALLOWED_ALGS: 'none' }],
      [
        'sprzeczne PAP_OIDC_ALLOWED_ALGORITHMS i PAP_OIDC_ALLOWED_ALGS',
        { PAP_OIDC_ALLOWED_ALGORITHMS: 'RS256', PAP_OIDC_ALLOWED_ALGS: 'ES256' },
      ],
      ['puste PAP_OIDC_REQUIRED_SCOPES', { PAP_OIDC_REQUIRED_SCOPES: '   ' }],
      [
        'kolizja PAP_OIDC_AUDIENCE z PAP_OIDC_ALLOWED_AZP (ryzyko ID Token confusion)',
        { PAP_OIDC_AUDIENCE: 'pap-api,pap-web-client', PAP_OIDC_ALLOWED_AZP: 'pap-web-client' },
      ],
      ['pusty element na liście PAP_OIDC_AUDIENCE', { PAP_OIDC_AUDIENCE: 'pap-api,' }],
      ['inny origin JWKS niż issuer', { PAP_OIDC_JWKS_URI: 'https://evil.example.test/jwks.json' }],
      [
        'http na stagingu',
        {
          NODE_ENV: 'production',
          PAP_OIDC_ENV: 'staging',
          PAP_OIDC_ISSUER: 'http://id.ksiegowosc.roleplayingtech.com/realms/pap',
          PAP_OIDC_JWKS_URI: 'http://id.ksiegowosc.roleplayingtech.com/realms/pap/certs',
        },
      ],
      [
        'loopback na stagingu',
        {
          NODE_ENV: 'production',
          PAP_OIDC_ENV: 'staging',
          PAP_OIDC_ISSUER: 'https://127.0.0.1/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://127.0.0.1/realms/pap/certs',
        },
      ],
      [
        'IPv4-mapped IPv6 loopback na stagingu',
        {
          NODE_ENV: 'production',
          PAP_OIDC_ENV: 'staging',
          PAP_OIDC_ISSUER: 'https://[::ffff:127.0.0.1]/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://[::ffff:127.0.0.1]/realms/pap/certs',
        },
      ],
      [
        'IPv4-mapped IPv6 metadata link-local',
        {
          PAP_OIDC_ISSUER: 'https://[::ffff:169.254.169.254]/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://[::ffff:169.254.169.254]/realms/pap/certs',
        },
      ],
      [
        'adres IPv6 nieokreślony [::]',
        {
          PAP_OIDC_ISSUER: 'https://[::]/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://[::]/realms/pap/certs',
        },
      ],
      [
        'hostname z kropką końcową (localhost.)',
        {
          NODE_ENV: 'production',
          PAP_OIDC_ENV: 'staging',
          PAP_OIDC_ISSUER: 'https://localhost./realms/pap',
          PAP_OIDC_JWKS_URI: 'https://localhost./realms/pap/certs',
        },
      ],
      [
        'jednoczłonowa wewnętrzna nazwa hosta bez kropki',
        {
          NODE_ENV: 'production',
          PAP_OIDC_ENV: 'staging',
          PAP_OIDC_ISSUER: 'https://keycloak/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://keycloak/realms/pap/certs',
        },
      ],
      [
        'adres CGNAT 100.64.0.0/10',
        {
          PAP_OIDC_ISSUER: 'https://100.64.0.1/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://100.64.0.1/realms/pap/certs',
        },
      ],
      [
        'prywatne IP w JWKS/issuer',
        {
          PAP_OIDC_ISSUER: 'https://169.254.169.254/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://169.254.169.254/realms/pap/certs',
        },
      ],
      [
        'poświadczenia w URL',
        {
          PAP_OIDC_ISSUER: 'https://user:pass@id.ksiegowosc.roleplayingtech.com/realms/pap',
          PAP_OIDC_JWKS_URI: 'https://user:pass@id.ksiegowosc.roleplayingtech.com/realms/pap/certs',
        },
      ],
      ['zbyt duża tolerancja zegara', { PAP_OIDC_CLOCK_TOLERANCE_SECONDS: '120' }],
    ])('odrzuca niebezpieczną konfigurację OIDC: %s', (_label, overrides) => {
      expect(() =>
        loadOidcVerifierConfig({
          NODE_ENV: 'test',
          PAP_OIDC_ENV: 'test',
          PAP_OIDC_ISSUER: ISSUER,
          PAP_OIDC_JWKS_URI: JWKS_URI,
          PAP_OIDC_AUDIENCE: AUDIENCE,
          ...overrides,
        }),
      ).toThrow(OidcConfigError);
    });
  });

  describe('JwksOidcAccessTokenVerifier', () => {
    it('weryfikuje poprawny token RS256 oraz ES256 ze skonfigurowanego JWKS', async () => {
      const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({ keys: [rsaPublicJwk, ecPublicJwk] }),
      });

      const rsaToken = await signAccessToken();
      const rsaResult = await verifier.verifyAccessToken(rsaToken);
      expect(rsaResult).toEqual({
        ok: true,
        identity: {
          issuer: ISSUER,
          subject: 'User-Sub-CaseSensitive-01',
          tokenId: 'jti-synthetic-001',
          sessionId: 'sid-synthetic-001',
          scopes: ['openid', 'profile', 'pap:accounting'],
          issuedAt: new Date((NOW_SEC - 60) * 1000),
          expiresAt: new Date((NOW_SEC + 300) * 1000),
        },
      });

      const ecToken = await signAccessToken(
        { sub: 'EC-Subject-02' },
        { alg: 'ES256', kid: 'kid-ec-1' },
        ecPair1.privateKey,
      );
      const ecResult = await verifier.verifyAccessToken(ecToken);
      expect(ecResult).toMatchObject({
        ok: true,
        identity: { issuer: ISSUER, subject: 'EC-Subject-02' },
      });
    });

    it('odrzuca niepoprawny podpis oraz token podpisany innym kluczem o tym samym kid', async () => {
      const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
      });

      const wrongKeyToken = await signAccessToken({}, {}, rsaPair2.privateKey);
      await expect(verifier.verifyAccessToken(wrongKeyToken)).resolves.toEqual({
        ok: false,
        reason: 'invalid_signature',
      });

      const validToken = await signAccessToken();
      const tampered = `${validToken.slice(0, -4)}AAAA`;
      await expect(verifier.verifyAccessToken(tampered)).resolves.toEqual({
        ok: false,
        reason: 'invalid_signature',
      });
    });

    it.each([
      ['alg=none', { alg: 'none', typ: 'at+jwt', kid: 'kid-rsa-1' }, 'unsupported_algorithm'],
      ['alg=NONE', { alg: 'NONE', typ: 'at+jwt', kid: 'kid-rsa-1' }, 'unsupported_algorithm'],
      ['alg=HS256', { alg: 'HS256', typ: 'at+jwt', kid: 'kid-rsa-1' }, 'unsupported_algorithm'],
      [
        'alg=RS512 spoza dozwolonej listy',
        { alg: 'RS512', typ: 'at+jwt', kid: 'kid-rsa-1' },
        'unsupported_algorithm',
      ],
      [
        'jku w nagłówku',
        { alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1', jku: 'https://attacker.test/jwks.json' },
        'untrusted_key_header',
      ],
      [
        'jwk osadzone w nagłówku',
        { alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1', jwk: { kty: 'RSA' } },
        'untrusted_key_header',
      ],
      [
        'x5u w nagłówku',
        { alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1', x5u: 'https://attacker.test/cert.pem' },
        'untrusted_key_header',
      ],
      [
        'x5c w nagłówku',
        { alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1', x5c: ['MIIB...'] },
        'untrusted_key_header',
      ],
      [
        'crit w nagłówku',
        { alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1', crit: ['exp'] },
        'untrusted_key_header',
      ],
    ] as const)(
      'odrzuca niebezpieczny nagłówek JWS (%s) przed pobraniem klucza',
      async (_label, header, expectedReason) => {
        const fetchJwks = vi.fn();
        const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
          clock: { now: () => NOW },
          fetchJwks,
        });

        const token = makeUnsecuredToken(header, { iss: ISSUER, sub: 'u1', aud: AUDIENCE });
        await expect(verifier.verifyAccessToken(token)).resolves.toEqual({
          ok: false,
          reason: expectedReason,
        });
        expect(fetchJwks).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['nagłówek typ=id+jwt', {}, { typ: 'id+jwt' }],
      ['nagłówek typ=application/id+jwt', {}, { typ: 'application/id+jwt' }],
      ['nagłówek typ=dpop+jwt', {}, { typ: 'dpop+jwt' }],
      ['nagłówek typ=logout+jwt', {}, { typ: 'logout+jwt' }],
      ['payload typ=ID (Keycloak ID Token)', { typ: 'ID' }, { typ: 'JWT' }],
      ['payload typ=Refresh (Keycloak Refresh Token)', { typ: 'Refresh' }, { typ: 'JWT' }],
      ['payload z at_hash (ID Token)', { at_hash: 'xyz' }, { typ: 'JWT' }],
      ['payload z c_hash (ID Token)', { c_hash: 'abc' }, { typ: 'at+jwt' }],
      ['payload z s_hash (ID Token)', { s_hash: 'def' }, { typ: 'at+jwt' }],
      ['payload z nonce (ID Token)', { nonce: 'n-123' }, { typ: 'at+jwt' }],
      [
        'payload z events (Logout Token)',
        { events: { 'http://schemas.openid.net/event/backchannel-logout': {} } },
        { typ: 'JWT' },
      ],
    ])(
      'chroni przed pomyleniem ID/Refresh/Logout Tokena z Access Tokenem: %s',
      async (_label, claimOverrides, headerOverrides) => {
        const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
          clock: { now: () => NOW },
          fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        });

        const token = await signAccessToken(claimOverrides, headerOverrides);
        await expect(verifier.verifyAccessToken(token)).resolves.toEqual({
          ok: false,
          reason: 'invalid_token_type',
        });
      },
    );

    it('odrzuca standardowy OIDC Core ID Token (nagłówek typ=JWT bez at_hash, c_hash i bez payload typ=Bearer), a akceptuje RFC 9068 at+jwt oraz Keycloak Bearer', async () => {
      const verifier = new JwksOidcAccessTokenVerifier(
        baseConfig({
          requiredScopes: ['openid'],
        }),
        {
          clock: { now: () => NOW },
          fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        },
      );

      // 1. Standardowy OIDC Core 1.0 ID Token (np. z implicit/code flow bez at_hash/c_hash i bez niestandardowego payload.typ)
      const standardIdToken = await new SignJWT({
        iss: ISSUER,
        sub: 'User-Sub-CaseSensitive-01',
        aud: AUDIENCE,
        azp: 'pap-web-client',
        auth_time: NOW_SEC - 60,
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 300,
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'kid-rsa-1' })
        .sign(rsaPair1.privateKey);

      await expect(verifier.verifyAccessToken(standardIdToken)).resolves.toEqual({
        ok: false,
        reason: 'invalid_token_type',
      });

      // 2. Nawet jeśli niestandardowy IdP dołączy claim scope do tokenu z nagłówkiem typ=JWT, brak payload.typ="Bearer" musi go odrzucić
      const idTokenWithScopeClaim = await new SignJWT({
        iss: ISSUER,
        sub: 'User-Sub-CaseSensitive-01',
        aud: AUDIENCE,
        azp: 'pap-web-client',
        scope: 'openid profile pap:accounting',
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 300,
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'kid-rsa-1' })
        .sign(rsaPair1.privateKey);

      await expect(verifier.verifyAccessToken(idTokenWithScopeClaim)).resolves.toEqual({
        ok: false,
        reason: 'invalid_token_type',
      });

      // 3. RFC 9068 Access Token (nagłówek typ=at+jwt, bez payload.typ, z client_id zamiast azp) jest akceptowany
      const expectedJti = 'jti-0000000002';
      const rfc9068AccessToken = await new SignJWT({
        iss: ISSUER,
        sub: 'User-Sub-CaseSensitive-01',
        aud: AUDIENCE,
        client_id: 'pap-web-client',
        scope: 'openid pap:accounting',
        iat: NOW_SEC - 60,
        exp: NOW_SEC + 300,
        jti: expectedJti,
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'kid-rsa-1' })
        .sign(rsaPair1.privateKey);

      await expect(verifier.verifyAccessToken(rfc9068AccessToken)).resolves.toMatchObject({
        ok: true,
        identity: {
          issuer: ISSUER,
          subject: 'User-Sub-CaseSensitive-01',
          tokenId: expectedJti,
          scopes: ['openid', 'pap:accounting'],
        },
      });

      // 4. Keycloak Access Token (nagłówek typ=JWT oraz jawny payload.typ="Bearer") jest akceptowany
      const keycloakAccessToken = await signAccessToken(
        { typ: 'Bearer', scope: 'openid pap:accounting' },
        { typ: 'JWT' },
      );
      await expect(verifier.verifyAccessToken(keycloakAccessToken)).resolves.toMatchObject({
        ok: true,
      });
    });

    it.each([
      ['błędny issuer', { iss: 'https://evil-idp.example.test/realms/pap' }, 'invalid_issuer'],
      ['issuer z ukośnikiem na końcu', { iss: `${ISSUER}/` }, 'invalid_issuer'],
      ['błędny audience', { aud: 'other-service' }, 'invalid_audience'],
      ['tablica audience bez pap-api', { aud: ['svc-a', 'svc-b'] }, 'invalid_audience'],
      ['błędny azp', { azp: 'untrusted-client' }, 'invalid_authorized_party'],
      [
        'sprzeczne azp oraz client_id',
        { azp: 'pap-web-client', client_id: 'other-client' },
        'invalid_authorized_party',
      ],
      [
        'azp równe audience serwera zasobów (ryzyko pomylenia odbiorcy)',
        { azp: AUDIENCE },
        'invalid_authorized_party',
      ],
      [
        'wielu odbiorców aud bez azp',
        { aud: [AUDIENCE, 'other-api'], azp: undefined },
        'invalid_authorized_party',
      ],
      ['wygasły token (poza clockTolerance)', { exp: NOW_SEC - 30 }, 'token_expired'],
      [
        'token jeszcze nieważny (nbf w przyszłości poza clockTolerance)',
        { nbf: NOW_SEC + 31 },
        'token_not_yet_valid',
      ],
      ['iat w przyszłości poza clockTolerance', { iat: NOW_SEC + 31 }, 'invalid_issued_at'],
      ['brak wymaganego scope', { scope: 'openid profile' }, 'insufficient_scope'],
      ['brak claimu scope', { scope: undefined }, 'missing_required_claim'],
      ['pusty claim scope', { scope: '   ' }, 'missing_required_claim'],
      ['pusty sub', { sub: '   ' }, 'missing_required_claim'],
    ] as const)(
      'odrzuca token z niepoprawnym claimem (%s)',
      async (_label, claims, expectedReason) => {
        const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
          clock: { now: () => NOW },
          fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        });

        const token = await signAccessToken(claims);
        await expect(verifier.verifyAccessToken(token)).resolves.toEqual({
          ok: false,
          reason: expectedReason,
        });
      },
    );

    it('respektuje kontrolowane ograniczenie różnicy czasu (clockToleranceSeconds)', async () => {
      const verifier = new JwksOidcAccessTokenVerifier(baseConfig({ clockToleranceSeconds: 30 }), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
      });

      // Token wygasł 29 sekund temu — mieści się w 30s clock skew
      const slightlyExpired = await signAccessToken({ exp: NOW_SEC - 29 });
      await expect(verifier.verifyAccessToken(slightlyExpired)).resolves.toMatchObject({
        ok: true,
      });

      // Token ma nbf za 29 sekund — mieści się w 30s clock skew
      const slightlyFutureNbf = await signAccessToken({ nbf: NOW_SEC + 29 });
      await expect(verifier.verifyAccessToken(slightlyFutureNbf)).resolves.toMatchObject({
        ok: true,
      });
    });

    it('obsługuje bezpieczną rotację kluczy JWKS, cooldown oraz niedostępność źródła kluczy', async () => {
      let currentTimeMs = NOW.getTime();
      let jwksState: JWK[] = [rsaPublicJwk];
      let shouldFailJwks = false;

      const fetchJwks = vi.fn(async () => {
        if (shouldFailJwks) {
          throw new Error('Network connection refused');
        }
        return { keys: jwksState };
      });

      const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => new Date(currentTimeMs) },
        fetchJwks,
      });

      // Pierwsze wywołanie pobiera JWKS i buforuje klucz kid-rsa-1
      const token1 = await signAccessToken();
      await expect(verifier.verifyAccessToken(token1)).resolves.toMatchObject({ ok: true });
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // Drugie wywołanie z tym samym kid korzysta z bufora
      await expect(verifier.verifyAccessToken(token1)).resolves.toMatchObject({ ok: true });
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // Pojawia się zrotowany klucz kid-ec-1 po upływie cooldownu (15s)
      currentTimeMs += 15_000;
      jwksState = [ecPublicJwk];
      const rotatedToken = await signAccessToken(
        {},
        { alg: 'ES256', kid: 'kid-ec-1' },
        ecPair1.privateKey,
      );
      await expect(verifier.verifyAccessToken(rotatedToken)).resolves.toMatchObject({ ok: true });
      expect(fetchJwks).toHaveBeenCalledTimes(2);

      // Nieznany kid przed upływem cooldownu (np. 1s później) zwraca unknown_key bez kolejnego uderzenia w JWKS
      currentTimeMs += 1_000;
      const unknownKidToken = await signAccessToken({}, { kid: 'unknown-kid-999' });
      await expect(verifier.verifyAccessToken(unknownKidToken)).resolves.toEqual({
        ok: false,
        reason: 'unknown_key',
      });
      expect(fetchJwks).toHaveBeenCalledTimes(2);

      // Po wygaśnięciu TTL (6 minut później) i awarii źródła JWKS zwraca jwks_unavailable (fail-closed)
      currentTimeMs += 360_000;
      shouldFailJwks = true;
      await expect(verifier.verifyAccessToken(rotatedToken)).resolves.toEqual({
        ok: false,
        reason: 'jwks_unavailable',
      });
      expect(fetchJwks).toHaveBeenCalledTimes(3);

      // Kolejne żądanie 1s po awarii (przed upływem cooldownu 10s) nie bombarduje niedostępnego IdP
      currentTimeMs += 1_000;
      await expect(verifier.verifyAccessToken(rotatedToken)).resolves.toEqual({
        ok: false,
        reason: 'jwks_unavailable',
      });
      expect(fetchJwks).toHaveBeenCalledTimes(3);
    });

    it('odświeża JWKS z poszanowaniem cooldownu, gdy IdP rotuje materiał klucza z ponownym użyciem tego samego kid', async () => {
      let currentTimeMs = NOW.getTime();
      const rsaPublicJwk2: JWK = {
        ...(await exportJWK(rsaPair2.publicKey)),
        kid: 'kid-rsa-1',
        use: 'sig',
        alg: 'RS256',
      };
      let jwksState: JWK[] = [rsaPublicJwk];
      const fetchJwks = vi.fn(async () => ({ keys: jwksState }));

      const verifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => new Date(currentTimeMs) },
        fetchJwks,
      });

      const tokenKey1 = await signAccessToken({}, { kid: 'kid-rsa-1' }, rsaPair1.privateKey);
      await expect(verifier.verifyAccessToken(tokenKey1)).resolves.toMatchObject({ ok: true });
      expect(fetchJwks).toHaveBeenCalledTimes(1);

      // Po upływie cooldownu (15s) IdP podmienia klucz pod tym samym kid-rsa-1
      currentTimeMs += 15_000;
      jwksState = [rsaPublicJwk2];
      const tokenKey2 = await signAccessToken({}, { kid: 'kid-rsa-1' }, rsaPair2.privateKey);
      await expect(verifier.verifyAccessToken(tokenKey2)).resolves.toMatchObject({ ok: true });
      expect(fetchJwks).toHaveBeenCalledTimes(2);
    });

    it('obsługuje wiele dozwolonych odbiorców (audiences) skonfigurowanych w OidcVerifierConfig', async () => {
      const verifier = new JwksOidcAccessTokenVerifier(
        baseConfig({
          audience: 'pap-api',
          audiences: ['pap-api', 'pap-mcp'],
        }),
        {
          clock: { now: () => NOW },
          fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        },
      );

      const mcpToken = await signAccessToken({ aud: 'pap-mcp', azp: 'pap-web-client' });
      await expect(verifier.verifyAccessToken(mcpToken)).resolves.toMatchObject({ ok: true });
    });

    it('przerywa strumieniowe pobieranie JWKS powyżej limitu 64 KiB bez buforowania całości w pamięci i odrzuca JWK z parametrami prywatnymi lub błędnym key_ops', async () => {
      const token = await signAccessToken();
      let streamCancelled = false;
      const chunk = new Uint8Array(20_000).fill(0x61); // 'a'

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        let pulls = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls <= 10) {
              controller.enqueue(chunk);
            } else {
              controller.close();
            }
          },
          cancel() {
            streamCancelled = true;
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

      try {
        const streamingVerifier = new JwksOidcAccessTokenVerifier(baseConfig(), {
          clock: { now: () => NOW },
        });
        await expect(streamingVerifier.verifyAccessToken(token)).resolves.toEqual({
          ok: false,
          reason: 'jwks_unavailable',
        });
        expect(streamCancelled).toBe(true);
      } finally {
        fetchSpy.mockRestore();
      }

      // Klucz zawierający prywatny parametr 'd' lub niedozwolone key_ops jest odrzucany
      const verifierWithInvalidJwks = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({
          keys: [
            { ...rsaPublicJwk, d: 'private-exponent-leak' },
            { ...ecPublicJwk, key_ops: ['encrypt'] },
            { ...ecPublicJwk, kid: 'kid-ec-sign', key_ops: ['sign', 'verify'] },
          ],
        }),
      });
      await expect(verifierWithInvalidJwks.verifyAccessToken(token)).resolves.toEqual({
        ok: false,
        reason: 'jwks_unavailable',
      });
    });

    it('odrzuca cofniętą sesję lub token zgłoszony przez revocationChecker (oraz przy błędzie checkera)', async () => {
      const revokedToken = await signAccessToken({ sid: 'revoked-session-1' });

      const verifierRevoked = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        revocationChecker: {
          isRevoked: async ({ sessionId }) => sessionId === 'revoked-session-1',
        },
      });
      await expect(verifierRevoked.verifyAccessToken(revokedToken)).resolves.toEqual({
        ok: false,
        reason: 'subject_revoked_or_disabled',
      });

      const verifierThrowing = new JwksOidcAccessTokenVerifier(baseConfig(), {
        clock: { now: () => NOW },
        fetchJwks: async () => ({ keys: [rsaPublicJwk] }),
        revocationChecker: {
          isRevoked: async () => {
            throw new Error('Revocation store down');
          },
        },
      });
      await expect(verifierThrowing.verifyAccessToken(revokedToken)).resolves.toEqual({
        ok: false,
        reason: 'subject_revoked_or_disabled',
      });
    });

    it('odrzuca każde żądanie, gdy konfiguracja OIDC jest niedostępna (brak trybu dev-bypass)', async () => {
      const unconfigured = new JwksOidcAccessTokenVerifier(null);
      const token = await signAccessToken();
      await expect(unconfigured.verifyAccessToken(token)).resolves.toEqual({
        ok: false,
        reason: 'oidc_configuration_unavailable',
      });
    });
  });
});
