# 36. Przewodnik użytkownika, ról organizacji, klienta MCP oraz FAQ podatnika

> **Zastrzeżenie prawne i operacyjne:** Niniejszy przewodnik opisuje rzeczywiste działanie aplikacji **Polish Accounting Platform** w wersji zaimplementowanej na gałęzi `main`. Środowisko testowe i demonstracyjne posługuje się wyłącznie **danymi syntetycznymi**, nie wysyła deklaracji ani faktur do produkcyjnych systemów Ministerstwa Finansów (`KSeF`, `e-Deklaracje`), ZUS ani banków oraz nie stanowi doradztwa podatkowego, prawnego ani księgowego w rozumieniu ustawy o doradztwie podatkowym.

---

## 1. Pierwsze kroki: logowanie personami testowymi i nawigacja

### 1.1. Wybór persony na ekranie `/login`

W środowisku deweloperskim i w prywatnym środowisku testowym (gdy aktywny jest bezpiecznik `SandboxOidcService`) ekran `/login` pozwala jednym kliknięciem zalogować się na jedną z trzech syntetycznych person, bez ręcznego generowania tokenów JWT i bez zapisywania ich w `localStorage` (sesja jest przechowywana wyłącznie w podpisanych ciasteczkach `HttpOnly`):

| Persona (`personaId`)                     | Organizacja (Tenant)                           | Rola i cel użycia w codziennych testach                                                                                                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Jan Testowy** (`jan-testowy`)           | `Grupa Projektowa Jan Testowy` (Tenant 1)      | **Właściciel organizacji (`owner`):** pełny odczyt i zapis we wszystkich 3 firmach demonstracyjnych (JDG KPiR + VAT, JDG Ryczałt zwolniona z VAT, Sp. z o.o. pełne księgi UoR + CIT) oraz prawo nadawania i cofania grantów dostępu.      |
| **Marta Księgowa** (`marta-ksiegowa`)     | `Grupa Projektowa Jan Testowy` (Tenant 1)      | **Księgowa (`accountant`):** posiada jawne granty podmiotowe — pełny zapis (`read + write`) na firmie JDG KPiR oraz Sp. z o.o., natomiast wyłącznie podgląd (`read`) na firmie JDG Ryczałt. Nie może zarządzać uprawnieniami innych osób. |
| **Piotr Izolacyjny** (`piotr-izolacyjny`) | `Przedsiębiorstwo Piotr Izolacyjny` (Tenant 2) | **Właściciel odrębnej organizacji:** widzi wyłącznie własną firmę (`Hurtownia Syntetyczna`). Służy do weryfikacji, że żadne dane z Tenant 1 nie przeciekają między organizacjami (`403 Forbidden`).                                       |

### 1.2. Przełączanie aktywnej firmy i okresu rozliczeniowego

Po zalogowaniu w górnym pasku nawigacyjnym każdego ekranu roboczego znajdują się dwa kluczowe selektory:

1. **Przełącznik podmiotu (`company-profile-switcher`):** zmienia aktywną firmę (`legalEntityId`) i automatycznie dostosowuje widoczne karty KPI oraz dostępne ewidencje (np. KPiR dla JDG na skali/liniowym, ewidencję ryczałtu dla ryczałtowca, pełne księgi UoR dla Sp. z o.o.).
2. **Selektor okresu rozliczeniowego (`RRRR-MM`):** ustawia miesiąc księgowy (np. `2025-10`, `2026-01`, `2026-03`). Silnik podatkowy automatycznie rozstrzyga przepisy obowiązujące w wybranym okresie (`resolveRuleAtDate`), dzięki czemu przełączenie z `2025-10` na `2026-03` natychmiast stosuje właściwy limit zwolnienia VAT (`200 000 PLN` vs `240 000 PLN`), układ kolumn PKPiR (`17` vs `19` kolumn) oraz wersję schemy `JPK_V7M(2)` vs `JPK_V7M(3)`.

### 1.3. Pulpit operacyjny „Do zrobienia dziś” (`/app`)

Ekran główny `/app` gromadzi najważniejsze informacje dla wybranej firmy i miesiąca:

- **5 kart podsumowania finansowego w PLN** (z czcionką tabelaryczną `tabular-nums`): `Przychody`, `Koszty KUP`, `Bilans VAT`, `Zaliczka PIT / Ryczałt PPE / CIT` oraz `Składki ZUS DRA`.
- **Kolejka zadań `ActionQueue`:** dokumenty ze statusem propozycji AI/KSeF oraz propozycje nadesłane przez agenta MCP oczekujące na ludzką weryfikację.
- **Oś terminów `ObligationTimeline`:** nadchodzące terminy ZUS, PIT/CIT i VAT z uwzględnieniem ustawowych przesunięć weekendowo-świątecznych (`art. 12 § 5` Ordynacji podatkowej).
- **Sekcja diagnostyczna `Zakres pierwszego etapu`:** potwierdzająca na żywo stan połączenia BFF → REST API (`API odpowiada`).

