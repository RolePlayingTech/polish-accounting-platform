import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

describe('Benchmark porównawczy e2e — tryb agentowy AI (agent.act + cache + agent.assert)', () => {
  test('1. agent AI loguje Jana Testowego i otwiera obieg dokumentów (z zapisem do cache po weryfikacji)', async ({
    agent,
    app,
    browser,
    screen,
  }) => {
    await app.open('/login');

    await agent.act('Click the button to log in as Jan Testowy');
    await browser.waitForURL(/\/app$/, { timeout: 30_000 });
    await expect(screen.getByText('Aktor: Jan Testowy')).toBeVisible();

    await app.open('/app/documents');
    await agent.act(
      'Click the button "Wczytaj przykładową fakturę XML FA(3)" and then click "Importuj i utwórz propozycję do weryfikacji"',
    );
    await expect(
      screen.getByText('Dokument przyjęty jako propozycja do weryfikacji człowieka'),
    ).toBeVisible();

    await agent.assert(
      'The screen confirms that a document was accepted as a proposal for human verification and shows a link to open Split-View verification',
    );
  });
});
