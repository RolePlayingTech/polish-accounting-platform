import {
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import {
  auditIdentifier,
  type OidcAccessTokenVerifier,
  type SecurityAuditRecorder,
  type UserIdentityResolver,
  type WorkspaceActorContext,
} from '@pap/application';
import { userId as parseUserId } from '@pap/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  SECURITY_AUDIT_RECORDER,
  USER_IDENTITY_RESOLVER,
} from './company-access.guard.js';

export const OPTIONAL_JWT_AUTH_KEY = 'pap:optional_jwt_auth';
export const OptionalJwtAuth = () => SetMetadata(OPTIONAL_JWT_AUTH_KEY, true);

export const REQUIRE_HUMAN_APPROVAL_SCOPE_KEY = 'pap:require_human_approval_scope';
export const RequireHumanApprovalScope = () => SetMetadata(REQUIRE_HUMAN_APPROVAL_SCOPE_KEY, true);

const REST_READ_SCOPES = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
  'pap:api:read',
  'pap:api:write',
  'pap:mcp:read',
]);

const REST_WRITE_SCOPES = new Set([
  'pap:ui:full',
  'pap:ui:accounting',
  'pap:accounting',
  'pap:api:write',
]);

const HUMAN_APPROVAL_SCOPES = new Set(['pap:ui:full', 'pap:ui:accounting', 'pap:accounting']);

export interface JwtAuthenticatedRequest extends FastifyRequest {
  papRequestId?: string;
  papActor?: WorkspaceActorContext;
}

const FORBIDDEN_IDENTITY_SPOOF_HEADERS = [
  'x-user-id',
  'x-tenant-id',
  'x-legal-entity-id',
  'x-actor-id',
  'x-authenticated-user',
  'x-forwarded-user',
  'x-auth-request-user',
  'x-remote-user',
  'x-pap-user-id',
  'x-pap-actor-id',
  'x-pap-tenant-role',
  'x-pap-platform-role',
  'x-pap-role',
  'x-approved',
] as const;

const FORBIDDEN_TOKEN_QUERY_KEYS = ['access_token', 'token', 'bearer', 'id_token'] as const;

function hasSpoofedIdentitySignal(request: FastifyRequest): string | null {
  for (const headerName of FORBIDDEN_IDENTITY_SPOOF_HEADERS) {
    if (request.headers[headerName] !== undefined) {
      return `spoofed_header_${headerName}`;
    }
  }
  const query = request.query;
  if (typeof query === 'object' && query !== null) {
    for (const key of FORBIDDEN_TOKEN_QUERY_KEYS) {
      if (key in query) {
        return `query_token_${key}`;
      }
    }
  }
  return null;
}

function extractStrictBearer(headers: FastifyRequest['headers']): {
  readonly present: boolean;
  readonly token: string | null;
} {
  const rawAuth = headers.authorization;
  if (rawAuth === undefined) {
    return { present: false, token: null };
  }
  if (typeof rawAuth !== 'string') {
    return { present: true, token: null };
  }
  const trimmed = rawAuth.trim();
  if (trimmed.includes(',') || !trimmed.startsWith('Bearer ')) {
    return { present: true, token: null };
  }
  const token = trimmed.slice('Bearer '.length);
  if (token.length === 0 || /\s/.test(token)) {
    return { present: true, token: null };
  }
  return { present: true, token };
}

export function requireRequestActor(request: JwtAuthenticatedRequest): WorkspaceActorContext {
  if (!request.papActor) {
    throw new UnauthorizedException({
      statusCode: 401,
      error: 'unauthorized',
      reasonCode: 'missing_authenticated_actor',
      message: 'Wymagane poprawne uwierzytelnienie OIDC Bearer JWT.',
    });
  }
  return request.papActor;
}