---

## 2. Codzienny obieg księgowy krok po kroku

### 2.1. Od importu faktury XML KSeF `FA(3)` do zatwierdzenia i zaksięgowania (`/app/documents`)

1. Przejdź do widoku **Dokumenty** (`/app/documents`).
2. Zaimportuj dokument jednym z trzech sposobów:
   - kliknij przycisk importu przykładowej faktury ustrukturyzowanej **XML `KSeF FA(3)`** (lub wklej własny syntetyczny ładunek XML `FA(2)`/`FA(3)`),
   - zaimportuj paczkę CSV,
   - wypełnij ręczny formularz szkicu faktury sprzedaży, zakupu lub korekty (z automatyczną walidacją sumy kontrolnej NIP i kalendarzowych dat ISO).
   - _Wskazówka:_ ponowne przesłanie identycznego pliku zostaje zatrzymane przez kontrolę skrótu `SHA-256` (`409 Conflict`), co chroni przed podwójnym zaksięgowaniem tej samej faktury.
3. Kliknij wybrany dokument na liście, aby otworzyć dwukolumnowy widok weryfikacji **`SplitVerificationView`** (`/app/documents/[documentId]`):
   - **Lewa kolumna** prezentuje niemodyfikowalny dowód źródłowy (podgląd struktury KSeF XML / treści ekstrakcji, numer referencyjny KSeF lub znacznik `OFF`/`BFK`/`DI` oraz skrót `SHA-256`).
   - **Prawa kolumna** wyświetla odczytane pola ze wskaźnikiem pewności AI, kategorię podatkową oraz przełącznik wydatku szczególnego (np. **samochód osobowy — użytek mieszany `50% VAT / 75% KUP`**).
4. Sprawdź podgląd kalkulacji na żywo wraz z sekcją **„§ Dlaczego?”**, popraw ewentualne pola i kliknij **„Zatwierdź i zaksięguj dokument”**.
5. Potwierdź operację w oknie modalnym. Dopiero w tym momencie (`POST .../approve-and-post`) dokument zmienia status na `Zweryfikowany i zaksięgowany`, a odpowiednie zapisy trafiają do KPiR, ewidencji ryczałtu lub dziennika pełnych ksiąg oraz rejestrów VAT wraz ze śladem Twojego identyfikatora użytkownika w audycie.

### 2.2. Podatkowa Księga Przychodów i Rozchodów — 17 vs 19 kolumn (`/app/kpir`)

Widok `/app/kpir` (przeznaczony dla JDG na skali podatkowej i podatku liniowym) udostępnia:

- **Przełącznik układu rozporządzenia PKPiR:**
  - **Wzór 2026 (19 kolumn wg `Dz.U. 2025 poz. 1299`):** zawiera dedykowaną **Kolumnę 3 na Numer KSeF**, Kolumnę 4 na numer innego dowodu, **Kolumnę 5 na NIP kontrahenta**, Kolumny 9–11 na przychody oraz Kolumny 12–16 na wydatki (w tym Kolumnę 15 na pozostałe wydatki KUP i Kolumnę 18 na koszty działalności B+R).
  - **Wzór 2019/2025 (17 kolumn wg `Dz.U. 2019 poz. 2544`):** historyczny układ obowiązujący dla zdarzeń do `2025-12-31` (przychód ze sprzedaży w Kol. 7, pozostałe wydatki w Kol. 13).
- **Szufladę wyjaśnienia „§ Dlaczego?”:** przy każdym wierszu KPiR kliknięcie przycisku `§ Dlaczego?` otwiera dokładny ślad wyliczenia w groszach i PLN (np. jak z faktury za paliwo `246,00 PLN` brutto — `200,00 PLN` netto + `46,00 PLN` VAT 23%, użytek mieszany `50% VAT / 75% KUP` — wyliczono **`23,00 PLN`** odliczonego VAT i **`167,25 PLN`** kosztu podatkowego KUP) wraz z klikalnym linkiem do aktu prawnego w ISAP.
- **Symulację porównawczą zaliczki PIT** (skala `12%`/`32%` z kwotą wolną `30 000 PLN` vs podatek liniowy `19%` z limitem odliczenia składki zdrowotnej `14 100 PLN` w 2026 r.) oraz formularz **czerwonego storna / korekty** z obowiązkowym podaniem przyczyny.

### 2.3. Ewidencja przychodów ryczałtowych i monitor limitu VAT (`/app/ryczalt`)

Po przełączeniu kontekstu na firmę ryczałtową widok `/app/ryczalt` prezentuje:

