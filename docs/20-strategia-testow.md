# 20. Strategia testów i aktualna walidacja

**Aktualizacja 6D-3A (2026-10-29):** po [testach lifecycle 6D-R](24-bezpieczny-cykl-dostepu-6dr.md) oraz [uwierzytelnianiu OIDC 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) [etap 6D-3A](26-transakcyjna-autoryzacja-6d3a.md) rozszerza walidację o:

- testy jednostkowe transakcyjnego `UnitOfWork` (`executeAuthorizedCompanyAction` i transakcyjnego `manageAccess`) w `packages/application/test/transactional-unit-of-work.test.ts` oraz `packages/application/test/access-management.test.ts`,
- testy jednostkowe generowanych zapytań Drizzle w `packages/db/test/access-management.test.ts` (`FOR SHARE`, `FOR UPDATE`, kanoniczna kolejność blokad `actorUserId < targetUserId` oraz `targetUserId < actorUserId`, sortowanie `ORDER BY`, `set_config(..., true)`, fizyczny `ROLLBACK` przy odmowie i brak surowych obiektów `Date`),
- testy opcji `maxConnections` w `packages/db/test/client-options.test.ts`,
- testy transakcyjnego helpera HTTP `executeHttpAuthorizedCompanyAction` w `apps/api/test/oidc-authorization-pipeline.test.ts` (w tym eliminacja TOCTOU przy wyłączeniu `app_user` lub cofnięciu grantu po `resolveVerifiedIdentity`),
- 12 deterministycznych scenariuszy integracyjnych i współbieżności na rzeczywistym PostgreSQL 18 w `packages/db/test/transactional-authz.integration.ts` (bariery współbieżności i `pg_blocking_pids`, wyścigi cofnięcia członkostwa, delegowalnego grantu, konta `app_user` i tożsamości OIDC, równolegli administratorzy, reaktywacja bez przywracania grantów, izolacja tenantów, rollback awarii audytu, idempotencja, brak zakleszczeń `A -> B` vs `B -> A` oraz bezpieczne ponowne użycie połączenia przy `maxConnections: 1`).

**Wcześniejsza aktualizacja 6D-2 (2026-10-28):** [etap 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) rozszerzył walidację o:

- testy czystej polityki autoryzacji administracyjnej `decideAccessManagementAuthorization` w `packages/domain` (izolacja tenanta, zakaz self-escalation dla każdej roli, hierarchia ról i granice delegacji `tenant_admin`),
- testy portów tożsamości OIDC i kompozycji `authenticateOidcActor`, `authorizeAuthenticatedCompanyAction`, `createOidcAccessManagementActorSource` oraz `createTenantAccessManagementAuthorizer` w `packages/application`,
- testy jednostkowe i integracyjne PostgreSQL dla migracji `0003_user-identity.sql`, `PostgresUserIdentityResolver`, `PostgresUserIdentityStore` i `PostgresAccessManagementAuthorizationDataSource` w `packages/db`,
- testy kryptograficznego weryfikatora `JwksOidcAccessTokenVerifier` (RS256/ES256, algorytmy `none`/`HS256`, nagłówki `jku`/`jwk`/`x5u`/`x5c`/`crit`, pomylenie ID/Refresh/Logout Token z Access Tokenem, `iss`, `sub`, `aud`, `azp`, `exp`, `nbf`, `iat`, `scope`, rotacja JWKS z cooldownem, cofnięcie tokenu, redakcja błędów) oraz pełnego pipeline'u NestJS/Fastify z `CompanyActionAuthorizationGuard` w `apps/api`.

Wszystkie testy PostgreSQL uruchamiają się obowiązkowo w izolowanej usłudze `pap_test` na GitHub Actions (`db-integration`).

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

- **Domain:** akceptacja poprawnych UUID oraz odrzucanie niepoprawnych identyfikatorów; czysta polityka aktywnego członkostwa, jawnych grantów tenant/firma/akcja, czasu ważności i odmowy domyślnej (`decideAccountingAccess`); czysta polityka autoryzacji administracyjnej (`decideAccessManagementAuthorization`).
- **Contracts:** walidacja kontraktu statusu, odrzucanie nieznanych pól i nieuzasadnionych twierdzeń o dostępności.
- **Application:** wynik współdzielonego use case statusu, policy use case działający na porcie zaufanego źródła, kompozycja uwierzytelniania OIDC z resolverem tożsamości i autoryzacją firmy, transakcyjny `UnitOfWork` (`executeAuthorizedCompanyAction`) oraz serwerowe źródło aktora i transakcyjny autoryzator dla `manageAccess`. Testy używają wyłącznie syntetycznych danych i implementacji in-memory.
- **API:** testy przez prawdziwy adapter Nest/Fastify w pamięci:
  - publiczne `/health` i `/api/v1/system/status` oraz brak niezdefiniowanych tras administracyjnych w `AppModule`,
  - weryfikator kryptograficzny `JwksOidcAccessTokenVerifier` i walidator konfiguracji `loadOidcVerifierConfig`,
  - pełny pipeline serwerowy z kontrolerami testowymi chronionymi przez `CompanyActionAuthorizationGuard` oraz transakcyjny `executeHttpAuthorizedCompanyAction` (rozróżnienie `401` vs `403` vs `400`, ignorowanie `userId`/`role` w body i query, odrzucanie nagłówków spoofingu i `?access_token=`, natychmiastowa odmowa po cofnięciu członkostwa i reaktywacji bez przywracania grantów, wycofanie transakcji przy TOCTOU, redakcja błędów).
