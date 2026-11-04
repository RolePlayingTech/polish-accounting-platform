import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql as statement } from 'drizzle-orm';
import {
  ConfirmedTransactionRollbackError,
  executeAuthorizedCompanyAction,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { connectDatabase } from '../src/client.js';
import {
  createPostgresCompanyActionScope,
  recordCompanyOperationProbe,
  ScopeClosedError,
  type PostgresCompanyActionScope,
} from '../src/company-operation-probe.js';
import { applyMigrations } from '../src/migrations.js';
import {
  configureRuntimePrivileges,
  provisionDatabaseContextKey,
} from '../src/runtime-provisioning.js';
import {
  createPostgresSecurityServices,
  type PostgresSecurityServices,
} from '../src/runtime-security.js';
import { companyOperationProbe } from '../src/schema.js';
import { PostgresContextSigner } from '../src/signed-context.js';
import { applyLocalRlsSessionContext } from '../src/transaction-primitives.js';
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
const verifiedActor = {
  userId: actor,
  identity: { issuer: 'https://idp.example.test', subject: 'synthetic-actor' },
} as const;

describe('6D-3A — rzeczywisty login runtime, ACL, podpis, RLS, izolacja TScope i pula', () => {
  let owner: TestDatabase;
  let runtime: ReturnType<typeof connectDatabase>;
  let signer: PostgresContextSigner;
  let services: PostgresSecurityServices;
  let diagnosticServices: PostgresSecurityServices<
    PostgresCompanyActionScope & {
      inspectRlsSession(): Promise<{
        readonly binding: { payload: string; signature: string; pid: number };
        readonly siblingGrantCount: number;
        readonly crossTenantEntityCount: number;
      }>;
    }
  >;
  let createdRole = false;
  let databasePublicPrivileges: string[] = [];
  let publicSchemaCreate = false;
  let replay: { payload: string; signature: string; pid: number };

  beforeAll(async () => {
    owner = await createTestDatabase();
    const { client: sql } = owner;
    const preprovisionedRuntimeUrl = process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL?.trim();
    let runtimeUrl: string;

    if (preprovisionedRuntimeUrl) {
      // Tryb strict-migrator --bootstrap-runtime-role w efemerycznym kontenerze PG18 na Hetznerze
      runtimeUrl = preprovisionedRuntimeUrl;
    } else {
      // Tryb fixture: wyłącznie dedykowany pap_test; istniejącej roli nigdy nie przejmujemy ani nie zmieniamy.
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
      const url = new URL(process.env.DATABASE_URL!);
      url.username = runtimeRole;
      url.password = password;
      runtimeUrl = url.toString();
    }

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

    runtime = connectDatabase(
      { PAP_DATABASE_ENV: 'test', DATABASE_URL: runtimeUrl },
      owner.dataSchema,
      { maxConnections: 1 },
    );
    signer = new PostgresContextSigner({ keyId: 'integration', keyHex });
    services = await createPostgresSecurityServices(runtime.db, signer);
    diagnosticServices = await createPostgresSecurityServices(runtime.db, signer, (driver) => {
      const base = createPostgresCompanyActionScope(driver);
      return Object.freeze({
        ...base,
        async inspectRlsSession() {
          driver.assertActive();
          const [row] = await driver.tx.execute<{
            payload: string;
            signature: string;
            pid: number;
          }>(
            statement`SELECT current_setting('pap.context') AS payload,
              current_setting('pap.context_signature') AS signature, pg_backend_pid() AS pid`,
          );
          const siblingGrants = await driver.tx.execute(
            statement`SELECT * FROM company_access_grant WHERE legal_entity_id = ${id(9)}`,
          );
          const crossTenantEntities = await driver.tx.execute(
            statement`SELECT * FROM legal_entity WHERE tenant_id = ${tenantB}`,
          );
          return {
            binding: row!,
            siblingGrantCount: siblingGrants.length,
            crossTenantEntityCount: crossTenantEntities.length,
          };
        },
      });
    });
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

  it('bez kontekstu i po sfałszowaniu GUC nie ujawnia danych; SQL runtime nie daje DDL/bypass/audytu ani PUBLIC EXECUTE na pgcrypto', async () => {
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

    // P1-1 (H1): brak PUBLIC EXECUTE oraz brak EXECUTE dla roli runtime na funkcjach pgcrypto w schemacie danych
    const exposedPgcryptoFunctions = await owner.client`
      SELECT p.proname
      FROM pg_depend dep
      JOIN pg_extension ext ON ext.oid = dep.refobjid
      JOIN pg_proc p ON p.oid = dep.objid
      WHERE dep.classid = 'pg_proc'::regclass
        AND dep.refclassid = 'pg_extension'::regclass
        AND dep.deptype = 'e'
        AND ext.extname = 'pgcrypto'
        AND p.pronamespace = to_regnamespace(${owner.dataSchema})
        AND (
          has_function_privilege('public', p.oid, 'EXECUTE')
          OR has_function_privilege(${runtimeRole}, p.oid, 'EXECUTE')
        )
    `;
    expect(exposedPgcryptoFunctions).toHaveLength(0);
    await expectDatabaseError(sql.unsafe("SELECT hmac('a'::bytea, 'b'::bytea, 'sha256')"), '42501');
    const lockdownSchemas = await owner.client<
      { rolsuper: boolean; public_usage: boolean; runtime_usage: boolean }[]
    >`
      SELECT r.rolsuper,
             has_schema_privilege('public', n.oid, 'USAGE') AS public_usage,
             has_schema_privilege(${runtimeRole}, n.oid, 'USAGE') AS runtime_usage
      FROM pg_namespace n
      JOIN pg_roles r ON r.oid = n.nspowner
      WHERE n.nspname = 'pap_lockdown'
    `;
    if (lockdownSchemas.length > 0) {
      expect(lockdownSchemas[0]).toEqual({
        rolsuper: true,
        public_usage: false,
        runtime_usage: false,
      });
    }

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

  it('zapisuje idempotentną syntetyczną operację tylko w A przez izolowany TScope; kontekst nie przechodzi do kolejnej TX i uchwyt wygasa po callbacku', async () => {
    const operationId = randomUUID();
    let capturedDefaultScope: PostgresCompanyActionScope | undefined;

    const verifier = {
      verifyAccessToken: async () => ({
        ok: true as const,
        identity: { issuer: 'https://idp.example.test', subject: 'synthetic-actor' },
      }),
    };

    const executeDiagnostic = () =>
      executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'synthetic-token',
          operationId,
          tenantId: tenantA,
          legalEntityId: entityA,
          action: 'write',
        },
        { ...diagnosticServices, verifier },
        async (context, scope) => {
          const inspection = await scope.inspectRlsSession();
          replay = inspection.binding;
          expect(inspection.siblingGrantCount).toBe(0);
          expect(inspection.crossTenantEntityCount).toBe(0);
          return recordCompanyOperationProbe(context, scope, operationId);
        },
      );

    expect(await executeDiagnostic()).toMatchObject({ allowed: true, data: { created: true } });

    // Domyślny services.unitOfWork przekazuje wyłącznie zamrożony uchwyt PostgresCompanyActionScope (NEG-SEC04-01/02)
    expect(
      await executeAuthorizedCompanyAction(
        {
          rawBearerToken: 'synthetic-token',
          operationId,
          tenantId: tenantA,
          legalEntityId: entityA,
          action: 'write',
        },
        { ...services, verifier },
        async (context, scope) => {
          capturedDefaultScope = scope;
          expect(Object.isFrozen(scope)).toBe(true);
          expect(Object.keys(scope)).toEqual(['recordOperationProbe']);
          expect(scope).not.toHaveProperty('tx');
          expect(scope).not.toHaveProperty('recordAuthorizationDecision');
          return recordCompanyOperationProbe(context, scope, operationId);
        },
      ),
    ).toMatchObject({ allowed: true, data: { created: false } });

    // NEG-SEC04-02: użycie zachowanego uchwytu po wyjściu z operation rzuca ScopeClosedError
    await expect(capturedDefaultScope!.recordOperationProbe()).rejects.toBeInstanceOf(
      ScopeClosedError,
    );

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
          operationId,
          tenantId: tenantB,
          legalEntityId: entityB,
          action: 'write',
        },
        { ...services, verifier },
        async () => {
          throw new Error('Nie wolno wywołać');
        },
      ),
    ).toMatchObject({ allowed: false });
    await owner.client`UPDATE tenant_membership SET valid_until = clock_timestamp() - interval '1 second'
      WHERE tenant_id = ${tenantA} AND user_id = ${actor}`;
    expect(await executeDiagnostic()).toMatchObject({ allowed: false });
  });

  it('brak audytu w UnitOfWork (NEG-SEC04-04), surowy COMMIT bez audytu (23514) i awaria INSERT audytu wycofują zapis; rollback ma oddzielny ślad', async () => {
    await owner.client`UPDATE tenant_membership SET valid_until = NULL
      WHERE tenant_id = ${tenantA} AND user_id = ${actor}`;

    // 1) NEG-SEC04-04: bezpośrednie wywołanie runCompanyActionInTransaction bez recordAuthorizationDecision wycofuje TX (także przed 23514)
    const omittedInUow = randomUUID();
    await expect(
      services.unitOfWork.runCompanyActionInTransaction(
        async (session) => {
          expect(await session.verifyActorAccount(verifiedActor)).toBe(true);
          const facts = await session.getLockedFacts({
            userId: actor,
            tenantId: tenantA,
            legalEntityId: entityA,
            action: 'write',
          });
          const scope = await session.enterAuthorizedCompanyScope({
            operationId: omittedInUow,
            decisionAt: facts.now.toISOString(),
            actorUserId: actor,
            tenantId: tenantA,
            legalEntityId: entityA,
            action: 'write',
          });
          await scope.recordOperationProbe(omittedInUow);
          return true;
        },
        (result) => result,
      ),
    ).rejects.toBeInstanceOf(ConfirmedTransactionRollbackError);
    expect(
      await owner.db
        .select()
        .from(companyOperationProbe)
        .where(eq(companyOperationProbe.operationId, omittedInUow)),
    ).toHaveLength(0);

    // 2) Obrona w głąb SQL: bezpośrednia transakcja z podpisanym kontekstem bez wpisu w security_decision_event jest blokowana przez odroczony trigger 23514
    const omittedRaw = randomUUID();
    const rawDecisionAt = new Date().toISOString();
    await expectDatabaseError(
      runtime.db.transaction(async (tx) => {
        await signer.apply(tx, {
          purpose: 'company',
          actorUserId: actor,
          tenantId: tenantA,
          legalEntityId: entityA,
          action: 'write',
          operationId: omittedRaw,
          decisionAt: rawDecisionAt,
        });
        await applyLocalRlsSessionContext(tx, {
          operationId: omittedRaw,
          decisionAt: rawDecisionAt,
          actorUserId: actor,
          tenantId: tenantA,
          legalEntityId: entityA,
        });
        await tx.insert(companyOperationProbe).values({
          operationId: omittedRaw,
          tenantId: tenantA,
          legalEntityId: entityA,
          actorId: actor,
          createdAt: new Date(rawDecisionAt),
        });
      }),
      '23514',
    );
    expect(
      await owner.db
        .select()
        .from(companyOperationProbe)
        .where(eq(companyOperationProbe.operationId, omittedRaw)),
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
        (context, scope) => recordCompanyOperationProbe(context, scope, operationId),
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
    // Factory zwraca port; bezpośrednie execute również przechodzi przez wspólny use case.
    const first = await store.execute(command, verifiedActor);
    expect(first).toMatchObject({ ok: true });
    expect(await store.execute(command, verifiedActor)).toEqual(first);
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
        verifiedActor,
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
