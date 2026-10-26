# ADR-004 — Wspólny model autoryzacji i granice zaufania

- **Status:** propozycja do przeglądu w PR dla Issue #3
- **Data:** 2026-10-26
- **Zakres:** kontrakt bezpieczeństwa przed implementacją tenantów, API i MCP
- **Powiązania:** [ADR-001](001-rdzen-i-mcp.md), [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [ADR-003](003-administracja-i-uprawnienia-produktowe.md), [model zagrożeń i uprawnień](../18-model-zagrozen-i-uprawnien.md), Issue [#3](https://github.com/RolePlayingTech/polish-accounting-platform/issues/3)

## Kontekst

Aplikacja będzie dostępna przez web, REST, MCP i procesy w tle. Różne implementacje kontroli dostępu mogłyby dopuścić inną operację w każdym kanale. Podstawowym ryzykiem jest ujawnienie dokumentu lub wykonanie nieodwracalnej czynności wobec niewłaściwego tenanta albo firmy. Trzeba także oddzielić operatora platformy, administratora organizacji i osoby pracujące w księgach.

## Decyzja

1. Każda operacja przechodzi przez wspólny, serwerowy application service i policy check, niezależnie od kanału wejścia.
2. Polityka jest deny-by-default i uwzględnia tożsamość, typ aktora, aktywne członkostwo, tenant, firmę, działanie, stan/wersję zasobu, okres grantu i wymagany etap zatwierdzenia.
3. Rola platformowa, administracja tenanta i role księgowe są odrębnymi grantami. Żadna rola administratora nie daje domyślnego dostępu do dokumentów klienta. Ewentualny break-glass pozostaje poza MVP i wymaga osobnej decyzji.
4. Tenant/firma podane przez klienta są selektorami, nie dowodem uprawnienia. Serwer rozwiązuje je względem grantów; tenant context dla późniejszego PostgreSQL RLS ustawia się transakcyjnie zgodnie z ADR-002.
5. `prepare`, `approve` i `execute` to oddzielne komendy. Agent/OCR/worker nie zatwierdza ani nie autoryzuje własnych operacji wymagających zgody człowieka. Zatwierdzenie wiąże się z wersją/hash treści i ponowną weryfikacją grantu.
6. Decyzje autoryzacyjne i zmiany krytyczne są audytowane bez kopiowania dokumentów, tokenów i zbędnych danych osobowych. Krytyczny zapis fail-closed, jeśli audytu nie można zagwarantować.

Role, macierz działań, zagrożenia i testy negatywne są określone w [docs/18-model-zagrozen-i-uprawnien.md](../18-model-zagrozen-i-uprawnien.md).

## Rozważone warianty

| Wariant | Ocena |
| --- | --- |
| Uprawnienia egzekwowane tylko przez ukrywanie elementów UI | Odrzucone: REST, MCP lub bezpośrednie żądanie omija interfejs |
| Osobna logika authZ dla UI, API i MCP | Odrzucone: rozjazd polityk i nieprzewidywalne różnice |
| Jedna globalna rola superadmina do całego systemu | Odrzucone: niepotrzebny dostęp do dokumentów klientów i konflikt z ADR-003 |
| Sam token OAuth jako kompletna decyzja dostępu do firmy | Odrzucone: granty i członkostwo mogą zostać cofnięte po wydaniu tokenu; potrzebna kontrola zasobu przy każdej operacji |
| Wspólny policy check, granty ograniczone zakresem i defense in depth | **Proponowane**: wspólna semantyka, testowalne odmowy, późniejszy RLS jako dodatkowa bariera |

## Konsekwencje

- Przed dokumentami i księgami należy wdrożyć w Issue #6 tożsamość, granty tenant/entity i testy cross-tenant.
- MCP w Issue #8 nie może uzyskać dostępu do bazy ani własnego zestawu reguł. Token ogranicza potencjalny zakres, ale serwer nadal sprawdza bieżące granty.
- Katalog roli nie wystarczy: każda operacja potrzebuje jawnego prawa i zakresu. Wymaga to większej liczby testów odmów, ale ogranicza skutki błędnej konfiguracji.
- Brak break-glass i billing nie blokuje utrzymania technicznego platformy; funkcje te wymagają osobnego procesu/ADR.
- W tym ADR nie wybiera się dostawcy tożsamości innego niż referencyjny OIDC/Keycloak przyjęty w ADR-002.

## Migracja i rollout

Nie istnieją jeszcze konta ani dane produkcyjne, więc nie ma migracji danych. Implementacja powinna zacząć od policy contract i syntetycznych fixtures, następnie od middleware/API, testów izolacji i ograniczonej roli runtime. PostgreSQL RLS można dodać jako osobną barierę po wprowadzeniu schematu tenanta; nie zastępuje ona kontroli w application service. MCP i worker dołączają dopiero po przetestowaniu tej samej polityki. Każda zmiana semantyki ról po utworzeniu grantów wymaga wersjonowanej migracji i testów regresyjnych.

## Wymagane dowody

- Macierz role → zasób → działanie → warunek.
- Negatywne przypadki dla izolacji, grantów, tokenów, replay, zatwierdzenia, prompt injection i audytu.
- Testy API i MCP używające wspólnego policy check, w tym odmowa dla nieprawidłowego tenant/entity.
- Przegląd eksperta bezpieczeństwa przed uruchomieniem produkcyjnego pilotażu; sam dokument nie jest takim przeglądem.
