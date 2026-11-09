import { NextResponse, type NextRequest } from 'next/server';
import { OidcAuthorizeRequestSchema } from '@pap/contracts';
import {
  OidcConfigurationError,
  OidcSecurityValidationError,
  OidcServiceUnavailableError,
  callApiBffSessionRpc,
  encryptBffPayload,
  generatePkceAndFlowMaterial,
  loadWebOidcClientConfig,
  resolveOidcProviderMetadata,
  resolveRedirectUriForOrigin,
  signOidcFlowBindingCookie,
  type StoredOidcFlowPayload,
} from '../../../../../lib/oidc-client';
import {
  assertSameOriginMutation,
  sanitizeInternalRedirect,
} from '../../../../../lib/request-security';
import {
  OIDC_FLOW_COOKIE_NAME,
  buildOpaqueBffSessionCookieOptions,
} from '../../../../../lib/session';

const OIDC_AUTH_STATE_TTL_SECONDS = 600;

function resolveRequestOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  const hostHeader = request.headers.get('host')?.trim().toLowerCase();

  const protocol =
    forwardedProto === 'https' || forwardedProto === 'http' ? `${forwardedProto}:` : url.protocol;
  const host = forwardedHost || hostHeader || url.host;
  return `${protocol}//${host}`;
}

async function initiateOidcAuthorizationFlow(
  request: NextRequest,
  rawReturnTo: string | undefined,
  prefersJson: boolean,
): Promise<NextResponse> {
  try {
    const requestOrigin = resolveRequestOrigin(request);
    const config = loadWebOidcClientConfig();
    const redirectUri = resolveRedirectUriForOrigin(config, requestOrigin);
    const metadata = await resolveOidcProviderMetadata(config);
    const returnTo = sanitizeInternalRedirect(rawReturnTo, '/app', requestOrigin);

    const pkce = generatePkceAndFlowMaterial();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OIDC_AUTH_STATE_TTL_SECONDS * 1000);

    const flowPayload: StoredOidcFlowPayload = {
      codeVerifier: pkce.codeVerifier,
      nonce: pkce.nonce,
      redirectUri,
      returnTo,
      issuer: config.issuer,
    };

    const encryptedPayload = encryptBffPayload(flowPayload, `oidc_state:${pkce.stateHash}`);

    await callApiBffSessionRpc('/oidc-state/create', {
      stateHash: pkce.stateHash,
      encryptedPayload,
      expiresAt: expiresAt.toISOString(),
    });

    const authUrl = new URL(metadata.authorizationEndpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', config.scopes.join(' '));
    authUrl.searchParams.set('state', pkce.state);
    authUrl.searchParams.set('nonce', pkce.nonce);
    authUrl.searchParams.set('code_challenge', pkce.codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const flowCookieValue = signOidcFlowBindingCookie(pkce.stateHash);
    const cookieOpts = buildOpaqueBffSessionCookieOptions(
      requestOrigin,
      OIDC_AUTH_STATE_TTL_SECONDS,
    );

    if (prefersJson) {
      const response = NextResponse.json(
        {
          ok: true,
          authorizationUrl: authUrl.toString(),
          expiresAt: expiresAt.toISOString(),
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store' },
        },
      );
      response.cookies.set(OIDC_FLOW_COOKIE_NAME, flowCookieValue, cookieOpts);
      return response;
    }

    const response = NextResponse.redirect(authUrl, {
      status: 303,
      headers: { 'Cache-Control': 'no-store' },
    });
    response.cookies.set(OIDC_FLOW_COOKIE_NAME, flowCookieValue, cookieOpts);
    return response;
  } catch (err) {
    if (err instanceof OidcConfigurationError || err instanceof OidcServiceUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: 'auth_service_unavailable',
          error: err.message,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    if (err instanceof OidcSecurityValidationError) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: err.reasonCode,
          error: err.message,
        },
        { status: err.statusCode, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'auth_service_unavailable',
        error: 'Nie udało się zainicjować bezpiecznego przepływu logowania OIDC + PKCE.',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const secFetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite === 'cross-site') {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'csrf_origin_rejected',
        error: 'Odrzucono międzywitrynową próbę zainicjowania logowania OIDC.',
      },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const url = new URL(request.url);
  const rawReturnTo = url.searchParams.get('returnTo') ?? undefined;
  const prefersJson = (request.headers.get('accept') ?? '').includes('application/json');
  return initiateOidcAuthorizationFlow(request, rawReturnTo, prefersJson);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  const contentType = request.headers.get('content-type') ?? '';
  const prefersJson =
    contentType.includes('application/json') ||
    (request.headers.get('accept') ?? '').includes('application/json');

  let rawReturnTo: string | undefined;
  try {
    if (contentType.includes('application/json')) {
      const text = await request.text();
      if (text.trim().length > 0) {
        const parsed = OidcAuthorizeRequestSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          return NextResponse.json(
            {
              ok: false,
              reasonCode: 'invalid_authorize_request',
              error: 'Nieprawidłowe parametry żądania inicjacji logowania OIDC.',
            },
            { status: 400, headers: { 'Cache-Control': 'no-store' } },
          );
        }
        rawReturnTo = parsed.data.returnTo;
      }
    } else {
      const formData = await request.formData();
      const candidate = formData.get('returnTo');
      rawReturnTo = typeof candidate === 'string' ? candidate : undefined;
    }
  } catch {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'invalid_authorize_request',
        error: 'Nieprawidłowy format żądania inicjacji logowania OIDC.',
      },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return initiateOidcAuthorizationFlow(request, rawReturnTo, prefersJson);
}
