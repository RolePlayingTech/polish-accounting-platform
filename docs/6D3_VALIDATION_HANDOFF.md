# Security Foundation 6D-3 — przekazanie walidacji

Data: 2026-10-29. Status: kompletna implementacja kandydacka w Draft PR,
**bez pełnego odbioru, bez migracji/deploymentu stagingu i bez merge**.
Issue #6 pozostaje otwarte. Nie dopuszczać danych rzeczywistych ani endpointów firm
przed wymaganymi testami PostgreSQL i niezależnym code/security review.

## Repozytorium i zależności

| Część | PR / gałąź | Stan |
| --- | --- | --- |
| Polityka CI, środowiska i handoff | #29 (`00fb64f`), #26 (`566d9ad`), #32 (`9e62b9a`) → `main` (`9e62b9a5881cd38b2e2a9b874d73b44078f16bf3`) | Scalone do `main` |
| Istniejąca transakcyjna implementacja | #27, `feat/issue-6d3a-transactional-authz`, `1281027a126b09f934894cde5fe43dc01a7b3e3b` (wcześniejszy: `918b6c148cce77b13cb0ee2770f763e4bba42176`) | Baza `main` (`9e62b9a`); konflikty z `main` rozwiązane |
| B: domknięcie ścieżek transakcyjnych | #28, `codex/6d3b-transactional-authorization`, `5d2a4c5c4d37219988310c787544352f89c794b0` (wcześniejszy: `0d1c54c25504b1dea79e3c6fe51bd6578d94710c`, kod: `db31f508140cce2a9a1549bf54da44943acbebe9`) | Baza #27 (`1281027`) |
| A: role, podpis i RLS | #30, `codex/6d3a-runtime-rls`, `edad9f7f0d1c67da4a57f47454295a0d459322ec` (wcześniejszy: `8a7d34635dcd8592479065267e3a085d5f213a42`) | Baza #28 (`5d2a4c5`) |
| C: audyt i hardening | #31, `codex/6d3c-security-audit`, merge `d2bf07824d1f87c2fe6e1c6fc244b412ffb4ad26` (wcześniejszy: `f916385b1b06c29666267182fb70a1a425bc858a`, kod: `23ed1b9f406d0cc14db235e1dbfa7deea07a4d3f`) | Baza #30 (`edad9f7`); końcowy SHA z dokumentacją w opisie PR #31 |

Numeracja istniejącego #27 jest historyczna: nazywa transakcje 6D-3A. W bieżącym
poleceniu A oznacza role/RLS, B transakcje, C audyt.

