import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { ACADEMY_ALL_LESSONS } from '@pap/domain/academy';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, '..');
const repoRoot = resolve(webRoot, '../..');
const screenshotsDir = resolve(webRoot, 'public/academy/screenshots');

const API_PORT = Number(process.env.PAP_CAPTURE_API_PORT ?? '4120');
const WEB_PORT = Number(process.env.PAP_CAPTURE_WEB_PORT ?? '3120');
const apiBaseUrl = `http://127.0.0.1:${String(API_PORT)}`;
const webBaseUrl = `http://127.0.0.1:${String(WEB_PORT)}`;

const TENANT_1_ID = '11111111-1111-4111-8111-111111111100';
const COMPANY_KPIR_ID = '11111111-1111-4111-8111-111111111101';
const COMPANY_RYCZALT_ID = '11111111-1111-4111-8111-111111111102';
const COMPANY_SPZOO_ID = '11111111-1111-4111-8111-111111111103';

const DEMO_COMPANY_MAP = {
  demo_jdg_kpir_alfa: COMPANY_KPIR_ID,
  demo_jdg_ryczalt_beta: COMPANY_RYCZALT_ID,
  demo_spzoo_gamma: COMPANY_SPZOO_ID,
};

/**
 * Nadpisania docelowej trasy, podmiotu oraz interakcji UI dla slotów,
 * które wymagają konkretnego dokumentu Split-View, zakładki lub okresu.
 */
const SLOT_OVERRIDES = {
  'm01-l02-weryfikacja-kosztu-kup-nkup': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/documents/doc-kpir-car-042',
  },
  'm02-l02-porownanie-form-opodatkowania': {
    companyId: COMPANY_RYCZALT_ID,
    route: '/app/companies',
  },
  'm02-l03-profil-cit-spolki-zoo': {
    companyId: COMPANY_SPZOO_ID,
    route: '/app/vat',
  },
  'm03-l01-slad-obliczen-zaliczki-pit': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/kpir',
  },
  'm03-l03-pasek-limitu-vat-240k-i-mpp': {
    companyId: COMPANY_RYCZALT_ID,
    route: '/app/ryczalt',
  },
  'm05-l02-kalkulator-faktury-samochodowej-50-75': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/documents/doc-kpir-car-042',
  },
  'm06-l01-ewidencja-przychodow-ryczalt-stawki': {
    companyId: COMPANY_RYCZALT_ID,
    route: '/app/ryczalt',
  },
  'm06-l02-kalkulacja-ryczaltu-ppe-i-odliczenia-zus': {
    companyId: COMPANY_RYCZALT_ID,
    route: '/app/ryczalt',
  },
  'm06-l03-alert-progu-zdrowotnej-ryczalt-300k': {
    companyId: COMPANY_RYCZALT_ID,
    route: '/app/ryczalt',
  },
  'm07-l01-zakladowy-plan-kont-zespoly-0-8': {
    companyId: COMPANY_SPZOO_ID,
    route: '/app/ledger',
    tabLabel: 'Plan kont (Zespoły 0–8)',
  },
  'm07-l02-edytor-dekretu-wn-ma-i-storno': {
    companyId: COMPANY_SPZOO_ID,
    route: '/app/ledger',
    tabLabel: 'Dziennik księgowań (Wn = Ma)',
  },
  'm07-l03-raport-bilans-i-rzis-spolki': {
    companyId: COMPANY_SPZOO_ID,
    route: '/app/ledger',
    tabLabel: 'Bilans i RZiS',
  },
  'm09-l01-kalendarz-podatkowy-przesuniecia-swiateczne': {
    companyId: COMPANY_KPIR_ID,
    period: '2026-06',
    route: '/app/calendar',
  },
  'm09-l03-weryfikacja-bialej-listy-i-ade': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/finance',
  },
  'm10-l01-tabela-wiekowania-rozrachunkow': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/finance',
  },
  'm10-l03-import-wyciagu-csv-mt940-i-rezerwa': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/finance',
  },
  'm11-l01-widok-dzielony-ocr-weryfikacja-czlowieka': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/documents/doc-kpir-car-042',
  },
  'm11-l02-panel-uprawnien-mcp-i-kolejka-prepare-confirm': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/companies',
  },
  'm11-l03-alert-zmiany-iban-i-izolacja-sekretow': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/finance',
  },
  'm12-l01-kreator-profilu-firmy-demo-i-field-help': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/companies',
    openFieldHelpInSelector: '[data-testid="demo-company-tax-profile-wizard"]',
  },
  'm12-l02-samouczek-obieg-faktur-split-view': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/documents/doc-kpir-car-042',
  },
  'm12-l03-szuflada-dlaczego-slad-obliczeniowy-jpk': {
    companyId: COMPANY_KPIR_ID,
    route: '/app/vat',
  },
};

