import type {
  AccessManagementStore,
  CompanyActionTransactionContext,
  CompanyActionUnitOfWork,
  SecurityAuditEvent,
} from '@pap/application';
import { PostgresAccessManagementStore } from './access-management.js';
import type { connectDatabase } from './client.js';
import type { PostgresContextSigner } from './signed-context.js';
import { appendSecurityDecision, PostgresSecurityAudit } from './security-audit.js';
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
  constructor(
    private readonly db: Pick<Database, 'transaction'>,
    private readonly signer?: PostgresContextSigner,
  ) {}

  recordDeniedDecision(event: SecurityAuditEvent): Promise<void> {
    return new PostgresSecurityAudit(this.db, this.signer).recordDecision(event);
  }

  async runCompanyActionInTransaction<TResult>(
    work: (tx: PostgresCompanyActionTransactionContext) => Promise<TResult>,
    shouldCommit: (result: TResult) => boolean,
  ): Promise<TResult> {
    return runManagedTransaction(
      this.db,
      async (tx) => {
        let actorUserId: string | undefined;
        let action: 'read' | 'write' | undefined;
        const context: PostgresCompanyActionTransactionContext = {
          tx,
          recordAuthorizationDecision: (event) => appendSecurityDecision(tx, event, this.signer),
          verifyActorAccount: async (actor) => {
            actorUserId = actor.userId;
            await this.signer?.apply(tx, { purpose: 'actor', actorUserId });
            return verifyAndLockActorInTx(tx, actor);
          },
          getLockedFacts: async (query) => {
            if (query.userId !== actorUserId) throw new Error('Niezgodny aktor transakcji.');
            action = query.action;
            await this.signer?.apply(tx, {
              purpose: 'facts',
              actorUserId,
              tenantId: query.tenantId,
              legalEntityId: query.legalEntityId,
              action,
            });
            return lockCompanyActionFactsInTx(tx, query);
          },
          applySessionContext: async (sessionContext) => {
            if (!action || sessionContext.actorUserId !== actorUserId) {
              throw new Error('Brak zablokowanej decyzji autoryzacyjnej.');
            }
            await this.signer?.apply(tx, {
              purpose: 'company',
              actorUserId,
              tenantId: sessionContext.tenantId,
              ...(sessionContext.legalEntityId
                ? { legalEntityId: sessionContext.legalEntityId }
                : {}),
              action,
              ...(sessionContext.operationId ? { operationId: sessionContext.operationId } : {}),
              ...(sessionContext.decisionAt ? { decisionAt: sessionContext.decisionAt } : {}),
            });
            await applyLocalRlsSessionContext(tx, sessionContext);
          },
        };
        return work(Object.freeze(context));
      },
      shouldCommit,
    );
  }

  createAccessManagementStore(): AccessManagementStore {
    return new PostgresAccessManagementStore(this.db, this.signer);
  }
}
