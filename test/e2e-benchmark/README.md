# Zestaw Benchmarkowy i Diagnostyczny: `e2e@latest` (`@e2e-dev/web`) vs `@playwright/test`

Odizolowany, powtarzalny zestaw benchmarkowy przygotowany w ramach **Issue [#64](https://github.com/RolePlayingTech/polish-accounting-platform/issues/64)** do empirycznego porównania frameworka [`tester-army/e2e`](https://github.com/tester-army/e2e) (`e2e@0.23.0`, `@e2e-dev/web@0.15.5`) z `@playwright/test@1.64.1` na aplikacji **Polish Accounting Platform**.

> **Gwarancja izolacji:** Żaden plik w tym katalogu nie nadpisuje ani nie modyfikuje produkcyjnego zestawu testów `apps/web/e2e/accounting-flows.spec.ts`. Wszystkie uruchomienia korzystają z dedykowanych portów lokalnych **`41801` (`@pap/api`)** oraz **`31801` (`@pap/web`)**, a po zakończeniu automatycznie zamykają drzewo procesów potomnych.

---

## Struktura katalogu

- `run-benchmark.mjs` — pojedynczy skrypt orkiestrujący (uruchamia `@pap/api` na `:41801` i `@pap/web` na `:31801`, resetuje stan `@pap/api` przed każdą iteracją, wykonuje pomiary, wyłącza telemetrię `E2E_TELEMETRY_DISABLED=1` i zapisuje zagregowane wyniki JSON w `results/`).
- `playwright.benchmark.config.ts` — odizolowana konfiguracja `@playwright/test` (`1280x720`, `pl-PL`, `Europe/Warsaw`, `workers: 1`).
- `e2e.benchmark.config.ts` — odizolowana konfiguracja `e2e` (`@e2e-dev/web` + `@e2e-dev/acp` `codex()`, `1280x720`, `pl-PL`, `Europe/Warsaw`, `workers: 1`).
- `playwright/accounting-benchmark.spec.ts` — 5 reprezentatywnych scenariuszy księgowych w deterministycznym `@playwright/test`.
- `e2e-deterministic/accounting-benchmark.e2e.ts` — 5 identycznych funkcjonalnie scenariuszy księgowych w deterministycznym API `@e2e-dev/web` (`app`, `screen`, `browser`, `expect`).
- `e2e-agent/accounting-agent.e2e.ts` — scenariusz hybrydowo-agentowy (`agent.act`, `agent.assert`) do badania nagrywania i odtwarzania cache'u `.e2e/cache/` (`trace-1`).
- `diagnostics/split-brain-probe.spec.ts` oraz `diagnostics/split-brain-probe.e2e.ts` — równoważne sondy diagnostyczne weryfikujące rozjazd UI vs `@pap/api` (zgłoszenia `#57`, `#59`, `#60`, `#62`, `#63`).
- `results/` — zapisane artefakty pomiarowe JSON z przebiegów benchmarku.

---

## Szybkie uruchomienie (1 polecenie)

Wymagane zbudowane pakiety `@pap/api...` (`pnpm --filter @pap/api... build`):

```bash
# Pełny benchmark deterministyczny (Playwright vs e2e, N=5 powtórzeń):
node test/e2e-benchmark/run-benchmark.mjs --mode=deterministic --runs=5

# Sonda diagnostyczna Split-Brain (#57-#63) w obu narzędziach:
node test/e2e-benchmark/run-benchmark.mjs --mode=diagnostics

# Benchmark trybu agentowego AI (Cold Run + Warm Cache Replay):
node test/e2e-benchmark/run-benchmark.mjs --mode=agent

# Wszystkie tryby kolejno:
node test/e2e-benchmark/run-benchmark.mjs --mode=all --runs=5
```

---

## Ponowne uruchomienie po Fali 2 (po wdrożeniu pełnego stosu PostgreSQL 18)

Po scaleniu poprawek eliminujących split-brain (`#57`–`#63`) oraz podłączeniu bazy PostgreSQL 18 (Fala 2), wystarczy uruchomić:

```bash
node test/e2e-benchmark/run-benchmark.mjs --mode=diagnostics
```

W pliku `test/e2e-benchmark/results/benchmark-diagnostics.json` flagi diagnostyczne powinny wówczas zmienić wartości na:

- `issue62_apiPreservedRawXmlPayload: true` (pełny dokument XML `FA(3)` oraz numery KSeF utrwalone w bazie `@pap/api`),
- `issue60_apiMcpProposalsCount >= 1` (propozycja MCP zapisana w `@pap/api` zamiast wyłącznie w pamięci Next.js),
- `issue57_calendarMutationUsesRealApi: true` (mutacja kalendarza podatkowego przechodząca przez endpoint `@pap/api`).

Szczegółowa analiza wyników znajduje się w raportach:

- [`docs/reports/e2e-vs-playwright.md`](../../docs/reports/e2e-vs-playwright.md)
- [`docs/reports/e2e-technical-business-review.md`](../../docs/reports/e2e-technical-business-review.md)
