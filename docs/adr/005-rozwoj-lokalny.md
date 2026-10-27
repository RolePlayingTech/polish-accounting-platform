# ADR-005 — Bieżący rozwój wyłącznie lokalny

- **Status:** decyzja właściciela projektu; do review wraz z pakietem 6A (PR #17).
- **Data:** 2026-10-27
- **Powiązania:** [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6).

## Kontekst i decyzja

Na obecnym etapie potrzebujemy sprawdzalnego fundamentu DB, bez przygotowywania serwera, deploymentu i infrastruktury kontenerowej. Zachowujemy stos z ADR-002: TypeScript, Next.js, NestJS/Fastify, PostgreSQL i Drizzle. Zmieniamy bieżący sposób rozwoju, a nie granice modułów ani model autoryzacji.

- Web i API uruchamiamy przez `pnpm dev`, bez bazy i bez automatycznych migracji.
- Dla ręcznych migracji i testu integracyjnego używamy PostgreSQL 18 zainstalowanego bezpośrednio na komputerze, z osobnymi bazami i kontami `pap_local` oraz `pap_test`. Instrukcja jest w [przewodniku developera](../19-przewodnik-developera.md#postgresql-lokalnie-bez-dockera).
- Połączenia pakietu DB są ograniczone do `local`/`test` i loopback. Konfiguracja produkcyjna oraz zdalne hosty pozostają odrzucane.
- Nie budujemy obrazów, nie uruchamiamy Compose, nie przygotowujemy serwera ani konfiguracji wdrożeniowej. Wcześniejsze `compose.yaml` i `Dockerfile.dev` zachowujemy w wersji z `main`; nie są częścią walidacji 6A.
- CI może korzystać z izolowanej usługi PostgreSQL na runnerze GitHub do testu migracji. Nie wymaga to Dockera na komputerze developera ani obrazu aplikacji.

## Alternatywy i konsekwencje

Rozwijanie Compose z PostgreSQL odraczamy: zwiększa zakres infrastruktury bez potrzeby obecnego szkieletu. Zastąpienie PostgreSQL inną bazą odrzucamy: migracje mają być sprawdzane na docelowym silniku.

Developer sam przygotowuje lokalny PostgreSQL, jeśli potrzebuje testów DB; zwykłe testy i uruchomienie aplikacji nadal działają bez niego. Skrypty projektu nie instalują ani nie uruchamiają usług systemowych. Dokumentacja oddziela wyniki lokalne od CI; brak lokalnego PostgreSQL oznacza niewykonany lokalnie test integracyjny.

## Migracja, ryzyka i powrót do infrastruktury

Decyzja nie migruje ani nie usuwa istniejących baz, danych i wolumenów. Wycofujemy wyłącznie dodatki kontenerowe z PR #17; SQL migracji 6A pozostaje bez zmian. Brak automatycznego rollbacku DB. Późniejsza praca nad infrastrukturą wymaga osobnego zakresu i review. Kierunek stage/prod z ADR-002 pozostaje planem, bez zgody na wdrożenie.
