# 35. Przewodnik interfejsu webowego (`apps/web`) i Akademii Polskiej Księgowości

Dokument opisuje architekturę warstwy prezentacji `apps/web` (Next.js 16 App Router, React 19, Tailwind CSS 4, `@pap/ui`), zasady bezpieczeństwa sesji BFF, obsługiwane persony syntetyczne, mapę ekranów operacyjnych oraz integrację Interaktywnej Akademii Polskiej Księgowości i pomocy kontekstowej `FieldHelpButton`.

---

## 1. Kierunek wizualny „Księga Współczesna” i standard WCAG 2.2 AA

Interfejs realizuje specyfikację z [`docs/21-kierunek-wizualny.md`](./21-kierunek-wizualny.md) oraz walidację wzorców z **Issue #13**:

- **Paleta i powierzchnie:** ciepły papier ewidencyjny `#faf9f5`, czyste karty robocze `#ffffff`, cienkie linie rubryk `#e5e2d9`, obramowania formularzy o kontraście `>= 3:1` (`#858177`), głęboki grafitowy atrament `#191c1a`, leśno-szmaragdowy akcent operacyjny `#1d5c42` oraz semantyczny bursztyn ostrzeżeń i podstaw prawnych.
- **Zero dekoracyjnego „AI slop”:** brak neonowych gradientów, brak glassmorphismu, brak fałszywych pasków postępu i brak ukrywania decyzji podatkowych za ogólnikowym komunikatem czatu.
- **Typografia kwot i identyfikatorów:** wszystkie kwoty w PLN/groszach, stawki podatków, daty ISO (`RRRR-MM-DD`), numery NIP, numery KSeF i rachunki IBAN używają `font-variant-numeric: tabular-nums` (`MoneyAmount`, `MoneyInput`, `NipInput`).
- **Dostępność i urządzenia mobilne (`375px`):**
  - żaden stan nie opiera się wyłącznie na kolorze — każda odznaka `StatusBadge` i `AlertBanner` łączy ton kolorystyczny z dedykowaną ikoną SVG i jawną polską etykietą tekstową;
  - tabele księgowe `LedgerTable` przełączają się na wąskich ekranach w czytelne karty rekordów z zachowaniem głównej kwoty i statusu;
  - wszystkie pola formularzy posiadają jawne powiązania `<label htmlFor="...">` i unikalne identyfikatory `id`;
  - pełna obsługa klawiatury (`SkipToContentLink`, `focus-visible`, pułapka fokusu i `Escape` w modalach `CriticalConfirmDialog`, szufladach podstawy prawnej oraz dymkach `FieldHelpButton`), poszanowanie `prefers-reduced-motion`.

---

## 2. Architektura BFF, bezpieczeństwo `API_BASE_URL` i ciasteczka sesji

Warstwa `apps/web` działa jako **Backend-for-Frontend (BFF)** i ściśle przestrzega granic modułowych ESLint (brak bezpośrednich importów `@pap/db`, `@pap/mcp`, `drizzle-orm` oraz `postgres`):

1. **Zamknięta biała lista `API_BASE_URL` i blokada SSRF / Path Traversal (`apps/web/lib/api-url.ts` oraz `apps/web/lib/read-system-status.ts`):**
   - w środowisku lokalnym (`NODE_ENV !== 'production'`) domyślnym adresem API jest `http://127.0.0.1:4000`;
   - w `NODE_ENV === 'production'` dozwolone są wyłącznie dwa jawne adresy: `http://127.0.0.1:4100` (loopback stagingu za wspólną bramką HTTP Basic Auth na Hetznerze) oraz `https://ksiegowosc.roleplayingtech.com`;
   - każdy adres zawierający poświadczenia `user:pass@`, ścieżkę, query string, fragment `#`, spacje lub nieautoryzowany host jest odrzucany przed wywołaniem `fetch`; ścieżki przekazywane do `papBffFetch` muszą rozpoczynać się od `/api/` lub `/health`, odrzucają znaki kontrolne, `\`, `..`, `#`, `//` i zakodowane sekwencje `%2e/%2f/%5c`, a po `new URL(path, baseUrl)` weryfikują `targetUrl.origin === baseUrl.origin`;
   - wszystkie wywołania serwerowe wymuszają `redirect: 'error'`, `cache: 'no-store'` oraz jawny `AbortSignal.timeout`, a odpowiedzi błędów autoryzacji lub walidacji z `apps/api` (`401`, `403`, `400..499`) działają w trybie **fail-closed** (rzucają `WorkspaceAccessError` bez mutowania lokalnego stanu pomocniczego).
