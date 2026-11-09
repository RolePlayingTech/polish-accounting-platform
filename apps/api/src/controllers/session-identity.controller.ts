import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Inject,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import {
  buildAuthenticatedSessionView,
  type IdentityLifecycleStorePort,
} from '@pap/application';
import type { AuthenticatedSessionView } from '@pap/contracts';
import {
  JwtBearerAuthGuard,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import { SandboxOidcService } from '../auth/sandbox-oidc.service.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  IDENTITY_LIFECYCLE_STORE_PORT,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';

function decodeTokenExpIsoFallback(rawBearerToken: string | undefined, now: Date): string {
  if (rawBearerToken) {
    const parts = rawBearerToken.split('.');
    const payloadSeg = parts[1];
    if (parts.length === 3 && payloadSeg) {
      try {
        const parsed = JSON.parse(Buffer.from(payloadSeg, 'base64url').toString('utf8')) as Record<
          string,
          unknown
        >;
        if (typeof parsed['exp'] === 'number' && Number.isFinite(parsed['exp'])) {
          return new Date(parsed['exp'] * 1000).toISOString();
        }
      } catch {
        // Ignoruj — poniżej bezpieczny fallback czasowy.
      }
    }
  }
  return new Date(now.getTime() + 300_000).toISOString();
}

@Controller('/api/v1')
@UseGuards(JwtBearerAuthGuard)
export class SessionIdentityController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
    @Inject(IDENTITY_LIFECYCLE_STORE_PORT)
    private readonly identityLifecycleStore: IdentityLifecycleStorePort,
    @Inject(SandboxOidcService)
    private readonly sandboxOidc: SandboxOidcService,
  ) {}

  @Get('/me/session')
  @Header('Cache-Control', 'no-store')
  async getMySession(
    @Req() request: JwtAuthenticatedRequest,
    @Query('tenantId') requestedTenantId?: string,
    @Query('legalEntityId') requestedLegalEntityId?: string,
    @Query('period') requestedPeriod?: string,
  ): Promise<AuthenticatedSessionView> {
    const actor = requireRequestActor(request);
    const now = new Date();

    let directory;
    try {
      directory = await this.identityLifecycleStore.getActorSessionDirectory(actor.userId, now);
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'service_unavailable',
        reasonCode: 'auth_service_unavailable',
        message: 'Katalog tożsamości i członkostw jest chwilowo niedostępny (fail-closed).',
      });
    }

    if (!directory.ok) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'forbidden',
        reasonCode: 'inactive_user_account',
        message: 'Konto użytkownika jest nieaktywne lub zablokowane.',
      });
    }

    const myCompanies = await this.workspace.getMyCompanies(actor);
    const authMethod =
      this.sandboxOidc.isEnabled() && actor.issuer === this.sandboxOidc.getIssuer()
        ? 'sandbox_persona'
        : 'oidc';

    const accessTokenExpiresAt = decodeTokenExpIsoFallback(actor.rawBearerToken, now);
    const sessionExpiresAt = new Date(now.getTime() + 28_800_000).toISOString();

    return buildAuthenticatedSessionView({
      authMethod,
      userId: actor.userId,
      issuer: actor.issuer ?? 'https://unknown-issuer.invalid',
      subject: actor.subject ?? actor.userId,
      displayName: directory.profile?.displayName ?? actor.displayName ?? actor.userId,
      email: directory.profile?.email ?? actor.email ?? 'uzytkownik@pap.example',
      memberships: directory.memberships,
      companies: myCompanies.companies,
      requestedTenantId: requestedTenantId ?? null,
      requestedLegalEntityId: requestedLegalEntityId ?? null,
      requestedPeriod: requestedPeriod ?? null,
      sessionExpiresAt,
      accessTokenExpiresAt,
    });
  }
}
