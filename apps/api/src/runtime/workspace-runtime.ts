import {
  AccountingWorkspaceService,
  type OidcAccessTokenVerifier,
  type SecurityAuditRecorder,
  type TenantAuthorizationDataSource,
  type UserIdentityResolver,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import { DatabaseConfigError } from '@pap/db';
import { JwksOidcAccessTokenVerifier } from '../auth/jwks-oidc-token-verifier.js';
import { loadOidcVerifierConfig } from '../auth/oidc-config.js';
import { SandboxOidcService } from '../auth/sandbox-oidc.service.js';
import { hydrateWorkspaceFromPostgres } from './postgres-company-hydrator.js';
import { seedSyntheticDemoToPostgres } from './postgres-demo-seed.js';
import { connectPostgresRuntime, hasConfiguredDatabaseUrl } from './postgres-runtime-config.js';
import {
  PostgresBackedWorkspaceService,
  type WorkspaceRuntimePort,
} from './postgres-workspace-persistence.js';

export type { WorkspaceRuntimePort } from './postgres-workspace-persistence.js';
export { seedSyntheticDemoToPostgres } from './postgres-demo-seed.js';

export const ACCOUNTING_WORKSPACE_SERVICE = Symbol('ACCOUNTING_WORKSPACE_SERVICE');
export const PAP_MCP_GATEWAY = Symbol('PAP_MCP_GATEWAY');
export const API_RUNTIME_ENV = Symbol('API_RUNTIME_ENV');

export interface ApiRuntimeServices {
  readonly sandboxOidc: SandboxOidcService;
  readonly workspace: WorkspaceRuntimePort;
  readonly oidcVerifier: OidcAccessTokenVerifier;
  readonly mcpGateway: PapMcpGateway;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly securityAudit: SecurityAuditRecorder;
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
  if (hasConfiguredDatabaseUrl(env)) {
    throw new DatabaseConfigError(
      'Skonfigurowano DATABASE_URL — użyj asynchronicznej fabryki createApiRuntimeServicesAsync, aby zweryfikować zabezpieczenia RLS i połączyć z PostgreSQL 18.6.',
    );
  }

  const sandboxOidc = new SandboxOidcService(env);
  const workspace = new AccountingWorkspaceService({ seedDemoData: true });
  const oidcVerifier = buildOidcVerifier(env, sandboxOidc);
  const mcpDomainPort = workspace.createWorkspaceMcpDomainPort();
  const mcpGateway = workspace.createBoundMcpGateway(oidcVerifier);

  return {
    sandboxOidc,
    workspace,
    oidcVerifier,
    mcpGateway,
    identityResolver: mcpDomainPort,
    authorizationDataSource: mcpDomainPort,
    securityAudit: mcpDomainPort,
    persistenceMode: 'in_memory',
  };
}

export async function createApiRuntimeServicesAsync(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ApiRuntimeServices> {
  if (!hasConfiguredDatabaseUrl(env)) {
    return createApiRuntimeServices(env);
  }

  const sandboxOidc = new SandboxOidcService(env);
  const oidcVerifier = buildOidcVerifier(env, sandboxOidc);
  const pgRuntime = await connectPostgresRuntime(env);

  try {
    if (env.PAP_SEED_SYNTHETIC_DEMO === 'true') {
      await seedSyntheticDemoToPostgres({
        runtime: pgRuntime,
        migratorDatabaseUrl: env.PAP_MIGRATOR_DATABASE_URL,
        sandboxIssuer: sandboxOidc.getIssuer(),
      });
    }

    const innerWorkspace = await hydrateWorkspaceFromPostgres(pgRuntime, sandboxOidc.getIssuer());
    const workspace = new PostgresBackedWorkspaceService({
      runtime: pgRuntime,
      innerWorkspace,
      oidcVerifier,
      sandboxIssuer: sandboxOidc.getIssuer(),
    });
    const mcpGateway = workspace.createBoundMcpGateway();

    return {
      sandboxOidc,
      workspace,
      oidcVerifier,
      mcpGateway,
      identityResolver: pgRuntime.securityServices.identityResolver,
      authorizationDataSource: pgRuntime.securityServices.authorizationDataSource,
      securityAudit: pgRuntime.securityServices.securityAudit,
      persistenceMode: 'postgres',
      close: () => pgRuntime.close(),
    };
  } catch (err) {
    await pgRuntime.close();
    throw err;
  }
}
