# 17. Docelowa struktura repozytorium i standardy implementacji

**Status:** kierunek architektury przyjęty dla [Issue #5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5). Część „Aktualny szkielet” opisuje kod, który istnieje. Pozostałe pakiety poniżej to plan, a nie deklaracja wdrożenia. Obowiązuje [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md).

## Aktualny szkielet

```text
polish-accounting-platform/
├── apps/
│   ├── web/                    # Next.js; /app oraz statyczne placeholdery
│   ├── api/                    # NestJS + Fastify; publiczny status oraz serwerowy adapter OIDC/guard/UnitOfWork (6D-2/6D-3A)
│   └── mcp/                    # lokalne STDIO; tylko read-only system_status
├── packages/
│   ├── domain/                 # identyfikatory, polityka grantów (6C) i autoryzacji administracyjnej (6D-2)
│   ├── application/            # use case statusu, porty OIDC/tożsamości, autoryzacji i transakcyjnego UnitOfWork (6C/6D-R/6D-2/6D-3A)
│   ├── contracts/              # ścisły kontrakt statusu
│   ├── ui/                     # współdzielone komponenty interfejsu
│   └── db/                     # Drizzle, migracje 0000-0003 (6A/6B/6D-R/6D-2) i transakcyjne adaptery PostgreSQL (6D-3A)
├── .github/workflows/ci.yml
├── compose.yaml                # wcześniejszy scaffold; poza bieżącym trybem pracy
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── turbo.json
```

Pakiet `db` zawiera migracje `0000`–`0006`: tabele tenantów, firm, członkostw, wersji profilu, jawnych grantów, zdarzeń audytowych cyklu dostępu, wewnętrznej tożsamości użytkownika (`app_user`, `user_oidc_identity`) oraz fundament bezpieczeństwa runtime (`security_decision_event`, `company_operation_probe`, ograniczona rola runtime, podpisany kontekst HMAC `pap.context`, `FORCE ROW LEVEL SECURITY` i wyzwalacze wymuszające audyt) wraz z walidacją połączeń loopback dla profili `local`, `test` i `staging` ([opis 6B](22-schemat-tenantow-6b.md), [6D-R](24-bezpieczny-cykl-dostepu-6dr.md), [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md), [6D-3A](26-transakcyjna-autoryzacja-6d3a.md), [6D-3B](27-runtime-security-6d3a.md), [6D-3C](28-security-audit-6d3c.md)). Nie ma jeszcze workerów, integracji zewnętrznych ani księgowania. Rozwój lokalny nie wymaga Dockera ani lokalnej bazy ([ADR-005](adr/005-rozwoj-lokalny.md)), natomiast na serwerze Hetzner działa prywatny staging techniczny Web/API Etapu A ([ADR-006 — staging](adr/006-prywatny-staging-hetzner.md)) i tam w izolowanym środowisku testowym realizujemy bieżące CI ([ADR-006 — CI](adr/006-tymczasowe-ci-hetzner.md)); automatyczne deploymenty i produkcja nie istnieją. `domain` zawiera czyste funkcje decyzji dla dostępu księgowego (`decideAccountingAccess`) oraz operacji administracyjnych (`decideAccessManagementAuthorization`). `application` udostępnia porty weryfikacji OIDC, rozwiązania wewnętrznej tożsamości, źródła faktów autoryzacyjnych oraz wspólne use case'y (`authenticateOidcActor`, `authorizeAuthenticatedCompanyAction`, `executeAuthorizedCompanyAction`, `manageAccess`). Identyfikatory firm z pakietu `domain` nie nadają dostępu, a role administratora tenanta i operatora platformy nie dają domyślnego dostępu do ksiąg.

**Stan 6D-3A / ograniczenie Issue #6:** `@pap/db` implementuje porty przez `PostgresTransactionalUnitOfWork`, `PostgresAccessManagementStore` (z transakcyjnym `runInTransaction`), `PostgresTenantAuthorizationDataSource`, `PostgresAccessManagementAuthorizationDataSource`, `PostgresUserIdentityResolver` oraz `PostgresUserIdentityStore`. `apps/api` dostarcza `JwksOidcAccessTokenVerifier`, `CompanyActionAuthorizationGuard` i `executeHttpAuthorizedCompanyAction`. Publiczne `AppModule` nie wystawia jeszcze endpointów księgowych ani mutujących z uwagi na pozostałe podetapy 6D-3: brak ograniczonej roli runtime DB i polityk PostgreSQL RLS (6D-3B) oraz pełnego audytu decyzji `allow/deny` (6D-3C). Szczegóły opisują [dokument 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) oraz [dokument 6D-3A](26-transakcyjna-autoryzacja-6d3a.md).

## Struktura monorepo

```text
polish-accounting-platform/
├── apps/
│   ├── web/                    # Next.js, UI; bez dostępu do DB i tajemnic urzędowych
│   ├── api/                    # NestJS + Fastify, REST/OpenAPI v1, policy enforcement
│   ├── mcp/                    # MCP TypeScript SDK, transport/auth, use-case przez API
│   └── worker/                 # OCR, antywirus, import, KSeF, raporty, pg-boss
├── packages/
│   ├── domain/                 # czysta logika księgowa, podatkowa, dokumentowa
│   ├── application/            # use cases, ports, transakcje, policy engine
│   ├── contracts/              # Zod DTO, OpenAPI, typy zdarzeń, API errors
│   ├── db/                     # Drizzle, migrations, RLS, repos (adaptery)
│   ├── integrations/           # KSeF, JPK, NBP, REGON, OCR, banki (port-adapters)
│   ├── auth/                   # adapter OIDC/JWT, ABAC/policy adapters
│   ├── ui/                     # design system i komponenty wielokrotnego użytku
│   └── config/                 # env validation, eslint, tsconfig
├── tooling/                    # skrypty CI, fixtures syntetyczne, test utilities
├── infra/
│   ├── docker/                 # Compose dla lokalnego developmentu
│   └── opentofu/               # szkielety IaC, bez poświadczeń i deploy
├── docs/
│   └── adr/
├── .github/workflows/
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── package.json
└── AGENTS.md
```

**Zasada:** `apps/mcp` nie importuje `packages/db`. `apps/web` nie importuje repozytoriów ORM. `packages/domain` i `packages/application` nie importują Next, Nest, HTTP, obiektów Drizzle ani biblioteki `jose`. Nie tworzyć wspólnego `utils` zawierającego dowolną logikę domenową.

## Moduły i kierunek zależności

- `domain`: entity, value objects (Money/TaxPeriod), niezmienne zdarzenia, reguły księgowe, walidacja invariants.
- `application`: use case `ImportDocument`, `PrepareEntry`, `ApproveOperation`, `SyncKsef`, polityki autoryzacyjne, porty.
- `db`: mapowania Drizzle, transakcje i migracje; jeden adapter `UnitOfWork`, uprawnienia runtime i RLS.
- `integrations`: implementacje portów, narzędzia retry i idempotencji; otoczone feature flagami.
- `api`: normalizacja tokenu, tenant context, transport DTO, policy enforcement; żadnych reguł podatkowych.
- `mcp`: bezpośrednie wywołanie autoryzowanego API i mapowanie na MCP; nie importuje DB, LLM ani kluczy MF.
- `worker`: konsument kolejki, egzekwowanie użycia komend aplikacyjnych i audytu, limit per provider/per tenant.

Konwencja katalogów wewnątrz każdego modułu: `domain/`, `application/`, `infrastructure/`, `tests/` tylko jeśli uzasadnione; w małych modułach proste płaskie katalogi bez ceremonialnych warstw.

## Kontrakt API i przykład jakości

- Namespace: `/api/v1` i `/health`; pagination cursor/limit, jawne `problem+json`, stabilny `error_code` i `request_id`.
- `POST` dla operacji nieidempotentnych wymaga `Idempotency-Key`; odpowiedź nie może podawać tokenu, surowego wyjątku SQL ani danych innej firmy.
- Ładunki plików: proces przygotowania uploadu i osobny etap potwierdzenia checksum/skanowania; brak bezpośredniego uploadu do API jako domyślnego rozwiązania przy dużych plikach.
- Zmiana kontraktu API: migracja kompatybilna i test kontraktowy; MCP deklaruje wersjonowaną semantykę narzędzi.

## Polecenia dostępne obecnie

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm format:check
pnpm test:integration
pnpm db:generate
pnpm db:migrate
pnpm audit --audit-level high
```

Powyższe skrypty są skonfigurowane w repozytorium. Szczegółowa instalacja jest w [19 — przewodniku developera](19-przewodnik-developera.md), a zakres testów w [20 — strategii testów](20-strategia-testow.md). Przeglądarkowy E2E sprawdza rzeczywisty przepływ web → API oraz niedostępność API. Testy integracyjne na izolowanej bazie PostgreSQL 18 (wykonywane w odizolowanym środowisku CI na Hetznerze wg [ADR-006](adr/006-tymczasowe-ci-hetzner.md)) weryfikują migracje `0000`–`0006`, adapter autoryzacji, cykl dostępu, mapowanie tożsamości OIDC oraz Security Foundation 6D-3 (transakcyjną eliminację TOCTOU, brak zakleszczeń, ograniczoną rolę runtime, podpisany kontekst HMAC, `FORCE RLS` i atomowy audyt `allow/deny`).

## Standard CI i dependency hygiene

1. Bieżący tryb CI ([ADR-006](adr/006-tymczasowe-ci-hetzner.md)): automatyczne wyzwalacze GitHub Actions w `.github/workflows/ci.yml` są tymczasowo wyłączone; kontrole statyczne, testy jednostkowe/integracyjne i skan sekretów na odbieranym SHA wykonujemy w odizolowanym środowisku testowym na serwerze Hetzner (docelowy przepływ GitHub Actions: checkout przypięty po SHA → Corepack/pnpm → lint/typecheck/test/build → skan sekretów i zależności).
2. Obecny test integracyjny migracji: lokalnie opcjonalny, bezpośrednio zainstalowany PostgreSQL 18, a w bieżącym CI odizolowana, nietrwała instancja PostgreSQL 18.6 na Hetznerze (nigdy baza stagingu ani dane produkcyjne).
3. Review migracji DB osobno od kodu; transakcje, RLS, indeksy, zero downtime.
4. Lockfile, automatyczne PR z aktualizacjami bezpieczeństwa, cykl patch releases.
5. Zmiana `domain` lub `tax-rules` wymaga testów referencyjnych i przeglądu merytorycznego.
6. Environment validation przy starcie: fail fast przy braku sekretu, brak hard-coded fallbacków prod.
7. ESLint `no-restricted-imports` sprawdza w CI, że `packages/domain` i `packages/application` nie importują Next/Nest/HTTP/ORM/MCP/`jose` ani pakietu DB, a `apps/web` i `apps/mcp` nie importują pakietu DB ani adapterów ORM.

## Warunki promocji i pracy z agentami

- Przed scaffoldem: zamknąć decyzję z ADR-002 oraz odpowiedni threat-model z Issue #3.
- Po scaffoldzie: proof-of-concept API + PostgreSQL RLS + tenant test + read-only MCP tool na danych syntetycznych.
- Kolejne PR-y maksymalnie jeden bounded context / jedna zmiana contract. Nie budować od razu pełnych ksiąg, JPK czy samoczynnych deklaracji.
- Bramka dla rozdzielenia mikroserwisu: udokumentowane bottleneck, transakcyjne granice, load-test i koszt migracji. Bez tego utrzymujemy modularny monolit.
