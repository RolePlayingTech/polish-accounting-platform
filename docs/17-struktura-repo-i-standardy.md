# 17. Docelowa struktura repozytorium i standardy implementacji

**Status:** wymagania dla [Issue #5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5). To **projekt katalogów i kontraktów**, nie deklaracja, że istnieje działający kod. Obowiązuje [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md).

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

## Wymagane polecenia po bootstrapie

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm db:migrate
```

Dopóki nie istnieje `package.json`, **nie obiecujemy, że polecenia działają**. W Issue #5 należy je rzeczywiście zaimplementować, udokumentować i przetestować.

## Standard CI i dependency hygiene

1. GitHub Actions: PR -> checkout (pinned action sha) -> Corepack/pnpm -> cache -> lint/typecheck/test/build -> skan sekretów -> skan zależności -> raport.
2. Integracyjne Postgres+OIDC+object-store mocks w testcontainers/Compose; żadnych produkcyjnych danych.
3. Review migracji DB osobno od kodu; transakcje, RLS, indeksy, zero downtime.
4. Lockfile, automatyczne PR z aktualizacjami bezpieczeństwa, cykl patch releases.
5. Zmiana `domain` lub `tax-rules` wymaga testów referencyjnych i przeglądu merytorycznego.
6. Environment validation przy starcie: fail fast przy braku sekretu, brak hard-coded fallbacków prod.

## Warunki promocji i pracy z agentami

- Przed scaffoldem: zamknąć decyzję z ADR-002 oraz odpowiedni threat-model z Issue #3.
- Po scaffoldzie: proof-of-concept API + PostgreSQL RLS + tenant test + read-only MCP tool na danych syntetycznych.
- Kolejne PR-y maksymalnie jeden bounded context / jedna zmiana contract. Nie budować od razu pełnych ksiąg, JPK czy samoczynnych deklaracji.
- Bramka dla rozdzielenia mikroserwisu: udokumentowane bottleneck, transakcyjne granice, load-test i koszt migracji. Bez tego utrzymujemy modularny monolit.
