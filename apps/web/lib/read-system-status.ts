import { SystemStatusSchema, type SystemStatus } from '@pap/contracts';

export type PublicSystemStatusResult =
  { state: 'available'; status: SystemStatus } | { state: 'unavailable' };

interface ReadStatusOptions {
  apiBaseUrl?: string;
  fetcher?: typeof fetch;
}

const PRODUCTION_LOOPBACK_API_URL = 'http://127.0.0.1:4100';

function isForbiddenProductionHttpsHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '');
  if (
    normalized.length === 0 ||
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized.startsWith('[') ||
    normalized.includes(':')
  ) {
    return true;
  }

  return /^\d+(?:\.\d+){0,3}$/.test(normalized) || /^0x[0-9a-f]+/i.test(normalized);
}

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
    const isExactProductionLoopback =
      configuredUrl === PRODUCTION_LOOPBACK_API_URL &&
      baseUrl.origin === PRODUCTION_LOOPBACK_API_URL &&
      baseUrl.protocol === 'http:' &&
      baseUrl.hostname === '127.0.0.1' &&
      baseUrl.port === '4100';

    if (isExactProductionLoopback) {
      return baseUrl;
    }

    if (baseUrl.protocol !== 'https:' || isForbiddenProductionHttpsHost(baseUrl.hostname)) {
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
