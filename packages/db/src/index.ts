export { connectDatabase } from './client.js';
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
