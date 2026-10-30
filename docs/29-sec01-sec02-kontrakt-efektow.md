# SEC-01/SEC-02 — kontrakt autoryzacji, efektów i audytu

Data: 2026-10-29. Issue #6, baza PR #31 `bd0c56047dd9a86243c12a1a7e917429c487015f`.
Aktualny kontrakt integracji/migracji i status SEC-01–05: [docs/30](30-security-foundation-integracja.md).
Status: implementacja kandydacka, **Draft / NO-GO**. Wszystkie testy i narzędzia
walidacyjne tej zmiany: **NOT RUN**, zgodnie z instrukcją właściciela. Scenariusze
poniżej ma zaimplementować i wykonać odrębny agent QA na izolowanym Hetznerze.

## Przyczyna i decyzja

Dotychczasowy HMAC uwierzytelniał polecenie i wpis audytu, ale trigger COMMIT
wiązał je tylko z tenantem/aktorem/celem w transakcji. Nie dowodził zgodności
konkretnego efektu. `operation_id` bez kontroli wyniku także nie wystarcza:
historyczny receipt z `changed=false` mógł pokryć nowy INSERT, a retry cofnięcia
pozwalało przesunąć `revoked_at` w przeszłość.

Wybieramy kontrolowany executor SQL `pap_execute_access()` bez argumentów.
TypeScript nadal jest jedynym właścicielem polityki delegacji: weryfikuje OIDC,
blokuje fakty w kanonicznym porządku, podejmuje decyzję domenową i podpisuje
dokładną komendę oraz `decision_at`. Executor sprawdza podpis/fazę/zakres,
wykonuje wyłącznie cztery istniejące komendy lifecycle, a następnie sam tworzy
receipt i zapis rzeczywistych przejść. Nie implementuje nowych reguł przyznawania
uprawnień ani osobnej polityki administracyjnej. Kod mutacji przeniesiono z TS
do SQL; nie utrzymujemy dwóch implementacji wykonania.

## Inwarianty i granica zaufania

1. Runtime może blokować wiersze, ale nie może modyfikować ich danych: ma UPDATE
   tylko na technicznej kolumnie klucza dla SELECT FOR SHARE/UPDATE; RLS ma
   `WITH CHECK (false)`. Invoker guard odrzuca DML z `current_user` innym niż
   właściciel tabeli. Brak INSERT grantów/receipt, także przy starych asercjach
   `access_event`. Runtime nie ma członkostwa w roli właściciela ani możliwości
   wyłączenia triggerów. Factory odmawia przy zastanych niebezpiecznych ACL.
2. Executor ma stały `search_path` (`pg_catalog`, schemat danych, `pg_temp`),
   odwołany EXECUTE z PUBLIC, brak dynamicznego SQL i brak argumentów mutacji.
   Jedynie ten executor dostaje jawny EXECUTE runtime. Komendę bierze z poprawnej
   asercji `access` związanej z xid8/backendem/rolą/bazą/TTL. Nie ujawnia klucza.
3. Każdy nowy receipt ma rzeczywisty `transaction_id` i
   `state_change.effects = {klucz_wiersza: {table, operation, old, new}, ...}`. Stany pochodzą
   z zablokowanego wiersza i `RETURNING` rzeczywistego DML, obejmują wszystkie
   kolumny, klucze, identyfikator grantu, okres i cofnięcie. Nie są wejściem
   callbacku, klienta ani podpisywaną kopią deklarowanego wyniku TS.
4. Deferred trigger każdej mutacji wymaga **dokładnie jednego** odpowiadającego
   OLD/NEW w receipt z tej samej rzeczywistej TX oraz audytu `allow/committed`
   z tym samym `operation_id`, FK receipt, `action=kind`, aktorem, tenantem,
   celem i `decided_at=occurred_at`. Bieżące GUC nie są dowodem na COMMIT.
5. Nowy receipt, także bez efektów, sam wymaga atomowego audytu. Kontrola w
   przeciwnym kierunku wiąże każdy committed access event z właściwym receipt
   i firmą wynikającą z komendy/grantu. Brak INSERT audytu, niezgodność lub błąd
   constrainta uniemożliwia COMMIT. Audyt nie powstaje automatycznie w executorze:
   zaufany writer TS nadal osobno podpisuje jego dokładne metadane.
6. Cofnięcie ma dokładnie `LEAST(OLD.revoked_at, decision_at)` (PostgreSQL pomija
   NULL w LEAST): wcześniejsze cofnięcie jest zachowane, pozostałe przypada na
   chwilę decyzji. Nie wykonujemy UPDATE dla niezmienionego cofnięcia.
   Kaskada używa tej samej chwili; executor najpierw cofa wszystkie potrzebne
   granty w porządku grant_id, potem zmienia członkostwo. Trigger kaskady nie
   dopisuje kolejnych efektów, bo wszystkie pasujące granty są już cofnięte.
