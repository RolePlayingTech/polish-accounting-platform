# 24. Bezpieczny cykl członkostw i grantów — 6D-R

**Data:** 2026-10-28. **Zakres:** [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), kod do code/security review. Bez UI, nowych endpointów produkcyjnych, konfiguracji produkcyjnej, merge i deploymentu. Obowiązują ADR-002/003/004/005. Issue #6 pozostaje otwarte.

## Decyzja i invariant

Wybieramy **wariant A: transakcyjny lifecycle**, z dodatkowymi guardami SQL. Obecny klucz członkostwa `(tenant_id, user_id)` wystarcza jako wspólny punkt serializacji. Nie zmieniamy kontraktu domenowego ani semantyki czystej polityki. Wariant B wymagałby generacji po obu stronach relacji, migracji istniejących grantów oraz aktualizacji wszystkich źródeł faktów; nie usuwa sam potrzeby autoryzacji, audytu i ograniczenia roli DB.

**Reaktywacja nigdy nie odnawia dawnych grantów.** Cofnięcie członkostwa trwale odwołuje wszystkie granty użytkownika w tym tenancie: każdą firmę, obie akcje, także granty przyszłe. Reaktywacja otwiera nowy okres członkostwa bez praw księgowych. Dostęp wymaga oddzielnej autoryzowanej komendy `grant`, nowego identyfikatora i audytu. Właściciel/administrator tenanta i operator platformy nie otrzymują automatycznych grantów.

## Warstwy i granica zaufania

- `domain`: polityka `decideAccountingAccess` oraz (od [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md)) polityka autoryzacji administracyjnej `decideAccessManagementAuthorization`, bez SQL/Drizzle i bez automatycznych praw księgowych administratora.
- `application`: `manageAccess`, cztery komendy (`revoke_membership`, `reactivate_membership`, `grant`, `revoke_grant`), port magazynu, źródła zweryfikowanego aktora i osobnego autoryzatora administracyjnego (od [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md): `createOidcAccessManagementActorSource` i `createTenantAccessManagementAuthorizer`).
- `db`: `PostgresAccessManagementStore` oraz (od [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md)) `PostgresAccessManagementAuthorizationDataSource`, transakcja, blokady, kontrola stanu, idempotencja oraz zapis audytu; addytywne `0002_access-lifecycle.sql`.

Źródło aktora jest zależnością zaufanej kompozycji serwerowej, a nie argumentem HTTP. Brak źródła, brak aktora, brak autoryzatora lub wynik inny niż jawne `true` blokuje mutację. Awarie są fail-closed, bez SQL, parametrów, poświadczeń i `cause`. Komenda jest walidowana, kopiowana i zamrażana przed pierwszym `await`; autoryzator i magazyn dostają ten sam zakres. `read`/`write` nie dają prawa do administracji. Adapter DB jest zaufaną implementacją portu i musi być wywoływany przez use case; sam interfejs TypeScript nie uwierzytelnia.

**Aktualizacja 6D-2 (2026-10-28):** [etap 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) dostarcza serwerową implementację `AccessManagementActorSource` (opartą na weryfikatorze OIDC i `PostgresUserIdentityResolver`) oraz `AccessManagementAuthorizer` (`createTenantAccessManagementAuthorizer` z `PostgresAccessManagementAuthorizationDataSource`). Nadal jednak sprawdzenie autoryzatora wykonuje się przed transakcją `PostgresAccessManagementStore.execute`, więc współbieżne cofnięcie prawa administratora (TOCTOU) oraz brak ograniczonej roli runtime DB pozostają jawnymi blockerami na etap 6D-3 przed wystawieniem mutujących endpointów HTTP użytkownikom.

## Transakcja, czas i kolejność blokad

1. `SELECT ... FOR UPDATE` wybiera dokładnie `(tenant_id, user_id)`. Brak rekordu daje odmowę. Nie ma blokady globalnej ani kontekstu tenanta w zmiennej sesji.
2. Pod blokadą sprawdzamy istniejący `operation_id`. Zgodny aktor i kanoniczna treść dają historyczne potwierdzenie bez ponownego wykonania; konflikt daje odmowę.
3. Jedna chwila z zegara PostgreSQL: `date_trunc('milliseconds', clock_timestamp())`, pobrana **po** uzyskaniu blokady. `transaction_timestamp()` mógłby wskazywać czas sprzed oczekiwania. Ta sama chwila służy datom zmian i audytowi.
4. Operacja sprawdza aktualny stan, zmienia rekordy i dopisuje wymagane zdarzenie. Commit obejmuje całość. Błąd SQL lub audytu powoduje rollback, również po częściowej aktualizacji grantów.

