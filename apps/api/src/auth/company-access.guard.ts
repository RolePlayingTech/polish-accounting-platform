import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  authorizeAuthenticatedCompanyAction,
  systemClock,
  type AuthenticatedCompanyActionContext,
  type Clock,
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

export const COMPANY_ACTION_METADATA_KEY = 'pap:require_company_action';

export interface RequireCompanyActionMetadata {
  readonly action: AccountingAction;
  readonly requiredScopes?: readonly string[] | undefined;
}

export const RequireCompanyAction = (metadata: RequireCompanyActionMetadata) =>
  SetMetadata(COMPANY_ACTION_METADATA_KEY, Object.freeze({ ...metadata }));

export interface AuthenticatedFastifyRequest extends FastifyRequest {
  papCompanyAuthContext?: AuthenticatedCompanyActionContext;
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
 * Serwerowy guard NestJS/Fastify łączący uwierzytelnienie OIDC, rozwiązanie wewnętrznego userId
 * i autoryzację akcji na firmie (authorizeCompanyAction).
 * Ignoruje wszelkie próby przekazania userId/roli w body lub query, a próby spoofingu nagłówków odrzuca.
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
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        message: 'Brak uprawnień do wykonania operacji.',
      });
    }

    if (hasUntrustedIdentitySignal(request)) {
      reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        message: 'Wymagane poprawne uwierzytelnienie OIDC.',
      });
    }

    const rawBearerToken = extractBearerTokenFromHeaders(request.headers);
    if (!rawBearerToken) {
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
      },
    );

    if (!decision.allowed) {
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