7. Deduplikacja grantu tworzy nowy receipt `changed=false, grantId=G0, effects={}`.
   Nie powstaje G1 z komendy. Ponowne wywołanie executora dla istniejącej operacji
   porównuje aktora, tenant, cel i semantyczny JSON całej komendy, po czym zwraca
   receipt **przed jakimkolwiek DML**. Konflikt operacji odmawia. Historyczny
   receipt może być celem świeżej decyzji retry, ale nie jest dowodem nowej mutacji.
8. Dla jedynego obecnego zapisu firmowego (`company_operation_probe`) wejście
   transakcyjne write wymaga UUID operacji. Ten sam identyfikator oraz czas DB
   trafiają do kontekstu callbacku, asercji company i repozytorium. RLS porównuje
   `operation_id` i dokładny `created_at=decision_at`; deferred trigger wymaga
   zgodnego audytu. Callback A nie może utworzyć B. Retry A odczytuje istniejący
   rekord bez efektu, ale podlega ponownej autoryzacji i świeżemu audytowi.

Format OLD/NEW jest niezależny od ustawień sesji runtime: executor i weryfikator
mają UTC i ISO DateStyle. Lista efektów nie zawiera OIDC ani danych dokumentów;
zawiera wewnętrzne identyfikatory i stany uprawnień. Runtime nadal nie odczytuje
globalnego security audit; odczyt receipt jest ograniczony do podpisanej komendy.

Administrator/migrator i proces z kluczem HMAC pozostają granicą zaufania.
Integracja wzmacnia stan aktora/scope UoW (SEC-04) i ogranicza helpery (SEC-05);
pozostałe bramki i brak odbioru są opisane w docs/30.
H2 (savepointy/utrata blokad) pozostaje obowiązkowym scenariuszem audytu całego
UoW: executor bierze blokadę celu, ale decyzja delegacji opiera się na blokadach
i polityce wspólnego core. Nie traktować tej zmiany jako odbioru całego 6D-3.

## Kontrakty aplikacyjne i migracje

- `AuthenticatedCompanyActionInput.operationId` pozostaje opcjonalny dla read
  i preflight, ale transakcyjny write bez poprawnego UUID odmawia przed callbackiem.
  Kontekst transakcyjny zawiera `operationId` i `decisionAt`. Repozytorium probe
  sprawdza zgodność argumentu z kontekstem; SQL niezależnie wymusza te same pola.
- Helper HTTP przyjmuje opcjonalny szósty argument `{ operationId }` po callbacku.
  Wywołujący serwerowy use case dostarcza stabilny identyfikator przy jawnym retry;
  nie ma domyślnego losowania ID ani utożsamienia go z request_id. Brak nowego
  endpointu i brak zmian w AppModule. Istniejące wywołania write wymagają aktualizacji.
- `PostgresAccessManagementStore` zachowuje port, typy komend, wynik/receipt,
  politykę domenową i blokady; zastępuje własny DML pojedynczym SELECT executora.
  Produkcyjna ścieżka wymaga signera. Dawne testy adaptera używające właściciela
  bez signera muszą zostać dostosowane do rzeczywistego protokołu przez QA.
- Integracja zachowuje 0000–0005 i snapshoty z #31. Cały SQL naprawczy jest
  addytywną 0006 z osobnym snapshotem/journal. Historyczne receipt zachowują
  transaction_id NULL i niezmienioną treść; nowe mają xid i mapę efektów.
  CHECK NOT VALID chroni nowe INSERT-y bez przepisywania dawnego audytu.
  Cold install oraz upgrade oryginalnej 0005 wymagają QA; bazy ze zmienionymi
  migracjami gałęzi naprawczych wymagają osobnej oceny operatora. Szczegóły docs/30.
- Po cold install / upgrade wymagane jest jawne uruchomienie nowego provisioning ACL
  przed użyciem factory. Stara aplikacja + nowe ACL/SQL odmawia; nowa aplikacja +
  stare SQL także nie działa. Zmiana wymaga wspólnej wersji application/DB/ACL,
  bez wyłączania RLS lub guardów jako mechanizmu rollbacku. Brak automatycznego deployu.

## Odrzucone alternatywy

- Samo `operation_id` lub dodatkowe porównanie kind/grant: nie rozwiązuje różnicy
  pomiędzy zatwierdzonym poleceniem, deduplikacją i rzeczywistym rezultatem retry.
