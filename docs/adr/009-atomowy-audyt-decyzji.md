# ADR-009 — Trwały audyt odmów i atomowy audyt operacji

Data: 2026-10-29. Status: kandydat 6D-3C do niezależnej walidacji. Powiązania:
#6, ADR-007/008, docs/27-runtime-security-6d3a.md. Bez nowej usługi observability.

Rollback chronionej operacji usuwa także jej zwykły INSERT audytu. Dlatego:

- Allow operacji firmowej i administracyjnej zapisujemy w tej samej TX co efekt.
  Brak INSERT lub jego awaria uniemożliwia COMMIT.
- Deny oraz allow zakończone rollbackiem zapisujemy osobną krótką TX dopiero po
  zwolnieniu połączenia/blokad poprzedniej. Działa także z pulą max=1.
- Bramka HTTP zapisuje preflight, odróżniony od committed. Jej allow nie daje prawa
  późniejszego zapisu. Wczesne odrzucenia transportowe mają actor_id NULL, bez
  zgadywania tożsamości z JWT, nagłówka lub body.

security_decision_event przechowuje allow/deny, outcome, kontrolowany reason,
wewnętrznego aktora ze źródła serwerowego, cel, tenant, firmę, akcję, czas decyzji,
request_id, operation_id oraz opcjonalne FK do access_management_event. recorded_at
i pełny transaction_id nadaje trigger PostgreSQL. Brak pełnych tokenów, sesji OIDC,
treści dokumentów, surowych selektorów i wyjątków SQL. Writer kopiuje wyłącznie
allowlistę pól; przyczyny mają allowlistę także w CHECK bazy.

Rola runtime ma tylko INSERT audytu pod RLS, bez SELECT/UPDATE/DELETE/TRUNCATE.
Oddzielna faza podpisu audit poświadcza dokładny payload; asercja company/access nie
pozwala sfałszować wpisu. Po rewizji SEC-01/02 access_management_event, state_change
i receipt tworzy wyłącznie kontrolowany executor SQL z podpisanej komendy;
runtime nie może wstawić ich samodzielnie, także pod dawną asercją access_event.
Triggery odmawiają UPDATE/DELETE. Administrator
DDL nadal pozostaje jawną granicą zaufania; nie obiecujemy kryptograficznej trwałości
przeciw migratorowi, superuserowi ani przejętemu procesowi z kluczem.

DEFERRABLE INITIALLY DEFERRED constraint triggers sprawdzają na COMMIT, że każda
runtime mutacja członkostwa/grantu oraz syntetycznej operacji firmowej ma allow
committed w tej samej rzeczywistej TX, operacji i zakresie. Dla lifecycle wymagany
jest dokładnie jeden wpis pełnego OLD/NEW pod kluczem wiersza w mapie effects
receipt z tej samej TX (także grant_id, rodzaj DML i revoked_at), z action równym
kind komendy i zgodnym czasem decyzji. Nowy receipt sam wymaga audytu, a audyt
committed musi wskazywać dokładną operację, aktora, tenant, cel, rodzaj i firmę.
Idempotentne powtórzenie zwraca historyczny receipt przed DML i zapisuje nową
decyzję; stary receipt nie pokrywa nowych efektów. Zapis probe wymaga zgodnego
operation_id i created_at = decision_at w asercji/repozytorium/RLS/audycie.

Decyzja oraz odrzucone warianty i macierz QA:
[SEC-01/02](../29-sec01-sec02-kontrakt-efektow.md). Wszystkie testy rewizji NOT RUN.

Awaria atomowego audytu nie pozwala utrwalić efektu i zwraca authorization_audit_unavailable.
Próbujemy osobno utrwalić allow/rolled_back; awaria tej ścieżki również nie może dać
sukcesu. Awaria bazy może uniemożliwić zapis całej odmowy — nie deklarujemy wtedy
trwałego śladu. HTTP zwraca 503 bez szczegółów SQL; nie udajemy dostarczenia audytu
przez log tekstowy ani nie wprowadzamy nieograniczonego retry/outbox na tym etapie.

Powyższy opis rolled_back wymaga integracji poprawki SEC-03 z PR #35:
tylko potwierdzony rollback przed COMMIT może dać rolled_back. Niepewne
zakończenie ma outcome_unknown/503 i nie uruchamia ponownie callbacku.
Executor nie rozstrzyga wyniku COMMIT. Zachować rozszerzenie CHECK/allowlisty,
typy błędów i obsługę aplikacyjną z #35 podczas integracji; kod SEC-03 pozostaje
odrębnym PR i obowiązkową zależnością odbioru tej rewizji.

Hardening C obejmuje też odebranie zastanych grantów kolumnowych (zwykły REVOKE na
tabeli ich nie usuwa), odmowę roli z SET session_replication_role i porównanie wszystkich
32 bajtów MAC bez wczesnego zakończenia. Nie jest to dowód odporności timingowej całej DB.

Migracja: rewizja kandydackich 0004/0005, bez zmian 0000–0003. 0005 dodaje
transaction_id/indeks do receipt; historycznym wpisom pozostawia NULL, bez
przypisywania im TX migracji. Ręczny provisioning ACL należy powtórzyć po
migracji: INSERT security_decision_event i EXECUTE executora, bez INSERT
grantów/receipt i UPDATE stanu uprawnień. Factory wymaga 11 tabel z FORCE RLS.
Nie wyłączać kontroli ani nie usuwać audytu jako rollbacku. Brak automatycznych
migracji/deploymentu; wymagany pełny odbiór PG18 na izolowanym Hetznerze.

Podstawy:
[RLS i kolejność BEFORE/WITH CHECK](https://www.postgresql.org/docs/18/sql-createpolicy.html),
[granty kolumnowe](https://www.postgresql.org/docs/18/sql-revoke.html).
