# Checklista gotowości (Go / No-Go) dla środowiska Hetzner

- **Data:** 2026-10-28
- **Powiązane zadanie:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19), [Audyt serwera Hetzner](HETZNER_SERVER_AUDIT_2026-10-28.md), [Architektura stagingu](HETZNER_STAGING_ARCHITECTURE.md), [Plan wdrożenia](HETZNER_DEPLOYMENT_PLAN.md)
- **Przeznaczenie:** Jednoznaczne kryteria odbiorowe (Go/No-Go) oraz lista decyzji wymagających wyraźnej zgody właściciela przed wykonaniem jakiejkolwiek operacji na serwerze.

---

## 1. Działania wymagające osobnej, jawnej zgody właściciela

Zgodnie z zasadami projektu ([AGENTS.md](../AGENTS.md)) oraz zakresem [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19), żadna z poniższych czynności nie została wykonana podczas audytu i **wymaga osobnej decyzji właściciela**:

- [ ] **Decyzja 1 (DNS):** Dodanie rekordu `A` (oraz opcjonalnie `AAAA`) dla `xn--ksigowo-c5a1nq1a.roleplayingtech.com` wskazującego na serwer Hetzner, oraz decyzja, czy utrzymujemy istniejący rekord `ksiegowosc.roleplayingtech.com` jako przekierowanie `308` do domeny z polskimi znakami.
- [ ] **Decyzja 2 (Model uruchomienia na hoście):** Akceptacja rekomendowanego modelu: procesy `systemd` (`pap-staging-web`, `pap-staging-api`) z izolowanym Node.js `24.22.1` w `/opt/pap-runtime` + PostgreSQL `18.6` w kontenerze `postgres:18.6-alpine` na `127.0.0.1:5432` (lub wskazanie instalacji natywnego pakietu `postgresql-18` z repozytorium PGDG).
- [ ] **Decyzja 3 (Bramka dostępu dla Etapu A):** Akceptacja ochrony prywatnego stagingu technicznego przez HTTP Basic Auth na poziomie Nginx (z opcjonalnym zawężeniem do wskazanych adresów IP / VPN).
- [ ] **Decyzja 4 (Zgoda na zapis na serwerze Hetzner):** Zgoda na utworzenie użytkownika systemowego `pap`, katalogów `/opt/pap-runtime`, `/var/www/pap-staging`, `/etc/pap`, `/var/lib/pap-acme`, `/mnt/HC_Volume_<REDACTED>/pap-staging`, jednostek `systemd`, vhosta Nginx i wygenerowanie certyfikatu Let's Encrypt.
- [ ] **Decyzja 5 (Ochrona gałęzi `main`):** Włączenie Branch Ruleset dla gałęzi `main` w repozytorium GitHub (`Require pull request`, `Require status checks: db-integration, checks, secrets`, `Block force pushes`).
- [ ] **Decyzja 6 (Porządki na serwerze — opcjonalne, poza zakresem PAP):** Osobna decyzja właściciela, czy i kiedy wyłączyć nieużywane odnowienia certyfikatów `app.mumro.io` i `roleplayingtech.com-0001` naprawiające status `certbot.service`, oraz co zrobić z procesami `python3 -m http.server 3001` i `vite --port 5174` i nieaktywnym `ufw`.

---

## 2. Bramka Go / No-Go — Etap A (Prywatny staging techniczny)

Wdrożenie Etapu A pod adresem `https://księgowość.roleplayingtech.com` może nastąpić **wyłącznie wtedy**, gdy wszystkie poniższe punkty są spełnione:

### 2.1. Warunki wstępne (Przed startem usług)
- [ ] **Właściciel udzielił jawnej zgody** na wykonanie instalacji Etapu A (Decyzje 1–4).
- [ ] Rekord DNS `A` dla `xn--ksigowo-c5a1nq1a.roleplayingtech.com` rozwiązuje się na adres IPv4 serwera Hetzner (`<HETZNER_IPV4>`).
- [ ] Na serwerze jest minimum `5 GiB` wolnego miejsca na `/` (obecnie `15 GiB` **[Potwierdzone na serwerze]**) oraz minimum `10 GiB` na wolumenie dodatkowym (obecnie `24 GiB` **[Potwierdzone na serwerze]**), a dostępna pamięć RAM przekracza `1.0 GiB` (obecnie `2.3 GiB` **[Potwierdzone na serwerze]**).
- [ ] Porty `127.0.0.1:3100`, `127.0.0.1:4100` (oraz `127.0.0.1:5432` dla A.2) są wolne bezpośrednio przed uruchomieniem (`ss -lntup`).
- [ ] Wszystkie testy w CI na gałęzi `main` (`lint`, `format:check`, `typecheck`, `test`, `test:arch`, `db-integration`, `test:e2e`, `audit`, `gitleaks`) mają status **PASS**.

