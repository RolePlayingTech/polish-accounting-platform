import {
  AccountingWorkspaceService,
  InMemoryIdentityLifecycleStore,
  InMemoryWebSessionStore,
  TENANT_1_ID,
  TENANT_2_ID,
  type IdentityLifecycleStorePort,
  type OidcAccessTokenVerifier,
  type SecurityAuditRecorder,
  type TenantAuthorizationDataSource,
  type UserIdentityResolver,
  type WebSessionStorePort,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import {
  DatabaseConfigError,
  PostgresIdentityLifecycleStore,
  PostgresWebSessionStore,
} from '@pap/db';
import { JwksOidcAccessTokenVerifier } from '../auth/jwks-oidc-token-verifier.js';
import { loadOidcVerifierConfig } from '../auth/oidc-config.js';
import {
  SandboxOidcService,
  resolveApiRuntimeMode,
} from '../auth/sandbox-oidc.service.js';
import {
  OwnerBootstrapError,
  RuntimeOwnerBootstrapService,
  type OwnerBootstrapFailureReason,
  type OwnerBootstrapPort,
} from './owner-bootstrap-runtime.js';
import { hydrateWorkspaceFromPostgres } from './postgres-company-hydrator.js';
import { seedSyntheticDemoToPostgres } from './postgres-demo-seed.js';
import { connectPostgresRuntime, hasConfiguredDatabaseUrl } from './postgres-runtime-config.js';
import {
  PostgresBackedWorkspaceService,
  type WorkspaceRuntimePort,
} from './postgres-workspace-persistence.js';

export type { WorkspaceRuntimePort } from './postgres-workspace-persistence.js';
export { seedSyntheticDemoToPostgres } from './postgres-demo-seed.js';
export {
  OwnerBootstrapError,
  type OwnerBootstrapFailureReason,
  type OwnerBootstrapPort,
};

export const ACCOUNTING_WORKSPACE_SERVICE = Symbol('ACCOUNTING_WORKSPACE_SERVICE');
export const PAP_MCP_GATEWAY = Symbol('PAP_MCP_GATEWAY');
export const API_RUNTIME_ENV = Symbol('API_RUNTIME_ENV');
export const WEB_SESSION_STORE_PORT = Symbol('WEB_SESSION_STORE_PORT');
export const IDENTITY_LIFECYCLE_STORE_PORT = Symbol('IDENTITY_LIFECYCLE_STORE_PORT');
export const OWNER_BOOTSTRAP_PORT = Symbol('OWNER_BOOTSTRAP_PORT');

export interface ApiRuntimeServices {
  readonly sandboxOidc: SandboxOidcService;
  readonly workspace: WorkspaceRuntimePort;
  readonly oidcVerifier: OidcAccessTokenVerifier;
  readonly mcpGateway: PapMcpGateway;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly securityAudit: SecurityAuditRecorder;
  readonly webSessionStore: WebSessionStorePort;
  readonly identityLifecycleStore: IdentityLifecycleStorePort;
  readonly ownerBootstrap: OwnerBootstrapPort;
  readonly persistenceMode: 'in_memory' | 'postgres';
  readonly close?: () => Promise<void>;
}

function createUnconfiguredFailClosedVerifier(): OidcAccessTokenVerifier {
  return {
    async verifyAccessToken() {
      return { ok: false, reason: 'oidc_configuration_unavailable' };
    },
  };
}

function buildOidcVerifier(
  env: Readonly<Record<string, string | undefined>>,
  sandboxOidc: SandboxOidcService,
): OidcAccessTokenVerifier {
  if (sandboxOidc.isEnabled()) {
    return new JwksOidcAccessTokenVerifier(sandboxOidc.buildVerifierConfig(), {
      fetchJwks: () => sandboxOidc.getJwksDocument(),
    });
  }
  if (
    (env.PAP_OIDC_ENV !== undefined && env.PAP_OIDC_ENV.trim().length > 0) ||
    (env.PAP_OIDC_JWKS_URI !== undefined && env.PAP_OIDC_JWKS_URI.trim().length > 0) ||
    (env.PAP_OIDC_ISSUER !== undefined && env.PAP_OIDC_ISSUER.trim().length > 0)
  ) {
    const config = loadOidcVerifierConfig(env);
    return new JwksOidcAccessTokenVerifier(config);
  }
  return createUnconfiguredFailClosedVerifier();
}

export function createApiRuntimeServices(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApiRuntimeServices {
  const runtimeMode = resolveApiRuntimeMode(env);

  if (hasConfiguredDatabaseUrl(env)) {
    throw new DatabaseConfigError(
      'Skonfigurowano DATABASE_URL — użyj asynchronicznej fabryki createApiRuntimeServicesAsync, aby zweryfikować zabezpieczenia RLS i połączyć z PostgreSQL 18.6.',
    );
  }

  const sandboxOidc = new SandboxOidcService(env);
  const seedDemoData =
    runtimeMode !== null && runtimeMode !== 'LOCAL_DEV'
      ? false
      : env.PAP_SEED_SYNTHETIC_DEMO !== 'false';
  const workspace = new AccountingWorkspaceService({ seedDemoData });
  const oidcVerifier = buildOidcVerifier(env, sandboxOidc);
  const mcpDomainPort = workspace.createWorkspaceMcpDomainPort();
  const mcpGateway = workspace.createBoundMcpGateway(oidcVerifier);
  const webSessionStore = new InMemoryWebSessionStore();
  const identityLifecycleStore = new InMemoryIdentityLifecycleStore({
    workspaceStore: workspace.store,
    initialTenantNames: seedDemoData
      ? {
          [TENANT_1_ID]: 'Biuro Rachunkowe Alfa (Demo)',
          [TENANT_2_ID]: 'Kancelaria Podatkowa Beta (Demo)',
        }
      : undefined,
  });
  const ownerBootstrap = new RuntimeOwnerBootstrapService({
    lifecycleStore: identityLifecycleStore,
    workspace,
    innerWorkspace: workspace,
  });

  return {
    sandboxOidc,
    workspace,
    oidcVerifier,
    mcpGateway,
    identityResolver: mcpDomainPort,
    authorizationDataSource: mcpDomainPort,
    securityAudit: mcpDomainPort,
    webSessionStore,
    identityLifecycleStore,
    ownerBootstrap,
    persistenceMode: 'in_memory',
  };
}

export async function createApiRuntimeServicesAsync(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApiRuntimeServices> {
  if (!hasConfiguredDatabaseUrl(env)) {
    return createApiRuntimeServices(env);
  }

  const runtimeMode = resolveApiRuntimeMode(env);
  const sandboxOidc = new SandboxOidcService(env);
  const oidcVerifier = buildOidcVerifier(env, sandboxOidc);
  const pgRuntime = await connectPostgresRuntime(env);

  try {
    if (
      (runtimeMode === null || runtimeMode === 'LOCAL_DEV') &&
      env.PAP_SEED_SYNTHETIC_DEMO === 'true'
    ) {
      await seedSyntheticDemoToPostgres({
        runtime: pgRuntime,
        migratorDatabaseUrl: env.PAP_MIGRATOR_DATABASE_URL,
        sandboxIssuer: sandboxOidc.getIssuer(),
      });
    }

    const innerWorkspace = await hydrateWorkspaceFromPostgres(pgRuntime, sandboxOidc.getIssuer());
    const webSessionStore = new PostgresWebSessionStore(pgRuntime.connection.db, pgRuntime.signer);
    const workspace = new PostgresBackedWorkspaceService({
      runtime: pgRuntime,
      innerWorkspace,
      oidcVerifier,
      sandboxIssuer: sandboxOidc.getIssuer(),
      webSessionStore,
    });
    const mcpGateway = workspace.createBoundMcpGateway();
    const identityLifecycleStore = new PostgresIdentityLifecycleStore(
      pgRuntime.connection.db,
      pgRuntime.signer,
    );
    const ownerBootstrap = new RuntimeOwnerBootstrapService({
      lifecycleStore: identityLifecycleStore,
      workspace,
      innerWorkspace,
      pgRuntime,
    });

    return {
      sandboxOidc,
      workspace,
      oidcVerifier,
      mcpGateway,
      identityResolver: pgRuntime.securityServices.identityResolver,
      authorizationDataSource: pgRuntime.securityServices.authorizationDataSource,
      securityAudit: pgRuntime.securityServices.securityAudit,
      webSessionStore,
      identityLifecycleStore,
      ownerBootstrap,
      persistenceMode: 'postgres',
      close: () => pgRuntime.close(),
    };
  } catch (err) {
    await pgRuntime.close();
    throw err;
  }
}
