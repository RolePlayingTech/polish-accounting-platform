import {
  createHash,
  createHmac,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
} from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { POST as loginPost } from '../app/api/session/login/route.js';
import { POST as logoutPost } from '../app/api/session/logout/route.js';
import { POST as oidcAuthorizePost } from '../app/api/session/oidc/authorize/route.js';
import { GET as oidcCallbackGet } from '../app/api/session/oidc/callback/route.js';
import { POST as refreshPost } from '../app/api/session/refresh/route.js';
import {
  OidcConfigurationError,
  OidcSecurityValidationError,
  OidcServiceUnavailableError,
  clearWebOidcMetadataCachesForTesting,
  decryptBffPayload,
  encryptBffPayload,
  generatePkceAndFlowMaterial,
  loadWebOidcClientConfig,
  resolveRedirectUriForOrigin,
  signOidcFlowBindingCookie,
  verifyOidcFlowBindingCookie,
  verifyOidcIdToken,
} from '../lib/oidc-client.js';
import {
  RuntimeModeConfigError,
  isSyntheticPersonaLoginAllowed,
  resolveWebRuntimeMode,
  shouldUseSecureSessionCookie,
} from '../lib/runtime-mode.js';
import {
  BFF_SESSION_COOKIE_NAME,
  OIDC_FLOW_COOKIE_NAME,
  OIDC_TOKEN_COOKIE_NAME,
  SESSION_CONTEXT_COOKIE_NAME,
  resolveOpaqueBffSessionFromId,
} from '../lib/session.js';

async function readHttpBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

