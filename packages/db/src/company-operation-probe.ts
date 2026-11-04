import { and, eq } from 'drizzle-orm';
import type {
  AuthenticatedCompanyActionContext,
  CompanyRlsSessionContext,
} from '@pap/application';
import { userId } from '@pap/domain';
import { companyOperationProbe } from './schema.js';
import type { PostgresTransaction } from './transaction-primitives.js';

/**
 * Rzucany przy próbie użycia uchwytu repozytorium `scope` po zakończeniu callbacku biznesowego `operation`.
 */
export class ScopeClosedError extends Error {
  constructor(message = 'Zakres operacji firmowej został już zamknięty.') {
    super(message);
    this.name = 'ScopeClosedError';
  }
}

/**
 * Wewnętrzny sterownik przekazywany wyłącznie do zaufanej fabryki repozytoriów w warstwie kompozycji DB.
 * Nigdy nie opuszcza fabryki ani nie trafia do kontrolerów HTTP/MCP.
 */
export interface PostgresCompanyActionScopeDriver {
  readonly tx: PostgresTransaction;
  readonly context: CompanyRlsSessionContext;
  readonly assertActive: () => void;
}

export type PostgresCompanyActionScopeFactory<TScope> = (
  driver: PostgresCompanyActionScopeDriver,
) => TScope;

/**
 * Domyślny, zamrożony uchwyt zakresu operacji firmowej przekazywany do `operation(context, scope)`.
 * Nie udostępnia surowego `PostgresTransaction`, signera ani metod sesji autoryzacyjnej.
 */
export interface PostgresCompanyActionScope {
  recordOperationProbe(operationId?: string): Promise<{ readonly inserted: boolean }>;
}

export function createPostgresCompanyActionScope(
  driver: PostgresCompanyActionScopeDriver,
): PostgresCompanyActionScope {
  const { tx, context, assertActive } = driver;
  return Object.freeze({
    async recordOperationProbe(rawOperationId?: string): Promise<{ readonly inserted: boolean }> {
      assertActive();
      if (context.action !== 'write') {
        throw new Error('Próba wymaga jawnego prawa zapisu.');
      }
      const candidateOperationId = rawOperationId ?? context.operationId;
      if (!candidateOperationId || !context.operationId || !context.decisionAt) {
        throw new Error('Efekt nie należy do zatwierdzonej operacji.');
      }
      const operationId = userId(candidateOperationId);
      if (operationId !== context.operationId) {
        throw new Error('Efekt nie należy do zatwierdzonej operacji.');
      }
      const insertedRows = await tx
        .insert(companyOperationProbe)
        .values({
          operationId,
          tenantId: context.tenantId,
          legalEntityId: context.legalEntityId,
          actorId: context.actorUserId,
          createdAt: new Date(context.decisionAt),
        })
        .onConflictDoNothing()
        .returning({ operationId: companyOperationProbe.operationId });
      assertActive();
      if (insertedRows.length > 0) {
        return Object.freeze({ inserted: true });
      }
      const [previous] = await tx
        .select()
        .from(companyOperationProbe)
        .where(
          and(
            eq(companyOperationProbe.operationId, operationId),
            eq(companyOperationProbe.tenantId, context.tenantId),
            eq(companyOperationProbe.legalEntityId, context.legalEntityId),
            eq(companyOperationProbe.actorId, context.actorUserId),
          ),
        );
      assertActive();
      if (!previous) {
        throw new Error('Konflikt identyfikatora operacji.');
      }
      return Object.freeze({ inserted: false });
    },
  });
}

/**
 * Pomocnicza operacja syntetyczna wywoływana WYŁĄCZNIE wewnątrz `executeAuthorizedCompanyAction`
 * za pośrednictwem zamkniętego uchwytu `PostgresCompanyActionScope` (bez dostępu do `tx`).
 */
export async function recordCompanyOperationProbe(
  context: AuthenticatedCompanyActionContext,
  scope: PostgresCompanyActionScope,
  rawOperationId: string,
): Promise<{ readonly operationId: string; readonly inserted: boolean; readonly created: boolean }> {
  if (context.action !== 'write') {
    throw new Error('Próba wymaga jawnego prawa zapisu.');
  }
  const operationId = userId(rawOperationId);
  if (operationId !== context.operationId || !context.decisionAt) {
    throw new Error('Efekt nie należy do zatwierdzonej operacji.');
  }
  const { inserted } = await scope.recordOperationProbe(operationId);
  return Object.freeze({
    operationId,
    inserted,
    created: inserted,
  });
}