Kolejność to **jedno członkostwo → jego granty → nowy event**. Żadna komenda nie blokuje dwóch członkostw. Współbieżne grant/cofnięcie mają dwa bezpieczne wyniki: grant zapisany pierwszy zostaje cofnięty; cofnięcie zapisane pierwsze blokuje grant. Cofnięcie/reaktywacja pozostawia stan ostatniej operacji, zawsze bez starych praw. Wszystkie operacje tego adaptera uczestniczą w tej samej serializacji. Przyszły batch musi zdefiniować porządek wielu kluczy i osobne testy zakleszczeń.

Podstawy: [PostgreSQL 18 — blokady wierszy i kolejność blokad](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS), [czas bieżący](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT), [transakcyjne wykonanie triggerów](https://www.postgresql.org/docs/18/trigger-definition.html).

## Semantyka komend i ponowień

`revoke_membership` ustawia `revoked`, a `revoked_at` wszystkich grantów na najwcześniejszą z dotychczasowej i bieżącej chwili. Nie usuwa grantów ani historii. Kolejne cofnięcie jest bezpieczne i może mieć `changed=false`; osobny identyfikator operacji pozostawia osobny ślad no-op.

`reactivate_membership` wymaga statusu `revoked`. Ustawia `active`, `valid_from` na chwilę operacji i jawny przyszły `valid_until` albo NULL. Nie przedłuża aktywnego lub wygasłego członkostwa tylną ścieżką — najpierw trzeba je cofnąć. Dodatkowo odwołuje ewentualne pozostawione granty rekordu `revoked` sprzed 0002; nigdy nie czyści cofnięcia.

`grant` wymaga istniejącego członkostwa aktywnego **teraz**, w okresie `[od, do)`, oraz firmy w tym samym tenancie. Początek NULL oznacza chwilę operacji; jawny początek może być przyszły, bez nadawania wstecz. Koniec jest wyłączny i późniejszy od początku. Grant może wykraczać poza koniec członkostwa, lecz sam nie daje dostępu bez aktywnego członkostwa. Reaktywacja wymaga uprzedniego cofnięcia wszystkich praw. Identyczne uprawnienie z takim samym okresem (lub już rozpoczęte przy początku NULL) jest zwracane jako no-op z istniejącym ID, również po dwóch równoległych żądaniach. Wygasłe i odwołane rekordy nie służą do deduplikacji nowego dostępu.

`revoke_grant` wybiera ID tylko w danym tenancie i członkostwie, także przy już nieaktywnym członkostwie. Cofnięcie przyszłego grantu jest dozwolone. Wcześniejszej daty cofnięcia nie przesuwa się dalej.

`operation_id` jest UUID, unikalnym w całym rejestrze. Potwierdzenie jest **historyczne**, nie oznacza aktualnego zezwolenia: ponowienie dawnego `grant` po cofnięciu/reaktywacji nie tworzy nowego grantu. Zmieniona treść/aktor przy tym samym ID jest konfliktem. Równoległa kolizja ID między różnymi członkostwami może dać ogólną odmowę dostępności po naruszeniu UNIQUE; transakcja w całości się wycofuje. Klient nie powinien automatycznie generować nowego ID po niepewnym wyniku.

## Audyt

`access_management_event` zawiera ID operacji, rodzaj, tenant, użytkownika docelowego, zatwierdzającego aktora, ID grantu (jeżeli dotyczy), czas, kanoniczny klucz żądania z jawnymi polami komendy, istotną zmianę stanu (`before`, `after`, liczba cofniętych grantów) i potwierdzenie wyniku. Nie zapisuje HTTP, tokenów, dokumentów ani poświadczeń. Brak FK do członkostwa/grantu jest celowy: historyczny audyt nie ma znikać wraz ze zmianą modelu. Testy nie tworzą prawdziwych tożsamości.

INSERT audytu jest obowiązkową częścią transakcji. Także nowe operacje no-op są rejestrowane. Dokładne ponowienie ID nie dopisuje drugiego zdarzenia. Trigger odrzuca UPDATE/DELETE zdarzeń. Nie jest to pełny audyt odmów, uwierzytelniania ani autoryzacji odczytów — to zakres kolejnych etapów.

## Migracja i obrona przed SQL

`0000`/`0001` i ich snapshoty pozostają niezmienione. `0002` dodaje tabelę/indeks, snapshot i journal oraz trzy guardy:

- `revoked_at` nie może przejść z wartości do NULL ani na późniejszą chwilę, także przez zwykły UPDATE.
- Zmiana statusu członkostwa w dowolną stronę cofa pozostałe granty w tej samej transakcji. Regresja SQL z PR #20 daje odmowę. Przy reaktywacji bierze pod uwagę również nowy `valid_from`, więc wsteczna data reaktywacji nie odtwarza dostępu w tym okresie.
- UPDATE/DELETE audytu jest zabroniony.

Serwis jawnie cofa granty przed zmianą statusu, używając jednej chwili i rejestrując liczbę zmian. Guard statusu jest dodatkowym zabezpieczeniem także dla starych rekordów; w poprawnej ścieżce nie ma już pozostałych grantów do zmiany. Funkcje działają z prawami wywołującego, bez `SECURITY DEFINER`; używają kontrolowanego namespace połączenia. Nie są kompletnym systemem autoryzacji DB.

Nie ma destrukcyjnego rollbacku. Błąd migracji wycofuje DDL; po sukcesie wycofanie kodu pozostawia tabelę i guardy. Ich usunięcie odtworzyłoby ryzyko, więc wymaga osobnej decyzji i migracji naprawczej. 0002 nie zgaduje utraconej historii aktywacji istniejących aktywnych członkostw. Przed importem prawdziwych danych lub pierwszym dostępem należy przejrzeć dawne granty i jawnie przeprowadzić cofnięcie/reaktywację/nowe nadanie; nie wolno traktować samej migracji jako oczyszczenia nieznanej historii.

## Obowiązkowe blokady przed pierwszym dostępem użytkowników

**Ograniczona rola DB i wymuszenie ścieżki mutacji są blockerem.** Obecne konta local/test mają uprawnienia DDL. Mogą ominąć autoryzację i audyt przez INSERT/DELETE/reinsert, TRUNCATE, zmianę funkcji/triggerów lub ich wyłączenie. Zwykłe przełączenie statusu i wyczyszczenie `revoked_at` są już chronione, lecz uprzywilejowany bezpośredni SQL nadal może odtworzyć dostęp. Same te guardy nie spełniają warunku publicznego dostępu.

W 6D-3 wymagana jest rola runtime bez ownera, DDL, TRUNCATE, BYPASSRLS i możliwości wyłączenia triggerów; brak dowolnego DML grantów/członkostw poza kontrolowaną ścieżką (np. osobno reviewowane procedury z wąskimi uprawnieniami i atomowym audytem). Bezpośredni INSERT eventu także nie może być źródłem dowolnie podanego aktora. Trzeba przetestować prawa ról, odporność na obejście przez SQL, RLS, `SET LOCAL` przy poolingu i audyt odmów. Nie dodajemy teraz nieprzetestowanej konfiguracji produkcyjnej ani pozornego administratora.

**Serwerowe OIDC i autoryzator administracyjny dostarczono w [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md).** Mutujące endpointy pozostają jednak niewystawione w publicznym `AppModule` do czasu domknięcia atomowości transakcyjnej (TOCTOU) i ograniczonej roli runtime DB w 6D-3.

**Pozostaje TOCTOU:** odczyt faktów przez `authorizeCompanyAction` oraz `createTenantAccessManagementAuthorizer` nie jest jeszcze atomowy z docelową operacją w jednej transakcji DB. 6D-3 połączy kontekst i operację na danych w odpowiedniej transakcji, wyegzekwuje RLS i przetestuje współbieżność.

Wymagane są code/security review, rozstrzygnięcie powyższych blockerów i pozostałe bramki Issue #6. Naprawa pierwotnej sekwencji nie oznacza gotowości do publicznego użycia.

## Dowody testowe

Testy jednostkowe application sprawdzają brak aktora/autoryzatora, odmowę także administratorowi, awarie fail-closed, walidację i zamrożenie zakresu przed autoryzacją. Dotychczasowa polityka i adapter zachowują kontrakty.

Testy PostgreSQL sprawdzają pełny cykl ze świeżym grantem, wiele firm/akcji, grant przyszły, ponowienia/no-op, nieaktywne/przyszłe/wygasłe/brakujące członkostwo, niewłaściwe daty, cofnięcie pojedynczego grantu, ochronę cofnięcia i audytu w SQL, cudzy tenant/firmę/grant, odmowy administracyjne, rollback awarii audytu i częściowej zmiany grantów. Regresja PR #20 sprawdza odmowę po SQL `active → revoked → active`. Migracje sprawdzają pustą bazę, ponowienie, rollback i upgrade z 0000/0001 z zachowaniem danych i rejestru.

Wyścigi wymuszają dwie rzeczywiste transakcje: pierwsza posiada blokadę członkostwa, druga czeka na nią, co test potwierdza przez `pg_blocking_pids` przed zwolnieniem bariery. Pokryte są obie kolejności grant/cofnięcie i cofnięcie/reaktywacja oraz równoległe nadania ze wspólnym i różnymi ID operacji. Limity oczekiwania wykrywają zakleszczenie; sam `Promise.all` nie jest dowodem nakładania.

Każdy zestaw DB używa dotychczasowego helpera `pap_test`, loopback, losowego namespace i inwentaryzacji przed/po. Nie uruchamiamy lokalnego Dockera i nie instalujemy PostgreSQL. `pnpm dev` nadal nie wymaga DB. Ostateczne wyniki lokalne i CI, liczby testów i pełny SHA podaje PR; brak lokalnej bazy oznacza niewykonanie testów integracyjnych lokalnie.
