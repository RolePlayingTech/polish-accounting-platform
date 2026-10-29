import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const scriptPath = resolve(repoRoot, 'scripts/hetzner/with-ephemeral-pg18.sh');
const docPath = resolve(repoRoot, 'docs/HETZNER_POSTGRES_TEST_ENVIRONMENT.md');
const ciWorkflowPath = resolve(repoRoot, '.github/workflows/ci.yml');

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

describe('Hetzner ephemeral PostgreSQL 18.6 runner security contract', () => {
  const scriptContent = readFileSync(scriptPath, 'utf8');
  const ciContent = readFileSync(ciWorkflowPath, 'utf8');
  const docContent = readFileSync(docPath, 'utf8');

  it('uses LF line endings, strict shell flags, and exact SHA-256 image digest matching CI', () => {
    expect(scriptContent.includes('\r\n')).toBe(false);
    expect(scriptContent.startsWith('#!/usr/bin/env bash\n')).toBe(true);
    expect(scriptContent).toContain('set -euo pipefail');
    expect(scriptContent).toContain('set +x');
    expect(scriptContent).toContain('umask 077');

    const ciImageMatch = ciContent.match(/image:\s*(postgres:18\.6-alpine@sha256:[a-f0-9]{64})/);
    expect(ciImageMatch).not.toBeNull();
    const pinnedImage = ciImageMatch![1];

    expect(scriptContent).toContain(`readonly PG_IMAGE="${pinnedImage}"`);
    expect(docContent).toContain(pinnedImage);
  });

  it('enforces documented RAM, CPU, loopback, PG18 volume, secret file, and cleanup invariants', () => {
    expect(scriptContent).toContain('--publish "127.0.0.1:${PORT}:5432"');
    expect(scriptContent).toContain('--memory=384m');
    expect(scriptContent).toContain('--memory-swap=384m');
    expect(scriptContent).toContain('--cpus=0.50');
    expect(scriptContent).toContain('--pids-limit=128');
    expect(scriptContent).toContain('--security-opt no-new-privileges:true');
    // PostgreSQL 18 definiuje VOLUME /var/lib/postgresql (nie /var/lib/postgresql/data)
    expect(scriptContent).toContain('-v "${RUN_DIR}/pgdata:/var/lib/postgresql"');
    expect(scriptContent).not.toContain(':/var/lib/postgresql/data');
    expect(scriptContent).toContain('POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass');
    expect(scriptContent).toContain('-c log_statement=none');
    expect(scriptContent).toContain('trap cleanup EXIT INT TERM');
  });

  it('keeps infrastructure documentation redacted from raw volume IDs and host IPv4', () => {
    expect(docContent).not.toMatch(/HC_Volume_[0-9]+/);
    expect(docContent).not.toMatch(/\b159\.69\.[0-9]+\.[0-9]+\b/);
    expect(docContent).toContain('--mode fixture');
    expect(docContent).toContain('--mode strict-migrator');
  });

  it('rejects missing approval, staging port 5432, protected staging paths, and production env vars (fail-closed)', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();

    const posixScript = toPosixPath(scriptPath);
    const syntaxCheck = spawnSync(bashBin!, ['-n', posixScript], { encoding: 'utf8' });
    expect(syntaxCheck.status).toBe(0);

    const helpRun = spawnSync(bashBin!, [posixScript, '--help'], { encoding: 'utf8' });
    expect(helpRun.status).toBe(0);
    expect(helpRun.stdout).toContain('--preflight-only');

    const tempDir = mkdtempSync(resolve(tmpdir(), 'pap-ephemeral-test-'));
    try {
      const posixTempDir = toPosixPath(tempDir);
      const baseEnv = {
        ...process.env,
        NODE_ENV: 'test',
        PAP_DATABASE_ENV: undefined,
        PAP_ENV: undefined,
        PAP_ALLOW_HETZNER_EPHEMERAL_PG: undefined,
      };

      // 1. Brak potwierdzonej zgody PAP_ALLOW_HETZNER_EPHEMERAL_PG=1
      const noApproval = spawnSync(
        bashBin!,
        [posixScript, '--work-root', posixTempDir, '--', 'true'],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(noApproval.status).toBe(2);
      expect(noApproval.stderr).toContain('PAP_ALLOW_HETZNER_EPHEMERAL_PG=1');

      // 2. Próba użycia portu 5432 zarezerwowanego dla pap_staging
      const stagingPort = spawnSync(bashBin!, [posixScript, '--preflight-only', '--port', '5432'], {
        encoding: 'utf8',
        env: baseEnv,
      });
      expect(stagingPort.status).toBe(2);
      expect(stagingPort.stderr).toContain('5432');

      // 3. Próba użycia chronionych ścieżek stagingu lub innych usług
      for (const forbidden of [
        '/var/www/pap-staging',
        '/var/www/pap-staging/releases',
        '/mnt/HC_Volume_redacted/pap-staging/postgres',
        '/etc/pap',
        '/var/www/mumro',
      ]) {
        const forbiddenPathRun = spawnSync(
          bashBin!,
          [posixScript, '--preflight-only', '--work-root', forbidden],
          {
            encoding: 'utf8',
            env: { ...baseEnv, PAP_ALLOW_HETZNER_EPHEMERAL_PG: '1' },
          },
        );
        expect(forbiddenPathRun.status).toBe(2);
      }

      // 4. Wykrycie zmiennych produkcyjnych / stagingowych w środowisku
      const prodEnvRun = spawnSync(bashBin!, [posixScript, '--preflight-only'], {
        encoding: 'utf8',
        env: { ...baseEnv, NODE_ENV: 'production' },
      });
      expect(prodEnvRun.status).toBe(2);

      const stagingDbEnvRun = spawnSync(bashBin!, [posixScript, '--preflight-only'], {
        encoding: 'utf8',
        env: { ...baseEnv, PAP_DATABASE_ENV: 'staging' },
      });
      expect(stagingDbEnvRun.status).toBe(2);

      // 5. Niepoprawny tryb i przekroczony timeout
      const badModeRun = spawnSync(
        bashBin!,
        [posixScript, '--preflight-only', '--mode', 'superuser'],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(badModeRun.status).toBe(2);

      const badTimeoutRun = spawnSync(
        bashBin!,
        [posixScript, '--preflight-only', '--timeout', '3600'],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(badTimeoutRun.status).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
