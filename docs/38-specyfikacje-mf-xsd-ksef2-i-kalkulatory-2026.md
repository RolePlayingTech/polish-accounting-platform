# 38. Specyfikacje urzędowe MF (XSD FA(2)/FA(3), JPK 2026, UPO v4-3), KSeF 2.0 Sandbox oraz deterministyczne kalkulatory 2026 (`#81`, `#82`, `#98`, `#99`)

> **Status dokumentu (2026-11-24):** Specyfikacja techniczna i rejestr proweniencji schematów urzędowych Ministerstwa Finansów dostarczonych w Etapach G2/G3/G4 (`#124`). Dokument zachowuje pełną uczciwość weryfikacyjną zgodnie z [AGENTS.md](../AGENTS.md) oraz utrzymuje bramki produkcyjne `#100` i `#119` w statusie **`NO-GO`** do czasu zamknięcia wszystkich kryteriów pilotowych. Powiązane dokumenty: [08-integracje.md](./08-integracje.md), [09-reguly-prawne.md](./09-reguly-prawne.md), [32-rejestr-regul-prawnych-i-matryca-jdg.md](./32-rejestr-regul-prawnych-i-matryca-jdg.md).

---

## 1. Rejestr oficjalnych schematów XSD Ministerstwa Finansów (offline, bez dostępu sieciowego)

Wszystkie schematy główne oraz słowniki bazowe zostały zweryfikowane względem źródeł urzędowych (`crd.gov.pl`, `gov.pl/web/kas`, oficjalnego repozytorium MF `CIRFMF/ksef-api`) i zapisane lokalnie w `test/fixtures/xsd/` wraz z manifestem kryptograficznym `test/fixtures/xsd/manifest.json`. Walidator offline (`packages/application/src/xsd/offline-xsd-validator.ts`) kompiluje i wykonuje walidację w trybie `no_network=True`, `resolve_entities=False` (twarda blokada XXE i zewnętrznych wywołań sieciowych).

### 1.1. Schematy główne XSD (`test/fixtures/xsd/`)