describe('Wave 2 Slice 2 — tryb uruchomieniowy PAP_RUNTIME_MODE, AEAD sesji BFF i walidacja OIDC ID Token + PKCE', () => {
  it('egzekwuje reguły fail-closed dla PAP_RUNTIME_MODE i blokuje syntetyczne persony poza LOCAL_DEV', async () => {
    expect(resolveWebRuntimeMode({ NODE_ENV: 'development' })).toBe('LOCAL_DEV');
    expect(resolveWebRuntimeMode({ NODE_ENV: 'production' })).toBe('PRODUCTION');
    expect(
      resolveWebRuntimeMode({ NODE_ENV: 'production', PAP_RUNTIME_MODE: 'STAGING_PRIVATE' }),
    ).toBe('STAGING_PRIVATE');

    expect(() =>
      resolveWebRuntimeMode({ NODE_ENV: 'production', PAP_RUNTIME_MODE: 'LOCAL_DEV' }),
    ).toThrow(RuntimeModeConfigError);
    expect(() =>
      resolveWebRuntimeMode({ NODE_ENV: 'development', PAP_RUNTIME_MODE: 'UNKNOWN_MODE' }),
    ).toThrow(RuntimeModeConfigError);

    expect(isSyntheticPersonaLoginAllowed({ NODE_ENV: 'development' })).toBe(true);
    expect(
      isSyntheticPersonaLoginAllowed({ NODE_ENV: 'test', PAP_RUNTIME_MODE: 'STAGING_PRIVATE' }),
    ).toBe(false);
    expect(
      isSyntheticPersonaLoginAllowed({ NODE_ENV: 'test', PAP_RUNTIME_MODE: 'PUBLIC_DEMO' }),
    ).toBe(false);
    expect(
      isSyntheticPersonaLoginAllowed({ NODE_ENV: 'test', PAP_RUNTIME_MODE: 'PRODUCTION' }),
    ).toBe(false);
    expect(isSyntheticPersonaLoginAllowed({ NODE_ENV: 'production' })).toBe(false);

    expect(
      shouldUseSecureSessionCookie('http://127.0.0.1:3000', {
        NODE_ENV: 'test',
        PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      }),
    ).toBe(true);

    // POST /api/session/login zwraca 403 synthetic_persona_disabled w STAGING_PRIVATE
    const prevMode = process.env.PAP_RUNTIME_MODE;
    process.env.PAP_RUNTIME_MODE = 'STAGING_PRIVATE';
    try {
      const req = new NextRequest('http://127.0.0.1:3000/api/session/login', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ personaId: 'jan-testowy' }),
      });
      const res = await loginPost(req);
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        reasonCode: 'synthetic_persona_disabled',
      });
    } finally {
      if (prevMode === undefined) {
        delete process.env.PAP_RUNTIME_MODE;
      } else {
        process.env.PAP_RUNTIME_MODE = prevMode;
      }
    }
  });

  it('szyfruje ładunki BFF algorytmem AES-256-GCM z wiązaniem AAD i zawodzi zamknięcie bez PAP_WEB_SESSION_SECRET', () => {
    const validEnv = {
      NODE_ENV: 'production',
      PAP_WEB_SESSION_SECRET: '0123456789abcdef0123456789abcdef-strong-secret',
    };

    const envelope = encryptBffPayload(
      { accessToken: 'secret-at', refreshToken: 'secret-rt' },
      'bff_session:hash-a',
      validEnv,
    );
    expect(envelope).not.toContain('secret-at');
    expect(envelope).not.toContain('secret-rt');

    expect(decryptBffPayload(envelope, 'bff_session:hash-a', validEnv)).toEqual({
      accessToken: 'secret-at',
      refreshToken: 'secret-rt',
    });

    // Próba przeszczepienia szyfrogramu do innej sesji (inny AAD) kończy się odmową weryfikacji tagu GCM
    expect(() => decryptBffPayload(envelope, 'bff_session:hash-b', validEnv)).toThrow(
      OidcSecurityValidationError,
    );

    // Brak lub zbyt krótki PAP_WEB_SESSION_SECRET w produkcji rzuca OidcServiceUnavailableError (503 fail-closed)
    expect(() =>
      encryptBffPayload({ a: 1 }, 'ctx', { NODE_ENV: 'production' }),
    ).toThrow(OidcServiceUnavailableError);
    expect(() =>
      encryptBffPayload({ a: 1 }, 'ctx', {
        NODE_ENV: 'production',
        PAP_WEB_SESSION_SECRET: 'za-krotki',
      }),
    ).toThrow(OidcServiceUnavailableError);

    // Ciasteczko wiążące przepływ OIDC PKCE (pap_oidc_flow) chroni przed Login CSRF
    const pkce = generatePkceAndFlowMaterial();
    const signedCookie = signOidcFlowBindingCookie(pkce.stateHash, validEnv);
    expect(verifyOidcFlowBindingCookie(signedCookie, pkce.stateHash, validEnv)).toBe(true);
    expect(verifyOidcFlowBindingCookie(signedCookie, 'f'.repeat(64), validEnv)).toBe(false);
    expect(verifyOidcFlowBindingCookie(undefined, pkce.stateHash, validEnv)).toBe(false);
  });

  it('weryfikuje podpisy asymetryczne ES256/RS256 oraz odrzuca błędny nonce, aud, iss, alg=none, at+jwt i niezaufany redirect_uri', async () => {
    clearWebOidcMetadataCachesForTesting();
    const issuer = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
    const config = loadWebOidcClientConfig({
      NODE_ENV: 'production',
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      PAP_OIDC_ISSUER: issuer,
      PAP_OIDC_CLIENT_ID: 'pap-web',
      PAP_OIDC_REDIRECT_URI: 'https://ksiegowosc.roleplayingtech.com/api/session/oidc/callback',
      PAP_OIDC_AUTHORIZATION_ENDPOINT: `${issuer}/protocol/openid-connect/auth`,
      PAP_OIDC_TOKEN_ENDPOINT: `${issuer}/protocol/openid-connect/token`,
      PAP_OIDC_JWKS_URI: `${issuer}/protocol/openid-connect/certs`,
    });

    expect(
      resolveRedirectUriForOrigin(config, 'https://ksiegowosc.roleplayingtech.com'),
    ).toBe('https://ksiegowosc.roleplayingtech.com/api/session/oidc/callback');
    expect(() =>
      resolveRedirectUriForOrigin(config, 'https://evil.attacker.example'),
    ).toThrow(OidcSecurityValidationError);

    expect(() =>
      loadWebOidcClientConfig({
        NODE_ENV: 'production',
        PAP_RUNTIME_MODE: 'PRODUCTION',
        PAP_OIDC_ISSUER: 'http://127.0.0.1:8080/realms/pap',
        PAP_OIDC_CLIENT_ID: 'pap-web',
        PAP_OIDC_REDIRECT_URI: 'https://ksiegowosc.roleplayingtech.com/api/session/oidc/callback',
      }),
    ).toThrow(OidcConfigurationError);

    const ecPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const ecJwk = {
      ...ecPair.publicKey.export({ format: 'jwk' }),
      kid: 'ec-key-1',
      use: 'sig',
      alg: 'ES256',
    };
    const rsaPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaJwk = {
      ...rsaPair.publicKey.export({ format: 'jwk' }),
      kid: 'rsa-key-1',
      use: 'sig',
      alg: 'RS256',
    };

    const mockJwksFetcher: typeof fetch = async () =>
      new Response(JSON.stringify({ keys: [ecJwk, rsaJwk] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const now = new Date('2026-11-09T15:00:00.000Z');
    const nowSec = Math.floor(now.getTime() / 1000);

    const signEcToken = (header: Record<string, unknown>, payload: Record<string, unknown>) => {
      const h = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
      const p = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const s = cryptoSign('sha256', Buffer.from(`${h}.${p}`, 'ascii'), {
        key: ecPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return `${h}.${p}.${s}`;
    };

    const signRsaToken = (header: Record<string, unknown>, payload: Record<string, unknown>) => {
      const h = Buffer.from(JSON.stringify(header), 'utf8').toString('base64url');
      const p = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const s = cryptoSign('RSA-SHA256', Buffer.from(`${h}.${p}`, 'ascii'), rsaPair.privateKey).toString(
        'base64url',
      );
      return `${h}.${p}.${s}`;
    };

    const validClaims = await verifyOidcIdToken({
      rawIdToken: signEcToken(
        { alg: 'ES256', typ: 'JWT', kid: 'ec-key-1' },
        {
          iss: issuer,
          sub: 'real-user-sub-01',
          aud: 'pap-web',
          nonce: 'expected-nonce-123',
          email: 'wlasciciel@firma.pl',
          name: 'Właściciel Firmy',
          iat: nowSec,
          exp: nowSec + 600,
        },
      ),
      config,
      jwksUri: config.jwksUri!,
      expectedNonce: 'expected-nonce-123',
      now,
      fetcher: mockJwksFetcher,
    });
    expect(validClaims.subject).toBe('real-user-sub-01');
    expect(validClaims.email).toBe('wlasciciel@firma.pl');

    const validRsa = await verifyOidcIdToken({
      rawIdToken: signRsaToken(
        { alg: 'RS256', typ: 'JWT', kid: 'rsa-key-1' },
        {
          iss: issuer,
          sub: 'rsa-user-sub-02',
          aud: ['pap-web', 'other-aud'],
          azp: 'pap-web',
          nonce: 'rsa-nonce-456',
          iat: nowSec,
          exp: nowSec + 600,
        },
      ),
      config,
      jwksUri: config.jwksUri!,
      expectedNonce: 'rsa-nonce-456',
      now,
      fetcher: mockJwksFetcher,
    });
    expect(validRsa.subject).toBe('rsa-user-sub-02');

    await expect(
      verifyOidcIdToken({
        rawIdToken: signEcToken(
          { alg: 'ES256', typ: 'JWT', kid: 'ec-key-1' },
          {
            iss: issuer,
            sub: 'real-user-sub-01',
            aud: 'pap-web',
            nonce: 'wrong-nonce',
            iat: nowSec,
            exp: nowSec + 600,
          },
        ),
        config,
        jwksUri: config.jwksUri!,
        expectedNonce: 'expected-nonce-123',
        now,
        fetcher: mockJwksFetcher,
      }),
    ).rejects.toMatchObject({ reasonCode: 'invalid_nonce' });

    await expect(
      verifyOidcIdToken({
        rawIdToken: signEcToken(
          { alg: 'ES256', typ: 'at+jwt', kid: 'ec-key-1' },
          {
            iss: issuer,
            sub: 'real-user-sub-01',
            aud: 'pap-web',
            nonce: 'expected-nonce-123',
            iat: nowSec,
            exp: nowSec + 600,
          },
        ),
        config,
        jwksUri: config.jwksUri!,
        expectedNonce: 'expected-nonce-123',
        now,
        fetcher: mockJwksFetcher,
      }),
    ).rejects.toMatchObject({ reasonCode: 'invalid_token_type' });

    await expect(
      verifyOidcIdToken({
        rawIdToken: signEcToken(
          { alg: 'ES256', typ: 'JWT', kid: 'ec-key-1' },
          {
            iss: issuer,
            sub: 'real-user-sub-01',
            aud: 'other-client',
            nonce: 'expected-nonce-123',
            iat: nowSec,
            exp: nowSec + 600,
          },
        ),
        config,
        jwksUri: config.jwksUri!,
        expectedNonce: 'expected-nonce-123',
        now,
        fetcher: mockJwksFetcher,
      }),
    ).rejects.toMatchObject({ reasonCode: 'invalid_audience' });
  });

  it('przeprowadza pełny przepływ Next.js BFF (authorize -> PKCE -> callback -> 2 instancje Web -> współbieżny refresh -> logout) i blokuje replay/CSRF/brak magazynu (503)', async () => {
    clearWebOidcMetadataCachesForTesting();
    const sharedSecret = randomBytes(32).toString('hex');
    const internalRpcHmacKey = Buffer.from(
      hkdfSync(
        'sha256',
        Buffer.from(sharedSecret, 'utf8'),
        Buffer.alloc(0),
        Buffer.from('pap-bff-internal-rpc-hmac-v1', 'utf8'),
        32,
      ),
    );

    const ecPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const kid = 'bff-e2e-es256';
    const publicJwk = {
      ...ecPair.publicKey.export({ format: 'jwk' }),
      kid,
      use: 'sig',
      alg: 'ES256',
    };

    const signJwt = (typ: string, payload: Record<string, unknown>) => {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256', typ, kid }), 'utf8').toString(
        'base64url',
      );
      const p = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const s = cryptoSign('sha256', Buffer.from(`${h}.${p}`, 'ascii'), {
        key: ecPair.privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return `${h}.${p}.${s}`;
    };

    const webOrigin1 = 'http://127.0.0.1:3101';
    const webOrigin2 = 'http://127.0.0.1:3102';
    const redirectUri1 = `${webOrigin1}/api/session/oidc/callback`;
    const redirectUri2 = `${webOrigin2}/api/session/oidc/callback`;

    // Współdzielony w pamięci serwer HTTP symulujący jednocześnie izolowanego dostawcę OIDC oraz API BFF
    const oidcCodes = new Map<
      string,
      {
        codeChallenge: string;
        nonce: string;
        redirectUri: string;
        subject: string;
        email: string;
        name: string;
        consumed: boolean;
        expired: boolean;
      }
    >();
    const oidcRefreshTokens = new Map<
      string,
      { subject: string; email: string; name: string; consumed: boolean }
    >();
    const bffStates = new Map<
      string,
      { encryptedPayload: string; expiresAt: string; consumed: boolean }
    >();
    const bffSessions = new Map<string, Record<string, unknown>>();
    let forceStoreUnavailable = false;
    let idpIssuer = '';

    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', idpIssuer || 'http://127.0.0.1');

      if (url.pathname === '/.well-known/openid-configuration') {
        sendJson(res, 200, {
          issuer: idpIssuer,
          authorization_endpoint: `${idpIssuer}/authorize`,
          token_endpoint: `${idpIssuer}/token`,
          jwks_uri: `${idpIssuer}/jwks`,
        });
        return;
      }
      if (url.pathname === '/jwks') {
        sendJson(res, 200, { keys: [publicJwk] });
        return;
      }
      if (url.pathname === '/token' && req.method === 'POST') {
        const params = new URLSearchParams(await readHttpBody(req));
        const grantType = params.get('grant_type');
        const nowSec = Math.floor(Date.now() / 1000);

        if (grantType === 'authorization_code') {
          const code = params.get('code') ?? '';
          const rec = oidcCodes.get(code);
          if (!rec || rec.consumed || rec.expired || rec.redirectUri !== params.get('redirect_uri')) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          rec.consumed = true;
          const verifier = params.get('code_verifier') ?? '';
          const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
          if (challenge !== rec.codeChallenge) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          const rt = `rt_${randomBytes(20).toString('base64url')}`;
          oidcRefreshTokens.set(rt, {
            subject: rec.subject,
            email: rec.email,
            name: rec.name,
            consumed: false,
          });
          sendJson(res, 200, {
            access_token: signJwt('at+jwt', {
              iss: idpIssuer,
              sub: rec.subject,
              aud: 'pap-api',
              azp: 'pap-web',
              scope: 'openid profile email pap:ui:full',
              iat: nowSec,
              exp: nowSec + 300,
            }),
            token_type: 'Bearer',
            expires_in: 300,
            refresh_token: rt,
            id_token: signJwt('JWT', {
              iss: idpIssuer,
              sub: rec.subject,
              aud: 'pap-web',
              azp: 'pap-web',
              nonce: rec.nonce,
              email: rec.email,
              name: rec.name,
              iat: nowSec,
              exp: nowSec + 600,
            }),
          });
          return;
        }

        if (grantType === 'refresh_token') {
          const rt = params.get('refresh_token') ?? '';
          const rec = oidcRefreshTokens.get(rt);
          if (!rec || rec.consumed) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }
          rec.consumed = true;
          const nextRt = `rt_${randomBytes(20).toString('base64url')}`;
          oidcRefreshTokens.set(nextRt, {
            subject: rec.subject,
            email: rec.email,
            name: rec.name,
            consumed: false,
          });
          sendJson(res, 200, {
            access_token: signJwt('at+jwt', {
              iss: idpIssuer,
              sub: rec.subject,
              aud: 'pap-api',
              azp: 'pap-web',
              scope: 'openid profile email pap:ui:full',
              iat: nowSec,
              exp: nowSec + 300,
            }),
            token_type: 'Bearer',
            expires_in: 300,
            refresh_token: nextRt,
          });
          return;
        }
      }

      if (url.pathname === '/api/v1/me/companies' && req.method === 'GET') {
        const auth = req.headers.authorization ?? '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
        ) as { sub: string };
        if (payload.sub === 'anna-sub') {
          sendJson(res, 200, {
            actor: {
              userId: '11111111-1111-4111-8111-000000000901',
              issuer: idpIssuer,
              subject: 'anna-sub',
              displayName: 'Anna Księgowa',
            },
            companies: [
              {
                tenantId: '11111111-1111-4111-8111-000000000911',
                legalEntityId: '11111111-1111-4111-8111-000000000921',
                companyName: 'Alfa Sp. z o.o.',
              },
            ],
          });
          return;
        }
        sendJson(res, 200, {
          actor: {
            userId: '22222222-2222-4222-8222-000000000902',
            issuer: idpIssuer,
            subject: 'bartosz-sub',
            displayName: 'Bartosz Doradca',
          },
          companies: [
            {
              tenantId: '22222222-2222-4222-8222-000000000912',
              legalEntityId: '22222222-2222-4222-8222-000000000922',
              companyName: 'Beta JDG',
            },
          ],
        });
        return;
      }

      if (url.pathname.startsWith('/api/v1/auth/bff/') && req.method === 'POST') {
        if (forceStoreUnavailable) {
          sendJson(res, 503, { reasonCode: 'auth_service_unavailable' });
          return;
        }
        const rawBody = await readHttpBody(req);
        const ts = String(req.headers['x-bff-timestamp'] ?? '');
        const sig = String(req.headers['x-bff-signature'] ?? '');
        const bodySha = createHash('sha256').update(rawBody, 'utf8').digest('hex');
        const expectedSig = createHmac('sha256', internalRpcHmacKey)
          .update(`POST|${url.pathname}|${ts}|${bodySha}`, 'utf8')
          .digest('hex');
        if (sig !== expectedSig) {
          sendJson(res, 401, { reasonCode: 'invalid_bff_internal_signature' });
          return;
        }

        const body = JSON.parse(rawBody) as Record<string, unknown>;
        const nowIso = new Date().toISOString();

        if (url.pathname.endsWith('/oidc-state/create')) {
          bffStates.set(String(body['stateHash']), {
            encryptedPayload: String(body['encryptedPayload']),
            expiresAt: String(body['expiresAt']),
            consumed: false,
          });
          sendJson(res, 200, { stateHash: body['stateHash'], createdAt: nowIso });
          return;
        }
        if (url.pathname.endsWith('/oidc-state/consume')) {
          const st = bffStates.get(String(body['stateHash']));
          if (!st) {
            sendJson(res, 200, { ok: false, reason: 'not_found' });
            return;
          }
          if (st.consumed) {
            sendJson(res, 200, { ok: false, reason: 'already_consumed' });
            return;
          }
          st.consumed = true;
          sendJson(res, 200, {
            ok: true,
            state: {
              stateHash: body['stateHash'],
              encryptedPayload: st.encryptedPayload,
              expiresAt: st.expiresAt,
              consumedAt: nowIso,
              createdAt: nowIso,
            },
          });
          return;
        }
        if (url.pathname.endsWith('/session/create')) {
          const rec = {
            ...body,
            refreshGeneration: 0,
            previousEncryptedTokens: null,
            previousAccessTokenExpiresAt: null,
            previousGraceUntil: null,
            revokedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          bffSessions.set(String(body['sessionIdHash']), rec);
          sendJson(res, 200, { ok: true, session: rec });
          return;
        }
        if (url.pathname.endsWith('/session/get')) {
          const rec = bffSessions.get(String(body['sessionIdHash']));
          if (!rec) {
            sendJson(res, 200, { ok: false, reason: 'not_found' });
            return;
          }
          if (rec['revokedAt']) {
            sendJson(res, 200, { ok: false, reason: 'revoked' });
            return;
          }
          sendJson(res, 200, { ok: true, session: rec });
          return;
        }
        if (url.pathname.endsWith('/session/rotate')) {
          const rec = bffSessions.get(String(body['sessionIdHash']));
          if (!rec || rec['revokedAt']) {
            sendJson(res, 200, { ok: false, reason: 'revoked' });
            return;
          }
          const expectedGen = Number(body['expectedGeneration']);
          const currentGen = Number(rec['refreshGeneration']);
          if (expectedGen === currentGen) {
            rec['refreshGeneration'] = currentGen + 1;
            rec['encryptedTokens'] = body['encryptedTokens'];
            rec['accessTokenExpiresAt'] = body['accessTokenExpiresAt'];
            rec['updatedAt'] = nowIso;
            sendJson(res, 200, {
              ok: true,
              rotated: true,
              alreadyAdvanced: false,
              session: rec,
            });
            return;
          }
          if (expectedGen === currentGen - 1) {
            sendJson(res, 200, {
              ok: true,
              rotated: false,
              alreadyAdvanced: true,
              session: rec,
            });
            return;
          }
          sendJson(res, 200, { ok: false, reason: 'generation_conflict' });
          return;
        }
        if (url.pathname.endsWith('/session/revoke')) {
          const rec = bffSessions.get(String(body['sessionIdHash']));
          if (rec) {
            rec['revokedAt'] = nowIso;
          }
          sendJson(res, 200, { revoked: Boolean(rec) });
          return;
        }
      }

      sendJson(res, 404, { error: 'not_found' });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    idpIssuer = `http://127.0.0.1:${String(port)}`;

    const savedEnv: Record<string, string | undefined> = {
      PAP_RUNTIME_MODE: process.env.PAP_RUNTIME_MODE,
      PAP_WEB_SESSION_SECRET: process.env.PAP_WEB_SESSION_SECRET,
      API_BASE_URL: process.env.API_BASE_URL,
      PAP_OIDC_ISSUER: process.env.PAP_OIDC_ISSUER,
      PAP_OIDC_CLIENT_ID: process.env.PAP_OIDC_CLIENT_ID,
      PAP_OIDC_REDIRECT_URI: process.env.PAP_OIDC_REDIRECT_URI,
      PAP_OIDC_ALLOWED_REDIRECT_URIS: process.env.PAP_OIDC_ALLOWED_REDIRECT_URIS,
    };

    process.env.PAP_RUNTIME_MODE = 'STAGING_PRIVATE';
    process.env.PAP_WEB_SESSION_SECRET = sharedSecret;
    process.env.API_BASE_URL = idpIssuer;
    process.env.PAP_OIDC_ISSUER = idpIssuer;
    process.env.PAP_OIDC_CLIENT_ID = 'pap-web';
    process.env.PAP_OIDC_REDIRECT_URI = redirectUri1;
    process.env.PAP_OIDC_ALLOWED_REDIRECT_URIS = `${redirectUri1},${redirectUri2}`;

    try {
      // 1. Ochrona CSRF na POST /api/session/oidc/authorize
      const csrfAuthorize = await oidcAuthorizePost(
        new NextRequest(`${webOrigin1}/api/session/oidc/authorize`, {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3101',
            origin: 'https://evil.example',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ returnTo: '/app' }),
        }),
      );
      expect(csrfAuthorize.status).toBe(403);

      // 2. Poprawne rozpoczęcie logowania Anny na Instancji Web #1
      const authInitRes = await oidcAuthorizePost(
        new NextRequest(`${webOrigin1}/api/session/oidc/authorize`, {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3101',
            origin: webOrigin1,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ returnTo: '/app/kpir' }),
        }),
      );
      expect(authInitRes.status).toBe(200);
      const flowCookie = authInitRes.cookies.get(OIDC_FLOW_COOKIE_NAME)?.value;
      expect(flowCookie).toBeTruthy();

      const authInitBody = (await authInitRes.json()) as { authorizationUrl: string };
      const parsedAuthUrl = new URL(authInitBody.authorizationUrl);
      expect(parsedAuthUrl.searchParams.get('code_challenge_method')).toBe('S256');
      const state = parsedAuthUrl.searchParams.get('state')!;
      const nonce = parsedAuthUrl.searchParams.get('nonce')!;
      const codeChallenge = parsedAuthUrl.searchParams.get('code_challenge')!;

      const validCode = `code_${randomUUID()}`;
      oidcCodes.set(validCode, {
        codeChallenge,
        nonce,
        redirectUri: redirectUri1,
        subject: 'anna-sub',
        email: 'anna@alfa.pl',
        name: 'Anna Księgowa',
        consumed: false,
        expired: false,
      });

      // 3. Próba Login CSRF (callback bez ciasteczka pap_oidc_flow) -> 401 bez zużycia stanu ofiary!
      const missingCookieCallback = await oidcCallbackGet(
        new NextRequest(
          `${redirectUri1}?code=${encodeURIComponent(validCode)}&state=${encodeURIComponent(state)}`,
          {
            headers: { host: '127.0.0.1:3101', accept: 'application/json' },
          },
        ),
      );
      expect(missingCookieCallback.status).toBe(401);
      await expect(missingCookieCallback.json()).resolves.toMatchObject({
        reasonCode: 'invalid_oidc_flow_binding',
      });

      // 4. Prawidłowy callback z ciasteczkiem pap_oidc_flow -> wystawia nieprzezroczyste Secure HttpOnly pap_session_id
      const okCallback = await oidcCallbackGet(
        new NextRequest(
          `${redirectUri1}?code=${encodeURIComponent(validCode)}&state=${encodeURIComponent(state)}`,
          {
            headers: {
              host: '127.0.0.1:3101',
              accept: 'application/json',
              cookie: `${OIDC_FLOW_COOKIE_NAME}=${flowCookie!}`,
            },
          },
        ),
      );
      expect(okCallback.status).toBe(200);
      const callbackJsonText = await okCallback.text();
      // Żadne surowe tokeny JWT ani refresh_token nie mogą pojawić się w odpowiedzi JSON ani w ciasteczkach!
      expect(callbackJsonText).not.toContain('eyJ');
      expect(callbackJsonText).not.toContain('rt_');

      const setCookieHeader = okCallback.headers.get('set-cookie') ?? '';
      expect(setCookieHeader).toContain(`${BFF_SESSION_COOKIE_NAME}=`);
      expect(setCookieHeader).toContain('HttpOnly');
      expect(setCookieHeader).toContain('Secure');
      expect(setCookieHeader).not.toContain('eyJ');
      expect(okCallback.cookies.get(OIDC_TOKEN_COOKIE_NAME)?.value ?? '').toBe('');
      expect(okCallback.cookies.get(SESSION_CONTEXT_COOKIE_NAME)?.value ?? '').toBe('');

      const annaOpaqueSessionId = okCallback.cookies.get(BFF_SESSION_COOKIE_NAME)?.value!;
      expect(annaOpaqueSessionId.length).toBeGreaterThanOrEqual(32);

      // Ponowne użycie tego samego state + ciasteczka (replay callbacku) -> 401 oidc_state_replayed
      const replayedCallback = await oidcCallbackGet(
        new NextRequest(
          `${redirectUri1}?code=${encodeURIComponent(validCode)}&state=${encodeURIComponent(state)}`,
          {
            headers: {
              host: '127.0.0.1:3101',
              accept: 'application/json',
              cookie: `${OIDC_FLOW_COOKIE_NAME}=${flowCookie!}`,
            },
          },
        ),
      );
      expect(replayedCallback.status).toBe(401);
      await expect(replayedCallback.json()).resolves.toMatchObject({
        reasonCode: 'oidc_state_replayed',
      });

      // 5. Druga instancja Web (#2, z wyczyszczonym cache pamięciowym) natychmiast rozpoznaje sesję Anny
      clearWebOidcMetadataCachesForTesting();
      const resolvedOnWeb2 = await resolveOpaqueBffSessionFromId(annaOpaqueSessionId);
      expect(resolvedOnWeb2).toMatchObject({
        authMethod: 'oidc',
        hasTenantMembership: true,
        context: {
          userId: '11111111-1111-4111-8111-000000000901',
          tenantId: '11111111-1111-4111-8111-000000000911',
          legalEntityId: '11111111-1111-4111-8111-000000000921',
        },
      });

      // 6. Współbieżne odświeżenie tokenów z Instancji Web #1 i Instancji Web #2 (Promise.all przeciwko jednorazowemu refresh_token!)
      const makeRefreshReq = (origin: string, host: string) =>
        new NextRequest(`${origin}/api/session/refresh`, {
          method: 'POST',
          headers: {
            host,
            origin,
            accept: 'application/json',
            'content-type': 'application/json',
            cookie: `${BFF_SESSION_COOKIE_NAME}=${annaOpaqueSessionId}`,
          },
          body: '{}',
        });

      const [ref1, ref2] = await Promise.all([
        refreshPost(makeRefreshReq(webOrigin1, '127.0.0.1:3101')),
        refreshPost(makeRefreshReq(webOrigin2, '127.0.0.1:3102')),
      ]);
      expect(ref1.status).toBe(200);
      expect(ref2.status).toBe(200);
      const refBody1 = (await ref1.json()) as { refreshGeneration: number };
      const refBody2 = (await ref2.json()) as { refreshGeneration: number };
      expect(refBody1.refreshGeneration).toBe(1);
      expect(refBody2.refreshGeneration).toBe(1);

      // 7. Tryb fail-closed (503 auth_service_unavailable), gdy magazyn sesji jest niedostępny
      forceStoreUnavailable = true;
      const unavailableRefresh = await refreshPost(makeRefreshReq(webOrigin1, '127.0.0.1:3101'));
      expect(unavailableRefresh.status).toBe(503);
      await expect(unavailableRefresh.json()).resolves.toMatchObject({
        reasonCode: 'auth_service_unavailable',
      });
      forceStoreUnavailable = false;

      // 8. Wylogowanie na Instancji Web #1 unieważnia sesję po stronie serwera — replay starego ciasteczka na Instancji Web #2 zawodzi zamknięcie!
      const logoutRes = await logoutPost(
        new NextRequest(`${webOrigin1}/api/session/logout`, {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3101',
            origin: webOrigin1,
            accept: 'application/json',
            'content-type': 'application/json',
            cookie: `${BFF_SESSION_COOKIE_NAME}=${annaOpaqueSessionId}`,
          },
          body: '{}',
        }),
      );
      expect(logoutRes.status).toBe(200);
      expect(await resolveOpaqueBffSessionFromId(annaOpaqueSessionId)).toBeNull();

      const refreshAfterLogoutOnWeb2 = await refreshPost(
        makeRefreshReq(webOrigin2, '127.0.0.1:3102'),
      );
      expect(refreshAfterLogoutOnWeb2.status).toBe(401);
    } finally {
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
