import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  generateOpaqueInvitationToken,
  hashInvitationTokenSha256,
  normalizeSessionDisplayName,
  normalizeSessionSafeEmail,
  type AcceptTenantInvitationDeniedReason,
  type CreateTenantInvitationDeniedReason,
  type IdentityLifecycleStorePort,
  type RejectTenantInvitationDeniedReason,
  type RevokeTenantInvitationDeniedReason,
} from '@pap/application';
import {
  AcceptTenantInvitationRequestSchema,
  AcceptTenantInvitationResponseSchema,
  CreateTenantInvitationRequestSchema,
  CreateTenantInvitationResponseSchema,
  ListTenantInvitationsResponseSchema,
  RejectTenantInvitationRequestSchema,
  RejectTenantInvitationResponseSchema,
  RevokeTenantInvitationRequestSchema,
  RevokeTenantInvitationResponseSchema,
  UuidSelectorSchema,
  type AcceptTenantInvitationResponse,
  type CreateTenantInvitationResponse,
  type ListTenantInvitationsResponse,
  type RejectTenantInvitationResponse,
  type RevokeTenantInvitationResponse,
} from '@pap/contracts';
import {
  InvalidIdentifierError,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import {
  AllowUnprovisionedOidcForInvitation,
  JwtBearerAuthGuard,
  RequireHumanApprovalScope,
  requireInvitationCallerIdentity,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  IDENTITY_LIFECYCLE_STORE_PORT,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';

const DEFAULT_INVITATION_EXPIRES_IN_HOURS = 72;

function resolveOperationId(
  explicitOperationId: string | undefined,
  headerIdempotencyKey: string | undefined,
): string {
  if (explicitOperationId) {
    return explicitOperationId;
  }
  if (headerIdempotencyKey && UuidSelectorSchema.safeParse(headerIdempotencyKey).success) {
    return headerIdempotencyKey;
  }
  return randomUUID();
}

function throwCreateInvitationError(reason: CreateTenantInvitationDeniedReason): never {
  switch (reason) {
    case 'invalid_invitation_input':
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: reason,
        message: 'Niepoprawne dane zaproszenia do organizacji.',
      });
    case 'duplicate_pending_invitation':
      throw new ConflictException({
        statusCode: 409,
        error: 'conflict',
        reasonCode: reason,
        message: 'Dla wskazanego adresu e-mail istnieje już aktywne oczekujące zaproszenie w tej organizacji.',
      });
    case 'operation_conflict':
      throw new ConflictException({
        statusCode: 409,
        error: 'conflict',
        reasonCode: reason,
        message: 'Konflikt idempotencji operacji utworzenia zaproszenia.',
      });
    case 'active_admin_membership_required':
    case 'admin_role_required':
    case 'target_role_not_delegable':
    case 'grant_scope_not_delegable':
    case 'user_disabled':
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: reason,
        message: 'Brak uprawnień do wystawienia zaproszenia o żądanym zakresie roli lub firm.',
      });
  }
}

function throwRevokeInvitationError(reason: RevokeTenantInvitationDeniedReason): never {
  switch (reason) {
    case 'invalid_invitation_input':
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: reason,
        message: 'Niepoprawne dane cofnięcia zaproszenia.',
      });
    case 'invitation_not_found':
      throw new NotFoundException({
        statusCode: 404,
        error: 'not_found',
        reasonCode: reason,
        message: 'Nie znaleziono wskazanego zaproszenia w bieżącej organizacji.',
      });
    case 'invitation_not_pending':
    case 'operation_conflict':
      throw new ConflictException({
        statusCode: 409,
        error: 'conflict',
        reasonCode: reason,
        message:
          reason === 'operation_conflict'
            ? 'Konflikt idempotencji operacji cofnięcia zaproszenia.'
            : 'Zaproszenie nie jest już oczekujące (zostało wcześniej użyte, wygasło lub zostało cofnięte).',
      });
    case 'active_admin_membership_required':
    case 'admin_role_required':
    case 'target_role_not_delegable':
    case 'grant_scope_not_delegable':
    case 'user_disabled':
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: reason,
        message: 'Brak uprawnień do cofnięcia wskazanego zaproszenia.',
      });
  }
}

