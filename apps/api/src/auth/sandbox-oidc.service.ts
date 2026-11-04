import { Injectable, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountingWorkspaceAccessError,
  AccountingWorkspaceValidationError,
  resolveDemoPersonaSeed,
  systemClock,
  type AccountingWorkspaceService,
  type Clock,
} from '@pap/application';
import {
  IssueSandboxTokenRequestSchema,
  IssueSandboxTokenResponseSchema,
  OidcDiscoveryDocumentSchema,
  type IssueSandboxTokenResponse,
  type ListSandboxPersonasResponse,
  type OidcDiscoveryDocument,
} from '@pap/contracts';
import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from 'jose';
import type { OidcVerifierConfig } from './oidc-config.js';

export const DEFAULT_SANDBOX_OIDC_ISSUER = 'http://127.0.0.1:4000' as const;
export const DEFAULT_SANDBOX_OIDC_AUDIENCE = 'pap-api' as const;
export const SANDBOX_SIGNING_KEY_ID = 'pap-sandbox-es256-v1' as const;
const SANDBOX_TOKEN_TTL_SECONDS = 3_600;
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;
const SAFE_SCOPE_PATTERN = /^[A-Za-z0-9:._-]+$/;

function resolveSandboxEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.PAP_OIDC_ENV === 'staging') {
    return false;
  }
  return env.PAP_SANDBOX_AUTH_ENABLED === 'true';
}

function resolveCanonicalSandboxIssuer(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env.PAP_SANDBOX_OIDC_ISSUER?.trim() || env.PAP_OIDC_ISSUER?.trim();
  if (configured && configured.length > 0) {
    return configured.endsWith('/') ? configured.slice(0, -1) : configured;
  }
  return DEFAULT_SANDBOX_OIDC_ISSUER;
}

function resolveSafeLoopbackOriginFromHost(
  hostHeader: string | undefined,
  fallback: string,
): string {
  if (!hostHeader) {
    return fallback;
  }
  const trimmed = hostHeader.trim();
  if (
    /^127\.0\.0\.1(:\d{1,5})?$/.test(trimmed) ||
    /^localhost(:\d{1,5})?$/i.test(trimmed) ||
    /^\[::1\](:\d{1,5})?$/.test(trimmed)
  ) {
    return `http://${trimmed}`;
  }
  return fallback;
}

interface SandboxSigningKeyMaterial {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
  readonly jwksDocument: { readonly keys: readonly JWK[] };
}

@Injectable()
export class SandboxOidcService implements OnModuleInit {
  private readonly enabled: boolean;
  private readonly issuer: string;
  private readonly audience: string;
  private readonly clock: Clock;
  private keyMaterialPromise: Promise<SandboxSigningKeyMaterial> | null = null;

  constructor(
    env: Readonly<Record<string, string | undefined>> = process.env,
    clock: Clock = systemClock,
  ) {
    this.enabled = resolveSandboxEnabled(env);
    this.issuer = resolveCanonicalSandboxIssuer(env);
    this.audience = env.PAP_OIDC_AUDIENCE?.split(',')[0]?.trim() || DEFAULT_SANDBOX_OIDC_AUDIENCE;
    this.clock = clock;
  }

