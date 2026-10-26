import { describe, expect, it } from 'vitest';
import { getSystemStatus } from '../src/index.js';

describe('getSystemStatus', () => {
  it('reports only the available public status and marks unfinished modules unavailable', () => {
    expect(getSystemStatus()).toEqual({
      service: 'Polish Accounting Platform',
      status: 'ok',
      version: '0.1.0',
      modules: {
        accounting: 'not_available',
        tenantAuthorization: 'not_available',
        remoteMcp: 'not_available',
      },
    });
  });
});
