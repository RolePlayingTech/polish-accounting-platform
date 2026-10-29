# Izolowane środowisko testowe PostgreSQL 18.6 na serwerze Hetzner (`hetz-1`)

- **Data weryfikacji odczytowej:** 2026-10-29
- **Powiązane zadania i decyzje:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19), [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), [PR #31 (`6D-3`)](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31), [ADR-006 (tymczasowe CI na Hetznerze)](adr/006-tymczasowe-ci-hetzner.md), [ADR-006 (prywatny staging Hetzner)](adr/006-prywatny-staging-hetzner.md)
- **Skrypt wykonawczy w repozytorium:** [`scripts/hetzner/with-ephemeral-pg18.sh`](../scripts/hetzner/with-ephemeral-pg18.sh)
- **Status gotowości na hoście (`2026-10-29`):** **Brak działającej i wydzielonej bazy testowej PostgreSQL 18.6** (`NOT RUNNING / NOT PROVISIONED`). W niniejszym zadaniu wykonano wyłącznie odczytową inwentaryzację serwera (bez zmian na hoście) oraz przygotowano gotowy, samooczyszczający się mechanizm kontenerowy wymagający potwierdzenia zgody właściciela przed pierwszym uruchomieniem.

---

## 1. Faktyczny stan serwera Hetzner (`hetz-1`) — audyt odczytowy z `2026-10-29`

Wszystkie poniższe wartości zostały odczytane bezinwazyjnie przez `ssh hetzner` bez uruchamiania nowych procesów usługowych, pobierania obrazów ani modyfikacji plików:

### 1.1. Zasoby sprzętowe i systemowe

| Zasób | Stan faktyczny (`2026-10-29`) | Wnioski dla testów PostgreSQL 18.6 |
| --- | --- | --- |
| **System i jądro** | Ubuntu (`Linux hetz-1 6.8.0-90-generic x86_64`), uptime `287 dni` | Stabilny host współdzielony; zakaz restartów i instalacji pakietów systemowych `apt`. |
| **CPU** | `2 vCPU` (`Intel Xeon Skylake`, 1 socket × 2 rdzenie × 1 wątek), `load average: 0.62, 0.37, 0.15`, bezczynność w spoczynku `98–99%` | Wystarczające dla pojedynczego kontenera testowego z limitem `--cpus=0.50` oraz procesu testowego z `CPUQuota=50%`. |
| **Pamięć RAM** | `3819 MiB` (`3.7 GiB`) łącznie, `1352 MiB` użyte, **`2467 MiB` (`~2.4 GiB`) `MemAvailable`** | Bezpieczny zapas pamięci pod warunkiem twardych limitów cgroups v2 (`384 MiB` dla PG18 + `768 MiB` dla Vitest = maks. `~1.12 GiB`). |
| **Swap** | `8191 MiB` (`8.0 GiB`) w pliku na wolumenie blokowym, **`1888 MiB` (`~1.8 GiB`) w użyciu**, aktywność wymiany w spoczynku `si=0, so=0` | Kontener testowy musi mieć `--memory=384m --memory-swap=384m`, a runner testowy `MemorySwapMax=0`, aby nie powiększać użycia swapu. |
| **Dysk główny `/`** | `/dev/sda1` (`ext4`, `rw,relatime`): `38 GiB` łącznie, `29 GiB` użyte (**`81%`**), **`7.1 GiB` dostępne** | **Istotne ograniczenie:** na `/` leży `/var/lib/docker` (`9.8 GB` obrazów, `5.2 GB` build cache). Nie wolno klonować repozytorium ani instalować `node_modules` na `/`. |
| **Wolumen blokowy** | `/dev/sdb` (`/mnt/HC_Volume_<REDACTED>`, `ext4`, `rw,relatime,discard`): `49 GiB` łącznie, `23 GiB` użyte (`49%`), **`24 GiB` dostępne** | Docelowe miejsce na wydzielony katalog roboczy CI/testów (poza katalogiem `pap-staging`). |
| **`/dev/shm`** | `tmpfs` `1.9 GiB`, użycie `0%` | Dostępna pamięć współdzielona hosta pozostaje nienaruszona. |

### 1.2. Kontenery, usługi i porty

- **Docker Engine:** `29.4.3` (`API 1.54`), `Docker Compose v5.1.3`.
- **Aktywne kontenery Docker (wszystkie należą do innych projektów — zakaz ingerencji):**
  - `shorts-api-shorts-backend-1` (`127.0.0.1:8010->8000/tcp`, `Up 2 months (healthy)`)
  - `shorts-api-youtube-pot-provider-1` (`4416/tcp`, `Up 2 months`)
  - `reels-api-video-backend-1` (`127.0.0.1:8000->8000/tcp`, `Up 4 months (healthy)`)
- **Aktywne usługi PAP (prywatny staging techniczny Etapu A.1 — zakaz używania do testów):**
  - `pap-staging-api.service` (`127.0.0.1:4100`, `MemoryCurrent ~31 MiB`)
  - `pap-staging-web.service` (`127.0.0.1:3100`, `MemoryCurrent ~70 MiB`)
  - `pap-staging-healthcheck.timer` (`active/waiting`)
  - Izolowany runtime w `/opt/pap-runtime`: **Node.js `v24.22.1`** oraz **pnpm `12.15.0`** (zgodne z wymaganiami `package.json`).
- **Dostępne mechanizmy izolacji i limitowania zasobów:**
  1. **Docker + cgroups v2 (`CgroupDriver=systemd`, `CgroupVersion=2`):** potwierdzone wsparcie `MemoryLimit=true`, `SwapLimit=true`, `pids-limit`, `SecurityOptions=[apparmor, seccomp(builtin), cgroupns]`, `no-new-privileges:true`, prywatnych sieci bridge (`enable_icc=false`) i bindowania wyłącznie do `127.0.0.1`.
  2. **`systemd 255` (`systemd-run --user --scope`):** w nieinteraktywnej sesji `ssh hetzner` działa menedżer użytkownika (`XDG_RUNTIME_DIR=/run/user/1000`, `USER_SYSTEMD=OK`) z delegacją kontrolerów `cpu memory pids` na `user-1000.slice`. Pozwala to objąć sam proces `vitest`/`node` twardym limitem pamięci i CPU bez instalowania żadnych jednostek systemowych.
  3. **Narzędzia procesowe:** `/usr/bin/timeout`, `/usr/bin/unshare`, `/usr/bin/bwrap` (brak `podman` i `firejail`).

---

## 2. Czy bezpieczne środowisko testowe PostgreSQL 18.6 już istnieje?

**Nie (`[Potwierdzone na serwerze]`).**

1. W `ss -lntup` brak jakiegokolwiek procesu nasłuchującego na porcie `5432` lub portach testowych (`15432`, `55432`).
2. W `docker ps -a` nie ma żadnego działającego ani zatrzymanego kontenera PostgreSQL.
3. W lokalnym cache `docker images` **nie ma obrazu `postgres:18.6-alpine`** (znajduje się tam wyłącznie obraz `mumro-postgres:16-pgvector` innego projektu).
4. Na hoście nie ma zainstalowanych pakietów `postgresql-*`, a binaria `psql`, `pg_isready` i `postgres` nie występują w `PATH` (są dostępne wewnątrz oficjalnego obrazu `postgres:18.6-alpine`).
5. Katalog `/mnt/HC_Volume_<REDACTED>/pap-staging/` zawiera wyłącznie nieuruchomiony szablon dla przyszłej bazy stagingu (`pap_staging` na porcie `127.0.0.1:5432`). Zgodnie z `AGENTS.md` i `ADR-006` zasoby i konfiguracja `pap-staging` są bezwzględnie wykluczone z użycia w testach.

---

## 3. Przygotowany sposób uruchomienia tymczasowego PostgreSQL 18.6

W repozytorium przygotowano skrypt [`scripts/hetzner/with-ephemeral-pg18.sh`](../scripts/hetzner/with-ephemeral-pg18.sh), który realizuje pełny cykl życia efemerycznego środowiska testowego na `hetz-1` bez instalowania usług systemowych:

### 3.1. Parametry izolacji i limitów zasobów

- **Przypięty obraz (identyczny z `.github/workflows/ci.yml` i `ADR-006`):**
  `postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`
- **Limity cgroups v2 kontenera PostgreSQL:**
  `--memory=384m --memory-swap=384m --cpus=0.50 --pids-limit=128 --security-opt no-new-privileges:true`
- **Izolacja sieciowa i port loopback:**
  - Dedykowana, jednorazowa sieć bridge `pap-ci-pg-net-<run_id>` z wyłączoną komunikacją między kontenerami (`com.docker.network.bridge.enable_icc=false`), odseparowana od `bridge`, `shorts-api_default` i `reels-api_default`.
  - Publikacja portu wyłącznie na wysokim porcie loopback: `127.0.0.1:55432:5432` (port `5432` zarezerwowany dla `pap_staging` jest programowo zablokowany w skrypcie; po starcie skrypt weryfikuje `docker port`, aby wykluczyć `0.0.0.0`/`[::]`).
  - *(Uwaga techniczna Docker 29: nie używamy flagi `--internal` na sieci kontenera publikującego port na loopbacku hosta, ponieważ Docker 28/29 blokuje port mapping na sieciach `--internal`).*
- **Zarządzanie dyskiem i układem `PGDATA` w PostgreSQL 18:**
  - Od wersji `postgres:18` oficjalny obraz `docker-library/postgres` definiuje `VOLUME /var/lib/postgresql` oraz `PGDATA=/var/lib/postgresql/18/docker` (zamiast dawnego `/var/lib/postgresql/data`).
  - Skrypt montuje jednorazowy katalog `${RUN_DIR}/pgdata` z wolumenu blokowego bezpośrednio pod `/var/lib/postgresql`, dzięki czemu:
    1. pliki klastra i WAL korzystają z wolumenu z `24 GiB` wolnego miejsca zamiast partycji `/` (`81%`),
    2. nie obciążają limitu `384 MiB` RAM kontenera (jak robiłby `tmpfs` pod cgroups v2),
    3. Docker nie tworzy osieroconych anonimowych wolumenów w `/var/lib/docker/volumes`.
- **Ochrona poświadczeń i logów:**
  - Losowe 192-bitowe hasła generowane per uruchomienie (`openssl rand -hex 24`), przekazywane do kontenera przez plik `POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass` (`scram-sha-256`), bez obecności hasła w `ps aux` i `docker inspect`.
  - Wyłączone logowanie zapytań i parametrów SQL (`log_statement=none`), aby testowe klucze HMAC `security_context_key` nie trafiały do logów kontenera.
- **Konserwatywne parametry silnika PostgreSQL i timeouty:**
  `shared_buffers=64MB`, `work_mem=4MB`, `maintenance_work_mem=32MB`, `max_connections=32`, `statement_timeout=15s`, `lock_timeout=10s`, `idle_in_transaction_session_timeout=15s`.
- **Limity na proces testowy (`vitest`/`node`):**
  Wywołanie opakowane w `systemd-run --user --scope` (`MemoryHigh=512M`, `MemoryMax=768M`, `MemorySwapMax=0`, `CPUQuota=50%`, `TasksMax=128`) oraz `timeout --signal=TERM --kill-after=15s 300s`.
- **Gwarantowane sprzątanie (`trap cleanup EXIT INT TERM`):**
  Po zakończeniu polecenia (także po błędzie lub sygnale) skrypt usuwa pliki klastra, niszczy kontener (`docker rm -fv`), usuwa jednorazową sieć bridge i kasuje katalog `${RUN_DIR}`.

---

## 4. Jaka zgoda właściciela jest wymagana przed uruchomieniem?

Zgodnie z zasadą nienaruszania zasobów bez potwierdzonej zgody, przed pierwszym wykonaniem testów na `hetz-1` potrzebna jest krótka decyzja właściciela zatwierdzająca dwa kroki przygotowawcze:

1. **Wydzielenie katalogu roboczego dla efemerycznego CI na wolumenie blokowym** (całkowicie poza `pap-staging`):
   ```bash
   sudo install -d -m 0700 -o admin -g admin /mnt/HC_Volume_<ID>/pap-ci-ephemeral
   ```
2. **Zgoda na jednorazowe pobranie przypiętego obrazu `postgres:18.6-alpine@sha256:10a5c69a...` (`~280 MB` na `/var/lib/docker`) i uruchamianie krótkotrwałych kontenerów testowych** na `127.0.0.1:55432` z limitem `384 MiB RAM / 0.50 CPU` przez `PAP_ALLOW_HETZNER_EPHEMERAL_PG=1`.

Bez zmiennej `PAP_ALLOW_HETZNER_EPHEMERAL_PG=1` oraz wydzielonego katalogu `--work-root` skrypt działa wyłącznie w trybie odczytowym (`--preflight-only`) i odmawia tworzenia jakichkolwiek zasobów.

---

## 5. Ograniczenia i uwagi operacyjne

1. **Zakaz pełnego `pnpm build` i E2E na współdzielonym hoście:** kompilacja produkcyjna Next.js (`@pap/web`) oraz przeglądarka Chromium przekraczają bezpieczny budżet pamięci hosta z `1.8 GiB` aktywnego swapu. Do testów integracyjnych `@pap/db` wymagane jest wyłącznie lekkie zbudowanie deklaracji i modułów czystego TypeScriptu (`tsc -b` w `@pap/contracts`, `@pap/domain`, `@pap/application`, tj. `pnpm --filter @pap/application... build`), które mieści się w limicie `MemoryMax=512M` (lub może zostać dostarczone jako gotowy artefakt z maszyny deweloperskiej).
2. **Brak równoległego uruchamiania wielu kampanii DB:** testy integracyjne instalują rozszerzenia na poziomie bazy (`btree_gist`, `pgcrypto`) oraz tworzą globalną rolę klastra `pap_test_app`, dlatego używają `fileParallelism: false` i muszą być wykonywane pojedynczo.
3. **Uwaga dot. nieaktywnego szablonu stagingu (Etap A.2):** podczas audytu odczytowego zauważono, że nieuruchomiony szablon `/mnt/HC_Volume_<REDACTED>/pap-staging/compose/docker-compose.postgres.yml` montuje wolumen pod historyczną ścieżką `/var/lib/postgresql/data` zamiast `/var/lib/postgresql` wymaganej przez `postgres:18.6-alpine`. Zgodnie z zakazem modyfikacji stagingu pliku tego nie zmieniano — należy go zaktualizować przed przyszłym uruchomieniem Etapu A.2.

---

## 6. Dokładna instrukcja dla agenta wykonującego walidację `6D-3`

Po uzyskaniu zgody właściciela (Rozdział 4) oraz zsynchronizowaniu gałęzi kandydata ([PR #31](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31)) wykonaj poniższą procedurę przez `ssh hetzner`. **Nie używaj i nie dotykaj `/var/www/pap-staging`, `/etc/pap` ani portu `5432`. Nie wypisuj `DATABASE_URL` ani haseł na wyjście.**

### Krok 1 — Odczytowy pre-flight hosta

```bash
ssh hetzner
export PATH="/opt/pap-runtime/current/bin:$PATH"
export COREPACK_HOME="/opt/pap-runtime/corepack-home"
export COREPACK_ENABLE_NETWORK=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

/var/www/pap-staging/bin/pap-monitor-resources.sh
```

Upewnij się, że `MemAvailable >= 1.4 GiB`, a wolne miejsce na `/` wynosi `>= 3.0 GiB`.

### Krok 2 — Przygotowanie izolowanego workspace'u na wolumenie blokowym

```bash
CI_ROOT="/mnt/HC_Volume_<ID>/pap-ci-ephemeral"
mkdir -p "$CI_ROOT/pnpm-store" "$CI_ROOT/pg-runs"

# Czysty checkout testowanego SHA poza partycją główną /
rm -rf "$CI_ROOT/repo"
git clone --no-tags --branch codex/6d3c-security-audit --single-branch \
  https://github.com/RolePlayingTech/polish-accounting-platform.git "$CI_ROOT/repo"
cd "$CI_ROOT/repo"
git rev-parse HEAD
```

Jeżeli skrypt `scripts/hetzner/with-ephemeral-pg18.sh` nie został jeszcze scalony do gałęzi `codex/6d3c-security-audit`, pobierz go z `origin/main` (lub gałęzi PR z niniejszym skryptem) do `$CI_ROOT/with-ephemeral-pg18.sh` poza drzewem git, aby nie zmieniać badanego `HEAD` SHA:

```bash
# Tylko jeśli brak pliku w badanym HEAD:
git fetch origin main
git show origin/main:scripts/hetzner/with-ephemeral-pg18.sh > "$CI_ROOT/with-ephemeral-pg18.sh"
chmod 0700 "$CI_ROOT/with-ephemeral-pg18.sh"
RUNNER="${CI_ROOT}/with-ephemeral-pg18.sh" # lub ./scripts/hetzner/with-ephemeral-pg18.sh
```

Zainstaluj zależności z użyciem sklepu `pnpm` na wolumenie blokowym i skompiluj wyłącznie lekkie pakiety warstw wewnętrznych (`contracts`, `domain`, `application` — **bez `pnpm build` całego monorepo**):

```bash
# Uwaga: tylko przy pierwszym uruchomieniu na pustym pnpm-store może być konieczne
# tymczasowe pobranie pakietów npm; sam proces uruchom w scope cgroup v2:
systemd-run --user --scope -p MemoryHigh=512M -p MemoryMax=768M -p MemorySwapMax=0 -p CPUQuota=50% -- \
  pnpm install --frozen-lockfile --store-dir "$CI_ROOT/pnpm-store"

systemd-run --user --scope -p MemoryHigh=384M -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -- \
  pnpm --filter @pap/application... build
```

Wykonaj odczytowy pre-flight skryptu:

```bash
"$RUNNER" --preflight-only --work-root "$CI_ROOT/pg-runs" --port 55432
```

### Krok 3 — Kampania A: pełne testy integracyjne `6D-3` w izolowanym PostgreSQL 18.6 (`--mode fixture`)

W tym przebiegu świeży kontener udostępnia pustą bazę `pap_test` (bez `btree_gist`, `pgcrypto` i `pap_test_app`), a harness `runtime-security.integration.ts` sam tworzy nieuprzywilejowaną rolę `pap_test_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`) i testuje realne wyścigi, podpis HMAC, `FORCE RLS`, constraint triggers oraz audyt `allow`/`deny`:

```bash
# Pierwsze uruchomienie pobiera przypięty po SHA-256 obraz postgres:18.6-alpine (--pull-if-missing)
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode fixture \
  --timeout 300 \
  --pull-if-missing \
  -- pnpm --filter @pap/db exec vitest run --config vitest.integration.config.ts \
       test/runtime-security.integration.ts

PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode fixture \
  --timeout 300 \
  -- pnpm --filter @pap/db exec vitest run --config vitest.integration.config.ts \
       test/transactional-authz.integration.ts

# Pełny zestaw integracyjny @pap/db (migracje 0000->0005, rollback, 6B, 6D-1, 6D-R, 6D-2, 6D-3)
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode fixture \
  --timeout 420 \
  -- pnpm test:integration
```

### Krok 4 — Kampania B: obowiązkowy odbiór migratora `NOSUPERUSER` / `NOBYPASSRLS` (`--mode strict-migrator`)

Zgodnie z `docs/6D3_VALIDATION_HANDOFF.md` oraz review w [PR #31](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31) należy osobno potwierdzić, że łańcuch migracji `0000`→`0005`, ręczny provisioning ACL/klucza, `FORCE ROW LEVEL SECURITY` i funkcje `SECURITY DEFINER` działają prawidłowo, gdy właściciel bazy i tabel (`pap_test`) **nie jest superuserem** (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`):

```bash
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode strict-migrator \
  --bootstrap-runtime-role \
  --timeout 300 \
  -- bash -euo pipefail -c '
    # 1. Cold install 0000->0005 jako NOSUPERUSER migrator pap_test + ponowienie idempotentne
    pnpm db:migrate
    pnpm db:migrate

    # 2. Provisioning losowego klucza HMAC i restrykcyjnych uprawnień runtime-privileges.sql
    KEY_HEX="$(openssl rand -hex 32)"
    PAP_TEST_KEY_HEX="$KEY_HEX" pnpm --filter @pap/db exec tsx -e "
      import { connectDatabase } from \"./src/client.ts\";
      import { configureRuntimePrivileges, provisionDatabaseContextKey } from \"./src/runtime-provisioning.ts\";
      import { createPostgresSecurityServices } from \"./src/runtime-security.ts\";
      import { PostgresContextSigner } from \"./src/signed-context.ts\";

      const migrator = connectDatabase(process.env, \"public\", { roleScope: \"migrator\", maxConnections: 1 });
      const runtime = connectDatabase(
        { PAP_DATABASE_ENV: \"test\", DATABASE_URL: process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL },
        \"public\",
        { roleScope: \"runtime\", maxConnections: 1 },
      );
      try {
        const [{ version }] = await migrator.client\`SELECT version()\`;
        const roles = await migrator.client\`
          SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb
          FROM pg_roles WHERE rolname IN (\x27pap_test\x27, \x27pap_test_app\x27) ORDER BY rolname
        \`;
        console.log({ version, roles });
        await provisionDatabaseContextKey(migrator.db, {
          keyId: \"strict-check\",
          keyHex: process.env.PAP_TEST_KEY_HEX!,
          runtimeRole: \"pap_test_app\",
        });
        await configureRuntimePrivileges(migrator.db, \"pap_test_app\");
        await createPostgresSecurityServices(
          runtime.db,
          new PostgresContextSigner({ keyId: \"strict-check\", keyHex: process.env.PAP_TEST_KEY_HEX! }),
        );
        console.log(\"STRICT_MIGRATOR_AND_RUNTIME_VERIFIED=OK\");
      } finally {
        await runtime.client.end({ timeout: 1 });
        await migrator.client.end({ timeout: 1 });
      }
    "
  '
```

### Krok 5 — Sprzątanie i kontrola po zakończeniu

1. Usuń tymczasowy klon repozytorium (`rm -rf "$CI_ROOT/repo" "$CI_ROOT/pg-runs/*"`).
2. Zweryfikuj brak pozostawionych kontenerów, sieci i procesów oraz nienaruszony stan usług:
   ```bash
   docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
   docker network ls
   ss -lnt | grep 55432 || echo "Port 55432 zwolniony"
   /var/www/pap-staging/bin/pap-monitor-resources.sh
   ```
3. Opublikuj pełny raport odbioru w [PR #31](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31) / [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6) (dokładny SHA, `SELECT version()`, wykaz ról i flag `pg_roles`, wykonany zakres, pominięcia i wyniki wszystkich punktów kontrolnych).
