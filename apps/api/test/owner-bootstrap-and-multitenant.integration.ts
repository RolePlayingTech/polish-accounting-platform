import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AuthenticatedSessionViewSchema,
  BootstrapOwnerResponseSchema,
  CreateCompanyResponseSchema,
} from '@pap/contracts';
import {
  DatabaseConfigError,
  PostgresUserIdentityStore,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { runBootstrapOwnerCli } from '../src/cli/bootstrap-owner.js';
import { createApiRuntimeServicesAsync } from '../src/runtime/workspace-runtime.js';
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

async function obtainOidcBearerToken(
  idp: IsolatedOidcIdpHandle,
  redirectUri: string,
  subject: string,
): Promise<string> {
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
  return String(tokenJson['access_token']);
}

describe('Wave 2 Slice 3 — Jednorazowy bootstrap właściciela (CLI + atomowość PG), wielotenantowość (1 user -> N organizacji, 1 organizacja -> M podmiotów) i brak łączenia po e-mailu (#83)', () => {
  const keyId = 'pap-api-wave2-s3-ctx';
  const keyHex = randomBytes(32).toString('hex');
  const bffSecret = randomBytes(32).toString('hex');
  const redirectUri = 'http://127.0.0.1:3201/api/session/oidc/callback';

  let dataSchema = '';
  let runtimeUrl = '';
  let owner: ReturnType<typeof connectDatabase> | undefined;
  let schemaCreated = false;
  let idp: IsolatedOidcIdpHandle | undefined;
  const openApps = new Set<NestFastifyApplication>();

  beforeAll(async () => {
    if (process.env.PAP_DATABASE_ENV !== 'test' || !process.env.DATABASE_URL) {
      throw new DatabaseConfigError(
        'Test integracyjny Wave 2 Slice 3 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }
    runtimeUrl = (process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL ?? '').trim();
    if (!runtimeUrl) {
      throw new DatabaseConfigError('Brak PAP_EPHEMERAL_RUNTIME_DATABASE_URL.');
    }

    idp = await startIsolatedOidcIdp({
      clientId: 'pap-web',
      resourceAudience: 'pap-api',
      allowedRedirectUris: [redirectUri],
      accessTokenTtlSeconds: 300,
    });

    idp.registerUser({
      subject: 'owner-oidc-sub-katarzyna',
      email: 'katarzyna.wlascicielka@syntetyczne-biuro.example',
      displayName: 'Katarzyna Właścicielka',
    });
    idp.registerUser({
      subject: 'unassigned-oidc-sub-tomasz',
      email: 'tomasz.nowy@syntetyczne-biuro.example',
      displayName: 'Tomasz Bez Organizacji',
    });
    idp.registerUser({
      subject: 'collision-oidc-sub-outsider',
      email: 'katarzyna.wlascicielka@syntetyczne-biuro.example', // Celowo identyczny e-mail jak właścicielka!
      displayName: 'Atakujący Kolizją E-mail',
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

  it('wycofuje całą transakcję przy awarii prowizjonowania początkowej spółki, a następnie wykonuje audytowany CLI bootstrap, idempotentny replay, 1->N organizacji i 1->M podmiotów między 2 instancjami API', async () => {
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

    // 1. Negatywny test CLI: nieznana flaga zwraca kod wyjścia 2 i zero śladów w bazie
    const badStderr: string[] = [];
    const badExit = await runBootstrapOwnerCli(['--nieznana-flaga', 'wartosc'], baseApiEnv, {
      stdout: () => undefined,
      stderr: (line) => badStderr.push(line),
    });
    expect(badExit).toBe(2);
    expect(badStderr[0]).toContain('invalid_bootstrap_request');

    // 2. Test atomowości transakcji: awaria podczas zapisu początkowej spółki wycofuje także app_user, tenant i pap_identity_lifecycle_event!
    const rtFault = await createApiRuntimeServicesAsync(baseApiEnv);
    try {
      rtFault.ownerBootstrap.beforeInitialCompanyCommitHook = () => {
        throw new Error('Symulowana awaria w trakcie inicjalizacji spółki początkowej');
      };
      await expect(
        rtFault.ownerBootstrap.bootstrapInitialOwner({
          operationId: randomUUID(),
          issuer: idp!.issuer,
          subject: 'owner-oidc-sub-katarzyna',
          displayName: 'Katarzyna Właścicielka',
          email: 'katarzyna.wlascicielka@syntetyczne-biuro.example',
          tenantName: 'Kancelaria Podatkowa Katarzyna Sp. z o.o.',
          reason: 'Test wycofania atomowej transakcji bootstrapu właściciela',
          initialCompany: {
            displayName: 'Spółka Wycofana Sp. z o.o.',
            nip: '5213017228',
            legalForm: 'sp_z_o_o',
            profileCode: 'spzoo_pelne_ksiegi',
            vatStatus: 'czynny',
            address: 'ul. Marszałkowska 10, 00-590 Warszawa',
          },
        }),
      ).rejects.toThrow('Symulowana awaria');
    } finally {
      await rtFault.close?.();
    }

    const [orphanCheck] = await owner!.client`
      SELECT
        (SELECT count(*)::int FROM app_user) AS users_cnt,
        (SELECT count(*)::int FROM tenant) AS tenants_cnt,
        (SELECT count(*)::int FROM legal_entity) AS entities_cnt,
        (SELECT count(*)::int FROM pap_identity_lifecycle_event) AS events_cnt
    `;
    expect(orphanCheck).toEqual({
      users_cnt: 0,
      tenants_cnt: 0,
      entities_cnt: 0,
      events_cnt: 0,
    });

    // 3. Prawidłowy jednorazowy bootstrap właściciela z początkową spółką przez CLI
    const bootstrapOpId = randomUUID();
    const initialCompanyJson = JSON.stringify({
      displayName: 'Kancelaria Katarzyna Pierwsza Sp. z o.o.',
      nip: '5213017228',
      legalForm: 'sp_z_o_o',
      profileCode: 'spzoo_pelne_ksiegi',
      vatStatus: 'czynny',
      address: 'ul. Marszałkowska 10, 00-590 Warszawa',
    });

    const cliStdout: string[] = [];
    const cliStderr: string[] = [];
    const cliExit = await runBootstrapOwnerCli(
      [
        '--operation-id',
        bootstrapOpId,
        '--issuer',
        idp!.issuer,
        '--subject',
        'owner-oidc-sub-katarzyna',
        '--display-name',
        'Katarzyna Właścicielka',
        '--email',
        'katarzyna.wlascicielka@syntetyczne-biuro.example',
        '--tenant-name',
        'Kancelaria Podatkowa Katarzyna Sp. z o.o.',
        '--reason',
        'Jednorazowa inicjalizacja właściciela platformy PAP (#83)',
        '--initial-company-json',
        initialCompanyJson,
      ],
      baseApiEnv,
      {
        stdout: (line) => cliStdout.push(line),
        stderr: (line) => cliStderr.push(line),
      },
    );

    expect(cliStderr).toEqual([]);
    expect(cliExit).toBe(0);
    const bootstrapped = BootstrapOwnerResponseSchema.parse(JSON.parse(cliStdout[0]!));
    expect(bootstrapped.idempotentReplay).toBe(false);
    expect(bootstrapped.role).toBe('tenant_owner');
    expect(bootstrapped.legalEntityId).toBeTruthy();

    // 4. Idempotentny replay tego samego operationId zwraca exitCode 0 oraz idempotentReplay: true
    const replayStdout: string[] = [];
    const replayExit = await runBootstrapOwnerCli(
      [
        '--operation-id',
        bootstrapOpId,
        '--issuer',
        idp!.issuer,
        '--subject',
        'owner-oidc-sub-katarzyna',
        '--display-name',
        'Katarzyna Właścicielka',
        '--email',
        'katarzyna.wlascicielka@syntetyczne-biuro.example',
        '--tenant-name',
        'Kancelaria Podatkowa Katarzyna Sp. z o.o.',
        '--reason',
        'Jednorazowa inicjalizacja właściciela platformy PAP (#83)',
        '--initial-company-json',
        initialCompanyJson,
      ],
      baseApiEnv,
      {
        stdout: (line) => replayStdout.push(line),
        stderr: () => undefined,
      },
    );
    expect(replayExit).toBe(0);
    const replayed = BootstrapOwnerResponseSchema.parse(JSON.parse(replayStdout[0]!));
    expect(replayed.idempotentReplay).toBe(true);
    expect(replayed.userId).toBe(bootstrapped.userId);
    expect(replayed.tenantId).toBe(bootstrapped.tenantId);
    expect(replayed.legalEntityId).toBe(bootstrapped.legalEntityId);

    // 5. Próba drugiego bootstrapu z nowym operationId kończy się odmową 409 owner_already_bootstrapped (exitCode 3)
    const secondStderr: string[] = [];
    const secondExit = await runBootstrapOwnerCli(
      [
        '--operation-id',
        randomUUID(),
        '--issuer',
        idp!.issuer,
        '--subject',
        'collision-oidc-sub-outsider',
        '--display-name',
        'Nieuprawniony Drugi Właściciel',
        '--email',
        'outsider@syntetyczne-biuro.example',
        '--tenant-name',
        'Przejęta Organizacja',
        '--reason',
        'Próba ponownego bootstrapu po inicjalizacji właściciela',
      ],
      baseApiEnv,
      {
        stdout: () => undefined,
        stderr: (line) => secondStderr.push(line),
      },
    );
    expect(secondExit).toBe(3);
    expect(secondStderr[0]).toContain('owner_already_bootstrapped');

    // 6. Przygotowujemy również:
    //    - drugą organizację dla tej samej właścicielki (1 user -> 2 tenants),
    //    - użytkownika OIDC bez żadnej organizacji (no_tenant_membership),
    //    - użytkownika z kolizją e-mail (ten sam e-mail co właścicielka, ale inny subject OIDC!).
    const secondTenantId = randomUUID();
    const unassignedUserId = randomUUID();
    const collisionUserId = randomUUID();

    await owner!.client`
      INSERT INTO tenant (id, name, created_at)
      VALUES (${secondTenantId}, 'Druga Organizacja Doradcza Katarzyny', '2026-03-01T00:00:00Z')
    `;
    await owner!.client`
      INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from)
      VALUES (${secondTenantId}, ${bootstrapped.userId}, 'tenant_admin', 'active', '2026-03-01T00:00:00Z')
    `;

    const identityStore = new PostgresUserIdentityStore(owner!.db);
    await identityStore.provisionUserWithOidcIdentity({
      userId: unassignedUserId as ReturnType<typeof import('@pap/domain').userId>,
      identityId: randomUUID(),
      issuer: idp!.issuer,
      subject: 'unassigned-oidc-sub-tomasz',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: collisionUserId as ReturnType<typeof import('@pap/domain').userId>,
      identityId: randomUUID(),
      issuer: idp!.issuer,
      subject: 'collision-oidc-sub-outsider',
    });

    // 7. Uruchamiamy DWIE niezależne instancje @pap/api bez syntetycznego seeda (PAP_SEED_SYNTHETIC_DEMO=false)
    const inst1 = await bootApiInstance(baseApiEnv);
    const inst2 = await bootApiInstance(baseApiEnv);
    openApps.add(inst1.app);
    openApps.add(inst2.app);

    const ownerToken = await obtainOidcBearerToken(
      idp!,
      redirectUri,
      'owner-oidc-sub-katarzyna',
    );
    const unassignedToken = await obtainOidcBearerToken(
      idp!,
      redirectUri,
      'unassigned-oidc-sub-tomasz',
    );
    const collisionToken = await obtainOidcBearerToken(
      idp!,
      redirectUri,
      'collision-oidc-sub-outsider',
    );

    // 8. Właścicielka zakłada DRUGI podmiot prawny w pierwszej organizacji na instancji #1 (1 tenant -> 2 companies)
    const createSecondCompRes = await fetch(
      `${inst1.baseUrl}/api/v1/tenants/${bootstrapped.tenantId}/companies`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Kancelaria Katarzyna Druga JDG',
          nip: '5250002008',
          legalForm: 'jdg',
          profileCode: 'jdg_kpir_liniowy',
          vatStatus: 'czynny',
          address: 'ul. Królewska 5, 30-045 Kraków',
        }),
      },
    );
    expect(createSecondCompRes.status).toBe(201);
    const secondCompany = CreateCompanyResponseSchema.parse(await createSecondCompRes.json());

    // Oraz podmiot prawny w DRUGIEJ organizacji na instancji #1 (jako tenant_admin)
    const createSecondTenantCompRes = await fetch(
      `${inst1.baseUrl}/api/v1/tenants/${secondTenantId}/companies`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          displayName: 'Doradztwo Katarzyna Ryczałt',
          nip: '5261040828',
          legalForm: 'jdg',
          profileCode: 'jdg_ryczalt',
          vatStatus: 'zwolniony',
          address: 'ul. Gdańska 12, 80-001 Gdańsk',
        }),
      },
    );
    expect(createSecondTenantCompRes.status).toBe(201);
    const secondTenantCompany = CreateCompanyResponseSchema.parse(
      await createSecondTenantCompRes.json(),
    );

    // 9. Odczyt GET /api/v1/me/session na INSTANCJI #2 widzi obie organizacje i wszystkie 3 podmioty prawne
    const meOnInst2Res = await fetch(
      `${inst2.baseUrl}/api/v1/me/session?tenantId=${bootstrapped.tenantId}&legalEntityId=${secondCompany.company.legalEntityId}`,
      {
        headers: { Authorization: `Bearer ${ownerToken}` },
      },
    );
    expect(meOnInst2Res.status).toBe(200);
    const meView1 = AuthenticatedSessionViewSchema.parse(await meOnInst2Res.json());
    expect(meView1.state).toBe('authenticated');
    expect(meView1.authMethod).toBe('oidc');
    expect(meView1.displayName).toBe('Katarzyna Właścicielka');
    expect(meView1.email).toBe('katarzyna.wlascicielka@syntetyczne-biuro.example');
    expect(meView1.tenantId).toBe(bootstrapped.tenantId);
    expect(meView1.legalEntityId).toBe(secondCompany.company.legalEntityId);
    expect(meView1.memberships).toHaveLength(2);
    expect(meView1.companies).toHaveLength(3);

    // Przełączenie aktywnej organizacji na secondTenantId na instancji #2 wybiera właściwy podmiot z drugiej organizacji
    const switchTenantRes = await fetch(
      `${inst2.baseUrl}/api/v1/me/session?tenantId=${secondTenantId}`,
      {
        headers: { Authorization: `Bearer ${ownerToken}` },
      },
    );
    expect(switchTenantRes.status).toBe(200);
    const meView2 = AuthenticatedSessionViewSchema.parse(await switchTenantRes.json());
    expect(meView2.tenantId).toBe(secondTenantId);
    expect(meView2.legalEntityId).toBe(secondTenantCompany.company.legalEntityId);

    // 10. Użytkownik bez członkostwa (Tomasz) oraz użytkownik z kolizją e-mail (Outsider) dostają no_tenant_membership i zero firm!
    for (const token of [unassignedToken, collisionToken]) {
      const res = await fetch(
        `${inst2.baseUrl}/api/v1/me/session?tenantId=${bootstrapped.tenantId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      expect(res.status).toBe(200);
      const view = AuthenticatedSessionViewSchema.parse(await res.json());
      expect(view.state).toBe('no_tenant_membership');
      expect(view.tenantId).toBeNull();
      expect(view.legalEntityId).toBeNull();
      expect(view.memberships).toEqual([]);
      expect(view.companies).toEqual([]);
    }
  });
});