2. **Kryptograficznie podpisane ciasteczka `HttpOnly` i ochrona CSRF (`apps/web/lib/session.ts`, `apps/web/lib/request-security.ts`):**
   - token OIDC (`pap_oidc_token`) oraz kontekst wybranej firmy i okresu (`pap_session_ctx`) są zapisywane przez Route Handlery `/api/session/login`, `/api/session/context` i `/api/session/logout` z flagami `HttpOnly; SameSite=Lax; Path=/` (oraz `Secure` w `NODE_ENV === 'production'`);
   - wartość `pap_session_ctx` jest podpisywana kluczem serwerowym **HMAC-SHA256** (`PAP_WEB_SESSION_SECRET`, z bezpiecznym losowym 32-bajtowym sekretem efemerycznym per proces w środowisku deweloperskim/testowym) i weryfikowana w stałym czasie (`timingSafeEqual`), wiążąc kryptograficznie `oidcToken` + `userId` + `personaId` + `tenantId` + `legalEntityId` + `period` (przy wymuszeniu formatu UUID dla `userId`, `tenantId` i `legalEntityId`);
   - wszystkie mutujące trasy `POST` BFF (`/api/session/login`, `/api/session/logout`, `/api/session/context`, `/api/workspace/actions`) weryfikują nagłówki `Origin` / `Referer` (`assertSameOriginMutation`), sanityzują przekierowania wewnętrzne (`sanitizeInternalRedirect`) oraz ograniczają rozmiar ładunku JSON (`256 KB`);
   - aplikacja **nigdy** nie zapisuje tokenów OIDC w `localStorage` ani `sessionStorage` i nie przekazuje `syntheticOidcToken` do komponentów klienckich HTML/RSC.
3. **Niezmiennik diagnostyczny `/app` (`SystemStatusDiagnosticSection`):**
   - strona `/app` (zarówno bez aktywnej sesji, jak i po zalogowaniu) renderuje sekcję `Zakres pierwszego etapu` (`border-radius: 16px`) oraz dokładnie jedną odznakę stanu połączenia `API odpowiada` / `API niedostępne` zgodną z kontraktem testu E2E `apps/web/e2e/system-status.spec.ts` i skryptem `pap-smoke-test.sh`.

---

## 3. Syntetyczne persony testowe i izolacja tenantów (`/login`)

Ekran `/login` udostępnia trzy syntetyczne persony testowe z wyraźnym oznaczeniem środowiska nieprodukcyjnego:

| Persona                                   | Organizacja (Tenant)                           | Uprawnienia i cel testowy                                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jan Testowy** (`jan-testowy`)           | Tenant 1 (`Grupa Projektowa Jan Testowy`)      | Właściciel (`tenant_owner`) z pełnym dostępem `read + write` do 3 firm demonstracyjnych: JDG na KPiR + VAT, JDG na ryczałcie (zw. z VAT do 240 000 PLN) oraz Sp. z o.o. na pełnych księgach UoR i CIT 9%.                        |
| **Marta Księgowa** (`marta-ksiegowa`)     | Tenant 1 (`Grupa Projektowa Jan Testowy`)      | Zewnętrzna księgowa (`tenant_member`) z jawnymi grantami podmiotowymi: `read + write` dla JDG KPiR i Sp. z o.o., wyłącznie `read` dla JDG Ryczałt, brak uprawnień właścicielskich do nadawania/cofania grantów (ADR-003).        |
| **Piotr Izolacyjny** (`piotr-izolacyjny`) | Tenant 2 (`Przedsiębiorstwo Piotr Izolacyjny`) | Właściciel odrębnego Tenant 2 (`Hurtownia Syntetyczna`). Każda próba przełączenia kontekstu lub wykonania akcji na podmiotach z Tenant 1 kończy się odmową `403` (`active_membership_required`) rejestrowaną w dzienniku audytu. |

