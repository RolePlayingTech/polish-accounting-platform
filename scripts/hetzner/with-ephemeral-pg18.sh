#!/usr/bin/env bash
# Bezpieczny, samooczyszczający się runner tymczasowego PostgreSQL 18.6 dla testów integracyjnych na Hetznerze.
# Nie instaluje usług systemowych, nie dotyka bazy ani plików stagingu i działa wyłącznie na loopbacku 127.0.0.1.
#
# Gwarancje i ograniczenia sieci Docker (Docker 29, FirewallBackend=iptables):
# - Gwarantowane: dedykowany mostek user-defined bridge (pap-ci-pg-net-<id>) izolowany od mostków innych projektów
#   przez DOCKER-ISOLATION-STAGE-1/2, wyłączone ICC (enable_icc=false), publikacja portu wyłącznie na 127.0.0.1:${PORT}
#   oraz brak dostępu z kontenera do usług 127.0.0.1 hosta dzięki osobnemu netns i net.ipv4.conf.all.route_localnet=0.
# - Ograniczenia (bez zmian firewalla hosta): Docker 28/29 odrzuca łączenie --internal z -p 127.0.0.1:PORT:5432,
#   dlatego mostek nie blokuje wychodzącego NAT egress z wnętrza kontenera (internet / 169.254.169.254) ani połączeń
#   z kontenera do gniazd 0.0.0.0 hosta; na samym hoście port 127.0.0.1:${PORT} chroni jednorazowe 192-bitowe hasło SCRAM.

set -euo pipefail
set +x
umask 077

readonly PG_IMAGE="postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5"
readonly DEFAULT_PORT=55432
readonly DEFAULT_TIMEOUT_SEC=300
readonly MIN_MEM_AVAILABLE_MIB=1400
readonly MIN_ROOT_FREE_MIB=3072
readonly MIN_WORK_FREE_MIB=2048
readonly -a SCOPE_LIMIT_ARGS=(
  -p MemoryHigh=512M
  -p MemoryMax=768M
  -p MemorySwapMax=0
  -p CPUQuota=50%
  -p TasksMax=128
)

# Strażnik wykonywany wewnątrz systemd-run --user --scope przed uruchomieniem właściwego polecenia:
# potwierdza na poziomie jądra (/proc/self/cgroup + /sys/fs/cgroup), że proces trafił do docelowego *.scope
# i ma faktycznie wymuszone limity pamięci, swapu, CPU oraz liczby zadań.
readonly SCOPE_CGROUP_ENFORCER_SCRIPT='
set -euo pipefail
cg_root="$1"
proc_cg="$2"
expected_unit="$3"
shift 3

if [[ ! -r "${proc_cg}" ]]; then
  echo "Brak odczytywalnego ${proc_cg} wewnątrz scope ${expected_unit}." >&2
  exit 3
fi

rel_path="$(awk -F: '\''$1 == "0" { print $3; exit }'\'' "${proc_cg}")"
if [[ -z "${rel_path}" || "${rel_path}" != *"/${expected_unit}.scope" ]]; then
  echo "Proces nie działa w oczekiwanym cgroup scope (${expected_unit}.scope, wykryto: ${rel_path:-brak})." >&2
  exit 3
fi

scope_dir="${cg_root%/}${rel_path}"
for ctrl_file in memory.high memory.max memory.swap.max cpu.max pids.max; do
  if [[ ! -r "${scope_dir}/${ctrl_file}" ]]; then
    echo "Brak pliku kontrolnego cgroup v2: ${scope_dir}/${ctrl_file}." >&2
    exit 3
  fi
done

mem_high="$(tr -d '\''\n'\'' < "${scope_dir}/memory.high")"
mem_max="$(tr -d '\''\n'\'' < "${scope_dir}/memory.max")"
swap_max="$(tr -d '\''\n'\'' < "${scope_dir}/memory.swap.max")"
cpu_max="$(tr -d '\''\n'\'' < "${scope_dir}/cpu.max")"
pids_max="$(tr -d '\''\n'\'' < "${scope_dir}/pids.max")"

if [[ ! "${mem_high}" =~ ^[0-9]+$ ]] || (( mem_high <= 0 )); then
  echo "Limit MemoryHigh nie został wymuszony w ${scope_dir}/memory.high (${mem_high})." >&2
  exit 3
fi
if [[ ! "${mem_max}" =~ ^[0-9]+$ ]] || (( mem_max <= 0 )); then
  echo "Limit MemoryMax nie został wymuszony w ${scope_dir}/memory.max (${mem_max})." >&2
  exit 3
fi
if [[ "${swap_max}" != "0" ]]; then
  echo "Limit MemorySwapMax=0 nie został wymuszony w ${scope_dir}/memory.swap.max (${swap_max})." >&2
  exit 3
fi
if [[ -z "${cpu_max}" || "${cpu_max}" == "max" || "${cpu_max}" == "max "* ]]; then
  echo "Limit CPUQuota nie został wymuszony w ${scope_dir}/cpu.max (${cpu_max})." >&2
  exit 3
fi
if [[ ! "${pids_max}" =~ ^[0-9]+$ ]] || (( pids_max <= 0 )); then
  echo "Limit TasksMax nie został wymuszony w ${scope_dir}/pids.max (${pids_max})." >&2
  exit 3
