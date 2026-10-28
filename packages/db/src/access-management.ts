import {
  copyAccessManagementCommand,
  type AccessManagementActor,
  type AccessManagementCommand,
  type AccessManagementResult,
  type AccessManagementStore,
} from '@pap/application';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import {
  accessManagementEvent,
  companyAccessGrant,
  legalEntity,
  tenantMembership,
} from './schema.js';

type Database = ReturnType<typeof connectDatabase>['db'];

/** Zaufany adapter serwerowy; wywoływać przez manageAccess, nigdy bezpośrednio z transportu. */
export class PostgresAccessManagementStore implements AccessManagementStore {
  constructor(private readonly db: Pick<Database, 'transaction'>) {}

  async execute(
    input: AccessManagementCommand,
    actor: AccessManagementActor,
  ): Promise<AccessManagementResult> {
    try {
      const command = copyAccessManagementCommand(input);
      return await this.db.transaction(async (tx): Promise<AccessManagementResult> => {
        const target = and(
          eq(tenantMembership.tenantId, command.tenantId),
          eq(tenantMembership.userId, command.userId),
        );
        // Jedyna kolejność blokad: członkostwo → granty → nowy event. Bez blokady globalnej.
        const [member] = await tx.select().from(tenantMembership).where(target).for('update');
        if (!member) return { ok: false, reason: 'membership_unavailable' };
        const requestKey = JSON.stringify(command);
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
          )
            return { ok: false, reason: 'operation_conflict' };
          return { ok: true, receipt: previous.receipt };
        }
        // clock_timestamp dopiero PO uzyskaniu blokady; transaction_timestamp może być sprzed oczekiwania.
        const times = await tx.execute<{ now: string }>(
          sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
        );
        const now = new Date(times[0]!.now);
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
                sql`(${companyAccessGrant.revokedAt} IS NULL OR ${companyAccessGrant.revokedAt} > ${now})`,
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
            if (member.status !== 'revoked') return { ok: false, reason: 'membership_not_revoked' };
            const validUntil = command.validUntil === null ? null : new Date(command.validUntil);
            if (validUntil !== null && validUntil <= now)
              return { ok: false, reason: 'invalid_command' };
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
            )
              return { ok: false, reason: 'membership_inactive' };
            const validFrom = command.validFrom === null ? now : new Date(command.validFrom);
            const validUntil = command.validUntil === null ? null : new Date(command.validUntil);
            if (validFrom < now || (validUntil !== null && validUntil <= validFrom))
              return { ok: false, reason: 'invalid_command' };
            const [entity] = await tx
              .select({ id: legalEntity.id })
              .from(legalEntity)
              .where(
                and(
                  eq(legalEntity.tenantId, command.tenantId),
                  eq(legalEntity.id, command.legalEntityId),
                ),
              );
            if (!entity) return { ok: false, reason: 'grant_unavailable' };
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
                    ? sql`${companyAccessGrant.validFrom} <= ${now}`
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
            if (usedId) return { ok: false, reason: 'operation_conflict' };
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
            const [grant] = await tx
              .select()
              .from(companyAccessGrant)
              .where(and(grantsTarget, eq(companyAccessGrant.grantId, command.grantId)));
            if (!grant) return { ok: false, reason: 'grant_unavailable' };
            grantId = grant.grantId;
            before = grant.revokedAt?.toISOString() ?? 'not_revoked';
            const revokedAt =
              grant.revokedAt !== null && grant.revokedAt < now ? grant.revokedAt : now;
            changed = grant.revokedAt === null || grant.revokedAt > now;
            if (changed)
              await tx
                .update(companyAccessGrant)
                .set({ revokedAt })
                .where(and(grantsTarget, eq(companyAccessGrant.grantId, grantId)));
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
      });
    } catch {
      return { ok: false, reason: 'access_management_unavailable' };
    }
  }
}
