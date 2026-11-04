import {
  auditIdentifier,
  freezeTransactionActor,
  type AccessManagementStore,
  type CompanyActionAuthorizationSession,
  type CompanyActionUnitOfWork,
  type CompanyRlsSessionContext,
  type SecurityAuditEvent,
  type TenantAuthorizationQuery,
  type TransactionActor,
} from '@pap/application';
import { decideAccountingAccess, legalEntityId, tenantId, userId } from '@pap/domain';
import { PostgresAccessManagementStore } from './access-management.js';
import type { connectDatabase } from './client.js';
import {
  createPostgresCompanyActionScope,
  ScopeClosedError,
  type PostgresCompanyActionScope,
  type PostgresCompanyActionScopeDriver,
  type PostgresCompanyActionScopeFactory,
} from './company-operation-probe.js';
import { appendSecurityDecision, PostgresSecurityAudit } from './security-audit.js';
import type { PostgresContextSigner } from './signed-context.js';
import {
  applyLocalRlsSessionContext,
  lockCompanyActionFactsInTx,
  runManagedTransaction,
  verifyAndLockActorInTx,
} from './transaction-primitives.js';

export {
  ScopeClosedError,
  type PostgresCompanyActionScope,
  type PostgresCompanyActionScopeDriver,
  type PostgresCompanyActionScopeFactory,
};

type Database = ReturnType<typeof connectDatabase>['db'];

/**
 * Reużywalny transakcyjny UnitOfWork PostgreSQL (6D-3 / SEC-04) przeznaczony dla:
 * - operacji odczytu i zapisu dokumentów firmowych (`executeAuthorizedCompanyAction`),
 * - operacji administracji dostępem (`createAccessManagementStore` -> `manageAccess`),
 * - przyszłych repozytoriów Fazy 2 (KPiR, VAT, dokumenty, księgi) przez rozszerzalne `scopeFactory`
 *   bez jakiejkolwiek ekspozycji surowego `PostgresTransaction`, signera ani sesji autoryzacyjnej.
 */
