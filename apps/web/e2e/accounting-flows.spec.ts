import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test, type Page } from '@playwright/test';
import { ACADEMY_ALL_LESSONS, ACADEMY_DISCLAIMER } from '@pap/domain/academy';

const repositoryRoot = process.cwd();
const webPort = Number(process.env['PAP_E2E_WEB_PORT'] || 31_607);
const webBaseUrl = `http://127.0.0.1:${String(webPort)}`;
const apiPort = Number(process.env['PAP_E2E_API_PORT'] || 41_607);
const apiBaseUrl = `http://127.0.0.1:${String(apiPort)}`;

const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_JDG_KPIR_ID = '11111111-1111-4111-8111-111111111101';
const COMPANY_JDG_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';

let apiProcess: ChildProcess | undefined;

async function startSandboxApi(options?: { readonly seedDemo?: boolean }): Promise<ChildProcess> {
  const hasPostgresDb = Boolean(process.env.DATABASE_URL);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    PAP_OIDC_ENV: 'test',
    PAP_SANDBOX_AUTH_ENABLED: 'true',
    PAP_SANDBOX_OIDC_ISSUER: apiBaseUrl,
  };
  if (hasPostgresDb) {
    if (options?.seedDemo === false) {
      env.PAP_SEED_SYNTHETIC_DEMO = 'false';
      delete env.PAP_MIGRATOR_DATABASE_URL;
    } else {
      env.PAP_SEED_SYNTHETIC_DEMO ??= 'true';
    }
  }
  delete env.PAP_OIDC_JWKS_URI;
  delete env.PAP_OIDC_ISSUER;

  const child = spawn(process.execPath, [resolve(repositoryRoot, 'apps/api/dist/main.js')], {
    cwd: repositoryRoot,
    env,
    stdio: 'ignore',
  });
  apiProcess = child;

  const deadline = Date.now() + 60_000;
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

  throw new Error('Testowe @pap/api nie uruchomiło się w ciągu 60 sekund.');
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
  await page.waitForURL('**/app', { timeout: 45_000 });
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

async function prewarmNextDevRoutes(): Promise<void> {
  const routes = [
    '/login',
    '/app',
    '/app/documents',
    '/app/kpir',
    '/app/vat',
    '/app/finance',
    '/app/notifications',
    '/app/mcp',
    '/app/companies',
    '/app/ledger',
    '/app/ryczalt',
    '/academy',
  ];
  for (const route of routes) {
    try {
      await fetch(`${webBaseUrl}${route}`, { redirect: 'manual' });
    } catch {
      // Ignoruj przejściowy błąd rozgrzewania pojedynczej trasy
    }
  }
}

