import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';
import { ACADEMY_ALL_LESSONS, ACADEMY_DISCLAIMER } from '@pap/domain/academy';

const repositoryRoot = process.cwd();
const apiPort = 41_607;
const apiBaseUrl = `http://127.0.0.1:${String(apiPort)}`;

const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';

let apiProcess: ChildProcess | undefined;

async function startSandboxApi(): Promise<ChildProcess> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    PAP_OIDC_ENV: 'test',
    PAP_SANDBOX_AUTH_ENABLED: 'true',
    PAP_SANDBOX_OIDC_ISSUER: apiBaseUrl,
  };
  delete env.PAP_OIDC_JWKS_URI;
  delete env.PAP_OIDC_ISSUER;

  const child = spawn(process.execPath, [resolve(repositoryRoot, 'apps/api/dist/main.js')], {
    cwd: repositoryRoot,
    env,
    stdio: 'ignore',
  });
  apiProcess = child;

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API zakończyło pracę przed startem (kod ${String(child.exitCode)}).`);
    }
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) {
        return child;
      }
    } catch {
      // Serwer @pap/api jeszcze startuje.
    }
    await delay(200);
  }

  throw new Error('Testowe @pap/api nie uruchomiło się w ciągu 20 sekund.');
}

async function stopSandboxApi(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Nie udało się zatrzymać @pap/api po zestawie E2E.'));
    }, 5_000);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit();
    };
    child.once('exit', onExit);
    child.kill();
  });
  await delay(250);
}

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

test.describe('Przekrojowe przepływy księgowe, RBAC, MCP i Akademia (E2E)', () => {
  test.beforeAll(async () => {
    await startSandboxApi();
  });

  test.afterAll(async () => {
    await stopSandboxApi(apiProcess);
    apiProcess = undefined;
  });

  test('1. loguje Jana Testowego na /login, wyświetla KPI na /app i przełącza między 3 firmami (KPiR, Ryczałt, Sp. z o.o.)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await expect(page.getByText('API odpowiada', { exact: true })).toBeVisible();

    const kpiGrid = page.getByTestId('dashboard-financial-overview');
    await expect(kpiGrid).toBeVisible();
    await expect(kpiGrid.getByText(/Przychody · 2026-10/i)).toBeVisible();
    await expect(kpiGrid.getByText(/Koszty KUP · 2026-10/i)).toBeVisible();

    // Domyślny podmiot 1: JDG KPiR + VAT
    await expect(page.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();

    // Przełączenie na podmiot 2: JDG Ryczałt
    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await expect(page.getByText(/JDG · Ryczałt/i).first()).toBeVisible();

    // Przełączenie na podmiot 3: Sp. z o.o. (pełne księgi UoR + CIT 9%)
    await switchCompanyViaHeader(page, COMPANY_SPZOO_ID);
    await expect(page.getByText(/Sp\. z o\.o\./i).first()).toBeVisible();

    // Powrót na JDG KPiR
    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);
    await expect(page.getByText('Pracownia Projektowa Jan Testowy').first()).toBeVisible();
  });

  test('2. importuje fakturę KSeF XML FA(3), zatwierdza ją jako człowiek w Split-View i weryfikuje KPiR (19 kolumn 2026), „Dlaczego?” oraz JPK_V7M na /app/vat', async ({
    page,
  }) => {
    test.setTimeout(90_000);

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

    // Zatwierdzenie i zaksięgowanie przez człowieka (dwukrokowe okno CriticalConfirmDialog)
    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).click();

    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    // Weryfikacja zaksięgowanego wpisu w 19-kolumnowej KPiR 2026 + otwarcie „Dlaczego?”
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

    // Weryfikacja rejestru VAT zakupu i części deklaracyjnej JPK_V7M(3) na /app/vat
    await page.goto('/app/vat');
    await expect(page.getByTestId('vat-registers-summary')).toBeVisible();
    await expect(page.getByText(/JPK_V7M/i).first()).toBeVisible();
    await expect(
      page.getByTestId('vat-registers-summary').getByText('FA3/10/2026/084').first(),
    ).toBeVisible();
  });

  test('3. importuje wyciąg bankowy CSV z uzgodnieniem rozrachunku na /app/finance i weryfikuje wiadomość RFC 5322 ze stopką anty-impersonacyjną na /app/notifications', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/finance');

    await page.getByRole('button', { name: 'Wczytaj przykładowy wyciąg CSV (średnik)' }).click();
    await page
      .getByRole('button', { name: 'Importuj wyciąg i uzgodnij przelewy z fakturami' })
      .click();

    await expect(
      page.getByText(/Zaimportowano wyciąg bankowy i wykonano parowanie deterministyczne/i),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Uzgodniono 1:1/i).first()).toBeVisible({ timeout: 15_000 });

    // Podgląd wiadomości RFC 5322 i obowiązkowej stopki anty-impersonacyjnej w Skrzynce Sandbox
    await page.goto('/app/notifications');
    await page.getByRole('button', { name: /Uruchom wysyłkę zaległych \(dispatch-due\)/i }).click();
    await expect(page.getByText('Wygenerowano wiadomość RFC 5322 w Skrzynce Sandbox')).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByText(/MIME-Version/i).first()).toBeVisible();
    await expect(page.getByText(/auto-generated/i).first()).toBeVisible();
    await expect(
      page
        .getByText(
          /nie stanowi doradztwa podatkowego ani urzędowego potwierdzenia złożenia deklaracji \(UPO\)/i,
        )
        .first(),
    ).toBeVisible();
  });

  test('4. zatwierdza oczekującą propozycję MCP za pomocą dwukrokowego kodu potwierdzenia człowieka na /app/mcp', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/mcp');

    // Na wypadek wcześniejszego zużycia propozycji utwórz świeży szkic MCP
    await page
      .getByRole('button', { name: /\+ Symuluj wywołanie prepare_invoice_and_posting_proposal/i })
      .click();
    await expect(page.getByText('Zasymulowano nową propozycję z klienta MCP')).toBeVisible({
      timeout: 15_000,
    });

    await page
      .getByRole('button', { name: '1. Wygeneruj kod potwierdzenia człowieka' })
      .first()
      .click();
    await expect(page.getByText('Wygenerowano jednorazowy kod autoryzacji człowieka')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Użyj wyświetlonego kodu wyzwania' }).first().click();
    await page
      .getByRole('button', { name: '2. Zatwierdź propozycję z kodem człowieka' })
      .first()
      .click();

    const confirmDialog = page.getByRole('alertdialog');
    await expect(confirmDialog).toBeVisible();
    await confirmDialog
      .getByRole('button', { name: 'Potwierdzam kod i zatwierdzam propozycję MCP' })
      .click();

    await expect(page.getByText('Propozycja MCP została zatwierdzona przez człowieka')).toBeVisible(
      { timeout: 15_000 },
    );
    await expect(page.getByText('Zatwierdzono (Jan Testowy)').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('5. egzekwuje uprawnienia RBAC Marty Księgowej (read-only na JDG Ryczałt -> 403) oraz twardą izolację tenanta Piotra Izolacyjnego (Tenant 2 -> brak dostępu do Tenant 1)', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // A) Marta Księgowa: przełączenie na JDG Ryczałt (grant read-only) i blokada mutacji (UI + HTTP 403)
    await loginAsPersona(page, /Zaloguj jako Marta Księgowa/i, 'Marta Księgowa');
    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await expect(page.getByText('Uprawnienia: tylko odczyt')).toBeVisible();

    await page.goto('/app/documents');
    const readOnlyImportBtn = page.getByRole('button', {
      name: 'Tylko odczyt — brak grantu write',
    });
    await expect(readOnlyImportBtn).toBeDisabled();

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

    // B) Piotr Izolacyjny: widzi wyłącznie własną firmę w Tenant 2 i dostaje HTTP 403 przy próbie odczytu Tenant 1
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
    await expect(page.getByText('Zablokowano dostęp międzyorganizacyjny (HTTP 403)')).toBeVisible({
      timeout: 15_000,
    });

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

  test('6. weryfikuje Akademię Polskiej Księgowości (klauzulę ACADEMY_DISCLAIMER, załadowany zrzut PNG <img>, quiz z oceną) oraz kontekstową pomoc „?” FieldHelpButton na formularzu', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const firstLesson = ACADEMY_ALL_LESSONS[0]!;
    await page.goto('/academy');
    await expect(
      page.getByText(ACADEMY_DISCLAIMER.slice(0, 64), { exact: false }).first(),
    ).toBeVisible();

    await page
      .getByRole('link', { name: new RegExp(firstLesson.title.slice(0, 28), 'i') })
      .first()
      .click();
    await page.waitForURL('**/academy/**', { timeout: 30_000 });

    // Weryfikacja klauzuli informacyjnej ACADEMY_DISCLAIMER na stronie lekcji
    await expect(
      page.getByText(ACADEMY_DISCLAIMER.slice(0, 64), { exact: false }).first(),
    ).toBeVisible();

    // Weryfikacja rzeczywistego obrazka zrzutu ekranu PNG (complete && naturalWidth > 0)
    const lessonImg = page.locator(`img[src="${firstLesson.screenshotSlot.imagePath}"]`);
    await expect(lessonImg).toBeVisible();
    await expect
      .poll(async () =>
        lessonImg.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
      )
      .toBe(true);

    // Rozwiązanie quizu kontrolnego z pełnym wynikiem
    const fieldsets = page.locator('fieldset');
    await expect(fieldsets).toHaveCount(firstLesson.quiz.length);
    for (let qIdx = 0; qIdx < firstLesson.quiz.length; qIdx += 1) {
      const question = firstLesson.quiz[qIdx]!;
      await fieldsets.nth(qIdx).getByRole('radio').nth(question.correctOptionIndex).click();
    }
    const totalQ = String(firstLesson.quiz.length);
    await expect(
      page.getByText(`Wynik: ${totalQ}/${totalQ} (odpowiedziano: ${totalQ})`),
    ).toBeVisible();

    // Kontekstowa pomoc „?” FieldHelpButton na formularzu w aplikacji z linkiem do lekcji Akademii
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/companies');
    const helpBtn = page
      .locator('[data-testid="demo-company-tax-profile-wizard"] button[data-field-help-id]')
      .first();
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    const helpPanel = page.locator('[data-help-panel-for]').first();
    await expect(helpPanel).toBeVisible();
    await expect(helpPanel.locator('a[href^="/academy/"]')).toBeVisible();
  });
});
