import { NextResponse } from 'next/server';

const ENCODED_DANGEROUS_REDIRECT_SEQUENCE_REGEX = /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c|2f|2e)/i;

function hasControlOrWhitespaceChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || /\s/.test(value[i]!)) {
      return true;
    }
  }
  return false;
}

/**
 * Sanityzuje docelową ścieżkę przekierowania wewnętrznego (`redirectTo` / `returnTo`),
 * blokując Open Redirect przez znaki kontrolne WHATWG URL (`/\t/evil.com`), białe znaki,
 * ukośniki wsteczne `\`, ścieżki protokołowo-względne `//`, schematy URL oraz `..`.
 */
export function sanitizeInternalRedirect(
  candidate: string | null | undefined,
  fallback = '/app',
  requestOrigin = 'http://127.0.0.1:3000',
): string {
  if (!candidate || typeof candidate !== 'string') {
    return fallback;
  }

  if (hasControlOrWhitespaceChar(candidate)) {
    return fallback;
  }

  const trimmed = candidate.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 512 ||
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('//') ||
    trimmed.includes('\\') ||
    trimmed.includes('..') ||
    trimmed.includes('://') ||
    ENCODED_DANGEROUS_REDIRECT_SEQUENCE_REGEX.test(trimmed)
  ) {
    return fallback;
  }

  try {
    const baseUrl = new URL(requestOrigin);
    const resolved = new URL(trimmed, baseUrl);
    if (
      resolved.origin !== baseUrl.origin ||
      resolved.protocol !== baseUrl.protocol ||
      resolved.host !== baseUrl.host ||
      resolved.username.length > 0 ||
      resolved.password.length > 0 ||
      !resolved.pathname.startsWith('/') ||
      resolved.pathname.startsWith('//') ||
      resolved.pathname.includes('\\') ||
      resolved.pathname.includes('..')
    ) {
      return fallback;
    }

    return `${resolved.pathname}${resolved.search}`;
  } catch {
    return fallback;
  }
}

function buildCsrfForbiddenResponse(messagePl: string): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      reasonCode: 'csrf_origin_rejected',
      error: messagePl,
    },
    { status: 403 },
  );
}

/**
 * Wspólna ochrona CSRF dla wszystkich tras mutujących `POST` w warstwie BFF (`apps/web/app/api/**`).
 * Weryfikuje `Sec-Fetch-Site` oraz zgodność nagłówka `Origin` (lub `Referer`, gdy brak `Origin`)
 * z hostem docelowym (`Host` / `X-Forwarded-Host` / `request.url`).
 */
export function assertSameOriginMutation(request: Request): NextResponse | null {
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return buildCsrfForbiddenResponse(
      'Odrzucono żądanie międzywitrynowe CSRF (Sec-Fetch-Site: cross-site).',
    );
  }

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return buildCsrfForbiddenResponse('Nieprawidłowy adres URL żądania BFF.');
  }

  const allowedHosts = new Set<string>([requestUrl.host.toLowerCase()]);
  const hostHeader = request.headers.get('host')?.trim().toLowerCase();
  if (hostHeader) {
    allowedHosts.add(hostHeader);
  }
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  if (forwardedHost) {
    allowedHosts.add(forwardedHost);
  }

  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const isHttpsTarget = forwardedProto === 'https' || requestUrl.protocol === 'https:';

  const originHeader = request.headers.get('origin');
  if (originHeader !== null) {
    const trimmedOrigin = originHeader.trim();
    if (!trimmedOrigin || trimmedOrigin.toLowerCase() === 'null') {
      return buildCsrfForbiddenResponse(
        'Odrzucono żądanie mutujące z niejawnego pochodzenia (Origin: null).',
      );
    }

    try {
      const parsedOrigin = new URL(trimmedOrigin);
      if (
        (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') ||
        parsedOrigin.origin !== trimmedOrigin ||
        !allowedHosts.has(parsedOrigin.host.toLowerCase()) ||
        (isHttpsTarget && parsedOrigin.protocol !== 'https:')
      ) {
        return buildCsrfForbiddenResponse(
          'Odrzucono żądanie CSRF z obcego pochodzenia (niezgodny nagłówek Origin).',
        );
      }
      return null;
    } catch {
      return buildCsrfForbiddenResponse('Nieprawidłowy format nagłówka Origin.');
    }
  }

  const refererHeader = request.headers.get('referer');
  if (refererHeader !== null) {
    try {
      const parsedReferer = new URL(refererHeader.trim());
      if (
        (parsedReferer.protocol !== 'http:' && parsedReferer.protocol !== 'https:') ||
        !allowedHosts.has(parsedReferer.host.toLowerCase()) ||
        (isHttpsTarget && parsedReferer.protocol !== 'https:')
      ) {
        return buildCsrfForbiddenResponse(
          'Odrzucono żądanie CSRF z obcego adresu odsyłającego (niezgodny nagłówek Referer).',
        );
      }
      return null;
    } catch {
      return buildCsrfForbiddenResponse('Nieprawidłowy format nagłówka Referer.');
    }
  }

  // Dla formularzy HTML / żądań innych niż JSON oraz w produkcji wymagaj jawnego Origin lub Referer.
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (process.env.NODE_ENV === 'production' || !contentType.includes('application/json')) {
    return buildCsrfForbiddenResponse(
      'Brak wymaganego nagłówka Origin lub Referer dla operacji mutującej BFF.',
    );
  }

  return null;
}
