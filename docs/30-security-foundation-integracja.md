# Security Foundation 6D-3 — integracja SEC-01/02/03

Data: 2026-10-29. Issue #6. Branch `codex/issue-6-security-foundation-integration`.
**Kandydat implementacyjny, Draft / NO-MERGE — oczekuje na QA i security review.**
Dokładny końcowy HEAD i wyniki kontroli statycznych są w opisie PR i handoff Issue #6;
nie przypisywać wyników źródłowych PR do nowego SHA.

## Baza i wybór rozwiązań

| Źródło | Sprawdzony SHA | Decyzja |
| --- | --- | --- |
| main | `9e62b9a5881cd38b2e2a9b874d73b44078f16bf3` | Polityka ADR-006 i handoff obowiązuje |
| #27 | `1281027a126b09f934894cde5fe43dc01a7b3e3b` | Fundament UoW, zawarty w bazie |
| #28 | `5d2a4c5c4d37219988310c787544352f89c794b0` | Granice transakcji, zawarte w bazie |
| #30 | `edad9f7f0d1c67da4a57f47454295a0d459322ec` | Runtime/HMAC/RLS, zawarte w bazie |
| #31 | `bd0c56047dd9a86243c12a1a7e917429c487015f` | Bezpośrednia baza nowej gałęzi i PR |
| #36 | `b41e220259ebfd6b79936b8b680b70ed116f5ebf` | Zintegrowano kontrakt SEC-01/02, executor i OLD/NEW |
| #37 | `a459aa1e09b1d664d2eee07c697306da79f05fb3` | Zintegrowano SEC-03, kontrakty, HTTP 503 i istniejące testy |
| #35 | `6da3326bebb1f41dabc2c492d8c19656f3a6dbb5` | Porównanie; bez drugiej implementacji i bez merge tej gałęzi |

Obie źródłowe gałęzie #36/#37 zachowano w historii integracji. Żadnej cudzej gałęzi
nie nadpisano. PR jest dodatkiem do #31; zależność #27 → #28 → #30 → #31 pozostaje.
To nie jest zgoda na osobny merge nieodebranych elementów stosu.

W końcowym #35 obsługa odroczonych więzów już istnieje, ale regex klas `23|40`
obejmuje również `40003` (statement_completion_unknown). Dlatego wybrano węższą
allowlistę #37 z wymaganym rzeczywistym `PostgresError` i `severity = ERROR`.
`23514` i `40001` są wycofaniem; `40003`, `08007`, błędy połączenia i FATAL/PANIC
pozostają niepewne. Nie kopiowano szerokiego regexu z #35.

Dodatkowo ograniczono klasyfikator #37 do bezpośredniego błędu sterownika: stary
`PostgresError` w `cause` błędu transportu nie dowodzi rollbacku. Błąd przed wejściem
do callbacku nie jest sam w sobie potwierdzeniem ROLLBACK; aplikacja nie uzyskała
wtedy decyzji allow. Z #35 przyjęto objęcie predykatu `shouldCommit` nośnikiem
przerwania sprzed COMMIT. Nie dodano automatycznego ponawiania callbacku.

## Wspólny kontrakt operacji i wyniku transakcji

Write firmowy wymaga kanonicznego UUID operacji. To samo ID oraz czas decyzji po
blokadach przechodzą przez application, asercję HMAC, repozytorium probe, RLS i
audyt. Probe A i B nie mogą zostać zatwierdzone audytem A. Retry A ponownie sprawdza
prawa i zwraca istniejący efekt bez nowego INSERT; zapisuje nową decyzję.

Administrację wykonuje wyłącznie `pap_execute_access()` z podpisanej komendy,
bez argumentów SQL. Funkcja tworzy receipt i mapę rzeczywistych pełnych OLD/NEW
w tej samej TX. Runtime ma jedynie UPDATE kluczy potrzebne do blokad; RLS WITH CHECK
false, invoker guard oraz brak INSERT grantów/receipt uniemożliwiają dodatkowe DML.
Każde przejście musi pasować do dokładnie jednego receipt bieżącej TX i jego audytu:
operation_id, actor, tenant, target, action/kind, firma i czas. Nowy receipt wymaga
audytu; committed audit musi wskazywać właściwą operację. Historyczny receipt retry
nie jest dowodem nowej mutacji. No-op i dedup G1→G0 mają pustą mapę efektów.

