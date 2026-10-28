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
        PAP_OIDC_AUDIENCE: AUDIENCE,
      });
      expect(local.environment).toBe('local');
    });

    it.each([
      ['alg=none', { PAP_OIDC_ALLOWED_ALGORITHMS: 'none' }],
      ['alg=HS256', { PAP_OIDC_ALLOWED_ALGORITHMS: 'RS256,HS256' }],
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

    it.each([
      ['błędny issuer', { iss: 'https://evil-idp.example.test/realms/pap' }, 'invalid_issuer'],
      ['issuer z ukośnikiem na końcu', { iss: `${ISSUER}/` }, 'invalid_issuer'],
      ['błędny audience', { aud: 'other-service' }, 'invalid_audience'],
      ['tablica audience bez pap-api', { aud: ['svc-a', 'svc-b'] }, 'invalid_audience'],
      ['błędny azp', { azp: 'untrusted-client' }, 'invalid_authorized_party'],
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
