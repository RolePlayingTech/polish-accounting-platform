import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql as statement } from 'drizzle-orm';
import { executeAuthorizedCompanyAction } from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { connectDatabase } from '../src/client.js';
import { applyMigrations } from '../src/migrations.js';
import { createPostgresSecurityServices } from '../src/runtime-security.js';
import {
  configureRuntimePrivileges,
  provisionDatabaseContextKey,
} from '../src/runtime-provisioning.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { recordCompanyOperationProbe } from '../src/company-operation-probe.js';
import { and, eq } from 'drizzle-orm';
import { companyOperationProbe } from '../src/schema.js';
import {
  createTestDatabase,
  expectDatabaseError,
  type TestDatabase,
} from './integration-database.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
const actor = userId(id(1)),
  tenantA = tenantId(id(2)),
  entityA = legalEntityId(id(3));
const tenantB = tenantId(id(4)),
  entityB = legalEntityId(id(5));
const runtimeRole = 'pap_test_app';

describe('6D-3A — rzeczywisty login runtime, ACL, podpis, RLS i pula', () => {
  let owner: TestDatabase;
  let runtime: ReturnType<typeof connectDatabase>;
  let services: Awaited<ReturnType<typeof createPostgresSecurityServices>>;
  let createdRole = false;
  let databasePublicPrivileges: string[] = [];
  let publicSchemaCreate = false;
  let replay: { payload: string; signature: string; pid: number };

  beforeAll(async () => {
    owner = await createTestDatabase();
    const { client: sql } = owner;
    // Wyłącznie dedykowany pap_test. Istniejącej roli nigdy nie przejmujemy ani nie zmieniamy.
    if ((await sql`SELECT 1 FROM pg_roles WHERE rolname = ${runtimeRole}`).length) {
      throw new Error('Test wymaga wolnej nazwy pap_test_app na odizolowanej instancji.');
    }
    databasePublicPrivileges = Array.from(
      await sql`SELECT privilege_type FROM pg_database,
      LATERAL aclexplode(coalesce(datacl, acldefault('d', datdba))) a
      WHERE datname = current_database() AND a.grantee = 0`,
      (r) => String(r.privilege_type),
    );
    publicSchemaCreate =
      (
        await sql`SELECT 1 FROM pg_namespace,
      LATERAL aclexplode(coalesce(nspacl, acldefault('n', nspowner))) a
      WHERE nspname = 'public' AND a.grantee = 0 AND a.privilege_type = 'CREATE'`
      ).length > 0;
    const password = randomBytes(24).toString('hex');
    // Utility CREATE ROLE nie obsługuje bind-parametru hasła; wartość jest własnym losowym hex.
    await sql.unsafe(`CREATE ROLE pap_test_app LOGIN PASSWORD '${password}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    createdRole = true;
    await applyMigrations(owner.db, owner.dataSchema);
    const keyHex = randomBytes(32).toString('hex');
    await provisionDatabaseContextKey(owner.db, { keyId: 'integration', keyHex, runtimeRole });
    await configureRuntimePrivileges(owner.db, runtimeRole);
    await sql`INSERT INTO tenant(id,name) VALUES (${tenantA},'Syntetyczny A'),(${tenantB},'Syntetyczny B')`;
    await sql`INSERT INTO legal_entity(id,tenant_id,display_name)
      VALUES (${entityA},${tenantA},'Firma A'),(${entityB},${tenantB},'Firma B')`;
    await sql`INSERT INTO legal_entity(id,tenant_id,display_name)
      VALUES (${id(9)},${tenantA},'Druga firma A')`;
    await sql`INSERT INTO app_user(id,status) VALUES (${actor},'active')`;
    await sql`INSERT INTO user_oidc_identity(id,user_id,issuer,subject,status)
      VALUES (${id(6)},${actor},'https://idp.example.test','synthetic-actor','active')`;
    await sql`INSERT INTO tenant_membership(tenant_id,user_id,role,status,valid_from)
      VALUES (${tenantA},${actor},'tenant_member','active','2026-01-01')`;
    await sql`INSERT INTO company_access_grant(grant_id,tenant_id,user_id,legal_entity_id,action,valid_from)
      VALUES (${id(7)},${tenantA},${actor},${entityA},'write','2026-01-01')`;
    await sql`INSERT INTO company_access_grant(grant_id,tenant_id,user_id,legal_entity_id,action,valid_from)
      VALUES (${id(10)},${tenantA},${actor},${id(9)},'write','2026-01-01')`;
    const url = new URL(process.env.DATABASE_URL!);
    url.username = runtimeRole;
    url.password = password;
    runtime = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: url.toString() },
      owner.dataSchema,
      { maxConnections: 1 },
    );
    services = await createPostgresSecurityServices(
      runtime.db,
      new PostgresContextSigner({ keyId: 'integration', keyHex }),
    );
  });

  afterAll(async () => {
    await runtime?.client.end({ timeout: 1 });
    if (createdRole) {
      await owner.client.unsafe('DROP OWNED BY pap_test_app');
      await owner.client.unsafe('DROP ROLE pap_test_app');
      for (const privilege of databasePublicPrivileges) {
        if (!['CONNECT', 'TEMPORARY', 'CREATE'].includes(privilege))
          throw new Error('Nieznany ACL bazy.');
        await owner.client.unsafe(`GRANT ${privilege} ON DATABASE pap_test TO PUBLIC`);
      }
      if (publicSchemaCreate) await owner.client.unsafe('GRANT CREATE ON SCHEMA public TO PUBLIC');
    }
    await owner?.cleanup();
  });

  it('bez kontekstu i po sfałszowaniu GUC nie ujawnia danych; SQL runtime nie daje DDL/bypass/audytu', async () => {
    const sql = runtime.client;
    expect(await sql`SELECT * FROM company_access_grant`).toHaveLength(0);
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('pap.current_tenant_id',${tenantA},true),
        set_config('pap.current_actor_user_id',${actor},true),
        set_config('pap.context','{}',true),
        set_config('pap.context_signature',${'0'.repeat(64)},true)`;
      expect(await tx`SELECT * FROM legal_entity`).toHaveLength(0);
      expect(await tx`SELECT pap_context() AS context`).toMatchObject([{ context: null }]);
    });
    for (const query of [
      'CREATE TABLE unauthorized_table(id int)',
      'CREATE TEMP TABLE unauthorized_temp(id int)',
      'TRUNCATE company_access_grant',
      'ALTER TABLE tenant_membership DISABLE TRIGGER ALL',
      'SET session_replication_role = replica',
      'SET ROLE pap_test',
      'SELECT * FROM security_context_key',
      'SELECT * FROM __drizzle_migrations',
      "UPDATE tenant_membership SET role = 'tenant_owner'",
      'DELETE FROM access_management_event',
    ])
      await expectDatabaseError(sql.unsafe(query), '42501');
    await expectDatabaseError(
      sql.begin(async (tx) => {
        await tx.unsafe('SET LOCAL row_security = off');
        await tx.unsafe('SELECT * FROM tenant');
      }),
      '42501',
    );
  });

  it('zapisuje idempotentną syntetyczną operację tylko w A; kontekst nie przechodzi do kolejnej TX', async () => {
    const operationId = randomUUID();
    const dependencies = {
      ...services,
      verifier: {
        verifyAccessToken: async () => ({
          ok: true as const,
          identity: { issuer: 'https://idp.example.test', subject: 'synthetic-actor' },
        }),
      },
    };
    const execute = () =>
      executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'synthetic-token',
          tenantId: tenantA,
          legalEntityId: entityA,
          action: 'write',
        },
        dependencies,
        async (context, tx) => {
          const [row] = await tx.tx.execute<{ payload: string; signature: string; pid: number }>(
            statement`SELECT current_setting('pap.context') AS payload,
          current_setting('pap.context_signature') AS signature, pg_backend_pid() AS pid`,
          );
          replay = row!;
          expect(
            await tx.tx.execute(statement`SELECT * FROM company_access_grant
        WHERE legal_entity_id = ${id(9)}`),
          ).toHaveLength(0);
          expect(
            await tx.tx.execute(statement`SELECT * FROM legal_entity WHERE tenant_id = ${tenantB}`),
          ).toHaveLength(0);
          return recordCompanyOperationProbe(context, tx, operationId);
        },
      );
    expect(await execute()).toMatchObject({ allowed: true, data: { created: true } });
    expect(await execute()).toMatchObject({ allowed: true, data: { created: false } });
    expect(await owner.client`SELECT * FROM company_operation_probe`).toHaveLength(1);
    expect(await runtime.client`SELECT * FROM company_operation_probe`).toHaveLength(0);
    await runtime.client.begin(async (tx) => {
      expect((await tx`SELECT pg_backend_pid() AS pid`)[0]?.pid).toBe(replay.pid);
      await tx`SELECT set_config('pap.context',${replay.payload},true),
        set_config('pap.context_signature',${replay.signature},true)`;
      expect(await tx`SELECT * FROM company_operation_probe`).toHaveLength(0);
    });
    expect(
      await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'synthetic-token',
          tenantId: tenantB,
          legalEntityId: entityB,
          action: 'write',
        },
        dependencies,
        async () => {
          throw new Error('Nie wolno wywołać');
        },
      ),
    ).toMatchObject({ allowed: false });
    await owner.client`UPDATE tenant_membership SET valid_until = clock_timestamp() - interval '1 second'
      WHERE tenant_id = ${tenantA} AND user_id = ${actor}`;
    expect(await execute()).toMatchObject({ allowed: false });
  });

  it('brak audytu na COMMIT i awaria jego INSERT wycofują zapis; rollback ma oddzielny ślad', async () => {
    await owner.client`UPDATE tenant_membership SET valid_until = NULL
      WHERE tenant_id = ${tenantA} AND user_id = ${actor}`;
    const omitted = randomUUID();
    await expectDatabaseError(
      services.unitOfWork.runCompanyActionInTransaction(
        async (tx) => {
          expect(await tx.verifyActorAccount({ userId: actor })).toBe(true);
          await tx.getLockedFacts({
            userId: actor,
            tenantId: tenantA,
            legalEntityId: entityA,
            action: 'write',
          });
          await tx.applySessionContext?.({
            actorUserId: actor,
            tenantId: tenantA,
            legalEntityId: entityA,
          });
          await tx.tx.insert(companyOperationProbe).values({
            operationId: omitted,
            tenantId: tenantA,
            legalEntityId: entityA,
            actorId: actor,
          });
          return true;
        },
        (result) => result,
      ),
      '23514',
    );
    expect(
      await owner.db
        .select()
        .from(companyOperationProbe)
        .where(eq(companyOperationProbe.operationId, omitted)),
    ).toHaveLength(0);

    await owner.client
      .unsafe(`CREATE FUNCTION reject_committed_audit() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN IF NEW.outcome = 'committed' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF;
      RETURN NEW; END $$`);
    await owner.client
      .unsafe(`CREATE TRIGGER reject_committed_audit BEFORE INSERT ON security_decision_event
      FOR EACH ROW EXECUTE FUNCTION reject_committed_audit()`);
    const requestId = randomUUID(),
      operationId = randomUUID();
    try {
      const result = await executeAuthorizedCompanyAction(
        {
          requestId,
          operationId,
          rawBearerToken: 'synthetic-token',
          tenantId: tenantA,
          legalEntityId: entityA,
          action: 'write',
        },
        {
          ...services,
          verifier: {
            verifyAccessToken: async () => ({
              ok: true as const,
              identity: { issuer: 'https://idp.example.test', subject: 'synthetic-actor' },
            }),
          },
        },
        (context, tx) => recordCompanyOperationProbe(context, tx, operationId),
      );
      expect(result).toMatchObject({ allowed: false, reason: 'authorization_audit_unavailable' });
      expect(
        await owner.db
          .select()
          .from(companyOperationProbe)
          .where(
            and(
              eq(companyOperationProbe.operationId, operationId),
              eq(companyOperationProbe.tenantId, tenantA),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await owner.client`SELECT decision, outcome, reason FROM security_decision_event
        WHERE request_id = ${requestId}`,
      ).toMatchObject([
        {
          decision: 'allow',
          outcome: 'rolled_back',
          reason: 'authorization_audit_unavailable',
        },
      ]);
    } finally {
      await owner.client.unsafe('DROP TRIGGER reject_committed_audit ON security_decision_event');
      await owner.client.unsafe('DROP FUNCTION reject_committed_audit()');
    }
    for (const query of [
      'UPDATE security_decision_event SET reason = reason',
      'DELETE FROM security_decision_event',
      'TRUNCATE security_decision_event',
    ]) {
      await expectDatabaseError(runtime.client.unsafe(query), '42501');
    }
    await expectDatabaseError(
      runtime.client.unsafe(`INSERT INTO security_decision_event
      (id,request_id,action,kind,decision,outcome,reason,decided_at) VALUES
      (gen_random_uuid(),gen_random_uuid(),'read','transport','deny','denied','transport_rejected',clock_timestamp())`),
      '42501',
    );
  });

  it('runtime obsługuje autoryzowany grant/revoke i oba powiązane audyty atomowo, z idempotencją', async () => {
    const target = userId(id(8));
    await owner.client`UPDATE tenant_membership SET role = 'tenant_owner'
      WHERE tenant_id = ${tenantA} AND user_id = ${actor}`;
    await owner.client`INSERT INTO tenant_membership(tenant_id,user_id,role,status,valid_from)
      VALUES (${tenantA},${target},'tenant_member','active','2026-01-01')`;
    const command = {
      kind: 'grant' as const,
      operationId: randomUUID(),
      tenantId: tenantA,
      userId: target,
      grantId: randomUUID(),
      legalEntityId: entityA,
      action: 'read' as const,
      validFrom: null,
      validUntil: null,
    };
    const store = services.accessManagementStore;
    const verified = {
      userId: actor,
      identity: { issuer: 'https://idp.example.test', subject: 'synthetic-actor' },
    };
    // Factory zwraca port; bezpośrednie execute również przechodzi przez wspólny use case.
    const first = await store.execute(command, verified);
    expect(first).toMatchObject({ ok: true });
    expect(await store.execute(command, verified)).toEqual(first);
    expect(
      await owner.client`SELECT 1 FROM access_management_event
      WHERE operation_id = ${command.operationId}`,
    ).toHaveLength(1);
    expect(
      await owner.client`SELECT 1 FROM security_decision_event
      WHERE access_management_operation_id = ${command.operationId} AND outcome = 'committed'`,
    ).toHaveLength(2);
    expect(
      await store.execute(
        {
          kind: 'revoke_grant',
          operationId: randomUUID(),
          tenantId: tenantA,
          userId: target,
          grantId: command.grantId,
        },
        verified,
      ),
    ).toMatchObject({ ok: true });
    expect(
      (
        await owner.client`SELECT revoked_at FROM company_access_grant
      WHERE grant_id = ${command.grantId}`
      )[0]?.revoked_at,
    ).not.toBeNull();
  });
});
