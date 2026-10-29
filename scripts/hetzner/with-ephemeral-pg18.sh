#!/usr/bin/env bash
# Bezpieczny, samooczyszczający się runner tymczasowego PostgreSQL 18.6 dla testów integracyjnych na Hetznerze.
# Nie instaluje usług systemowych, nie dotyka bazy ani plików stagingu i działa wyłącznie na loopbacku 127.0.0.1.

set -euo pipefail
set +x
umask 077

readonly PG_IMAGE="postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5"
readonly DEFAULT_PORT=55432
readonly DEFAULT_TIMEOUT_SEC=300
readonly MIN_MEM_AVAILABLE_MIB=1400
readonly MIN_ROOT_FREE_MIB=3072
readonly MIN_WORK_FREE_MIB=2048

PREFLIGHT_ONLY=0
PULL_IF_MISSING=0
BOOTSTRAP_RUNTIME_ROLE=0
MODE="fixture"
PORT="${DEFAULT_PORT}"
TIMEOUT_SEC="${DEFAULT_TIMEOUT_SEC}"
WORK_ROOT=""

RUN_DIR=""
CONTAINER_NAME=""
NET_NAME=""

log_info() {
  printf '[pap-ephemeral-pg18] INFO: %s\n' "$*" >&2
}

log_error() {
  printf '[pap-ephemeral-pg18] BŁĄD: %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
Użycie:
  scripts/hetzner/with-ephemeral-pg18.sh --preflight-only [--port 55432] [--work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral/pg-runs]
  PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/hetzner/with-ephemeral-pg18.sh \
    --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral/pg-runs \
    [--port 55432] \
    [--mode fixture|strict-migrator] \
    [--bootstrap-runtime-role] \
    [--timeout 300] \
    [--pull-if-missing] \
    -- <polecenie-testowe...>

Opcje:
  --preflight-only          Wyłącznie odczytowa kontrola zasobów, cgroups v2, wolumenu, Dockera i portu (bez tworzenia zasobów).
  --work-root <katalog>     Wydzielony katalog na zamontowanym wolumenie blokowym (/mnt/HC_Volume_<ID>/pap-ci-ephemeral[/...]).
  --port <15432..60999>     Lokalny port loopback 127.0.0.1 (domyślnie 55432; port 5432 stagingu jest zablokowany).
  --mode <tryb>             fixture (domyślny dla pnpm test:integration) albo strict-migrator (pap_test jako NOSUPERUSER/NOBYPASSRLS).
  --bootstrap-runtime-role  W trybie strict-migrator tworzy również nieuprzywilejowany login pap_test_app.
  --timeout <10..900>       Limit czasu polecenia testowego w sekundach (domyślnie 300).
  --pull-if-missing         Pozwala pobrać przypięty obraz postgres:18.6-alpine po SHA-256, jeśli brak go lokalnie.
  -h, --help                Wyświetla niniejszą pomoc.
EOF
}

