import { describe, expect, it } from 'vitest';
import { SystemStatusSchema } from '../src/index.js';

const validStatus = {
  service: 'Polish Accounting Platform',
  status: 'ok',
  version: '0.1.0',
  modules: {
    accounting: 'not_available',
    tenantAuthorization: 'not_available',
    remoteMcp: 'not_available',
  },
} as const;

describe('SystemStatus contract', () => {
  it('accepts the public status contract', () => {
    expect(SystemStatusSchema.parse(validStatus)).toEqual(validStatus);
  });

  it('rejects unexpected fields rather than returning them to callers', () => {
    expect(
      SystemStatusSchema.safeParse({ ...validStatus, tenantName: 'Niezaufane dane' }).success,
    ).toBe(false);
  });

  it('rejects a status that claims tenant access is implemented', () => {
    expect(
      SystemStatusSchema.safeParse({
        ...validStatus,
        modules: { ...validStatus.modules, tenantAuthorization: 'available' },
      }).success,
    ).toBe(false);
  });
});