| Kod struktury   | Plik lokalny           | Przestrzeń nazw (`targetNamespace`)           | Obowiązuje od | Obowiązuje do | SHA-256                                                            | Oficjalne źródło MF / CRD                                                                | Zakres profili i ograniczenia                                                                                                                                                         |
| :-------------- | :--------------------- | :-------------------------------------------- | :------------ | :------------ | :----------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FA(2)`         | `fa2_schemat.xsd`      | `http://crd.gov.pl/wzor/2023/06/29/12648/`    | `2023-09-01`  | `2026-01-31`  | `b8acb60f0692ac2b05ac40ffcb1929b4d68c12b3c486cac4322e1699796f6999` | `https://crd.gov.pl/wzor/2023/06/29/12648/schemat.xsd`                                   | Wszystkie profile (`A`, `B`, `C`) dla importu archiwalnego oraz testów kompatybilności wstecznej KSeF TEST.                                                                           |
| `FA(3)`         | `fa3_schemat.xsd`      | `http://crd.gov.pl/wzor/2025/06/25/13775/`    | `2026-02-01`  | bezterminowo  | `b646b6b525f51adf1bb2545f111fc8ca6e7aa6dd2f98948f1667d3695c06d958` | `https://crd.gov.pl/wzor/2025/06/25/13775/schemat.xsd`                                   | Wszystkie profile (`A`, `B`, `C`) w KSeF 2.0 od `2026-02-01`. Księgowanie w pilocie obsługuje PLN; waluty obce wymagają modułu różnic kursowych.                                      |
| `JPK_V7M(2)`    | `jpk_v7m2_schemat.xsd` | `http://crd.gov.pl/wzor/2021/12/27/11148/`    | `2022-01-01`  | `2026-01-31`  | `90cb53e1217449f3ebc671962922fd62f7a892cca26be46a6f5de3d0dc01b96b` | `https://crd.gov.pl/wzor/2021/12/27/11148/schemat.xsd`                                   | Archiwalne rozliczenia miesięczne VAT do `2026-01` włącznie (bez znaczników `NrKSeF`/`OFF`/`BFK`/`DI`).                                                                               |
| `JPK_V7M(3)`    | `jpk_v7m3_schemat.xsd` | `http://crd.gov.pl/wzor/2025/12/19/14090/`    | `2026-02-01`  | bezterminowo  | `1870324001ba1318f0535841b963571e970b45ef32ba5ca3d433f0dc5da412df` | `https://crd.gov.pl/wzor/2025/12/19/14090/schemat.xsd`                                   | Miesięczni podatnicy czynni VAT (`A`, `B`, `C`) od `2026-02`. Eksport generuje plik XML do podpisu zewnętrznego (brak wbudowanej bramki e-Deklaracje).                                |
| `JPK_V7K(3)`    | `jpk_v7k3_schemat.xsd` | `http://crd.gov.pl/wzor/2025/12/19/14089/`    | `2026-02-01`  | bezterminowo  | `3e7b70f30debf7ffe35127ac694b465004a45c0786b3267a92d91c7c29595d34` | `https://crd.gov.pl/wzor/2025/12/19/14089/schemat.xsd`                                   | Kwartalni podatnicy czynni VAT od `2026-02`: miesiące 1–2 kwartału zawierają wyłącznie `<Ewidencja>`, miesiąc 3 zawiera `<Deklaracja>` (`VAT-7K (17)`) + `<Ewidencja>`.               |
| `JPK_PKPIR(3)`  | `jpk_pkpir3_v1-0.xsd`  | `http://jpk.mf.gov.pl/wzor/2024/10/30/10302/` | `2026-01-01`  | bezterminowo  | `a09c8f5f0812fa78fb103366d77fd8e31b45e9f9cfdb0bdb33a3950e578a4498` | `https://www.gov.pl/attachment/70b78fa0-9183-400d-a967-eeacdcb87e57`                     | Profil A (`jdg_kpir_skala`, `jdg_kpir_liniowy`). Obowiązek roczny od roku 2026 dla podatników na `JPK_V7M`, od 2027 r. dla pozostałych.                                               |
| `JPK_EWP(4)`    | `jpk_ewp4_v1-0.xsd`    | `http://jpk.mf.gov.pl/wzor/2024/10/30/10301/` | `2026-01-01`  | bezterminowo  | `0061478a2af63894bf2ea6293eaf6ebd3da18a26ab43076899a20d3c3f32a79b` | `https://www.gov.pl/attachment/67b55c59-e05c-42f0-be4c-28afcca460b6`                     | Profil B (`jdg_ryczalt`). Uwaga XSD MF: `TStawkaPodatku` dopuszcza enum `17\|15\|14\|12.5\|12\|10\|8.5\|5.5\|3`; stawka `2%` jest odrzucana jawnie przed generacją XML.               |
| `JPK_ST(1)`     | `jpk_st1_v1-2.xsd`     | `http://jpk.mf.gov.pl/wzor/2024/11/26/11262/` | `2026-01-01`  | bezterminowo  | `e2f063617fb2c4ec5e477be992f9818a7f270939cb8d35915157d0a15f6fbe0d` | `https://www.gov.pl/attachment/aa2ea22c-afdf-42bb-a607-8907afd321a6`                     | Profile A i B (`ZnacznikST=2` `<PKPIR>` albo `ZnacznikST=1` `<EWP>`). Przyjmuje jawne pozycje ewidencji środków trwałych i WNiP.                                                      |
| `JPK_KR_PD(1)`  | `jpk_kr_pd1_v1-1.xsd`  | `http://jpk.mf.gov.pl/wzor/2024/09/04/09041/` | `2025-01-01`  | bezterminowo  | `251bab822af09d638225068538dcd64c0b3b56c11a13a0c7cda0f709e0d5063a` | `https://www.gov.pl/attachment/4ec8f106-032c-42f2-9fb5-15b5ec5ca670`                     | Profil C (`spzoo_pelne_ksiegi`, `ZOiS7`, `Dziennik`, `KontoZapis`, `Ctrl`, `RPD`). Wymaga zbilansowanego dziennika (`Wn = Ma`) oraz zatwierdzonych znaczników kont `S_12_1`/`S_12_3`. |
| `JPK_ST_KR(1)`  | `jpk_st_kr1_v1-0.xsd`  | `http://jpk.mf.gov.pl/wzor/2024/04/24/04242/` | `2025-01-01`  | bezterminowo  | `2e82f260f04595e2e25d6db1634e3fc1ebe46a2ca4ec38e591754c71f5ac80d1` | `https://www.gov.pl/attachment/336fb09b-ea93-475d-a895-0ef5b8b72a0b`                     | Profil C (`spzoo_pelne_ksiegi`, `<KodFormularza kodSystemowy="JPK_ST_KR (1)">JPK_ST</KodFormularza>`). Wymaga min. 1 pozycji `<ST_KR>`.                                               |
| `KSEF_UPO(4-3)` | `ksef_upo_v4-3.xsd`    | `http://upo.schematy.mf.gov.pl/KSeF/v4-3`     | `2026-02-01`  | bezterminowo  | `1e5ff386a29324021a9e0126319680aec0b1e0d4f4a18add30b2f5d12ce6fa86` | `https://raw.githubusercontent.com/CIRFMF/ksef-api/main/faktury/upo/schemy/upo-v4-3.xsd` | Walidacja autentycznych potwierdzeń UPO pobranych z KSeF 2.0 (aplikacja nigdy nie generuje własnych dokumentów UPO).                                                                  |

