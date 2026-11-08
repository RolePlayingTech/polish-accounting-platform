#!/usr/bin/env bash
# Deterministyczny runner bramki jakości QA dla izolowanego środowiska Hetzner (Issue #85, ADR-006).
# Opakowuje scripts/hetzner/with-ephemeral-pg18.sh, wymusza limity cgroups v2 (systemd-run --user --scope)
# także dla kroków statycznych/jednostkowych, jawnie uruchamia @pap/db test:integration ORAZ
# @pap/api test:integration (oraz opcjonalnie test:adversarial), weryfikuje sprzątanie zasobów tymczasowych
# i generuje deterministyczny raport dowodowy JSON + Markdown przypięty do dokładnego SHA.

set -euo pipefail
set +x
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
EPHEMERAL_PG_RUNNER="${REPO_ROOT}/scripts/hetzner/with-ephemeral-pg18.sh"

readonly -a HOST_SCOPE_LIMIT_ARGS=(
  -p MemoryHigh=512M
  -p MemoryMax=768M
  -p MemorySwapMax=0
  -p CPUQuota=50%
  -p TasksMax=512
)

PREFLIGHT_ONLY=0
WORK_ROOT=""
PORT=55432
TIMEOUT_SEC=300
SCOPE="auto"
REPORT_JSON=""
REPORT_MD=""

usage() {
  cat <<'EOF'
Użycie:
  scripts/qa/run-hetzner-qa.sh --preflight-only [--port 55432] [--work-root <katalog>]
  PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/qa/run-hetzner-qa.sh \
    --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral[/podkatalog] \
    [--port 55432] \
    [--scope auto|docs|db-api|adversarial|full] \
    [--timeout 300] \
    [--report-json <ścieżka.json>] \
    [--report-md <ścieżka.md>]

Zakresy (--scope):
  auto         Wyznacza zakres na podstawie zmienionych plików względem origin/main (domyślny).
  docs         Wyłącznie preflight Git/sekretów i test granic architektonicznych (bez PG18).
  db-api       Preflight + typecheck/lint/unit + @pap/db test:integration ORAZ @pap/api test:integration na efemerycznym PG18.
  adversarial  Uruchamia zestaw kontrprzykładów (@pap/api test:adversarial) na efemerycznym PG18.
  full         Pełny przebieg: preflight + typecheck/lint/unit + @pap/db test:integration + @pap/api test:integration + @pap/api test:adversarial.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --preflight-only)
      PREFLIGHT_ONLY=1
      shift
      ;;
    --work-root)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --work-root wymaga ścieżki." >&2; exit 2; }
      WORK_ROOT="$2"
      shift 2
      ;;
    --port)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --port wymaga numeru portu." >&2; exit 2; }
      PORT="$2"
      shift 2
      ;;
    --scope)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --scope wymaga wartości (auto|docs|db-api|adversarial|full)." >&2; exit 2; }
      SCOPE="$2"
      shift 2
      ;;
    --timeout)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --timeout wymaga liczby sekund." >&2; exit 2; }
      TIMEOUT_SEC="$2"
      shift 2
      ;;
    --report-json)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --report-json wymaga ścieżki pliku." >&2; exit 2; }
      REPORT_JSON="$2"
      shift 2
      ;;
    --report-md)
      [[ $# -ge 2 ]] || { echo "[pap-qa] BŁĄD: --report-md wymaga ścieżki pliku." >&2; exit 2; }
      REPORT_MD="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[pap-qa] BŁĄD: Nieznana opcja: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "${SCOPE}" in
  auto|docs|db-api|adversarial|full) ;;
  *)
    echo "[pap-qa] BŁĄD: Nieobsługiwany --scope=${SCOPE} (dozwolone: auto, docs, db-api, adversarial, full)." >&2
    exit 2
    ;;
esac

if [[ -d "/opt/pap-runtime/current/bin" ]]; then
  export PATH="/opt/pap-runtime/current/bin:${PATH}"
fi
if [[ -d "/opt/pap-runtime/pnpm" ]]; then
  export PATH="/opt/pap-runtime/pnpm:${PATH}"
fi
if [[ -d "/opt/pap-runtime/corepack-home" ]]; then
  export COREPACK_HOME="/opt/pap-runtime/corepack-home"
  export COREPACK_ENABLE_NETWORK=0
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  export COREPACK_DEFAULT_TO_LATEST=0
fi

