import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    expect(scriptContent).toContain('exec_container_super_psql');
    expect(scriptContent).toContain('docker exec -i -u postgres');
    expect(scriptContent).toContain('PGPASSWORD="$(cat /run/secrets/pg_pass)"');
    expect(scriptContent).not.toContain('-e PGPASSWORD=');
    expect(scriptContent).toContain('-c log_statement=none');
    expect(scriptContent).toContain('host all postgres 0.0.0.0/0 reject');

    // Zakaz cichego przejścia na sam timeout bez limitów cgroups systemd-run --user --scope
    expect(scriptContent).not.toContain('USER_SYSTEMD_AVAILABLE');
    expect(scriptContent).toContain('-p MemoryHigh=512M');
    expect(scriptContent).toContain('-p MemoryMax=768M');
    expect(scriptContent).toContain('-p MemorySwapMax=0');
    expect(scriptContent).toContain('-p CPUQuota=50%');
    expect(scriptContent).toContain('-p TasksMax=128');
    expect(scriptContent).toContain('SCOPE_CGROUP_ENFORCER_SCRIPT');
    expect(scriptContent).toContain('verify_user_systemd_readonly');
    expect(scriptContent).toContain('verify_user_systemd_scope_active');

    // Bezpieczny cleanup nieprzerywalny powtórzonym sygnałem i izolacja kontenera pomocniczego
    expect(scriptContent).toContain('--one-file-system');
    expect(scriptContent).toContain('--network=none');
    expect(scriptContent).toContain("trap '' HUP INT TERM");
    expect(scriptContent).toContain('trap \'cleanup "$?"\' EXIT');
    expect(scriptContent).toContain("trap 'on_signal TERM' TERM");
    expect(scriptContent).toContain("trap 'on_signal INT' INT");
    expect(scriptContent).toContain("trap 'on_signal HUP' HUP");
  });

  it('keeps infrastructure documentation redacted and explicitly documents Docker network guarantees and limits', () => {
    expect(docContent).not.toMatch(/HC_Volume_[0-9]+/);
    expect(docContent).not.toMatch(/\b159\.69\.[0-9]+\.[0-9]+\b/);
    expect(docContent).toContain('/opt/pap-runtime/pnpm:/opt/pap-runtime/current/bin');
    expect(docContent).toContain('--mode fixture');
    expect(docContent).toContain('--mode strict-migrator');
    expect(docContent).toContain('enable_icc=false');
    expect(docContent).toContain('DOCKER-ISOLATION-STAGE-1/2');
    expect(docContent).toContain('egress');
    expect(docContent).toContain('169.254.169.254');
    expect(docContent).toContain('0.0.0.0');
    expect(docContent).toContain('route_localnet=0');
    expect(docContent).toContain('pap-ci-ephemeral');
  });

  it('rejects missing approval, staging port 5432, protected CWD, production env vars, and any path outside pap-ci-ephemeral', () => {
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
        '/tmp/pap-ci-ephemeral',
        posixTempDir,
        'relative/pap-ci-ephemeral',
        '/home/admin/pap-ci-ephemeral',
        '/var/www/pap-staging',
        '/var/www/pap-staging/releases',
        '/etc/pap',
        '/var/www/mumro',
        '/mnt/pap-ci-ephemeral',
        '/mnt/HC_Volume_12345',
        '/mnt/HC_Volume_12345/pap-staging',
        '/mnt/HC_Volume_12345/pap-staging/postgres',
        '/mnt/HC_Volume_12345/mumro-temp-ci',
        '/mnt/HC_Volume_12345/reels-api',
        '/mnt/HC_Volume_12345/shorts-api',
        '/mnt/HC_Volume_12345/TMP',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral-other',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/../pap-staging',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/./runs',
        '/mnt/HC_Volume_12345//pap-ci-ephemeral',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/.hidden',
        '/mnt/HC_Volume_12345/pap-ci-ephemeral/-dash',
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

      // 4. Odrzucenie uruchomienia z chronionego katalogu roboczego PWD (np. pap-staging / shorts-api)
      const protectedCwdCheck = spawnSync(
        bashBin!,
        [
          '-euo',
          'pipefail',
          '-c',
          `mkdir -p "${posixTempDir}/pap-staging" && cd "${posixTempDir}/pap-staging" && "${posixScript}" --preflight-only`,
        ],
        { encoding: 'utf8', env: baseEnv },
      );
      expect(protectedCwdCheck.status).toBe(2);

      // 5. Wykrycie zmiennych produkcyjnych / stagingowych
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

      // 6. Niepoprawny tryb, bootstrap bez strict-migrator i przekroczony timeout
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
  }, 25_000);

  it('enforces dedicated block volume mountpoint, realpath canonicalization, symlink and bind-mount rejection for --work-root', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'SANDBOX="/tmp/pap-vol-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'VOL_MNT="$SANDBOX/mnt/HC_Volume_12345"',
      'mkdir -p "$SANDBOX/bin" "$VOL_MNT/pap-ci-ephemeral/pg-runs"',
      'mkdir -p "$VOL_MNT/pap-staging" "$SANDBOX/outside"',
      'ln -s "$SANDBOX/outside" "$VOL_MNT/pap-ci-ephemeral/symlink-escape"',
      'ln -s "$VOL_MNT/pap-ci-ephemeral/pg-runs" "$SANDBOX/outside/symlink-in"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'MOCK_STAT\'',
      '#!/usr/bin/env bash',
      'fmt=""',
      'target="${!#}"',
      'for arg in "$@"; do',
      '  if [[ "$arg" == "%a" || "$arg" == "%d" ]]; then fmt="$arg"; fi',
      'done',
      'if [[ "$fmt" == "%a" ]]; then',
      '  [[ "${FAKE_WORLD_WRITABLE:-0}" == "1" ]] && printf "777\\n" || printf "700\\n"',
      '  exit 0',
      'fi',
      'if [[ "${FAKE_SAME_ROOT_DEV:-0}" == "1" ]]; then',
      '  printf "100\\n"',
      '  exit 0',
      'fi',
      'if [[ "${FAKE_SUBDIR_REMOUNT_ROOT:-0}" == "1" && "$target" == *"/pg-runs" ]]; then',
      '  printf "100\\n"',
      '  exit 0',
      'fi',
      'if [[ "$target" == *"HC_Volume_"* ]]; then',
      '  printf "200\\n"',
      'else',
      '  printf "100\\n"',
      'fi',
      'MOCK_STAT',
      '',
      'cat > "$SANDBOX/bin/df" <<\'MOCK_DF\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      'fs="${FAKE_FSTYPE:-ext4}"',
      'if [[ "$1" == "-PT" ]]; then',
      '  if [[ "$target" == "/" ]]; then',
      '    printf "Filesystem Type 1024-blocks Used Available Capacity Mounted_on\\n/dev/sda1 ext4 39000000 31000000 7200000 81%% /\\n"',
      '    exit 0',
      '  fi',
      '  vol_dev="${FAKE_DF_DEV:-/dev/sdb}"',
      '  if [[ "${FAKE_UNMOUNTED_MNT:-0}" == "1" ]]; then',
      '    mnt_point="$SANDBOX/mnt"',
      '  elif [[ "${FAKE_SAME_VOL_BIND_MOUNT:-0}" == "1" && "$target" == *"/pg-runs" ]]; then',
      '    mnt_point="$target"',
      '  else',
      '    mnt_point="$(printf "%s" "$target" | sed -E "s|(HC_Volume_[0-9]+).*|\\1|")"',
      '  fi',
      '  printf "Filesystem Type 1024-blocks Used Available Capacity Mounted_on\\n%s %s 51290592 10000 41290592 20%% %s\\n" "$vol_dev" "$fs" "$mnt_point"',
      'else',
      '  printf "Filesystem 1048576-blocks Used Available Capacity Mounted_on\\n/dev/sdb 50000 10000 24000 20%% %s\\n" "$VOL_MNT"',
      'fi',
      'MOCK_DF',
      'chmod +x "$SANDBOX/bin/stat" "$SANDBOX/bin/df"',
      'export PATH="$SANDBOX/bin:$PATH"',
      'export SANDBOX VOL_MNT',
      '',
      'run_validate() {',
      '  (',
      '    source "$1"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    validate_work_root "$2" "${3:-0}"',
      '    printf "ACCEPTED=%s:%s\\n" "$WORK_ROOT_STATUS" "$RESOLVED_WORK_ROOT"',
      '  )',
      '}',
      '',
      '# 1. Symlink wychodzący z wnętrza pap-ci-ephemeral poza wolumen',
      'if run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/symlink-escape" 2>"$SANDBOX/err1"; then exit 11; fi',
      'grep -q "symlink" "$SANDBOX/err1"',
      '',
      '# 2. Symlink pośredni przy nieistniejącym liściu w --preflight-only',
      'if run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/symlink-escape/future-runs" 1 2>"$SANDBOX/err1b"; then exit 111; fi',
      'grep -q "symlink" "$SANDBOX/err1b"',
      '',
      '# 3. Symlink wchodzący spoza zatwierdzonego drzewa',
      'if run_validate "$1" "$SANDBOX/outside/symlink-in" 2>"$SANDBOX/err2"; then exit 12; fi',
      '',
      '# 4. Katalog o poprawnej nazwie, ale leżący na partycji głównej / (ten sam st_dev)',
      'if FAKE_SAME_ROOT_DEV=1 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err3"; then exit 13; fi',
      'grep -q "partycją /" "$SANDBOX/err3"',
      '',
      '# 5. Niezamontowany podkatalog pod /mnt (df mountpoint != /mnt/HC_Volume_<ID>)',
      'if FAKE_UNMOUNTED_MNT=1 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err3b"; then exit 131; fi',
      '',
      '# 6. Bind-mount w obrębie tego samego wolumenu blokowego /dev/sdb (np. z pap-staging)',
      'if FAKE_SAME_VOL_BIND_MOUNT=1 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err4"; then exit 14; fi',
      'grep -q "bind-mount" "$SANDBOX/err4"',
      '',
      '# 7. Podkatalog przymontowany z powrotem do innego urządzenia (st_dev mismatch)',
      'if FAKE_SUBDIR_REMOUNT_ROOT=1 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err4b"; then exit 141; fi',
      '',
      '# 8. Niedozwolony system plików tmpfs oraz sieciowy nfs4',
      'if FAKE_FSTYPE=tmpfs run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err5"; then exit 15; fi',
      'grep -q "tmpfs" "$SANDBOX/err5"',
      'if FAKE_FSTYPE=nfs4 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err5b"; then exit 151; fi',
      '',
      '# 9. Katalog world-writable (0777)',
      'if FAKE_WORLD_WRITABLE=1 run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 2>"$SANDBOX/err5c"; then exit 152; fi',
      '',
      '# 10. Sam pap-ci-ephemeral podmieniony na symlink do pap-staging',
      'mkdir -p "$SANDBOX/mnt/HC_Volume_99999/pap-staging"',
      'ln -s "$SANDBOX/mnt/HC_Volume_99999/pap-staging" "$SANDBOX/mnt/HC_Volume_99999/pap-ci-ephemeral"',
      'if run_validate "$1" "$SANDBOX/mnt/HC_Volume_99999/pap-ci-ephemeral" 2>"$SANDBOX/err6"; then exit 16; fi',
      'grep -q "symlink" "$SANDBOX/err6"',
      '',
      '# 11. Nieistniejący podkatalog: odmowa w trybie wykonawczym (0), akceptacja pending-mkdir w preflight (1)',
      'if run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/not-created-yet" 0 2>"$SANDBOX/err7"; then exit 17; fi',
      'OUT_PF="$(run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/not-created-yet" 1)"',
      '[[ "$OUT_PF" == *"ACCEPTED=pending-mkdir:"* ]] || exit 18',
      '',
      '# 12. Poprawny katalog na wydzielonym wolumenie blokowym ext4',
      'OUT_OK="$(run_validate "$1" "$VOL_MNT/pap-ci-ephemeral/pg-runs" 0)"',
      'printf "%s\\n" "$OUT_OK"',
    ].join('\n');

    const result = spawnSync(bashBin!, ['-c', harness, 'bash', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('ACCEPTED=ready:');
    expect(result.stdout).toContain('/mnt/HC_Volume_12345/pap-ci-ephemeral/pg-runs');
  }, 25_000);

  it('refuses to run test commands when systemd-run --user --scope or kernel cgroup limits are unavailable while keeping preflight read-only', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'SANDBOX="/tmp/pap-scope-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'UID_VAL="$(id -u)"',
      'SLICE_DIR="$SANDBOX/cgroup/user.slice/user-${UID_VAL}.slice"',
      'MGR_DIR="$SLICE_DIR/user@${UID_VAL}.service"',
      'VOL_MNT="$SANDBOX/mnt/HC_Volume_12345"',
      'mkdir -p "$SANDBOX/bin" "$SANDBOX/state" "$MGR_DIR/app.slice" "$VOL_MNT/pap-ci-ephemeral/pg-runs"',
      'printf "MemAvailable: 2560000 kB\\n" > "$SANDBOX/meminfo"',
      'printf "cpu memory pids\\n" > "$SLICE_DIR/cgroup.controllers"',
      'printf "cpu memory pids\\n" > "$MGR_DIR/cgroup.controllers"',
      'printf "cpu memory pids\\n" > "$MGR_DIR/cgroup.subtree_control"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'for arg in "$@"; do [[ "$arg" == "%a" ]] && { printf "700\\n"; exit 0; }; done',
      'target="${!#}"',
      '[[ "$target" == *"HC_Volume_12345"* ]] && printf "200\\n" || printf "100\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/df" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      'if [[ "$1" == "-PT" ]]; then',
      '  [[ "$target" == "/" ]] && printf "FS T 1K U A C M\\n/dev/sda1 ext4 39000 31000 7200 81%% /\\n" || printf "FS T 1K U A C M\\n/dev/sdb ext4 50000 1000 40000 2%% %s\\n" "$VOL_MNT"',
      'else',
      '  printf "FS 1M U A C M\\n/dev/sdb 50000 1000 24000 2%% %s\\n" "$VOL_MNT"',
      'fi',
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
      'unit_name=""',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --unit=*) unit_name="${1#--unit=}"; shift ;;',
      '    --) shift; break ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'rel_cg="/user.slice/user-${UID_VAL}.slice/user@${UID_VAL}.service/app.slice/${unit_name}.scope"',
      'scope_dir="$SANDBOX/cgroup${rel_cg}"',
      'mkdir -p "$scope_dir"',
      'printf "0::%s\\n" "$rel_cg" > "$SANDBOX/proc_self_cgroup"',
      'printf "%s\\n" "${MOCK_MEM_HIGH:-536870912}" > "$scope_dir/memory.high"',
      'printf "%s\\n" "${MOCK_MEM_MAX:-805306368}" > "$scope_dir/memory.max"',
      'printf "%s\\n" "${MOCK_SWAP_MAX:-0}" > "$scope_dir/memory.swap.max"',
      'printf "%s\\n" "${MOCK_CPU_MAX:-50000 100000}" > "$scope_dir/cpu.max"',
      'printf "%s\\n" "${MOCK_PIDS_MAX:-128}" > "$scope_dir/pids.max"',
      'exec "$@"',
      'EOF',
      'chmod +x "$SANDBOX/bin/"*',
      'export PATH="$SANDBOX/bin:$PATH"',
      'export SANDBOX SANDBOX_STATE="$SANDBOX/state" UID_VAL VOL_MNT',
      '',
      'invoke_runner() {',
      '  (',
      '    source "$SCRIPT_UNDER_TEST"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '    get_cgroup_root_dir() { printf "%s" "$SANDBOX/cgroup"; }',
      '    get_proc_self_cgroup_path() { printf "%s" "$SANDBOX/proc_self_cgroup"; }',
      '    main "$@"',
      '  )',
      '}',
      'export SCRIPT_UNDER_TEST="$1"',
      '',
      '# A. Preflight jest wyłącznie odczytowy (nie uruchamia systemd-run --scope)',
      'MOCK_SCOPE_FAIL=1 invoke_runner --preflight-only --work-root "$VOL_MNT/pap-ci-ephemeral/pg-runs" --port 55432',
      '[[ ! -f "$SANDBOX_STATE/systemd-run.log" ]] || exit 21',
      '',
      '# B. Odmowa, gdy systemctl --user jest niedostępny',
      'set +e',
      'MOCK_USER_SYSTEMCTL_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$VOL_MNT/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-without-cgroups" 2>"$SANDBOX/err_sys"',
      'rc_sys=$?',
      'set -e',
      '[[ "$rc_sys" -eq 3 ]] || exit 22',
      '[[ ! -f "$SANDBOX_STATE/ran-without-cgroups" ]] || exit 23',
      '',
      '# C. Odmowa, gdy user-<uid>.slice ma kontrolery, ale brak delegacji cpu w user@<uid>.service/cgroup.subtree_control',
      'printf "memory pids\\n" > "$MGR_DIR/cgroup.subtree_control"',
      'set +e',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$VOL_MNT/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-without-subtree-ctrl" 2>"$SANDBOX/err_ctrl"',
      'rc_ctrl=$?',
      'set -e',
      '[[ "$rc_ctrl" -eq 3 ]] || exit 24',
      'grep -q "cpu" "$SANDBOX/err_ctrl"',
      '[[ ! -f "$SANDBOX_STATE/ran-without-subtree-ctrl" ]] || exit 25',
      'printf "cpu memory pids\\n" > "$MGR_DIR/cgroup.subtree_control"',
      '',
      '# D. Kluczowy scenariusz: systemctl --user działa, ale systemd-run --user --scope odmawia utworzenia scope',
      ': > "$SANDBOX_STATE/docker.log"',
      'set +e',
      'MOCK_SCOPE_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$VOL_MNT/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-fallback-timeout" 2>"$SANDBOX/err_scope"',
      'rc_scope=$?',
      'set -e',
      '[[ "$rc_scope" -eq 3 ]] || exit 26',
      'grep -q "systemd-run --user --scope" "$SANDBOX/err_scope"',
      '[[ ! -f "$SANDBOX_STATE/ran-fallback-timeout" ]] || exit 27',
      '! grep -q "^run " "$SANDBOX_STATE/docker.log" || exit 28',
      '',
      '# E. Scenariusz obrony w głąb: systemd-run zwraca 0, ale jądro nie wymusiło MemoryMax (memory.max=max)',
      ': > "$SANDBOX_STATE/docker.log"',
      'set +e',
      'MOCK_MEM_MAX=max PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner \\',
      '  --work-root "$VOL_MNT/pap-ci-ephemeral/pg-runs" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/ran-unbounded-mem" 2>"$SANDBOX/err_unbounded"',
      'rc_unbounded=$?',
      'set -e',
      '[[ "$rc_unbounded" -eq 3 ]] || exit 29',
      'grep -q "MemoryMax" "$SANDBOX/err_unbounded"',
      '[[ ! -f "$SANDBOX_STATE/ran-unbounded-mem" ]] || exit 30',
      '! grep -q "^run " "$SANDBOX_STATE/docker.log" || exit 31',
      'printf "SCOPE_FAIL_CLOSED_VERIFIED=OK\\n"',
    ].join('\n');

    const result = spawnSync(bashBin!, ['-c', harness, 'bash', posixScript], {
      encoding: 'utf8',
      env: buildCleanBashEnv(),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('SCOPE_FAIL_CLOSED_VERIFIED=OK');
  }, 25_000);

  it('cleans up ephemeral resources on success, command error, init error, timeout, SIGTERM, and SIGINT without touching existing server resources', () => {
    const bashBin = resolveBashExecutable();
    expect(bashBin).not.toBeNull();
    const posixScript = toPosixPath(scriptPath);

    const harness = [
      'set -euo pipefail',
      'REAL_TIMEOUT="$(command -v timeout)"',
      'SANDBOX="/tmp/pap-cleanup-harness-$$"',
      'trap \'rm -rf "$SANDBOX"\' EXIT',
      'UID_VAL="$(id -u)"',
      'SLICE_DIR="$SANDBOX/cgroup/user.slice/user-${UID_VAL}.slice"',
      'MGR_DIR="$SLICE_DIR/user@${UID_VAL}.service"',
      'VOL_MNT="$SANDBOX/mnt/HC_Volume_12345"',
      'WORK_DIR="$VOL_MNT/pap-ci-ephemeral/pg-runs"',
      'mkdir -p "$SANDBOX/bin" "$SANDBOX/state/containers" "$SANDBOX/state/networks" "$MGR_DIR/app.slice" "$WORK_DIR"',
      'printf "MemAvailable: 2560000 kB\\n" > "$SANDBOX/meminfo"',
      'printf "cpu memory pids\\n" > "$SLICE_DIR/cgroup.controllers"',
      'printf "cpu memory pids\\n" > "$MGR_DIR/cgroup.controllers"',
      'printf "cpu memory pids\\n" > "$MGR_DIR/cgroup.subtree_control"',
      '',
      '# Zasoby innych usług istniejące wcześniej na serwerze — muszą pozostać nienaruszone',
      'touch "$SANDBOX/state/containers/shorts-api-shorts-backend-1"',
      'touch "$SANDBOX/state/networks/shorts-api_default"',
      'touch "$VOL_MNT/pap-ci-ephemeral/keep-sentinel"',
      '',
      'cat > "$SANDBOX/bin/stat" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'for arg in "$@"; do [[ "$arg" == "%a" ]] && { printf "700\\n"; exit 0; }; done',
      'target="${!#}"',
      '[[ "$target" == *"HC_Volume_12345"* ]] && printf "200\\n" || printf "100\\n"',
      'EOF',
      'cat > "$SANDBOX/bin/df" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'target="${!#}"',
      'if [[ "$1" == "-PT" ]]; then',
      '  [[ "$target" == "/" ]] && printf "FS T 1K U A C M\\n/dev/sda1 ext4 39000 31000 7200 81%% /\\n" || printf "FS T 1K U A C M\\n/dev/sdb ext4 50000 1000 40000 2%% %s\\n" "$VOL_MNT"',
      'else',
      '  printf "FS 1M U A C M\\n/dev/sdb 50000 1000 24000 2%% %s\\n" "$VOL_MNT"',
      'fi',
      'EOF',
      'cat > "$SANDBOX/bin/ss" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'if [[ "${SIMULATE_PORT_BUSY:-0}" == "1" ]]; then',
      '  printf "LISTEN 0 128 127.0.0.1:55432 0.0.0.0:*\\n"',
      'fi',
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
      'unit_name=""',
      'while [[ $# -gt 0 ]]; do',
      '  case "$1" in',
      '    --unit=*) unit_name="${1#--unit=}"; shift ;;',
      '    --) shift; break ;;',
      '    *) shift ;;',
      '  esac',
      'done',
      'rel_cg="/user.slice/user-${UID_VAL}.slice/user@${UID_VAL}.service/app.slice/${unit_name}.scope"',
      'scope_dir="$SANDBOX/cgroup${rel_cg}"',
      'mkdir -p "$scope_dir"',
      'printf "0::%s\\n" "$rel_cg" > "$SANDBOX/proc_self_cgroup"',
      'printf "536870912\\n" > "$scope_dir/memory.high"',
      'printf "805306368\\n" > "$scope_dir/memory.max"',
      'printf "0\\n" > "$scope_dir/memory.swap.max"',
      'printf "50000 100000\\n" > "$scope_dir/cpu.max"',
      'printf "128\\n" > "$scope_dir/pids.max"',
      'exec "$@"',
      'EOF',
      'cat > "$SANDBOX/bin/timeout" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'if [[ "${FAST_TEST_TIMEOUT:-0}" == "1" && "$1" == "--signal=TERM" ]]; then',
      '  shift 3',
      '  exec "$REAL_TIMEOUT" --signal=TERM --kill-after=1s 0.2s "$@"',
      'fi',
      'exec "$REAL_TIMEOUT" "$@"',
      'EOF',
      'mkdir -p "$SANDBOX/psql-bin"',
      'cat > "$SANDBOX/psql-bin/psql" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '[[ "${SIMULATE_STRICT_PSQL_FAIL:-0}" == "1" ]] && { echo "Simulated psql error" >&2; exit 1; }',
      'has_no_pw_flag=0',
      'query_arg=""',
      'prev=""',
      'for arg in "$@"; do',
      '  [[ "$arg" == "-w" ]] && has_no_pw_flag=1',
      '  [[ "$prev" == "-c" ]] && query_arg="$arg"',
      '  prev="$arg"',
      'done',
      '[[ "$has_no_pw_flag" -eq 1 ]] || { echo "psql missing -w flag" >&2; exit 2; }',
      'expected_pw="$(cat "$MOCK_MOUNTED_SECRET_FILE")"',
      'if [[ -z "${PGPASSWORD:-}" || "${PGPASSWORD}" != "${expected_pw}" ]]; then',
      '  echo "psql: error: fe_sendauth: no password supplied or mismatch" >&2',
      '  exit 2',
      'fi',
      'if [[ "$query_arg" == "SHOW hba_file" ]]; then',
      '  printf "%s\\n" "$MOCK_HBA_FILE"',
      '  exit 0',
      'fi',
      'if [[ -n "$query_arg" ]]; then',
      '  printf "CMD:%s\\n" "$query_arg" >> "$MOCK_PSQL_LOG"',
      'else',
      '  cat >> "$MOCK_PSQL_LOG"',
      '  printf "\\n" >> "$MOCK_PSQL_LOG"',
      'fi',
      'EOF',
      'chmod +x "$SANDBOX/psql-bin/psql"',
      'cat > "$SANDBOX/bin/docker" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'cmd="$1"; shift',
      'case "$cmd" in',
      '  info) printf "CgroupVersion=2 MemoryLimit=true SwapLimit=true\\n" ;;',
      '  image)',
      '    [[ "${SIMULATE_IMAGE_MISSING:-0}" == "1" ]] && exit 1',
      '    exit 0',
      '    ;;',
      '  container)',
      '    sub="$1"; shift',
      '    if [[ "$sub" == "inspect" ]]; then',
      '      cname="${!#}"',
      '      if [[ ! -f "$SANDBOX_STATE/containers/$cname" ]]; then exit 1; fi',
      '      if [[ "$*" == *"State.Running"* ]]; then',
      '        [[ "${SIMULATE_CONTAINER_EXITED:-0}" == "1" ]] && printf "false\\n" || printf "true\\n"',
      '      fi',
      '      exit 0',
      '    fi',
      '    ;;',
      '  network)',
      '    sub="$1"; shift',
      '    if [[ "$sub" == "create" ]]; then',
      '      net="${!#}"',
      '      touch "$SANDBOX_STATE/networks/$net"',
      '    elif [[ "$sub" == "rm" ]]; then',
      '      [[ "${SIMULATE_NET_RM_FAIL:-0}" == "1" ]] && exit 1',
      '      rm -f "$SANDBOX_STATE/networks/$1"',
      '    elif [[ "$sub" == "inspect" ]]; then',
      '      [[ -f "$SANDBOX_STATE/networks/$1" ]] && exit 0 || exit 1',
      '    fi',
      '    ;;',
      '  run)',
      '    [[ "${SIMULATE_DOCKER_RUN_FAIL:-0}" == "1" ]] && { echo "Simulated docker run failure" >&2; exit 125; }',
      '    cname=""',
      '    secret_src=""',
      '    while [[ $# -gt 0 ]]; do',
      '      if [[ "$1" == "--name" ]]; then',
      '        cname="$2"; shift 2',
      '      elif [[ "$1" == "-v" && "$2" == *":/run/secrets/pg_pass:ro" ]]; then',
      '        secret_src="${2%:/run/secrets/pg_pass:ro}"; shift 2',
      '      else',
      '        shift',
      '      fi',
      '    done',
      '    if [[ -n "$cname" ]]; then',
      '      touch "$SANDBOX_STATE/containers/$cname"',
      '      [[ -n "$secret_src" ]] && printf "%s" "$secret_src" > "$SANDBOX_STATE/secret_path"',
      '      printf "local all all scram-sha-256\\nhost all all 127.0.0.1/32 scram-sha-256\\n" > "$SANDBOX_STATE/mock_pg_hba.conf"',
      '    fi',
      '    ;;',
      '  port)',
      '    if [[ "${SIMULATE_PORT_QUERY_FAIL:-0}" == "1" ]]; then',
      '      exit 1',
      '    elif [[ "${SIMULATE_BAD_PORT_BIND:-0}" == "1" ]]; then',
      '      printf "0.0.0.0:55432\\n"',
      '    else',
      '      printf "127.0.0.1:55432\\n"',
      '    fi',
      '    ;;',
      '  exec)',
      '    printf "EXEC:%s\\n" "$*" >> "$SANDBOX_STATE/docker_exec.log"',
      '    if [[ "$*" == *"pg_isready"* ]]; then',
      '      [[ "${SIMULATE_PG_NEVER_READY:-0}" == "1" ]] && exit 1',
      '      exit 0',
      '    fi',
      '    exec_user=""',
      '    while [[ $# -gt 0 ]]; do',
      '      case "$1" in',
      '        -i) shift ;;',
      '        -u) exec_user="$2"; shift 2 ;;',
      '        pap-ci-pg18-*) shift; break ;;',
      '        *) shift ;;',
      '      esac',
      '    done',
      '    if [[ "$exec_user" == "0" ]]; then',
      '      exit 0',
      '    fi',
      '    [[ "$exec_user" == "postgres" ]] || { echo "Expected -u postgres in docker exec, got: $exec_user" >&2; exit 92; }',
      '    secret_file="$(cat "$SANDBOX_STATE/secret_path")"',
      '    secret_val="$(cat "$secret_file")"',
      '    if grep -Fq "$secret_val" "$SANDBOX_STATE/docker_exec.log"; then',
      '      echo "Boot password leaked in docker exec arguments" >&2',
      '      exit 93',
      '    fi',
      '    if [[ "$1" == "sh" && "$2" == "-eu" && "$3" == "-c" ]]; then',
      '      orig_script="$4"',
      '      patched_script="$(printf "%s" "$orig_script" | sed "s|/run/secrets/pg_pass|$secret_file|g")"',
      '      shift 4',
      '      MOCK_MOUNTED_SECRET_FILE="$secret_file" \\',
      '      MOCK_HBA_FILE="$SANDBOX_STATE/mock_pg_hba.conf" \\',
      '      MOCK_PSQL_LOG="$SANDBOX_STATE/psql.log" \\',
      '      PATH="$SANDBOX/psql-bin:$PATH" \\',
      '      bash -eu -c "$patched_script" "$@"',
      '      exit $?',
      '    fi',
      '    echo "Unexpected docker exec invocation: $*" >&2',
      '    exit 94',
      '    ;;',
      '  rm)',
      '    cname="${!#}"',
      '    rm -f "$SANDBOX_STATE/containers/$cname"',
      '    ;;',
      'esac',
      'EOF',
      'chmod +x "$SANDBOX/bin/"*',
      'export PATH="$SANDBOX/bin:$PATH"',
      'export SANDBOX SANDBOX_STATE="$SANDBOX/state" UID_VAL VOL_MNT REAL_TIMEOUT',
      'export SCRIPT_UNDER_TEST="$1"',
      '',
      'invoke_runner() {',
      '  (',
      '    source "$SCRIPT_UNDER_TEST"',
      '    get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '    get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '    get_cgroup_root_dir() { printf "%s" "$SANDBOX/cgroup"; }',
      '    get_proc_self_cgroup_path() { printf "%s" "$SANDBOX/proc_self_cgroup"; }',
      '    get_pg_ready_max_attempts() { printf "%s" "${MOCK_READY_ATTEMPTS:-3}"; }',
      '    get_pg_ready_sleep_sec() { printf "%s" "0.01"; }',
      '    main "$@"',
      '  )',
      '}',
      '',
      'assert_clean_and_preserved() {',
      '  [[ -f "$SANDBOX_STATE/containers/shorts-api-shorts-backend-1" ]] || exit 31',
      '  [[ -f "$SANDBOX_STATE/networks/shorts-api_default" ]] || exit 32',
      '  [[ -f "$VOL_MNT/pap-ci-ephemeral/keep-sentinel" ]] || exit 33',
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
      '# 0. Negatywne preflight/pre-start: za mało RAM, zajęty port TCP oraz brak obrazu bez --pull-if-missing (exit 3)',
      'printf "MemAvailable: 512000 kB\\n" > "$SANDBOX/meminfo"',
      'set +e',
      'invoke_runner --preflight-only --work-root "$WORK_DIR" --port 55432 2>"$SANDBOX/err_mem"',
      'rc_mem=$?',
      'set -e',
      '[[ "$rc_mem" -eq 3 ]] || exit 301',
      'printf "MemAvailable: 2560000 kB\\n" > "$SANDBOX/meminfo"',
      '',
      'set +e',
      'SIMULATE_PORT_BUSY=1 invoke_runner --preflight-only --work-root "$WORK_DIR" --port 55432 2>"$SANDBOX/err_busy"',
      'rc_busy=$?',
      'set -e',
      '[[ "$rc_busy" -eq 3 ]] || exit 302',
      '',
      'set +e',
      'SIMULATE_IMAGE_MISSING=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 -- true 2>"$SANDBOX/err_img"',
      'rc_img=$?',
      'set -e',
      '[[ "$rc_img" -eq 3 ]] || exit 303',
      'assert_clean_and_preserved',
      '',
      '# 1. Sukces w trybie fixture (exit 0)',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- bash -c \'[[ "$PAP_DATABASE_ENV" == "test" && "$DATABASE_URL" == postgres://pap_test:*@127.0.0.1:55432/pap_test ]]\'',
      'assert_clean_and_preserved',
      '',
      '# 1b. Sukces w trybie --mode strict-migrator --bootstrap-runtime-role (autoryzacja SCRAM z /run/secrets/pg_pass + pg_hba reject)',
      ': > "$SANDBOX_STATE/psql.log"',
      ': > "$SANDBOX_STATE/docker_exec.log"',
      'PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  --mode strict-migrator --bootstrap-runtime-role \\',
      '  -- bash -c \'[[ "$DATABASE_URL" == postgres://pap_test:*@127.0.0.1:55432/pap_test && "$PAP_EPHEMERAL_RUNTIME_DATABASE_URL" == postgres://pap_test_app:*@127.0.0.1:55432/pap_test && "$DATABASE_URL" != "$PAP_EPHEMERAL_RUNTIME_DATABASE_URL" ]]\'',
      'assert_clean_and_preserved',
      'grep -q "CREATE ROLE pap_test LOGIN" "$SANDBOX_STATE/psql.log"',
      'grep -q "CREATE ROLE pap_test_app LOGIN" "$SANDBOX_STATE/psql.log"',
      'grep -q "CMD:SELECT pg_reload_conf();" "$SANDBOX_STATE/psql.log"',
      'head -n 2 "$SANDBOX_STATE/mock_pg_hba.conf" | grep -q "host all postgres 0.0.0.0/0 reject"',
      'head -n 2 "$SANDBOX_STATE/mock_pg_hba.conf" | grep -q "host all postgres ::/0 reject"',
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
      '# 3a. Nieudany start docker run po utworzeniu RUN_DIR i sieci Docker -> pełne sprzątanie',
      'set +e',
      'SIMULATE_DOCKER_RUN_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-run-fail" 2>"$SANDBOX/err_runfail"',
      'rc_runfail=$?',
      'set -e',
      '[[ "$rc_runfail" -eq 125 ]] || exit 349',
      '[[ ! -f "$SANDBOX_STATE/should-not-run-on-run-fail" ]] || exit 350',
      'assert_clean_and_preserved',
      '',
      '# 3b. Błąd bindowania portu kontenera 0.0.0.0 oraz pusty wynik docker port po crashu kontenera (exit 4) + pełne sprzątanie',
      'set +e',
      'SIMULATE_BAD_PORT_BIND=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-bad-port" 2>"$SANDBOX/err_port"',
      'rc_port=$?',
      'SIMULATE_PORT_QUERY_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-dead-port" 2>"$SANDBOX/err_deadport"',
      'rc_deadport=$?',
      'set -e',
      '[[ "$rc_port" -eq 4 && "$rc_deadport" -eq 4 ]] || exit 351',
      '[[ ! -f "$SANDBOX_STATE/should-not-run-on-bad-port" && ! -f "$SANDBOX_STATE/should-not-run-on-dead-port" ]] || exit 352',
      'assert_clean_and_preserved',
      '',
      '# 3c. Przedwczesne wyjście kontenera (State.Running=false) oraz brak gotowości pg_isready (exit 4) + pełne sprzątanie',
      'set +e',
      'SIMULATE_CONTAINER_EXITED=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-exited" 2>"$SANDBOX/err_exited"',
      'rc_exited=$?',
      'SIMULATE_PG_NEVER_READY=1 MOCK_READY_ATTEMPTS=2 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-unready" 2>"$SANDBOX/err_unready"',
      'rc_unready=$?',
      'SIMULATE_STRICT_PSQL_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 \\',
      '  --mode strict-migrator --bootstrap-runtime-role \\',
      '  -- touch "$SANDBOX_STATE/should-not-run-on-psql-fail" 2>"$SANDBOX/err_psqlfail"',
      'rc_psqlfail=$?',
      'set -e',
      '[[ "$rc_exited" -eq 4 && "$rc_unready" -eq 4 && "$rc_psqlfail" -eq 4 ]] || exit 353',
      '[[ ! -f "$SANDBOX_STATE/should-not-run-on-exited" && ! -f "$SANDBOX_STATE/should-not-run-on-unready" && ! -f "$SANDBOX_STATE/should-not-run-on-psql-fail" ]] || exit 354',
      'assert_clean_and_preserved',
      '',
      '# 4. Timeout polecenia testowego (exit 124 / 137)',
      'set +e',
      'FAST_TEST_TIMEOUT=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 --timeout 10 \\',
      '  -- sleep 10',
      'rc_to=$?',
      'set -e',
      '[[ "$rc_to" -eq 124 || "$rc_to" -eq 137 ]] || { echo "Expected 124 or 137, got $rc_to" >&2; exit 36; }',
      'assert_clean_and_preserved',
      '',
      '# 5a. Przerwanie sygnałem SIGTERM oraz powtórzonym SIGINT w trakcie sprzątania (exit 143)',
      "PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 bash -c '",
      '  source "$SCRIPT_UNDER_TEST"',
      '  get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '  get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '  get_cgroup_root_dir() { printf "%s" "$SANDBOX/cgroup"; }',
      '  get_proc_self_cgroup_path() { printf "%s" "$SANDBOX/proc_self_cgroup"; }',
      '  main "$@"',
      '\' bash --work-root "$WORK_DIR" --port 55432 \\',
      '  -- bash -c \'trap "exit 143" TERM; touch "$SANDBOX_STATE/child-started"; while :; do sleep 0.1; done\' &',
      'bg_pid=$!',
      'for _ in $(seq 1 50); do [[ -f "$SANDBOX_STATE/child-started" ]] && break; sleep 0.05; done',
      '[[ -f "$SANDBOX_STATE/child-started" ]] || exit 37',
      'kill -TERM "$bg_pid"',
      'kill -INT "$bg_pid" 2>/dev/null || true',
      'set +e',
      'wait "$bg_pid"',
      'rc_sig=$?',
      'set -e',
      '[[ "$rc_sig" -eq 143 ]] || { echo "Expected 143, got $rc_sig" >&2; exit 38; }',
      'assert_clean_and_preserved',
      '',
      '# 5b. Bezpośrednie przerwanie sygnałem SIGINT w trakcie oczekiwania wait (exit 130) + pełne sprzątanie',
      'set +e',
      '(',
      '  printf "%s" "$BASHPID" > "$SANDBOX_STATE/runner_int.pid"',
      '  source "$SCRIPT_UNDER_TEST"',
      '  get_volume_mount_parent() { printf "%s" "$SANDBOX/mnt"; }',
      '  get_proc_meminfo_path() { printf "%s" "$SANDBOX/meminfo"; }',
      '  get_cgroup_root_dir() { printf "%s" "$SANDBOX/cgroup"; }',
      '  get_proc_self_cgroup_path() { printf "%s" "$SANDBOX/proc_self_cgroup"; }',
      '  get_pg_ready_sleep_sec() { printf "%s" "0.01"; }',
      '  PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 main --work-root "$WORK_DIR" --port 55432 \\',
      '    -- bash -c \'trap "exit 130" INT TERM; kill -INT "$(cat "$SANDBOX_STATE/runner_int.pid")"; while :; do sleep 0.1; done\'',
      ') 2>"$SANDBOX/err_int"',
      'rc_int=$?',
      'set -e',
      '[[ "$rc_int" -eq 130 ]] || { echo "Expected 130 on SIGINT, got $rc_int" >&2; exit 382; }',
      'assert_clean_and_preserved',
      '',
      '# 6. Wykrycie nieusuniętej sieci Docker w cleanup podnosi kod wyjścia 0 -> 5',
      'set +e',
      'SIMULATE_NET_RM_FAIL=1 PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 invoke_runner --work-root "$WORK_DIR" --port 55432 -- true 2>"$SANDBOX/err_netrm"',
      'rc_netfail=$?',
      'set -e',
      '[[ "$rc_netfail" -eq 5 ]] || { echo "Expected 5 on cleanup failure, got $rc_netfail" >&2; exit 39; }',
      'rm -f "$SANDBOX_STATE/networks/"pap-ci-pg-net-*',
      'assert_clean_and_preserved',
      'printf "ALL_CLEANUP_PATHS_VERIFIED=OK\\n"',
    ].join('\n');

    const harnessDir = mkdtempSync(resolve(tmpdir(), 'pap-harness-'));
    try {
      const harnessFile = resolve(harnessDir, 'cleanup-harness.sh');
      writeFileSync(harnessFile, `${harness}\n`, 'utf8');
      const result = spawnSync(bashBin!, [toPosixPath(harnessFile), posixScript], {
        encoding: 'utf8',
        env: buildCleanBashEnv(),
        timeout: 80_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('ALL_CLEANUP_PATHS_VERIFIED=OK');
    } finally {
      rmSync(harnessDir, { recursive: true, force: true });
    }
  }, 90_000);
});
