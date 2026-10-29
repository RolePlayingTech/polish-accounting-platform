import { describe, expect, it, vi } from 'vitest';
import type { SecurityAuditEvent } from '@pap/application';
import { appendSecurityDecision } from '../src/security-audit.js';
import type { PostgresTransaction } from '../src/transaction-primitives.js';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

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

  it('SEC-03: akceptuje jawny wpis allow/outcome_unknown bez FK operacji i odrzuca sprzeczne kombinacje', async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    const tx = { insert: vi.fn(() => ({ values })) } as unknown as PostgresTransaction;

    await appendSecurityDecision(tx, {
      requestId: id(1),
      operationId: id(2),
      actorId: id(3),
      targetUserId: id(4),
      tenantId: id(5),
      legalEntityId: id(6),
      action: 'grant',
      kind: 'access',
      decision: 'allow',
      outcome: 'outcome_unknown',
      reason: 'transaction_outcome_unknown',
      decidedAt: '2026-10-29T10:00:00.000Z',
    });

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]![0]).toMatchObject({
      requestId: id(1),
      operationId: id(2),
      accessManagementOperationId: null,
      actorId: id(3),
      tenantId: id(5),
      kind: 'access',
      decision: 'allow',
      outcome: 'outcome_unknown',
      reason: 'transaction_outcome_unknown',
    });

    const invalidEvents: SecurityAuditEvent[] = [
      // outcome_unknown nie może mieć decision='deny'
      {
        actorId: id(3),
        tenantId: id(5),
        legalEntityId: id(6),
        action: 'write',
        kind: 'company',
        decision: 'deny',
        outcome: 'outcome_unknown',
        reason: 'transaction_outcome_unknown',
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // outcome_unknown nie może mieć innego reason niż transaction_outcome_unknown
      {
        actorId: id(3),
        tenantId: id(5),
        legalEntityId: id(6),
        action: 'write',
        kind: 'company',
        decision: 'allow',
        outcome: 'outcome_unknown',
        reason: 'operation_failed',
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // outcome_unknown nie może ustawiać accessManagementOperationId (brak gwarancji zatwierdzenia FK)
      {
        actorId: id(3),
        tenantId: id(5),
        legalEntityId: id(6),
        accessManagementOperationId: id(9),
        action: 'grant',
        kind: 'access',
        decision: 'allow',
        outcome: 'outcome_unknown',
        reason: 'transaction_outcome_unknown',
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
      // rolled_back nie może używać kodu niepewności transaction_outcome_unknown
      {
        actorId: id(3),
        tenantId: id(5),
        legalEntityId: id(6),
        action: 'write',
        kind: 'company',
        decision: 'allow',
        outcome: 'rolled_back',
        reason: 'transaction_outcome_unknown',
        decidedAt: '2026-10-29T10:00:00.000Z',
      },
    ];

    for (const invalid of invalidEvents) {
      await expect(appendSecurityDecision(tx, invalid)).rejects.toThrow(
        'Audyt decyzji dostępowej jest niedostępny.',
      );
    }
  });
});
