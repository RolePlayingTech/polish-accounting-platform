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
  validateIndependentReviewEvidence,
  validateOwnerApprovalEvidence,
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

  it('rejects NOT RUN, FAIL, empty changedFiles, missing cleanup, unverified review env flags, or stale SHA', () => {
    const shaA = '755d33471e993640ead855d7ccb706a842ecfecb';
    const treeA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const shaB = '1111111111111111111111111111111111111111';

    const validIndependentReview = {
      status: 'APPROVED',
      reviewerId: 'independent-qa-subagent-9932e5a2',
      reviewedHeadSha: shaA,
      reviewedTreeSha: treeA,
      reviewedAt: '2026-11-09T08:00:00Z',
      unresolvedFindingsCount: 0,
      summary: 'Verified multi-instance consistency, rollback isolation, and QA governance gate.',
      evidenceUri: 'https://github.com/RolePlayingTech/polish-accounting-platform/pull/90#issuecomment-1',
    };

    const validOwnerApproval = {
      status: 'APPROVED',
      approverId: 'RolePlayingTech',
      scope: 'internal_merge',
      approvedHeadSha: shaA,
      approvedTreeSha: treeA,
      approvedAt: '2026-11-09T08:05:00Z',
      evidenceUri: 'https://github.com/RolePlayingTech/polish-accounting-platform/pull/91#issuecomment-2',
    };

    const emptyFilesReport = {
      headSha: shaA,
      treeSha: treeA,
      baseSha: shaA,
      changedFiles: [],
      cleanupVerified: null,
      independentReview: validIndependentReview,
      checks: [
        { id: 'git_preflight_and_secret_scan', status: 'PASS' },
        { id: 'architecture_boundaries', status: 'PASS' },
      ],
    };
    const emptyValidation = validateEvidenceReport(emptyFilesReport, shaA);
    expect(emptyValidation.valid).toBe(false);
    expect(emptyValidation.technicalChecksValid).toBe(false);
    expect(emptyValidation.recommendedExitCode).toBe(1);
    expect(emptyValidation.errors.join(' ')).toContain('changedFiles');

    const incompleteReport = {
      headSha: shaA,
      treeSha: treeA,
      baseSha: shaA,
      authorId: 'implementation-lead',
      changedFiles: ['apps/api/src/runtime/postgres-workspace-persistence.ts'],
      cleanupVerified: true,
      independentReview: validIndependentReview,
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
    expect(notRunValidation.mergeReady).toBe(false);
    expect(notRunValidation.gateStatus).toBe('TECHNICAL_FAIL');
    expect(notRunValidation.recommendedExitCode).toBe(1);
    expect(notRunValidation.mergeVerdict).toBe('NO-GO (KEEP DRAFT)');
    expect(notRunValidation.errors.join(' ')).toContain('hetzner_pg18_api_integration');

    const completeReport = {
      ...incompleteReport,
      checks: incompleteReport.checks.map((c) => ({ ...c, status: 'PASS', durationSec: 1.2 })),
    };

    // 1. Bare string independentReviewStatus: 'APPROVED' WITHOUT structured independentReview object MUST fail governance with exit code 2
    const unverifiedEnvFlagReport = {
      ...completeReport,
      independentReview: null,
      independentReviewStatus: 'APPROVED',
    };
    const unverifiedEnvValidation = validateEvidenceReport(unverifiedEnvFlagReport, shaA);
    expect(unverifiedEnvValidation.technicalChecksValid).toBe(true);
    expect(unverifiedEnvValidation.governanceValid).toBe(false);
    expect(unverifiedEnvValidation.valid).toBe(false);
    expect(unverifiedEnvValidation.mergeReady).toBe(false);
    expect(unverifiedEnvValidation.gateStatus).toBe('TECHNICAL_PASS_PENDING_GOVERNANCE');
    expect(unverifiedEnvValidation.recommendedExitCode).toBe(2);
    expect(unverifiedEnvValidation.mergeVerdict).toBe(
      'NO-GO (TECHNICAL PASS — PENDING GOVERNANCE APPROVAL)',
    );

    // 2. Self-review (reviewerId === authorId), unresolved findings, or mismatched SHA/treeSha MUST fail governance
    expect(
      validateIndependentReviewEvidence(
        { ...validIndependentReview, reviewerId: 'implementation-lead' },
        { expectedHeadSha: shaA, expectedTreeSha: treeA, authorId: 'implementation-lead' },
      ).valid,
    ).toBe(false);
    expect(
      validateIndependentReviewEvidence(
        { ...validIndependentReview, unresolvedFindingsCount: 1 },
        { expectedHeadSha: shaA, expectedTreeSha: treeA },
      ).valid,
    ).toBe(false);
    expect(
      validateIndependentReviewEvidence(
        { ...validIndependentReview, reviewedHeadSha: shaB, reviewedTreeSha: undefined },
        { expectedHeadSha: shaA, expectedTreeSha: treeA },
      ).valid,
    ).toBe(false);

    // 3. Rebased commit preserving identical git treeSha remains valid
    expect(
      validateIndependentReviewEvidence(
        { ...validIndependentReview, reviewedHeadSha: shaB, reviewedTreeSha: treeA },
        { expectedHeadSha: shaA, expectedTreeSha: treeA },
      ).valid,
    ).toBe(true);

    // 4. Full pass with verified structured independentReview -> READY FOR MERGE (exit code 0)
    const passValidation = validateEvidenceReport(completeReport, shaA);
    expect(passValidation.valid).toBe(true);
    expect(passValidation.technicalChecksValid).toBe(true);
    expect(passValidation.governanceValid).toBe(true);
    expect(passValidation.mergeReady).toBe(true);
    expect(passValidation.gateStatus).toBe('READY_FOR_MERGE');
    expect(passValidation.recommendedExitCode).toBe(0);
    expect(passValidation.mergeVerdict).toBe('READY FOR MERGE');

    // 5. Migration change without structured ownerApproval (even with bare ownerApprovalStatus: 'APPROVED') -> exit code 2
    const migrationReportWithoutOwner = {
      ...completeReport,
      changedFiles: ['packages/db/drizzle/0009_company-nip-unique.sql'],
      ownerApprovalStatus: 'APPROVED',
      ownerApproval: null,
    };
    const ownerValidation = validateEvidenceReport(migrationReportWithoutOwner, shaA);
    expect(ownerValidation.valid).toBe(false);
    expect(ownerValidation.technicalChecksValid).toBe(true);
    expect(ownerValidation.governanceValid).toBe(false);
    expect(ownerValidation.mergeReady).toBe(false);
    expect(ownerValidation.gateStatus).toBe('TECHNICAL_PASS_PENDING_GOVERNANCE');
    expect(ownerValidation.recommendedExitCode).toBe(2);
    expect(ownerValidation.errors.join(' ')).toContain('ownerApproval');

    // 6. Migration change with both structured independentReview and ownerApproval -> exit code 0
    expect(
      validateOwnerApprovalEvidence(
        { ...validOwnerApproval, scope: 'staging_deploy' },
        { expectedHeadSha: shaA, expectedTreeSha: treeA },
      ).valid,
    ).toBe(false);
    expect(
      validateOwnerApprovalEvidence(validOwnerApproval, {
        expectedHeadSha: shaA,
        expectedTreeSha: treeA,
      }).valid,
    ).toBe(true);
    const migrationApprovedValidation = validateEvidenceReport(
      {
        ...migrationReportWithoutOwner,
        ownerApproval: validOwnerApproval,
      },
      shaA,
    );
    expect(migrationApprovedValidation.valid).toBe(true);
    expect(migrationApprovedValidation.mergeReady).toBe(true);
    expect(migrationApprovedValidation.recommendedExitCode).toBe(0);

    const staleValidation = validateEvidenceReport(completeReport, shaB);
    expect(staleValidation.valid).toBe(false);
    expect(staleValidation.technicalChecksValid).toBe(false);
    expect(staleValidation.recommendedExitCode).toBe(1);
    expect(staleValidation.errors.join(' ')).toContain('Niezgodność SHA');

    const md = formatEvidenceReportMarkdown(completeReport);
    expect(md).toContain('READY FOR MERGE');
    expect(md).toContain('independent-qa-subagent-9932e5a2');
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
    expect(content).toContain('-p MemoryHigh=768M');
    expect(content).toContain('-p MemoryMax=1024M');
    expect(content).not.toContain('PAP_INDEPENDENT_REVIEW_STATUS');
    expect(content).toContain('--review-evidence-json');
    expect(content).toContain('pnpm --filter @pap/db test:integration');
    expect(content).toContain('pnpm --filter @pap/api test:integration');
    expect(content).toContain('pnpm --filter @pap/api test:adversarial');

    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const syntax = spawnSync(bashBin!, ['-n', toPosixPath(qaRunnerPath)], { encoding: 'utf8' });
    expect(syntax.status, syntax.stderr).toBe(0);
  });
});
