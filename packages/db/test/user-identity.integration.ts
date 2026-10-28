import {
  authorizeAuthenticatedCompanyAction,
  createOidcAccessManagementActorSource,
  createTenantAccessManagementAuthorizer,
  manageAccess,
  type OidcAccessTokenVerifier,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  PostgresAccessManagementAuthorizationDataSource,
  PostgresAccessManagementStore,
} from '../src/access-management.js';
import { applyMigrations } from '../src/migrations.js';
import {
  appUser,
  companyAccessGrant,
  legalEntity,
  tenant,
  tenantMembership,
  userOidcIdentity,
} from '../src/schema.js';
import { PostgresTenantAuthorizationDataSource } from '../src/tenant-authorization.js';
import { PostgresUserIdentityResolver, PostgresUserIdentityStore } from '../src/user-identity.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

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
const ISSUER_1 = 'https://id.ksiegowosc.roleplayingtech.com/realms/pap';
const ISSUER_2 = 'https://other-idp.example.test/realms/pap';
const from = new Date('2026-01-01T00:00:00.000Z');

describe('6D-2 — tożsamość OIDC, mapowanie na userId i autoryzacja na PostgreSQL', () => {
  let database: TestDatabase | undefined;
  const connection = () => {
    if (!database) throw new Error('Brak testowej bazy PostgreSQL.');
    return database;
  };

  beforeAll(async () => {
    database = await createTestDatabase();
    await applyMigrations(database.db, database.dataSchema);
    await database.db.insert(tenant).values([
      { id: TENANT_A, name: 'Syntetyczny Tenant A' },
      { id: TENANT_B, name: 'Syntetyczny Tenant B' },
    ]);
    await database.db.insert(legalEntity).values([
      { id: ENTITY_A1, tenantId: TENANT_A, displayName: 'A1' },
      { id: ENTITY_A2, tenantId: TENANT_A, displayName: 'A2' },
      { id: ENTITY_B1, tenantId: TENANT_B, displayName: 'B1' },
    ]);
  });

  beforeEach(async () => {
    const { db, client: sql } = connection();
    await sql`TRUNCATE access_management_event`;
    await db.delete(companyAccessGrant);
    await db.delete(tenantMembership);
    await db.delete(userOidcIdentity);
    await db.delete(appUser);
  });

  afterAll(async () => {
    await database?.cleanup();
  });

  it('mapuje dokładnie parę (issuer, subject) na userId, rozróżnia wielkość liter i wystawców oraz egzekwuje UNIQUE', async () => {
    const { db, client: sql } = connection();
    const store = new PostgresUserIdentityStore(db);
    const resolver = new PostgresUserIdentityResolver(db);

    expect(
      await store.provisionUserWithOidcIdentity({
        userId: USER_A,
        identityId: id(101),
        issuer: ISSUER_1,
        subject: 'Sub-Shared-01',
      }),
    ).toEqual({ ok: true, userId: USER_A });

    // Ten sam subject u innego wystawcy należy do innego użytkownika wewnętrznego
    expect(
      await store.provisionUserWithOidcIdentity({
        userId: USER_B,
        identityId: id(102),
        issuer: ISSUER_2,
        subject: 'Sub-Shared-01',
      }),
    ).toEqual({ ok: true, userId: USER_B });

    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: 'Sub-Shared-01' }),
    ).toEqual({ userId: USER_A });
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_2, subject: 'Sub-Shared-01' }),
    ).toEqual({ userId: USER_B });

    // Wielkość liter w subject: 'sub-shared-01' nie pasuje do 'Sub-Shared-01'
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: 'sub-shared-01' }),
    ).toBeNull();

    // Duplikat tej samej pary (issuer, subject) jest odrzucany przez store i przez UNIQUE w PostgreSQL
    expect(
      await store.provisionUserWithOidcIdentity({
        userId: ADMIN_A,
        identityId: id(103),
        issuer: ISSUER_1,
        subject: 'Sub-Shared-01',
      }),
    ).toEqual({ ok: false, reason: 'identity_already_linked' });

    await expectDatabaseError(
      sql`INSERT INTO user_oidc_identity (id, user_id, issuer, subject, status, linked_at)
          VALUES (${id(104)}, ${USER_B}, ${ISSUER_1}, 'Sub-Shared-01', 'active', '2026-01-01T00:00:00.000Z')`,
      '23505',
      'user_oidc_identity_issuer_subject_unique',
    );
  });

  it('obsługuje wiele jawnie powiązanych tożsamości jednego użytkownika i blokuje dostęp po cofnięciu powiązania lub wyłączeniu konta', async () => {
    const { db, client: sql } = connection();
    const store = new PostgresUserIdentityStore(db);
    const resolver = new PostgresUserIdentityResolver(db);

    await store.provisionUserWithOidcIdentity({
      userId: USER_A,
      identityId: id(111),
      issuer: ISSUER_1,
      subject: 'user-a-legacy',
    });
    await store.linkAdditionalOidcIdentity({
      userId: USER_A,
      identityId: id(112),
      issuer: ISSUER_2,
      subject: 'user-a-migrated',
    });

    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: 'user-a-legacy' }),
    ).toEqual({ userId: USER_A });
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_2, subject: 'user-a-migrated' }),
    ).toEqual({ userId: USER_A });

    // Cofnięcie pierwszego powiązania blokuje tylko to powiązanie; drugie pozostaje aktywne
    expect(await store.revokeOidcIdentity({ userId: USER_A, identityId: id(111) })).toEqual({
      ok: true,
      userId: USER_A,
    });
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_1, subject: 'user-a-legacy' }),
    ).toBeNull();
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_2, subject: 'user-a-migrated' }),
    ).toEqual({ userId: USER_A });

    // Guard SQL nie pozwala na przywrócenie cofniętego powiązania ani przepisanie user_id
    await expectDatabaseError(
      sql`UPDATE user_oidc_identity SET status = 'active', revoked_at = NULL WHERE id = ${id(111)}`,
      '23514',
    );
    await expectDatabaseError(
      sql`UPDATE user_oidc_identity SET subject = 'tampered' WHERE id = ${id(112)}`,
      '23514',
    );

    // Wyłączenie konta blokuje wszystkie powiązania i nie pozwala dodać nowego
    expect(await store.disableUserAccount({ userId: USER_A })).toEqual({
      ok: true,
      userId: USER_A,
    });
    expect(
      await resolver.resolveVerifiedIdentity({ issuer: ISSUER_2, subject: 'user-a-migrated' }),
    ).toBeNull();
    expect(
      await store.linkAdditionalOidcIdentity({
        userId: USER_A,
        identityId: id(113),
        issuer: ISSUER_2,
        subject: 'user-a-attempt-after-disable',
      }),
    ).toEqual({ ok: false, reason: 'user_disabled' });
  });

  it('wykonuje pełny łańcuch OIDC -> internal userId -> autoryzacja firmy i administracja dostępem na PostgreSQL', async () => {
    const { db } = connection();
    const identityStore = new PostgresUserIdentityStore(db);
    const identityResolver = new PostgresUserIdentityResolver(db);
    const companyAuthSource = new PostgresTenantAuthorizationDataSource(db);
    const accessAdminAuthSource = new PostgresAccessManagementAuthorizationDataSource(db);
    const accessStore = new PostgresAccessManagementStore(db);

    await identityStore.provisionUserWithOidcIdentity({
      userId: OWNER_A,
      identityId: id(201),
      issuer: ISSUER_1,
      subject: 'owner-a-sub',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: ADMIN_A,
      identityId: id(202),
      issuer: ISSUER_1,
      subject: 'admin-a-sub',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: USER_A,
      identityId: id(203),
      issuer: ISSUER_1,
      subject: 'user-a-sub',
    });

    await db.insert(tenantMembership).values([
      {
        tenantId: TENANT_A,
        userId: OWNER_A,
        role: 'tenant_owner',
        status: 'active',
        validFrom: from,
      },
      {
        tenantId: TENANT_A,
        userId: ADMIN_A,
        role: 'tenant_admin',
        status: 'active',
        validFrom: from,
      },
      {
        tenantId: TENANT_A,
        userId: USER_A,
        role: 'tenant_member',
        status: 'active',
        validFrom: from,
      },
    ]);

    const verifierFor = (subject: string): OidcAccessTokenVerifier => ({
      verifyAccessToken: async (token) =>
        token === `token:${subject}`
          ? { ok: true, identity: { issuer: ISSUER_1, subject } }
          : { ok: false, reason: 'invalid_signature' },
    });

    // Owner nadaje adminowi grant read do A1 (owner nie może nadać sobie samemu!)
    const ownerSelfGrant = await manageAccess(
      {
        kind: 'grant',
        operationId: id(301),
        tenantId: TENANT_A,
        userId: OWNER_A,
        grantId: id(401),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      {
        store: accessStore,
        actors: createOidcAccessManagementActorSource('token:owner-a-sub', {
          verifier: verifierFor('owner-a-sub'),
          identityResolver,
        }),
        authorizer: createTenantAccessManagementAuthorizer(accessAdminAuthSource),
      },
    );
    expect(ownerSelfGrant).toEqual({ ok: false, reason: 'access_management_denied' });

    const ownerDelegatesToAdmin = await manageAccess(
      {
        kind: 'grant',
        operationId: id(302),
        tenantId: TENANT_A,
        userId: ADMIN_A,
        grantId: id(402),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      {
        store: accessStore,
        actors: createOidcAccessManagementActorSource('token:owner-a-sub', {
          verifier: verifierFor('owner-a-sub'),
          identityResolver,
        }),
        authorizer: createTenantAccessManagementAuthorizer(accessAdminAuthSource),
      },
    );
    expect(ownerDelegatesToAdmin).toMatchObject({ ok: true });

    // Admin deleguje posiadane read dla A1 członkowi USER_A, ale nie może nadać write ani grantu do A2
    const adminInvalidWriteDelegation = await manageAccess(
      {
        kind: 'grant',
        operationId: id(303),
        tenantId: TENANT_A,
        userId: USER_A,
        grantId: id(403),
        legalEntityId: ENTITY_A1,
        action: 'write',
        validFrom: null,
        validUntil: null,
      },
      {
        store: accessStore,
        actors: createOidcAccessManagementActorSource('token:admin-a-sub', {
          verifier: verifierFor('admin-a-sub'),
          identityResolver,
        }),
        authorizer: createTenantAccessManagementAuthorizer(accessAdminAuthSource),
      },
    );
    expect(adminInvalidWriteDelegation).toEqual({ ok: false, reason: 'access_management_denied' });

    const adminValidReadDelegation = await manageAccess(
      {
        kind: 'grant',
        operationId: id(304),
        tenantId: TENANT_A,
        userId: USER_A,
        grantId: id(404),
        legalEntityId: ENTITY_A1,
        action: 'read',
        validFrom: null,
        validUntil: null,
      },
      {
        store: accessStore,
        actors: createOidcAccessManagementActorSource('token:admin-a-sub', {
          verifier: verifierFor('admin-a-sub'),
          identityResolver,
        }),
        authorizer: createTenantAccessManagementAuthorizer(accessAdminAuthSource),
      },
    );
    expect(adminValidReadDelegation).toMatchObject({ ok: true });

    // USER_A może teraz wykonać read na A1 przez pełny łańcuch OIDC, ale nie write i nie A2/B1
    const allowReadA1 = await authorizeAuthenticatedCompanyAction(
      {
        rawBearerToken: 'token:user-a-sub',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      {
        verifier: verifierFor('user-a-sub'),
        identityResolver,
        authorizationDataSource: companyAuthSource,
      },
    );
    expect(allowReadA1).toMatchObject({
      allowed: true,
      status: 'allowed',
      reason: 'explicit_company_grant',
      context: { userId: USER_A, tenantId: TENANT_A, legalEntityId: ENTITY_A1, action: 'read' },
    });

    const denyWriteA1 = await authorizeAuthenticatedCompanyAction(
      {
        rawBearerToken: 'token:user-a-sub',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'write',
      },
      {
        verifier: verifierFor('user-a-sub'),
        identityResolver,
        authorizationDataSource: companyAuthSource,
      },
    );
    expect(denyWriteA1).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'explicit_company_grant_required',
    });

    // Wyłączenie konta USER_A natychmiast blokuje kolejne żądanie mimo ważnego tokenu i grantu
    await identityStore.disableUserAccount({ userId: USER_A });
    const denyDisabledUser = await authorizeAuthenticatedCompanyAction(
      {
        rawBearerToken: 'token:user-a-sub',
        tenantId: TENANT_A,
        legalEntityId: ENTITY_A1,
        action: 'read',
      },
      {
        verifier: verifierFor('user-a-sub'),
        identityResolver,
        authorizationDataSource: companyAuthSource,
      },
    );
    expect(denyDisabledUser).toEqual({
      allowed: false,
      status: 'forbidden',
      reason: 'identity_not_provisioned_or_disabled',
    });
  });
});
