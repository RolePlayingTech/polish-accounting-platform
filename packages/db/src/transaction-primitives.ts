import {
  ConfirmedTransactionRollbackError,
  freezeTransactionActor,
  TransactionOutcomeUnknownError,
  type LockedTenantAuthorizationFacts,
  type TenantAuthorizationQuery,
  type TransactionActor,
  type TransactionSessionContext,
} from '@pap/application';
import { legalEntityId, tenantId, userId } from '@pap/domain';
import { and, asc, eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import type { connectDatabase } from './client.js';
import {
  appUser,
  companyAccessGrant,
  legalEntity,
  tenantMembership,
  userOidcIdentity,
} from './schema.js';

type Database = ReturnType<typeof connectDatabase>['db'];
export type PostgresTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const ROLLBACK_BRAND = Symbol('pap.rollback_with_value');
const PRE_COMMIT_ABORT_BRAND = Symbol('pap.pre_commit_abort');

class RollbackTransactionWithValue<T> extends Error {
  readonly [ROLLBACK_BRAND] = true;

  constructor(readonly value: T) {
    super('Transakcja wycofana po kontrolowanej odmowie.');
    this.name = 'RollbackTransactionWithValue';
  }
}

/**
 * Wewnętrzny nośnik przerwania sprzed fazy COMMIT.
 * W `postgres.js` (`scope`) wyjątek rzucony z callbacku powoduje wykonanie `await sql\`rollback\``,
 * a ten sam obiekt błędu wraca wyłącznie wtedy, gdy serwer PostgreSQL potwierdził `ROLLBACK`.
 * Jeśli `ROLLBACK` lub późniejszy `COMMIT` utraci połączenie/potwierdzenie, `postgres.js`
 * odrzuci Promise błędem transportowym/protokołu zamiast tego nośnika.
 */
class PreCommitAbortCarrier extends Error {
  readonly [PRE_COMMIT_ABORT_BRAND] = true;

  constructor(readonly originalError: unknown) {
    super('Przerwanie transakcji przed fazą COMMIT.');
    this.name = 'PreCommitAbortCarrier';
  }
}

function isRollbackWithValue<T>(error: unknown): error is RollbackTransactionWithValue<T> {
  return (
    typeof error === 'object' &&
    error !== null &&
    ROLLBACK_BRAND in error &&
    (error as { readonly [ROLLBACK_BRAND]?: unknown })[ROLLBACK_BRAND] === true
  );
}

function isPreCommitAbortCarrier(error: unknown): error is PreCommitAbortCarrier {
  return (
    typeof error === 'object' &&
    error !== null &&
    PRE_COMMIT_ABORT_BRAND in error &&
    (error as { readonly [PRE_COMMIT_ABORT_BRAND]?: unknown })[PRE_COMMIT_ABORT_BRAND] === true
  );
}

/**
 * Serwer PostgreSQL wykonuje odroczone triggery i więzy integralności (`23xxx`, w tym `23514`
 * z `DEFERRABLE INITIALLY DEFERRED` audytu w 0005 / SEC-01/02) oraz walidację serializacji (`40xxx`)
 * PRZED `RecordTransactionCommit()`, a `postgres.js` konstruuje `PostgresError` wyłącznie po
 * odebraniu protokołowego `ErrorResponse` + `ReadyForQuery('I')`. Dla błędów transportowych oraz
 * klas bez gwarancji wycofania przed zapisem WAL (`08xxx`, `53xxx`, `57xxx`, `58xxx`, `XXxxx`)
 * zwraca `false`, zachowując fail-closed `TransactionOutcomeUnknownError`.
 */
function isServerConfirmedCommitRollback(error: unknown): boolean {
  return (
    error instanceof postgres.PostgresError &&
    typeof error.code === 'string' &&
    /^(?:23|40)[0-9A-Z]{3}$/.test(error.code)
  );
}

/**
 * Wykonuje pracę w jednej transakcji PostgreSQL i rozróżnia trzy stany zakończenia (SEC-03):
 * 1) potwierdzony COMMIT (`db.transaction` rozwiązało się po `commitRequested = true`),
 * 2) potwierdzony ROLLBACK (przed fazą COMMIT z potwierdzonym `ROLLBACK` albo odrzucenie `COMMIT`
 *    przez odroczony constraint/serializację `23xxx`/`40xxx` potwierdzone przez `ErrorResponse` + `ReadyForQuery`),
 * 3) niepewny wynik zakończenia transakcji (`TransactionOutcomeUnknownError`), m.in. gdy połączenie
 *    lub potwierdzenie zostało utracone w fazie `COMMIT` albo `ROLLBACK`.
 */
export async function runManagedTransaction<TResult>(
  db: Pick<Database, 'transaction'>,
  work: (tx: PostgresTransaction) => Promise<TResult>,
  shouldCommit: (result: TResult) => boolean,
): Promise<TResult> {
  let commitRequested = false;
  try {
    return await db.transaction(
      async (tx) => {
        let result: TResult;
        try {
          result = await work(tx);
          if (!shouldCommit(result)) {
            throw new RollbackTransactionWithValue(result);
          }
        } catch (error) {
          throw new PreCommitAbortCarrier(error);
        }
        commitRequested = true;
        return result;
      },
      { isolationLevel: 'read committed' },
    );
  } catch (error) {
    if (!commitRequested && isPreCommitAbortCarrier(error)) {
      if (isRollbackWithValue<TResult>(error.originalError)) {
        return error.originalError.value;
      }
      throw new ConfirmedTransactionRollbackError(error.originalError);
    }
    if (commitRequested && isServerConfirmedCommitRollback(error)) {
      throw new ConfirmedTransactionRollbackError(error);
    }
    throw new TransactionOutcomeUnknownError(
      isPreCommitAbortCarrier(error) ? error.originalError : error,
    );
  }
}

/**
 * Pobiera autorytatywny czas z zegara PostgreSQL (`clock_timestamp()`) z precyzją milisekundową.
 * Musi być wywoływany PO uzyskaniu blokad wierszowych, ponieważ `transaction_timestamp()` (NOW())
 * pochodziłby sprzed oczekiwania na blokadę konkurencyjnej transakcji.
 */
export async function readTransactionClockNow(tx: PostgresTransaction): Promise<Date> {
  const times = await tx.execute<{ now: string }>(
    sql`SELECT date_trunc('milliseconds', clock_timestamp())::text AS now`,
  );
  const rawNow = times[0]?.now;
  if (typeof rawNow !== 'string') {
    throw new Error('Brak odczytu zegara transakcyjnego PostgreSQL.');
  }
  const parsed = new Date(rawNow);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Niepoprawny odczyt zegara transakcyjnego PostgreSQL.');
  }
  return parsed;
}

