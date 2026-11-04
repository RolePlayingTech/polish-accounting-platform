# 31. System projektowy „Księga Współczesna” — wybór wariantu, tokeny i biblioteka komponentów

- **Status:** specyfikacja projektowa i implementacja biblioteki `@pap/ui` do odbioru w ramach Fazy 1
- **Data:** 2026-11-04
- **Powiązane zadania:** [Issue #13](https://github.com/RolePlayingTech/polish-accounting-platform/issues/13) (kierunek wizualny i design system), [Issue #44](https://github.com/RolePlayingTech/polish-accounting-platform/issues/44) (Strumień S3)
- **Dokumenty bazowe:** [11 — Projekt interfejsu webowego](11-ui-ux.md), [21 — Kierunek wizualny i doświadczenie użytkownika](21-kierunek-wizualny.md), [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md), [ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md)
- **Pakiet docelowy:** `packages/ui` (`@pap/ui`) — czyste komponenty React 19 + Tailwind CSS v4, bez zależności od `@pap/db`, ORM ani protokołów transportowych

---

## 1. Cel dokumentu i zasady nadrzędne

Zgodnie z wymogami `AGENTS.md`, `docs/21-kierunek-wizualny.md` oraz kryteriami akceptacji `Issue #13`, zanim powstaną docelowe ekrany operacyjne księgowości, obiegu dokumentów, Centrum MCP i Akademii Polskiej Księgowości, ustanawiamy **spójny, odróżnialny i audytowalny system projektowy**.

Nadrzędne założenia projektowe:

1. **Środowisko pracy księgowej, nie „dashboard AI”:** interfejs buduje zaufanie, porządek i poczucie pełnej kontroli. Brak neonów, szklistych paneli (`glassmorphism`), przypadkowych gradientów, dekoracyjnych okręgów i fałszywych pasków „ukończenia księgowości w 84%”.
2. **Jawny kontekst prawno-księgowy w każdej chwili:** użytkownik zawsze widzi na górze ekranu **firmę (`legal_entity`), NIP, profil podatkowy, okres rozliczeniowy (`RRRR-MM`) oraz świeżość i charakter danych** (np. tryb syntetyczny vs synchronizacja KSeF).
3. **AI i OCR wyłącznie proponują — człowiek decyduje:** każda wartość wyodrębniona automatycznie ma jawne oznaczenie źródła, poziomu pewności oraz różnicy między propozycją a wartością zatwierdzoną. Przypadkowe naciśnięcie klawisza `Enter` w polu formularza nigdy nie księguje dokumentu.
4. **Wyjaśnialność prawa („Dlaczego? / Podstawa prawna”):** przy każdej wyliczonej kwocie podatku, składki ZUS lub kwalifikacji kosztu dostępny jest panel pokazujący konkretny przepis (artykuł, Dz.U., zakres dat obowiązywania, wersję reguły, status weryfikacji eksperckiej, kroki obliczenia na liczbach oraz link do ISAP / podatki.gov.pl).
5. **Dostępność WCAG 2.2 AA i pełna użyteczność mobilna:** każdy stan komunikowany jest jednocześnie **kolorem, ikoną SVG oraz polską etykietą tekstową**. Tabele księgowe na ekranach mobilnych (`< 768px`) automatycznie przechodzą w pogrupowane karty pozycji ewidencyjnych zamiast nieczytelnego poziomego ściskania kolumn.

---

## 2. Porównanie trzech wariantów projektowych na reprezentatywnych widokach

Przed wyborem docelowego systemu przeanalizowano trzy odmienne kierunki artystyczno-funkcjonalne na trzech kluczowych scenariuszach pracy w polskiej księgowości (wyłącznie na danych syntetycznych):

1. **Pulpit właściciela firmy** (orientacja w bieżącym okresie, kolejka zadań, terminy US/ZUS).
2. **Tabela / rejestr dokumentów** (praca z wieloma fakturami, walutami, statusami weryfikacji).
3. **Split-view weryfikacji faktury** (porównanie niezmiennego oryginału PDF/FA(3) z formularzem decyzji człowieka).

### Wariant A — *Nowoczesny dziennik finansowy*

Koncepcja oparta na szlachetnej tradycji polskich ksiąg handlowych przetłumaczonej na współczesny język cyfrowy: ciepła kość słoniowa tła (`#faf9f5`), głęboki grafitowy atrament (`#191c1a`), cienkie linie rubryk ewidencyjnych (`#e5e2d9`), pojedynczy stonowany akcent leśnego szmaragdu (`#1d5c42`) oraz rygorystyczna typografia kolumn liczbowych (`tabular-nums`).

```text
+-----------------------------------------------------------------------------------+
| [Księga] Pracownia Projektowa „Rytm” | NIP 526-104-08-28 | KPiR · VAT | 2026-10   |
+--------------------+--------------------------------------------------------------+
| PRACA KSIĘGOWA     | BIEŻĄCY STAN OKRESU 2026-10 · Dane syntetyczne               |
| > Pulpit           | Masz 3 dokumenty do sprawdzenia i 1 termin za 5 dni.         |
|   Dokumenty (3)    |--------------------------------------------------------------|
|   KPiR / Ewidencja | DO DECYZJI CZŁOWIEKA                 | TERMINY USTAWOWE      |
|   VAT i JPK        | [!] FV/10/2026 · Hosting UE · 492,00 | 20.11 · Zaliczka PIT|
|   Kalendarz        | [!] Propozycja MCP · Kwalifikacja    | 25.11 · JPK_V7M [§]   |
| WIEDZA             |--------------------------------------------------------------|
|   Akademia         | OSTATNIE POZYCJE EWIDENCYJNE                          (PLN)  |
|   Reguły prawne    | Poz. | Data       | Kontrahent        | Status     | Brutto  |
|                    | 142  | 28.10.2026 | Polskie Sieci SA  | [v] Zaks.  | 1 230,00|
+--------------------+--------------------------------------------------------------+
```

- **Pulpit właściciela firmy:** spokojna góra ekranu z jednym zdaniem podsumowania zadań i dwukolumnowym podziałem na kolejkę decyzji oraz oś terminów. Brak kafli KPI z wykresami kołowymi.
- **Tabela dokumentów:** przypomina czystą kartę księgi — wyraźne linie poziome, brak zbędnych cieni, wyrównane przecinki dziesiętne, spokojne odznaki statusów z ikonami.
- **Split-view weryfikacji:** lewa strona osadzona na lekko ciemniejszym podłożu papierowym (`#efece4`) z metryką SHA-256; prawa strona na czystej bieli (`#ffffff`) z rubrykami pól i sekcją podstawy prawnej.
- **Zalety:** natychmiastowa rozpoznawalność marki, zero skojarzeń z „AI slop”, brak zmęczenia wzroku przy wielogodzinnej pracy (ciepłe tło zamiast ostrego `#ffffff`), naturalny autorytet przy danych prawnych i finansowych.
- **Ryzyka:** przy zbyt dużych odstępach pionowych księgowi obsługujący 300+ faktur miesięcznie musieliby częściej przewijać tabelę; nadmiar detali papierowych mógłby pójść w stronę retro, jeśli nie zachowa się nowoczesnej dyscypliny geometrycznej.

---

### Wariant B — *Spokojne studio finansów*

Przestrzenny, lekki układ narzędziowy z dużymi marginesami (`p-8`), zaokrąglonymi blokami prowadzącymi za rękę i rozbudowanymi opisami objaśniającymi każdy krok dla początkujących właścicieli jednoosobowych działalności gospodarczych.

```text
+-----------------------------------------------------------------------------------+
|  Twoja firma: Studio Graficzne „Kreska”                      Październik 2026     |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|   Dobry początek dnia! Zostały tylko 2 kroki do uporządkowania października:      |
|                                                                                   |
|   +-----------------------------------+   +-----------------------------------+   |
|   | Krok 1: Sprawdź nową fakturę      |   | Krok 2: Przygotuj JPK_V7M         |   |
|   | Paliwo osobowe — odliczysz 50% VAT|   | Termin mija 25 listopada 2026 r.  |   |
|   | [ Przejdź do sprawdzenia -> ]     |   | [ Zobacz instrukcję krok po kroku]|   |
|   +-----------------------------------+   +-----------------------------------+   |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

- **Pulpit właściciela firmy:** duże karty zadaniowe z objaśnieniami językiem potocznym, niska gęstość informacji na pierwszym ekranie.
- **Tabela dokumentów:** wysokie wiersze (`64px`), uproszczona liczba kolumn (ukryte numery KPiR, stawki i podstawy prawne pod rozwijanymi szczegółami).
- **Split-view weryfikacji:** układ przewodnika krok po kroku („1. Sprawdź sprzedawcę → 2. Wybierz kategorię kosztu → 3. Zatwierdź”).
- **Zalety:** minimalny próg wejścia dla osoby zakładającej pierwszą firmę, świetna czytelność treści edukacyjnych, przykładów liczbowych i wskazówek.
- **Ryzyka:** niska wydajność przy codziennej pracy operacyjnej; ukrycie kolumn księgowych utrudnia wychwycenie błędów VAT/NIP; zbyt bliski wizualnie tysiącom generycznych aplikacji SaaS.

---

### Wariant C — *Profesjonalny warsztat księgowego*

Wysokowydajny, zagęszczony interfejs operacyjny inspirowany narzędziami audytorskimi i systemami finansowo-księgowymi dla głównych księgowych oraz biur rachunkowych.

```text
+-----------------------------------------------------------------------------------+
| PODMIOT: [526-104-08-28] AlfaTech Sp. z o.o. | KSIĘGI RACH. | OKRES: 2026-10 [Z]  |
+-----------------------------------------------------------------------------------+
| FILTRY: [Status: Do weryf. x] [Źródło: KSeF x] [Waluta: Wszystkie]   Gęstość:[K]  |
+------+------------+---------------+------------------+---------+---------+--------+
| Poz. | Data wyst. | Nr dokumentu  | NIP kontrahenta  | Netto   | VAT     | Brutto |
+------+------------+---------------+------------------+---------+---------+--------+
| 0841 | 29.10.2026 | FV/2026/10/88 | 701-092-11-34    | 4 000,00|   920,00|4 920,00|
| 0842 | 30.10.2026 | KSEF-99281... | 899-241-55-12    |   850,00|   195,50|1 045,50|
| 0843 | 30.10.2026 | INV-2026-412  | DE129481920      | 1 200,00|     0,00|1 200,00|
+------+------------+---------------+------------------+---------+---------+--------+
| RAZEM STRONA (3 poz., przeliczenie wg tabeli NBP):   | 6 050,00| 1 115,50|7 165,50|
+-----------------------------------------------------------------------------------+
```

- **Pulpit właściciela firmy:** zwięzły pasek stanu okresu, natychmiastowa lista pozycji wymagających uzgodnienia Wn/Ma, rozrachunków i walidacji XSD.
- **Tabela dokumentów:** kompaktowe wiersze (`34px`), jawne jednostki w nagłówkach, wiersz sum kontrolnych w stopce (`<tfoot>`), obsługa wyłącznie z klawiatury, brak dekoracyjnych odstępów.
- **Split-view weryfikacji:** gęsta siatka wszystkich pól dekretacyjnych jednocześnie obok oryginału, natychmiastowy podgląd różnic (`diff`) propozycji OCR i skrótów walidacji.
- **Zalety:** maksymalna produktywność specjalisty, błyskawiczne skanowanie wzrokiem kolumn kwot, dat i NIP-ów, pełna transparentność techniczna (SHA-256, numery KSeF, wersje reguł).
- **Ryzyka:** zastosowany bez łagodzącej hierarchii wizualnej i objaśnień może przytłaczać mniejszych przedsiębiorców samodzielnie prowadzących KPiR lub ryczałt.

---

### Porównanie syntetyczne wariantów

| Kryterium oceny (`Issue #13`) | Wariant A (Dziennik) | Wariant B (Studio) | Wariant C (Warsztat) | Synteza: **„Księga Współczesna”** |
| --- | --- | --- | --- | --- |
| Odróżnialność od „AI slop” | Bardzo wysoka | Średnia | Wysoka | **Bardzo wysoka** |
| Zaufanie i autorytet prawny | Bardzo wysoka | Średnia | Wysoka | **Bardzo wysoka** |
| Ergonomia przy 100+ fakturach | Dobra | Niska | Bardzo wysoka | **Bardzo wysoka** (przełącznik gęstości) |
| Przyjazność dla JDG / uczących się | Dobra | Bardzo wysoka | Niska | **Wysoka** (`FieldHelpButton` + Akademia) |
| Czytelność na telefonie (`< 768px`) | Wysoka | Wysoka | Trudna bez adaptacji | **Wysoka** (automatyczne karty pozycji) |

---

## 3. Rekomendacja i decyzja: synteza „Księga Współczesna” (`A + C + B`)

Jako docelowy system projektowy Polish Accounting Platform wybieramy spójną syntezę nazwaną **„Księga Współczesna”**:

1. **Wariant A stanowi tożsamość wizualną całej platformy:** ciepły papier tła (`#faf9f5` / `#f4f2ec`), czysta biel powierzchni roboczych (`#ffffff`), cienkie linie ewidencyjne (`#e5e2d9`), głęboki grafitowy atrament (`#191c1a`) oraz stonowany leśny szmaragd (`#1d5c42`) zarezerwowany dla interakcji i aktywnej nawigacji.
2. **Wariant C definiuje ergonomię operacyjną tabel, formularzy weryfikacji i audytu:**
   - tabele `LedgerTable` oferują przełącznik gęstości **`Podstawowa`** (`comfortable`, dla właściciela firmy) oraz **`Kompaktowa`** (`compact`, dla księgowego), jawne jednostki w nagłówkach, podsumowania oraz automatyczne przejście w karty ewidencyjne na telefonach;
   - `SplitVerificationView` i `AiProposalField` eksponują hash SHA-256 oryginału, pewność ekstrakcji, dokładny `diff` zmian człowieka i blokują przypadkowe zatwierdzenie klawiszem `Enter`.
3. **Wariant B zasila warstwę edukacyjną, onboarding i pomoc kontekstową:**
   - moduły kursu w `AcademyLessonView` i `InteractiveQuiz` mają spokojny, oddechowy rytm z kartami przykładów liczbowych i listą typowych błędów;
   - w formularzach operacyjnych zamiast przeładowywać ekran ścianą tekstu zastosowano dyskretny wyzwalacz `FieldHelpButton` (`?` powiązany z `fieldHelpId`) oraz przycisk `WhyTrigger` (`§ Dlaczego?`).

### Charakterystyczny motyw produktu (Sygnatura „Rubryki i Podstawy Prawnej”)

Zamiast sztucznych ozdobników „Księga Współczesna” wyróżnia się trzema powtarzalnymi, użytecznymi detalami:
- **Belka kontekstu księgowego (`CompanyPeriodHeader`)** — zawsze przypięta na górze, z wyraźnym rozdzieleniem nazwy firmy, NIP-u w formacie `XXX-XXX-XX-XX`, profilu podatkowego, okresu `RRRR-MM` i odznaki świeżości danych.
- **Dwupoziomowy zapis kwoty (`MoneyAmount`)** — wyrównane do prawej cyfry `tabular-nums`, w których pełne złote mają mocny grafitowy ciężar, a część groszowa (`,00`) i kod waluty ISO (`PLN`, `EUR`) są subtelnie lżejsze wizualnie, co przyspiesza porównywanie rzędów wielkości bez utraty precyzji co do grosza.
- **Pieczęć podstawy prawnej (`WhyTrigger` + `LegalBasisPanel`)** — kodeksowy ton `legal` z symbolem `§`, który jednym kliknięciem odsłania przepis, Dz.U., wersję reguły, status kontroli eksperta i rachunek krok po kroku.

---

## 4. Katalog tokenów projektowych (`packages/ui/src/tokens.ts`)

### 4.1. Kolory powierzchni, linii i atramentu

| Token semantyczny | Wartość HEX | Rola w interfejsie | Kontrast WCAG 2.2 |
| --- | --- | --- | --- |
| `canvas.DEFAULT` | `#faf9f5` | Tło główne aplikacji (ciepła kość słoniowa / papier księgowy) | Tło bazowe |
| `canvas.subtle` | `#f4f2ec` | Lewa nawigacja, nagłówki tabel (`<thead>`), tła sekcji wtórnych | Separacja z `#ffffff` |
| `canvas.document` | `#efece4` | Podłoże podglądu dokumentu oryginalnego w `SplitVerificationView` | Wyraźna granica oryginału |
| `surface.DEFAULT` | `#ffffff` | Karty zadaniowe, wiersze tabel, pola formularzy, szuflady i dialogi | Tło zawartości |
| `border.subtle` | `#e5e2d9` | Cienkie linie ewidencyjne wierszy i obramowania paneli (`1px`) | Nienachalny rytm rubryk |
| `border.strong` | `#858177` | Obramowania pól formularzy, przełączników i aktywnych kontrolek | **3.85:1** na `#ffffff` / **3.69:1** na `#faf9f5` (AA 1.4.11) |
| `ink.DEFAULT` | `#191c1a` | Tekst podstawowy, kwoty główne, nagłówki (głęboki grafit) | **16.8:1** na `#ffffff` (AAA) |
| `ink.secondary` | `#464c48` | Tekst pomocniczy, opisy wierszy, parametry techniczne | **8.5:1** na `#faf9f5` (AAA) |
| `ink.muted` | `#636b66` | Nadtytuły (`eyebrow`), jednostki w nagłówkach, wskazówki pól | **5.2:1** na `#faf9f5` (AA) |
| `accent.DEFAULT` | `#1d5c42` | Akcent interakcji marki: główne przyciski akcji, aktywna pozycja menu, `focus` | **7.7:1** z `#ffffff` (AAA) |
| `accent.hover` | `#164833` | Stan najechania głównego przycisku akcji | **9.8:1** z `#ffffff` (AAA) |
| `accent.surface` | `#e7f1ec` | Tło aktywnej pozycji nawigacji i wyróżnionego filtra | Z tekstem `#164833` |

> **Zasada rozdziału semantycznego:** kolor marki `#1d5c42` oznacza **aktywne miejsce i główną akcję użytkownika**, a nie „sukces podatkowy”. Stany weryfikacji i zgodności używają osobnych tonów semantycznych poniżej.

### 4.2. Tony semantyczne (zawsze Kolor + Ikona SVG + Polska Etykieta)

| Ton (`StatusTone`) | Tekst | Tło | Obramowanie | Obowiązkowy symbol / ikona | Przykładowe znaczenie domenowe |
| --- | --- | --- | --- | --- | --- |
| `success` | `#165b33` | `#eaf5ee` | `#b8dec6` | Znacznik wyboru w okręgu (`✓`) | `Zaksięgowano`, `Zatwierdzono`, `API odpowiada` |
| `warning` | `#854d0e` | `#fef7e6` | `#f3d38c` | Trójkąt ostrzegawczy / zegar (`!`) | `Do weryfikacji`, `Termin za 5 dni`, `Średnia pewność AI` |
| `danger` | `#991b1b` | `#fef2f2` | `#f5bcbc` | Ośmiokąt błędu (`×`) | `Zaległość`, `Konflikt duplikatu`, `Odmowa dostępu` |
| `info` | `#1e40af` | `#eff6ff` | `#bfdbfe` | Okrąg informacyjny (`i`) | `Synchronizacja KSeF`, `Przetwarzanie OCR` |
| `legal` | `#5b4618` | `#f7f4ea` | `#dcd3b8` | Znak paragrafu (`§`) | `Podstawa prawna`, `Zweryfikowano w Dz.U.` |
| `accent` | `#164833` | `#e7f1ec` | `#b7d4c5` | Romboidalny znacznik kontekstu | `Aktywny okres`, `Lekcja Akademii` |
| `neutral` | `#44403c` | `#f5f4f0` | `#dedbd2` | Kreska w okręgu (`–`) | `Wersja robocza`, `Planowane`, `Nie dotyczy` |

### 4.3. Typografia, zapis liczb i formatowanie polskie

- **Krój podstawowy UI:** `Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` — wysoka czytelność polskich znaków diakrytycznych przy małych stopniach pisma (`12px`–`14px`).
- **Krój techniczny (`monospace`):** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` — skróty `SHA-256`, identyfikatory KSeF, klucze idempotentności MCP oraz kody schem JPK.
- **Obowiązkowe cyfry tabelaryczne (`tabular-nums lining-nums`):** stosowane bez wyjątku dla:
  - wszystkich kwot pieniężnych (przychody, koszty, VAT, zaliczki PIT/CIT, składki ZUS, salda Wn/Ma),
  - numerów NIP (`526-104-08-28`), dat (`28.10.2026`), okresów (`2026-10`) i stawek procentowych (`23%`, `12%`, `8,5%`).
- **Bezstratne formatowanie groszowe (`formatCurrencyPln`):** arytmetyka formatowania opiera się na całkowitych groszach (`bigint` lub liczba całkowita groszy), z niełamliwą spacją `\u00A0` jako separatorem tysięcy, przecinkiem dziesiętnym oraz jawnym trzyliterowym kodem waluty ISO 4217 (`12 450,75 PLN`).

### 4.4. Promienie, warstwy, cienie i ruch

- **Promienie:** `rounded-lg` (`8px`) dla przycisków, pól wejściowych i przycisków gęstości; `rounded-xl` (`12px`) dla kart zadaniowych, ramek tabel i paneli podstawy prawnej. Zakaz stosowania `rounded-3xl` na kontenerach roboczych.
- **Obramowania zamiast dekoracyjnych cieni:** powierzchnie na płaszczyźnie strony oddzielane są wyłącznie linią `1px solid #e5e2d9`. Cień warstwowy (`shadow-xl`) zarezerwowany jest wyłącznie dla rzeczywistych warstw nad treścią: szuflady mobilnej w `AppShell` oraz modalnego dialogu `CriticalConfirmDialog`.
- **Gęstość (`comfortable` vs `compact`):**
  - `comfortable` (`Podstawowa`): komórki tabeli `px-4 py-3 text-[13px]`, wygodne przeglądanie i nauka;
  - `compact` (`Kompaktowa`): komórki tabeli `px-3 py-1.5 text-xs`, z zachowaniem minimalnego rozmiaru celu klikalnego `>= 24×24 px` (WCAG 2.2 kryterium `2.5.8 Target Size Minimum`).
- **Ruch (`prefers-reduced-motion`):** każda zmiana stanu używa klas `motion-reduce:transition-none motion-reduce:animate-none`, całkowicie wyłączając animacje u użytkowników z preferencją ograniczonego ruchu.

---

## 5. Rozdział powierzchni `/app`, `/settings` i `/platform` (zgodnie z ADR-003)

System komponentów `AppShell` egzekwuje czytelne granice wizualne i informacyjne między trzema powierzchniami aplikacji:

1. **`surface="app"` (`/app/*` — Praca księgowa firmy):**
   - wymaga paska `CompanyPeriodHeader` ze wskazaniem konkretnej firmy (`legal_entity`), NIP, profilu podatkowego i okresu rozliczeniowego;
   - przy braku grantu do danej firmy komponenty wyświetlają jawny stan `forbidden` (`Brak uprawnień do danych tej firmy`) bez ujawniania liczb ani nazw kontrahentów.
2. **`surface="settings"` (`/settings/*` — Ustawienia organizacji / tenanta):**
   - spokojniejszy nagłówek administracji organizacją (członkostwa, zaproszenia, uprawnienia klientów MCP, eksport danych archiwalnych);
   - nie miesza ustawień ról użytkowników z bieżącym księgowaniem faktur.
3. **`surface="platform"` (`/platform/*` — Konsola operatora platformy):**
   - wyraźny, chłodniejszy pasek ostrzegawczy operatora technicznego z informacją: *„Konsola operatora usługi — operator platformy nie posiada automatycznego dostępu do ksiąg, dokumentów ani danych podatkowych klientów”*;
   - brak przełącznika firm klientów i brak funkcji cichej impersonacji.

---

## 6. Walidacja użyteczności — protokół 3 zadań kontrolnych

Zgodnie z procesem z `docs/21-kierunek-wizualny.md` (rozdz. „Jak zatwierdzić kierunek”) oraz `Issue #13`, projekt zweryfikowano na trzech reprezentatywnych zadaniach użytkownika na desktopie i telefonie (`< 768px`):

### Zadanie 1: „Znajdź dokument wymagający sprawdzenia i przejdź do decyzji”
- **Przepływ Desktop:** użytkownik otwiera Pulpit → w górnej sekcji `ActionQueue` widzi jednozdaniowe podsumowanie (`Masz 2 pozycje wymagające decyzji człowieka`) oraz wiersz faktury z bursztynową odznaką `Pilne` i przyciskiem `Sprawdź dokument` → alternatywnie w `LedgerTable` filtruje status i przełącza gęstość na `Kompaktową`.
- **Przepływ Mobile (`< 768px`):** `ActionQueue` układa przycisk akcji na pełną szerokość karty dotykowej (`min-h-10`), a `LedgerTable` prezentuje każdą fakturę jako osobną kartę ewidencyjną z nazwą kontrahenta, statusem i kwotą brutto bez przewijania w poziomie.

### Zadanie 2: „Sprawdź, w jakiej firmie, profilu i okresie pracujesz oraz czy dane są aktualne”
- **Przepływ Desktop i Mobile:** stały nagłówek `CompanyPeriodHeader` bezpośrednio nad obszarem roboczym prezentuje pełną nazwę podmiotu, sformatowany NIP (`526-104-08-28`), profil (`JDG · KPiR · Skala PIT · VAT czynny`), selektor okresu (`2026-10`) oraz odznakę świeżości (`Dane syntetyczne · KSeF zsynchronizowano 10:40`). Ryzyko zaksięgowania faktury w niewłaściwej spółce lub miesiącu zostaje zredukowane przed wykonaniem jakiejkolwiek akcji.

### Zadanie 3: „Zidentyfikuj różnicę przed zatwierdzeniem oraz sprawdź podstawę prawną”
- **Przepływ w `SplitVerificationView`:** po lewej użytkownik widzi podgląd oryginału wraz ze skrótem `SHA-256` i gwarancją nienaruszalności pliku; po prawej `AiProposalField` oznacza pola wyodrębnione z OCR, poziom pewności (`Średnia pewność — sprawdź z oryginałem`) oraz jawny blok porównania `Proponowano przez AI → Wartość zatwierdzona przez człowieka`.
- **Kontrola przepisu i zatwierdzenie:** obok kwalifikacji podatkowej przycisk `WhyTrigger` (`§ Dlaczego?`) otwiera `LegalBasisPanel` z artykułem ustawy, pozycją Dz.U., krokami wyliczenia i linkiem do ISAP. Kliknięcie `Zatwierdź i zaksięguj` otwiera `CriticalConfirmDialog` podsumowujący firmę, okres, kwotę oraz skutki w dzienniku audytu.

---

## 7. Architektura biblioteki `@pap/ui` i plan wdrożenia w kolejnych PR-ach

### Moduły zaimplementowane w `packages/ui/src/` (Faza 1 — ten PR)

| Moduł | Eksportowane elementy | Przeznaczenie |
| --- | --- | --- |
| `tokens.ts` | `ksiegaTokens`, `formatCurrencyPln`, `splitFormattedMoney`, `formatPolishDate`, `formatAccountingPeriod`, `formatNip`, `isValidNipChecksum`, `isSafeAppUrl`, `sanitizeAppUrl` | Tokeny kolorów/typografii, bezstratne formatowanie groszy PLN/ISO, dat, okresów, walidacja KSeF `TNIP` oraz ochrona URL |
| `focus-trap.ts` | `useModalFocusTrap`, `attachModalFocusTrap`, `cycleFocusTrapIndex`, `cycleRadioGroupIndex` | Zarządzanie fokusem w modalach/szufladach (WCAG 2.4.3) oraz nawigacja strzałkami WAI-ARIA `radiogroup` |
| `primitives.tsx` | `Card`, `StatusBadge`, `ToneIcon` | Kompatybilne wstecz prymitywy powierzchni i statusów z wbudowanymi ikonami SVG |
| `money.tsx` | `MoneyAmount` | Tabularna prezentacja kwot finansowych z wyróżnieniem groszy i wariantami semantycznymi |
| `shell.tsx` | `AppShell`, `CompanyPeriodHeader`, `DEFAULT_APP_NAV_SECTIONS` | Główny układ aplikacji z sekcjami nawigacji, szufladą mobilną, skip-linkiem i paskiem kontekstu firmy/okresu |
| `ledger-table.tsx` | `LedgerTable`, `DataTable` | Tabela księgowa z jednostkami, przełącznikiem gęstości, kartami mobilnymi i stanami `loading`/`empty`/`error`/`forbidden` |
| `workflow.tsx` | `ActionQueue`, `ObligationTimeline` | Kolejka decyzji człowieka oraz oś nadchodzących i zaległych obowiązków podatkowych/ZUS |
| `legal-basis.tsx` | `LegalBasisPanel`, `WhyTrigger` | Panel wyjaśnialności prawa („Dlaczego? / Podstawa prawna”) z krokami obliczeń i linkiem urzędowym |
| `verification.tsx` | `SplitVerificationView`, `AiProposalField` | Dwukolumnowa weryfikacja dokumentu (oryginał + SHA-256 vs decyzja człowieka, `diff` AI, blokada `Enter`) |
| `forms.tsx` | `FormField`, `FieldHelpButton` | Dostępne pole formularza (`role="alert"`, `aria-invalid`, `aria-describedby`) z pomocą kontekstową `fieldHelpId` |
| `confirm-dialog.tsx` | `CriticalConfirmDialog` | Modal zatwierdzania operacji krytycznych (księgowanie, zgoda MCP, zamknięcie okresu) z podsumowaniem audytowym |
| `academy.tsx` | `AcademyLessonView`, `LessonLayout`, `InteractiveQuiz` | Komponenty edukacyjne Akademii Księgowości (przykład liczbowy, przepis, typowe błędy, zrzut ekranu, quiz) |

### Plan etapowego przejścia w `apps/web` (bez naruszania granic bieżących strumieni)

1. **Etap 1 (obecny PR — Strumień S3):** dostarczenie kompletnego systemu tokenów, komponentów i testów jednostkowych dostępności w `@pap/ui` oraz niniejszej specyfikacji w `docs/31-design-system-ksiega-wspolczesna.md`, przy 100% kompatybilności wstecznej istniejących stron `apps/web`.
2. **Etap 2 (po scaleniu fundamentu bezpieczeństwa S1, silnika podatkowego S2 i API Fazy 2):** podpięcie zmiennych CSS w `apps/web/app/globals.css` oraz wdrożenie `AppShell` i `CompanyPeriodHeader` z serwerowym kontekstem autoryzacji firmy i okresu.
3. **Etap 3 (Faza 3):** budowa pełnych ekranów operacyjnych (Pulpit z `ActionQueue`/`ObligationTimeline`, Rejestr dokumentów i KPiR na `LedgerTable`, weryfikacja faktur na `SplitVerificationView`, kalkulatory z `WhyTrigger`, Centrum MCP z `CriticalConfirmDialog` oraz kurs na `AcademyLessonView` i `InteractiveQuiz`) wraz z testami E2E w Playwright.
