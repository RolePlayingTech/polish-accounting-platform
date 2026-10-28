# 19. Przewodnik developera

Ten dokument opisuje szkielet z Issue #5 oraz pakiety DB/autoryzacji 6A/6B/6C/6D-1/6D-R/6D-2 z Issue #6. Obecnie pracujemy wyłącznie lokalnie, zgodnie z [ADR-005](adr/005-rozwoj-lokalny.md), bez przygotowywania serwera i deploymentu. Schemat 6B i warstwa serwerowa [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) nie wystawiają jeszcze publicznych operacji księgowych ani interaktywnego logowania w przeglądarce; decyzje i ograniczenia opisują [model 6B](22-schemat-tenantow-6b.md), [cykl 6D-R](24-bezpieczny-cykl-dostepu-6dr.md) i [dokument 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md).

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

Polecenie uruchamia web i API w trybie developerskim. Web jest dostępny pod `http://127.0.0.1:3000/app`, API pod `http://127.0.0.1:4000`. Domyślnie procesy nasłuchują wyłącznie na loopback. Nie potrzebujesz PostgreSQL, serwera Keycloak ani głównego pliku `.env`; migracje i połączenia DB nie uruchamiają się przy `pnpm dev`. Zakończ procesy przez `Ctrl+C`.

API udostępnia publicznie:

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

Edytuj `.env`: ustaw `PAP_DATABASE_ENV=local` i adres z kontem/bazą `pap_local`. Zastąp `UZUPELNIJ_HASLO_LOCAL` swoim hasłem. Znaki specjalne w części hasła zakoduj jako percent-encoding URL (np. `@` jako `%40`, `#` jako `%23`, `%` jako `%25`). Nie dodawaj parametrów po `?`. Nie zapisuj hasła w historii terminala ani nie wypisuj `DATABASE_URL` w logach. `.env` jest ignorowany przez Git; `.env.example` zawiera wyłącznie placeholdery (w tym opcjonalne zmienne `PAP_OIDC_*` dla serwerowego weryfikatora OIDC z [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md)).

Runner migracji i test integracyjny czytają główny `.env`; zmienne już ustawione w sesji mają pierwszeństwo. Sprawdź tę ewentualność, jeśli edycja pliku nie zmienia zachowania polecenia.

```powershell
pnpm db:generate
pnpm db:migrate
pnpm db:migrate
```

`db:generate` działa bez DB: tworzy SQL i metadane po zmianie schematu Drizzle; dla niezmienionego schematu nie powinien dodać migracji. `db:migrate` zapisuje wykonane wersje w `drizzle.__drizzle_migrations`. Ponowne wykonanie nie powiela migracji. Łańcuch migracji obejmuje `0000` (6A), `0001` (6B: `tenant`, `legal_entity`, `tenant_membership`, `entity_profile_version`, `company_access_grant` oraz rozszerzenie `btree_gist`), `0002` (6D-R: `access_management_event` i guardy SQL cyklu dostępu) oraz `0003` (6D-2: `app_user`, `user_oidc_identity` i guardy SQL niezmienności tożsamości). Reviewuj SQL i metadane w `packages/db/drizzle`, w tym usunięcie kwalifikatora `public` z wygenerowanych FK na potrzeby testowego namespace ([wyjaśnienie](22-schemat-tenantow-6b.md#migracje-i-izolacja-testów)). Migracje uruchamiaj pojedynczo; nie wykonują się przy `pnpm dev`.

Walidator wymaga `PAP_DATABASE_ENV=local` z kontem i bazą `pap_local` albo `PAP_DATABASE_ENV=test` z kontem i bazą `pap_test` oraz hosta `127.0.0.1`, `localhost` lub `::1`. `NODE_ENV=production`, inne środowisko, zdalny host, inne konto lub baza, niepoprawny URL i parametry/fragmenty URL są odrzucane przed utworzeniem klienta PostgreSQL.

### Testy integracyjne na pap_test

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

W świeżej bazie oczekiwane jest zero wierszy. Jeśli istnieją obiekty, ustal ich przeznaczenie i nie usuwaj ich. Testy mają własne namespace, lecz odmawiają uruchomienia, gdy zastana baza ma już `btree_gist`. Nie wykonuj wcześniej `db:migrate` na `pap_test`; nie czyść ani nie odtwarzaj zastanej bazy na potrzeby testu. Następnie:

```powershell
pnpm test:integration
```

Testy wymagają `PAP_DATABASE_ENV=test`. Tworzą własny losowy schemat `pap_test_<32 znaki hex>` dla tabel, rozszerzenia i rejestru. `search_path` obejmuje wszystkie połączenia puli; samo `migrationsSchema` nie izoluje tabel. Weryfikują cztery wpisy rejestru (`0000`–`0003`), osiem tabel modelu, ponowienie, rollback nieudanej migracji, FK/UNIQUE/CHECK/NOT NULL, zakaz nakładania profili, adapter autoryzacji 6D-1, transakcyjny cykl dostępu 6D-R oraz mapowanie i provisioning tożsamości OIDC 6D-2. Sprzątają tylko własny schemat i porównują inwentaryzację obiektów sprzed i po teście. Bez PostgreSQL raportuj testy integracyjne jako niewykonane lokalnie; CI uruchamia je na świeżej izolowanej usłudze PostgreSQL.

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

- `/app` prezentuje stan techniczny szkieletu. Moduły księgowe i autoryzacja tenantów w publicznym statusie pozostają oznaczone jako `not_available`.
- `/settings` i `/platform` są statycznymi placeholderami bez operacji administracyjnych.
- Warstwa serwerowa [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) weryfikuje tokeny dostępu OIDC, rozwiązuje wewnętrzne `userId` i egzekwuje autoryzację w guardzie API oraz w `manageAccess`, lecz nie wystawia jeszcze publicznych endpointów księgowych ani mutujących i nie obejmuje interaktywnego logowania UI, RLS ani ograniczonej roli runtime DB.
- Przed samodzielnym `pnpm test:integration` po czystej instalacji zbuduj zależności przez `pnpm --filter @pap/application... build` (pełne `pnpm build` również je buduje); CI wykonuje ten krok jawnie.
- W pakietach i testach używaj wyłącznie danych syntetycznych. Nie dodawaj danych osobowych, faktur, tokenów, certyfikatów ani sekretów.

Przed wdrażaniem nowych funkcji kieruj się [modelem zagrożeń i uprawnień](18-model-zagrozen-i-uprawnien.md), [zasadami architektury](16-zasady-architektoniczne.md) oraz roadmapą.
