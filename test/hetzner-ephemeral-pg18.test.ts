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

function buildCleanBashEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MSYS: 'winsymlinks:lnk',
    NODE_ENV: 'test',
    PAP_DATABASE_ENV: undefined,
    PAP_ENV: undefined,
    PAP_ALLOW_HETZNER_EPHEMERAL_PG: undefined,
    ...overrides,
  };
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

  it('enforces mandatory cgroups scope limits without fallback and strict container/cleanup invariants', () => {
    expect(scriptContent).toContain('--publish "127.0.0.1:${PORT}:5432"');
    expect(scriptContent).toContain('--memory=384m');
    expect(scriptContent).toContain('--memory-swap=384m');
    expect(scriptContent).toContain('--cpus=0.50');
    expect(scriptContent).toContain('--pids-limit=128');
    expect(scriptContent).toContain('--cap-drop=NET_RAW');
    expect(scriptContent).toContain('--security-opt no-new-privileges:true');
    expect(scriptContent).toContain('/opt/pap-runtime/pnpm');
    expect(scriptContent).toContain('COREPACK_DEFAULT_TO_LATEST=0');
    // PostgreSQL 18 definiuje VOLUME /var/lib/postgresql (nie /var/lib/postgresql/data)
    expect(scriptContent).toContain('-v "${RUN_DIR}/pgdata:/var/lib/postgresql"');
    expect(scriptContent).not.toContain(':/var/lib/postgresql/data');
    expect(scriptContent).toContain('POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass');
    expect(scriptContent).toContain('-c log_statement=none');

    // Zakaz cichego przejścia na sam timeout bez limitów cgroups systemd-run --user --scope
    expect(scriptContent).not.toContain('USER_SYSTEMD_AVAILABLE');
    expect(scriptContent).toContain('-p MemoryHigh=512M');
    expect(scriptContent).toContain('-p MemoryMax=768M');
    expect(scriptContent).toContain('-p MemorySwapMax=0');
    expect(scriptContent).toContain('-p CPUQuota=50%');
    expect(scriptContent).toContain('-p TasksMax=128');
    expect(scriptContent).toContain('verify_user_systemd_readonly');
    expect(scriptContent).toContain('verify_user_systemd_scope_active');

    // Bezpieczny cleanup i izolacja kontenera pomocniczego
    expect(scriptContent).toContain('--one-file-system');
    expect(scriptContent).toContain('--network=none');
    expect(scriptContent).toContain('trap \'cleanup "$?"\' EXIT');
    expect(scriptContent).toContain("trap 'on_signal TERM' TERM");
    expect(scriptContent).toContain("trap 'on_signal INT' INT");
    expect(scriptContent).toContain("trap 'on_signal HUP' HUP");
  });

  it('keeps infrastructure documentation redacted and explicitly documents Docker network limits', () => {
    expect(docContent).not.toMatch(/HC_Volume_[0-9]+/);
    expect(docContent).not.toMatch(/\b159\.69\.[0-9]+\.[0-9]+\b/);
    expect(docContent).toContain('--mode fixture');
    expect(docContent).toContain('--mode strict-migrator');
    expect(docContent).toContain('enable_icc=false');
    expect(docContent).toContain('egress');
    expect(docContent).toContain('0.0.0.0');
    expect(docContent).toContain('route_localnet=0');
    expect(docContent).toContain('pap-ci-ephemeral');
  });

  it('rejects missing approval, staging port 5432, production env vars, and any path outside pap-ci-ephemeral', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();

    const posixScript = toPosixPath(scriptPath);
    const syntaxCheck = spawnSync(bashBin!, ['-n', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(syntaxCheck.status).toBe(0);

    const helpRun = spawnSync(bashBin!, [posixScript, '--help'], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(helpRun.status).toBe(0);
    expect(helpRun.stdout).toContain('--preflight-only');

    const tempDir = mkdtempSync(resolve(tmpdir(), 'pap-ephemeral-test-'));
    try {
      const posixTempDir = toPosixPath(tempDir);
      const baseEnv = buildCleanBashEnv();

      // 1. Brak potwierdzonej zgody PAP_ALLOW_HETZNER_EPHEMERAL_PG=1
      const noApproval = spawnSync(
        bashBin!,
        [posixScript, '--work-root', posixTempDir, '--', 'true'],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(noApproval.status).toBe(2);
      expect(noApproval.stderr).toContain('PAP_ALLOW_HETZNER_EPHEMERAL_PG=1');

      // 2. Port 5432 stagingu i porty spoza dozwolonego zakresu
      const stagingPort = spawnSync(bashBin!, [posixScript, '--preflight-only', '--port', '5432'], {
        encoding: 'utf8',
        env: baseEnv,
      });
      expect(stagingPort.status).toBe(2);
      expect(stagingPort.stderr).toContain('5432');

      // 3. Katalogi spoza zatwierdzonego /mnt/HC_Volume_<ID>/pap-ci-ephemeral
      const disallowedWorkRoots = [
        '/',
        '/tmp',
        posixTempDir,
        'relative/pap-ci-ephemeral',
        '/var/www/pap-staging',
        '/var/www/pap-staging/releases',
        '/etc/pap',
        '/var/www/mumro',
        '/mnt/HC_Volume_12345',
        '/mnt/HC_Volume_12345/pap-staging',
        '/mnt/HC_Volume_12345/pap-staging/postgres',
        '/mnt/HC_Volume_12345/mumro-temp-ci',
        '/mnt/HC_Volume_12345/reels-api',
        '/mnt/HC_Volume_12345/TMP',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral-other',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/../pap-staging',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/./runs',
        '/mnt/HC_Volume_12345//pap-ci-ephemeral',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/bad:colon',
      ];

      for (const candidate of disallowedWorkRoots) {
        const run = spawnSync(
          bashBin!,
          [posixScript, '--preflight-only', '--work-root', candidate],
          {
            encoding: 'utf8',
            env: { ...baseEnv, PAP_ALLOW_HETZNER_EPHEMERAL_PG: '1' },
          },
        );
        expect(run.status, `Expected rejection for work-root=${candidate}`).toBe(2);
      }

      // 4. Wykrycie zmiennych produkcyjnych / stagingowych
      for (const badEnv of [
        { NODE_ENV: 'production' },
        { PAP_DATABASE_ENV: 'staging' },
        { PAP_ENV: 'staging' },
      ]) {
        const envRun = spawnSync(bashBin!, [posixScript, '--preflight-only'], {
          encoding: 'utf8',
          env: { ...baseEnv, ...badEnv },
        });
        expect(envRun.status).toBe(2);
      }

      // 5. Niepoprawny tryb, bootstrap bez strict-migrator i przekroczony timeout
      expect(
        spawnSync(bashBin!, [posixScript, '--preflight-only', '--mode', 'superuser'], {
          encoding: 'utf8',
          env: baseEnv,
        }).status,
      ).toBe(2);

      expect(
        spawnSync(
          bashBin!,
          [posixScript, '--preflight-only', '--mode', 'fixture', '--bootstrap-runtime-role'],
          { encoding: 'utf8', env: baseEnv },
        ).status,
      ).toBe(2);

      expect(
        spawnSync(bashBin!, [posixScript, '--preflight-only', '--timeout', '3600'], {
          encoding: 'utf8',
          env: baseEnv,
        }).status,
      ).toBe(2);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 20_000);

  it('enforces dedicated block volume, realpath canonicalization, and symlink rejection for --work-root', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'SANDBOX="/tmp/pap-vol-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'mkdir -p "$SANDBOX/bin" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs"',
      'mkdir -p "$SANDBOX/mnt/HC_Volume_12345/pap-staging" "$SANDBOX/outside"',
      'ln -s "$SANDBOX/outside" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/symlink-escape"',
      'ln -s "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" "$SANDBOX/outside/symlink-in"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'MOCK_STAT\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      'if [[ "${FAKE_SAME_ROOT_DEV:-0}" == "1" ]]; then',
      '  printf "100\\n"',
      '  exit 0',
      'fi',
      'if [[ "${FAKE_SUBDIR_REMOUNT_ROOT:-0}" == "1" && "$target" == *"/pg-runs" ]]; then',
      '  printf "100\\n"',
      '  exit 0',
      'fi',
      'if [[ "$target" == *"HC_Volume_12345"* ]]; then',
      '  printf "200\\n"',
      'else',
      '  printf "100\\n"',
      'fi',
      'MOCK_STAT',
      '',
      'cat > "$SANDBOX/bin/df" <<\'MOCK_DF\'',
      '#!/usr/bin/env bash',
      'fs="${FAKE_FSTYPE:-ext4}"',
      'if [[ "$1" == "-PT" ]]; then',
      '  printf "Filesystem Type 1024-blocks Used Available Capacity Mounted\\n/dev/sdb %s 51290592 10000 41290592 20%% /mnt\\n" "$fs"',
      'else',
      '  printf "Filesystem 1048576-blocks Used Available Capacity Mounted\\n/dev/sdb 50000 10000 24000 20%% /mnt\\n"',
      'fi',
      'MOCK_DF',
      'chmod +x "$SANDBOX/bin/stat" "$SANDBOX/bin/df"',
      'export PATH="$SANDBOX/bin:$PATH"',
      '',
      'run_validate() {',
      '  (',
      '    source "$1"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    validate_work_root "$2"',
      '    printf "ACCEPTED=%s\\n" "$RESOLVED_WORK_ROOT"',
      '  )',
      '}',
      '',
      '# 1. Symlink wychodzący z wnętrza pap-ci-ephemeral poza wolumen',
      'if run_validate "$1" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/symlink-escape" 2>"$SANDBOX/err1"; then exit 11; fi',
      'grep -q "symlink" "$SANDBOX/err1"',
      '',
      '# 2. Symlink wchodzący spoza zatwierdzonego drzewa',
      'if run_validate "$1" "$SANDBOX/outside/symlink-in" 2>"$SANDBOX/err2"; then exit 12; fi',
      '',
      '# 3. Katalog o poprawnej nazwie, ale leżący na partycji głównej / (ten sam st_dev)',
      'if FAKE_SAME_ROOT_DEV=1 run_validate "$1" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err3"; then exit 13; fi',
      'grep -q "partycją /" "$SANDBOX/err3"',
      '',
      '# 4. Podkatalog przymontowany z powrotem do innego urządzenia (bind-mount mismatch)',
      'if FAKE_SUBDIR_REMOUNT_ROOT=1 run_validate "$1" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err4"; then exit 14; fi',
      '',
      '# 5. Niedozwolony system plików tmpfs',
      'if FAKE_FSTYPE=tmpfs run_validate "$1" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err5"; then exit 15; fi',
      'grep -q "tmpfs" "$SANDBOX/err5"',
      '',
      '# 6. Sam pap-ci-ephemeral podmieniony na symlink do pap-staging',
      'mkdir -p "$SANDBOX/mnt/HC_Volume_99999/pap-staging"',
      'ln -s "$SANDBOX/mnt/HC_Volume_99999/pap-staging" "$SANDBOX/mnt/HC_Volume_99999/pap-ci-ephemeral"',
      'if run_validate "$1" "$SANDBOX/mnt/HC_Volume_99999/pap-ci-ephemeral" 2>"$SANDBOX/err6"; then exit 16; fi',
      'grep -q "symlink" "$SANDBOX/err6"',
      '',
      '# 7. Poprawny katalog na wydzielonym wolumenie ext4',
      'OUT_OK="$(run_validate "$1" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs")"',
      'printf "%s\\n" "$OUT_OK"',
    ].join('\n');

    const result = spawnSync(bashBin!, ['-c', harness, 'bash', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs');
  }, 20_000);

  it('refuses to run test commands when systemd-run --user --scope is unavailable while keeping preflight read-only', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'SANDBOX="/tmp/pap-scope-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'mkdir -p "$SANDBOX/bin" "$SANDBOX/state" "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs"',
      'printf "MemAvailable: 2560000 kB\\n" > "$SANDBOX/meminfo"',
      'printf "cpu memory pids\\n" > "$SANDBOX/controllers"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      '[[ "$target" == *"HC_Volume_12345"* ]] && printf "200\\n" || printf "100\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/df" <<\'EOF\'',
      '#!/usr/bin/env bash',
      '[[ "$1" == "-PT" ]] && printf "FS Type 1K U A C M\\n/dev/sdb ext4 50000 1000 40000 2%% /mnt\\n" || printf "FS 1M U A C M\\n/dev/sdb 50000 1000 24000 2%% /mnt\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/ss" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'exit 0',
      'EOF',
      'cat > "$SANDBOX/bin/docker" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$SANDBOX_STATE/docker.log"',
      'if [[ "$1" == "info" ]]; then printf "CgroupVersion=2 MemoryLimit=true SwapLimit=true\\n"; exit 0; fi',
      'if [[ "$1" == "image" && "$2" == "inspect" ]]; then exit 0; fi',
      'exit 99',
      'EOF',
      'cat > "$SANDBOX/bin/systemctl" <<\'EOF\'',
      '#!/usr/bin/env bash',
      '[[ "${MOCK_USER_SYSTEMCTL_FAIL:-0}" == "1" ]] && exit 1',
      'exit 0',
      'EOF',
      'cat > "$SANDBOX/bin/systemd-run" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'printf "%s\\n" "$*" >> "$SANDBOX_STATE/systemd-run.log"',
      '[[ "${MOCK_SCOPE_FAIL:-0}" == "1" ]] && exit 1',
      'while [[ $# -gt 0 ]]; do [[ "$1" == "--" ]] && { shift; break; }; shift; done',
      'exec "$@"',
      'EOF',
      'chmod +x "$SANDBOX/bin/"*',
      'export PATH="$SANDBOX/bin:$PATH"',
      'export SANDBOX_STATE="$SANDBOX/state"',
      '',
      'invoke_runner() {',
      '  (',
      '    source "$SCRIPT_UNDER_TEST"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '    get_user_cgroup_controllers_file() { printf "%s" "$SANDBOX/controllers"; }',
      '    main "$@"',
      '  )',
      '}',
      'export SCRIPT_UNDER_TEST="$1"',
      '',
      '# A. Preflight jest wyłącznie odczytowy (nie uruchamia systemd-run --scope)',
      'MOCK_SCOPE_FAIL=1 invoke_runner --preflight-only --work-root "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" --port 55432',
      '[[ ! -f "$SANDBOX_STATE/systemd-run.log" ]] || exit 21',
      '',
      '# B. Odmowa, gdy systemctl --user jest niedostępny',
      'set +e',
      'MOCK_USER_SYSTEMCTL_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-without-cgroups" 2>"$SANDBOX/err_sys"',
      'rc_sys=$?',
      'set -e',
      '[[ "$rc_sys" -eq 3 ]] || exit 22',
      '[[ ! -f "$SANDBOX_STATE/ran-without-cgroups" ]] || exit 23',
      '',
      '# C. Odmowa, gdy brak delegacji kontrolera memory w cgroup.controllers',
      'printf "cpu pids\\n" > "$SANDBOX/controllers"',
      'set +e',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-without-mem-ctrl" 2>"$SANDBOX/err_ctrl"',
      'rc_ctrl=$?',
      'set -e',
      '[[ "$rc_ctrl" -eq 3 ]] || exit 24',
      'grep -q "memory" "$SANDBOX/err_ctrl"',
      '[[ ! -f "$SANDBOX_STATE/ran-without-mem-ctrl" ]] || exit 25',
      '',
      '# D. Kluczowy scenariusz: systemctl --user działa, ale systemd-run --user --scope odmawia utworzenia scope',
      'printf "cpu memory pids\\n" > "$SANDBOX/controllers"',
      ': > "$SANDBOX_STATE/docker.log"',
      'set +e',
      'MOCK_SCOPE_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-fallback-timeout" 2>"$SANDBOX/err_scope"',
      'rc_scope=$?',
      'set -e',
      '[[ "$rc_scope" -eq 3 ]] || exit 26',
      'grep -q "systemd-run --user --scope" "$SANDBOX/err_scope"',
      '[[ ! -f "$SANDBOX_STATE/ran-fallback-timeout" ]] || exit 27',
      '! grep -q "^run " "$SANDBOX_STATE/docker.log" || exit 28',
      'printf "SCOPE_FAIL_CLOSED_VERIFIED=OK\\n"',
    ].join('\n');

    const result = spawnSync(bashBin!, ['-c', harness, 'bash', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SCOPE_FAIL_CLOSED_VERIFIED=OK');
  }, 20_000);

  it('cleans up ephemeral resources on success, failure, timeout, and SIGTERM without touching existing server resources', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'REAL_TIMEOUT="$(command -v timeout)"',
      'SANDBOX="/tmp/pap-cleanup-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'WORK_DIR="$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs"',
      'mkdir -p "$SANDBOX/bin" "$SANDBOX/state/containers" "$SANDBOX/state/networks" "$WORK_DIR"',
      'printf "MemAvailable: 2560000 kB\\n" > "$SANDBOX/meminfo"',
      'printf "cpu memory pids\\n" > "$SANDBOX/controllers"',
      '',
      '# Zasoby innych usług istniejące wcześniej na serwerze — muszą pozostać nienaruszone',
      'touch "$SANDBOX/state/containers/shorts-api-shorts-backend-1"',
      'touch "$SANDBOX/state/networks/shorts-api_default"',
      'touch "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/keep-sentinel"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      '[[ "$target" == *"HC_Volume_12345"* ]] && printf "200\\n" || printf "100\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/df" <<\'EOF\'',
      '#!/usr/bin/env bash',
      '[[ "$1" == "-PT" ]] && printf "FS Type 1K U A C M\\n/dev/sdb ext4 50000 1000 40000 2%% /mnt\\n" || printf "FS 1M U A C M\\n/dev/sdb 50000 1000 24000 2%% /mnt\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/ss" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'exit 0',
      'EOF',
      'cat > "$SANDBOX/bin/systemctl" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'exit 0',
      'EOF',
      'cat > "$SANDBOX/bin/systemd-run" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'all_args=" $* "',
      'for req in "-p MemoryHigh=512M" "-p MemoryMax=768M" "-p MemorySwapMax=0" "-p CPUQuota=50%" "-p TasksMax=128" "--user" "--scope"; do',
      '  [[ "$all_args" == *" $req "* ]] || { echo "Missing scope arg: $req" >&2; exit 91; }',
      'done',
      'while [[ $# -gt 0 ]]; do [[ "$1" == "--" ]] && { shift; break; }; shift; done',
      'exec "$@"',
      'EOF',
      'cat > "$SANDBOX/bin/timeout" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'if [[ "${FAST_TEST_TIMEOUT:-0}" == "1" ]]; then',
      '  shift 3',
      '  exec "$REAL_TIMEOUT" --signal=TERM --kill-after=1s 0.2s "$@"',
      'fi',
      'exec "$REAL_TIMEOUT" "$@"',
      'EOF',
      'cat > "$SANDBOX/bin/docker" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'cmd="$1"; shift',
      'case "$cmd" in',
      '  info) printf "CgroupVersion=2 MemoryLimit=true SwapLimit=true\\n" ;;',
      '  image) exit 0 ;;',
      '  network)',
      '    sub="$1"; shift',
      '    if [[ "$sub" == "create" ]]; then',
      '      net="${!#}"',
      '      touch "$SANDBOX_STATE/networks/$net"',
      '    elif [[ "$sub" == "rm" ]]; then',
      '      rm -f "$SANDBOX_STATE/networks/$1"',
      '    fi',
      '    ;;',
      '  run)',
      '    cname=""',
      '    while [[ $# -gt 0 ]]; do',
      '      if [[ "$1" == "--name" ]]; then cname="$2"; shift 2; else shift; fi',
      '    done',
      '    [[ -n "$cname" ]] && touch "$SANDBOX_STATE/containers/$cname"',
      '    ;;',
      '  port) printf "127.0.0.1:55432\\n" ;;',
      '  exec) exit 0 ;;',
      '  rm)',
      '    cname="${!#}"',
      '    rm -f "$SANDBOX_STATE/containers/$cname"',
      '    ;;',
      'esac',
      'EOF',
      'chmod +x "$SANDBOX/bin/"*',
      'export PATH="$SANDBOX/bin:$PATH"',
      'export SANDBOX_STATE="$SANDBOX/state"',
      'export REAL_TIMEOUT',
      'export SCRIPT_UNDER_TEST="$1"',
      '',
      'invoke_runner() {',
      '  (',
      '    source "$SCRIPT_UNDER_TEST"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '    get_user_cgroup_controllers_file() { printf "%s" "$SANDBOX/controllers"; }',
      '    main "$@"',
      '  )',
      '}',
      '',
      'assert_clean_and_preserved() {',
      '  [[ -f "$SANDBOX_STATE/containers/shorts-api-shorts-backend-1" ]] || exit 31',
      '  [[ -f "$SANDBOX_STATE/networks/shorts-api_default" ]] || exit 32',
      '  [[ -f "$SANDBOX/mnt/HC_Volume_12345/pap-ci-ephemeral/keep-sentinel" ]] || exit 33',
      '  local leftover_c leftover_n leftover_r',
      '  leftover_c="$(ls "$SANDBOX_STATE/containers" | grep -v "^shorts-api-shorts-backend-1$" || true)"',
      '  leftover_n="$(ls "$SANDBOX_STATE/networks" | grep -v "^shorts-api_default$" || true)"',
      '  leftover_r="$(ls "$WORK_DIR" || true)"',
      '  [[ -z "$leftover_c" && -z "$leftover_n" && -z "$leftover_r" ]] || {',
      '    echo "Leftovers: c=$leftover_c n=$leftover_n r=$leftover_r" >&2',
      '    exit 34',
      '  }',
      '}',
      '',
      '# 1. Sukces (exit 0)',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- bash -c \'[[ "$PAP_DATABASE_ENV" == "test" && "$DATABASE_URL" == postgres://pap_test:*@127.0.0.1:55432/pap_test ]]\'',
      'assert_clean_and_preserved',
      '',
      '# 2. Błąd polecenia testowego (exit 17)',
      'set +e',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- bash -c "exit 17"',
      'rc_err=$?',
      'set -e',
      '[[ "$rc_err" -eq 17 ]] || exit 35',
      'assert_clean_and_preserved',
      '',
      '# 3. Timeout polecenia testowego (exit 124)',
      'set +e',
      'FAST_TEST_TIMEOUT=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 --timeout 10 \\',
      '  -- sleep 10',
      'rc_to=$?',
      'set -e',
      '[[ "$rc_to" -eq 124 || "$rc_to" -eq 137 ]] || { echo "Expected 124 or 137, got $rc_to" >&2; exit 36; }',
      'assert_clean_and_preserved',
      '',
      '# 4. Przerwanie sygnałem SIGTERM w trakcie działania (exit 143)',
      'export SANDBOX',
      "PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 bash -c '",
      '  source "$SCRIPT_UNDER_TEST"',
      '  get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '  get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '  get_user_cgroup_controllers_file() { printf "%s" "$SANDBOX/controllers"; }',
      '  main "$@"',
      '\' bash --work-root "$WORK_DIR" --port 55432 \\',
      '  -- bash -c \'trap "exit 143" TERM; touch "$SANDBOX_STATE/child-started"; while :; do sleep 0.1; done\' &',
      'bg_pid=$!',
      'for _ in $(seq 1 50); do [[ -f "$SANDBOX_STATE/child-started" ]] && break; sleep 0.05; done',
      '[[ -f "$SANDBOX_STATE/child-started" ]] || exit 37',
      'kill -TERM "$bg_pid"',
      'set +e',
      'wait "$bg_pid"',
      'rc_sig=$?',
      'set -e',
      '[[ "$rc_sig" -eq 143 ]] || { echo "Expected 143, got $rc_sig" >&2; exit 38; }',
      'assert_clean_and_preserved',
      'printf "ALL_CLEANUP_PATHS_VERIFIED=OK\\n"',
    ].join('\n');

    const result = spawnSync(bashBin!, ['-c', harness, 'bash', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ALL_CLEANUP_PATHS_VERIFIED=OK');
  }, 25_000);
});
