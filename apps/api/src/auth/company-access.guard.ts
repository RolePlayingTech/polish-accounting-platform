import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import {
  authorizeAuthenticatedCompanyAction,
  executeAuthorizedCompanyAction,
  systemClock,
  auditIdentifier,
  type SecurityAuditRecorder,
  type AuthenticatedCompanyActionContext,
  type Clock,
  type CompanyActionTransactionContext,
  type ExecuteAuthorizedCompanyActionDependencies,
  type OidcAccessTokenVerifier,
  type TenantAuthorizationDataSource,
  type UserIdentityResolver,
} from '@pap/application';
import type { AccountingAction } from '@pap/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const OIDC_ACCESS_TOKEN_VERIFIER = Symbol('OIDC_ACCESS_TOKEN_VERIFIER');
export const USER_IDENTITY_RESOLVER = Symbol('USER_IDENTITY_RESOLVER');
export const TENANT_AUTHORIZATION_DATA_SOURCE = Symbol('TENANT_AUTHORIZATION_DATA_SOURCE');
export const AUTHORIZATION_CLOCK = Symbol('AUTHORIZATION_CLOCK');
export const SECURITY_AUDIT_RECORDER = Symbol('SECURITY_AUDIT_RECORDER');

export const COMPANY_ACTION_METADATA_KEY = 'pap:require_company_action';

export interface RequireCompanyActionMetadata {
  readonly action: AccountingAction;
  readonly requiredScopes?: readonly string[] | undefined;
}

export const RequireCompanyAction = (metadata: RequireCompanyActionMetadata) =>
  SetMetadata(COMPANY_ACTION_METADATA_KEY, Object.freeze({ ...metadata }));

export interface AuthenticatedFastifyRequest extends FastifyRequest {
  papRequestId?: string;
  papCompanyAuthContext?: AuthenticatedCompanyActionContext;
}

function serverRequestId(request: AuthenticatedFastifyRequest, reply: FastifyReply): string {
  const id = (request.papRequestId ??= randomUUID());
  reply.header('x-request-id', id);
  return id;
}

async function auditTransportDenial(
  request: AuthenticatedFastifyRequest,
  reply: FastifyReply,
  audit: SecurityAuditRecorder,
  action: AccountingAction | 'unknown',
): Promise<void> {
  const params = (request.params ?? {}) as Record<string, unknown>;
  try {
    await audit.recordDecision({
      requestId: serverRequestId(request, reply),
      actorId: null,
      tenantId: auditIdentifier(params.tenantId),
      legalEntityId: auditIdentifier(params.legalEntityId),
      action,
      kind: 'transport',
      decision: 'deny',
      outcome: 'denied',
      reason: 'transport_rejected',
    });
  } catch {
    throw new ServiceUnavailableException('Audyt bezpieczeństwa jest niedostępny.');
  }
}

/**
 * Nagłówki, których obecność oznacza próbę ominięcia serwerowej weryfikacji OIDC
 * lub wstrzyknięcia tożsamości przez niezaufanego klienta/proxy.
 */
const UNTRUSTED_IDENTITY_HEADERS = [
  'x-user-id',
  'x-authenticated-user',
  'x-forwarded-user',
  'x-auth-request-user',
  'x-remote-user',
  'x-pap-user-id',
  'x-pap-actor-id',
  'x-pap-tenant-role',
  'x-pap-platform-role',
] as const;

export function hasUntrustedIdentitySignal(request: FastifyRequest): boolean {
  const headers = request.headers;
  for (const headerName of UNTRUSTED_IDENTITY_HEADERS) {
    if (headers[headerName] !== undefined) {
      return true;
    }
  }

  const query = request.query;
  if (typeof query === 'object' && query !== null && 'access_token' in query) {
    return true;
  }

  return false;
}

export function extractBearerTokenFromHeaders(headers: FastifyRequest['headers']): string | null {
  const rawAuth = headers.authorization;
  if (typeof rawAuth !== 'string') {
    return null;
  }
  const trimmed = rawAuth.trim();
  if (!trimmed.startsWith('Bearer ')) {
    return null;
  }
  const token = trimmed.slice('Bearer '.length);
  if (token.length === 0 || /\s/.test(token)) {
    return null;
  }
  return token;
}

/**
 * Serwerowy guard NestJS/Fastify pełniący funkcję wczesnej bramki transportowej HTTP (400/401/403).
 * UWAGA (6D-3A): Krytyczne operacje odczytu i zapisu danych firmowych oraz administracji dostępem
 * nie mogą opierać bezpieczeństwa wyłącznie na wcześniejszym wyniku guarda w pamięci żądania —
 * muszą wykonywać autoryzację i operację DB w jednej transakcji przez `executeHttpAuthorizedCompanyAction`
 * (`executeAuthorizedCompanyAction`) lub `manageAccess`.
 */
