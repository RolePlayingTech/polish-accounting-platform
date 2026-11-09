import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CreateCompanyResponseSchema, GetMyCompaniesResponseSchema } from '@pap/contracts';
import {
  DatabaseConfigError,
  PostgresUserIdentityStore,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  computeBffInternalSignatureHex,
  resolveBffInternalHmacKey,
} from '../src/auth/bff-session.controller.js';
import { startIsolatedOidcIdp, type IsolatedOidcIdpHandle } from './helpers/isolated-oidc-idp.js';

interface DrizzleJournalFile {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
  }[];
}

async function applySqlMigrationsToSchema(
  ownerClient: ReturnType<typeof connectDatabase>['client'],
): Promise<void> {
  const drizzleDir = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));
  const journalRaw = readFileSync(`${drizzleDir}/meta/_journal.json`, 'utf8');
  const journal = JSON.parse(journalRaw) as DrizzleJournalFile;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of ordered) {
    const sqlText = readFileSync(`${drizzleDir}/${entry.tag}.sql`, 'utf8');
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await ownerClient.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
    });
  }
}

async function bootApiInstance(
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly app: NestFastifyApplication; readonly baseUrl: string }> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env),
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  if (!addr || typeof addr === 'string') {
    await app.close();
    throw new Error('Nie udało się zbindować efemerycznego portu TCP dla @pap/api.');
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${String(addr.port)}`,
  };
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function callBffInternalRpc<T>(
  baseUrl: string,
  bffSecret: string,
  subPath: string,
  body: Record<string, unknown>,
): Promise<{ readonly status: number; readonly json: T }> {
  const hmacKey = resolveBffInternalHmacKey({
    NODE_ENV: 'production',
    PAP_WEB_SESSION_SECRET: bffSecret,
  })!;
  const pathname = `/api/v1/auth/bff${subPath}`;
  const timestampMs = String(Date.now());
  const signatureHex = computeBffInternalSignatureHex(
    hmacKey,
    'POST',
    pathname,
    timestampMs,
    body,
  );
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-bff-timestamp': timestampMs,
      'x-bff-signature': signatureHex,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as T;
  return { status: res.status, json };
}

async function executeOidcAuthorizationCodePkceFlow(
  idp: IsolatedOidcIdpHandle,
  redirectUri: string,
  testSubject: string,
): Promise<{
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
  readonly code: string;
}> {
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier, 'ascii').digest('base64url');

  const authUrl = new URL(idp.authorizationEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', idp.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set(
    'scope',
    'openid profile email pap:ui:full pap:mcp:read pap:mcp:prepare',
  );
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('test_subject', testSubject);

  const authRes = await fetch(authUrl, { redirect: 'manual' });
  expect(authRes.status).toBe(302);
  const location = authRes.headers.get('location')!;
  const callbackUrl = new URL(location);
  expect(callbackUrl.searchParams.get('state')).toBe(state);
  const code = callbackUrl.searchParams.get('code');
  expect(code).toBeTruthy();

  return {
    state,
    nonce,
    codeVerifier,
    code: code!,
  };
}

describe('Wave 2 Slice 2 — OIDC Authorization Code + PKCE, współdzielone sesje BFF między 2 instancjami i izolacja tenantów na PostgreSQL 18.6 (#83)', () => {
  const keyId = 'pap-api-wave2-s2-ctx';
  const keyHex = randomBytes(32).toString('hex');
  const bffSecret = randomBytes(32).toString('hex');
  const redirectUri1 = 'http://127.0.0.1:3101/api/session/oidc/callback';
  const redirectUri2 = 'http://127.0.0.1:3102/api/session/oidc/callback';

  const TENANT_ALPHA = 'aaaa1111-1111-4111-8111-111111111101';
  const TENANT_BETA = 'bbbb2222-2222-4222-8222-222222222202';
  const USER_ANNA = 'aaaa1111-1111-4111-8111-111111111201';
  const USER_BARTOSZ = 'bbbb2222-2222-4222-8222-222222222203';

  let dataSchema = '';
  let runtimeUrl = '';
  let owner: ReturnType<typeof connectDatabase> | undefined;
  let schemaCreated = false;
  let idp: IsolatedOidcIdpHandle | undefined;
  const openApps = new Set<NestFastifyApplication>();

  beforeAll(async () => {
    if (process.env.PAP_DATABASE_ENV !== 'test' || !process.env.DATABASE_URL) {
      throw new DatabaseConfigError(
        'Test integracyjny Wave 2 Slice 2 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }
    runtimeUrl = (process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL ?? '').trim();
    if (!runtimeUrl) {
      throw new DatabaseConfigError('Brak PAP_EPHEMERAL_RUNTIME_DATABASE_URL.');
    }

    idp = await startIsolatedOidcIdp({
      clientId: 'pap-web',
      resourceAudience: 'pap-api',
      allowedRedirectUris: [redirectUri1, redirectUri2],
      accessTokenTtlSeconds: 300,
    });
    idp.registerUser({
      subject: 'real-oidc-anna-001',
      email: 'anna.wlascicielka@alfa-rachunkowosc.pl',
      displayName: 'Anna Właścicielka',
    });
    idp.registerUser({
      subject: 'real-oidc-bartosz-002',
      email: 'bartosz.wlasciciel@beta-podatki.pl',
      displayName: 'Bartosz Właściciel',
    });
    idp.registerUser({
      subject: 'unprovisioned-outsider-999',
      email: 'anna.wlascicielka@alfa-rachunkowosc.pl', // Celowo ten sam email co Anna! Nie wolno łączyć po emailu!
      displayName: 'Nieuprawniony o tym samym emailu',
    });

    dataSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;
    owner = connectDatabase(process.env, dataSchema, { roleScope: 'migrator' });
    await owner.client`CREATE SCHEMA ${owner.client(dataSchema)}`;
    schemaCreated = true;

    await applySqlMigrationsToSchema(owner.client);
    await provisionDatabaseContextKey(owner.db, {
      keyId,
      keyHex,
      runtimeRole: 'pap_test_app',
    });
    await configureRuntimePrivileges(owner.db, 'pap_test_app');

    // Zakładamy dwie niezależne organizacje i dwóch prawdziwych użytkowników OIDC (bez żadnych syntetycznych person!)
    await owner.client`
      INSERT INTO tenant (id, name)
      VALUES
        (${TENANT_ALPHA}, 'Kancelaria Alfa Sp. z o.o.'),
        (${TENANT_BETA}, 'Biuro Beta Doradztwo')
    `;

    const identityStore = new PostgresUserIdentityStore(owner.db);
    await identityStore.provisionUserWithOidcIdentity({
      userId: USER_ANNA as ReturnType<typeof import('@pap/domain').userId>,
      identityId: 'aaaa1111-1111-4111-8111-111111111301',
      issuer: idp.issuer,
      subject: 'real-oidc-anna-001',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: USER_BARTOSZ as ReturnType<typeof import('@pap/domain').userId>,
      identityId: 'bbbb2222-2222-4222-8222-222222222302',
      issuer: idp.issuer,
      subject: 'real-oidc-bartosz-002',
    });

    await owner.client`
      INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from)
      VALUES
        (${TENANT_ALPHA}, ${USER_ANNA}, 'tenant_owner', 'active', '2026-01-01T00:00:00Z'),
        (${TENANT_BETA}, ${USER_BARTOSZ}, 'tenant_owner', 'active', '2026-01-01T00:00:00Z')
    `;
  });

  afterAll(async () => {
    for (const app of openApps) {
      await app.close();
    }
    openApps.clear();
    await idp?.close();

    if (owner) {
      try {
        if (schemaCreated) {
          await owner.client`DROP SCHEMA ${owner.client(dataSchema)} CASCADE`;
        }
      } finally {
        await owner.client.end({ timeout: 2 });
      }
    }
  });

  it('dwóch niezależnych użytkowników OIDC utrzymuje odseparowane sesje między 2 instancjami API, przeżywa restart i wymusza fail-closed bez fallbacku do sandboxa', async () => {
    const baseApiEnv: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_DATABASE_ENV: 'test',
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'false',
      PAP_OIDC_ENV: 'test',
      PAP_OIDC_ISSUER: idp!.issuer,
      PAP_OIDC_JWKS_URI: idp!.jwksUri,
      PAP_OIDC_AUDIENCE: 'pap-api',
      PAP_OIDC_ALLOWED_AZP: 'pap-web',
      PAP_WEB_SESSION_SECRET: bffSecret,
      PAP_REQUIRE_EXPLICIT_WEB_SESSION_SECRET: 'true',
    };

    // Uruchamiamy DWIE niezależne instancje @pap/api podłączone do tego samego schematu PostgreSQL 18.6
    let inst1 = await bootApiInstance(baseApiEnv);
    const inst2 = await bootApiInstance(baseApiEnv);
    openApps.add(inst1.app);
    openApps.add(inst2.app);

    // 1. Przepływ Authorization Code + PKCE (S256) dla Anny (na instancji #1) i Bartosza (na instancji #2)
    const annaFlow = await executeOidcAuthorizationCodePkceFlow(
      idp!,
      redirectUri1,
      'real-oidc-anna-001',
    );
    const bartoszFlow = await executeOidcAuthorizationCodePkceFlow(
      idp!,
      redirectUri2,
      'real-oidc-bartosz-002',
    );

    const exchangeCode = async (code: string, redirectUri: string, codeVerifier: string) => {
      const res = await fetch(idp!.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: idp!.clientId,
          redirect_uri: redirectUri,
          code,
          code_verifier: codeVerifier,
        }).toString(),
      });
      return { status: res.status, data: (await res.json()) as Record<string, unknown> };
    };

    const annaTokens = await exchangeCode(annaFlow.code, redirectUri1, annaFlow.codeVerifier);
    expect(annaTokens.status).toBe(200);
    const annaAccessToken = String(annaTokens.data['access_token']);
    const annaRefreshToken = String(annaTokens.data['refresh_token']);

    // Negatywny test: ponowne użycie tego samego authorization_code (replay) jest odrzucane i unieważnia wydany refresh_token (RFC 6749 §10.5)
    const replayFlow = await executeOidcAuthorizationCodePkceFlow(
      idp!,
      redirectUri1,
      'real-oidc-anna-001',
    );
    const firstUse = await exchangeCode(replayFlow.code, redirectUri1, replayFlow.codeVerifier);
    expect(firstUse.status).toBe(200);
    const replayUse = await exchangeCode(replayFlow.code, redirectUri1, replayFlow.codeVerifier);
    expect(replayUse.status).toBe(400);
    const rtAfterCodeReplay = await fetch(idp!.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: idp!.clientId,
        refresh_token: String(firstUse.data['refresh_token']),
      }).toString(),
    });
    expect(rtAfterCodeReplay.status).toBe(400);

    const bartoszTokens = await exchangeCode(
      bartoszFlow.code,
      redirectUri2,
      bartoszFlow.codeVerifier,
    );
    expect(bartoszTokens.status).toBe(200);
    const bartoszAccessToken = String(bartoszTokens.data['access_token']);

    // 2. Anna zakłada firmę w TENANT_ALPHA na instancji #1, Bartosz zakłada firmę w TENANT_BETA na instancji #2
    const createAlphaRes = await fetch(`${inst1.baseUrl}/api/v1/tenants/${TENANT_ALPHA}/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${annaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Alfa Projektowanie Anna Właścicielka',
        nip: '5261040828',
        legalForm: 'jdg',
        profileCode: 'jdg_kpir_skala',
        vatStatus: 'czynny',
        address: 'ul. Marszałkowska 10, 00-590 Warszawa',
      }),
    });
    expect(createAlphaRes.status).toBe(201);
    const companyAlpha = CreateCompanyResponseSchema.parse(await createAlphaRes.json()).company;

    const createBetaRes = await fetch(`${inst2.baseUrl}/api/v1/tenants/${TENANT_BETA}/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bartoszAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Beta Consulting Sp. z o.o.',
        nip: '5213017228',
        legalForm: 'sp_z_o_o',
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        address: 'ul. Królewska 5, 30-045 Kraków',
      }),
    });
    expect(createBetaRes.status).toBe(201);
    const companyBeta = CreateCompanyResponseSchema.parse(await createBetaRes.json()).company;

    // 3. Twarda izolacja między tenantami i zakaz łączenia kont wyłącznie po adresie e-mail!
    const annaCrossTenantRes = await fetch(
      `${inst2.baseUrl}/api/v1/tenants/${TENANT_BETA}/companies/${companyBeta.legalEntityId}/dashboard`,
      {
        headers: { Authorization: `Bearer ${annaAccessToken}` },
      },
    );
    expect(annaCrossTenantRes.status).toBe(403);

    const bartoszCrossTenantRes = await fetch(
      `${inst1.baseUrl}/api/v1/tenants/${TENANT_ALPHA}/companies/${companyAlpha.legalEntityId}/dashboard`,
      {
        headers: { Authorization: `Bearer ${bartoszAccessToken}` },
      },
    );
    expect(bartoszCrossTenantRes.status).toBe(403);

    // Użytkownik z tym samym adresem e-mail co Anna, ale innym subject OIDC, otrzymuje 403 identity_not_provisioned!
    const outsiderToken = idp!.issueDirectAccessToken({
      user: {
        subject: 'unprovisioned-outsider-999',
        email: 'anna.wlascicielka@alfa-rachunkowosc.pl',
        displayName: 'Nieuprawniony o tym samym emailu',
      },
    });
    const outsiderMeRes = await fetch(`${inst1.baseUrl}/api/v1/me/companies`, {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    expect(outsiderMeRes.status).toBe(403);
    await expect(outsiderMeRes.json()).resolves.toMatchObject({
      reasonCode: 'identity_not_provisioned',
    });

    // Endpoint syntetycznych person jest wyłączony (404 sandbox_oidc_disabled), brak cichego fallbacku!
    const synthAttempt = await fetch(`${inst1.baseUrl}/api/v1/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaId: 'jan-testowy' }),
    });
    expect(synthAttempt.status).toBe(404);
    await expect(synthAttempt.json()).resolves.toMatchObject({
      reasonCode: 'sandbox_oidc_disabled',
    });

    // 4. Utworzenie nieprzezroczystych sesji BFF w PostgreSQL przez instancję #1 i odczyt z instancji #2 + po restarcie instancji #1
    const annaSessionHash = sha256Hex('opaque-cookie-anna-prod-grade');
    const bartoszSessionHash = sha256Hex('opaque-cookie-bartosz-prod-grade');

    const createAnnaSess = await callBffInternalRpc<{ ok: boolean }>(
      inst1.baseUrl,
      bffSecret,
      '/session/create',
      {
        sessionIdHash: annaSessionHash,
        userId: USER_ANNA,
        issuer: idp!.issuer,
        subject: 'real-oidc-anna-001',
        displayName: 'Anna Właścicielka',
        email: 'anna.wlascicielka@alfa-rachunkowosc.pl',
        tenantId: TENANT_ALPHA,
        legalEntityId: companyAlpha.legalEntityId,
        period: '2026-11',
        encryptedTokens: `cipher:${annaRefreshToken}`,
        accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      },
    );
    expect(createAnnaSess.status).toBe(200);
    expect(createAnnaSess.json.ok).toBe(true);

    const createBartoszSess = await callBffInternalRpc<{ ok: boolean }>(
      inst2.baseUrl,
      bffSecret,
      '/session/create',
      {
        sessionIdHash: bartoszSessionHash,
        userId: USER_BARTOSZ,
        issuer: idp!.issuer,
        subject: 'real-oidc-bartosz-002',
        displayName: 'Bartosz Właściciel',
        email: 'bartosz.wlasciciel@beta-podatki.pl',
        tenantId: TENANT_BETA,
        legalEntityId: companyBeta.legalEntityId,
        period: '2026-11',
        encryptedTokens: 'cipher:bartosz-tokens',
        accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        expiresAt: new Date(Date.now() + 28_800_000).toISOString(),
      },
    );
    expect(createBartoszSess.status).toBe(200);
    expect(createBartoszSess.json.ok).toBe(true);

    // Odczyt sesji Anny na instancji #2 przed restartem
    const readAnnaOnInst2 = await callBffInternalRpc<{
      ok: boolean;
      session?: { userId: string; tenantId: string; legalEntityId: string };
    }>(inst2.baseUrl, bffSecret, '/session/get', {
      sessionIdHash: annaSessionHash,
    });
    expect(readAnnaOnInst2.json).toMatchObject({
      ok: true,
      session: {
        userId: USER_ANNA,
        tenantId: TENANT_ALPHA,
        legalEntityId: companyAlpha.legalEntityId,
      },
    });

    // Kontrolowany restart instancji #1!
    await inst1.app.close();
    openApps.delete(inst1.app);
    inst1 = await bootApiInstance(baseApiEnv);
    openApps.add(inst1.app);

    // Po restarcie instancji #1 obie sesje oraz firmy nadal działają bez utraty stanu!
    const readAnnaAfterRestart = await callBffInternalRpc<{
      ok: boolean;
      session?: { userId: string; legalEntityId: string };
    }>(inst1.baseUrl, bffSecret, '/session/get', {
      sessionIdHash: annaSessionHash,
    });
    expect(readAnnaAfterRestart.json).toMatchObject({
      ok: true,
      session: {
        userId: USER_ANNA,
        legalEntityId: companyAlpha.legalEntityId,
      },
    });

    const annaMyCompaniesAfterRestart = await fetch(`${inst1.baseUrl}/api/v1/me/companies`, {
      headers: { Authorization: `Bearer ${annaAccessToken}` },
    });
    expect(annaMyCompaniesAfterRestart.status).toBe(200);
    const annaCompaniesParsed = GetMyCompaniesResponseSchema.parse(
      await annaMyCompaniesAfterRestart.json(),
    );
    expect(annaCompaniesParsed.companies.map((c) => c.legalEntityId)).toEqual([
      companyAlpha.legalEntityId,
    ]);

    // 5. Negatywne testy podpisu HMAC wewnętrznego kanału BFF -> API (401) oraz wylogowanie/unieważnienie
    const forgedRes = await fetch(`${inst1.baseUrl}/api/v1/auth/bff/session/get`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bff-timestamp': String(Date.now()),
        'x-bff-signature': '0'.repeat(64),
      },
      body: JSON.stringify({ sessionIdHash: annaSessionHash }),
    });
    expect(forgedRes.status).toBe(401);

    // Wylogowanie na instancji #1 unieważnia sesję również na instancji #2!
    const revokeRes = await callBffInternalRpc<{ ok: boolean; revoked: boolean }>(
      inst1.baseUrl,
      bffSecret,
      '/session/revoke',
      { sessionIdHash: annaSessionHash },
    );
    expect(revokeRes.json).toEqual({ ok: true, revoked: true });

    const replayAfterLogoutOnInst2 = await callBffInternalRpc<{ ok: boolean; reason?: string }>(
      inst2.baseUrl,
      bffSecret,
      '/session/get',
      { sessionIdHash: annaSessionHash },
    );
    expect(replayAfterLogoutOnInst2.json).toEqual({ ok: false, reason: 'session_revoked' });

    // Instancja API bez skonfigurowanego PAP_WEB_SESSION_SECRET zawodzi zamknięcie (503 auth_service_unavailable)
    const { PAP_WEB_SESSION_SECRET: _omitted, ...envWithoutSecret } = baseApiEnv;
    void _omitted;
    const instNoSecret = await bootApiInstance(envWithoutSecret);
    openApps.add(instNoSecret.app);
    const failClosedRes = await fetch(`${instNoSecret.baseUrl}/api/v1/auth/bff/session/get`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIdHash: bartoszSessionHash }),
    });
    expect(failClosedRes.status).toBe(503);
    await expect(failClosedRes.json()).resolves.toMatchObject({
      reasonCode: 'auth_service_unavailable',
    });
  }, 60_000);
});
