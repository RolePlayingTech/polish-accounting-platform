# Audyt serwera Hetzner — inwentaryzacja i weryfikacja przedstartowa (2026-10-28)

- **Data audytu i weryfikacji:** 2026-10-28
- **Powiązane zadanie:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Docelowa domena (jedyna kanoniczna):** `https://ksiegowosc.roleplayingtech.com`
- **Redakcja bezpieczeństwa:** publiczne adresy IP hosta, identyfikatory zasobów chmurowych oraz ścieżki mogące zawierać dane uwierzytelniające zostały zamaskowane (`<HETZNER_IPV4>`, `<HETZNER_IPV6_PREFIX>`, `HC_Volume_<REDACTED>`). Żadne wartości `.env`, tokeny, hasła ani klucze prywatne nie były odczytywane.

## Legenda statusów ustaleń

Każde ustalenie w niniejszym raporcie jest oznaczone jedną z czterech kategorii dowodowych:

- **[Potwierdzone na serwerze]** — zweryfikowane bezpośrednio poleceniem diagnostycznym przez `ssh hetzner`, zewnętrznym testem połączenia TCP lub zapytaniem do autorytatywnego i publicznego DNS.
- **[Potwierdzone w repo]** — zweryfikowane w kodzie źródłowym, konfiguracji CI lub dokumentacji repozytorium `RolePlayingTech/polish-accounting-platform`.
- **[Założenie]** — robocze założenie projektowe przyjęte na potrzeby architektury docelowej.
- **[Do sprawdzenia]** — element wymagający weryfikacji podczas docelowego uruchomienia usług.

---

## 1. Podsumowanie wykonawcze

1. **Host istnieje, działa stabilnie i posiada zasoby na prywatny staging pod warunkiem ścisłych limitów:** **[Potwierdzone na serwerze]** Serwer `hetz-1` (Ubuntu 24.04.3 LTS, 2 vCPU, 3.7 GiB RAM, ~15 GiB wolnego miejsca na `/` oraz ~24 GiB na dodatkowym wolumenie blokowym) działa nieprzerwanie od 286 dni przy niskim obciążeniu CPU (`load average: 0.10, 0.08, 0.09`) i posiada ~2.3 GiB dostępnej pamięci RAM (`available`), ale wykorzystuje **`1.7 GiB` pamięci swap** (z `8.0 GiB` na wolumenie sieciowym). Szacowane zużycie `~350–500 MiB` RAM przez Web + API + PostgreSQL 18 jest hipotezą przedstartową (**[Założenie]**), która jest zabezpieczona twardymi limitami pamięci/CPU/I/O w jednostkach `systemd` oraz pomiarem rzeczywistego RSS po uruchomieniu.
2. **Serwer nie jest pusty — współdzieli kilka aktywnych aplikacji:** **[Potwierdzone na serwerze]** Na hoście działa reverse proxy Nginx (`80`/`443`), 3 kontenery Docker (`shorts-api`, `reels-api`), 4 aktywne usługi aplikacyjne `systemd` (`durnoty`, `mumro-articles`, `swiadek-dziejow-articles`, `social-media-manager`), 2 procesy w PM2 (`historia-technologii`, `mfc-backend`) oraz 2 procesy uruchomione bezpośrednio w sesjach użytkownika. Wszystkie te usługi pozostają nienaruszone.
3. **Docelowa domena `ksiegowosc.roleplayingtech.com` jest gotowa w DNS:** **[Potwierdzone na serwerze]** Właściciel podjął ostateczną decyzję, że jedynym kanonicznym adresem aplikacji jest **`https://ksiegowosc.roleplayingtech.com`** (bez polskich znaków i bez Punycode). Rekord `A` (`TTL 600`) dla `ksiegowosc.roleplayingtech.com` jest skonfigurowany na autorytatywnych serwerach DNS (`ns09.domaincontrol.com.`, `ns10.domaincontrol.com.`) oraz rozpropagowany na publicznych resolverach (`1.1.1.1`, `8.8.8.8`, `9.9.9.9`) i wskazuje dokładnie na adres `<HETZNER_IPV4>` badanego serwera `hetz-1`.
4. **Zewnętrzny Hetzner Cloud Firewall (`firewall-1`) chroni hosta — port `3001` został zamknięty:** **[Potwierdzone na serwerze]** Po usunięciu przez właściciela czwartej reguły (`TCP 3001`) w `firewall-1`, zewnętrzna weryfikacja TCP potwierdziła, że wszystkie cztery procesy nasłuchujące na `0.0.0.0`/`*` (porty **`3001`**, **`3002`**, **`3003`**, **`5174`**) są **niedostępne z internetu (`FILTERED / TIMEOUT`)**, podczas gdy porty `22`, `80` i `443` działają prawidłowo. Wszystkie usługi Polish Accounting Platform są dodatkowo bindowane wyłącznie do `127.0.0.1`.
5. **Globalny stan `failed` jednostki `certbot.service`:** **[Potwierdzone na serwerze]** Timer `certbot.timer` działa, ale `certbot.service` kończy się błędem (`exit-code 1`) z powodu nieudanych odnowień dwóch historycznych certyfikatów (`app.mumro.io` oraz `roleplayingtech.com-0001`, których domeny wskazują obecnie na inne serwery). Samo użycie `--webroot` dla nowego certyfikatu `ksiegowosc.roleplayingtech.com` nie naprawi globalnego stanu `failed` jednostki `certbot.service`, dlatego nowy certyfikat wymaga dedykowanego testu `certbot renew --cert-name ksiegowosc.roleplayingtech.com --dry-run` oraz niezależnego monitoringu ważności TLS.