function throwAcceptOrRejectInvitationError(
  reason: AcceptTenantInvitationDeniedReason | RejectTenantInvitationDeniedReason,
): never {
  switch (reason) {
    case 'invalid_invitation_input':
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: reason,
        message: 'Niepoprawny format tokenu lub danych zaproszenia.',
      });
    case 'invitation_not_found':
      throw new NotFoundException({
        statusCode: 404,
        error: 'not_found',
        reasonCode: reason,
        message: 'Zaproszenie nie istnieje lub podany token jest nieprawidłowy.',
      });
    case 'invitation_expired':
      throw new GoneException({
        statusCode: 410,
        error: 'gone',
        reasonCode: reason,
        message: 'Zaproszenie wygasło i nie może zostać użyte.',
      });
    case 'invitation_already_used':
    case 'invitation_rejected':
    case 'already_tenant_member':
    case 'membership_role_change_not_supported':
    case 'operation_conflict':
      throw new ConflictException({
        statusCode: 409,
        error: 'conflict',
        reasonCode: reason,
        message: 'Zaproszenie zostało już wykorzystane, odrzucone lub pozostaje w konflikcie z obecnym członkostwem.',
      });
    case 'invitation_revoked':
    case 'self_invitation_acceptance_forbidden':
    case 'inviter_authority_revoked':
    case 'grant_scope_not_delegable':
    case 'identity_revoked':
    case 'user_disabled':
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: reason,
        message: 'Przyjęcie lub odrzucenie zaproszenia zostało zablokowane ze względów bezpieczeństwa.',
      });
  }
}

@Controller('/api/v1')
@UseGuards(JwtBearerAuthGuard)
export class TenantInvitationsController {
  constructor(
    @Inject(IDENTITY_LIFECYCLE_STORE_PORT)
    private readonly identityLifecycleStore: IdentityLifecycleStorePort,
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
  ) {}

