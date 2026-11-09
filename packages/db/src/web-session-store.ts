import { sql } from 'drizzle-orm';
import type {
  ConsumeOidcAuthStateDeniedReason,
  ConsumeOidcAuthStateResult,
  CreateOidcAuthStateInput,
  CreateWebBffSessionInput,
  CreateWebBffSessionResult,
  GetWebBffSessionResult,
  OidcAuthStateRecord,
  RotateWebBffSessionTokensInput,
  RotateWebBffSessionTokensResult,
  UpdateWebBffSessionContextInput,
  WebBffSessionDeniedReason,
  WebBffSessionRecord,
  WebSessionStorePort,
} from '@pap/application';
import type { connectDatabase } from './client.js';
import type { PostgresContextSigner } from './signed-context.js';

type SessionDatabase = Pick<ReturnType<typeof connectDatabase>['db'], 'transaction'>;

interface RawSqlSessionJson {
  readonly sessionIdHash: string;
  readonly userId: string;
  readonly issuer: string;
  readonly subject: string;
  readonly displayName: string;
  readonly email: string;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly period: string;
  readonly encryptedTokens: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshGeneration: number;
  readonly previousEncryptedTokens: string | null;
  readonly previousAccessTokenExpiresAt: string | null;
  readonly previousGraceUntil: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface RawSqlStateJson {
  readonly stateHash: string;
  readonly encryptedPayload: string;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

function parseSessionRecord(raw: RawSqlSessionJson): WebBffSessionRecord {
  return Object.freeze({
    sessionIdHash: String(raw.sessionIdHash),
    userId: String(raw.userId),
    issuer: String(raw.issuer),
    subject: String(raw.subject),
    displayName: String(raw.displayName),
    email: String(raw.email),
    tenantId: raw.tenantId ? String(raw.tenantId) : null,
    legalEntityId: raw.legalEntityId ? String(raw.legalEntityId) : null,
    period: String(raw.period),
    encryptedTokens: String(raw.encryptedTokens),
    accessTokenExpiresAt: new Date(raw.accessTokenExpiresAt),
    refreshGeneration: Number(raw.refreshGeneration),
    previousEncryptedTokens: raw.previousEncryptedTokens
      ? String(raw.previousEncryptedTokens)
      : null,
    previousAccessTokenExpiresAt: raw.previousAccessTokenExpiresAt
      ? new Date(raw.previousAccessTokenExpiresAt)
      : null,
    previousGraceUntil: raw.previousGraceUntil ? new Date(raw.previousGraceUntil) : null,
    expiresAt: new Date(raw.expiresAt),
    revokedAt: raw.revokedAt ? new Date(raw.revokedAt) : null,
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  });
}

function parseAuthStateRecord(raw: RawSqlStateJson): OidcAuthStateRecord {
  return Object.freeze({
    stateHash: String(raw.stateHash),
    encryptedPayload: String(raw.encryptedPayload),
    expiresAt: new Date(raw.expiresAt),
    consumedAt: raw.consumedAt ? new Date(raw.consumedAt) : null,
    createdAt: new Date(raw.createdAt),
  });
}

/**
 * Współdzielony, wieloinstancyjny magazyn sesji BFF i transakcji PKCE w PostgreSQL 18.6.
 * Działa pod nieuprzywilejowaną rolą `pap_*_app` (`NOBYPASSRLS`) wyłącznie przez kontrolowaną
 * funkcję `pap_bff_session_op(jsonb)` weryfikującą podpis HMAC `PostgresContextSigner`.
 */
export class PostgresWebSessionStore implements WebSessionStorePort {
  readonly #db: SessionDatabase;
  readonly #signer: PostgresContextSigner;

  constructor(db: SessionDatabase, signer: PostgresContextSigner) {
    this.#db = db;
    this.#signer = signer;
    Object.freeze(this);
  }

  async #executeOp(
    fullPayload: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.#db.transaction(async (tx) => {
        await this.#signer.apply(tx, {
          purpose: 'bff_session',
          command: fullPayload,
        });
        const [row] = await tx.execute<{ result: Record<string, unknown> | string }>(
          sql`SELECT pap_bff_session_op(${JSON.stringify(fullPayload)}::jsonb) AS result`,
        );
        const raw = row?.result;
        if (!raw) {
          throw new Error('Brak odpowiedzi magazynu sesji BFF w PostgreSQL.');
        }
        if (typeof raw === 'string') {
          return JSON.parse(raw) as Record<string, unknown>;
        }
        return raw;
      });
    } catch {
      throw new Error('Współdzielony magazyn sesji BFF w PostgreSQL jest niedostępny.');
    }
  }

  async createOidcAuthState(
    input: CreateOidcAuthStateInput,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
    const result = await this.#executeOp({
      kind: 'create_auth_state',
      stateHash: input.stateHash,
      encryptedPayload: input.encryptedPayload,
      expiresAtIso: input.expiresAt.toISOString(),
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: String(result['reason'] ?? 'invalid_auth_state_input'),
    };
  }

  async consumeOidcAuthState(input: {
    readonly stateHash: string;
    readonly now?: Date | undefined;
  }): Promise<ConsumeOidcAuthStateResult> {
    const result = await this.#executeOp({
      kind: 'consume_auth_state',
      stateHash: input.stateHash,
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true && result['state']) {
      return {
        ok: true,
        state: parseAuthStateRecord(result['state'] as RawSqlStateJson),
      };
    }

    return {
      ok: false,
      reason: (result['reason'] as ConsumeOidcAuthStateDeniedReason) ?? 'state_not_found',
    };
  }

  async createSession(input: CreateWebBffSessionInput): Promise<CreateWebBffSessionResult> {
    const result = await this.#executeOp({
      kind: 'create_session',
      sessionIdHash: input.sessionIdHash,
      userId: input.userId,
      issuer: input.issuer,
      subject: input.subject,
      displayName: input.displayName,
      email: input.email,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      period: input.period,
      encryptedTokens: input.encryptedTokens,
      accessTokenExpiresAtIso: input.accessTokenExpiresAt.toISOString(),
      expiresAtIso: input.expiresAt.toISOString(),
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true && result['session']) {
      return {
        ok: true,
        session: parseSessionRecord(result['session'] as RawSqlSessionJson),
      };
    }

    return {
      ok: false,
      reason: (result['reason'] as WebBffSessionDeniedReason) ?? 'invalid_session_input',
    };
  }

  async getSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<GetWebBffSessionResult> {
    const result = await this.#executeOp({
      kind: 'get_session',
      sessionIdHash: input.sessionIdHash,
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true && result['session']) {
      return {
        ok: true,
        session: parseSessionRecord(result['session'] as RawSqlSessionJson),
      };
    }

    return {
      ok: false,
      reason: (result['reason'] as WebBffSessionDeniedReason) ?? 'session_not_found',
    };
  }

  async updateSessionContext(
    input: UpdateWebBffSessionContextInput,
  ): Promise<GetWebBffSessionResult> {
    const result = await this.#executeOp({
      kind: 'update_session_context',
      sessionIdHash: input.sessionIdHash,
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      period: input.period,
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true && result['session']) {
      return {
        ok: true,
        session: parseSessionRecord(result['session'] as RawSqlSessionJson),
      };
    }

    return {
      ok: false,
      reason: (result['reason'] as WebBffSessionDeniedReason) ?? 'session_not_found',
    };
  }

  async rotateSessionTokens(
    input: RotateWebBffSessionTokensInput,
  ): Promise<RotateWebBffSessionTokensResult> {
    const result = await this.#executeOp({
      kind: 'rotate_session_tokens',
      sessionIdHash: input.sessionIdHash,
      expectedGeneration: input.expectedGeneration,
      encryptedTokens: input.encryptedTokens,
      accessTokenExpiresAtIso: input.accessTokenExpiresAt.toISOString(),
      ...(input.sessionExpiresAt
        ? { sessionExpiresAtIso: input.sessionExpiresAt.toISOString() }
        : {}),
      ...(input.gracePeriodMs !== undefined ? { gracePeriodMs: input.gracePeriodMs } : {}),
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    if (result['ok'] === true && result['session']) {
      return {
        ok: true,
        rotated: result['rotated'] === true,
        alreadyAdvanced: result['alreadyAdvanced'] === true,
        session: parseSessionRecord(result['session'] as RawSqlSessionJson),
      };
    }

    return {
      ok: false,
      reason: (result['reason'] as WebBffSessionDeniedReason) ?? 'session_not_found',
    };
  }

  async revokeSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revoked: boolean }> {
    const result = await this.#executeOp({
      kind: 'revoke_session',
      sessionIdHash: input.sessionIdHash,
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    return {
      ok: true,
      revoked: result['revoked'] === true,
    };
  }

  async revokeAllSessionsForUser(input: {
    readonly userId: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revokedCount: number }> {
    const result = await this.#executeOp({
      kind: 'revoke_user_sessions',
      userId: input.userId,
      ...(input.now ? { nowIso: input.now.toISOString() } : {}),
    });

    return {
      ok: true,
      revokedCount: Number(result['revokedCount'] ?? 0),
    };
  }
}
