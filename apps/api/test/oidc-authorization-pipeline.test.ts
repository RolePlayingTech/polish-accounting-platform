import { Bind, Controller, Get, Inject, Module, Post, Req, Res, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  manageAccess,
  type AccessManagementActor,
  type AccessManagementAuthorizationDataSource,
  type AccessManagementAuthorizationFacts,
  type AccessManagementCommand,
  type AccessManagementResult,
  type AccessManagementStore,
  type AccessManagementTransaction,
  type CompanyActionTransactionContext,
  type CompanyActionUnitOfWork,
  type LockedTenantAuthorizationFacts,
  type TenantAuthorizationDataSource,
  type TenantAuthorizationFacts,
  type TenantAuthorizationQuery,
  type TransactionActor,
  type TransactionSessionContext,
  type UserIdentityResolver,
  type VerifiedOidcIdentity,
} from '@pap/application';
import {
  legalEntityId,
  tenantId,
  userId,
  type CompanyAccessGrant,
  type PlatformRoleAssignment,
  type TenantMembership,
  type UserId,
} from '@pap/domain';
import type { FastifyReply } from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  AUTHORIZATION_CLOCK,
  CompanyActionAuthorizationGuard,
  executeHttpAuthorizedCompanyAction,
  JwksOidcAccessTokenVerifier,
  OIDC_ACCESS_TOKEN_VERIFIER,
  RequireCompanyAction,
  TENANT_AUTHORIZATION_DATA_SOURCE,
  USER_IDENTITY_RESOLVER,
  type AuthenticatedFastifyRequest,
  type OidcVerifierConfig,
} from '../src/auth/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const TENANT_A = tenantId(id(1));
const TENANT_B = tenantId(id(2));
const ENTITY_A1 = legalEntityId(id(11));
const ENTITY_A2 = legalEntityId(id(12));
const ENTITY_B1 = legalEntityId(id(21));

const USER_A = userId(id(31));
const USER_B = userId(id(32));
const ADMIN_A = userId(id(33));
const OWNER_A = userId(id(34));
const PLATFORM_OP = userId(id(35));

const ISSUER_TRUSTED = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const ISSUER_OTHER = 'https://other-idp.example.test/realms/pap';
const JWKS_URI =
  'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/certs';
