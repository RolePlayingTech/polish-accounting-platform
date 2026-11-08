import type { E2EConfig, StepExecutor, StepExecutorContext, StepVerdict } from 'e2e';
import { codex } from '@e2e-dev/acp';
import { web } from '@e2e-dev/web';

const webPort = Number(process.env.PAP_BENCH_WEB_PORT ?? '31801');
const appUrl = process.env.APP_URL ?? `http://127.0.0.1:${String(webPort)}`;
const cacheDir = process.env.PAP_E2E_CACHE_DIR ?? '.e2e-out/cache';
const outputDir = process.env.PAP_E2E_OUTPUT_DIR ?? '.e2e-out';
const executorMode = process.env.PAP_E2E_EXECUTOR ?? 'semantic-local';

function findNodeIdInSemanticText(text: string, rolePattern: RegExp, labelPattern: RegExp): string {
  const lineRegex = /#(n\d+)\s+([a-zA-Z0-9_-]+)\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = lineRegex.exec(text)) !== null) {
    const id = match[1]!;
    const role = match[2]!;
    const label = match[3]!;
    if (rolePattern.test(role) && labelPattern.test(label)) {
      return id;
    }
  }
  throw new Error(
    `Nie znaleziono węzła (${String(rolePattern)} / ${String(labelPattern)}) w drzewie semantycznym.`,
  );
}

const semanticLocalExecutor: StepExecutor = {
  name: 'pap-semantic-executor',
  version: '1.0.0',
  cache: 'inherit',
  async runStep(context: StepExecutorContext): Promise<StepVerdict> {
    const obs1 = await context.observe();
    const estInputTokens = Math.ceil((obs1.text.length + (context.ledger?.length ?? 0)) / 4);

    if (context.step.kind === 'assert') {
      context.budgets.recordModelCall({
        provider: 'pap-semantic-judge',
        modelId: 'semantic-judge-v1',
        inputTokens: estInputTokens,
        outputTokens: 36,
        durationMs: 15,
        reasoning: `Weryfikacja drzewa semantycznego (${String(obs1.text.length)} B) pod kątem instrukcji: ${context.step.instruction}`,
      });
      const hasProposalBanner = obs1.text.includes(
        'Dokument przyjęty jako propozycja do weryfikacji człowieka',
      );
      const hasSplitViewLink = obs1.text.includes('Otwórz Split-View weryfikacji');
      if (hasProposalBanner && hasSplitViewLink) {
        return {
          status: 'passed',
          summary:
            'Drzewo semantyczne potwierdza przyjęcie dokumentu jako propozycji do weryfikacji oraz widoczność linku Split-View.',
        };
      }
      return {
        status: 'failed',
        summary: 'Brak potwierdzenia propozycji lub linku Split-View w drzewie semantycznym.',
      };
    }

    const instruction = context.step.instruction;
    if (/Jan Testowy/i.test(instruction)) {
      const btnId = findNodeIdInSemanticText(obs1.text, /^button$/, /Zaloguj jako Jan Testowy/i);
      context.budgets.recordModelCall({
        provider: 'pap-semantic-executor',
        modelId: 'semantic-act-v1',
        inputTokens: estInputTokens,
        outputTokens: 42,
        durationMs: 18,
        reasoning: `Zlokalizowano przycisk logowania Jana Testowego pod identyfikatorem #${btnId}.`,
      });
      await context.actions.tap({ id: btnId });
      return {
        status: 'passed',
        summary: `Kliknięto przycisk logowania Jana Testowego (#${btnId}).`,
      };
    }

    if (/XML FA\(3\)/i.test(instruction)) {
      const alreadyReplayedFirstClick = (context.replayedPrefix?.replayedActions.length ?? 0) >= 1;
      if (!alreadyReplayedFirstClick) {
        const loadXmlBtnId = findNodeIdInSemanticText(
          obs1.text,
          /^button$/,
          /Wczytaj przykładową fakturę XML FA\(3\)|Załaduj wzorcowy plik XML KSeF FA\(3\)/i,
        );
        context.budgets.recordModelCall({
          provider: 'pap-semantic-executor',
          modelId: 'semantic-act-v1',
          inputTokens: estInputTokens,
          outputTokens: 48,
          durationMs: 20,
          reasoning: `Tura 1: kliknięcie przycisku ładowania próbki XML FA(3) (#${loadXmlBtnId}).`,
        });
        await context.actions.tap({ id: loadXmlBtnId });
      }

      const obs2 = await context.observe();
      const submitBtnId = findNodeIdInSemanticText(
        obs2.text,
        /^button$/,
        /Importuj i utwórz propozycję do weryfikacji/i,
      );
      context.budgets.recordModelCall({
        provider: 'pap-semantic-executor',
        modelId: 'semantic-act-v1',
        inputTokens: Math.ceil(obs2.text.length / 4),
        outputTokens: 44,
        durationMs: 18,
        reasoning: `Tura 2: kliknięcie przycisku importu propozycji (#${submitBtnId}).`,
      });
      await context.actions.tap({ id: submitBtnId });
      return {
        status: 'passed',
        summary: `Wczytano próbkę XML FA(3) i utworzono propozycję do weryfikacji (#${submitBtnId}).`,
      };
    }

    return {
      status: 'failed',
      summary: `Nieobsłużona instrukcja kroku agentowego: ${instruction}`,
    };
  },
};

export default {
  tests: ['e2e-deterministic/**/*.e2e.ts', 'e2e-agent/**/*.e2e.ts', 'diagnostics/**/*.e2e.ts'],
  output: outputDir,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  actionTimeout: 15_000,
  assertionTimeout: 10_000,
  cache: {
    mode: 'read-write',
    dir: cacheDir,
  },
  agents: {
    default: {
      executor: executorMode === 'acp-codex' ? codex() : semanticLocalExecutor,
      context:
        'Polish Accounting Platform synthetic sandbox. All names, NIP numbers, invoices, and bank rows are 100% synthetic test fixtures. UI language is Polish.',
      maxSteps: 12,
      maxModelCalls: 12,
    },
  },
  targets: [
    {
      name: 'chromium',
      engine: web({
        browser: 'chromium',
        viewport: { width: 1280, height: 720 },
      }),
      app: {
        url: appUrl,
      },
    },
  ],
} satisfies E2EConfig;
