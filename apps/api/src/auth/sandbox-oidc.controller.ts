import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';
import { SandboxOidcService } from './sandbox-oidc.service.js';

@Controller()
export class SandboxOidcController {
  constructor(
    @Inject(SandboxOidcService)
    private readonly sandboxOidc: SandboxOidcService,
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
  ) {}

  private assertSandboxEnabled(): void {
    if (!this.sandboxOidc.isEnabled()) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'not_found',
        reasonCode: 'sandbox_oidc_disabled',
        message: 'Piaskownica OIDC jest wyłączona w bieżącym środowisku.',
      });
    }
  }

  @Get('/.well-known/openid-configuration')
  @Header('Cache-Control', 'no-store')
  getDiscovery(@Req() request: FastifyRequest) {
    this.assertSandboxEnabled();
    const hostHeader = typeof request.headers.host === 'string' ? request.headers.host : undefined;
    return this.sandboxOidc.getDiscoveryDocument(hostHeader);
  }

  @Get('/api/v1/auth/sandbox/jwks.json')
  @Header('Cache-Control', 'no-store')
  async getSandboxJwks() {
    this.assertSandboxEnabled();
    return this.sandboxOidc.getJwksDocument();
  }

  @Get('/api/v1/oidc/jwks.json')
  @Header('Cache-Control', 'no-store')
  async getOidcJwksAlias() {
    this.assertSandboxEnabled();
    return this.sandboxOidc.getJwksDocument();
  }

  @Get('/api/v1/oidc/personas')
  @Header('Cache-Control', 'no-store')
  getOidcPersonas() {
    this.assertSandboxEnabled();
    return this.sandboxOidc.listPersonas(this.workspace);
  }

  @Get('/api/v1/auth/sandbox/personas')
  @Header('Cache-Control', 'no-store')
  getSandboxPersonasAlias() {
    this.assertSandboxEnabled();
    return this.sandboxOidc.listPersonas(this.workspace);
  }

  @Post('/api/v1/oidc/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async issueOidcToken(@Body() body: unknown) {
    this.assertSandboxEnabled();
    return this.sandboxOidc.issueToken(this.workspace, body);
  }

  @Post('/api/v1/auth/sandbox/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async issueSandboxTokenAlias(@Body() body: unknown) {
    this.assertSandboxEnabled();
    return this.sandboxOidc.issueToken(this.workspace, body);
  }
}