@Injectable()
export class JwtBearerAuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(OIDC_ACCESS_TOKEN_VERIFIER)
    private readonly verifier: OidcAccessTokenVerifier,
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
    @Inject(USER_IDENTITY_RESOLVER)
    private readonly identityResolver: UserIdentityResolver,
    @Inject(SECURITY_AUDIT_RECORDER)
    private readonly securityAudit: SecurityAuditRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isOptional =
      this.reflector.getAllAndOverride<boolean | undefined>(OPTIONAL_JWT_AUTH_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;

    const http = context.switchToHttp();
    const request = http.getRequest<JwtAuthenticatedRequest>();
    const reply = http.getResponse<FastifyReply>();
    const requestId = (request.papRequestId ??= randomUUID());
    reply.header('x-request-id', requestId);

    const params = (request.params ?? {}) as Record<string, unknown>;
    const spoofReason = hasSpoofedIdentitySignal(request);
    if (spoofReason) {
      await this.recordDenial(requestId, params, 'transport_rejected');
      reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: spoofReason,
        message: 'Wykryto niedozwolony nagłówek lub parametr podszywania tożsamości.',
      });
    }

    const bearer = extractStrictBearer(request.headers);
    if (!bearer.present) {
      if (isOptional) {
        return true;
      }
      await this.recordDenial(requestId, params, 'transport_rejected');
      reply.header('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: 'missing_bearer_token',
        message: 'Wymagany nagłówek Authorization: Bearer <JWT>.',
      });
    }

    if (!bearer.token) {
      await this.recordDenial(requestId, params, 'transport_rejected');
      reply.header('WWW-Authenticate', 'Bearer error="invalid_request"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: 'malformed_authorization_header',
        message: 'Niepoprawny format nagłówka Authorization: Bearer <JWT>.',
      });
    }

    const verified = await this.verifier.verifyAccessToken(bearer.token);
    if (!verified.ok) {
      await this.recordDenial(requestId, params, 'authentication_failed');
      reply.header('WWW-Authenticate', 'Bearer error="invalid_token"');
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'unauthorized',
        reasonCode: verified.reason,
        message: 'Weryfikacja kryptograficzna tokena OIDC zakończyła się odmową.',
      });
    }

    const { identity } = verified;
    let resolvedUser = this.workspace.store.getUserBySubject(identity.subject);
    if (!resolvedUser) {
      try {
        resolvedUser = this.workspace.store.getUserById(parseUserId(identity.subject));
      } catch {
        resolvedUser = null;
      }
    }
    if (!resolvedUser) {
      const dbResolved = await this.identityResolver.resolveVerifiedIdentity(identity);
      if (dbResolved) {
        resolvedUser = {
          userId: dbResolved.userId,
          subject: identity.subject,
          displayName: identity.subject,
          email: 'uzytkownik@pap.local',
          active: true,
        };
      }
    }

    if (!resolvedUser) {
      await this.recordDenial(requestId, params, 'authentication_failed');
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: 'identity_not_provisioned',
        message: 'Uwierzytelniona tożsamość OIDC nie posiada aktywnego konta w platformie.',
      });
    }

    if (!resolvedUser.active) {
      await this.recordDenial(requestId, params, 'authentication_failed');
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: 'inactive_user_account',
        message: 'Konto użytkownika jest nieaktywne lub zablokowane.',
      });
    }

    if (!isOptional) {
      const requiresHumanApproval =
        this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_HUMAN_APPROVAL_SCOPE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) === true;
      const tokenScopes = identity.scopes ?? [];
      const method = request.method.toUpperCase();
      const isMutationMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

      if (
        (requiresHumanApproval || isMutationMethod) &&
        tokenScopes.includes('pap:mcp:agent_autonomous')
      ) {
        await this.recordDenial(
          requestId,
          params,
          'authorization_context_invalid',
          resolvedUser.userId,
        );
        throw new ForbiddenException({
          statusCode: 403,
          error: 'forbidden',
          reasonCode: 'agent_self_approval_forbidden',
          message:
            'Autonomiczny agent MCP (pap:mcp:agent_autonomous) nie może zatwierdzać propozycji ani wykonywać bezpośrednich mutacji REST API.',
        });
      }

      if (requiresHumanApproval) {
        if (!tokenScopes.some((s) => HUMAN_APPROVAL_SCOPES.has(s))) {
          await this.recordDenial(requestId, params, 'authentication_failed', resolvedUser.userId);
          reply.header('WWW-Authenticate', 'Bearer error="insufficient_scope"');
          throw new ForbiddenException({
            statusCode: 403,
            error: 'insufficient_scope',
            reasonCode: 'insufficient_scope',
            message:
              'Operacja zatwierdzania lub zarządzania grantami wymaga ludzkiego zakresu OIDC (pap:ui:full lub pap:ui:accounting).',
          });
        }
      } else if (isMutationMethod) {
        if (!tokenScopes.some((s) => REST_WRITE_SCOPES.has(s))) {
          await this.recordDenial(requestId, params, 'authentication_failed', resolvedUser.userId);
          reply.header('WWW-Authenticate', 'Bearer error="insufficient_scope"');
          throw new ForbiddenException({
            statusCode: 403,
            error: 'insufficient_scope',
            reasonCode: 'insufficient_scope',
            message:
              'Mutacje na trasach REST wymagają zakresu zapisu człowieka lub API (np. pap:ui:full, pap:ui:accounting lub pap:api:write).',
          });
        }
      } else if (!tokenScopes.some((s) => REST_READ_SCOPES.has(s))) {
        await this.recordDenial(requestId, params, 'authentication_failed', resolvedUser.userId);
        reply.header('WWW-Authenticate', 'Bearer error="insufficient_scope"');
        throw new ForbiddenException({
          statusCode: 403,
          error: 'insufficient_scope',
          reasonCode: 'insufficient_scope',
          message: 'Brak wymaganego zakresu OIDC do odczytu chronionych zasobów REST API.',
        });
      }
    }

    request.papActor = {
      userId: resolvedUser.userId,
      issuer: identity.issuer,
      subject: identity.subject,
      displayName: resolvedUser.displayName,
      email: resolvedUser.email,
      scopes: identity.scopes,
      rawBearerToken: bearer.token,
      requestId,
    };

    return true;
  }

  private async recordDenial(
    requestId: string,
    params: Record<string, unknown>,
    reason: 'transport_rejected' | 'authentication_failed' | 'authorization_context_invalid',
    actorId: ReturnType<typeof parseUserId> | null = null,
  ): Promise<void> {
    await this.securityAudit.recordDecision({
      requestId,
      actorId,
      tenantId: auditIdentifier(params.tenantId),
      legalEntityId: auditIdentifier(params.legalEntityId),
      action: 'unknown',
      kind: reason === 'transport_rejected' ? 'transport' : 'preflight',
      decision: 'deny',
      outcome: 'denied',
      reason,
    });
  }
}
