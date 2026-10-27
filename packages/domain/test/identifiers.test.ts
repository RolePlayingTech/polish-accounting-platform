import { describe, expect, it } from 'vitest';
import { InvalidIdentifierError, legalEntityId, tenantId, userId } from '../src/index.js';

describe('tenant and legal entity identifiers', () => {
  it('accepts UUIDs and normalizes their case', () => {
    expect(tenantId('A7f68c3a-45e2-4b3c-91bd-2a3c988ec7d2')).toBe(
      'a7f68c3a-45e2-4b3c-91bd-2a3c988ec7d2',
    );
    expect(legalEntityId('3d7b0c53-d015-40bc-8bea-c6507b8bfb3f')).toBe(
      '3d7b0c53-d015-40bc-8bea-c6507b8bfb3f',
    );
  });

  it('rejects a malformed tenant identifier', () => {
    expect(() => tenantId('../tenant-b')).toThrow(InvalidIdentifierError);
  });

  it('rejects a malformed company identifier', () => {
    expect(() => legalEntityId('not-a-uuid')).toThrow(InvalidIdentifierError);
  });

  it('accepts user identifiers using the same UUID validation', () => {
    expect(userId('B1874848-D011-44AA-B1C9-42F892419C0A')).toBe(
      'b1874848-d011-44aa-b1c9-42f892419c0a',
    );
  });
});