fi

exec "$@"
'

PREFLIGHT_ONLY=0
PULL_IF_MISSING=0
BOOTSTRAP_RUNTIME_ROLE=0
MODE="fixture"
PORT="${DEFAULT_PORT}"
TIMEOUT_SEC="${DEFAULT_TIMEOUT_SEC}"
WORK_ROOT=""
RESOLVED_WORK_ROOT=""
WORK_PROBE_DIR=""
WORK_ROOT_STATUS="not-specified"

RUN_DIR=""
CONTAINER_NAME=""
NET_NAME=""
SCOPE_UNIT=""
TEST_CHILD_PID=""
CLEANUP_DONE=0

log_info() {
  printf '[pap-ephemeral-pg18] INFO: %s\n' "$*" >&2
}

log_error() {
  printf '[pap-ephemeral-pg18] BŁĄD: %s\n' "$*" >&2
}

get_volume_mount_parent() {
  printf '%s' "/mnt"
}

get_proc_meminfo_path() {
  printf '%s' "/proc/meminfo"
}

get_cgroup_root_dir() {
  printf '%s' "/sys/fs/cgroup"
}

get_proc_self_cgroup_path() {
  printf '%s' "/proc/self/cgroup"
}

get_user_slice_controllers_file() {
  printf '%s/user.slice/user-%s.slice/cgroup.controllers' "$(get_cgroup_root_dir)" "$(id -u)"
}

get_user_manager_cgroup_dir() {
  printf '%s/user.slice/user-%s.slice/user@%s.service' "$(get_cgroup_root_dir)" "$(id -u)" "$(id -u)"
}

get_pg_ready_max_attempts() {
  printf '%s' "30"
}

get_pg_ready_sleep_sec() {
  printf '%s' "1"
}

exec_container_super_psql() {
  local target_db="$1"
  shift
  docker exec -i -u postgres "${CONTAINER_NAME}" sh -eu -c '
    target_db="$1"
    shift
    export PGPASSWORD
    PGPASSWORD="$(cat /run/secrets/pg_pass)"
    exec psql -X -w -q -v ON_ERROR_STOP=1 -U postgres -d "${target_db}" "$@"
  ' sh "${target_db}" "$@"
}

usage() {
  cat <<'EOF'
Użycie:
  scripts/hetzner/with-ephemeral-pg18.sh --preflight-only [--port 55432] [--work-root <katalog>]
  PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/hetzner/with-ephemeral-pg18.sh \
    --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral[/podkatalog] \
    [--port 55432] \
    [--mode fixture|strict-migrator] \
    [--bootstrap-runtime-role] \
    [--timeout 300] \
    [--pull-if-missing] \
    -- <polecenie-testowe...>

Opcje:
  --preflight-only          Wyłącznie odczytowa kontrola zasobów, cgroups v2, wolumenu, Dockera i portu.
  --work-root <katalog>     Zatwierdzony katalog testowy /mnt/HC_Volume_<ID>/pap-ci-ephemeral (lub jego podkatalog)
                            na wydzielonym wolumenie blokowym poza partycją / i poza zasobami innych usług.
  --port <15432..60999>     Lokalny port loopback 127.0.0.1 (domyślnie 55432; port 5432 stagingu jest zablokowany).
  --mode <tryb>             fixture (domyślny dla pnpm test:integration) albo strict-migrator (pap_test jako NOSUPERUSER/NOBYPASSRLS).
  --bootstrap-runtime-role  W trybie strict-migrator tworzy również nieuprzywilejowany login pap_test_app.
  --timeout <10..900>       Limit czasu polecenia testowego w sekundach (domyślnie 300).
  --pull-if-missing         Pozwala pobrać przypięty obraz postgres:18.6-alpine po SHA-256, jeśli brak go lokalnie.
  -h, --help                Wyświetla niniejszą pomoc.
EOF
}

is_forbidden_cwd() {
  local candidate="$1"
  case "${candidate}" in
    ""|"/"|"/etc"|"/etc/"*|"/var/www/pap-staging"|"/var/www/pap-staging/"*|"/opt/pap-runtime"|"/opt/pap-runtime/"*|"/var/lib/pap-acme"|"/var/lib/pap-acme/"*|"/var/www/mumro"|"/var/www/mumro/"*|"/var/www/durnoty"|"/var/www/durnoty/"*|"/var/www/swiadek-dziejow"*|"/home/admin/stacks"|"/home/admin/stacks/"*)
      return 0
      ;;
  esac
  case "${candidate}" in
    */pap-staging|*/pap-staging/*|*/mumro-backups|*/mumro-backups/*|*/mumro-temp-ci|*/mumro-temp-ci/*|*/mumro-release-quarantine*|*/reels-api|*/reels-api/*|*/shorts-api|*/shorts-api/*|*/social-admin|*/social-admin/*|*/roleplayingtech.com|*/roleplayingtech.com/*|*/durnoty|*/durnoty/*|*/historia-technologii*|*/mfc-backend*)
      return 0
      ;;
  esac
  return 1
}