Przełącznik aktywnej firmy (`[data-testid="company-profile-switcher"]`) oraz okresu rozliczeniowego (`RRRR-MM`) znajduje się w nagłówku `WorkspaceShell` na każdym ekranie operacyjnym. W razie odmowy dostępu (`403`) strony SSR `/app/*` renderują dedykowaną polską kartę błędu `WorkspaceAccessDeniedCard` z możliwością natychmiastowego przełączenia podmiotu lub przejścia do `/app/companies`.

---

## 4. Mapa ekranów aplikacji (`apps/web/app/`)

1. **`/` — Strona główna produktu:** wprowadzenie do platformy, podsumowanie modułów księgowych 2025/2026, skrót do Akademii Księgowości i logowania syntetycznego.
2. **`/login` — Wybór persony OIDC:** logowanie jednym kliknięciem do wybranej roli i firmy syntetycznej (bez ujawniania surowego tokena w drzewie komponentów klienckich).
3. **`/app` — Pulpit operacyjny „Do zrobienia dziś”:**
   - 5 kart KPI bieżącego miesiąca w PLN (`Przychody`, `Koszty KUP`, `Bilans VAT`, `Zaliczka PIT / Ryczałt PPE / CIT`, `Składki ZUS DRA`);
   - kolejka `ActionQueue` dokumentów z propozycją AI i szkiców MCP oczekujących na zatwierdzenie człowieka;
   - oś czasu terminów podatkowych `ObligationTimeline` z przesunięciami weekendowo-świątecznymi wg `art. 12 § 5` Ordynacji podatkowej;
   - sekcja diagnostyczna `Zakres pierwszego etapu`.
4. **`/app/companies` (oraz aliasy `/settings`, `/platform`) — Podmioty, profile podatkowe, granty i audyt:**
   - lista dostępnych firm z przełączaniem kontekstu, formularz rejestracji nowego podmiotu (`NipInput`, `TaxRegimeSelector`, pomoc `?`), edycja ustawień podatkowych i ZUS, zarządzanie grantami użytkowników (`ConfirmOperationDialog` przy cofaniu dostępu) oraz pełny dziennik audytu (`UI` / `API` / `MCP`).
5. **`/app/documents` i `/app/documents/[documentId]` (aliasy `/documents`, `/invoices`) — Obieg dokumentów i Split-View weryfikacji AI:**
   - wyszukiwarka i filtry statusów (`Szkic`, `Propozycja AI`, `Zweryfikowany i zaksięgowany`), detekcja duplikatów po skrócie `SHA-256`, walidacja sumy kontrolnej NIP i kalendarzowych dat ISO oraz oznaczenia KSeF (`FA(3)`, `OFF`, `BFK`, `DI`);
   - import jednym kliknięciem przykładowej faktury ustrukturyzowanej XML `KSeF FA(3)` lub pliku CSV oraz formularz ręczny (sprzedaż, zakup, korekta);
   - widok szczegółowy `SplitVerificationView`: oryginał XML/OCR po lewej, pola z oceną pewności AI po prawej, kwalifikacja kosztu (w tym samochód osobowy o użytku mieszanym `50% VAT / 75% KUP`), kalkulacja na żywo z wyjaśnieniem „Dlaczego?” oraz modal potwierdzenia człowieka **„Zatwierdź i zaksięguj dokument”** obsługujący KPiR, ewidencję ryczałtu oraz zbilansowany dziennik pełnych ksiąg Sp. z o.o. (`Wn === Ma`).
