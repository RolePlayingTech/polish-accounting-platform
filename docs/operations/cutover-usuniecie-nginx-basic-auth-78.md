# Procedura cutover i rollback: bezpieczne usunięcie dodatkowego HTTP Basic Auth w Nginx (`#78`, `#83`)

**Status dokumentu:** gotowa procedura operacyjna — **wymaga odrębnej, jawnej zgody właściciela projektu przed wykonaniem na serwerze stagingowym (`hetz-1`)**.

> [!IMPORTANT]
> Scalenie Fali 2 (PR #92–#96) do gałęzi `main` **nie stanowi zgody na wdrożenie, migrację bazy stagingu ani modyfikację plików `/etc/nginx/`**. Do momentu zatwierdzenia i wykonania poniższej procedury przez właściciela domena `https://ksiegowosc.roleplayingtech.com` zachowuje dotychczasową ochronę warstwową.

---

## 1. Cel operacji

Przejście na docelowy model logowania użytkownika opisany w **Issue #78** oraz **ADR-011**:

1. Użytkownik otwiera `https://ksiegowosc.roleplayingtech.com` i widzi **jedno czyste logowanie aplikacyjne** (OAuth 2.0 Authorization Code + `PKCE S256`) bez dodatkowego systemowego okna przeglądarki HTTP Basic Auth i bez selektora syntetycznych person testowych.
2. Warstwa odwrotnego proxy Nginx zachowuje pełne utwardzenie transportowe (TLS 1.2/1.3, HSTS, nagłówki bezpieczeństwa, limity żądań `limit_req`, przekazywanie `X-Forwarded-Proto` / `X-Forwarded-Host` / `Host`, brak publicznego wystawienia portów loopback aplikacji i bazy).

---

## 2. Warunki wstępne (bramka GO przed zdjęciem Basic Auth)

Przed wykonaniem jakiejkolwiek zmiany w Nginx wszystkie poniższe punkty muszą mieć status **TAK**:

- [ ] **Migracje bazodanowe do `0009_company-tenant-nip-uniqueness.sql` wdrożone na bazie stagingu oraz wykonany `configureRuntimePrivileges`** tworzący tabele i funkcje Fali 2 (`pap_oidc_auth_state`, `pap_bff_session`, `pap_user_profile`, `pap_identity_lifecycle_event`, `pap_tenant_invitation` pod `FORCE RLS` i rolą runtime `NOBYPASSRLS`).
- [ ] **Tryb uruchomieniowy ustawiony na `PAP_RUNTIME_MODE=STAGING_PRIVATE`** (lub docelowo `PUBLIC_DEMO` / `PRODUCTION`) zarówno w usłudze `@pap/api`, jak i `@pap/web`:
  - `PAP_SANDBOX_AUTH_ENABLED=false`
  - `PAP_SEED_SYNTHETIC_DEMO=false`
  - silny sekret `PAP_WEB_SESSION_SECRET` (`>= 32` bajty losowej entropii, współdzielony wyłącznie między `@pap/web` a `@pap/api` na loopbacku).
- [ ] **Skonfigurowany produkcyjny/stagingowy dostawca OIDC** (`PAP_OIDC_ISSUER`, `PAP_OIDC_CLIENT_ID`, `PAP_OIDC_REDIRECT_URI=https://ksiegowosc.roleplayingtech.com/api/session/oidc/callback`, `PAP_OIDC_AUDIENCE`, `PAP_OIDC_JWKS_URI`).
- [ ] **Wykonany jednorazowy bootstrap właściciela organizacji** przez audytowalne CLI:
  ```bash
  pnpm --filter @pap/api bootstrap:owner \
    --issuer "<ISSUER_OIDC>" \
    --subject "<SUB_WLASCICIELA>" \
    --display-name "<NAZWA_WLASCICIELA>" \
    --email "<EMAIL_WLASCICIELA>" \
    --tenant-name "<NAZWA_ORGANIZACJI>" \
    --reason "Inicjalny bootstrap właściciela na prywatnym stagingu (#83)"
  ```
- [ ] **Zweryfikowano blokadę tras piaskownicy na loopbacku stagingu** przed zdjęciem Basic Auth:
  - `POST /api/v1/oidc/token` → `404` (`sandbox_oidc_disabled`)
  - `POST /api/v1/auth/sandbox/token` → `404` (`sandbox_oidc_disabled`)
  - `GET /api/v1/oidc/personas` → `404` (`sandbox_oidc_disabled`)
  - `POST /api/session/login` → `403` (`synthetic_persona_disabled`).

---

## 3. Kopia zapasowa i dokładna zmiana konfiguracji Nginx

### Krok 3.1 — Utworzenie znacznikowej kopii zapasowej przed edycją

```bash
sudo cp -a /etc/nginx/sites-available/ksiegowosc.roleplayingtech.com \
  "/etc/nginx/sites-available/ksiegowosc.roleplayingtech.com.bak.$(date -u +%Y%m%dT%H%M%SZ)"
```

_(Uwaga: nie usuwaj pliku `.htpasswd` z dysku podczas okna cutover — pozostaw go nienaruszonego, aby ewentualny rollback trwał poniżej 5 sekund.)_

### Krok 3.2 — Zakres zmiany w bloku `server` (`ksiegowosc.roleplayingtech.com`)

Usuń wyłącznie dyrektywy `auth_basic` oraz `auth_basic_user_file`, zachowując TLS, HSTS, nagłówki bezpieczeństwa oraz limity żądań dla punktów uwierzytelniania:

```diff
 server {
   listen 443 ssl http2;
   server_name ksiegowosc.roleplayingtech.com;

   # Certyfikaty TLS, HSTS i nagłówki bezpieczeństwa pozostają bez zmian
+  add_header Referrer-Policy "no-referrer" always;
-  auth_basic "Polish Accounting Platform — Staging";
-  auth_basic_user_file /etc/nginx/.htpasswd-ksiegowosc;

   # Ochrona rate-limit dla inicjacji i powrotu logowania OIDC oraz mutacji sesji
   location ~ ^/api/session/(oidc|invitations|login|refresh) {
     limit_req zone=pap_auth_limit burst=15 nodelay;
     proxy_pass http://127.0.0.1:3100;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto https;
     proxy_set_header X-Forwarded-Host $host;
   }

   location / {
     proxy_pass http://127.0.0.1:3100;
     proxy_http_version 1.1;
     proxy_set_header Host $host;
     proxy_set_header X-Real-IP $remote_addr;
     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
     proxy_set_header X-Forwarded-Proto https;
     proxy_set_header X-Forwarded-Host $host;
   }
 }
```

*(Jeżeli w `/etc/nginx/nginx.conf` nie zdefiniowano jeszcze strefy `pap_auth_limit`, dodaj w sekcji `http { ... }`: `limit_req_zone $binary_remote_addr zone=pap_auth_limit:10m rate=10r/s;`.)*

### Krok 3.3 — Walidacja składni i bezprzestojowe przeładowanie

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## 4. Kontrola po przełączeniu (Post-Cutover Smoke Test)

Wykonaj z zewnętrznej maszyny (bez poświadczeń Basic Auth):

1. **Brak wyzwania `401 WWW-Authenticate: Basic` i obecność czystego ekranu logowania OIDC:**
   ```bash
   curl -sSI https://ksiegowosc.roleplayingtech.com/login | grep -E "^(HTTP/|www-authenticate:|strict-transport-security:)"
   ```
   Oczekiwany wynik: `HTTP/2 200`, obecny nagłówek `strict-transport-security`, **brak** nagłówka `www-authenticate: Basic`.
2. **Brak selektora syntetycznych person w HTML `/login`:**
   - Strona zawiera przycisk `Zaloguj przez dostawcę tożsamości (OIDC)`, nie zawiera tekstu `Wybierz syntetyczną personę testową` ani `Jan Testowy`.
3. **Blokada nieautoryzowanego dostępu do API i sesji syntetycznych:**
   - `curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://ksiegowosc.roleplayingtech.com/api/session/login -H "Origin: https://ksiegowosc.roleplayingtech.com" -H "Content-Type: application/json" -d '{"personaId":"jan-testowy"}'` → **`403`**.
   - Nieuwierzytelnione żądanie do `/app/companies` wyświetla wyłącznie kartę wymaganego logowania OIDC bez ujawniania jakichkolwiek danych podmiotów.
4. **Test logowania właściciela w przeglądarce:**
   - Wejście na `https://ksiegowosc.roleplayingtech.com/login` → pojedyncze logowanie OIDC → poprawne utworzenie nieprzezroczystego ciasteczka sesji BFF `pap_session_id` (`Secure; HttpOnly; SameSite=Lax`) → dostęp do organizacji właściciela oraz poprawne wylogowanie do `/login?authState=signed_out`.

---

## 5. Natychmiastowy Rollback (poniżej 30 sekund)

W razie wykrycia jakiejkolwiek nieprawidłowości (np. niedostępności zewnętrznego dostawcy OIDC, błędnej konfiguracji redirect URI lub nieoczekiwanego zachowania nagłówków proxy) natychmiast przywróć kopię zapasową z Kroku 3.1:

```bash
LATEST_BAK="$(ls -1t /etc/nginx/sites-available/ksiegowosc.roleplayingtech.com.bak.* | head -n 1)"
sudo cp -a "${LATEST_BAK}" /etc/nginx/sites-available/ksiegowosc.roleplayingtech.com
sudo nginx -t && sudo systemctl reload nginx
```

Następnie zweryfikuj powrót bramki Basic Auth:

```bash
curl -sSI https://ksiegowosc.roleplayingtech.com/login | head -n 5
# Oczekiwane: HTTP/2 401 oraz www-authenticate: Basic
```
