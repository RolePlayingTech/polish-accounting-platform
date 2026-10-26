import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from '@playwright/test';

const repositoryRoot = process.cwd();
const apiPort = 41_607;
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

let apiProcess: ChildProcess | undefined;

async function startApi(): Promise<ChildProcess> {
  const child = spawn(process.execPath, [resolve(repositoryRoot, 'apps/api/dist/main.js')], {
    cwd: repositoryRoot,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort) },
    stdio: 'ignore',
  });
  apiProcess = child;

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API zakończyło pracę przed startem (kod ${child.exitCode}).`);
    }

    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      if (response.ok) {
        return child;
      }
    } catch {
      // API może jeszcze uruchamiać serwer.
    }

    await delay(200);
  }

  throw new Error('Lokalne API nie uruchomiło się w ciągu 15 sekund.');
}

async function stopApi(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolveExit, reject) => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Nie udało się zatrzymać lokalnego API po teście.'));
    }, 5_000);
    const onExit = () => {
      clearTimeout(timeout);
      resolveExit();
    };
    child.once('exit', onExit);
    child.kill();
  });
}

test('pokazuje stan rzeczywistego API i uczciwie opisuje jego niedostępność', async ({ page }) => {
  test.setTimeout(60_000);

  try {
    const server = await startApi();
    await page.goto('/app');

    await expect(page.getByText('API odpowiada', { exact: true })).toBeVisible();
    const availabilityCard = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Zakres pierwszego etapu' }) });
    await expect(availabilityCard.getByText('Uruchomiony', { exact: true })).toBeVisible();
    await expect(availabilityCard.getByText('Dostępny', { exact: true })).toBeVisible();
    await expect(availabilityCard).toHaveCSS('border-radius', '16px');

    await stopApi(server);
    apiProcess = undefined;
    await page.reload();

    await expect(page.getByText('API niedostępne', { exact: true })).toHaveCount(1);
    await expect(availabilityCard.getByText('Niedostępny', { exact: true })).toBeVisible();
  } finally {
    await stopApi(apiProcess);
    apiProcess = undefined;
  }
});
