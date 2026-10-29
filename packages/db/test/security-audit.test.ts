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
});
