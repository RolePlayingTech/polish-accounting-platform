# ADR-011: Tożsamość OIDC, współdzielone sesje BFF i cykl życia użytkowników (Fala 2)

- **Status:** Zaakceptowany (Fala 2 — Issues #83, #78; plan wykonawczy Astra PR #84)
- **Data:** 2026-11-09
- **Powiązane dokumenty:** [ADR-001](001-rdzen-i-mcp.md), [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [ADR-003](003-administracja-i-uprawnienia-produktowe.md), [ADR-004](004-model-zagrozen-i-autoryzacji.md), [ADR-006](006-tymczasowe-ci-hetzner.md), [ADR-010](010-granica-transakcji-i-idempotencja-fala1.md), [Polityka wewnętrznych merge](../internal-development-merge-policy.md)

## 1. Kontekst i problem

W Fali 1 ([ADR-010](010-granica-transakcji-i-idempotencja-fala1.md)) zamknięto luki spójności transakcyjnej PostgreSQL, współbieżnego tworzenia podmiotów prawnych oraz idempotencji komend księgowych między wieloma instancjami API.

W warstwie uwierzytelniania aplikacyjnego (`apps/web`) oraz inicjalizacji środowiska uruchomieniowego (`apps/api`) pozostało jednak tymczasowe uzależnienie od trzech syntetycznych person testowych (`jan-testowy`, `marta-ksiegowa`, `piotr-izolacyjny`):

1. **Sztywne powiązanie sesji Web z syntetycznymi personami (`#83`, `#78`)**:
   - `SessionContextSchema` w `apps/web/lib/session.ts` wymaga pola `personaId` z zamkniętej listy trzech person oraz odrzuca dowolnego użytkownika spoza `CANONICAL_PERSONA_IDENTITY`.
   - `resolveSessionHmacKey()` w przypadku braku lub zbyt krótkiego `PAP_WEB_SESSION_SECRET` generuje losowy klucz w pamięci procesu (`getEphemeralProcessSecret()`), co uniemożliwia utrzymanie sesji między dwiema instancjami Web i narusza zasadę fail-closed.
   - Surowy token dostępowy (`pap_oidc_token`) jest zapisywany bezpośrednio w ciasteczku przeglądarki, bez współdzielonego magazynu sesji po stronie serwera, bez obsługi odświeżania (`refresh_token`) i bez natychmiastowego unieważniania sesji po stronie serwera.
2. **Brak pełnego przepływu OAuth 2.0 Authorization Code + PKCE w BFF (`#83`)**:
   - Logowanie w `POST /api/session/login` przyjmuje `personaId` i wywołuje `POST /api/v1/oidc/token` (syntetyczny wystawca tokenów) bez uwierzytelnienia u dostawcy OIDC.
3. **Brak jawnego kontraktu trybu uruchomieniowego (`PAP_RUNTIME_MODE`) (`#78`, `#83`)**:
   - `SandboxOidcService` opiera blokadę na kombinacji `NODE_ENV`, `PAP_OIDC_ENV` i `PAP_ALLOW_PRIVATE_TEST_SANDBOX_OIDC`, zamiast jawnego rozróżnienia trybów wdrożeniowych (`LOCAL_DEV`, `STAGING_PRIVATE`, `PUBLIC_DEMO`, `PRODUCTION`).
4. **Brak produkcyjnego cyklu życia właściciela i zaproszeń użytkowników (`#83`)**:
   - Brakuje jednorazowego, audytowalnego mechanizmu bootstrapu pierwszego właściciela organizacji (`tenant_owner`) oraz jednorazowych, haszowanych zaproszeń (`TenantInvitation`) z kontrolą delegacji uprawnień.
   - Hydratacja przestrzeni roboczej w `apps/api/src/runtime/postgres-company-hydrator.ts` zakłada statyczny zestaw person z `DEMO_PERSONAS_SEED` i dwóch tenantów startowych.

Celem Fali 2 jest zastąpienie zależności ścieżki produkcyjnej od syntetycznych person pełnym, wielotenanckim modelem tożsamości OIDC, sesji BFF i zarządzania dostępem użytkowników, przy zachowaniu istniejącego weryfikatora JWKS (`JwksOidcAccessTokenVerifier`), rezolwera `(issuer, subject)` (`PostgresUserIdentityResolver`), podpisanych kontekstów transakcyjnych (`PostgresContextSigner`) i polityk `FORCE ROW LEVEL SECURITY`.

---

## 2. Decyzja architektoniczna

### 2.1. Przepływ OAuth 2.0 Authorization Code + PKCE w warstwie BFF (`apps/web`)

1. **Inicjacja logowania (`GET /api/session/oidc/authorize` / `POST /api/session/oidc/authorize`)**:
   - BFF generuje kryptograficznie losowe wartości `state` (≥ 128 bitów entropii), `nonce` (≥ 128 bitów entropii) oraz `code_verifier` PKCE (≥ 43 znaki base64url, metoda `S256` -> `code_challenge`).
   - Stan transakcji autoryzacyjnej OIDC jest zapisywany po stronie serwera w magazynie sesji (`WebSessionStorePort`) z krótkim czasem życia (TTL ≤ 10 minut) i powiązany z krótkotrwałym ciasteczkiem transakcyjnym (`HttpOnly`, `Secure` dla HTTPS, `SameSite=Lax`, `Path=/`).
   - Adres `redirect_uri` oraz docelowa ścieżka powrotu (`returnTo`) są ściśle walidowane (wyłącznie względne ścieżki wewnętrzne aplikacji zaczynające się od `/` bez `//` ani schematów zewnętrznych).
2. **Wymiana kodu i walidacja (`GET /api/session/oidc/callback`)**:
   - BFF weryfikuje obecność i ważność transakcji PKCE, zgodność `state` w czasie stałym (`timingSafeEqual`) oraz jednorazowość transakcji (ochrona przed replay kodu autoryzacyjnego).
   - Wymiana `code` + `code_verifier` na tokeny (`access_token`, `id_token`, opcjonalnie `refresh_token`) odbywa się wyłącznie po stronie serwera (server-to-server) z jawną walidacją `issuer`, `audience`, `client_id`/`azp`, `nonce`, `exp`, `iat`/`nbf` oraz podpisu asymetrycznego JWS przez JWKS.
   - Weryfikacja tożsamości i rozwiązanie wewnętrznego `userId` następuje przez API / `PostgresUserIdentityResolver` wyłącznie po parze `(issuer, subject)`. **Nigdy nie łączymy kont automatycznie na podstawie zgodności adresu e-mail.**

### 2.2. Niejawne sesje aplikacyjne (`pap_session_id`) i współdzielony magazyn sesji

1. **Ciasteczko sesyjne przeglądarki**:
   - Przeglądarka otrzymuje wyłącznie niejawny, losowy identyfikator sesji (`sessionId`, ≥ 256 bitów entropii) w ciasteczku `pap_session_id` z atrybutami `HttpOnly`, `Secure` (w środowiskach HTTPS / poza lokalnym `http://127.0.0.1`), `SameSite=Lax`, `Path=/`.
   - Surowe tokeny OIDC (`access_token`, `refresh_token`, `id_token`) **nigdy** nie trafiają do ciasteczek przeglądarki, `localStorage`, `sessionStorage`, logów klienta ani komunikatów błędów.
2. **Współdzielony magazyn sesji (`WebSessionStorePort`)**:
   - W bazie danych (adapter PostgreSQL dla wielu instancji Web oraz restartów procesu; adapter in-memory wyłącznie dla izolowanych testów jednostkowych bez bazy) przechowywany jest wyłącznie skrót `SHA-256(sessionId)` (`sessionIdHash`), nigdy jawny identyfikator z ciasteczka.
   - Rekord sesji przechowuje: `sessionIdHash`, `userId`, `issuer`, `subject`, `displayName`, `email`, wybrany kontekst roboczy (`tenantId`, `legalEntityId`, `period`), zaszyfrowane AEAD (`AES-256-GCM` kluczem wyprowadzonym z `PAP_WEB_SESSION_SECRET`) tokeny `accessToken` i `refreshToken`, `accessTokenExpiresAt`, `sessionExpiresAt`, `refreshGeneration`, `revokedAt` oraz `lastRotatedAt`.
3. **Bezpieczna rotacja `refresh_token` i współbieżność między instancjami Web**:
   - Gdy `access_token` wygasł lub zbliża się do wygaśnięcia, BFF wykonuje odświeżenie sesji z blokadą wiersza / atomową aktualizacją generacji (`refreshGeneration`).
   - Jeżeli dwie instancje Web podejmą równoległą próbę odświeżenia tej samej sesji, pierwsza zapisuje nową parę tokenów i inkrementuje `refreshGeneration`, natomiast druga odczytuje świeżo zrotowany stan sesji zamiast powtarzać żądanie ze zużytym tokenem.
   - Próba użycia unieważnionej (`revokedAt IS NOT NULL`) lub wygasłej sesji kończy się natychmiastową odmową (`401 session_expired_or_invalid`) i wyczyszczeniem ciasteczka.
4. **Fail-closed dla konfiguracji i magazynu sesji**:
   - Poza jawnym trybem testowym (`NODE_ENV=test`) aplikacja wymaga jawnego `PAP_WEB_SESSION_SECRET` o długości co najmniej 32 znaków. Brak sekretu lub niedostępność współdzielonego magazynu sesji powoduje natychmiastową odmowę (`503 auth_service_unavailable` / błąd startu), bez cichego generowania klucza efemerycznego w pamięci procesu i bez przełączania na syntetyczne persony.
5. **Ochrona CSRF**:
   - Wszystkie operacje zmieniające stan sesji lub wywołujące mutacje BFF (`POST`, `PUT`, `PATCH`, `DELETE`) weryfikują `assertSameOriginMutation(request)` (zgodność `Origin`/`Referer` z oczekiwanym originem aplikacji).

### 2.3. Jawny tryb uruchomieniowy (`PAP_RUNTIME_MODE`) i blokada piaskownicy OIDC

1. Wprowadzamy kanoniczny kontrakt trybu uruchomieniowego `PAP_RUNTIME_MODE`:
   - `'LOCAL_DEV'` — lokalne środowisko deweloperskie i izolowane testy jednostkowe/integracyjne.
   - `'STAGING_PRIVATE'` — prywatny staging techniczny właściciela na Hetznerze.
   - `'PUBLIC_DEMO'` — odizolowane środowisko demonstracyjne z danymi syntetycznymi.
   - `'PRODUCTION'` — docelowe środowisko produkcyjne SaaS.
2. **Zasada blokady syntetycznego wystawcy OIDC (`SandboxOidcService` / `SandboxOidcController`)**:
   - W trybie `'PRODUCTION'` oraz `'PUBLIC_DEMO'` (a także w `'STAGING_PRIVATE'` bez jawnego wyłączenia w izolowanym teście CI) wydawanie tokenów bez poświadczeń (`POST /api/v1/oidc/token`) oraz logowanie syntetyczną personą w BFF są bezwzględnie wyłączone (`403 sandbox_oidc_disabled`).
   - Sama wartość `NODE_ENV` nie stanowi jedynego kryterium bezpieczeństwa — `PAP_RUNTIME_MODE` jest walidowany niezależnie i działa w trybie fail-closed (nierozpoznana wartość lub sprzeczna konfiguracja blokuje start / zwraca odmowę).

### 2.4. Cykl życia użytkownika, jednorazowy bootstrap właściciela i zaproszenia (`Phase B & C`)

1. **Tożsamość i wielotenanckość (`app_user`, `user_oidc_identity`, `tenant_membership`)**:
   - Jeden użytkownik (`app_user`) może posiadać aktywne członkostwa w wielu organizacjach (`1 user -> N tenants`), a każda organizacja (`tenant`) może zawierać wiele podmiotów prawnych (`1 tenant -> M legal_entities`).
   - Dostęp do operacji księgowych na podmiocie prawnym wymaga jednocześnie aktywnego konta `app_user`, aktywnego członkostwa w `tenant_membership` oraz jawnego grantu w `company_access_grant` (`read` lub `write`), zgodnie z `decideAccountingAccess` i `pap_company_allowed`.
   - Rola `tenant_owner` lub `tenant_admin` uprawnia do administracji organizacją i tworzenia podmiotów prawnych (`pap_provision_company`), ale sama w sobie nie zastępuje jawnego grantu do firmy przy operacjach księgowych.
2. **Jednorazowy, audytowalny bootstrap pierwszego właściciela (`bootstrapOwnerAndTenant`)**:
   - Bootstrap pierwszego właściciela odbywa się wyłącznie poprzez kontrolowaną operację administracyjną (komenda CLI / serwis administracyjny z poświadczeniami migratora/operatora, nigdy przez publiczny endpoint typu „first-visitor-wins” i nigdy przez statyczne hasło `admin/admin`).
   - Operacja przyjmuje zweryfikowaną parę `(issuer, subject)`, nazwę organizacji oraz metadane właściciela, atomowo tworzy (lub wiąże idempotentnie dla tego samego właściciela) rekordy `app_user`, `user_oidc_identity`, `tenant` i `tenant_membership(role = 'tenant_owner', status = 'active')` oraz zapisuje zdarzenie audytowe.
   - Jeżeli organizacja posiada już aktywnego właściciela o innej tożsamości, operacja kończy się odmową fail-closed (`409 owner_already_bootstrapped`).
3. **Jednorazowe zaproszenia do organizacji (`TenantInvitation`)**:
   - Właściciel (`tenant_owner`) lub administrator organizacji (`tenant_admin`) może wystawić zaproszenie powiązane z `tenantId`, docelową rolą (`intendedRole`) oraz opcjonalną listą początkowych grantów do firm (`initialCompanyGrants`).
   - **Kontrola delegacji uprawnień**:
     - `tenant_admin` nie może wystawić zaproszenia z rolą `tenant_owner` ani `tenant_admin` (wyłącznie `tenant_member`), ani delegować początkowych grantów (`read`/`write`) do firm, do których sam nie posiada aktywnego grantu.
     - Wyłącznie `tenant_owner` może wystawić zaproszenie z rolą `tenant_admin` lub `tenant_owner` oraz delegować początkowe granty do firm w swoim tenancie.
   - **Bezpieczeństwo tokenu zaproszenia**:
     - Surowy token zaproszenia (≥ 192 bity entropii) jest zwracany wyłącznie raz w momencie utworzenia zaproszenia; po stronie serwera przechowywany jest wyłącznie skrót `SHA-256(invitationToken)` (`tokenHash`).
   - **Akceptacja, wygaśnięcie i odwołanie**:
     - Zaproszenie jest jednorazowe (`status: 'pending' | 'accepted' | 'expired' | 'revoked' | 'rejected'`) i posiada obowiązkowy termin ważności (`expiresAt`).
     - Akceptacja zaproszenia przez uwierzytelnionego użytkownika OIDC (`(issuer, subject)`) atomowo tworzy/wiąże `app_user`, `tenant_membership` i dozwolone początkowe granty `company_access_grant`, oznacza zaproszenie jako `accepted` i rejestruje ślad audytowy.
     - Próba ponownego użycia zaakceptowanego, wygasłego lub odwołanego zaproszenia kończy się odmową fail-closed (`409 invitation_already_used` / `410 invitation_expired` / `403 invitation_revoked`).
4. **Natychmiastowe cofnięcie dostępu i wyłączenie konta**:
   - Cofnięcie grantu (`revoke_grant`), cofnięcie członkostwa (`revoke_membership`) lub wyłączenie konta (`app_user.status = 'disabled'`) obowiązuje natychmiast przy kolejnym żądaniu API/BFF, bez konieczności wygaśnięcia bieżącego tokenu JWT.

### 2.5. Uproszczone logowanie aplikacyjne i bramka wyłączenia Nginx HTTP Basic Auth (`#78`)

1. Ekran `/login` prezentuje jedno czyste wejście do logowania OIDC (zgodnie z `docs/21-kierunek-wizualny.md`), bez selektora trzech syntetycznych person w trybach niebędących lokalną piaskownicą.
2. Interfejs obsługuje i komunikuje w prostym języku polskim stany:
   - wylogowany (`signed_out`),
   - trwa logowanie (`signing_in`),
   - sesja wygasła lub jest nieprawidłowa (`session_expired_or_invalid`),
   - brak przypisania do organizacji (`no_tenant_membership`),
   - zaproszenie oczekujące lub wygasłe (`invitation_pending_or_expired`),
   - brak uprawnień do wybranej firmy (`insufficient_permissions`),
   - usługa uwierzytelniania chwilowo niedostępna (`auth_service_unavailable`).
3. **Bramka infrastrukturalna `#78`**:
   - Wyłączenie dodatkowego `auth_basic` w Nginx na żywym stagingu (`https://ksiegowosc.roleplayingtech.com`) nie jest wykonywane automatycznie podczas merge kodu.
   - Odcięcie `auth_basic` wymaga uprzedniego przejścia pełnej weryfikacji E2E i kontrprzykładów (2 instancje Web + 2 instancje API + OIDC + PostgreSQL 18.6) oraz osobnej zgody właściciela według udokumentowanego planu cutover/rollback.

---

## 3. Konsekwencje

### Pozytywne
- Jedno spójne logowanie OIDC z PKCE, bezpiecznymi ciasteczkami `HttpOnly` i współdzielonym magazynem sesji działającym między wieloma instancjami Web i po restarcie.
- Całkowite usunięcie zależności ścieżki produkcyjnej od syntetycznych person (`jan-testowy`, `marta-ksiegowa`, `piotr-izolacyjny`) oraz zablokowanie `SandboxOidcService` poza lokalnym środowiskiem testowym.
- Pełna obsługa wielu organizacji na jednego użytkownika (`1 user -> N tenants`) i wielu firm w organizacji (`1 tenant -> M legal_entities`) z zachowaniem `FORCE ROW LEVEL SECURITY` i niezmiennego audytu w PostgreSQL.

### Wymagania weryfikacyjne (Definition of Done Fali 2)
- Testy jednostkowe, integracyjne i kontrprzykłady (adversarial) obejmujące: błędny `issuer`/`audience`, wygasły/odwołany token, powtórzony kod autoryzacyjny (replay), błędny `state`/`nonce`/PKCE, manipulację `redirect_uri`, brak CSRF, współbieżne odświeżenie sesji między 2 instancjami Web, wylogowanie i próbę ponownego użycia starego ciasteczka, awarię magazynu sesji, brak `PAP_WEB_SESSION_SECRET`, eskalację uprawnień w zaproszeniach, akceptację wygasłego/odwołanego zaproszenia, wyłączone konto z aktywną sesją oraz kolizję adresu e-mail przy różnej parze `(issuer, subject)`.