export class PostgresTransactionalUnitOfWork<TScope = PostgresCompanyActionScope>
  implements CompanyActionUnitOfWork<TScope>
{
  readonly #db: Pick<Database, 'transaction'>;
  readonly #signer: PostgresContextSigner | undefined;
  readonly #scopeFactory: PostgresCompanyActionScopeFactory<TScope>;

  constructor(
    db: Pick<Database, 'transaction'>,
    signer?: PostgresContextSigner,
    scopeFactory?: PostgresCompanyActionScopeFactory<TScope>,
  ) {
    this.#db = db;
    this.#signer = signer;
    this.#scopeFactory =
      scopeFactory ??
      (createPostgresCompanyActionScope as unknown as PostgresCompanyActionScopeFactory<TScope>);
    Object.freeze(this);
  }

  recordDeniedDecision(event: SecurityAuditEvent): Promise<void> {
    return new PostgresSecurityAudit(this.#db, this.#signer).recordDecision(event);
  }

  async runCompanyActionInTransaction<TResult>(
    work: (session: CompanyActionAuthorizationSession<TScope>) => Promise<TResult>,
    shouldCommit: (result: TResult) => boolean,
  ): Promise<TResult> {
    let sessionApplied = false;
    let decisionRecorded = false;

    return runManagedTransaction(
      this.#db,
      async (tx) => {
        sessionApplied = false;
        decisionRecorded = false;
        let verificationAttempted = false;
        let verifiedActor: TransactionActor | undefined;
        let factsRequested = false;
        let authorizedQuery: TenantAuthorizationQuery | undefined;
        let decisionAt: string | undefined;
        let operationId: string | null = null;
        let scopeActive = false;
        let decisionAttempted = false;

        const assertActive = (): void => {
          if (!scopeActive) {
            throw new ScopeClosedError();
          }
        };

        const session: CompanyActionAuthorizationSession<TScope> = Object.freeze({
          verifyActorAccount: async (rawActor: TransactionActor) => {
            // Jedna tożsamość w TX. Wymagana zweryfikowana tożsamość OIDC eliminuje pominięcie blokady user_oidc_identity.
            if (verificationAttempted) {
              throw new Error('Aktor transakcji został już wybrany.');
            }
            verificationAttempted = true;
            const actor = freezeTransactionActor(rawActor);
            if (actor.identity === undefined) {
              throw new Error('Wymagana zweryfikowana tożsamość OIDC aktora.');
            }
            await this.#signer?.apply(tx, { purpose: 'actor', actorUserId: actor.userId });
            if (!(await verifyAndLockActorInTx(tx, actor))) {
              return false;
            }
            verifiedActor = actor;
            return true;
          },

          getLockedFacts: async (rawQuery: TenantAuthorizationQuery) => {
            if (!verifiedActor || factsRequested || rawQuery.userId !== verifiedActor.userId) {
              throw new Error('Brak zweryfikowanego aktora lub zakres został już wybrany.');
            }
            factsRequested = true;
            if (rawQuery.action !== 'read' && rawQuery.action !== 'write') {
              throw new Error('Niepoprawna akcja.');
            }
            const query: TenantAuthorizationQuery = Object.freeze({
              userId: userId(rawQuery.userId),
              tenantId: tenantId(rawQuery.tenantId),
              legalEntityId: legalEntityId(rawQuery.legalEntityId),
              action: rawQuery.action,
            });
            await this.#signer?.apply(tx, {
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

          enterAuthorizedCompanyScope: async (rawSessionContext: CompanyRlsSessionContext) => {
            if (
              sessionApplied ||
              decisionAttempted ||
              !authorizedQuery ||
              !decisionAt ||
              rawSessionContext.actorUserId !== authorizedQuery.userId ||
              rawSessionContext.tenantId !== authorizedQuery.tenantId ||
              rawSessionContext.legalEntityId !== authorizedQuery.legalEntityId ||
              rawSessionContext.action !== authorizedQuery.action ||
              rawSessionContext.decisionAt !== decisionAt
            ) {
              throw new Error('Brak zablokowanej decyzji autoryzacyjnej.');
            }
            if (rawSessionContext.operationId !== undefined) {
              const parsedOperationId = auditIdentifier(rawSessionContext.operationId);
              if (parsedOperationId === null) {
                throw new Error('Niepoprawny identyfikator operacji.');
              }
              operationId = parsedOperationId;
            } else {
              operationId = null;
            }
            if (authorizedQuery.action === 'write' && operationId === null) {
              throw new Error('Zapis wymaga identyfikatora operacji.');
            }
            const frozenSessionContext: CompanyRlsSessionContext = Object.freeze({
              ...(operationId ? { operationId } : {}),
              decisionAt,
              actorUserId: authorizedQuery.userId,
              tenantId: authorizedQuery.tenantId,
              legalEntityId: authorizedQuery.legalEntityId,
              action: authorizedQuery.action,
            });
            sessionApplied = true;
            await this.#signer?.apply(tx, {
              purpose: 'company',
              actorUserId: authorizedQuery.userId,
              tenantId: authorizedQuery.tenantId,
              legalEntityId: authorizedQuery.legalEntityId,
              action: authorizedQuery.action,
              ...(operationId ? { operationId } : {}),
              decisionAt,
            });
            await applyLocalRlsSessionContext(tx, frozenSessionContext);
            scopeActive = true;
            return this.#scopeFactory(
              Object.freeze({
                tx,
                context: frozenSessionContext,
                assertActive,
              }),
            );
          },

          closeScope: () => {
            scopeActive = false;
          },

          recordAuthorizationDecision: async (event: SecurityAuditEvent) => {
            scopeActive = false;
            if (decisionAttempted || decisionRecorded) {
              throw new Error('Decyzja autoryzacyjna została już zapisana w tej transakcji.');
            }
            decisionAttempted = true;
            if (
              !sessionApplied ||
              !authorizedQuery ||
              !decisionAt ||
              event.kind !== 'company' ||
              event.decision !== 'allow' ||
              event.outcome !== 'committed' ||
              event.actorId !== authorizedQuery.userId ||
              event.tenantId !== authorizedQuery.tenantId ||
              event.legalEntityId !== authorizedQuery.legalEntityId ||
              event.action !== authorizedQuery.action ||
              auditIdentifier(event.operationId) !== operationId ||
              event.decidedAt !== decisionAt
            ) {
              throw new Error('Audyt nie odpowiada zablokowanej decyzji.');
            }
            await appendSecurityDecision(tx, event, this.#signer);
            decisionRecorded = true;
          },
        });

        try {
          return await work(session);
        } finally {
          scopeActive = false;
        }
      },
      (result) => shouldCommit(result) && sessionApplied && decisionRecorded,
    );
  }

  createAccessManagementStore(): AccessManagementStore {
    return new PostgresAccessManagementStore(this.#db, this.#signer);
  }
}
