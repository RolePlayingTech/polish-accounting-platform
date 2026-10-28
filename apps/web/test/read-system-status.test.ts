import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readPublicSystemStatus', () => {
  it('reads the validated public status from the API with redirects disabled', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));

    const result = await readPublicSystemStatus({ apiBaseUrl: 'http://127.0.0.1:4000', fetcher });

    expect(result).toEqual({ state: 'available', status });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4000/api/v1/system/status'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
      }),
    );
  });

  it('allows the exact staging loopback API URL in NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));

    const result = await readPublicSystemStatus({ apiBaseUrl: 'http://127.0.0.1:4100', fetcher });

    expect(result).toEqual({ state: 'available', status });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4100/api/v1/system/status'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
      }),
    );
  });

  it('allows a public HTTPS origin without path or credentials in NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));

    const result = await readPublicSystemStatus({
      apiBaseUrl: 'https://xn--ksigowo-c5a1nq1a.roleplayingtech.com',
      fetcher,
    });

    expect(result).toEqual({ state: 'available', status });
    expect(fetcher).toHaveBeenCalledWith(
      new URL('https://xn--ksigowo-c5a1nq1a.roleplayingtech.com/api/v1/system/status'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
      }),
    );
  });

  it.each([
    undefined,
    'http://127.0.0.1:4000',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:4100/',
    'http://127.0.0.1:4100/custom',
    'http://127.0.0.1:4100?redirect=1',
    'http://127.0.0.1:4100#section',
    ' http://127.0.0.1:4100',
    'http://localhost:4100',
    'http://[::1]:4100',
    'http://0.0.0.0:4100',
    'http://10.0.0.1:4100',
    'http://172.16.0.1:4100',
    'http://192.168.1.1:4100',
    'http://169.254.169.254',
    'http://xn--ksigowo-c5a1nq1a.roleplayingtech.com',
    'https://localhost:4100',
    'https://sub.localhost:4100',
    'https://internal.local',
    'https://127.0.0.1:4100',
    'https://127.0.0.1:3001',
    'https://[::1]:4100',
    'https://10.0.0.1:4100',
    'https://192.168.1.1:4100',
    'https://169.254.169.254',
    'https://user:secret@xn--ksigowo-c5a1nq1a.roleplayingtech.com',
    'https://xn--ksigowo-c5a1nq1a.roleplayingtech.com/prefix',
    'https://xn--ksigowo-c5a1nq1a.roleplayingtech.com?env=prod',
  ])('rejects disallowed production API_BASE_URL %s before calling fetch', async (apiBaseUrl) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_BASE_URL', '');
    const fetcher = vi.fn<typeof fetch>();

    await expect(readPublicSystemStatus({ apiBaseUrl, fetcher })).resolves.toEqual({
      state: 'unavailable',
    });
    expect(fetcher).not.toHaveBeenCalled();
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

  it('returns an unavailable state when fetch rejects an HTTP redirect', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('fetch failed: redirect mode is set to error'));

    await expect(
      readPublicSystemStatus({ apiBaseUrl: 'http://127.0.0.1:4100', fetcher }),
    ).resolves.toEqual({
      state: 'unavailable',
    });
  });

  it('does not request a URL containing credentials, path, query, or hash', async () => {
    const fetcher = vi.fn<typeof fetch>();

    for (const apiBaseUrl of [
      'http://user:secret@127.0.0.1:4000',
      'http://127.0.0.1:4000/custom-path',
      'http://127.0.0.1:4000?foo=bar',
      'http://127.0.0.1:4000#hash',
    ]) {
      await expect(readPublicSystemStatus({ apiBaseUrl, fetcher })).resolves.toEqual({
        state: 'unavailable',
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
