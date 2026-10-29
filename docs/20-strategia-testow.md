# 20. Strategia testów i aktualna walidacja

> Polityka implementacji 6D-3 (2026-10-29): agent implementacyjny uruchamia celowane testy i kontrolę typów po logicznym fragmencie pracy. Pełny odbiór regresji, PostgreSQL/RLS i współbieżności wykonuje osobny agent walidacyjny przed merge krytycznych Draft PR. Nie powtarzamy pełnego zestawu po drobnych zmianach ani ręcznie zestawu już wykonywanego przez CI. Obowiązuje nowsza decyzja właściciela z PR #29: tymczasowe CI na izolowanym Hetznerze, bez uruchamiania GitHub Actions. Niewykonane testy są nieweryfikowane. Nie wymagamy lokalnej instalacji DB: można użyć uprzednio odizolowanych zasobów Hetznera (`ssh hetzner`), po kontroli usług, zasobów i limitów ADR-006; baza uruchomionego stagingu jest wykluczona. Bez izolowanego PostgreSQL testy integracyjne pozostają do późniejszej walidacji na izolowanym Hetznerze.

**Aktualizacja 6D-2 (2026-10-28):** po [testach lifecycle 6D-R](24-bezpieczny-cykl-dostepu-6dr.md) [etap 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) rozszerza walidację o:

- testy czystej polityki autoryzacji administracyjnej `decideAccessManagementAuthorization` w `packages/domain` (izolacja tenanta, zakaz self-escalation dla każdej roli, hierarchia ról i granice delegacji `tenant_admin`),
- testy portów tożsamości OIDC i kompozycji `authenticateOidcActor`, `authorizeAuthenticatedCompanyAction`, `createOidcAccessManagementActorSource` oraz `createTenantAccessManagementAuthorizer` w `packages/application`,
- testy jednostkowe i integracyjne PostgreSQL dla migracji `0003_user-identity.sql`, `PostgresUserIdentityResolver`, `PostgresUserIdentityStore` i `PostgresAccessManagementAuthorizationDataSource` w `packages/db`,
- testy kryptograficznego weryfikatora `JwksOidcAccessTokenVerifier` (RS256/ES256, algorytmy `none`/`HS256`, nagłówki `jku`/`jwk`/`x5u`/`x5c`/`crit`, pomylenie ID/Refresh/Logout Token z Access Tokenem, `iss`, `sub`, `aud`, `azp`, `exp`, `nbf`, `iat`, `scope`, rotacja JWKS z cooldownem, cofnięcie tokenu, redakcja błędów) oraz pełnego pipeline'u NestJS/Fastify z `CompanyActionAuthorizationGuard` w `apps/api`.

**Obowiązujący od 2026-10-29 tryb CI:** wszystkie testy integracyjne PostgreSQL i migracji uruchamiamy na serwerze Hetzner w odizolowanym, tymczasowym środowisku testowym, z limitami zasobów i bez dostępu do baz aplikacji. Automatyczne GitHub Actions jest czasowo wstrzymane. Zobacz [ADR-006](adr/006-tymczasowe-ci-hetzner.md) i [AGENTS.md](../AGENTS.md).

## Polecenia automatyczne

Dostępne polecenia kontroli (dobierane do ryzyka zmiany; nie uruchamiać pełnego zestawu po każdej drobnej edycji):

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

Przed odbiorem zmian wrażliwych można wykonać skan repozytorium pod kątem sekretów na izolowanym Hetznerze; dotychczasowy job GitHub Actions pozostaje zachowany jako konfiguracja do późniejszego przywrócenia, nie uruchamia się automatycznie.

## Zakres testów w szkielecie

- **Domain:** akceptacja poprawnych UUID oraz odrzucanie niepoprawnych identyfikatorów; czysta polityka aktywnego członkostwa, jawnych grantów tenant/firma/akcja, czasu ważności i odmowy domyślnej (`decideAccountingAccess`); czysta polityka autoryzacji administracyjnej (`decideAccessManagementAuthorization`).
- **Contracts:** walidacja kontraktu statusu, odrzucanie nieznanych pól i nieuzasadnionych twierdzeń o dostępności.
- **Application:** wynik współdzielonego use case statusu, policy use case działający na porcie zaufanego źródła, kompozycja uwierzytelniania OIDC z resolverem tożsamości i autoryzacją firmy oraz serwerowe źródło aktora i autoryzator dla `manageAccess`. Testy używają wyłącznie syntetycznych danych i implementacji in-memory.
- **API:** testy przez prawdziwy adapter Nest/Fastify w pamięci:
  - publiczne `/health` i `/api/v1/system/status` oraz brak niezdefiniowanych tras administracyjnych w `AppModule`,
  - weryfikator kryptograficzny `JwksOidcAccessTokenVerifier` i walidator konfiguracji `loadOidcVerifierConfig`,
  - pełny pipeline serwerowy z kontrolerem testowym chronionym przez `CompanyActionAuthorizationGuard` (rozróżnienie `401` vs `403` vs `400`, ignorowanie `userId`/`role` w body i query, odrzucanie nagłówków spoofingu i `?access_token=`, natychmiastowa odmowa po cofnięciu członkostwa i reaktywacji bez przywracania grantów, redakcja błędów).