Na `main` scalono kolejno #29 (`00fb64f` — tymczasowe CI na Hetznerze bez automatycznych
GitHub Actions), #26 (`566d9ad` — środowiska Hetzner i polityka walidacji) oraz #32
(`9e62b9a` — GitHub jako źródło prawdy i handoff). Nie uruchamiać `workflow_dispatch`/rerun
i nie oczekiwać statusów GitHub. Cały stos `#27 → #28 → #30 → #31` zsynchronizowano
bez force-push z `main` (`9e62b9a`), rozwiązując konflikty dokumentacyjne w
`docs/19-przewodnik-developera.md` i `docs/20-strategia-testow.md` (w tym przywracając
pełny opis zakresu 6D-3A z #27 obok polityki CI z #29/#26); diff `.github/workflows/ci.yml`
względem `main` jest pusty na każdej gałęzi stosu. Porównanie drzew `apps/`, `packages/`,
`test/`, `package.json`, `pnpm-lock.yaml` i `.env.example` potwierdziło zerowy diff kodu
względem wcześniejszych SHA (`918b6c1`, `0d1c54c`, `8a7d346`, `f916385`); pełnych testów,
buildów ani migracji nie uruchamiano podczas tej integracji. Równoległe review
bezpieczeństwa może odnosić się do wcześniejszych SHA powyżej.

Przeczytaj ADR-007/008/009, docs/27-runtime-security-6d3a.md i docs/28-security-audit-6d3c.md.
Uchwyty tx i signer są zaufanym kodem serwera, nigdy wejściem REST/MCP.
Publiczny AppModule i MCP nadal nie udostępniają danych/operacji księgowych.

## Co zostało zaimplementowane

- Jedna TX READ COMMITTED: konto i konkretne OIDC → zablokowane członkostwa → firma
  → granty → polityka → operacja → audyt → COMMIT. Odmowa wykonuje fizyczny rollback.
- Kanoniczna kolejność członkostw po user_id; actor SHARE, target UPDATE; granty
  po user_id/grant_id. Bez fallbacku check-then-write i bez obejścia przez execute.
- Podpis HMAC z xid8, backendem, session_user, bazą, zakresem i TTL 30 s. GUC bez
  podpisu oraz podpis z innej TX nie uprawnia do odczytu. Klucz niedostępny runtime SQL.
- Migracje 0004 i 0005; 0000–0003 bez zmian. 11 tabel z ENABLE/FORCE RLS, przypięte
  search_path definerów, bootstrap/ACL/klucz poza automatycznym startem/migracją.
- Syntetyczny, idempotentny company_operation_probe jako przykład chronionego zapisu.
- Allow i efekt w jednej TX; deny oraz potwierdzony rollback zapisane po jej zakończeniu osobną TX;
  utrata potwierdzenia COMMIT / niepotwierdzony rollback klasyfikowana jako `outcome_unknown` (SEC-03).
  Dokładny payload audytu jest podpisany osobno. Audit writer ma allowlistę pól/kodów.
- Constraint triggers wymagają audytu runtime mutacji na COMMIT. Runtime nie czyta
  globalnego audytu, nie modyfikuje ani nie usuwa wpisów i nie ma TRUNCATE/DDL/trigger bypass.
- Obsługa HTTP korelacji, audytu preflight/transport, 503 przy awarii audytu oraz przy niepewnym wyniku TX.

## Minimalne testy wykonane w sesji

Środowisko: Windows, Node 24.22.1 z istniejącego runtime, pnpm 12.15.0 z cache;
zależności zainstalowane offline, bez nowych usług systemowych.
Wyniki dotyczą kodu kandydackiego; kolejne zmiany dokumentacji nie zmieniają kodu.

| Zakres | Wynik |
| --- | --- |
| B application (transactional-unit-of-work + access-management) | 25/25 PASS |
| B DB builder lifecycle, client-options i pipeline HTTP | 5/5, 10/10, 22/22 PASS |
| A podpis, konfiguracja, pliki migracji, client-options, adapter faktów, resolver | 54/54 PASS |
| A builder lifecycle po cache zablokowanych faktów | 5/5 PASS |
| C application (transactional-unit-of-work + access-management) | 26/26 PASS |
| C oidc-authentication | 7/7 PASS przed końcowymi zmianami dokumentacji |
| C DB writer audytu | 2/2 PASS |
| C statyczny kontrakt migracji/metadanych | 4/4 PASS |
| C pipeline HTTP z awarią audytu i brakiem tokenu w śladzie | 23/23 PASS |
| TypeScript application/db/api oraz testy db/api | PASS |
| Lint zmienionych modułów, format, git diff --check | PASS |
| SQL | Ocena statyczna/metadane; **nie jest to wykonanie migracji** |

Testów nie powtarzano po zmianach, które ich nie dotyczyły. Nie uruchamiano pełnego
pnpm test, build, E2E, skanowania całej historii/dependency audit ani pełnej kampanii.
Dokładne lokalne komendy używały node na tsc/vitest/eslint z workspace; równoważne
polecenia pnpm są poniżej. SHA odbioru odczytać z końcowej gałęzi, nie z historycznego
zielonego CI #27.

## Hetzner — ustalenia i wymagania

Odczytowo sprawdzono ssh hetzner: Web/API aktywne, brak psql w PATH, brak listenera
5432 i załadowanych usług PostgreSQL/testowych, brak kontenera PG/testowego w docker
ps -a. Nie potwierdzono żadnego wydzielonego środowiska DB. RAM około 3.7 GiB,
około 2.3 GiB dostępne podczas pierwszej kontroli, root około 84% zajęty.
Nie zmieniono usług, danych, Nginx, DNS, certyfikatów, firewalla ani stagingu.

**Blocker walidacji:** trzeba uprzednio wydzielić środowisko testowe; ta sesja go
nie tworzyła. Wymagania do odrębnej decyzji/przygotowania:

- Nietrwała, dedykowana instancja PostgreSQL 18 zgodna z pinem repo (18.6),
  na loopback, bez danych aplikacji i bez dostępu do produkcji.
- Limity zgodne z ADR stagingu: PG najwyżej 384 MiB RAM, bez wzrostu swapu,
  0.5 CPU; niskie max_connections/work_mem. Zweryfikować bieżące zasoby przed startem.
- Świeża pap_test bez zastanego btree_gist/pgcrypto i bez pap_test_app.
  Nie uruchamiać wcześniej db:migrate na bazie pełnej kampanii: harness tworzy namespace.
- Konto fixture pap_test z uprawnieniem tworzenia własnego namespace/rozszerzeń/roli
  testowej i ustawienia deadlock_timeout. Historyczny runner używał superusera wyłącznie
  w świeżym klastrze. Rzeczywisty testowany login pap_test_app jest odrębny i bez
  SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION/własności/członkostw.
- Osobny test migratora NOSUPERUSER/NOBYPASSRLS jako właściciela DB/tabel jest
  obowiązkowy: potwierdzi FORCE oraz jawną politykę właściciela i działanie definerów.
- Zależności/artfakty przygotowane poza współdzielonym Hetznerem. Nie wykonywać tam
  pełnego builda; użyć gotowych zależności application/domain/contracts lub osobnego,
  zatwierdzonego runnera z odpowiednimi limitami.
- Ograniczyć timeouty całej kampanii, logi i równoległość. Testy DB mają fileParallelism=false.
  Posprzątać tylko zasoby utworzone przez test. Nigdy nie usuwać zastanej roli/schematu,
  rozszerzenia, bazy ani danych w celu „naprawienia” fixture.

Nie używać pap_staging ani jej kont/sekretów. Dane wyłącznie syntetyczne.
Nie wysyłać materiałów do KSeF, urzędów ani banków.

## Komendy odbioru

Po checkout końcowej gałęzi i przygotowaniu zależności poza hostem współdzielonym:

```bash
git rev-parse HEAD
node --version
pnpm --version
pnpm --filter @pap/application typecheck
pnpm --filter @pap/db typecheck
pnpm --filter @pap/api typecheck
pnpm --filter @pap/application exec vitest run --config ../../vitest.config.ts test/transactional-unit-of-work.test.ts test/access-management.test.ts test/oidc-authentication.test.ts
pnpm --filter @pap/db exec vitest run --config ../../vitest.config.ts test/security-audit.test.ts test/signed-context.test.ts test/database-config.test.ts test/migration-files.test.ts
pnpm --filter @pap/api exec vitest run --config ../../vitest.config.ts test/oidc-authorization-pipeline.test.ts
```

Na wyłącznie przygotowanej, izolowanej pap_test, ze zmiennymi w chronionym kanale,
bez wypisywania DATABASE_URL lub haseł:

```bash
# PAP_DATABASE_ENV=test
# DATABASE_URL: dedykowany testowy login pap_test na loopback, wyłącznie fixture
pnpm --filter @pap/db exec vitest run --config vitest.integration.config.ts test/runtime-security.integration.ts
pnpm --filter @pap/db exec vitest run --config vitest.integration.config.ts test/transactional-authz.integration.ts
pnpm test:integration
```

Po celowanych próbach pełna regresja JEDEN raz na końcowym SHA w zatwierdzonym
środowisku; nie powtarzać identycznej kampanii bez unieważnienia wyniku:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:arch
# build / Playwright / audit zależności na runnerze o zatwierdzonych zasobach,
# nie pełny build na współdzielonym Hetznerze:
pnpm build
pnpm test:e2e
pnpm audit --audit-level high
```

pnpm test obejmuje już test:arch; oddzielne wywołanie wyłącznie przy potrzebie diagnozy.
Nie uruchamiać Actions. Wyniki zapisać z SHA, wersją PG, izolacją, komendą i pominięciami.

## Obowiązkowe scenariusze PG i próby obejścia

1. Migracje od zera, powtórzenie, upgrade 0000–0003 → 0004 → 0005, rollback błędu,
   zgodność snapshotów/journal i brak kwalifikatorów omijających namespace.
2. Rzeczywisty runtime login, nigdy SET ROLE z sesji superusera. Brak dostępu bez
   kontekstu, pusty/niepoprawny kontekst, fałszywe GUC, błędny MAC i klucz, wygasłe TTL.
3. Replay na tym samym połączeniu w nowej TX, innym backendzie, innej bazie i roli;
   rollback, wyjątek SQL, savepoint, maxConnections=1 i większa pula.
4. Cross-tenant oraz firma A → inna firma tego samego tenanta, także gdy aktor ma
   grant do obu: asercja A nie ujawnia danych/grantów B. Odczyt i zapis.
5. Runtime nie tworzy tabel/schematów/TEMP, nie wyłącza RLS/triggerów, nie zmienia
   session_replication_role, nie przyjmuje roli migratora, nie czyta kluczy/rejestru.
   Zbadać również zastane granty kolumnowe, PUBLIC i uprawnienia SET parametrów.
6. SECURITY DEFINER: właściciel, NOBYPASSRLS, bezpieczny search_path, brak publicznego
   EXECUTE, shadowing nazw/operatorów/temp, brak szerszego wyniku niż podpisany scope.
7. TOCTOU: revoke/grant/reactivate, wyłączenie konta, cofnięcie konkretnego OIDC,
   oba porządki UUID i krzyżowe operacje. Bariery + pg_blocking_pids, nie przypadkowe sleep.
8. Temporalność: grant/membership przyszły, wygasły, cofnięty; wygaśnięcie podczas
   oczekiwania na blokadę; zegar po blokadach. Autoryzacja ma punkt linearyzacji,
   nie obiecuje anulowania operacji tylko dlatego, że termin minął już po decyzji.
9. Bezpośrednie execute/executeAuthorized nie omijają polityki. Fałszowanie kind,
   grantId, dat, roli, aktora i tenant/company w SQL nie zmienia zatwierdzonej komendy.
10. Atomowość i niepewność zakończenia TX (SEC-03): brak audytu na COMMIT, awaria jego
    INSERT oraz awaria samej operacji przed COMMIT z potwierdzonym `ROLLBACK` wycofują efekt
    i zapisują `allow/rolled_back`. Zerwanie połączenia lub utrata potwierdzenia po wejściu
    w fazę `COMMIT` (np. `08007` / zamknięcie gniazda po zatwierdzeniu po stronie PG)
    zwraca fail-closed `transaction_outcome_unknown` (HTTP 503), **nigdy** nie zapisuje
    fałszywego `rolled_back`, nie ponawia automatycznie callbacku, a przy ponowieniu z tym
    samym `operationId` zachowuje idempotencję (jeden efekt i spójny ślad audytu).
11. Idempotencja: powtórzenie potwierdzenia, konflikt payload/aktora/firmy, retry po
    utracie uprawnień oraz ponowienie po `transaction_outcome_unknown`; jeden efekt /
    `access_management_event` i osobne decyzje.
12. Audyt: realny serwerowy aktor, preflight vs committed vs denied / rolled_back /
    outcome_unknown, request/operation/FK (`outcome_unknown` zawsze z `access_management_operation_id IS NULL`),
    append-only, brak możliwości samodzielnego INSERT bez podpisu, brak tokenów/sekretów/dokumentów/SQL
    w DB, HTTP i logach błędów.

## Ryzyka i miejsca review

- SQL/RLS i nowe migracje nie były wykonane w tej sesji. To materialny blocker odbioru.
- HMAC nie broni przed przejęciem procesu z kluczem, migratora lub administratora.
  Dowolny SQL wewnątrz już zautoryzowanej TX pozostaje ograniczony jej podpisanym zakresem;
  parametryzacja, krótkie callbacki i review są nadal konieczne.
- Dedykowana baza musi mieć kontrolowanych właścicieli/grantee CREATE. Audyt katalogów
  ma sprawdzić także dodatkowe role, procedury i niestandardowe granty w pg_catalog.
- Polityki wielokrotnie weryfikują MAC; po poprawności ocenić koszt i plany. Nie
  wprowadzać cache decyzji kosztem aktualności.
- Awaria całej DB uniemożliwia trwały audyt odmowy. System wtedy odmawia; nie ma
  gwarancji exactly-once delivery audytu podczas awarii infrastruktury.
- Brak UI audytu/retencji/alertów i limitowania ataków na audyt; to przyszły zakres
  przed udostępnieniem, nie działająca platforma produkcyjna.
- Zaktualizować wszystkie nowe moduły o RLS/ACL i wymóg audytu przy COMMIT.
  Callback musi używać przekazanego tx, nie osobnego db/połączenia ani sieci.

## Nadal niewykonane

**NOT RUN:** wszystkie migracje i testy PostgreSQL/RLS/ACL/TOCTOU w tej sesji,
pełna regresja, pełny build, Playwright, niezależny security review, odbiór
operacyjny rotacji kluczy i migratora NOSUPERUSER. Nie ma deklaracji bezpieczeństwa
produkcyjnego. Kandydat jest gotowy do przekazania i wymagającej walidacji, nie do merge.
