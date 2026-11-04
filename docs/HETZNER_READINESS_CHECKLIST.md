# Checklista gotowości (Go / No-Go) dla środowiska Hetzner

> Aktualny stan (2026-10-29): [PR #23](https://github.com/RolePlayingTech/polish-accounting-platform/pull/23) i [PR #24](https://github.com/RolePlayingTech/polish-accounting-platform/pull/24) są scalone na `main`, a prywatny staging techniczny Etapu A (`@pap/web` i `@pap/api` za HTTPS i HTTP Basic Auth, bez uruchomionego PostgreSQL `pap_staging`) działa pod `https://ksiegowosc.roleplayingtech.com`. Automatyczne GitHub Actions jest tymczasowo wyłączone na rzecz izolowanego CI na Hetznerze ([ADR-006](adr/006-tymczasowe-ci-hetzner.md)). Poniższa checklista z `2026-10-28` pozostaje zapisem historycznym; podetap A.2 oraz Etap B nadal wymagają osobnej zgody właściciela, a Etap B dodatkowo pełnego odbioru kandydata `6D-3` ([plan QA 6D-3](6D3_SECURITY_QA_ACCEPTANCE_PLAN.md)).

- **Data:** 2026-10-28
- **Powiązane zadanie:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19), [Audyt serwera Hetzner](HETZNER_SERVER_AUDIT_2026-10-28.md), [Architektura stagingu](HETZNER_STAGING_ARCHITECTURE.md), [Plan wdrożenia](HETZNER_DEPLOYMENT_PLAN.md)
- **Docelowa domena (jedyna kanoniczna):** `https://ksiegowosc.roleplayingtech.com`
- **Przeznaczenie:** Jednoznaczne kryteria odbiorowe (Go/No-Go) oraz lista decyzji wymagających wyraźnej zgody właściciela przed pierwszym uruchomieniem aplikacji na serwerze.

---

## 1. Status decyzji przygotowawczych i działania wymagające zgody właściciela na start

