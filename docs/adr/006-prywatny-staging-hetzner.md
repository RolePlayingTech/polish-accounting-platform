# ADR-006 — Przejście z rozwoju lokalnego do prywatnego stagingu na serwerze Hetzner

- **Status:** decyzja architektoniczna dla [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Data:** 2026-10-28
- **Powiązania:** [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [ADR-004](004-model-zagrozen-i-autoryzacji.md), [ADR-005](005-rozwoj-lokalny.md), [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Zakres:** ustalenie warunków architektonicznych i etapowych uruchomienia pierwszego prywatnego środowiska serwerowego (staging) pod kanoniczną domeną `https://ksiegowosc.roleplayingtech.com` bez łamania blokad lokalnych z ADR-005.

## Kontekst

1. [ADR-002](002-stos-technologiczny-i-wdrozenia.md) definiuje docelowy stos technologiczny (Node.js 24 LTS, Next.js, NestJS/Fastify, PostgreSQL 18, Drizzle ORM, OIDC, MCP) oraz docelowy podział środowisk (`Local`, `CI`, `Staging`, `Production`).
2. [ADR-005](005-rozwoj-lokalny.md) słusznie ograniczył bieżący etap implementacji fundamentu DB (`6A`/`6B`/`6D-1`/`6D-R`, migracje `0000–0002`) do pracy lokalnej (`PAP_DATABASE_ENV=local|test`, hosty loopback, odrzucanie `NODE_ENV=production` w `@pap/db`), aby uniknąć przedwczesnego wystawienia nieukończonego modelu uprawnień na serwerze.
3. Właściciel projektu udostępnił istniejący serwer Hetzner (`hetz-1`) ([raport audytu](../HETZNER_SERVER_AUDIT_2026-10-28.md)) oraz ustalił jako jedyny docelowy i kanoniczny adres aplikacji domenę ASCII **`https://ksiegowosc.roleplayingtech.com`** (bez polskich znaków i bez wariantu IDN/Punycode).

Potrzebujemy formalnej decyzji łączącej ADR-002 i ADR-005: jak uruchomić pierwszą prywatną wersję na serwerze Hetzner bezpiecznie, bez obchodzenia zabezpieczeń pakietu `@pap/db` i bez udostępniania nieukończonych funkcji wielopodmiotowych.

## Decyzja

1. **ADR-005 pozostaje domyślnym trybem pracy deweloperskiej:** lokalny rozwój nadal nie wymaga Dockera ani dostępu do serwera Hetzner, a skrypty repozytorium nie wykonują żadnych automatycznych operacji zdalnych.
2. **Jedyna kanoniczna domena aplikacji to `https://ksiegowosc.roleplayingtech.com`:**
   - Nie używamy polskich znaków diakrytycznych ani formy Punycode w DNS, Nginx `server_name`, SAN certyfikatu TLS, skryptach wdrożeniowych i smoke testach, monitoringu HTTPS, nagłówkach `Origin`, ciasteczkach ani przyszłych `redirect_uri` OIDC (`https://ksiegowosc.roleplayingtech.com/...`).
   - Nie konfigurujemy przekierowań z domeny z polskimi znakami.
3. **Wprowadzamy dwuetapowy model prywatnego stagingu na serwerze Hetzner:**
   - **Etap A (Prywatny staging techniczny):** uruchomienie wyłącznie szkieletu `@pap/web` i `@pap/api` (`/`, `/app`, `/health`, `/api/v1/system/status`) za istniejącym Nginx z certyfikatem TLS dla `ksiegowosc.roleplayingtech.com` oraz obowiązkową bramką uwierzytelniającą właściciela na brzegu (HTTP Basic Auth dla całego vhosta bez publicznych wyjątków). Brak kont użytkowników końcowych, brak publicznych operacji na firmach, brak zdalnego MCP, wyłącznie dane syntetyczne.
   - **Etap B (Funkcjonalny staging na danych syntetycznych):** dopuszczony dopiero po ukończeniu, przetestowaniu i odebraniu w osobnych PR pakietów **`6D-R`** (bezpieczny cykl życia członkostw i grantów), **`6D-2`** (serwerowa tożsamość OIDC i egzekwowanie `authorizeCompanyAction` w API) oraz **`6D-3`** (rola runtime DB bez `BYPASSRLS`, PostgreSQL RLS z `FORCE ROW LEVEL SECURITY`, `SET LOCAL` i audyt).
4. **Zakaz obchodzenia walidatorów fałszywymi zmiennymi i zakaz publicznych wyjątków w Basic Auth:**
   - W Etapie A cały vhost Nginx jest chroniony bramką Basic Auth bez wyłączeń dla `/api/v1/system/status`. Komunikacja SSR pomiędzy `@pap/web` a `@pap/api` odbywa się przez przetestowany w osobnym PR ([PR #23](https://github.com/RolePlayingTech/polish-accounting-platform/pull/23)) wyjątek w `readPublicSystemStatus` dopuszczający w `NODE_ENV=production` wyłącznie zamkniętą allowlistę originów (`http://127.0.0.1:4100` używany przez SSR na stagingu w Etapie A oraz `https://ksiegowosc.roleplayingtech.com` dla środowisk bez bramki Basic Auth na `/api/v1/system/status` przy założeniu zaufanej konfiguracji DNS domeny właściciela, z `redirect: 'error'`).
   - Na serwerze stagingowym nie wolno ustawiać `PAP_DATABASE_ENV=local` ani używać kont `pap_local`/`pap_test`.
   - Włączenie bazy PostgreSQL 18 i pełnego łańcucha migracji `0000–0002` na stagingu (podetap A.2 / Etap B) wymaga osobnego, wąskiego PR ([PR #24](https://github.com/RolePlayingTech/polish-accounting-platform/pull/24)) rozszerzającego `packages/db/src/database-config.ts` o jawny profil `PAP_DATABASE_ENV=staging` (wymagający fail-closed `NODE_ENV=production`) z wymogiem loopback (`127.0.0.1`/`::1`), bazy `pap_staging` oraz rozdzielonych ról `pap_staging_migrator` (DDL) i `pap_staging_app` (runtime `NOBYPASSRLS`). Walidacja nazwy użytkownika w `DATABASE_URL` jest kontrolą konfiguracji klienta; egzekwowanie uprawnień `GRANT`/`REVOKE`, `NOBYPASSRLS` i RLS w PostgreSQL należy do inicjalizacji bazy (A.2) i pakietu `6D-3`.
   - Połączenia `PAP_DATABASE_ENV=production` oraz zdalne adresy bazy pozostają nadal zablokowane w kodzie.
5. **Model wykonania, limity zasobów i kopie zapasowe na współdzielonym hoście `hetz-1`:**
   - Ze względu na ograniczoną pamięć RAM (`3.7 GiB` łącznie, `1.7 GiB` użytego swapu) i współistnienie innych usług, budowanie (`pnpm build`) odbywa się wyłącznie w CI (GitHub Actions), a na hoście procesy Web (`127.0.0.1:3100`) i API (`127.0.0.1:4100`) działają jako odizolowane jednostki `systemd` z własnym runtime Node.js `24.22.1` w `/opt/pap-runtime` oraz twardymi limitami `MemoryHigh`/`MemoryMax`, `MemorySwapMax=64M` i `CPUQuota=50%`.
   - Baza PostgreSQL `18.6` działa wyłącznie na `127.0.0.1:5432` (jako kontener `postgres:18.6-alpine` przypięty po SHA256 z limitem pamięci `384m`).
   - Kopie na dodatkowym wolumenie blokowym tego samego hosta służą wyłącznie walidacji odtwarzania syntetycznych danych Etapu A; przed wprowadzeniem jakichkolwiek danych trwałych lub rzeczywistych wymagany jest szyfrowany backup off-host.
6. **Brak automatycznego wdrożenia bez zgody człowieka:** każde wdrożenie na staging wymaga przejścia pełnego CI na chronionej gałęzi `main` oraz ręcznego zatwierdzenia przez właściciela (GitHub Environment `staging` / manual approval).
7. **Przyszła produkcja wymaga osobnego środowiska:** współdzielony serwer `hetz-1` służy wyłącznie jako prywatny staging na danych syntetycznych. Uruchomienie produkcyjne dla rzeczywistych danych księgowych będzie wymagało dedykowanego, odseparowanego środowiska w UE/EOG i osobnej zgody właściciela.

## Konsekwencje

- Możemy szybko i bezpiecznie zweryfikować działanie aplikacji pod docelową domeną `https://ksiegowosc.roleplayingtech.com` w Etapie A, wykorzystując już istniejący i rozpropagowany rekord DNS `A`, nie czekając na pełne ukończenie OIDC i RLS, ponieważ w Etapie A aplikacja jest zamknięta za bramką brzegową i nie przetwarza danych firmowych.
- Zachowujemy pełną dyscyplinę bezpieczeństwa z [ADR-004](004-model-zagrozen-i-autoryzacji.md): żaden użytkownik ani endpoint firmowy nie zostanie wystawiony przed zamknięciem `6D-R`, `6D-2` i `6D-3`.
- Istniejące usługi na serwerze Hetzner pozostają w pełni odizolowane i bezpieczne.
