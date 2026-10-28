export { connectDatabase } from './client.js';
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
} from './database-config.js';
