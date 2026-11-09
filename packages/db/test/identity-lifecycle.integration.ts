import { randomBytes, randomUUID } from 'node:crypto';
import { tenantId, userId } from '@pap/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase } from '../src/client.js';
import { PostgresIdentityLifecycleStore } from '../src/identity-lifecycle.js';
import { applyMigrations } from '../src/migrations.js';
import {
  configureRuntimePrivileges,
  provisionDatabaseContextKey,
} from '../src/runtime-provisioning.js';
import { assertRuntimeDatabaseSecurity } from '../src/runtime-security.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { PostgresUserIdentityStore } from '../src/user-identity.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const ISSUER = 'https://idp.syntetyczny.example/realms/pap';
const runtimeRole = 'pap_test_app' as const;

describe('Wave 2 Slice 3 — PostgresIdentityLifecycleStore (FORCE RLS, jednorazowy bootstrap z wyścigiem 10x, niezmienność audytu, brak łączenia po e-mailu i katalog wielotenantowy)', () => {
  let owner: TestDatabase;
  let runtimeConnA: ReturnType<typeof connectDatabase>;
  let runtimeConnB: ReturnType<typeof connectDatabase>;
  let signer: PostgresContextSigner;
  let storeA: PostgresIdentityLifecycleStore;
  let storeB: PostgresIdentityLifecycleStore;
  let identityStore: PostgresUserIdentityStore;
  let createdRole = false;
  let databasePublicPrivileges: string[] = [];
  let publicSchemaCreate = false;

  beforeAll(async () => {
    owner = await createTestDatabase();
    const { client: sqlClient } = owner;
    const preprovisionedRuntimeUrl = process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL?.trim();
    let runtimeUrl: string;

    if (preprovisionedRuntimeUrl) {
      runtimeUrl = preprovisionedRuntimeUrl;
    } else {
      if ((await sqlClient`SELECT 1 FROM pg_roles WHERE rolname = ${runtimeRole}`).length) {
        throw new Error('Test wymaga wolnej nazwy pap_test_app na odizolowanej instancji.');
      }
      databasePublicPrivileges = Array.from(
        await sqlClient`SELECT privilege_type FROM pg_database,
        LATERAL aclexplode(coalesce(datacl, acldefault('d', datdba))) a
        WHERE datname = current_database() AND a.grantee = 0`,
        (r) => String(r.privilege_type),
      );
      publicSchemaCreate =
        (
          await sqlClient`SELECT 1 FROM pg_namespace,
        LATERAL aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a
        WHERE nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`
        ).length > 0;
      const password = randomBytes(24).toString('hex');
      await sqlClient.unsafe(`CREATE ROLE pap_test_app LOGIN PASSWORD '${password}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      createdRole = true;
      const url = new URL(process.env.DATABASE_URL!);
      url.username = runtimeRole;
      url.password = password;
      runtimeUrl = url.toString();
    }

    await applyMigrations(owner.db, owner.dataSchema);
    const keyHex = randomBytes(32).toString('hex');
    await provisionDatabaseContextKey(owner.db, {
      keyId: 'wave2-identity-test',
      keyHex,
      runtimeRole,
    });
    await configureRuntimePrivileges(owner.db, runtimeRole);

    identityStore = new PostgresUserIdentityStore(owner.db);

    runtimeConnA = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 6 },
    );
    runtimeConnB = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 6 },
    );

    await assertRuntimeDatabaseSecurity(runtimeConnA.db);
    signer = new PostgresContextSigner({ keyId: 'wave2-identity-test', keyHex });
    storeA = new PostgresIdentityLifecycleStore(runtimeConnA.db, signer);
    storeB = new PostgresIdentityLifecycleStore(runtimeConnB.db, signer);
  });

  afterAll(async () => {
    await runtimeConnA?.client.end({ timeout: 1 });
    await runtimeConnB?.client.end({ timeout: 1 });
    if (createdRole) {
      await owner.client.unsafe('DROP OWNED BY pap_test_app');
      await owner.client.unsafe('DROP ROLE pap_test_app');
      for (const privilege of databasePublicPrivileges) {
        if (!['CONNECT', 'TEMPORARY', 'CREATE'].includes(privilege)) {
          throw new Error('Nieznany ACL bazy.');
        }
        await owner.client.unsafe(`GRANT ${privilege} ON DATABASE pap_test TO PUBLIC`);
      }
      if (publicSchemaCreate) {
        await owner.client.unsafe('GRANT CREATE ON SCHEMA public TO PUBLIC');
      }
    }
    await owner?.cleanup();
  });

  it('blokuje bezpośredni dostęp SQL roli runtime do pap_user_profile i pap_identity_lifecycle_event oraz sfałszowany podpis kontekstu (42501)', async () => {
    const rtSql = runtimeConnA.client;
    for (const stmt of [
      'SELECT * FROM pap_user_profile',
      'SELECT * FROM pap_identity_lifecycle_event',
      'SELECT * FROM pap_tenant_invitation',
      `INSERT INTO pap_user_profile (user_id, display_name, email) VALUES ('${randomUUID()}', 'Atak', 'atak@syntetyczny.example')`,
      `INSERT INTO pap_tenant_invitation (id, operation_id, tenant_id, token_sha256, invitee_email, intended_role, invited_by_user_id, reason, expires_at) VALUES ('${randomUUID()}', '${randomUUID()}', '${randomUUID()}', '${'a'.repeat(64)}', 'atak@syntetyczny.example', 'tenant_member', '${randomUUID()}', 'atak', now() + interval '1 hour')`,
      'DELETE FROM pap_identity_lifecycle_event',
      'DELETE FROM pap_tenant_invitation',
      'TRUNCATE pap_user_profile',
      'TRUNCATE pap_identity_lifecycle_event',
      'TRUNCATE pap_tenant_invitation',
    ]) {
      await expectDatabaseError(rtSql.unsafe(stmt), '42501');
    }

    const forgedCmd = JSON.stringify({
      kind: 'get_actor_session_directory',
      userId: randomUUID(),
    });

    await expectDatabaseError(
      runtimeConnA.db.transaction(async (tx) => {
        const [binding] = await tx.execute<{
          xid: string;
          pid: number;
          database: string;
          role: string;
          expires: string;
        }>(sql`SELECT pg_current_xact_id()::text AS xid, pg_backend_pid() AS pid,
          current_database() AS database, session_user::text AS role,
          (extract(epoch FROM clock_timestamp()) * 1000 + 30000)::bigint::text AS expires`);
        const forgedCtx = JSON.stringify({
          version: 1,
          key_id: 'wave2-identity-test',
          ...binding,
          purpose: 'identity_lifecycle',
          command: JSON.parse(forgedCmd),
        });
        await tx.execute(
          sql`SELECT set_config('pap.context', ${forgedCtx}, true), set_config('pap.context_signature', ${'0'.repeat(64)}, true)`,
        );
        await tx.execute(sql`SELECT pap_wave2_identity_op(${forgedCmd}::jsonb)`);
      }),
      '42501',
    );

    // Zgodny podpis dla innego purpose ('bff_session') jest odrzucany przez pap_wave2_identity_op
    await expectDatabaseError(
      runtimeConnA.db.transaction(async (tx) => {
        await signer.apply(tx, {
          purpose: 'bff_session',
          command: JSON.parse(forgedCmd),
        });
        await tx.execute(sql`SELECT pap_wave2_identity_op(${forgedCmd}::jsonb)`);
      }),
      '42501',
    );
  });

  it('rozstrzyga 10-krotny współbieżny wyścig bootstrapInitialOwner (dokładnie 1 wygrywa, 9 kończy się owner_already_bootstrapped) i obsługuje idempotentny replay', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, idx) => {
        const targetStore = idx % 2 === 0 ? storeA : storeB;
        return targetStore.bootstrapInitialOwner({
          operationId: randomUUID(),
          issuer: ISSUER,
          subject: `concurrent-owner-sub-${String(idx)}`,
          displayName: `Kandydat Właściciela ${String(idx)}`,
          email: `kandydat-${String(idx)}@syntetyczny.example`,
          tenantName: `Organizacja Startowa ${String(idx)}`,
          reason: 'Współbieżny test wyścigu jednorazowego bootstrapu właściciela',
        });
      }),
    );

    const winners = results.filter(
      (r): r is Extract<typeof r, { readonly ok: true }> => r.ok === true,
    );
    const losers = results.filter(
      (r): r is Extract<typeof r, { readonly ok: false }> => r.ok === false,
    );

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);
    for (const loser of losers) {
      expect(loser.reason).toBe('owner_already_bootstrapped');
    }

    const winner = winners[0]!;
    expect(winner.idempotentReplay).toBe(false);
    expect(winner.receipt.role).toBe('tenant_owner');

    // Idempotentny replay tego samego operationId zwraca ten sam receipt bez duplikacji wierszy
    const winnerIndex = Number(winner.receipt.subject.replace('concurrent-owner-sub-', ''));
    const replay = await storeB.bootstrapInitialOwner({
      operationId: winner.receipt.operationId,
      issuer: ISSUER,
      subject: winner.receipt.subject,
      displayName: `Kandydat Właściciela ${String(winnerIndex)}`,
      email: winner.receipt.email,
      tenantName: winner.receipt.tenantName,
      reason: 'Współbieżny test wyścigu jednorazowego bootstrapu właściciela',
    });
    expect(replay).toEqual({
      ok: true,
      idempotentReplay: true,
      receipt: winner.receipt,
    });

    // Konflikt parametrów pod tym samym operationId zwraca operation_conflict
    const conflict = await storeA.bootstrapInitialOwner({
      operationId: winner.receipt.operationId,
      issuer: ISSUER,
      subject: winner.receipt.subject,
      displayName: 'Zmieniona Nazwa Konfliktowa',
      email: winner.receipt.email,
      tenantName: winner.receipt.tenantName,
      reason: 'Współbieżny test wyścigu jednorazowego bootstrapu właściciela',
    });
    expect(conflict).toEqual({
      ok: false,
      reason: 'operation_conflict',
    });

    // Trigger append-only blokuje UPDATE oraz DELETE na pap_identity_lifecycle_event nawet dla właściciela schematu (ERRCODE 23514)
    await expectDatabaseError(
      owner.client`UPDATE pap_identity_lifecycle_event SET reason = 'manipulacja' WHERE operation_id = ${winner.receipt.operationId}::uuid`,
      '23514',
    );
    await expectDatabaseError(
      owner.client`DELETE FROM pap_identity_lifecycle_event WHERE operation_id = ${winner.receipt.operationId}::uuid`,
      '23514',
    );

    // Nawet po późniejszym wyłączeniu konta pierwotnego właściciela jednorazowy bootstrap pozostaje trwale zablokowany (P1-1)
    await identityStore.disableUserAccount({ userId: userId(winner.receipt.userId) });
    const afterOwnerDisabled = await storeB.bootstrapInitialOwner({
      operationId: randomUUID(),
      issuer: ISSUER,
      subject: 'nowy-kandydat-po-wylaczeniu-wlasciciela',
      displayName: 'Próba Re-bootstrapu',
      email: 'rebootstrap@syntetyczny.example',
      tenantName: 'Nowa Organizacja Po Blokadzie',
      reason: 'Próba ponownego bootstrapu po wyłączeniu pierwszego właściciela',
    });
    expect(afterOwnerDisabled).toEqual({
      ok: false,
      reason: 'owner_already_bootstrapped',
    });
  });

  it('nie łączy tożsamości po kolizji adresu e-mail i zwraca pełny katalog wielotenantowy z filtracją wygasłych/odwołanych członkostw', async () => {
    const sharedEmail = 'wspolny.adres@syntetyczny.example';
    const userAlpha = userId(randomUUID());
    const userBeta = userId(randomUUID());
    const tenantTwo = tenantId(randomUUID());
    const tenantThree = tenantId(randomUUID());
    const tenantExpired = tenantId(randomUUID());

    await identityStore.provisionUserWithOidcIdentity({
      userId: userAlpha,
      identityId: randomUUID(),
      issuer: ISSUER,
      subject: 'oidc-sub-alpha',
    });
    await identityStore.provisionUserWithOidcIdentity({
      userId: userBeta,
      identityId: randomUUID(),
      issuer: 'https://drugi-idp.syntetyczny.example/realms/zewnetrzny',
      subject: 'oidc-sub-beta',
    });

    const profAlpha = await storeA.upsertUserProfile({
      userId: userAlpha,
      displayName: 'Anna Kolizja Pierwsza',
      email: sharedEmail,
    });
    const profBeta = await storeB.upsertUserProfile({
      userId: userBeta,
      displayName: 'Anna Kolizja Druga',
      email: sharedEmail,
    });

    expect(profAlpha?.userId).toBe(userAlpha);
    expect(profBeta?.userId).toBe(userBeta);
    expect(userAlpha).not.toBe(userBeta);

    // Próba nadpisania prawdziwego e-maila syntetycznym placeholderem '*.invalid' zachowuje dotychczasowy adres e-mail (P1-3)
    const afterInvalidPlaceholder = await storeA.upsertUserProfile({
      userId: userAlpha,
      displayName: 'Anna Kolizja Pierwsza Zaktualizowana',
      email: 'brak-adresu@oidc.invalid',
    });
    expect(afterInvalidPlaceholder?.email).toBe(sharedEmail);
    expect(afterInvalidPlaceholder?.displayName).toBe('Anna Kolizja Pierwsza Zaktualizowana');

    // Dodajemy dwie aktywne organizacje oraz jedną wygasłą dla userAlpha, zero dla userBeta
    const baseNow = new Date('2026-11-09T14:00:00.000Z');
    await owner.client`INSERT INTO tenant (id, name, created_at) VALUES (${tenantTwo}, 'Kancelaria Druga Sp. z o.o.', '2026-01-10T00:00:00Z')`;
    await owner.client`INSERT INTO tenant (id, name, created_at) VALUES (${tenantThree}, 'Biuro Trzecie Partnerzy', '2026-02-10T00:00:00Z')`;
    await owner.client`INSERT INTO tenant (id, name, created_at) VALUES (${tenantExpired}, 'Organizacja Wygasła', '2026-03-10T00:00:00Z')`;

    await owner.client`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (${tenantTwo}, ${userAlpha}, 'tenant_admin', 'active', '2026-01-10T00:00:00Z', NULL)`;
    await owner.client`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (${tenantThree}, ${userAlpha}, 'tenant_member', 'active', '2026-02-10T00:00:00Z', NULL)`;
    await owner.client`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (${tenantExpired}, ${userAlpha}, 'tenant_member', 'active', '2026-03-10T00:00:00Z', '2026-06-01T00:00:00Z')`;

    const dirAlpha = await storeB.getActorSessionDirectory(userAlpha, baseNow);
    expect(dirAlpha.ok).toBe(true);
    if (!dirAlpha.ok) {
      throw new Error('Oczekiwano aktywnego katalogu dla userAlpha.');
    }
    expect(dirAlpha.profile?.displayName).toBe('Anna Kolizja Pierwsza Zaktualizowana');
    expect(dirAlpha.memberships).toEqual([
      expect.objectContaining({
        tenantId: tenantTwo,
        tenantName: 'Kancelaria Druga Sp. z o.o.',
        role: 'tenant_admin',
        status: 'active',
      }),
      expect.objectContaining({
        tenantId: tenantThree,
        tenantName: 'Biuro Trzecie Partnerzy',
        role: 'tenant_member',
        status: 'active',
      }),
      expect.objectContaining({
        tenantId: tenantExpired,
        tenantName: 'Organizacja Wygasła',
        role: 'tenant_member',
        status: 'revoked',
      }),
    ]);

    // userBeta o tym samym adresie e-mail NIE dziedziczy żadnych członkostw userAlpha!
    const dirBeta = await storeA.getActorSessionDirectory(userBeta, baseNow);
    expect(dirBeta).toEqual({
      ok: true,
      userId: userBeta,
      profile: expect.objectContaining({
        userId: userBeta,
        displayName: 'Anna Kolizja Druga',
        email: sharedEmail,
      }),
      memberships: [],
    });

    // Zablokowanie konta natychmiast odcina getActorSessionDirectory oraz upsertUserProfile
    await identityStore.disableUserAccount({ userId: userAlpha });
    expect(await storeA.getActorSessionDirectory(userAlpha, baseNow)).toEqual({
      ok: false,
      reason: 'user_inactive_or_missing',
    });
    expect(
      await storeB.upsertUserProfile({
        userId: userAlpha,
        displayName: 'Próba Po Blokadzie',
        email: sharedEmail,
      }),
    ).toBeNull();
  });

  it('Wave 2 Slice 4 — rozstrzyga 10-krotny współbieżny wyścig akceptacji single-use zaproszenia (dokładnie 1 wygrywa, zero wycieku app_user u 9 przegranych) i wycofuje transakcję przy TOCTOU utracie grantu zapraszającego', async () => {
    const invOwnerId = userId(randomUUID());
    const invTenantId = tenantId(randomUUID());
    const invEntityId = randomUUID();

    await identityStore.provisionUserWithOidcIdentity({
      userId: invOwnerId,
      identityId: randomUUID(),
      issuer: ISSUER,
      subject: 's4-pg-owner',
    });
    await storeA.upsertUserProfile({
      userId: invOwnerId,
      displayName: 'Właściciel Testu Wyścigu',
      email: 'wlasciciel.wyscig@syntetyczny.example',
    });

    await owner.client`INSERT INTO tenant (id, name, created_at) VALUES (${invTenantId}, 'Organizacja Wyścigu Zaproszeń', now() - interval '1 day')`;
    await owner.client`INSERT INTO legal_entity (id, tenant_id, display_name, created_at) VALUES (${invEntityId}, ${invTenantId}, 'Spółka Docelowa Grantu', now() - interval '1 day')`;
    await owner.client`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (${invTenantId}, ${invOwnerId}, 'tenant_owner', 'active', now() - interval '1 day', NULL)`;

    const raceTokenSha256 = randomBytes(32).toString('hex');
    const createdInv = await storeA.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: invOwnerId,
      tenantId: invTenantId,
      tokenSha256: raceTokenSha256,
      inviteeEmail: 'wyscig.kandydat@syntetyczny.example',
      intendedRole: 'tenant_member',
      initialCompanyGrants: [
        {
          legalEntityId: invEntityId,
          actions: ['read', 'write'],
        },
      ],
      reason: 'Współbieżny test 10x single-use akceptacji zaproszenia',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(createdInv.ok).toBe(true);

    const raceResults = await Promise.all(
      Array.from({ length: 10 }, (_, idx) => {
        const targetStore = idx % 2 === 0 ? storeA : storeB;
        return targetStore.acceptTenantInvitation({
          operationId: randomUUID(),
          tokenSha256: raceTokenSha256,
          issuer: ISSUER,
          subject: `s4-race-accept-sub-${String(idx)}`,
          displayName: `Uczestnik Wyścigu ${String(idx)}`,
          email: `uczestnik-${String(idx)}@syntetyczny.example`,
        });
      }),
    );

    const raceWinners = raceResults.filter(
      (r): r is Extract<typeof r, { readonly ok: true }> => r.ok === true,
    );
    const raceLosers = raceResults.filter(
      (r): r is Extract<typeof r, { readonly ok: false }> => r.ok === false,
    );

    expect(raceWinners).toHaveLength(1);
    expect(raceLosers).toHaveLength(9);
    for (const loser of raceLosers) {
      expect(loser.reason).toBe('invitation_already_used');
    }

    // Wyłącznie zwycięzca wyścigu otrzymał rekord user_oidc_identity, członkostwo oraz 2 granty (read + write)
    const provisionedRaceIdentities = await owner.client<{ readonly subject: string }[]>`
      SELECT subject FROM user_oidc_identity WHERE subject LIKE 's4-race-accept-sub-%'
    `;
    expect(provisionedRaceIdentities).toHaveLength(1);

    const winnerGrants = await owner.client<{ readonly action: string }[]>`
      SELECT action FROM company_access_grant
      WHERE tenant_id = ${invTenantId}::uuid AND user_id = ${raceWinners[0]!.userId}::uuid
      ORDER BY action ASC
    `;
    expect(winnerGrants.map((g) => g.action)).toEqual(['read', 'write']);

    // Test atomowego wycofania TOCTOU: tenant_admin wystawia zaproszenie z grantem, traci grant przed akceptacją -> pełny ROLLBACK
    const adminId = userId(randomUUID());
    await identityStore.provisionUserWithOidcIdentity({
      userId: adminId,
      identityId: randomUUID(),
      issuer: ISSUER,
      subject: 's4-pg-admin-toctou',
    });
    await owner.client`INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from, valid_until)
      VALUES (${invTenantId}, ${adminId}, 'tenant_admin', 'active', now() - interval '1 hour', NULL)`;
    const adminGrantId = randomUUID();
    await owner.client`INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from, valid_until, revoked_at)
      VALUES (${adminGrantId}, ${invTenantId}, ${adminId}, ${invEntityId}, 'read', now() - interval '1 hour', NULL, NULL)`;

    const toctouTokenSha256 = randomBytes(32).toString('hex');
    const adminInv = await storeA.createTenantInvitation({
      operationId: randomUUID(),
      actorUserId: adminId,
      tenantId: invTenantId,
      tokenSha256: toctouTokenSha256,
      inviteeEmail: 'toctou.invitee@syntetyczny.example',
      intendedRole: 'tenant_member',
      initialCompanyGrants: [{ legalEntityId: invEntityId, actions: ['read'] }],
      reason: 'Zaproszenie przed cofnięciem grantu administratora',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    expect(adminInv.ok).toBe(true);

    // Cofnięcie grantu administratora przed akceptacją
    await owner.client`UPDATE company_access_grant SET revoked_at = clock_timestamp() WHERE grant_id = ${adminGrantId}::uuid`;

    const toctouAccept = await storeB.acceptTenantInvitation({
      operationId: randomUUID(),
      tokenSha256: toctouTokenSha256,
      issuer: ISSUER,
      subject: 's4-pg-toctou-invitee',
      displayName: 'Niedoszły Członek TOCTOU',
      email: 'toctou.invitee@syntetyczny.example',
    });
    expect(toctouAccept).toEqual({
      ok: false,
      reason: 'inviter_authority_revoked',
    });

    const toctouInviteeRows = await owner.client<{ readonly cnt: string }[]>`
      SELECT count(*)::text AS cnt FROM user_oidc_identity WHERE subject = 's4-pg-toctou-invitee'
    `;
    expect(toctouInviteeRows[0]!.cnt).toBe('0');

    const toctouInvStatus = await owner.client<{ readonly status: string }[]>`
      SELECT status FROM pap_tenant_invitation WHERE token_sha256 = ${toctouTokenSha256}
    `;
    expect(toctouInvStatus[0]!.status).toBe('pending');
  });
});