  async onModuleInit(): Promise<void> {
    if (this.enabled) {
      await this.ensureKeyMaterial();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getIssuer(): string {
    return this.issuer;
  }

  getAudience(): string {
    return this.audience;
  }

  buildVerifierConfig(): OidcVerifierConfig {
    return Object.freeze({
      environment: 'local',
      issuer: this.issuer,
      jwksUri: `${this.issuer}/api/v1/auth/sandbox/jwks.json`,
      audience: this.audience,
      audiences: Object.freeze([this.audience]),
      allowedAlgorithms: Object.freeze(['ES256'] as const),
      allowedTokenHeaderTypes: Object.freeze(['at+jwt', 'jwt']),
      allowedAuthorizedParties: null,
      requiredScopes: Object.freeze(['openid']),
      clockToleranceSeconds: 30,
      maxTokenAgeSeconds: 3_600,
      jwksCacheTtlMs: 300_000,
      jwksRefreshCooldownMs: 10_000,
      jwksFetchTimeoutMs: 5_000,
    });
  }

  async getJwksDocument(): Promise<{ readonly keys: readonly JWK[] }> {
    const material = await this.ensureKeyMaterial();
    return material.jwksDocument;
  }

  getDiscoveryDocument(hostHeader?: string): OidcDiscoveryDocument {
    const endpointOrigin = resolveSafeLoopbackOriginFromHost(hostHeader, this.issuer);
    return OidcDiscoveryDocumentSchema.parse({
      issuer: this.issuer,
      jwks_uri: `${endpointOrigin}/api/v1/auth/sandbox/jwks.json`,
      token_endpoint: `${endpointOrigin}/api/v1/oidc/token`,
      response_types_supported: ['token'],
      grant_types_supported: ['urn:pap:params:oauth:grant-type:sandbox-persona'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [
        'openid',
        'profile',
        'email',
        'pap:ui:full',
        'pap:ui:accounting',
        'pap:accounting',
        'pap:mcp:read',
        'pap:mcp:prepare',
      ],
    });
  }

  listPersonas(workspace: AccountingWorkspaceService): ListSandboxPersonasResponse {
    return workspace.listSandboxPersonas(this.issuer);
  }

  async issueToken(
    workspace: AccountingWorkspaceService,
    rawBody: unknown,
  ): Promise<IssueSandboxTokenResponse> {
    const parsed = IssueSandboxTokenRequestSchema.parse(rawBody ?? {});
    const seed = resolveDemoPersonaSeed(parsed.personaId);
    if (!seed) {
      throw new AccountingWorkspaceAccessError(
        404,
        'persona_not_found',
        `Nieznana persona piaskownicy OIDC: ${parsed.personaId}.`,
      );
    }

    if (parsed.sub !== undefined && parsed.sub !== seed.userId && parsed.sub !== seed.subject) {
      throw new AccountingWorkspaceValidationError(
        400,
        'subject_persona_mismatch',
        'Wskazane pole sub nie odpowiada wybranej personie testowej.',
      );
    }

    const rawScopes = parsed.scopes ? [...parsed.scopes] : [...seed.defaultScopes];
    const normalizedScopes: string[] = [];
    for (const item of rawScopes) {
      const trimmed = item.trim();
      if (!SAFE_SCOPE_PATTERN.test(trimmed)) {
        throw new AccountingWorkspaceValidationError(
          400,
          'invalid_scope_format',
          `Niepoprawny format zakresu OIDC: ${trimmed}.`,
        );
      }
      if (!normalizedScopes.includes(trimmed)) {
        normalizedScopes.push(trimmed);
      }
    }
    if (!normalizedScopes.includes('openid')) {
      normalizedScopes.unshift('openid');
    }

    const material = await this.ensureKeyMaterial();
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const expSeconds = nowSeconds + SANDBOX_TOKEN_TTL_SECONDS;
    const scopeClaim = normalizedScopes.join(' ');

    const jwt = await new SignJWT({
      scope: scopeClaim,
      client_id: 'pap-sandbox-client',
      ...(parsed.period ? { pap_period: parsed.period } : {}),
    })
      .setProtectedHeader({
        alg: 'ES256',
        typ: 'at+jwt',
        kid: SANDBOX_SIGNING_KEY_ID,
      })
      .setIssuer(this.issuer)
      .setSubject(seed.userId)
      .setAudience(this.audience)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(expSeconds)
      .setJti(randomUUID())
      .sign(material.privateKey);

    const manifest = workspace.listSandboxPersonas(this.issuer);
    const persona = manifest.personas.find((p) => p.userId === seed.userId);
    if (!persona) {
      throw new AccountingWorkspaceAccessError(
        404,
        'persona_not_found',
        `Brak manifestu dla persony ${seed.personaId}.`,
      );
    }

    return IssueSandboxTokenResponseSchema.parse({
      accessToken: jwt,
      token: jwt,
      tokenType: 'Bearer',
      expiresIn: SANDBOX_TOKEN_TTL_SECONDS,
      expiresAt: new Date(expSeconds * 1000).toISOString(),
      issuer: this.issuer,
      scope: scopeClaim,
      persona,
    });
  }

  private ensureKeyMaterial(): Promise<SandboxSigningKeyMaterial> {
    if (!this.keyMaterialPromise) {
      this.keyMaterialPromise = (async () => {
        const { publicKey, privateKey } = await generateKeyPair('ES256');
        const exported = await exportJWK(publicKey);
        const sanitized: Record<string, unknown> = {
          ...exported,
          kid: SANDBOX_SIGNING_KEY_ID,
          alg: 'ES256',
          use: 'sig',
        };
        for (const field of PRIVATE_JWK_FIELDS) {
          delete sanitized[field];
        }
        const publicJwk = Object.freeze(sanitized) as JWK;
        const jwksDocument = Object.freeze({
          keys: Object.freeze([publicJwk]),
        });
        return { privateKey, publicJwk, jwksDocument };
      })();
    }
    return this.keyMaterialPromise;
  }
}
