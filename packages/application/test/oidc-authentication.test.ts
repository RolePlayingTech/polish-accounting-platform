import { describe, expect, it, vi } from 'vitest';
import { legalEntityId, tenantId, userId, type TenantMembership } from '@pap/domain';
import {
  authenticateOidcActor,
  authorizeAuthenticatedCompanyAction,
  type OidcAccessTokenVerifier,
  type TenantAuthorizationDataSource,
  type UserIdentityResolver,
} from '../src/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const USER_A = userId(id(1));
const USER_B = userId(id(2));
const TENANT_A = tenantId(id(10));
const ENTITY_A1 = legalEntityId(id(11));
const ISSUER_1 = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const ISSUER_2 = 'https://other-idp.example.test/realms/pap';
const now = new Date('2026-10-28T12:00:00.000Z');
const validFrom = new Date('2026-01-01T00:00:00.000Z');

describe('authenticateOidcActor i authorizeAuthenticatedCompanyAction', () => {
  it('rozwiązuje zweryfikowaną parę (issuer, subject) na wewnętrzny userId i autoryzuje akcję', async () => {
    const verifier: OidcAccessTokenVerifier = {
      verifyAccessToken: vi.fn(async () => ({
        ok: true as const,
        identity: {
          issuer: ISSUER_1,
          subject: 'CaseSensitive-Subject-01',
          scopes: ['openid', 'pap:accounting'],
        },
      })),
    };
    const identityResolver: UserIdentityResolver = {
      resolveVerifiedIdentity: vi.fn(async (identity) =>
        identity.issuer === ISSUER_1 && identity.subject === 'CaseSensitive-Subject-01'
          ? { userId: USER_A }
          : null,
      ),
    };
    const authorizationDataSource: TenantAuthorizationDataSource = {
      getFacts: vi.fn(async (query) => ({
        membership: {
          userId: query.userId,
          tenantId: query.tenantId,
          role: 'tenant_member',
          status: 'active',
          validFrom,
          validUntil: null,
        } satisfies TenantMembership,
        grants: [
          {
            grantId: id(90),
            userId: USER_A,
            tenantId: TENANT_A,
            legalEntityId: ENTITY_A1,
            action: 'read',
            validFrom,
            validUntil: null,
            revokedAt: null,
          },
        ],
        platformRoleAssignments: [],
      })),
    };

    const result = await authorizeAuthenticatedCompanyAction(
      {
        rawBearerToken: 'synthetic.jwt.token',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
        requiredScopes: ['pap:accounting'],
      },
      {
        verifier,
        identityResolver,
        authorizationDataSource,
        clock: { now: () => now },
      },
    );

    expect(result).toEqual({
      allowed: true,
      status: 'allowed',
      reason: 'explicit_company_grant',
      context: {
        userId: USER_A,
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
        identity: {
          issuer: ISSUER_1,
          subject: 'CaseSensitive-Subject-01',
          scopes: ['openid', 'pap:accounting'],
        },
      },
    });
    expect(authorizationDataSource.getFacts).toHaveBeenCalledWith({
      userId: USER_A,
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A1,
      action: 'read',
    });
  });

  it('traktuje subject jako case-sensitive i rozróżnia wystawców o tym samym subject', async () => {
    const mappings = new Map<string, typeof USER_A>([
      [`${ISSUER_1}::Subject-Alpha`, USER_A],
      [`${ISSUER_2}::Subject-Alpha`, USER_B],
    ]);
    const identityResolver: UserIdentityResolver = {
      resolveVerifiedIdentity: async ({ issuer, subject }) => {
        const mapped = mappings.get(`${issuer}::${subject}`);
        return mapped ? { userId: mapped } : null;
      },
    };

    const makeVerifier = (issuer: string, subject: string): OidcAccessTokenVerifier => ({
      verifyAccessToken: async () => ({
        ok: true,
        identity: { issuer, subject },
      }),
    });

    const res1 = await authenticateOidcActor('token-1', {
      verifier: makeVerifier(ISSUER_1, 'Subject-Alpha'),
      identityResolver,
    });
    const res2 = await authenticateOidcActor('token-2', {
      verifier: makeVerifier(ISSUER_2, 'Subject-Alpha'),
      identityResolver,
    });
    const resWrongCase = await authenticateOidcActor('token-3', {
      verifier: makeVerifier(ISSUER_1, 'subject-alpha'),
      identityResolver,
    });

    expect(res1).toMatchObject({ authenticated: true, userId: USER_A });
    expect(res2).toMatchObject({ authenticated: true, userId: USER_B });
    expect(resWrongCase).toEqual({
      authenticated: false,
      status: 'forbidden',
      reason: 'identity_not_provisioned_or_disabled',
    });
  });

  it.each([
    ['pusty token', ''],
    ['spacje na krańcach tokenu', ' token '],
    ['brak tokenu', undefined],
  ])(
    'odrzuca nieprawidłowy surowy token przed wywołaniem weryfikatora: %s',
    async (_label, raw) => {
      const verifier: OidcAccessTokenVerifier = {
        verifyAccessToken: vi.fn(),
      };
      const identityResolver: UserIdentityResolver = {
        resolveVerifiedIdentity: vi.fn(),
      };

      expect(await authenticateOidcActor(raw, { verifier, identityResolver })).toEqual({
        authenticated: false,
        status: 'unauthenticated',
        reason: 'missing_token',
      });
      expect(verifier.verifyAccessToken).not.toHaveBeenCalled();
      expect(identityResolver.resolveVerifiedIdentity).not.toHaveBeenCalled();
    },
  );

  it('mapuje insufficient_scope na forbidden (403), a inne błędy tokenu na unauthenticated (401)', async () => {
    const identityResolver: UserIdentityResolver = {
      resolveVerifiedIdentity: vi.fn(),
    };

    const scopeResult = await authenticateOidcActor('token', {
      verifier: {
        verifyAccessToken: async () => ({ ok: false, reason: 'insufficient_scope' }),
      },
      identityResolver,
    });
    expect(scopeResult).toEqual({
      authenticated: false,
      status: 'forbidden',
      reason: 'insufficient_scope',
    });

    const sigResult = await authenticateOidcActor('token', {
      verifier: {
        verifyAccessToken: async () => ({ ok: false, reason: 'invalid_signature' }),
      },
      identityResolver,
    });
    expect(sigResult).toEqual({
      authenticated: false,
      status: 'unauthenticated',
      reason: 'invalid_signature',
    });
    expect(identityResolver.resolveVerifiedIdentity).not.toHaveBeenCalled();
  });

  it('jest fail-closed przy awarii weryfikatora OIDC lub źródła tożsamości bez wycieku wyjątku', async () => {
    const throwingVerifier = await authenticateOidcActor('token', {
      verifier: {
        verifyAccessToken: async () => {
          throw new Error('JWKS secret error');
        },
      },
      identityResolver: { resolveVerifiedIdentity: async () => ({ userId: USER_A }) },
    });
    expect(throwingVerifier).toEqual({
      authenticated: false,
      status: 'unauthenticated',
      reason: 'oidc_verification_unavailable',
    });

    const throwingResolver = await authenticateOidcActor('token', {
      verifier: {
        verifyAccessToken: async () => ({
          ok: true,
          identity: { issuer: ISSUER_1, subject: 'sub-1' },
        }),
      },
      identityResolver: {
        resolveVerifiedIdentity: async () => {
          throw new Error('SELECT * FROM app_user password=secret');
        },
      },
    });
    expect(throwingResolver).toEqual({
      authenticated: false,
      status: 'forbidden',
      reason: 'identity_resolution_unavailable',
    });
  });
});
