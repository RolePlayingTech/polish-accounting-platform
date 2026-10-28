# ADR-006 — Przejście z rozwoju lokalnego do prywatnego stagingu na serwerze Hetzner

- **Status:** propozycja do przeglądu w PR dla [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Data:** 2026-10-28
- **Powiązania:** [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [ADR-004](004-model-zagrozen-i-autoryzacji.md), [ADR-005](005-rozwoj-lokalny.md), [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Zakres:** ustalenie warunków architektonicznych i etapowych uruchomienia pierwszego prywatnego środowiska serwerowego (staging) bez łamania blokad lokalnych z ADR-005.

## Kontekst

1. [ADR-002](002-stos-technologiczny-i-wdrozenia.md) definiuje docelowy stos technologiczny (Node.js 24 LTS, Next.js, NestJS/Fastify, PostgreSQL 18, Drizzle ORM, OIDC, MCP) oraz docelowy podział środowisk (`Local`, `CI`, `Staging`, `Production`).
2. [ADR-005](005-rozwoj-lokalny.md) słusznie ograniczył bieżący etap implementacji fundamentu DB (`6A`/`6B`/`6D-1`) do pracy lokalnej (`PAP_DATABASE_ENV=local|test`, hosty loopback, odrzucanie `NODE_ENV=production` w `@pap/db`), aby uniknąć przedwczesnego wystawienia nieukończonego modelu uprawnień na serwerze.
3. Właściciel projektu udostępnił istniejący serwer Hetzner (`hetz-1`) do audytu odczytowego ([raport audytu](../HETZNER_SERVER_AUDIT_2026-10-28.md)) oraz wskazał docelową domenę `księgowość.roleplayingtech.com` (`xn--ksigowo-c5a1nq1a.roleplayingtech.com`) w celu przygotowania pierwszego, prywatnego uruchomienia aplikacji.

Potrzebujemy formalnej decyzji łączącej ADR-002 i ADR-005: jak uruchomić pierwszą prywatną wersję na serwerze Hetzner bezpiecznie, bez obchodzenia zabezpieczeń pakietu `@pap/db` i bez udostępniania nieukończonych funkcji wielopodmiotowych.

## Decyzja

1. **ADR-005 pozostaje domyślnym trybem pracy deweloperskiej:** lokalny rozwój nadal nie wymaga Dockera ani dostępu do serwera Hetzner, a skrypty repozytorium nie wykonują żadnych automatycznych operacji zdalnych.
2. **Wprowadzamy dwuetapowy model prywatnego stagingu na serwerze Hetzner:**
   - **Etap A (Prywatny staging techniczny):** uruchomienie wyłącznie szkieletu `@pap/web` i `@pap/api` (`/app`, `/health`, `/api/v1/system/status`) za istniejącym Nginx z certyfikatem TLS dla domeny IDN `xn--ksigowo-c5a1nq1a.roleplayingtech.com` oraz obowiązkową bramką uwierzytelniającą właściciela na brzegu (HTTP Basic Auth / allowlista). Brak kont użytkowników końcowych, brak publicznych operacji na firmach, brak zdalnego MCP, wyłącznie dane syntetyczne.
   - **Etap B (Funkcjonalny staging na danych syntetycznych):** dopuszczony dopiero po ukończeniu, przetestowaniu i odebraniu w osobnych PR pakietów **`6D-R`** (bezpieczny cykl życia członkostw i grantów), **`6D-2`** (serwerowa tożsamość OIDC i egzekwowanie `authorizeCompanyAction` w API) oraz **`6D-3`** (rola runtime DB bez `BYPASSRLS`, PostgreSQL RLS z `FORCE ROW LEVEL SECURITY`, `SET LOCAL` i audyt).
3. **Zakaz obchodzenia walidatora `loadDatabaseConfig` fałszywymi zmiennymi:**
   - Na serwerze stagingowym nie wolno ustawiać `PAP_DATABASE_ENV=local` ani używać kont `pap_local`/`pap_test`.
   - Włączenie bazy PostgreSQL 18 na stagingu (podetap A.2 / Etap B) wymaga osobnego, wąskiego PR rozszerzającego `packages/db/src/database-config.ts` o jawny profil `PAP_DATABASE_ENV=staging` z wymogiem loopback (`127.0.0.1`/`::1`), bazy `pap_staging` oraz rozdzielonych ról `pap_staging_migrator` (DDL) i `pap_staging_app` (runtime `NOBYPASSRLS`).
   - Połączenia `PAP_DATABASE_ENV=production` oraz zdalne adresy bazy pozostają nadal zablokowane w kodzie.
4. **Model wykonania na współdzielonym hoście `hetz-1`:**
   - Ze względu na ograniczoną pamięć RAM (`3.7 GiB`) i współistnienie innych usług, budowanie (`pnpm build`) odbywa się wyłącznie w CI (GitHub Actions), a na hoście procesy Web (`127.0.0.1:3100`) i API (`127.0.0.1:4100`) działają jako odizolowane jednostki `systemd` z własnym runtime Node.js `24.22.1` w `/opt/pap-runtime`.
   - Baza PostgreSQL `18.6` działa wyłącznie na `127.0.0.1:5432` (jako kontener `postgres:18.6-alpine` przypięty po SHA256 lub pakiet PGDG `postgresql-18`).
5. **Brak automatycznego wdrożenia bez zgody człowieka:** każde wdrożenie na staging wymaga przejścia pełnego CI na chronionej gałęzi `main` oraz ręcznego zatwierdzenia przez właściciela (GitHub Environment `staging` / manual approval).
6. **Przyszła produkcja wymaga osobnego środowiska:** współdzielony serwer `hetz-1` służy wyłącznie jako prywatny staging na danych syntetycznych. Uruchomienie produkcyjne dla rzeczywistych danych księgowych będzie wymagało dedykowanego, odseparowanego środowiska w UE/EOG i osobnej zgody właściciela.

## Konsekwencje

- Możemy szybko i bezpiecznie zweryfikować działanie aplikacji pod docelową polską domeną IDN (`księgowość.roleplayingtech.com`) w Etapie A, nie czekając na pełne ukończenie OIDC i RLS, ponieważ w Etapie A aplikacja jest zamknięta za bramką brzegową i nie przetwarza danych firmowych.
- Zachowujemy pełną dyscyplinę bezpieczeństwa z [ADR-004](004-model-zagrozen-i-autoryzacji.md): żaden użytkownik ani endpoint firmowy nie zostanie wystawiony przed zamknięciem `6D-R`, `6D-2` i `6D-3`.
- Istniejące usługi na serwerze Hetzner pozostają w pełni odizolowane i bezpieczne.
