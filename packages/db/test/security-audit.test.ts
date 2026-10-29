import { describe, expect, it, vi } from 'vitest';
import type { SecurityAuditEvent } from '@pap/application';
import { appendSecurityDecision } from '../src/security-audit.js';
import type { PostgresTransaction } from '../src/transaction-primitives.js';

const event: SecurityAuditEvent = {
  actorId: null,
  tenantId: null,
  legalEntityId: null,
  action: 'read',
  kind: 'transport',
  decision: 'deny',
  outcome: 'denied',
  reason: 'transport_rejected',
  decidedAt: '2026-10-29T10:00:00.000Z',
};

describe('Minimalny writer audytu bezpieczeństwa', () => {
  it('utrwala tylko allowlistę, generuje identyfikatory i pomija tokeny/surowe błędy', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as unknown as PostgresTransaction;
    await appendSecurityDecision(tx, {
      ...event,
      rawBearerToken: 'synthetic-secret',
      sqlError: 'SELECT password',
      userId: 'untrusted',
    } as SecurityAuditEvent);
    const row = values.mock.calls[0]![0];
    expect(row.actorId).toBeNull();
    expect(row.reason).toBe('transport_rejected');
    expect(row.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(row.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(row)).not.toMatch(/synthetic-secret|SELECT password|untrusted/);
  });

  it('awaria INSERT oraz niekontrolowany kod przyczyny są redagowane i fail-closed', async () => {
    const tx = {
      insert: () => ({
        values: async () => {
          throw new Error('SQL secret');
        },
      }),
    } as unknown as PostgresTransaction;
    await expect(appendSecurityDecision(tx, event)).rejects.toThrow(
      'Audyt decyzji dostępowej jest niedostępny.',
    );
    await expect(
      appendSecurityDecision(tx, { ...event, reason: 'raw SQL' } as unknown as SecurityAuditEvent),
    ).rejects.toThrow('Audyt decyzji dostępowej jest niedostępny.');
  });

  it('SEC-03: egzekwuje niezmienniki outcome_unknown i transaction_outcome_unknown w writerze audytu', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as unknown as PostgresTransaction;
    const validUuid1 = '00000000-0000-4000-8000-000000000001';
    const validUuid2 = '00000000-0000-4000-8000-000000000002';
    const validUuid3 = '00000000-0000-4000-8000-000000000003';

    await appendSecurityDecision(tx, {
      requestId: validUuid1,
      operationId: validUuid1,
      actorId: validUuid2,
      tenantId: validUuid3,
      legalEntityId: null,
      action: 'revoke_membership',
      kind: 'access',
      decision: 'allow',
      outcome: 'outcome_unknown',
      reason: 'transaction_outcome_unknown',
      decidedAt: '2026-10-29T10:00:00.000Z',
    });
    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]![0]).toMatchObject({
      decision: 'allow',
      outcome: 'outcome_unknown',
      reason: 'transaction_outcome_unknown',
      accessManagementOperationId: null,
    });

    // Niedozwolone kombinacje muszą zostać odrzucone fail-closed przed INSERT:
    for (const invalid of [
      // outcome_unknown z inną przyczyną
      {
        actorId: validUuid2,
        tenantId: validUuid3,
        legalEntityId: null,
        action: 'read' as const,
        kind: 'company' as const,
        decision: 'allow' as const,
        outcome: 'outcome_unknown' as const,
        reason: 'operation_failed' as const,
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // transaction_outcome_unknown z outcome = rolled_back
      {
        actorId: validUuid2,
        tenantId: validUuid3,
        legalEntityId: null,
        action: 'read' as const,
        kind: 'company' as const,
        decision: 'allow' as const,
        outcome: 'rolled_back' as const,
        reason: 'transaction_outcome_unknown' as const,
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // deny z outcome_unknown
      {
        actorId: validUuid2,
        tenantId: validUuid3,
        legalEntityId: null,
        action: 'read' as const,
        kind: 'company' as const,
        decision: 'deny' as const,
        outcome: 'outcome_unknown' as const,
        reason: 'transaction_outcome_unknown' as const,
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // outcome_unknown bez potwierdzonego aktora lub z FK do access_management_event
      {
        actorId: null,
        tenantId: validUuid3,
        legalEntityId: null,
        action: 'read' as const,
        kind: 'company' as const,
        decision: 'allow' as const,
        outcome: 'outcome_unknown' as const,
        reason: 'transaction_outcome_unknown' as const,
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      {
        actorId: validUuid2,
        tenantId: validUuid3,
        legalEntityId: null,
        accessManagementOperationId: validUuid1,
        action: 'revoke_membership' as const,
        kind: 'access' as const,
        decision: 'allow' as const,
        outcome: 'outcome_unknown' as const,
        reason: 'transaction_outcome_unknown' as const,
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
    ]) {
      await expect(appendSecurityDecision(tx, invalid)).rejects.toThrow(
        'Audyt decyzji dostępowej jest niedostępny.',
      );
    }
    expect(values).toHaveBeenCalledTimes(1);
  });
});