const AUDIENCE = 'pap-api';
const VALID_FROM = new Date('2026-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-28T12:00:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

const TEST_COMPANY_UNIT_OF_WORK = Symbol('TEST_COMPANY_UNIT_OF_WORK');

interface TestCompanyTransactionContext extends CompanyActionTransactionContext {
  readonly txNumber: number;
  appliedSessionContext: TransactionSessionContext | null;
}

/**
 * Kontroler testowy rejestrowany wyłącznie w module testowym (Sec 6: brak nowych publicznych endpointów księgowych w AppModule).
 * Dowodzi działania pełnego serwerowego pipeline'u NestJS/Fastify:
 * Bearer JWT -> JwksOidcAccessTokenVerifier -> UserIdentityResolver -> TenantAuthorizationDataSource -> authorizeCompanyAction.
 */
@Controller('api/v1/test-authz/tenants/:tenantId/entities/:legalEntityId')
@UseGuards(CompanyActionAuthorizationGuard)
class TestCompanyAuthorizationController {
  @Get('probe')
  @RequireCompanyAction({ action: 'read', requiredScopes: ['pap:accounting'] })
  @Bind(Req())
  readCompanyProbe(request: AuthenticatedFastifyRequest) {
    const ctx = request.papCompanyAuthContext!;
    return {
      ok: true,
      resolvedActorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      action: ctx.action,
    };
  }

  @Post('probe-write')
  @RequireCompanyAction({ action: 'write', requiredScopes: ['pap:accounting'] })
  @Bind(Req())
  writeCompanyProbe(request: AuthenticatedFastifyRequest) {
    const ctx = request.papCompanyAuthContext!;
    return {
      ok: true,
      resolvedActorUserId: ctx.userId,
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      action: ctx.action,
    };
  }
}

/**
 * Drugi kontroler testowy (wyłącznie w module testowym) weryfikujący transakcyjny helper HTTP 6D-3A
 * `executeHttpAuthorizedCompanyAction`, który eliminuje okno TOCTOU między uwierzytelnieniem OIDC a operacją DB.
 */
@Controller('api/v1/test-authz/tenants/:tenantId/entities/:legalEntityId')
class TestTransactionalCompanyController {
  constructor(
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: JwksOidcAccessTokenVerifier,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
    @Inject(TEST_COMPANY_UNIT_OF_WORK)
    private readonly unitOfWork: CompanyActionUnitOfWork<TestCompanyTransactionContext>,
  ) {}

  @Post('probe-transactional-write')
  @Bind(Req(), Res({ passthrough: true }))
  async writeTransactionalProbe(request: AuthenticatedFastifyRequest, reply: FastifyReply) {
    return executeHttpAuthorizedCompanyAction(
      request,
      reply,
      { action: 'write', requiredScopes: ['pap:accounting'] },
      {
        verifier: this.verifier,
        identityResolver: this.identityResolver,
        unitOfWork: this.unitOfWork,
      },
      async (ctx, tx) => ({
        ok: true,
        txNumber: tx.txNumber,
        resolvedActorUserId: ctx.userId,
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        action: ctx.action,
        sessionContext: tx.appliedSessionContext,
      }),
    );
  }
}

class ControlledAuthState
  implements
    UserIdentityResolver,
    TenantAuthorizationDataSource,
    AccessManagementAuthorizationDataSource,
    AccessManagementStore,
    CompanyActionUnitOfWork<TestCompanyTransactionContext>
{
  readonly identities = new Map<
    string,
    { userId: UserId; userActive: boolean; linkActive: boolean }
  >();
  readonly memberships = new Map<string, TenantMembership>();
  grants: CompanyAccessGrant[] = [];
  platformRoles: PlatformRoleAssignment[] = [];
  failIdentityResolution = false;
  failAuthorizationDataSource = false;
  onAfterResolveIdentity: (() => void) | null = null;
  txCounter = 0;
  committedTransactions = 0;
  rolledBackTransactions = 0;
  executedOperations = 0;

  reset() {
    this.identities.clear();
    this.memberships.clear();
    this.grants = [];
    this.platformRoles = [];
    this.failIdentityResolution = false;
    this.failAuthorizationDataSource = false;
    this.onAfterResolveIdentity = null;
    this.txCounter = 0;
    this.committedTransactions = 0;
    this.rolledBackTransactions = 0;
    this.executedOperations = 0;

    this.linkIdentity(ISSUER_TRUSTED, 'Sub-User-A', USER_A);
    this.linkIdentity(ISSUER_OTHER, 'Sub-User-A', USER_B);
    this.linkIdentity(ISSUER_TRUSTED, 'Sub-Admin-A', ADMIN_A);
    this.linkIdentity(ISSUER_TRUSTED, 'Sub-Owner-A', OWNER_A);
    this.linkIdentity(ISSUER_TRUSTED, 'Sub-Platform-Op', PLATFORM_OP);

    this.setMembership({
      tenantId: TENANT_A,
      userId: USER_A,
      role: 'tenant_member',
      status: 'active',
      validFrom: VALID_FROM,
      validUntil: null,
    });
    this.setMembership({
      tenantId: TENANT_A,
      userId: ADMIN_A,
      role: 'tenant_admin',
      status: 'active',
      validFrom: VALID_FROM,
      validUntil: null,
    });
    this.setMembership({
      tenantId: TENANT_A,
      userId: OWNER_A,
      role: 'tenant_owner',
      status: 'active',
      validFrom: VALID_FROM,
      validUntil: null,
    });
    this.setMembership({
      tenantId: TENANT_B,
      userId: USER_B,
      role: 'tenant_owner',
      status: 'active',
      validFrom: VALID_FROM,
      validUntil: null,
    });

    this.grants = [
      {
        grantId: id(101),
        tenantId: TENANT_A,
        userId: USER_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: VALID_FROM,
        validUntil: null,
        revokedAt: null,
      },
      {
        grantId: id(102),
        tenantId: TENANT_B,
        userId: USER_B,
        legalEntityId: ENTITY_B1,
        action: 'read',
        validFrom: VALID_FROM,
        validUntil: null,
        revokedAt: null,
      },
    ];

    this.platformRoles = [{ userId: PLATFORM_OP, role: 'platform_operator' }];
  }

  linkIdentity(
    issuer: string,
    subject: string,
    targetUserId: UserId,
    userActive = true,
    linkActive = true,
  ) {
    this.identities.set(`${issuer}\u0000${subject}`, {
      userId: targetUserId,
      userActive,
      linkActive,
    });
  }

  setMembership(membership: TenantMembership) {
    this.memberships.set(`${membership.tenantId}::${membership.userId}`, membership);
  }

  async resolveVerifiedIdentity(
    identity: VerifiedOidcIdentity,
  ): Promise<{ readonly userId: UserId } | null> {
    if (this.failIdentityResolution) {
      throw new Error('SELECT * FROM user_oidc_identity password=synthetic-db-secret');
    }
    const entry = this.identities.get(`${identity.issuer}\u0000${identity.subject}`);
    if (!entry || !entry.userActive || !entry.linkActive) {
      return null;
    }
    const resolved = { userId: entry.userId };
    this.onAfterResolveIdentity?.();
    return resolved;
  }

  private isActorCurrentlyActive(actor: TransactionActor): boolean {
    if (actor.identity) {
      const entry = this.identities.get(`${actor.identity.issuer}\u0000${actor.identity.subject}`);
      return Boolean(
        entry && entry.userId === actor.userId && entry.userActive && entry.linkActive,
      );
    }
    for (const entry of this.identities.values()) {
      if (entry.userId === actor.userId && entry.userActive) {
        return true;
      }
    }
    return false;
  }

  async runCompanyActionInTransaction<TResult>(
    work: (tx: TestCompanyTransactionContext) => Promise<TResult>,
    shouldCommit: (result: TResult) => boolean,
  ): Promise<TResult> {
    const txNumber = ++this.txCounter;
    const tx: TestCompanyTransactionContext = {
      txNumber,
      appliedSessionContext: null,
      verifyActorAccount: async (actor) => this.isActorCurrentlyActive(actor),
      getLockedFacts: async (query): Promise<LockedTenantAuthorizationFacts> => {
        const facts = await this.getFacts(query);
        return { ...facts, now: NOW };
      },
      applySessionContext: async (context) => {
        tx.appliedSessionContext = context;
      },
    };

    try {
      const result = await work(tx);
      if (shouldCommit(result)) {
        this.committedTransactions += 1;
        this.executedOperations += 1;
      } else {
        this.rolledBackTransactions += 1;
      }
      return result;
    } catch (error) {
      this.rolledBackTransactions += 1;
      throw error;
    }
  }

  async runInTransaction(
    work: (tx: AccessManagementTransaction) => Promise<AccessManagementResult>,
  ): Promise<AccessManagementResult> {
    const tx: AccessManagementTransaction = {
      verifyActorAccount: async (actor) => this.isActorCurrentlyActive(actor),
      getAuthorizationFacts: async (actor, command) => {
        const facts = await this.getAuthorizationFacts(actor, command);
        return { ...facts, now: NOW };
      },
      applySessionContext: async () => undefined,
      executeAuthorized: async (command) => this.execute(command),
    };
    const result = await work(tx);
    if (result.ok) {
      this.committedTransactions += 1;
    } else {
      this.rolledBackTransactions += 1;
    }
    return result;
  }

  async getFacts(query: TenantAuthorizationQuery): Promise<TenantAuthorizationFacts> {
    if (this.failAuthorizationDataSource) {
      throw new Error('SELECT * FROM company_access_grant password=synthetic-db-secret');
    }
    const membership = this.memberships.get(`${query.tenantId}::${query.userId}`) ?? null;
    const grants = this.grants.filter(
      (g) =>
        g.tenantId === query.tenantId &&
        g.userId === query.userId &&
        g.legalEntityId === query.legalEntityId &&
        g.action === query.action,
    );
    return {
      membership,
      grants,
      platformRoleAssignments: this.platformRoles.filter((r) => r.userId === query.userId),
    };
  }

  async getAuthorizationFacts(
    actor: AccessManagementActor,
    command: AccessManagementCommand,
  ): Promise<AccessManagementAuthorizationFacts> {
    const actorMembership = this.memberships.get(`${command.tenantId}::${actor.userId}`) ?? null;
    const targetMembership = this.memberships.get(`${command.tenantId}::${command.userId}`) ?? null;
    const actorGrants = this.grants.filter(
      (g) => g.tenantId === command.tenantId && g.userId === actor.userId,
    );
    const foundTargetGrant =
      command.kind === 'revoke_grant'
        ? this.grants.find(
            (g) =>
              g.tenantId === command.tenantId &&
              g.userId === command.userId &&
              g.grantId === command.grantId,
          )
        : undefined;

    return {
      actorMembership,
      actorGrants,
      targetMembership,
      targetGrant: foundTargetGrant
        ? { legalEntityId: foundTargetGrant.legalEntityId, action: foundTargetGrant.action }
        : null,
    };
  }

  async execute(command: AccessManagementCommand): Promise<AccessManagementResult> {
    const key = `${command.tenantId}::${command.userId}`;
    const member = this.memberships.get(key);
    if (!member) {
      return { ok: false, reason: 'membership_unavailable' };
    }

    switch (command.kind) {
      case 'revoke_membership': {
        this.grants = this.grants.map((g) =>
          g.tenantId === command.tenantId && g.userId === command.userId && g.revokedAt === null
            ? { ...g, revokedAt: NOW }
            : g,
        );
        this.memberships.set(key, { ...member, status: 'revoked' });
        return {
          ok: true,
          receipt: {
            operationId: command.operationId,
            occurredAt: NOW.toISOString(),
            changed: true,
            grantId: null,
          },
        };
      }
      case 'reactivate_membership': {
        if (member.status !== 'revoked') {
          return { ok: false, reason: 'membership_not_revoked' };
        }
        // Zgodnie z 6D-R: reaktywacja nigdy nie przywraca historycznych grantów!
        this.memberships.set(key, {
          ...member,
          status: 'active',
          validFrom: NOW,
          validUntil: command.validUntil ? new Date(command.validUntil) : null,
        });
        return {
          ok: true,
          receipt: {
            operationId: command.operationId,
            occurredAt: NOW.toISOString(),
            changed: true,
            grantId: null,
          },
        };
      }
      case 'grant': {
        if (member.status !== 'active') {
          return { ok: false, reason: 'membership_inactive' };
        }
        this.grants.push({
          grantId: command.grantId,
          tenantId: command.tenantId,
          userId: command.userId,
          legalEntityId: command.legalEntityId,
          action: command.action,
          validFrom: command.validFrom ? new Date(command.validFrom) : NOW,
          validUntil: command.validUntil ? new Date(command.validUntil) : null,
          revokedAt: null,
        });
        return {
          ok: true,
          receipt: {
            operationId: command.operationId,
            occurredAt: NOW.toISOString(),
            changed: true,
            grantId: command.grantId,
          },
        };
      }
      case 'revoke_grant': {
        this.grants = this.grants.map((g) =>
          g.tenantId === command.tenantId &&
          g.userId === command.userId &&
          g.grantId === command.grantId
            ? { ...g, revokedAt: NOW }
            : g,
        );
        return {
          ok: true,
          receipt: {
            operationId: command.operationId,
            occurredAt: NOW.toISOString(),
            changed: true,
            grantId: command.grantId,
          },
        };
      }
    }
  }
}

describe('Serwerowy pipeline OIDC -> UserIdentityResolver -> authorizeCompanyAction w NestJS/Fastify', () => {
  let app: NestFastifyApplication;
  let prodApp: NestFastifyApplication;
  let rsaPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let publicJwk: JWK;
  let verifier: JwksOidcAccessTokenVerifier;
  const state = new ControlledAuthState();

  async function issueToken(claims: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT({
      iss: ISSUER_TRUSTED,
      sub: 'Sub-User-A',
      aud: AUDIENCE,
      azp: 'pap-web-client',
      typ: 'Bearer',
      scope: 'openid pap:accounting',
      iat: NOW_SEC - 30,
      exp: NOW_SEC + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'test-kid-1' })
      .sign(rsaPair.privateKey);
  }

  beforeAll(async () => {
    rsaPair = await generateKeyPair('RS256');
    publicJwk = {
      ...(await exportJWK(rsaPair.publicKey)),
      kid: 'test-kid-1',
      use: 'sig',
      alg: 'RS256',
    };

    const config: OidcVerifierConfig = {
      environment: 'test',
      issuer: ISSUER_TRUSTED,
      jwksUri: JWKS_URI,
      audience: AUDIENCE,
      allowedAlgorithms: ['RS256'],
      allowedTokenHeaderTypes: ['at+jwt', 'jwt'],
      allowedAuthorizedParties: ['pap-web-client'],
      requiredScopes: ['openid'],
      clockToleranceSeconds: 30,
      maxTokenAgeSeconds: 3600,
      jwksCacheTtlMs: 300_000,
      jwksRefreshCooldownMs: 10_000,
      jwksFetchTimeoutMs: 5_000,
    };

    verifier = new JwksOidcAccessTokenVerifier(config, {
      clock: { now: () => NOW },
      fetchJwks: async () => ({ keys: [publicJwk] }),
    });

    @Module({
      imports: [AppModule],
      controllers: [TestCompanyAuthorizationController, TestTransactionalCompanyController],
      providers: [
        CompanyActionAuthorizationGuard,
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: USER_IDENTITY_RESOLVER, useValue: state },
        { provide: TENANT_AUTHORIZATION_DATA_SOURCE, useValue: state },
        { provide: TEST_COMPANY_UNIT_OF_WORK, useValue: state },
        { provide: AUTHORIZATION_CLOCK, useValue: { now: () => NOW } },
      ],
    })
    class TestAuthPipelineModule {}

    app = await NestFactory.create<NestFastifyApplication>(
      TestAuthPipelineModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.init();

    prodApp = await NestFactory.create<NestFastifyApplication>(
      AppModule,
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await prodApp.init();
  });

  beforeEach(() => {
    state.reset();
  });

  afterAll(async () => {
    await app?.close();
    await prodApp?.close();
  });

  it('produkcyjny AppModule zachowuje publiczne /health i /api/v1/system/status i nie wystawia endpointów firmowych ani /platform', async () => {
    const health = await prodApp.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health',
    });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: 'ok' });

    const status = await prodApp.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/system/status',
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      status: 'ok',
      modules: {
        accounting: 'not_available',
        tenantAuthorization: 'not_available',
        remoteMcp: 'not_available',
      },
    });

    const unexposedProbe = await prodApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
      });
    expect(unexposedProbe.statusCode).toBe(404);

    const unexposedTxProbe = await prodApp
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe-transactional-write`,
      });
    expect(unexposedTxProbe.statusCode).toBe(404);

    const platform = await prodApp.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/api/v1/platform/tenants',
    });
    expect(platform.statusCode).toBe(404);
  });

  it('zezwala użytkownikowi A na dozwoloną operację read w firmie A1 po pełnej weryfikacji OIDC', async () => {
    const token = await issueToken();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      resolvedActorUserId: USER_A,
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A1,
      action: 'read',
    });
  });

  it('ignoruje próby podmiany userId lub roli w body i query — tożsamość pochodzi wyłącznie z serwera', async () => {
    state.grants.push({
      grantId: id(105),
      tenantId: TENANT_A,
      userId: USER_A,
      legalEntityId: ENTITY_A1,
      action: 'write',
      validFrom: VALID_FROM,
      validUntil: null,
      revokedAt: null,
    });

    const token = await issueToken({
      // Deklarowane role w JWT nie nadają uprawnień aplikacyjnych ani nie zmieniają userId
      roles: ['tenant_owner', 'platform_operator'],
      email: 'owner@example.test',
    });

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe-write?userId=${OWNER_A}`,
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          userId: OWNER_A,
          actorId: OWNER_A,
          role: 'tenant_owner',
          approved: true,
        },
      });

    expect(response.statusCode).toBe(201);
    expect(response.json().resolvedActorUserId).toBe(USER_A);
  });

  it.each([
    ['x-user-id', USER_B],
    ['x-authenticated-user', 'admin'],
    ['x-forwarded-user', 'owner'],
    ['x-pap-user-id', OWNER_A],
    ['x-pap-tenant-role', 'tenant_owner'],
    ['x-pap-platform-role', 'platform_operator'],
  ])(
    'odrzuca próbę podszycia się przez nagłówek HTTP %s (401), nawet przy ważnym tokenie Bearer',
    async (headerName, headerValue) => {
      const token = await issueToken();
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'GET',
          url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
          headers: {
            authorization: `Bearer ${token}`,
            [headerName]: headerValue,
          },
        });

      expect(response.statusCode).toBe(401);
      expect(response.headers['www-authenticate']).toContain('Bearer');
      expect(JSON.stringify(response.json())).not.toContain(token);
    },
  );

  it('odrzuca token przesłany w query string (?access_token=...) z kodem 401', async () => {
    const token = await issueToken();
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe?access_token=${token}`,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['A nie może odczytać firmy A2 bez grantu', 'Sub-User-A', TENANT_A, ENTITY_A2, 'GET', 'probe'],
    [
      'A nie może odczytać firmy B1 należącej do tenanta B',
      'Sub-User-A',
      TENANT_B,
      ENTITY_B1,
      'GET',
      'probe',
    ],
    [
      'A nie może odczytać firmy B1 przez własny selektor tenanta A',
      'Sub-User-A',
      TENANT_A,
      ENTITY_B1,
      'GET',
      'probe',
    ],
    [
      'Grant read nie pozwala wykonać write',
      'Sub-User-A',
      TENANT_A,
      ENTITY_A1,
      'POST',
      'probe-write',
    ],
    [
      'Właściciel tenanta (tenant_owner) nie otrzymuje automatycznie dostępu księgowego',
      'Sub-Owner-A',
      TENANT_A,
      ENTITY_A1,
      'GET',
      'probe',
    ],
    [
      'Administrator tenanta (tenant_admin) nie otrzymuje automatycznie dostępu księgowego',
      'Sub-Admin-A',
      TENANT_A,
      ENTITY_A1,
      'GET',
      'probe',
    ],
    [
      'Operator platformy (platform_operator) nie ma dostępu do dokumentów firmy',
      'Sub-Platform-Op',
      TENANT_A,
      ENTITY_A1,
      'GET',
      'probe',
    ],
  ] as const)(
    'odmawia dostępu (403 Forbidden) z jednolitą odpowiedzią: %s',
    async (_label, subject, targetTenant, targetEntity, method, suffix) => {
      const token = await issueToken({
        sub: subject,
        roles: ['platform_operator', 'tenant_owner', 'tenant_admin'],
      });
      const response = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method,
          url: `/api/v1/test-authz/tenants/${targetTenant}/entities/${targetEntity}/${suffix}`,
          headers: {
            authorization: `Bearer ${token}`,
          },
        });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({
        statusCode: 403,
        error: 'forbidden',
        message: 'Brak uprawnień do wykonania operacji.',
      });
    },
  );

  it('nie utożsamia kont po adresie e-mail, rozróżnia wielkość liter w subject i odrzuca wyłączone konto', async () => {
    // Nieznany subject o tym samym adresie e-mail co właściciel nie przejmuje konta
    const emailCollisionToken = await issueToken({
      sub: 'Unmapped-Subject-With-Owner-Email',
      email: 'owner@ksiegowosc.roleplayingtech.com',
      email_verified: true,
    });
    const unmappedRes = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${emailCollisionToken}` },
      });
    expect(unmappedRes.statusCode).toBe(403);

    // Zmiana wielkości liter w subject ('sub-user-a' zamiast 'Sub-User-A') powoduje odmowę
    const wrongCaseToken = await issueToken({ sub: 'sub-user-a' });
    const wrongCaseRes = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${wrongCaseToken}` },
      });
    expect(wrongCaseRes.statusCode).toBe(403);

    // Wyłączone konto wewnętrzne (userActive = false) natychmiast blokuje dostęp
    state.linkIdentity(ISSUER_TRUSTED, 'Sub-User-A', USER_A, false, true);
    const validToken = await issueToken({ sub: 'Sub-User-A' });
    const disabledRes = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${validToken}` },
      });
    expect(disabledRes.statusCode).toBe(403);
  });

  it('cofnięcie członkostwa natychmiast blokuje kolejną operację API, a reaktywacja nie przywraca historycznych grantów', async () => {
    const userToken = await issueToken({ sub: 'Sub-User-A' });
    const ownerToken = await issueToken({ sub: 'Sub-Owner-A' });

    const beforeRevoke = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${userToken}` },
      });
    expect(beforeRevoke.statusCode).toBe(200);

    // Właściciel tenanta cofa członkostwo USER_A przez serwerowy manageAccess
    const revokeResult = await manageAccess(
      {
        kind: 'revoke_membership',
        operationId: id(501),
        tenantId: TENANT_A,
        userId: USER_A,
      },
      {
        store: state,
        actors: createOidcAccessManagementActorSource(ownerToken, {
          verifier,
          identityResolver: state,
        }),
        authorizer: createTenantAccessManagementAuthorizer(state, { now: () => NOW }),
      },
    );
    expect(revokeResult).toMatchObject({ ok: true });

    // Kolejne wywołanie API z tym samym ważnym tokenem JWT natychmiast dostaje 403
    const afterRevoke = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${userToken}` },
      });
    expect(afterRevoke.statusCode).toBe(403);

    // Właściciel tenanta reaktywuje członkostwo USER_A
    const reactivateResult = await manageAccess(
      {
        kind: 'reactivate_membership',
        operationId: id(502),
        tenantId: TENANT_A,
        userId: USER_A,
        validUntil: null,
      },
      {
        store: state,
        actors: createOidcAccessManagementActorSource(ownerToken, {
          verifier,
          identityResolver: state,
        }),
        authorizer: createTenantAccessManagementAuthorizer(state, { now: () => NOW }),
      },
    );
    expect(reactivateResult).toMatchObject({ ok: true });

    // Reaktywacja nie przywraca historycznego grantu do A1 -> nadal 403
    const afterReactivate = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${userToken}` },
      });
    expect(afterReactivate.statusCode).toBe(403);
  });

  it('odmawia (403 fail-closed) przy awarii źródła tożsamości lub autoryzacji bez wycieku SQL i sekretów', async () => {
    const token = await issueToken();

    state.failIdentityResolution = true;
    const resIdentityFail = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(resIdentityFail.statusCode).toBe(403);
    expect(resIdentityFail.body).not.toContain('synthetic-db-secret');
    expect(resIdentityFail.body).not.toContain('SELECT');

    state.failIdentityResolution = false;
    state.failAuthorizationDataSource = true;
    const resAuthzFail = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'GET',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(resAuthzFail.statusCode).toBe(403);
    expect(resAuthzFail.body).not.toContain('synthetic-db-secret');
    expect(resAuthzFail.body).not.toContain('SELECT');
  });

  it('executeHttpAuthorizedCompanyAction wykonuje autoryzację, kontekst sesji i operację w jednej transakcji (201)', async () => {
    state.grants.push({
      grantId: id(109),
      tenantId: TENANT_A,
      userId: USER_A,
      legalEntityId: ENTITY_A1,
      action: 'write',
      validFrom: VALID_FROM,
      validUntil: null,
      revokedAt: null,
    });

    const token = await issueToken({ sub: 'Sub-User-A' });
    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe-transactional-write`,
        headers: { authorization: `Bearer ${token}` },
      });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      ok: true,
      txNumber: 1,
      resolvedActorUserId: USER_A,
      tenantId: TENANT_A,
      legalEntityId: ENTITY_A1,
      action: 'write',
      sessionContext: {
        actorUserId: USER_A,
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
      },
    });
    expect(state.committedTransactions).toBe(1);
    expect(state.rolledBackTransactions).toBe(0);
    expect(state.executedOperations).toBe(1);
  });

  it('executeHttpAuthorizedCompanyAction eliminuje TOCTOU — wyłączenie konta lub cofnięcie grantu po resolveVerifiedIdentity wycofuje transakcję (403)', async () => {
    state.grants.push({
      grantId: id(110),
      tenantId: TENANT_A,
      userId: USER_A,
      legalEntityId: ENTITY_A1,
      action: 'write',
      validFrom: VALID_FROM,
      validUntil: null,
      revokedAt: null,
    });

    const token = await issueToken({ sub: 'Sub-User-A' });

    // Scenariusz A: wyłączenie app_user w oknie między resolveVerifiedIdentity a wejściem do transakcji
    state.onAfterResolveIdentity = () => {
      state.linkIdentity(ISSUER_TRUSTED, 'Sub-User-A', USER_A, false, true);
    };
    const disabledRes = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe-transactional-write`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(disabledRes.statusCode).toBe(403);
    expect(state.committedTransactions).toBe(0);
    expect(state.rolledBackTransactions).toBe(1);
    expect(state.executedOperations).toBe(0);

    // Scenariusz B: przywrócenie aktywnego konta, ale cofnięcie grantu w oknie przed getLockedFacts w transakcji
    state.linkIdentity(ISSUER_TRUSTED, 'Sub-User-A', USER_A, true, true);
    state.onAfterResolveIdentity = () => {
      state.grants = state.grants.map((g) =>
        g.grantId === id(110) ? { ...g, revokedAt: NOW } : g,
      );
    };
    const revokedGrantRes = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: `/api/v1/test-authz/tenants/${TENANT_A}/entities/${ENTITY_A1}/probe-transactional-write`,
        headers: { authorization: `Bearer ${token}` },
      });
    expect(revokedGrantRes.statusCode).toBe(403);
    expect(state.committedTransactions).toBe(0);
    expect(state.rolledBackTransactions).toBe(2);
    expect(state.executedOperations).toBe(0);
  });
});
