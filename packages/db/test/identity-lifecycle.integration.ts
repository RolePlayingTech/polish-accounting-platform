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
      `INSERT INTO pap_user_profile (user_id, display_name, email) VALUES ('${randomUUID()}', 'Atak', 'atak@syntetyczny.example')`,
      'DELETE FROM pap_identity_lifecycle_event',
      'TRUNCATE pap_user_profile',
      'TRUNCATE pap_identity_lifecycle_event',
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
    expect(dirAlpha.profile?.displayName).toBe('Anna Kolizja Pierwsza');
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
});
