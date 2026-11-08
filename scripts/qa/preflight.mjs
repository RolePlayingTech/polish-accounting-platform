#!/usr/bin/env node
// Deterministyczny skrypt preflight QA (Issue #85):
// 1. Weryfikuje higienę gałęzi Git (zakaz bezpośredniej pracy na main i gałęzi historycznych).
// 2. Sprawdza aktualność bazy względem origin/main (git merge-base) oraz git diff --check.
// 3. Skanuje zmienione pliki pod kątem przypadkowych sekretów i niezamaskowanych danych Hetznera.
// 4. Potwierdza, że automatyczne wyzwalacze GitHub Actions pozostają wyłączone (ADR-006).
// 5. Klasyfikuje zmienione pliki wg macierzy ryzyka i wypisuje obowiązkowe komendy testowe.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyChangedFiles,
  FORBIDDEN_BRANCH_NAMES,
  scanTextForAccidentalSecretsAndLeaks,
  validateCiWorkflowRemainsDisabled,
  VERIFICATION_MATRIX_VERSION,
} from './verification-matrix.mjs';

function runGit(args, cwd = process.cwd()) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return {
    status: res.status ?? 1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  };
}

function parseArgs(argv) {
  const options = {
    baseRef: 'origin/main',
    json: false,
    allowMainInspect: false,
    requireCleanWorktree: false,
    filesOverride: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base' && i + 1 < argv.length) {
      options.baseRef = argv[i + 1];
      i += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--allow-main-inspect') {
      options.allowMainInspect = true;
    } else if (arg === '--require-clean') {
      options.requireCleanWorktree = true;
    } else if (arg === '--files' && i + 1 < argv.length) {
      options.filesOverride = argv[i + 1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      i += 1;
    } else if (arg === '-h' || arg === '--help') {
      console.log(
        [
          'Użycie: node scripts/qa/preflight.mjs [opcje]',
          '  --base <ref>          Gałąź bazowa do porównania (domyślnie: origin/main)',
          '  --require-clean       Wymagaj czystego git status --porcelain',
          '  --allow-main-inspect  Pozwól na odczytowy preflight na gałęzi main',
          '  --files <a,b,c>       Jawna lista plików do klasyfikacji',
          '  --json                Wypisz wynik w formacie JSON',
        ].join('\n'),
      );
      process.exit(0);
    }
  }
  return options;
}

