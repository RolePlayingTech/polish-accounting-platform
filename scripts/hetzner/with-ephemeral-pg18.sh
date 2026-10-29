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
  scripts/hetzner/with-ephemeral-pg18.sh --preflight-only [--port 55432] [--work-root <katalog>]
  PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/hetzner/with-ephemeral-pg18.sh \
    --work-root <wydzielony-katalog-testowy> \
    [--port 55432] \
    [--mode fixture|strict-migrator] \
    [--bootstrap-runtime-role] \
    [--timeout 300] \
    [--pull-if-missing] \
    -- <polecenie-testowe...>

Opcje:
  --preflight-only          Wyłącznie odczytowa kontrola zasobów, cgroups v2, Dockera i portu (bez tworzenia zasobów).
  --work-root <katalog>     Wydzielony katalog roboczy dla danych tymczasowych (poza ścieżkami stagingu i innych usług).
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

CURRENT_DIR="$(realpath -m "${PWD}")"
if is_forbidden_path "${CURRENT_DIR}"; then
  log_error "Bieżący katalog (${CURRENT_DIR}) należy do chronionej ścieżki usługowej. Użyj oddzielnego klonu testowego."
  exit 2
fi

RESOLVED_WORK_ROOT=""
if [[ -n "${WORK_ROOT}" ]]; then
  RESOLVED_WORK_ROOT="$(realpath -m "${WORK_ROOT}")"
  if is_forbidden_path "${RESOLVED_WORK_ROOT}"; then
    log_error "Katalog --work-root (${RESOLVED_WORK_ROOT}) narusza chronioną ścieżkę stagingu lub innej usługi."
    exit 2
  fi
fi

