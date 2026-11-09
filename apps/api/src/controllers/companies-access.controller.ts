import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { WebSessionStorePort } from '@pap/application';
import type {
  CreateCompanyRequest,
  GrantCompanyAccessRequest,
  RevokeCompanyAccessRequest,
  UpdateCompanySettingsRequest,
} from '@pap/contracts';
import { legalEntityId as parseLegalEntityId, tenantId as parseTenantId } from '@pap/domain';
import {
  JwtBearerAuthGuard,
  RequireHumanApprovalScope,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  WEB_SESSION_STORE_PORT,
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
    @Optional()
    @Inject(WEB_SESSION_STORE_PORT)
    private readonly webSessionStore?: WebSessionStorePort,
  ) {}

  private resolveGrantTargetUserIdBeforeRevoke(
    rawTenantId: string,
    rawLegalEntityId: string,
    payload: RevokeCompanyAccessRequest,
  ): string | null {
    if (typeof payload.targetUserId === 'string' && payload.targetUserId.trim().length > 0) {
      return payload.targetUserId.trim();
    }
    if (typeof payload.grantId === 'string' && payload.grantId.trim().length > 0) {
      try {
        const tId = parseTenantId(rawTenantId);
        const leId = parseLegalEntityId(rawLegalEntityId);
        const matched = this.workspace.store
          .listGrantsForCompany(tId, leId)
          .find((g) => g.grantId === payload.grantId);
        return matched?.userId ?? null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async invalidateUserSessionsFailClosed(userId: string | null): Promise<void> {
    if (!userId || !this.webSessionStore) {
      return;
    }
    try {
      await this.webSessionStore.revokeAllSessionsForUser({ userId });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn sesji BFF jest chwilowo niedostępny podczas unieważniania dostępu (fail-closed).',
      });
    }
  }

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
  async deleteGrant(
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
    const targetUserId = this.resolveGrantTargetUserIdBeforeRevoke(tenantId, legalEntityId, payload);
    const response = await this.workspace.revokeCompanyAccess(actor, tenantId, legalEntityId, payload);
    await this.invalidateUserSessionsFailClosed(targetUserId);
    return response;
  }

  @Post('/tenants/:tenantId/companies/:legalEntityId/grants/:grantId/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeGrantById(
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
    const targetUserId = this.resolveGrantTargetUserIdBeforeRevoke(tenantId, legalEntityId, payload);
    const response = await this.workspace.revokeCompanyAccess(actor, tenantId, legalEntityId, payload);
    await this.invalidateUserSessionsFailClosed(targetUserId);
    return response;
  }

  @Post('/tenants/:tenantId/companies/:legalEntityId/grants/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeGrantFromBody(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload = (body ?? {}) as RevokeCompanyAccessRequest;
    const targetUserId = this.resolveGrantTargetUserIdBeforeRevoke(tenantId, legalEntityId, payload);
    const response = await this.workspace.revokeCompanyAccess(actor, tenantId, legalEntityId, payload);
    await this.invalidateUserSessionsFailClosed(targetUserId);
    return response;
  }

  @Post('/tenants/:tenantId/memberships/:targetUserId/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeTenantMembership(
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
    const response = await this.workspace.revokeTenantMembership(
      actor,
      tenantId,
      targetUserId,
      parsedBody,
    );
    await this.invalidateUserSessionsFailClosed(targetUserId);
    return response;
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