test.describe('Przekrojowe przepływy księgowe, RBAC, MCP i Akademia (E2E)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(210_000);
    await startSandboxApi();
    await prewarmNextDevRoutes();
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(30_000);
    await stopSandboxApi(apiProcess);
    apiProcess = undefined;
  });

  test('1. loguje Jana Testowego na /login, wyświetla KPI na /app i przełącza między 3 firmami (KPiR, Ryczałt, Sp. z o.o.)', async ({
    page,
  }) => {
    test.setTimeout(150_000);

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
    test.setTimeout(150_000);

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
    test.setTimeout(150_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/finance');

    await page.getByRole('button', { name: 'Wczytaj przykładowy wyciąg CSV (średnik)' }).click();
    await page
      .getByRole('button', { name: 'Importuj wyciąg i uzgodnij przelewy z fakturami' })
      .click();

    await expect(
      page.getByText(/Zaimportowano wyciąg bankowy i wykonano parowanie deterministyczne/i),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Uzgodniono 1:1/i).first()).toBeVisible({ timeout: 30_000 });

    // Podgląd wiadomości RFC 5322 i obowiązkowej stopki anty-impersonacyjnej w Skrzynce Sandbox
    await page.goto('/app/notifications');
    await page.getByRole('button', { name: /Uruchom wysyłkę zaległych \(dispatch-due\)/i }).click();
    await expect(page.getByText('Wygenerowano wiadomość RFC 5322 w Skrzynce Sandbox')).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(/X-PAP-Notification-Kind|MIME-Version/i).first()).toBeVisible();
    await expect(page.getByText(/auto-generated/i).first()).toBeVisible();
    await expect(
      page
        .getByText(
          /nie pochodzi z urzędu skarbowego, Ministerstwa Finansów ani ZUS|nie stanowi doradztwa podatkowego/i,
        )
        .first(),
    ).toBeVisible();
  });

  test('4. zatwierdza oczekującą propozycję MCP za pomocą dwukrokowego kodu potwierdzenia człowieka na /app/mcp', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/mcp');

    // Na wypadek wcześniejszego zużycia propozycji utwórz świeży szkic MCP
    await page
      .getByRole('button', { name: /\+ Symuluj wywołanie prepare_invoice_and_posting_proposal/i })
      .click();
    await expect(page.getByText('Zasymulowano nową propozycję z klienta MCP')).toBeVisible({
      timeout: 30_000,
    });

    await page
      .getByRole('button', { name: '1. Wygeneruj kod potwierdzenia człowieka' })
      .first()
      .click();
    await expect(page.getByText('Wygenerowano jednorazowy kod autoryzacji człowieka')).toBeVisible({
      timeout: 30_000,
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
      { timeout: 30_000 },
    );
    await expect(page.getByText('Zatwierdzono (Jan Testowy)').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('5. egzekwuje uprawnienia RBAC Marty Księgowej (read-only na JDG Ryczałt -> 403) oraz twardą izolację tenanta Piotra Izolacyjnego (Tenant 2 -> brak dostępu do Tenant 1)', async ({
    page,
  }) => {
    test.setTimeout(150_000);

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
      timeout: 30_000,
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
    test.setTimeout(150_000);

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

  test('7. tworzy nową firmę (#58), odrzuca duplikat NIP (409, #70) oraz błędny XML/XXE (400, #62), blokuje mutacje w trybie fail-closed przy wyłączonym API (503, #59) i zachowuje dane po zimnym restarcie API na PostgreSQL 18 (#57, #61)', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await page.goto('/app/companies');

    // 1. Utworzenie nowej firmy i weryfikacja spójnego legalEntityId pomiędzy API a sesją Web (#58)
    await page.locator('#new-company-name').fill('Pracownia Architektury Syntetycznej E2E');
    await page.locator('#new-company-nip').fill('5213004125');
    await page.locator('#new-company-address').fill('ul. Marszałkowska 88/4, 00-514 Warszawa');

    const createActionPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/workspace/actions') && resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /Utwórz podmiot i przełącz kontekst/i }).click();
    const createActionResp = await createActionPromise;
    expect(createActionResp.status()).toBe(200);
    const createPayload = (await createActionResp.json()) as {
      ok?: boolean;
      legalEntityId?: string;
      company?: { readonly legalEntityId?: string };
    };
    const createdEntityId =
      createPayload.company?.legalEntityId ?? createPayload.legalEntityId ?? '';
    expect(createPayload.ok).toBe(true);
    expect(createdEntityId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    await expect(page.locator('#pap-active-company-select')).toHaveValue(createdEntityId);

    // 2. Próba utworzenia drugiej firmy z tym samym NIP w tym samym tenancie -> 409 Conflict (#70)
    const duplicateNipStatus = await page.evaluate(async () => {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_company',
          companyName: 'Duplikat NIP Sp. z o.o.',
          nip: '5213004125',
          address: 'ul. Duplikatowa 1, 00-001 Warszawa',
          legalForm: 'jdg',
          profileCode: 'jdg_kpir_skala',
          vatStatus: 'czynny',
        }),
      });
      return res.status;
    });
    expect(duplicateNipStatus).toBe(409);

    // 3. Odrzucenie złośliwego pliku XML z deklaracją <!DOCTYPE / XXE -> 400 (#62) oraz uczciwe odznaki (#63)
    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);
    await page.goto('/app/documents');
    await expect(page.getByText(/niesprawdzone w API (MF|KAS)/i).first()).toBeVisible();

    const xxeRejectStatus = await page.evaluate(async () => {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import_document',
          format: 'fa3_xml',
          rawPayload:
            '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><Faktura><P_2>XXE/1</P_2></Faktura>',
        }),
      });
      return res.status;
    });
    expect(xxeRejectStatus).toBe(400);

    // 4. Wyłączenie @pap/api -> weryfikacja trybu fail-closed (HTTP 503, zero fałszywego sukcesu, #59, #61)
    await stopSandboxApi(apiProcess);
    apiProcess = undefined;

    const offlineActionResult = await page.evaluate(async () => {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mcp_create_demo_proposal',
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      return { status: res.status, ok: Boolean(body.ok), error: body.error ?? '' };
    });
    expect(offlineActionResult.status).toBe(503);
    expect(offlineActionResult.ok).toBe(false);

    // 5. Zimny restart @pap/api (bez ponownego seedowania przy włączonym PostgreSQL 18) i weryfikacja przetrwania danych (#57, #61, #70)
    await startSandboxApi({ seedDemo: false });
    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');

    if (process.env.DATABASE_URL) {
      await page.goto('/app/companies');
      await expect(page.getByText('Pracownia Architektury Syntetycznej E2E').first()).toBeVisible();
      await expect(page.getByText('ul. Marszałkowska 88/4, 00-514 Warszawa').first()).toBeVisible();

      await page.goto('/app/kpir');
      await expect(
        page.getByTestId('kpir-ledger-table').getByText('FA3/10/2026/084').first(),
      ).toBeVisible();
    }
  });

  test('8. weryfikuje profilową nawigację (#120), wielostawkowy formularz i import CSV bez fikcyjnego NrKSeF (#102, #114, #115), pomoc stawek VAT/ryczałtu (#103), polską walidację dekretu (#105) i bramkę reżimu (#101, #104)', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);

    // #120: Nawigacja boczna dla JDG KPiR + VAT czynny pokazuje wyłącznie KPiR, bez ryczałtu i pełnych ksiąg
    const sidebar = page.getByLabel('Główna nawigacja aplikacji');
    await expect(sidebar.getByRole('link', { name: /KPiR i zaliczka PIT/i })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'Rejestry VAT i JPK_V7M' })).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: /Ewidencja przychodów \(ryczałt\)/i }),
    ).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: /Księga główna, ZOiS i CIT/i })).toHaveCount(0);

    // Zwijana sekcja „Więcej narzędzi”
    const moreToggle = sidebar.getByTestId('nav-section-toggle-wiecej-narzedzi');
    await expect(moreToggle).toHaveAttribute('aria-expanded', 'false');
    await moreToggle.click();
    await expect(moreToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar.getByRole('link', { name: 'Klienci AI i kolejka MCP' })).toBeVisible();

    // #102, #115, #114, #103: Formularz dokumentów bez fikcyjnego NrKSeF i zaszytych danych + działający CSV
    await page.goto('/app/documents');
    await expect(page.locator('#manual-doc-number')).toHaveValue('');
    await expect(page.locator('#manual-counterparty-name')).toHaveValue('');
    await expect(page.locator('#manual-ksef-marker')).toHaveValue('BFK');
    await expect(page.locator('#manual-ksef-ref')).toHaveCount(0);

    // Przewodnik stawek VAT (#103)
    await page.getByTestId('vat-rate-contextual-guide-trigger').click();
    const vatGuide = page.getByTestId('vat-rate-contextual-guide-panel');
    await expect(vatGuide).toBeVisible();
    await expect(vatGuide.getByText(/240\s*000 PLN/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(vatGuide).toHaveCount(0);

    // Import wbudowanego przykładowego CSV (#114) bez błędu 400 invalid_document_csv_headers
    await page.getByRole('button', { name: 'Wczytaj przykładowy plik CSV' }).click();
    await page.getByRole('button', { name: 'Importuj i utwórz propozycję do weryfikacji' }).click();
    await expect(
      page.getByText('Dokument przyjęty jako propozycja do weryfikacji człowieka'),
    ).toBeVisible();

    // Wielopozycyjna faktura ręczna z dwiema różnymi stawkami VAT (23% + 8%) i uczciwym statusem BFK (#102, #115)
    const uniqueDocNum = `FV/MULTI/2026/${String(Date.now()).slice(-4)}`;
    await page.locator('#manual-doc-number').fill(uniqueDocNum);
    await page.locator('#manual-counterparty-name').fill('Wydawnictwo Techniczne Alfa Sp. z o.o.');
    await page.locator('#manual-counterparty-nip').fill('5261040828');
    await page
      .locator('#manual-line-desc-0')
      .fill('Licencja elektroniczna systemu obliczeniowego (stawka 23%)');
    await page.locator('#manual-line-net-0').fill('1000.00');
    await page.locator('#manual-line-vat-rate-0').selectOption('23');

    await page.getByTestId('add-invoice-line-button').click();
    await page
      .locator('#manual-line-desc-1')
      .fill('Czasopismo specjalistyczne branżowe (stawka 8%)');
    await page.locator('#manual-line-net-1').fill('500.00');
    await page.locator('#manual-line-vat-rate-1').selectOption('8');

    await expect(page.getByTestId('invoice-totals-summary')).toContainText('1 500,00 zł');
    await expect(page.getByTestId('invoice-totals-summary')).toContainText('270,00 zł');
    await expect(page.getByTestId('invoice-totals-summary')).toContainText('1 770,00 zł');

    await page
      .getByRole('button', { name: 'Dodaj dokument do obiegu (do weryfikacji Split-View)' })
      .click();
    const openSplitLink = page.getByRole('link', { name: /Otwórz Split-View weryfikacji/i });
    await expect(openSplitLink).toBeVisible();
    await openSplitLink.click();

    await page.waitForURL('**/app/documents/**', { timeout: 30_000 });
    await expect(page.getByText('Poza KSeF (BFK — nieprzesłano)')).toBeVisible();
    const linesTable = page.getByTestId('split-view-document-lines-table');
    await expect(linesTable).toContainText('Licencja elektroniczna systemu obliczeniowego');
    await expect(linesTable).toContainText('Czasopismo specjalistyczne branżowe');

    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    const postDialog = page.getByRole('alertdialog');
    await expect(postDialog).toBeVisible();
    await postDialog.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).click();
    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    // Faktura korygująca KOR (in minus, kwoty ujemne) — utworzenie, blokada sumy w Split-View i zaksięgowanie do KPiR bez błędu 500 (#102, #105)
    await page.goto('/app/documents');
    const uniqueKorNum = `KOR/2026/${String(Date.now()).slice(-4)}`;
    await page.locator('#manual-doc-kind').selectOption('correction');
    await page.locator('#manual-doc-number').fill(uniqueKorNum);
    await page.locator('#manual-corrected-doc-number').fill(uniqueDocNum);
    await page
      .locator('#manual-correction-reason')
      .fill('Rabat potransakcyjny do licencji elektronicznej');
    await page.locator('#manual-counterparty-name').fill('Wydawnictwo Techniczne Alfa Sp. z o.o.');
    await page.locator('#manual-counterparty-nip').fill('5261040828');
    await page
      .locator('#manual-line-desc-0')
      .fill('Korekta ceny licencji elektronicznej (in minus)');
    await page.locator('#manual-line-net-0').fill('100.00');
    await page.locator('#manual-line-vat-rate-0').selectOption('23');
    await expect(page.getByTestId('invoice-totals-summary')).toContainText('-100,00 zł');
    await expect(page.getByTestId('invoice-totals-summary')).toContainText('-123,00 zł');

    await page
      .getByRole('button', { name: 'Dodaj dokument do obiegu (do weryfikacji Split-View)' })
      .click();
    const openKorSplitLink = page.getByRole('link', { name: /Otwórz Split-View weryfikacji/i });
    await expect(openKorSplitLink).toBeVisible();
    await openKorSplitLink.click();

    await page.waitForURL('**/app/documents/**', { timeout: 30_000 });
    await expect(page.locator('#verify-net-pln')).toHaveValue('-100.00');
    await expect(page.locator('#verify-net-pln')).toHaveAttribute('readonly', '');
    await expect(page.getByTestId('verify-correction-metadata-panel')).toBeVisible();

    await page.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).first().click();
    const korPostDialog = page.getByRole('alertdialog');
    await expect(korPostDialog).toBeVisible();
    await korPostDialog.getByRole('button', { name: 'Zatwierdź i zaksięguj dokument' }).click();
    await expect(
      page.getByText(/Dokument zatwierdzony przez człowieka i zaksięgowany/i),
    ).toBeVisible();

    await page.goto('/app/kpir');
    await expect(
      page.getByTestId('kpir-ledger-table').getByText(uniqueKorNum).first(),
    ).toBeVisible();

    // Bezpośrednie wejście na /app/ledger na firmie JDG KPiR -> bramka niezgodnego reżimu (#101, #104)
    await page.goto('/app/ledger');
    const gateBanner = page.getByTestId('incompatible-regime-banner-full_ledger');
    await expect(gateBanner).toBeVisible();
    await expect(
      page.getByRole('button', {
        name: /Zapis zablokowany — aktywna firma nie prowadzi pełnych ksiąg/i,
      }),
    ).toBeDisabled();

    // Przełączenie na realnie dostępną Sp. z o.o. przyciskiem w bramce (#101, #104)
    await gateBanner
      .getByRole('button', { name: /Przełącz na: Syntetyczna Technologia Test Sp\. z o\.o\./i })
      .click();
    await expect(page.getByTestId('incompatible-regime-banner-full_ledger')).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Księga główna, ZOiS i CIT' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: /KPiR/i })).toHaveCount(0);

    // #105: Walidacja pustej treści operacji gospodarczej w języku polskim + wskazówka merytoryczna kont
    await page.locator('#jrn-doc').fill('PK/2026/10/99');
    await page.locator('#jrn-desc').fill('');
    await page.getByRole('button', { name: 'Zaksięguj dekret w Dzienniku' }).click();
    await expect(page.getByText(/Uzupełnij treść operacji gospodarczej/i)).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Too small: expected string');

    await page.locator('#jrn-acc-1').selectOption('010');
    await page.locator('#jrn-amt-0').fill('1000.00');
    await page.locator('#jrn-ldesc-0').fill('Koszt usług');
    await page.locator('#jrn-amt-1').fill('1000.00');
    await page.locator('#jrn-ldesc-1').fill('Zobowiązanie wobec dostawcy');
    await expect(page.getByTestId('journal-semantic-warnings')).toContainText('Zespołu 2');

    // Przełączenie w nagłówku na JDG Ryczałt na trasie /app/ledger -> automatyczne przekierowanie na /app/ryczalt (#120)
    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await page.waitForURL('**/app/ryczalt', { timeout: 30_000 });
    await expect(
      sidebar.getByRole('link', { name: 'Ewidencja przychodów (ryczałt)' }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: /Status VAT i limit zwolnienia/i }),
    ).toBeVisible();

    await page.getByTestId('ryczalt-pkwiu-guide-trigger').click();
    await expect(page.getByTestId('ryczalt-pkwiu-guide-panel')).toBeVisible();
  });

  test('9. weryfikuje eksport JPK XSD bez fikcyjnego UPO (#98), FA(3) XML + KSeF Sandbox + WORM (#82, #99), Naliczone vs Opłacone (#81), Konto 130 (#111), blokadę fieldset (#109) i zamknięcie okresu 409 (#116)', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    await loginAsPersona(page, /Zaloguj jako Jan Testowy/i, 'Jan Testowy');
    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);

    // 1. Eksport JPK_V7M(3) zgodny z XSD MF i uczciwy brak numeru UPO (#98, GLD-11)
    await page.goto('/app/vat');
    const jpkPanel = page.getByTestId('statutory-jpk-export-panel');
    await expect(jpkPanel).toBeVisible();
    await jpkPanel.getByTestId('generate-jpk-xml-button').click();
    const jpkResult = jpkPanel.getByTestId('exported-jpk-xml-result');
    await expect(jpkResult).toBeVisible();
    await expect(jpkResult).toContainText('UPO: brak (nieprzesłano do MF)');
    await expect(jpkResult).toContainText('http://crd.gov.pl/wzor/2025/12/19/14090/');

    // 2. Eksport e-faktury FA(3) XML + archiwum źródłowe WORM z deduplikacją SHA-256 (#82, #99, GLD-09, GLD-10)
    await page.goto('/app/documents');
    const ksefPanel = page.getByTestId('ksef-sandbox-and-fa3-panel');
    await expect(ksefPanel).toBeVisible();
    await ksefPanel.getByTestId('export-fa3-xml-button').click();
    const fa3Result = ksefPanel.getByTestId('exported-fa3-xml-result');
    await expect(fa3Result).toBeVisible();
    await expect(fa3Result).toContainText('http://crd.gov.pl/wzor/2025/06/25/13775/');

    const uniqueWormPayload = `DOWOD-WORM-${String(Date.now())}`;
    await ksefPanel.locator('#worm-archive-content').fill(uniqueWormPayload);
    await ksefPanel.getByTestId('worm-archive-submit-button').click();
    await expect(ksefPanel.getByTestId('worm-archive-saved-badge')).toBeVisible();

    // Drugi identyczny zapis WORM -> odmowa 409 duplicate SHA-256 po polsku
    await ksefPanel.getByTestId('worm-archive-submit-button').click();
    await expect(ksefPanel.getByText(/skrót.*SHA-256|skrócie SHA-256/i)).toBeVisible();

    // 3. Sp. z o.o. -> widoczność uzgodnienia Konta 130 na pełnych księgach (#111)
    await switchCompanyViaHeader(page, COMPANY_SPZOO_ID);
    await page.goto('/app/ledger');
    await expect(page.getByTestId('ledger-bank-account-130-summary')).toBeVisible();

    // 4. JDG Ryczałt na /app/kpir -> twarda blokada <fieldset disabled> na formularzu niezgodnego reżimu (#109)
    await switchCompanyViaHeader(page, COMPANY_JDG_RYCZALT_ID);
    await page.goto('/app/kpir');
    await expect(page.getByTestId('incompatible-regime-banner-kpir')).toBeVisible();
    await expect(page.locator('#kpir-doc-num')).toBeDisabled();

    // 5. Naliczone vs Opłacone (#81) + Zamknięcie okresu rozliczeniowego 2026-09 (#116, GLD-08) i odmowa wstecznego zapisu 409
    await switchCompanyViaHeader(page, COMPANY_JDG_KPIR_ID);
    await page.evaluate(async () => {
      await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period: '2026-09' }),
      });
    });

    await page.goto('/app');
    await expect(page.getByTestId('due-vs-paid-obligations-card')).toBeVisible();
    const closePanel = page.getByTestId('period-close-panel');
    await expect(closePanel).toBeVisible();
    await closePanel.locator('#period-close-note').fill('Zamknięcie E2E września 2026');
    await closePanel.getByTestId('close-accounting-period-button').click();

    const closeDialog = page.getByRole('alertdialog');
    await expect(closeDialog).toBeVisible();
    await closeDialog.getByRole('button', { name: /Potwierdzam zamknięcie 2026-09/i }).click();

    await expect(page.getByTestId('period-closed-active-lock-notice')).toBeVisible();
    await expect(page.getByTestId('header-period-status-badge')).toContainText('Okres zamknięty');

    // Próba dopisania dowodu wewnętrznego do zamkniętego miesiąca 2026-09 -> odmowa 409 period_closed po polsku
    await page.goto('/app/kpir');
    await page.locator('#kpir-event-date').fill('2026-09-25');
    await page.locator('#kpir-doc-num').fill('DW/2026/09/LOCKED');
    await page.locator('#kpir-cp-name').fill('Dostawca Testowy');
    await page.locator('#kpir-desc').fill('Próba zapisu w zamkniętym okresie');
    await page.locator('#kpir-exp-pln').fill('150.00');
    await page.getByRole('button', { name: 'Zapisz pozycję w KPiR' }).click();
    await expect(
      page.getByText(/został trwale zamknięty|okres rozliczeniowy jest zamknięty/i).first(),
    ).toBeVisible();
  });
});
