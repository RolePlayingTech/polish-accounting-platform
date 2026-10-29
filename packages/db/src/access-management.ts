import {
  copyAccessManagementCommand,
  createTenantAccessManagementAuthorizer,
  freezeTransactionActor,
  type AccessManagementActor,
  type AccessManagementAuthorizationDataSource,
  type AccessManagementAuthorizationFacts,
  type AccessManagementCommand,
  type AccessManagementResult,
  type AccessManagementStore,
  type AccessManagementTransaction,
} from '@pap/application';
import { legalEntityId, tenantId, userId, type TenantMembership } from '@pap/domain';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import {
  accessManagementEvent,
  companyAccessGrant,
  legalEntity,
  tenantMembership,
} from './schema.js';
import {
  applyLocalRlsSessionContext,
  readTransactionClockNow,
  runManagedTransaction,
  verifyAndLockActorInTx,
  type PostgresTransaction,
} from './transaction-primitives.js';

type Database = ReturnType<typeof connectDatabase>['db'];
type MembershipRow = typeof tenantMembership.$inferSelect;
type GrantRow = typeof companyAccessGrant.$inferSelect;

function mapMembershipRow(row: MembershipRow | undefined): TenantMembership | null {
  if (!row) {
    return null;
  }
  return {
    ...row,
    tenantId: tenantId(row.tenantId),
    userId: userId(row.userId),
  };
}

function actorCacheKey(actor: AccessManagementActor): string {
  if (!actor.identity) {
    return actor.userId;
  }
  return `${actor.userId}\u0000${actor.identity.issuer}\u0000${actor.identity.subject}`;
}

function isUniqueGrantConflict(error: unknown): boolean {
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
    const constraint = String(
      (candidate as { readonly constraint_name?: unknown; readonly constraint?: unknown })
        .constraint_name ??
        (candidate as { readonly constraint?: unknown }).constraint ??
        '',
    );
    if (code === '23505' && constraint === 'company_access_grant_pkey') {
      return true;
    }
  }
  return false;
}

interface LockedAccessManagementSnapshot {
  readonly requestKey: string;
  readonly actorKey: string;
  readonly targetMembershipRow: MembershipRow | null;
  readonly entityExists?: boolean | undefined;
  readonly targetGrantRow?: GrantRow | null | undefined;
  readonly now: Date;
}

/**
 * Nieblokujące źródło odczytu faktów administracyjnych z 6D-2 (przydatne wyłącznie do zapytań bez mutacji
 * lub jako fallback poza transakcją). W `manageAccess` z `PostgresAccessManagementStore` (6D-3A) autoryzator
 * zawsze korzysta z transakcyjnego `AccessManagementTransaction`, eliminując okno TOCTOU.
 */
export class PostgresAccessManagementAuthorizationDataSource implements AccessManagementAuthorizationDataSource {
  constructor(private readonly db: Pick<Database, 'select'>) {}

  async getAuthorizationFacts(
    actor: AccessManagementActor,
    command: AccessManagementCommand,
  ): Promise<AccessManagementAuthorizationFacts> {
    try {
      const memberships = await this.db
        .select()
        .from(tenantMembership)
        .where(
          and(
            eq(tenantMembership.tenantId, command.tenantId),
            inArray(tenantMembership.userId, [actor.userId, command.userId]),
          ),
        );

      const actorMembershipRow = memberships.find((row) => row.userId === actor.userId);
      const targetMembershipRow = memberships.find((row) => row.userId === command.userId);

      const actorGrantsRows = await this.db
        .select()
        .from(companyAccessGrant)
        .where(
          and(
            eq(companyAccessGrant.tenantId, command.tenantId),
            eq(companyAccessGrant.userId, actor.userId),
          ),
        );

      let targetGrant: AccessManagementAuthorizationFacts['targetGrant'] = null;
      if (command.kind === 'revoke_grant') {
        const [grantRow] = await this.db
          .select({
            legalEntityId: companyAccessGrant.legalEntityId,
            action: companyAccessGrant.action,
          })
          .from(companyAccessGrant)
          .where(
            and(
              eq(companyAccessGrant.tenantId, command.tenantId),
              eq(companyAccessGrant.userId, command.userId),
              eq(companyAccessGrant.grantId, command.grantId),
            ),
          );
        if (grantRow) {
          targetGrant = {
            legalEntityId: legalEntityId(grantRow.legalEntityId),
            action: grantRow.action,
          };
        }
      }

      return {
        actorMembership: mapMembershipRow(actorMembershipRow),
        actorGrants: actorGrantsRows.map((grantRow) => ({
          ...grantRow,
          tenantId: tenantId(grantRow.tenantId),
          userId: userId(grantRow.userId),
          legalEntityId: legalEntityId(grantRow.legalEntityId),
        })),
        targetMembership: mapMembershipRow(targetMembershipRow),
        targetGrant,
      };
    } catch {
      throw new Error('Źródło danych autoryzacji administracyjnej jest niedostępne.');
    }
  }
}