### 2.2. Weryfikacja bezpieczeństwa i izolacji po uruchomieniu Etapu A
- [ ] Procesy `pap-staging-web` i `pap-staging-api` działają na koncie nieuprzywilejowanym `pap` z aktywnymi flagami `NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`.
- [ ] Polecenie `ss -lntp | grep -E ':(3100|4100|5432)\b'` potwierdza nasłuch **wyłącznie na `127.0.0.1`**, nigdy na `0.0.0.0` ani `[::]`.
- [ ] Niezalogowane żądanie z zewnątrz (`curl -i https://xn--ksigowo-c5a1nq1a.roleplayingtech.com/app` oraz `/api/v1/system/status`) zwraca **`401 Unauthorized`** (bramka Nginx działa przed aplikacją).
- [ ] Uwierzytelnione żądanie właściciela zwraca `200 OK`, prawidłowy certyfikat TLS dla `xn--ksigowo-c5a1nq1a.roleplayingtech.com`, nagłówki `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` oraz `X-Robots-Tag: noindex, nofollow`.
- [ ] Żadna z istniejących usług na serwerze (`durnoty.service`, `mumro-articles.service`, `swiadek-dziejow-articles.service`, `social-media-manager.service`, PM2 `historia-technologii` i `mfc-backend`, kontenery `shorts-api` i `reels-api`) nie została zrestartowana ani nie zmieniła stanu.

### 2.3. Dodatkowe warunki dla podetapu A.2 (Baza PostgreSQL 18 na stagingu)
- [ ] Scalono i zweryfikowano w CI osobny PR rozszerzający `packages/db/src/database-config.ts` o jawny tryb `PAP_DATABASE_ENV=staging` na loopbacku.
- [ ] Rola `pap_staging_app` posiada atrybuty `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS` i nie jest właścicielem bazy ani tabel.
- [ ] Migracje `0000_technical-baseline.sql`, `0001_tenant-schema.sql` (`btree_gist`) oraz `0002_access-lifecycle.sql` wykonały się bez błędów z konta `pap_staging_migrator`.
- [ ] Wykonano próbny backup (`pap-staging-backup.service`) i zakończono sukcesem test odtworzenia (Restore Drill) do tymczasowej bazy weryfikacyjnej.

---

## 3. Bramka Go / No-Go — Etap B (Funkcjonalny staging z kontami i syntetycznymi firmami)

Przejście z Etapu A do Etapu B (udostępnienie logowania użytkowników i operacji na firmach syntetycznych) jest **zablokowane (NO-GO)**, dopóki nie zostaną spełnione wszystkie poniższe kryteria:

- [ ] **Zamknięta blokada `6D-R`:** wdrożony i przetestowany na PostgreSQL 18 bezpieczny cykl życia członkostw i grantów (cofnięcie członkostwa trwale unieważnia wszystkie granty użytkownika w tenancie; ponowna aktywacja członkostwa **nie przywraca** dawnych grantów).
- [ ] **Zamknięty pakiet `6D-2`:** wdrożona serwerowa weryfikacja OIDC (`iss`, `aud`, `exp`, `nbf`, `sub`), mapowanie `(issuer, subject) -> userId` oraz obowiązkowe wywołanie `authorizeCompanyAction` w API.
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
4. **Spadek dostępnej pamięci RAM poniżej `500 MiB` lub wzrost użycia swapu o `> 500 MiB` po starcie usług:** zatrzymać usługi `pap-staging-*` i zweryfikować limity `MemoryMax=` w jednostkach `systemd`.
5. **Pojawienie się jakichkolwiek rzeczywistych danych osobowych, faktur, NIP klientów lub produkcyjnych kluczy KSeF** w środowisku stagingowym.