export CI="1"
export NEXT_TELEMETRY_DISABLED="1"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
export TURBO_CONCURRENCY="${TURBO_CONCURRENCY:-1}"
export RAYON_NUM_THREADS="${RAYON_NUM_THREADS:-2}"
export TOKIO_WORKER_THREADS="${TOKIO_WORKER_THREADS:-2}"

run_bounded_host_cmd() {
  local unit_name="pap-qa-host-$(openssl rand -hex 6)"
  local host_timeout_sec=$(( TIMEOUT_SEC < 600 ? 600 : TIMEOUT_SEC ))
  systemd-run --user --scope --quiet \
    --unit="${unit_name}" \
    "${HOST_SCOPE_LIMIT_ARGS[@]}" \
    -- \
    timeout --signal=TERM --kill-after=15s "${host_timeout_sec}s" \
    "$@"
}

cd "${REPO_ROOT}"

if (( PREFLIGHT_ONLY == 1 )); then
  node "${REPO_ROOT}/scripts/qa/preflight.mjs"
  if [[ -n "${WORK_ROOT}" ]]; then
    "${EPHEMERAL_PG_RUNNER}" --preflight-only --port "${PORT}" --work-root "${WORK_ROOT}"
  else
    "${EPHEMERAL_PG_RUNNER}" --preflight-only --port "${PORT}"
  fi
  exit 0
fi

HEAD_SHA="$(git rev-parse HEAD)"
BASE_SHA="$(git rev-parse --verify -q origin/main || git rev-parse HEAD)"
HOSTNAME_VAL="$(hostname 2>/dev/null || printf 'unknown-host')"
NODE_VER="$(node -v 2>/dev/null || printf 'unknown')"

TMP_RESULTS_DIR="$(mktemp -d)"
cleanup_tmp() {
  rm -rf "${TMP_RESULTS_DIR}" >/dev/null 2>&1 || true
}
trap cleanup_tmp EXIT

CHECKS_FILE="${TMP_RESULTS_DIR}/checks.jsonl"
: > "${CHECKS_FILE}"

record_check() {
  local id="$1"
  local cmd="$2"
  local env_name="$3"
  local status="$4"
  local duration="$5"
  node -e '
    const [id, command, environment, status, durationStr] = process.argv.slice(1);
    const durationSec = durationStr === "null" ? null : Number(durationStr);
    process.stdout.write(JSON.stringify({ id, command, environment, status, durationSec }) + "\n");
  ' "${id}" "${cmd}" "${env_name}" "${status}" "${duration}" >> "${CHECKS_FILE}"
}

run_step() {
  local id="$1"
  local cmd_display="$2"
  local env_name="$3"
  shift 3
  local start_ts end_ts elapsed rc=0
  start_ts="$(date +%s)"
  if "$@"; then
    rc=0
  else
    rc=$?
  fi
  end_ts="$(date +%s)"
  elapsed="$(( end_ts - start_ts ))"
  if (( rc == 0 )); then
    record_check "${id}" "${cmd_display}" "${env_name}" "PASS" "${elapsed}"
  else
    record_check "${id}" "${cmd_display}" "${env_name}" "FAIL" "${elapsed}"
  fi
  return "${rc}"
}

OVERALL_RC=0
INITIAL_PREFLIGHT_JSON="${TMP_RESULTS_DIR}/initial-preflight.json"
node "${REPO_ROOT}/scripts/qa/preflight.mjs" --allow-main-inspect --json > "${INITIAL_PREFLIGHT_JSON}" || true

# 1. Preflight Git + skan sekretów
if ! run_step "git_preflight_and_secret_scan" "node scripts/qa/preflight.mjs" "local" \
  run_bounded_host_cmd node "${REPO_ROOT}/scripts/qa/preflight.mjs"; then
  OVERALL_RC=1
fi

# 2. Granice architektoniczne
if ! run_step "architecture_boundaries" "pnpm test:arch" "local" \
  run_bounded_host_cmd corepack pnpm test:arch; then
  OVERALL_RC=1
fi

NEED_CODE_CHECKS=0
NEED_DB_API_INTEGRATION=0
NEED_ADVERSARIAL=0

