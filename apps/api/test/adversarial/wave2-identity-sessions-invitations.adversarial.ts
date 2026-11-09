import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AcceptTenantInvitationResponseSchema,
  AuthenticatedSessionViewSchema,
  CreateCompanyResponseSchema,
  CreateTenantInvitationResponseSchema,
} from '@pap/contracts';
import {
  DatabaseConfigError,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import {
  computeBffInternalSignatureHex,
  resolveBffInternalHmacKey,
} from '../../src/auth/bff-session.controller.js';
import { OidcConfigError } from '../../src/auth/oidc-config.js';
import { runBootstrapOwnerCli } from '../../src/cli/bootstrap-owner.js';
import {
  createApiRuntimeServices,
  createApiRuntimeServicesAsync,
} from '../../src/runtime/workspace-runtime.js';
import {
  startIsolatedOidcIdp,
  type IsolatedOidcIdpHandle,
} from '../helpers/isolated-oidc-idp.js';

interface DrizzleJournalFile {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
  }[];
}

async function applySqlMigrationsToSchema(
  ownerClient: ReturnType<typeof connectDatabase>['client'],
): Promise<void> {
  const drizzleDir = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));
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
    { logger: false, abortOnError: false },
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

async function obtainOidcTokens(
  idp: IsolatedOidcIdpHandle,
  redirectUri: string,
  subject: string,
): Promise<{
  readonly code: string;
  readonly codeVerifier: string;
  readonly accessToken: string;
  readonly refreshToken: string;
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
  authUrl.searchParams.set('test_subject', subject);

  const authRes = await fetch(authUrl, { redirect: 'manual' });
  expect(authRes.status).toBe(302);
  const callbackUrl = new URL(authRes.headers.get('location')!);
  const code = callbackUrl.searchParams.get('code')!;
  expect(code).toBeTruthy();

  const tokenRes = await fetch(idp.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: idp.clientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }).toString(),
  });
  expect(tokenRes.status).toBe(200);
  const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
  return {
    code,
    codeVerifier,
    accessToken: String(tokenJson['access_token']),
    refreshToken: String(tokenJson['refresh_token']),
  };
}