- zestawienie przychodów pogrupowane według właściwych stawek ryczałtu (`12%` dla wybranych usług IT, `8,5%` dla usług ogólnych do limitu, `15%`, `17%` itd. wg `art. 12` ustawy o ryczałcie),
- kalkulację miesięcznego ryczałtu po proporcjonalnym odliczeniu zapłaconych składek ZUS społecznych oraz **50% zapłaconej składki zdrowotnej** (`art. 11 ust. 1a` ustawy o ryczałcie),
- **wizualny pasek wykorzystania limitu zwolnienia podmiotowego z VAT** (`240 000,00 PLN` w skali roku od 1 stycznia 2026 r., `art. 113 ust. 1` ustawy o VAT) z ostrzeżeniem wyprzedzającym przed przekroczeniem progu.

### 2.4. Rejestry VAT i podgląd deklaracji `JPK_V7M(3)` (`/app/vat`)

Widok `/app/vat` prezentuje:

- **Rejestr sprzedaży VAT** oraz **Rejestr zakupów VAT** (z wyraźnym oddzieleniem kwoty VAT podlegającej odliczeniu od nieodliczalnych `50%` przy pojazdach samochodowych),
- oznaczenia e-faktur wymagane od lutego 2026 r. w schemie **`JPK_V7M(3)`** (`NrKSeF`, `OFF`, `BFK`, `DI`), kody grup towarowo-usługowych (`GTU_01`–`GTU_13`) oraz procedurę `MPP`,
- wyliczenie pól części deklaracyjnej `P_10`–`P_62` (zaokrąglonych do pełnych złotych wg `art. 63 § 1` Ordynacji podatkowej — kwota do wpłaty `P_51` lub nadwyżka do przeniesienia/zwrotu `P_53`/`P_62`).
- _Uwaga:_ widok wyświetla czytelny komunikat, że w środowisku testowym wygenerowane podsumowanie służy do weryfikacji krzyżowej i nie jest automatycznie wysyłane do bramki Ministerstwa Finansów.

### 2.5. Pełne księgi rachunkowe Sp. z o.o. i CIT (`/app/ledger`)

Po wybraniu w nagłówku spółki z o.o. (dla JDG ekran wyświetli pomocny baner edukacyjny z przyciskiem szybkiego przełączenia na spółkę demo) w `/app/ledger` dostępne są:

- **Zakładowy Plan Kont (Zespoły `0`–`8`)** zgodny z Ustawą o rachunkowości,
- **Dziennik księgowań z wielopozycyjnym formularzem dekretu:** interfejs na żywo sumuje stronę **Winien (`Wn`)** oraz stronę **Ma (`Ma`)**. Próba zapisania dekretu, w którym `SUM(Wn) !== SUM(Ma)`, jest blokowana zarówno w formularzu, jak i po stronie serwera (`422 Unprocessable Entity`),
- **Zestawienie Obrotów i Sald (ZOiS)**, uproszczony **Bilans** (z kontrolą równowagi `Aktywa === Pasywa`), **Rachunek Zysków i Strat (RZiS)** oraz kalkulacja miesięcznej zaliczki na **podatek CIT** (`9%` dla małego podatnika i podatnika rozpoczynającego działalność vs `19%` stawki podstawowej).

### 2.6. Rozrachunki, Biała Lista KAS i wyciągi bankowe CSV / MT940 (`/app/finance`)

W module `/app/finance`:

1. Sprawdzisz otwarte należności od odbiorców i zobowiązania wobec dostawców wraz z przedziałami przeterminowania (**wiekowanie / aging**).
2. Zweryfikujesz oznaczenie rachunku IBAN pod kątem **Białej Listy podatników VAT (Wykazu KAS)** oraz flagę obowiązkowego **Mechanizmu Podzielonej Płatności (MPP)** dla faktur powyżej `15 000,00 PLN` brutto obejmujących towary lub usługi z załącznika nr 15.
3. Zaimportujesz wyciąg bankowy w formacie **CSV** lub **MT940** i sparujesz przelewy z fakturami, rozliczając saldo dokumentu.

### 2.7. Kalendarz podatkowy (`/app/calendar`), Rejestr reguł (`/app/rules`) i Skrzynka Sandbox (`/app/notifications`)

- **`/app/calendar`:** prezentuje miesięczne zobowiązania firmy (np. ZUS DRA do `15.` dnia miesiąca dla Sp. z o.o. lub do `20.` dnia dla JDG, zaliczki PIT/CIT/ryczałt do `20.` dnia, `JPK_V7M` do `25.` dnia). Gdy ustawowy dzień płatności wypada w sobotę, niedzielę lub święto ustawowo wolne od pracy (w tym **wolną Wigilię 24 grudnia** obowiązującą od 2025 r.), system wskazuje przesunięcie na najbliższy dzień roboczy zgodnie z `art. 12 § 5` Ordynacji podatkowej i pozwala oznaczyć zobowiązanie jako opłacone.
- **`/app/rules`:** umożliwia przeszukiwanie wszystkich **32 kodów reguł prawnych (42 wersji temporalnych)** z filtrami kategorii, okresu obowiązywania i bezpośrednimi linkami do `ISAP` / `Dz.U.`.
- **`/app/notifications`:** pozwala skonfigurować w formularzu 4 progi przypomnień (`Wyprzedzenie 7 dni przed terminem`, `Pilne przypomnienie 2 dni przed terminem`, `W dniu ustawowego terminu (0 dni)` oraz `Monit zaległości 3 dni po terminie`, a także całkowity `opt-out` — przy czym silnik domenowy mapuje wysyłki na etapy wyprzedzające i po terminie: `advance_7d`, `urgent_2d`, `overdue_1d`), ręcznie wyzwolić wysyłkę należnych alertów (`dispatch-due`) i podejrzeć surowe wiadomości **MIME RFC 5322** (`text/plain` + `text/html`, bez pełnego NIP i bez kwot w temacie wiadomości) przechwycone w bezpiecznej skrzynce **`ControlledSandboxMailboxTransport`**.

