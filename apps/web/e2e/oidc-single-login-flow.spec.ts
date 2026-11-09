import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';

interface E2eStackMetadata {
  readonly mode: 'postgres' | 'memory';
  readonly idpIssuer: string;
  readonly apiBaseUrlA: string;
  readonly apiBaseUrlB: string | null;
  readonly tenantId: string;
  readonly ownerUserId: string;
}

const repositoryRoot = process.cwd();
let stackProcess: ChildProcess | undefined;
let stackMeta: E2eStackMetadata | undefined;

async function startOidcE2eStack(): Promise<{
  readonly child: ChildProcess;
  readonly meta: E2eStackMetadata;
}> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', resolve(repositoryRoot, 'apps/api/test/helpers/e2e-oidc-stack.ts')],
    {
      cwd: resolve(repositoryRoot, 'apps/api'),
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: resolve(repositoryRoot, 'apps/api/test/tsconfig.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const stderrLines: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrLines.push(chunk.toString('utf8'));
  });

  const meta = await new Promise<E2eStackMetadata>((resolveReady, rejectReady) => {
    const timer = setTimeout(() => {
      rejectReady(
        new Error(
          `Przekroczono limit 60s oczekiwania na start stosu OIDC E2E. Stderr: ${stderrLines.join('')}`,
        ),
      );
    }, 60_000);

    child.once('exit', (code) => {
      clearTimeout(timer);
      rejectReady(
        new Error(
          `Stos OIDC E2E zakończył pracę przed gotowością (kod=${String(code)}). Stderr: ${stderrLines.join('')}`,
        ),
      );
    });

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      if (line.startsWith('E2E_OIDC_STACK_READY ')) {
        clearTimeout(timer);
        rl.close();
        resolveReady(
          JSON.parse(line.slice('E2E_OIDC_STACK_READY '.length)) as E2eStackMetadata,
        );
      }
    });
  });

  return { child, meta };
}

async function stopOidcE2eStack(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolveExit();
    }, 8_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.kill('SIGTERM');
  });
  await delay(200);
}

