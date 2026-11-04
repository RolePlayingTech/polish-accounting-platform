import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { PostgresContextSigner, loadDatabaseContextSigner } from '../src/signed-context.js';
import type { PostgresTransaction } from '../src/transaction-primitives.js';
import { PgDialect } from 'drizzle-orm/pg-core';

describe('Podpisany kontekst transakcji', () => {
  it('wiąże podpis z tx, backendem, rolą i bazą; SET jest lokalny i parametryzowany', async () => {
    const binding = {
      xid: '1234',
      pid: 42,
      database: 'pap_test',
      role: 'pap_test_app',
      expires: '100000',
    };
    const execute = vi.fn().mockResolvedValueOnce([binding]).mockResolvedValueOnce([]);
    const signer = new PostgresContextSigner({ keyId: 'synthetic', keyHex: 'ab'.repeat(32) });
    await signer.apply({ execute } as unknown as PostgresTransaction, {
      purpose: 'company',
      actorUserId: 'actor',
      tenantId: 'tenant',
      legalEntityId: 'company',
      action: 'write',
    });
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1]![0]);
    const [payload, signature] = query.params as string[];
    expect(JSON.parse(payload!)).toMatchObject({
      ...binding,
      purpose: 'company',
      action: 'write',
      key_id: 'synthetic',
    });
    expect(signature).toBe(
      createHmac('sha256', Buffer.from('ab'.repeat(32), 'hex'))
        .update(payload!)
        .digest('hex'),
    );
    expect(query.sql).toContain("set_config('pap.context', $1, true)");
    expect(query.sql).toContain("set_config('pap.context_signature', $2, true)");
    expect(query.sql).not.toContain('abababab');
    expect(JSON.stringify(signer)).toBe('{}');
  });

  it('brak klucza i niepoprawny klucz są fail-closed', () => {
    expect(() => loadDatabaseContextSigner({})).toThrow('Niepoprawna konfiguracja');
    expect(() => new PostgresContextSigner({ keyId: 'x', keyHex: 'short' })).toThrow();
  });
});
