import type {
  AccessManagementStore,
  CompanyActionTransactionContext,
  CompanyActionUnitOfWork,
} from '@pap/application';
import { PostgresAccessManagementStore } from './access-management.js';
import type { connectDatabase } from './client.js';
import {
  applyLocalRlsSessionContext,
  lockCompanyActionFactsInTx,
  readTransactionClockNow,
  runManagedTransaction,
  verifyAndLockActorInTx,
  type PostgresTransaction,
} from './transaction-primitives.js';

export {
  applyLocalRlsSessionContext,
  lockCompanyActionFactsInTx,
  readTransactionClockNow,
  runManagedTransaction,
  verifyAndLockActorInTx,
  type PostgresTransaction,
};

type Database = ReturnType<typeof connectDatabase>['db'];

export interface PostgresCompanyActionTransactionContext extends CompanyActionTransactionContext {
  readonly tx: PostgresTransaction;
}

/**
 * Reużywalny transakcyjny UnitOfWork PostgreSQL (6D-3A) przeznaczony dla:
 * - operacji odczytu i zapisu dokumentów firmowych (`executeAuthorizedCompanyAction`),
 * - operacji administracji dostępem (`createAccessManagementStore` -> `manageAccess`),
 * - późniejszej integracji z PostgreSQL RLS i ograniczoną rolą runtime w 6D-3B.
 */
export class PostgresTransactionalUnitOfWork implements CompanyActionUnitOfWork<PostgresCompanyActionTransactionContext> {
  constructor(private readonly db: Pick<Database, 'transaction'>) {}

  async runCompanyActionInTransaction<TResult>(
    work: (tx: PostgresCompanyActionTransactionContext) => Promise<TResult>,
    shouldCommit: (result: TResult) => boolean,
  ): Promise<TResult> {
    return runManagedTransaction(
      this.db,
      async (tx) => {
        const context: PostgresCompanyActionTransactionContext = {
          tx,
          verifyActorAccount: (actor) => verifyAndLockActorInTx(tx, actor),
          getLockedFacts: (query) => lockCompanyActionFactsInTx(tx, query),
          applySessionContext: (sessionContext) => applyLocalRlsSessionContext(tx, sessionContext),
        };
        return work(Object.freeze(context));
      },
      shouldCommit,
    );
  }

  createAccessManagementStore(): AccessManagementStore {
    return new PostgresAccessManagementStore(this.db);
  }
}
