import { describe, expect, it, vi } from 'vitest';
import { readPublicSystemStatus } from '../lib/read-system-status.js';

const status = {
  service: 'Polish Accounting Platform',
  status: 'ok',
  version: '0.1.0',
  modules: {
    accounting: 'not_available',
    tenantAuthorization: 'not_available',
    remoteMcp: 'not_available',
  },
};

describe('readPublicSystemStatus', () => {
  it('reads the validated public status from the API', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));

    const result = await readPublicSystemStatus({ apiBaseUrl: 'http://127.0.0.1:4000', fetcher });

    expect(result).toEqual({ state: 'available', status });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4000/api/v1/system/status'),
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('returns an unavailable state for an invalid API payload', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ...status, tenantName: 'nieoczekiwane' }), { status: 200 }),
      );

    await expect(
      readPublicSystemStatus({ apiBaseUrl: 'http://127.0.0.1:4000', fetcher }),
    ).resolves.toEqual({
      state: 'unavailable',
    });
  });

  it('does not request a URL containing credentials', async () => {
    const fetcher = vi.fn<typeof fetch>();

    await expect(
      readPublicSystemStatus({ apiBaseUrl: 'http://user:secret@127.0.0.1:4000', fetcher }),
    ).resolves.toEqual({ state: 'unavailable' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