is_forbidden_path() {
  local candidate="$1"
  case "${candidate}" in
    ""|"/"|"/etc"|"/etc/"*|"/var/www/pap-staging"|"/var/www/pap-staging/"*|"/opt/pap-runtime"|"/opt/pap-runtime/"*|"/var/lib/pap-acme"|"/var/lib/pap-acme/"*|"/var/www/mumro"|"/var/www/mumro/"*|"/home/admin/stacks"|"/home/admin/stacks/"*)
      return 0
      ;;
  esac
  if [[ "${candidate}" == */pap-staging || "${candidate}" == */pap-staging/* ]]; then
    return 0
  fi
  return 1
}

is_allowed_work_root_path() {
  local candidate="$1"
  if is_forbidden_path "${candidate}"; then
    return 1
  fi
  if [[ "${candidate}" =~ ^/mnt/HC_Volume_[A-Za-z0-9._-]+/pap-ci-ephemeral(/.*)?$ ]]; then
    return 0
  fi
  return 1
}

resolve_and_validate_work_root() {
  local raw_path="$1"
  local require_existing="$2"
  local trimmed logical_path resolved_path

  trimmed="${raw_path%/}"
  if [[ -z "${trimmed}" ]]; then
    trimmed="/"
  fi

  if is_forbidden_path "${trimmed}"; then
    log_error "Katalog --work-root (${trimmed}) narusza chronioną ścieżkę stagingu lub innej usługi."
    exit 2
  fi

  if [[ -L "${trimmed}" ]]; then
    log_error "Katalog --work-root (${raw_path}) nie może być dowiązaniem symbolicznym."
    exit 2
  fi

  logical_path="$(realpath -s -m "${trimmed}" 2>/dev/null || true)"
  if [[ -z "${logical_path}" ]]; then
    log_error "Nie można wyznaczyć ścieżki logicznej dla --work-root (${raw_path})."
    exit 2
  fi

  if (( require_existing == 1 )); then
    if [[ ! -d "${trimmed}" || ! -w "${trimmed}" ]]; then
      log_error "Wydzielony katalog --work-root (${trimmed}) nie istnieje lub nie jest zapisywalny."
      exit 2
    fi
    resolved_path="$(realpath -e "${trimmed}" 2>/dev/null || true)"
  else
    resolved_path="$(realpath -m "${trimmed}" 2>/dev/null || true)"
  fi

  if [[ -z "${resolved_path}" ]]; then
    log_error "Nie można rozwiązać kanonicznej ścieżki --work-root (${raw_path})."
    exit 2
  fi

  if [[ "${resolved_path}" != "${logical_path}" ]]; then
    log_error "Ścieżka --work-root (${raw_path} -> ${resolved_path}) zawiera niedozwolone dowiązanie symboliczne."
    exit 2
  fi

  if ! is_allowed_work_root_path "${resolved_path}"; then
    log_error "Katalog --work-root (${resolved_path}) musi znajdować się wewnątrz zatwierdzonego obszaru /mnt/HC_Volume_<ID>/pap-ci-ephemeral na osobnym wolumenie."
    exit 2
  fi

  printf '%s' "${resolved_path}"
}

verify_separate_volume_mount() {
  local resolved_work_root="$1"
  local probe_override="${2:-}"
  local expected_mount probe_dir
  local root_dev root_mnt work_dev work_free_mib work_mnt

  expected_mount="/mnt/$(printf '%s' "${resolved_work_root#/mnt/}" | cut -d/ -f1)"
  if [[ -n "${probe_override}" && -d "${probe_override}" ]]; then
    probe_dir="${probe_override}"
  elif [[ -d "${resolved_work_root}" ]]; then
    probe_dir="${resolved_work_root}"
  elif [[ -d "${expected_mount}" ]]; then
    probe_dir="${expected_mount}"
  else
    log_error "Wymagany wolumen blokowy ${expected_mount} nie istnieje na hoście."
    exit 3
  fi

  read -r root_dev _ _ _ _ root_mnt < <(df -Pm / | awk 'NR==2 { print $1, $2, $3, $4, $5, $6 }')
  read -r work_dev _ _ work_free_mib _ work_mnt < <(df -Pm "${probe_dir}" | awk 'NR==2 { print $1, $2, $3, $4, $5, $6 }')

  if [[ -z "${work_mnt}" || "${work_mnt}" == "/" || "${work_mnt}" == "${root_mnt}" || "${work_dev}" == "${root_dev}" || "${work_mnt}" != "${expected_mount}" ]]; then
    log_error "Katalog --work-root (${resolved_work_root}) nie znajduje się na odrębnym zamontowanym wolumenie blokowym ${expected_mount} (mount=${work_mnt:-brak}, dev=${work_dev:-brak})."
    exit 3
  fi

  if [[ ! "${work_free_mib}" =~ ^[0-9]+$ ]] || (( work_free_mib < MIN_WORK_FREE_MIB )); then
    log_error "Zbyt mało wolnego miejsca na wolumenie ${work_mnt}: ${work_free_mib:-0} MiB (minimum: ${MIN_WORK_FREE_MIB} MiB)."
    exit 3
  fi
}

detect_user_systemd_cgroup() {
  local uid_val cgroup_file controllers
  uid_val="${1:-$(id -u)}"
  cgroup_file="${2:-/sys/fs/cgroup/user.slice/user-${uid_val}.slice/cgroup.controllers}"

  if ! command -v systemd-run >/dev/null 2>&1 || ! command -v systemctl >/dev/null 2>&1; then
    printf 'no'
    return 0
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    printf 'no'
    return 0
  fi
  if [[ ! -r "${cgroup_file}" ]]; then
    printf 'no'
    return 0
  fi

  controllers=" $(tr '\n' ' ' < "${cgroup_file}") "
  if [[ "${controllers}" == *" cpu "* && "${controllers}" == *" memory "* && "${controllers}" == *" pids "* ]]; then
    printf 'yes'
    return 0
  fi

  printf 'no'
}

enforce_user_systemd_scope() {
  local preflight_only="$1"
  local user_systemd_available="$2"
  if (( preflight_only == 0 )) && [[ "${user_systemd_available}" != "yes" ]]; then
    log_error "Brak działającego systemd-run --user --scope z delegacją kontrolerów cgroups v2 (cpu, memory, pids). Tryb wykonawczy działa fail-closed bez limitów zasobów."
    exit 3
  fi
}

validate_port() {
  local p="$1"
  if [[ ! "${p}" =~ ^[0-9]+$ ]]; then
    log_error "Port musi być liczbą całkowitą (otrzymano: ${p})."
    exit 2
  fi
  if (( p == 5432 )); then
    log_error "Port 5432 jest zarezerwowany dla pap_staging — użyj wysokiego portu testowego (np. 55432)."
    exit 2
  fi
  if (( p < 15432 || p > 60999 )); then
    log_error "Port testowy musi należeć do zakresu 15432..60999 (otrzymano: ${p})."
    exit 2
  fi
}

cleanup() {
  local exit_code=$?
  set +e

  if [[ -n "${CONTAINER_NAME}" ]]; then
    docker exec -u 0 "${CONTAINER_NAME}" sh -c 'rm -rf /var/lib/postgresql/* /var/lib/postgresql/.[!.]* 2>/dev/null || true' >/dev/null 2>&1
    docker rm -fv "${CONTAINER_NAME}" >/dev/null 2>&1
  fi

  if [[ -n "${RUN_DIR}" && -d "${RUN_DIR}/pgdata" ]]; then
    rm -rf "${RUN_DIR}/pgdata" >/dev/null 2>&1 || \
      docker run --rm --pull=never -u 0 -v "${RUN_DIR}/pgdata:/cleanup" --entrypoint sh "${PG_IMAGE}" \
        -c 'rm -rf /cleanup/* /cleanup/.[!.]* 2>/dev/null || true' >/dev/null 2>&1
  fi

  if [[ -n "${NET_NAME}" ]]; then
    docker network rm "${NET_NAME}" >/dev/null 2>&1
  fi

  if [[ -n "${RUN_DIR}" && -d "${RUN_DIR}" ]]; then
    rm -rf "${RUN_DIR}" >/dev/null 2>&1
  fi

  exit "${exit_code}"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --preflight-only)
        PREFLIGHT_ONLY=1
        shift
        ;;
      --work-root)
        [[ $# -ge 2 ]] || { log_error "Opcja --work-root wymaga ścieżki."; exit 2; }
        WORK_ROOT="$2"
        shift 2
        ;;
      --port)
        [[ $# -ge 2 ]] || { log_error "Opcja --port wymaga numeru portu."; exit 2; }
        PORT="$2"
        shift 2
        ;;
      --mode)
        [[ $# -ge 2 ]] || { log_error "Opcja --mode wymaga wartości fixture albo strict-migrator."; exit 2; }
        MODE="$2"
        shift 2
        ;;
      --bootstrap-runtime-role)
        BOOTSTRAP_RUNTIME_ROLE=1
        shift
        ;;
      --timeout)
        [[ $# -ge 2 ]] || { log_error "Opcja --timeout wymaga liczby sekund."; exit 2; }
        TIMEOUT_SEC="$2"
        shift 2
        ;;
      --pull-if-missing)
        PULL_IF_MISSING=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        break
        ;;
      *)
        log_error "Nieznana opcja: $1"
        usage >&2
        exit 2
        ;;
    esac
  done

  validate_port "${PORT}"

  if [[ "${MODE}" != "fixture" && "${MODE}" != "strict-migrator" ]]; then
    log_error "Nieobsługiwany tryb --mode=${MODE} (dozwolone: fixture, strict-migrator)."
    exit 2
  fi

  if (( BOOTSTRAP_RUNTIME_ROLE == 1 )) && [[ "${MODE}" != "strict-migrator" ]]; then
    log_error "Opcja --bootstrap-runtime-role jest dozwolona wyłącznie z --mode strict-migrator."
    exit 2
  fi

  if [[ ! "${TIMEOUT_SEC}" =~ ^[0-9]+$ ]] || (( TIMEOUT_SEC < 10 || TIMEOUT_SEC > 900 )); then
    log_error "Limit --timeout musi mieścić się w przedziale 10..900 sekund."
    exit 2
  fi

  if [[ "${NODE_ENV:-}" == "production" || "${PAP_DATABASE_ENV:-}" == "staging" || "${PAP_ENV:-}" == "staging" ]]; then
    log_error "Wykryto zmienne środowiska produkcyjnego/stagingowego (NODE_ENV/PAP_DATABASE_ENV/PAP_ENV). Odmowa uruchomienia."
    exit 2
  fi

  if [[ "$(id -u)" -eq 0 ]]; then
    log_error "Nie uruchamiaj runnera testowego jako root — użyj nieuprzywilejowanego konta operatora."
    exit 2
  fi

  local current_dir
  current_dir="$(realpath -m "${PWD}")"
  if is_forbidden_path "${current_dir}"; then
    log_error "Bieżący katalog (${current_dir}) należy do chronionej ścieżki usługowej. Użyj oddzielnego klonu testowego."
    exit 2
  fi

  if (( PREFLIGHT_ONLY == 0 )); then
    if [[ "${PAP_ALLOW_HETZNER_EPHEMERAL_PG:-}" != "1" ]]; then
      log_error "Brak potwierdzenia zgody (PAP_ALLOW_HETZNER_EPHEMERAL_PG=1). Uruchamianie nowych zasobów jest zablokowane."
      exit 2
    fi
    if [[ -z "${WORK_ROOT}" ]]; then
      log_error "Tryb wykonawczy wymaga jawnego wskazania --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral[/...]."
      exit 2
    fi
    if [[ $# -eq 0 ]]; then
      log_error "Podaj polecenie testowe po separatorze '--'."
      exit 2
    fi
  fi

  local resolved_work_root=""
  if [[ -n "${WORK_ROOT}" ]]; then
    local require_existing=0
    if (( PREFLIGHT_ONLY == 0 )); then
      require_existing=1
    fi
    resolved_work_root="$(resolve_and_validate_work_root "${WORK_ROOT}" "${require_existing}")"
  fi

  # --- Kontrola zasobów hosta (odczytowa) ---
  local required_bin
  for required_bin in docker ss df awk openssl timeout realpath; do
    if ! command -v "${required_bin}" >/dev/null 2>&1; then
      log_error "Brak wymaganego narzędzia systemowego: ${required_bin}"
      exit 3
    fi
  done

  local mem_available_kib mem_available_mib root_free_mib
  mem_available_kib="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
  mem_available_mib="$(( mem_available_kib / 1024 ))"
  if (( mem_available_mib < MIN_MEM_AVAILABLE_MIB )); then
    log_error "Zbyt mało dostępnej pamięci RAM: ${mem_available_mib} MiB (minimum: ${MIN_MEM_AVAILABLE_MIB} MiB)."
    exit 3
  fi

  root_free_mib="$(df -Pm / | awk 'NR==2 { print $4 }')"
  if (( root_free_mib < MIN_ROOT_FREE_MIB )); then
    log_error "Zbyt mało wolnego miejsca na /: ${root_free_mib} MiB (minimum: ${MIN_ROOT_FREE_MIB} MiB)."
    exit 3
  fi

  if [[ -n "${resolved_work_root}" ]]; then
    verify_separate_volume_mount "${resolved_work_root}"
  fi

  if ss -H -lnt "sport = :${PORT}" | grep -q .; then
    log_error "Port TCP ${PORT} jest już zajęty na hoście."
    exit 3
  fi

  local docker_caps
  docker_caps="$(docker info --format 'CgroupVersion={{.CgroupVersion}} MemoryLimit={{.MemoryLimit}} SwapLimit={{.SwapLimit}}')"
  if [[ "${docker_caps}" != *"CgroupVersion=2"* || "${docker_caps}" != *"MemoryLimit=true"* || "${docker_caps}" != *"SwapLimit=true"* ]]; then
    log_error "Demon Docker nie wspiera wymaganych limitów cgroups v2 (${docker_caps})."
    exit 3
  fi

  local image_cached="no"
  if docker image inspect "${PG_IMAGE}" >/dev/null 2>&1; then
    image_cached="yes"
  fi

  local user_systemd_available
  user_systemd_available="$(detect_user_systemd_cgroup)"

  log_info "Pre-flight OK: MemAvailable=${mem_available_mib}MiB, RootFree=${root_free_mib}MiB, Port=127.0.0.1:${PORT} (wolny), ImageCached=${image_cached}, UserSystemd=${user_systemd_available}."

  if (( PREFLIGHT_ONLY == 1 )); then
    exit 0
  fi

  enforce_user_systemd_scope "${PREFLIGHT_ONLY}" "${user_systemd_available}"

  # --- Przygotowanie izolowanego kontenera efemerycznego ---
  if [[ "${image_cached}" == "no" ]]; then
    if (( PULL_IF_MISSING == 0 )); then
      log_error "Obraz ${PG_IMAGE} nie jest jeszcze pobrany lokalnie. Dodaj --pull-if-missing po uzyskaniu zgody właściciela."
      exit 3
    fi
    log_info "Pobieranie przypiętego obrazu ${PG_IMAGE}..."
    docker pull "${PG_IMAGE}" >/dev/null
  fi

  trap cleanup EXIT INT TERM

  local run_id boot_password init_user init_db
  run_id="$(openssl rand -hex 6)"
  RUN_DIR="${resolved_work_root}/run-${run_id}"
  mkdir -m 0700 "${RUN_DIR}"
  mkdir -m 0700 "${RUN_DIR}/pgdata"

  boot_password="$(openssl rand -hex 24)"
  printf '%s' "${boot_password}" > "${RUN_DIR}/pg_pass.secret"
  # Katalog nadrzędny RUN_DIR ma 0700 (brak dostępu innych użytkowników na hoście),
  # a 0444 umożliwia odczyt pliku sekretu przez użytkownika postgres (uid 70) wewnątrz kontenera.
  chmod 0444 "${RUN_DIR}/pg_pass.secret"

  NET_NAME="pap-ci-pg-net-${run_id}"
  CONTAINER_NAME="pap-ci-pg18-${run_id}"

  docker network create \
    --driver bridge \
    -o com.docker.network.bridge.enable_icc=false \
    "${NET_NAME}" >/dev/null

  init_user="pap_test"
  init_db="pap_test"
  if [[ "${MODE}" == "strict-migrator" ]]; then
    init_user="postgres"
    init_db="postgres"
  fi

  log_info "Uruchamianie izolowanego kontenera ${CONTAINER_NAME} na 127.0.0.1:${PORT} (RAM<=384MiB, CPU=0.50, mode=${MODE})..."
  docker run \
    --detach \
    --pull=never \
    --name "${CONTAINER_NAME}" \
    --network "${NET_NAME}" \
    --publish "127.0.0.1:${PORT}:5432" \
    --memory=384m \
    --memory-swap=384m \
    --cpus=0.50 \
    --pids-limit=128 \
    --cap-drop=NET_RAW \
    --security-opt no-new-privileges:true \
    -v "${RUN_DIR}/pgdata:/var/lib/postgresql" \
    -v "${RUN_DIR}/pg_pass.secret:/run/secrets/pg_pass:ro" \
    -e "POSTGRES_DB=${init_db}" \
    -e "POSTGRES_USER=${init_user}" \
    -e "POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass" \
    -e "POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 --auth-local=scram-sha-256 --encoding=UTF8 --locale=C" \
    "${PG_IMAGE}" \
    postgres \
      -c listen_addresses='*' \
      -c password_encryption=scram-sha-256 \
      -c shared_buffers=64MB \
      -c work_mem=4MB \
      -c maintenance_work_mem=32MB \
      -c effective_cache_size=192MB \
      -c wal_buffers=4MB \
      -c max_wal_size=128MB \
      -c min_wal_size=32MB \
      -c max_connections=32 \
      -c statement_timeout=30s \
      -c lock_timeout=10s \
      -c idle_in_transaction_session_timeout=15s \
      -c log_statement=none \
      -c log_connections=off \
      -c log_disconnections=off >/dev/null

  local port_binding
  port_binding="$(docker port "${CONTAINER_NAME}" 5432/tcp)"
  if [[ "${port_binding}" != "127.0.0.1:${PORT}" ]]; then
    log_error "Niedozwolone bindowanie portu kontenera (${port_binding}); oczekiwano wyłącznie 127.0.0.1:${PORT}."
    exit 4
  fi

  local ready=0
  for _ in $(seq 1 30); do
    if docker exec "${CONTAINER_NAME}" pg_isready -h 127.0.0.1 -U "${init_user}" -d "${init_db}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if (( ready == 0 )); then
    log_error "Kontener PostgreSQL 18.6 nie osiągnął gotowości w ciągu 30 sekund."
    exit 4
  fi

  local test_db_password="${boot_password}"
  local runtime_db_url=""

  if [[ "${MODE}" == "strict-migrator" ]]; then
    test_db_password="$(openssl rand -hex 24)"
    docker exec -i "${CONTAINER_NAME}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
\\set migrator_pass '${test_db_password}'
CREATE ROLE pap_test LOGIN PASSWORD :'migrator_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE pap_test OWNER pap_test ENCODING 'UTF8' TEMPLATE template0;
GRANT SET ON PARAMETER deadlock_timeout TO pap_test;
SQL

    if (( BOOTSTRAP_RUNTIME_ROLE == 1 )); then
      local runtime_password
      runtime_password="$(openssl rand -hex 24)"
      docker exec -i "${CONTAINER_NAME}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d pap_test <<SQL
\\set runtime_pass '${runtime_password}'
CREATE ROLE pap_test_app LOGIN PASSWORD :'runtime_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
      runtime_db_url="postgres://pap_test_app:${runtime_password}@127.0.0.1:${PORT}/pap_test"
    fi

    # Blokada logowania superusera postgres po TCP (127.0.0.1:${PORT}) w trybie strict-migrator.
    docker exec -i "${CONTAINER_NAME}" sh -eu -c '
      HBA_FILE="$(psql -X -q -t -A -U postgres -d postgres -c "SHOW hba_file")"
      TMP_HBA="${HBA_FILE}.tmp"
      {
        printf "host all postgres 0.0.0.0/0 reject\n"
        printf "host all postgres ::/0 reject\n"
        cat "${HBA_FILE}"
      } > "${TMP_HBA}"
      cat "${TMP_HBA}" > "${HBA_FILE}"
      rm -f "${TMP_HBA}"
      psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT pg_reload_conf();" >/dev/null
    '
  fi

  local test_db_url="postgres://pap_test:${test_db_password}@127.0.0.1:${PORT}/pap_test"

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

  local -a runner_prefix=(
    systemd-run --user --scope --quiet
    -p MemoryHigh=512M
    -p MemoryMax=768M
    -p MemorySwapMax=0
    -p CPUQuota=50%
    -p TasksMax=128
    --
    timeout --signal=TERM --kill-after=15s "${TIMEOUT_SEC}s"
  )

  log_info "Baza pap_test gotowa na 127.0.0.1:${PORT}. Wykonywanie polecenia testowego w scope cgroups v2 (timeout=${TIMEOUT_SEC}s)..."
  if [[ -n "${runtime_db_url}" ]]; then
    PAP_DATABASE_ENV="test" \
    DATABASE_URL="${test_db_url}" \
    PAP_EPHEMERAL_RUNTIME_DATABASE_URL="${runtime_db_url}" \
    CI="1" \
    NEXT_TELEMETRY_DISABLED="1" \
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" \
    "${runner_prefix[@]}" "$@"
  else
    PAP_DATABASE_ENV="test" \
    DATABASE_URL="${test_db_url}" \
    CI="1" \
    NEXT_TELEMETRY_DISABLED="1" \
    NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" \
    "${runner_prefix[@]}" "$@"
  fi
}

if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  main "$@"
fi
