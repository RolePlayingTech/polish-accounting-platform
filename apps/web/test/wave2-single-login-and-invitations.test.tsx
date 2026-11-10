import { NextRequest } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as acceptInvitationPost } from '../app/api/session/invitations/accept/route.js';
import { POST as rejectInvitationPost } from '../app/api/session/invitations/reject/route.js';
import { POST as logoutPost } from '../app/api/session/logout/route.js';
import LoginPage from '../app/login/page.js';
import { LoginRequiredCard } from '../components/login-required-card.js';
import { encryptBffPayload, sha256Hex } from '../lib/oidc-client.js';
import { BFF_SESSION_COOKIE_NAME, type ActiveWebSession } from '../lib/session.js';
import { createCompanyMutation, verifySessionAccess } from '../lib/synthetic-workspace.js';

const TEST_BFF_SECRET = 'pap-vitest-slice5-bff-session-secret-key-min-32b!!';
const VALID_OPAQUE_SESSION_ID = 's5_opaque_session_identifier_0123456789abcdef';
const VALID_INVITE_TOKEN = 'inv_tok_0123456789abcdefghijklmnopqrstuvwxyzABCD';

const cookiesMock = vi.fn<() => Promise<{ get: (name: string) => { name: string; value: string } | undefined }>>(
  async () => ({
    get: () => undefined,
  }),
);

vi.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