6. **`/app/kpir` (alias `/accounting/kpir`) — Podatkowa Księga Przychodów i Rozchodów:**
   - przełącznik wzoru rozporządzenia: **2026 — 19 kolumn z nr KSeF (Kol. 3), nr dowodu (Kol. 4) i pozostałymi wydatkami (Kol. 15) wg Dz.U. 2025 poz. 1299** vs **2019 — 17 kolumn (pozostałe wydatki w Kol. 13)**;
   - tabela wpisów z podsumowaniem miesiąca, klikalny przycisk `§ Dlaczego?` dla każdego wiersza, symulacja porównawcza zaliczki PIT (skala `12%/32%` vs liniowy `19%`), formularz wpisu ręcznego oraz czerwonego storna/korekty.
7. **`/app/ryczalt` (alias `/accounting/ryczalt`) — Ewidencja przychodów ryczałtowych:**
   - zestawienie przychodów wg stawek ryczałtu (`12%`, `8,5%`, `15%`, `17%` itd.), wyliczenie miesięcznego ryczałtu PPE po odliczeniu ZUS społecznego i 50% składki zdrowotnej oraz wizualny monitor limitu zwolnienia podmiotowego VAT (`240 000 PLN` od 2026 r., `art. 113 ust. 1` ustawy o VAT).
8. **`/app/vat` (aliasy `/taxes`, `/app/vat-jpk`) — Rejestry VAT i podgląd `JPK_V7M(3)`:**
   - rejestr sprzedaży i rejestr zakupów VAT (z jawnym rozbiciem kwoty VAT odliczonego `50%` i nieodliczonego `50%`), znaczniki KSeF (`NrKSeF`, `OFF`, `BFK`, `DI`), kody GTU/MPP oraz wyliczenie pól deklaracyjnych `P_10`–`P_62` z ostrzeżeniem, że wysyłka do MF wymaga podpisu kwalifikowanego lub Profilu Zaufanego poza środowiskiem testowym.
9. **`/app/ledger` (aliasy `/accounting/ledger`, `/accounting/reports`) — Pełne księgi UoR i CIT dla Sp. z o.o.:**
   - plan kont (Zespoły `0`–`8`), dziennik księgowań z wielopozycyjnym formularzem dekretu kontrolującym na żywo równowagę `Wn === Ma`, zestawienie obrotów i sald, uproszczony Bilans, Rachunek Zysków i Strat oraz kalkulacja zaliczki CIT (`9%` mały podatnik vs `19%`). Dla firm JDG wyświetla baner edukacyjny z przełączeniem jednym kliknięciem na spółkę demo.
10. **`/app/finance` (alias `/payments`) — Rozrachunki, wiekowanie i wyciągi bankowe CSV / MT940:**
    - lista otwartych należności i zobowiązań z wiekowaniem po terminie płatności, weryfikacją rachunku na Białej Liście KAS i oznaczeniem obowiązkowego MPP (`> 15 000 PLN` brutto, załącznik nr 15), import wyciągu CSV / MT940 oraz deterministyczne parowanie przelewów z fakturami.
11. **`/app/calendar` i `/app/rules` (aliasy `/calendar`, `/app/legal-rules`) — Kalendarz podatkowy i katalog reguł prawnych:**
    - oś obowiązków ZUS / PIT / CIT / VAT / KSeF z jawnym wykazaniem dni wolnych przesuwających termin wg `art. 12 § 5` Ordynacji podatkowej (w tym wolnej Wigilii `24 grudnia` od 2025 r.) i oznaczaniem zobowiązań jako opłaconych;
    - przeszukiwalny katalog wszystkich 32 zweryfikowanych reguł prawnych 2025–2026 z linkami do ISAP / Dz.U. / podatki.gov.pl / zus.pl.
