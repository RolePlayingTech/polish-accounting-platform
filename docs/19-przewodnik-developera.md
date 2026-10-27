# 19. Przewodnik developera

Ten dokument opisuje szkielet z Issue #5 i fundament bazy z pakietu 6A Issue #6. Obecnie pracujemy wyłącznie lokalnie, zgodnie z [ADR-005](adr/005-rozwoj-lokalny.md), bez przygotowywania serwera i deploymentu. Pakiet 6A nie jest modułem firm ani księgowości.

## Wymagania

- Node.js `24.22.1` (wersja wskazana w `.node-version`).
- pnpm `12.15.0` przez Corepack.
- Git. Docker i Compose nie są wymagane.
- Opcjonalnie PostgreSQL **18** z narzędziami `psql` i `pg_isready`, zainstalowany bezpośrednio na komputerze. CI testuje przypięte wydanie `18.6`; lokalnie używaj aktualnego wydania poprawkowego linii 18. Baza jest potrzebna tylko do `db:migrate` i `test:integration`.

## Instalacja lokalna

W katalogu głównym repozytorium:

```bash
corepack enable
corepack prepare pnpm@12.15.0 --activate
pnpm install --frozen-lockfile
```

Jeśli środowisko nie aktywuje pnpm globalnie, polecenia można wywoływać jako `corepack pnpm <polecenie>`.

## Uruchamianie aplikacji

```bash
pnpm dev
```

Polecenie uruchamia web i API w trybie developerskim. Web jest dostępny pod `http://127.0.0.1:3000/app`, API pod `http://127.0.0.1:4000`. Domyślnie procesy nasłuchują wyłącznie na loopback. Nie potrzebujesz PostgreSQL ani głównego pliku `.env`; migracje i połączenia DB nie uruchamiają się przy `pnpm dev`. Zakończ procesy przez `Ctrl+C`.

API udostępnia:

- `GET /health` — minimalny health check procesu.
- `GET /api/v1/system/status` — wersjonowany, walidowany kontraktem status modułów.

Web pobiera status po stronie serwera. Opcjonalny adres API można ustawić przez `API_BASE_URL`; przykład znajduje się w `apps/web/.env.example`. W produkcyjnym `NODE_ENV` dozwolony jest wyłącznie adres HTTPS. Produkcyjne uruchomienie aplikacji nie jest obecnie wspierane ani skonfigurowane.

## PostgreSQL lokalnie bez Dockera

### Sprawdzenie środowiska (Windows/PowerShell)

Najpierw sprawdź, czy PostgreSQL jest już zainstalowany i działa. Poniższe polecenia niczego nie uruchamiają ani nie tworzą:

```powershell
Get-Command psql, pg_isready -ErrorAction SilentlyContinue
Get-Service -Name '*postgres*' -ErrorAction SilentlyContinue
$papPgBin = 'C:\Program Files\PostgreSQL\18\bin'
& "$papPgBin\psql.exe" --version
& "$papPgBin\pg_isready.exe" -h 127.0.0.1 -p 5432
```