if [[ "${SCOPE}" == "auto" ]]; then
  AUTO_FLAGS="$(node -e '
    import { readFileSync } from "node:fs";
    const res = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const c = res.classification;
    const code = c.requiredChecks.some((ch) => ch.id === "typecheck_and_lint") ? 1 : 0;
    const dbApi = c.requiresBothDbAndApiIntegration ? 1 : 0;
    const adv = c.requiresAdversarialSuite ? 1 : 0;
    console.log(`${code} ${dbApi} ${adv}`);
  ' "${INITIAL_PREFLIGHT_JSON}")"
  read -r NEED_CODE_CHECKS NEED_DB_API_INTEGRATION NEED_ADVERSARIAL <<< "${AUTO_FLAGS}"
elif [[ "${SCOPE}" == "docs" ]]; then
  NEED_CODE_CHECKS=0
  NEED_DB_API_INTEGRATION=0
  NEED_ADVERSARIAL=0
elif [[ "${SCOPE}" == "db-api" ]]; then
  NEED_CODE_CHECKS=1
  NEED_DB_API_INTEGRATION=1
  NEED_ADVERSARIAL=0
elif [[ "${SCOPE}" == "adversarial" ]]; then
  NEED_CODE_CHECKS=0
  NEED_DB_API_INTEGRATION=0
  NEED_ADVERSARIAL=1
elif [[ "${SCOPE}" == "full" ]]; then
  NEED_CODE_CHECKS=1
  NEED_DB_API_INTEGRATION=1
  NEED_ADVERSARIAL=1
fi

BUILD_OK=1
if (( NEED_CODE_CHECKS == 1 || NEED_DB_API_INTEGRATION == 1 || NEED_ADVERSARIAL == 1 )); then
  # Budujemy pakiety zależności wewnątrz limitu cgroups przed uruchomieniem typecheck/test/integracji
  if ! run_step "build_integration_dependencies" "pnpm --filter @pap/db... --filter @pap/mcp... build" "local" \
    run_bounded_host_cmd corepack pnpm --filter @pap/db... --filter @pap/mcp... build; then
    OVERALL_RC=1
    BUILD_OK=0
  fi
fi

run_typecheck_and_lint() {
  run_bounded_host_cmd corepack pnpm typecheck && run_bounded_host_cmd corepack pnpm lint
}

if (( NEED_CODE_CHECKS == 1 )); then
  if ! run_step "typecheck_and_lint" "pnpm typecheck && pnpm lint" "local" \
    run_typecheck_and_lint; then
    OVERALL_RC=1
  fi
  if ! run_step "unit_tests" "pnpm test" "local" \
    run_bounded_host_cmd corepack pnpm test; then
    OVERALL_RC=1
  fi
else
  record_check "typecheck_and_lint" "pnpm typecheck && pnpm lint" "local" "NOT RUN" "null"
  record_check "unit_tests" "pnpm test" "local" "NOT RUN" "null"
fi

CLEANUP_VERIFIED="null"

