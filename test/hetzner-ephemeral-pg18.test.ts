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

  it('enforces documented RAM, CPU, loopback, PG18 volume, PAP pnpm PATH, secret file, and cleanup invariants', () => {
    expect(scriptContent).toContain('--publish "127.0.0.1:${PORT}:5432"');
    expect(scriptContent).toContain('--memory=384m');
    expect(scriptContent).toContain('--memory-swap=384m');
    expect(scriptContent).toContain('--cpus=0.50');
    expect(scriptContent).toContain('--pids-limit=128');
    expect(scriptContent).toContain('--cap-drop=NET_RAW');
    expect(scriptContent).toContain('--security-opt no-new-privileges:true');
    // PostgreSQL 18 definiuje VOLUME /var/lib/postgresql (nie /var/lib/postgresql/data)
    expect(scriptContent).toContain('-v "${RUN_DIR}/pgdata:/var/lib/postgresql"');
    expect(scriptContent).not.toContain(':/var/lib/postgresql/data');
    expect(scriptContent).toContain('POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass');
    expect(scriptContent).toContain('-c log_statement=none');
    expect(scriptContent).toContain('host all postgres 0.0.0.0/0 reject');
    expect(scriptContent).toContain('export PATH="/opt/pap-runtime/pnpm:${PATH}"');
    expect(scriptContent).toContain('export COREPACK_DEFAULT_TO_LATEST=0');
    expect(scriptContent).toContain('trap cleanup EXIT INT TERM');
  });

  it('keeps infrastructure documentation redacted from raw volume IDs and host IPv4 and includes pnpm PATH', () => {
    expect(docContent).not.toMatch(/HC_Volume_[0-9]+/);
    expect(docContent).not.toMatch(/\b159\.69\.[0-9]+\.[0-9]+\b/);
    expect(docContent).toContain('/opt/pap-runtime/pnpm:/opt/pap-runtime/current/bin');
    expect(docContent).toContain('--mode fixture');
    expect(docContent).toContain('--mode strict-migrator');
  });

  it('rejects missing approval, staging port 5432, non-volume work-root paths, symlinks, and prod env vars (fail-closed)', () => {
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

      // 3. Próba użycia chronionych ścieżek lub katalogów poza /mnt/HC_Volume_<ID>/pap-ci-ephemeral (INFRA-REVIEW-02)
      for (const disallowed of [
        '/var/www/pap-staging',
        '/var/www/pap-staging/releases',
        '/mnt/HC_Volume_redacted/pap-staging/postgres',
        '/etc/pap',
        '/var/www/mumro',
        '/tmp',
        '/tmp/pap-ci-ephemeral',
        posixTempDir,
        '/home/admin/pap-ci-ephemeral',
        '/mnt/HC_Volume_redacted/other-dir',
        '/mnt/pap-ci-ephemeral',
      ]) {
        const disallowedPathRun = spawnSync(
          bashBin!,
          [posixScript, '--preflight-only', '--work-root', disallowed],
          {
            encoding: 'utf8',
            env: { ...baseEnv, PAP_ALLOW_HETZNER_EPHEMERAL_PG: '1' },
          },
        );
        expect(disallowedPathRun.status).toBe(2);
      }

      // 4. Wykrycie dowiązań symbolicznych bezpośrednich oraz nadrzędnych w --work-root (INFRA-REVIEW-02)
      const symlinkCheck = spawnSync(
        bashBin!,
        [
          '-euo',
          'pipefail',
          '-c',
          `
          source "${posixScript}"
          mkdir -p "${posixTempDir}/real-target/sub"
          ln -s "${posixTempDir}/real-target" "${posixTempDir}/symlink-root"
          if (resolve_and_validate_work_root "${posixTempDir}/symlink-root" 0) >/dev/null 2>&1; then
            exit 10
          fi
          if (resolve_and_validate_work_root "${posixTempDir}/symlink-root/sub" 0) >/dev/null 2>&1; then
            exit 11
          fi
          VALID_OUT="$(resolve_and_validate_work_root "/mnt/HC_Volume_test1/pap-ci-ephemeral/pg-runs" 0)"
          [[ "\${VALID_OUT}" == "/mnt/HC_Volume_test1/pap-ci-ephemeral/pg-runs" ]]
          `,
        ],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(symlinkCheck.status).toBe(0);

      // 5. Wykrycie zmiennych produkcyjnych / stagingowych w środowisku
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

      // 6. Niepoprawny tryb i przekroczony timeout
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

  it('enforces fail-closed systemd-run --user --scope (INFRA-REVIEW-01) and separate block volume mount (INFRA-REVIEW-02)', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();

    const posixScript = toPosixPath(scriptPath);
    const tempDir = mkdtempSync(resolve(tmpdir(), 'pap-ephemeral-unit-'));
    try {
      const posixTempDir = toPosixPath(tempDir);

      // INFRA-REVIEW-01: preflight pozostaje read-only (exit 0), natomiast tryb wykonawczy bez systemd-run --user kończy się fail-closed (exit 3)
      const systemdFailClosed = spawnSync(
        bashBin!,
        [
          '-euo',
          'pipefail',
          '-c',
          `
          source "${posixScript}"
          printf 'cpu memory\n' > "${posixTempDir}/controllers-incomplete"
          printf 'cpu memory pids\n' > "${posixTempDir}/controllers-full"

          systemd-run() { return 0; }
          systemctl() { return 0; }
          export -f systemd-run systemctl

          INCOMPLETE="$(detect_user_systemd_cgroup 1000 "${posixTempDir}/controllers-incomplete")"
          [[ "\${INCOMPLETE}" == "no" ]]

          FULL="$(detect_user_systemd_cgroup 1000 "${posixTempDir}/controllers-full")"
          [[ "\${FULL}" == "yes" ]]

          # Preflight read-only nie blokuje odczytu, gdy UserSystemd=no
          (enforce_user_systemd_scope 1 "no")

          # Tryb wykonawczy musi zakończyć się fail-closed kodem 3, gdy UserSystemd=no
          set +e
          (enforce_user_systemd_scope 0 "no") 2>"${posixTempDir}/err.log"
          RC=$?
          set -e
          [[ "\${RC}" -eq 3 ]]
          grep -q "fail-closed" "${posixTempDir}/err.log"
          `,
        ],
        { encoding: 'utf8' },
      );
      expect(systemdFailClosed.status).toBe(0);

      // INFRA-REVIEW-02: weryfikacja odrębnego wolumenu blokowego przez rzeczywistą funkcję verify_separate_volume_mount
      const volumeMountChecks = spawnSync(
        bashBin!,
        [
          '-euo',
          'pipefail',
          '-c',
          `
          source "${posixScript}"
          PROBE_DIR="${posixTempDir}/probe"
          mkdir -p "\${PROBE_DIR}"

          # Przypadek A: nieistniejący wolumen /mnt/HC_Volume_synthetic_test -> exit 3
          set +e
          (verify_separate_volume_mount "/mnt/HC_Volume_synthetic_test/pap-ci-ephemeral") >/dev/null 2>&1
          RC_MISSING=$?
          set -e
          [[ "\${RC_MISSING}" -eq 3 ]]

          # Przypadek B: katalog na partycji głównej / (mount=/) -> exit 3
          set +e
          (
            df() {
              printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n'
              printf '/dev/sda1 38122 29352 7164 81%% /\\n'
            }
            verify_separate_volume_mount "/mnt/HC_Volume_synthetic_test/pap-ci-ephemeral" "\${PROBE_DIR}"
          ) >/dev/null 2>&1
          RC_ROOT_MNT=$?
          set -e
          [[ "\${RC_ROOT_MNT}" -eq 3 ]]

          # Przypadek C: bind-mount z tego samego urządzenia co / (/dev/sda1) -> exit 3
          set +e
          (
            df() {
              if [[ "$2" == "/" ]]; then
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sda1 38122 29352 7164 81%% /\\n'
              else
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sda1 38122 29352 7164 81%% /mnt/HC_Volume_synthetic_test\\n'
              fi
            }
            verify_separate_volume_mount "/mnt/HC_Volume_synthetic_test/pap-ci-ephemeral" "\${PROBE_DIR}"
          ) >/dev/null 2>&1
          RC_BIND=$?
          set -e
          [[ "\${RC_BIND}" -eq 3 ]]

          # Przypadek D: osobny wolumen /dev/sdb, ale za mało miejsca (< 2048 MiB) -> exit 3
          set +e
          (
            df() {
              if [[ "$2" == "/" ]]; then
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sda1 38122 29352 7164 81%% /\\n'
              else
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sdb 50000 49000 1000 98%% /mnt/HC_Volume_synthetic_test\\n'
              fi
            }
            verify_separate_volume_mount "/mnt/HC_Volume_synthetic_test/pap-ci-ephemeral" "\${PROBE_DIR}"
          ) >/dev/null 2>&1
          RC_LOW_SPACE=$?
          set -e
          [[ "\${RC_LOW_SPACE}" -eq 3 ]]

          # Przypadek E: osobny zamontowany wolumen blokowy /dev/sdb z >= 2048 MiB wolnego miejsca -> exit 0
          (
            df() {
              if [[ "$2" == "/" ]]; then
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sda1 38122 29352 7164 81%% /\\n'
              else
                printf 'Filesystem 1048576-blocks Used Available Capacity Mounted on\\n/dev/sdb 50000 23000 24576 49%% /mnt/HC_Volume_synthetic_test\\n'
              fi
            }
            verify_separate_volume_mount "/mnt/HC_Volume_synthetic_test/pap-ci-ephemeral" "\${PROBE_DIR}"
          )
          `,
        ],
        { encoding: 'utf8' },
      );
      expect(volumeMountChecks.status).toBe(0);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