/**
 * Poziomy 1–2 kanonicznego porządku blokad (DAG):
 * 1) `app_user` (FOR SHARE) — blokuje konkurencyjne wyłączenie konta (`disableUserAccount` FOR UPDATE)
 *    i wymusza odczyt aktualnego statusu po zwolnieniu ewentualnej blokady.
 * 2) `user_oidc_identity` (FOR SHARE, gdy aktor przyszedł ze ścieżki OIDC) — potwierdza aktywność
 *    konkretnej pary `(issuer, subject)` w tym samym porządku tabel co `revokeOidcIdentity`.
 */
export async function verifyAndLockActorInTx(
  tx: PostgresTransaction,
  rawActor: TransactionActor,
): Promise<boolean> {
  let actor: TransactionActor;
  try {
    actor = freezeTransactionActor(rawActor);
  } catch {
    return false;
  }

  const [userRow] = await tx
    .select({
      id: appUser.id,
      status: appUser.status,
      disabledAt: appUser.disabledAt,
    })
    .from(appUser)
    .where(eq(appUser.id, actor.userId))
    .for('share');

  if (
    !userRow ||
    userRow.id !== actor.userId ||
    userRow.status !== 'active' ||
    userRow.disabledAt !== null
  ) {
    return false;
  }

  if (actor.identity !== undefined) {
    const [identityRow] = await tx
      .select({
        id: userOidcIdentity.id,
        userId: userOidcIdentity.userId,
        issuer: userOidcIdentity.issuer,
        subject: userOidcIdentity.subject,
        status: userOidcIdentity.status,
        revokedAt: userOidcIdentity.revokedAt,
      })
      .from(userOidcIdentity)
      .where(
        and(
          eq(userOidcIdentity.issuer, actor.identity.issuer),
          eq(userOidcIdentity.subject, actor.identity.subject),
        ),
      )
      .for('share');

    if (
      !identityRow ||
      identityRow.userId !== actor.userId ||
      identityRow.issuer !== actor.identity.issuer ||
      identityRow.subject !== actor.identity.subject ||
      identityRow.status !== 'active' ||
      identityRow.revokedAt !== null
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Ustawia parametry sesyjne PostgreSQL ograniczone wyłącznie do bieżącej transakcji (`is_local = true`).
 * Przygotowuje UnitOfWork pod przyszłe polityki PostgreSQL RLS i ograniczoną rolą runtime w etapie 6D-3B.
 * UWAGA: W etapie 6D-3A samo ustawienie zmiennych GUC nie włącza jeszcze polityk RLS na tabelach.
 */
export async function applyLocalRlsSessionContext(
  tx: PostgresTransaction,
  context: TransactionSessionContext,
): Promise<void> {
  const canonicalTenantId = tenantId(context.tenantId);
  const canonicalActorId = userId(context.actorUserId);
  const canonicalEntityId =
    context.legalEntityId === undefined ? '' : legalEntityId(context.legalEntityId);

  await tx.execute(
    sql`SELECT
      set_config('pap.current_tenant_id', ${canonicalTenantId}, true),
      set_config('pap.current_actor_user_id', ${canonicalActorId}, true),
      set_config('pap.current_legal_entity_id', ${canonicalEntityId}, true)`,
  );
}

/**
 * Poziomy 3–5 kanonicznego porządku blokad dla operacji na danych firmy (`read` / `write`):
 * 3) `tenant_membership` (FOR SHARE)
 * 4) `legal_entity` (FOR SHARE)
 * 5) `company_access_grant` (ORDER BY grant_id ASC FOR SHARE)
 * Po uzyskaniu wszystkich blokad odczytuje zegar `clock_timestamp()` w tej samej transakcji.
 */
export async function lockCompanyActionFactsInTx(
  tx: PostgresTransaction,
  query: TenantAuthorizationQuery,
): Promise<LockedTenantAuthorizationFacts> {
  const canonicalTenantId = tenantId(query.tenantId);
  const canonicalUserId = userId(query.userId);
  const canonicalEntityId = legalEntityId(query.legalEntityId);

  const [membershipRow] = await tx
    .select()
    .from(tenantMembership)
    .where(
      and(
        eq(tenantMembership.tenantId, canonicalTenantId),
        eq(tenantMembership.userId, canonicalUserId),
      ),
    )
    .for('share');

  if (!membershipRow) {
    const now = await readTransactionClockNow(tx);
    return {
      membership: null,
      grants: [],
      platformRoleAssignments: [],
      now,
    };
  }

  const mappedMembership = {
    ...membershipRow,
    tenantId: tenantId(membershipRow.tenantId),
    userId: userId(membershipRow.userId),
  };

  const [entityRow] = await tx
    .select({ id: legalEntity.id })
    .from(legalEntity)
    .where(and(eq(legalEntity.tenantId, canonicalTenantId), eq(legalEntity.id, canonicalEntityId)))
    .for('share');

  if (!entityRow) {
    const now = await readTransactionClockNow(tx);
    return {
      membership: mappedMembership,
      grants: [],
      platformRoleAssignments: [],
      now,
    };
  }

  const grantRows = await tx
    .select()
    .from(companyAccessGrant)
    .where(
      and(
        eq(companyAccessGrant.tenantId, canonicalTenantId),
        eq(companyAccessGrant.userId, canonicalUserId),
        eq(companyAccessGrant.legalEntityId, canonicalEntityId),
        eq(companyAccessGrant.action, query.action),
      ),
    )
    .orderBy(asc(companyAccessGrant.grantId))
    .for('share');

  const now = await readTransactionClockNow(tx);

  return {
    membership: mappedMembership,
    grants: grantRows.map((grantRow) => ({
      ...grantRow,
      tenantId: tenantId(grantRow.tenantId),
      userId: userId(grantRow.userId),
      legalEntityId: legalEntityId(grantRow.legalEntityId),
    })),
    // Schemat 6B/6D-3A nie przechowuje ról platformowych dających dostęp księgowy.
    platformRoleAssignments: [],
    now,
  };
}
