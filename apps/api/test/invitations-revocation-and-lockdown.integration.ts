import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { OidcConfigError } from '@pap/application';
import {
  AcceptTenantInvitationResponseSchema,
  AccessMutationResponseSchema,
  AuthenticatedSessionViewSchema,
  CompanyAccessResponseSchema,
  CreateCompanyResponseSchema,
  CreateTenantInvitationResponseSchema,
  ListTenantInvitationsResponseSchema,
  RejectTenantInvitationResponseSchema,
  RevokeTenantInvitationResponseSchema,
} from '@pap/contracts';
import {
  DatabaseConfigError,
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
import { runBootstrapOwnerCli } from '../src/cli/bootstrap-owner.js';
import {
  createApiRuntimeServices,
  createApiRuntimeServicesAsync,
} from '../src/runtime/workspace-runtime.js';
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

async function postBffAuthenticatedJson(params: {
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

describe('Wave 2 Slice 4 — Zaproszenia (single-use + SHA-256), granice delegacji, natychmiastowe cofanie dostępu między instancjami API oraz blokada sandboxu PAP_RUNTIME_MODE (#83)', () => {
  const keyId = 'pap-api-wave2-s4-ctx';
  const keyHex = randomBytes(32).toString('hex');
  const sessionSecret = randomBytes(32).toString('hex');
  const redirectUri = 'http://127.0.0.1:3204/api/session/oidc/callback';

  let dataSchema = '';
  let runtimeUrl = '';
  let owner: ReturnType<typeof connectDatabase> | undefined;
  let schemaCreated = false;
  let idp: IsolatedOidcIdpHandle | undefined;
  const openApps = new Set<NestFastifyApplication>();

  beforeAll(async () => {
    if (process.env.PAP_DATABASE_ENV !== 'test' || !process.env.DATABASE_URL) {
      throw new DatabaseConfigError(
        'Test integracyjny Wave 2 Slice 4 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
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
      subject: 's4-owner-marek',
      email: 'marek.wlasciciel@syntetyczne-biuro.example',
      displayName: 'Marek Właściciel',
    });
    idp.registerUser({
      subject: 's4-ksiegowa-anna',
      email: 'anna.ksiegowa@syntetyczne-biuro.example',
      displayName: 'Anna Księgowa',
    });
    idp.registerUser({
      subject: 's4-admin-piotr',
      email: 'piotr.admin@syntetyczne-biuro.example',
      displayName: 'Piotr Administrator',
    });
    idp.registerUser({
      subject: 's4-asystent-celina',
      email: 'celina.asystent@syntetyczne-biuro.example',
      displayName: 'Celina Asystentka',
    });
    idp.registerUser({
      subject: 's4-odrzucajacy-damian',
      email: 'damian.odrzucajacy@syntetyczne-biuro.example',
      displayName: 'Damian Odrzucający',
    });
    idp.registerUser({
      subject: 's4-nieprowizjonowany-obcy',
      email: 'obcy.intruz@syntetyczne-biuro.example',
      displayName: 'Obcy Intruz',
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
  }, 60_000);

  afterAll(async () => {
    for (const app of openApps) {
      await app.close().catch(() => undefined);
    }
    openApps.clear();
    if (idp) {
      await idp.close().catch(() => undefined);
    }
    if (owner && schemaCreated) {
      await owner.client`DROP SCHEMA IF EXISTS ${owner.client(dataSchema)} CASCADE`.catch(
        () => undefined,
      );
    }
    if (owner) {
      await owner.client.end({ timeout: 2 }).catch(() => undefined);
    }
  });

  function makeRuntimeEnv(
    overrides: Readonly<Record<string, string | undefined>> = {},
  ): Record<string, string | undefined> {
    return {
      NODE_ENV: 'test',
      PAP_RUNTIME_MODE: 'STAGING_PRIVATE',
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: keyHex,
      PAP_WEB_SESSION_SECRET: sessionSecret,
      PAP_SANDBOX_AUTH_ENABLED: 'false',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_OIDC_ISSUER: idp!.issuer,
      PAP_OIDC_AUDIENCE: idp!.resourceAudience,
      PAP_OIDC_JWKS_URI: idp!.jwksUri,
      ...overrides,
    };
  }

  it('egzekwuje blokadę PAP_RUNTIME_MODE (STAGING_PRIVATE, PUBLIC_DEMO, PRODUCTION) przeciwko PAP_SANDBOX_AUTH_ENABLED oraz PAP_SEED_SYNTHETIC_DEMO (fail-closed OidcConfigError)', async () => {
    for (const mode of ['STAGING_PRIVATE', 'PUBLIC_DEMO', 'PRODUCTION'] as const) {
      expect(() =>
        createApiRuntimeServices(
          makeRuntimeEnv({
            PAP_RUNTIME_MODE: mode,
            PAP_SANDBOX_AUTH_ENABLED: 'true',
          }),
        ),
      ).toThrow(OidcConfigError);

      await expect(
        createApiRuntimeServicesAsync(
          makeRuntimeEnv({
            PAP_RUNTIME_MODE: mode,
            PAP_SANDBOX_AUTH_ENABLED: 'true',
          }),
        ),
      ).rejects.toThrow(OidcConfigError);

      await expect(
        createApiRuntimeServicesAsync(
          makeRuntimeEnv({
            PAP_RUNTIME_MODE: mode,
            PAP_SEED_SYNTHETIC_DEMO: 'true',
          }),
        ),
      ).rejects.toThrow(OidcConfigError);
    }

    // NODE_ENV=production nie pozwala na degradację do LOCAL_DEV
    expect(() =>
      createApiRuntimeServices(
        makeRuntimeEnv({
          NODE_ENV: 'production',
          PAP_RUNTIME_MODE: 'LOCAL_DEV',
        }),
      ),
    ).toThrow(OidcConfigError);
  });

  it('obsługuje pełny cykl życia zaproszeń, ograniczone granty firmowe i natychmiastowe cofanie dostępu między dwiema instancjami API w trybie STAGING_PRIVATE', async () => {
    const cliOut: string[] = [];
    const cliErr: string[] = [];

    const bootstrapExit = await runBootstrapOwnerCli(
      [
        '--issuer',
        idp!.issuer,
        '--subject',
        's4-owner-marek',
        '--display-name',
        'Marek Właściciel',
        '--email',
        'marek.wlasciciel@syntetyczne-biuro.example',
        '--tenant-name',
        'Kancelaria Rachunkowa Alfa Sp. z o.o.',
        '--reason',
        'Jednorazowy bootstrap właściciela dla testu Wave 2 Slice 4',
      ],
      makeRuntimeEnv(),
      {
        stdout: (line) => cliOut.push(line),
        stderr: (line) => cliErr.push(line),
      },
    );
    expect(bootstrapExit).toBe(0);
    expect(cliErr).toEqual([]);
    const bootstrapReceipt = JSON.parse(cliOut[0]!) as {
      readonly userId: string;
      readonly tenantId: string;
    };
    const tenantId = bootstrapReceipt.tenantId;

    const instA = await bootApiInstance(makeRuntimeEnv());
    openApps.add(instA.app);
    const instB = await bootApiInstance(makeRuntimeEnv());
    openApps.add(instB.app);

    // W STAGING_PRIVATE endpointy piaskownicy są wyłączone (404)
    const sandboxTokenAttempt = await fetch(`${instA.baseUrl}/api/v1/auth/sandbox-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personaKey: 'owner' }),
    });
    expect(sandboxTokenAttempt.status).toBe(404);

    const ownerToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-owner-marek');

    // Właściciel tworzy 2 firmy w tej samej organizacji na Instancji A
    const createComp1Res = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Alfa Usługi Księgowe JDG',
        nip: '5250002008',
        legalForm: 'jdg',
        profileCode: 'jdg_kpir_liniowy',
      }),
    });
    expect(createComp1Res.status).toBe(201);
    const comp1 = CreateCompanyResponseSchema.parse(await createComp1Res.json()).company;

    const createComp2Res = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/companies`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: 'Alfa Audyt Sp. z o.o.',
        nip: '5213017228',
        legalForm: 'sp_z_o_o',
        profileCode: 'spzoo_pelne_ksiegi',
      }),
    });
    expect(createComp2Res.status).toBe(201);
    const comp2 = CreateCompanyResponseSchema.parse(await createComp2Res.json()).company;

    // Drugi realny użytkownik OIDC (Anna) loguje się przez BFF /identity/ensure na Instancji B -> stan no_tenant_membership
    const annaToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-ksiegowa-anna');
    const ensureAnnaRes = await postBffAuthenticatedJson({
      baseUrl: instB.baseUrl,
      path: '/api/v1/auth/bff/identity/ensure',
      webSessionSecret: sessionSecret,
      payload: {
        accessToken: annaToken,
        displayName: 'Anna Księgowa',
        email: 'anna.ksiegowa@syntetyczne-biuro.example',
      },
    });
    expect(ensureAnnaRes.status).toBe(200);
    const ensureAnnaJson = (await ensureAnnaRes.json()) as {
      readonly ok: boolean;
      readonly userId: string;
    };
    expect(ensureAnnaJson.ok).toBe(true);

    const annaPreSessionRes = await fetch(`${instB.baseUrl}/api/v1/me/session`, {
      headers: { Authorization: `Bearer ${annaToken}` },
    });
    expect(annaPreSessionRes.status).toBe(200);
    const annaPreSession = AuthenticatedSessionViewSchema.parse(await annaPreSessionRes.json());
    expect(annaPreSession.state).toBe('no_tenant_membership');
    expect(annaPreSession.companies).toEqual([]);

    // Właściciel na Instancji A zaprasza Annę jako tenant_member z ograniczonym dostępem wyłącznie do odczytu Firmy 1
    const inviteAnnaRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'anna.ksiegowa@syntetyczne-biuro.example',
        inviteeDisplayName: 'Anna Księgowa',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [
          {
            legalEntityId: comp1.legalEntityId,
            actions: ['read'],
          },
        ],
        expiresInHours: 48,
        reason: 'Nadanie dostępu tylko do odczytu dla księgowej obsługującej JDG',
      }),
    });
    expect(inviteAnnaRes.status).toBe(201);
    const inviteAnnaBody = CreateTenantInvitationResponseSchema.parse(await inviteAnnaRes.json());
    const rawInviteToken = inviteAnnaBody.invitationToken;
    expect(inviteAnnaBody.acceptPath).toContain('/login?invite=');

    // Weryfikacja w PostgreSQL: surowy token NIGDY nie jest zapisywany w tabeli zaproszeń ani w audycie
    const dbInvRows = await owner!.client<{
      readonly token_sha256: string;
      readonly raw_match: boolean;
    }[]>`
      SELECT token_sha256,
             (token_sha256 = ${rawInviteToken}) AS raw_match
      FROM ${owner!.client(dataSchema)}.pap_tenant_invitation
      WHERE id = ${inviteAnnaBody.invitation.invitationId}::uuid
    `;
    expect(dbInvRows).toHaveLength(1);
    expect(dbInvRows[0]!.raw_match).toBe(false);
    expect(dbInvRows[0]!.token_sha256).toBe(
      createHash('sha256').update(rawInviteToken, 'utf8').digest('hex'),
    );

    const auditLeakRows = await owner!.client<{ readonly cnt: string }[]>`
      SELECT count(*)::text AS cnt
      FROM ${owner!.client(dataSchema)}.pap_identity_lifecycle_event
      WHERE receipt::text LIKE ${`%${rawInviteToken}%`}
         OR request_key LIKE ${`%${rawInviteToken}%`}
    `;
    expect(auditLeakRows[0]!.cnt).toBe('0');

    // Duplikat oczekującego zaproszenia na ten sam e-mail zwraca 409 duplicate_pending_invitation
    const dupInviteRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'ANNA.KSIEGOWA@syntetyczne-biuro.example',
        intendedRole: 'tenant_member',
        reason: 'Próba zduplikowanego zaproszenia dla tego samego e-maila',
      }),
    });
    expect(dupInviteRes.status).toBe(409);

    // Zakaz samo-akceptacji zaproszenia przez wystawiającego właściciela (403 self_invitation_acceptance_forbidden)
    const selfAcceptRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: rawInviteToken,
      }),
    });
    expect(selfAcceptRes.status).toBe(403);
    expect(((await selfAcceptRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'self_invitation_acceptance_forbidden',
    );

    // Anna akceptuje zaproszenie na Instancji B
    const acceptAnnaRes = await fetch(`${instB.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${annaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: rawInviteToken,
      }),
    });
    expect(acceptAnnaRes.status).toBe(200);
    const acceptAnnaBody = AcceptTenantInvitationResponseSchema.parse(await acceptAnnaRes.json());
    expect(acceptAnnaBody.invitation.status).toBe('accepted');
    expect(acceptAnnaBody.grantedCompanyIds).toEqual([comp1.legalEntityId]);

    // Powtórne użycie tego samego tokenu zaproszenia zwraca 409 invitation_already_used (single-use)
    const replayAcceptRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${annaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: rawInviteToken,
      }),
    });
    expect(replayAcceptRes.status).toBe(409);
    expect(((await replayAcceptRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'invitation_already_used',
    );

    // Anna ma dostęp do odczytu Firmy 1 (200), ale NIE ma prawa zapisu w Firmie 1 (403) ani dostępu do Firmy 2 (403)
    const annaComp1Read = await fetch(
      `${instB.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1.legalEntityId}/overview`,
      { headers: { Authorization: `Bearer ${annaToken}` } },
    );
    expect(annaComp1Read.status).toBe(200);

    const annaComp1WriteDenied = await fetch(
      `${instB.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1.legalEntityId}/documents`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${annaToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documentType: 'cost_invoice',
          documentNumber: 'FV/NIEAUTORYZOWANA/01',
          issueDate: '2026-10-15',
          saleDate: '2026-10-15',
          counterpartyName: 'Kontrahent Testowy Sp. z o.o.',
          counterpartyNip: '5261040828',
          currency: 'PLN',
          lines: [
            {
              description: 'Usługa doradcza',
              quantity: '1',
              unitPriceNetGrosze: 10000,
              vatRateCode: '23',
              netGrosze: 10000,
              vatGrosze: 2300,
              grossGrosze: 12300,
            },
          ],
        }),
      },
    );
    expect(annaComp1WriteDenied.status).toBe(403);

    const annaComp2Denied = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp2.legalEntityId}/overview`,
      { headers: { Authorization: `Bearer ${annaToken}` } },
    );
    expect(annaComp2Denied.status).toBe(403);

    // Właściciel na Instancji A (która nie wykonywała akceptacji!) widzi grant Anny i cofa go po grantId
    const accessListRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1.legalEntityId}/access`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    expect(accessListRes.status).toBe(200);
    const accessList = CompanyAccessResponseSchema.parse(await accessListRes.json());
    const annaGrant = accessList.grants.find(
      (g) => g.userId === ensureAnnaJson.userId && g.action === 'read' && g.active,
    );
    expect(annaGrant).toBeDefined();

    const revokeGrantRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1.legalEntityId}/grants/${annaGrant!.grantId}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(revokeGrantRes.status).toBe(200);
    AccessMutationResponseSchema.parse(await revokeGrantRes.json());

    // Natychmiast (0 ms oczekiwania) Instancja B odmawia Annie odczytu Firmy 1 (403)
    const annaAfterGrantRevoke = await fetch(
      `${instB.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1.legalEntityId}/overview`,
      { headers: { Authorization: `Bearer ${annaToken}` } },
    );
    expect(annaAfterGrantRevoke.status).toBe(403);

    const annaSessionAfterGrantRevokeRes = await fetch(`${instB.baseUrl}/api/v1/me/session`, {
      headers: { Authorization: `Bearer ${annaToken}` },
    });
    expect(annaSessionAfterGrantRevokeRes.status).toBe(200);
    const annaSessionAfterGrantRevoke = AuthenticatedSessionViewSchema.parse(
      await annaSessionAfterGrantRevokeRes.json(),
    );
    expect(annaSessionAfterGrantRevoke.state).toBe('authenticated');
    expect(annaSessionAfterGrantRevoke.companies).toEqual([]);

    // Właściciel na Instancji A cofa członkostwo Anny w organizacji -> Instancja B natychmiast przechodzi w stan no_tenant_membership
    const revokeMembershipRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/memberships/${ensureAnnaJson.userId}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Zakończenie współpracy z zewnętrzną księgową',
        }),
      },
    );
    expect(revokeMembershipRes.status).toBe(200);
    AccessMutationResponseSchema.parse(await revokeMembershipRes.json());

    const annaSessionAfterMemberRevokeRes = await fetch(`${instB.baseUrl}/api/v1/me/session`, {
      headers: { Authorization: `Bearer ${annaToken}` },
    });
    expect(annaSessionAfterMemberRevokeRes.status).toBe(200);
    const annaSessionAfterMemberRevoke = AuthenticatedSessionViewSchema.parse(
      await annaSessionAfterMemberRevokeRes.json(),
    );
    expect(annaSessionAfterMemberRevoke.state).toBe('no_tenant_membership');
    expect(annaSessionAfterMemberRevoke.tenantId).toBeNull();
  });

  it('egzekwuje granice delegacji tenant_admin, ochronę TOCTOU przy cofnięciu uprawnień zapraszającego, odrzucenie zaproszenia oraz zero wycieku app_user przy fałszywym tokenie', async () => {
    const instA = await bootApiInstance(makeRuntimeEnv());
    openApps.add(instA.app);

    const ownerToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-owner-marek');
    const sessionRes = await fetch(`${instA.baseUrl}/api/v1/me/session`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    const ownerSession = AuthenticatedSessionViewSchema.parse(await sessionRes.json());
    const tenantId = ownerSession.tenantId!;
    const comp1Id = ownerSession.companies[0]!.legalEntityId;
    const comp2Id = ownerSession.companies[1]!.legalEntityId;

    // 1. Nieprowizjonowany intruz z fałszywym tokenem zaproszenia dostaje 404 i NIE tworzy rekordu app_user!
    const intruzToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-nieprowizjonowany-obcy');
    const bogusAcceptRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${intruzToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: randomBytes(32).toString('base64url'),
      }),
    });
    expect(bogusAcceptRes.status).toBe(404);

    const intruzIdentityRows = await owner!.client<{ readonly cnt: string }[]>`
      SELECT count(*)::text AS cnt
      FROM ${owner!.client(dataSchema)}.user_oidc_identity
      WHERE subject = 's4-nieprowizjonowany-obcy'
    `;
    expect(intruzIdentityRows[0]!.cnt).toBe('0');

    // 2. Właściciel zaprasza Piotra jako tenant_admin z dostępem wyłącznie do odczytu Firmy 1
    const invPiotrRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'piotr.admin@syntetyczne-biuro.example',
        intendedRole: 'tenant_admin',
        initialCompanyGrants: [{ legalEntityId: comp1Id, actions: ['read'] }],
        reason: 'Powołanie administratora z zakresem wyłącznie do odczytu Firmy 1',
      }),
    });
    expect(invPiotrRes.status).toBe(201);
    const invPiotr = CreateTenantInvitationResponseSchema.parse(await invPiotrRes.json());

    const piotrToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-admin-piotr');
    const acceptPiotrRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${piotrToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: invPiotr.invitationToken }),
    });
    expect(acceptPiotrRes.status).toBe(200);

    // 3. Piotr (tenant_admin) NIE może zaprosić tenant_owner ani drugiego tenant_admin (403 target_role_not_delegable)
    for (const forbiddenRole of ['tenant_owner', 'tenant_admin'] as const) {
      const escRoleRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${piotrToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inviteeEmail: `eskalacja-${forbiddenRole}@syntetyczne-biuro.example`,
          intendedRole: forbiddenRole,
          reason: 'Próba eskalacji roli przez administratora tenanta',
        }),
      });
      expect(escRoleRes.status).toBe(403);
      expect(((await escRoleRes.json()) as { reasonCode?: string }).reasonCode).toBe(
        'target_role_not_delegable',
      );
    }

    // 4. Piotr NIE może delegować Firmy 2 (brak grantu) ani akcji write w Firmie 1 (posiada tylko read) -> 403 grant_scope_not_delegable
    const escComp2Res = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${piotrToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'celina.asystent@syntetyczne-biuro.example',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [{ legalEntityId: comp2Id, actions: ['read'] }],
        reason: 'Próba delegacji nieautoryzowanej firmy przez administratora',
      }),
    });
    expect(escComp2Res.status).toBe(403);
    expect(((await escComp2Res.json()) as { reasonCode?: string }).reasonCode).toBe(
      'grant_scope_not_delegable',
    );

    const escWriteRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${piotrToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'celina.asystent@syntetyczne-biuro.example',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [{ legalEntityId: comp1Id, actions: ['read', 'write'] }],
        reason: 'Próba delegacji uprawnienia zapisu bez posiadania grantu write',
      }),
    });
    expect(escWriteRes.status).toBe(403);
    expect(((await escWriteRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'grant_scope_not_delegable',
    );

    // 5. Piotr zaprasza Celinę z dozwolonym grantem read do Firmy 1, ale ZANIM Celina zaakceptuje, Właściciel cofa grant Piotra (TOCTOU!)
    const invCelinaRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${piotrToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'celina.asystent@syntetyczne-biuro.example',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [{ legalEntityId: comp1Id, actions: ['read'] }],
        reason: 'Legalne zaproszenie przed cofnięciem grantu administratora',
      }),
    });
    expect(invCelinaRes.status).toBe(201);
    const invCelina = CreateTenantInvitationResponseSchema.parse(await invCelinaRes.json());

    const comp1AccessRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1Id}/access`,
      { headers: { Authorization: `Bearer ${ownerToken}` } },
    );
    const comp1Access = CompanyAccessResponseSchema.parse(await comp1AccessRes.json());
    const piotrMember = comp1Access.members.find((m) => m.tenantRole === 'tenant_admin')!;
    const piotrGrant = comp1Access.grants.find(
      (g) => g.userId === piotrMember.userId && g.action === 'read' && g.active,
    )!;

    const revokePiotrGrantRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/companies/${comp1Id}/grants/${piotrGrant.grantId}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
    );
    expect(revokePiotrGrantRes.status).toBe(200);

    // Celina próbuje zaakceptować zaproszenie wystawione przez Piotra po utracie przez niego grantu -> 403 inviter_authority_revoked i pełny rollback!
    const celinaToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-asystent-celina');
    const acceptCelinaRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${celinaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: invCelina.invitationToken }),
    });
    expect(acceptCelinaRes.status).toBe(403);
    expect(((await acceptCelinaRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'inviter_authority_revoked',
    );

    const celinaIdentityRows = await owner!.client<{ readonly cnt: string }[]>`
      SELECT count(*)::text AS cnt
      FROM ${owner!.client(dataSchema)}.user_oidc_identity
      WHERE subject = 's4-asystent-celina'
    `;
    expect(celinaIdentityRows[0]!.cnt).toBe('0');

    // 6. Cofnięcie oczekującego zaproszenia przez Właściciela + próba akceptacji cofniętego zaproszenia (403 invitation_revoked)
    const revokeCelinaInvRes = await fetch(
      `${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations/${invCelina.invitation.invitationId}/revoke`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ownerToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Cofnięcie zaproszenia po zmianie zakresu uprawnień' }),
      },
    );
    expect(revokeCelinaInvRes.status).toBe(200);
    const revokedInv = RevokeTenantInvitationResponseSchema.parse(await revokeCelinaInvRes.json());
    expect(revokedInv.invitation.status).toBe('revoked');

    const acceptRevokedRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${celinaToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: invCelina.invitationToken }),
    });
    expect(acceptRevokedRes.status).toBe(403);
    expect(((await acceptRevokedRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'invitation_revoked',
    );

    // 7. Świadome odrzucenie zaproszenia przez adresata (POST /invitations/reject) i audyt listowania zaproszeń
    const invDamianRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inviteeEmail: 'damian.odrzucajacy@syntetyczne-biuro.example',
        intendedRole: 'tenant_member',
        reason: 'Zaproszenie testowe do scenariusza odrzucenia',
      }),
    });
    expect(invDamianRes.status).toBe(201);
    const invDamian = CreateTenantInvitationResponseSchema.parse(await invDamianRes.json());

    const damianToken = await obtainOidcBearerToken(idp!, redirectUri, 's4-odrzucajacy-damian');
    const rejectDamianRes = await fetch(`${instA.baseUrl}/api/v1/invitations/reject`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${damianToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: invDamian.invitationToken,
        reason: 'Nie należę do tej kancelarii podatkowej',
      }),
    });
    expect(rejectDamianRes.status).toBe(200);
    const rejectedDamian = RejectTenantInvitationResponseSchema.parse(await rejectDamianRes.json());
    expect(rejectedDamian.invitation.status).toBe('rejected');

    const acceptAfterRejectRes = await fetch(`${instA.baseUrl}/api/v1/invitations/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${damianToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: invDamian.invitationToken }),
    });
    expect(acceptAfterRejectRes.status).toBe(409);
    expect(((await acceptAfterRejectRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'invitation_rejected',
    );

    const listInvRes = await fetch(`${instA.baseUrl}/api/v1/tenants/${tenantId}/invitations`, {
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    expect(listInvRes.status).toBe(200);
    const listInv = ListTenantInvitationsResponseSchema.parse(await listInvRes.json());
    expect(listInv.invitations.length).toBeGreaterThanOrEqual(4);
    for (const item of listInv.invitations) {
      expect(item.inviteeMaskedEmail).toContain('***@');
    }
  });
});
