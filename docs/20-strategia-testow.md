# 20. Strategia testów i aktualna walidacja

## Polecenia automatyczne

CI uruchamia na pull requestach i pushach do `main`:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --audit-level high
```

Osobny job skanuje pełną historię repozytorium pod kątem sekretów. Workflow ma minimalne uprawnienia odczytu i przypięte akcje GitHub do SHA.

## Zakres testów w szkielecie

- **Domain:** akceptacja poprawnych UUID oraz odrzucanie niepoprawnych identyfikatorów. Typ identyfikatora nie zastępuje autoryzacji. Testowana jest także czysta polityka aktywnego członkostwa, jawnych grantów tenant/firma/akcja, czasu ważności i odmowy domyślnej.
- **Contracts:** walidacja kontraktu statusu, odrzucanie nieznanych pól i nieuzasadnionych twierdzeń o dostępności.
- **Application:** wynik współdzielonego use case statusu oraz policy use case działający na porcie zaufanego źródła. Testy używają wyłącznie syntetycznych danych i implementacji in-memory.
- **API:** testy przez prawdziwy adapter Nest/Fastify w pamięci; health check, zgodność odpowiedzi z kontraktem i brak niezdefiniowanej trasy administracyjnej tenantów.
- **Web:** renderowalny, prawidłowy status; odrzucanie niepoprawnego payloadu i adresu API zawierającego dane logowania.
- **Web → API E2E:** przeglądarka sprawdza działające połączenie z lokalnym Nest/Fastify API, stan UI po zatrzymaniu API oraz styl komponentu współdzielonego z `packages/ui`.
- **MCP:** test klient-serwer przez transport in-memory i potwierdzenie, że serwer udostępnia wyłącznie narzędzie `system_status`; osobny proces uruchamia serwer przez STDIO.
- **Granice architektoniczne (`pnpm test:arch`, uruchamiane także w `pnpm test`):** programowy test ESLint weryfikujący reguły `no-restricted-imports` z `eslint.config.mjs` — blokowanie niedozwolonych zależności (m.in. `@nestjs/common` i `drizzle-orm` w `packages/domain`, `@pap/db` w `apps/web` oraz `apps/mcp`) oraz akceptację dozwolonych importów (np. `@pap/contracts`).
- **PostgreSQL/migracje (`pnpm test:integration`):** osobny job CI używa świeżej `pap_test` w PostgreSQL 18. Lokalnie wymagany jest bezpośrednio zainstalowany PostgreSQL, bez Dockera. Każdy zestaw tworzy własny namespace danych, rozszerzenia i rejestru; samo `migrationsSchema` nie izoluje tabel. Testy sprawdzają kolejność i hashe 6A → 6B, dokładnie pięć tabel modelu i rejestr, ponowienie bez zmiany obiektów oraz rollback migracji przy konflikcie zastanej tabeli. Weryfikują rzeczywiste FK (w tym cross-tenant i UPDATE), osobne granty A1/A2 i read/write, dozwolone role/statusy/akcje, UNIQUE/PK, wszystkie wymagane NOT NULL, daty i nieskończone chwile, sąsiednie i nakładające profile, konflikt równoległych transakcji, przechowanie cofniętego dostępu oraz brak częściowego zapisu po błędzie. Sprzątają tylko własny schemat i porównują inwentaryzację obiektów sprzed i po teście. Odmawiają przejęcia zastanego `btree_gist`; zestawy działają kolejno. Szczegóły i ograniczenia: [model 6B](22-schemat-tenantow-6b.md).
- **DB bez PostgreSQL (`pnpm test`):** konfiguracja odrzuca `production`, hosty zdalne, niewłaściwe konta/bazy i błędne adresy; mock sterownika dowodzi, że odrzucona konfiguracja nie tworzy klienta. Testy namespace odrzucają niekontrolowane identyfikatory i użycie namespace testowego w local. Test CLI sprawdza kod odmowy i brak URL/hasła w stdout/stderr. Test plików potwierdza łańcuch snapshotów, journal 6A/6B i jawne rozszerzenie/EXCLUDE; nie zastępuje testów constraints na PostgreSQL. `pnpm typecheck` obejmuje również pliki testów DB i konfiguracji, także bez lokalnego PostgreSQL.

Test migracji nie dowodzi działania autoryzacji użytkowników ani izolacji tenantów: nie obejmuje OIDC, połączenia policy check z API/MCP, RLS, audytu operacji finansowych ani integracji urzędowych. Dla przyszłych operacji firmowych wymagane będą testy negatywne izolacji i uprawnień end-to-end według [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md).

## Lokalna kontrola PR

`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, testy granic i `pnpm test:e2e` nie wymagają PostgreSQL. E2E uruchamia wyłącznie lokalny frontend/backend. Także `pnpm dev` i `pnpm db:generate` działają bez bazy; migracje nie są zależnością startu aplikacji.

Tylko `pnpm db:migrate` oraz `pnpm test:integration` wymagają działającego PostgreSQL. Przygotowanie oddzielnych kont/baz i instrukcja Windows/PowerShell: [19 — przewodnik developera](19-przewodnik-developera.md#postgresql-lokalnie-bez-dockera). Testów integracyjnych nie poprzedzaj ręczną migracją `pap_test`: wymagają bazy bez zastanego `btree_gist` i nie usuwają go na potrzeby testu. W CI baza jest świeża.

Uruchom dostępne kontrole przed review. W opisie PR podaj oddzielnie wyniki lokalne i CI dla konkretnego commita. Jeśli PostgreSQL lokalnie nie jest dostępny, nie instaluj go automatycznie i nie oznaczaj testu integracyjnego jako lokalnie zaliczonego. Izolowana usługa PostgreSQL w CI jest dozwolona przez [ADR-005](adr/005-rozwoj-lokalny.md); uruchomienie Compose, budowanie obrazu i dostęp do przyszłego serwera nie są warunkami odbioru 6A.

Każda zmiana reguł prawnych wymaga osobnych testów referencyjnych, dat obowiązywania, źródła urzędowego i przeglądu eksperta — sam szkielet nie implementuje takich reguł.
