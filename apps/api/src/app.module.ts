import { type DynamicModule, Module, type Provider } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  SECURITY_AUDIT_RECORDER,
  TENANT_AUTHORIZATION_DATA_SOURCE,
  USER_IDENTITY_RESOLVER,
} from './auth/company-access.guard.js';
import { JwtBearerAuthGuard } from './auth/jwt-bearer.guard.js';
import { SandboxOidcController } from './auth/sandbox-oidc.controller.js';
import { SandboxOidcService } from './auth/sandbox-oidc.service.js';
import { CompaniesAccessController } from './controllers/companies-access.controller.js';
import { DocumentsBooksController } from './controllers/documents-books.controller.js';
import { EducationRulesController } from './controllers/education-rules.controller.js';
import { OperationsAutomationController } from './controllers/operations-automation.controller.js';
import { AccountingWorkspaceExceptionFilter } from './filters/workspace-exception.filter.js';
import { HealthController } from './health.controller.js';
import { RemoteMcpFastifyRegistrar } from './mcp/remote-mcp.registrar.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  API_RUNTIME_ENV,
  PAP_MCP_GATEWAY,
  createApiRuntimeServices,
  type ApiRuntimeServices,
} from './runtime/workspace-runtime.js';
import { SystemStatusController } from './system-status.controller.js';

export const API_RUNTIME_SERVICES = Symbol('API_RUNTIME_SERVICES');

function buildRuntimeProviders(
  explicitEnv?: Readonly<Record<string, string | undefined>>,
): Provider[] {
  return [
    {
      provide: API_RUNTIME_ENV,
      useFactory: () => explicitEnv ?? process.env,
    },
    {
      provide: API_RUNTIME_SERVICES,
      useFactory: (runtimeEnv: Readonly<Record<string, string | undefined>>) =>
        createApiRuntimeServices(runtimeEnv),
      inject: [API_RUNTIME_ENV],
    },
    {
      provide: SandboxOidcService,
      useFactory: (rt: ApiRuntimeServices) => rt.sandboxOidc,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: ACCOUNTING_WORKSPACE_SERVICE,
      useFactory: (rt: ApiRuntimeServices) => rt.workspace,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: OIDC_ACCESS_TOKEN_VERIFIER,
      useFactory: (rt: ApiRuntimeServices) => rt.oidcVerifier,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: PAP_MCP_GATEWAY,
      useFactory: (rt: ApiRuntimeServices) => rt.mcpGateway,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: USER_IDENTITY_RESOLVER,
      useFactory: (rt: ApiRuntimeServices) => rt.identityResolver,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: TENANT_AUTHORIZATION_DATA_SOURCE,
      useFactory: (rt: ApiRuntimeServices) => rt.authorizationDataSource,
      inject: [API_RUNTIME_SERVICES],
    },
    {
      provide: SECURITY_AUDIT_RECORDER,
      useFactory: (rt: ApiRuntimeServices) => rt.securityAudit,
      inject: [API_RUNTIME_SERVICES],
    },
    JwtBearerAuthGuard,
    RemoteMcpFastifyRegistrar,
    {
      provide: APP_FILTER,
      useClass: AccountingWorkspaceExceptionFilter,
    },
  ];
}

const API_CONTROLLERS = [
  HealthController,
  SystemStatusController,
  SandboxOidcController,
  CompaniesAccessController,
  DocumentsBooksController,
  OperationsAutomationController,
  EducationRulesController,
];

@Module({
  controllers: API_CONTROLLERS,
  providers: buildRuntimeProviders(),
})
export class AppModule {
  static register(env?: Readonly<Record<string, string | undefined>>): DynamicModule {
    return {
      module: AppModule,
      controllers: API_CONTROLLERS,
      providers: buildRuntimeProviders(env),
    };
  }
}
