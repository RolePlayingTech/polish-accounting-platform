# 17. Docelowa struktura repozytorium i standardy implementacji

**Status:** kierunek architektury przyjęty dla [Issue #5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5). Część „Aktualny szkielet” opisuje kod, który istnieje. Pozostałe pakiety poniżej to plan, a nie deklaracja wdrożenia. Obowiązuje [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md).

## Aktualny szkielet

```text
polish-accounting-platform/
├── apps/
│   ├── web/                    # Next.js; /app oraz statyczne placeholdery
│   ├── api/                    # NestJS + Fastify; publiczny status bez danych firm
│   └── mcp/                    # lokalne STDIO; tylko read-only system_status
├── packages/
│   ├── domain/                 # identyfikatory tenant/company, bez autoryzacji
│   ├── application/            # use case publicznego statusu
│   ├── contracts/              # ścisły kontrakt statusu
│   └── ui/                     # współdzielone komponenty interfejsu
├── .github/workflows/ci.yml
├── compose.yaml                # lokalny development, porty tylko na loopback
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── turbo.json
```

Szkielet nie zawiera DB, migracji, OIDC, tenantów, workerów, integracji zewnętrznych ani księgowania. Identyfikatory firm z pakietu `domain` nie nadają dostępu. Role i egzekwowanie uprawnień pozostają do wdrożenia w kolejnych zadaniach zależnych od modelu zagrożeń.

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

**Zasada:** `apps/mcp` nie importuje `packages/db`. `apps/web` nie importuje repozytoriów ORM. `packages/domain` nie importuje Next, Nest, HTTP ani obiektów Drizzle. Nie tworzyć wspólnego `utils` zawierającego dowolną logikę domenową.

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
pnpm audit --audit-level high
```

Powyższe skrypty są skonfigurowane w repozytorium. Szczegółowa instalacja jest w [19 — przewodniku developera](19-przewodnik-developera.md), a zakres testów w [20 — strategii testów](20-strategia-testow.md). Przeglądarkowy E2E sprawdza rzeczywisty przepływ web → API oraz niedostępność API. Testy integracyjne z DB i migracje pozostają przyszłym zakresem, bo nie ma jeszcze bazy ani funkcji uwierzytelniania.

## Docelowe polecenia po wdrożeniu kolejnych modułów

```bash
pnpm test:integration
pnpm db:migrate
```

Powyższe polecenia są przyszłym wymaganiem dla modułów DB i uwierzytelniania; nie są aktualnymi skryptami.

## Standard CI i dependency hygiene

1. GitHub Actions: PR -> checkout (pinned action sha) -> Corepack/pnpm -> cache -> lint/typecheck/test/build -> skan sekretów -> skan zależności -> raport.
2. Integracyjne Postgres+OIDC+object-store mocks w testcontainers/Compose; żadnych produkcyjnych danych.
3. Review migracji DB osobno od kodu; transakcje, RLS, indeksy, zero downtime.
4. Lockfile, automatyczne PR z aktualizacjami bezpieczeństwa, cykl patch releases.
5. Zmiana `domain` lub `tax-rules` wymaga testów referencyjnych i przeglądu merytorycznego.
6. Environment validation przy starcie: fail fast przy braku sekretu, brak hard-coded fallbacków prod.
7. ESLint `no-restricted-imports` sprawdza w CI, że `packages/domain` nie importuje Next/Nest/HTTP/ORM/MCP ani pakietu DB, a `apps/web` i `apps/mcp` nie importują pakietu DB ani adapterów ORM.

## Warunki promocji i pracy z agentami

- Przed scaffoldem: zamknąć decyzję z ADR-002 oraz odpowiedni threat-model z Issue #3.
- Po scaffoldzie: proof-of-concept API + PostgreSQL RLS + tenant test + read-only MCP tool na danych syntetycznych.
- Kolejne PR-y maksymalnie jeden bounded context / jedna zmiana contract. Nie budować od razu pełnych ksiąg, JPK czy samoczynnych deklaracji.
- Bramka dla rozdzielenia mikroserwisu: udokumentowane bottleneck, transakcyjne granice, load-test i koszt migracji. Bez tego utrzymujemy modularny monolit.