function parseCliArgs(argv) {
  let mobileAuditDir = null;
  let skipServers = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--mobile-audit-dir' && argv[i + 1]) {
      mobileAuditDir = resolve(process.cwd(), argv[i + 1]);
      i += 1;
    } else if (argv[i] === '--skip-servers') {
      skipServers = true;
    }
  }
  return { mobileAuditDir, skipServers };
}

async function waitForHttpOk(url, child, label, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${label} zakończył pracę przed gotowością (kod ${String(child.exitCode)}).`);
    }
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) {
        return;
      }
    } catch {
      // Serwer jeszcze startuje.
    }
    await delay(300);
  }
  throw new Error(`${label} nie odpowiedział pod adresem ${url} w ciągu ${String(timeoutMs)} ms.`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // Ignoruj.
      }
      resolveExit();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveExit();
    });
    child.kill('SIGTERM');
  });
}

async function startLiveApi() {
  const apiEntry = resolve(repoRoot, 'apps/api/dist/main.js');
  if (!existsSync(apiEntry)) {
    throw new Error(`Brak zbudowanego @pap/api (${apiEntry}). Uruchom najpierw build @pap/api.`);
  }
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    PAP_OIDC_ENV: 'test',
    PAP_SANDBOX_AUTH_ENABLED: 'true',
    PAP_SANDBOX_OIDC_ISSUER: apiBaseUrl,
  };
  delete env.PAP_OIDC_JWKS_URI;
  delete env.PAP_OIDC_ISSUER;

  const child = spawn(process.execPath, [apiEntry], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text.length > 0) {
      process.stderr.write(`[api] ${text}\n`);
    }
  });
  await waitForHttpOk(`${apiBaseUrl}/health`, child, '@pap/api', 25_000);
  return child;
}

async function startLiveWeb() {
  const nextBin = resolve(webRoot, 'node_modules/next/dist/bin/next');
  const child = spawn(
    process.execPath,
    [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(WEB_PORT)],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        API_BASE_URL: apiBaseUrl,
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text.length > 0 && !text.includes('ExperimentalWarning')) {
      process.stderr.write(`[web] ${text}\n`);
    }
  });
  await waitForHttpOk(`${webBaseUrl}/login`, child, '@pap/web', 90_000);
  return child;
}

async function setSessionContext(page, { companyId, period }) {
  const result = await page.evaluate(
    async ({ tenantId, legalEntityId, nextPeriod }) => {
      const response = await fetch('/api/session/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          tenantId,
          legalEntityId,
          period: nextPeriod,
        }),
      });
      return { ok: response.ok, status: response.status };
    },
    { tenantId: TENANT_1_ID, legalEntityId: companyId, nextPeriod: period },
  );
  if (!result.ok) {
    throw new Error(
      `Nie udało się przełączyć kontekstu sesji na ${companyId} (${period}): HTTP ${String(result.status)}`,
    );
  }
}

async function run() {
  const { mobileAuditDir, skipServers } = parseCliArgs(process.argv.slice(2));
  mkdirSync(screenshotsDir, { recursive: true });
  if (mobileAuditDir) {
    mkdirSync(mobileAuditDir, { recursive: true });
  }

  let apiProc;
  let webProc;
  let browser;

  try {
    if (!skipServers) {
      console.log(`[capture] Uruchamianie @pap/api na ${apiBaseUrl}...`);
      apiProc = await startLiveApi();
      console.log(`[capture] Uruchamianie @pap/web na ${webBaseUrl}...`);
      webProc = await startLiveWeb();
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: webBaseUrl,
      locale: 'pl-PL',
      timezoneId: 'Europe/Warsaw',
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });

    await context.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent =
        'nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }';
      document.documentElement.appendChild(style);
    });

    const page = await context.newPage();

    // Logowanie jako Jan Testowy przez rzeczywisty formularz /login + Sandbox OIDC ES256
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Zaloguj jako Jan Testowy/i }).click();
    await page.waitForURL('**/app', { timeout: 30_000 });
    await page.waitForLoadState('networkidle');

    let currentCompanyId = COMPANY_KPIR_ID;
    let currentPeriod = '2026-10';

    const slotFilter = process.env.PAP_CAPTURE_SLOT_FILTER ?? '';
    const targetLessons = slotFilter
      ? ACADEMY_ALL_LESSONS.filter((l) => l.screenshotSlot.slotId.includes(slotFilter))
      : ACADEMY_ALL_LESSONS;

    console.log(
      `[capture] Rozpoczynam generowanie ${String(targetLessons.length)} zrzutów Akademii...`,
    );

    for (const lesson of targetLessons) {
      const { slotId, appRoute, captureSelector, imagePath } = lesson.screenshotSlot;
      const override = SLOT_OVERRIDES[slotId] ?? {};
      const desiredCompanyId =
        override.companyId ??
        DEMO_COMPANY_MAP[lesson.practicalExercise.demoCompanyId] ??
        COMPANY_KPIR_ID;
      const desiredPeriod = override.period ?? '2026-10';
      const targetRoute = override.route ?? appRoute;
      const fileName = imagePath.replace('/academy/screenshots/', '');
      const outPath = resolve(screenshotsDir, fileName);

      if (desiredCompanyId !== currentCompanyId || desiredPeriod !== currentPeriod) {
        await setSessionContext(page, { companyId: desiredCompanyId, period: desiredPeriod });
        currentCompanyId = desiredCompanyId;
        currentPeriod = desiredPeriod;
      }

      await page.goto(targetRoute, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.evaluate(() => document.fonts.ready);

      if (override.tabLabel) {
        await page.getByRole('tab', { name: override.tabLabel }).click();
        await delay(150);
      }

      if (override.openFieldHelpInSelector) {
        const helpBtn = page
          .locator(`${override.openFieldHelpInSelector} button[data-field-help-id]`)
          .first();
        await helpBtn.waitFor({ state: 'visible', timeout: 10_000 });
        await helpBtn.click();
        await delay(150);
      }

      const locator = page.locator(captureSelector).first();
      await locator.waitFor({ state: 'visible', timeout: 15_000 });

      await locator.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const absTop = window.scrollY + rect.top;
        const targetScrollY = rect.top < 72 && window.scrollY === 0 ? 0 : Math.max(0, absTop - 88);
        window.scrollTo({ top: targetScrollY, behavior: 'instant' });
        if (rect.width < 1020 || rect.height < 520) {
          el.setAttribute(
            'data-pap-capture-prev-style',
            el.getAttribute('style') ?? '__EMPTY_STYLE__',
          );
          el.style.outline = '2px solid #1d5c42';
          el.style.outlineOffset = '4px';
          el.style.borderRadius = '12px';
        }
      });

      await delay(120);
      await page.screenshot({ path: outPath, fullPage: false });

      await locator.evaluate((el) => {
        const prev = el.getAttribute('data-pap-capture-prev-style');
        if (prev !== null) {
          el.removeAttribute('data-pap-capture-prev-style');
          if (prev === '__EMPTY_STYLE__') {
            el.removeAttribute('style');
          } else {
            el.setAttribute('style', prev);
          }
        }
      });

      const sizeBytes = statSync(outPath).size;
      if (sizeBytes < 4_096) {
        throw new Error(
          `Wygenerowany plik ${outPath} jest podejrzanie mały (${String(sizeBytes)} B).`,
        );
      }
      console.log(`[capture] OK ${slotId}.png (${String(Math.round(sizeBytes / 1024))} KB)`);
    }

    if (mobileAuditDir) {
      console.log(`[capture] Wykonywanie audytu mobilnego 375x812 w ${mobileAuditDir}...`);
      const mobileContext = await browser.newContext({
        baseURL: webBaseUrl,
        locale: 'pl-PL',
        timezoneId: 'Europe/Warsaw',
        viewport: { width: 375, height: 812 },
        hasTouch: true,
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
      });
      await mobileContext.addInitScript(() => {
        const style = document.createElement('style');
        style.textContent =
          'nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display: none !important; }';
        document.documentElement.appendChild(style);
      });

      const mobilePage = await mobileContext.newPage();
      const mobileScreens = [
        { slug: '01-login-mobile', route: '/login', loginAfter: true },
        { slug: '02-app-dashboard-mobile', route: '/app' },
        { slug: '03-app-kpir-mobile', route: '/app/kpir' },
        { slug: '04-app-documents-mobile', route: '/app/documents' },
        { slug: '05-academy-mobile', route: '/academy' },
      ];

      for (const screen of mobileScreens) {
        await mobilePage.goto(screen.route, { waitUntil: 'networkidle', timeout: 45_000 });
        await mobilePage.evaluate(() => document.fonts.ready);
        await delay(150);

        const metrics = await mobilePage.evaluate(() => ({
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        const outMobile = resolve(mobileAuditDir, `${screen.slug}.png`);
        await mobilePage.screenshot({ path: outMobile, fullPage: false });
        console.log(
          `[mobile-audit] ${screen.slug}.png (innerWidth=${String(metrics.innerWidth)}, scrollWidth=${String(metrics.scrollWidth)})`,
        );

        if (screen.loginAfter) {
          await mobilePage.getByRole('button', { name: /Zaloguj jako Jan Testowy/i }).click();
          await mobilePage.waitForURL('**/app', { timeout: 30_000 });
        }
      }
      await mobileContext.close();
    }

    await context.close();
    console.log('[capture] Zakończono sukcesem wszystkie 37 zrzutów Akademii.');
  } finally {
    if (browser) {
      await browser.close();
    }
    await stopChild(webProc);
    await stopChild(apiProc);
  }
}

run().catch((err) => {
  console.error('[capture] BŁĄD:', err);
  process.exitCode = 1;
});
