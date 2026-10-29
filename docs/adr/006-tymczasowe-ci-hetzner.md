# ADR-006 — Tymczasowe CI na Hetznerze zamiast GitHub Actions

- **Status:** obowiązująca decyzja właściciela.
- **Data:** 2026-10-29.
- **Zakres:** Polish Accounting Platform, procesy CI, testy i odbiór zmian.
- **Powiązania:** [AGENTS.md](../../AGENTS.md), [strategia testów](../20-strategia-testow.md), [ADR-005](005-rozwoj-lokalny.md).

## Kontekst

GitHub Actions nie jest obecnie dostępną ani akceptowaną ścieżką CI i pozostaje tymczasowo wstrzymane. Nie oczekujemy na statusy Actions ani nie wydajemy środków na nowe uruchomienia. Repozytorium i review pozostają na GitHubie. Dotychczasowe zielone przebiegi są historycznym dowodem testów z podanego SHA, nie dowodem odbioru przyszłych commitów.

Wcześniejszy ADR-005 opisywał rozwój lokalny i dopuszczał bazę testową na GitHub Actions. **W zakresie wykonywania bieżącego CI ten ADR zastępuje te fragmenty ADR-005.** Nie zmienia decyzji o architekturze aplikacji, lokalnej edycji kodu ani zakazu samowolnego wdrożenia.

## Decyzja

1. Wszystkie bieżące procesy CI, zwłaszcza `pnpm test:integration` na rzeczywistym PostgreSQL 18 oraz testy migracji, wykonujemy na serwerze Hetzner w odizolowanym, nietrwałym środowisku. Wykorzystujemy istniejący, autoryzowany dostęp (np. `ssh hetzner` / `hetz-1`) bez zakładania, że każdy agent dysponuje dostępem SSH.
2. Serwer z aplikacją nie jest obecnie produkcyjny, jest przeznaczony do użytku własnego. **Nie wolno** podłączać testów do istniejącej bazy, modyfikować usług aplikacji, nginx, DNS, certyfikatów, danych, wolumenów ani wykonywać deployu bez osobnej zgody. Odrębne kontenery / baza testowa, limity CPU/RAM, timeouty, izolacja sieci i usunięcie zasobów po zakończeniu są obowiązkowe.
3. Przy codziennym programowaniu wybieramy najkrótsze sensowne testy i statyczne kontrole adekwatne do zmian. Pełne E2E/regresję/integrację i niezależny security review można wydzielić do osobnego etapu oraz agenta; dla zmian krytycznych odpowiednia walidacja jest warunkiem scalenia.
4. PR dokumentuje dokładny SHA, komendy, wersje narzędzi i PostgreSQL, zakres oraz wynik testów, sposób izolacji i istotne pominięcia. Brak dostępu do Hetznera oznacza `NOT RUN`, a nie `PASS`.
5. Workflow `.github/workflows/ci.yml` pozostaje w repozytorium z wyłączonymi wyzwalaczami automatycznymi; nie wolno uruchamiać `workflow_dispatch`, `rerun`, ponawiać ani wznawiać Actions bez wyraźnej zgody właściciela.
6. Przywrócenie GitHub Actions oraz zmiana sposobu testowania wymaga nowej decyzji właściciela i aktualizacji tego ADR i AGENTS.md.

## Kryterium odbioru

Oceniaj kod i testy na końcowym SHA, nie historyczne statusy CI. Przed scaleniem sprawdź krytyczne scenariusze odmowy, rollback, współbieżność i izolację tenantów adekwatnie do zmian. Brak wymaganego przebiegu na Hetznerze jawnie blokuje odbiór, lecz nie uniemożliwia przygotowania PR do review.
