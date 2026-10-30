import { sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import { PostgresContextSigner } from './signed-context.js';
import { PostgresTransactionalUnitOfWork } from './transactional-unit-of-work.js';
import { PostgresUserIdentityResolver } from './user-identity.js';
import { PostgresTenantAuthorizationDataSource } from './tenant-authorization.js';
import { PostgresSecurityAudit } from './security-audit.js';

type Database = ReturnType<typeof connectDatabase>['db'];

/** Kontrola rzeczywistych ACL/katalogów, niezależna od samej nazwy w DATABASE_URL. */
export async function assertRuntimeDatabaseSecurity(db: Pick<Database, 'execute'>): Promise<void> {
  // Brak 0006 albo stare ACL mają zatrzymać kompozycję przed utworzeniem usług.
  const [protocol] = await db.execute<{ version: number }>(
    sql`SELECT pap_security_protocol_version() AS version`,
  );
  if (protocol?.version !== 60301) throw new Error('Niezgodna wersja protokołu bezpieczeństwa DB.');
  const [state] = await db.execute<{ safe: boolean }>(sql`SELECT (
    current_user = session_user AND
    NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication) AND
    NOT has_parameter_privilege('session_replication_role', 'SET') AND
    NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AND
    NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = r.oid) AND
    NOT has_database_privilege(current_database(), 'CREATE,TEMP') AND
    NOT has_schema_privilege(current_schema(), 'CREATE') AND
    NOT has_schema_privilege('public', 'CREATE') AND
    NOT has_table_privilege('security_context_key', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('security_context_key', 'SELECT,INSERT,UPDATE,REFERENCES') AND
    NOT has_table_privilege('security_decision_event', 'SELECT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('security_decision_event', 'SELECT,UPDATE,REFERENCES') AND
    NOT has_any_column_privilege('access_management_event', 'INSERT,UPDATE') AND
    NOT has_table_privilege('access_management_event', 'DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('company_access_grant', 'INSERT') AND
    NOT has_column_privilege('company_access_grant', 'revoked_at', 'UPDATE') AND
    NOT has_column_privilege('tenant_membership', 'status', 'UPDATE') AND
    NOT has_column_privilege('tenant_membership', 'valid_from', 'UPDATE') AND
    NOT has_column_privilege('tenant_membership', 'valid_until', 'UPDATE') AND
    has_function_privilege('pap_execute_access()', 'EXECUTE') AND
    (SELECT count(*) = 11 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid)
      FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace
        AND c.relname IN ('tenant','legal_entity','tenant_membership','entity_profile_version',
          'company_access_grant','access_management_event','app_user','user_oidc_identity',
          'security_context_key','company_operation_probe','security_decision_event')) AND
    NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = current_schema()::regnamespace AND p.proowner = r.oid)
    ) AS safe FROM pg_roles r WHERE r.rolname = current_user`);
  if (state?.safe !== true)
    throw new Error('Niespełniony kontrakt bezpieczeństwa roli runtime DB.');
}

/** Jedno miejsce kompozycji dla przyszłego API i adaptera MCP. Bez otwierania endpointów. */
export async function createPostgresSecurityServices(db: Database, signer: PostgresContextSigner) {
  await assertRuntimeDatabaseSecurity(db);
  await db.transaction(async (tx) => {
    await signer.apply(tx, { purpose: 'actor' });
    const [row] = await tx.execute<{ valid: boolean }>(
      sql`SELECT pap_context() IS NOT NULL AS valid`,
    );
    if (row?.valid !== true) throw new Error('Nieaktywny klucz kontekstu runtime DB.');
  });
  const unitOfWork = new PostgresTransactionalUnitOfWork(db, signer);
  return Object.freeze({
    unitOfWork,
    identityResolver: new PostgresUserIdentityResolver(db, signer),
    authorizationDataSource: new PostgresTenantAuthorizationDataSource(db, signer),
    accessManagementStore: unitOfWork.createAccessManagementStore(),
    securityAudit: new PostgresSecurityAudit(db, signer),
  });
}