@Injectable()
export class CompanyActionAuthorizationGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
    @Inject(TENANT_AUTHORIZATION_DATA_SOURCE)
    private readonly authorizationDataSource: TenantAuthorizationDataSource,
    @Inject(SECURITY_AUDIT_RECORDER)
    private readonly securityAudit: SecurityAuditRecorder,
    @Optional()
    @Inject(AUTHORIZATION_CLOCK)
    private readonly clock: Clock = systemClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.getAllAndOverride<RequireCompanyActionMetadata | undefined>(
      COMPANY_ACTION_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedFastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    if (!metadata) {
      await auditTransportDenial(request, reply, this.securityAudit, 'unknown');
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        message: 'Brak uprawnień do wykonania operacji.',
      });
    }

    if (hasUntrustedIdentitySignal(request)) {
      await auditTransportDenial(request, reply, this.securityAudit, metadata.action);
      reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        message: 'Wymagane poprawne uwierzytelnienie OIDC.',
      });
    }

    const rawBearerToken = extractBearerTokenFromHeaders(request.headers);
    if (!rawBearerToken) {
      await auditTransportDenial(request, reply, this.securityAudit, metadata.action);
      reply.header('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        message: 'Wymagane poprawne uwierzytelnienie OIDC.',
      });
    }

    const params = (request.params ?? {}) as Record<string, unknown>;
    const rawTenantId = typeof params.tenantId === 'string' ? params.tenantId : '';
    const rawLegalEntityId = typeof params.legalEntityId === 'string' ? params.legalEntityId : '';

    const decision = await authorizeAuthenticatedCompanyAction(
      {
        rawBearerToken,
        requestId: serverRequestId(request, reply),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        action: metadata.action,
        requiredScopes: metadata.requiredScopes,
      },
      {
        verifier: this.verifier,
        identityResolver: this.identityResolver,
        authorizationDataSource: this.authorizationDataSource,
        clock: this.clock,
        securityAudit: this.securityAudit,
      },
    );

    if (!decision.allowed) {
      if (decision.reason === 'authorization_audit_unavailable') {
        throw new ServiceUnavailableException('Audyt bezpieczeństwa jest niedostępny.');
      }
      if (decision.status === 'unauthenticated') {
        reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
        throw new UnauthorizedException({
          statusCode: 401,
          error: 'unauthorized',
          message: 'Wymagane poprawne uwierzytelnienie OIDC.',
        });
      }

      if (decision.status === 'invalid_selector') {
        throw new BadRequestException({
          statusCode: 400,
          error: 'bad_request',
          message: 'Niepoprawny identyfikator zasobu.',
        });
      }

      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        message: 'Brak uprawnień do wykonania operacji.',
      });
    }

    request.papCompanyAuthContext = decision.context;
    return true;
  }
}

/**
 * Transakcyjny helper HTTP (6D-3A) łączący ekstrakcję Bearer JWT i ochronę przed spoofingiem nagłówków
 * z `executeAuthorizedCompanyAction` (jedna transakcja UnitOfWork dla autoryzacji, kontekstu sesji i operacji DB).
 */
export async function executeHttpAuthorizedCompanyAction<
  TOutput,
  TTx extends CompanyActionTransactionContext = CompanyActionTransactionContext,
>(
  request: AuthenticatedFastifyRequest,
  reply: FastifyReply,
  metadata: RequireCompanyActionMetadata,
  dependencies: ExecuteAuthorizedCompanyActionDependencies<TTx>,
  operation: (context: AuthenticatedCompanyActionContext, tx: TTx) => Promise<TOutput>,
): Promise<TOutput> {
  if (hasUntrustedIdentitySignal(request)) {
    await auditTransportDenial(
      request,
      reply,
      { recordDecision: (event) => dependencies.unitOfWork.recordDeniedDecision(event) },
      metadata.action,
    );
    reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'unauthorized',
      message: 'Wymagane poprawne uwierzytelnienie OIDC.',
    });
  }

  const rawBearerToken = extractBearerTokenFromHeaders(request.headers);
  if (!rawBearerToken) {
    await auditTransportDenial(
      request,
      reply,
      { recordDecision: (event) => dependencies.unitOfWork.recordDeniedDecision(event) },
      metadata.action,
    );
    reply.header('WWW-Authenticate', 'Bearer');
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'unauthorized',
      message: 'Wymagane poprawne uwierzytelnienie OIDC.',
    });
  }

  const params = (request.params ?? {}) as Record<string, unknown>;
  const rawTenantId = typeof params.tenantId === 'string' ? params.tenantId : '';
  const rawLegalEntityId = typeof params.legalEntityId === 'string' ? params.legalEntityId : '';

  const decision = await executeAuthorizedCompanyAction(
    {
      rawBearerToken,
      requestId: serverRequestId(request, reply),
      tenantId: rawTenantId,
      legalEntityId: rawLegalEntityId,
      action: metadata.action,
      requiredScopes: metadata.requiredScopes,
    },
    dependencies,
    operation,
  );

  if (!decision.allowed) {
    if (decision.reason === 'authorization_audit_unavailable') {
      throw new ServiceUnavailableException('Audyt bezpieczeństwa jest niedostępny.');
    }
    if (decision.status === 'unauthenticated') {
      reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        message: 'Wymagane poprawne uwierzytelnienie OIDC.',
      });
    }

    if (decision.status === 'invalid_selector') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'bad_request',
        message: 'Niepoprawny identyfikator zasobu.',
      });
    }

    throw new ForbiddenException({
      statusCode: 403,
      error: 'forbidden',
      message: 'Brak uprawnień do wykonania operacji.',
    });
  }

  request.papCompanyAuthContext = decision.context;
  return decision.data;
}
