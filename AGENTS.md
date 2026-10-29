# Zasady dla agentów AI

Projekt: Polish Accounting Platform. Wszystkie zmiany projektuj dla jurysdykcji polskiej i w języku polskim.

## Dokumenty architektoniczne — obowiązkowe przed kodowaniem
- [ADR-001](docs/adr/001-rdzen-i-mcp.md): jeden rdzeń aplikacji i MCP jako adapter.
- [ADR-002](docs/adr/002-stos-technologiczny-i-wdrozenia.md): zatwierdzony bazowy stack i wdrożenia.
- [Zasady architektoniczne](docs/16-zasady-architektoniczne.md): granice modułów, bezpieczeństwo i DoD.
- [Struktura repo](docs/17-struktura-repo-i-standardy.md): kierunek zależności, przyszłe monorepo i polecenia.
- [ADR-003](docs/adr/003-administracja-i-uprawnienia-produktowe.md): propozycja rozdziału administratora platformy, tenanta i księgowego oraz przygotowanie przyszłych abonamentów. Nie wdrażać płatności w #5.
- [Brief UX i kierunek wizualny](docs/21-kierunek-wizualny.md): prosta, rozpoznawalna i przyjemna aplikacja do pracy, bez generycznego „AI dashboardu”; wzorce designu podlegają walidacji w [Issue #13](https://github.com/RolePlayingTech/polish-accounting-platform/issues/13).

Nie zastępuj wybranego stacku bez nowego ADR. Wybierz najmniejszy działający moduł, ale respektuj spójność i autoryzację. Skrypty build/test utrzymuj działające, ale ich bieżąca walidacja CI odbywa się na Hetznerze według zasad poniżej. Nie traktuj dokumentacji ani dawnych wyników GitHub Actions jako dowodu aktualnego odbioru.

## Obowiązujący tryb środowisk i CI (decyzja właściciela, 2026-10-29)
- **GitHub Actions jest tymczasowo wyłączone z automatycznego CI.** Agent nie uruchamia workflow, nie ponawia jobów, nie oczekuje na ich zakończenie i nie traktuje zielonych statusów GitHub jako wymaganego warunku review/merge. GitHub pozostaje miejscem zarządzania kodem, PR i Issue. Przywrócenie Actions wymaga odrębnej decyzji właściciela.
- **Wszystkie bieżące procesy CI, w tym testy integracyjne PostgreSQL i testy migracji, realizujemy na serwerze Hetzner** w *odizolowanym środowisku testowym*, nigdy na istniejących danych aplikacji. Gdy środowisko agenta udostępnia skonfigurowany alias SSH, użyj `ssh hetzner` (serwer `hetz-1`); nie zakładaj, że każdy agent ma dostęp SSH.
- Aplikacja na Hetznerze jest obecnie **nieprodukcyjna i przeznaczona do użytku własnego**. To nie jest zgoda na zmiany serwisów, konfiguracji, nginx, DNS, certyfikatów, baz ani automatyczne wdrożenia. Przed ingerencją poza izolowanym środowiskiem testowym ustal zakres i uzyskaj zgodę właściciela. Nie dotykaj istniejących usług, danych ani wolumenów; wymagane są limity zasobów, timeouty i sprzątanie zasobów testowych.
- Przy tworzeniu funkcjonalności uruchamiaj **minimalne, celowane testy** i podstawowe kontrole adekwatne do zmian. Pełną walidację regresyjną, E2E i audyt bezpieczeństwa można zlecić oddzielnemu agentowi przed scaleniem. Dla zmian autoryzacji, RLS i migracji obowiązkowe są odpowiednie testy negatywne/integracyjne na Hetznerze przed odbiorem; nie rezygnuj z krytycznych testów tylko ze względu na koszt.
- Opis każdego PR musi rozróżniać testy wykonane, pominięte i oczekujące; podawać SHA, środowisko (Hetzner), polecenia, wyniki oraz istotne ograniczenia. Nie oznaczaj testów jako zaliczonych bez faktycznego uruchomienia na wskazanym SHA.
- Dotychczasowy [ADR-005](docs/adr/005-rozwoj-lokalny.md) opisuje wcześniejszy sposób pracy. W zakresie miejsca uruchamiania CI i prawa używania izolowanego Hetznera nadrzędny jest [ADR-006](docs/adr/006-tymczasowe-ci-hetzner.md). Zwykły rozwój lokalny pozostaje możliwy, ale nie jest bieżącą ścieżką integracyjnej walidacji CI.

## Zasady bezwzględne
1. Priorytet: bezpieczeństwo danych, zgodność, audytowalność, dopiero potem funkcje.
2. Zanim rozpoczniesz pracę, przeczytaj README, roadmapę, architekturę, MCP, bezpieczeństwo, Issue i otwarte PR. Nie duplikuj zadań.
3. Jedno zadanie = jeden wąski PR. Dodaj testy (także negatywne), dokumentację, ryzyka i migracje.
4. Reguły księgowe/podatkowe muszą mieć źródło urzędowe, daty obowiązywania, wersję, testy referencyjne i kontrolę eksperta.
5. AI i OCR wyłącznie proponują dane; zatwierdzanie księgowania, deklaracji, płatności i wysyłki do urzędów jest odrębną autoryzowaną operacją.
6. Żadnych danych rzeczywistych osób, tokenów, sekretów, certyfikatów ani faktur w publicznym repozytorium.
7. Nie wykonuj operacji na produkcji ani wysyłki do instytucji bez odrębnej zgody właściciela projektu.
8. W API, UI i MCP obowiązuje jedna i ta sama autoryzacja; każdy tenant jest izolowany.
9. Dokumentacja to plan, nie dowód, że system realizuje daną funkcję.

## Środowiska pracy

- Istnieje prywatny staging techniczny na Hetznerze, dostęp przez `ssh hetzner`.
- Kanoniczna domena: `https://ksiegowosc.roleplayingtech.com`, HTTPS i HTTP Basic Auth.
- To nie jest produkcja księgowa; wyłącznie prywatny użytek i dane syntetyczne, bez prawdziwych rozliczeń.
- Działające Web/API nie dowodzą uruchomienia PostgreSQL. Najpierw sprawdź usługi i zasoby.
- Testy wymagające serwera można wykonywać na uprzednio wydzielonych, izolowanych zasobach testowych Hetznera. Nie używaj bazy działającego stagingu ani danych innych usług.
- Nie wymagamy lokalnej instalacji bazy na komputerze właściciela. Rozwój lokalny bez DB pozostaje dostępny; ADR-005 opisuje również historyczny etap local-only, rozszerzony przez ADR-006.
- Przed obciążającą operacją sprawdź limity ADR-006. Pełne buildy uruchamiaj tylko w zatwierdzonym, izolowanym środowisku CI z limitami zasobów na Hetznerze, nigdy w działającym stagingu ani bezpośrednio na współdzielonym hoście. Gdy brak takiego środowiska, oznacz build jako niewykonany. Nie instaluj automatycznie usług systemowych.

## Polityka pracy agentów

- Agent implementacyjny wykonuje minimalne testy celowane zmienionego modułu, scenariusze negatywne, kontrolę typów i statyczny przegląd migracji.
- Osobny etap/agenta walidacyjnego obowiązuje pełna kontrola regresji, integracji i bezpieczeństwa. Nie uruchamiaj pełnego zestawu wielokrotnie po drobnych zmianach.
- Niewykonany test oznaczaj jako **nieweryfikowany**, nigdy jako zaliczony. Podaj komendy i wymagania środowiska w przekazaniu.
- Krytyczne PR-y pozostają Draft do pełnego odbioru przed scaleniem. Zgodnie z nowszą decyzją właściciela (#29) CI wykonujemy na izolowanym Hetznerze; nie uruchamiaj, nie wznawiaj ani nie zmieniaj wyzwalaczy GitHub Actions bez odrębnej decyzji.

## Granice operacyjne

- Zakaz ingerencji w produkcję i w usługi innych projektów.
- Brak automatycznego deploymentu. Wdrożenia, migracje i administracja działającego stagingu wymagają osobnej zgody właściciela.
- Nie wykonuj destrukcyjnych zmian istniejących danych, nie zmieniaj firewalla, Nginx, DNS ani certyfikatów bez odrębnej zgody.
- Zgoda na odczytową kontrolę lub izolowany test nie jest zgodą na deployment ani migrację stagingu.

## Zasady projektowania interfejsu
- Przed tworzeniem wielu nowych ekranów pokaż 2–3 warianty i wyjaśnij rekomendację; masz swobodę zaproponowania innego, lepszego kierunku.
- Priorytetem są zadania użytkownika, czytelność tabel/kwot, prosty język polski, dostępność i stany błędów, a nie dekoracje lub marketing AI.
- Nie uznawaj kart statusu w pierwszym scaffoldzie za obowiązkowy wzorzec wszystkich przyszłych widoków.
- Wybór wizualnej tożsamości i większy redesign wymagają review; nie dodawaj ich do obecnego PR #12, dopóki nie ustalimy wzorców.

## Checklist PR
- [ ] Połączono z właściwym Issue.
- [ ] Uwzględniono przynajmniej jeden scenariusz niepoprawny.
- [ ] Zweryfikowano izolację firm, role i audyt.
- [ ] Brak danych wrażliwych i sekretów.
- [ ] Zaktualizowano dokumentację i ADR, gdy decyzje się zmieniły.
- [ ] W przypadku reguł prawa udokumentowano źródło, wersję i datę.
- [ ] Zmiany nie uruchamiają automatycznie połączeń produkcyjnych.

Najpierw: docs/12-roadmapa.md, docs/13-kryteria-akceptacji.md i ADR-002. Nie implementuj dodatkowego mikroserwisu, Redis/Kubernetes ani agentowego zapisu w księgach bez potrzeby i zatwierdzonej decyzji.
