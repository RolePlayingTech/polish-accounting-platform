import { NextResponse, type NextRequest } from 'next/server';
import { formatUserFacingErrorPl } from '../../../../lib/error-messages-pl';
import { OidcServiceUnavailableError } from '../../../../lib/oidc-client';
import { assertSameOriginMutation } from '../../../../lib/request-security';
import { isSyntheticPersonaLoginAllowed } from '../../../../lib/runtime-mode';
import {
  persistUpdatedSessionContext,
  readServerSessionOrThrowUnavailable,
  type SessionContext,
} from '../../../../lib/session';
import { WorkspaceAccessError, verifySessionAccess } from '../../../../lib/synthetic-workspace';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  TENANT_1_ID,
} from '../../../../lib/workspace-types';

const DEMO_CODE_TO_ENTITY: Readonly<
  Record<string, { readonly tenantId: string; readonly legalEntityId: string }>
> = {
  demo_jdg_kpir_alfa: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_JDG_KPIR_ID },
  demo_jdg_ryczalt_beta: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_JDG_RYCZALT_ID },
  demo_spzoo_gamma: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_SPZOO_ID },
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const csrfError = assertSameOriginMutation(request);
  if (csrfError) {
    return csrfError;
  }

  let session;
  try {
    session = await readServerSessionOrThrowUnavailable();
  } catch (err) {
    if (err instanceof OidcServiceUnavailableError) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: 'auth_service_unavailable',
          error: err.message,
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'auth_service_unavailable',
        error: 'Usługa sesji BFF jest chwilowo niedostępna (tryb fail-closed).',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Brak aktywnej sesji BFF. Zaloguj się ponownie.',
      },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, reasonCode: 'invalid_json', error: 'Nieprawidłowy format żądania JSON.' },
      { status: 400 },
    );
  }

  const demoCode =
    typeof body['demoCompanyCode'] === 'string' ? body['demoCompanyCode'].trim() : undefined;
  if (demoCode && (session.authMethod === 'oidc' || !isSyntheticPersonaLoginAllowed())) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'demo_company_code_forbidden',
        error:
          'Przełączanie przez globalny kod demonstracyjny jest wyłączone w sesji OIDC. Wybierz rzeczywisty podmiot z listy dostępnych firm lub utwórz własny podmiot testowy w /app/companies.',
      },
      { status: 403 },
    );
  }
  const mappedDemo = demoCode ? DEMO_CODE_TO_ENTITY[demoCode] : undefined;

  const targetTenantId =
    mappedDemo?.tenantId ??
    (typeof body['tenantId'] === 'string' && body['tenantId'].trim()
      ? body['tenantId'].trim()
      : session.context.tenantId);

  const targetLegalEntityId =
    mappedDemo?.legalEntityId ??
    (typeof body['legalEntityId'] === 'string' && body['legalEntityId'].trim()
      ? body['legalEntityId'].trim()
      : session.context.legalEntityId);

  const rawPeriod = typeof body['period'] === 'string' ? body['period'].trim() : undefined;
  const targetPeriod =
    rawPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawPeriod) ? rawPeriod : session.context.period;

  try {
    const company = await verifySessionAccess(session, targetTenantId, targetLegalEntityId, 'read');
    const updatedContext: SessionContext = {
      ...session.context,
      tenantId: company.tenantId,
      legalEntityId: company.legalEntityId,
      period: targetPeriod,
    };
    const response = NextResponse.json({
      ok: true,
      context: updatedContext,
      companyName: company.companyName,
    });
    await persistUpdatedSessionContext(response, session, updatedContext);
    return response;
  } catch (err) {
    if (err instanceof OidcServiceUnavailableError) {
      return NextResponse.json(
        { ok: false, reasonCode: 'auth_service_unavailable', error: err.message },
        { status: 503 },
      );
    }
    if (err instanceof WorkspaceAccessError) {
      return NextResponse.json(
        {
          ok: false,
          reasonCode: err.reasonCode,
          error: formatUserFacingErrorPl({
            status: err.statusCode,
            reasonCode: err.reasonCode,
            rawMessage: err.message,
            fallbackPl: 'Nie udało się zmienić aktywnej firmy.',
          }),
        },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { ok: false, reasonCode: 'internal_error', error: 'Nie udało się zmienić aktywnej firmy.' },
      { status: 500 },
    );
  }
}
