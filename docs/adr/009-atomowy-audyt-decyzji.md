# ADR-009 — Trwały audyt odmów i atomowy audyt operacji

Data: 2026-10-29. Status: kandydat 6D-3C do niezależnej walidacji. Powiązania:
#6, ADR-007/008, docs/27-runtime-security-6d3a.md. Bez nowej usługi observability.

Rollback chronionej operacji usuwa także jej zwykły INSERT audytu. Dlatego:

- Allow operacji firmowej i administracyjnej zapisujemy w tej samej TX co efekt.
  Brak INSERT lub jego awaria uniemożliwia COMMIT.
- Deny oraz allow zakończone **potwierdzonym** rollbackiem (`rolled_back`) zapisujemy
  osobną krótką TX dopiero po zwolnieniu połączenia/blokad poprzedniej. Działa także z pulą max=1.
- Nie wolno utożsamiać dowolnego odrzucenia Promise transakcji po autoryzacji z potwierdzonym
  rollbackiem (SEC-03). Jeśli błąd wystąpił po wejściu w fazę `COMMIT` albo baza nie
  potwierdziła wykonania `ROLLBACK`, wynik zakończenia transakcji jest niepewny:
  aplikacja zwraca fail-closed `transaction_outcome_unknown` (HTTP 503), nie ponawia
  automatycznie callbacku biznesowego i nie zapisuje fałszywego `allow/rolled_back`.
  Gdy DB jest dostępna na świeżym połączeniu, utrwala jawny wpis `allow/outcome_unknown`
  (`reason = 'transaction_outcome_unknown'`, bez FK `access_management_operation_id`).
  Jeżeli serwer PostgreSQL zdążył wykonać `COMMIT` przed utratą potwierdzenia, w bazie
  pozostaje również atomowy wpis `allow/committed` z tej samej transakcji; system nie
  deklaruje pozornej gwarancji `exactly-once`, której sieć i PostgreSQL nie zapewniają,
  lecz opiera bezpieczne ponowienie na idempotentnym `operation_id`.
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
pozwala sfałszować wpisu. Tak samo osobno podpisujemy pełny access_management_event,
łącznie z state_change i receipt. Triggery odmawiają UPDATE/DELETE. Administrator
DDL nadal pozostaje jawną granicą zaufania; nie obiecujemy kryptograficznej trwałości
przeciw migratorowi, superuserowi ani przejętemu procesowi z kluczem.

DEFERRABLE INITIALLY DEFERRED constraint triggers sprawdzają na COMMIT, że każda
runtime mutacja członkostwa/grantu oraz syntetycznej operacji firmowej ma allow
committed w tej samej rzeczywistej TX i zakresie. Dla lifecycle wymagany jest również
access_management_event. Idempotentne powtórzenie nie powiela mutacji/receipt,
ale zapisuje nową decyzję z linkiem do istniejącej operacji.

Awaria atomowego audytu przed `COMMIT` wycofuje efekt i zwraca `authorization_audit_unavailable`.
Po potwierdzonym `ROLLBACK` próbujemy osobno utrwalić `allow/rolled_back`; awaria tej ścieżki
również nie może dać sukcesu. Przy utracie potwierdzenia zakończenia transakcji (`outcome_unknown`)
priorytetem jest zachowanie sygnału `transaction_outcome_unknown`, nawet gdy best-effort zapis
wpisu niepewności także nie powiedzie się z powodu niedostępności bazy. Awaria bazy może
uniemożliwić zapis całej odmowy lub śladu niepewności — nie deklarujemy wtedy trwałego śladu
poza ewentualnie zatwierdzoną transakcją główną. HTTP zwraca 503 bez szczegółów SQL; nie udajemy
dostarczenia audytu przez log tekstowy ani nie wprowadzamy automatycznego retry/outbox na tym etapie.

Hardening C obejmuje też odebranie zastanych grantów kolumnowych (zwykły REVOKE na
tabeli ich nie usuwa), odmowę roli z SET session_replication_role i porównanie wszystkich
32 bajtów MAC bez wczesnego zakończenia. Nie jest to dowód odporności timingowej całej DB.

Migracja: 0005, bez zmian 0000–0004. Ręczny provisioning ACL należy powtórzyć po
migracji: dodaje INSERT security_decision_event. Factory wymaga 11 tabel z FORCE RLS.
Nie wyłączać kontroli ani nie usuwać audytu jako rollbacku. Brak automatycznych
migracji/deploymentu; wymagany pełny odbiór PG18 na izolowanym Hetznerze.

Podstawy:
[RLS i kolejność BEFORE/WITH CHECK](https://www.postgresql.org/docs/18/sql-createpolicy.html),
[granty kolumnowe](https://www.postgresql.org/docs/18/sql-revoke.html).
