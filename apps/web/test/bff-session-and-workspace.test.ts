import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as contextPost } from '../app/api/session/context/route.js';
import { POST as loginPost } from '../app/api/session/login/route.js';
import { POST as logoutPost } from '../app/api/session/logout/route.js';
import { POST as workspaceActionsPost } from '../app/api/workspace/actions/route.js';
import { papBffFetch, resolveValidatedApiBaseUrl } from '../lib/api-url.js';
import { FIELD_HELP_REGISTRY, resolveUiFieldHelp } from '../lib/field-help.js';
import { assertSameOriginMutation, sanitizeInternalRedirect } from '../lib/request-security.js';
import {
  OIDC_TOKEN_COOKIE_NAME,
  SESSION_CONTEXT_COOKIE_NAME,
  buildSessionCookieOptions,
  parseSessionCookies,
  serializeSignedSessionContext,
} from '../lib/session.js';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  COMPANY_TENANT_2_ID,
  MAX_WORKSPACE_IMPORT_BYTES,
  TENANT_1_ID,
  TENANT_2_ID,
  WorkspaceAccessError,
  addJournalEntryMutation,
  approveAndPostDocumentMutation,
  createCompanyMutation,
  createOrImportDocumentMutation,
  getDashboardSnapshot,
  getDocumentsForActiveCompany,
  getFullLedgerSnapshot,
  getNotificationsAndMcpSnapshot,
  getPersonaById,
  getRyczaltSnapshot,
  importAndReconcileBankStatementMutation,
  issuePersonaSession,
  listAccessibleCompaniesForSession,
  listAvailablePersonas,
  manageCompanyGrantMutation,
  manageMcpProposalMutation,
  resetSyntheticWorkspaceForTests,
  verifySessionAccess,
} from '../lib/synthetic-workspace.js';
import {
  PUBLIC_SYNTHETIC_PERSONAS,
  SAMPLE_BANK_CSV,
  SAMPLE_KSEF_FA3_XML,
} from '../lib/workspace-types.js';
import type { ActiveWebSession, SessionContext } from '../lib/session.js';

function makeSessionForPersona(
  personaId: 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny',
  overrides?: { tenantId?: string; legalEntityId?: string; period?: string; oidcToken?: string },
): ActiveWebSession {
  const persona = getPersonaById(personaId);
  return {
    oidcToken: overrides?.oidcToken ?? persona.syntheticOidcToken,
    context: {
      personaId: persona.personaId,
      userId: persona.userId,
      displayName: persona.displayName,
      email: persona.email,
      roleSummaryPl: persona.roleSummaryPl,
      tenantId: overrides?.tenantId ?? persona.tenantId,
      legalEntityId: overrides?.legalEntityId ?? persona.defaultLegalEntityId,
      period: overrides?.period ?? '2026-10',
    },
  };
}

function forgeHmacEnvelope(
  secret: string,
  oidcToken: string,
  ctx: Record<string, unknown>,
): string {
  const payloadB64 = Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64url');
  const sigHex = createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(
      [
        'v1',
        oidcToken,
        String(ctx['userId'] ?? ''),
        String(ctx['personaId'] ?? ''),
        String(ctx['tenantId'] ?? ''),
        String(ctx['legalEntityId'] ?? ''),
        String(ctx['period'] ?? ''),
        payloadB64,
      ].join('|'),
      'utf8',
    )
    .digest('hex');
  return `v1.${payloadB64}.${sigHex}`;
}

function collectWebSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue;
    const full = resolve(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectWebSourceFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      files.push(full);
    }
  }
  return files;
}