---

## 3. Przewodnik właściciela organizacji i księgowej (`/app/companies`)

Platforma egzekwuje ścisły rozdział uprawnień administracyjnych i operacyjnych zgodnie z [ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md):

| Uprawnienie / Czynność                                                  | Właściciel organizacji (`owner`, np. `jan-testowy`) | Księgowa (`accountant`, np. `marta-ksiegowa`)                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Przeglądanie ksiąg, dokumentów i raportów firmy                         | Tak — we wszystkich firmach swojej organizacji      | Wyłącznie w firmach, do których posiada aktywny grant `read` lub `write`                      |
| Zatwierdzanie faktur (`approve-and-post`), wpisy KPiR/UoR, import banku | Tak                                                 | Wyłącznie w firmach z aktywnym grantem `write` (`accounting_write`)                           |
| Rejestracja nowej firmy i zmiana profilu podatkowego / ZUS              | Tak                                                 | Uzależnione od grantu zapisu na danym podmiocie (bez praw właścicielskich tenanta)            |
| **Nadawanie i cofanie grantów dostępu innym użytkownikom (`/grants`)**  | **Tak** (pełna kontrola nad dostępem w organizacji) | **Nie (`403 Forbidden`)** — księgowa nie może samodzielnie rozszerzać ani delegować uprawnień |
| Podgląd dziennika audytu bezpieczeństwa i operacji firmy                | Tak                                                 | Zgodnie z zakresem odczytu podmiotu                                                           |

### Jak nadać lub cofnąć dostęp księgowej do konkretnej firmy:

1. Zaloguj się jako właściciel organizacji (`jan-testowy`) i otwórz **`/app/companies`**.
2. Wybierz docelowy podmiot i przejdź do sekcji **Uprawnienia i granty dostępu**.
3. Wskaż użytkownika (np. `marta-ksiegowa`) oraz poziom uprawnień:
   - **`read` (`accounting_read`):** wyłącznie wgląd w dokumenty, ewidencje i podsumowania podatkowe — każda próba zapisu lub zatwierdzenia dokumentu zwróci `403 Forbidden`,
   - **`read + write` (`accounting_write`):** prawo weryfikacji i księgowania dokumentów, dodawania wpisów oraz parowania płatności w danej firmie.
4. Aby odebrać dostęp, kliknij **Cofnij dostęp** i potwierdź operację w oknie modalnym `CriticalConfirmDialog` przyciskiem **Tak, cofnij grant dostępu**. Cofnięcie działa natychmiastowo (transakcyjnie z blokadą wiersza i zapisem w audycie), a w przypadku odebrania członkostwa w całej organizacji wszystkie granty firmowe tego użytkownika są trwale unieważniane (`6D-R`).
5. Każda decyzja `allow/deny` z UI, REST API oraz MCP jest widoczna w sekcji **Dziennik audytu** na tym samym ekranie.

---

## 4. Podłączenie klienta AI do zdalnego serwera MCP (`/api/v1/mcp`)

Zewnętrzni asystenci AI (np. Claude Desktop, Claude Code, Cursor, własne skrypty `@modelcontextprotocol/client`) łączą się z platformą przez bezstanowy protokół **Streamable HTTP MCP** wystawiony na ścieżce `/api/v1/mcp`.

### 4.1. Wymagania uwierzytelniania i zakresów OIDC

- Każde żądanie do `/api/v1/mcp` musi zawierać nagłówek `Authorization: Bearer <TOKEN_JWT>` zweryfikowany przed odczytem strumienia treści żądania (przekazywanie tokenu w parametrze URL `?access_token=` oraz nagłówki typu `x-user-id` są odrzucane błędem `401`).
- Wymagane zakresy (`scope`) w tokenie JWT:
  - **`pap:mcp:read`** — wymagany do połączenia z bramką oraz wywoływania 7 narzędzi odczytowych,
  - **`pap:mcp:prepare`** — wymagany dodatkowo do przygotowania szkicu faktury/dekretacji (`prepare_invoice_and_posting_proposal`) oraz wywołania finalizacji z kodem człowieka (`confirm_prepared_proposal`).
