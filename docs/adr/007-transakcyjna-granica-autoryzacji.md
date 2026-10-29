# ADR-007 — Transakcyjna granica autoryzacji 6D-3B

Data: 2026-10-29. Status: kandydat do niezależnego security review. Powiązanie: #6.

Decyzja z guarda HTTP i nieblokującego adaptera faktów nie upoważnia późniejszego zapisu.
REST oraz przyszłe MCP wywołują jeden use case z portem UnitOfWork. Weryfikacja JWT/JWKS
odbywa się przed transakcją, następnie konto i konkretna tożsamość OIDC są rewalidowane
pod blokadami. READ COMMITTED jest jawny, także gdy połączenie ma inne ustawienie domyślne.

Blokady: app_user → user_oidc_identity → członkostwa uporządkowane po user_id
(aktor SHARE, cel UPDATE) → firma → granty uporządkowane po user_id/grant_id.
Czas clock_timestamp jest pobierany po oczekiwaniu na blokady. Operacja i jej krytyczny
audyt kończą się jednym COMMIT; kontrolowana odmowa również wykonuje fizyczny ROLLBACK.
Brak adaptera transakcyjnego powoduje odmowę, bez fallbacku do check-then-write.
Bezpośrednie execute adaptera PostgreSQL także sprawdza zablokowaną politykę.

Odrzucono: ponowne nieblokujące authorize przed zapisem (pozostawia TOCTOU),
cache decyzji, SERIALIZABLE jako jedyny mechanizm (nie zastępuje granicy uprawnień).
Nie powtarzamy automatycznie callbacku, który mógł wykonać efekt zewnętrzny.
Callback jest zaufanym kodem serwera; musi używać przekazanego tx i nie może wykonywać
sieci ani przechowywać uchwytu transakcji. Przyszłe efekty zewnętrzne wymagają outbox.

Migracje: brak w B; historyczne 0000–0003 bez zmian. A doda role i RLS oraz podpisany,
transakcyjny kontekst; nie uznajemy zwykłych GUC za dowód tożsamości.
C doda trwały audyt odmów poza rollbackiem i atomowy audyt sukcesów.
Ważność czasowa jest oceniana w punkcie decyzji po blokadach; nie obiecujemy
wycofania operacji, która została zautoryzowana przed wygaśnięciem jej grantu.
Krótkie transakcje oraz limity są częścią konfiguracji operacyjnej.

Ryzyka: spójny porządek musi obowiązywać każdy nowy moduł. Zmiany tożsamości i FK,
równoczesne operacje krzyżowe oraz upływ terminu podczas oczekiwania wymagają pełnych
testów PostgreSQL. Scenariusze znajdują się w transactional-authz.integration.ts;
brak izolowanej DB na Hetznerze oznacza nieweryfikowane integracje w tej sesji.
Rollback aplikacji nie usuwa danych; zachować kompatybilność przed scaleniem zależnych PR.

PR #27 jest istniejącym fundamentem i używa historycznej etykiety 6D-3A dla transakcji.
Uzupełniający PR #28 zawiera tylko poprawki opisane w tym ADR. Bieżące polecenie
wyróżnia A = role/RLS, B = transakcje, C = audyt. Dokumenty PR #27 zachowujemy jako historię.
Minimalna walidacja poprawek: 25 testów application, 5 buildera DB, 22 HTTP i 10 client-options;
tsc zmienionych pakietów i testów DB/API oraz lint. Integracje pozostają nieweryfikowane w tej sesji.