Dostosuj ścieżkę i port do istniejącej instalacji. Jeśli jej nie ma, PostgreSQL 18 można zainstalować ręcznie z [oficjalnej strony dla Windows](https://www.postgresql.org/download/windows/). Skrypty projektu nie instalują ani nie uruchamiają usług. Lokalna instancja powinna nasłuchiwać tylko na loopback i wymagać uwierzytelnienia hasłem. Brak działającego PostgreSQL nie blokuje rozwoju obecnego frontend/backend ani testów jednostkowych.

Połącz się z lokalną bazą administracyjną; `-W` pyta o hasło, bez wpisywania go do historii poleceń:

```powershell
& "$papPgBin\psql.exe" -X -h 127.0.0.1 -p 5432 -U postgres -d postgres -W
```

W `psql` sprawdź instancję, nazwy baz i kont przed utworzeniem czegokolwiek:

```sql
\set ON_ERROR_STOP on
SHOW server_version;
SELECT inet_server_addr(), inet_server_port(), current_user, current_database();
SELECT datname FROM pg_database WHERE datname IN ('pap_local', 'pap_test');
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
FROM pg_roles WHERE rolname IN ('pap_local', 'pap_test');
```

Jeżeli nazwy już istnieją, zweryfikuj ich właścicieli, przeznaczenie i zawartość. Nie usuwaj baz, nie zmieniaj istniejących haseł ani nie wykonuj ponownie poniższego fragmentu na niezweryfikowanych zasobach.

### Jednorazowe przygotowanie oddzielnych baz i kont

Wyłącznie gdy powyższe nazwy są wolne, wykonaj w tej samej sesji `psql`:

```sql
CREATE ROLE pap_local LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password pap_local
CREATE ROLE pap_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password pap_test
CREATE DATABASE pap_local OWNER pap_local;
CREATE DATABASE pap_test OWNER pap_test;
REVOKE ALL ON DATABASE pap_local FROM PUBLIC;
REVOKE ALL ON DATABASE pap_test FROM PUBLIC;
\q
```

Ustaw dwa różne hasła w interaktywnych monitach `\password`. Konta są właścicielami wyłącznie swoich baz developerskich, aby wykonywać DDL migracji; nie są przyszłymi rolami runtime z RLS. Nie przyznawaj im wzajemnych członkostw ani uprawnień do innych baz. W repo i bazach używamy tylko danych syntetycznych. Źródła poleceń: [CREATE ROLE](https://www.postgresql.org/docs/18/sql-createrole.html), [CREATE DATABASE](https://www.postgresql.org/docs/18/sql-createdatabase.html), [psql i bezpieczne ustawianie hasła](https://www.postgresql.org/docs/18/app-psql.html).

### Konfiguracja i ręczne migracje

W katalogu głównym repozytorium utwórz `.env`, jeśli jeszcze go nie masz:

```powershell
if (-not (Test-Path -LiteralPath .env)) { Copy-Item .env.example .env }
```

Edytuj `.env`: ustaw `PAP_DATABASE_ENV=local` i adres z kontem/bazą `pap_local`. Zastąp `UZUPELNIJ_HASLO_LOCAL` swoim hasłem. Znaki specjalne w części hasła zakoduj jako percent-encoding URL (np. `@` jako `%40`, `#` jako `%23`, `%` jako `%25`). Nie dodawaj parametrów po `?`. Nie zapisuj hasła w historii terminala ani nie wypisuj `DATABASE_URL` w logach. `.env` jest ignorowany przez Git; `.env.example` zawiera wyłącznie placeholdery.

Runner migracji i test integracyjny czytają główny `.env`; zmienne już ustawione w sesji mają pierwszeństwo. Sprawdź tę ewentualność, jeśli edycja pliku nie zmienia zachowania polecenia.

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:migrate
```

`db:generate` działa bez DB: tworzy SQL i metadane po zmianie schematu Drizzle; dla niezmienionego schematu nie powinien dodać migracji. `db:migrate` wymaga działającej bazy i zapisuje wykonane wersje w `drizzle.__drizzle_migrations`. Ponowne wykonanie nie powiela migracji. Migracja 6A wykonuje tylko `SELECT 1`; jedyną tabelą techniczną jest rejestr Drizzle. Migracje uruchamiaj pojedynczo i reviewuj SQL oraz metadane w `packages/db/drizzle`. Nie wykonują się przy `pnpm dev`.

Walidator wymaga `PAP_DATABASE_ENV=local` z kontem i bazą `pap_local` albo `PAP_DATABASE_ENV=test` z kontem i bazą `pap_test` oraz hosta `127.0.0.1`, `localhost` lub `::1`. `NODE_ENV=production`, inne środowisko, zdalny host, inne konto lub baza, niepoprawny URL i parametry/fragmenty URL są odrzucane przed utworzeniem klienta PostgreSQL. DB nie podejmuje decyzji o uprawnieniach księgowych; polityka z PR #16 pozostaje w `domain`/`application`.

### Test integracyjny na pustej pap_test

W `.env` wybierz komentowany wariant `test`: ustaw jednocześnie `PAP_DATABASE_ENV=test`, konto/bazę `pap_test` i jej hasło zamiast `UZUPELNIJ_HASLO_TEST`. Sprawdź pustość bazy, łącząc się kontem testowym:

```powershell
& "$papPgBin\psql.exe" -X -h 127.0.0.1 -p 5432 -U pap_test -d pap_test -W
```

```sql
SELECT table_schema, table_name FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  AND table_type = 'BASE TABLE';
\q
```

Oczekiwane jest zero wierszy. Nie wykonuj wcześniej `db:migrate` na `pap_test`, bo test wymaga pustej bazy. Następnie:

```powershell
pnpm test:integration
```

Test odmawia użycia środowiska `local` i niepustej bazy. Wykonuje migrację dwukrotnie, sprawdza pojedynczy wpis rejestru i brak tabel biznesowych. Sprząta wyłącznie własny losowo nazwany schemat migracji; nie usuwa bazy ani istniejących tabel. Jeśli baza nie jest pusta, wyjaśnij jej przeznaczenie zamiast ją czyścić. Po teście przywróć wariant `local` w `.env`, jeśli chcesz wykonywać lokalne migracje. Bez PostgreSQL raportuj test integracyjny jako niewykonany lokalnie; CI uruchamia go na izolowanej usłudze PostgreSQL.

W 6B należy dodać kolejną migrację bez zmieniania zastosowanej migracji 6A. Brak automatycznego rollbacku i poleceń usuwających istniejące dane. Starsze `compose.yaml` i `Dockerfile.dev` pozostają w wersji z `main`, poza bieżącym trybem pracy; 6A nie dodaje infrastruktury Docker ani wymagań weryfikacji na serwerze.

## MCP lokalne STDIO

Najpierw zbuduj pakiety używane przez serwer, a następnie uruchom MCP:

```bash
pnpm build
pnpm dev:mcp
```

Proces używa wyłącznie transportu STDIO i udostępnia read-only narzędzie `system_status`. Nie ma transportu HTTP, autoryzacji klienta, dostępu do tenantów, dokumentów ani zapisów. Serwer oczekuje klienta MCP podłączonego do jego standardowego wejścia/wyjścia; uruchomienie bez klienta pozostaje procesem działającym w terminalu.

## Codzienne polecenia

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
pnpm audit --audit-level high
```

Opis scenariuszy i zakresu walidacji znajduje się w [20 — strategii testów](20-strategia-testow.md).

## Granice obecnego działania

- `/app` prezentuje stan techniczny szkieletu. Moduły księgowe są oznaczone jako niedostępne.
- `/settings` i `/platform` są statycznymi placeholderami bez operacji administracyjnych.
- Nie ma kont, logowania, sesji, tenantów, firm ani egzekwowania polityki autoryzacji przez API/MCP.
- Pakiet DB ma lokalne połączenia i techniczne migracje, ale nie zawiera tabel tenantów, firm, ksiąg ani faktur. Nie ma integracji KSeF/MF, workerów ani produkcyjnych połączeń MCP.
- W pakietach i testach używaj wyłącznie danych syntetycznych. Nie dodawaj danych osobowych, faktur, tokenów, certyfikatów ani sekretów.

Przed wdrażaniem nowych funkcji kieruj się [modelem zagrożeń i uprawnień](18-model-zagrozen-i-uprawnien.md), [zasadami architektury](16-zasady-architektoniczne.md) oraz roadmapą.
