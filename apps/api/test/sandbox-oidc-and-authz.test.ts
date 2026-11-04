import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_TENANT_2_ID,
  DEMO_USER_JAN_ID,
  DEMO_USER_MARTA_ID,
  DEMO_USER_PIOTR_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  TENANT_2_ID,
} from '@pap/application';
import {
  IssueSandboxTokenResponseSchema,
  ListSandboxPersonasResponseSchema,
  OidcDiscoveryDocumentSchema,
} from '@pap/contracts';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppModule } from '../src/app.module.js';
import { OidcConfigError } from '../src/auth/oidc-config.js';

describe('Sandbox OIDC (ES256 fail-closed) and REST authorization matrix', () => {
  describe('when PAP_SANDBOX_AUTH_ENABLED is disabled (default fail-closed)', () => {
    let disabledApp: NestFastifyApplication;

    beforeAll(async () => {
      disabledApp = await NestFactory.create<NestFastifyApplication>(
        AppModule.register({}),
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await disabledApp.init();
    });

    afterAll(async () => {
      await disabledApp.close();
    });

    it.each([
      { method: 'GET' as const, url: '/.well-known/openid-configuration' },
      { method: 'GET' as const, url: '/api/v1/auth/sandbox/jwks.json' },
      { method: 'GET' as const, url: '/api/v1/oidc/personas' },
      { method: 'GET' as const, url: '/api/v1/auth/sandbox/personas' },
      { method: 'POST' as const, url: '/api/v1/oidc/token' },
      { method: 'POST' as const, url: '/api/v1/auth/sandbox/token' },
    ])('returns 404 Not Found on $method $url', async ({ method, url }) => {
      const response = await disabledApp
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url,
          ...(method === 'POST' ? { payload: { personaId: 'jan-testowy' } } : {}),
        });
      expect(response.statusCode).toBe(404);
    });

    it('throws OidcConfigError fail-closed at startup if PAP_SANDBOX_AUTH_ENABLED=true co-occurs with PAP_OIDC_ENV=staging or PAP_OIDC_JWKS_URI', async () => {
      const conflictingModule = AppModule.register({
        PAP_SANDBOX_AUTH_ENABLED: 'true',
        PAP_OIDC_ENV: 'staging',
        NODE_ENV: 'production',
        PAP_OIDC_ISSUER: 'https://oidc.example.com',
        PAP_OIDC_JWKS_URI: 'https://oidc.example.com/.well-known/jwks.json',
        PAP_OIDC_AUDIENCE: 'pap-api',
      });
      await expect(
        NestFactory.create<NestFastifyApplication>(
          conflictingModule,
          new FastifyAdapter({ logger: false }),
          { logger: false, abortOnError: false },
        ),
      ).rejects.toThrow(OidcConfigError);
    });
  });

  describe('when PAP_SANDBOX_AUTH_ENABLED=true (real ES256 JWKS + RBAC/tenant isolation)', () => {
    let app: NestFastifyApplication;
    let baseUrl: string;
    let janToken: string;
    let martaToken: string;
    let piotrToken: string;

    beforeAll(async () => {
      app = await NestFactory.create<NestFastifyApplication>(
        AppModule.register({ PAP_SANDBOX_AUTH_ENABLED: 'true' }),
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await app.listen(0, '127.0.0.1');
      const addr = app.getHttpServer().address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Failed to bind ephemeral TCP port');
      }
      baseUrl = `http://127.0.0.1:${addr.port}`;

      const issue = async (personaId: string): Promise<string> => {
        const res = await fetch(`${baseUrl}/api/v1/oidc/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ personaId }),
        });
        expect(res.status).toBe(200);
        const parsed = IssueSandboxTokenResponseSchema.parse(await res.json());
        return parsed.accessToken;
      };

      janToken = await issue('jan-testowy');
      martaToken = await issue('marta-ksiegowa');
      piotrToken = await issue('piotr-izolacyjny');
    });

    afterAll(async () => {
      await app.close();
    });

    it('exposes OIDC discovery and public-only ES256 JWKS and verifies issued tokens cryptographically', async () => {
      const discoveryRes = await fetch(`${baseUrl}/.well-known/openid-configuration`);
      expect(discoveryRes.status).toBe(200);
      const discovery = OidcDiscoveryDocumentSchema.parse(await discoveryRes.json());
      expect(discovery.id_token_signing_alg_values_supported).toEqual(['ES256']);

      const jwksRes = await fetch(discovery.jwks_uri);
      expect(jwksRes.status).toBe(200);
      const jwks = (await jwksRes.json()) as { keys: Record<string, unknown>[] };
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0]).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
      expect(jwks.keys[0]).not.toHaveProperty('d');

      const remoteJwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
      const verified = await jwtVerify(janToken, remoteJwks, {
        issuer: discovery.issuer,
        audience: 'pap-api',
        algorithms: ['ES256'],
      });
      expect(verified.payload.sub).toBe(DEMO_USER_JAN_ID);
      expect(verified.protectedHeader.alg).toBe('ES256');
      expect(verified.protectedHeader.typ).toBe('at+jwt');

      const aliasRes = await fetch(`${baseUrl}/api/v1/auth/sandbox/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId: 'piotr-beta' }),
      });
      expect(aliasRes.status).toBe(200);
      const aliasParsed = IssueSandboxTokenResponseSchema.parse(await aliasRes.json());
      expect(aliasParsed.persona.userId).toBe(DEMO_USER_PIOTR_ID);

      const personasRes = await fetch(`${baseUrl}/api/v1/auth/sandbox/personas`);
      expect(personasRes.status).toBe(200);
      const personas = ListSandboxPersonasResponseSchema.parse(await personasRes.json());
      expect(personas.personas.map((p) => p.personaId)).toEqual([
        'jan-testowy',
        'marta-ksiegowa',
        'piotr-izolacyjny',
      ]);
    });

    it('rejects unknown persona (404) and subject mismatch (400)', async () => {
      const unknownRes = await fetch(`${baseUrl}/api/v1/oidc/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId: 'nieznany-haker' }),
      });
      expect(unknownRes.status).toBe(404);

      const mismatchRes = await fetch(`${baseUrl}/api/v1/oidc/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ personaId: 'piotr-izolacyjny', sub: DEMO_USER_JAN_ID }),
      });
      expect(mismatchRes.status).toBe(400);
    });

    it('rejects missing token, forged JWT, query access_token, and x-user-id / x-tenant-id spoofing with 401', async () => {
      const noTokenRes = await fetch(`${baseUrl}/api/v1/me/companies`);
      expect(noTokenRes.status).toBe(401);

      const spoofWithoutToken = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/dashboard`,
        {
          headers: {
            'x-user-id': DEMO_USER_JAN_ID,
            'x-tenant-id': TENANT_1_ID,
          },
        },
      );
      expect(spoofWithoutToken.status).toBe(401);

      const spoofWithValidToken = await fetch(`${baseUrl}/api/v1/me/companies`, {
        headers: {
          authorization: `Bearer ${janToken}`,
          'x-user-id': DEMO_USER_JAN_ID,
        },
      });
      expect(spoofWithValidToken.status).toBe(401);

      const queryTokenRes = await fetch(
        `${baseUrl}/api/v1/me/companies?access_token=${encodeURIComponent(janToken)}`,
        {
          headers: { authorization: `Bearer ${janToken}` },
        },
      );
      expect(queryTokenRes.status).toBe(401);

      const tamperedJwt = `${janToken.slice(0, -4)}AAAA`;
      const tamperedRes = await fetch(`${baseUrl}/api/v1/me/companies`, {
        headers: { authorization: `Bearer ${tamperedJwt}` },
      });
      expect(tamperedRes.status).toBe(401);
    });

    it('enforces cross-tenant isolation: piotr-izolacyjny gets 403 on TENANT_1_ID and 200 on TENANT_2_ID', async () => {
      const crossTenantList = await fetch(`${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies`, {
        headers: { authorization: `Bearer ${piotrToken}` },
      });
      expect(crossTenantList.status).toBe(403);

      const crossTenantKpir = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
        {
          headers: { authorization: `Bearer ${piotrToken}` },
        },
      );
      expect(crossTenantKpir.status).toBe(403);

      const ownDashboard = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_2_ID}/companies/${COMPANY_TENANT_2_ID}/dashboard`,
        {
          headers: { authorization: `Bearer ${piotrToken}` },
        },
      );
      expect(ownDashboard.status).toBe(200);
    });

    it('enforces company-level delegated grants for marta-ksiegowa (read-only on Ryczałt, read+write on KPiR)', async () => {
      const ryczaltGet = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/ryczalt?period=2026-03`,
        {
          headers: { authorization: `Bearer ${martaToken}` },
        },
      );
      expect(ryczaltGet.status).toBe(200);

      const ryczaltPostDoc = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/documents`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${martaToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            documentNumber: 'FV-RYCZALT-DENIED/01',
            direction: 'sales',
            issueDate: '2026-03-18',
            counterpartyName: 'Kontrahent Test Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
            lines: [{ description: 'Usługa IT', netGrosze: 100_000, vatRate: 'zw' }],
          }),
        },
      );
      expect(ryczaltPostDoc.status).toBe(403);

      const ryczaltPutSettings = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/settings`,
        {
          method: 'PUT',
          headers: {
            authorization: `Bearer ${martaToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ smallTaxpayer: false }),
        },
      );
      expect(ryczaltPutSettings.status).toBe(403);

      const kpirPostEntry = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${martaToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            eventDate: '2026-03-21',
            documentNumber: 'DW-MARTA/2026/03/01',
            counterpartyName: 'Dostawca Biurowy Test Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
            counterpartyAddress: 'ul. Testowa 10, 00-001 Warszawa',
            eventDescription: 'Zakup materiałów biurowych przez księgową',
            entryKind: 'other_expenses_100_col13',
            netGrosze: 25_000,
            vatRate: '23',
          }),
        },
      );
      expect(kpirPostEntry.status).toBe(201);

      const martaGrantAttempt = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/grants`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${martaToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ targetUserId: DEMO_USER_MARTA_ID, action: 'write' }),
        },
      );
      expect(martaGrantAttempt.status).toBe(403);
    });
  });
});
