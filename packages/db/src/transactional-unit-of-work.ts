import {
  auditIdentifier,
  freezeTransactionActor,
  type AccessManagementStore,
  type CompanyActionTransactionContext,
  type CompanyActionUnitOfWork,
  type SecurityAuditEvent,
  type TenantAuthorizationQuery,
  type TransactionActor,
} from '@pap/application';
import { decideAccountingAccess, legalEntityId, tenantId, userId } from '@pap/domain';
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
        let verificationAttempted = false;
        let verifiedActor: TransactionActor | undefined;
        let factsRequested = false;
        let authorizedQuery: TenantAuthorizationQuery | undefined;
        let decisionAt: string | undefined;
        let operationId: string | null = null;
        let sessionApplied = false;
        const context: PostgresCompanyActionTransactionContext = {
          tx,
          recordAuthorizationDecision: async (event) => {
            if (
              !sessionApplied || !authorizedQuery || event.kind !== 'company' ||
              event.decision !== 'allow' || event.outcome !== 'committed' ||
              event.actorId !== authorizedQuery.userId || event.tenantId !== authorizedQuery.tenantId ||
              event.legalEntityId !== authorizedQuery.legalEntityId || event.action !== authorizedQuery.action ||
              auditIdentifier(event.operationId) !== operationId || event.decidedAt !== decisionAt
            ) throw new Error('Audyt nie odpowiada zablokowanej decyzji.');
            await appendSecurityDecision(tx, event, this.signer);
          },
          verifyActorAccount: async (rawActor) => {
            // Jedna tożsamość w TX. Wynik false nie zostawia aktora uprawnionego do podpisu.
            if (verificationAttempted) throw new Error('Aktor transakcji został już wybrany.');
            verificationAttempted = true;
            const actor = freezeTransactionActor(rawActor);
            await this.signer?.apply(tx, { purpose: 'actor', actorUserId: actor.userId });
            if (!(await verifyAndLockActorInTx(tx, actor))) return false;
            verifiedActor = actor;
            return true;
          },
          getLockedFacts: async (rawQuery) => {
            if (!verifiedActor || factsRequested || rawQuery.userId !== verifiedActor.userId) {
              throw new Error('Brak zweryfikowanego aktora lub zakres został już wybrany.');
            }
            factsRequested = true;
            if (rawQuery.action !== 'read' && rawQuery.action !== 'write') throw new Error('Niepoprawna akcja.');
            const query = Object.freeze({
              userId: userId(rawQuery.userId), tenantId: tenantId(rawQuery.tenantId),
              legalEntityId: legalEntityId(rawQuery.legalEntityId), action: rawQuery.action,
            });
            await this.signer?.apply(tx, {
              purpose: 'facts',
              actorUserId: verifiedActor.userId,
              tenantId: query.tenantId,
              legalEntityId: query.legalEntityId,
              action: query.action,
            });
            const facts = await lockCompanyActionFactsInTx(tx, query);
            // Adapter sam sprawdza politykę na prywatnej kopii faktów, również przy pominięciu helpera.
            if (decideAccountingAccess({ ...query, ...facts }).allowed) {
              authorizedQuery = query;
              decisionAt = facts.now.toISOString();
            }
            return structuredClone(facts);
          },
          applySessionContext: async (sessionContext) => {
            if (
              sessionApplied || !authorizedQuery || !decisionAt ||
              sessionContext.actorUserId !== authorizedQuery.userId ||
              sessionContext.tenantId !== authorizedQuery.tenantId ||
              sessionContext.legalEntityId !== authorizedQuery.legalEntityId ||
              sessionContext.decisionAt !== decisionAt
            ) {
              throw new Error('Brak zablokowanej decyzji autoryzacyjnej.');
            }
            operationId = auditIdentifier(sessionContext.operationId);
            if (authorizedQuery.action === 'write' && operationId === null) {
              throw new Error('Zapis wymaga identyfikatora operacji.');
            }
            sessionApplied = true;
            await this.signer?.apply(tx, {
              purpose: 'company',
              actorUserId: authorizedQuery.userId,
              tenantId: sessionContext.tenantId,
              legalEntityId: authorizedQuery.legalEntityId,
              action: authorizedQuery.action,
              ...(operationId ? { operationId } : {}),
              decisionAt,
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
