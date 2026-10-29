# Izolowane środowisko testowe PostgreSQL 18.6 na serwerze Hetzner (`hetz-1`)

- **Data weryfikacji odczytowej:** 2026-10-29
- **Powiązane zadania i decyzje:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19), [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), [PR #31 (`6D-3`)](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31), [PR #33](https://github.com/RolePlayingTech/polish-accounting-platform/pull/33), [ADR-006 (tymczasowe CI na Hetznerze)](adr/006-tymczasowe-ci-hetzner.md), [ADR-006 (prywatny staging Hetzner)](adr/006-prywatny-staging-hetzner.md)
- **Skrypt wykonawczy w repozytorium:** [`scripts/hetzner/with-ephemeral-pg18.sh`](../scripts/hetzner/with-ephemeral-pg18.sh)
- **Status gotowości na hoście (`2026-10-29`):** **Brak działającej i wydzielonej bazy testowej PostgreSQL 18.6** (`NOT RUNNING / NOT PROVISIONED`). W niniejszym zadaniu wykonano wyłącznie odczytową inwentaryzację serwera (bez zmian na hoście, bez pobierania obrazów i bez uruchamiania kontenerów) oraz przygotowano gotowy, samooczyszczający się mechanizm kontenerowy wymagający potwierdzenia zgody właściciela przed pierwszym uruchomieniem.

---

## 1. Faktyczny stan serwera Hetzner (`hetz-1`) — audyt odczytowy z `2026-10-29`

Wszystkie poniższe wartości zostały odczytane bezinwazyjnie przez `ssh hetzner` bez uruchamiania nowych procesów usługowych, pobierania obrazów ani modyfikacji plików:

### 1.1. Zasoby sprzętowe i systemowe

| Zasób               | Stan faktyczny (`2026-10-29`)                                                                                                            | Wnioski dla testów PostgreSQL 18.6                                                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **System i jądro**  | Ubuntu 24.04.3 LTS (`Linux hetz-1 6.8.0-90-generic x86_64`), uptime `287 dni`                                                            | Stabilny host współdzielony; zakaz restartów i instalacji pakietów systemowych `apt`.                                                                                                                 |
| **CPU**             | `2 vCPU` (`Intel Xeon Skylake`, 1 socket × 2 rdzenie × 1 wątek), `load average: 0.15..0.62`, bezczynność w spoczynku `98–99%`            | Wystarczające dla pojedynczego kontenera testowego z limitem `--cpus=0.50` oraz procesu testowego z obowiązkowym `CPUQuota=50%`.                                                                      |
| **Pamięć RAM**      | `3819 MiB` (`3.7 GiB`) łącznie, `1352 MiB` użyte, **`2467–2504 MiB` (`~2.4 GiB`) `MemAvailable`**                                        | Bezpieczny zapas pamięci pod warunkiem obowiązkowych limitów cgroups v2 (`384 MiB` dla PG18 + `768 MiB` dla drzewa procesu testowego = maks. `~1.12 GiB`).                                            |
| **Swap**            | `8191 MiB` (`8.0 GiB`) w pliku na wolumenie blokowym, **`1888 MiB` (`~1.8 GiB`) w użyciu**, aktywność wymiany w spoczynku `si=0, so=0`   | Kontener testowy ma `--memory=384m --memory-swap=384m`, a scope procesu testowego `MemorySwapMax=0`, aby nie powiększać użycia swapu.                                                                 |
| **Dysk główny `/`** | `/dev/sda1` (`ext4`, `rw,relatime`): `38 GiB` łącznie, `29 GiB` użyte (**`81%`**), **`~7.0–7.1 GiB` dostępne**                           | **Istotne ograniczenie:** na `/` leży `/var/lib/docker` (`9.8 GB` obrazów, `5.2 GB` build cache). Zakaz klonowania repozytorium, instalacji `node_modules` i tworzenia katalogów roboczych PG na `/`. |
| **Wolumen blokowy** | `/dev/sdb` (`/mnt/HC_Volume_<REDACTED>`, `ext4`, `rw,relatime,discard`): `49 GiB` łącznie, `23 GiB` użyte (`49%`), **`24 GiB` dostępne** | Jedyne dozwolone miejsce na wydzielony katalog roboczy `/mnt/HC_Volume_<ID>/pap-ci-ephemeral` (poza katalogami `pap-staging` i innych projektów).                                                     |
| **`/dev/shm`**      | `tmpfs` `1.9 GiB`, użycie `0%`                                                                                                           | Dostępna pamięć współdzielona hosta pozostaje nienaruszona.                                                                                                                                           |

### 1.2. Kontenery, usługi i porty

- **Docker Engine:** `29.4.3` (`API 1.54`, `FirewallBackend=iptables`, `LiveRestore=false`), `Docker Compose v5.1.3`.
- **Aktywne kontenery Docker (wszystkie należą do innych projektów — zakaz ingerencji):**
  - `shorts-api-shorts-backend-1` (`127.0.0.1:8010->8000/tcp`, sieć `shorts-api_default`)
  - `shorts-api-youtube-pot-provider-1` (`4416/tcp`, sieć `shorts-api_default`)
  - `reels-api-video-backend-1` (`127.0.0.1:8000->8000/tcp`, sieć `reels-api_default`)
- **Aktywne usługi PAP (prywatny staging techniczny Etapu A.1 — zakaz używania do testów):**
  - `pap-staging-api.service` (`127.0.0.1:4100`, `MemoryCurrent ~31–41 MiB`)
  - `pap-staging-web.service` (`127.0.0.1:3100`, `MemoryCurrent ~49–70 MiB`)
  - `pap-staging-healthcheck.timer` (`active/waiting`)
  - Izolowany runtime w `/opt/pap-runtime` (zgodny z `package.json`, podczas gdy domyślny systemowy `/usr/bin/node` to `v20.20.2` bez `pnpm` w `PATH`):
    - **Node.js `v24.22.1`** w `/opt/pap-runtime/current/bin/node` (`current -> node-v24.22.1-linux-x64`),
    - **pnpm `12.15.0`** w `/opt/pap-runtime/pnpm/pnpm` z cache offline w `/opt/pap-runtime/corepack-home/v1/pnpm/12.15.0` (**uwaga:** w `/opt/pap-runtime/current/bin` nie ma pliku `pnpm`, dlatego `PATH` musi zawierać oba katalogi: `/opt/pap-runtime/pnpm:/opt/pap-runtime/current/bin`, wraz z `COREPACK_DEFAULT_TO_LATEST=0`).
- **Dostępne mechanizmy izolacji i limitowania zasobów (`[Potwierdzone na serwerze]`):**
  1. **Docker + cgroups v2 (`CgroupDriver=systemd`, `CgroupVersion=2`):** potwierdzone wsparcie `MemoryLimit=true`, `SwapLimit=true`, `pids-limit`, `SecurityOptions=[apparmor, seccomp(builtin), cgroupns]`, `no-new-privileges:true`, `--cap-drop=NET_RAW`, prywatnych sieci bridge (`enable_icc=false`) i bindowania wyłącznie do `127.0.0.1`.
  2. **`systemd 255` (`systemd-run --user --scope`):** w nieinteraktywnej sesji `ssh hetzner` działa menedżer użytkownika (`systemctl --user is-system-running` -> `running`, `XDG_RUNTIME_DIR=/run/user/1000`, `Delegate=yes`) z delegacją kontrolerów `cpu memory pids` potwierdzoną zarówno w `/sys/fs/cgroup/user.slice/user-1000.slice/cgroup.controllers`, jak i w `/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/{cgroup.controllers,cgroup.subtree_control}`.
  3. **Parametr jądra `net.ipv4.conf.all.route_localnet=0` (`default=0`):** interfejs loopback `127.0.0.1` hosta nie jest routowalny z zewnętrznych przestrzeni nazw sieci kontenerów.

---

## 2. Czy bezpieczne środowisko testowe PostgreSQL 18.6 już istnieje?

**Nie (`[Potwierdzone na serwerze]`).**

1. W `ss -lnt` brak jakiegokolwiek procesu nasłuchującego na porcie `5432` lub portach testowych (`15432`, `55432`).
2. W `docker ps -a` nie ma żadnego działającego ani zatrzymanego kontenera PostgreSQL.
3. W lokalnym cache `docker images` **nie ma obrazu `postgres:18.6-alpine`** (znajduje się tam wyłącznie obraz `mumro-postgres:16-pgvector` innego projektu).
4. Na hoście nie ma zainstalowanych pakietów `postgresql-*`, a binaria `psql`, `pg_isready` i `postgres` nie występują w `PATH` (są dostępne wewnątrz oficjalnego obrazu `postgres:18.6-alpine`).
5. Katalog `/mnt/HC_Volume_<REDACTED>/pap-staging/` zawiera wyłącznie nieuruchomiony szablon dla przyszłej bazy stagingu (`pap_staging` na porcie `127.0.0.1:5432`). Zgodnie z `AGENTS.md` i `ADR-006` zasoby i konfiguracja `pap-staging` są bezwzględnie wykluczone z użycia w testach.
6. Katalog `/mnt/HC_Volume_<REDACTED>/pap-ci-ephemeral` nie został jeszcze utworzony (wymaga zgody właściciela z Rozdziału 4).

---

## 3. Przygotowany sposób uruchomienia tymczasowego PostgreSQL 18.6

Skrypt [`scripts/hetzner/with-ephemeral-pg18.sh`](../scripts/hetzner/with-ephemeral-pg18.sh) realizuje pełny cykl życia efemerycznego środowiska testowego w trybie **fail-closed**, bez instalowania usług systemowych i bez modyfikacji istniejących usług hosta.

### 3.1. Obowiązkowe limity cgroups procesu testowego i kontenera

- **Przypięty obraz (identyczny z `.github/workflows/ci.yml` i `ADR-006`):**
  `postgres:18.6-alpine@sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`
- **Limity cgroups v2 kontenera PostgreSQL:**
  `--memory=384m --memory-swap=384m --cpus=0.50 --pids-limit=128 --cap-drop=NET_RAW --security-opt no-new-privileges:true`
- **Obowiązkowe limity cgroups v2 na całe drzewo procesu testowego (`vitest`/`node`):**
  - Skrypt **nie posiada fallbacku na sam `timeout`**. Bez działającego `systemd-run --user --scope` oraz wymuszonych limitów cgroups uruchomienie procesu testowego jest niemożliwe (`exit 3`).
  - W trybie `--preflight-only` kontrola pozostaje całkowicie odczytowa: weryfikuje obecność `systemd-run` i `systemctl`, aktywność `systemctl --user show-environment` oraz delegację wszystkich trzech kontrolerów `cpu`, `memory` i `pids` w `user-<uid>.slice/cgroup.controllers`, `user@<uid>.service/cgroup.controllers` oraz `user@<uid>.service/cgroup.subtree_control` (bez tworzenia transient scope'ów).
  - W trybie wykonawczym skrypt wykonuje próbną alokację scope'a `systemd-run --user --scope` z docelowymi limitami (`MemoryHigh=512M`, `MemoryMax=768M`, `MemorySwapMax=0`, `CPUQuota=50%`, `TasksMax=128`) przed pobraniem obrazu, utworzeniem katalogów i startem kontenera, a ponadto przed `exec timeout` **wewnątrz każdego scope'a** strażnik odczytuje `/proc/self/cgroup` oraz pliki kontrolne `memory.high`, `memory.max`, `memory.swap.max`, `cpu.max` i `pids.max` w `/sys/fs/cgroup`, blokując wykonanie polecenia testowego (`exit 3`), gdyby którykolwiek limit nie został faktycznie nałożony przez jądro.

### 3.2. Ścisła walidacja katalogu roboczego `--work-root` na wolumenie blokowym

- Skrypt nie opiera się na ogólnej liście zabronionych ścieżek dla `--work-root`, lecz egzekwuje **allowlistę, kanonizację ścieżki oraz weryfikację punktu montowania i urządzenia blokowego**:
  1. Dopuszczalna jest wyłącznie znormalizowana ścieżka bezwzględna wskazująca zatwierdzony katalog `/mnt/HC_Volume_<ID>/pap-ci-ephemeral` lub jego podkatalog (`/mnt/HC_Volume_[0-9]+/pap-ci-ephemeral(/[A-Za-z0-9][A-Za-z0-9._-]*)*`), bez segmentów `.`, `..`, `//`, ukrytych segmentów zaczynających się od `.` ani znaków specjalnych (`:`, spacje).
  2. Każdy segment ścieżki jest sprawdzany pod kątem dowiązań symbolicznych (`[[ -L ... ]]`), ścieżka `realpath -m` jest porównywana z `realpath -s -m`, a dla istniejących katalogów `realpath -e` musi być identyczne ze ścieżką wejściową (eliminacja ucieczki przez symlinki wchodzące, pośrednie i wychodzące).
  3. Identyfikator urządzenia (`stat -c '%d'`) punktu montowania `/mnt/HC_Volume_<ID>` musi różnić się od urządzenia partycji głównej `/` oraz `/mnt`, a `df -PT` musi potwierdzać urządzenie blokowe `/dev/*` różne od urządzenia `/` oraz dokładny punkt montowania `/mnt/HC_Volume_<ID>` (`!= /` i `!= /mnt`).
  4. Katalog bazowy `pap-ci-ephemeral` oraz docelowy podkatalog roboczy muszą dzielić ten sam `st_dev` **oraz** ten sam punkt montowania `/mnt/HC_Volume_<ID>` w `df -PT`, co blokuje zarówno powrotne bind-mounty z `/`, jak i bind-mounty z innych katalogów na tym samym wolumenie blokowym (np. z `pap-staging`).
  5. Typ systemu plików (`df -PT`) musi być lokalnym dyskowym systemem plików (odrzucane są `tmpfs`, `devtmpfs`, `ramfs`, `overlay`, `squashfs`, `nfs*`, `cifs`, `fuse*`), z wolnym miejscem `>= 2048 MiB`, własnością bieżącego użytkownika (`-O`), prawem zapisu (`-w`) i brakiem uprawnień zapisu dla innych użytkowników (`o+w` zabronione).
- Katalogi innych projektów na hoście i wolumenie (`pap-staging`, `mumro-*`, `reels-api`, `shorts-api`, `social-admin`, `roleplayingtech.com`, `durnoty`, `swiadek-dziejow*`, `TMP` itd.) są odrzucane zarówno dla `--work-root`, jak i dla bieżącego katalogu roboczego `PWD`.
- Od wersji `postgres:18` oficjalny obraz definiuje `VOLUME /var/lib/postgresql` oraz `PGDATA=/var/lib/postgresql/18/docker` — skrypt montuje `${RUN_DIR}/pgdata` bezpośrednio pod `/var/lib/postgresql`, dzięki czemu nie obciąża RAM kontenera i nie tworzy anonimowych wolumenów w `/var/lib/docker/volumes` na `/`.

### 3.3. Gwarancje i ograniczenia izolacji sieciowej Docker

| Aspekt sieciowy                                                                           | Czy jest gwarantowany?   | Mechanizm / wyjaśnienie techniczne                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brak ekspozycji portu DB na świat**                                                     | **TAK**                  | Publikacja wyłącznie na `127.0.0.1:${PORT}:5432` (port `5432` stagingu jest zablokowany w skrypcie; po starcie kontenera skrypt weryfikuje pełny wynik `docker port`, a instancję chroni dodatkowo `firewall-1`).                                                                                                                              |
| **Izolacja od sieci wewnętrznych kontenerów innych projektów**                            | **TAK**                  | Dedykowana sieć user-defined bridge `pap-ci-pg-net-<run_id>`: łańcuchy `DOCKER-ISOLATION-STAGE-1/2` w `iptables FORWARD` odrzucają bezpośredni ruch między różnymi mostkami (`shorts-api_default`, `reels-api_default`, `bridge`), a `enable_icc=false` blokuje komunikację między kontenerami w obrębie samego mostka testowego.              |
| **Brak dostępu z kontenera do usług `127.0.0.1` hosta**                                   | **TAK**                  | Kontener działa w osobnej przestrzeni nazw sieci (`netns`), a na `hetz-1` obowiązuje `net.ipv4.conf.all.route_localnet=0` (`default=0`, `[Potwierdzone na serwerze]`), więc gniazda `127.0.0.1:3100` (`pap-staging-web`), `127.0.0.1:4100` (`pap-staging-api`), `127.0.0.1:8000` i `127.0.0.1:8010` są nieosiągalne z kontenera.               |
| **Całkowity brak sieci kontenera sprzątającego**                                          | **TAK**                  | Awaryjny kontener czyszczący pliki `uid 70` w `cleanup()` działa z `--network=none` oraz limitami cgroups (`--memory=64m --pids-limit=32`).                                                                                                                                                                                                    |
| **Blokada ruchu wychodzącego (NAT egress) z kontenera PG18 do internetu i IP metadanych** | **NIE** _(ograniczenie)_ | `enable_icc=false` dotyczy wyłącznie komunikacji między kontenerami na tym samym mostku, a zwykła sieć `bridge` ma bramę i maskaradę NAT (Docker 28/29 odrzuca łączenie `--internal` z `--publish 127.0.0.1:${PORT}:5432`). Bez modyfikacji `iptables`/`DOCKER-USER` na hoście kontener zachowuje otwarty egress (w tym do `169.254.169.254`). |
| **Blokada połączeń z kontenera PG18 do gniazd `0.0.0.0` hosta**                           | **NIE** _(ograniczenie)_ | Przy lokalnej polityce `ufw inactive` (`INPUT ACCEPT`) proces wewnątrz kontenera mógłby połączyć się po IP bramy mostka (`172.x.x.1`) z gniazdami nasłuchującymi na `0.0.0.0`/`*` na hoście (`22`, `80`, `443`, `3001`–`3003`, `5174`).                                                                                                        |
| **Izolacja portu `127.0.0.1:${PORT}` od innych procesów działających w `netns` hosta**    | **NIE** _(z założenia)_  | Proces `vitest`/`node` działa w przestrzeni nazw sieci hosta, aby połączyć się z `127.0.0.1:${PORT}`; inne lokalne procesy hosta nie znają jednorazowego 192-bitowego hasła `scram-sha-256`, a w trybie `strict-migrator` logowanie superusera `postgres` po TCP jest odrzucane w `pg_hba.conf`.                                               |

**Ocena ryzyka ograniczeń sieciowych:** kontener uruchamia wyłącznie oficjalny, przypięty po SHA-256 obraz `postgres:18.6-alpine` bez rozszerzeń sieciowych (`dblink`, `postgres_fdw`, języków niezaufanych `pl*u`), z `--cap-drop=NET_RAW`, zasilany wyłącznie syntetycznymi danymi z zatwierdzonego commita repozytorium, a w trybie `strict-migrator` operuje na rolach `NOSUPERUSER` (bez prawa do `COPY ... PROGRAM`). Skrypt celowo nie modyfikuje firewalla hosta.

### 3.4. Ochrona sekretów i gwarantowane sprzątanie (`cleanup`)

- **Ochrona poświadczeń i logów:**
  - Losowe 192-bitowe hasła generowane per uruchomienie (`openssl rand -hex 24`), przekazywane do kontenera przez plik `POSTGRES_PASSWORD_FILE=/run/secrets/pg_pass` (`scram-sha-256`), w trybie `strict-migrator` odczytywane przez lokalne `psql` wewnątrz kontenera (`docker exec -i -u postgres` z `/run/secrets/pg_pass`, bez flag `-e PGPASSWORD=...` na hoście), a do procesu testowego przekazywane przez `export` w subshellu poprzedzającym `exec` (brak haseł w `ps aux` i `docker inspect`).
  - Wyłączone logowanie zapytań SQL (`log_statement=none`), blokada logowania superusera `postgres` po TCP (`0.0.0.0/0` i `::/0` `reject` w `pg_hba.conf`) w trybie `--mode strict-migrator` oraz konserwatywne timeouty silnika (`statement_timeout=30s`, `lock_timeout=10s`, `idle_in_transaction_session_timeout=15s`, `max_connections=32`).
- **Cztery zweryfikowane ścieżki sprzątania (bez ryzyka usunięcia istniejących zasobów serwera):**
  1. **Sukces (`exit 0`):** zamknięcie scope'a, wyczyszczenie plików PG, `docker rm -fv`, `rm -rf --one-file-system "${RUN_DIR}"`, `docker network rm` oraz weryfikacja nieistnienia kontenera, katalogu i sieci (w razie pozostawienia czegokolwiek wymusza kod błędu `5` zamiast `0`).
  2. **Błąd polecenia testowego lub błąd inicjalizacji kontenera (`exit != 0`):** przechwycenie niezerowego kodu `wait` (lub `EXIT` pod `set -e`), pełny `cleanup` wszystkich dotąd utworzonych zasobów danego przebiegu i zachowanie oryginalnego kodu błędu.
  3. **Timeout (`exit 124` / `137`):** `timeout --signal=TERM --kill-after=15s` zabija grupę procesów testowych, a `timeout --signal=KILL 5s systemctl --user stop` oraz `systemctl --user kill --kill-whom=all --signal=SIGKILL` w `cleanup()` kończą wszystkie podprocesy w cgroupie `${SCOPE_UNIT}.scope` bez ryzyka 90-sekundowego zawieszenia na domyślnym `TimeoutStopUSec` przed usunięciem kontenera, katalogu i sieci.
  4. **Przerwanie sygnałem (`HUP` -> `129`, `INT` -> `130`, `TERM` -> `143`):** handler `on_signal` przerywa oczekiwanie `wait`, wchodzi w idempotentny `cleanup` (`CLEANUP_DONE=1`) z aktywnym ignorowaniem kolejnych sygnałów (`trap '' HUP INT TERM`), dzięki czemu powtórzony `Ctrl+C` lub `SIGTERM` nie przerywa sprzątania w połowie.
  - **Ochrona istniejących zasobów hosta:** każda operacja kasująca w `cleanup()` wymaga ścisłego dopasowania nazwy do jednorazowego 48-bitowego identyfikatora bieżącego przebiegu (`^pap-ci-scope-[0-9a-f]{12}$`, `^pap-ci-pg18-[0-9a-f]{12}$`, `^pap-ci-pg-net-[0-9a-f]{12}$` oraz `^/mnt/HC_Volume_[0-9]+/pap-ci-ephemeral(/[A-Za-z0-9][A-Za-z0-9._-]*)*\/run-[0-9a-f]{12}$` bez symlinków i z flagą `--one-file-system`).

---

## 4. Jaka zgoda właściciela jest wymagana przed pierwszym uruchomieniem?

Przed pierwszym wykonaniem testów na `hetz-1` wymagana jest osobna zgoda właściciela zatwierdzająca:

1. **Jednorazowe wydzielenie katalogu roboczego dla efemerycznego CI na wolumenie blokowym** (całkowicie poza `pap-staging` i poza partycją `/`):
   ```bash
   sudo install -d -m 0700 -o admin -g admin /mnt/HC_Volume_<ID>/pap-ci-ephemeral
   ```
2. **Jednorazowe pobranie przypiętego obrazu `postgres:18.6-alpine@sha256:10a5c69a...` (`~280 MB` w `/var/lib/docker`) oraz uruchamianie krótkotrwałych kontenerów testowych** na `127.0.0.1:55432` z `PAP_ALLOW_HETZNER_EPHEMERAL_PG=1`.

Bez zmiennej `PAP_ALLOW_HETZNER_EPHEMERAL_PG=1`, zatwierdzonego katalogu `/mnt/HC_Volume_<ID>/pap-ci-ephemeral` na wydzielonym wolumenie blokowym i aktywnego `systemd-run --user --scope` z wymuszonymi limitami cgroups skrypt odmawia alokacji jakichkolwiek zasobów.

---

## 5. Ograniczenia i uwagi operacyjne

1. **Zakaz pełnego `pnpm build` i E2E na współdzielonym hoście:** kompilacja produkcyjna Next.js (`@pap/web`) oraz przeglądarka Chromium przekraczają bezpieczny budżet pamięci hosta z `1.8 GiB` aktywnego swapu. Do testów integracyjnych `@pap/db` wymagane jest wyłącznie lekkie zbudowanie deklaracji i modułów czystego TypeScriptu (`tsc -b` w `@pap/contracts`, `@pap/domain`, `@pap/application`, tj. `pnpm --filter @pap/application... build`) pod limitem `MemoryMax=512M`.
2. **Brak równoległego uruchamiania wielu kampanii DB:** testy integracyjne instalują rozszerzenia na poziomie bazy (`btree_gist`, `pgcrypto`) oraz tworzą globalną rolę klastra `pap_test_app`, dlatego używają `fileParallelism: false` i muszą być wykonywane pojedynczo.
3. **Uwaga dot. nieaktywnego szablonu stagingu (Etap A.2):** nieuruchomiony szablon `/mnt/HC_Volume_<REDACTED>/pap-staging/compose/docker-compose.postgres.yml` montuje wolumen pod historyczną ścieżką `/var/lib/postgresql/data` zamiast `/var/lib/postgresql` wymaganej przez `postgres:18.6-alpine`. Zgodnie z zakazem modyfikacji stagingu pliku tego nie zmieniano — należy go zaktualizować przed przyszłym uruchomieniem Etapu A.2.

---

## 6. Dokładna instrukcja dla agenta wykonującego pierwsze uruchomienie i walidację `6D-3`

Po uzyskaniu zgody właściciela (Rozdział 4) oraz zsynchronizowaniu gałęzi kandydata ([PR #31](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31)) wykonaj poniższą procedurę przez `ssh hetzner`. **Nie dotykaj `/var/www/pap-staging`, `/etc/pap` ani portu `5432`. Nie wypisuj `DATABASE_URL` ani haseł na wyjście.**

### Krok 1 — Odczytowy pre-flight hosta i runtime Node/pnpm

```bash
ssh hetzner
export PATH="/opt/pap-runtime/pnpm:/opt/pap-runtime/current/bin:$PATH"
export COREPACK_HOME="/opt/pap-runtime/corepack-home"
export COREPACK_ENABLE_NETWORK=0
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_DEFAULT_TO_LATEST=0

node -v   # oczekiwane: v24.22.1
pnpm -v   # oczekiwane: 12.15.0 (offline z /opt/pap-runtime/corepack-home)
/var/www/pap-staging/bin/pap-monitor-resources.sh
```

Upewnij się, że `MemAvailable >= 1.4 GiB`, a wolne miejsce na `/` wynosi `>= 3.0 GiB`.

### Krok 2 — Przygotowanie izolowanego workspace'u na wolumenie blokowym

```bash
CI_ROOT="/mnt/HC_Volume_<ID>/pap-ci-ephemeral"
mkdir -p -m 0700 "$CI_ROOT/pnpm-store" "$CI_ROOT/pg-runs"

# Czysty checkout testowanego SHA poza partycją główną /
rm -rf "$CI_ROOT/repo"
git clone --no-tags --branch codex/6d3c-security-audit --single-branch \
  https://github.com/RolePlayingTech/polish-accounting-platform.git "$CI_ROOT/repo"
cd "$CI_ROOT/repo"
git rev-parse HEAD
```

Jeżeli skrypt `scripts/hetzner/with-ephemeral-pg18.sh` nie został jeszcze scalony do gałęzi `codex/6d3c-security-audit`, pobierz go z `origin/main` do `$CI_ROOT/with-ephemeral-pg18.sh` poza drzewem git, aby nie zmieniać badanego `HEAD` SHA:

```bash
# Tylko jeśli brak pliku w badanym HEAD:
git fetch origin main
git show origin/main:scripts/hetzner/with-ephemeral-pg18.sh > "$CI_ROOT/with-ephemeral-pg18.sh"
chmod 0700 "$CI_ROOT/with-ephemeral-pg18.sh"
RUNNER="${CI_ROOT}/with-ephemeral-pg18.sh" # lub ./scripts/hetzner/with-ephemeral-pg18.sh
```

Zainstaluj zależności z użyciem sklepu `pnpm` na wolumenie blokowym i skompiluj wyłącznie lekkie pakiety warstw wewnętrznych (`contracts`, `domain`, `application` — **bez `pnpm build` całego monorepo**):

```bash
systemd-run --user --scope -p MemoryHigh=512M -p MemoryMax=768M -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=128 -- \
  pnpm install --frozen-lockfile --store-dir "$CI_ROOT/pnpm-store"

systemd-run --user --scope -p MemoryHigh=384M -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=50% -p TasksMax=128 -- \
  pnpm --filter @pap/application... build
```

Wykonaj odczytowy pre-flight skryptu na docelowym katalogu:

```bash
"$RUNNER" --preflight-only --work-root "$CI_ROOT/pg-runs" --port 55432
```

### Krok 3 — Dynamiczny smoke-check runnera przy pierwszym dopuszczonym uruchomieniu

Przed właściwą kampanią testową potwierdź w praktyce bindowanie `127.0.0.1:55432` oraz poprawne sprzątanie po sukcesie (`0`), błędzie (`!= 0`), przekroczeniu `timeout` (`124`) i przerwaniu sygnałem (`143`):

```bash
# 1) Pobranie obrazu i sprawdzenie sukcesu + czystego zamknięcia:
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" --port 55432 --timeout 30 --pull-if-missing \
  -- true

# 2) Sprawdzenie sprzątania po błędzie komendy (oczekiwany exit=7) i po timeout (oczekiwany exit=124):
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" --port 55432 --timeout 30 \
  -- bash -c 'exit 7' || echo "Oczekiwany błąd: $?"

PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" --port 55432 --timeout 10 \
  -- sleep 30 || echo "Oczekiwany timeout: $?"

# Po wszystkich próbach katalog pg-runs musi być pusty, a kontenery/sieci/scope'y pap-ci-* nieobecne:
ls -la "$CI_ROOT/pg-runs"
docker ps -a --filter "name=pap-ci-pg18-"
docker network ls --filter "name=pap-ci-pg-net-"
systemctl --user list-units 'pap-ci-*' --all
ss -H -lnt "sport = :55432"
```

### Krok 4 — Kampania A: pełne testy integracyjne `6D-3` w izolowanym PostgreSQL 18.6 (`--mode fixture`)

```bash
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode fixture \
  --timeout 300 \
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

### Krok 5 — Kampania B: obowiązkowy odbiór migratora `NOSUPERUSER` / `NOBYPASSRLS` (`--mode strict-migrator`)

Potwierdź, że łańcuch migracji `0000`→`0005`, ręczny provisioning ACL/klucza, `FORCE ROW LEVEL SECURITY` (również wobec właściciela tabel `pap_test`), funkcje `SECURITY DEFINER` oraz blokada TCP superusera `postgres` działają prawidłowo, gdy właściciel bazy i tabel (`pap_test`) **nie jest superuserem** (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`):

```bash
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 "$RUNNER" \
  --work-root "$CI_ROOT/pg-runs" \
  --port 55432 \
  --mode strict-migrator \
  --bootstrap-runtime-role \
  --timeout 300 \
  -- bash -euo pipefail -c '
    pnpm db:migrate
    pnpm db:migrate

    KEY_HEX="$(openssl rand -hex 32)"
    PAP_TEST_KEY_HEX="$KEY_HEX" pnpm --filter @pap/db exec tsx -e "
      import assert from \"node:assert/strict\";
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
        assert.equal(roles.length, 2);
        for (const role of roles) {
          assert.equal(role.rolsuper, false);
          assert.equal(role.rolbypassrls, false);
          assert.equal(role.rolcreaterole, false);
          assert.equal(role.rolcreatedb, false);
        }
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
        const ownerRowsWithoutContext = await migrator.client\`SELECT * FROM tenant\`;
        assert.equal(ownerRowsWithoutContext.length, 0);
        console.log({ version, roles, ownerRowsWithoutContext: ownerRowsWithoutContext.length });
        console.log(\"STRICT_MIGRATOR_AND_RUNTIME_VERIFIED=OK\");
      } finally {
        await runtime.client.end({ timeout: 1 });
        await migrator.client.end({ timeout: 1 });
      }
    "
  '
```

### Krok 6 — Sprzątanie i kontrola po zakończeniu

1. Usuń tymczasowy klon repozytorium (`rm -rf "$CI_ROOT/repo" "$CI_ROOT/pg-runs/"*`).
2. Zweryfikuj brak pozostawionych kontenerów, sieci, scope'ów i procesów oraz nienaruszony stan usług:
   ```bash
   docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
   docker network ls
   systemctl --user list-units 'pap-ci-*' --all
   ss -lnt | grep 55432 || echo "Port 55432 zwolniony"
   /var/www/pap-staging/bin/pap-monitor-resources.sh
   ```
3. Opublikuj pełny raport odbioru w [PR #31](https://github.com/RolePlayingTech/polish-accounting-platform/pull/31) / [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6) (dokładny SHA, `SELECT version()`, wykaz ról i flag `pg_roles`, wykonany zakres, pominięcia i wyniki wszystkich punktów kontrolnych).
