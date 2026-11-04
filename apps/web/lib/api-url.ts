/**
 * Bezpieczna walidacja `API_BASE_URL` i klient BFF po stronie serwera `apps/web`.
 * Zachowuje dokładnie tę samą zamkniętą białą listę produkcyjną co `read-system-status.ts`:
 * - lokalnie (gdy `NODE_ENV !== 'production'`): domyślnie `http://127.0.0.1:4000`
 * - w `NODE_ENV === 'production'`: wyłącznie `http://127.0.0.1:4100` lub `https://ksiegowosc.roleplayingtech.com`
 * - brak poświadczeń w URL, brak ścieżki/query/hash, `redirect: 'error'`, `cache: 'no-store'`, timeout.
 */

const ALLOWED_PRODUCTION_API_ORIGINS = new Set([
  'http://127.0.0.1:4100',
  'https://ksiegowosc.roleplayingtech.com',
]);

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
  | { readonly kind: 'forbidden'; readonly message: string }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'validation_error'; readonly status: number; readonly message: string }
  | { readonly kind: 'unavailable' };

function isSafeRelativeApiPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
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
    const response = await (options.fetcher ?? fetch)(new URL(path, baseUrl), {
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
        message: extractErrorMessage(
          parsedJson,
          'Brak uprawnień (grantu) do wybranego tenanta lub podmiotu prawnego.',
        ),
      };
    }

    if (response.status === 404) {
      return { kind: 'not_found' };
    }

    if (response.status === 400 || response.status === 409 || response.status === 422) {
      return {
        kind: 'validation_error',
        status: response.status,
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