### 1.2. Słowniki bazowe `crd.gov.pl` (`test/fixtures/xsd/deps/`)

Wszystkie 10 importowanych słowników typów elementarnych, kodów krajów i kodów urzędów skarbowych (`ElementarneTypyDanych_v8-0E.xsd`, `ElementarneTypyDanych_v10-0E.xsd`, `StrukturyDanych_v8-0E.xsd`, `StrukturyDanych_v10-0E.xsd`, `StrukturyDanych_v12-0E.xsd`, `KodyKrajow_v8-0E.xsd`, `KodyKrajow_v10-0E.xsd`, `KodyKrajow_v13-0E.xsd`, `KodyUrzedowSkarbowych_v7-0E.xsd`, `KodyUrzedowSkarbowych_v8-0E.xsd`) posiada zweryfikowane skróty SHA-256 w `test/fixtures/xsd/manifest.json` (funkcja `verifyOfficialMfXsdIntegrity()`).

---

## 2. Parser i generator faktur ustrukturyzowanych `FA(2)` / `FA(3)` oraz archiwum WORM (`#82`, `#99`, `GLD-09`)

1. **Eliminacja wyrażeń regularnych XML (`packages/application/src/document-import-parsers.ts`)**:
   - Dotychczasowe parsowanie oparte o wyrażenia regularne zostało zastąpione deterministycznym, świadomym przestrzeni nazw parserem drzewa XML DOM (`parseSafeXmlDomTree`) oraz pełną walidacją offline XSD (`parseOfficialKsefFaXml`).
   - Twarda ochrona przed XXE i ekspansją encji: blokowane są `<!DOCTYPE`, `<!ENTITY`, `<!ELEMENT`, `<!ATTLIST`, `<!NOTATION`, instrukcje przetwarzania `<?...?>` (poza prologiem `<?xml ...?>`) oraz wszelkie niestandardowe encje `&custom;`.
   - Rygorystyczne reguły XSD:
     - odrzucenie prefiksu `PL` w `<NIP>` tam, gdzie XSD wymaga `etd:TNrNIP` (`10` cyfr + wagi kontrolne NIP),
     - odrzucenie brakującego lub sprzecznego `<Naglowek>` (`KodFormularza`, `kodSystemowy`, `wersjaSchemy`, `WariantFormularza`),
     - odrzucenie nieprawidłowego `xmlns` oraz przecinków dziesiętnych w polach `TKwotowy` (np. `100,00`),
     - dopuszczenie `<BrakID>1</BrakID>` ściśle tam, gdzie zezwala XSD (`Podmiot2` / `Podmiot3`), przy bezwzględnym odrzuceniu `<BrakID>` w `<Podmiot1>` (Sprzedawca).
