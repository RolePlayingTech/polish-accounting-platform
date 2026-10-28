# Audyt serwera Hetzner — inwentaryzacja odczytowa (2026-10-28)

- **Data audytu:** 2026-10-28
- **Powiązane zadanie:** [Issue #19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)
- **Tryb badania:** wyłącznie odczytowy (`ssh hetzner`), bez modyfikacji systemu, usług, kontenerów, firewalla, DNS ani sekretów.
- **Redakcja bezpieczeństwa:** publiczne adresy IP hosta, identyfikatory zasobów chmurowych oraz ścieżki mogące zawierać dane uwierzytelniające zostały zamaskowane (`<HETZNER_IPV4>`, `<HETZNER_IPV6_PREFIX>`, `HC_Volume_<REDACTED>`). Żadne wartości `.env`, tokeny, hasła ani klucze prywatne nie były odczytywane.

## Legenda statusów ustaleń

Każde ustalenie w niniejszym raporcie jest oznaczone jedną z czterech kategorii dowodowych:

- **[Potwierdzone na serwerze]** — zweryfikowane bezpośrednio poleceniem diagnostycznym przez `ssh hetzner` lub zapytaniem do publicznego DNS.
- **[Potwierdzone w repo]** — zweryfikowane w kodzie źródłowym, konfiguracji CI lub dokumentacji repozytorium `RolePlayingTech/polish-accounting-platform` (gałąź `main`, commit `8baf642`).
- **[Założenie]** — robocze założenie projektowe przyjęte na potrzeby architektury docelowej.
- **[Do sprawdzenia]** — element niewidoczny z poziomu odczytowego konta na hoście (np. zewnętrzny panel Hetzner Cloud Firewall lub panel rejestratora DNS).

---

## 1. Podsumowanie wykonawcze

1. **Host istnieje, działa stabilnie i posiada zasoby na prywatny staging pod warunkiem ścisłych limitów:** **[Potwierdzone na serwerze]** Serwer `hetz-1` (Ubuntu 24.04.3 LTS, 2 vCPU, 3.7 GiB RAM, ~15 GiB wolnego miejsca na `/` oraz ~24 GiB na dodatkowym wolumenie blokowym) działa nieprzerwanie od 286 dni przy niskim obciążeniu CPU (`load average: 0.79, 0.35, 0.14`) i posiada ~2.3 GiB dostępnej pamięci RAM (`available`), ale już teraz wykorzystuje **`1.7 GiB` pamięci swap** (z `8.0 GiB` na wolumenie sieciowym). Szacowane zużycie `~350–500 MiB` RAM przez Web + API + PostgreSQL 18 jest hipotezą przedstartową (**[Założenie]**), która wymaga nałożenia twardych limitów pamięci/CPU/I/O oraz pomiaru rzeczywistego RSS po uruchomieniu.
2. **Serwer nie jest pusty — współdzieli kilka aktywnych aplikacji:** **[Potwierdzone na serwerze]** Na hoście działa reverse proxy Nginx (`80`/`443`), 3 kontenery Docker (`shorts-api`, `reels-api`), 4 aktywne usługi aplikacyjne `systemd` (`durnoty`, `mumro-articles`, `swiadek-dziejow-articles`, `social-media-manager`), 2 procesy w PM2 (`historia-technologii`, `mfc-backend`) oraz 2 procesy uruchomione bezpośrednio w sesjach użytkownika. Wszystkie te usługi muszą pozostać nienaruszone.
3. **Docelowa domena IDN nie ma jeszcze rekordu DNS, ale wariant ASCII już wskazuje na ten serwer:** **[Potwierdzone na serwerze]** Nazwa docelowa `księgowość.roleplayingtech.com` (`xn--ksigowo-c5a1nq1a.roleplayingtech.com`) zwraca obecnie `NXDOMAIN` (brak rekordów `A`, `AAAA`, `CNAME`). Jednocześnie nazwa bez znaków diakrytycznych `ksiegowosc.roleplayingtech.com` posiada aktywny rekord `A` (`TTL 600`) wskazujący dokładnie na adres `<HETZNER_IPV4>` badanego serwera `hetz-1`.
4. **Brak zainstalowanego PostgreSQL 18 na hoście:** **[Potwierdzone na serwerze]** Na serwerze nie ma obecnie zainstalowanego klienta ani serwera PostgreSQL (`psql`, `pg_isready`, `postgres` nieobecne), a domyślne repozytorium Ubuntu 24.04 (`noble`) oferuje wyłącznie linię `postgresql-16`. Projekt wymaga PostgreSQL 18 (`18.6` w CI) wraz z rozszerzeniem `btree_gist` oraz łańcuchem migracji `0000–0002` **[Potwierdzone w repo]**.
5. **Wykryte ryzyka operacyjne i bezpieczeństwa na hoście (wymagające uwagi właściciela):**
   - **PILNE — ryzyko publicznej ekspozycji istniejących aplikacji:** **[Potwierdzone na serwerze]** Zapora systemowa `ufw` ma status `inactive`, a polityka `iptables`/`ip6tables` dla łańcucha `INPUT` to `ACCEPT`. Jednocześnie cztery istniejące procesy innych projektów nasłuchują na `0.0.0.0` / `*` (porty TCP **`3001`**, **`3002`**, **`3003`**, **`5174`**). Oznacza to, że są one wystawione bezpośrednio na publiczny internet z pominięciem Nginx, chyba że ruch blokuje zewnętrzny **Hetzner Cloud Firewall** w panelu chmurowym (**[Do sprawdzenia]** pilnie przez właściciela). Nie ingerujemy automatycznie w te procesy; wszystkie usługi Polish Accounting Platform będą bindowane wyłącznie do `127.0.0.1`.
   - **Globalny stan `failed` jednostki `certbot.service`:** **[Potwierdzone na serwerze]** Timer `certbot.timer` działa, ale `certbot.service` kończy się błędem (`exit-code 1`) z powodu nieudanych odnowień dwóch historycznych certyfikatów (`app.mumro.io` oraz `roleplayingtech.com-0001`, których domeny wskazują obecnie na inne serwery). Samo użycie `--webroot` dla nowego certyfikatu PAP nie naprawi globalnego stanu `failed` jednostki `certbot.service` (bez zmian w certyfikatach innych projektów), dlatego nowy certyfikat wymaga dedykowanego testu `--cert-name ... --dry-run` oraz niezależnego monitoringu ważności TLS.

---

## 2. System operacyjny i zasoby sprzętowe

Wszystkie poniższe dane mają status **[Potwierdzone na serwerze]**:

| Parametr | Wartość odczytana na hoście | Ocena pod kątem Polish Accounting Platform |
| --- | --- | --- |
| Nazwa hosta / wirtualizacja | `hetz-1` / Hetzner vServer (KVM) | Standardowa maszyna wirtualna Hetzner Cloud |
| System operacyjny | Ubuntu 24.04.3 LTS (`Noble Numbat`) | Wspierany LTS, nowoczesny systemd i biblioteka `glibc` |
| Kernel i architektura | `Linux 6.8.0-90-generic` / `x86_64` | Zgodny z wymaganiami Node.js 24 i PostgreSQL 18 |
| Procesor (CPU) | 2 vCPU (`Intel Xeon Processor, Skylake, IBRS`) | Wystarczające dla prywatnego stagingu; ogranicza równoległe budowanie dużych projektów TS na hoście (budowanie powinno odbywać się w CI) |
| Pamięć RAM | `3.7 GiB` łącznie; `1.4 GiB` użyte; `2.4 GiB` buff/cache; **`2.3 GiB` dostępne (`available`)** | Szacowane łączne zapotrzebowanie Web + API + PostgreSQL 18 na poziomie `~350–500 MiB` to hipoteza (**[Założenie]**); wymaga wykonywania `pnpm build` w CI, ustawienia twardych limitów (`MemoryHigh`/`MemoryMax`) oraz pomiaru RSS po starcie |
| Pamięć Swap | `8.0 GiB` (`/mnt/HC_Volume_<REDACTED>/reels-api-swapfile`), **użyte `1.7 GiB`**, `vm.swappiness = 60` | Swap znajduje się na sieciowym wolumenie blokowym; obecne zużycie `1.7 GiB` oznacza, że host doświadczał wcześniej presji pamięciowej, a dodatkowy ruch na swapie pogorszy opóźnienia I/O |
| Dysk systemowy (`/`) | `/dev/sda1` (`ext4`), rozmiar `38 GiB`, użyte `22 GiB` (`59%`), **wolne `15 GiB`** (inody: `15%`) | Wystarczające na binaria runtime i kod aplikacji (`~500 MiB` na wydanie) przy retencji maksymalnie 3 wydań |
| Dodatkowy wolumen blokowy | `/dev/sdb` (`ext4`) zamontowany w `/mnt/HC_Volume_<REDACTED>`, rozmiar `49 GiB`, użyte `23 GiB` (`49%`), **wolne `24 GiB`** (inody: `2%`) | Dobre miejsce na dane PostgreSQL stagingu oraz lokalne zrzuty `pg_dump` (uwaga: ten sam host — nie zastępuje backupu off-host dla danych trwałych/produkcyjnych) |
| Czas działania (Uptime) | `286 dni, 20 godz.` | Bardzo wysoka stabilność hosta |
| Obciążenie (`load average`) | `0.79` (1 min), `0.35` (5 min), `0.14` (15 min) | Niskie bieżące obciążenie CPU |
| Rozmiar logów `journald` | `81.2 MiB` | Logi systemowe nie obciążają dysku |

---

## 3. Dostępne narzędzia i środowiska wykonawcze

Porównanie stanu serwera (**[Potwierdzone na serwerze]**) z wymaganiami repozytorium (**[Potwierdzone w repo]** w `.node-version`, `package.json`, `docs/19-przewodnik-developera.md`):

| Narzędzie | Stan na serwerze Hetzner **[Potwierdzone na serwerze]** | Wymaganie Polish Accounting Platform **[Potwierdzone w repo]** | Wniosek / Różnica |
| --- | --- | --- | --- |
| Node.js (systemowy) | `/usr/bin/node` w wersji **`v20.20.2`** (z `nodesource.sources`) | **`24.22.1`** (`>=24.22.1 <25`) | Systemowy `/usr/bin/node` jest za stary (używają go inne aplikacje — **nie wolno go nadpisywać globalnie!**) |
| Node.js 24 (izolowany) | `/opt/durnoty-runtime/node_modules/node/bin/node` w wersji **`v24.21.0`** | **`24.22.1`** | Na serwerze zastosowano już sprawdzony wzorzec izolowanego runtime w `/opt/<app>-runtime`; dla PAP należy przygotować analogiczny `/opt/pap-runtime` z Node `24.22.1` |
| `corepack` / `pnpm` | `/usr/bin/corepack` obecny; brak `pnpm` w globalnym `PATH` | `pnpm@12.15.0` | Można dostarczyć `pnpm@12.15.0` wewnątrz izolowanego `/opt/pap-runtime` (lub w artefakcie CI) bez ingerencji w `/usr/bin` |
| PostgreSQL (serwer i klient) | **Brak** (`psql`, `pg_isready`, `pg_dump`, `postgres` niezainstalowane). W domyślnym `apt` Ubuntu 24.04 dostępny tylko `postgresql-16` (`16.15`) | **PostgreSQL 18** (w CI przypięty `postgres:18.6-alpine`) + rozszerzenie `btree_gist` | Wymagana instalacja PostgreSQL 18 (jako izolowany kontener `postgres:18.6-alpine` na `127.0.0.1:5432` lub z oficjalnego repozytorium PGDG `apt.postgresql.org`) |
| Docker / Compose | `Docker 29.4.3` + `Docker Compose v5.1.3` | Opcjonalny na serwerze (wg ADR-002 / ADR-005) | Gotowy i działający; używany obecnie przez `shorts-api` i `reels-api` |
| Reverse proxy | `nginx/1.24.0 (Ubuntu)` aktywny; brak `caddy` i `traefik` | Dowolny bezpieczny reverse proxy obsługujący TLS i nagłówki HTTP | Wykorzystamy istniejący Nginx |
| Zarządzanie certyfikatami | `certbot 2.9.0` + timer `certbot.timer` (`certbot.service` w stanie `failed`) | Certyfikat TLS dla domeny IDN (`xn--ksigowo-c5a1nq1a.roleplayingtech.com`) | Certbot wymaga wydania certyfikatu w trybie `--webroot` (z katalogiem `0750 root:www-data`), jawnego testu `--cert-name ... --dry-run` oraz niezależnego monitoringu daty ważności TLS, ponieważ samo `--webroot` nie usunie globalnego błędu `certbot.service` wywołanego przez certyfikaty innych projektów |
| Narzędzia VPN / tuneli | Brak `tailscale`, `wg` (WireGuard), `cloudflared` | Prywatne ograniczenie dostępu w Etapie A | W Etapie A najprościej użyć bramki uwierzytelniającej Nginx (`auth_basic` + opcjonalna allowlista IP) lub tunelu SSH, bez konieczności instalacji daemona VPN |
| Narzędzia backupu | `tar`, `gzip`, `cron`, `systemd` timers (brak `restic`, `borg`) | Odtwarzalny backup bazy i konfiguracji | Na serwerze działa wzorcowy timer `durnoty-backup.timer`; dla PAP zastosujemy dedykowany timer `systemd` z `pg_dump --format=custom` i sumą SHA-256 |

---

## 4. Inwentaryzacja uruchomionych usług, kontenerów i portów

### 4.1. Porty nasłuchujące (TCP/UDP)

Stan odczytany przez `ss -lntup` (**[Potwierdzone na serwerze]**):

| Adres i port lokalny | Proces / Usługa | Użytkownik | Katalog roboczy / Kontener | Ekspozycja i przeznaczenie |
| --- | --- | --- | --- | --- |
| `0.0.0.0:22`, `[::]:22` | `sshd` | `root` | — | Dostęp administracyjny SSH (tylko klucze publiczne) |
| `0.0.0.0:80`, `[::]:80` | `nginx` | `root` / `www-data` | `/etc/nginx` | Publiczny ruch HTTP i przekierowania / ACME challenge |
| `0.0.0.0:443`, `[::]:443` | `nginx` | `root` / `www-data` | `/etc/nginx` | Publiczny ruch HTTPS (reverse proxy dla wszystkich domen) |
| `0.0.0.0:3001` | `python3 -m http.server 3001` (PID `3460`) | `admin` | `/home/admin/stacks/dupa` | **Uwaga:** niezarządzany proces w `session-34.scope` (działa od 286 dni, binarium `/usr/bin/python3.12 (deleted)`), nasłuchuje na wszystkich interfejsach |
| `*:3002` | `node` (PID `3153768`, PM2 `mfc-backend`) | `admin` | `/var/www/monitor-mfc.roleplayingtech.com/backend` | Backend aplikacji `monitor-mfc.roleplayingtech.com` (nasłuchuje na `*`, proxyowany też przez Nginx) |
| `0.0.0.0:3003` | `next-server (v16.2.1)` (PID `1400637`, PM2 `historia-technologii`) | `admin` | `/var/www/historia-technologii` | Aplikacja Next.js (proxyowana z vhosta `swiadek-dziejow.pl`, nasłuchuje na `0.0.0.0`) |
| `127.0.0.1:3004` | `node` (`swiadek-dziejow-articles.service`) | `admin` | `/var/www/swiadek-dziejow.pl/articles-cms` | CMS artykułów `swiadek-dziejow.pl` (tylko loopback) |
| `127.0.0.1:3005` | `node` (`mumro-articles.service`) | `admin` | `/var/www/mumro.io` | CMS artykułów `mumro.io` (tylko loopback) |
| `127.0.0.1:3010` | `node` (`durnoty.service`) | `www-data` | `/var/www/durnoty.pl` | Serwer aplikacji `durnoty.pl` z własnym Node `24.21.0` (tylko loopback) |
| `0.0.0.0:5174` | `node .../vite --host 0.0.0.0 --port 5174` (PID `2172892`) | `admin` | `/var/www/mumro/frontend` | **Uwaga:** niezarządzany serwer deweloperski Vite w `session-42643.scope` (działa od 99 dni na `0.0.0.0:5174`) |
| `127.0.0.1:8000` | `docker-proxy` (`reels-api-video-backend-1`) | `root` | Kontener `video-generation-backend:prod` | Backend `reels-api.mumro.io` (tylko loopback) |
| `127.0.0.1:8010` | `docker-proxy` (`shorts-api-shorts-backend-1`) | `root` | Kontener `shorts-backend:local` | Backend `shorts-api.mumro.io` (tylko loopback) |
| `127.0.0.1:8903` | `python3` (`social-media-manager.service`) | `admin` | `/mnt/HC_Volume_<REDACTED>/roleplayingtech.com/html/social-admin-v2` | API `social-media-manager` (tylko loopback) |
| `127.0.0.53:53`, `127.0.0.54:53` | `systemd-resolved` | `systemd-resolve` | — | Lokalny resolver DNS systemu |

**Wniosek dotyczący portów dla Polish Accounting Platform:** **[Potwierdzone na serwerze]**
- Porty `3001`, `3002`, `3003`, `3004`, `3005`, `3010`, `5174`, `8000`, `8010`, `8903` są zajęte.
- Porty `3000`, `4000` oraz `5432` są obecnie wolne, jednak aby uniknąć przypadkowych kolizji z domyślnymi portami deweloperskimi innych projektów w `/var/www`, dla Polish Accounting Platform rekomendujemy wydzielony zakres na loopbacku:
  - Web (`@pap/web`): `127.0.0.1:3100`
  - API (`@pap/api`): `127.0.0.1:4100`
  - PostgreSQL 18 (staging): `127.0.0.1:5432` (lub dedykowany `127.0.0.1:5438`, jeśli na hoście miałaby powstać więcej niż jedna instancja PG).

### 4.2. Kontenery, sieci i wolumeny Docker

Stan odczytany przez `docker ps -a`, `docker network ls`, `docker volume ls`, `docker system df` (**[Potwierdzone na serwerze]**):

- **Aktywne kontenery (3):**
  1. `shorts-api-shorts-backend-1` (`shorts-backend:local`, status `Up 2 months (healthy)`, port `127.0.0.1:8010->8000/tcp`, sieć `shorts-api_default` `172.20.0.0/16`).
  2. `shorts-api-youtube-pot-provider-1` (`brainicism/bgutil-ytdlp-pot-provider:1.3.2`, status `Up 2 months`, port wewnętrzny `4416/tcp`, sieć `shorts-api_default`).
  3. `reels-api-video-backend-1` (`video-generation-backend:prod`, status `Up 4 months (healthy)`, port `127.0.0.1:8000->8000/tcp`, sieć `reels-api_default` `172.19.0.0/16`).
- **Historyczne artefakty Docker po projekcie Mumro (nieuruchomione, zachowane):**
  - Wolumeny lokalne (`713.3 MB` łącznie): `mumro_smm_postgres_data`, `mumro_smm_minio_data`, `mumro_smm_redis_data`, `mumro_smm_loki_data`, `mumro_smm_alloy_data`, `shorts-api_shorts_backend_data` oraz 4 wolumeny anonimowe.
  - Obrazy (`5.917 GB` łącznie): m.in. `mumro-postgres:16-pgvector`, `mumro-minio`, `redis:7.4.10-alpine`, `video-generation-backend:prod`, `shorts-backend:local`.
  - **Zasada:** Żaden z tych wolumenów, sieci ani obrazów nie będzie modyfikowany ani usuwany.

### 4.3. Katalogi wdrożeniowe i struktura plików na hoście

Stan odczytany z `/var/www`, `/opt`, `/mnt/HC_Volume_<REDACTED>`, `/home/admin` (**[Potwierdzone na serwerze]**):

- `/var/www/` — główny katalog projektów webowych (`mumro` 2.0 GB, `mumro.io` 1.6 GB, `historia-technologii` 655 MB, `durnoty.pl` 340 MB, `swiadek-dziejow.pl` 281 MB, `mumro-admin` 214 MB, `monitor-mfc.roleplayingtech.com` 32 MB, `atlas.swiadek-dziejow.pl` 21 MB, `docs.mumro.io` 11 MB, `shorts-api` 1.4 MB, `roleplayingtech.pl` 104 KB oraz symlinki `roleplayingtech.com` i `social-admin` prowadzące na wolumen dodatkowy).
- `/opt/` — zawiera `/opt/containerd` oraz `/opt/durnoty-runtime` (`189 MB`, izolowane binarium Node.js `v24.21.0` dla `durnoty.service`).
- `/mnt/HC_Volume_<REDACTED>/` — dodatkowy dysk 49 GB zawierający m.in. `roleplayingtech.com` (`9.3 GB`), plik wymiany `reels-api-swapfile` (`8.1 GB`), `mumro-backups` (`1.5 GB`), `cache-evac-20260813T125300Z` (`778 MB`), `social-admin` (`563 MB`), `reels-api` (`235 MB`).
- **Istniejący wzorzec referencyjny na hoście:** Usługa `durnoty.service` wraz z `durnoty-backup.timer` stanowi najlepiej skonfigurowane wdrożenie na tym serwerze: działa na koncie `www-data`, używa izolowanego Node 24 z `/opt/durnoty-runtime`, pliku środowiskowego `/etc/durnoty.env`, flag izolacji `systemd` (`NoNewPrivileges=true`, `PrivateTmp=true`, `ProtectHome=true`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/durnoty`, `UMask=0027`) oraz dedykowanego timera kopii zapasowych (`OnCalendar=*-*-* 03:15:00`).

---

## 5. Sieć, zapora i bezpieczeństwo hosta

### 5.1. Interfejsy sieciowe i routing

**[Potwierdzone na serwerze]**:
- Interfejs publiczny `eth0`:
  - IPv4: `<HETZNER_IPV4>/32` z bramą domyślną `172.31.1.1`.
  - IPv6: `<HETZNER_IPV6_PREFIX>::1/64` z trasą domyślną `default via fe80::1 dev eth0`.
- Host ma w pełni skonfigurowany stos dual-stack (IPv4 + IPv6), a Nginx nasłuchuje zarówno na `0.0.0.0:80/443`, jak i `[::]:80/443`.

### 5.2. Stan zapory ogniowej (Firewall) i ryzyko ekspozycji istniejących usług

**[Potwierdzone na serwerze]**:
- `sudo ufw status verbose` zwraca: **`Status: inactive`**.
- W `iptables` oraz `ip6tables` łańcuch `INPUT` ma domyślną politykę **`ACCEPT`**, bez żadnych reguł blokujących ruch przychodzący na wysokie porty TCP.
- W `nftables` obecne są wyłącznie reguły wygenerowane przez demona Docker (`table ip nat`, `table ip filter`, `table ip raw`), które chronią kontenery zbindowane do `127.0.0.1` (`8000`, `8010`) przed dostępem spoza interfejsu `lo`, ale **nie chronią procesów hosta nasłuchujących na `0.0.0.0` / `*`**.
- **PILNE RYZYKO EKSPozycji ISTNIEJĄCYCH USŁUG (`[Potwierdzone na serwerze]` / `[Do sprawdzenia]`):**
  Cztery aktywne procesy innych projektów nasłuchują obecnie na wszystkich interfejsach (`0.0.0.0` / `*`):
  1. `0.0.0.0:3001` — `python3 -m http.server 3001` w `/home/admin/stacks/dupa` (niezarządzany proces z usuniętym binarium Pythona, działa od 286 dni — bezpośrednie serwowanie plików katalogu po HTTP!).
  2. `*:3002` — `node /var/www/monitor-mfc.roleplayingtech.com/backend` (PM2 `mfc-backend`).
  3. `0.0.0.0:3003` — `next-server (v16.2.1)` w `/var/www/historia-technologii` (PM2 `historia-technologii`).
  4. `0.0.0.0:5174` — `vite --host 0.0.0.0 --port 5174` w `/var/www/mumro/frontend` (niezarządzany serwer deweloperski Vite, działa od 99 dni).
  Jeżeli przed serwerem `hetz-1` nie jest włączony zewnętrzny **Hetzner Cloud Firewall** w panelu Hetzner Cloud (**[Do sprawdzenia]** pilnie przez właściciela), wszystkie cztery powyższe porty są bezpośrednio dostępne z publicznego internetu z pominięciem Nginx i TLS.
- **Zasada nieingerencji i izolacji PAP:** Zgodnie z granicami zadania nie zatrzymujemy ani nie rekonfigurujemy automatycznie powyższych procesów. Natomiast wszystkie komponenty Polish Accounting Platform (Web, API, PostgreSQL) **muszą bezwzględnie bindować gniazda wyłącznie do `127.0.0.1`**, nigdy do `0.0.0.0` ani `*`.

### 5.3. Konfiguracja SSH i ochrona dostępu

**[Potwierdzone na serwerze]** (`sshd -T` oraz `systemctl`):
- `port 22`, `permitrootlogin no`, `pubkeyauthentication yes`, `passwordauthentication no`, `kbdinteractiveauthentication no`, `maxauthtries 6`.
- Dostęp SSH jest poprawnie zawężony wyłącznie do kluczy publicznych i bez logowania na konto `root`.
- Na hoście nie ma zainstalowanego `fail2ban`, `crowdsec` ani `sshguard`.
- Działa `unattended-upgrades.service` zapewniający automatyczne poprawki bezpieczeństwa pakietów Ubuntu.

### 5.4. Stan Nginx i Certbot (analiza błędu `certbot.service`)

**[Potwierdzone na serwerze]**:
- W `/etc/nginx/sites-enabled/` aktywnych jest 14 vhostów: `app.mumro.io`, `atlas.swiadek-dziejow.pl`, `docs.mumro.io`, `durnoty.pl`, `mcp.mumro.io`, `monitor-mfc.roleplayingtech.com`, `mumro.io`, `mumro.io-academy`, `poezja.roleplayinglife.pl`, `reels-api.mumro.io`, `roleplayingtech.com`, `roleplayingtech.pl`, `shorts-api.mumro.io`, `swiadek-dziejow.pl`.
- Plik `/etc/nginx/sites-available/default` (`default_server` na porcie 80) nie jest podlinkowany w `/etc/nginx/sites-enabled/`, a na porcie `443` żaden vhost nie ma flagi `default_server` ani `ssl_reject_handshake on`.
- Przez to każde połączenie HTTPS dla nieznanej domeny (SNI) trafia do pierwszego alfabetycznie vhosta (`app.mumro.io`), zwracając certyfikat `app.mumro.io` oraz kod `HTTP/2 503` **[Potwierdzone na serwerze]**.
- **Przyczyna awarii `certbot.service`:** Timer uruchamia `certbot -q renew` dwa razy na dobę. Odnowienie kończy się kodem wyjścia `1`, ponieważ:
  1. Certyfikat `app.mumro.io` (obejmujący `app.mumro.io` i `mcp.mumro.io`, ważny do `2026-11-25`) nie może przejść weryfikacji HTTP-01 — domeny te zostały w DNS przepisane na inny serwer (`51.68.x.x`), gdzie połączenie na port 80 kończy się timeoutem.
  2. Certyfikat `roleplayingtech.com-0001` (ważny do `2026-11-25`) nie może przejść weryfikacji HTTP-01 — domena `roleplayingtech.com` w DNS wskazuje na GitHub Pages (`185.199.108.153` / `2606:50c0:8001::153`), który zwraca `404` dla ścieżki `.well-known/acme-challenge/`. Ponadto w Nginx domena `roleplayingtech.com` jest zadeklarowana jednocześnie w dwóch aktywnych plikach (`roleplayingtech.com` oraz `roleplayingtech.pl`).
- Pozostałe 12 certyfikatów Let's Encrypt jest ważnych (od 42 do 81 dni ważności).

---

## 6. Weryfikacja domeny docelowej i IDN / Punycode

Docelowy adres aplikacji:
- Postać wyświetlana (Unicode / U-label): `https://księgowość.roleplayingtech.com`
- Postać techniczna DNS (ASCII / A-label, IDNA2008 / Punycode): `xn--ksigowo-c5a1nq1a.roleplayingtech.com`
- Dodatkowy wariant ASCII (bez polskich znaków): `ksiegowosc.roleplayingtech.com`

### 6.1. Stan publicznego DNS (stan na 2026-10-28)

Wyniki zapytań do serwerów autorytatywnych `ns09.domaincontrol.com` i `ns10.domaincontrol.com` (**[Potwierdzone na serwerze]**):

| Nazwa DNS | Rekord `A` (IPv4) | Rekord `AAAA` (IPv6) | Rekord `CNAME` | Wskazuje na badany serwer Hetzner? |
| --- | --- | --- | --- | --- |
| `xn--ksigowo-c5a1nq1a.roleplayingtech.com` (`księgowość.roleplayingtech.com`) | **Brak (`NXDOMAIN`)** | **Brak (`NXDOMAIN`)** | **Brak** | **NIE** — rekord nie został jeszcze utworzony w strefie DNS |
| `ksiegowosc.roleplayingtech.com` (wariant ASCII) | **`<HETZNER_IPV4>`** (`TTL 600`) | **Brak** | **Brak** | **TAK** — wskazuje dokładnie na adres IPv4 `eth0` badanego hosta `hetz-1` |
| `monitor-mfc.roleplayingtech.com` (inna subdomena w tej strefie) | `<HETZNER_IPV4>` (`TTL 600`) | Brak | Brak | TAK |
| `roleplayingtech.com` (domena główna / apex) | `185.199.108.153` (`TTL 600`) | `2606:50c0:8001::153` | Brak | NIE (wskazuje na GitHub Pages) |

### 6.2. Wymagania techniczne dla domeny IDN (`księgowość.roleplayingtech.com`)

1. **Strefa DNS:** Aby docelowy adres `https://księgowość.roleplayingtech.com` działał, w panelu DNS dla `roleplayingtech.com` należy dodać rekord `A` dla nazwy **`xn--ksigowo-c5a1nq1a`** wskazujący na `<HETZNER_IPV4>` (oraz opcjonalnie rekord `AAAA` wskazujący na `<HETZNER_IPV6_PREFIX>::1`, ponieważ host i Nginx obsługują IPv6).
2. **Certyfikat TLS (Let's Encrypt / ACME):** Protokół ACME oraz certyfikaty X.509 przechowują w polu SAN (`Subject Alternative Name`) wyłącznie postać ASCII Punycode (`xn--ksigowo-c5a1nq1a.roleplayingtech.com`). Wywołanie Certbota musi używać flagi `-d xn--ksigowo-c5a1nq1a.roleplayingtech.com`.
3. **Konfiguracja Nginx (`server_name` i SNI):** Przeglądarki podczas TLS SNI oraz w nagłówku HTTP `Host` przesyłają postać Punycode `xn--ksigowo-c5a1nq1a.roleplayingtech.com`. W dyrektywie `server_name` Nginx należy wpisać postać `xn--ksigowo-c5a1nq1a.roleplayingtech.com` (z komentarzem `# księgowość.roleplayingtech.com`).
4. **Nagłówki `Origin`, `Referer`, CORS i przyszłe OIDC (`redirect_uri`):**
   - `new URL('https://księgowość.roleplayingtech.com').origin` w przeglądarkach i w Node.js (`whatwg-url`) serializuje się do `https://xn--ksigowo-c5a1nq1a.roleplayingtech.com`.
   - Walidacja nagłówka `Origin`/`Host` po stronie API i przyszłego serwera MCP oraz lista dozwolonych `redirect_uri` w providerze OIDC (etap `6D-2`) muszą operować na kanonicznej postaci ASCII `https://xn--ksigowo-c5a1nq1a.roleplayingtech.com`, przy jednoczesnym prezentowaniu użytkownikowi w UI przyjaznej nazwy `księgowość.roleplayingtech.com`.
5. **Ocena dodatkowego adresu ASCII `ksiegowosc.roleplayingtech.com`:**
   - Ponieważ rekord `A` dla `ksiegowosc.roleplayingtech.com` **już istnieje w DNS i wskazuje na ten serwer**, bardzo praktycznym i bezpiecznym rozwiązaniem (po uzyskaniu zgody właściciela) jest objęcie obu nazw jednym certyfikatem TLS (`-d xn--ksigowo-c5a1nq1a.roleplayingtech.com -d ksiegowosc.roleplayingtech.com`) i ustawienie w Nginx stałego przekierowania `308 Permanent Redirect` z `https://ksiegowosc.roleplayingtech.com` na kanoniczny adres `https://xn--ksigowo-c5a1nq1a.roleplayingtech.com` (`https://księgowość.roleplayingtech.com`).
   - Chroni to użytkowników wpisujących adres bez polskich znaków przed trafieniem na domyślny vhost Nginx (błąd certyfikatu `app.mumro.io` i kod `503`), a zarazem utrzymuje dokładnie jeden kanoniczny `Origin` dla ciasteczek, sesji i OIDC.

---

## 7. Inwentaryzacja stanu repozytorium a gotowość serwerowa

Wszystkie poniższe ustalenia mają status **[Potwierdzone w repo]** (na podstawie `main` `8baf642`):

| Komponent | Co już istnieje w repozytorium | Czego brakuje do środowiska serwerowego |
| --- | --- | --- |
| **Web (`@pap/web`)** | Next.js `16.4.3` (App Router), React `19.3.1`, strona statusu `/app`, statyczne placeholdery `/settings` i `/platform`. `readPublicSystemStatus` wymusza protokół `https:` dla `API_BASE_URL` gdy `NODE_ENV=production`. | W `apps/web/package.json` skrypt `start` uruchamia `next start --hostname 127.0.0.1` (domyślnie port `3000`); w `readPublicSystemStatus` przy `NODE_ENV=production` wymagany jest wąski, przetestowany wyjątek pozwalający wyłącznie na lokalny adres loopback `http://127.0.0.1:4100` (bez otwierania publicznego wyjątku od Basic Auth w Nginx). |
| **API (`@pap/api`)** | NestJS `12.2.0` + Fastify `5.12.7`. Endpointy `GET /health` i `GET /api/v1/system/status`. Nasłuch na `process.env.HOST ?? '127.0.0.1'` i `process.env.PORT ?? '4000'`. | API nie jest jeszcze połączone z `@pap/db`, nie ma jeszcze middleware OIDC (`6D-2`) ani tras biznesowych firm. Gotowe do uruchomienia w Etapie A (techniczny staging). |
| **MCP (`@pap/mcp`)** | `@modelcontextprotocol/server@2.4.0`, transport wyłącznie lokalny `STDIO` (`serveStdio`), jedno narzędzie read-only `system_status`. | Brak transportu Streamable HTTP, brak OAuth resource servera i autoryzacji (zaplanowane w `Issue #8` / `E2-01`). **Nie uruchamiać jako usługi sieciowej w Etapie A.** |
| **Baza i migracje (`@pap/db`)** | Drizzle ORM `0.45.4`, sterownik `postgres@3.4.9`, migracje `0000_technical-baseline.sql`, `0001_tenant-schema.sql` (`btree_gist`) oraz `0002_access-lifecycle.sql` (tabela `access_management_event` i triggery guardów cofnięcia/audytu), adaptery `PostgresTenantAuthorizationDataSource` (`6D-1`) i `PostgresAccessManagementStore` (`6D-R`). | `loadDatabaseConfig` w `packages/db/src/database-config.ts` **celowo blokuje** `NODE_ENV=production` oraz wartości `PAP_DATABASE_ENV` inne niż `local` i `test` (wymusza też nazwy kont/baz `pap_local` / `pap_test`). Aby uruchomić migracje na bazie `pap_staging`, wymagany będzie osobny, reviewowany PR dodający jawny profil `staging` (z zachowaniem wymogu loopback `127.0.0.1` i osobnych ról migracji/runtime). |
| **Bezpieczeństwo tenantów i cykl dostępu (`Issue #6`)** | Czysta polityka `6C` w `@pap/domain` i `@pap/application`, schemat relacyjny `6B` z FK/EXCLUDE w `@pap/db`, adapter odczytu faktów `6D-1` oraz bezpieczny transakcyjny cykl członkostw i grantów **`6D-R`** (`manageAccess` + guardy SQL w `0002_access-lifecycle.sql`, PR #21). | Brak jeszcze **`6D-2`** (OIDC + serwerowy autoryzator administracyjny + egzekwowanie w API) oraz **`6D-3`** (rola DB bez ownera/DDL/`TRUNCATE`/`BYPASSRLS`/możliwości wyłączenia triggerów, RLS, `SET LOCAL`, atomowe powiązanie kontekstu z operacją, audyt odmów). Blokuje to Etap B (wpuszczenie użytkowników i operacji firmowych), ale **nie blokuje Etapu A** (prywatnego stagingu technicznego bez danych firm). |
| **Zależność `esbuild` (GHSA-67mh-4wv8-2f99)** | W `pnpm-lock.yaml` obecny jest `esbuild@0.18.20` wciągany wyłącznie przechodnio przez `drizzle-kit@0.31.11 -> @esbuild-kit/esm-loader@2.6.5 -> @esbuild-kit/core-utils@3.3.2`. `pnpm audit --audit-level high` przechodzi bez błędów (podatność ma poziom `moderate`). | Podatność dotyczy wyłącznie serwera deweloperskiego `esbuild --serve`, który nie jest używany w projekcie ani nie trafia do runtime produkcyjnego. Można ją wyeliminować w osobnym PR przez `pnpm.overrides` lub aktualizację `drizzle-kit`. |
| **Ochrona gałęzi `main`** | W GitHub API gałąź `main` ma obecnie `protected: false` (brak wymuszonych status checks i review). | Przed włączeniem jakiejkolwiek automatyzacji CD na staging wymagane jest włączenie ochrony gałęzi `main` (Branch Ruleset). |
