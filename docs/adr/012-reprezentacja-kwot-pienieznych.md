# ADR-012 — Kanoniczna reprezentacja kwot pieniężnych, granice precyzji i reguły zaokrągleń

Data: 2026-11-24. Status: zaakceptowany i wdrożony w kodzie.
Powiązania: Issue #117, Issue #124, `docs/16-zasady-architektoniczne.md` (§C.11), ADR-001, ADR-002, ADR-007, ADR-010.

## Kontekst i problem

W dokumencie [16. Zasady architektoniczne](../16-zasady-architektoniczne.md) (§C.11) sformułowano zasadę ogólną:

> _„Kwoty wyłącznie w bezstratnym formacie `numeric/Decimal` z walutą i regułami zaokrągleń określonymi dla konkretnego obliczenia. Nie używać JS `number` do podatków, sald, sum Wn/Ma ani wymiany walut.”_

Intencją §C.11 było bezwzględne wykluczenie **arytmetyki zmiennoprzecinkowej IEEE-754 na ułamkach dziesiętnych złotych** (np. `0.1 + 0.2 === 0.30000000000000004`, `100.10 * 0.23`), która prowadzi do rozjazdów groszowych w sumach `Wn/Ma`, rejestrach VAT oraz rozrachunkach bankowych.

W trakcie implementacji rdzenia domenowego (`packages/domain/src/money.ts`), schematów kontraktowych (`packages/contracts`), warstwy persystencji PostgreSQL 18 (`packages/db`) oraz bramek REST i MCP przyjęto architekturę **stałoprzecinkowych całkowitych groszy (`1 PLN = 100 gr`) z arytmetyką pośrednią `BigInt`**. Brak dedykowanego rekordu ADR wyjaśniającego relację pomiędzy sformułowaniem §C.11 a wdrożonym modelem stałoprzecinkowym w groszach powodował niejednoznaczność interpretacyjną podczas audytów architektonicznych (Issue #117).

## Decyzja

Ustanawia się jednolity, wielowarstwowy kontrakt reprezentacji i przetwarzania wartości pieniężnych w całej platformie:

### 1. Reprezentacja w warstwach systemu

| Warstwa                                                 | Reprezentacja kanoniczna                                                                                                        | Typ i ograniczenia walidacyjne                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL 18 (`@pap/db`)**                           | Stałoprzecinkowa liczba całkowita w groszach (`*_grosze`)                                                                       | Kolumny `BIGINT NOT NULL` (`-9_223_372_036_854_775_808 .. 9_223_372_036_854_775_807`); w sterowniku Drizzle/pg mapowane bez utraty precyzji.                                                                                                                             |
| **Domena (`@pap/domain`)**                              | Całkowite grosze ze znakiem walidowane przez `assertSafeGrosze` + obliczenia pośrednie na `BigInt`                              | `Number.isSafeInteger(x)` (`±9_007_199_254_740_991 gr`, tj. **`±90 071 992 547 409,91 PLN`**, ~90 bln PLN). Każde dodawanie, odejmowanie, sumowanie i mnożenie przez stawkę wykonuje się na typie `BigInt` i weryfikuje przed konwersją powrotną (`bigintToSafeNumber`). |
| **Kontrakty wewnętrzne i REST (`@pap/contracts`)**      | Pola całkowite `*Grosze` (`SafeGroszeSchema` / `NonNegativeGroszeSchema`) oraz sformatowane etykiety prezentacyjne `*Formatted` | `z.number().int().refine(Number.isSafeInteger)`; na granicach formularzy tekstowych i importów CSV/MT940/FA(3) — deterministyczny parser tekstowy `parsePlnToGrosze(text)` bez udziału `parseFloat`.                                                                     |
| **Kontrakty narzędzi MCP (`@pap/contracts/mcp-tools`)** | Kanoniczne napisy dziesiętne PLN (`*Pln`, np. `"1230.00"`, `"-50.00"`)                                                          | Walidacja wyrażeniem regularnym `/^-?\d+\.\d{2}$/` i natychmiastowa bezstratna konwersja w adapterze przez `parsePlnToGrosze` / `formatGroszeDecimalPln` — eliminuje ryzyko halucynacji lub niejawnego zaokrąglenia liczb JSON przez zewnętrzne klienty LLM.             |
| **Eksporty urzędowe XSD (`JPK_V7M`, `FA(3)`)**          | Napisy dziesiętne `TKwota2` (`0.00`) dla ewidencji oraz liczby całkowite `TKwotaC` (pełne złote) dla deklaracji                 | Generowane deterministycznie z groszy bez konwersji zmiennoprzecinkowej.                                                                                                                                                                                                 |

### 2. Doprecyzowanie i uzgodnienie z §C.11 (`docs/16-zasady-architektoniczne.md`)

1. **Zakaz zmiennoprzecinkowy z §C.11 pozostaje bezwzględny:** w żadnym module (`domain`, `application`, `db`, `api`, `mcp`, `web`) nie wolno przechowywać ani przeliczać kwot w złotych jako ułamkowych wartości `number` IEEE-754 (zakaz `parseFloat`, `Number(str) * 100`, `amount * 0.23`, `amount / 1.23`).
2. **Stałoprzecinkowa liczba całkowita groszy (`SafeGrosze`) + `BigInt` realizuje wymóg bezstratności §C.11 dla waluty PLN (`2` miejsca po przecinku):**
   - pierścień liczb całkowitych w groszach jest izomorficzny z typem `DECIMAL(16, 2)` w zakresie do `90 071 992 547 409,91 PLN`,
   - wszystkie iloczyny pośrednie (`BigInt(amountGrosze) * BigInt(numerator)`) wykonywane są w arytmetyce całkowitej dowolnej precyzji `BigInt`, dzięki czemu iloczyn pośredni nigdy nie przekracza 53-bitowej mantysy `Number.MAX_SAFE_INTEGER` przed podzieleniem przez mianownik (`10_000 bps`),
   - wynik `-0` w JS jest kanonicznie normalizowany do `0` (`Object.is(x, -0) ? 0 : x`).
3. **Rozszerzenie na wielowalutowość i ceny jednostkowe > 2 miejsc po przecinku (przyszłe etapy):**
   - dla kursów walut NBP (4 miejsca po przecinku, np. `1 EUR = 4,2634 PLN`) stosuje się całkowite punkty bazowe (`42_634 bps`) oraz `multiplyGroszeByRatio` na `BigInt`,
   - dla ewentualnych cen jednostkowych z dokładnością do 4–6 miejsc po przecinku na fakturach magazynowych wprowadzony zostanie jawny obiekt wartości `{ subUnits: bigint, scale: 2 | 4 | 6, currency: CurrencyCode }` przed etapem gospodarki magazynowej / FX, bez naruszania kanonicznych kwot księgowych w groszach PLN.

### 3. Jawne reguły zaokrągleń przypisane do klasy obliczenia

Zgodnie z §C.11 każde zaokrąglenie musi wynikać z przepisu prawa i być jawnie nazwane w funkcji domenowej:

1. **Zaokrąglenie handlowe pozycji faktury i VAT (`half_up` do 1 grosza — § 106e ust. 11 ustawy o VAT):**
   - `calculateInvoiceLineFromNet(netGrosze, vatRate)` oraz `calculateInvoiceLineFromGross(grossGrosze, vatRate)` stosują symetryczne zaokrąglenie od zera (`remainder * 2n >= denominator`, tj. `0,5 gr -> 1 gr`, `-0,5 gr -> -1 gr` dla korekt `in minus`).
2. **Zaokrąglenie podstaw opodatkowania i kwot podatków do pełnych złotych (`art. 63 § 1 Ordynacji podatkowej`):**
   - `roundTaxAmountOrdynacjaArt63(amountGrosze)` — końcówki `< 50 gr` pomija się, a `>= 50 gr` podwyższa do pełnych złotych (dla zaliczek PIT, ryczałtu, CIT oraz pól dodatnich JPK_V7M),
   - `roundSignedTaxAmountOrdynacjaArt63(amountGrosze)` — wariant ze znakiem dla pól deklaracyjnych `TKwotaC` dopuszczających ujemne sumy korekt (`P_38`, `P_48` w `JPK_V7M`).
3. **Zaokrąglenie proporcjonalnych limitów ustawowych CIT do pełnych `1 000 PLN` (`art. 4a pkt 10` i `art. 19 ust. 1 pkt 2 ustawy o CIT`):**
   - `roundLimitToNearestThousandPlnGrosze(rawGrosze)` — końcówki `< 500,00 zł` (`< 50_000 gr`) pomija się, a `>= 500,00 zł` podwyższa do pełnych tysięcy złotych (`100_000 gr`).
4. **Proporcjonalna alokacja odliczeń ZUS w ryczałcie wielostawkowym (`art. 11 ust. 1–2 u.z.p.d.`):**
   - `allocateDeductionProportionally` rozdziela odliczenie bez utraty ani wykreowania grosza (`SUM(alokacji_i) === odliczenie_ogółem` co do `1 gr`).

## Konsekwencje i egzekwowanie testowe

1. Zestaw testów kontraktowych `packages/domain/test/money-contract-adr012.test.ts` weryfikuje w CI:
   - odrzucanie `NaN`, `±Infinity`, ułamków (`10.5`) oraz `Number.MAX_SAFE_INTEGER + 1`,
   - brak przepełnienia mantysy IEEE-754 przy mnożeniu dużych kwot (`500 mld PLN * 23%`) dzięki pośredniemu `BigInt`,
   - odrzucanie nadmiarowych miejsc dziesiętnych (`"10.999"`) w `parsePlnToGrosze` oraz obsługę polskiego formatu z przecinkiem i spacjami (`"1 234,56"`),
   - deterministyczną zgodność wszystkich trzech klas zaokrągleń (`half_up`, `art. 63 § 1 OP`, `1 000 PLN CIT`).
2. Wszelkie nowe moduły finansowe mają obowiązek korzystać wyłącznie z prymitywów `@pap/domain/money` (`addGrosze`, `subtractGrosze`, `sumGrosze`, `multiplyGroszeByBps`, `multiplyGroszeByRatio`, `parsePlnToGrosze`, `formatPlnFromGrosze`).
