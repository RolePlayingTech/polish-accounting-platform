import { and, eq } from 'drizzle-orm';
import type { AuthenticatedCompanyActionContext } from '@pap/application';
import { userId } from '@pap/domain';
import { companyOperationProbe } from './schema.js';
import type { PostgresCompanyActionTransactionContext } from './transactional-unit-of-work.js';

/** Wywoływany WYŁĄCZNIE wewnątrz executeAuthorizedCompanyAction, nigdy jako endpoint. */
export async function recordCompanyOperationProbe(
  context: AuthenticatedCompanyActionContext,
  transaction: PostgresCompanyActionTransactionContext,
  rawOperationId: string,
): Promise<{ readonly operationId: string; readonly created: boolean }> {
  if (context.action !== 'write') throw new Error('Próba wymaga jawnego prawa zapisu.');
  const operationId = userId(rawOperationId);
  const inserted = await transaction.tx
    .insert(companyOperationProbe)
    .values({
      operationId,
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      actorId: context.userId,
    })
    .onConflictDoNothing()
    .returning({ operationId: companyOperationProbe.operationId });
  if (inserted.length) return { operationId, created: true };
  const [previous] = await transaction.tx
    .select()
    .from(companyOperationProbe)
    .where(
      and(
        eq(companyOperationProbe.operationId, operationId),
        eq(companyOperationProbe.tenantId, context.tenantId),
        eq(companyOperationProbe.legalEntityId, context.legalEntityId),
        eq(companyOperationProbe.actorId, context.userId),
      ),
    );
  if (!previous) throw new Error('Konflikt identyfikatora operacji.');
  return { operationId, created: false };
}