Kaskada revoke/reactivate najpierw cofa potrzebne granty jednym zegarem, potem
zmienia członkostwo; wcześniejsze cofnięcie pozostaje, inne ma dokładnie czas
decyzji. Szczegółowe uzasadnienie rozwiązania i alternatywy: [docs/29](29-sec01-sec02-kontrakt-efektow.md).

Przy integracji wykryto też błąd dat retry: polityka nowego grantu odrzucała jawny
validFrom po upływie tej daty, zanim odczytano wcześniejszy receipt. Adapter teraz
rozpoznaje w fazie facts własny receipt o identycznej całej komendzie/ID/aktorze/
tenant/target. Przekazuje zaufany committedOperationAt, a polityka sprawdza daty
propozycji względem pierwotnego zdarzenia. **Bieżące** konto, OIDC, role i delegowane
granty nadal podlegają ocenie w aktualnym czasie po blokadach. Znacznik nie pochodzi
z DTO i nie trafia do komendy; executor ponownie dopasowuje receipt przed DML.
Fałszywy znacznik bez istniejącej operacji nie omija kontroli czasu w SQL nowej
mutacji. Retry nie przedłuża ważności, nie reaktywuje dostępu i nie wykonuje DML.

| Zakończenie | Wynik aplikacji i audyt |
| --- | --- |
| Potwierdzony COMMIT | Sukces; efekt + receipt + allow/committed atomowo |
| Callback/predykat odrzucony i potwierdzony ROLLBACK | Odmowa; po zwolnieniu TX osobny allow/rolled_back, jeżeli była autoryzacja |
| Odroczony constraint `23514` lub `40001` odrzucony przez serwer podczas COMMIT | Potwierdzone wycofanie, bez efektu; dopuszczalny allow/rolled_back |
| Utrata potwierdzenia COMMIT albo ROLLBACK, `40003`, `08007`, FATAL/PANIC | outcome_unknown; HTTP 503; brak rolled_back i brak automatycznego replay |
| DB nadal niedostępna po niepewności | Nadal outcome_unknown/503; dodatkowy ślad niepewności może nie powstać |

Ślad niepewności ma `access_management_operation_id = NULL`, aby nie zakładać
istnienia receipt; korelacja odbywa się przez operation_id/request_id. To informacja
o braku potwierdzenia próby, nie dowód wycofania ani drugiego wykonania. Jawny retry
z tym samym ID korzysta z idempotencji; nie ma gwarancji dostarczenia exactly-once.

