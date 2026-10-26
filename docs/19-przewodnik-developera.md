# 19. Przewodnik developera

Ten dokument opisuje uruchamialny szkielet z Issue #5. Nie jest instrukcją wdrożenia produkcyjnego.

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

Compose buduje lokalny obraz developerski, udostępnia porty 3000 i 4000 tylko na komputerze lokalnym oraz montuje katalogi z kodem. Zatrzymanie: `Ctrl+C`; usunięcie kontenera: `docker compose down`. Wolumeny pnpm przechowują zależności w kontenerze. Compose nie konfiguruje DB ani usług zewnętrznych.

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
- Nie ma kont, logowania, sesji, tenantów, firm ani mechanizmu autoryzacji.
- Nie ma bazy, migracji, ksiąg, faktur, integracji KSeF/MF, workerów ani produkcyjnych połączeń MCP.
- W pakietach i testach używaj wyłącznie danych syntetycznych. Nie dodawaj danych osobowych, faktur, tokenów, certyfikatów ani sekretów.

Przed wdrażaniem nowych funkcji kieruj się [modelem zagrożeń i uprawnień](18-model-zagrozen-i-uprawnien.md), [zasadami architektury](16-zasady-architektoniczne.md) oraz roadmapą.
