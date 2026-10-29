import {
  copyAccessManagementCommand,
  manageAccess,
  SecurityAuditUnavailableError,
  type SecurityAuditEvent,
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
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { connectDatabase } from './client.js';
import type { PostgresContextSigner } from './signed-context.js';
import { appendSecurityDecision, PostgresSecurityAudit } from './security-audit.js';
import { companyAccessGrant, legalEntity, tenantMembership } from './schema.js';
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
  constructor(
    private readonly db: Pick<Database, 'transaction'>,
    private readonly signer?: PostgresContextSigner,
  ) {}

  recordDeniedDecision(event: SecurityAuditEvent): Promise<void> {
    return new PostgresSecurityAudit(this.db, this.signer).recordDecision(event);
  }

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
      if (error instanceof SecurityAuditUnavailableError) {
        return { ok: false, reason: 'authorization_audit_unavailable' };
      }
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
    return manageAccess(input, {
      store: this,
      actors: { getVerifiedActor: async () => freezeTransactionActor(actor) },
      authorizer: createTenantAccessManagementAuthorizer(),
    });
  }

  private createTransactionAdapter(tx: PostgresTransaction): AccessManagementTransaction {
    let verifiedActorKey: string | null = null;
    let lockedSnapshot: LockedAccessManagementSnapshot | null = null;
    let cachedFacts: AccessManagementAuthorizationFacts | undefined;

    const recordAccessAllow = async (
      command: AccessManagementCommand,
      actor: AccessManagementActor,
      now: Date,
    ) =>
      appendSecurityDecision(
        tx,
        {
          requestId: command.operationId,
          operationId: command.operationId,
          accessManagementOperationId: command.operationId,
          actorId: actor.userId,
          targetUserId: command.userId,
          tenantId: command.tenantId,
          legalEntityId:
            command.kind === 'grant'
              ? command.legalEntityId
              : (lockedSnapshot?.targetGrantRow?.legalEntityId ?? null),
          action: command.kind,
          kind: 'access',
          decision: 'allow',
          outcome: 'committed',
          reason: 'authorized_tenant_administration',
          decidedAt: now.toISOString(),
        },
        this.signer,
      );

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
      await this.signer?.apply(tx, { purpose: 'actor', actorUserId: actor.userId });
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
      await this.signer?.apply(tx, {
        purpose: 'facts',
        actorUserId: actor.userId,
        tenantId: command.tenantId,
        targetUserId: command.userId,
        command,
        ...(command.kind === 'grant' ? { legalEntityId: command.legalEntityId } : {}),
      });
      if (
        cachedFacts &&
        lockedSnapshot?.requestKey === JSON.stringify(command) &&
        lockedSnapshot.actorKey === currentActorKey
      ) {
        return structuredClone(cachedFacts);
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

      cachedFacts = {
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
      return structuredClone(cachedFacts);
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

      // Niezależnie od wstrzykniętego autoryzatora wymuszamy wspólną politykę domenową.
      if (
        !(await createTenantAccessManagementAuthorizer().authorize(actor, command, {
          getAuthorizationFacts,
        }))
      )
        return { ok: false, reason: 'access_management_denied' };
      await this.signer?.apply(tx, {
        purpose: 'access',
        actorUserId: actor.userId,
        tenantId: command.tenantId,
        targetUserId: command.userId,
        command,
        decisionAt: lockedSnapshot!.now.toISOString(),
        ...(command.kind === 'grant' ? { legalEntityId: command.legalEntityId } : {}),
      });
      // Wyłącznie funkcja DB wykonuje komendę i tworzy receipt z rzeczywistymi OLD/NEW.
      // Runtime zachowuje uprawnienia blokowania wierszy, ale nie ma ścieżki surowego DML.
      const [row] = await tx.execute<{ result: AccessManagementResult }>(
        sql`SELECT pap_execute_access() AS result`,
      );
      if (!row) throw new Error('Brak wyniku kontrolowanej operacji dostępu.');
      if (row.result.ok) await recordAccessAllow(command, actor, lockedSnapshot!.now);
      return row.result;
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