---

## 2. System operacyjny i zasoby sprzętowe

Wszystkie poniższe dane mają status **[Potwierdzone na serwerze]**:

| Parametr | Wartość odczytana na hoście | Ocena pod kątem Polish Accounting Platform |
| --- | --- | --- |
| Nazwa hosta / strefa | `hetz-1` (`nbg1-dc3`) / Hetzner vServer (KVM) | Standardowa maszyna wirtualna Hetzner Cloud w UE/EOG (Norymberga) |
| System operacyjny | Ubuntu 24.04.3 LTS (`Noble Numbat`) | Wspierany LTS, nowoczesny systemd i biblioteka `glibc` |
| Kernel i architektura | `Linux 6.8.0-90-generic` / `x86_64` | Zgodny z wymaganiami Node.js 24 i PostgreSQL 18 |
| Procesor (CPU) | 2 vCPU (`Intel Xeon Processor, Skylake, IBRS`) | Wystarczające dla prywatnego stagingu; budowanie odbywa się poza serwerem (w CI) |
| Pamięć RAM | `3.7 GiB` łącznie; `1.4 GiB` użyte; `2.4 GiB` buff/cache; **`2.3 GiB` dostępne (`available`)** | Szacowane łączne zapotrzebowanie Web + API + PostgreSQL 18 na poziomie `~350–500 MiB` to hipoteza (**[Założenie]**); zastosowano twarde limity (`MemoryHigh`/`MemoryMax`) w jednostkach `systemd` |
| Pamięć Swap | `8.0 GiB` (`/mnt/HC_Volume_<REDACTED>/reels-api-swapfile`), **użyte `1.7 GiB`**, `vm.swappiness = 60` | Swap znajduje się na sieciowym wolumenie blokowym; aktywność wymiany stron w spoczynku wynosi `0 B/s` (`vmstat`) |
| Dysk systemowy (`/`) | `/dev/sda1` (`ext4`), rozmiar `38 GiB`, użyte `22 GiB` (`60%`), **wolne `15 GiB`** | Wystarczające na binaria runtime i kod aplikacji przy retencji 3 wydań |
| Dodatkowy wolumen blokowy | `/dev/sdb` (`ext4`) zamontowany w `/mnt/HC_Volume_<REDACTED>`, rozmiar `49 GiB`, użyte `23 GiB` (`49%`), **wolne `24 GiB`** | Przeznaczony na dane PostgreSQL stagingu oraz lokalne zrzuty `pg_dump` (w Etapie A dla danych syntetycznych) |
| Czas działania (Uptime) | `286 dni, 22 godz.` | Bardzo wysoka stabilność hosta |

---

## 3. Dostępne narzędzia i przygotowane środowisko wykonawcze PAP

