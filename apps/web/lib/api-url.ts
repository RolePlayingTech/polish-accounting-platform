/**
 * Bezpieczna walidacja `API_BASE_URL` i klient BFF po stronie serwera `apps/web`.
 * Zachowuje dokładnie tę samą zamkniętą białą listę produkcyjną co `read-system-status.ts`:
 * - lokalnie (gdy `NODE_ENV !== 'production'`): domyślnie `http://127.0.0.1:4000`
 * - w `NODE_ENV === 'production'`: wyłącznie `http://127.0.0.1:4100` lub `https://ksiegowosc.roleplayingtech.com`
 * - brak poświadczeń w URL, brak ścieżki/query/hash, blokada SSRF/Path Traversal, `redirect: 'error'`, `cache: 'no-store'`, timeout.
 */

const ALLOWED_PRODUCTION_API_ORIGINS = new Set([
  'http://127.0.0.1:4100',
  'https://ksiegowosc.roleplayingtech.com',
]);

const ENCODED_TRAVERSAL_OR_CONTROL_REGEX = /%(?:0[0-9a-f]|1[0-9a-f]|7f|2e|2f|5c)/i;

function hasControlOrWhitespaceChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || /\s/.test(value[i]!)) {
      return true;
    }
  }
  return false;
}

export interface ResolveApiBaseUrlOptions {
  readonly apiBaseUrl?: string | undefined;
  readonly isProduction?: boolean | undefined;
}

export function resolveValidatedApiBaseUrl(
  options: ResolveApiBaseUrlOptions = {},
): URL | undefined {
  const isProduction = options.isProduction ?? process.env.NODE_ENV === 'production';
  const configuredUrl =
    options.apiBaseUrl ??
    process.env.API_BASE_URL ??
    (isProduction ? undefined : 'http://127.0.0.1:4000');

  if (!configuredUrl || configuredUrl !== configuredUrl.trim()) {
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

export interface BffFetchOptions {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined;
  readonly bearerToken?: string | undefined;
  readonly body?: unknown;
  readonly apiBaseUrl?: string | undefined;
  readonly fetcher?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
}

export type BffFetchResult<T> =
  | { readonly kind: 'ok'; readonly status: number; readonly data: T }
  | { readonly kind: 'unauthorized' }
  | {
      readonly kind: 'forbidden';
      readonly message: string;
      readonly reasonCode?: string | undefined;
    }
  | {
      readonly kind: 'not_found';
      readonly routeUnmounted?: boolean;
      readonly message?: string;
    }
  | {
      readonly kind: 'validation_error';
      readonly status: number;
      readonly message: string;
      readonly reasonCode?: string | undefined;
    }
  | { readonly kind: 'unavailable' };

export function isSafeRelativeApiPath(path: string): boolean {
  if (
    !path ||
    typeof path !== 'string' ||
    path.length > 1024 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    hasControlOrWhitespaceChar(path) ||
    path.includes('\\') ||
    path.includes('#') ||
    path.includes('//') ||
    path.includes('..') ||
    ENCODED_TRAVERSAL_OR_CONTROL_REGEX.test(path)
  ) {
    return false;
  }

  const pathname = path.split('?')[0] ?? '';
  if (pathname !== '/health' && !pathname.startsWith('/api/')) {
    return false;
  }

  const segments = pathname.split('/').slice(1);
  if (segments.some((seg) => seg.length === 0 || seg === '.' || seg === '..')) {
    return false;
  }

  return true;
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record['messagePl'] === 'string' && record['messagePl'].trim().length > 0) {
      return record['messagePl'];
    }
    if (typeof record['message'] === 'string' && record['message'].trim().length > 0) {
      return record['message'];
    }
    if (typeof record['error'] === 'string' && record['error'].trim().length > 0) {
      return record['error'];
    }
  }
  return fallback;
}

function extractReasonCode(payload: unknown): string | undefined {
  if (typeof payload === 'object' && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (typeof record['reasonCode'] === 'string' && record['reasonCode'].trim().length > 0) {
      return record['reasonCode'].trim();
    }
    if (typeof record['reason'] === 'string' && record['reason'].trim().length > 0) {
      return record['reason'].trim();
    }
  }
  return undefined;
}

function isNestUnmountedRoute404(payload: unknown): boolean {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const msg = record['message'];
  return typeof msg === 'string' && /^Cannot (GET|POST|PUT|PATCH|DELETE) \//.test(msg);
}

export async function papBffFetch<T>(
  path: string,
  options: BffFetchOptions = {},
): Promise<BffFetchResult<T>> {
  if (!isSafeRelativeApiPath(path)) {
    return { kind: 'unavailable' };
  }

  const baseUrl = resolveValidatedApiBaseUrl({ apiBaseUrl: options.apiBaseUrl });
  if (!baseUrl) {
    return { kind: 'unavailable' };
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(path, baseUrl);
  } catch {
    return { kind: 'unavailable' };
  }

  if (
    targetUrl.origin !== baseUrl.origin ||
    targetUrl.protocol !== baseUrl.protocol ||
    targetUrl.host !== baseUrl.host ||
    targetUrl.username.length > 0 ||
    targetUrl.password.length > 0 ||
    targetUrl.hash.length > 0 ||
    (targetUrl.pathname !== '/health' && !targetUrl.pathname.startsWith('/api/')) ||
    targetUrl.pathname.includes('//') ||
    targetUrl.pathname.includes('\\') ||
    targetUrl.pathname.includes('..')
  ) {
    return { kind: 'unavailable' };
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.bearerToken && options.bearerToken.trim().length > 0) {
    headers['Authorization'] = `Bearer ${options.bearerToken.trim()}`;
  }

  const serializedBody = options.body !== undefined ? JSON.stringify(options.body) : undefined;
  if (serializedBody !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await (options.fetcher ?? fetch)(targetUrl, {
      method: options.method ?? 'GET',
      headers,
      ...(serializedBody !== undefined ? { body: serializedBody } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_500),
    });

    if (response.status === 401) {
      return { kind: 'unauthorized' };
    }

    let parsedJson: unknown = null;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        parsedJson = await response.json();
      } catch {
        parsedJson = null;
      }
    }

    if (response.status === 403) {
      return {
        kind: 'forbidden',
        reasonCode: extractReasonCode(parsedJson),
        message: extractErrorMessage(
          parsedJson,
          'Brak uprawnień (grantu) do wybranego tenanta lub podmiotu prawnego.',
        ),
      };
    }

    if (response.status === 404) {
      return {
        kind: 'not_found',
        routeUnmounted: isNestUnmountedRoute404(parsedJson),
        message: extractErrorMessage(parsedJson, 'Nie znaleziono zasobu w API.'),
      };
    }

    if (response.status >= 400 && response.status < 500) {
      return {
        kind: 'validation_error',
        status: response.status,
        reasonCode: extractReasonCode(parsedJson),
        message: extractErrorMessage(parsedJson, 'Nieprawidłowe dane wejściowe operacji.'),
      };
    }

    if (!response.ok) {
      return { kind: 'unavailable' };
    }

    return {
      kind: 'ok',
      status: response.status,
      data: parsedJson as T,
    };
  } catch {
    return { kind: 'unavailable' };
  }
}
