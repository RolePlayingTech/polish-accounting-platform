/* global AbortSignal, console, fetch */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = process.cwd();
const apiPort = Number(process.env.PAP_BENCH_API_PORT ?? '41801');
const webPort = Number(process.env.PAP_BENCH_WEB_PORT ?? '31801');
const apiBaseUrl = `http://127.0.0.1:${String(apiPort)}`;
const webBaseUrl = `http://127.0.0.1:${String(webPort)}`;

const activeChildren = new Set();

function parseArg(prefix, fallback) {
  const found = process.argv.find((arg) => arg.startsWith(`${prefix}=`));
  return found ? found.slice(prefix.length + 1) : fallback;
}

const mode = parseArg('--mode', 'all');
const deterministicRuns = Number(parseArg('--runs', '3'));

function killProcessTree(child) {
  if (!child || !child.pid) return;
  activeChildren.delete(child);
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    // Proces już zakończony.
  }
}

function freeDedicatedBenchmarkPorts() {
  for (const child of [...activeChildren]) {
    killProcessTree(child);
  }
  if (process.platform !== 'win32') return;
  try {
    const netstat = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    const pids = new Set();
    for (const line of netstat.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;
      const localAddr = parts[1] ?? '';
      const state = parts[3] ?? '';
      const pid = parts[4] ?? '';
      if (
        state === 'LISTENING' &&
        (localAddr.endsWith(`:${String(apiPort)}`) || localAddr.endsWith(`:${String(webPort)}`)) &&
        /^\d+$/.test(pid) &&
        pid !== '0' &&
        Number(pid) !== process.pid
      ) {
        pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execFileSync('taskkill', ['/T', '/F', '/PID', pid], { stdio: 'ignore' });
      } catch {
        // Proces już zakończony.
      }
    }
  } catch {
    // Brak procesów nasłuchujących na portach benchmarku.
  }
}

async function waitForHttpOk(urls, timeoutMs = 25_000) {
  const urlList = Array.isArray(urls) ? urls : [urls];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const url of urlList) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1_500) });
        if (res.ok) return;
      } catch {
        // Serwer jeszcze startuje.
      }
    }
    await delay(250);
  }
  throw new Error(
    `Przekroczono czas oczekiwania na ${urlList.join(' / ')} (${String(timeoutMs)} ms).`,
  );
}

async function startStack() {
  freeDedicatedBenchmarkPorts();
  await delay(300);

  const apiEnv = {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    PAP_OIDC_ENV: 'test',
    PAP_SANDBOX_AUTH_ENABLED: 'true',
    PAP_SANDBOX_OIDC_ISSUER: apiBaseUrl,
  };
  delete apiEnv.PAP_OIDC_JWKS_URI;
  delete apiEnv.PAP_OIDC_ISSUER;

  let apiChild;
  async function spawnFreshApi() {
    killProcessTree(apiChild);
    await delay(150);
    apiChild = spawn(process.execPath, [resolve(repoRoot, 'apps/api/dist/main.js')], {
      cwd: repoRoot,
      env: apiEnv,
      stdio: 'ignore',
    });
    activeChildren.add(apiChild);
    await waitForHttpOk([`${apiBaseUrl}/health`, `${apiBaseUrl}/api/v1/system/status`], 20_000);
  }

  let webChild;
  try {
    await spawnFreshApi();

    const webEnv = {
      ...process.env,
      NODE_ENV: 'development',
      API_BASE_URL: apiBaseUrl,
    };

    webChild = spawn(
      process.execPath,
      [
        resolve(repoRoot, 'apps/web/node_modules/next/dist/bin/next'),
        'dev',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(webPort),
      ],
      {
        cwd: resolve(repoRoot, 'apps/web'),
        env: webEnv,
        stdio: 'ignore',
      },
    );
    activeChildren.add(webChild);

    await waitForHttpOk(`${webBaseUrl}/login`, 35_000);
    await Promise.all(
      [
        '/app',
        '/app/documents',
        '/app/kpir',
        '/app/vat',
        '/app/companies',
        '/app/finance',
        '/app/calendar',
        '/app/mcp',
      ].map((route) =>
        fetch(`${webBaseUrl}${route}`, { signal: AbortSignal.timeout(15_000) }).catch(
          () => undefined,
        ),
      ),
    );
  } catch (err) {
    killProcessTree(webChild);
    killProcessTree(apiChild);
    throw err;
  }

  return {
    restartApi: spawnFreshApi,
    async stop() {
      killProcessTree(webChild);
      killProcessTree(apiChild);
      await delay(300);
    },
  };
}