| Narzędzie | Stan na serwerze Hetzner **[Potwierdzone na serwerze]** | Wymaganie Polish Accounting Platform **[Potwierdzone w repo]** | Status przygotowania |
| --- | --- | --- | --- |
| Node.js (systemowy) | `/usr/bin/node` w wersji **`v20.20.2`** | **`24.22.1`** (`>=24.22.1 <25`) | Systemowy `/usr/bin/node` pozostawiono **nietknięty** dla istniejących aplikacji |
| Node.js 24 (izolowany dla PAP) | `/opt/pap-runtime/current/bin/node` w wersji **`v24.22.1`** | **`24.22.1`** | **Zainstalowany i zweryfikowany sumą SHA-256** w `/opt/pap-runtime/node-v24.22.1-linux-x64` |
| `pnpm` (izolowany dla PAP) | `/opt/pap-runtime/pnpm/pnpm` w wersji **`12.15.0`** | `pnpm@12.15.0` | **Zainstalowany i zweryfikowany** z konta nieuprzywilejowanego `pap` |
| PostgreSQL 18 | Przygotowana konfiguracja `postgres:18.6-alpine` (przypięta po SHA256) w `/mnt/HC_Volume_<REDACTED>/pap-staging/compose/docker-compose.postgres.yml` | **PostgreSQL 18** (`18.6` w CI) + rozszerzenie `btree_gist` | **Gotowa (nieuruchomiona)** — bindowana wyłącznie do `127.0.0.1:5432` |
| Reverse proxy | `nginx/1.24.0 (Ubuntu)` aktywny; przygotowane nieaktywne pliki `/etc/nginx/sites-available/pap-staging.bootstrap-http.conf` i `pap-staging.https.conf` | HTTPS + bramka Basic Auth dla `ksiegowosc.roleplayingtech.com` | **Gotowe (nieaktywne)** — brak wpisu w `sites-enabled`, brak reloadu Nginx |
| Zarządzanie certyfikatami | `certbot 2.9.0` + webroot `/var/lib/pap-acme/.well-known/acme-challenge` (`0750 root:www-data`) | Certyfikat TLS dla `ksiegowosc.roleplayingtech.com` | **Gotowe do wydania** po zgodzie właściciela (`-d ksiegowosc.roleplayingtech.com`) |

---

## 4. Inwentaryzacja uruchomionych usług, kontenerów i portów

### 4.1. Porty nasłuchujące (TCP/UDP)

Stan odczytany przez `ss -lntup` oraz zweryfikowany z zewnątrz (**[Potwierdzone na serwerze]**):

| Adres i port lokalny | Proces / Usługa | Użytkownik | Dostępność z internetu (`firewall-1`) | Przeznaczenie |
| --- | --- | --- | --- | --- |
| `0.0.0.0:22`, `[::]:22` | `sshd` | `root` | **`OPEN`** | Dostęp administracyjny SSH (tylko klucze publiczne) |
| `0.0.0.0:80`, `[::]:80` | `nginx` | `root` / `www-data` | **`OPEN`** | Publiczny ruch HTTP i przekierowania / ACME challenge |
| `0.0.0.0:443`, `[::]:443` | `nginx` | `root` / `www-data` | **`OPEN`** | Publiczny ruch HTTPS (reverse proxy dla wszystkich domen) |
| `0.0.0.0:3001` | `python3 -m http.server 3001` (PID `3460`) | `admin` | **`FILTERED / TIMEOUT` (zablokowany)** | Nieużywany przez Nginx ani systemd historyczny proces w `/home/admin/stacks/dupa`; po usunięciu reguły `TCP 3001` w `firewall-1` niedostępny z internetu |
| `*:3002` | `node` (PID `3153768`, PM2 `mfc-backend`) | `admin` | **`FILTERED / TIMEOUT` (zablokowany)** | Backend aplikacji `monitor-mfc.roleplayingtech.com` (dostępny wyłącznie przez Nginx) |
| `0.0.0.0:3003` | `next-server (v16.2.1)` (PID `1400637`, PM2 `historia-technologii`) | `admin` | **`FILTERED / TIMEOUT` (zablokowany)** | Aplikacja Next.js (proxyowana z vhosta `swiadek-dziejow.pl`) |
| `127.0.0.1:3004` | `node` (`swiadek-dziejow-articles.service`) | `admin` | Niedostępny (loopback) | CMS artykułów `swiadek-dziejow.pl` |
| `127.0.0.1:3005` | `node` (`mumro-articles.service`) | `admin` | Niedostępny (loopback) | CMS artykułów `mumro.io` |
| `127.0.0.1:3010` | `node` (`durnoty.service`) | `www-data` | Niedostępny (loopback) | Serwer aplikacji `durnoty.pl` |
| `0.0.0.0:5174` | `node .../vite --host 0.0.0.0 --port 5174` (PID `2172892`) | `admin` | **`FILTERED / TIMEOUT` (zablokowany)** | Serwer Vite w `/var/www/mumro/frontend` (zablokowany z zewnątrz przez `firewall-1`) |
| `127.0.0.1:8000` | `docker-proxy` (`reels-api-video-backend-1`) | `root` | Niedostępny (loopback) | Backend `reels-api.mumro.io` |
| `127.0.0.1:8010` | `docker-proxy` (`shorts-api-shorts-backend-1`) | `root` | Niedostępny (loopback) | Backend `shorts-api.mumro.io` |
| `127.0.0.1:8903` | `python3` (`social-media-manager.service`) | `admin` | Niedostępny (loopback) | API `social-media-manager` |