2. **Niemutowalne archiwum plików źródłowych (`packages/application/src/source-archive/index.ts`, `#99`)**:
   - `ImmutableSourceDocumentArchive` wymusza autoryzację tenant/company (`actorUserId`, `tenantId`, `legalEntityId`), weryfikuje sygnatury binarne (`%PDF-`, JPEG `FF D8 FF`, PNG `89 50 4E 47`, XML bez XXE, CSV, JSON), deduplikuje surowy ładunek po `SHA-256` (`409 duplicate_source_artifact_sha256`), weryfikuje integralność WORM przy każdym odczycie oraz zwraca deskryptor `SplitVerificationView` z wymogiem `requiresHumanApproval: true` dla propozycji OCR.

---

## 3. Adapter KSeF 2.0 Test / Demo (`GLD-10`, `packages/application/src/ksef/index.ts`)

### 3.1. Zweryfikowana specyfikacja OpenAPI KSeF 2.0

- **Wersja OpenAPI MF (odczyt read-only 2026-11-24):** `2.10.0` (`build 2.10.0-te-20261117.2+ace86902e3d938fefd6ddc577c64d175b1d63d20`)
- **URL specyfikacji TEST:** `https://api-test.ksef.mf.gov.pl/docs/v2/openapi.json` (HTTP `200`, SHA-256 `314d27ae8260dcf265c3a11b64b05e4092371d7ef20b220de4d3f8ef7aeaf4c4`)
- **Dozwolone bazy API w kodzie:**
  - `test`: `https://api-test.ksef.mf.gov.pl/v2`
  - `demo`: `https://api-demo.ksef.mf.gov.pl/v2`
  - `local_mock`: wyłącznie hosty pętli zwrotnej na potrzeby testów kontraktowych (`127.0.0.1`, `localhost`, `ksef-mock.local`)
- **Twarda blokada środowisk produkcyjnych (`assertAllowedKsefNonProductionEndpoint`)**:
  - Każda próba użycia `ksef.mf.gov.pl`, `api.ksef.mf.gov.pl`, `prd.ksef.mf.gov.pl`, `e-deklaracje.mf.gov.pl` lub `pue.zus.pl` rzuca natychmiast wyjątek `KsefProductionEndpointBlockedError` przed wykonaniem jakiegokolwiek połączenia.

### 3.2. Zakres operacji i uczciwy status weryfikacji KSeF 2.0

- Uwierzytelnianie `POST /auth/challenge`, szyfrowanie `token|timestampMs` algorytmem `RSA-OAEP (SHA-256)`, `POST /auth/ksef-token` oraz `POST /auth/xades-signature`, polling `GET /auth/{referenceNumber}`, jednorazowy wykup `POST /auth/token/redeem` oraz odświeżanie `POST /auth/token/refresh`.
- Sesja interaktywna `POST /sessions/online`, obowiązkowa pre-walidacja `FA(3)` względem oficjalnego XSD przed wysyłką, szyfrowanie faktury `AES-256-CBC` + `RSA-OAEP`, `POST /sessions/online/{referenceNumber}/invoices`, polling statusu, zamknięcie sesji `POST /sessions/online/{referenceNumber}/close` oraz walidacja pobranego UPO względem `ksef_upo_v4-3.xsd` (w tym weryfikacja `SkrotDokumentu` i sumy kontrolnej CRC-8 numeru KSeF).
- Synchronizacja faktur zakupowych (`POST /invoices/query/metadata` dla `Subject2` — powszechny obowiązek odbioru w KSeF od `2026-02-01` — oraz `GET /invoices/ksef/{ksefNumber}`) z automatycznym zapisem oryginału XML do `ImmutableSourceDocumentArchive`.
- Idempotentny outbox (`KsefIdempotentOutbox`): ochrona przed duplikacją sesji przy timeoutach, `HTTP 429` (`Retry-After`) i błędach `5xx`, detekcja konfliktu payloadu (`409`) oraz uzgodnienie odpowiedzi KSeF `440 Duplikat faktury` (`extensions.originalKsefNumber`).

