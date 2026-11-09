import { sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import type {
  PostgresCompanyActionScope,
  PostgresCompanyActionScopeFactory,
} from './company-operation-probe.js';
import { PostgresSecurityAudit } from './security-audit.js';
import { PostgresContextSigner } from './signed-context.js';
import { PostgresTenantAuthorizationDataSource } from './tenant-authorization.js';
import { PostgresTransactionalUnitOfWork } from './transactional-unit-of-work.js';
import { PostgresUserIdentityResolver } from './user-identity.js';

type Database = ReturnType<typeof connectDatabase>['db'];

/** Kontrola rzeczywistych ACL/katalogów, niezależna od samej nazwy w DATABASE_URL. */
export async function assertRuntimeDatabaseSecurity(db: Pick<Database, 'execute'>): Promise<void> {
  // Brak 0006/0007 albo stare ACL mają zatrzymać kompozycję przed utworzeniem usług.
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
    NOT has_table_privilege('pap_oidc_auth_state', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('pap_oidc_auth_state', 'SELECT,INSERT,UPDATE,REFERENCES') AND
    NOT has_table_privilege('pap_bff_session', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('pap_bff_session', 'SELECT,INSERT,UPDATE,REFERENCES') AND
    NOT has_table_privilege('pap_user_profile', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('pap_user_profile', 'SELECT,INSERT,UPDATE,REFERENCES') AND
    NOT has_table_privilege('pap_identity_lifecycle_event', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('pap_identity_lifecycle_event', 'SELECT,INSERT,UPDATE,REFERENCES') AND
    NOT has_table_privilege('pap_tenant_invitation', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') AND
    NOT has_any_column_privilege('pap_tenant_invitation', 'SELECT,INSERT,UPDATE,REFERENCES') AND
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
    has_function_privilege('pap_provision_company()', 'EXECUTE') AND
    has_function_privilege('pap_list_actor_accessible_entities()', 'EXECUTE') AND
    has_function_privilege('pap_bff_session_op(jsonb)', 'EXECUTE') AND
    has_function_privilege('pap_wave2_identity_op(jsonb)', 'EXECUTE') AND
    (SELECT count(*) = 32 AND bool_and(
        c.relrowsecurity
        AND c.relforcerowsecurity
        AND c.relowner <> r.oid
        AND NOT has_table_privilege(c.oid, 'DELETE,TRUNCATE')
      )
      FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace
        AND c.relname IN (
          'tenant','legal_entity','tenant_membership','entity_profile_version',
          'company_access_grant','access_management_event','app_user','user_oidc_identity',
          'security_context_key','company_operation_probe','security_decision_event',
          'company_tax_settings','accounting_document','kpir_entry','ryczalt_entry',
          'vat_register_entry','ledger_account','journal_entry','journal_line',
          'settlement_item','bank_statement_import','bank_transaction','tax_obligation_item',
          'mcp_prepared_proposal','notification_preference','notification_outbox',
          'sandbox_mailbox_message','pap_oidc_auth_state','pap_bff_session',
          'pap_user_profile','pap_identity_lifecycle_event','pap_tenant_invitation'
        )) AND
    NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.relnamespace IN (current_schema()::regnamespace, 'public'::regnamespace)
        AND c.relkind IN ('r', 'p')
        AND has_table_privilege(c.oid, 'DELETE,TRUNCATE')
    ) AND
    (SELECT count(*) = 7 AND NOT bool_or(has_any_column_privilege(c.oid, 'UPDATE'))
      FROM pg_class c WHERE c.relnamespace = current_schema()::regnamespace
        AND c.relname IN (
          'kpir_entry','ryczalt_entry','vat_register_entry','journal_entry',
          'journal_line','bank_statement_import','sandbox_mailbox_message'
        )) AND
    NOT EXISTS (SELECT 1 FROM pg_proc p
      WHERE p.pronamespace = current_schema()::regnamespace AND p.proowner = r.oid)
    ) AS safe FROM pg_roles r WHERE r.rolname = current_user`);
  if (state?.safe !== true)
    throw new Error('Niespełniony kontrakt bezpieczeństwa roli runtime DB.');
}

export interface PostgresSecurityServices<TScope = PostgresCompanyActionScope> {
  readonly unitOfWork: PostgresTransactionalUnitOfWork<TScope>;
  readonly identityResolver: PostgresUserIdentityResolver;
  readonly authorizationDataSource: PostgresTenantAuthorizationDataSource;
  readonly accessManagementStore: ReturnType<
    PostgresTransactionalUnitOfWork<TScope>['createAccessManagementStore']
  >;
  readonly securityAudit: PostgresSecurityAudit;
}

/** Jedno miejsce kompozycji dla przyszłego API i adaptera MCP. Bez otwierania endpointów. */
export async function createPostgresSecurityServices<TScope = PostgresCompanyActionScope>(
  db: Database,
  signer: PostgresContextSigner,
  scopeFactory?: PostgresCompanyActionScopeFactory<TScope>,
): Promise<PostgresSecurityServices<TScope>> {
  await assertRuntimeDatabaseSecurity(db);
  await db.transaction(async (tx) => {
    await signer.apply(tx, { purpose: 'actor' });
    const [row] = await tx.execute<{ valid: boolean }>(
      sql`SELECT pap_context() IS NOT NULL AS valid`,
    );
    if (row?.valid !== true) throw new Error('Nieaktywny klucz kontekstu runtime DB.');
  });
  const unitOfWork = new PostgresTransactionalUnitOfWork<TScope>(db, signer, scopeFactory);
  return Object.freeze({
    unitOfWork,
    identityResolver: new PostgresUserIdentityResolver(db, signer),
    authorizationDataSource: new PostgresTenantAuthorizationDataSource(db, signer),
    accessManagementStore: unitOfWork.createAccessManagementStore(),
    securityAudit: new PostgresSecurityAudit(db, signer),
  });
}
