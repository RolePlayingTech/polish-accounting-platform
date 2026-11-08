# ADR-010 — Granica transakcji, wycofanie współdzielonego cache'u RAM i idempotencja komend (Fala 1)

Data: 2026-11-08. Status: zaakceptowany do implementacji przyrostowej Fali 1.
Powiązania: Issue #79, Issue #80, Issue #85, PR #84 (przegląd architektoniczny Astry), ADR-001, ADR-002, ADR-007, ADR-008, ADR-009.

## Kontekst i problem

Przegląd architektoniczny Fali 1 (PR #84) oraz zestaw testów kontrprzykładów (`apps/api/test/adversarial/wave1-consistency-and-provisioning.adversarial.ts`) potwierdziły dwa krytyczne defekty spójności w adapterze `PostgresBackedWorkspaceStore`:

1. **Rozdwojenie stanu (split-brain) między instancjami API oraz widoczność stanu sprzed `COMMIT` (#79):**
   - `PostgresBackedWorkspaceStore` utrzymywał w procesie współdzielony obiekt `innerWorkspace: InMemoryAccountingWorkspaceStore` oraz zbiór `loadedCompanyIds`.
   - Po pierwszym załadowaniu firmy `F` przez Instancję B kolejne odczyty na Instancji B pomijały PostgreSQL (`if (this.loadedCompanyIds.has(companyId)) return;`) i zwracały nieaktualny stan z pamięci RAM, ignorując dokumenty i zapisy księgowe zatwierdzone w międzyczasie przez Instancję A (`ADV-79-01`).
   - Mutacje modyfikowały współdzielony stan RAM przed wykonaniem zapisów SQL i przed `COMMIT`, co przy współbieżnych żądaniach na tej samej instancji groziło odczytem niezatwierdzonego stanu (dirty read w RAM) oraz wyścigami przy odtwarzaniu snapshotu po `ROLLBACK`.
2. **Brak atomowości i brak bazodanowej unikalności NIP przy tworzeniu firmy (#80):**
   - Tworzenie firmy (`createCompany`) składało się z kilku rozdzielnych transakcji (`createEntityWithInitialProfile`, nadanie grantów `grantCompanyAccess`, a następnie osobny zapis `company_tax_settings` i kont księgowych). Awaria w połowie procesu pozostawiała częściowo utworzoną firmę (sierotę `legal_entity` bez `company_tax_settings`).
   - Unikalność NIP w obrębie tenanta była sprawdzana wyłącznie w pamięci RAM pojedynczej instancji, bez ograniczenia `UNIQUE (tenant_id, nip)` w PostgreSQL, przez co równoczesne żądania tworzyły duplikaty firm o tym samym NIP (`ADV-80-01`).
   - W ścieżce runtime występował ponadto niedopuszczalny fallback do uprzywilejowanego `PAP_MIGRATOR_DATABASE_URL`.

## Decyzja

### 1. Granica transakcji i Unit of Work (`PostgresTransactionalUnitOfWork`)

1. Każda operacja firmowa (`read` lub `write`) w aktywnym trybie PostgreSQL wykonuje się wyłącznie wewnątrz pojedynczej transakcji bazy danych zarządzanej przez `PostgresTransactionalUnitOfWork.executeCompanyOperation` (lub `executeTenantAdminOperation` dla operacji administracyjnych tenanta).
2. Wewnątrz transakcji kolejno następują:
   - zablokowanie i weryfikacja faktów autoryzacyjnych w PostgreSQL (`lockCompanyActionFactsInTx` / `lockTenantAdminFactsInTx`),
   - ocena czystej reguły autoryzacyjnej (`evaluateCompanyAction` / `evaluateTenantAdminAction`),
   - osadzenie podpisanego kontekstu sesji `SET LOCAL pap.context` z fazą `company` (lub `access`) na czas operacji,
   - sprawdzenie trwałego potwierdzenia idempotencji (`command_receipt`) dla mutacji,
   - odczyt aktualnego stanu agregatu z PostgreSQL, wykonanie czystych kalkulatorów domenowych (`@pap/domain`) na transakcyjnym stanie lokalnym oraz zapis zmienionych wierszy SQL,
   - zapis trwałego potwierdzenia idempotencji (`command_receipt`) i atomowego zdarzenia audytowego `security_decision_event` (`decision = 'allow'`, `outcome = 'committed'`) pod fazą podpisu `audit`,
   - weryfikacja odroczonych triggerów spójności (`DEFERRABLE INITIALLY DEFERRED`) podczas `COMMIT`.

### 2. PostgreSQL jako jedyne autorytatywne źródło prawdy i bezpieczne wycofanie cache'u RAM z aktywnych ścieżek PG

1. Gdy skonfigurowano `DATABASE_URL`, **PostgreSQL 18 pod `FORCE RLS` i rolą runtime (`NOSUPERUSER`, `NOBYPASSRLS`) jest jedynym autorytatywnym źródłem stanu trwałego**.
2. Współdzielony pomiędzy żądaniami bufor `innerWorkspace` oraz `loadedCompanyIds` zostają **wycofane z aktywnych ścieżek PostgreSQL**:
   - **Ścieżki odczytu (`action = 'read'`):** Zawsze pobierają aktualne wiersze bezpośrednio z PostgreSQL wewnątrz transakcji `read` (z blokadą `FOR SHARE` na `legal_entity`) i wyliczają widoki pochodne (np. podsumowania KPiR, rejestry VAT, zestawienia obrotów i sald, kalendarz podatkowy) za pomocą czystych funkcji `@pap/domain` na świeżo odczytanych danych. Żaden odczyt w trybie PG nie korzysta z pamięci RAM poprzedniego żądania.
   - **Ścieżki zapisu (`action = 'write'`):** Wewnątrz transakcji `write` (po założeniu blokady `FOR UPDATE` na wierszu `legal_entity`) ładują aktualny stan firmy z PostgreSQL do **efemerycznego, prywatnego dla tej transakcji egzemplarza roboczego**, wykonują deterministyczną logikę domenową (`@pap/domain` / `@pap/application`), zapisują wynikowe wiersze SQL w tej samej transakcji i po zakończeniu transakcji porzucają egzemplarz roboczy.
   - Dzięki temu żaden niezatwierdzony stan (`uncommitted state`) nie jest nigdy widoczny dla równoległych żądań na tej samej ani na innej instancji API.
3. `InMemoryAccountingWorkspaceStore` pozostaje wyłącznie jawnym adapterem lokalnym/testowym używanym wtedy, gdy `DATABASE_URL` nie jest ustawiony.

### 3. Kolejność blokad (`Lock Ordering`) i autoryzacja

Aby wyeliminować zakleszczenia (`deadlocks`), utracone aktualizacje (`lost updates`) oraz eskalację blokad `FOR SHARE -> FOR UPDATE` w ramach tej samej transakcji, ustala się bezwzględną kolejność blokowania wierszy:

1. `app_user` — `FOR SHARE`
2. `user_oidc_identity` — `FOR SHARE`
3. `tenant_membership` — `FOR SHARE`
4. `legal_entity`:
   - dla `action = 'write'`: **`FOR UPDATE`** pobierane natychmiast przy pierwszym odczycie w `lockCompanyActionFactsInTx` (serializuje wszystkie współbieżne mutacje księgowe i konfiguracyjne w obrębie danej firmy `legal_entity_id`),
   - dla `action = 'read'`: **`FOR SHARE`** (zapobiega usunięciu/dezaktywacji firmy w trakcie odczytu, pozwalając na równoległe odczyty),
   - zakazuje się rozpoczynania mutacji od `FOR SHARE` i późniejszego podnoszenia blokady do `FOR UPDATE`.
5. `company_access_grant` — `FOR SHARE` (w kolejności `ORDER BY id ASC`)
6. Tabele domenowe firmy (`company_tax_settings`, `accounting_document`, `kpir_entry`, `ryczalt_entry`, `vat_register_entry`, `journal_entry`, `journal_line`, `settlement_item`, `bank_statement_import`, `bank_transaction`, `tax_obligation_item`, `mcp_prepared_proposal`) — zawsze po uprzednim zablokowaniu wiersza nadrzędnego `legal_entity`.

Cofnięcie członkostwa w tenancie lub grantu dostępu do firmy jest widoczne natychmiast dla każdej kolejnej transakcji na dowolnej instancji API lub połączeniu z puli.

### 4. Idempotencja komend i trwałe potwierdzenia (`Durable Command Receipts`)

1. Każda komenda mutująca w trybie PostgreSQL może przekazać deterministyczny identyfikator operacji (`operation_id` / nagłówek `Idempotency-Key`) powiązany z kluczem:
   - `(tenant_id, legal_entity_id, actor_user_id, action_kind, operation_id)` dla komend firmowych,
   - `(tenant_id, actor_user_id, action_kind, operation_id)` dla komend administracyjnych na poziomie tenanta (np. `create_company`).
2. Wraz z potwierdzeniem zapisywany jest kanoniczny skrót SHA-256 wejściowego ładunku (`payload_sha256`), bieżący `transaction_id = pg_current_xact_id()` oraz zserializowany wynik operacji (`response_json`).
3. Zasady obsługi powtórzonego klucza idempotencji:
   - **Najpierw autoryzacja:** Przed odczytem potwierdzenia wykonywana jest pełna transakcyjna weryfikacja uprawnień aktora (`lockCompanyActionFactsInTx` / `lockTenantAdminFactsInTx`). Jeżeli uprawnienia zostały w międzyczasie cofnięte, żądanie kończy się odmową `403 Forbidden` (historyczny receipt nigdy nie omija bieżącej autoryzacji).
   - **Niezgodny ładunek (`payload_sha256` różny od zapisanego):** Transakcja przerywa wykonanie i zwraca `409 Conflict` (`idempotency_payload_mismatch`) bez wykonywania jakichkolwiek zmian w danych.
   - **Zgodny ładunek (`payload_sha256` identyczny):** Komenda nie wykonuje ponownie operacji biznesowych DML (brak podwójnego księgowania), zapisuje nowe zdarzenie audytowe `security_decision_event` (`allow/committed`) dla bieżącej transakcji odtworzenia i zwraca zapisany deterministyczny wynik.

### 5. Semantyka `COMMIT`, `ROLLBACK` oraz `transaction_outcome_unknown`

Zgodnie z ADR-009 (`SEC-03`):

1. **Potwierdzony `COMMIT`:** Efekt biznesowy, `command_receipt` oraz `security_decision_event` (`allow/committed`) stają się trwale widoczne jednocześnie dla wszystkich instancji API.
2. **Potwierdzony `ROLLBACK`:** Jeżeli przed wysłaniem `COMMIT` wystąpi błąd domenowy, błąd ograniczenia SQL (np. `23505`, `23514`, `40001`) lub awaria zapisu audytu i `ROLLBACK` zostanie potwierdzony (bądź serwer PostgreSQL jawnie odrzuci `COMMIT` komunikatem `ErrorResponse` z `severity = 'ERROR'`), żadna zmiana nie zostaje utrwalona w bazie, a efemeryczny stan transakcyjny w pamięci zostaje odrzucony. Po zwolnieniu blokad zapisywany jest w osobnej krótkiej transakcji ślad `allow/rolled_back` (lub `deny/rejected` dla odmowy autoryzacji).
3. **Niepewny wynik zakończenia transakcji (`transaction_outcome_unknown`):** Jeżeli po wysłaniu `COMMIT` połączenie zostanie zerwane przed odebraniem potwierdzenia (`08007`, `40003`, `57P01`, błąd gniazda TCP, `FATAL`/`PANIC`), adapter **nigdy** nie oznacza transakcji jako `rolled_back` i **nigdy** nie ponawia automatycznie callbacku biznesowego w tle. Podejmuje próbę best-effort zapisu `allow/outcome_unknown` i zwraca fail-closed `transaction_outcome_unknown` (`HTTP 503`). Klient może bezpiecznie ponowić żądanie z tym samym `operation_id` / `Idempotency-Key`.

### 6. Atomowy provisioning firmy i bazodanowa unikalność NIP (#80)

1. Utworzenie firmy (`createCompany`) odbywa się w **jednej atomowej transakcji PostgreSQL** wykonywanej wyłącznie na roli runtime (`NOSUPERUSER`, `NOBYPASSRLS`) bez jakiegokolwiek fallbacku do `PAP_MIGRATOR_DATABASE_URL`.
2. Pojedyncza transakcja atomowo tworzy:
   - wiersz `legal_entity` oraz początkowy `entity_profile_version`,
   - początkowe uprawnienia `company_access_grant` (dla właściciela/administratora oraz wskazanych księgowych w tenancie),
   - wiersz `company_tax_settings`,
   - domyślny plan kont `ledger_account` (dla pełnej księgowości UoR) oraz `notification_preference`,
   - trwały receipt operacji oraz wpis `security_decision_event` (`allow/committed`).
     Dowolny błąd na którymkolwiek etapie wycofuje całą transakcję (zero sierot w `legal_entity`).
3. Unikalność numeru NIP w obrębie tenanta jest wymuszana przez bazę danych PostgreSQL za pomocą ograniczenia unikalności na kanonicznej, 10-cyfrowej postaci `(tenant_id, nip)` (poprzedzonego kontrolą braku duplikatów w migracji addytywnej). Równoczesne żądania utworzenia firmy o tym samym NIP kończą się deterministycznie dokładnie jednym sukcesem (`201 Created`) oraz odpowiedziami `409 Conflict` dla pozostałych wywołań.

## Sekwencja wdrożenia w Fali 1

1. **Krok 1 (niniejszy ADR-010):** Zatwierdzenie granic transakcyjnych, kolejności blokad i kontraktu idempotencji.
2. **Krok 2 (Pierwszy pionowy przekrój #79):** Blokada `FOR UPDATE` na `legal_entity` dla `write`, trwałe `command_receipt` dla operacji księgowych oraz pełne przejście na autorytatywny odczyt/zapis PostgreSQL (bez współdzielonego cache'u RAM) dla ścieżki:
   `utworzenie/import dokumentu -> zatwierdzenie i zaksięgowanie -> zapis KPiR/VAT/Księgi -> COMMIT -> natychmiastowy odczyt przez drugą instancję API` (zamknięcie `ADV-79-01`).
3. **Krok 3 (Pozostałe aktywne operacje firmowe #79):** Wycofanie współdzielonego cache'u RAM z ustawień podatkowych firmy, rozrachunków i importu bankowego, zobowiązań podatkowych oraz propozycji/zatwierdzeń MCP.
4. **Krok 4 (Atomowy provisioning firmy i unikalność NIP w DB #80):** Addytywna migracja SQL wymuszająca unikalność `(tenant_id, nip)` oraz atomową procedurę provisioningu w jednej transakcji bez fallbacku do migratora (zamknięcie `ADV-80-01`).