describe('Wave 2 Slice 5 — Pojedyncze logowanie OIDC (#78), trasy BFF zaproszeń i onboarding właściciela (#83)', () => {
  afterEach(() => {
    cookiesMock.mockReset();
    cookiesMock.mockImplementation(async () => ({ get: () => undefined }));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('renderuje czysty pojedynczy ekran logowania OIDC bez person i bez piaskownicy poza LOCAL_DEV oraz polskie komunikaty authState', async () => {
    vi.stubEnv('PAP_RUNTIME_MODE', 'STAGING_PRIVATE');
    vi.stubEnv('PAP_WEB_SESSION_SECRET', TEST_BFF_SECRET);

    const element = await LoginPage({
      searchParams: Promise.resolve({
        invite: VALID_INVITE_TOKEN,
        authState: 'session_expired_or_invalid',
      }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('Zaloguj się do Polish Accounting Platform');
    expect(html).toContain('Zaloguj przez dostawcę tożsamości (OIDC)');
    expect(html).toContain('Sesja wygasła lub została unieważniona');
    expect(html).toContain('Wykryto jednorazowe zaproszenie do organizacji');
    expect(html).toContain(`value="/app?invite=${VALID_INVITE_TOKEN}"`);

    // Zero śladów selektora person i piaskownicy OIDC
    expect(html).not.toContain('Wybierz syntetyczną personę testową');
    expect(html).not.toContain('Jan Testowy');
    expect(html).not.toContain('Marta Księgowa');
    expect(html).not.toContain('OIDC Sandbox');

    const requiredCardHtml = renderToStaticMarkup(
      <LoginRequiredCard returnTo="/app/companies" screenTitle="Podmioty i uprawnienia" />,
    );
    expect(requiredCardHtml).toContain('Zaloguj przez dostawcę tożsamości (OIDC)');
    expect(requiredCardHtml).not.toContain('Jan Testowy');
  });

  it('przekierowuje wylogowanie do /login?authState=signed_out w STAGING_PRIVATE oraz do /login w LOCAL_DEV', async () => {
    vi.stubEnv('PAP_RUNTIME_MODE', 'STAGING_PRIVATE');
    vi.stubEnv('PAP_WEB_SESSION_SECRET', TEST_BFF_SECRET);
    vi.stubEnv('PAP_OIDC_REDIRECT_URI', 'http://localhost:31608/api/session/oidc/callback');

    const reqStaging = new NextRequest('http://localhost:31608/api/session/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        accept: 'application/json',
      },
    });
    const resStaging = await logoutPost(reqStaging);
    expect(resStaging.status).toBe(200);
    const jsonStaging = (await resStaging.json()) as { ok: boolean; redirectTo: string };
    expect(jsonStaging.redirectTo).toBe('/login?authState=signed_out');

    vi.stubEnv('PAP_RUNTIME_MODE', 'LOCAL_DEV');
    const reqLocal = new NextRequest('http://localhost:31608/api/session/logout', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        accept: 'application/json',
      },
    });
    const resLocal = await logoutPost(reqLocal);
    const jsonLocal = (await resLocal.json()) as { ok: boolean; redirectTo: string };
    expect(jsonLocal.redirectTo).toBe('/login');
  });

  it('egzekwuje ochronę CSRF, fail-closed 503 oraz aktualizację kontekstu sesji BFF w trasach /api/session/invitations/accept i /reject', async () => {
    vi.stubEnv('PAP_RUNTIME_MODE', 'STAGING_PRIVATE');
    vi.stubEnv('PAP_WEB_SESSION_SECRET', TEST_BFF_SECRET);
    vi.stubEnv('API_BASE_URL', 'http://127.0.0.1:4100');

    // 1. Odrzucenie cross-origin CSRF (403)
    const csrfReq = new NextRequest('http://localhost:31608/api/session/invitations/accept', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: VALID_INVITE_TOKEN }),
    });
    const csrfRes = await acceptInvitationPost(csrfReq);
    expect(csrfRes.status).toBe(403);

    // 2. Brak ciasteczka sesji -> 401
    const unauthReq = new NextRequest('http://localhost:31608/api/session/invitations/accept', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: VALID_INVITE_TOKEN }),
    });
    const unauthRes = await acceptInvitationPost(unauthReq);
    expect(unauthRes.status).toBe(401);

    // 3. Przyjęcie zaproszenia aktualizuje kontekst sesji BFF (tenantId + legalEntityId)
    const sessionIdHash = sha256Hex(VALID_OPAQUE_SESSION_ID);
    const encryptedTokens = encryptBffPayload(
      { accessToken: 'real_oidc_access_token_jwt_value_0123456789' },
      `bff_session:${sessionIdHash}`,
      { PAP_WEB_SESSION_SECRET: TEST_BFF_SECRET },
    );

    cookiesMock.mockImplementation(async () => ({
      get: (name: string) =>
        name === BFF_SESSION_COOKIE_NAME
          ? { name, value: VALID_OPAQUE_SESSION_ID }
          : undefined,
    }));

    let capturedContextUpdate: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        if (url.pathname === '/api/v1/auth/bff/session/get') {
          return new Response(
            JSON.stringify({
              ok: true,
              session: {
                sessionIdHash,
                userId: '11111111-1111-4111-8111-000000000501',
                issuer: 'https://idp.syntetyczny.example',
                subject: 'ewa-sub',
                displayName: 'Ewa Księgowa',
                email: 'ewa@syntetyczny.example',
                tenantId: null,
                legalEntityId: null,
                period: '2026-10',
                encryptedTokens,
                accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                refreshGeneration: 0,
                previousEncryptedTokens: null,
                previousAccessTokenExpiresAt: null,
                previousGraceUntil: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                revokedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/v1/invitations/accept') {
          return new Response(
            JSON.stringify({
              ok: true,
              invitation: {
                invitationId: '22222222-2222-4222-8222-000000000502',
                tenantId: '33333333-3333-4333-8333-000000000503',
                tenantName: 'Biuro Syntetyczne Alfa',
                inviteeMaskedEmail: 'e***@syntetyczny.example',
                inviteeDisplayName: 'Ewa Księgowa',
                intendedRole: 'tenant_member',
                initialCompanyGrants: [
                  {
                    legalEntityId: '44444444-4444-4444-8444-000000000504',
                    actions: ['read'],
                  },
                ],
                status: 'accepted',
                invitedByUserId: '55555555-5555-4555-8555-000000000505',
                invitedByDisplayName: 'Anna Właścicielka',
                createdAt: '2026-10-01T10:00:00.000Z',
                expiresAt: '2026-10-04T10:00:00.000Z',
                acceptedAt: '2026-10-01T10:05:00.000Z',
                acceptedByUserId: '11111111-1111-4111-8111-000000000501',
                revokedAt: null,
                rejectedAt: null,
              },
              membership: {
                tenantId: '33333333-3333-4333-8333-000000000503',
                tenantName: 'Biuro Syntetyczne Alfa',
                role: 'tenant_member',
                status: 'active',
                validFrom: '2026-10-01T10:05:00.000Z',
                validUntil: null,
              },
              grantedCompanyIds: ['44444444-4444-4444-8444-000000000504'],
              auditEventId: 'aud-inv-1',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/v1/auth/bff/session/context') {
          capturedContextUpdate = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              ok: true,
              session: {
                sessionIdHash,
                userId: '11111111-1111-4111-8111-000000000501',
                issuer: 'https://idp.syntetyczny.example',
                subject: 'ewa-sub',
                displayName: 'Ewa Księgowa',
                email: 'ewa@syntetyczny.example',
                tenantId: '33333333-3333-4333-8333-000000000503',
                legalEntityId: '44444444-4444-4444-8444-000000000504',
                period: '2026-10',
                encryptedTokens,
                accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                refreshGeneration: 0,
                previousEncryptedTokens: null,
                previousAccessTokenExpiresAt: null,
                previousGraceUntil: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                revokedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/v1/invitations/reject') {
          return new Response(
            JSON.stringify({
              ok: true,
              invitation: {
                invitationId: '22222222-2222-4222-8222-000000000509',
                tenantId: '33333333-3333-4333-8333-000000000503',
                tenantName: 'Biuro Syntetyczne Alfa',
                inviteeMaskedEmail: 'e***@syntetyczny.example',
                inviteeDisplayName: null,
                intendedRole: 'tenant_member',
                initialCompanyGrants: [],
                status: 'rejected',
                invitedByUserId: '55555555-5555-4555-8555-000000000505',
                invitedByDisplayName: 'Anna Właścicielka',
                createdAt: '2026-10-01T10:00:00.000Z',
                expiresAt: '2026-10-04T10:00:00.000Z',
                acceptedAt: null,
                acceptedByUserId: null,
                revokedAt: null,
                rejectedAt: '2026-10-01T10:06:00.000Z',
              },
              auditEventId: 'aud-inv-rej-1',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const acceptReq = new NextRequest('http://localhost:31608/api/session/invitations/accept', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: VALID_INVITE_TOKEN }),
    });
    const acceptRes = await acceptInvitationPost(acceptReq);
    expect(acceptRes.status).toBe(200);
    expect(capturedContextUpdate).toMatchObject({
      tenantId: '33333333-3333-4333-8333-000000000503',
      legalEntityId: '44444444-4444-4444-8444-000000000504',
    });

    const rejectReq = new NextRequest('http://localhost:31608/api/session/invitations/reject', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        invitationToken: VALID_INVITE_TOKEN,
        reason: 'Odrzucam testowe zaproszenie',
      }),
    });
    const rejectRes = await rejectInvitationPost(rejectReq);
    expect(rejectRes.status).toBe(200);
  });

  it('umożliwia świeżo zbootstrapowanemu właścicielowi OIDC (legalEntityId === "") utworzenie pierwszego podmiotu prawnego', async () => {
    vi.stubEnv('API_BASE_URL', 'http://127.0.0.1:4100');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        return new Response(
          JSON.stringify({
            company: {
              tenantId: '33333333-3333-4333-8333-000000000503',
              legalEntityId: '66666666-6666-4666-8666-000000000506',
              displayName: 'Pierwsza Kancelaria Właściciela',
              companyName: 'Pierwsza Kancelaria Właściciela',
              nip: '5261040828',
              grantedActions: ['read', 'write'],
            },
            taxProfile: {
              legalForm: 'jdg',
              profileCode: 'jdg_kpir_skala',
              vatStatus: 'czynny',
              zusStage: 'preferencyjny_zus',
              smallTaxpayer: true,
              voluntarySicknessInsurance: false,
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const ownerBootstrappedSession: ActiveWebSession = {
      oidcToken: 'real_oidc_owner_access_token_jwt_0123456789',
      authMethod: 'oidc',
      hasTenantMembership: true,
      context: {
        userId: '11111111-1111-4111-8111-000000000501',
        displayName: 'Anna Właścicielka',
        email: 'anna@syntetyczny.example',
        roleSummaryPl: 'Użytkownik OIDC (wybór lub utworzenie podmiotu)',
        tenantId: '33333333-3333-4333-8333-000000000503',
        legalEntityId: '',
        period: '2026-10',
      },
    };

    const created = await createCompanyMutation(ownerBootstrappedSession, {
      companyName: 'Pierwsza Kancelaria Właściciela',
      nip: '5261040828',
      address: 'ul. Książęca 4, 00-498 Warszawa',
      legalForm: 'jdg',
      profileCode: 'jdg_kpir_skala',
      vatStatus: 'czynny',
    });

    expect(created.legalEntityId).toBe('66666666-6666-4666-8666-000000000506');
    expect(created.companyName).toBe('Pierwsza Kancelaria Właściciela');
  });

  it('P0-5: pozwala wybrać pierwszą firmę w verifySessionAccess przy pustym session.context.legalEntityId oraz czyści legalEntityId przy akceptacji zaproszenia do innego tenanta bez grantów', async () => {
    vi.stubEnv('PAP_RUNTIME_MODE', 'STAGING_PRIVATE');
    vi.stubEnv('PAP_WEB_SESSION_SECRET', TEST_BFF_SECRET);
    vi.stubEnv('API_BASE_URL', 'http://127.0.0.1:4100');

    const sessionIdHash = sha256Hex(VALID_OPAQUE_SESSION_ID);
    const encryptedTokens = encryptBffPayload(
      { accessToken: 'real_oidc_member_access_token_jwt_0123456789' },
      `bff_session:${sessionIdHash}`,
      { PAP_WEB_SESSION_SECRET: TEST_BFF_SECRET },
    );

    cookiesMock.mockImplementation(async () => ({
      get: (name: string) =>
        name === BFF_SESSION_COOKIE_NAME
          ? { name, value: VALID_OPAQUE_SESSION_ID }
          : undefined,
    }));

    let contextSaved: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        if (url.pathname === '/api/v1/auth/bff/session/get') {
          return new Response(
            JSON.stringify({
              ok: true,
              session: {
                sessionIdHash,
                userId: '11111111-1111-4111-8111-000000000501',
                issuer: 'https://idp.syntetyczny.example',
                subject: 'ewa-sub',
                displayName: 'Ewa Księgowa',
                email: 'ewa@syntetyczny.example',
                tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
                legalEntityId: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002',
                period: '2026-10',
                encryptedTokens,
                accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                refreshGeneration: 0,
                previousEncryptedTokens: null,
                previousAccessTokenExpiresAt: null,
                previousGraceUntil: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                revokedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/v1/invitations/accept') {
          return new Response(
            JSON.stringify({
              ok: true,
              invitation: {
                invitationId: '22222222-2222-4222-8222-000000000599',
                tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
                tenantName: 'Druga Organizacja Bez Grantu Początkowego',
                inviteeMaskedEmail: 'e***@syntetyczny.example',
                inviteeDisplayName: 'Ewa Księgowa',
                intendedRole: 'tenant_member',
                initialCompanyGrants: [],
                status: 'accepted',
                invitedByUserId: '55555555-5555-4555-8555-000000000505',
                invitedByDisplayName: 'Piotr Właściciel',
                createdAt: '2026-10-01T10:00:00.000Z',
                expiresAt: '2026-10-04T10:00:00.000Z',
                acceptedAt: '2026-10-01T10:05:00.000Z',
                acceptedByUserId: '11111111-1111-4111-8111-000000000501',
                revokedAt: null,
                rejectedAt: null,
              },
              membership: {
                tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
                tenantName: 'Druga Organizacja Bez Grantu Początkowego',
                role: 'tenant_member',
                status: 'active',
                validFrom: '2026-10-01T10:05:00.000Z',
                validUntil: null,
              },
              grantedCompanyIds: [],
              auditEventId: 'aud-inv-cross-1',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname === '/api/v1/auth/bff/session/context') {
          contextSaved = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          return new Response(
            JSON.stringify({
              ok: true,
              session: {
                sessionIdHash,
                userId: '11111111-1111-4111-8111-000000000501',
                issuer: 'https://idp.syntetyczny.example',
                subject: 'ewa-sub',
                displayName: 'Ewa Księgowa',
                email: 'ewa@syntetyczny.example',
                tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
                legalEntityId: null,
                period: '2026-10',
                encryptedTokens,
                accessTokenExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                refreshGeneration: 0,
                previousEncryptedTokens: null,
                previousAccessTokenExpiresAt: null,
                previousGraceUntil: null,
                expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
                revokedAt: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname.endsWith('/settings')) {
          return new Response(
            JSON.stringify({
              company: {
                tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
                legalEntityId: 'dddddddd-dddd-4ddd-8ddd-000000000004',
                displayName: 'Spółka Udostępniona Później',
                companyName: 'Spółka Udostępniona Później',
                nip: '5213004125',
                grantedActions: ['read'],
              },
              taxProfile: {
                legalForm: 'sp_z_o_o',
                profileCode: 'spzoo_pelne_ksiegi',
                vatStatus: 'czynny',
                zusStage: 'not_applicable',
                smallTaxpayer: true,
                voluntarySicknessInsurance: false,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response('not found', { status: 404 });
      }),
    );

    const crossAcceptReq = new NextRequest('http://localhost:31608/api/session/invitations/accept', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:31608',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ invitationToken: VALID_INVITE_TOKEN }),
    });
    const crossAcceptRes = await acceptInvitationPost(crossAcceptReq);
    expect(crossAcceptRes.status).toBe(200);
    // legalEntityId z poprzedniego tenanta NIE może zostać zachowane!
    expect(contextSaved).toMatchObject({
      tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
      legalEntityId: null,
    });

    // Użytkownik z pustym legalEntityId w sesji może wybrać firmę po nadaniu grantu
    const memberWithoutSelectedCompany: ActiveWebSession = {
      oidcToken: 'real_oidc_member_access_token_jwt_0123456789',
      authMethod: 'oidc',
      hasTenantMembership: true,
      context: {
        userId: '11111111-1111-4111-8111-000000000501',
        displayName: 'Ewa Księgowa',
        email: 'ewa@syntetyczny.example',
        roleSummaryPl: 'Użytkownik OIDC (wybór lub utworzenie podmiotu)',
        tenantId: 'cccccccc-cccc-4ccc-8ccc-000000000003',
        legalEntityId: '',
        period: '2026-10',
      },
    };
    const verifiedComp = await verifySessionAccess(
      memberWithoutSelectedCompany,
      'cccccccc-cccc-4ccc-8ccc-000000000003',
      'dddddddd-dddd-4ddd-8ddd-000000000004',
      'read',
    );
    expect(verifiedComp.companyName).toBe('Spółka Udostępniona Później');
  });
});
