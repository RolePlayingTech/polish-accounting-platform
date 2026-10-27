# 19. Przewodnik developera

Ten dokument opisuje szkielet z Issue #5 i fundament bazy z pakietu 6A Issue #6. Nie jest instrukcją wdrożenia produkcyjnego.

## Wymagania

- Node.js `24.22.1` (wersja wskazana w `.node-version`).
- pnpm `12.15.0` przez Corepack.
- Git; Docker Desktop z Compose jest potrzebny tylko do wariantu kontenerowego.

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

Polecenie uruchamia web i API w trybie developerskim. Web jest dostępny pod `http://127.0.0.1:3000/app`, API pod `http://127.0.0.1:4000`. Domyślnie procesy nasłuchują wyłącznie na loopback.

API udostępnia:

- `GET /health` — minimalny health check procesu.
- `GET /api/v1/system/status` — wersjonowany, walidowany kontraktem status modułów.

Web pobiera status po stronie serwera. Opcjonalny adres API można ustawić przez `API_BASE_URL`; przykład znajduje się w `apps/web/.env.example`. W produkcyjnym `NODE_ENV` dozwolony jest wyłącznie adres HTTPS. Produkcyjne uruchomienie aplikacji nie jest obecnie wspierane ani skonfigurowane.

### Docker Compose

```bash
docker compose up --build
```

Compose buduje lokalny obraz developerski i uruchamia PostgreSQL. Porty web/API (`3000`, `4000`) i PostgreSQL (`5432`) są dostępne wyłącznie na loopback. Baza `pap_local` ma lokalny wolumen `postgres_data`; konto i hasło `pap_local`/`pap_local_only` są syntetycznymi ustawieniami developerskimi i nie mogą być używane poza lokalnym kontenerem. Healthcheck sprawdza gotowość PostgreSQL. Zatrzymanie usług: `docker compose down`; wolumen bazy pozostaje. Do usunięcia kontenerów i lokalnych danych służy `docker compose down -v`. Obraz jest przypięty do wersji i digestu; wolumen dla PostgreSQL 18 jest montowany pod `/var/lib/postgresql`, zgodnie z [dokumentacją oficjalnego obrazu](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).

Można uruchomić samą bazę, bez aplikacji:

```bash
docker compose up -d postgres
docker compose ps postgres
docker compose stop postgres
```

Opcjonalna baza testowa `pap_test` i konto `pap_test`/`pap_test_only` powstają przy pierwszym tworzeniu wolumenu. Są przeznaczone wyłącznie do danych syntetycznych. `pnpm dev` nie łączy się z PostgreSQL i nadal działa bez uruchomionej bazy.

Runner migracji i test integracyjny czytają plik `.env` z katalogu głównego repozytorium. Zmienne ustawione w sesji mają pierwszeństwo. Przykładowe ustawienia lokalne można skopiować w PowerShell:

```powershell
Copy-Item .env.example .env
pnpm db:migrate
```

PowerShellowy przykład dla testów:

```powershell
$env:PAP_DATABASE_ENV = 'test'
$env:DATABASE_URL = 'postgres://pap_test:pap_test_only@127.0.0.1:5432/pap_test'
pnpm test:integration
```

Walidator wymaga `PAP_DATABASE_ENV=local` z kontem i bazą `pap_local` albo `PAP_DATABASE_ENV=test` z kontem i bazą `pap_test` oraz adresu loopback. `NODE_ENV=production`, inne środowisko, zdalny host, inna baza, niepoprawny URL i dodatkowe parametry URL są odrzucane przed utworzeniem klienta PostgreSQL. Pakiet nie ma ścieżki połączenia produkcyjnego. Test integracyjny odmawia również użycia środowiska `local`; wymaga pustej bazy testowej i usuwa wyłącznie własny, losowo nazwany schemat migracji.

Polecenia migracji:

```bash
pnpm db:generate
pnpm db:migrate
pnpm test:integration
```

`db:generate` tworzy wersjonowane pliki SQL i metadane na podstawie schematu Drizzle, bez połączenia z bazą. `db:migrate` uruchamia je przez kontrolowany runner i zapisuje wykonane wersje w tabeli `drizzle.__drizzle_migrations`. Początkowa migracja wykonuje wyłącznie `SELECT 1`; nie tworzy tabel biznesowych. Migracje wykonuj pojedynczo i reviewuj SQL oraz metadane w `packages/db/drizzle`. Nie są uruchamiane automatycznie przy starcie aplikacji. W 6B należy dodać tabele przez kolejną migrację, bez zmieniania zastosowanej migracji 6A. Wycofanie obecnego fundamentu oznacza usunięcie wyłącznie jednorazowego środowiska syntetycznego; nie ma automatycznego rollbacku ani usuwania danych domenowych.

### MCP lokalne STDIO

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