12. **`/app/notifications` i `/app/mcp` (alias `/approvals/proposals/[proposalId]`) — Powiadomienia Sandbox RFC 5322 oraz Klienci AI / Kolejka MCP:**
    - konfiguracja wyprzedzeń (`7 dni`, `2 dni`, `w dniu terminu`, `3 dni po terminie`) i całkowitego wyłączenia (`opt-out`), ręczne wyzwolenie `dispatch-due` oraz podgląd wygenerowanych wiadomości **RFC 5322** (nagłówki MIME, `text/plain`, `text/html`, obowiązkowa stopka pomocnicza) w izolowanej Skrzynce Sandbox;
    - kolejka propozycji `prepare_invoice_and_posting_proposal` z dwuetapową bramką zatwierdzania człowieka (wygenerowanie jednorazowego wyzwania `issuedConfirmationCode`, weryfikacja daty wygaśnięcia `expiresAt` oraz dokładnej zgodności wpisanego `confirmationCode`) i gotowymi konfiguracjami **Streamable HTTP MCP** dla **Claude Desktop / Claude Code**, **Cursor**, **ChatGPT**, **Gemini CLI** oraz `curl` (ze zredagowanym placeholderem `<POBIERZ_TOKEN_Z_ENDPOINTU_OIDC>` zamiast surowego tokena sesji).

---

## 5. Interaktywna Akademia Polskiej Księgowości (`/academy`) i `FieldHelpButton`

- **Dostępność publiczna:** pełny katalog 12 modułów (37 lekcji) pod `/academy` oraz widoki lekcji `/academy/[moduleSlug]/[lessonSlug]` (i skrót `/academy/lekcja/[lessonSlug]`) działają zarówno bez logowania, jak i wewnątrz zalogowanej sesji.
- **Struktura lekcji:** każda lekcja prezentuje cel praktyczny, streszczenie, sekcje merytoryczne, przykłady liczbowe w PLN, najczęstsze błędy podatników, podgląd ekranu aplikacji ze wskazaniem docelowego widoku (`AcademyScreenshotPreview`), zweryfikowane cytowania ustawowe (`ISAP` / `podatki.gov.pl` / `zus.pl` / `biznes.gov.pl`) oraz interaktywny quiz sprawdzający (`LessonQuiz`) z wyjaśnieniem każdej odpowiedzi.
- **Kontekstowa pomoc `?` (`FieldHelpButton`):** krytyczne pola formularzy księgowych (`nip`, `ksef_reference`, `gtu_code`, `vehicle_75_kup`, `vat_50_vehicle`, `kup_deductibility`, `split_payment_mpp` / `mpp_split_payment`, `white_list_iban` / `whitelist_iban`, `wn_ma_balance` / `double_entry_wn_ma`, `mcp_human_confirmation` i pozostałe wpisy z `FIELD_HELP_REGISTRY` w `apps/web/lib/field-help.ts` oraz `ACADEMY_FIELD_HELP_ENTRIES` w `@pap/domain/academy`) posiadają przycisk `?` otwierający zwięzłe objaśnienie, przykład wypełnienia, podstawę prawną oraz bezpośredni link do właściwej lekcji Akademii.
- **Zastrzeżenie prawne (`ACADEMY_DISCLAIMER`):** każdy widok Akademii oraz ekrany wyliczeń podatkowych wyświetlają widoczne zastrzeżenie informujące, że materiały i kalkulatory mają charakter edukacyjno-pomocniczy i nie zastępują indywidualnej interpretacji podatkowej ani porady licencjonowanego doradcy podatkowego.

---

## 6. Uruchamianie celowanych kontroli jakości dla `apps/web`

```powershell
# Sprawdzenie typów Next.js 16 + TypeScript (bez pełnego buildu)
pnpm --filter @pap/web typecheck

# Linter ESLint (w tym reguły granic architektonicznych)
pnpm --filter @pap/web lint

# Testy granic architektonicznych monorepo
pnpm test:arch

# Testy jednostkowe BFF, izolacji tenantów i renderowania SSR ekranów/Akademii
pnpm --filter @pap/web test
```
