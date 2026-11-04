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
  type AccountingWorkspaceService,
  type OidcAccessTokenVerifier,
  type SecurityAuditRecorder,
  type WorkspaceActorContext,
} from '@pap/application';
import { userId as parseUserId } from '@pap/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ACCOUNTING_WORKSPACE_SERVICE } from '../runtime/workspace-runtime.js';
import { OIDC_ACCESS_TOKEN_VERIFIER, SECURITY_AUDIT_RECORDER } from './company-access.guard.js';

export const OPTIONAL_JWT_AUTH_KEY = 'pap:optional_jwt_auth';
export const OptionalJwtAuth = () => SetMetadata(OPTIONAL_JWT_AUTH_KEY, true);

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
    private readonly workspace: AccountingWorkspaceService,
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
      await this.recordDenial(requestId, params, 'authentication_failed');
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: 'identity_not_provisioned',
        message: 'Uwierzytelniona tożsamość OIDC nie posiada aktywnego konta w platformie.',
      });
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
    reason: 'transport_rejected' | 'authentication_failed',
  ): Promise<void> {
    await this.securityAudit.recordDecision({
      requestId,
      actorId: null,
      tenantId: auditIdentifier(params.tenantId),
      legalEntityId: auditIdentifier(params.legalEntityId),
      action: 'unknown',
      kind: 'transport',
      decision: 'deny',
      outcome: 'denied',
      reason,
    });
  }
}