if (( NEED_DB_API_INTEGRATION == 1 || NEED_ADVERSARIAL == 1 )); then
  if [[ -z "${WORK_ROOT}" ]]; then
    echo "[pap-qa] BŁĄD: Testy integracyjne PG18 wymagają podania --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral[/podkatalog]." >&2
    exit 2
  fi

  if (( BUILD_OK == 0 )); then
    record_check "hetzner_pg18_db_integration" "pnpm --filter @pap/db test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
    record_check "hetzner_pg18_api_integration" "pnpm --filter @pap/api test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
    record_check "hetzner_pg18_adversarial_regressions" "pnpm --filter @pap/api test:adversarial" "hetzner-ephemeral-pg18" "NOT RUN" "null"
    CLEANUP_VERIFIED="false"
  else
    if (( NEED_DB_API_INTEGRATION == 1 )); then
      if ! run_step "hetzner_pg18_db_integration" "pnpm --filter @pap/db test:integration" "hetzner-ephemeral-pg18" \
        "${EPHEMERAL_PG_RUNNER}" \
          --work-root "${WORK_ROOT}" \
          --port "${PORT}" \
          --mode strict-migrator \
          --bootstrap-runtime-role \
          --timeout "${TIMEOUT_SEC}" \
          -- corepack pnpm --filter @pap/db test:integration; then
        OVERALL_RC=1
      fi

      if ! run_step "hetzner_pg18_api_integration" "pnpm --filter @pap/api test:integration" "hetzner-ephemeral-pg18" \
        "${EPHEMERAL_PG_RUNNER}" \
          --work-root "${WORK_ROOT}" \
          --port "${PORT}" \
          --mode strict-migrator \
          --bootstrap-runtime-role \
          --timeout "${TIMEOUT_SEC}" \
          -- corepack pnpm --filter @pap/api test:integration; then
        OVERALL_RC=1
      fi
    else
      record_check "hetzner_pg18_db_integration" "pnpm --filter @pap/db test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
      record_check "hetzner_pg18_api_integration" "pnpm --filter @pap/api test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
    fi

    if (( NEED_ADVERSARIAL == 1 )); then
      if ! run_step "hetzner_pg18_adversarial_regressions" "pnpm --filter @pap/api test:adversarial" "hetzner-ephemeral-pg18" \
        "${EPHEMERAL_PG_RUNNER}" \
          --work-root "${WORK_ROOT}" \
          --port "${PORT}" \
          --mode strict-migrator \
          --bootstrap-runtime-role \
          --timeout "${TIMEOUT_SEC}" \
          -- corepack pnpm --filter @pap/api test:adversarial; then
        OVERALL_RC=1
      fi
    else
      record_check "hetzner_pg18_adversarial_regressions" "pnpm --filter @pap/api test:adversarial" "hetzner-ephemeral-pg18" "NOT RUN" "null"
    fi

    # Weryfikacja braku pozostałości po kontenerach, sieciach i katalogach run-*
    LEFTOVER_CONTAINERS="$(docker ps -a --filter 'name=pap-ci-pg18-' -q 2>/dev/null || true)"
    LEFTOVER_NETWORKS="$(docker network ls --filter 'name=pap-ci-pg-net-' -q 2>/dev/null || true)"
    LEFTOVER_RUN_DIRS="$(find "${WORK_ROOT}" -maxdepth 1 -name 'run-*' 2>/dev/null || true)"
    if [[ -z "${LEFTOVER_CONTAINERS}" && -z "${LEFTOVER_NETWORKS}" && -z "${LEFTOVER_RUN_DIRS}" ]]; then
      CLEANUP_VERIFIED="true"
    else
      CLEANUP_VERIFIED="false"
      OVERALL_RC=1
    fi
  fi
else
  record_check "hetzner_pg18_db_integration" "pnpm --filter @pap/db test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
  record_check "hetzner_pg18_api_integration" "pnpm --filter @pap/api test:integration" "hetzner-ephemeral-pg18" "NOT RUN" "null"
  record_check "hetzner_pg18_adversarial_regressions" "pnpm --filter @pap/api test:adversarial" "hetzner-ephemeral-pg18" "NOT RUN" "null"
fi

REPORT_RC=0
node -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { formatEvidenceReportMarkdown, validateEvidenceReport } from "./scripts/qa/verification-matrix.mjs";

  const [checksFile, preflightJsonPath, headSha, baseSha, hostName, nodeVer, cleanupStr, reportJsonPath, reportMdPath] = process.argv.slice(1);
  const checks = readFileSync(checksFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  const preflight = JSON.parse(readFileSync(preflightJsonPath, "utf8"));
  const cleanupVerified = cleanupStr === "true" ? true : cleanupStr === "false" ? false : null;

  const report = {
    generatedAt: new Date().toISOString(),
    headSha,
    baseSha,
    environment: `${hostName} (Node ${nodeVer})`,
    changedFiles: preflight.changedFiles.length > 0 ? preflight.changedFiles : ["README.md"],
    cleanupVerified,
    independentReviewStatus: "PENDING",
    checks,
  };

  const validation = validateEvidenceReport(report, headSha);
  const fullReport = { ...report, validation };
  const markdown = formatEvidenceReportMarkdown(report);

  if (reportJsonPath) {
    writeFileSync(reportJsonPath, JSON.stringify(fullReport, null, 2) + "\n", "utf8");
  }
  if (reportMdPath) {
    writeFileSync(reportMdPath, markdown + "\n", "utf8");
  }
  console.log("\n" + markdown);

  if (!validation.technicalChecksValid) {
    process.exit(1);
  }
' "${CHECKS_FILE}" "${INITIAL_PREFLIGHT_JSON}" "${HEAD_SHA}" "${BASE_SHA}" "${HOSTNAME_VAL}" "${NODE_VER}" "${CLEANUP_VERIFIED}" "${REPORT_JSON}" "${REPORT_MD}" || REPORT_RC=$?

if (( REPORT_RC != 0 )); then
  OVERALL_RC=1
fi

exit "${OVERALL_RC}"