- _Uwaga dla prywatnego stagingu:_ za reverse proxy HTTPS zmienna środowiskowa `PAP_MCP_ALLOWED_HOSTS` na serwerze musi jawnie dopuszczać kanoniczny host (np. `ksiegowosc.roleplayingtech.com`); lokalnie domyślnie dozwolony jest wyłącznie loopback (`127.0.0.1`, `localhost`).

### 4.2. Konfiguracja w klientach MCP i przykład wywołania

Gotowe szablony konfiguracji (ze zredagowanym placeholderem zamiast tajnego tokenu) znajdziesz również bezpośrednio w aplikacji na ekranie **`/app/mcp`**.

**Przykład konfiguracji Streamable HTTP (np. Cursor / kompatybilny klient MCP):**

```json
{
  "mcpServers": {
    "polish-accounting-platform": {
      "url": "http://127.0.0.1:4000/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer <POBIERZ_TOKEN_Z_ENDPOINTU_OIDC>"
      }
    }
  }
}
```

_(W lokalnym środowisku deweloperskim z włączonym `PAP_SANDBOX_AUTH_ENABLED=true` testowy token `ES256` z zakresami `openid pap:mcp:read pap:mcp:prepare` można pobrać żądaniem `POST http://127.0.0.1:4000/api/v1/oidc/token` z ciałem `{"personaId":"jan-testowy","scopes":["openid","pap:mcp:read","pap:mcp:prepare"]}`)._

### 4.3. Katalog 9 narzędzi MCP i dwuetapowe zatwierdzanie przez człowieka

| Narzędzie MCP                          | Wymagany scope                                              | Działanie                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `system_status`                        | `pap:mcp:read` _(na HTTP `/api/v1/mcp`; w STDIO publiczne)_ | Przyjmuje `{}` i zwraca wyłącznie `SystemStatusSchema` (`{ service, status, version, modules }`) — nie zwraca tożsamości zalogowanego aktora.                                     |
| `list_my_companies`                    | `pap:mcp:read`                                              | Zwraca wyłącznie firmy dostępne dla użytkownika (z zamaskowanym NIP).                                                                                                             |
| `list_unpaid_invoices`                 | `pap:mcp:read`                                              | Zwraca nierozliczone faktury w PLN (pola tekstowe są oczyszczone ze znaków Bidi i oznaczone jako niezaufane dane dokumentu).                                                      |
| `get_monthly_tax_obligations`          | `pap:mcp:read`                                              | Wylicza terminy ZUS, PIT/CIT i VAT na dany miesiąc wraz z podstawą prawną.                                                                                                        |
| `explain_accounting_item`              | `pap:mcp:read`                                              | Wyjaśnia krok po kroku wyliczenie KUP/NKUP i VAT dla wskazanej pozycji.                                                                                                           |
| `get_legal_basis`                      | `pap:mcp:read`                                              | Zwraca treść i parametry zweryfikowanej reguły prawnej z linkiem ISAP na wskazany dzień.                                                                                          |
| `get_month_close_checklist`            | `pap:mcp:read`                                              | Sprawdza listę kontrolną zamknięcia miesiąca (niezatwierdzone szkice, niesparowane przelewy).                                                                                     |
| `prepare_invoice_and_posting_proposal` | `pap:mcp:prepare`                                           | **Krok 1 zapisu:** tworzy propozycję księgowania w stanie `pending_human_approval` (`ledgerPosted: false`) i zwraca `proposalId` oraz `payloadHash`. **Nie modyfikuje ksiąg.**    |
| `confirm_prepared_proposal`            | `pap:mcp:prepare`                                           | **Krok 2 zapisu:** finalizuje propozycję wyłącznie po podaniu ważnego jednorazowego `confirmationCode` wygenerowanego przez człowieka oraz zgodnego skrótu `expectedPayloadHash`. |

**Jak bezpiecznie zatwierdzić propozycję przygotowaną przez agenta AI:**