export function runPreflight(options = {}, repoRoot = process.cwd()) {
  const baseRef = options.baseRef ?? 'origin/main';
  const errors = [];
  const warnings = [];

  const headRes = runGit(['rev-parse', 'HEAD'], repoRoot);
  const headSha = headRes.status === 0 ? headRes.stdout : 'unknown';

  const branchRes = runGit([' symbolic-ref', '--short', '-q', 'HEAD'], repoRoot);
  const currentBranch =
    branchRes.status === 0
      ? branchRes.stdout
      : runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot).stdout;

  if (!options.allowMainInspect && FORBIDDEN_BRANCH_NAMES.includes(currentBranch)) {
    errors.push(
      `Niedozwolona gałąź robocza '${currentBranch}'. Utwórz świeżą gałąź zadaniową z aktualnego origin/main.`,
    );
  }

  const baseRes = runGit(['rev-parse', baseRef], repoRoot);
  const baseSha = baseRes.status === 0 ? baseRes.stdout : null;
  let mergeBaseSha = null;

  if (!baseSha) {
    warnings.push(`Nie udało się rozwiązać referencji bazowej '${baseRef}'.`);
  } else {
    const mbRes = runGit(['merge-base', 'HEAD', baseSha], repoRoot);
    if (mbRes.status === 0) {
      mergeBaseSha = mbRes.stdout;
      if (mergeBaseSha !== baseSha) {
        warnings.push(
          `Gałąź nie zawiera najnowszego '${baseRef}' (merge-base=${mergeBaseSha.slice(0, 7)}, ${baseRef}=${baseSha.slice(0, 7)}). Wykonaj rebase przed merge.`,
        );
      }
    }
  }

  const statusRes = runGit(['status', '--porcelain'], repoRoot);
  const dirtyLines = statusRes.stdout
    ? statusRes.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0)
    : [];
  if (options.requireCleanWorktree && dirtyLines.length > 0) {
    errors.push(
      `Drzewo robocze zawiera niezacommitowane zmiany (${dirtyLines.length} plików) przy aktywnym --require-clean.`,
    );
  }

  let changedFiles = [];
  if (Array.isArray(options.filesOverride)) {
    changedFiles = options.filesOverride;
  } else {
    const diffTarget = mergeBaseSha ?? baseSha ?? 'HEAD';
    const committedDiff = runGit(['diff', '--name-only', `${diffTarget}...HEAD`], repoRoot);
    const workingDiff = runGit(['diff', '--name-only', 'HEAD'], repoRoot);
    const untrackedDiff = runGit(['ls-files', '--others', '--exclude-standard'], repoRoot);

    const combined = [
      ...(committedDiff.stdout ? committedDiff.stdout.split(/\r?\n/) : []),
      ...(workingDiff.stdout ? workingDiff.stdout.split(/\r?\n/) : []),
      ...(untrackedDiff.stdout ? untrackedDiff.stdout.split(/\r?\n/) : []),
    ];
    changedFiles = Array.from(new Set(combined.map((f) => f.trim()).filter(Boolean)));
  }

  // Kontrola git diff --check
  const diffCheckTarget = mergeBaseSha ?? 'HEAD';
  const diffCheckRes = runGit(['diff', '--check', diffCheckTarget], repoRoot);
  if (diffCheckRes.status !== 0) {
    errors.push(
      `git diff --check wykrył błędy białych znaków lub znaczniki konfliktu:\n${diffCheckRes.stdout}`,
    );
  }

  // Kontrola wyłączenia GitHub Actions (ADR-006)
  const ciWorkflowPath = resolve(repoRoot, '.github/workflows/ci.yml');
  if (existsSync(ciWorkflowPath)) {
    const ciCheck = validateCiWorkflowRemainsDisabled(readFileSync(ciWorkflowPath, 'utf8'));
    if (!ciCheck.valid) {
      errors.push(ciCheck.reason);
    }
  }

  // Skan przypadkowych sekretów i wycieków w zmienionych plikach
  const secretFindings = [];
  for (const relFile of changedFiles) {
    const absPath = resolve(repoRoot, relFile);
    if (!existsSync(absPath)) {
      continue;
    }
    try {
      const content = readFileSync(absPath, 'utf8');
      const fileFindings = scanTextForAccidentalSecretsAndLeaks(relFile, content);
      secretFindings.push(...fileFindings);
    } catch {
      // Plik binarny lub katalog — pomijamy odczyt UTF-8
    }
  }

  for (const finding of secretFindings) {
    errors.push(`[SECRET/LEAK] ${finding.filePath}: ${finding.message} (${finding.ruleId})`);
  }

  const classification = classifyChangedFiles(changedFiles);

  return {
    ok: errors.length === 0,
    matrixVersion: VERIFICATION_MATRIX_VERSION,
    branch: currentBranch,
    headSha,
    baseRef,
    baseSha,
    mergeBaseSha,
    dirtyWorktreeFiles: dirtyLines.length,
    changedFiles,
    classification,
    errors,
    warnings,
  };
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) ===
    resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

if (isMainModule || process.argv[1]?.endsWith('preflight.mjs')) {
  const opts = parseArgs(process.argv.slice(2));
  const result = runPreflight(opts);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[pap-qa-preflight] Wersja macierzy: ${result.matrixVersion}`);
    console.log(`[pap-qa-preflight] Gałąź: ${result.branch} (HEAD: ${result.headSha})`);
    console.log(
      `[pap-qa-preflight] Baza (${result.baseRef}): ${result.baseSha ?? 'brak'} (merge-base: ${result.mergeBaseSha ?? 'brak'})`,
    );
    console.log(
      `[pap-qa-preflight] Zmienione pliki (${result.changedFiles.length}): ${result.changedFiles.join(', ') || '(brak)'}`,
    );
    console.log(
      `[pap-qa-preflight] Powierzchnie ryzyka: ${result.classification.surfaces.join(', ')} (poziom: ${result.classification.riskLevel})`,
    );
    console.log(
      `[pap-qa-preflight] Wymagane izolowane CI Hetzner PG18 (@pap/db + @pap/api): ${result.classification.requiresBothDbAndApiIntegration ? 'TAK' : 'NIE'}`,
    );
    console.log(
      `[pap-qa-preflight] Wymagany niezależny review: ${result.classification.requiresIndependentReview ? 'TAK' : 'NIE'}`,
    );
    console.log('\nObowiązkowe kontrole dla tego zakresu:');
    for (const check of result.classification.requiredChecks) {
      console.log(`  - [${check.environment}] ${check.id}: ${check.command}`);
    }
    if (result.warnings.length > 0) {
      console.log('\nOstrzeżenia:');
      for (const w of result.warnings) {
        console.log(`  ! ${w}`);
      }
    }
    if (result.errors.length > 0) {
      console.error('\nBłędy blokujące preflight:');
      for (const err of result.errors) {
        console.error(`  X ${err}`);
      }
    }
  }

  process.exit(result.ok ? 0 : 1);
}
