import { describe, test, type Browser, type WebApp } from '@e2e-dev/web';
import { expect, type Screen } from 'e2e';

const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';

async function loginAsPersona(
  app: WebApp,
  browser: Browser,
  screen: Screen,
  buttonPattern: RegExp,
  expectedActorName: string,
): Promise<void> {
  await app.open('/login');
  await screen.getByRole('button', buttonPattern).click();
  await browser.waitForURL(/\/app$/, { timeout: 30_000 });
  await expect(screen.getByText(`Aktor: ${expectedActorName}`)).toBeVisible();
}

async function switchCompanyViaHeader(browser: Browser, legalEntityId: string): Promise<void> {
  const select = browser.locator('#pap-active-company-select');
  await expect(select).toBeVisible();
  const contextRespPromise = browser.waitForResponse(/\/api\/session\/context/);
  await select.selectOption({ value: legalEntityId });
  const contextResp = await contextRespPromise;
  expect(contextResp.status).toBe(200);
}

describe('Benchmark porównawczy e2e — deterministyczne przepływy księgowe', () => {
  test('1. logowanie persony i przełączanie kontekstu między 3 firmami (KPiR, Ryczałt, Sp. z o.o.)', async ({
    app,
    browser,
    screen,
  }) => {
    await loginAsPersona(app, browser, screen, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await expect(screen.getByText('API odpowiada')).toBeVisible();

    const kpiGrid = screen.getByTestId('dashboard-financial-overview');
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.getByText(/Przychody · 2026-10/i)).toBeVisible();
    await expect(kpiGrid.getByText(/Koszty KUP · 2026-10/i)).toBeVisible();
    await expect(screen.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();

    await switchCompanyViaHeader(browser, COMPANY_JDG_RYCZALT_ID);
    await expect(screen.getByText(/JDG · Ryczałt/i).first()).toBeVisible();

    await switchCompanyViaHeader(browser, COMPANY_SPZOO_ID);
    await expect(screen.getByText(/Sp\. z o\.o\./i).first()).toBeVisible();

    await switchCompanyViaHeader(browser, COMPANY_JDG_KPIR_ID);
    await expect(screen.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();
  });

  test('2. dodanie faktury ręcznej i weryfikacja propozycji w rejestrze dokumentów', async ({
    app,
    browser,
    screen,
  }) => {
    await loginAsPersona(app, browser, screen, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await app.open('/app/documents');

    await browser.locator('#manual-doc-number').fill('FZ/2026-10/BENCH-01');
    await browser
      .locator('#manual-counterparty-name')
      .fill('Syntetyczny Dostawca Benchmark Sp. z o.o.');
    await browser.locator('#manual-net-pln').fill('2400.00');
    await screen.getByRole('button', 'Dodaj dokument do obiegu').click();

    await expect(
      screen.getByText('Dokument przyjęty jako propozycja do weryfikacji człowieka'),
    ).toBeVisible();
    await expect(screen.getByText('FZ/2026-10/BENCH-01').first()).toBeVisible();
    await expect(
      screen.getByText('Syntetyczny Dostawca Benchmark Sp. z o.o.').first(),
    ).toBeVisible();
  });

  test('3. import XML FA(3), zatwierdzenie Split-View oraz weryfikacja PKPiR (19 kolumn) i JPK_V7M', async ({
    app,
    browser,
    screen,
  }) => {
    await loginAsPersona(app, browser, screen, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await app.open('/app/documents');

    await screen.getByRole('button', 'Wczytaj przykładową fakturę XML FA(3)').click();
    await screen.getByRole('button', 'Importuj i utwórz propozycję do weryfikacji').click();

    const splitViewLink = screen.getByRole('link', /Otwórz Split-View weryfikacji/i);
    await expect(splitViewLink).toBeVisible();
    await splitViewLink.click();

    await browser.waitForURL(/\/app\/documents\/.+/, { timeout: 30_000 });
    await expect(screen.getByTestId('document-split-verification-workbench')).toBeVisible();
    await expect(screen.getByText(/FA3\/10\/2026\/084/).first()).toBeVisible();

    await screen.getByRole('button', 'Zatwierdź i zaksięguj dokument').first().click();
    const confirmDialog = screen.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', 'Zatwierdź i zaksięguj dokument').click();

    await expect(
      screen.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    await app.open('/app/kpir');
    const kpirTable = screen.getByTestId('kpir-ledger-table');
    await expect(kpirTable).toBeVisible();
    await expect(screen.getByText(/19 kolumn z KSeF/i).first()).toBeVisible();
    await expect(kpirTable.getByText('FA3/10/2026/084').first()).toBeVisible();
    await expect(kpirTable.getByText('5213004125-20261016-FA3084-99A1B2-44').first()).toBeVisible();

    await kpirTable
      .getByRole('button', /Dlaczego\?/i)
      .first()
      .click();
    await expect(
      screen.getByText('Dlaczego? / Podstawa prawna wybranego wiersza KPiR'),
    ).toBeVisible();

    await app.open('/app/vat');
    await expect(screen.getByTestId('vat-registers-summary')).toBeVisible();
    await expect(screen.getByText(/JPK_V7M/i).first()).toBeVisible();
    await expect(
      screen.getByTestId('vat-registers-summary').getByText('FA3/10/2026/084').first(),
    ).toBeVisible();
  });

  test('4. zmiana firmy i odmowa dostępu HTTP 403 dla RBAC read-only oraz izolacji tenanta', async ({
    app,
    browser,
    screen,
  }) => {
    await loginAsPersona(app, browser, screen, /Zaloguj jako Marta Księgowa/i, 'Marta Księgowa');
    await switchCompanyViaHeader(browser, COMPANY_JDG_RYCZALT_ID);
    await expect(screen.getByText('Uprawnienia: tylko odczyt')).toBeVisible();

    await app.open('/app/documents');
    await expect(screen.getByRole('button', 'Tylko odczyt — brak grantu write')).toBeDisabled();

    const martaWriteAttemptStatus = await browser.evaluate(async () => {
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

    await loginAsPersona(
      app,
      browser,
      screen,
      /Zaloguj jako Piotr Izolacyjny/i,
      'Piotr Izolacyjny',
    );
    const options = await browser.locator('#pap-active-company-select option').allTextContents();
    expect(options).toHaveLength(1);
    expect(options.join(' ')).not.toContain('Pracownia Projektowa');

    await app.open('/app/companies');
    const leakedCount = await screen.getByText('Pracownia Projektowa Jan Testowy').count();
    expect(leakedCount).toBe(0);

    const crossTenantRespPromise = browser.waitForResponse(/\/api\/session\/context/);
    await screen.getByRole('button', 'Test izolacji: spróbuj odczytać Tenant 1').click();
    const crossTenantResp = await crossTenantRespPromise;
    expect(crossTenantResp.status).toBe(403);
    await expect(
      screen.getByText('Zablokowano dostęp międzyorganizacyjny (HTTP 403)'),
    ).toBeVisible();

    const directTenant1Attempt = await browser.evaluate(
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
    app,
    browser,
    screen,
  }) => {
    await loginAsPersona(app, browser, screen, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await app.open('/app/documents');

    await screen.getByRole('button', 'Wczytaj przykładowy plik CSV').click();
    await screen.getByRole('button', 'Importuj i utwórz propozycję do weryfikacji').click();

    const splitViewLink = screen.getByRole('link', /Otwórz Split-View weryfikacji/i);
    await expect(splitViewLink).toBeVisible();
    await splitViewLink.click();

    await browser.waitForURL(/\/app\/documents\/.+/, { timeout: 30_000 });
    await screen.getByRole('button', 'Zatwierdź i zaksięguj dokument').first().click();
    const confirmDialog = screen.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', 'Zatwierdź i zaksięguj dokument').click();
    await expect(
      screen.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    await app.open('/app/finance');
    await screen.getByRole('button', 'Wczytaj przykładowy wyciąg CSV (średnik)').click();
    await screen.getByRole('button', 'Importuj wyciąg i uzgodnij przelewy z fakturami').click();
    await expect(
      screen.getByText(/Zaimportowano wyciąg bankowy i wykonano parowanie deterministyczne/i),
    ).toBeVisible();
    await expect(
      screen.getByText(/Wczytano 3 operacji bankowych; uzgodniono z rozrachunkami:/i),
    ).toBeVisible();
    await expect(
      screen.getByTestId('receivables-aging-table').getByText('FV/2026/10/019').first(),
    ).toBeVisible();

    await app.open('/app/calendar');
    await expect(screen.getByTestId('tax-calendar-month-view')).toBeVisible();
    await screen
      .getByRole('button', /Oznacz jako opłacone|Cofnij oznaczenie wpłaty/i)
      .first()
      .click();
    await expect(
      screen.getByText(/Opłacone \/ złożone|Oczekuje na realizację/i).first(),
    ).toBeVisible();

    await screen.getByRole('button', 'Wyloguj').click();
    await expect(screen.getByRole('button', /Zaloguj jako Jan Testowy/i)).toBeVisible();
  });
});