- **Web:** renderowalny, prawidłowy status; odrzucanie niepoprawnego payloadu i adresu API zawierającego dane logowania.
- **Web → API E2E:** przeglądarka sprawdza działające połączenie z lokalnym Nest/Fastify API, stan UI po zatrzymaniu API oraz styl komponentu współdzielonego z `packages/ui`.
- **MCP:** test klient-serwer przez transport in-memory i potwierdzenie, że serwer udostępnia wyłącznie narzędzie `system_status`; osobny proces uruchamia serwer przez STDIO.
- **Granice architektoniczne (`pnpm test:arch`, uruchamiane także w `pnpm test`):** programowy test ESLint weryfikujący reguły `no-restricted-imports` z `eslint.config.mjs` — blokowanie niedozwolonych zależności (m.in. `@nestjs/common`, `drizzle-orm` i `jose` w `packages/domain` oraz `packages/application`, `@pap/db` w `apps/web` oraz `apps/mcp`) oraz akceptację dozwolonych importów.
- **PostgreSQL/migracje (`pnpm test:integration`):** osobny job CI używa świeżej `pap_test` w PostgreSQL 18. Lokalnie wymagany jest bezpośrednio zainstalowany PostgreSQL, bez Dockera. Każdy zestaw tworzy własny namespace danych, rozszerzenia i rejestru; samo `migrationsSchema` nie izoluje tabel. Testy sprawdzają kolejność i hashe `0000` → `0003`, osiem tabel modelu i rejestr, ponowienie bez zmiany obiektów, rollback migracji, upgrade `0000`–`0002` → `0003`, FK/UNIQUE/CHECK/NOT NULL, zakaz nakładania profili, adapter 6D-1, transakcyjny cykl dostępu 6D-R, mapowanie tożsamości OIDC 6D-2 oraz transakcyjną autoryzację i eliminację TOCTOU 6D-3A (w tym deterministyczne wyścigi z barierami i `pg_blocking_pids`, brak zakleszczeń na powiązanych członkostwach oraz ponowne użycie połączenia po `ROLLBACK`).
- **DB bez PostgreSQL (`pnpm test`):** konfiguracja odrzuca `production`, hosty zdalne, niewłaściwe konta/bazy i błędne adresy; testy namespace, CLI, łańcucha migracji `0000`–`0003`, limitu `maxConnections` oraz jednostkowe testy builderów Drizzle dla `PostgresTenantAuthorizationDataSource`, `PostgresAccessManagementStore` (z kanonicznym porządkiem blokad 6D-3A) i `PostgresUserIdentityResolver` / `PostgresUserIdentityStore`.

Testy 6D-2 i 6D-3A potwierdzają serwerową weryfikację tokenów OIDC, mapowanie tożsamości oraz atomowe, transakcyjne powiązanie decyzji autoryzacyjnej z wykonaniem operacji i audytem mutacji w PostgreSQL, lecz nie obejmują jeszcze ograniczonej roli runtime DB i polityk PostgreSQL RLS (**6D-3B**), strukturalnego audytu decyzji `allow/deny` (**6D-3C**) ani interaktywnego logowania w przeglądarce (PKCE/sesja).

## Lokalna kontrola PR

`pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, testy granic i `pnpm test:e2e` nie wymagają PostgreSQL. E2E uruchamia wyłącznie lokalny frontend/backend. Także `pnpm dev` i `pnpm db:generate` działają bez bazy; migracje nie są zależnością startu aplikacji.

Tylko `pnpm db:migrate` oraz `pnpm test:integration` wymagają działającego PostgreSQL. Przygotowanie oddzielnych kont/baz i instrukcja Windows/PowerShell: [19 — przewodnik developera](19-przewodnik-developera.md#postgresql-lokalnie-bez-dockera). Testów integracyjnych nie poprzedzaj ręczną migracją `pap_test`: wymagają bazy bez zastanego `btree_gist` i nie usuwają go na potrzeby testu. W CI baza jest świeża.

Uruchom dostępne kontrole przed review. W opisie PR podaj oddzielnie wyniki lokalne i CI dla konkretnego commita. Jeśli PostgreSQL lokalnie nie jest dostępny, nie instaluj go automatycznie i nie oznaczaj testu integracyjnego jako lokalnie zaliczonego. Izolowana usługa PostgreSQL w CI jest dozwolona przez [ADR-005](adr/005-rozwoj-lokalny.md).

Każda zmiana reguł prawnych wymaga osobnych testów referencyjnych, dat obowiązywania, źródła urzędowego i przeglądu eksperta — sam szkielet nie implementuje takich reguł.