1. Poproś swojego asystenta AI o przygotowanie szkicu faktury narzędziem `prepare_invoice_and_posting_proposal`. Agent otrzyma `proposalId` oraz `payloadHash`, ale dokument **nie trafi jeszcze do ksiąg**.
2. Otwórz w przeglądarce ekran **`/app/mcp`** (zalogowany jako człowiek z uprawnieniem `write` do tej firmy).
3. Sprawdź kwoty, NIP, stawkę VAT i kwalifikację kosztu na karcie oczekującej propozycji, a następnie kliknij przycisk **`1. Wygeneruj kod potwierdzenia człowieka`**, który wystawi jednorazowy kod wyzwania (`confirmationCode`, TTL 5 minut).
4. Sfinalizuj zatwierdzenie (nie istnieje jedno-klikowe zatwierdzenie bez kodu):
   - przekaż wygenerowany jednorazowy kod klientowi MCP, aby wywołał `confirm_prepared_proposal` wraz z `expectedPayloadHash`, **albo**
   - wpisz/wklej ten kod w polu obok na karcie w `/app/mcp` i kliknij **`2. Zatwierdź propozycję z kodem człowieka`** (analogicznie w widoku szczegółowym `/approvals/proposals/[proposalId]`: **`Wygeneruj kod potwierdzenia (TTL 5 min)`** -> **`Zatwierdź i zaksięguj propozycję`**).
   - _Uwaga dot. odrzucania propozycji:_ na ekranie `/app/mcp` nie ma osobnego przycisku odrzucenia — odrzucenie oczekującej propozycji jest dostępne przez endpoint REST `POST /api/v1/tenants/:tenantId/companies/:legalEntityId/mcp/proposals/:proposalId/reject`.
   - Jeżeli ktokolwiek zmieniłby w międzyczasie choćby 1 grosz w ładunku propozycji, porównanie `expectedPayloadHash` odrzuci operację. Token posiadający autonomiczny znacznik `pap:mcp:agent_autonomous` ma twardy zakaz wydawania wyzwań i samoakceptacji (`403 agent_self_approval_forbidden`).

---

## 5. Akademia Polskiej Księgowości (`/academy`) i pomoc kontekstowa `?` (`FieldHelpButton`)

### 5.1. Jak korzystać z 12-modułowej Akademii (`/academy`)

Akademia jest dostępna publicznie pod adresem **`/academy`** (zarówno bez logowania, jak i wewnątrz zalogowanej sesji roboczej) i obejmuje **12 modułów (37 lekcji)** prowadzących od podstaw po pełne księgi i automatyzację MCP:

1. **Filtrowanie po Twoim profilu podatkowym:** wybierz swój profil (np. `JDG KPiR — skala podatkowa`, `JDG Ryczałt`, `Sp. z o.o. — CIT klasyczny`, `Podatnik zwolniony z VAT art. 113`), aby wyróżnić moduły najważniejsze dla Twojej firmy i odróżnić wiedzę ogólną (`general_education`) od reguł specyficznych dla wybranej formy opodatkowania (`profile_specific`).
2. **Nauka na konkretnych liczbach i prawdziwym interfejsie:** każda lekcja zawiera przystępne wyjaśnienie, wielokrokowy przykład w PLN, zweryfikowane odwołania ustawowe (`ISAP` / `Dz.U.` / `podatki.gov.pl` / `zus.pl`), odnośnik do docelowego widoku aplikacji, praktyczne ćwiczenie na jednej z trzech firm demonstracyjnych oraz zestawienie typowych błędów podatników.
3. **Sprawdzenie wiedzy w interaktywnym quizie (`LessonQuiz`):** na końcu każdej lekcji rozwiąż krótki test jednokrotnego wyboru. Odpowiedzi są oceniane deterministycznie przez silnik domenowy (bez udziału modelu AI), a po zatwierdzeniu zobaczysz szczegółowe wyjaśnienie merytoryczne każdego pytania.

### 5.2. Jak działa przycisk pomocy kontekstowej `?` (`FieldHelpButton`)

Przy kluczowych polach formularzy w całej aplikacji (m.in. numer NIP, numer KSeF, kod GTU, użytek mieszany pojazdu `50% VAT / 75% KUP`, stawka ryczałtu, równowaga `Wn = Ma`, rachunek IBAN na Białej Liście KAS, podzielona płatność MPP, kod potwierdzenia człowieka MCP) znajduje się okrągły przycisk **`?`**:

- Kliknięcie (lub naciśnięcie `Enter` / `Spacja` po przejściu klawiszem `Tab`) otwiera czytelny dymek wyjaśniający **prostym językiem**, co należy wpisać w danym polu, pokazuje poprawny przykład, wskazuje przepis prawny i udostępnia bezpośredni link **„Przejdź do pełnej lekcji w Akademii”**.
- Okienko pomocy zamkniesz klawiszem `Escape` lub ponownym kliknięciem przycisku.

---

## 6. FAQ polskiego przedsiębiorcy (Najczęściej zadawane pytania — stan 2025/2026)

### P1: Czym różni się nowa 19-kolumnowa PKPiR od 2026 r. od dotychczasowej 17-kolumnowej z lat 2020–2025?

Od **1 stycznia 2026 r.** obowiązuje nowe rozporządzenie Ministra Finansów i Gospodarki z dnia 6 września 2025 r. w sprawie prowadzenia podatkowej księgi przychodów i rozchodów (`Dz.U. 2025 poz. 1299`), które zastąpiło wzór 17-kolumnowy z 2019 r. (`Dz.U. 2019 poz. 2544`). Najważniejsze zmiany w układzie 19 kolumn:

