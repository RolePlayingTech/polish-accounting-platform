import {
  AccountingWorkspaceService,
  type OidcAccessTokenVerifier,
  type SecurityAuditRecorder,
  type TenantAuthorizationDataSource,
  type UserIdentityResolver,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import { JwksOidcAccessTokenVerifier } from '../auth/jwks-oidc-token-verifier.js';
import { loadOidcVerifierConfig } from '../auth/oidc-config.js';
import { SandboxOidcService } from '../auth/sandbox-oidc.service.js';

export const ACCOUNTING_WORKSPACE_SERVICE = Symbol('ACCOUNTING_WORKSPACE_SERVICE');
export const PAP_MCP_GATEWAY = Symbol('PAP_MCP_GATEWAY');

export interface ApiRuntimeServices {
  readonly sandboxOidc: SandboxOidcService;
  readonly workspace: AccountingWorkspaceService;
  readonly oidcVerifier: OidcAccessTokenVerifier;
  readonly mcpGateway: PapMcpGateway;
  readonly identityResolver: UserIdentityResolver;
  readonly authorizationDataSource: TenantAuthorizationDataSource;
  readonly securityAudit: SecurityAuditRecorder;
}

function createUnconfiguredFailClosedVerifier(): OidcAccessTokenVerifier {
  return {
    async verifyAccessToken() {
      return { ok: false, reason: 'oidc_configuration_unavailable' };
    },
  };
}

export function createApiRuntimeServices(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ApiRuntimeServices {
  const sandboxOidc = new SandboxOidcService(env);
  const workspace = new AccountingWorkspaceService({ seedDemoData: true });

  let oidcVerifier: OidcAccessTokenVerifier;
  if (sandboxOidc.isEnabled()) {
    oidcVerifier = new JwksOidcAccessTokenVerifier(sandboxOidc.buildVerifierConfig(), {
      fetchJwks: () => sandboxOidc.getJwksDocument(),
    });
  } else if (env.PAP_OIDC_ENV !== undefined && env.PAP_OIDC_ENV.trim().length > 0) {
    const config = loadOidcVerifierConfig(env);
    oidcVerifier = new JwksOidcAccessTokenVerifier(config);
  } else {
    oidcVerifier = createUnconfiguredFailClosedVerifier();
  }

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
  };
}