/**
 * Zaufany adapter serwerowy (6D-R / 6D-3A); wywoływać przez `manageAccess`, nigdy bezpośrednio z transportu.
 * Wykonuje w jednej transakcji PostgreSQL:
 * 1) blokadę i rewalidację konta `app_user` (+ `user_oidc_identity`),
 * 2) blokadę faktów autoryzacyjnych w kanonicznym porządku odpornym na zakleszczenia,
 * 3) ocenę polityki domenowej względem zegara transakcyjnego DB po blokadach,
 * 4) ustawienie transakcyjnego kontekstu sesji pod przyszłe RLS,
 * 5) mutację oraz atomowy zapis audytu `access_management_event` przed COMMIT.
 */
export class PostgresAccessManagementStore implements AccessManagementStore {
  constructor(private readonly db: Pick<Database, 'transaction'>) {}

  async runInTransaction(
    work: (tx: AccessManagementTransaction) => Promise<AccessManagementResult>,
  ): Promise<AccessManagementResult> {
    try {
      return await runManagedTransaction(
        this.db,
        async (tx) => {
          const txAdapter = this.createTransactionAdapter(tx);
          return work(txAdapter);
        },
        (result) => result.ok === true,
      );
    } catch (error) {
      if (isUniqueGrantConflict(error)) {
        return { ok: false, reason: 'operation_conflict' };
      }
      return { ok: false, reason: 'access_management_unavailable' };
    }
  }

  async execute(
    input: AccessManagementCommand,
    actor: AccessManagementActor,
  ): Promise<AccessManagementResult> {
    let command: AccessManagementCommand;
    let canonicalActor: AccessManagementActor;
    try {
      command = copyAccessManagementCommand(input);
      canonicalActor = freezeTransactionActor(actor);
    } catch {
      return { ok: false, reason: 'invalid_command' };
    }

    return this.runInTransaction(async (tx) => {
      if ((await tx.verifyActorAccount(canonicalActor)) !== true) {
        return { ok: false, reason: 'access_management_denied' };
      }
      if (
        !(await createTenantAccessManagementAuthorizer().authorize(canonicalActor, command, tx))
      ) {
        return { ok: false, reason: 'access_management_denied' };
      }
      await tx.applySessionContext?.({
        actorUserId: canonicalActor.userId,
        tenantId: command.tenantId,
        ...(command.kind === 'grant' ? { legalEntityId: command.legalEntityId } : {}),
      });
      return tx.executeAuthorized(command, canonicalActor);
    });
  }

