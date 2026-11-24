import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { StatutoryFilingFacade } from '@pap/application';
import type { FastifyReply } from 'fastify';
import {
  JwtBearerAuthGuard,
  RequireHumanApprovalScope,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  API_RUNTIME_ENV,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';

@Controller([
  '/api/v1/tenants/:tenantId/companies/:companyId',
  '/api/v1/companies/:companyId',
  '/v1/companies/:companyId',
])
@UseGuards(JwtBearerAuthGuard)
export class StatutoryKsefController {
  private readonly facade: StatutoryFilingFacade;

  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    workspace: WorkspaceRuntimePort,
    @Optional()
    @Inject(API_RUNTIME_ENV)
    runtimeEnv?: Readonly<Record<string, string | undefined>>,
  ) {
    this.facade = new StatutoryFilingFacade({
      workspace,
      ...(runtimeEnv ? { env: runtimeEnv } : {}),
    });
  }

  @Get('/jpk/applicable')
  @Header('Cache-Control', 'no-store')
  getApplicableJpk(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.getApplicableJpk(actor, tenantId, companyId, period);
  }

  @Post('/jpk/export')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  exportJpk(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.exportJpk(actor, tenantId, companyId, body);
  }

  @Post(['/invoices/:documentId/fa3-xml', '/documents/:documentId/fa3-xml'])
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  generateInvoiceFa3Xml(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('documentId') documentId: string,
    @Param('tenantId') tenantId?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.generateInvoiceFa3Xml(actor, tenantId, companyId, documentId, body);
  }

  @Get('/source-archive')
  @Header('Cache-Control', 'no-store')
  listSourceArchive(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.listSourceArchive(actor, tenantId, companyId);
  }

  @Post('/source-archive')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  storeSourceArchive(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.storeSourceArchive(actor, tenantId, companyId, body);
  }

  @Get('/source-archive/:artifactId')
  @Header('Cache-Control', 'no-store')
  getSourceArchivePreview(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('artifactId') artifactId: string,
    @Param('tenantId') tenantId?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.getSourceArchivePreview(actor, tenantId, companyId, artifactId);
  }

  @Get(['/source-archive/:artifactId/content', '/source-artifacts/:artifactId/content'])
  async downloadSourceArchiveContent(
    @Req() request: JwtAuthenticatedRequest,
    @Res() reply: FastifyReply,
    @Param('companyId') companyId: string,
    @Param('artifactId') artifactId: string,
    @Param('tenantId') tenantId?: string,
  ) {
    const actor = requireRequestActor(request);
    const { metadata, bytes } = await this.facade.readSourceArchiveContent(
      actor,
      tenantId,
      companyId,
      artifactId,
    );
    reply
      .status(200)
      .header('Cache-Control', 'no-store')
      .header('Content-Type', metadata.mimeType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Artifact-Sha256', metadata.sha256Hex)
      .header(
        'Content-Disposition',
        `attachment; filename="${metadata.fileName.replace(/["\\\r\n]/g, '_')}"`,
      )
      .send(bytes);
  }

  @Get('/ksef/status')
  @Header('Cache-Control', 'no-store')
  getKsefStatus(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Query('probe') probe?: string,
    @Query('environment') environment?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.getKsefStatus(actor, tenantId, companyId, {
      liveProbe: probe === 'true' || probe === '1',
      ...(environment ? { environment } : {}),
    });
  }

  @Post('/ksef/sandbox/issue')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  issueKsefSandbox(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.issueKsefSandbox(actor, tenantId, companyId, body);
  }

  @Post('/ksef/sandbox/sync-incoming')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  syncKsefIncoming(
    @Req() request: JwtAuthenticatedRequest,
    @Param('companyId') companyId: string,
    @Param('tenantId') tenantId?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.facade.syncKsefIncoming(actor, tenantId, companyId, body);
  }
}
