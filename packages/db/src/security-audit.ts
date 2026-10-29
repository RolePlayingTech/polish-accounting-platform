import { randomUUID } from 'node:crypto';
import {
  auditIdentifier,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_REASONS,
  SecurityAuditUnavailableError,
  type SecurityAuditEvent,
  type SecurityAuditRecorder,
} from '@pap/application';
import type { connectDatabase } from './client.js';
import { securityDecisionEvent } from './schema.js';
import type { PostgresContextSigner } from './signed-context.js';
import { readTransactionClockNow, type PostgresTransaction } from './transaction-primitives.js';

type Database = ReturnType<typeof connectDatabase>['db'];
const actions = [
  'read',
  'write',
  'revoke_membership',
  'reactivate_membership',
  'grant',
  'revoke_grant',
  'unknown',
];

/** Jedyny writer audytu. Jawna allowlista pól wyklucza tokeny, dokumenty i dowolne błędy. */
export async function appendSecurityDecision(
  tx: PostgresTransaction,
  event: SecurityAuditEvent,
  signer?: PostgresContextSigner,
): Promise<void> {
  try {
    if (
      !(SECURITY_AUDIT_REASONS as readonly string[]).includes(event.reason) ||
      !actions.includes(event.action) ||
      !['company', 'access', 'preflight', 'transport'].includes(event.kind) ||
      !['allow', 'deny'].includes(event.decision) ||
      !(SECURITY_AUDIT_OUTCOMES as readonly string[]).includes(event.outcome) ||
      (event.decision === 'deny' && event.outcome !== 'denied') ||
      (event.decision === 'allow' && event.outcome === 'denied') ||
      (event.outcome === 'outcome_unknown' && event.reason !== 'transaction_outcome_unknown') ||
      (event.reason === 'transaction_outcome_unknown' && event.outcome !== 'outcome_unknown')
    ) {
      throw new SecurityAuditUnavailableError();
    }
    const decidedAt = event.decidedAt
      ? new Date(event.decidedAt)
      : await readTransactionClockNow(tx);
    if (!Number.isFinite(decidedAt.getTime())) throw new SecurityAuditUnavailableError();
    const row = {
      id: randomUUID(),
      requestId: auditIdentifier(event.requestId) ?? randomUUID(),
      operationId: auditIdentifier(event.operationId),
      accessManagementOperationId: auditIdentifier(event.accessManagementOperationId),
      actorId: auditIdentifier(event.actorId),
      targetUserId: auditIdentifier(event.targetUserId),
      tenantId: auditIdentifier(event.tenantId),
      legalEntityId: auditIdentifier(event.legalEntityId),
      action: event.action,
      kind: event.kind,
      decision: event.decision,
      outcome: event.outcome,
      reason: event.reason,
      decidedAt,
    };
    if (
      (row.outcome === 'committed' ||
        row.outcome === 'rolled_back' ||
        row.outcome === 'outcome_unknown') &&
      (row.decision !== 'allow' ||
        (row.kind !== 'company' && row.kind !== 'access') ||
        row.actorId === null ||
        row.tenantId === null)
    ) {
      throw new SecurityAuditUnavailableError();
    }
    if (
      row.kind === 'access' &&
      row.outcome === 'committed' &&
      row.accessManagementOperationId === null
    ) {
      throw new SecurityAuditUnavailableError();
    }
    if (
      row.kind === 'company' && row.action === 'write' && row.outcome === 'committed' &&
      (row.operationId === null || row.legalEntityId === null)
    ) throw new SecurityAuditUnavailableError();
    if (
      (row.outcome === 'rolled_back' || row.outcome === 'outcome_unknown') &&
      row.accessManagementOperationId !== null
    ) {
      throw new SecurityAuditUnavailableError();
    }
    // Dokładny payload audytu jest osobno poświadczony; kontekst operacji nie daje INSERT do audytu.
    await signer?.apply(tx, {
      purpose: 'audit',
      auditEvent: {
        id: row.id,
        request_id: row.requestId,
        operation_id: row.operationId,
        access_management_operation_id: row.accessManagementOperationId,
        actor_id: row.actorId,
        target_user_id: row.targetUserId,
        tenant_id: row.tenantId,
        legal_entity_id: row.legalEntityId,
        action: row.action,
        kind: row.kind,
        decision: row.decision,
        outcome: row.outcome,
        reason: row.reason,
        decided_at: decidedAt.toISOString(),
      },
    });
    await tx.insert(securityDecisionEvent).values(row);
  } catch {
    throw new SecurityAuditUnavailableError();
  }
}

/** Osobne, krótkie TX odmów/rollbacków. Nie trzyma połączenia z przerwanej TX. */
export class PostgresSecurityAudit implements SecurityAuditRecorder {
  constructor(
    private readonly db: Pick<Database, 'transaction'>,
    private readonly signer?: PostgresContextSigner,
  ) {}

  async recordDecision(event: SecurityAuditEvent): Promise<void> {
    try {
      await this.db.transaction((tx) => appendSecurityDecision(tx, event, this.signer));
    } catch {
      throw new SecurityAuditUnavailableError();
    }
  }
}
