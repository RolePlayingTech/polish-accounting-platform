import { expect, test, type Page } from '@playwright/test';

const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';

async function loginAsPersona(
  page: Page,
  buttonPattern: RegExp,
  expectedActorName: string,
): Promise<void> {
  await page.goto('/login');
  await page.getByRole('button', { name: buttonPattern }).click();
  await page.waitForURL('**/app', { timeout: 30_000 });
  await expect(page.getByText(`Aktor: ${expectedActorName}`)).toBeVisible();
}

async function switchCompanyViaHeader(page: Page, legalEntityId: string): Promise<void> {
  const select = page.locator('#pap-active-company-select');
  await expect(select).toBeVisible();
  const contextRespPromise = page.waitForResponse(
    (resp) => resp.url().includes('/api/session/context') && resp.request().method() === 'POST',
  );
  await select.selectOption(legalEntityId);
  const contextResp = await contextRespPromise;
  expect(contextResp.ok()).toBe(true);
}

test.describe('Benchmark porównawczy Playwright — deterministyczne przepływy księgowe', () => {
  test('1. logowanie persony i przełączanie kontekstu między 3 firmami (KPiR, Ryczałt, Sp. z o.o.)', async ({
    page,
  }) => {
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await expect(page.getByText('API odpowiada', { exact: true })).toBeVisible();

    const kpiGrid = page.getByTestId('dashboard-financial-overview');
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.getByText(/Przychody · 2026-10/i)).toBeVisible();
    await expect(kpiGrid.getByText(/Koszty KUP · 2026-10/i)).toBeVisible();
    await expect(page.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();

    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await expect(page.getByText(/JDG · Ryczałt/i).first()).toBeVisible();

    await switchCompanyViaHeader(page, COMPANY_SPZOO_ID);
    await expect(page.getByText(/Sp\. z o\.o\./i).first()).toBeVisible();

    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);
    await expect(page.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();
  });

  test('2. dodanie faktury ręcznej i weryfikacja propozycji w rejestrze dokumentów', async ({
    page,
  }) => {
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/documents');

    await page.locator('#manual-doc-number').fill('FZ/2026-10/BENCH-01');
    await page
      .locator('#manual-counterparty-name')
      .fill('Syntetyczny Dostawca Benchmark Sp. z o.o.');
    await page.locator('#manual-net-pln').fill('2400.00');
    await page.getByRole('button', { name: 'Dodaj dokument do obiegu' }).click();

    await expect(
      page.getByText('Dokument przyjęty jako propozycja do weryfikacji człowieka'),
    ).toBeVisible();
    await expect(page.getByText('FZ/2026-10/BENCH-01').first()).toBeVisible();
    await expect(page.getByText('Syntetyczny Dostawca Benchmark Sp. z o.o.').first()).toBeVisible();
  });

  test('3. import XML FA(3), zatwierdzenie Split-View oraz weryfikacja PKPiR (19 kolumn) i JPK_V7M', async ({
    page,
  }) => {
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/documents');

    await page.getByRole('button', { name: 'Wczytaj przykładową fakturę XML FA(3)' }).click();
    await page.getByRole('button', { name: 'Importuj i utwórz propozycję do weryfikacji' }).click();

    const splitViewLink = page.getByRole('link', { name: /Otwórz Split-View weryfikacji/i });
    await expect(splitViewLink).toBeVisible();
    await splitViewLink.click();

    await page.waitForURL('**/app/documents/**', { timeout: 30_000 });
    await expect(page.getByTestId('document-split-verification-workbench')).toBeVisible();
    await expect(page.getByText(/FA3\/10\/2026\/084/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).click();

    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    await page.goto('/app/kpir');
    const kpirTable = page.getByTestId('kpir-ledger-table');
    await expect(kpirTable).toBeVisible();
    await expect(page.getByText(/19 kolumn z KSeF/i).first()).toBeVisible();
    await expect(kpirTable.getByText('FA3/10/2026/084').first()).toBeVisible();
    await expect(kpirTable.getByText('5213004125-20261016-FA3084-99A1B2-44').first()).toBeVisible();

    await kpirTable
      .getByRole('button', { name: /Dlaczego\?/i })
      .first()
      .click();
    await expect(
      page.getByText('Dlaczego? / Podstawa prawna wybranego wiersza KPiR'),
    ).toBeVisible();

    await page.goto('/app/vat');
    await expect(page.getByTestId('vat-registers-summary')).toBeVisible();
    await expect(page.getByText(/JPK_V7M/i).first()).toBeVisible();
    await expect(
      page.getByTestId('vat-registers-summary').getByText('FA3/10/2026/084').first(),
    ).toBeVisible();
  });

  test('4. zmiana firmy i odmowa dostępu HTTP 403 dla RBAC read-only oraz izolacji tenanta', async ({
    page,
  }) => {
    await loginAsPersona(page, /Zaloguj jako Marta Księgowa/i, 'Marta Księgowa');
    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await expect(page.getByText('Uprawnienia: tylko odczyt')).toBeVisible();

    await page.goto('/app/documents');
    await expect(
      page.getByRole('button', { name: 'Tylko odczyt — brak grantu write' }),
    ).toBeDisabled();

    const martaWriteAttemptStatus = await page.evaluate(async () => {
      const response = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_ryczalt_entry',
          eventDate: '2026-10-20',
          documentNumber: 'FS/BLOCKED/01',
          counterpartyName: 'Próba Zapisu Read-Only',
          description: 'Test blokady 403',
          rateCode: '12',
          netRevenuePln: '1000.00',
        }),
      });
      return response.status;
    });
    expect(martaWriteAttemptStatus).toBe(403);

    await loginAsPersona(page, /Zaloguj jako Piotr Izolacyjny/i, 'Piotr Izolacyjny');
    const options = await page.locator('#pap-active-company-select option').allTextContents();
    expect(options).toHaveLength(1);
    expect(options.join(' ')).not.toContain('Pracownia Projektowa');

    await page.goto('/app/companies');
    await expect(page.getByText('Pracownia Projektowa Jan Testowy')).toHaveCount(0);

    const crossTenantRespPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/session/context') && resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Test izolacji: spróbuj odczytać Tenant 1' }).click();
    const crossTenantResp = await crossTenantRespPromise;
    expect(crossTenantResp.status()).toBe(403);
    await expect(page.getByText('Zablokowano dostęp międzyorganizacyjny (HTTP 403)')).toBeVisible();

    const directTenant1Attempt = await page.evaluate(
      async ({ t1, c1 }) => {
        const res = await fetch('/api/session/context', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId: t1, legalEntityId: c1 }),
        });
        return res.status;
      },
      { t1: TENANT_1_ID, c1: COMPANY_JDG_KPIR_ID },
    );
    expect(directTenant1Attempt).toBe(403);
  });

  test('5. złożony przepływ wieloetapowy: logowanie -> import CSV -> księgowanie -> wyciąg bankowy -> kalendarz -> wylogowanie', async ({
    page,
  }) => {
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/documents');

    await page.getByRole('button', { name: 'Wczytaj przykładowy plik CSV' }).click();
    await page.getByRole('button', { name: 'Importuj i utwórz propozycję do weryfikacji' }).click();

    const splitViewLink = page.getByRole('link', { name: /Otwórz Split-View weryfikacji/i });
    await expect(splitViewLink).toBeVisible();
    await splitViewLink.click();

    await page.waitForURL('**/app/documents/**', { timeout: 30_000 });
    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).click();
    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    await page.goto('/app/finance');
    await page.getByRole('button', { name: 'Wczytaj przykładowy wyciąg CSV (średnik)' }).click();
    await page
      .getByRole('button', { name: 'Importuj wyciąg i uzgodnij przelewy z fakturami' })
      .click();
    await expect(
      page.getByText(/Zaimportowano wyciąg bankowy i wykonano parowanie deterministyczne/i),
    ).toBeVisible();
    await expect(
      page.getByText(/Wczytano 3 operacji bankowych; uzgodniono z rozrachunkami:/i),
    ).toBeVisible();
    await expect(
      page.getByTestId('receivables-aging-table').getByText('FV/2026/10/019').first(),
    ).toBeVisible();

    await page.goto('/app/calendar');
    await expect(page.getByTestId('tax-calendar-month-view')).toBeVisible();
    await page
      .getByRole('button', { name: /Oznacz jako opłacone|Cofnij oznaczenie wpłaty/i })
      .first()
      .click();
    await expect(
      page.getByText(/Opłacone \/ złożone|Oczekuje na realizację/i).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Wyloguj' }).click();
    await expect(page.getByRole('button', { name: /Zaloguj jako Jan Testowy/i })).toBeVisible();
  });
});