- dodano **Kolumnę 3: Numer identyfikujący fakturę wystawioną przy użyciu Krajowego Systemu e-Faktur (Nr KSeF)** (dotychczasowy numer innego dowodu księgowego przesunął się do Kolumny 4),
- dodano **Kolumnę 5: Identyfikator podatkowy kontrahenta (NIP)**,
- w konsekwencji przesunęły się numery kolumn kwotowych: przychód ze sprzedaży towarów i usług znajduje się w **Kolumnie 9** (dawniej kol. 7), zakup towarów handlowych w **Kolumnie 12** (dawniej kol. 10), pozostałe wydatki KUP w **Kolumnie 15** (dawniej kol. 13), koszty działalności badawczo-rozwojowej w **Kolumnie 18**, a uwagi w **Kolumnie 19**.

W Polish Accounting Platform widok `/app/kpir` automatycznie dobiera właściwy wzór na podstawie wybranego okresu (`2025` vs `2026`) i umożliwia przejrzenie obu układów.

### P2: Jak dokładnie liczy się zakup paliwa lub serwisu samochodu osobowego w użytku mieszanym (`50% VAT` i `75% KUP`)?

Jeżeli jesteś czynnym podatnikiem VAT i wykorzystujesz samochód osobowy w sposób mieszany (zarówno w działalności gospodarczej, jak i prywatnie — bez zgłoszenia `VAT-26` i szczegółowej ewidencji przebiegu pojazdu), działają jednocześnie dwie reguły:

1. **Podatek VAT (`art. 86a ust. 1` ustawy o VAT):** odliczasz **50% kwoty VAT** z faktury. Pozostałe 50% nieodliczonego podatku VAT powiększa podstawę kosztową netto (`art. 23 ust. 1 pkt 43 lit. a` ustawy o PIT / `art. 16 ust. 1 pkt 46 lit. a` ustawy o CIT).
2. **Podatek dochodowy (`art. 23 ust. 1 pkt 46a` PIT / `art. 16 ust. 1 pkt 51` CIT):** do kosztów uzyskania przychodów (KUP) zaliczasz **75%** tak ustalonej kwoty (czyli `75% * (netto + nieodliczony VAT)`), natomiast pozostałe `25%` stanowi wydatek niestanowiący kosztu uzyskania przychodów (NKUP).

**Przykład liczbowy w PLN:** Faktura za paliwo opiewa na `200,00 PLN` netto + `46,00 PLN` VAT (23%) = `246,00 PLN` brutto:

- Odliczony VAT w rejestrze zakupów `JPK_V7M`: `50% * 46,00 PLN` = **`23,00 PLN`**.
- Nieodliczony VAT: **`23,00 PLN`**.
- Podstawa do limitu KUP: `200,00 PLN + 23,00 PLN = 223,00 PLN`.
- Koszt podatkowy KUP (wpisywany do Kolumny 15 PKPiR w 2026 r.): `75% * 223,00 PLN` = **`167,25 PLN`** (pozostałe `55,75 PLN` to NKUP).

_(Jeżeli jesteś podatnikiem zwolnionym z VAT, nie odliczasz VAT w ogóle, więc podstawą limitu 75% jest pełna kwota brutto: `75% * 246,00 PLN = 184,50 PLN` KUP)._

### P3: Ile wynosi limit zwolnienia podmiotowego z VAT od 2026 r. i co jeśli otwieram firmę w środku roku?

Na mocy nowelizacji ustawy o VAT (`Dz.U. 2025 poz. 896`, zmieniającej `art. 113 ust. 1` i `ust. 9` ustawy o VAT) roczny limit wartości sprzedaży uprawniający do zwolnienia podmiotowego z VAT wzrósł od **1 stycznia 2026 r.** z `200 000,00 PLN` do **`240 000,00 PLN`** (bez wliczania kwoty podatku).

- Jeżeli rozpoczynasz wykonywanie czynności podlegających opodatkowaniu **w trakcie roku podatkowego**, limit liczy się **proporcjonalnie do liczby dni** prowadzenia działalności w tym roku (`art. 113 ust. 9` ustawy o VAT): `240 000 PLN * (liczba dni od dnia rozpoczęcia do 31 grudnia / liczba dni w roku)`.
- Pamiętaj o wyłączeniach ustawowych (`art. 113 ust. 13` ustawy o VAT): m.in. usługi prawnicze, usługi doradztwa (z wyłączeniem doradztwa rolniczego) czy sprzedaż wybranych towarów z załącznika nr 12 przez internet nie mogą korzystać ze zwolnienia podmiotowego już od pierwszej sprzedaży.

### P4: Kiedy podzielona płatność (MPP / Split Payment) powyżej `15 000 PLN` jest obowiązkowa i po co sprawdzać Białą Listę KAS?