function runCommandTimed(args, extraEnv = {}, timeoutMs = 150_000) {
  return new Promise((resolveRun) => {
    const startedAt = performance.now();
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        APP_URL: webBaseUrl,
        API_BASE_URL: apiBaseUrl,
        PAP_BENCH_WEB_PORT: String(webPort),
        PAP_BENCH_API_PORT: String(apiPort),
        E2E_TELEMETRY_DISABLED: '1',
        DO_NOT_TRACK: '1',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      killProcessTree(child);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      activeChildren.delete(child);
      const wallClockMs = Math.round(performance.now() - startedAt);
      resolveRun({
        exitCode: code ?? 1,
        wallClockMs,
        stdout,
        stderr,
      });
    });
  });
}

function computeStats(values) {
  if (values.length === 0) return { count: 0, medianMs: 0, minMs: 0, maxMs: 0, meanMs: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  const meanMs = Math.round(sorted.reduce((acc, v) => acc + v, 0) / sorted.length);
  return {
    count: sorted.length,
    medianMs,
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    meanMs,
    samplesMs: values,
  };
}

function countLoc(filePath) {
  const content = readFileSync(resolve(repoRoot, filePath), 'utf8');
  const allLines = content.split(/\r?\n/);
  const codeLines = allLines.filter((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
  });
  return { totalLines: allLines.length, nonBlankNonCommentLoc: codeLines.length };
}

function extractE2eRunnerDurationMs(report) {
  if (!report?.run) return null;
  if (typeof report.run.durationMs === 'number') return Math.round(report.run.durationMs);
  if (report.run.startedAt && report.run.finishedAt) {
    const diff = Date.parse(report.run.finishedAt) - Date.parse(report.run.startedAt);
    if (Number.isFinite(diff) && diff >= 0) return diff;
  }
  return null;
}

function extractE2eTestsSumMs(report) {
  const results = report?.run?.results;
  if (!Array.isArray(results)) return null;
  return results.reduce((sum, r) => sum + (r?.attempts?.[0]?.durationMs ?? 0), 0);
}

function extractSelectedSteps(report) {
  const selected = report?.run?.results?.find((r) => r.selected);
  return (
    selected?.attempts?.[0]?.steps?.map((s) => ({
      api: s.api,
      label: s.label,
      status: s.status,
      durationMs: s.durationMs,
      cache: s.cache ?? null,
      metrics: s.metrics ?? null,
      error: s.error ?? null,
    })) ?? []
  );
}

async function main() {
  const summary = {
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    ports: { apiPort, webPort },
    locComparison: {
      playwrightSuite: countLoc('test/e2e-benchmark/playwright/accounting-benchmark.spec.ts'),
      e2eDeterministicSuite: countLoc(
        'test/e2e-benchmark/e2e-deterministic/accounting-benchmark.e2e.ts',
      ),
      e2eAgentSuite: countLoc('test/e2e-benchmark/e2e-agent/accounting-agent.e2e.ts'),
    },
    playwrightDeterministic: null,
    e2eDeterministic: null,
    e2eAgent: null,
    splitBrainDiagnostics: null,
  };

  const stack = await startStack();
  try {
    if (mode === 'all' || mode === 'diagnostics') {
      console.log(
        '[Benchmark] Uruchamianie sond diagnostycznych Split-Brain (Playwright vs e2e)...',
      );
      await stack.restartApi();
      const pwDiag = await runCommandTimed([
        'node_modules/@playwright/test/cli.js',
        'test',
        '-c',
        'test/e2e-benchmark/playwright.benchmark.config.ts',
        'test/e2e-benchmark/diagnostics/split-brain-probe.spec.ts',
      ]);
      const pwMatch = pwDiag.stdout.match(/SPLIT_BRAIN_DIAGNOSTICS_JSON:\s*(\{.*\})/);
      const pwParsed = pwMatch ? JSON.parse(pwMatch[1]) : { rawExitCode: pwDiag.exitCode };

      await stack.restartApi();
      const e2eDiag = await runCommandTimed([
        'node_modules/e2e/dist/cli/bin.js',
        'run',
        'diagnostics/split-brain-probe.e2e.ts',
        '--config',
        'test/e2e-benchmark/e2e.benchmark.config.ts',
      ]);
      const e2eReportPath = resolve(repoRoot, 'test/e2e-benchmark/.e2e-out/report.json');
      const e2eReport = existsSync(e2eReportPath)
        ? JSON.parse(readFileSync(e2eReportPath, 'utf8'))
        : null;
      const appLogLines =
        e2eReport?.run?.results?.[0]?.attempts?.[0]?.appLog?.map((l) => l.text) ?? [];
      const combinedOut = `${e2eDiag.stdout}\n${e2eDiag.stderr}\n${appLogLines.join('\n')}`;
      const e2eMatch = combinedOut.match(/SPLIT_BRAIN_DIAGNOSTICS_JSON:\s*(\{.*\})/);

      summary.splitBrainDiagnostics = {
        playwright: {
          exitCode: pwDiag.exitCode,
          wallClockMs: pwDiag.wallClockMs,
          findings: pwParsed,
        },
        e2e: {
          exitCode: e2eDiag.exitCode,
          wallClockMs: e2eDiag.wallClockMs,
          runnerDurationMs: extractE2eRunnerDurationMs(e2eReport),
          findings: e2eMatch ? JSON.parse(e2eMatch[1]) : pwParsed,
        },
      };
    }

    if (mode === 'all' || mode === 'deterministic') {
      const pwRuns = [];
      for (let i = 0; i < deterministicRuns; i += 1) {
        console.log(
          `[Benchmark] Playwright deterministyczny — przebieg ${String(i + 1)}/${String(deterministicRuns)}...`,
        );
        await stack.restartApi();
        const res = await runCommandTimed([
          'node_modules/@playwright/test/cli.js',
          'test',
          '-c',
          'test/e2e-benchmark/playwright.benchmark.config.ts',
          'test/e2e-benchmark/playwright/accounting-benchmark.spec.ts',
        ]);
        const reportPath = resolve(repoRoot, 'test/e2e-benchmark/playwright-results/report.json');
        const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
        pwRuns.push({
          iteration: i + 1,
          exitCode: res.exitCode,
          wallClockMs: res.wallClockMs,
          runnerDurationMs: report?.stats?.duration ? Math.round(report.stats.duration) : null,
          expected: report?.stats?.expected ?? null,
          unexpected: report?.stats?.unexpected ?? null,
        });
      }
      summary.playwrightDeterministic = {
        runs: pwRuns,
        wallClockStats: computeStats(pwRuns.map((r) => r.wallClockMs)),
        runnerDurationStats: computeStats(
          pwRuns.map((r) => r.runnerDurationMs).filter((v) => typeof v === 'number'),
        ),
      };

      const e2eDetRuns = [];
      for (let i = 0; i < deterministicRuns; i += 1) {
        console.log(
          `[Benchmark] e2e deterministyczny — przebieg ${String(i + 1)}/${String(deterministicRuns)}...`,
        );
        await stack.restartApi();
        const res = await runCommandTimed([
          'node_modules/e2e/dist/cli/bin.js',
          'run',
          'e2e-deterministic/accounting-benchmark.e2e.ts',
          '--config',
          'test/e2e-benchmark/e2e.benchmark.config.ts',
          '--reporter',
          'list,markdown',
        ]);
        const reportPath = resolve(repoRoot, 'test/e2e-benchmark/.e2e-out/report.json');
        const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
        e2eDetRuns.push({
          iteration: i + 1,
          exitCode: res.exitCode,
          wallClockMs: res.wallClockMs,
          runnerDurationMs: extractE2eRunnerDurationMs(report),
          testsSumDurationMs: extractE2eTestsSumMs(report),
          summary: report?.run?.summary ?? null,
          usage: report?.run?.usage ?? null,
        });
      }
      summary.e2eDeterministic = {
        runs: e2eDetRuns,
        wallClockStats: computeStats(e2eDetRuns.map((r) => r.wallClockMs)),
        runnerDurationStats: computeStats(
          e2eDetRuns.map((r) => r.runnerDurationMs).filter((v) => typeof v === 'number'),
        ),
      };
    }

    if (mode === 'all' || mode === 'agent') {
      const cacheDir = resolve(repoRoot, 'test/e2e-benchmark/.e2e-out/cache');
      rmSync(cacheDir, { recursive: true, force: true });

      console.log('[Benchmark] e2e Agent AI — przebieg COLD (pusty cache, zapis trace-1)...');
      await stack.restartApi();
      const coldRes = await runCommandTimed(
        [
          'node_modules/e2e/dist/cli/bin.js',
          'run',
          'e2e-agent/accounting-agent.e2e.ts',
          '--config',
          'test/e2e-benchmark/e2e.benchmark.config.ts',
          '--debug',
          '--ai-trace',
        ],
        {},
        120_000,
      );
      const reportPath = resolve(repoRoot, 'test/e2e-benchmark/.e2e-out/report.json');
      const coldReport = existsSync(reportPath)
        ? JSON.parse(readFileSync(reportPath, 'utf8'))
        : null;
      const cacheFiles = existsSync(cacheDir) ? readdirSync(cacheDir) : [];
      const coldResult = {
        exitCode: coldRes.exitCode,
        wallClockMs: coldRes.wallClockMs,
        runnerDurationMs: extractE2eRunnerDurationMs(coldReport),
        summary: coldReport?.run?.summary ?? null,
        usage: coldReport?.run?.usage ?? null,
        steps: extractSelectedSteps(coldReport),
        cacheFilesWritten: cacheFiles,
        stderrTail: coldRes.stderr.slice(-1200),
      };

      console.log('[Benchmark] e2e Agent AI — przebieg WARM CACHE (odtwarzanie z .e2e/cache)...');
      await stack.restartApi();
      const warmRes = await runCommandTimed(
        [
          'node_modules/e2e/dist/cli/bin.js',
          'run',
          'e2e-agent/accounting-agent.e2e.ts',
          '--config',
          'test/e2e-benchmark/e2e.benchmark.config.ts',
          '--debug',
        ],
        {},
        120_000,
      );
      const warmReport = existsSync(reportPath)
        ? JSON.parse(readFileSync(reportPath, 'utf8'))
        : null;
      const warmResult = {
        exitCode: warmRes.exitCode,
        wallClockMs: warmRes.wallClockMs,
        runnerDurationMs: extractE2eRunnerDurationMs(warmReport),
        summary: warmReport?.run?.summary ?? null,
        usage: warmReport?.run?.usage ?? null,
        steps: extractSelectedSteps(warmReport),
      };

      summary.e2eAgent = {
        coldRun: coldResult,
        warmCachedRun: warmResult,
      };

      console.log('[Benchmark] e2e Agent AI — przebieg NO-CACHE (--no-cache)...');
      await stack.restartApi();
      const noCacheRes = await runCommandTimed(
        [
          'node_modules/e2e/dist/cli/bin.js',
          'run',
          'e2e-agent/accounting-agent.e2e.ts',
          '--config',
          'test/e2e-benchmark/e2e.benchmark.config.ts',
          '--no-cache',
          '--debug',
        ],
        {},
        120_000,
      );
      const noCacheReport = existsSync(reportPath)
        ? JSON.parse(readFileSync(reportPath, 'utf8'))
        : null;
      summary.e2eAgent.noCacheRun = {
        exitCode: noCacheRes.exitCode,
        wallClockMs: noCacheRes.wallClockMs,
        runnerDurationMs: extractE2eRunnerDurationMs(noCacheReport),
        summary: noCacheReport?.run?.summary ?? null,
        usage: noCacheReport?.run?.usage ?? null,
        steps: extractSelectedSteps(noCacheReport),
      };
    }
  } finally {
    await stack.stop();
    freeDedicatedBenchmarkPorts();
  }

  const outDir = resolve(repoRoot, 'test/e2e-benchmark/results');
  mkdirSync(outDir, { recursive: true });
  const outFile = resolve(outDir, `benchmark-${mode}.json`);
  writeFileSync(outFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`[Benchmark] Zapisano wynik do ${outFile}`);
}

main()
  .then(() => {
    freeDedicatedBenchmarkPorts();
    process.exit(0);
  })
  .catch((err) => {
    console.error('[Benchmark] Błąd krytyczny:', err);
    freeDedicatedBenchmarkPorts();
    process.exit(1);
  });
