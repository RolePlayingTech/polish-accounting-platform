import { systemClock, type Clock } from './tenant-authorization.js';

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;
const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TAX_PERIOD_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface OidcAuthStateRecord {
  readonly stateHash: string;
  readonly encryptedPayload: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export interface CreateOidcAuthStateInput {
  readonly stateHash: string;
  readonly encryptedPayload: string;
  readonly expiresAt: Date;
  readonly now?: Date | undefined;
}

export type ConsumeOidcAuthStateDeniedReason =
  | 'invalid_state_hash'
  | 'state_not_found'
  | 'state_already_consumed'
  | 'state_expired';

export type ConsumeOidcAuthStateResult =
  | { readonly ok: true; readonly state: OidcAuthStateRecord }
  | { readonly ok: false; readonly reason: ConsumeOidcAuthStateDeniedReason };

export interface WebBffSessionRecord {
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
  readonly accessTokenExpiresAt: Date;
  readonly refreshGeneration: number;
  readonly previousEncryptedTokens: string | null;
  readonly previousAccessTokenExpiresAt: Date | null;
  readonly previousGraceUntil: Date | null;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateWebBffSessionInput {
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
  readonly accessTokenExpiresAt: Date;
  readonly expiresAt: Date;
  readonly now?: Date | undefined;
}

export type WebBffSessionDeniedReason =
  | 'invalid_session_input'
  | 'session_already_exists'
  | 'session_not_found'
  | 'session_revoked'
  | 'session_expired'
  | 'user_disabled_or_identity_revoked'
  | 'generation_conflict';

export type CreateWebBffSessionResult =
  | { readonly ok: true; readonly session: WebBffSessionRecord }
  | { readonly ok: false; readonly reason: WebBffSessionDeniedReason };

export type GetWebBffSessionResult =
  | { readonly ok: true; readonly session: WebBffSessionRecord }
  | { readonly ok: false; readonly reason: WebBffSessionDeniedReason };

export interface UpdateWebBffSessionContextInput {
  readonly sessionIdHash: string;
  readonly tenantId: string | null;
  readonly legalEntityId: string | null;
  readonly period: string;
  readonly now?: Date | undefined;
}

export interface RotateWebBffSessionTokensInput {
  readonly sessionIdHash: string;
  readonly expectedGeneration: number;
  readonly encryptedTokens: string;
  readonly accessTokenExpiresAt: Date;
  readonly sessionExpiresAt?: Date | undefined;
  readonly gracePeriodMs?: number | undefined;
  readonly now?: Date | undefined;
}

export type RotateWebBffSessionTokensResult =
  | {
      readonly ok: true;
      readonly rotated: boolean;
      readonly alreadyAdvanced: boolean;
      readonly session: WebBffSessionRecord;
    }
  | { readonly ok: false; readonly reason: WebBffSessionDeniedReason };

/**
 * Port współdzielonego, trwałego magazynu sesji aplikacyjnych BFF oraz stanów transakcji OIDC PKCE.
 * Przechowuje wyłącznie skróty SHA-256 identyfikatorów ciasteczek/stanów oraz zaszyfrowane pakiety tokenów.
 */
export interface WebSessionStorePort {
  createOidcAuthState(
    input: CreateOidcAuthStateInput,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>;

  consumeOidcAuthState(input: {
    readonly stateHash: string;
    readonly now?: Date | undefined;
  }): Promise<ConsumeOidcAuthStateResult>;

  createSession(input: CreateWebBffSessionInput): Promise<CreateWebBffSessionResult>;

  getSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<GetWebBffSessionResult>;

  updateSessionContext(input: UpdateWebBffSessionContextInput): Promise<GetWebBffSessionResult>;

  rotateSessionTokens(
    input: RotateWebBffSessionTokensInput,
  ): Promise<RotateWebBffSessionTokensResult>;

  revokeSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revoked: boolean }>;

  revokeAllSessionsForUser(input: {
    readonly userId: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revokedCount: number }>;
}

function isValidSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_REGEX.test(value);
}

function isValidFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isValidNonBlankTrimmed(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value === value.trim() &&
    value.length <= maxLength
  );
}

function isValidOptionalUuid(value: string | null): boolean {
  return value === null || STRICT_UUID_REGEX.test(value);
}

function freezeSessionRecord(record: WebBffSessionRecord): WebBffSessionRecord {
  return Object.freeze({
    ...record,
    accessTokenExpiresAt: new Date(record.accessTokenExpiresAt.getTime()),
    previousAccessTokenExpiresAt: record.previousAccessTokenExpiresAt
      ? new Date(record.previousAccessTokenExpiresAt.getTime())
      : null,
    previousGraceUntil: record.previousGraceUntil
      ? new Date(record.previousGraceUntil.getTime())
      : null,
    expiresAt: new Date(record.expiresAt.getTime()),
    revokedAt: record.revokedAt ? new Date(record.revokedAt.getTime()) : null,
    createdAt: new Date(record.createdAt.getTime()),
    updatedAt: new Date(record.updatedAt.getTime()),
  });
}

/**
 * Adapter w pamięci RAM przeznaczony wyłącznie dla izolowanych testów jednostkowych i trybu lokalnego bez DB.
 * W środowisku wieloinstancyjnym i produkcyjnym wymagany jest `PostgresWebSessionStore`.
 */
export class InMemoryWebSessionStore implements WebSessionStorePort {
  readonly #authStates = new Map<string, OidcAuthStateRecord>();
  readonly #sessions = new Map<string, WebBffSessionRecord>();
  readonly #disabledUserIds = new Set<string>();
  readonly #clock: Clock;

  constructor(options: { readonly clock?: Clock | undefined } = {}) {
    this.#clock = options.clock ?? systemClock;
  }

  markUserDisabledForTest(userId: string): void {
    this.#disabledUserIds.add(userId.toLowerCase());
  }

  async createOidcAuthState(
    input: CreateOidcAuthStateInput,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
    const now = input.now ?? this.#clock.now();
    if (
      !isValidSha256Hex(input.stateHash) ||
      !isValidNonBlankTrimmed(input.encryptedPayload, 16_384) ||
      !isValidFiniteDate(input.expiresAt) ||
      !isValidFiniteDate(now) ||
      input.expiresAt.getTime() <= now.getTime()
    ) {
      return { ok: false, reason: 'invalid_auth_state_input' };
    }

    if (this.#authStates.has(input.stateHash)) {
      return { ok: false, reason: 'state_already_exists' };
    }

    for (const [hash, existing] of this.#authStates.entries()) {
      if (existing.expiresAt.getTime() <= now.getTime() - 3_600_000) {
        this.#authStates.delete(hash);
      }
    }

    this.#authStates.set(
      input.stateHash,
      Object.freeze({
        stateHash: input.stateHash,
        encryptedPayload: input.encryptedPayload,
        expiresAt: new Date(input.expiresAt.getTime()),
        consumedAt: null,
        createdAt: new Date(now.getTime()),
      }),
    );

    return { ok: true };
  }

  async consumeOidcAuthState(input: {
    readonly stateHash: string;
    readonly now?: Date | undefined;
  }): Promise<ConsumeOidcAuthStateResult> {
    if (!isValidSha256Hex(input.stateHash)) {
      return { ok: false, reason: 'invalid_state_hash' };
    }

    const now = input.now ?? this.#clock.now();
    const existing = this.#authStates.get(input.stateHash);
    if (!existing) {
      return { ok: false, reason: 'state_not_found' };
    }
    if (existing.consumedAt !== null) {
      return { ok: false, reason: 'state_already_consumed' };
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: 'state_expired' };
    }

    const consumed: OidcAuthStateRecord = Object.freeze({
      ...existing,
      consumedAt: new Date(now.getTime()),
    });
    this.#authStates.set(input.stateHash, consumed);
    return { ok: true, state: consumed };
  }

  async createSession(input: CreateWebBffSessionInput): Promise<CreateWebBffSessionResult> {
    const now = input.now ?? this.#clock.now();
    if (
      !isValidSha256Hex(input.sessionIdHash) ||
      !STRICT_UUID_REGEX.test(input.userId) ||
      !isValidNonBlankTrimmed(input.issuer, 512) ||
      !isValidNonBlankTrimmed(input.subject, 256) ||
      !isValidNonBlankTrimmed(input.displayName, 160) ||
      !isValidNonBlankTrimmed(input.email, 254) ||
      !isValidOptionalUuid(input.tenantId) ||
      !isValidOptionalUuid(input.legalEntityId) ||
      (input.tenantId === null && input.legalEntityId !== null) ||
      !TAX_PERIOD_MONTH_REGEX.test(input.period) ||
      !isValidNonBlankTrimmed(input.encryptedTokens, 32_768) ||
      !isValidFiniteDate(input.accessTokenExpiresAt) ||
      !isValidFiniteDate(input.expiresAt) ||
      !isValidFiniteDate(now) ||
      input.expiresAt.getTime() <= now.getTime()
    ) {
      return { ok: false, reason: 'invalid_session_input' };
    }

    if (this.#disabledUserIds.has(input.userId.toLowerCase())) {
      return { ok: false, reason: 'user_disabled_or_identity_revoked' };
    }

    if (this.#sessions.has(input.sessionIdHash)) {
      return { ok: false, reason: 'session_already_exists' };
    }

    const created: WebBffSessionRecord = freezeSessionRecord({
      sessionIdHash: input.sessionIdHash,
      userId: input.userId.toLowerCase(),
      issuer: input.issuer,
      subject: input.subject,
      displayName: input.displayName,
      email: input.email,
      tenantId: input.tenantId ? input.tenantId.toLowerCase() : null,
      legalEntityId: input.legalEntityId ? input.legalEntityId.toLowerCase() : null,
      period: input.period,
      encryptedTokens: input.encryptedTokens,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      refreshGeneration: 0,
      previousEncryptedTokens: null,
      previousAccessTokenExpiresAt: null,
      previousGraceUntil: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    this.#sessions.set(input.sessionIdHash, created);
    return { ok: true, session: created };
  }

  async getSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<GetWebBffSessionResult> {
    if (!isValidSha256Hex(input.sessionIdHash)) {
      return { ok: false, reason: 'invalid_session_input' };
    }

    const now = input.now ?? this.#clock.now();
    const existing = this.#sessions.get(input.sessionIdHash);
    if (!existing) {
      return { ok: false, reason: 'session_not_found' };
    }
    if (existing.revokedAt !== null) {
      return { ok: false, reason: 'session_revoked' };
    }
    if (existing.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: 'session_expired' };
    }
    if (this.#disabledUserIds.has(existing.userId.toLowerCase())) {
      return { ok: false, reason: 'user_disabled_or_identity_revoked' };
    }

    return { ok: true, session: freezeSessionRecord(existing) };
  }

  async updateSessionContext(
    input: UpdateWebBffSessionContextInput,
  ): Promise<GetWebBffSessionResult> {
    if (
      !isValidSha256Hex(input.sessionIdHash) ||
      !isValidOptionalUuid(input.tenantId) ||
      !isValidOptionalUuid(input.legalEntityId) ||
      (input.tenantId === null && input.legalEntityId !== null) ||
      !TAX_PERIOD_MONTH_REGEX.test(input.period)
    ) {
      return { ok: false, reason: 'invalid_session_input' };
    }

    const now = input.now ?? this.#clock.now();
    const current = await this.getSession({ sessionIdHash: input.sessionIdHash, now });
    if (!current.ok) {
      return current;
    }

    const updated = freezeSessionRecord({
      ...current.session,
      tenantId: input.tenantId ? input.tenantId.toLowerCase() : null,
      legalEntityId: input.legalEntityId ? input.legalEntityId.toLowerCase() : null,
      period: input.period,
      updatedAt: now,
    });
    this.#sessions.set(input.sessionIdHash, updated);
    return { ok: true, session: updated };
  }

  async rotateSessionTokens(
    input: RotateWebBffSessionTokensInput,
  ): Promise<RotateWebBffSessionTokensResult> {
    const now = input.now ?? this.#clock.now();
    if (
      !isValidSha256Hex(input.sessionIdHash) ||
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration < 0 ||
      !isValidNonBlankTrimmed(input.encryptedTokens, 32_768) ||
      !isValidFiniteDate(input.accessTokenExpiresAt) ||
      (input.sessionExpiresAt !== undefined && !isValidFiniteDate(input.sessionExpiresAt)) ||
      !isValidFiniteDate(now)
    ) {
      return { ok: false, reason: 'invalid_session_input' };
    }

    const current = await this.getSession({ sessionIdHash: input.sessionIdHash, now });
    if (!current.ok) {
      return current;
    }

    if (current.session.refreshGeneration > input.expectedGeneration) {
      return {
        ok: true,
        rotated: false,
        alreadyAdvanced: true,
        session: current.session,
      };
    }

    if (current.session.refreshGeneration < input.expectedGeneration) {
      return { ok: false, reason: 'generation_conflict' };
    }

    const nextExpiresAt = input.sessionExpiresAt ?? current.session.expiresAt;
    if (nextExpiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: 'session_expired' };
    }

    const graceMs = Math.max(0, Math.min(input.gracePeriodMs ?? 30_000, 120_000));
    const updated = freezeSessionRecord({
      ...current.session,
      previousEncryptedTokens: current.session.encryptedTokens,
      previousAccessTokenExpiresAt: current.session.accessTokenExpiresAt,
      previousGraceUntil: new Date(now.getTime() + graceMs),
      encryptedTokens: input.encryptedTokens,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      expiresAt: nextExpiresAt,
      refreshGeneration: current.session.refreshGeneration + 1,
      updatedAt: now,
    });

    this.#sessions.set(input.sessionIdHash, updated);
    return {
      ok: true,
      rotated: true,
      alreadyAdvanced: false,
      session: updated,
    };
  }

  async revokeSession(input: {
    readonly sessionIdHash: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revoked: boolean }> {
    if (!isValidSha256Hex(input.sessionIdHash)) {
      return { ok: true, revoked: false };
    }
    const existing = this.#sessions.get(input.sessionIdHash);
    if (!existing) {
      return { ok: true, revoked: false };
    }
    const now = input.now ?? this.#clock.now();
    const updated = freezeSessionRecord({
      ...existing,
      revokedAt: existing.revokedAt ?? now,
      updatedAt: now,
    });
    this.#sessions.set(input.sessionIdHash, updated);
    return { ok: true, revoked: true };
  }

  async revokeAllSessionsForUser(input: {
    readonly userId: string;
    readonly now?: Date | undefined;
  }): Promise<{ readonly ok: true; readonly revokedCount: number }> {
    if (!STRICT_UUID_REGEX.test(input.userId)) {
      return { ok: true, revokedCount: 0 };
    }
    const normalizedUserId = input.userId.toLowerCase();
    const now = input.now ?? this.#clock.now();
    let count = 0;
    for (const [hash, sess] of this.#sessions.entries()) {
      if (sess.userId === normalizedUserId && sess.revokedAt === null) {
        this.#sessions.set(
          hash,
          freezeSessionRecord({
            ...sess,
            revokedAt: now,
            updatedAt: now,
          }),
        );
        count += 1;
      }
    }
    return { ok: true, revokedCount: count };
  }
}