| Poziom weryfikacji KSeF 2.0                                                                                              | Status      | Dowód / wyjaśnienie                                                                                                                                                                                              |
| :----------------------------------------------------------------------------------------------------------------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonda read-only OpenAPI / kluczy publicznych MF (`api-test.ksef.mf.gov.pl`, `api-demo.ksef.mf.gov.pl`)                   | **PASS**    | Zweryfikowano dostępność specyfikacji OpenAPI `2.10.0` bez wysyłania jakichkolwiek danych podmiotów.                                                                                                             |
| Testy kontraktowe/mock + kryptografia `RSA-OAEP`/`AES-256-CBC` + walidacja XSD `FA(3)` i `UPO v4-3` + retry/idempotencja | **PASS**    | Pokryte deterministycznymi testami automatycznymi w `packages/application/test/ksef2-sandbox-adapter.test.ts`.                                                                                                   |
| Zewnętrzny uwierzytelniony round-trip E2E na żywym sandboxie MF (`api-test` / `api-demo`)                                | **NOT RUN** | Wymaga testowego kontekstu NIP oraz tokenu KSeF 2.0 lub certyfikatu testowego XAdES właściciela w zmiennych środowiskowych sandboxu (w repozytorium nie przechowujemy sekretów ani nie fabrykujemy poświadczeń). |

---

## 4. Deterministyczne kalkulatory zobowiązań należnych vs zapłaconych na 2026 r. (`#81`, `packages/domain/src/tax-rules/index.ts`)

1. **Rozdzielenie stanów `accrued/due` od `paid` (`buildObligationSettlementSnapshot`)**:
   - Naliczona składka ZUS lub zaliczka podatkowa za okres `YYYY-MM` posiada status `accrued_not_yet_due` / `due_unpaid` do momentu powiązania ze zweryfikowanym rekordem płatności (`VerifiedTaxOrZusPayment` z `paidDate` i `bankTransactionId`).
   - W trybie wiążącym (`binding_verified_payments_only`) nieopłacone składki ZUS **nigdy** nie pomniejszają podstawy opodatkowania PIT/ryczałtu ani podatku. Tryb symulacyjny (`what_if_simulation`) jest jawnie oznaczony flagą `isBindingForFiling: false` oraz ostrzeżeniem prawnym.
2. **Profil A — JDG KPiR (`calculateProfileAKpirObligations`)**:
   - Skala podatkowa (`12%` / `32%`, kwota wolna `30 000 PLN` -> `3 600 PLN` kwoty zmniejszającej, próg `120 000 PLN`, składka zdrowotna `9%` nieodliczalna, minimum zdrowotnej liczone od `100%` minimalnego wynagrodzenia `4 806 PLN` = `432,54 PLN` od lutego 2026 r.).
   - Podatek liniowy (`19%`, składka zdrowotna `4,9%` z limitem odliczenia zapłaconej zdrowotnej `14 100 PLN` w 2026 r.).
3. **Profil B — JDG Ryczałt (`calculateProfileBRyczaltObligations`)**:
   - Wielostawkowe koszyki przychodów z proporcjonalnym odliczeniem wyłącznie **zapłaconych** składek ZUS społecznych oraz `50%` **zapłaconej** składki zdrowotnej, plus 3 progi składki zdrowotnej (`<= 60 000 PLN`, `60 000–300 000 PLN`, `> 300 000 PLN`).
4. **Profil C — Sp. z o.o. CIT (`calculateProfileCCitObligations`)**:
   - Rozdzielenie koszyka zysków kapitałowych (zawsze `19%`, art. 7b i art. 7 ust. 5 ustawy o CIT — straty kapitałowe nie kompensują dochodu operacyjnego) od pozostałych źródeł przychodów.
   - Zasada **fail-closed** dla stawki preferencyjnej `9%` CIT: brak pełnego oświadczenia kwalifikacyjnego (`CitPreferentialEligibilityAttestation`), przekroczenie limitu małego podatnika `2 000 000 EUR` brutto z roku poprzedniego, przekroczenie limitu bieżących przychodów netto `2 000 000 EUR` (liczonego proporcjonalnie `roundUp(2_000_000 * months / 12)` dla roku podatkowego krótszego lub dłuższego niż 12 miesięcy!) lub wyłączenie restrukturyzacyjne z art. 19 ust. 1a–1c skutkuje jawnym błędem `CitPreferentialEligibilityError` przy próbie wymuszenia `9%` albo bezpiecznym zastosowaniem stawki podstawowej `19%`.