Dowód rollbacku nośnika opiera się na przypiętym `postgres.js 3.4.9`: `begin/scope`
oddaje wyjątek callbacku dopiero po `await rollback`; utrata połączenia zastępuje go
błędem transportowym. Drizzle 0.45.4 deleguje transakcję do tego `begin`. Zmiana
sterownika wymaga ponownego review i fault injection. Źródła:
[postgres.js begin/scope](https://github.com/porsager/postgres/blob/v3.4.9/src/index.js),
[obsługa ReadyForQuery/ErrorResponse](https://github.com/porsager/postgres/blob/v3.4.9/src/connection.js),
[Drizzle transaction](https://github.com/drizzle-team/drizzle-orm/blob/0.45.4/drizzle-orm/src/postgres-js/session.ts),
[SQLSTATE PostgreSQL 18](https://www.postgresql.org/docs/18/errcodes-appendix.html).

## Rozwiązane konflikty i migracja

Scalono sąsiednie kontrakty w application UoW, access-management, signerze i helperze
HTTP: zachowano operationId/decisionAt z #36 oraz trzy wyniki TX i 503 z #37. W
konflikcie ADR-009 zachowano dokładne efekty i semantykę niepewności. Konflikt SQL
0005 rozwiązano przeniesieniem wszystkich zmian do **nowej 0006**.

- `0000`–`0005` i istniejące snapshoty są identyczne z #31. Nie zmienia się hashów
  wykonanych migracji. Journal dodaje 0006, a snapshot 0006 wskazuje oryginalny 0005.
- 0006 działa zarówno po cold install 0000→0006, jak i po oryginalnej 0005 z #31.
  Dodaje nullable transaction_id receipt i indeks; historyczne wpisy zachowują NULL,
  dawną treść i brak mapy efektów. Nie dopisuje historii ani fałszywego xid migracji.
- Nowy CHECK audytu jest `NOT VALID`, ponieważ oryginalna 0005 dopuszczała np.
  write z NULL operation_id. Nowe INSERT-y są egzekwowane; historyczny audyt pozostaje
  bez zmian. Nie uruchamiać automatycznie VALIDATE ani naprawiania dawnych zdarzeń.
- 0006 ma lock_timeout 5 s, statement_timeout 30 s, blokady zmienianych tabel oraz
  wymaga dotychczasowego właściciela. Nie obiecuje migracji bez przerwy w dostępie.
  Błąd ma wycofać całą migrację; brak automatycznych powtórzeń lub wyłączania RLS.
- Wymagany jest nowy ręczny provisioning `runtime-privileges.sql` i wspólna wersja
  aplikacji/SQL. Marker `pap_security_protocol_version() = 60301` zatrzymuje nową
  factory przy starej DB/ACL. Stary kod próbujący surowego DML odmawia pod nowymi
  guardami/ACL. Rollback nie może przywracać dawnych szerokich uprawnień.
- Factory sprawdza też granty kolumnowe do klucza i audytu, których nie wykrywa
  samo has_table_privilege. Faza company ogranicza własne granty do podpisanej
  firmy i akcji; szerokie własne granty delegacji są dostępne tylko administracji.
- Bazy z alternatywnie edytowanymi 0004/0005 z #35/#36/#37 są poza tą ścieżką:
  operator musi porównać schemat, hashe i właścicieli. Nie kasować rejestru migracji,
  nie omijać duplicate column, nie uruchamiać ponownie edytowanych plików. Fixture
  można odtworzyć; trwała instancja wymaga osobnego planu i zgody.

Nie wykonano żadnej migracji, provisioningu, połączenia do Hetznera ani deploymentu.

## Status ustaleń i pozostałe bramki

| Ustalenie | Stan implementacji / warunek odbioru |
| --- | --- |
| SEC-01 | Zintegrowane ID/asercja/RLS/audyt; wymaga negatywnych prób PG |
| SEC-02 | Kontrolowany executor, OLD/NEW i retry bez DML; wymaga review definerów i PG |
| SEC-03 | Trzy wyniki TX, deferred COMMIT, 503; wymaga fault injection na PG |
| SEC-04 | Poprawiono false OIDC→podpis i scope A→B: jeden zweryfikowany aktor, jeden zakres, domenowa decyzja wewnątrz UoW i zgodny audyt. **Otwarte:** oddzielenie surowego portu sterowania/tx od callbacku repozytorium przed API/MCP; brak odbioru savepointów/blokad |
| SEC-05 | Helpery sprawdzają podpisaną fazę/tenant/firmę/akcję przed odczytem; wymaga prób PG dla aktora z prawami do obu firm |
| H1 | Otwarte: właściciele/ACL pgcrypto przy migratorze NOSUPERUSER; nie nadawać SUPERUSER |
| H2 | Otwarte: wyścigi, savepointy i utrata blokad/podpisów na prawdziwym runtime |

Każde „zintegrowane/poprawiono” oznacza kod kandydata, nie potwierdzoną naprawę
audytu. SEC-04 residual, H1/H2, brak testów i niezależnego security review blokują
udostępnienie operacji firmowych przez API/MCP. Nie dodano żadnego endpointu.
Proces z kluczem HMAC, migrator i DDL pozostają granicą zaufania. Koszt dużych map
efektów/kaskad i append-only audytu trzeba zmierzyć pod limitami runnera.
Surowy callback pozostaje zaufanym kodem serwera: nie wolno w nim wykonywać
COMMIT/ROLLBACK, omijać sterowania UoW ani zwalniać blokad autoryzacji savepointem.
Nie deklarujemy odporności na taki błędnie podłączony port; jego odseparowanie
jest częścią otwartej bramki SEC-04 przed API/MCP.

## Macierz QA — wszystko NOT RUN

Każdy przypadek sprawdza trwały stan kontem kontrolnym, wywołania callbacku i audyt,
zamiast polegać tylko na wyniku use case. Runtime: prawdziwy login pap_test_app,
bez własności/SUPERUSER/BYPASSRLS/członkostw. Migrator także NOSUPERUSER.

| Próba | Wymagany wynik |
| --- | --- |
| Poprawne probe A; ponowienie A | Jeden efekt, świeży audyt każdej próby |
| A+B z samym audytem A; event NULL/B lub obcy czas/scope | Brak zatwierdzenia dodatkowego efektu; cała TX wycofana |
| Write bez ID, ze złym ID; read bez ID | Write odmawia przed callbackiem; poprawny read działa |
| Revoke TX1→retry TX2→revoked_at t0−1 dzień pod przechwyconym MAC | Brak nowego DML/przepisania daty |
| Dedup G1→G0→INSERT G1; mutacja po audycie; INSERT receipt runtime | Odmowa, brak ukrytego grantu i dodatkowego efektu |
| Obcy kind/grant/OLD/NEW/transaction_id lub niewłaściwy event | COMMIT odrzucony; brak częściowego efektu |
| Grant/revoke/no-op; wcześniejsze/równe/późniejsze cofnięcie | Dokładny receipt i zgodne rzeczywiste OLD/NEW |
| Revoke/reactivate 0/1/wiele grantów, także przyszłych; historyczny receipt NULL xid | Pełna kaskada jednym zegarem; retry bez DML |
| Błąd callbacku lub predykatu, poprawny ROLLBACK | Brak efektu; allow/rolled_back tylko po autoryzacji |
| Odroczony trigger `23514` przy COMMIT; `40001` | Confirmed rollback, brak efektu, bez fałszywego outcome_unknown |
| `40003`, `08007`, rozłączenie po skutecznym COMMIT | 503/outcome_unknown, callback raz, committed efekt, brak rolled_back |
| Rozłączenie podczas ROLLBACK; transport z cause=PostgresError(23514) | Outcome unknown; bez deklarowania rollbacku |
| DB niedostępna przy osobnym audycie niepewności | Nadal 503/outcome_unknown; brak sukcesu i replay |
| Jawny retry tym samym ID po utracie COMMIT ACK; konflikt komendy/aktora/scope | Jeden efekt/receipt albo operation_conflict; zawsze świeża autoryzacja |
| Retry grantu z jawnym dawnym validFrom lub zakończonym okresem; retry reaktywacji po jej okresie | Własny dokładny receipt bez nowego DML, o ile bieżące prawa aktora nadal wystarczają |
| Obcy ID/komenda/aktor lub podrobiony znacznik replay bez receipt | Brak pominięcia kontroli czasu nowej mutacji; cofnięty aktor nadal odrzucony |
| Sprzeczne outcome/reason/FK pod prawidłową asercją audit | CHECK 23514; brak fałszywego committed/rolled_back |
| Cofnięte OIDC→verify=false→getFacts/apply; brak faktów/negatywna polityka | Brak podpisu company i efektów |
| Fakty A→podpis B/inna akcja/czas; podmienione fakty zwrócone callerowi | Odmowa; wewnętrzna decyzja nie korzysta z podmienionej kopii |
| A/read→helper B, A/write lub admin obcego tenanta; aktor ma wszystkie granty | false/odmowa; poprawne facts/company/access nadal działają |
| Cold 0000→0006 i upgrade oryginalnej 0005 z dawnym audytem/receipt | Te same hashe 0000–0005 i stare dane; nowe constraints/ACL aktywne |
| Awaria migracji/lock timeout; provisioning i start ze starym SQL/ACL | Atomowy rollback migracji lub odmowa startu; bez osłabiania RLS |
| Pool max=1, replay w innej TX/backendzie/bazie/roli, TTL, TimeZone/DateStyle | Brak wycieku kontekstu i nieuprawnionych efektów |
| Oba porządki UUID, revoke/disable/OIDC, savepoint sprzed blokad, H1/H2 | Dowód zachowania blokad/izolacji albo jawny blocker i poprawka |

Najpierw QA musi dostosować stare fixture: mocki `access-management.test.ts` i
fixture integracyjne zakładają jeszcze surowy DML TS/runtime lub adapter bez
signera; testowy kontroler HTTP i część application fixture mają write bez ID
oraz stare oczekiwania context bez operationId/decisionAt. Nie osłabiać produkcyjnego
kontraktu ani oznaczać takich testów jako PASS. Zaimportowane testy #37 są materiałem
do adaptacji, nie dowodem zgodności z executorem #36. Zaktualizowano jedynie kontrakt
łańcucha migracji i ostrożniejszy wynik błędu inicjalizacji TX.

## Polecenia i przekazanie do następnego agenta

W tej sesji: analiza GitHub/kodu/źródeł sterowników, implementacja oraz dopuszczone
kontrole statyczne Git. **Wszystkie testy, typecheck/lint/format/build/E2E/audyt
zależności, migracje i CI: NOT RUN** na całym końcowym SHA. Środowisko: osobny
worktree Windows/PowerShell, bez DB. Nie przenosimy historycznych PASS z #27–#37.

Po adaptacji fixture, wyłącznie w zatwierdzonym izolowanym runnerze Hetznera/PG18.6
według ADR-006, z limitami CPU/RAM, timeoutami i sprzątaniem zasobów:

```sh
pnpm --filter @pap/application typecheck
pnpm --filter @pap/domain typecheck
pnpm --filter @pap/db typecheck
pnpm --filter @pap/api typecheck
pnpm --filter @pap/application exec vitest run --config ../../vitest.config.ts test/transactional-unit-of-work.test.ts test/access-management.test.ts
pnpm --filter @pap/domain exec vitest run --config ../../vitest.config.ts test/access-management-authorization.test.ts
pnpm --filter @pap/db exec vitest run --config ../../vitest.config.ts test/access-management.test.ts test/security-audit.test.ts test/signed-context.test.ts test/migration-files.test.ts
pnpm --filter @pap/api exec vitest run --config ../../vitest.config.ts test/oidc-authorization-pipeline.test.ts
pnpm --filter @pap/db exec vitest run --config vitest.integration.config.ts test/migrations.integration.ts test/runtime-security.integration.ts test/transactional-authz.integration.ts test/access-management.integration.ts
pnpm test:arch
pnpm test:integration
```

Cold install/upgrade i provisioning wykonać wyłącznie we własnej syntetycznej DB
testu, nie na stagingu. Sekrety dostarczyć chronionym środowiskiem, bez CLI/logów.
Pełne `pnpm test`, `pnpm lint`, `pnpm format:check`, `pnpm build`, `pnpm test:e2e`
i `pnpm audit --audit-level high` należą do osobnego odbioru w izolowanym CI.
GitHub Actions pozostaje wyłączone; nie uruchamiać workflow ani rerun.

Kolejny agent: review 0006/definerów i klasyfikatora → adaptacja fixture i implementacja
brakujących kontrprzykładów/fault injection → domknięcie SEC-04 residual/H1/H2 →
kampania na dokładnym HEAD → raport PASS/FAIL/NOT RUN z komendami, rolami, wersją PG,
limitami i cleanup na GitHub → niezależny security review. Każda zmiana SHA unieważnia
przypisanie wyników do nowej głowy. Do tego czasu **NO-MERGE**.
