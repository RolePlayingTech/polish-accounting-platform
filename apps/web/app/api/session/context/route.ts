import { NextResponse, type NextRequest } from 'next/server';
import {
  readServerSession,
  writeSessionToResponse,
  type SessionContext,
} from '../../../../lib/session';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  TENANT_1_ID,
  WorkspaceAccessError,
  verifySessionAccess,
} from '../../../../lib/synthetic-workspace';

const DEMO_CODE_TO_ENTITY: Readonly<
  Record<string, { readonly tenantId: string; readonly legalEntityId: string }>
> = {
  demo_jdg_kpir_alfa: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_JDG_KPIR_ID },
  demo_jdg_ryczalt_beta: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_JDG_RYCZALT_ID },
  demo_spzoo_gamma: { tenantId: TENANT_1_ID, legalEntityId: COMPANY_SPZOO_ID },
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await readServerSession();
  if (!session) {
    return NextResponse.json(
      {
        ok: false,
        reasonCode: 'unauthenticated',
        error: 'Brak aktywnej sesji BFF. Zaloguj się do środowiska testowego.',
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
    typeof body['demoCompanyCode'] === 'string' ? body['demoCompanyCode'] : undefined;
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
    const company = verifySessionAccess(session, targetTenantId, targetLegalEntityId, 'read');
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
    writeSessionToResponse(response, {
      oidcToken: session.oidcToken,
      context: updatedContext,
    });
    return response;
  } catch (err) {
    if (err instanceof WorkspaceAccessError) {
      return NextResponse.json(
        { ok: false, reasonCode: err.reasonCode, error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { ok: false, reasonCode: 'internal_error', error: 'Nie udało się zmienić aktywnej firmy.' },
      { status: 500 },
    );
  }
}
