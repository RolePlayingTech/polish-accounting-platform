import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface IsolatedOidcTestUser {
  readonly subject: string;
  readonly email: string;
  readonly emailVerified?: boolean | undefined;
  readonly displayName: string;
  readonly scopes?: readonly string[] | undefined;
}

interface PendingAuthCodeRecord {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly nonce: string;
  readonly scopes: readonly string[];
  readonly user: IsolatedOidcTestUser;
  readonly expiresAtMs: number;
  consumed: boolean;
  readonly issuedRefreshTokens: Set<string>;
}

interface RefreshTokenRecord {
  readonly token: string;
  readonly clientId: string;
  readonly scopes: readonly string[];
  readonly user: IsolatedOidcTestUser;
  readonly sessionId: string;
  readonly expiresAtMs: number;
  consumed: boolean;
  revoked: boolean;
}

export interface IsolatedOidcIdpOptions {
  readonly port?: number | undefined;
  readonly interactiveConsentInBrowser?: boolean | undefined;
  readonly clientId?: string | undefined;
  readonly clientSecret?: string | undefined;
  readonly resourceAudience?: string | undefined;
  readonly allowedRedirectUris?: readonly string[] | undefined;
  readonly accessTokenTtlSeconds?: number | undefined;
  readonly codeTtlMs?: number | undefined;
}

export interface IsolatedOidcIdpHandle {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly resourceAudience: string;
  registerUser(user: IsolatedOidcTestUser): void;
  addAllowedRedirectUri(uri: string): void;
  setNextIdTokenOverride(
    override: Partial<Record<string, unknown>> | null,
  ): void;
  revokeRefreshToken(rawRefreshToken: string): void;
  rotateSigningKey(): void;
  issueDirectAccessToken(input: {
    readonly user: IsolatedOidcTestUser;
    readonly expiresInSeconds?: number | undefined;
    readonly audience?: string | undefined;
    readonly azp?: string | undefined;
  }): string;
  close(): Promise<void>;
}

function signEs256Jwt(
  privateKey: KeyObject,
  kid: string,
  typ: string,
  payload: Record<string, unknown>,
): string {
  const headerB64 = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ, kid }),
    'utf8',
  ).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'ascii');
  const sig = cryptoSign(
    'sha256',
    signingInput,
    { key: privateKey, dsaEncoding: 'ieee-p1363' },
  );
  return `${headerB64}.${payloadB64}.${sig.toString('base64url')}`;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body, 'utf8')),
  });
  res.end(body);
}

