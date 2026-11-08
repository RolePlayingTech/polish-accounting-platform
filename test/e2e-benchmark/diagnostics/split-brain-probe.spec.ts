import { expect, test } from '@playwright/test';

const apiPort = Number(process.env.PAP_BENCH_API_PORT ?? '41801');
const apiBaseUrl = process.env.API_BASE_URL ?? `http://127.0.0.1:${String(apiPort)}`;
const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';

test.describe('Diagnostyka Split-Brain (#57, #59, #60, #62, #63) — Playwright', () => {
  test('porównuje asercje wyłącznie-UI (pozorny PASS) z weryfikacją kontraktu REST @pap/api (ujawnienie rozjazdu)', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /Zaloguj jako Jan Testowy/i }).click();
    await page.waitForURL('**/app', { timeout: 30_000 });

    // 1. Import FA(3) XML i księgowanie w UI
    await page.goto('/app/documents');
    await page.getByRole('button', { name: 'Wczytaj przykładową fakturę XML FA(3)' }).click();
    await page.getByRole('button', { name: 'Importuj i utwórz propozycję do weryfikacji' }).click();
    await page.getByRole('link', { name: /Otwórz Split-View weryfikacji/i }).click();
    await page.waitForURL('**/app/documents/**', { timeout: 30_000 });

    // Sprawdzenie #63: czy UI prezentuje sfabrykowane statusy KAS / AI 95%
    const pageText = (await page.locator('main').textContent()) ?? '';
    const hasSyntheticKasBadge =
      pageText.includes('KAS-WL-') || pageText.includes('Zweryfikowano na Białej Liście');

    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' })
      .click();
    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    // 2. Zatwierdzenie propozycji MCP w /app/mcp (#60)
    await page.goto('/app/mcp');
    await page
      .getByRole('button', { name: /\+ Symuluj wywołanie prepare_invoice_and_posting_proposal/i })
      .click();
    await expect(page.getByText('Zasymulowano nową propozycję z klienta MCP')).toBeVisible();

    // 3. Pobranie tokenu OIDC z @pap/api i bezpośrednie odpytanie @pap/api (#57, #60, #62)
    const tokenRes = await fetch(`${apiBaseUrl}/api/v1/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        personaId: 'jan-testowy',
        sub: '00000000-0000-4000-8000-000000000101',
      }),
    });
    const tokenData = (await tokenRes.json()) as { accessToken?: string; token?: string };
    const bearerToken = tokenData.accessToken ?? tokenData.token ?? '';

    const apiDocsRes = await fetch(
      `${apiBaseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
      },
    );
    const apiDocsJson = (await apiDocsRes.json()) as {
      items?: Array<{
        documentNumber?: string;
        sourceChannel?: string;
        rawPayload?: string;
        status?: string;
      }>;
    };
    const importedInApi = (apiDocsJson.items ?? []).find(
      (d) => d.documentNumber === 'FA3/10/2026/084',
    );

    const apiMcpRes = await fetch(
      `${apiBaseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals`,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json',
        },
      },
    );
    const apiMcpStatus = apiMcpRes.status;
    const apiMcpBody = apiMcpRes.ok ? ((await apiMcpRes.json()) as { items?: unknown[] }) : null;

    // 4. Sprawdzenie #57/#59: mutacja w BFF zwraca HTTP 200 wyłącznie w RAM Next.js
    const ramMutationStatus = await page.evaluate(async () => {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_obligation_paid',
          obligationCode: 'JPK_V7M',
        }),
      });
      return res.status;
    });

    const diagnostics = {
      tool: 'playwright',
      uiShowsApprovedDocument: true,
      issue63_hasSyntheticKasBadgeInUi: hasSyntheticKasBadge,
      issue62_apiReceivedDocument: Boolean(importedInApi),
      issue62_apiPreservedRawXmlPayload: Boolean(importedInApi?.rawPayload),
      issue60_apiMcpProposalsEndpointStatus: apiMcpStatus,
      issue60_apiMcpProposalsCount: apiMcpBody?.items?.length ?? 0,
      issue57_59_ramOnlyMutationHttpStatus: ramMutationStatus,
    };

    console.log('SPLIT_BRAIN_DIAGNOSTICS_JSON:', JSON.stringify(diagnostics));
    expect(diagnostics.uiShowsApprovedDocument).toBe(true);
  });
});