if (( PREFLIGHT_ONLY == 0 )); then
  if [[ "${PAP_ALLOW_HETZNER_EPHEMERAL_PG:-}" != "1" ]]; then
    log_error "Brak potwierdzenia zgody (PAP_ALLOW_HETZNER_EPHEMERAL_PG=1). Uruchamianie nowych zasobów jest zablokowane."
    exit 2
  fi
  if [[ -z "${RESOLVED_WORK_ROOT}" ]]; then
    log_error "Tryb wykonawczy wymaga jawnego wskazania --work-root <wydzielony-katalog-testowy>."
    exit 2
  fi
  if [[ ! -d "${RESOLVED_WORK_ROOT}" || ! -w "${RESOLVED_WORK_ROOT}" ]]; then
    log_error "Wydzielony katalog --work-root (${RESOLVED_WORK_ROOT}) nie istnieje lub nie jest zapisywalny."
    exit 2
  fi
  if [[ $# -eq 0 ]]; then
    log_error "Podaj polecenie testowe po separatorze '--'."
    exit 2
  fi
fi

# --- Kontrola zasobów hosta (odczytowa) ---
for required_bin in docker ss df awk openssl timeout; do
  if ! command -v "${required_bin}" >/dev/null 2>&1; then
    log_error "Brak wymaganego narzędzia systemowego: ${required_bin}"
    exit 3
  fi
done

MEM_AVAILABLE_KIB="$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)"
MEM_AVAILABLE_MIB="$(( MEM_AVAILABLE_KIB / 1024 ))"
if (( MEM_AVAILABLE_MIB < MIN_MEM_AVAILABLE_MIB )); then
  log_error "Zbyt mało dostępnej pamięci RAM: ${MEM_AVAILABLE_MIB} MiB (minimum: ${MIN_MEM_AVAILABLE_MIB} MiB)."
  exit 3
fi

ROOT_FREE_MIB="$(df -Pm / | awk 'NR==2 { print $4 }')"
if (( ROOT_FREE_MIB < MIN_ROOT_FREE_MIB )); then
  log_error "Zbyt mało wolnego miejsca na /: ${ROOT_FREE_MIB} MiB (minimum: ${MIN_ROOT_FREE_MIB} MiB)."
  exit 3
fi

if [[ -n "${RESOLVED_WORK_ROOT}" && -d "${RESOLVED_WORK_ROOT}" ]]; then
  WORK_FREE_MIB="$(df -Pm "${RESOLVED_WORK_ROOT}" | awk 'NR==2 { print $4 }')"
  if (( WORK_FREE_MIB < MIN_WORK_FREE_MIB )); then
    log_error "Zbyt mało wolnego miejsca w ${RESOLVED_WORK_ROOT}: ${WORK_FREE_MIB} MiB (minimum: ${MIN_WORK_FREE_MIB} MiB)."
    exit 3
  fi
fi

if ss -H -lnt "sport = :${PORT}" | grep -q .; then
  log_error "Port TCP ${PORT} jest już zajęty na hoście."
  exit 3
fi

DOCKER_CAPS="$(docker info --format 'CgroupVersion={{.CgroupVersion}} MemoryLimit={{.MemoryLimit}} SwapLimit={{.SwapLimit}}')"
if [[ "${DOCKER_CAPS}" != *"CgroupVersion=2"* || "${DOCKER_CAPS}" != *"MemoryLimit=true"* || "${DOCKER_CAPS}" != *"SwapLimit=true"* ]]; then
  log_error "Demon Docker nie wspiera wymaganych limitów cgroups v2 (${DOCKER_CAPS})."
  exit 3
fi

IMAGE_CACHED="no"
if docker image inspect "${PG_IMAGE}" >/dev/null 2>&1; then
  IMAGE_CACHED="yes"
fi

USER_SYSTEMD_AVAILABLE="no"
if command -v systemd-run >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  USER_SYSTEMD_AVAILABLE="yes"
fi

log_info "Pre-flight OK: MemAvailable=${MEM_AVAILABLE_MIB}MiB, RootFree=${ROOT_FREE_MIB}MiB, Port=127.0.0.1:${PORT} (wolny), ImageCached=${IMAGE_CACHED}, UserSystemd=${USER_SYSTEMD_AVAILABLE}."

if (( PREFLIGHT_ONLY == 1 )); then
  exit 0
fi

# --- Przygotowanie izolowanego kontenera efemerycznego ---
if [[ "${IMAGE_CACHED}" == "no" ]]; then
  if (( PULL_IF_MISSING == 0 )); then
    log_error "Obraz ${PG_IMAGE} nie jest jeszcze pobrany lokalnie. Dodaj --pull-if-missing po uzyskaniu zgody właściciela."
    exit 3
  fi
  log_info "Pobieranie przypiętego obrazu ${PG_IMAGE}..."
  docker pull "${PG_IMAGE}" >/dev/null
fi

trap cleanup EXIT INT TERM

RUN_ID="$(openssl rand -hex 6)"
RUN_DIR="${RESOLVED_WORK_ROOT}/run-${RUN_ID}"
mkdir -m 0700 "${RUN_DIR}"
mkdir -m 0700 "${RUN_DIR}/pgdata"

BOOT_PASSWORD="$(openssl rand -hex 24)"
printf '%s' "${BOOT_PASSWORD}" > "${RUN_DIR}/pg_pass.secret"
# Katalog nadrzędny RUN_DIR ma 0700 (brak dostępu innych użytkowników na hoście),
# a 0444 umożliwia odczyt pliku sekretu przez użytkownika postgres (uid 70) wewnątrz kontenera.
chmod 0444 "${RUN_DIR}/pg_pass.secret"

NET_NAME="pap-ci-pg-net-${RUN_ID}"
CONTAINER_NAME="pap-ci-pg18-${RUN_ID}"

docker network create \
  --driver bridge \
  -o com.docker.network.bridge.enable_icc=false \
  "${NET_NAME}" >/dev/null

INIT_USER="pap_test"
INIT_DB="pap_test"
if [[ "${MODE}" == "strict-migrator" ]]; then
  INIT_USER="postgres"
  INIT_DB="postgres"
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
  --security-opt no-new-privileges:true \
  -v "${RUN_DIR}/pgdata:/var/lib/postgresql" \
  -v "${RUN_DIR}/pg_pass.secret:/run/secrets/pg_pass:ro" \
  -e "POSTGRES_DB=${INIT_DB}" \
  -e "POSTGRES_USER=${INIT_USER}" \
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
    -c statement_timeout=15s \
    -c lock_timeout=10s \
    -c idle_in_transaction_session_timeout=15s \
    -c log_statement=none \
    -c log_connections=off \
    -c log_disconnections=off >/dev/null

PORT_BINDING="$(docker port "${CONTAINER_NAME}" 5432/tcp)"
if [[ "${PORT_BINDING}" != "127.0.0.1:${PORT}" ]]; then
  log_error "Niedozwolone bindowanie portu kontenera (${PORT_BINDING}); oczekiwano wyłącznie 127.0.0.1:${PORT}."
  exit 4
fi

READY=0
for _ in $(seq 1 30); do
  if docker exec "${CONTAINER_NAME}" pg_isready -h 127.0.0.1 -U "${INIT_USER}" -d "${INIT_DB}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done

if (( READY == 0 )); then
  log_error "Kontener PostgreSQL 18.6 nie osiągnął gotowości w ciągu 30 sekund."
  exit 4
fi

TEST_DB_PASSWORD="${BOOT_PASSWORD}"
RUNTIME_DB_URL=""

if [[ "${MODE}" == "strict-migrator" ]]; then
  TEST_DB_PASSWORD="$(openssl rand -hex 24)"
  docker exec -i "${CONTAINER_NAME}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres <<SQL
\\set migrator_pass '${TEST_DB_PASSWORD}'
CREATE ROLE pap_test LOGIN PASSWORD :'migrator_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE pap_test OWNER pap_test ENCODING 'UTF8' TEMPLATE template0;
GRANT SET ON PARAMETER deadlock_timeout TO pap_test;
SQL

  if (( BOOTSTRAP_RUNTIME_ROLE == 1 )); then
    RUNTIME_PASSWORD="$(openssl rand -hex 24)"
    docker exec -i "${CONTAINER_NAME}" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d pap_test <<SQL
\\set runtime_pass '${RUNTIME_PASSWORD}'
CREATE ROLE pap_test_app LOGIN PASSWORD :'runtime_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
    RUNTIME_DB_URL="postgres://pap_test_app:${RUNTIME_PASSWORD}@127.0.0.1:${PORT}/pap_test"
  fi
fi

TEST_DB_URL="postgres://pap_test:${TEST_DB_PASSWORD}@127.0.0.1:${PORT}/pap_test"

if [[ -d "/opt/pap-runtime/current/bin" ]]; then
  export PATH="/opt/pap-runtime/current/bin:${PATH}"
fi
if [[ -d "/opt/pap-runtime/corepack-home" ]]; then
  export COREPACK_HOME="/opt/pap-runtime/corepack-home"
  export COREPACK_ENABLE_NETWORK=0
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
fi

RUNNER_PREFIX=(timeout --signal=TERM --kill-after=15s "${TIMEOUT_SEC}s")
if [[ "${USER_SYSTEMD_AVAILABLE}" == "yes" ]]; then
  RUNNER_PREFIX=(
    systemd-run --user --scope --quiet
    -p MemoryHigh=512M
    -p MemoryMax=768M
    -p MemorySwapMax=0
    -p CPUQuota=50%
    -p TasksMax=128
    --
    "${RUNNER_PREFIX[@]}"
  )
fi

log_info "Baza pap_test gotowa na 127.0.0.1:${PORT}. Wykonywanie polecenia testowego (timeout=${TIMEOUT_SEC}s)..."
if [[ -n "${RUNTIME_DB_URL}" ]]; then
  PAP_DATABASE_ENV="test" \
  DATABASE_URL="${TEST_DB_URL}" \
  PAP_EPHEMERAL_RUNTIME_DATABASE_URL="${RUNTIME_DB_URL}" \
  CI="1" \
  NEXT_TELEMETRY_DISABLED="1" \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" \
  "${RUNNER_PREFIX[@]}" "$@"
else
  PAP_DATABASE_ENV="test" \
  DATABASE_URL="${TEST_DB_URL}" \
  CI="1" \
  NEXT_TELEMETRY_DISABLED="1" \
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}" \
  "${RUNNER_PREFIX[@]}" "$@"
fi
