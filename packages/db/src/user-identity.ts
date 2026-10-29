import { userId, type UserId } from '@pap/domain';
import type { UserIdentityResolver, VerifiedOidcIdentity } from '@pap/application';
import { and, eq, or, sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import { appUser, userOidcIdentity } from './schema.js';
import type { PostgresContextSigner } from './signed-context.js';

type IdentityReadDatabase = Pick<ReturnType<typeof connectDatabase>['db'], 'select'>;
type IdentityWriteDatabase = Pick<ReturnType<typeof connectDatabase>['db'], 'transaction'>;

function isExactNonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/**
 * Autorytatywny serwerowy resolver mapujący zweryfikowaną parę (issuer, subject) na wewnętrzny userId.
 * Traktuje subject jako nieprzezroczysty, case-sensitive identyfikator; nie tworzy kont automatycznie
 * i nigdy nie dopasowuje użytkowników po adresie e-mail ani nazwie.
 */
export class PostgresUserIdentityResolver implements UserIdentityResolver {
  constructor(
    private readonly db: IdentityReadDatabase & Partial<IdentityWriteDatabase>,
    private readonly signer?: PostgresContextSigner,
  ) {}

  async resolveVerifiedIdentity(
    identity: VerifiedOidcIdentity,
  ): Promise<{ readonly userId: UserId } | null> {
    if (!isExactNonBlank(identity.issuer) || !isExactNonBlank(identity.subject)) {
      return null;
    }

    try {
      if (this.signer) {
        if (!this.db.transaction) throw new Error('Brak transakcji resolvera.');
        return await this.db.transaction(async (tx) => {
          await this.signer!.apply(tx, {
            purpose: 'identity',
            issuer: identity.issuer,
            subject: identity.subject,
          });
          const [row] = await tx.execute<{ user_id: string | null }>(
            sql`SELECT pap_resolve_identity(${identity.issuer}, ${identity.subject}) AS user_id`,
          );
          return row?.user_id ? Object.freeze({ userId: userId(row.user_id) }) : null;
        });
      }
      const rows = await this.db
        .select({
          userId: appUser.id,
          userStatus: appUser.status,
          userDisabledAt: appUser.disabledAt,
          linkStatus: userOidcIdentity.status,
          linkRevokedAt: userOidcIdentity.revokedAt,
          issuer: userOidcIdentity.issuer,
          subject: userOidcIdentity.subject,
        })
        .from(userOidcIdentity)
        .innerJoin(appUser, eq(appUser.id, userOidcIdentity.userId))
        .where(
          and(
            eq(userOidcIdentity.issuer, identity.issuer),
            eq(userOidcIdentity.subject, identity.subject),
          ),
        );

      const row = rows[0];
      if (!row || rows.length !== 1) {
        return null;
      }

      // Defense in depth: dokładne porównanie case-sensitive w pamięci oraz kontrola aktywności obu rekordów.
      if (
        row.issuer !== identity.issuer ||
        row.subject !== identity.subject ||
        row.userStatus !== 'active' ||
        row.userDisabledAt !== null ||
        row.linkStatus !== 'active' ||
        row.linkRevokedAt !== null
      ) {
        return null;
      }

      return Object.freeze({ userId: userId(row.userId) });
    } catch {
      throw new Error('Źródło tożsamości użytkowników jest niedostępne.');
    }
  }
}

export interface ProvisionUserOidcIdentityInput {
  readonly userId: string;
  readonly identityId: string;
  readonly issuer: string;
  readonly subject: string;
}

export type UserIdentityStoreResult =
  | { readonly ok: true; readonly userId: UserId }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_identity_input'
        | 'user_already_exists'
        | 'identity_already_linked'
        | 'user_not_found'
        | 'user_disabled'
        | 'identity_not_found'
        | 'identity_store_unavailable';
    };

