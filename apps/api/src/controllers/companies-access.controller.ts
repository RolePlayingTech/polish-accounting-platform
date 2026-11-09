import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateCompanyRequest,
  GrantCompanyAccessRequest,
  RevokeCompanyAccessRequest,
  UpdateCompanySettingsRequest,
} from '@pap/contracts';
import {
  JwtBearerAuthGuard,
  RequireHumanApprovalScope,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';
import { parseOptionalPeriodParam } from './query-helpers.js';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Controller('/api/v1')
@UseGuards(JwtBearerAuthGuard)
export class CompaniesAccessController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
  ) {}

  @Get('/me/companies')
  @Header('Cache-Control', 'no-store')
  getMyCompanies(@Req() request: JwtAuthenticatedRequest) {
    const actor = requireRequestActor(request);
    return this.workspace.getMyCompanies(actor);
  }

  @Get('/tenants/:tenantId/companies')
  @Header('Cache-Control', 'no-store')
  listTenantCompanies(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.listTenantCompanies(actor, tenantId);
  }

  @Post('/tenants/:tenantId/companies')
  @Header('Cache-Control', 'no-store')
  createCompany(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.createCompany(actor, tenantId, (body ?? {}) as CreateCompanyRequest);
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/dashboard')
  @Header('Cache-Control', 'no-store')
  getDashboard(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getCompanyOverview(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/overview')
  @Header('Cache-Control', 'no-store')
  getOverviewAlias(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getCompanyOverview(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/settings')
  @Header('Cache-Control', 'no-store')
  getSettings(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getCompanySettings(actor, tenantId, legalEntityId);
  }

  @Put('/tenants/:tenantId/companies/:legalEntityId/settings')
  @Header('Cache-Control', 'no-store')
  updateSettings(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.updateCompanySettings(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as UpdateCompanySettingsRequest,
    );
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/grants')
  @Header('Cache-Control', 'no-store')
  getGrants(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getCompanyAccess(actor, tenantId, legalEntityId);
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/access')
  @Header('Cache-Control', 'no-store')
  getAccessAlias(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getCompanyAccess(actor, tenantId, legalEntityId);
  }

  @Post('/tenants/:tenantId/companies/:legalEntityId/grants')
  @RequireHumanApprovalScope()
  @Header('Cache-Control', 'no-store')
  grantAccess(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.grantCompanyAccess(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as GrantCompanyAccessRequest,
    );
  }

  @Delete('/tenants/:tenantId/companies/:legalEntityId/grants/:grantId')
  @RequireHumanApprovalScope()
  @Header('Cache-Control', 'no-store')
  deleteGrant(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('grantId') grantId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload: RevokeCompanyAccessRequest = {
      ...(isPlainRecord(body) ? (body as RevokeCompanyAccessRequest) : {}),
      grantId,
    };
    return this.workspace.revokeCompanyAccess(actor, tenantId, legalEntityId, payload);
  }

  @Post('/tenants/:tenantId/companies/:legalEntityId/grants/:grantId/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revokeGrantById(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('grantId') grantId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload: RevokeCompanyAccessRequest = {
      ...(isPlainRecord(body) ? (body as RevokeCompanyAccessRequest) : {}),
      grantId,
    };
    return this.workspace.revokeCompanyAccess(actor, tenantId, legalEntityId, payload);
  }

  @Post('/tenants/:tenantId/companies/:legalEntityId/grants/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revokeGrantFromBody(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.revokeCompanyAccess(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as RevokeCompanyAccessRequest,
    );
  }

  @Post('/tenants/:tenantId/memberships/:targetUserId/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revokeTenantMembership(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('targetUserId') targetUserId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const parsedBody = isPlainRecord(body)
      ? {
          ...(typeof body['operationId'] === 'string' ? { operationId: body['operationId'] } : {}),
          ...(typeof body['reason'] === 'string' ? { reason: body['reason'] } : {}),
        }
      : undefined;
    return this.workspace.revokeTenantMembership(actor, tenantId, targetUserId, parsedBody);
  }

  @Get('/tenants/:tenantId/companies/:legalEntityId/audit-log')
  @Header('Cache-Control', 'no-store')
  getAuditLog(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getAuditLog(actor, tenantId, legalEntityId);
  }
}