- Podpisywanie przez TS listy efektów po dowolnym callbacku: ryzyko zatwierdzenia
  skutków SQL injection jako oczekiwanych i konieczność kompletnego przechwytywania DML.
- Podpisany manifest wszystkich oczekiwanych grantów przed wykonaniem: możliwy,
  ale wymaga nowego protokołu planowania/rezerwacji efektów, hashowania i ich
  jednokrotnego zużycia; duże kaskady nie mieszczą się w małej asercji HMAC.
- Osobna tabela prywatnych pozwoleń/journal dla dowolnego DML: większy model i
  dodatkowy cykl uprawnień. Przy czterech znanych komendach executor jest mniejszy;
  dodanie nowych typów mutacji wymaga jawnego rozszerzenia kontraktu i review.
- Wyłączenie kaskad, zakaz retry albo usunięcie HMAC/RLS: łamie wymagania lifecycle.

## Integracja z SEC-03

Zintegrowano #37 a459aa1, porównano także końcowy #35 6da3326. Zachowano
ConfirmedTransactionRollbackError, TransactionOutcomeUnknownError, HTTP 503,
best-effort outcome_unknown i brak automatycznego callback retry. Wspólny CHECK
jest w 0006. SQLSTATE 40003 jest wykluczony z potwierdzonego rollbacku.
Executor i audyt pozostają w tej samej TX; utrata potwierdzenia ich nie rozdziela.
Opis decyzji klasyfikatora i scenariusze integracyjne: docs/30.

## Scenariusze dla QA — do implementacji i wykonania, wszystkie NOT RUN

Każdy scenariusz sprawdza wynik **i stan po COMMIT/ROLLBACK z konta kontrolnego**.
Wykonać na prawdziwym loginie `pap_test_app`, także przy migratorze
NOSUPERUSER/NOBYPASSRLS, na dokładnym końcowym SHA integracji.

| Przypadek | Wymagany wynik |
| --- | --- |
| SEC-01: callback A próbuje probe A+B przy audycie A | B odrzucone; nieprzechwycony błąd wycofuje całą TX |
| Bezpośredni SQL B pod przechwyconym poprawnym MAC company A | ACL/RLS odmawia, brak B |
| Probe A, audit.operation_id NULL/B lub inny tenant/aktor/firma/czas | COMMIT odmawia, brak efektu |
| write bez ID, z błędnym UUID, mutacja input po await | odmowa przed efektem lub niezmienny kanoniczny ID |
| Poprawna probe A, retry A, konflikt A w innym scope/aktorze | jeden efekt; retry z nową decyzją; konflikt odmawia |
| Poprawny read bez operationId | odczyt i audyt działają, brak prawa INSERT |
| SEC-02: revoke G w TX1, retry w TX2, UPDATE revoked_at do t0−1 dzień | UPDATE odrzucone pod świeżym MAC, t0 bez zmian |
| Grant G1 deduplikowany do G0, potem INSERT G1 pod zachowanym MAC | changed=false, effects={}, tylko G0; G1 nie powstaje |
| Bezpośredni INSERT receipt pod access / access_event / audit | brak uprawnień/polityki INSERT |
| UPDATE klucza grantu/członkostwa pod kolumnowym prawem blokowania | RLS/guard odmawia; SELECT FOR UPDATE/SHARE nadal działa |
| Grant/revoke z innym kind, grantId, OLD/NEW, targetem lub czasem | odrzucenie; żadnego częściowego efektu |
| Nowy grant; równoważny grant; konflikt użytego ID; grant przyszły | poprawne receipt/effects; zero ukrytych kopii; kontrolowany konflikt |
| revoke_grant dla NULL, wcześniejszego, równego i późniejszego revoked_at | min(stare cofnięcie, decyzja); brak UPDATE przy braku zmiany |
| revoke/reactivate z 0/1/wieloma grantami, także przyszłymi | wszystkie potrzebne cofnięcia dokładnie raz, wspólny decision_at |
| Cofnięcie revoked i reaktywacja historycznego członkostwa z dawnymi grantami | brak odnowienia dawnych praw; poprawny changed/effects |
| Nowa operacja no-op i historyczny retry (w tym receipt z transaction_id NULL) | brak DML, świeży audyt, historyczny wynik bez przepisywania |
| Dwa wywołania executora tej samej komendy w jednej TX | receipt i efekty tylko raz; bez ponownej kaskady |
| Nowy receipt bez audytu, audyt obcego receipt/kind/firmy, awaria INSERT audytu | constraint/rollback; brak efektu i receipt |
| Mutacja po audycie, przywrócenie poprawnego MAC tej samej TX | brak nieautoryzowanego DML; wyłącznie ta sama idempotentna komenda |
| Zmiana TimeZone/DateStyle przed COMMIT, grant o czasie równym decision_at | identyczne porównanie chwil i OLD/NEW; brak pozornych cofnięć |
| savepoint → wykonanie → rollback to savepoint → restore MAC/retry | receipt/efekty/odroczone triggery nie rozchodzą się; ponowny audyt wymagany |
| savepoint → utrata blokad → równoległe revoke/disable/zmiana roli → restore MAC | pełna weryfikacja H2/UoW; każdy bypass pozostaje blockerem, bez domniemania PASS |
| Przechwycenie asercji i replay w innej TX/backendzie/roli lub po TTL | odmowa; brak efektu/receipt |
| Wyścigi grant/revoke/reactivate; oba porządki UUID A→B i B→A | serializacja członkostwem, brak deadlocka i odnowienia grantów |
| SEC-03: utrata potwierdzenia skutecznego COMMIT, potem retry tym samym ID | jeden efekt/receipt, committed + outcome_unknown, brak fałszywego rolled_back |
| Błąd przed COMMIT i potwierdzony rollback adaptera | brak efektu/receipt, prawdziwy rolled_back |
| Pula max=1 po odmowie, błędzie SQL i niepewnym zakończeniu | brak wycieku kontekstu/blokad; deny nie blokuje puli |
| Cold install, upgrade 0000–0003 z syntetycznymi danymi, provisioning powtórzony | stare dane zachowane; historyczne tx NULL; poprawne ACL/FORCE RLS |
| Migrator NOSUPERUSER i pgcrypto (H1), ACL wszystkich nowych funkcji | prawidłowa własność/search_path; brak PUBLIC EXECUTE i DDL runtime |
| Kaskady 100/1000 grantów pod limitami/timeoutem Hetznera | zmierzyć koszt map OLD/NEW i odroczonych kontroli; timeout nie może utrwalić części efektów |