function extractPostgresUniqueConflictReason(
  error: unknown,
): 'user_already_exists' | 'identity_already_linked' | null {
  const candidates = [
    error,
    typeof error === 'object' && error !== null && 'cause' in error
      ? (error as { readonly cause?: unknown }).cause
      : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }
    const code = (candidate as { readonly code?: unknown }).code;
    if (code !== '23505') {
      continue;
    }
    const constraint = String(
      (candidate as { readonly constraint_name?: unknown; readonly constraint?: unknown })
        .constraint_name ??
        (candidate as { readonly constraint?: unknown }).constraint ??
        '',
    );
    if (constraint === 'app_user_pkey') {
      return 'user_already_exists';
    }
    return 'identity_already_linked';
  }
  return null;
}

/**
 * Kontrolowany adapter provisioningu i wyłączania kont, całkowicie oddzielony od weryfikacji tokenów.
 */
export class PostgresUserIdentityStore {
  constructor(private readonly db: IdentityWriteDatabase) {}

  async provisionUserWithOidcIdentity(
    input: ProvisionUserOidcIdentityInput,
  ): Promise<UserIdentityStoreResult> {
    let parsedUserId: UserId;
    let parsedIdentityId: UserId;
    try {
      parsedUserId = userId(input.userId);
      parsedIdentityId = userId(input.identityId);
      if (!isExactNonBlank(input.issuer) || !isExactNonBlank(input.subject)) {
        return { ok: false, reason: 'invalid_identity_input' };
      }
    } catch {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    try {
      return await this.db.transaction(async (tx): Promise<UserIdentityStoreResult> => {
        const [existingUser] = await tx
          .select({ id: appUser.id })
          .from(appUser)
          .where(eq(appUser.id, parsedUserId));
        if (existingUser) {
          return { ok: false, reason: 'user_already_exists' };
        }

        const [existingIdentity] = await tx
          .select({ id: userOidcIdentity.id })
          .from(userOidcIdentity)
          .where(
            or(
              eq(userOidcIdentity.id, parsedIdentityId),
              and(
                eq(userOidcIdentity.issuer, input.issuer),
                eq(userOidcIdentity.subject, input.subject),
              ),
            ),
          );
        if (existingIdentity) {
          return { ok: false, reason: 'identity_already_linked' };
        }

        const times = await tx.execute<{ now: string }>(
          sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
        );
        const now = new Date(times[0]!.now);

        await tx.insert(appUser).values({
          id: parsedUserId,
          status: 'active',
          createdAt: now,
          disabledAt: null,
        });

        await tx.insert(userOidcIdentity).values({
          id: parsedIdentityId,
          userId: parsedUserId,
          issuer: input.issuer,
          subject: input.subject,
          status: 'active',
          linkedAt: now,
          revokedAt: null,
        });

        return { ok: true, userId: parsedUserId };
      });
    } catch (error) {
      const uniqueConflict = extractPostgresUniqueConflictReason(error);
      if (uniqueConflict) {
        return { ok: false, reason: uniqueConflict };
      }
      return { ok: false, reason: 'identity_store_unavailable' };
    }
  }

  async linkAdditionalOidcIdentity(
    input: ProvisionUserOidcIdentityInput,
  ): Promise<UserIdentityStoreResult> {
    let parsedUserId: UserId;
    let parsedIdentityId: UserId;
    try {
      parsedUserId = userId(input.userId);
      parsedIdentityId = userId(input.identityId);
      if (!isExactNonBlank(input.issuer) || !isExactNonBlank(input.subject)) {
        return { ok: false, reason: 'invalid_identity_input' };
      }
    } catch {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    try {
      return await this.db.transaction(async (tx): Promise<UserIdentityStoreResult> => {
        const [user] = await tx
          .select()
          .from(appUser)
          .where(eq(appUser.id, parsedUserId))
          .for('update');
        if (!user) {
          return { ok: false, reason: 'user_not_found' };
        }
        if (user.status !== 'active' || user.disabledAt !== null) {
          return { ok: false, reason: 'user_disabled' };
        }

        const [existingIdentity] = await tx
          .select({ id: userOidcIdentity.id })
          .from(userOidcIdentity)
          .where(
            or(
              eq(userOidcIdentity.id, parsedIdentityId),
              and(
                eq(userOidcIdentity.issuer, input.issuer),
                eq(userOidcIdentity.subject, input.subject),
              ),
            ),
          );
        if (existingIdentity) {
          return { ok: false, reason: 'identity_already_linked' };
        }

        const times = await tx.execute<{ now: string }>(
          sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
        );
        const now = new Date(times[0]!.now);

        await tx.insert(userOidcIdentity).values({
          id: parsedIdentityId,
          userId: parsedUserId,
          issuer: input.issuer,
          subject: input.subject,
          status: 'active',
          linkedAt: now,
          revokedAt: null,
        });

        return { ok: true, userId: parsedUserId };
      });
    } catch (error) {
      const uniqueConflict = extractPostgresUniqueConflictReason(error);
      if (uniqueConflict === 'identity_already_linked') {
        return { ok: false, reason: 'identity_already_linked' };
      }
      return { ok: false, reason: 'identity_store_unavailable' };
    }
  }

  async disableUserAccount(input: { readonly userId: string }): Promise<UserIdentityStoreResult> {
    let parsedUserId: UserId;
    try {
      parsedUserId = userId(input.userId);
    } catch {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    try {
      return await this.db.transaction(async (tx): Promise<UserIdentityStoreResult> => {
        const [user] = await tx
          .select()
          .from(appUser)
          .where(eq(appUser.id, parsedUserId))
          .for('update');
        if (!user) {
          return { ok: false, reason: 'user_not_found' };
        }

        const times = await tx.execute<{ now: string }>(
          sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
        );
        const now = new Date(times[0]!.now);
        const disabledAt =
          user.disabledAt !== null && user.disabledAt < now
            ? user.disabledAt
            : now < user.createdAt
              ? user.createdAt
              : now;

        await tx
          .update(appUser)
          .set({ status: 'disabled', disabledAt })
          .where(eq(appUser.id, parsedUserId));

        return { ok: true, userId: parsedUserId };
      });
    } catch {
      return { ok: false, reason: 'identity_store_unavailable' };
    }
  }

  async revokeOidcIdentity(input: {
    readonly userId: string;
    readonly identityId: string;
  }): Promise<UserIdentityStoreResult> {
    let parsedUserId: UserId;
    let parsedIdentityId: UserId;
    try {
      parsedUserId = userId(input.userId);
      parsedIdentityId = userId(input.identityId);
    } catch {
      return { ok: false, reason: 'invalid_identity_input' };
    }

    try {
      return await this.db.transaction(async (tx): Promise<UserIdentityStoreResult> => {
        const [user] = await tx
          .select()
          .from(appUser)
          .where(eq(appUser.id, parsedUserId))
          .for('update');
        if (!user) {
          return { ok: false, reason: 'user_not_found' };
        }

        const [identity] = await tx
          .select()
          .from(userOidcIdentity)
          .where(
            and(
              eq(userOidcIdentity.id, parsedIdentityId),
              eq(userOidcIdentity.userId, parsedUserId),
            ),
          )
          .for('update');
        if (!identity) {
          return { ok: false, reason: 'identity_not_found' };
        }

        const times = await tx.execute<{ now: string }>(
          sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
        );
        const now = new Date(times[0]!.now);
        const revokedAt =
          identity.revokedAt !== null && identity.revokedAt < now
            ? identity.revokedAt
            : now < identity.linkedAt
              ? identity.linkedAt
              : now;

        await tx
          .update(userOidcIdentity)
          .set({ status: 'revoked', revokedAt })
          .where(eq(userOidcIdentity.id, parsedIdentityId));

        return { ok: true, userId: parsedUserId };
      });
    } catch {
      return { ok: false, reason: 'identity_store_unavailable' };
    }
  }
}
