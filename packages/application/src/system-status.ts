import type { SystemStatus } from '@pap/contracts';

export function getSystemStatus(): SystemStatus {
  return {
    service: 'Polish Accounting Platform',
    status: 'ok',
    version: '0.1.0',
    modules: {
      accounting: 'not_available',
      tenantAuthorization: 'not_available',
      remoteMcp: 'not_available',
    },
  };
}