- [x] **Decyzja 0 (Bezpieczeństwo hosta / Hetzner Cloud Firewall — ZREALIZOWANE):** Właściciel usunął w `firewall-1` regułę inbound `TCP 3001`. Zweryfikowano z zewnątrz (`[Potwierdzone]`), że porty `3001`, `3002`, `3003` i `5174` są zablokowane dla ruchu z internetu (`FILTERED / TIMEOUT`), a otwarte pozostają wyłącznie `TCP 22`, `80` i `443`.
- [x] **Decyzja 1 (Docelowa domena i DNS — ZREALIZOWANE):** Właściciel ustalił jako jedyny kanoniczny adres `https://ksiegowosc.roleplayingtech.com` (bez polskich znaków i bez Punycode). Rekord DNS `A` dla `ksiegowosc.roleplayingtech.com` jest aktywny na autorytatywnych serwerach DNS i publicznych resolverach oraz wskazuje na adres IPv4 serwera `hetz-1` (`[Potwierdzone na serwerze]`).
- [x] **Decyzja 2 i 4 (Przygotowanie izolowanego środowiska `pap-staging` bez uruchamiania usług — ZREALIZOWANE):** Utworzono konto `pap`, katalogi `/opt/pap-runtime` (`/opt/pap-runtime/current -> /opt/pap-runtime/node-v24.22.1-linux-x64` z Node.js `v24.22.1` + `/opt/pap-runtime/pnpm/pnpm` z `pnpm 12.15.0`), `/var/www/pap-staging` (`releases/`, `shared/next-cache/`, `bin/`), `/etc/pap` (`pap-staging-api.env`, `pap-staging-web.env`, `pap-staging-db-runtime.env.example`, `pap-staging-migrate.env.example`), `/var/lib/pap-acme` (`0750 root:www-data`), `/mnt/HC_Volume_<REDACTED>/pap-staging` (`0700 root:root`), nieaktywne jednostki `systemd`, nieaktywne konfiguracje Nginx dla `ksiegowosc.roleplayingtech.com` (`auth_basic_user_file /etc/nginx/pap-staging.htpasswd;`, `root /var/lib/pap-acme;`) oraz skrypty wdrożeniowe (`pap-deploy-release.sh <release-sha-or-id> <path-to-release-tarball.tar.gz>`), rollbacku, smoke testów i pre-flight check.
- [ ] **Decyzja 3 (Review i merge PR-ów przygotowawczych):**
  - [PR #23](https://github.com/RolePlayingTech/polish-accounting-platform/pull/23) — bezpieczna komunikacja Web–API przez `http://127.0.0.1:4100` i aktualizacja konfiguracji domeny `ksiegowosc.roleplayingtech.com` (wymagany dla Etapu A.1).
  - [PR #24](https://github.com/RolePlayingTech/polish-accounting-platform/pull/24) — jawny profil `PAP_DATABASE_ENV=staging` (fail-closed `NODE_ENV=production`) z rozdziałem ról migratora i runtime (wymagany przed uruchomieniem bazy w Etapie A.2).
- [ ] **Decyzja 5 (Zgoda na pierwsze uruchomienie Etapu A):** Jawna zgoda właściciela na:
  1. Utworzenie pliku `/etc/nginx/pap-staging.htpasswd` (`0640 root:www-data`),
  2. Wystawienie certyfikatu Let's Encrypt wyłącznie dla `-d ksiegowosc.roleplayingtech.com`,
  3. Aktywację vhosta `/etc/nginx/sites-enabled/pap-staging.conf` i `sudo systemctl reload nginx`,
  4. Wdrożenie artefaktu wydania z `main` i uruchomienie usług `pap-staging-api.service` (`127.0.0.1:4100`) oraz `pap-staging-web.service` (`127.0.0.1:3100`).
- [ ] **Decyzja 6 (Ochrona gałęzi `main`):** Włączenie Branch Ruleset dla gałęzi `main` w repozytorium GitHub (`Require pull request`, `Require status checks: db-integration, checks, secrets`, `Block force pushes`).
- [ ] **Decyzja 7 (Porządki na serwerze — opcjonalne, poza zakresem PAP):** Osobna decyzja właściciela, czy i kiedy zatrzymać nieużywany lokalny proces `python3 -m http.server 3001` (PID `3460`, już odcięty od internetu przez `firewall-1`) oraz czy wyłączyć nieaktualne odnowienia certyfikatów `app.mumro.io` i `roleplayingtech.com-0001` naprawiające globalny status `certbot.service`.

---

## 2. Bramka Go / No-Go — Etap A (Prywatny staging techniczny)

Wdrożenie Etapu A pod adresem `https://ksiegowosc.roleplayingtech.com` może nastąpić **wyłącznie wtedy**, gdy wszystkie poniższe punkty są spełnione:

### 2.1. Warunki wstępne (Przed startem usług)
- [ ] **Właściciel udzielił jawnej zgody** na uruchomienie Etapu A i zmergował [PR #23](https://github.com/RolePlayingTech/polish-accounting-platform/pull/23).
- [x] Rekord DNS `A` dla `ksiegowosc.roleplayingtech.com` rozwiązuje się na adres IPv4 serwera Hetzner (`<HETZNER_IPV4>`) **[Potwierdzone na serwerze]**.
- [x] Katalog `/var/lib/pap-acme/.well-known/acme-challenge` ma uprawnienia `0750 root:www-data` (brak prawa zapisu dla `www-data`), a skrypt `/var/www/pap-staging/bin/pap-preflight-check.sh` zwraca status `INFRASTRUCTURE PREPARED (awaiting PR merge & owner approval for launch)` **[Potwierdzone na serwerze]**.
- [x] Na serwerze jest minimum `5 GiB` wolnego miejsca na `/` (obecnie `15 GiB` **[Potwierdzone na serwerze]**) oraz minimum `10 GiB` na wolumenie dodatkowym (obecnie `24 GiB` **[Potwierdzone na serwerze]**), a dostępna pamięć RAM przekracza `1.5 GiB` (obecnie `2.3 GiB` przy `1.7 GiB` użytego swapu **[Potwierdzone na serwerze]**).
- [x] Porty `127.0.0.1:3100`, `127.0.0.1:4100` oraz `127.0.0.1:5432` są wolne przed uruchomieniem (`ss -lntup`) **[Potwierdzone na serwerze]**.
- [ ] Wszystkie testy w CI na gałęzi `main` (`lint`, `format:check`, `typecheck`, `test`, `test:arch`, `db-integration`, `test:e2e`, `audit`, `gitleaks`) mają status **PASS**.

### 2.2. Weryfikacja bezpieczeństwa, TLS i zasobów po uruchomieniu Etapu A
- [ ] Test odczytu pliku kontrolnego HTTP (`curl --fail http://ksiegowosc.roleplayingtech.com/.well-known/acme-challenge/healthcheck.txt`) zakończył się sukcesem przed uruchomieniem Certbota.
- [ ] Procesy `pap-staging-web` i `pap-staging-api` działają na koncie nieuprzywilejowanym `pap` z aktywnymi flagami `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true` oraz twardymi limitami `MemoryHigh=256M`, `MemoryMax=384M`, `MemorySwapMax=64M` i `CPUQuota=50%`.
- [ ] Polecenie `ss -lntp | grep -E ':(3100|4100|5432)\b'` potwierdza nasłuch **wyłącznie na `127.0.0.1`**, nigdy na `0.0.0.0` ani `[::]`.
- [ ] Niezalogowane żądanie z zewnątrz (`curl -i https://ksiegowosc.roleplayingtech.com/`, `/app`, `/api/v1/system/status` oraz `/health`) zwraca **`401 Unauthorized`** (cały vhost Nginx chroniony bramką Basic Auth, bez publicznych wyjątków).
- [ ] Uwierzytelnione żądanie właściciela zwraca `200 OK`, prawidłowy certyfikat TLS dla `ksiegowosc.roleplayingtech.com`, nagłówki `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` oraz `X-Robots-Tag: noindex, nofollow, noarchive`.
- [ ] Celowany test odnowienia certyfikatu `sudo certbot renew --cert-name ksiegowosc.roleplayingtech.com --dry-run` kończy się kodem `0`, a kontrola `openssl s_client -connect 127.0.0.1:443 -servername ksiegowosc.roleplayingtech.com ... -checkend $((21 * 86400))` potwierdza ważność certyfikatu i niezależność monitoringu od globalnego stanu `certbot.service`.
- [ ] Pomiar po starcie (`/var/www/pap-staging/bin/pap-monitor-resources.sh`) potwierdza, że łączny RSS usług PAP mieści się w założonym budżecie (`<= 600 MiB`), `MemAvailable >= 1.2 GiB`, a `SwapUsed` nie rośnie.
- [ ] Żadna z istniejących usług na serwerze (`durnoty.service`, `mumro-articles.service`, `swiadek-dziejow-articles.service`, `social-media-manager.service`, PM2 `historia-technologii` i `mfc-backend`, kontenery `shorts-api` i `reels-api`) nie została zrestartowana ani nie zmieniła stanu.

### 2.3. Dodatkowe warunki dla podetapu A.2 (Baza PostgreSQL 18 na stagingu)
- [ ] Scalono i zweryfikowano w CI [PR #24](https://github.com/RolePlayingTech/polish-accounting-platform/pull/24) rozszerzający `packages/db/src/database-config.ts` o jawny tryb `PAP_DATABASE_ENV=staging` z rozdziałem ról `pap_staging_migrator` i `pap_staging_app`.
- [ ] Rola `pap_staging_app` posiada atrybuty `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` i nie jest właścicielem bazy ani tabel.
- [ ] Migracje `0000_technical-baseline.sql`, `0001_tenant-schema.sql` (`btree_gist`) oraz `0002_access-lifecycle.sql` wykonały się bez błędów z konta `pap_staging_migrator`.
- [ ] Wykonano próbny backup (`/var/www/pap-staging/bin/pap-db-backup.sh`) i zakończono sukcesem test odtworzenia (`/var/www/pap-staging/bin/pap-db-restore-drill.sh`) do tymczasowej bazy weryfikacyjnej.

---

## 3. Bramka Go / No-Go — Etap B (Funkcjonalny staging z kontami i syntetycznymi firmami)

Przejście z Etapu A do Etapu B (udostępnienie logowania użytkowników i operacji na firmach syntetycznych) jest **zablokowane (NO-GO)**, dopóki nie zostaną spełnione wszystkie poniższe kryteria:

- [ ] **Zamknięta blokada `6D-R`:** wdrożony i przetestowany na PostgreSQL 18 bezpieczny cykl życia członkostw i grantów (cofnięcie członkostwa trwale unieważnia wszystkie granty użytkownika w tenancie; ponowna aktywacja członkostwa **nie przywraca** dawnych grantów).
- [ ] **Zamknięty pakiet `6D-2`:** wdrożona serwerowa weryfikacja OIDC (`iss`, `aud`, `exp`, `nbf`, `sub`) z `redirect_uri` na kanonicznej domenie `https://ksiegowosc.roleplayingtech.com`, mapowanie `(issuer, subject) -> userId` oraz obowiązkowe wywołanie `authorizeCompanyAction` w API.
- [ ] **Zamknięty pakiet `6D-3`:** włączone `ROW LEVEL SECURITY` oraz `FORCE ROW LEVEL SECURITY` na tabelach tenantowych, transakcyjny kontekst `SET LOCAL` (`set_config(..., true)`), testy negatywne braku przecieku kontekstu przy współbieżnym użyciu puli połączeń oraz audyt decyzji autoryzacyjnych fail-closed.
- [ ] **Testy negatywne end-to-end:** potwierdzona automatycznymi testami odmowa (`403`/`404` bez ujawnienia istnienia zasobu) przy próbie:
  - odczytu firmy `B1` z tenanta `B` przez użytkownika tenanta `A`,
  - odczytu firmy `A2` przez członka tenanta `A` posiadającego grant wyłącznie do `A1`,
  - wykonania akcji `write` z grantem `read`,
  - użycia konta `tenant_admin` / `tenant_owner` bez jawnego grantu do firmy,
  - użycia tokenu po cofnięciu członkostwa lub grantu.

---

## 4. Warunki natychmiastowego zatrzymania (Stop Conditions / Scenariusze negatywne)

Wdrożenie należy **natychmiast przerwać i wycofać**, jeżeli wystąpi którykolwiek z poniższych przypadków:

1. **Błąd testu konfiguracji Nginx (`sudo nginx -t` != 0):** zakaz przeładowywania Nginx; usunięcie nowego pliku z `/etc/nginx/sites-enabled/`.
2. **Bindowanie portu poza loopback:** jeżeli proces Web, API lub PostgreSQL pojawi się w `ss -lntup` na `0.0.0.0` lub `[::]`, natychmiast zatrzymać jednostkę `systemd` / kontener.
3. **Niepowodzenie migracji lub konflikt `btree_gist`:** jeżeli `pnpm db:migrate` zwróci kod wyjścia `!= 0`, nie uruchamiać nowej wersji API i nie kasować istniejących tabel.
4. **Przekroczenie budżetu zasobów po starcie (`MemAvailable < 1.2 GiB`, wzrost użycia swapu `> 100 MiB`, ciągłe `so > 0` w `vmstat` lub przekroczenie `MemoryHigh`):** natychmiast zatrzymać usługi `pap-staging-*` i zweryfikować zużycie pamięci poszczególnych procesów.
5. **Brak szyfrowanego backupu off-host przed wyjściem poza czysto ulotne dane syntetyczne Etapu A:** kopia na dodatkowym wolumenie tego samego serwera (`/mnt/HC_Volume_<REDACTED>`) nie uprawnia do przechowywania danych trwałych ani rzeczywistych.
6. **Pojawienie się jakichkolwiek rzeczywistych danych osobowych, faktur, NIP klientów lub produkcyjnych kluczy KSeF** w środowisku stagingowym.
