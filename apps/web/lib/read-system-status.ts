import { SystemStatusSchema, type SystemStatus } from '@pap/contracts';

export type PublicSystemStatusResult =
  { state: 'available'; status: SystemStatus } | { state: 'unavailable' };

interface ReadStatusOptions {
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
}

/**
 * Closed allowlist of API origins permitted when NODE_ENV=production:
 * - http://127.0.0.1:4100 — exact same-host loopback used by SSR in Stage A on Hetzner
 *   so the entire public Nginx vhost remains protected by Basic Auth without exceptions.
 * - https://ksiegowosc.roleplayingtech.com — canonical ASCII HTTPS origin of PAP for
 *   environments without an edge Basic Auth gate on /api/v1/system/status. Requires trusted
 *   DNS configuration for the domain; hostname string matching does not by itself verify
 *   the resolved target IP at the network layer.
 */
const ALLOWED_PRODUCTION_API_ORIGINS = new Set([
  'http://127.0.0.1:4100',
  'https://ksiegowosc.roleplayingtech.com',
]);

function resolveAllowedApiBaseUrl(configuredUrl: string, isProduction: boolean): URL | undefined {
  if (configuredUrl !== configuredUrl.trim()) {
    return undefined;
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    return undefined;
  }

  if (
    (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.pathname !== '/' ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0
  ) {
    return undefined;
  }

  if (isProduction) {
    if (!ALLOWED_PRODUCTION_API_ORIGINS.has(configuredUrl) || baseUrl.origin !== configuredUrl) {
      return undefined;
    }
  }

  return baseUrl;
}

export async function readPublicSystemStatus(
  options: ReadStatusOptions = {},
): Promise<PublicSystemStatusResult> {
  const isProduction = process.env.NODE_ENV === 'production';
  const configuredUrl =
    options.apiBaseUrl ??
    process.env.API_BASE_URL ??
    (isProduction ? undefined : 'http://127.0.0.1:4000');

  if (!configuredUrl) {
    return { state: 'unavailable' };
  }

  const baseUrl = resolveAllowedApiBaseUrl(configuredUrl, isProduction);
  if (!baseUrl) {
    return { state: 'unavailable' };
  }

  try {
    const response = await (options.fetcher ?? fetch)(new URL('/api/v1/system/status', baseUrl), {
      cache: 'no-store',
      redirect: 'error',
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
