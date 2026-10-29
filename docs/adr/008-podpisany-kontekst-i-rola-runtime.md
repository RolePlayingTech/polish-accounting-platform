# ADR-008 — Podpisany kontekst transakcji i rola runtime

Data: 2026-10-29. Status: kandydat 6D-3A do niezależnego review. Powiązane: #6,
ADR-001/002/004/006/007. Stack bez zmian.

Samo SET LOCAL jest podatne na zmianę przez każdego posiadacza połączenia SQL.
Wprowadzamy HMAC-SHA256 jako asercję zaufanego serwera po serwerowej weryfikacji OIDC
i domenowej decyzji pod blokadami. Klucz 256 bitów jest dostępny procesowi API oraz
oddzielnemu migratorowi, ale niedostępny roli SQL runtime. pgcrypto jest rozszerzeniem
PostgreSQL, instalowanym addytywnie w schemacie danych; nie instalujemy usług systemowych.

Asercja obejmuje bazę, session_user, pg_backend_pid, pg_current_xact_id (pełny xid8),
termin ważności 30 s, cel, aktora, tenant, firmę i akcję. Komenda administracyjna ma
ponadto dokładny payload, cel i chwilę decyzji. Zmienne są ustawiane lokalnie do TX.
Podpisu nie można odtworzyć w innej transakcji, bazie, roli ani na innym połączeniu.
Zmiana legacy pap.current_* nie daje dostępu. Nie zapisujemy JWT w DB.

Fazy: actor (rewalidacja konta), identity (minimalny resolver issuer/subject),
facts (zablokowane fakty), company (operacja firmy), access (zatwierdzona komenda).
Runtime może czytać tylko wiersze odpowiednie dla podpisanego zakresu; RLS dodatkowo
sprawdza aktywność konta, członkostwa i grantu oraz ich czas. Granica per-action
pozostaje w domenie. Zapis członkostw/grantów ogranicza również trigger, do dokładnej
zatwierdzonej komendy; nie wolno zmieniać roli ani kluczy. Konto SQL nie ma DELETE,
TRUNCATE, DDL, TRIGGER, REFERENCES, klucza, rejestru migracji ani członkostwa w migratorze.

ENABLE i FORCE RLS obejmują wszystkie 10 tabel modelu/bezpieczeństwa. Migrator ma
jawną politykę administracyjną: FORCE nie chroni przed administratorem posiadającym DDL.
Małe SECURITY DEFINER są własnością migratora, mają zamknięty search_path
pg_catalog, schemat_danych, pg_temp; runtime nie może tworzyć w tych schematach ani
tworzyć tabel tymczasowych. EXECUTE z PUBLIC jest odwołany. Nie używamy BYPASSRLS.
Provisioning odmawia pracy z uprzywilejowaną, właścicielską lub dziedziczącą rolą runtime.
createPostgresSecurityServices weryfikuje rzeczywiste flagi, ACL, FORCE RLS i zgodność
klucza przed udostępnieniem adapterów. Sam poprawny DATABASE_URL nie wystarcza.

Alternatywy: niepodpisane GUC odrzucone jako ochrona przed arbitrary SQL. Osobny
broker/serwis tożsamości odłożony — dodawałby połączenia i protokół bez potrzeby.
Nie przepisujemy reguł delegacji w PL/pgSQL: podpis poświadcza decyzję wspólnego core,
a SQL sprawdza zakres, stan i dokładną postać dozwolonych mutacji.

Ograniczenia: przejęcie procesu API/klucza lub migratora pozwala wystawiać asercje;
to jawna granica zaufania, nie rozwiązany problem. SQL injection może wykonać operacje
w już zatwierdzonym zakresie bieżącej transakcji — parametryzacja i review nadal są
obowiązkowe. PostgreSQL constraints/FK/unikalność mogą ujawniać istnienie identyfikatora
przez konflikty; transport musi redagować błędy i nie udostępniać SQL. Krótkie transakcje
są wymagane; po 30 s polityka odmawia zamiast przedłużać asercję w niezaufanym SQL.
Dokładny audyt allow/deny i ochrona jego zapisu należą do zależnego C.

Migracja: 0004, bez zmian 0000–0003. Role i klucz nie powstają automatycznie w migracji.
Nie ma automatycznego deploymentu ani migracji stagingu. Rollback aplikacji wymaga
utrzymania zgodnego podpisu i ACL; nie wyłączać RLS i nie kasować danych jako rollbacku.
Pełna walidacja ról, definerów, poolingu i wyścigów jest bramką przed merge.

Podstawy techniczne:
[PostgreSQL 18 RLS](https://www.postgresql.org/docs/18/ddl-rowsecurity.html),
[SECURITY DEFINER i search_path](https://www.postgresql.org/docs/18/sql-createfunction.html),
[blokady](https://www.postgresql.org/docs/18/explicit-locking.html).