  @Post('/tenants/:tenantId/invitations')
  @RequireHumanApprovalScope()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  async createInvitation(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') rawTenantId: string,
    @Body() body: unknown,
  ): Promise<CreateTenantInvitationResponse> {
    const actor = requireRequestActor(request);
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      tenantId = parseTenantId(rawTenantId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'bad_request',
          reasonCode: 'invalid_tenant_id',
          message: 'Niepoprawny identyfikator organizacji (tenantId).',
        });
      }
      throw err;
    }

    const parsedBody = CreateTenantInvitationRequestSchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_invitation_input',
        message: parsedBody.error.issues[0]?.message ?? 'Niepoprawne dane zaproszenia.',
      });
    }

    const now = new Date();
    const expiresInHours = parsedBody.data.expiresInHours ?? DEFAULT_INVITATION_EXPIRES_IN_HOURS;
    const expiresAt = new Date(now.getTime() + expiresInHours * 3_600_000);
    const rawToken = generateOpaqueInvitationToken();
    const tokenSha256 = hashInvitationTokenSha256(rawToken);
    const operationId = resolveOperationId(parsedBody.data.operationId, actor.idempotencyKey);

    let result;
    try {
      result = await this.identityLifecycleStore.createTenantInvitation({
        operationId,
        actorUserId: actor.userId,
        tenantId,
        tokenSha256,
        inviteeEmail: parsedBody.data.inviteeEmail,
        inviteeDisplayName: parsedBody.data.inviteeDisplayName,
        intendedRole: parsedBody.data.intendedRole,
        initialCompanyGrants: parsedBody.data.initialCompanyGrants ?? [],
        reason: parsedBody.data.reason,
        expiresAt,
        now,
      });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn zaproszeń jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!result.ok) {
      throwCreateInvitationError(result.reason);
    }

    return CreateTenantInvitationResponseSchema.parse({
      invitation: result.invitation,
      invitationToken: rawToken,
      acceptPath: `/login?invite=${encodeURIComponent(rawToken)}`,
      auditEventId: result.auditEventId,
    });
  }

  @Get('/tenants/:tenantId/invitations')
  @Header('Cache-Control', 'no-store')
  async listInvitations(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') rawTenantId: string,
  ): Promise<ListTenantInvitationsResponse> {
    const actor = requireRequestActor(request);
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      tenantId = parseTenantId(rawTenantId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'bad_request',
          reasonCode: 'invalid_tenant_id',
          message: 'Niepoprawny identyfikator organizacji (tenantId).',
        });
      }
      throw err;
    }

    let result;
    try {
      result = await this.identityLifecycleStore.listTenantInvitations({
        actorUserId: actor.userId,
        tenantId,
      });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn zaproszeń jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!result.ok) {
      if (result.reason === 'invalid_invitation_input') {
        throw new BadRequestException({
          statusCode: 400,
          error: 'bad_request',
          reasonCode: result.reason,
          message: 'Niepoprawne zapytanie o listę zaproszeń.',
        });
      }
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: result.reason,
        message: 'Brak uprawnień administracyjnych do podglądu zaproszeń w organizacji.',
      });
    }

    return ListTenantInvitationsResponseSchema.parse({
      tenantId: result.tenantId,
      invitations: result.invitations,
    });
  }

  @Post('/tenants/:tenantId/invitations/:invitationId/revoke')
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revokeInvitation(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') rawTenantId: string,
    @Param('invitationId') rawInvitationId: string,
    @Body() body: unknown,
  ): Promise<RevokeTenantInvitationResponse> {
    const actor = requireRequestActor(request);
    let tenantId: ReturnType<typeof parseTenantId>;
    try {
      tenantId = parseTenantId(rawTenantId);
    } catch (err) {
      if (err instanceof InvalidIdentifierError) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'bad_request',
          reasonCode: 'invalid_tenant_id',
          message: 'Niepoprawny identyfikator organizacji (tenantId).',
        });
      }
      throw err;
    }

    if (!UuidSelectorSchema.safeParse(rawInvitationId).success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_invitation_id',
        message: 'Niepoprawny identyfikator zaproszenia (invitationId).',
      });
    }

    const parsedBody = RevokeTenantInvitationRequestSchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_invitation_input',
        message: parsedBody.error.issues[0]?.message ?? 'Niepoprawne dane cofnięcia zaproszenia.',
      });
    }

    const operationId = resolveOperationId(parsedBody.data.operationId, actor.idempotencyKey);
    let result;
    try {
      result = await this.identityLifecycleStore.revokeTenantInvitation({
        operationId,
        actorUserId: actor.userId,
        tenantId,
        invitationId: rawInvitationId,
        reason: parsedBody.data.reason,
      });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn zaproszeń jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!result.ok) {
      throwRevokeInvitationError(result.reason);
    }

    return RevokeTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: result.invitation,
      auditEventId: result.auditEventId,
    });
  }

  @Post('/invitations/accept')
  @AllowUnprovisionedOidcForInvitation()
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async acceptInvitation(
    @Req() request: JwtAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<AcceptTenantInvitationResponse> {
    const caller = requireInvitationCallerIdentity(request);
    const parsedBody = AcceptTenantInvitationRequestSchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_invitation_input',
        message: parsedBody.error.issues[0]?.message ?? 'Niepoprawny token zaproszenia.',
      });
    }

    const tokenSha256 = hashInvitationTokenSha256(parsedBody.data.invitationToken.trim());
    const operationId = resolveOperationId(parsedBody.data.operationId, caller.idempotencyKey);

    let result;
    try {
      result = await this.identityLifecycleStore.acceptTenantInvitation({
        operationId,
        tokenSha256,
        actorUserId: caller.actorUserId,
        issuer: caller.issuer,
        subject: caller.subject,
        displayName: parsedBody.data.displayName ?? caller.displayName,
        email: caller.email,
      });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn zaproszeń jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!result.ok) {
      throwAcceptOrRejectInvitationError(result.reason);
    }

    const canonicalUserId = parseUserId(result.userId);
    if (!this.workspace.store.getUserById(canonicalUserId)) {
      this.workspace.store.upsertUser({
        userId: canonicalUserId,
        issuer: caller.issuer,
        subject: caller.subject,
        displayName: normalizeSessionDisplayName(
          parsedBody.data.displayName ?? caller.displayName ?? result.invitation.inviteeDisplayName,
          caller.subject,
        ),
        email: normalizeSessionSafeEmail(caller.email),
        active: true,
      });
    }
    if (this.workspace.syncActorFromPostgres) {
      await this.workspace
        .syncActorFromPostgres(result.userId, result.invitation.tenantId)
        .catch(() => undefined);
    }

    return AcceptTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: result.invitation,
      membership: result.membership,
      grantedCompanyIds: result.grantedCompanyIds,
      auditEventId: result.auditEventId,
    });
  }

  @Post('/invitations/reject')
  @AllowUnprovisionedOidcForInvitation()
  @RequireHumanApprovalScope()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async rejectInvitation(
    @Req() request: JwtAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<RejectTenantInvitationResponse> {
    const caller = requireInvitationCallerIdentity(request);
    const parsedBody = RejectTenantInvitationRequestSchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        reasonCode: 'invalid_invitation_input',
        message: parsedBody.error.issues[0]?.message ?? 'Niepoprawne dane odrzucenia zaproszenia.',
      });
    }

    const tokenSha256 = hashInvitationTokenSha256(parsedBody.data.invitationToken.trim());
    const operationId = resolveOperationId(undefined, caller.idempotencyKey);

    let result;
    try {
      result = await this.identityLifecycleStore.rejectTenantInvitation({
        operationId,
        tokenSha256,
        actorUserId: caller.actorUserId,
        issuer: caller.issuer,
        subject: caller.subject,
        displayName: caller.displayName,
        email: caller.email,
        reason: parsedBody.data.reason,
      });
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Magazyn zaproszeń jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!result.ok) {
      throwAcceptOrRejectInvitationError(result.reason);
    }

    const canonicalUserId = parseUserId(result.userId);
    if (!this.workspace.store.getUserById(canonicalUserId)) {
      this.workspace.store.upsertUser({
        userId: canonicalUserId,
        issuer: caller.issuer,
        subject: caller.subject,
        displayName: normalizeSessionDisplayName(caller.displayName, caller.subject),
        email: normalizeSessionSafeEmail(caller.email),
        active: true,
      });
    }

    return RejectTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: result.invitation,
      auditEventId: result.auditEventId,
    });
  }
}