describe('BFF API_BASE_URL security, SSRF/path-traversal defense & HMAC-signed HttpOnly session cookies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('enforces closed production API_BASE_URL allowlist and rejects untrusted origins', () => {
    expect(
      resolveValidatedApiBaseUrl({
        apiBaseUrl: 'http://127.0.0.1:4100',
        isProduction: true,
      })?.origin,
    ).toBe('http://127.0.0.1:4100');

    expect(
      resolveValidatedApiBaseUrl({
        apiBaseUrl: 'https://ksiegowosc.roleplayingtech.com',
        isProduction: true,
      })?.origin,
    ).toBe('https://ksiegowosc.roleplayingtech.com');

    for (const untrusted of [
      'http://127.0.0.1:4000',
      'https://evil.example.com',
      'http://169.254.169.254',
      'https://user:secret@ksiegowosc.roleplayingtech.com',
      'https://ksiegowosc.roleplayingtech.com/custom',
    ]) {
      expect(
        resolveValidatedApiBaseUrl({ apiBaseUrl: untrusted, isProduction: true }),
      ).toBeUndefined();
    }
  });

  it('blocks SSRF, protocol-relative, backslash, control-char and path-traversal URLs in papBffFetch and preserves 5xx server_error reason codes (#61)', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    for (const maliciousPath of [
      '//evil.example.com/steal',
      '/\t/evil.example.com',
      '/api/v1/../admin',
      '/api/v1/%2e%2e/secret',
      '/api/v1/%2f%2fevil.example.com',
      '/api/v1/foo\\bar',
      '/api/v1/foo#fragment',
      'http://169.254.169.254/latest/meta-data',
      '/internal/secret',
    ]) {
      await expect(
        papBffFetch(maliciousPath, {
          apiBaseUrl: 'http://127.0.0.1:4000',
          fetcher: spy,
        }),
      ).resolves.toEqual({ kind: 'unavailable' });
    }
    expect(spy).not.toHaveBeenCalled();

    const okResult = await papBffFetch<{ ok: boolean }>('/api/v1/oidc/personas', {
      apiBaseUrl: 'http://127.0.0.1:4000',
      bearerToken: 'synth-token-12345678',
      fetcher: spy,
    });
    expect(okResult).toEqual({ kind: 'ok', status: 200, data: { ok: true } });
    expect(spy).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4000/api/v1/oidc/personas'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer synth-token-12345678',
        }),
      }),
    );

    const serverErrSpy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          reason: 'database_connection_failed',
          message: 'Baza PostgreSQL jest niedostępna.',
        }),
        {
          status: 503,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );
    const serverErrResult = await papBffFetch('/api/v1/me/companies', {
      apiBaseUrl: 'http://127.0.0.1:4000',
      bearerToken: 'synth-token-12345678',
      fetcher: serverErrSpy,
    });
    expect(serverErrResult).toEqual({
      kind: 'server_error',
      status: 503,
      reasonCode: 'database_connection_failed',
      message: 'Baza PostgreSQL jest niedostępna.',
    });
  });

  it('cryptographically signs pap_session_ctx with HMAC-SHA256 and rejects forged, unsigned, or token-swapped cookies', () => {
    const secret = 'test-server-secret-32-bytes-minimum-key!!';
    vi.stubEnv('PAP_WEB_SESSION_SECRET', secret);

    expect(OIDC_TOKEN_COOKIE_NAME).toBe('pap_oidc_token');
    expect(SESSION_CONTEXT_COOKIE_NAME).toBe('pap_session_ctx');

    const devCookie = buildSessionCookieOptions(false);
    expect(devCookie).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 28_800,
    });
    expect(buildSessionCookieOptions(true).secure).toBe(true);

    const janSession = makeSessionForPersona('jan-testowy');
    const signedCookieValue = serializeSignedSessionContext(janSession);

    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: signedCookieValue,
      }),
    ).toEqual(janSession);

    // 1. Niepodpisany surowy JSON w pap_session_ctx MUSI być odrzucony
    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: JSON.stringify(janSession.context),
      }),
    ).toBeNull();

    // 2. Ręczna podmiana tenantId w podpisanym ładunku (bez znajomości klucza HMAC) MUSI być odrzucona
    const [, , oldSig] = signedCookieValue.split('.');
    const forgedPayloadB64 = Buffer.from(
      JSON.stringify({ ...janSession.context, tenantId: TENANT_2_ID }),
      'utf8',
    ).toString('base64url');
    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: `v1.${forgedPayloadB64}.${oldSig ?? ''}`,
      }),
    ).toBeNull();

    // 3. Podmiana pap_oidc_token na token innej persony (Piotr) przy zachowaniu podpisanego kontekstu Jana MUSI być odrzucona
    const piotrSession = makeSessionForPersona('piotr-izolacyjny');
    expect(
      parseSessionCookies({
        oidcToken: piotrSession.oidcToken,
        sessionContextJson: signedCookieValue,
      }),
    ).toBeNull();

    // 4. Nawet przy poprawnym podpisie HMAC niespójność userId względem personaId MUSI być odrzucona
    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: forgeHmacEnvelope(secret, janSession.oidcToken, {
          ...janSession.context,
          userId: piotrSession.context.userId,
        }),
      }),
    ).toBeNull();

    // 5. Niepoprawny format UUID dla tenantId / legalEntityId lub błędny okres rozliczeniowy są odrzucane
    expect(() =>
      serializeSignedSessionContext({
        oidcToken: janSession.oidcToken,
        context: {
          ...janSession.context,
          tenantId: 'not-a-valid-uuid',
        } as SessionContext,
      }),
    ).toThrow();

    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: forgeHmacEnvelope(secret, janSession.oidcToken, {
          ...janSession.context,
          tenantId: 'not-a-valid-uuid',
        }),
      }),
    ).toBeNull();

    expect(
      parseSessionCookies({
        oidcToken: janSession.oidcToken,
        sessionContextJson: forgeHmacEnvelope(secret, janSession.oidcToken, {
          ...janSession.context,
          period: '2026-13',
        }),
      }),
    ).toBeNull();
  });

  it('prevents Open Redirect (/\\t/evil.com, //evil.com, backslashes), enforces CSRF Origin checks, and fails closed on login when API is down (#59)', async () => {
    for (const maliciousRedirect of [
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '/%09/evil.com',
      '/%2f%2fevil.com',
      '//evil.com/phish',
      '/\\evil.com',
      'https://evil.com/login',
      'javascript:alert(1)',
      '/app/../evil',
      '/app/space inside',
    ]) {
      expect(sanitizeInternalRedirect(maliciousRedirect, '/app', 'http://127.0.0.1:3000')).toBe(
        '/app',
      );
    }

    expect(
      sanitizeInternalRedirect('/app/kpir?period=2026-10#ignored', '/app', 'http://127.0.0.1:3000'),
    ).toBe('/app/kpir?period=2026-10');

    const crossOriginReq = new NextRequest('http://127.0.0.1:3000/api/session/login', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'https://attacker.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ personaId: 'jan-testowy' }),
    });
    expect(assertSameOriginMutation(crossOriginReq)?.status).toBe(403);

    for (const handler of [loginPost, logoutPost, contextPost, workspaceActionsPost]) {
      const res = await handler(
        new NextRequest('http://127.0.0.1:3000/api/test', {
          method: 'POST',
          headers: {
            host: '127.0.0.1:3000',
            origin: 'https://attacker.example',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ personaId: 'jan-testowy' }),
        }),
      );
      expect(res.status).toBe(403);
    }

    const nullOriginRes = await loginPost(
      new NextRequest('http://127.0.0.1:3000/api/session/login', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'null',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ personaId: 'jan-testowy' }),
      }),
    );
    expect(nullOriginRes.status).toBe(403);

    // W domyślnym trybie online (PAP_WEB_OFFLINE_DEMO_MODE nieustawione) brak połączenia z @pap/api zwraca 503 (#59)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const failClosedLogin = await loginPost(
      new NextRequest('http://127.0.0.1:3000/api/session/login', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ personaId: 'jan-testowy', redirectTo: '/\t/evil.com' }),
      }),
    );
    expect(failClosedLogin.status).toBe(503);

    // Po odpowiedzi z @pap/api (/api/v1/oidc/token + /api/v1/me/companies) logowanie wydaje sesję i sanityzuje redirectTo
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = input instanceof URL ? input.toString() : String(input);
        if (url.endsWith('/api/v1/oidc/token')) {
          return new Response(
            JSON.stringify({
              accessToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqYW4ifQ.sig',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            companies: [
              {
                tenantId: TENANT_1_ID,
                legalEntityId: COMPANY_JDG_KPIR_ID,
                displayName: 'Pracownia Projektowa Jan Testowy',
                nip: '5250001003',
                legalForm: 'jdg',
                taxRegime: 'kpir_skala',
                vatStatus: 'czynny',
                zusStage: 'duzy_zus',
                role: 'tenant_owner',
                canRead: true,
                canWrite: true,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const sameOriginLogin = await loginPost(
      new NextRequest('http://127.0.0.1:3000/api/session/login', {
        method: 'POST',
        headers: {
          host: '127.0.0.1:3000',
          origin: 'http://127.0.0.1:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ personaId: 'jan-testowy', redirectTo: '/\t/evil.com' }),
      }),
    );
    expect(sameOriginLogin.status).toBe(200);
    const loginPayload = (await sameOriginLogin.json()) as { redirectTo?: string };
    expect(loginPayload.redirectTo).toBe('/app');
  });
});

describe('Online BFF Unification (#57, #58, #59, #60, #62, #63) & Offline Demo Mode invariants', () => {
  beforeEach(() => {
    resetSyntheticWorkspaceForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('enforces hard cross-tenant isolation (403 active_membership_required) when Piotr (Tenant 2) accesses Tenant 1', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    const piotrSession = makeSessionForPersona('piotr-izolacyjny');
    const piotrCompanies = await listAccessibleCompaniesForSession(piotrSession);
    expect(piotrCompanies.map((c) => c.legalEntityId)).toEqual([COMPANY_TENANT_2_ID]);
    expect(piotrCompanies[0]?.tenantId).toBe(TENANT_2_ID);

    await expect(
      verifySessionAccess(piotrSession, TENANT_1_ID, COMPANY_JDG_KPIR_ID, 'read'),
    ).rejects.toMatchObject({
      statusCode: 403,
      reasonCode: 'active_membership_required',
    });
  });

  it('fails closed on unavailable/401/403/409/422/503 from apps/api in default online mode (#57, #59)', async () => {
    const janSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
      oidcToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqYW4ifQ.sig',
    });

    // 1. Gdy @pap/api jest niedostępne, odczyty SSR i mutacje BFF rzucają 503 api_unavailable (zero cichego fallbacku!)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    await expect(issuePersonaSession('jan-testowy', '2026-10')).rejects.toMatchObject({
      statusCode: 503,
      reasonCode: 'api_unavailable',
    });
    await expect(listAccessibleCompaniesForSession(janSession)).rejects.toMatchObject({
      statusCode: 503,
      reasonCode: 'api_unavailable',
    });
    await expect(getDashboardSnapshot(janSession)).rejects.toMatchObject({
      statusCode: 503,
      reasonCode: 'api_unavailable',
    });
    await expect(getDocumentsForActiveCompany(janSession)).rejects.toMatchObject({
      statusCode: 503,
      reasonCode: 'api_unavailable',
    });

    // 2. Błąd 403 z @pap/api jest propagowany
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              reason: 'explicit_company_grant_required',
              message: 'Odmowa zapisu z centralnego jądra autoryzacji API.',
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'fa3_xml',
        rawPayload: SAMPLE_KSEF_FA3_XML,
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      reasonCode: 'explicit_company_grant_required',
    });

    // 3. Błąd 409 duplicate_document_sha256 z @pap/api NIGDY nie jest wyciszany jako sukces (#59)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              reason: 'duplicate_document_sha256',
              message: 'Wykryto duplikat SHA-256 w tej firmie.',
            }),
            { status: 409, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'fa3_xml',
        rawPayload: SAMPLE_KSEF_FA3_XML,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      reasonCode: 'duplicate_document_sha256',
    });

    // 4. Błąd 422 z @pap/api jest propagowany
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              reason: 'domain_validation_failed',
              message: 'Błąd walidacji po stronie API.',
            }),
            { status: 422, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'fa3_xml',
        rawPayload: SAMPLE_KSEF_FA3_XML,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      reasonCode: 'domain_validation_failed',
    });
  });

  it('uses remote legalEntityId from POST /api/v1/tenants/:tenantId/companies (#58) and wires real MCP flow (#60)', async () => {
    const janSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
      oidcToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqYW4ifQ.sig',
    });
    const remoteCompanyUuid = '88888888-8888-4888-8888-888888888888';
    const remoteProposalUuid = '99999999-9999-4999-8999-999999999999';
    const expectedPayloadHash = 'a'.repeat(64);
    const capturedCalls: Array<{ url: string; body: unknown }> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = input instanceof URL ? input.toString() : String(input);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        capturedCalls.push({ url, body });

        if (url.endsWith(`/tenants/${TENANT_1_ID}/companies`)) {
          return new Response(
            JSON.stringify({
              company: {
                tenantId: TENANT_1_ID,
                legalEntityId: remoteCompanyUuid,
                displayName: 'Nowa Spółka Zdalna Test',
                nip: '5213004125',
                legalForm: 'jdg',
                taxRegime: 'kpir_skala',
                vatStatus: 'czynny',
                zusStage: 'preferencyjny_zus',
                role: 'tenant_owner',
                canRead: true,
                canWrite: true,
              },
              taxProfile: {
                tenantId: TENANT_1_ID,
                legalEntityId: remoteCompanyUuid,
                companyName: 'Nowa Spółka Zdalna Test',
                nip: '5213004125',
                legalForm: 'jdg',
                profileCode: 'jdg_kpir_skala',
                vatStatus: 'czynny',
                vatSettlementPeriod: 'monthly',
                zusScheme: 'preferencyjny_zus',
                voluntarySicknessInsurance: false,
                smallTaxpayer: true,
                activityStartDate: '2026-01-01',
              },
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }

        if (url.endsWith('/api/v1/mcp')) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              result: {
                structuredContent: {
                  proposalId: remoteProposalUuid,
                  status: 'pending_human_confirmation',
                  payloadHash: expectedPayloadHash,
                },
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (url.endsWith(`/mcp/proposals/${remoteProposalUuid}/challenge`)) {
          return new Response(
            JSON.stringify({
              proposalId: remoteProposalUuid,
              confirmationCode: 'PAP-HUMAN-ABCDEF123456',
              payloadHash: expectedPayloadHash,
              expiresAt: '2026-10-30T12:00:00.000Z',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        if (url.endsWith('/mcp/proposals')) {
          return new Response(
            JSON.stringify({
              proposals: [
                {
                  proposalId: remoteProposalUuid,
                  tenantId: TENANT_1_ID,
                  legalEntityId: COMPANY_JDG_KPIR_ID,
                  toolName: 'prepare_invoice_and_posting_proposal',
                  status: 'pending_human_confirmation',
                  payloadHash: expectedPayloadHash,
                  createdAt: '2026-10-20T10:00:00.000Z',
                  expiresAt: '2026-10-30T12:00:00.000Z',
                  confirmedAt: null,
                  confirmedByUserId: null,
                  invoiceNumber: 'FZ/MCP/2026/10/99',
                  counterpartyName: 'Syntetyczne Chmury Obliczeniowe Sp. z o.o.',
                  counterpartyNip: '5213004125',
                  issueDate: '2026-10-20',
                  eventDate: '2026-10-20',
                  netGrosze: 160_000,
                  vatGrosze: 36_800,
                  grossGrosze: 196_800,
                  vatRate: '23',
                  suggestedCategory: 'other_kup_100',
                  kpirQualification: 'other_expenses_100_col13',
                  vatDeductionMode: 'full_100',
                  promptInjectionSuspected: false,
                  untrustedDescriptionText: 'Test',
                  preview: {
                    postingTarget: 'kpir',
                    deductibleVatGrosze: 36_800,
                    nonDeductibleVatGrosze: 0,
                    taxDeductibleCostGrosze: 160_000,
                    nonDeductibleCostGrosze: 0,
                    summaryPl: 'Podgląd ujęcia',
                  },
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const createdCompany = await createCompanyMutation(janSession, {
      companyName: 'Nowa Spółka Zdalna Test',
      nip: '5213004125',
      address: 'ul. Zdalna 10, 00-100 Warszawa',
      legalForm: 'jdg',
      profileCode: 'jdg_kpir_skala',
      vatStatus: 'czynny',
    });
    expect(createdCompany.legalEntityId).toBe(remoteCompanyUuid);
    expect(createdCompany.address).toBe('ul. Zdalna 10, 00-100 Warszawa');

    await manageMcpProposalMutation(janSession, { op: 'create_demo_proposal' });
    expect(capturedCalls.some((c) => c.url.endsWith('/api/v1/mcp'))).toBe(true);

    const challengeRes = await manageMcpProposalMutation(janSession, {
      op: 'issue_code',
      proposalId: remoteProposalUuid,
    });
    expect(challengeRes.confirmationCode).toBe('PAP-HUMAN-ABCDEF123456');

    await manageMcpProposalMutation(janSession, {
      op: 'confirm',
      proposalId: remoteProposalUuid,
      confirmationCode: 'PAP-HUMAN-ABCDEF123456',
    });
    const confirmCall = capturedCalls.find((c) =>
      c.url.endsWith(`/mcp/proposals/${remoteProposalUuid}/confirm`),
    );
    expect(confirmCall?.body).toMatchObject({
      confirmationCode: 'PAP-HUMAN-ABCDEF123456',
      expectedPayloadHash,
    });

    await manageMcpProposalMutation(janSession, {
      op: 'reject',
      proposalId: remoteProposalUuid,
      reason: 'Odrzucono w teście.',
    });
    const rejectCall = capturedCalls.find((c) =>
      c.url.endsWith(`/mcp/proposals/${remoteProposalUuid}/reject`),
    );
    expect(rejectCall?.body).toMatchObject({
      reason: 'Odrzucono w teście.',
    });
  });

  it('enforces granular company grants for Marta Księgowa (read-only on Ryczałt, no grant revocation rights)', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    const martaRyczaltSession = makeSessionForPersona('marta-ksiegowa', {
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
    });

    const company = await verifySessionAccess(
      martaRyczaltSession,
      TENANT_1_ID,
      COMPANY_JDG_RYCZALT_ID,
      'read',
    );
    expect(company.grantedActions).toEqual(['read']);

    await expect(
      verifySessionAccess(martaRyczaltSession, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, 'write'),
    ).rejects.toThrowError(/Brak wymaganego grantu podmiotowego/);

    const martaKpirSession = makeSessionForPersona('marta-ksiegowa', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
    });
    await expect(
      manageCompanyGrantMutation(martaKpirSession, {
        op: 'revoke',
        grantId: 'grant-marta-kpir',
      }),
    ).rejects.toThrowError(/wymaga uprawnień właściciela organizacji/);
  });

  it('imports KSeF FA(3) XML as unposted proposal, rejects SHA-256 duplicates with 409, and posts to KPiR, Ryczałt, and Sp. z o.o. ledger on human approval', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');

    const janKpirSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
    });
    const beforeDash = await getDashboardSnapshot(janKpirSession);
    const initialRevenue = beforeDash.monthlyRevenueGrosze;
    const initialCosts = beforeDash.monthlyKupCostsGrosze;

    const firstImport = await createOrImportDocumentMutation(janKpirSession, {
      mode: 'import_xml_or_csv',
      format: 'fa3_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });
    expect(firstImport.status).toBe('ai_proposal');
    expect(firstImport.isDuplicateSha256).toBe(false);
    expect(firstImport.ksefReferenceNumber).toBe('5213004125-20261016-FA3084-99A1B2-44');
    expect(firstImport.whiteListStatus).toBe('not_checked');
    expect(firstImport.aiConfidencePercent).toBeNull();

    const midDash = await getDashboardSnapshot(janKpirSession);
    expect(midDash.monthlyRevenueGrosze).toBe(initialRevenue);
    expect(midDash.monthlyKupCostsGrosze).toBe(initialCosts);

    await expect(
      createOrImportDocumentMutation(janKpirSession, {
        mode: 'import_xml_or_csv',
        format: 'fa3_xml',
        rawPayload: SAMPLE_KSEF_FA3_XML,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      reasonCode: 'duplicate_document_sha256',
    });

    const approvedKpir = await approveAndPostDocumentMutation(janKpirSession, {
      documentId: firstImport.documentId,
      documentNumber: firstImport.documentNumber,
      counterpartyName: firstImport.counterpartyName,
      counterpartyNip: firstImport.counterpartyNip,
      issueDate: firstImport.issueDate,
      netPln: '2400.00',
      vatPln: '552.00',
      expenseQualification: 'vehicle_mixed_75_col13',
      vatDeductionMode: 'vehicle_mixed_50',
    });
    expect(approvedKpir.status).toBe('approved_posted');
    expect((await getDashboardSnapshot(janKpirSession)).monthlyKupCostsGrosze).toBe(
      initialCosts + 200_700,
    );

    // Profil ryczałtowy: zatwierdzenie faktury sprzedaży księguje przychód w ewidencji ryczałtu
    const janRyczaltSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
    });
    const rycBefore = (await getRyczaltSnapshot(janRyczaltSession)).entries.length;
    const rycSalesDoc = await createOrImportDocumentMutation(janRyczaltSession, {
      mode: 'manual',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FS/RYC/2026/10/077',
      issueDate: '2026-10-19',
      dueDate: '2026-10-26',
      counterpartyName: 'Odbiorca Usług IT Sp. z o.o.',
      counterpartyNip: '5213004125',
      description: 'Usługa programistyczna B2B',
      netPln: '5000.00',
      vatRate: 'zw',
      ksefMarker: 'BFK',
      annex15Item: false,
    });
    await approveAndPostDocumentMutation(janRyczaltSession, {
      documentId: rycSalesDoc.documentId,
      documentNumber: rycSalesDoc.documentNumber,
      counterpartyName: rycSalesDoc.counterpartyName,
      counterpartyNip: rycSalesDoc.counterpartyNip,
      issueDate: rycSalesDoc.issueDate,
      netPln: '5000.00',
      vatPln: '0.00',
      expenseQualification: 'none',
      vatDeductionMode: 'none_0',
    });
    expect((await getRyczaltSnapshot(janRyczaltSession)).entries.length).toBe(rycBefore + 1);

    // Pełne księgi Sp. z o.o.: zatwierdzenie faktury tworzy zbilansowany dekret Wn === Ma
    const janSpzooSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_SPZOO_ID,
    });
    const jrnBefore = (await getFullLedgerSnapshot(janSpzooSession)).journalEntries.length;
    const spzooDoc = await createOrImportDocumentMutation(janSpzooSession, {
      mode: 'import_xml_or_csv',
      format: 'fa3_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });
    await approveAndPostDocumentMutation(janSpzooSession, {
      documentId: spzooDoc.documentId,
      documentNumber: spzooDoc.documentNumber,
      counterpartyName: spzooDoc.counterpartyName,
      counterpartyNip: spzooDoc.counterpartyNip,
      issueDate: spzooDoc.issueDate,
      netPln: '2400.00',
      vatPln: '552.00',
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
    });
    const ledgerAfter = await getFullLedgerSnapshot(janSpzooSession);
    expect(ledgerAfter.journalEntries.length).toBe(jrnBefore + 1);
    expect(ledgerAfter.trialBalance.isBalanced).toBe(true);
    expect(ledgerAfter.balanceSheet.isBalanced).toBe(true);
  });

  it('enforces strict two-step human confirmation code, status, rejection, and expiry for MCP proposals', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    const janSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
    });

    const initialProposals = (await getNotificationsAndMcpSnapshot(janSession)).mcpProposals;
    const pendingProposal = initialProposals.find((p) => p.status === 'pending_human_approval');
    expect(pendingProposal).toBeDefined();
    const proposalId = pendingProposal!.proposalId;

    // 1. Próba zatwierdzenia bez wygenerowanego kodu wyzwania człowieka jest odrzucana
    await expect(
      manageMcpProposalMutation(janSession, {
        op: 'confirm',
        proposalId,
      }),
    ).rejects.toThrowError(WorkspaceAccessError);

    // 2. Wygenerowanie wyzwania kodu człowieka
    const issued = await manageMcpProposalMutation(janSession, {
      op: 'issue_code',
      proposalId,
    });
    expect(issued.confirmationCode).toMatch(/^PAP-HUMAN-[A-F0-9]{12}$/);

    // 3. Błędny kod potwierdzenia człowieka jest odrzucany w stałym czasie
    await expect(
      manageMcpProposalMutation(janSession, {
        op: 'confirm',
        proposalId,
        confirmationCode: 'PAP-HUMAN-000000000000',
      }),
    ).rejects.toThrowError(/Nieprawidłowy jednorazowy kod potwierdzenia człowieka/);

    // 4. Dokładny kod wyzwania zatwierdza propozycję jednorazowo
    await manageMcpProposalMutation(janSession, {
      op: 'confirm',
      proposalId,
      confirmationCode: issued.confirmationCode!,
    });

    const updated = (await getNotificationsAndMcpSnapshot(janSession)).mcpProposals.find(
      (p) => p.proposalId === proposalId,
    );
    expect(updated?.status).toBe('confirmed');

    // 5. Ponowne użycie tego samego kodu na już zatwierdzonej propozycji jest odrzucane
    await expect(
      manageMcpProposalMutation(janSession, {
        op: 'confirm',
        proposalId,
        confirmationCode: issued.confirmationCode!,
      }),
    ).rejects.toThrowError(/nie oczekuje już na zatwierdzenie/);

    // 6. Przeterminowana propozycja MCP jest odrzucana jako wygasła
    await manageMcpProposalMutation(janSession, { op: 'create_demo_proposal' });
    const freshDemo = (await getNotificationsAndMcpSnapshot(janSession)).mcpProposals.find(
      (p) => p.status === 'pending_human_approval',
    )!;
    const demoCode = (
      await manageMcpProposalMutation(janSession, {
        op: 'issue_code',
        proposalId: freshDemo.proposalId,
      })
    ).confirmationCode!;

    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.parse(freshDemo.expiresAt) + 60_000));
    await expect(
      manageMcpProposalMutation(janSession, {
        op: 'confirm',
        proposalId: freshDemo.proposalId,
        confirmationCode: demoCode,
      }),
    ).rejects.toThrowError(/wygasła/);
  });

  it('rejects invalid NIP checksums, impossible calendar dates (2026-02-31), and oversized (>256 KB) payloads', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    const janSession = makeSessionForPersona('jan-testowy');

    // Nieprawidłowa suma kontrolna NIP w imporcie CSV (kolumny: docNum;direction;issueDate;dueDate;name;nip;desc;net;vat)
    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'csv',
        rawPayload:
          'FZ/ERR/01;purchase;2026-10-15;2026-10-29;Dostawca Błędny;1234567890;Usługa;1000.00;230.00',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      reasonCode: 'invalid_nip',
    });

    // Nieistniejąca data kalendarzowa 2026-02-31 w imporcie CSV
    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'csv',
        rawPayload:
          'FZ/ERR/02;purchase;2026-02-31;2026-10-29;Dostawca Poprawny;5213004125;Usługa;1000.00;230.00',
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      reasonCode: 'invalid_date',
    });

    // Ponad 256 KB ładunku jest odrzucane
    const oversizedXml = `${SAMPLE_KSEF_FA3_XML}<!-- ${'X'.repeat(MAX_WORKSPACE_IMPORT_BYTES + 1024)} -->`;
    await expect(
      createOrImportDocumentMutation(janSession, {
        mode: 'import_xml_or_csv',
        format: 'fa3_xml',
        rawPayload: oversizedXml,
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      reasonCode: 'payload_too_large',
    });
  });

  it('never exposes syntheticOidcToken in public persona summaries, client bundles, or FIELD_HELP_REGISTRY', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed')));
    const publicPersonas = await listAvailablePersonas();
    expect(publicPersonas).toEqual(PUBLIC_SYNTHETIC_PERSONAS);
    expect(JSON.stringify(publicPersonas)).not.toContain('pap_synth_oidc_');
    expect(JSON.stringify(publicPersonas)).not.toContain('syntheticOidcToken');

    // Żaden plik 'use client' w apps/web nie importuje serwerowego synthetic-workspace ani node:crypto
    const webRoot = resolve(import.meta.dirname, '..');
    const sourceFiles = collectWebSourceFiles(webRoot);
    const clientFiles = sourceFiles.filter((filePath) => {
      const head = readFileSync(filePath, 'utf8').slice(0, 200);
      return /^\s*['"]use client['"]/.test(head);
    });
    expect(clientFiles.length).toBeGreaterThan(5);
    for (const filePath of clientFiles) {
      const content = readFileSync(filePath, 'utf8');
      expect(
        content,
        `Plik kliencki ${filePath} nie może importować synthetic-workspace`,
      ).not.toMatch(/synthetic-workspace/);
      expect(content, `Plik kliencki ${filePath} nie może importować node:crypto`).not.toMatch(
        /node:crypto/,
      );
      expect(content, `Plik kliencki ${filePath} nie może zawierać syntheticOidcToken`).not.toMatch(
        /syntheticOidcToken/,
      );
    }

    // Rejestr pomocy kontekstowej eksportuje klucze z dokumentacji
    expect(FIELD_HELP_REGISTRY['mcp_human_confirmation']).toBeDefined();
    expect(FIELD_HELP_REGISTRY['split_payment_mpp']).toBeDefined();
    expect(resolveUiFieldHelp('mcp_human_approval')).toBeDefined();
  });

  it('rejects unbalanced double-entry journal lines (Wn !== Ma) and accepts balanced Sp. z o.o. postings', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    const janSpzooSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_SPZOO_ID,
    });

    await expect(
      addJournalEntryMutation(janSpzooSession, {
        bookingDate: '2026-10-22',
        documentNumber: 'PK/2026/10/ERR',
        description: 'Niezbilansowany dekret testowy',
        lines: [
          { accountCode: '402', side: 'Wn', amountPln: '1000.00', description: 'Koszt' },
          { accountCode: '130', side: 'Ma', amountPln: '900.00', description: 'Rachunek' },
        ],
      }),
    ).rejects.toThrowError(WorkspaceAccessError);

    const posted = await addJournalEntryMutation(janSpzooSession, {
      bookingDate: '2026-10-22',
      documentNumber: 'PK/2026/10/OK',
      description: 'Opłata notarialna opłacona z rachunku bieżącego',
      lines: [
        { accountCode: '402', side: 'Wn', amountPln: '1000.00', description: 'Usługi obce' },
        { accountCode: '130', side: 'Ma', amountPln: '1000.00', description: 'Rachunek bieżący' },
      ],
    });
    expect(posted.totalWnGrosze).toBe(100_000);
    expect(posted.totalMaGrosze).toBe(100_000);

    const ledgerSnap = await getFullLedgerSnapshot(janSpzooSession);
    expect(ledgerSnap.trialBalance.isBalanced).toBe(true);
    expect(ledgerSnap.balanceSheet.isBalanced).toBe(true);
  });

  it('preserves live API documentId UUID across import -> approve-and-post and forwards rawPayload + sourceFormat (#62)', async () => {
    const janSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
      oidcToken: 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqYW4ifQ.sig',
    });
    const remoteUuid = '77777777-7777-4777-8777-777777777777';
    const capturedCalls: Array<{ url: string; body: unknown }> = [];

    const mockRemoteDoc = {
      documentId: remoteUuid,
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_JDG_KPIR_ID,
      status: 'ai_proposed',
      sourceFormat: 'ksef_xml',
      sha256Hash: 'b'.repeat(64),
      createdAt: '2026-10-16T10:00:00.000Z',
      updatedAt: '2026-10-16T10:00:00.000Z',
      approvedByUserId: null,
      approvedAt: null,
      isCorrection: false,
      document: {
        documentId: remoteUuid,
        documentNumber: 'FV/FA3/2026/10/084',
        direction: 'purchase',
        issueDate: '2026-10-16',
        eventDate: '2026-10-16',
        dueDate: '2026-10-30',
        counterpartyName: 'Centrum Flotowe i Paliwowe Syntetyka Sp. z o.o.',
        counterpartyNip: '5213004125',
        ksefReferenceNumber: '5213004125-20261016-FA3084-99A1B2-44',
        ksefMarker: 'NrKSeF',
        lines: [
          {
            lineNumber: 1,
            description: 'Paliwo i serwis eksploatacyjny samochodu osobowego',
            quantity: '1',
            unit: 'szt.',
            netGrosze: 240_000,
            vatRate: '23',
            vatGrosze: 55_200,
            grossGrosze: 295_200,
            annex15Item: false,
          },
        ],
        totalNetGrosze: 240_000,
        totalVatGrosze: 55_200,
        totalGrossGrosze: 295_200,
      },
      aiProposal: {
        status: 'ai_proposed',
        confidenceScoreBps: 9500,
        suggestedCategory: 'vehicle_mixed_75_50',
        vatDeductionMode: 'vehicle_mixed_50',
        kpirQualification: 'vehicle_mixed_75_col13',
        extractedSummaryPl: 'Parser deterministyczny XML KSeF',
        promptInjectionSuspected: false,
      },
      postingResult: null,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = input instanceof URL ? input.toString() : String(input);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
        capturedCalls.push({ url, body });

        if (url.endsWith('/documents') && init?.method === 'POST') {
          return new Response(JSON.stringify(mockRemoteDoc), {
            status: 201,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.endsWith(`/documents/${remoteUuid}/approve-and-post`)) {
          return new Response(
            JSON.stringify({
              document: {
                ...mockRemoteDoc,
                status: 'posted',
                approvedByUserId: janSession.context.userId,
                approvedAt: '2026-10-16T11:00:00.000Z',
                postingResult: {
                  accountingItemId: 'item-1',
                  kpirEntryId: 'kpir-1',
                  ryczaltEntryId: null,
                  journalEntryId: null,
                },
              },
              postingResult: {
                accountingItemId: 'item-1',
                kpirEntryId: 'kpir-1',
                ryczaltEntryId: null,
                journalEntryId: null,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.endsWith('/finance/bank-import')) {
          return new Response(
            JSON.stringify({
              importedTransactionsCount: 2,
              matchedExactCount: 1,
              unmatchedCount: 1,
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    const imported = await createOrImportDocumentMutation(janSession, {
      mode: 'import_xml_or_csv',
      format: 'fa3_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });
    expect(imported.documentId).toBe(remoteUuid);
    expect(imported.whiteListStatus).toBe('not_checked');
    expect(imported.aiConfidencePercent).toBeNull();

    const importCall = capturedCalls.find((c) => c.url.endsWith('/documents'));
    expect(importCall?.body).toEqual({
      sourceFormat: 'ksef_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });

    await approveAndPostDocumentMutation(janSession, {
      documentId: imported.documentId,
      documentNumber: imported.documentNumber,
      counterpartyName: imported.counterpartyName,
      counterpartyNip: imported.counterpartyNip,
      issueDate: imported.issueDate,
      netPln: '2400,00',
      vatPln: '552,00',
      expenseQualification: 'vehicle_mixed_75_col13',
      vatDeductionMode: 'vehicle_mixed_50',
    });

    const approveCall = capturedCalls.find((c) =>
      c.url.endsWith(`/documents/${remoteUuid}/approve-and-post`),
    );
    expect(approveCall).toBeDefined();
    expect(approveCall?.body).toMatchObject({
      netPln: '2400.00',
      vatPln: '552.00',
    });
    expect(approveCall?.body).not.toHaveProperty('documentId');

    const bankRes = await importAndReconcileBankStatementMutation(janSession, {
      format: 'csv',
      content: SAMPLE_BANK_CSV,
      applySettlements: true,
    });
    expect(bankRes.importedCount).toBe(2);
    expect(bankRes.matchedCount).toBe(1);

    const bankImportCall = capturedCalls.find((c) => c.url.endsWith('/finance/bank-import'));
    expect(bankImportCall).toBeDefined();
    expect(bankImportCall?.body).toMatchObject({ format: 'csv', applySettlements: true });
  });
});