Komendy do wykonania przez QA (nie wykonywano ich w tej sesji), po aktualizacji
testów do nowego kontraktu i przygotowaniu zatwierdzonego runnera z ADR-006:

```text
pnpm --filter @pap/application typecheck
pnpm --filter @pap/db typecheck
pnpm --filter @pap/api typecheck
pnpm --filter @pap/application exec vitest run --config ../../vitest.config.ts test/transactional-unit-of-work.test.ts test/access-management.test.ts
pnpm --filter @pap/db exec vitest run --config ../../vitest.config.ts test/access-management.test.ts test/signed-context.test.ts test/security-audit.test.ts test/migration-files.test.ts
pnpm --filter @pap/api exec vitest run --config ../../vitest.config.ts test/oidc-authorization-pipeline.test.ts
pnpm test:integration
```

Osobny etap pełnej regresji/build/E2E/lintu, kontrola typów testów DB/API,
niezależne security review i skan sekretów także mają status **NOT RUN**.
Polecenia/limity/cleanup pełnego odbioru: `6D3_VALIDATION_HANDOFF.md`, ADR-006,
PR #33/#34. Nie uruchamiać Actions ani migracji istniejącego stagingu.

## Ryzyka i warunki przekazania

Brak wykonania SQL/typowania/testów jest blockerem odbioru. QA musi dostosować
historyczne fixture zakładające DML runtime i write bez ID; nie wystarczy uruchomić
starych testów bez nowych kontrprzykładów. Mapa efektów rośnie z liczbą grantów; każdy trigger odnajduje dokładny klucz
wiersza w JSONB zamiast przeglądać pełną listę przejść. Indeks TX ogranicza
odczyt historycznych receipt. Koszt budowy i przechowywania dużych map należy
zmierzyć pod limitami runnera przed zwiększeniem skali.
Nie osłabiać kontroli w celu przyspieszenia testu. Jeden use case odpowiada jednej
autoryzowanej operacji; nie obiecujemy arbitralnych sekwencji wielu poleceń i
powtarzających się identycznych przejść w jednym UoW.

Następne kroki: review integracji → domknięcie pozostałych bramek docs/30 → implementacja
macierzy przez QA → izolowane PG18 i raport SHA/PASS/FAIL/NOT RUN → niezależny
gate GO/NO-GO. Bez tych kroków zachować Draft i NO-MERGE. Brak deployu, merge,
zmian na serwerze, nowych usług, UI, endpointów księgowych i MCP.

Podstawy techniczne: [wykonanie triggerów](https://www.postgresql.org/docs/18/trigger-definition.html),
[SECURITY DEFINER i bezpieczny search_path](https://www.postgresql.org/docs/18/sql-createfunction.html),
[uprawnienia blokowania SELECT](https://www.postgresql.org/docs/18/sql-select.html).