  private createTransactionAdapter(tx: PostgresTransaction): AccessManagementTransaction {
    let verifiedActorKey: string | null = null;
    let lockedSnapshot: LockedAccessManagementSnapshot | null = null;

    const verifyActorAccount = async (rawActor: AccessManagementActor): Promise<boolean> => {
      let actor: AccessManagementActor;
      try {
        actor = freezeTransactionActor(rawActor);
      } catch {
        return false;
      }
      const key = actorCacheKey(actor);
      if (verifiedActorKey === key) {
        return true;
      }
      const active = await verifyAndLockActorInTx(tx, actor);
      if (active) {
        verifiedActorKey = key;
      }
      return active;
    };

    const getAuthorizationFacts = async (
      rawActor: AccessManagementActor,
      rawCommand: AccessManagementCommand,
    ): Promise<AccessManagementAuthorizationFacts> => {
      const actor = freezeTransactionActor(rawActor);
      const command = copyAccessManagementCommand(rawCommand);
      const currentActorKey = actorCacheKey(actor);

      if (verifiedActorKey !== currentActorKey) {
        const active = await verifyActorAccount(actor);
        if (!active) {
          const now = await readTransactionClockNow(tx);
          return {
            actorMembership: null,
            actorGrants: [],
            targetMembership: null,
            targetGrant: null,
            now,
          };
        }
      }

      // Samodzielna eskalacja jest zabroniona przez domenę — wystarczy FOR SHARE na wierszu aktora.
      if (actor.userId === command.userId) {
        const [selfMembership] = await tx
          .select()
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.tenantId, command.tenantId),
              eq(tenantMembership.userId, actor.userId),
            ),
          )
          .for('share');
        const now = await readTransactionClockNow(tx);
        const mapped = mapMembershipRow(selfMembership);
        return {
          actorMembership: mapped,
          actorGrants: [],
          targetMembership: mapped,
          targetGrant: null,
          now,
        };
      }

      // Szybki nieblokujący pre-check aktora: użytkownik spoza tenanta lub zwykły tenant_member
      // nigdy nie zakłada blokady FOR UPDATE na członkostwach w obcym/własnym tenancie.
      const [actorPrecheck] = await tx
        .select()
        .from(tenantMembership)
        .where(
          and(
            eq(tenantMembership.tenantId, command.tenantId),
            eq(tenantMembership.userId, actor.userId),
          ),
        );

      if (
        !actorPrecheck ||
        actorPrecheck.status !== 'active' ||
        (actorPrecheck.role !== 'tenant_owner' && actorPrecheck.role !== 'tenant_admin')
      ) {
        const now = await readTransactionClockNow(tx);
        return {
          actorMembership: mapMembershipRow(actorPrecheck),
          actorGrants: [],
          targetMembership: null,
          targetGrant: null,
          now,
        };
      }

      // Poziom 3: kanoniczny porządek blokad tenant_membership wg rosnącego UUID user_id.
      // Wyklucza deadlock przy równoległych operacjach krzyżowych (np. A -> B oraz B -> A).
      let actorMembershipRow: MembershipRow | undefined;
      let targetMembershipRow: MembershipRow | undefined;

      if (actor.userId < command.userId) {
        [actorMembershipRow] = await tx
          .select()
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.tenantId, command.tenantId),
              eq(tenantMembership.userId, actor.userId),
            ),
          )
          .for('share');

        // Jeśli w trakcie oczekiwania na blokadę członkostwo aktora zostało cofnięte, nie blokujemy celu.
        if (
          !actorMembershipRow ||
          actorMembershipRow.status !== 'active' ||
          (actorMembershipRow.role !== 'tenant_owner' && actorMembershipRow.role !== 'tenant_admin')
        ) {
          const now = await readTransactionClockNow(tx);
          return {
            actorMembership: mapMembershipRow(actorMembershipRow),
            actorGrants: [],
            targetMembership: null,
            targetGrant: null,
            now,
          };
        }

        [targetMembershipRow] = await tx
          .select()
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.tenantId, command.tenantId),
              eq(tenantMembership.userId, command.userId),
            ),
          )
          .for('update');
      } else {
        [targetMembershipRow] = await tx
          .select()
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.tenantId, command.tenantId),
              eq(tenantMembership.userId, command.userId),
            ),
          )
          .for('update');

        [actorMembershipRow] = await tx
          .select()
          .from(tenantMembership)
          .where(
            and(
              eq(tenantMembership.tenantId, command.tenantId),
              eq(tenantMembership.userId, actor.userId),
            ),
          )
          .for('share');

        if (
          !actorMembershipRow ||
          actorMembershipRow.status !== 'active' ||
          (actorMembershipRow.role !== 'tenant_owner' && actorMembershipRow.role !== 'tenant_admin')
        ) {
          const now = await readTransactionClockNow(tx);
          return {
            actorMembership: mapMembershipRow(actorMembershipRow),
            actorGrants: [],
            targetMembership: mapMembershipRow(targetMembershipRow),
            targetGrant: null,
            now,
          };
        }
      }

      // Poziom 4: blokada firmy przy nadawaniu grantu (FOR SHARE chroni spójność FK i przynależność do tenanta).
      let entityExists: boolean | undefined;
      if (command.kind === 'grant' && targetMembershipRow) {
        const [entityRow] = await tx
          .select({ id: legalEntity.id })
          .from(legalEntity)
          .where(
            and(
              eq(legalEntity.tenantId, command.tenantId),
              eq(legalEntity.id, command.legalEntityId),
            ),
          )
          .for('share');
        entityExists = Boolean(entityRow);
      }

      // Poziom 5: blokada company_access_grant w kanonicznym porządku (user_id ASC, grant_id ASC).
      const lockActorGrants = async (): Promise<GrantRow[]> => {
        if (actorMembershipRow.role !== 'tenant_admin') {
          return [];
        }
        return tx
          .select()
          .from(companyAccessGrant)
          .where(
            and(
              eq(companyAccessGrant.tenantId, command.tenantId),
              eq(companyAccessGrant.userId, actor.userId),
            ),
          )
          .orderBy(asc(companyAccessGrant.grantId))
          .for('share');
      };

      const lockTargetGrant = async (): Promise<GrantRow | null | undefined> => {
        if (command.kind !== 'revoke_grant' || !targetMembershipRow) {
          return undefined;
        }
        const [grantRow] = await tx
          .select()
          .from(companyAccessGrant)
          .where(
            and(
              eq(companyAccessGrant.tenantId, command.tenantId),
              eq(companyAccessGrant.userId, command.userId),
              eq(companyAccessGrant.grantId, command.grantId),
            ),
          )
          .for('update');
        return grantRow ?? null;
      };

      let actorGrantsRows: GrantRow[];
      let targetGrantRow: GrantRow | null | undefined;
      if (actor.userId < command.userId) {
        actorGrantsRows = await lockActorGrants();
        targetGrantRow = await lockTargetGrant();
      } else {
        targetGrantRow = await lockTargetGrant();
        actorGrantsRows = await lockActorGrants();
      }

      // Autorytatywny czas z zegara PostgreSQL pobrany PO uzyskaniu wszystkich blokad wierszowych.
      const now = await readTransactionClockNow(tx);

      lockedSnapshot = {
        requestKey: JSON.stringify(command),
        actorKey: currentActorKey,
        targetMembershipRow: targetMembershipRow ?? null,
        entityExists,
        targetGrantRow,
        now,
      };

      return {
        actorMembership: mapMembershipRow(actorMembershipRow),
        actorGrants: actorGrantsRows.map((grantRow) => ({
          ...grantRow,
          tenantId: tenantId(grantRow.tenantId),
          userId: userId(grantRow.userId),
          legalEntityId: legalEntityId(grantRow.legalEntityId),
        })),
        targetMembership: mapMembershipRow(targetMembershipRow),
        targetGrant: targetGrantRow
          ? {
              legalEntityId: legalEntityId(targetGrantRow.legalEntityId),
              action: targetGrantRow.action,
            }
          : null,
        now,
      };
    };

    const executeAuthorized = async (
      rawCommand: AccessManagementCommand,
      rawActor: AccessManagementActor,
    ): Promise<AccessManagementResult> => {
      const command = copyAccessManagementCommand(rawCommand);
      const actor = freezeTransactionActor(rawActor);
      const currentActorKey = actorCacheKey(actor);

      if (verifiedActorKey !== currentActorKey) {
        if ((await verifyActorAccount(actor)) !== true) {
          return { ok: false, reason: 'access_management_denied' };
        }
      }

      const requestKey = JSON.stringify(command);
      const target = and(
        eq(tenantMembership.tenantId, command.tenantId),
        eq(tenantMembership.userId, command.userId),
      );

      const snapshotMatches =
        lockedSnapshot !== null &&
        lockedSnapshot.requestKey === requestKey &&
        lockedSnapshot.actorKey === currentActorKey;

      let member: MembershipRow | null;
      if (snapshotMatches) {
        member = lockedSnapshot!.targetMembershipRow;
      } else {
        // Także bezpośredni adapter transakcji nie może ominąć zablokowanej polityki.
        if (
          !(await createTenantAccessManagementAuthorizer().authorize(actor, command, {
            getAuthorizationFacts,
          }))
        )
          return { ok: false, reason: 'access_management_denied' };
        member = lockedSnapshot?.targetMembershipRow ?? null;
      }

      if (!member) {
        return { ok: false, reason: 'membership_unavailable' };
      }

      const [previous] = await tx
        .select()
        .from(accessManagementEvent)
        .where(eq(accessManagementEvent.operationId, command.operationId));

      if (previous) {
        if (
          previous.tenantId !== command.tenantId ||
          previous.userId !== command.userId ||
          previous.actorId !== actor.userId ||
          previous.requestKey !== requestKey
        ) {
          return { ok: false, reason: 'operation_conflict' };
        }
        return { ok: true, receipt: previous.receipt };
      }

      const now = snapshotMatches ? lockedSnapshot!.now : await readTransactionClockNow(tx);

      const grantsTarget = and(
        eq(companyAccessGrant.tenantId, command.tenantId),
        eq(companyAccessGrant.userId, command.userId),
      );
      const revokeAllGrants = async () => {
        const revoked = await tx
          .update(companyAccessGrant)
          .set({ revokedAt: now })
          .where(
            and(
              grantsTarget,
              sql`(${companyAccessGrant.revokedAt} IS NULL OR ${companyAccessGrant.revokedAt} > ${now.toISOString()})`,
            ),
          )
          .returning({ id: companyAccessGrant.grantId });
        return revoked.length;
      };

      let before: string = member.status;
      let after: string = member.status;
      let revokedGrants = 0;
      let changed = false;
      let grantId: string | null = null;

      switch (command.kind) {
        case 'revoke_membership': {
          revokedGrants = await revokeAllGrants();
          await tx.update(tenantMembership).set({ status: 'revoked' }).where(target);
          after = 'revoked';
          changed = member.status !== 'revoked' || revokedGrants > 0;
          break;
        }
        case 'reactivate_membership': {
          if (member.status !== 'revoked') {
            return { ok: false, reason: 'membership_not_revoked' };
          }
          const validUntil = command.validUntil === null ? null : new Date(command.validUntil);
          if (validUntil !== null && validUntil <= now) {
            return { ok: false, reason: 'invalid_command' };
          }
          // Także rekord revoked sprzed 0002 może zawierać nieodwołane granty.
          // Nigdy nie czyścimy cofnięcia; wcześniejsze pozostaje bez zmian.
          revokedGrants = await revokeAllGrants();
          await tx
            .update(tenantMembership)
            .set({ status: 'active', validFrom: now, validUntil })
            .where(target);
          after = 'active';
          changed = true;
          break;
        }
        case 'grant': {
          if (
            member.status !== 'active' ||
            member.validFrom > now ||
            (member.validUntil !== null && member.validUntil <= now)
          ) {
            return { ok: false, reason: 'membership_inactive' };
          }
          const validFrom = command.validFrom === null ? now : new Date(command.validFrom);
          const validUntil = command.validUntil === null ? null : new Date(command.validUntil);
          if (validFrom < now || (validUntil !== null && validUntil <= validFrom)) {
            return { ok: false, reason: 'invalid_command' };
          }

          let entityAvailable: boolean;
          if (snapshotMatches && lockedSnapshot!.entityExists !== undefined) {
            entityAvailable = lockedSnapshot!.entityExists;
          } else {
            const [entity] = await tx
              .select({ id: legalEntity.id })
              .from(legalEntity)
              .where(
                and(
                  eq(legalEntity.tenantId, command.tenantId),
                  eq(legalEntity.id, command.legalEntityId),
                ),
              )
              .for('share');
            entityAvailable = Boolean(entity);
          }
          if (!entityAvailable) {
            return { ok: false, reason: 'grant_unavailable' };
          }

          // Równoległe żądania tego samego okresu/uprawnienia nie mnożą grantów.
          const [existing] = await tx
            .select()
            .from(companyAccessGrant)
            .where(
              and(
                grantsTarget,
                eq(companyAccessGrant.legalEntityId, command.legalEntityId),
                eq(companyAccessGrant.action, command.action),
                isNull(companyAccessGrant.revokedAt),
                command.validFrom === null
                  ? sql`${companyAccessGrant.validFrom} <= ${now.toISOString()}`
                  : eq(companyAccessGrant.validFrom, validFrom),
                validUntil === null
                  ? isNull(companyAccessGrant.validUntil)
                  : eq(companyAccessGrant.validUntil, validUntil),
              ),
            );
          if (existing) {
            grantId = existing.grantId;
            before = 'granted';
            after = 'granted';
            break;
          }
          const [usedId] = await tx
            .select({ id: companyAccessGrant.grantId })
            .from(companyAccessGrant)
            .where(eq(companyAccessGrant.grantId, command.grantId));
          if (usedId) {
            return { ok: false, reason: 'operation_conflict' };
          }
          await tx.insert(companyAccessGrant).values({
            grantId: command.grantId,
            tenantId: command.tenantId,
            userId: command.userId,
            legalEntityId: command.legalEntityId,
            action: command.action,
            validFrom,
            validUntil,
          });
          grantId = command.grantId;
          before = 'absent';
          after = 'granted';
          changed = true;
          break;
        }
        case 'revoke_grant': {
          let grant: GrantRow | null;
          if (snapshotMatches && lockedSnapshot!.targetGrantRow !== undefined) {
            grant = lockedSnapshot!.targetGrantRow;
          } else {
            const [lockedGrant] = await tx
              .select()
              .from(companyAccessGrant)
              .where(and(grantsTarget, eq(companyAccessGrant.grantId, command.grantId)))
              .for('update');
            grant = lockedGrant ?? null;
          }
          if (!grant) {
            return { ok: false, reason: 'grant_unavailable' };
          }
          grantId = grant.grantId;
          before = grant.revokedAt?.toISOString() ?? 'not_revoked';
          const revokedAt =
            grant.revokedAt !== null && grant.revokedAt < now ? grant.revokedAt : now;
          changed = grant.revokedAt === null || grant.revokedAt > now;
          if (changed) {
            await tx
              .update(companyAccessGrant)
              .set({ revokedAt })
              .where(and(grantsTarget, eq(companyAccessGrant.grantId, grantId)));
          }
          after = revokedAt.toISOString();
          revokedGrants = changed ? 1 : 0;
          break;
        }
      }

      const receipt = {
        operationId: command.operationId,
        occurredAt: now.toISOString(),
        changed,
        grantId,
      };
      // Wymagany INSERT, bez catch wewnątrz transakcji: błąd audytu wycofuje wszystkie zmiany.
      await tx.insert(accessManagementEvent).values({
        operationId: command.operationId,
        tenantId: command.tenantId,
        userId: command.userId,
        actorId: actor.userId,
        kind: command.kind,
        grantId,
        occurredAt: now,
        requestKey,
        stateChange: { before, after, revokedGrants },
        receipt,
      });
      return { ok: true, receipt };
    };

    const adapter: AccessManagementTransaction = {
      verifyActorAccount,
      getAuthorizationFacts,
      applySessionContext: (context) => applyLocalRlsSessionContext(tx, context),
      executeAuthorized,
    };
    return Object.freeze(adapter);
  }
}
