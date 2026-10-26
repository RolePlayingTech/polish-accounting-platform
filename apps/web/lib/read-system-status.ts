import { SystemStatusSchema, type SystemStatus } from '@pap/contracts';

export type PublicSystemStatusResult =
  { state: 'available'; status: SystemStatus } | { state: 'unavailable' };

interface ReadStatusOptions {
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
}

export async function readPublicSystemStatus(
  options: ReadStatusOptions = {},
): Promise<PublicSystemStatusResult> {
  const configuredUrl =
    options.apiBaseUrl ??
    process.env.API_BASE_URL ??
    (process.env.NODE_ENV === 'production' ? undefined : 'http://127.0.0.1:4000');

  if (!configuredUrl) {
    return { state: 'unavailable' };
  }

  try {
    const baseUrl = new URL(configuredUrl);
    if (
      (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
      baseUrl.username.length > 0 ||
      baseUrl.password.length > 0 ||
      (process.env.NODE_ENV === 'production' && baseUrl.protocol !== 'https:')
    ) {
      return { state: 'unavailable' };
    }

    const response = await (options.fetcher ?? fetch)(new URL('/api/v1/system/status', baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) {
      return { state: 'unavailable' };
    }

    const parsed = SystemStatusSchema.safeParse(await response.json());
    return parsed.success ? { state: 'available', status: parsed.data } : { state: 'unavailable' };
  } catch {
    return { state: 'unavailable' };
  }
}