export async function startIsolatedOidcIdp(
  options: IsolatedOidcIdpOptions = {},
): Promise<IsolatedOidcIdpHandle> {
  const clientId = options.clientId ?? 'pap-web';
  const clientSecret = options.clientSecret;
  const resourceAudience = options.resourceAudience ?? 'pap-api';
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 300;
  const codeTtlMs = options.codeTtlMs ?? 60_000;

  const allowedRedirects = new Set<string>(options.allowedRedirectUris ?? []);
  const usersBySubject = new Map<string, IsolatedOidcTestUser>();
  const authCodes = new Map<string, PendingAuthCodeRecord>();
  const refreshTokens = new Map<string, RefreshTokenRecord>();
  let nextIdTokenOverride: Partial<Record<string, unknown>> | null = null;

  const generateSigningMaterial = () => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const kid = `idp-es256-${randomBytes(6).toString('hex')}`;
    const exported = pair.publicKey.export({ format: 'jwk' });
    const publicJwk = {
      ...exported,
      kid,
      use: 'sig',
      alg: 'ES256',
    };
    return { privateKey: pair.privateKey, kid, publicJwk };
  };

  let activeKey = generateSigningMaterial();
  const publicKeysHistory = [activeKey.publicJwk];
  let issuer = '';

  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', issuer || 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/.well-known/openid-configuration') {
        sendJson(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          id_token_signing_alg_values_supported: ['ES256'],
          token_endpoint_auth_methods_supported: [
            'none',
            'client_secret_basic',
            'client_secret_post',
          ],
        });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/jwks') {
        sendJson(res, 200, { keys: publicKeysHistory });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/authorize') {
        const responseType = url.searchParams.get('response_type');
        const reqClientId = url.searchParams.get('client_id');
        const redirectUri = url.searchParams.get('redirect_uri');
        const state = url.searchParams.get('state');
        const nonce = url.searchParams.get('nonce');
        const codeChallenge = url.searchParams.get('code_challenge');
        const codeChallengeMethod = url.searchParams.get('code_challenge_method');
        const rawScope =
          url.searchParams.get('scope') ??
          'openid profile email pap:ui:full pap:mcp:read pap:mcp:prepare';

        if (
          responseType !== 'code' ||
          reqClientId !== clientId ||
          !redirectUri ||
          !allowedRedirects.has(redirectUri) ||
          !state ||
          !nonce ||
          !codeChallenge ||
          codeChallengeMethod !== 'S256'
        ) {
          sendJson(res, 400, { error: 'invalid_request' });
          return;
        }

        if (url.searchParams.get('test_cancel') === '1') {
          const cb = new URL(redirectUri);
          cb.searchParams.set('error', 'access_denied');
          cb.searchParams.set('state', state);
          res.writeHead(302, { Location: cb.toString(), 'Cache-Control': 'no-store' });
          res.end();
          return;
        }

        const explicitSubject =
          url.searchParams.get('test_subject') ??
          req.headers['x-test-oidc-subject']?.toString();

        if (options.interactiveConsentInBrowser && !explicitSubject) {
          const userButtons = Array.from(usersBySubject.values())
            .map(
              (u) =>
                `<button type="submit" name="test_subject" value="${escapeHtml(u.subject)}" style="display:block;width:100%;margin-top:8px;padding:10px 14px;border-radius:6px;border:1px solid #1d5c42;background:#1d5c42;color:#fff;font-weight:600;cursor:pointer;">Zaloguj jako ${escapeHtml(u.displayName)} (${escapeHtml(u.email)})</button>`,
            )
            .join('');
          const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Izolowany dostawca OIDC (Test IdP)</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:24px;background:#faf9f5;color:#191c1a;"><h1 style="font-size:20px;">Zewnętrzny dostawca tożsamości OIDC</h1><p style="font-size:14px;color:#464c48;">Wybierz konto do uwierzytelnienia OAuth 2.0 + PKCE (S256):</p><form method="get" action="/authorize"><input type="hidden" name="response_type" value="${escapeHtml(responseType)}"><input type="hidden" name="client_id" value="${escapeHtml(reqClientId)}"><input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}"><input type="hidden" name="state" value="${escapeHtml(state)}"><input type="hidden" name="nonce" value="${escapeHtml(nonce)}"><input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}"><input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}"><input type="hidden" name="scope" value="${escapeHtml(rawScope)}">${userButtons}<button type="submit" name="test_cancel" value="1" style="display:block;width:100%;margin-top:12px;padding:8px 14px;border-radius:6px;border:1px solid #858177;background:#fff;color:#191c1a;cursor:pointer;">Anuluj logowanie</button></form></body></html>`;
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(html);
          return;
        }

        const loginSubject = explicitSubject ?? Array.from(usersBySubject.keys())[0];

        const user = loginSubject ? usersBySubject.get(loginSubject) : undefined;
        if (!user) {
          const cb = new URL(redirectUri);
          cb.searchParams.set('error', 'access_denied');
          cb.searchParams.set('state', state);
          res.writeHead(302, { Location: cb.toString(), 'Cache-Control': 'no-store' });
          res.end();
          return;
        }

        const code = `code_${randomBytes(24).toString('base64url')}`;
        const scopes = rawScope
          .split(/\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        authCodes.set(code, {
          code,
          clientId,
          redirectUri,
          codeChallenge,
          nonce,
          scopes,
          user,
          expiresAtMs: Date.now() + codeTtlMs,
          consumed: false,
          issuedRefreshTokens: new Set<string>(),
        });

        const cb = new URL(redirectUri);
        cb.searchParams.set('code', code);
        cb.searchParams.set('state', state);
        res.writeHead(302, { Location: cb.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }

      if (req.method === 'POST' && url.pathname === '/token') {
        const rawBody = await readRequestBody(req);
        const params = new URLSearchParams(rawBody);
        const grantType = params.get('grant_type');

        let authedClientId = params.get('client_id') ?? undefined;
        let authedSecret = params.get('client_secret') ?? undefined;
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Basic ')) {
          const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
          const sep = decoded.indexOf(':');
          if (sep > 0) {
            authedClientId = decodeURIComponent(decoded.slice(0, sep));
            authedSecret = decodeURIComponent(decoded.slice(sep + 1));
          }
        }

        if (authedClientId !== clientId) {
          sendJson(res, 401, { error: 'invalid_client' });
          return;
        }
        if (clientSecret && authedSecret !== clientSecret) {
          sendJson(res, 401, { error: 'invalid_client' });
          return;
        }

        const nowSec = Math.floor(Date.now() / 1000);

        if (grantType === 'authorization_code') {
          const code = params.get('code') ?? '';
          const redirectUri = params.get('redirect_uri') ?? '';
          const codeVerifier = params.get('code_verifier') ?? '';
          const record = authCodes.get(code);

          if (!record) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }

          if (record.consumed) {
            // RFC 6749 §10.5: wykrycie ponownego użycia kodu unieważnia powiązane refresh tokeny
            for (const rt of record.issuedRefreshTokens) {
              const rtRec = refreshTokens.get(rt);
              if (rtRec) {
                rtRec.revoked = true;
              }
            }
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'code_replayed' });
            return;
          }

          record.consumed = true;
          if (Date.now() > record.expiresAtMs || record.redirectUri !== redirectUri) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }

          const computedChallenge = createHash('sha256')
            .update(codeVerifier, 'ascii')
            .digest('base64url');
          if (!codeVerifier || computedChallenge !== record.codeChallenge) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'pkce_mismatch' });
            return;
          }

          const sid = randomUUID();
          const effectiveScopes = record.user.scopes ?? record.scopes;
          const scopeStr = effectiveScopes.join(' ');

          const accessToken = signEs256Jwt(activeKey.privateKey, activeKey.kid, 'at+jwt', {
            iss: issuer,
            sub: record.user.subject,
            aud: resourceAudience,
            azp: clientId,
            client_id: clientId,
            scope: scopeStr,
            iat: nowSec,
            exp: nowSec + accessTokenTtlSeconds,
            jti: randomUUID(),
            sid,
          });

          const idTokenClaims: Record<string, unknown> = {
            iss: issuer,
            sub: record.user.subject,
            aud: clientId,
            azp: clientId,
            nonce: record.nonce,
            email: record.user.email,
            email_verified: record.user.emailVerified ?? true,
            name: record.user.displayName,
            iat: nowSec,
            exp: nowSec + 900,
            sid,
            ...(nextIdTokenOverride ?? {}),
          };
          nextIdTokenOverride = null;

          const idToken = signEs256Jwt(activeKey.privateKey, activeKey.kid, 'JWT', idTokenClaims);

          const refreshToken = `rt_${randomBytes(32).toString('base64url')}`;
          refreshTokens.set(refreshToken, {
            token: refreshToken,
            clientId,
            scopes: effectiveScopes,
            user: record.user,
            sessionId: sid,
            expiresAtMs: Date.now() + 8 * 3600_000,
            consumed: false,
            revoked: false,
          });
          record.issuedRefreshTokens.add(refreshToken);

          sendJson(res, 200, {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: accessTokenTtlSeconds,
            refresh_token: refreshToken,
            id_token: idToken,
            scope: scopeStr,
          });
          return;
        }

        if (grantType === 'refresh_token') {
          const rawRt = params.get('refresh_token') ?? '';
          const rtRecord = refreshTokens.get(rawRt);
          if (
            !rtRecord ||
            rtRecord.consumed ||
            rtRecord.revoked ||
            Date.now() > rtRecord.expiresAtMs
          ) {
            sendJson(res, 400, { error: 'invalid_grant' });
            return;
          }

          // Jednorazowa rotacja refresh_token
          rtRecord.consumed = true;

          const scopeStr = rtRecord.scopes.join(' ');
          const newAccessToken = signEs256Jwt(activeKey.privateKey, activeKey.kid, 'at+jwt', {
            iss: issuer,
            sub: rtRecord.user.subject,
            aud: resourceAudience,
            azp: clientId,
            client_id: clientId,
            scope: scopeStr,
            iat: nowSec,
            exp: nowSec + accessTokenTtlSeconds,
            jti: randomUUID(),
            sid: rtRecord.sessionId,
          });

          const newIdToken = signEs256Jwt(activeKey.privateKey, activeKey.kid, 'JWT', {
            iss: issuer,
            sub: rtRecord.user.subject,
            aud: clientId,
            azp: clientId,
            email: rtRecord.user.email,
            email_verified: rtRecord.user.emailVerified ?? true,
            name: rtRecord.user.displayName,
            iat: nowSec,
            exp: nowSec + 900,
            sid: rtRecord.sessionId,
            ...(nextIdTokenOverride ?? {}),
          });
          nextIdTokenOverride = null;

          const nextRt = `rt_${randomBytes(32).toString('base64url')}`;
          refreshTokens.set(nextRt, {
            token: nextRt,
            clientId,
            scopes: rtRecord.scopes,
            user: rtRecord.user,
            sessionId: rtRecord.sessionId,
            expiresAtMs: Date.now() + 8 * 3600_000,
            consumed: false,
            revoked: false,
          });

          sendJson(res, 200, {
            access_token: newAccessToken,
            token_type: 'Bearer',
            expires_in: accessTokenTtlSeconds,
            refresh_token: nextRt,
            id_token: newIdToken,
            scope: scopeStr,
          });
          return;
        }

        sendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }

      sendJson(res, 404, { error: 'not_found' });
    } catch {
      sendJson(res, 500, { error: 'server_error' });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Nie udało się uruchomić izolowanego dostawcy OIDC na porcie loopback.');
  }

  issuer = `http://127.0.0.1:${String(address.port)}`;

  return {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    clientId,
    clientSecret,
    resourceAudience,
    registerUser(user) {
      usersBySubject.set(user.subject, user);
    },
    addAllowedRedirectUri(uri) {
      allowedRedirects.add(uri);
    },
    setNextIdTokenOverride(override) {
      nextIdTokenOverride = override;
    },
    revokeRefreshToken(rawRefreshToken) {
      const rec = refreshTokens.get(rawRefreshToken);
      if (rec) {
        rec.revoked = true;
      }
    },
    rotateSigningKey() {
      activeKey = generateSigningMaterial();
      publicKeysHistory.unshift(activeKey.publicJwk);
    },
    issueDirectAccessToken(input) {
      const nowSec = Math.floor(Date.now() / 1000);
      const scopes =
        input.user.scopes ?? [
          'openid',
          'profile',
          'email',
          'pap:ui:full',
          'pap:mcp:read',
          'pap:mcp:prepare',
        ];
      return signEs256Jwt(activeKey.privateKey, activeKey.kid, 'at+jwt', {
        iss: issuer,
        sub: input.user.subject,
        aud: input.audience ?? resourceAudience,
        azp: input.azp ?? clientId,
        client_id: input.azp ?? clientId,
        scope: scopes.join(' '),
        iat: nowSec,
        exp: nowSec + (input.expiresInSeconds ?? accessTokenTtlSeconds),
        jti: randomUUID(),
        sid: randomUUID(),
      });
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
