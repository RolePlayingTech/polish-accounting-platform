export { connectDatabase, type ConnectDatabaseOptions } from './client.js';
export {
  PostgresAccessManagementAuthorizationDataSource,
  PostgresAccessManagementStore,
} from './access-management.js';
export {
  applyLocalRlsSessionContext,
  lockCompanyActionFactsInTx,
  PostgresTransactionalUnitOfWork,
  readTransactionClockNow,
  runManagedTransaction,
  verifyAndLockActorInTx,
  type PostgresCompanyActionTransactionContext,
  type PostgresTransaction,
} from './transactional-unit-of-work.js';
export {
  PostgresUserIdentityResolver,
  PostgresUserIdentityStore,
  type ProvisionUserOidcIdentityInput,
  type UserIdentityStoreResult,
} from './user-identity.js';
export { accessManagementEvent, appUser, userOidcIdentity } from './schema.js';
export { PostgresTenantAuthorizationDataSource } from './tenant-authorization.js';
export {
  tenant,
  legalEntity,
  tenantMembership,
  entityProfileVersion,
  companyAccessGrant,
} from './schema.js';
export {
  DatabaseConfigError,
  loadDatabaseConfig,
  type DatabaseConfig,
  type DatabaseEnvironment,
  type DatabaseRoleScope,
  type LoadDatabaseConfigOptions,
} from './database-config.js';