- **Obowiązkowy MPP (`art. 108a ust. 1a` ustawy o VAT):** zachodzi wtedy, gdy spełnione są **łącznie** dwa warunki: (1) kwota należności ogółem na fakturze przekracza **`15 000,00 PLN` brutto** oraz (2) co najmniej jedna pozycja na fakturze dotyczy towarów lub usług wrażliwych wymienionych w **załączniku nr 15** do ustawy o VAT (np. sprzęt elektroniczny, części samochodowe, stal, roboty budowlane). Wówczas przelew musi zostać wykonany komunikatem Split Payment.
- **Biała Lista podatników VAT (`art. 96b` VAT oraz `art. 22p` PIT / `art. 15d` CIT):** przy transakcji B2B z czynnym podatnikiem VAT o jednorazowej wartości przekraczającej `15 000,00 PLN` brutto zapłata na rachunek spoza Wykazu podatników VAT naraża nabywcę na wyłączenie wydatku z kosztów uzyskania przychodów (NKUP) oraz solidarną odpowiedzialność za VAT sprzedawcy — chyba że podatnik zapłaci z użyciem MPP lub w ciągu **7 dni** od zlecenia przelewu złoży zawiadomienie `ZAW-NR`.

### P5: Co się dzieje, gdy termin płatności podatku lub ZUS wypada w sobotę, niedzielę albo w Wigilię 24 grudnia?

Zgodnie z **`art. 12 § 5` Ordynacji podatkowej** (stosowanym również do składek ZUS na mocy `art. 31` ustawy o systemie ubezpieczeń społecznych), jeżeli ostatni dzień terminu przypada na **sobotę lub dzień ustawowo wolny od pracy**, za ostatni dzień terminu uważa się **następny dzień po dniu lub dniach wolnych od pracy**.

- Przykładowo, jeśli `20.` dzień miesiąca (termin ZUS DRA dla JDG i zaliczki PIT/CIT/ryczałtu) przypada w sobotę `20 czerwca 2026 r.`, ustawowy termin upływa w poniedziałek `22 czerwca 2026 r.`.
- Od 2025 r. na mocy nowelizacji ustawy o dniach wolnych od pracy (`Dz.U. 2024 poz. 1965`) **Wigilia 24 grudnia jest dniem ustawowo wolnym od pracy** — silnik kalendarza w `/app/calendar` uwzględnia ją automatycznie przy przesuwaniu terminów grudniowych (np. `JPK_V7M` przypadającego w okresie świątecznym `24–26 grudnia`).

### P6: Czym różnią się oznaczenia `NrKSeF`, `OFF`, `BFK` i `DI` w nowej strukturze `JPK_V7M(3)` od lutego 2026 r.?

W strukturze **`JPK_V7M(3)`** (wprowadzonej rozporządzeniem z 12 grudnia 2025 r., `Dz.U. 2025 poz. 1800`, obowiązującej począwszy od rozliczenia za luty 2026 r.) każdy dokument w ewidencji VAT wymaga odpowiedniego określenia relacji z Krajowym Systemem e-Faktur:

- **`NrKSeF`:** podaje się właściwy numer identyfikujący e-fakturę nadany w KSeF na dzień złożenia pliku JPK.
- **`OFF`:** faktura wystawiona w trybie offline / awarii KSeF, która na dzień przesłania ewidencji JPK nie posiada jeszcze nadanego numeru KSeF (po nadaniu numeru wymaga korekty ewidencji).
- **`BFK` (Bez Faktury KSeF):** faktura elektroniczna lub papierowa wystawiona poza KSeF zgodnie z przepisami (np. na rzecz konsumenta B2C lub przez podmiot korzystający z ustawowego wyłączenia).
- **`DI` (Dowód Inny):** dokument niebędący fakturą ustrukturyzowaną (np. raport okresowy z kasy rejestrującej `RO`, dokument wewnętrzny `WEW`).

### P7: Dlaczego asystent AI w tej platformie nie może samodzielnie zaksięgować faktury ani wysłać deklaracji?

Ponieważ w polskim prawie podatkowym i bilansowym **odpowiedzialność za rzetelność ksiąg i prawidłowość deklaracji zawsze ponosi podatnik lub kierownik jednostki** (`art. 4 ust. 5` Ustawy o rachunkowości, `art. 26` Ordynacji podatkowej), a nie dostawca modelu językowego. Modele LLM są probabilistyczne i podatne na niejednoznaczności dokumentów oraz złośliwe instrukcje ukryte w treści obcych faktur (_indirect prompt injection_).

Dlatego w Polish Accounting Platform obowiązują dwie żelazne bariery techniczne:

1. Wszystkie kwoty groszowe, zaokrąglenia i limity liczy **wyłącznie deterministyczny kod TypeScript w `@pap/domain`** na podstawie zweryfikowanych przepisów, nigdy model AI.
2. AI, OCR i narzędzia MCP tworzą wyłącznie **szkice oczekujące na decyzję człowieka** (`pending_human_approval`). Zapis w księgach wymaga świadomej autoryzacji człowieka w `SplitVerificationView` lub podania jednorazowego kodu wyzwania wygenerowanego przez człowieka.