**Porty zarezerwowane dla Polish Accounting Platform (potwierdzone jako wolne):**
- Web (`@pap/web`): `127.0.0.1:3100`
- API (`@pap/api`): `127.0.0.1:4100`
- PostgreSQL 18 (staging): `127.0.0.1:5432`

---

## 5. Weryfikacja ostatecznej domeny `ksiegowosc.roleplayingtech.com`

Zgodnie z wiążącą decyzją właściciela jedynym docelowym adresem aplikacji jest **`https://ksiegowosc.roleplayingtech.com`** (bez polskich znaków i bez domeny Punycode).

### 5.1. Stan publicznego i autorytatywnego DNS (`[Potwierdzone na serwerze]`)

Wyniki zapytań do serwerów autorytatywnych (`ns09.domaincontrol.com.`, `ns10.domaincontrol.com.`) oraz resolverów `1.1.1.1`, `8.8.8.8`, `9.9.9.9`:

| Nazwa DNS | Rekord `A` (IPv4) | Rekord `AAAA` (IPv6) | Rekord `CNAME` | Wskazuje na badany serwer Hetzner (`hetz-1`)? |
| --- | --- | --- | --- | --- |
| **`ksiegowosc.roleplayingtech.com`** *(jedyna domena kanoniczna)* | **`<HETZNER_IPV4>`** (`TTL 600`) | **Brak** | **Brak** | **TAK (`EXACT_MATCH_HOST_IPV4`)** — gotowa do wydania certyfikatu TLS i uruchomienia |

### 5.2. Konsekwencje techniczne użycia kanonicznej domeny ASCII `ksiegowosc.roleplayingtech.com`

1. **Strefa DNS:** Rekord `A` już istnieje i jest rozpropagowany — nie są wymagane żadne zmiany w DNS.
2. **Certyfikat TLS (Let's Encrypt / ACME):** Wywołanie Certbota używa wyłącznie `-d ksiegowosc.roleplayingtech.com` (`--cert-name ksiegowosc.roleplayingtech.com`) w trybie `--webroot -w /var/lib/pap-acme`.
3. **Konfiguracja Nginx (`server_name` i SNI):** W plikach `/etc/nginx/sites-available/pap-staging.bootstrap-http.conf` oraz `/etc/nginx/sites-available/pap-staging.https.conf` ustawiono wyłącznie `server_name ksiegowosc.roleplayingtech.com;`, bez przekierowań z innych domen.
4. **Nagłówki `Origin`, ciasteczka i przyszłe OIDC (`redirect_uri`):** Cała konfiguracja autoryzacji (`6D-2`), walidacji `Origin` oraz allowlista produkcyjna w `apps/web/lib/read-system-status.ts` operują wyłącznie na adresie `https://ksiegowosc.roleplayingtech.com` (oraz wewnętrznym loopbacku `http://127.0.0.1:4100` dla komunikacji SSR Web -> API).
