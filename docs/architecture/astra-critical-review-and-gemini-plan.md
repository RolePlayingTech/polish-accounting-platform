# Astra — krytyczny przegląd architektury i plan dla Gemini

## A. Executive Verdict

**Zachować modularny monolit, stack i czyste kalkulatory domenowe. Wymienić granicę trwałości, urealnić tożsamość i rozdzielić naliczenie od zapłaty. Pełne przepisanie systemu nie ma uzasadnienia.**

Przegląd z 2026-11-08: `git ls-remote origin refs/heads/main` potwierdził **`755d33471e993640ead855d7ccb706a842ecfecb`**, zgodny z lokalnym HEAD. Brak otwartych PR-ów w chwili sprawdzenia. Przeczytano wskazane issues, komentarz #78, polityki oraz bezpośrednie zależności poniższych ścieżek. Dawne audyty, dokumentacyjne deklaracje i werdykty GO nie są dowodem odbioru.

**Confirmed** oznacza fakt wykazany statycznie; **Plausible** — skutek wymagający eksperymentu; **Incorrect/overstated** — twierdzenie szersze niż dowody.

| Zakres | Ocena i dowód |
| --- | --- |
| [#79](https://github.com/RolePlayingTech/polish-accounting-platform/issues/79) | **Confirmed:** `ensureCompanyHydratedIfValid` pomija istniejącą firmę, a `listDocuments` czyta RAM ([workspace](../../apps/api/src/runtime/postgres-workspace-persistence.ts#L387)). **Plausible:** odczyt niezacommitowanej mutacji RAM: `runAtomicMutation` zmienia współdzielony stan, odczyty omijają mutex. To luka aplikacji, nie dirty read PostgreSQL. |
| [#80](https://github.com/RolePlayingTech/polish-accounting-platform/issues/80) | **Confirmed:** `createCompany` kończy provisioning przed osobną transakcją ustawień/kont ([L831–952](../../apps/api/src/runtime/postgres-workspace-persistence.ts#L831)); brak UNIQUE tenant/NIP. **Plausible:** duplikaty przy wyścigu i częściowa firma po awarii; `pap_provision_company` używa zgodnych blokad SHARE oraz `IF EXISTS` ([SQL](../../packages/db/drizzle/0008_runtime-company-provisioning.sql#L241)). |
| [#83](https://github.com/RolePlayingTech/polish-accounting-platform/issues/83), [#78](https://github.com/RolePlayingTech/polish-accounting-platform/issues/78) | **Confirmed:** `SessionContextSchema`, `isConsistentPersonaIdentity`, `resolveSessionHmacKey` ograniczają Web do person i dopuszczają sekret per proces ([session](../../apps/web/lib/session.ts#L15)). `SandboxOidcService.issueToken` wydaje token bez indywidualnych credentials; kontroler wymaga jedynie włączonego sandboxu ([kontroler](../../apps/api/src/auth/sandbox-oidc.controller.ts)). **Plausible:** publiczna ekspozycja po zdjęciu Basic Auth; konfiguracji żywego serwera nie badano. |
| [#81](https://github.com/RolePlayingTech/polish-accounting-platform/issues/81) | **Confirmed:** `computeYtdKpirZusAndPriorPitInternal` sumuje naliczone składki do pól `paid*`; `getRyczaltView` robi analogicznie ([workspace](../../packages/application/src/accounting-workspace.ts#L3459)). **Incorrect/overstated:** wyciąganie z nazwy `previousAdvancesPaid*` wniosku, że każda formuła zaliczki musi odejmować faktyczne płatności. Wymaga to osobnego rozstrzygnięcia prawnego. |
| [#82](https://github.com/RolePlayingTech/polish-accounting-platform/issues/82) | **Confirmed:** `parseSafeKsefXml` używa regex i domyślnego FA(3), bez XSD ([parser](../../packages/application/src/document-import-parsers.ts#L191)). Ochrona DTD/ENTITY nie dowodzi zgodności KSeF. |

**Incorrect/overstated:** dotychczasowy test dwóch instancji dowodzi pełnej spójności — sprawdza odkrycie nowej firmy, nie aktualizację już załadowanej ([test](../../apps/api/test/postgres-persistence-e2e.integration.ts#L1184)). Nie potwierdzono aktualnych wyników żadnego testu.

## B. Architectural Decisions

### A — PostgreSQL i transakcje

**Decyzja:** PostgreSQL jest jedynym źródłem trwałego stanu; RAM pozostaje jawnym adapterem testowym. Zachować domenę, kontrakty i `executeAuthorizedCompanyAction`; wydzielać przypadki użycia z `AccountingWorkspaceService` przyrostowo. Porty repozytoriów należą do application, implementacje do `packages/db`; API składa zależności.

Odczyty wykonują zapytania do PG. Komenda ładuje potrzebny agregat przez zakres UoW, wykonuje istniejącą logikę domenową, zapisuje różnicę i audyt w jednej transakcji. Ewentualny obiekt roboczy jest prywatny dla transakcji; nie wolno publikować go przed COMMIT. Nie utrzymywać dwóch aktywnych źródeł prawdy podczas przejścia.

Na początek serializować zapisy **per firma**: w `lockCompanyActionFactsInTx` zastąpić blokadę firmy SHARE przez UPDATE dla komend, zachować SHARE dla krótkich odczytów. Brać właściwy tryb od razu, bez eskalacji SHARE→UPDATE. Wszystkie ścieżki, także worker i MCP, przestrzegają kolejności blokad z ADR-007. Wtedy READ COMMITTED i wspólna blokada firmy wystarczają do spójnych wielozapytaniowych operacji. Numeracja i zamknięcie okresu są sprawdzane pod tą blokadą; edycja szkicu wymaga oczekiwanej wersji. Koszt: gorąca firma i długie raporty mogą blokować zapis; rozdrobnienie blokad dopiero po pomiarze.

Zachować rewalidację konta/tożsamości, członkostwa i grantów, podpisany kontekst transakcyjny, NOBYPASSRLS, FORCE RLS, atomowy audyt sukcesu i osobny audyt odmowy. `runManagedTransaction` już rozróżnia potwierdzony rollback od `outcome_unknown` ([implementacja](../../packages/db/src/transaction-primitives.ts#L108)); tego nie zastępować ogólnym retry.

Trwały receipt komendy: klucz klienta związany z aktorem, tenantem, firmą/zakresem i rodzajem operacji, hash kanonicznego payloadu oraz wynik. Unikalność w DB; receipt, efekty i audyt commitują razem. Ten sam klucz/payload zwraca wynik po ponownej autoryzacji, inny payload daje konflikt. Powtórzenie po niepewnym COMMIT sprawdza receipt na primary i synchronizuje się przez ten sam unikalny klucz; nie uruchamia ślepo callbacku. Retry tylko ograniczony, po potwierdzonym abort, dla komendy bez efektów zewnętrznych. Obecne losowanie `operationId` przy każdym żądaniu tego nie zapewnia.

Provisioning: jedna transakcja obejmuje firmę, profil, jawne granty, ustawienia, niezbędne konta, receipt i audyt. Wybrać jedną kanoniczną kolumnę NIP w tożsamości firmy, normalizację i UNIQUE `(tenant_id, nip)`; ten sam NIP w różnych tenantach jest dozwolony. Wykryć zastane duplikaty przed migracją, bez automatycznego scalania. Rozszerzyć wąski executor provisioningu i podpisany zakres zamiast poszerzać ogólne ACL.

**Dodatkowy fakt:** `createCompany` przy niesklasyfikowanym błędzie może użyć migratora, jeśli skonfigurowano `PAP_MIGRATOR_DATABASE_URL` ([L892](../../apps/api/src/runtime/postgres-workspace-persistence.ts#L892)). Usunąć ten fallback i credentials migratora z API; niepewny COMMIT nie upoważnia uprzywilejowanej ponownej próby.

Odrzucono cache z TTL/pub-sub, globalny mutex i ponowną hydrację całej firmy jako rozwiązanie docelowe: nie zapewniają granicy commit, zwiększają pamięć lub wymagają trudniejszego protokołu. Dwufazowy provisioning nie jest potrzebny bez niezbędnego efektu zewnętrznego.

### B — Tożsamość i dostęp do demo

**Decyzja:** jeden standardowy IdP OIDC, referencyjnie Keycloak z ADR-002; żadnego własnego IdP. BFF realizuje Authorization Code + PKCE, state/nonce, ścisłe redirect URI. Przeglądarka otrzymuje nieprzezroczysty identyfikator sesji w Secure/HttpOnly/SameSite cookie; tokeny i rotowany refresh token pozostają w chronionym współdzielonym magazynie PG za portem sesji. Nie daje to Next.js dostępu do ksiąg. CSRF, expiry, logout/revoke i konkurencyjny refresh muszą działać na dwóch workerach. Konfiguracja kluczy i magazynu sesji ma być fail-closed.

Zachować `JwksOidcAccessTokenVerifier` i `PostgresUserIdentityResolver.resolveVerifiedIdentity`: backend już mapuje `(issuer, subject)` na `app_user`. E-mail nie jest kluczem łączenia kont. Usunąć zależności person także z `hydrateWorkspaceFromPostgres`, które inicjuje użytkowników i tenanty z demo seedów ([hydrator](../../apps/api/src/runtime/postgres-company-hydrator.ts#L1187)).

Użytkownik może należeć do wielu organizacji; tenant jest organizacją/granicą izolacji, `legal_entity` firmą wewnątrz niej. Administracja organizacją nie oznacza automatycznego dostępu księgowego: jawne granty, oddzielny operator platformy, bez impersonacji. Pierwszy właściciel: audytowane, jednorazowe polecenie administracyjne wiążące zweryfikowane konto IdP z tenantem, bez publicznego „pierwszy wygrywa”. Zaproszenia: jednorazowe hashowane tokeny z TTL, tenantem i ograniczonym zakresem, akceptowane dopiero po uwierzytelnieniu; brak eskalacji ponad delegację zapraszającego.

**Najkrótsza droga dla właściciela:** #83 → wyłączenie person/token-mintingu → test routingu i autoryzacji → osobno zatwierdzone #78. Pozostaje jedno logowanie aplikacyjne. Odrzucono wspólne hasło i samo ukrycie selektora person.

Rozdzielić `STAGING_PRIVATE`, `PUBLIC_DEMO`, `PRODUCTION` niezależnie od NODE_ENV. Publiczne demo jest opcjonalne: oddzielna baza/credentials i issuer/audience, syntetyczny tenant per odwiedzający, TTL/reset, limity i serwerowo ograniczone scopes; bez dostępu do stagingu i realnych integracji. Obecny wspólny sandbox nie staje się takim demo przez zmianę etykiety. Ryzyko: migracja sesji wymusi ponowne logowanie.

### C — Semantyka księgowa

**Decyzja:** oddzielić wynik kalkulacji, zatwierdzone zobowiązanie z terminem i podstawą, płatność oraz jej alokację. Powstanie i wymagalność zobowiązania wynikają z reguły i faktów, nie kliknięcia zatwierdzenia. Płatność ma kwotę, walutę, datę, referencję dowodu i autora/weryfikatora; dopuszcza częściowe zapłaty, nadpłaty, zwroty i korekty alokacji. Ręczne potwierdzenie jest możliwe z dowodem i audytem. Status „zapłacone” jest pochodny.

Obecne `updateObligationStatus` zapisuje jedynie bieżący timestamp w mapie; nie wystarcza jako źródło danych o wpłatach. Domena wybiera kwalifikowane kwoty i reguły; application zbiera udokumentowane fakty i autoryzuje zatwierdzenie; persistence zapewnia atomowość, powiązania i historię. Symulacja jawnie oddziela założenia od rzeczywistych wpłat.

Nie odejmować naliczonych składek jako zapłaconych w PIT/ryczałcie. Nie zmieniać mechanicznie wzorów wcześniejszych zaliczek: ekspert ma określić osobno zobowiązania należne, podstawę obliczenia zaliczki i saldo zaległości. Do walidacji na źródłach MF/ISAP/ZUS: moment i kwalifikacja odliczeń, uniknięcie podwójnego kosztu/odliczenia, wpłaty między okresami oraz semantyka wcześniejszych zaliczek.

CIT: `calculateCitAdvance` już zawiera część kontroli limitów, więc ich całkowity brak byłby **overstated**. Wywołania application pomijają dane kwalifikacyjne oraz wcześniejsze zaliczki (domyślne zero), a `generateProfitAndLoss` agreguje źródła przychodów ([domena](../../packages/domain/src/full-ledger/index.ts#L722)). Ekspert rozstrzyga kwalifikację preferencji, rozdział źródeł i niestandardowy rok podatkowy; do tego czasu niekompletne przypadki są unsupported/symulacją, nie ostatecznym CIT.

Zachować `resolveRuleAtDate` i `LegalExplanation`. Utrwalać niezmienny snapshot wejść, wersji profilu, reguł/parametrów, wersji kalkulatora, wyniku i zatwierdzenia. Aktualizacja reguł nie zmienia historii; korekta tworzy powiązaną rewizję. Odrzucono prosty boolean paid i przeliczanie historycznego wyniku według bieżących ustawień.

### D — Skala i import

**Decyzja:** bez mikroserwisów, Redis, Kubernetes i event sourcingu. Tysiące użytkowników są wiarygodnym kierunkiem, nie potwierdzoną przepustowością.

`captureWorkspaceRamSnapshot` klonuje cały store przy mutacji, `hydrateSingleCompanyFromScope` ładuje całe rejestry, a `listAccountingDocuments` nie ma limitu ([DB](../../packages/db/src/accounting-scope.ts#L718)). Usunąć te koszty z runtime; wprowadzić filtry okresu, projekcje SQL i paginację kursorem z jednoznacznym sortowaniem. Indeksy tenant/firma/okres już istnieją; dodawać kolejne według planów zapytań, nie hurtowo. Pula ma domyślnie pięć połączeń na instancję (`connectDatabase`); budżet liczyć łącznie dla API, sesji i workerów.

Duże importy: pg-boss z ADR-002, transakcyjne zlecenie/outbox, deduplikacja, ograniczone porcje, limity czasu/pamięci i retry. Worker ponownie autoryzuje zakres; import nadal tworzy propozycje, nie sam zatwierdza księgowania. S3 dla źródeł według istniejącego ADR, bez nowego systemu rozproszonego.

KSeF: oddzielić bezpieczny XML, walidację przypiętym oficjalnym XSD i mapowanie wspieranego podzbioru. Nieznana wersja/nieobsługiwane mapowanie blokują księgowanie; zgodność XSD nie dowodzi poprawnej kwalifikacji podatkowej. Pełna integracja urzędowa pozostaje poza zakresem.

## C. Gemini Implementation Waves

### Fala 1 — Trwałość i atomowość (#79, #80)

- **Zakres:** `accounting-workspace.ts`, application UoW/porty, `packages/db/src/accounting-scope.ts`, `transaction-primitives.ts`, adaptery runtime PG, schemat i nowa migracja provisioningu.
- **Wykonanie:** najpierw krótki ADR kontraktu transakcji/receipt; pionowy przepływ dokument→zatwierdzenie→KPiR/VAT, następnie pozostałe aktywne komendy, ustawienia, rozrachunki, zobowiązania i MCP. Wycofać wspólny RAM oraz fallback migratora. Nie przepisywać kalkulatorów.
- **Niezmienniki:** autoryzacja pod blokadami, RLS/audyt, jeden efekt na klucz, brak częściowego provisioningu.
- **Testy rozstrzygające:** A/B najpierw ładują tę samą firmę, potem naprzemiennie zapisują/czytają REST/MCP; restart obu; wstrzymany zapis i rollback niewidoczny czytelnikom; awaria audytu; 20 równoległych tworzeń tego samego NIP; ten sam klucz/inny payload; utrata potwierdzenia COMMIT i ponowienie; równoczesne zatwierdzenie dokumentu/zamknięcie okresu; cofnięcie grantu i ponowne użycie połączenia dla innego tenanta.
- **Zależności/równoległość:** provisioning i repozytoria mogą mieć osobnych autorów po uzgodnieniu UoW. Osobny reviewer bezpieczeństwa i transakcji.
- **Koniec:** wszystkie aktywne ścieżki PG korzystają z nowej granicy albo są jawnie zablokowane; dowody integracyjne na końcowym SHA.

### Fala 2 — Konta i pojedyncze logowanie (#83 → #78)

- **Zakres:** Web `session.ts`, `synthetic-workspace.ts`, trasy login/callback/logout; API auth i runtime; identity/access, magazyn sesji i zaproszeń.
- **Wykonanie/inwarianty:** wdrożyć decyzję B; konto IdP nie nadaje samo grantów; brak produkcyjnego fallbacku RAM/person i credentials migratora.
- **Testy:** dwóch rzeczywistych użytkowników testowego IdP, bootstrap tylko raz, zaproszenie wygasłe/powtórzone/obcej osoby, MFA, grant/revoke, CSRF, zły issuer/audience, dwa Web workery i restart, konkurencyjny refresh, logout, awaria IdP/PG; wszystkie aliasy sandbox token API niedostępne publicznie.
- **Zależności/równoległość:** OIDC/BFF można przygotować równolegle z falą 1; onboarding integruje jej provisioning. Niezależny security review.
- **Koniec:** pojedyncze logowanie działa w izolowanej kopii; #78 ma przetestowany plan routingu i rollbacku. Zmiana Nginx pozostaje osobną operacją właściciela.

### Fala 3 — Płatności i odtwarzalne wyliczenia (#81)

- **Zakres:** application kalkulacje/obligations, contracts, domain KPiR/ryczałt/CIT/legal-rules, DB płatności/alokacji/snapshotów.
- **Wykonanie:** rozdzielić modele według decyzji C; historyczne flagi paid oznaczyć jako niezweryfikowane, nie dorabiać dowodów. Zachować korekty i zamknięcia.
- **Testy:** naliczone, lecz niezapłacone składki; częściowa/spóźniona wpłata, duplikat dowodu, zwrot, korekta; brak odliczenia podwójnego; odtworzenie historycznego wyniku po zmianie reguł; niepełne dane CIT blokują wynik ostateczny.
- **Zależności/równoległość:** model i konsultacja eksperta równolegle z falą 2; integracja po fali 1.
- **Koniec:** referencyjne przypadki ze źródłami, datami i podpisem eksperta oraz niezależny review finansowy. Nieodebrane profile pozostają wyłączone dla rzeczywistych rozliczeń.

### Fala 4 — Import, pojemność i odzyskiwanie (#82, walidacja #79)

- **Zakres:** parser, kontrakt wyniku importu, worker/outbox, zapytania repozytoriów, konfiguracja pul i procedury odtwarzania.
- **Testy:** malformed XML, namespace/wersja, XSD-valid lecz nieobsługiwane mapowanie; restart workera między porcjami; powtórzony job bez duplikatu; odwołany grant; odtworzenie backupu i uzgodnienie receipt/audytu.
- **Najmniejszy benchmark:** dwa API, 100 syntetycznych tenantów, po 1000 dokumentów plus jedna firma 100 000; 20 klientów przez 10 minut, 80% odczytów/20% zapisów. Osobno ruch rozproszony i jedna gorąca firma, następnie import 10 000 pozycji. Mierzyć p95/p99, RSS, liczbę zapytań, lock/pool wait, błędy i zgodność wyników; zbadać plany najdroższych zapytań.
- **Zależności/równoległość:** parser niezależnie od fal 2–3; pomiary po fali 1, odbiór po integracji. Limitowane, zatwierdzone zasoby Hetznera; brak zasobów oznacza NOT RUN.
- **Koniec:** zaakceptowany budżet opóźnień/zasobów, ograniczone zużycie pamięci i udany restore. Wynik warunkuje dalsze zmniejszanie zakresu blokad/pooling, nie automatyczne dodawanie infrastruktury.

## D. Release Gates

| Bramka | GO / warunek zatrzymania |
| --- | --- |
| Prywatny staging syntetyczny | Dostęp ograniczony, integracje realne wyłączone. Przed falą 1 tylko kontrolowane demo bez gwarancji spójności; nie jest odbiorem wieloinstancyjności. Nowy runtime wymaga odpowiednich testów integracyjnych i niezależnego review. Basic Auth pozostaje do odbioru fali 2 i osobnej zgody. |
| Zamknięta beta | Fale 1–3 odebrane w udostępnionym zakresie, walidacja importów albo ich wyłączenie, dwa API, izolacja/revocation, testy awarii, backup/restore i limity. Bez pełnej bramki danych rzeczywistych beta używa wyłącznie danych syntetycznych. |
| Rzeczywiste dane księgowe / produkcja | Dodatkowo pełna regresja/integracja/E2E na końcowym SHA, niezależny odbiór architektury/security, ekspert dla każdego aktywnego profilu, zaakceptowane SLO/RPO/RTO, off-host backup i restore drill, monitoring, retencja/ochrona danych oraz osobna zgoda właściciela. Integracje urzędowe mają odrębny odbiór. |

Każdy wyciek tenantowy, błędny audyt, niekontrolowany sandbox, niewyjaśniony duplikat/utrata zapisu lub niepoprawne wejście podatkowe oznacza NO-GO dla zależnego zakresu. Unit tests nie zastępują tych bramek. Wewnętrzny merge podlega polityce proporcjonalnej i nie stanowi zgody na release.

## E. Gemini Starter Prompt

> Pracuj według tego dokumentu i aktualnego AGENTS.md. Zweryfikuj main, istniejące issues #78–83 i aktywne PR-y; nie zakładaj aktualności dawnych GO. Zacznij od fali 1 i jej ADR. Zachowaj modularny monolit, domenę, OIDC, tenant isolation, FORCE RLS i audyt. Podziel falę na wąskie Draft PR-y z istniejącymi issues; używaj osobnych gałęzi. Deleguj implementację i celowane testy tańszym agentom, a odbiór architektury/security niezależnemu agentowi, który nie jest autorem zmian. Równoleglij tylko wskazane granice po uzgodnieniu kontraktów. Nie uruchamiaj GitHub Actions. Testy CI wykonuj na izolowanym Hetznerze z limitami, timeoutem i sprzątaniem; bez dotykania istniejących usług/danych. Dla DB i API użyj odpowiednio `pnpm --filter @pap/db test:integration` i `pnpm --filter @pap/api test:integration`, z selekcją właściwych testów; same root `test:integration` nie obejmuje API. W PR zapisz dokładny SHA, środowisko, komendy, PASS/FAIL/NOT RUN, ograniczenia, zależności i następny krok. Nie scalaj ani nie wdrażaj bez odrębnego upoważnienia; migracje istniejących środowisk i Nginx wymagają zgody właściciela. Nie zastępuj brakujących dowodów deklaracją gotowości.

**Handoff Astra:** wyłącznie przegląd statyczny i ten dokument. Build, testy, benchmarki, przeglądarka, SSH, migracje i deploy: **NOT RUN**, zgodnie z zakresem zadania. Nie zmieniono kodu aplikacji. Następny krok: Gemini przygotowuje kontrakt transakcji i pierwszy PR fali 1; niniejszy dokument nie zamyka issues ani nie daje zgody operacyjnej.