- **Web:** renderowalny, prawidłowy status; odrzucanie niepoprawnego payloadu i adresu API zawierającego dane logowania.
- **Web → API E2E:** przeglądarka sprawdza działające połączenie z lokalnym Nest/Fastify API, stan UI po zatrzymaniu API oraz styl komponentu współdzielonego z `packages/ui`.
- **MCP:** test klient-serwer przez transport in-memory i potwierdzenie, że serwer udostępnia wyłącznie narzędzie `system_status`; osobny proces uruchamia serwer przez STDIO.
- **Granice architektoniczne (`pnpm test:arch`, uruchamiane także w `pnpm test`):** programowy test ESLint weryfikujący reguły `no-restricted-imports` z `eslint.config.mjs` — blokowanie niedozwolonych zależności (m.in. `@nestjs/common`, `drizzle-orm` i `jose` w `packages/domain` oraz `packages/application`, `@pap/db` w `apps/web` oraz `apps/mcp`) oraz akceptację dozwolonych importów.
- **PostgreSQL/migracje (`pnpm test:integration`):** izolowane CI na Hetznerze używa świeżej bazy testowej PostgreSQL 18. Lokalnie wymagany jest bezpośrednio zainstalowany PostgreSQL, bez Dockera. Każdy zestaw tworzy własny namespace danych, rozszerzenia i rejestru; samo `migrationsSchema` nie izoluje tabel. Testy sprawdzają kolejność i hashe `0000` → `0003`, osiem tabel modelu i rejestr, ponowienie bez zmiany obiektów, rollback migracji, upgrade `0000`–`0002` → `0003`, FK/UNIQUE/CHECK/NOT NULL, zakaz nakładania profili, adapter 6D-1, transakcyjny cykl dostępu 6D-R (w tym wyścigi na blokadach wiersza z `pg_blocking_pids`) oraz mapowanie tożsamości OIDC 6D-2 (case-sensitivity `sub`, izolacja wystawców, brak auto-provisioningu, wyłączenie konta i triggery ochronne SQL).
- **DB bez PostgreSQL (`pnpm test`):** konfiguracja odrzuca `production`, hosty zdalne, niewłaściwe konta/bazy i błędne adresy; testy namespace, CLI, łańcucha migracji `0000`–`0003` oraz jednostkowe testy builderów Drizzle dla `PostgresTenantAuthorizationDataSource`, `PostgresAccessManagementStore` i `PostgresUserIdentityResolver` / `PostgresUserIdentityStore`.

Testy 6D-2 potwierdzają serwerową weryfikację tokenów OIDC, mapowanie tożsamości i egzekwowanie autoryzacji w pipeline HTTP, lecz nie obejmują jeszcze interaktywnego logowania w przeglądarce (PKCE/sesja), ograniczonej roli runtime DB, polityk PostgreSQL RLS ani atomowego powiązania decyzji z operacją na danych biznesowych (zakres 6D-3).

## Lokalna kontrola PR

`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, testy granic i `pnpm test:e2e` nie wymagają PostgreSQL. E2E uruchamia wyłącznie lokalny frontend/backend. Także `pnpm dev` i `pnpm db:generate` działają bez bazy; migracje nie są zależnością startu aplikacji.

Tylko `pnpm db:migrate` oraz `pnpm test:integration` wymagają działającego PostgreSQL. Przygotowanie oddzielnych kont/baz i instrukcja Windows/PowerShell: [19 — przewodnik developera](19-przewodnik-developera.md#postgresql-lokalnie-bez-dockera). Testów integracyjnych nie poprzedzaj ręczną migracją `pap_test`: wymagają bazy bez zastanego `btree_gist` i nie usuwają go na potrzeby testu. W CI na Hetznerze wymagana jest świeża baza testowa; nigdy nie używaj istniejącej bazy aplikacji.

Przed review uruchom minimalne celowane kontrole. Przed scaleniem zmian krytycznych (autoryzacja, migracje, RLS) wymagaj odpowiedniej walidacji na Hetznerze, którą może wykonać osobny agent testowy. W opisie PR podaj oddzielnie faktyczne wyniki lokalne i wyniki CI Hetzner dla konkretnego SHA; nie oznaczaj niewykonanych testów jako zaliczonych. Użycie Hetznera do izolowanego CI opisuje [ADR-006](adr/006-tymczasowe-ci-hetzner.md).

Każda zmiana reguł prawnych wymaga osobnych testów referencyjnych, dat obowiązywania, źródła urzędowego i przeglądu eksperta — sam szkielet nie implementuje takich reguł.
