import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyChangedFiles,
  formatEvidenceReportMarkdown,
  scanTextForAccidentalSecretsAndLeaks,
  validateCiWorkflowRemainsDisabled,
  validateEvidenceReport,
  VERIFICATION_MATRIX_VERSION,
} from '../scripts/qa/verification-matrix.mjs';

const repoRoot = process.cwd();
const qaRunnerPath = resolve(repoRoot, 'scripts/qa/run-hetzner-qa.sh');

function resolveBashExecutable(): string | null {
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
    if (existsSync(gitBash)) {
      return gitBash;
    }
    return null;
  }
  const probe = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'bash' : null;
}

function toPosixPath(filePath: string): string {
  if (process.platform !== 'win32') {
    return filePath;
  }
  return filePath
    .replace(/^([A-Za-z]):\\/, (_, drive: string) => `/${drive.toLowerCase()}/`)
    .replaceAll('\\', '/');
}

describe('Permanent QA Gate & Risk-Based Verification Matrix (#85)', () => {
  it('classifies docs-only changes as low risk without requiring PG18 or E2E', () => {
    const result = classifyChangedFiles(['docs/qa/verification-matrix.md', 'README.md']);

    expect(result.matrixVersion).toBe(VERIFICATION_MATRIX_VERSION);
    expect(result.surfaces).toEqual(['docs_dormant']);
    expect(result.riskLevel).toBe('low');
    expect(result.requiresHetznerPgIntegration).toBe(false);
    expect(result.requiresBothDbAndApiIntegration).toBe(false);
    expect(result.requiresAdversarialSuite).toBe(false);
    expect(result.requiresIndependentReview).toBe(false);
    expect(result.requiredChecks.map((c: { id: string }) => c.id)).toEqual([
      'git_preflight_and_secret_scan',
      'architecture_boundaries',
    ]);
  });

  it('requires BOTH @pap/db and @pap/api integration tests plus adversarial suite when any runtime, API, application, or DB files change', () => {
    const result = classifyChangedFiles([
      'apps/api/src/runtime/postgres-workspace-persistence.ts',
      'packages/db/src/transaction-primitives.ts',
    ]);

    expect(result.surfaces).toContain('db_transaction_provisioning');
    expect(result.surfaces).toContain('oidc_rls_tenant');
    expect(result.riskLevel).toBe('high');
    expect(result.requiresHetznerPgIntegration).toBe(true);
    expect(result.requiresBothDbAndApiIntegration).toBe(true);
    expect(result.requiresAdversarialSuite).toBe(true);
    expect(result.requiresIndependentReview).toBe(true);

    const commands = result.requiredChecks.map((c: { command: string }) => c.command);
    expect(commands).toContain('pnpm --filter @pap/db test:integration');
    expect(commands).toContain('pnpm --filter @pap/api test:integration');
    expect(commands).toContain('pnpm --filter @pap/api test:adversarial');

    // Weryfikacja P1-3: dowolny plik w apps/api/src/** lub packages/application/src/** również wpada w high-risk
    const apiMainResult = classifyChangedFiles(['apps/api/src/main.ts']);
    expect(apiMainResult.riskLevel).toBe('high');
    expect(apiMainResult.requiresBothDbAndApiIntegration).toBe(true);
    expect(apiMainResult.requiresAdversarialSuite).toBe(true);
    expect(apiMainResult.requiresIndependentReview).toBe(true);
  });

  it('flags SQL migrations and governance files as critical_governance requiring owner approval', () => {
    const migrationResult = classifyChangedFiles([
      'packages/db/drizzle/0009_company-nip-unique.sql',
    ]);
    expect(migrationResult.riskLevel).toBe('critical_governance');
    expect(migrationResult.touchesMigrations).toBe(true);
    expect(migrationResult.requiresOwnerApproval).toBe(true);
    expect(migrationResult.requiresBothDbAndApiIntegration).toBe(true);

    const govResult = classifyChangedFiles(['AGENTS.md']);
    expect(govResult.riskLevel).toBe('critical_governance');
    expect(govResult.touchesGovernanceOrInfra).toBe(true);
    expect(govResult.requiresOwnerApproval).toBe(true);
  });

  it('rejects NOT RUN, FAIL, empty changedFiles, missing cleanup, missing independent/owner review, or stale SHA', () => {
    const shaA = '755d33471e993640ead855d7ccb706a842ecfecb';
    const shaB = '1111111111111111111111111111111111111111';

    const emptyFilesReport = {
      headSha: shaA,
      baseSha: shaA,
      changedFiles: [],
      cleanupVerified: null,
      independentReviewStatus: 'APPROVED',
      checks: [
        { id: 'git_preflight_and_secret_scan', status: 'PASS' },
        { id: 'architecture_boundaries', status: 'PASS' },
      ],
    };
    const emptyValidation = validateEvidenceReport(emptyFilesReport, shaA);
    expect(emptyValidation.valid).toBe(false);
    expect(emptyValidation.technicalChecksValid).toBe(false);
    expect(emptyValidation.errors.join(' ')).toContain('changedFiles');

    const incompleteReport = {
      headSha: shaA,
      baseSha: shaA,
      changedFiles: ['apps/api/src/runtime/postgres-workspace-persistence.ts'],
      cleanupVerified: true,
      independentReviewStatus: 'APPROVED',
      checks: [
        { id: 'git_preflight_and_secret_scan', status: 'PASS' },
        { id: 'architecture_boundaries', status: 'PASS' },
        { id: 'typecheck_and_lint', status: 'PASS' },
        { id: 'unit_tests', status: 'PASS' },
        { id: 'hetzner_pg18_db_integration', status: 'PASS' },
        { id: 'hetzner_pg18_api_integration', status: 'NOT RUN' },
        { id: 'hetzner_pg18_adversarial_regressions', status: 'PASS' },
      ],
    };

    const notRunValidation = validateEvidenceReport(incompleteReport, shaA);
    expect(notRunValidation.valid).toBe(false);
    expect(notRunValidation.technicalChecksValid).toBe(false);
    expect(notRunValidation.mergeVerdict).toBe('NO-GO (KEEP DRAFT)');
    expect(notRunValidation.errors.join(' ')).toContain('hetzner_pg18_api_integration');

    const completeReport = {
      ...incompleteReport,
      checks: incompleteReport.checks.map((c) => ({ ...c, status: 'PASS', durationSec: 1.2 })),
    };

    const passValidation = validateEvidenceReport(completeReport, shaA);
    expect(passValidation.valid).toBe(true);
    expect(passValidation.technicalChecksValid).toBe(true);
    expect(passValidation.mergeVerdict).toBe('READY FOR MERGE');

    const migrationReportWithoutOwner = {
      ...completeReport,
      changedFiles: ['packages/db/drizzle/0009_company-nip-unique.sql'],
      ownerApprovalStatus: 'PENDING',
    };
    const ownerValidation = validateEvidenceReport(migrationReportWithoutOwner, shaA);
    expect(ownerValidation.valid).toBe(false);
    expect(ownerValidation.technicalChecksValid).toBe(true);
    expect(ownerValidation.errors.join(' ')).toContain('zgody właściciela');

    const staleValidation = validateEvidenceReport(completeReport, shaB);
    expect(staleValidation.valid).toBe(false);
    expect(staleValidation.technicalChecksValid).toBe(false);
    expect(staleValidation.errors.join(' ')).toContain('Niezgodność SHA');

    const md = formatEvidenceReportMarkdown(completeReport);
    expect(md).toContain('READY FOR MERGE');
    expect(md).toContain('hetzner_pg18_db_integration');
    expect(md).toContain('hetzner_pg18_api_integration');
  });

  it('detects accidental secrets and unredacted Hetzner identifiers', () => {
    const clean = scanTextForAccidentalSecretsAndLeaks(
      'docs/example.md',
      'Katalog /mnt/HC_Volume_<ID>/pap-ci-ephemeral jest bezpieczny.',
    );
    expect(clean).toEqual([]);

    const leaked = scanTextForAccidentalSecretsAndLeaks(
      'docs/example.md',
      [
        'Wolumen /mnt/' + 'HC_Volume_105684829/pap-ci-ephemeral',
        'IP 159.69.' + '42.19',
        'Token ghp_' + '1234567890abcdefghijklmnopqrstuv',
        ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      ].join('\n'),
    );
    expect(leaked.map((f: { ruleId: string }) => f.ruleId)).toEqual([
      'private_key_block',
      'github_or_mumro_token',
      'unredacted_hetzner_volume_id',
      'unredacted_hetzner_ip',
    ]);
  });

  it('verifies GitHub Actions workflow remains disabled and reject re-enabled triggers', () => {
    const actualCiYaml = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(validateCiWorkflowRemainsDisabled(actualCiYaml)).toEqual({ valid: true });

    const reEnabledYaml = 'name: CI\non:\n  push:\n    branches: [main]\n';
    const check = validateCiWorkflowRemainsDisabled(reEnabledYaml);
    expect(check.valid).toBe(false);
    expect(check.reason).toContain('push:');
  });

  it('enforces LF line endings, cgroup limits, and strict bash syntax on scripts/qa/run-hetzner-qa.sh', () => {
    const content = readFileSync(qaRunnerPath, 'utf8');
    expect(content.includes('\r\n')).toBe(false);
    expect(content.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(content).toContain('set -euo pipefail');
    expect(content).toContain('set +x');
    expect(content).toContain('umask 077');
    expect(content).toContain('run_bounded_host_cmd');
    expect(content).toContain('-p MemoryMax=768M');
    expect(content).toContain('pnpm --filter @pap/db test:integration');
    expect(content).toContain('pnpm --filter @pap/api test:integration');
    expect(content).toContain('pnpm --filter @pap/api test:adversarial');

    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const syntax = spawnSync(bashBin!, ['-n', toPosixPath(qaRunnerPath)], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
  });
});
