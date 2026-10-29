# 27. Rola runtime i podpisany kontekst RLS — kandydat 6D-3A

Zależności: istniejący PR #27 (historyczna nazwa transakcji 6D-3A) → uzupełnienie
#28 (aktualny pakiet B) → ten pakiet A → audyt C. Niezależny dokumentacyjny #26
aktualizuje środowiska. Pełny odbiór jest wymagany; brak zgody na deployment.
Decyzja i jawne ograniczenia: [ADR-008](adr/008-podpisany-kontekst-i-rola-runtime.md).

## Macierz rzeczywistych uprawnień

Wykonywalny kontrakt: packages/db/sql/runtime-privileges.sql. Wszystkie tabele mają
ENABLE/FORCE RLS. W tabeli „UPDATE do blokady” oznacza uprawnienie SQL potrzebne do
FOR SHARE/UPDATE; WITH CHECK false uniemożliwia rzeczywistą zmianę.

| Obiekt | Runtime | Warunek |
| --- | --- | --- |
| tenant | SELECT | Podpisany tenant i aktywne członkostwo |
| legal_entity | SELECT; UPDATE(id) do blokady | Podpisana firma i grant albo autoryzowana administracja; zapis zabroniony |
| entity_profile_version | SELECT | Faza company, dokładny tenant/firma/akcja i aktywny grant |
| app_user | SELECT; UPDATE(id) do blokady | Wyłącznie aktor asercji; zapis zabroniony |
| user_oidc_identity | SELECT; UPDATE(id) do blokady | Wyłącznie aktor asercji; provisioning zabroniony |
| tenant_membership | SELECT; UPDATE(user_id) do blokady | Aktor/cel; DML runtime zabronione przez RLS/guard; executor SEC-01/02 |
| company_access_grant | SELECT; UPDATE(grant_id) do blokady | Brak INSERT/UPDATE danych; executor wykonuje dokładną podpisaną komendę |
| access_management_event | SELECT | Tylko dokładna zatwierdzona operacja i aktor; INSERT wyłącznie z executora |
| company_operation_probe | SELECT, INSERT | Podpisane operation_id, firma, aktor i decision_at; INSERT tylko write |
| security_context_key | Brak | Migrator/operator, nigdy runtime |
| drizzle.__drizzle_migrations | Brak | Wyłącznie migrator |
| pap_context, pap_admin_allowed, pap_company_allowed, pap_resolve_identity | EXECUTE | Małe definery, jawny scope i zamknięty search_path |
| pap_execute_access | EXECUTE | Cztery komendy lifecycle z podpisu; receipt i rzeczywiste OLD/NEW, bez parametrów SQL |
| pap_security_protocol_version | EXECUTE | Marker zgodności 0006 i aplikacji: 60301 |
| Funkcje triggerów i pgcrypto | Brak bezpośredniego EXECUTE | Triggery wywoływane przez PostgreSQL; kryptografia tylko wewnątrz definerów |
| Nowe tabele/funkcje/sekwencje | Brak domyślnych grantów | Każdy moduł wymaga własnej migracji/macierzy |

Macierz uwzględnia rewizję SEC-01/02: [kontrakt i QA](29-sec01-sec02-kontrakt-efektow.md).
Testy tej rewizji są **NOT RUN**; wyniki wcześniejszego kandydata nie stanowią odbioru.

Runtime: CONNECT do dedykowanej bazy, USAGE na schemacie danych, bez CREATE/TEMP.
Nie jest właścicielem bazy, schematu, tabel ani funkcji, nie należy do innych ról,
nie ma SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Migrator pozostaje
oddzielnym kontem właścicielskim. W stagingu migrator także nie może być superuserem.

## Przygotowanie izolowanego środowiska

Nie wymaga instalacji DB na komputerze właściciela. Na Hetznerze wolno użyć wyłącznie
uprzednio wydzielonej instancji testowej po sprawdzeniu zasobów ADR-006. W tej sesji
jej nie znaleziono. Nie tworzymy jej i nie używamy bazy działającego stagingu.