assert_no_symlink_components() {
  local target="$1"
  local current=""
  local part
  local -a parts=()
  local IFS='/'
  read -r -a parts <<< "${target}"
  for part in "${parts[@]}"; do
    if [[ -z "${part}" ]]; then
      continue
    fi
    current="${current}/${part}"
    if [[ -L "${current}" ]]; then
      log_error "Ścieżka --work-root zawiera niedozwolony symlink (${current})."
      exit 2
    fi
  done
}

is_disallowed_fstype() {
  local fstype="$1"
  case "${fstype}" in
    ""|"tmpfs"|"devtmpfs"|"ramfs"|"overlay"|"squashfs"|"proc"|"sysfs"|"cgroup"|"cgroup2"|"nfs"|"nfs4"|"cifs"|"smb3"|fuse*)
      return 0
      ;;
  esac
  return 1
}

read_df_entry() {
  local target="$1"
  df -PT "${target}" | awk 'NR==2 { print $1, $2, $7 }'
}

validate_work_root() {
  local raw_work_root="$1"
  local preflight_mode="${2:-0}"
  if [[ -z "${raw_work_root}" ]]; then
    log_error "Opcja --work-root nie może być pusta."
    exit 2
  fi
  if [[ "${raw_work_root}" != /* ]]; then
    log_error "Katalog --work-root (${raw_work_root}) musi być ścieżką bezwzględną."
    exit 2
  fi

  local trimmed="${raw_work_root%/}"
  if [[ -z "${trimmed}" ]]; then
    log_error "Katalog --work-root nie może wskazywać korzenia systemu plików (/)."
    exit 2
  fi

  if [[ "${raw_work_root}" == *"//"* || "/${trimmed#/}/" == *"/./"* || "/${trimmed#/}/" == *"/../"* ]]; then
    log_error "Katalog --work-root (${raw_work_root}) musi być znormalizowaną ścieżką kanoniczną bez '.', '..' ani '//'."
    exit 2
  fi

  local mnt_parent
  mnt_parent="$(get_volume_mount_parent)"
  mnt_parent="${mnt_parent%/}"

  local allowed_regex="^${mnt_parent}/HC_Volume_[0-9]+/pap-ci-ephemeral(/[A-Za-z0-9][A-Za-z0-9._-]*)*$"
  if [[ ! "${trimmed}" =~ ${allowed_regex} ]]; then
    log_error "Katalog --work-root (${raw_work_root}) musi leżeć wyłącznie pod zatwierdzonym katalogiem ${mnt_parent}/HC_Volume_<ID>/pap-ci-ephemeral."
    exit 2
  fi

  assert_no_symlink_components "${trimmed}"

  local canonical_nonexist logical_nonexist
  canonical_nonexist="$(realpath -m -- "${trimmed}")"
  logical_nonexist="$(realpath -s -m -- "${trimmed}")"
  if [[ "${canonical_nonexist}" != "${trimmed}" || "${logical_nonexist}" != "${trimmed}" ]]; then
    log_error "Ścieżka --work-root (${raw_work_root}) zawiera niedozwolone dowiązanie symboliczne lub przekierowanie (${canonical_nonexist})."
    exit 2
  fi

  local rel_after_mnt="${trimmed#"${mnt_parent}/"}"
  local volume_name="${rel_after_mnt%%/*}"
  local volume_mount="${mnt_parent}/${volume_name}"
  local ephemeral_base="${volume_mount}/pap-ci-ephemeral"

  if [[ ! -d "${mnt_parent}" || ! -d "${volume_mount}" ]]; then
    log_error "Punkt montowania wolumenu blokowego (${volume_mount}) nie istnieje."
    exit 2
  fi

  local real_mnt_parent real_volume_mount
  real_mnt_parent="$(realpath -e -- "${mnt_parent}")"
  real_volume_mount="$(realpath -e -- "${volume_mount}")"
  if [[ "${real_mnt_parent}" != "${mnt_parent}" || "${real_volume_mount}" != "${volume_mount}" ]]; then
    log_error "Wykryto niedozwolone przekierowanie ścieżki punktu montowania wolumenu (${volume_mount} -> ${real_volume_mount})."
    exit 2
  fi

  local root_dev mnt_parent_dev vol_dev
  root_dev="$(stat -Lc '%d' /)"
  mnt_parent_dev="$(stat -Lc '%d' "${mnt_parent}")"
  vol_dev="$(stat -c '%d' "${volume_mount}")"
  if [[ "${vol_dev}" == "${root_dev}" || "${vol_dev}" == "${mnt_parent_dev}" ]]; then
    log_error "Katalog ${volume_mount} nie znajduje się na odrębnym zamontowanym wolumenie blokowym (dzieli urządzenie z partycją /)."
    exit 2
  fi

  local root_src root_fstype root_mnt vol_src vol_fstype vol_mnt
  read -r root_src root_fstype root_mnt < <(read_df_entry /)
  read -r vol_src vol_fstype vol_mnt < <(read_df_entry "${volume_mount}")

  if is_disallowed_fstype "${vol_fstype}"; then
    log_error "Wolumen ${volume_mount} używa niedozwolonego systemu plików (${vol_fstype:-nieznany}); wymagany dyskowy wolumen blokowy."
    exit 2
  fi

  if [[ "${vol_src}" != /dev/* || "${vol_src}" == "${root_src}" || "${vol_mnt}" != "${volume_mount}" || "${vol_mnt}" == "/" || "${vol_mnt}" == "${root_mnt}" ]]; then
    log_error "Katalog ${volume_mount} nie jest punktem montowania wydzielonego wolumenu blokowego (dev=${vol_src:-brak}, mount=${vol_mnt:-brak})."
    exit 2
  fi

  if [[ ! -d "${ephemeral_base}" || ! -d "${trimmed}" ]]; then
    if (( preflight_mode == 1 )); then
      if [[ -d "${ephemeral_base}" ]]; then
        local preflight_base_real preflight_base_dev pf_src pf_fstype pf_mnt
        preflight_base_real="$(realpath -e -- "${ephemeral_base}")"
        preflight_base_dev="$(stat -c '%d' "${preflight_base_real}")"
        read -r pf_src pf_fstype pf_mnt < <(read_df_entry "${preflight_base_real}")
        if [[ "${preflight_base_real}" != "${ephemeral_base}" || "${preflight_base_dev}" != "${vol_dev}" || "${pf_src}" != "${vol_src}" || "${pf_mnt}" != "${volume_mount}" ]] || is_disallowed_fstype "${pf_fstype}"; then
          log_error "Katalog bazowy ${ephemeral_base} narusza spójność wolumenu blokowego (wykryto obcy mount lub przekierowanie)."
          exit 2
        fi
      fi
      RESOLVED_WORK_ROOT="${trimmed}"
      WORK_PROBE_DIR="${volume_mount}"
      WORK_ROOT_STATUS="pending-mkdir"
      return 0
    fi
    log_error "Wydzielony katalog --work-root (${trimmed}) nie istnieje — wymagane wcześniejsze utworzenie ${ephemeral_base} za zgodą właściciela."
    exit 2
  fi

  local resolved_base resolved_work
  resolved_base="$(realpath -e -- "${ephemeral_base}")"
  resolved_work="$(realpath -e -- "${trimmed}")"
  if [[ "${resolved_base}" != "${ephemeral_base}" || "${resolved_work}" != "${trimmed}" ]]; then
    log_error "Katalog --work-root (${trimmed}) nie zgadza się ze ścieżką kanoniczną (${resolved_work})."
    exit 2
  fi
  if [[ "${resolved_work}" != "${resolved_base}" && "${resolved_work}" != "${resolved_base}/"* ]]; then
    log_error "Rozwiązana ścieżka --work-root (${resolved_work}) wykracza poza ${resolved_base}."
    exit 2
  fi

  local base_dev work_dev base_src base_fstype base_mnt work_src work_fstype work_mnt
  base_dev="$(stat -c '%d' "${resolved_base}")"
  work_dev="$(stat -c '%d' "${resolved_work}")"
  if [[ "${base_dev}" != "${vol_dev}" || "${work_dev}" != "${vol_dev}" ]]; then
    log_error "Katalog --work-root (${resolved_work}) nie leży na tym samym wolumenie blokowym co ${volume_mount}."
    exit 2
  fi

  read -r base_src base_fstype base_mnt < <(read_df_entry "${resolved_base}")
  read -r work_src work_fstype work_mnt < <(read_df_entry "${resolved_work}")
  if is_disallowed_fstype "${base_fstype}" || is_disallowed_fstype "${work_fstype}"; then
    log_error "Katalog --work-root (${resolved_work}) używa niedozwolonego systemu plików (${work_fstype:-nieznany})."
    exit 2
  fi
  if [[ "${base_src}" != "${vol_src}" || "${work_src}" != "${vol_src}" || "${base_mnt}" != "${volume_mount}" || "${work_mnt}" != "${volume_mount}" ]]; then
    log_error "Katalog --work-root (${resolved_work}) ma odrębny punkt montowania (${work_mnt:-brak}) zamiast wolumenu ${volume_mount} (bind-mount jest zabroniony)."
    exit 2
  fi

  if [[ ! -O "${resolved_work}" || ! -w "${resolved_work}" ]]; then
    log_error "Wydzielony katalog --work-root (${resolved_work}) musi należeć do bieżącego użytkownika i być zapisywalny."
    exit 2
  fi

  local work_perm
  work_perm="$(stat -c '%a' "${resolved_work}")"
  if [[ "${work_perm}" == *[2367] ]]; then
    log_error "Katalog --work-root (${resolved_work}) ma niebezpieczne uprawnienia zapisu dla innych użytkowników (mode=${work_perm}); oczekiwano np. 0700."
    exit 2
  fi

  RESOLVED_WORK_ROOT="${resolved_work}"
  WORK_PROBE_DIR="${resolved_work}"
  WORK_ROOT_STATUS="ready"
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

assert_controllers_present_in_file() {
  local file_path="$1"
  local label="$2"
  if [[ ! -r "${file_path}" ]]; then
    log_error "Brak odczytywalnego pliku delegacji cgroups v2 (${label}: ${file_path}). Odmowa uruchomienia bez limitów cgroups."
    exit 3
  fi

  local controllers padded required_ctrl
  controllers="$(tr '\n' ' ' < "${file_path}")"
  padded=" ${controllers} "
  for required_ctrl in cpu memory pids; do
    if [[ "${padded}" != *" ${required_ctrl} "* ]]; then
      log_error "Brak wymaganej delegacji kontrolera cgroups v2 '${required_ctrl}' w ${file_path} (dostępne: ${controllers})."
      exit 3
    fi
  done
}

verify_user_systemd_readonly() {
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    log_error "Menedżer użytkownika systemd (systemctl --user) jest niedostępny — uruchomienie procesu testowego bez limitów cgroups jest zablokowane."
    exit 3
  fi

  local slice_controllers_file manager_dir
  slice_controllers_file="$(get_user_slice_controllers_file)"
  manager_dir="$(get_user_manager_cgroup_dir)"

  assert_controllers_present_in_file "${slice_controllers_file}" "user-slice"
  assert_controllers_present_in_file "${manager_dir}/cgroup.controllers" "user-manager-controllers"
  assert_controllers_present_in_file "${manager_dir}/cgroup.subtree_control" "user-manager-subtree_control"
}

verify_user_systemd_scope_active() {
  local probe_unit cgroup_root proc_cgroup_file probe_output
  probe_unit="pap-ci-probe-$(openssl rand -hex 6)"
  cgroup_root="$(get_cgroup_root_dir)"
  proc_cgroup_file="$(get_proc_self_cgroup_path)"

  if ! probe_output="$(
    systemd-run --user --scope --quiet --unit="${probe_unit}" "${SCOPE_LIMIT_ARGS[@]}" -- \
      bash -euo pipefail -c "${SCOPE_CGROUP_ENFORCER_SCRIPT}" bash \
      "${cgroup_root}" "${proc_cgroup_file}" "${probe_unit}" printf 'SCOPE_OK' 2>&1
  )" || [[ "${probe_output}" != "SCOPE_OK" ]]; then
    systemctl --user reset-failed "${probe_unit}.scope" >/dev/null 2>&1 || true
    log_error "Nie udało się utworzyć i zweryfikować transient scope przez systemd-run --user --scope z wymaganymi limitami cgroups (CPU/RAM/Swap/pids): ${probe_output:-brak szczegółów}. Odmowa uruchomienia."
    exit 3
  fi
}

cleanup() {
  local exit_code="${1:-$?}"
  if (( CLEANUP_DONE == 1 )); then
    return 0
  fi
  CLEANUP_DONE=1
  set +e
  # Ignoruj kolejne sygnały HUP/INT/TERM w trakcie sprzątania, aby powtórzony sygnał
  # nie przerwał usuwania kontenera, katalogu tymczasowego ani sieci Docker.
  trap '' HUP INT TERM
  trap - EXIT

  if [[ -n "${TEST_CHILD_PID}" ]]; then
    kill -TERM "${TEST_CHILD_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${SCOPE_UNIT}" =~ ^pap-ci-scope-[0-9a-f]{12}$ ]]; then
    timeout --signal=KILL 5s systemctl --user stop "${SCOPE_UNIT}.scope" >/dev/null 2>&1 || true
  fi

  if [[ -n "${TEST_CHILD_PID}" ]]; then
    local wait_step
    for wait_step in 1 2 3 4 5; do
      if ! kill -0 "${TEST_CHILD_PID}" >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    kill -KILL "${TEST_CHILD_PID}" >/dev/null 2>&1 || true
  fi

  if [[ "${SCOPE_UNIT}" =~ ^pap-ci-scope-[0-9a-f]{12}$ ]]; then
    systemctl --user kill --kill-whom=all --signal=SIGKILL "${SCOPE_UNIT}.scope" >/dev/null 2>&1 || true
    systemctl --user reset-failed "${SCOPE_UNIT}.scope" >/dev/null 2>&1 || true
  fi

  if [[ -n "${TEST_CHILD_PID}" ]]; then
    wait "${TEST_CHILD_PID}" >/dev/null 2>&1 || true
    TEST_CHILD_PID=""
  fi

  if [[ "${CONTAINER_NAME}" =~ ^pap-ci-pg18-[0-9a-f]{12}$ ]]; then
    docker exec -u 0 "${CONTAINER_NAME}" sh -c 'rm -rf /var/lib/postgresql/* /var/lib/postgresql/.[!.]* /var/lib/postgresql/..?* 2>/dev/null || true' >/dev/null 2>&1 || true
    docker rm -fv "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    if docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1; then
      log_error "Nie udało się usunąć kontenera tymczasowego ${CONTAINER_NAME}."
      if (( exit_code == 0 )); then
        exit_code=5
      fi
    fi
  fi

  local mnt_parent
  mnt_parent="$(get_volume_mount_parent)"
  mnt_parent="${mnt_parent%/}"
  local safe_run_dir_regex="^${mnt_parent}/HC_Volume_[0-9]+/pap-ci-ephemeral(/[A-Za-z0-9][A-Za-z0-9._-]*)*\/run-[0-9a-f]{12}$"

  if [[ -n "${RUN_DIR}" && ! -L "${RUN_DIR}" && "${RUN_DIR}" =~ ${safe_run_dir_regex} ]]; then
    if [[ -d "${RUN_DIR}/pgdata" && ! -L "${RUN_DIR}/pgdata" ]]; then
      rm -rf --one-file-system "${RUN_DIR}/pgdata" >/dev/null 2>&1 || \
        docker run --rm --pull=never -u 0 \
          --network=none \
          --memory=64m \
          --memory-swap=64m \
          --cpus=0.25 \
          --pids-limit=32 \
          --security-opt no-new-privileges:true \
          -v "${RUN_DIR}/pgdata:/cleanup" \
          --entrypoint sh "${PG_IMAGE}" \
          -c 'rm -rf /cleanup/* /cleanup/.[!.]* /cleanup/..?* 2>/dev/null || true; chmod 0700 /cleanup 2>/dev/null || true' >/dev/null 2>&1 || true
    fi

    if [[ -d "${RUN_DIR}" ]]; then
      rm -rf --one-file-system "${RUN_DIR}" >/dev/null 2>&1 || true
    fi

    if [[ -e "${RUN_DIR}" || -L "${RUN_DIR}" ]]; then
      log_error "Nie udało się całkowicie usunąć katalogu tymczasowego ${RUN_DIR}."
      if (( exit_code == 0 )); then
        exit_code=5
      fi
    fi
  fi

  if [[ "${NET_NAME}" =~ ^pap-ci-pg-net-[0-9a-f]{12}$ ]]; then
    docker network rm "${NET_NAME}" >/dev/null 2>&1 || true
    if docker network inspect "${NET_NAME}" >/dev/null 2>&1; then
      log_error "Nie udało się usunąć tymczasowej sieci Docker ${NET_NAME}."
      if (( exit_code == 0 )); then
        exit_code=5
      fi
    fi
  fi

  exit "${exit_code}"
}

on_signal() {
  local sig="$1"
  local code=130
  case "${sig}" in
    HUP) code=129 ;;
    INT) code=130 ;;
    TERM) code=143 ;;
  esac
  log_error "Otrzymano sygnał SIG${sig} — przerywanie pracy i usuwanie zasobów tymczasowych..."
  cleanup "${code}"
}

main() {
  PREFLIGHT_ONLY=0
  PULL_IF_MISSING=0
  BOOTSTRAP_RUNTIME_ROLE=0
  MODE="fixture"
  PORT="${DEFAULT_PORT}"
  TIMEOUT_SEC="${DEFAULT_TIMEOUT_SEC}"
  WORK_ROOT=""
  RESOLVED_WORK_ROOT=""
  WORK_PROBE_DIR=""
  WORK_ROOT_STATUS="not-specified"
  RUN_DIR=""
  CONTAINER_NAME=""
  NET_NAME=""
  SCOPE_UNIT=""
  TEST_CHILD_PID=""
  CLEANUP_DONE=0

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

  local required_bin
  for required_bin in realpath stat df awk; do
    if ! command -v "${required_bin}" >/dev/null 2>&1; then
      log_error "Brak wymaganego narzędzia systemowego: ${required_bin}"
      exit 3
    fi
  done

  local current_dir
  current_dir="$(realpath -e -- "${PWD}")"
  if is_forbidden_cwd "${current_dir}"; then
    log_error "Bieżący katalog (${current_dir}) należy do chronionej ścieżki usługowej. Użyj oddzielnego klonu testowego."
    exit 2
  fi

  if (( PREFLIGHT_ONLY == 0 )); then
    if [[ "${PAP_ALLOW_HETZNER_EPHEMERAL_PG:-}" != "1" ]]; then
      log_error "Brak potwierdzenia zgody (PAP_ALLOW_HETZNER_EPHEMERAL_PG=1). Uruchamianie nowych zasobów jest zablokowane."
      exit 2
    fi
    if [[ -z "${WORK_ROOT}" ]]; then
      log_error "Tryb wykonawczy wymaga jawnego wskazania --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral[/podkatalog]."
      exit 2
    fi
    if [[ $# -eq 0 ]]; then
      log_error "Podaj polecenie testowe po separatorze '--'."
      exit 2
    fi
  fi

  if [[ -n "${WORK_ROOT}" ]]; then
    validate_work_root "${WORK_ROOT}" "${PREFLIGHT_ONLY}"
  fi

  # --- Kontrola zasobów hosta i wymogów cgroups v2 (odczytowa) ---
  for required_bin in docker ss openssl timeout systemd-run systemctl; do
    if ! command -v "${required_bin}" >/dev/null 2>&1; then
      log_error "Brak wymaganego narzędzia systemowego: ${required_bin}"
      exit 3
    fi
  done

  local meminfo_path mem_available_kib mem_available_mib
  meminfo_path="$(get_proc_meminfo_path)"
  mem_available_kib="$(awk '/^MemAvailable:/ { print $2 }' "${meminfo_path}")"
  if [[ ! "${mem_available_kib}" =~ ^[0-9]+$ ]]; then
    log_error "Nie udało się odczytać MemAvailable z ${meminfo_path}."
    exit 3
  fi
  mem_available_mib="$(( mem_available_kib / 1024 ))"
  if (( mem_available_mib < MIN_MEM_AVAILABLE_MIB )); then
    log_error "Zbyt mało dostępnej pamięci RAM: ${mem_available_mib} MiB (minimum: ${MIN_MEM_AVAILABLE_MIB} MiB)."
    exit 3
  fi

  local root_free_mib
  root_free_mib="$(df -Pm / | awk 'NR==2 { print $4 }')"
  if (( root_free_mib < MIN_ROOT_FREE_MIB )); then
    log_error "Zbyt mało wolnego miejsca na /: ${root_free_mib} MiB (minimum: ${MIN_ROOT_FREE_MIB} MiB)."
    exit 3
  fi

  local work_free_summary="not-checked"
  if [[ -n "${WORK_PROBE_DIR}" ]]; then
    local work_free_mib
    work_free_mib="$(df -Pm "${WORK_PROBE_DIR}" | awk 'NR==2 { print $4 }')"
    if (( work_free_mib < MIN_WORK_FREE_MIB )); then
      log_error "Zbyt mało wolnego miejsca na wolumenie roboczym (${WORK_PROBE_DIR}): ${work_free_mib} MiB (minimum: ${MIN_WORK_FREE_MIB} MiB)."
      exit 3
    fi
    work_free_summary="${work_free_mib}MiB(${WORK_ROOT_STATUS})"
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

  verify_user_systemd_readonly

  local image_cached="no"
  if docker image inspect "${PG_IMAGE}" >/dev/null 2>&1; then
    image_cached="yes"
  fi

  log_info "Pre-flight OK: MemAvailable=${mem_available_mib}MiB, RootFree=${root_free_mib}MiB, WorkFree=${work_free_summary}, Port=127.0.0.1:${PORT} (wolny), ImageCached=${image_cached}, UserSystemdCgroups=yes."

  if (( PREFLIGHT_ONLY == 1 )); then
    exit 0
  fi

  # --- Aktywna weryfikacja scope cgroups użytkownika przed alokacją zasobów ---
  verify_user_systemd_scope_active

  # --- Przygotowanie izolowanego kontenera efemerycznego ---
  if [[ "${image_cached}" == "no" ]]; then
    if (( PULL_IF_MISSING == 0 )); then
      log_error "Obraz ${PG_IMAGE} nie jest jeszcze pobrany lokalnie. Dodaj --pull-if-missing po uzyskaniu zgody właściciela."
      exit 3
    fi
    log_info "Pobieranie przypiętego obrazu ${PG_IMAGE}..."
    docker pull "${PG_IMAGE}" >/dev/null
  fi

  trap 'cleanup "$?"' EXIT
  trap 'on_signal HUP' HUP
  trap 'on_signal INT' INT
  trap 'on_signal TERM' TERM

  local run_id
  run_id="$(openssl rand -hex 6)"
  local candidate_run_dir="${RESOLVED_WORK_ROOT}/run-${run_id}"
  if [[ -e "${candidate_run_dir}" || -L "${candidate_run_dir}" ]]; then
    log_error "Kolizja jednorazowego katalogu uruchomieniowego (${candidate_run_dir})."
    exit 4
  fi
  RUN_DIR="${candidate_run_dir}"
  mkdir -m 0700 "${RUN_DIR}"
  mkdir -m 0700 "${RUN_DIR}/pgdata"

  local boot_password
  boot_password="$(openssl rand -hex 24)"
  printf '%s' "${boot_password}" > "${RUN_DIR}/pg_pass.secret"
  # Katalog nadrzędny RUN_DIR ma 0700 (brak dostępu innych użytkowników na hoście),
  # a 0444 umożliwia odczyt pliku sekretu przez użytkownika postgres (uid 70) wewnątrz kontenera.
  chmod 0444 "${RUN_DIR}/pg_pass.secret"

  SCOPE_UNIT="pap-ci-scope-${run_id}"
  NET_NAME="pap-ci-pg-net-${run_id}"

  docker network create \
    --driver bridge \
    -o com.docker.network.bridge.enable_icc=false \
    "${NET_NAME}" >/dev/null

  local init_user="pap_test"
  local init_db="pap_test"
  if [[ "${MODE}" == "strict-migrator" ]]; then
    init_user="postgres"
    init_db="postgres"
  fi

  CONTAINER_NAME="pap-ci-pg18-${run_id}"
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
  port_binding="$(docker port "${CONTAINER_NAME}" 5432/tcp 2>/dev/null || true)"
  if [[ "${port_binding}" != "127.0.0.1:${PORT}" ]]; then
    log_error "Niedozwolone lub brakujące bindowanie portu kontenera (${port_binding:-brak}); oczekiwano wyłącznie 127.0.0.1:${PORT}."
    exit 4
  fi

  local ready=0
  local attempt=0
  local max_ready_attempts ready_sleep_sec running_state
  max_ready_attempts="$(get_pg_ready_max_attempts)"
  ready_sleep_sec="$(get_pg_ready_sleep_sec)"
  for attempt in $(seq 1 "${max_ready_attempts}"); do
    running_state="$(docker container inspect --format '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || printf 'unknown')"
    if [[ "${running_state}" == "false" ]]; then
      log_error "Kontener PostgreSQL 18.6 (${CONTAINER_NAME}) zakończył działanie przed osiągnięciem gotowości (próba ${attempt})."
      exit 4
    fi
    if docker exec "${CONTAINER_NAME}" pg_isready -h 127.0.0.1 -U "${init_user}" -d "${init_db}" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep "${ready_sleep_sec}"
  done

  if (( ready == 0 )); then
    log_error "Kontener PostgreSQL 18.6 nie osiągnął gotowości w wymaganym czasie (prób: ${attempt})."
    exit 4
  fi

  local test_db_password="${boot_password}"
  local runtime_db_url=""

  if [[ "${MODE}" == "strict-migrator" ]]; then
    test_db_password="$(openssl rand -hex 24)"
    if ! exec_container_super_psql postgres <<SQL
\\set migrator_pass '${test_db_password}'
CREATE ROLE pap_test LOGIN PASSWORD :'migrator_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE DATABASE pap_test OWNER pap_test ENCODING 'UTF8' TEMPLATE template0;
GRANT SET ON PARAMETER deadlock_timeout TO pap_test;
SQL
    then
      log_error "Inicjalizacja roli migratora pap_test w trybie strict-migrator nie powiodła się."
      exit 4
    fi

    if (( BOOTSTRAP_RUNTIME_ROLE == 1 )); then
      local runtime_password
      runtime_password="$(openssl rand -hex 24)"
      if ! exec_container_super_psql pap_test <<SQL
\\set runtime_pass '${runtime_password}'
CREATE ROLE pap_test_app LOGIN PASSWORD :'runtime_pass'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL
      then
        log_error "Inicjalizacja roli aplikacyjnej pap_test_app w trybie strict-migrator nie powiodła się."
        exit 4
      fi
      runtime_db_url="postgres://pap_test_app:${runtime_password}@127.0.0.1:${PORT}/pap_test"
    fi

    # Blokada logowania superusera postgres po TCP (127.0.0.1:${PORT}) w trybie strict-migrator
    # (uwierzytelnienie po gnieździe Unix z PGPASSWORD odczytanym wewnątrz kontenera z /run/secrets/pg_pass).
    if ! docker exec -i -u postgres "${CONTAINER_NAME}" sh -eu -c '
      export PGPASSWORD
      PGPASSWORD="$(cat /run/secrets/pg_pass)"
      HBA_FILE="$(psql -X -w -q -t -A -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SHOW hba_file")"
      if [ -z "${HBA_FILE}" ] || [ ! -f "${HBA_FILE}" ]; then
        echo "Nie udało się ustalić pliku pg_hba.conf (${HBA_FILE:-brak})." >&2
        exit 4
      fi
      TMP_HBA="${HBA_FILE}.pap.tmp"
      umask 077
      {
        printf "host all postgres 0.0.0.0/0 reject\n"
        printf "host all postgres ::/0 reject\n"
        cat "${HBA_FILE}"
      } > "${TMP_HBA}"
      mv -f "${TMP_HBA}" "${HBA_FILE}"
      psql -X -w -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "SELECT pg_reload_conf();" >/dev/null
    '; then
      log_error "Utwardzenie pg_hba.conf w trybie strict-migrator nie powiodło się."
      exit 4
    fi
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

  local cgroup_root proc_cgroup_file
  cgroup_root="$(get_cgroup_root_dir)"
  proc_cgroup_file="$(get_proc_self_cgroup_path)"

  # Obowiązkowe limity cgroups v2 na całe drzewo procesu testowego + weryfikacja wewnątrz scope'a przed exec —
  # brak jakiegokolwiek fallbacku na sam timeout.
  local -a runner_prefix=(
    systemd-run --user --scope --quiet
    --unit="${SCOPE_UNIT}"
    "${SCOPE_LIMIT_ARGS[@]}"
    --
    bash -euo pipefail -c "${SCOPE_CGROUP_ENFORCER_SCRIPT}" bash
    "${cgroup_root}" "${proc_cgroup_file}" "${SCOPE_UNIT}"
    timeout --signal=TERM --kill-after=15s "${TIMEOUT_SEC}s"
  )

  log_info "Baza pap_test gotowa na 127.0.0.1:${PORT}. Wykonywanie polecenia testowego w scope ${SCOPE_UNIT} (timeout=${TIMEOUT_SEC}s)..."
  (
    export PAP_DATABASE_ENV="test"
    export DATABASE_URL="${test_db_url}"
    export CI="1"
    export NEXT_TELEMETRY_DISABLED="1"
    export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=512}"
    if [[ -n "${runtime_db_url}" ]]; then
      export PAP_EPHEMERAL_RUNTIME_DATABASE_URL="${runtime_db_url}"
    fi
    exec "${runner_prefix[@]}" "$@" </dev/null
  ) &
  TEST_CHILD_PID=$!

  local cmd_exit=0
  wait "${TEST_CHILD_PID}" || cmd_exit=$?
  TEST_CHILD_PID=""

  if (( cmd_exit == 124 || cmd_exit == 137 )); then
    log_error "Polecenie testowe przekroczyło limit czasu (${TIMEOUT_SEC}s, exit=${cmd_exit})."
  elif (( cmd_exit != 0 )); then
    log_error "Polecenie testowe zakończyło się błędem (exit=${cmd_exit})."
  fi

  exit "${cmd_exit}"
}

if ! (return 0 2>/dev/null); then
  main "$@"
fi