test.describe('Pojedyncze logowanie OIDC + PKCE, bootstrap właściciela, zaproszenia i cofanie dostępu (#78, #83)', () => {
  // eslint-disable-next-line no-empty-pattern
  test.beforeAll(async ({}, testInfo) => {
    testInfo.setTimeout(90_000);
    const started = await startOidcE2eStack();
    stackProcess = started.child;
    stackMeta = started.meta;
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterAll(async ({}, testInfo) => {
    testInfo.setTimeout(30_000);
    await stopOidcE2eStack(stackProcess);
    stackProcess = undefined;
    stackMeta = undefined;
  });

  test('obsługuje czyste pojedyncze logowanie OIDC bez selektora person, onboarding właściciela, ograniczone zaproszenie księgowej i natychmiastowe cofnięcie członkostwa między 2 kontekstami przeglądarki', async ({
    browser,
  }) => {
    expect(stackMeta).toBeDefined();
    if (process.env['PAP_REQUIRE_POSTGRES_E2E'] === 'true') {
      expect(stackMeta!.mode).toBe('postgres');
    }

    const ownerContext = await browser.newContext();
    const accountantContext = await browser.newContext();

    try {
      const ownerPage = await ownerContext.newPage();

      // 1. Weryfikacja ekranu /login w trybie STAGING_PRIVATE: brak Basic Auth, brak selektora person, brak piaskownicy OIDC
      await ownerPage.goto('/login');
      await expect(
        ownerPage.getByRole('heading', { name: 'Zaloguj się do Polish Accounting Platform' }),
      ).toBeVisible();
      await expect(ownerPage.getByTestId('oidc-single-login-submit')).toBeVisible();
      await expect(ownerPage.getByText('Wybierz syntetyczną personę testową')).toHaveCount(0);
      await expect(ownerPage.getByText('Jan Testowy')).toHaveCount(0);
      await expect(ownerPage.getByText('Marta Księgowa')).toHaveCount(0);
      await expect(ownerPage.getByText('OIDC Sandbox')).toHaveCount(0);

      // Bezpośrednie uderzenie w trasy syntetycznych person w Web i API musi zakończyć się odmową
      const webPersonaAttempt = await ownerPage.request.post('/api/session/login', {
        headers: { Origin: 'http://localhost:31608' },
        data: { personaId: 'jan-testowy' },
      });
      expect(webPersonaAttempt.status()).toBe(403);

      const apiSandboxAttempt = await fetch(`${stackMeta!.apiBaseUrlA}/api/v1/oidc/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId: 'jan-testowy' }),
      });
      expect(apiSandboxAttempt.status).toBe(404);

      // 2. Anulowanie u dostawcy OIDC -> powrót na /login?authState=oidc_denied_or_cancelled z polskim komunikatem
      await ownerPage.getByTestId('oidc-single-login-submit').click();
      await expect(
        ownerPage.getByRole('heading', { name: 'Zewnętrzny dostawca tożsamości OIDC' }),
      ).toBeVisible();
      await ownerPage.getByRole('button', { name: 'Anuluj logowanie' }).click();
      await ownerPage.waitForURL(/\/login\?authState=oidc_denied_or_cancelled/);
      await expect(ownerPage.getByText('Logowanie zostało przerwane')).toBeVisible();

      // 3. Logowanie właściciela (Anna Właścicielka) przez OAuth 2.0 + PKCE (S256)
      await ownerPage.getByTestId('oidc-single-login-submit').click();
      await ownerPage
        .getByRole('button', { name: /Zaloguj jako Anna Właścicielka/i })
        .click();
      await ownerPage.waitForURL(/\/app$/, { timeout: 45_000 });

      // Sprawdzenie atrybutów bezpieczeństwa nieprzezroczystego ciasteczka sesji BFF (pap_session_id)
      const ownerCookies = await ownerContext.cookies();
      const bffCookie = ownerCookies.find((c) => c.name === 'pap_session_id');
      expect(bffCookie).toBeDefined();
      expect(bffCookie!.httpOnly).toBe(true);
      expect(bffCookie!.secure).toBe(true);
      expect(bffCookie!.sameSite).toBe('Lax');
      expect(bffCookie!.value.includes('.')).toBe(false);
      expect(ownerCookies.find((c) => c.name === 'pap_oidc_token')).toBeUndefined();
      expect(ownerCookies.find((c) => c.name === 'pap_session_ctx')).toBeUndefined();

      // 4. Onboarding właściciela bez podmiotów: utworzenie Firmy 1 na ekranie /app
      await expect(ownerPage.getByTestId('owner-first-company-card')).toBeVisible();
      await ownerPage.getByLabel(/Pełna nazwa podmiotu/i).fill('Kancelaria Alfa E2E JDG');
      await ownerPage
        .getByRole('button', { name: 'Utwórz pierwszy podmiot i otwórz pulpit' })
        .click();
      await expect(ownerPage.getByTestId('dashboard-financial-overview')).toBeVisible();
      await expect(ownerPage.getByText('Aktor: Anna Właścicielka')).toBeVisible();

      // 5. Przejście do /app/companies, utworzenie drugiej firmy (Firma 2 — tajna dla księgowej) i wystawienie zaproszenia tylko do Firmy 1 (read)
      await ownerPage.goto('/app/companies');
      await ownerPage.getByLabel(/Pełna nazwa firmy/i).fill('Spółka Beta Tajna E2E');
      await ownerPage
        .getByRole('button', { name: 'Utwórz podmiot i przełącz kontekst' })
        .click();
      await expect(
        ownerPage.locator('strong', { hasText: 'Spółka Beta Tajna E2E' }),
      ).toBeVisible();

      const companySelect = ownerPage.locator('#pap-active-company-select');
      const ownerOptions = await companySelect.locator('option').allTextContents();
      expect(ownerOptions.length).toBe(2);
      const betaEntityId = await companySelect.inputValue();

      // Przełączenie właściciela z powrotem na Firmę 1 przed wystawieniem ograniczonego zaproszenia
      const alfaOptionValue = await companySelect
        .locator('option', { hasText: 'Kancelaria Alfa E2E JDG' })
        .getAttribute('value');
      expect(alfaOptionValue).toBeTruthy();

      const switchBackResp = ownerPage.waitForResponse(
        (r) => r.url().includes('/api/session/context') && r.request().method() === 'POST',
      );
      await companySelect.selectOption(alfaOptionValue!);
      expect((await switchBackResp).ok()).toBe(true);
      await expect(
        ownerPage.locator('strong', { hasText: 'Kancelaria Alfa E2E JDG' }),
      ).toBeVisible();

      const inviteForm = ownerPage.getByTestId('create-invitation-form');
      await inviteForm
        .getByLabel('Adres e-mail zapraszanej osoby')
        .fill('ewa.ksiegowa@syntetyczny.example');
      await inviteForm.getByLabel('Imię i nazwisko (opcjonalnie)').fill('Ewa Księgowa');
      await inviteForm
        .getByRole('button', { name: 'Wygeneruj jednorazowe zaproszenie' })
        .click();

      await expect(ownerPage.getByTestId('created-invitation-secret')).toBeVisible();
      const acceptPath = (
        await ownerPage.getByTestId('created-invitation-accept-path').textContent()
      )?.trim();
      const rawInvitationToken = (
        await ownerPage.getByTestId('created-invitation-token').textContent()
      )?.trim();
      expect(acceptPath).toMatch(/^\/login\?invite=/);
      expect(rawInvitationToken && rawInvitationToken.length >= 24).toBe(true);

      // 6. Drugi niezależny kontekst przeglądarki (Ewa Księgowa): logowanie z linku zaproszenia i akceptacja
      const accountantPage = await accountantContext.newPage();
      const inviteLoginResp = await accountantPage.goto(acceptPath!);
      expect(inviteLoginResp?.headers()['referrer-policy']).toBe('same-origin');
      await expect(
        accountantPage.getByText('Wykryto jednorazowe zaproszenie do organizacji'),
      ).toBeVisible();
      await accountantPage.getByTestId('oidc-single-login-submit').click();
      await accountantPage
        .getByRole('button', { name: /Zaloguj jako Ewa Księgowa/i })
        .click();
      await accountantPage.waitForURL(/\/app\?invite=/, { timeout: 45_000 });

      await expect(accountantPage.getByTestId('invitation-acceptance-form')).toBeVisible();
      await accountantPage
        .getByRole('button', { name: 'Przyjmij zaproszenie do organizacji' })
        .click();
      await accountantPage.waitForURL(/\/app$/, { timeout: 45_000 });

      // Ewa widzi pulpit Firmy 1 (tylko odczyt) i NIE widzi Firmy 2
      await expect(accountantPage.getByTestId('dashboard-financial-overview')).toBeVisible();
      await expect(accountantPage.getByText('Aktor: Ewa Księgowa')).toBeVisible();
      await expect(accountantPage.getByText('Uprawnienia: tylko odczyt')).toBeVisible();

      const accCompanyOptions = await accountantPage
        .locator('#pap-active-company-select option')
        .allTextContents();
      expect(accCompanyOptions).toEqual(['Kancelaria Alfa E2E JDG']);

      // Próba przełączenia kontekstu Ewy na tajną Firmę 2 kończy się twardą odmową 403
      const forbiddenSwitch = await accountantPage.request.post('/api/session/context', {
        headers: { Origin: 'http://localhost:31608' },
        data: { tenantId: stackMeta!.tenantId, legalEntityId: betaEntityId },
      });
      expect(forbiddenSwitch.status()).toBe(403);

      // Próba ponownego wykorzystania zużytego jednorazowego tokena zaproszenia kończy się 409 Conflict
      const replayAccept = await accountantPage.request.post('/api/session/invitations/accept', {
        headers: { Origin: 'http://localhost:31608' },
        data: { invitationToken: rawInvitationToken },
      });
      expect(replayAccept.status()).toBe(409);

      // 7. Natychmiastowe cofnięcie członkostwa Ewy przez Właścicielkę i natychmiastowa utrata sesji BFF w Kontekście 2
      await ownerPage.reload();
      const invitationsCard = ownerPage.getByTestId('tenant-invitations-card');
      await invitationsCard.getByRole('button', { name: 'Cofnij członkostwo' }).click();
      await ownerPage
        .getByRole('button', { name: 'Tak, cofnij członkostwo w organizacji' })
        .click();
      await expect(
        ownerPage.getByText('Zapisano zmianę i zarejestrowano ślad audytowy'),
      ).toBeVisible();

      // Ewa odświeża /app — jej sesja BFF w PostgreSQL została natychmiast unieważniona, księgi Firmy 1 są niedostępne
      await accountantPage.reload();
      await expect(accountantPage.getByTestId('dashboard-financial-overview')).toHaveCount(0);
      await expect(
        accountantPage.getByRole('link', { name: 'Zaloguj się do aplikacji' }),
      ).toBeVisible();

      // 8. Czyste wylogowanie Właścicielki -> przekierowanie na /login?authState=signed_out
      await ownerPage.getByRole('button', { name: 'Wyloguj' }).click();
      await ownerPage.waitForURL(/\/login\?authState=signed_out/);
      await expect(ownerPage.getByText('Wylogowano pomyślnie')).toBeVisible();
      const postLogoutCookies = await ownerContext.cookies();
      expect(postLogoutCookies.find((c) => c.name === 'pap_session_id')).toBeUndefined();
      expect(postLogoutCookies.find((c) => c.name === 'pap_oidc_token')).toBeUndefined();
    } finally {
      await accountantContext.close();
      await ownerContext.close();
    }
  });
});