async function postBffInternal(params: {
  readonly baseUrl: string;
  readonly path: string;
  readonly webSessionSecret: string;
  readonly payload: unknown;
}): Promise<Response> {
  const timestampMs = String(Date.now());
  const hmacKey = resolveBffInternalHmacKey({ PAP_WEB_SESSION_SECRET: params.webSessionSecret });
  if (!hmacKey) {
    throw new Error('Brak klucza HMAC BFF.');
  }
  const sig = computeBffInternalSignatureHex(
    hmacKey,
    'POST',
    params.path,
    timestampMs,
    params.payload,
  );
  return fetch(`${params.baseUrl}${params.path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bff-timestamp': timestampMs,
      'x-bff-signature': sig,
    },
    body: JSON.stringify(params.payload),
  });
}

describe('Adversarial Wave 2 Regression Suite (#83 tożsamość OIDC + sesje BFF + zaproszenia + blokada piaskownicy, #78)', () => {
  const keyId = 'pap-adv-wave2-ctx';
  const keyHex = randomBytes(32).toString('hex');
  const sessionSecret = randomBytes(32).toString('hex');
  const redirectUri = 'http://127.0.0.1:3283/api/session/oidc/callback';

  let dataSchema = '';
  let runtimeUrl = '';
  let owner: ReturnType<typeof connectDatabase> | undefined;
  let schemaCreated = false;
  let idpA: IsolatedOidcIdpHandle | undefined;
  let idpB: IsolatedOidcIdpHandle | undefined;
  const openApps = new Set<NestFastifyApplication>();

  beforeAll(async () => {
    if (process.env.PAP_DATABASE_ENV !== 'test' || !process.env.DATABASE_URL) {
      throw new DatabaseConfigError(
        'Zestaw adversarial Wave 2 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }
    runtimeUrl = (process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL ?? '').trim();
    if (!runtimeUrl) {
      throw new DatabaseConfigError(
        'Brak PAP_EPHEMERAL_RUNTIME_DATABASE_URL — uruchom przez scripts/hetzner/with-ephemeral-pg18.sh --mode strict-migrator --bootstrap-runtime-role.',
      );
    }

    dataSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;
    owner = connectDatabase(process.env, dataSchema, { roleScope: 'migrator' });
    await owner.client`CREATE SCHEMA ${owner.client(dataSchema)}`;
    schemaCreated = true;
    await applySqlMigrationsToSchema(owner.client);

    const runtimeUser = new URL(runtimeUrl).username;
    await provisionDatabaseContextKey(owner.db, {
      keyId,
      keyHex,
      runtimeRole: runtimeUser,
    });
    await configureRuntimePrivileges(owner.db, runtimeUser);

    idpA = await startIsolatedOidcIdp({
      clientId: 'pap-web',
      resourceAudience: 'pap-api',
      allowedRedirectUris: [redirectUri],
    });
    idpB = await startIsolatedOidcIdp({
      clientId: 'pap-web',
      resourceAudience: 'pap-api',
      allowedRedirectUris: [redirectUri],
    });
  }, 120_000);

  afterAll(async () => {
    for (const app of openApps) {
      await app.close().catch(() => undefined);
    }
    openApps.clear();
    await idpA?.close();
    await idpB?.close();
    if (owner) {
      if (schemaCreated) {
        await owner.client`DROP SCHEMA IF EXISTS ${owner.client(dataSchema)} CASCADE`.catch(
          () => undefined,
        );
      }
      await owner.client.end({ timeout: 2 }).catch(() => undefined);
    }
  }, 60_000);

  function buildRuntimeEnv(idp: IsolatedOidcIdpHandle): Record<string, string> {
    return {
      NODE_ENV: 'test',
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: keyHex,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'false',
      PAP_OIDC_ENV: 'test',
      PAP_OIDC_ISSUER: idp.issuer,
      PAP_OIDC_JWKS_URI: idp.jwksUri,
      PAP_OIDC_AUDIENCE: idp.resourceAudience,
      PAP_OIDC_ALLOWED_CLIENT_IDS: idp.clientId,
      PAP_WEB_SESSION_SECRET: sessionSecret,
    };
  }

  it('ADV-83-01 & ADV-83-02: wyścig 10x bootstrapInitialOwner, brak łączenia kont po e-mailu lub samym sub między wystawcami oraz ochrona PKCE/state/code/refresh przed replayem między 2 instancjami API', async () => {
    idpA!.registerUser({
      subject: 'adv-owner-sub',
      email: 'wlasciciel.adv@syntetyczny.example',
      emailVerified: true,
      displayName: 'Właściciel Adversarial',
    });
    // Identyczny sub oraz identyczny zweryfikowany e-mail u drugiego wystawcy OIDC!
    idpB!.registerUser({
      subject: 'adv-owner-sub',
      email: 'wlasciciel.adv@syntetyczny.example',
      emailVerified: true,
      displayName: 'Podszywacz z Drugiego IdP',
    });

    const envA = buildRuntimeEnv(idpA!);

    // 1. 10 równoczesnych prób jednorazowego bootstrapu właściciela z różnymi operationId
    const racePromises = Array.from({ length: 10 }, async (_, idx) => {
      const rt = await createApiRuntimeServicesAsync(envA);
      try {
        const receipt = await rt.ownerBootstrap.bootstrapInitialOwner({
          issuer: idpA!.issuer,
          subject: `adv-owner-candidate-${String(idx)}`,
          displayName: idx === 0 ? 'Właściciel Adversarial' : `Kandydat ${String(idx)}`,
          email:
            idx === 0
              ? 'wlasciciel.adv@syntetyczny.example'
              : `kandydat.${String(idx)}@syntetyczny.example`,
          tenantName: `Organizacja Wyścigowa ${String(idx)}`,
          reason: 'Równoczesny test wyścigu bootstrapu właściciela',
          operationId: randomUUID(),
        });
        return { ok: true as const, receipt };
      } catch (err) {
        return {
          ok: false as const,
          reasonCode: (err as { reasonCode?: string }).reasonCode ?? 'unknown',
        };
      } finally {
        await rt.close?.();
      }
    });

    // Zmieńmy tak, by zwycięzca miał powiązany sub — zarejestrujmy zwycięzcę w idpA
    const raceResults = await Promise.all(racePromises);
    const winners = raceResults.filter((r) => r.ok);
    const losers = raceResults.filter((r) => !r.ok);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(9);
    for (const loser of losers) {
      if (!loser.ok) {
        expect(loser.reasonCode).toBe('owner_already_bootstrapped');
      }
    }

    const winnerReceipt = winners[0]!.ok ? winners[0]!.receipt : null;
    expect(winnerReceipt).not.toBeNull();
    idpA!.registerUser({
      subject: winnerReceipt!.subject,
      email: winnerReceipt!.email,
      emailVerified: true,
      displayName: winnerReceipt!.displayName,
    });
    idpB!.registerUser({
      subject: winnerReceipt!.subject,
      email: winnerReceipt!.email,
      emailVerified: true,
      displayName: 'Kolizja Sub i Email u Drugiego Wystawcy',
    });

    const inst1 = await bootApiInstance(envA);
    const inst2 = await bootApiInstance(envA);
    openApps.add(inst1.app);
    openApps.add(inst2.app);

    const ownerTokens = await obtainOidcTokens(idpA!, redirectUri, winnerReceipt!.subject);

    // 2. Próba ponownego użycia tego samego authorization_code w IdP kończy się odmową (invalid_grant)
    const codeReplayRes = await fetch(idpA!.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: idpA!.clientId,
        redirect_uri: redirectUri,
        code: ownerTokens.code,
        code_verifier: ownerTokens.codeVerifier,
      }).toString(),
    });
    expect(codeReplayRes.status).toBe(400);

    // 3. Wyścig 8x zużycia jednorazowego pap_oidc_auth_state między instancjami 1 i 2
    const stateHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const createStateRes = await postBffInternal({
      baseUrl: inst1.baseUrl,
      path: '/api/v1/auth/bff/oidc-state/create',
      webSessionSecret: sessionSecret,
      payload: {
        stateHash,
        encryptedPayload: 'v1.syntetyczny.ladunek.aead',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    expect(createStateRes.status).toBe(200);

    const consumeRace = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        postBffInternal({
          baseUrl: idx % 2 === 0 ? inst1.baseUrl : inst2.baseUrl,
          path: '/api/v1/auth/bff/oidc-state/consume',
          webSessionSecret: sessionSecret,
          payload: { stateHash },
        }).then(async (r) => (await r.json()) as { ok: boolean }),
      ),
    );
    expect(consumeRace.filter((r) => r.ok).length).toBe(1);
    expect(consumeRace.filter((r) => !r.ok).length).toBe(7);

    // 4. Wyścig 8x rotacji sesji BFF (grace window) + detekcja kradzieży/reużycia starej generacji po oknie karencji
    const sessionIdHash = createHash('sha256').update(randomBytes(32)).digest('hex');
    const createSessRes = await postBffInternal({
      baseUrl: inst1.baseUrl,
      path: '/api/v1/auth/bff/session/create',
      webSessionSecret: sessionSecret,
      payload: {
        sessionIdHash,
        userId: winnerReceipt!.userId,
        issuer: idpA!.issuer,
        subject: winnerReceipt!.subject,
        displayName: winnerReceipt!.displayName,
        email: winnerReceipt!.email,
        tenantId: winnerReceipt!.tenantId,
        legalEntityId: null,
        period: '2026-10',
        encryptedTokens: 'v1.gen0.tokens.tag',
        accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    expect(createSessRes.status).toBe(200);

    const rotateNow = new Date();
    const rotateRace = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        postBffInternal({
          baseUrl: idx % 2 === 0 ? inst1.baseUrl : inst2.baseUrl,
          path: '/api/v1/auth/bff/session/rotate',
          webSessionSecret: sessionSecret,
          payload: {
            sessionIdHash,
            expectedGeneration: 0,
            encryptedTokens: `v1.gen1.candidate${String(idx)}.tag`,
            accessTokenExpiresAt: new Date(rotateNow.getTime() + 300_000).toISOString(),
            gracePeriodMs: 5_000,
            now: rotateNow.toISOString(),
          },
        }).then(
          async (r) =>
            (await r.json()) as { ok: boolean; rotated?: boolean; alreadyAdvanced?: boolean },
        ),
      ),
    );
    expect(rotateRace.filter((r) => r.ok && r.rotated === true).length).toBe(1);
    expect(rotateRace.filter((r) => r.ok && r.alreadyAdvanced === true).length).toBe(7);

    // Po upływie okna karencji (gracePeriodMs = 5s) ponowne użycie expectedGeneration: 0 kończy się odmową generation_conflict,
    // a ponowne użycie zużytego refresh_token w IdP kończy się invalid_grant i unieważnieniem sesji BFF!
    const afterGrace = new Date(rotateNow.getTime() + 10_000).toISOString();
    const reuseRes = await postBffInternal({
      baseUrl: inst2.baseUrl,
      path: '/api/v1/auth/bff/session/rotate',
      webSessionSecret: sessionSecret,
      payload: {
        sessionIdHash,
        expectedGeneration: 0,
        encryptedTokens: 'v1.stolen.replay.tag',
        accessTokenExpiresAt: new Date(rotateNow.getTime() + 600_000).toISOString(),
        now: afterGrace,
      },
    });
    const reuseJson = (await reuseRes.json()) as { ok: boolean; reason?: string };
    expect(reuseJson.ok).toBe(false);
    expect(reuseJson.reason).toBe('generation_conflict');

    const firstRefreshRes = await fetch(idpA!.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: idpA!.clientId,
        refresh_token: ownerTokens.refreshToken,
      }).toString(),
    });
    expect(firstRefreshRes.status).toBe(200);

    const replayRefreshRes = await fetch(idpA!.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: idpA!.clientId,
        refresh_token: ownerTokens.refreshToken,
      }).toString(),
    });
    expect(replayRefreshRes.status).toBe(400);

    const revokeStolenSessRes = await postBffInternal({
      baseUrl: inst2.baseUrl,
      path: '/api/v1/auth/bff/session/revoke',
      webSessionSecret: sessionSecret,
      payload: { sessionIdHash, now: afterGrace },
    });
    expect(revokeStolenSessRes.status).toBe(200);

    const getAfterReuse = await postBffInternal({
      baseUrl: inst1.baseUrl,
      path: '/api/v1/auth/bff/session/get',
      webSessionSecret: sessionSecret,
      payload: { sessionIdHash, now: afterGrace },
    });
    const getAfterReuseJson = (await getAfterReuse.json()) as { ok: boolean };
    expect(getAfterReuseJson.ok).toBe(false);

    // 5. Kolizja (subject + email) u drugiego wystawcy OIDC (idpB) NIE łączy kont i nie daje dostępu do tenanta idpA
    const instOtherIdp = await bootApiInstance(buildRuntimeEnv(idpB!));
    openApps.add(instOtherIdp.app);
    const otherIdpTokens = await obtainOidcTokens(idpB!, redirectUri, winnerReceipt!.subject);

    // Utwórzmy firmę w organizacji właściciela na inst1
    const createCompRes = await fetch(
      `${inst1.baseUrl}/api/v1/tenants/${winnerReceipt!.tenantId}/companies`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerTokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Kancelaria Właściciela Adv Sp. z o.o.',
          companyName: 'Kancelaria Właściciela Adv Sp. z o.o.',
          nip: '5261040828',
          address: 'ul. Prosta 20, 00-850 Warszawa',
          legalForm: 'sp_z_o_o',
          profileCode: 'spzoo_pelne_ksiegi',
          vatStatus: 'czynny',
        }),
      },
    );
    expect(createCompRes.status).toBe(201);
    const createdCompany = CreateCompanyResponseSchema.parse(await createCompRes.json()).company;

    // Zarejestrujmy tożsamość z idpB przez /identity/ensure i sprawdźmy całkowitą izolację
    const ensureOtherRes = await postBffInternal({
      baseUrl: instOtherIdp.baseUrl,
      path: '/api/v1/auth/bff/identity/ensure',
      webSessionSecret: sessionSecret,
      payload: {
        accessToken: otherIdpTokens.accessToken,
        displayName: 'Kolizja Sub i Email u Drugiego Wystawcy',
        email: winnerReceipt!.email,
      },
    });
    expect(ensureOtherRes.status).toBe(200);
    const ensureOtherJson = (await ensureOtherRes.json()) as { ok: boolean; userId: string };
    expect(ensureOtherJson.ok).toBe(true);
    expect(ensureOtherJson.userId).not.toBe(winnerReceipt!.userId);

    const otherSessionRes = await fetch(`${instOtherIdp.baseUrl}/api/v1/me/session`, {
      headers: { Authorization: `Bearer ${otherIdpTokens.accessToken}` },
    });
    expect(otherSessionRes.status).toBe(200);
    const otherSessionView = AuthenticatedSessionViewSchema.parse(await otherSessionRes.json());
    expect(otherSessionView.state).toBe('no_tenant_membership');
    expect(otherSessionView.companies).toEqual([]);

    const crossIdpStealAttempt = await fetch(
      `${instOtherIdp.baseUrl}/api/v1/tenants/${winnerReceipt!.tenantId}/companies/${createdCompany.legalEntityId}/overview?period=2026-10`,
      {
        headers: { Authorization: `Bearer ${otherIdpTokens.accessToken}` },
      },
    );
    expect(crossIdpStealAttempt.status).toBe(403);
  }, 120_000);

  it('ADV-83-03 & ADV-83-04: granice eskalacji tenant_admin, 10x wyścig single-use zaproszenia bez sierot app_user, natychmiastowe cofanie między instancjami + unieważnianie sesji BFF oraz blokada piaskownicy', async () => {
    // Osobny schemat dla izolowanego scenariusza zaproszeń i cofania
    const subSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;
    await owner!.client`CREATE SCHEMA ${owner!.client(subSchema)}`;
    const subMigrator = connectDatabase(process.env, subSchema, { roleScope: 'migrator' });
    try {
      await applySqlMigrationsToSchema(subMigrator.client);
      const runtimeUser = new URL(runtimeUrl).username;
      await provisionDatabaseContextKey(subMigrator.db, {
        keyId,
        keyHex,
        runtimeRole: runtimeUser,
      });
      await configureRuntimePrivileges(subMigrator.db, runtimeUser);

      idpA!.registerUser({
        subject: 'adv-s4-owner',
        email: 'owner.s4@syntetyczny.example',
        emailVerified: true,
        displayName: 'Właściciel S4',
      });
      idpA!.registerUser({
        subject: 'adv-s4-admin',
        email: 'admin.s4@syntetyczny.example',
        emailVerified: true,
        displayName: 'Administrator S4',
      });
      for (let i = 0; i < 10; i += 1) {
        idpA!.registerUser({
          subject: `adv-s4-racer-${String(i)}`,
          email: `racer.${String(i)}@syntetyczny.example`,
          emailVerified: true,
          displayName: `Kandydat Wyścigu ${String(i)}`,
        });
      }

      const envSub: Record<string, string> = {
        ...buildRuntimeEnv(idpA!),
        PAP_DB_SCHEMA: subSchema,
      };

      const cliOut: string[] = [];
      const cliRc = await runBootstrapOwnerCli(
        [
          '--issuer',
          idpA!.issuer,
          '--subject',
          'adv-s4-owner',
          '--display-name',
          'Właściciel S4',
          '--email',
          'owner.s4@syntetyczny.example',
          '--tenant-name',
          'Biuro Adversarial S4',
          '--reason',
          'Bootstrap właściciela do testu adversarial S4',
        ],
        envSub,
        { stdout: (l) => cliOut.push(l), stderr: () => undefined },
      );
      expect(cliRc).toBe(0);
      const bootReceipt = JSON.parse(cliOut[0]!) as { tenantId: string; userId: string };

      const apiA = await bootApiInstance(envSub);
      const apiB = await bootApiInstance(envSub);
      openApps.add(apiA.app);
      openApps.add(apiB.app);

      const ownerTok = (await obtainOidcTokens(idpA!, redirectUri, 'adv-s4-owner')).accessToken;

      // Właściciel tworzy 2 firmy: Firma 1 i Firma 2
      const comp1Res = await fetch(
        `${apiA.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/companies`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'Firma Pierwsza Adv JDG',
            companyName: 'Firma Pierwsza Adv JDG',
            nip: '5213004125',
            address: 'ul. Marszałkowska 1, 00-001 Warszawa',
            legalForm: 'jdg',
            profileCode: 'jdg_kpir_skala',
            vatStatus: 'czynny',
          }),
        },
      );
      expect(comp1Res.status).toBe(201);
      const comp1 = CreateCompanyResponseSchema.parse(await comp1Res.json()).company;

      const comp2Res = await fetch(
        `${apiA.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/companies`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            displayName: 'Firma Druga Tajna Sp. z o.o.',
            companyName: 'Firma Druga Tajna Sp. z o.o.',
            nip: '7010001454',
            address: 'ul. Świętokrzyska 10, 00-002 Warszawa',
            legalForm: 'sp_z_o_o',
            profileCode: 'spzoo_pelne_ksiegi',
            vatStatus: 'czynny',
          }),
        },
      );
      expect(comp2Res.status).toBe(201);
      const comp2 = CreateCompanyResponseSchema.parse(await comp2Res.json()).company;

      // Właściciel zaprasza tenant_admin TYLKO z grantem read do Firmy 1 (bez Firmy 2!)
      const invAdminRes = await fetch(
        `${apiA.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/invitations`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteeEmail: 'admin.s4@syntetyczny.example',
            intendedRole: 'tenant_admin',
            initialCompanyGrants: [{ legalEntityId: comp1.legalEntityId, actions: ['read'] }],
            reason: 'Powołanie administratora z ograniczonym zakresem',
          }),
        },
      );
      expect(invAdminRes.status).toBe(201);
      const invAdmin = CreateTenantInvitationResponseSchema.parse(await invAdminRes.json());

      const adminTok = (await obtainOidcTokens(idpA!, redirectUri, 'adv-s4-admin')).accessToken;
      const acceptAdminRes = await fetch(`${apiB.baseUrl}/api/v1/invitations/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationToken: invAdmin.invitationToken }),
      });
      expect(acceptAdminRes.status).toBe(200);

      // tenant_admin NIE ma automatycznego dostępu księgowego do Firmy 2 (403)
      const adminStealComp2 = await fetch(
        `${apiB.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/companies/${comp2.legalEntityId}/overview?period=2026-10`,
        { headers: { Authorization: `Bearer ${adminTok}` } },
      );
      expect(adminStealComp2.status).toBe(403);

      // tenant_admin NIE może zaprosić kolejnego tenant_admin (403 target_role_not_delegable)
      const adminEscalateRole = await fetch(
        `${apiB.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/invitations`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteeEmail: 'escalate@syntetyczny.example',
            intendedRole: 'tenant_admin',
            reason: 'Próba eskalacji roli przez administratora',
          }),
        },
      );
      expect(adminEscalateRole.status).toBe(403);

      // tenant_admin NIE może delegować write do Firmy 1 ani read do Firmy 2 (403 grant_scope_not_delegable)
      const adminEscalateGrant = await fetch(
        `${apiB.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/invitations`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteeEmail: 'escalate-write@syntetyczny.example',
            intendedRole: 'tenant_member',
            initialCompanyGrants: [
              { legalEntityId: comp1.legalEntityId, actions: ['read', 'write'] },
            ],
            reason: 'Próba delegacji write bez posiadania write',
          }),
        },
      );
      expect(adminEscalateGrant.status).toBe(403);

      // 10-krotny wyścig akceptacji single-use zaproszenia na 2 instancjach API
      const raceInvRes = await fetch(
        `${apiA.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/invitations`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${adminTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteeEmail: 'racer@syntetyczny.example',
            intendedRole: 'tenant_member',
            initialCompanyGrants: [{ legalEntityId: comp1.legalEntityId, actions: ['read'] }],
            reason: 'Zaproszenie do wyścigu 10x single-use',
          }),
        },
      );
      expect(raceInvRes.status).toBe(201);
      const raceInv = CreateTenantInvitationResponseSchema.parse(await raceInvRes.json());

      const racerTokens = await Promise.all(
        Array.from({ length: 10 }, (_, idx) =>
          obtainOidcTokens(idpA!, redirectUri, `adv-s4-racer-${String(idx)}`),
        ),
      );

      const acceptStatuses = await Promise.all(
        racerTokens.map(async (tok, idx) => {
          const targetBase = idx % 2 === 0 ? apiA.baseUrl : apiB.baseUrl;
          const res = await fetch(`${targetBase}/api/v1/invitations/accept`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tok.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ invitationToken: raceInv.invitationToken }),
          });
          const bodyJson = (await res.json()) as Record<string, unknown>;
          return { idx, status: res.status, bodyJson };
        }),
      );

      const okAccepts = acceptStatuses.filter((r) => r.status === 200);
      const conflictAccepts = acceptStatuses.filter((r) => r.status === 409);
      expect(okAccepts.length).toBe(1);
      expect(conflictAccepts.length).toBe(9);

      const winnerIdx = okAccepts[0]!.idx;
      const acceptedPayload = AcceptTenantInvitationResponseSchema.parse(okAccepts[0]!.bodyJson);
      const winnerToken = racerTokens[winnerIdx]!.accessToken;

      // 9 przegranych NIE utworzyło osieroconych tożsamości w user_oidc_identity / app_user!
      for (let i = 0; i < 10; i += 1) {
        if (i === winnerIdx) continue;
        const rows = await subMigrator.client<{ readonly cnt: string }[]>`
          SELECT count(*)::text AS cnt
          FROM ${subMigrator.client(subSchema)}.user_oidc_identity
          WHERE subject = ${`adv-s4-racer-${String(i)}`}
        `;
        expect(rows[0]!.cnt).toBe('0');
      }

      // Zwycięzca tworzy sesję BFF, po czym właściciel cofa jego członkostwo na instancji A ->
      // instancja B natychmiast odrzuca dostęp (403) ORAZ sesja BFF zostaje natychmiast unieważniona!
      const meWinnerRes = await fetch(`${apiB.baseUrl}/api/v1/me/session`, {
        headers: { Authorization: `Bearer ${winnerToken}` },
      });
      const meWinner = AuthenticatedSessionViewSchema.parse(await meWinnerRes.json());

      const winnerSessHash = createHash('sha256').update(randomBytes(32)).digest('hex');
      const createWinnerSess = await postBffInternal({
        baseUrl: apiB.baseUrl,
        path: '/api/v1/auth/bff/session/create',
        webSessionSecret: sessionSecret,
        payload: {
          sessionIdHash: winnerSessHash,
          userId: meWinner.userId,
          issuer: idpA!.issuer,
          subject: meWinner.subject,
          displayName: meWinner.displayName,
          email: meWinner.email,
          tenantId: acceptedPayload.membership.tenantId,
          legalEntityId: comp1.legalEntityId,
          period: '2026-10',
          encryptedTokens: 'v1.winner.tokens.tag',
          accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
      expect(createWinnerSess.status).toBe(200);

      // Przed cofnięciem odczyt Firmy 1 na instancji B działa (200)
      const preRevokeOverview = await fetch(
        `${apiB.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/companies/${comp1.legalEntityId}/overview?period=2026-10`,
        { headers: { Authorization: `Bearer ${winnerToken}` } },
      );
      expect(preRevokeOverview.status).toBe(200);

      // Właściciel cofa członkostwo na instancji A
      const revokeMemRes = await fetch(
        `${apiA.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/memberships/${meWinner.userId}/revoke`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${ownerTok}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'Natychmiastowe cofnięcie dostępu w teście adversarial',
          }),
        },
      );
      expect(revokeMemRes.status).toBe(200);

      // Natychmiastowa odmowa na instancji B przy wciąż ważnym podpisie JWT!
      const postRevokeOverview = await fetch(
        `${apiB.baseUrl}/api/v1/tenants/${bootReceipt.tenantId}/companies/${comp1.legalEntityId}/overview?period=2026-10`,
        { headers: { Authorization: `Bearer ${winnerToken}` } },
      );
      expect(postRevokeOverview.status).toBe(403);

      // Sesja BFF w PostgreSQL jest również natychmiast unieważniona!
      const bffAfterRevoke = await postBffInternal({
        baseUrl: apiB.baseUrl,
        path: '/api/v1/auth/bff/session/get',
        webSessionSecret: sessionSecret,
        payload: { sessionIdHash: winnerSessHash },
      });
      const bffAfterRevokeJson = (await bffAfterRevoke.json()) as { ok: boolean };
      expect(bffAfterRevokeJson.ok).toBe(false);

      // Blokada piaskownicy OIDC poza LOCAL_DEV
      for (const path of ['/api/v1/auth/sandbox/token', '/api/v1/oidc/token']) {
        const res = await fetch(`${apiA.baseUrl}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personaId: 'jan-testowy' }),
        });
        expect(res.status).toBe(404);
      }
      expect(() =>
        createApiRuntimeServices({
          ...envSub,
          PAP_RUNTIME_MODE: 'PRODUCTION',
          PAP_SANDBOX_AUTH_ENABLED: 'true',
        }),
      ).toThrow(OidcConfigError);
    } finally {
      await owner!.client`DROP SCHEMA IF EXISTS ${owner!.client(subSchema)} CASCADE`.catch(
        () => undefined,
      );
      await subMigrator.client.end({ timeout: 2 }).catch(() => undefined);
    }
  }, 120_000);
});