1. Administrator przygotowuje dedykowaną pap_test z migratorem pap_test, na loopback.
   Migruje ręcznie przez PAP_DATABASE_ENV=test, DATABASE_URL migratora i pnpm db:migrate.
2. Nowy runtime powstaje po ręcznym wykonaniu bootstrap-runtime-role.sql. Skrypt
   odmawia przejęcia istniejącego konta. Hasło ustaw interaktywnie przez psql
   `\password pap_test_app`; nie wpisuj go do historii ani polecenia.
3. W transakcji administracyjnej:

   ```sql
   BEGIN;
   SELECT set_config('pap.provision_runtime_role', 'pap_test_app', true);
   -- psql: \i packages/db/sql/runtime-privileges.sql
   COMMIT;
   ```

   To osobna operacja administracyjna, nigdy start aplikacji. Dla stagingu wymaga
   osobnej zgody. Istniejące usługi i ich ACL są poza zakresem.
4. Operator dostarcza losowy klucz 256 bitów przez chroniony kanał środowiskowy,
   bez parametrów CLI, logów i repo. PAP_DB_CONTEXT_KEY_ID oraz PAP_DB_CONTEXT_KEY_HEX
   są konfiguracją procesu API. provisionDatabaseContextKey zapisuje identyczny
   klucz parametryzowanym INSERT z konta migratora (runtime_role musi wskazywać login).
   Nie logować parametrów tej operacji w PostgreSQL. Klucza nie generuje migracja.
5. Runtime ma DATABASE_URL z pap_test_app (local: pap_local_app; staging: pap_staging_app).
   Migrator zachowuje odpowiednio pap_test/pap_local/pap_staging_migrator.
6. Kompozycja: loadDatabaseContextSigner → createPostgresSecurityServices(db, signer).
   Factory sprawdza marker 0006, rolę, ACL, FORCE RLS i podpis; zwraca spójne adaptery.
   Bez podpisu starsze adaptery na ograniczonej roli odmawiają; nie podłączać
   nieblokującego źródła faktów jako autoryzatora zapisu.

Rotacja: nowy key_id z nowym kluczem, kontrolowana zmiana procesu i dezaktywacja
starego klucza po zakończeniu transakcji (maks. 30 s). Osobny odbiór operacyjny;
nie zmieniać klucza in-place podczas otwartych operacji.

## Minimalna walidacja i przekazanie

Dostarczono runtime-security.integration.ts z prawdziwym loginem SQL, odrębnym od
właściciela i bez SET ROLE. Test przygotowuje wyłącznie nową pap_test_app, odmawia
przejęcia istniejącej roli i sprząta tylko swoje obiekty; przywraca zastany PUBLIC ACL.
Wymaga świeżej, dedykowanej instancji PG18 i administratora wyłącznie w fixture.

Scenariusze: spoofing GUC, brak kontekstu, DDL/TEMP/TRUNCATE/trigger/BYPASS,
ochrona klucza i rejestru, pool max=1, replay podpisu w nowej TX, cross-tenant,
idempotentny zapis syntetyczny i wygasłe członkostwo. **Nie wykonano ich w tej sesji.**
Nie są dowodem zgodności produkcyjnej. Kontrola typów, test podpisu i statyczny
kontrakt migracji są kontrolą minimalną; pełne SQL i wyścigi odbiera kolejny agent.

Wynik minimalny tej sesji: 54/54 testy sześciu zmienionych obszarów DB (podpis,
konfiguracja, pliki migracji, client-options, adapter faktów, resolver); osobno 5/5
buildera access-management po poprawce cache zablokowanych faktów. Tsc db i testów
db oraz lint: PASS. SQL oceniono statycznie; runtime-security.integration.ts,
migracje na realnym PG i pełna regresja są nieweryfikowane.
