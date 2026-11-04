# Akademia Polskiej Księgowości — Program Kursu i Dokumentacja Modułu

> **Zastrzeżenie prawne i edukacyjne:** Materiały zawarte w Akademii Polskiej Księgowości mają charakter wyłącznie edukacyjny i szkoleniowy (stan prawny zweryfikowany na `2026-11-04` z uwzględnieniem przepisów na lata 2025/2026). Nie stanowią doradztwa podatkowego, prawnego ani księgowego w rozumieniu ustawy o doradztwie podatkowym. Wszystkie przykłady posługują się w 100% danymi syntetycznymi.

---

## 1. Cel i architektura Akademii

**Akademia Polskiej Księgowości** łączy w jednym, silnie typowanym modelu domenowym (`@pap/domain/academy`) oraz kontrakcie walidacyjnym Zod (`@pap/contracts/academy`):

1. **Kompletny kurs polskiej księgowości od podstaw (12 modułów, 37 lekcji)** — napisany przystępnym językiem dla właścicieli firm, początkujących księgowych oraz operatorów weryfikujących dokumenty.
2. **Praktyczny samouczek aplikacji** — oparty o trzy syntetyczne firmy demonstracyjne (`demo_jdg_kpir_alfa`, `demo_jdg_ryczalt_beta`, `demo_spzoo_gamma`).
3. **Pomoc kontekstową w formularzach (`fieldHelpId`)** — powiązaną z komponentem `FieldHelpButton` (`?`) w bibliotece `@pap/ui` (`Księga Współczesna`) oraz odsyłającą bezpośrednio do odpowiedniej lekcji.
4. **Słownik pojęć księgowych i podatkowych** — podzielony na 7 kategorii tematycznych.
5. **Deterministyczny silnik oceny quizów (`evaluateLessonQuiz`)** — sprawdzający odpowiedzi kontrolne bez udziału LLM, z pełnym wyjaśnieniem merytorycznym każdego pytania.

### Gwarancje jakości merytorycznej i technicznej

- **Każda z 37 lekcji zawiera:** przystępne wprowadzenie, sekcje merytoryczne z punktami kluczowymi, wielokrokowy przykład liczbowy w PLN (`12 300,00 PLN`), zweryfikowaną podstawę prawną z oficjalnych źródeł RP (`isap.sejm.gov.pl`, `dziennikustaw.gov.pl`, `podatki.gov.pl`, `zus.pl`, `biznes.gov.pl`, `uodo.gov.pl`, `gov.pl`), metadane na prawdziwy zrzut ekranu z aplikacji, ćwiczenie praktyczne na firmie demo, typowe błędy z konsekwencjami, podsumowanie oraz interaktywny quiz.
- **Zakaz makiet AI udających zrzuty ekranu:** każdy obiekt `screenshotSlot` definiuje `slotId`, ścieżkę widoku `appRoute`, selektor DOM `captureSelector` (`[data-testid="..."]`) oraz docelowy plik `/academy/screenshots/<slotId>.png` generowany automatycznie przez Playwright z rzeczywistego interfejsu aplikacji.
- **Aktualny stan prawny 2025/2026:** uwzględnia m.in. ustawowo wolną Wigilię 24 grudnia (od 2025 r.), podwyższony limit zwolnienia podmiotowego VAT do **240 000,00 PLN** (od 01.01.2026 r.), harmonogram KSeF (**01.02.2026 r.** / **01.04.2026 r.** oraz próg przejściowy **10 000,00 PLN** miesięcznie do końca 2026 r.), likwidację not korygujących od lutego 2026 r., strukturę `FA(3)` i oznaczenia `OFF` / `BFK` / `DI` w `JPK_V7M(3)` oraz ulgę na złe długi po 90 dniach (`art. 89a/89b VAT`, `art. 26i PIT`, `art. 18f CIT`).

---

## 2. Program wszystkich 12 modułów (37 lekcji)

|   Nr   | Moduł (`slug`)                                                                                                  | Liczba lekcji | Zakres merytoryczny                                                                                                                                                                                                                                           |
| :----: | :-------------------------------------------------------------------------------------------------------------- | :-----------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1**  | **Podstawy księgowości dla przedsiębiorcy** (`podstawy-ksiegowosci-dla-przedsiebiorcy`)                         |       3       | Przychód należny vs dochód vs cash flow; koszty KUP i wyłączenia NKUP; dowód księgowy i odpowiedzialność podatnika/kierownika jednostki.                                                                                                                      |
| **2**  | **Formy prowadzenia działalności i rodzaje ewidencji** (`formy-prowadzenia-dzialalnosci-i-rodzaje-ewidencji`)   |       3       | Porównanie JDG, spółki cywilnej i sp. z o.o.; wybór skali (12%/32%), liniowego (19%) i ryczałtu; CIT klasyczny (9%/19%) vs Estoński CIT.                                                                                                                      |
| **3**  | **Podatki w praktyce — PIT, CIT i VAT** (`podatki-w-praktyce-pit-cit-i-vat`)                                    |       3       | Narastające zaliczki PIT/CIT i zaokrąglenia z art. 63 § 1 OP; VAT należny i naliczony (23%, 8%, 5%, 0%, zw.); limit zwolnienia 240 000 PLN od 2026 r., metoda kasowa i obowiązkowy MPP (> 15 000 PLN).                                                        |
| **4**  | **Faktury, korekty, archiwizacja i KSeF 2.0** (`faktury-korekty-archiwizacja-i-ksef-2-0`)                       |       3       | Elementy faktury (art. 106e VAT) i zaliczki; korekty in minus / in plus i likwidacja not korygujących od 02.2026; KSeF 2026, FA(3), tryb offline24 z kodami QR i archiwizacja.                                                                                |
| **5**  | **Podatkowa Księga Przychodów i Rozchodów (KPiR)** (`podatkowa-ksiega-przychodow-i-rozchodow-kpir`)             |       3       | Układ 19 kolumn PKPiR od 2026 r. (`Dz.U. 2025 poz. 1299` — kol. 3 Nr KSeF, kol. 5 NIP) a historyczne 17 kolumn; księgowanie sprzedaży, towarów i samochodu (50% VAT i 75% KUP); remanent.                                                                     |
| **6**  | **Ryczałt od przychodów ewidencjonowanych** (`ryczalt-od-przychodow-ewidencjonowanych`)                         |       3       | Ewidencja przychodów i stawki wg PKWiU (17%–2%); wyłączenia z art. 8 ustawy o ryczałcie i odliczenie 50% składki zdrowotnej; opłacalność ryczałtu i progi 60 tys. / 300 tys. PLN.                                                                             |
| **7**  | **Pełna księgowość (Księgi rachunkowe wg UoR)** (`pelna-ksiegowosc-ksiegi-rachunkowe-wg-uor`)                   |       3       | Zakładowy Plan Kont (Zespoły 0–8) i zasada podwójnego zapisu `Wn = Ma`; dekretacja faktur, wyciągu bankowego i storno; czytanie Bilansu (`Aktywa = Pasywa`) oraz RZiS.                                                                                        |
| **8**  | **ZUS i składka zdrowotna przedsiębiorcy** (`zus-i-skladka-zdrowotna-przedsiebiorcy`)                           |       3       | Ulga na start, Preferencyjny ZUS, Mały ZUS Plus i Duży ZUS; składka zdrowotna na skali (9%), liniowym (4,9%) i ryczałcie; terminy ZUS DRA (15. / 20. dzień), roczne rozliczenie i wakacje składkowe RWS.                                                      |
| **9**  | **Kalendarz podatkowy, JPK, Biała Lista i e-Doręczenia** (`kalendarz-podatkowy-jpk-biala-lista-i-e-doreczenia`) |       3       | Terminy miesięczne/roczne i przesunięcia (art. 12 § 5 OP, wolna Wigilia 24.12); `JPK_V7M(3)` z numerami KSeF / `OFF` / `BFK` / `DI`, kody GTU oraz JPK dochodowe (`JPK_PKPIR`, `JPK_EWP`, `JPK_KR_PD`); Biała Lista KAS, ZAW-NR (7 dni) i e-Doręczenia (ADE). |
| **10** | **Rozrachunki, ulga na złe długi, wyciągi bankowe i płynność** (`rozrachunki-zatory-platnicze-bank-i-plynnosc`) |       3       | Należności, zobowiązania i wiekowanie (aging); ulga na złe długi po 90 dniach w VAT (`art. 89a/89b`) oraz PIT/CIT (`art. 26i PIT` / `art. 18f CIT`); import wyciągów CSV/MT940, subkonto VAT (MPP) i rezerwa podatkowa.                                       |
| **11** | **Automatyzacja i bezpieczne użycie AI oraz MCP** (`automatyzacja-ai-ocr-i-bezpieczny-mcp`)                     |       3       | OCR/AI wyłącznie jako propozycja szkicu i dlaczego LLM nigdy nie liczy podatków; zdalny serwer MCP (Streamable HTTP + OIDC, izolacja tenantów, `prepare_*` / `confirm_*`); obrona przed _indirect prompt injection_ i ochrona sekretów KSeF.                  |
| **12** | **Praktyczny samouczek w aplikacji krok po kroku** (`praktyczny-samouczek-krok-po-kroku-w-aplikacji`)           |       4       | Krok 1: Konfiguracja profilu 2026 i ikony `?`; Krok 2: Faktura sprzedaży FA(3) i weryfikacja kosztu w _split-view_; Krok 3: KPiR, rejestry VAT, walidator `JPK_V7M(3)` i szuflada `§ Dlaczego?`; Krok 4: Kalendarz, alerty e-mail i praca przez MCP.          |

---

## 3. Macierz profili odbiorców (`TaxProfileCode`)

Każda lekcja oraz wpis `fieldHelpId` posiada jawne oznaczenie `audienceScope` (`general_education` vs `profile_specific`), które pozwala filtrować ścieżkę nauki w UI za pomocą `listAcademyLessonsForProfile(profile)`:

| Kod profilu (`TaxProfileCode`)      | Opis profilu odbiorcy                                                        | Kluczowe moduły kierunkowe |
| :---------------------------------- | :--------------------------------------------------------------------------- | :------------------------- |
| `jdg_kpir_skala`                    | JDG prowadząca PKPiR na skali podatkowej (12% / 32%, kwota wolna 30 000 PLN) | Moduły 1–5, 8–12           |
| `jdg_kpir_liniowy`                  | JDG prowadząca PKPiR na podatku liniowym 19%                                 | Moduły 1–5, 8–12           |
| `jdg_ryczalt`                       | JDG opodatkowana ryczałtem od przychodów ewidencjonowanych                   | Moduły 1–4, 6, 8–12        |
| `spolka_cywilna_kpir`               | Wspólnicy spółki cywilnej prowadzącej PKPiR                                  | Moduły 1–5, 8–12           |
| `sp_zoo_pelne_ksiegi_cit_klasyczny` | Spółka z o.o. na księgach rachunkowych (CIT 9% / 19%)                        | Moduły 1–4, 7, 9–12        |
| `sp_zoo_pelne_ksiegi_cit_estonski`  | Spółka z o.o. na księgach rachunkowych (Ryczałt od dochodów spółek)          | Moduły 1–2, 4, 7, 9–12     |
| `vat_czynny`                        | Czynny podatnik VAT składający JPK_V7M / JPK_V7K                             | Moduły 3–5, 9–10, 12       |
| `vat_zwolniony_art113`              | Podatnik zwolniony podmiotowo z VAT (limit 240 000 PLN od 2026 r.)           | Moduły 3–4, 9, 12          |

---

## 4. Rejestr pomocy kontekstowej w formularzach (`fieldHelpId`)

Poniższe identyfikatory są eksportowane w `ACADEMY_FIELD_HELP_ENTRIES` oraz rozwiązywane funkcją `resolveFieldHelpWithLesson(fieldHelpId)` do bezpośredniego użycia z `FieldHelpButton` (`@pap/ui`):

- `nip` — NIP kontrahenta / podatnika (walidacja wagowa, zakaz not korygujących od 02.2026)
- `ksef_reference` — Numer identyfikujący e-fakturę w KSeF oraz znaczniki `OFF` / `BFK` / `DI`
- `gtu_code` — Kody grup towarowo-usługowych `GTU_01`–`GTU_13` w JPK_V7
- `kpir_col_7` — Przychód ze sprzedaży w PKPiR (kol. 9 w układzie 19-kolumnowym od 2026 r. / dawna kol. 7)
- `kpir_col_13` — Pozostałe wydatki KUP w PKPiR (kol. 15 w układzie 19-kolumnowym od 2026 r. / dawna kol. 13)
- `vehicle_75_kup` — Limit 75% KUP eksploatacji samochodu osobowego w użytku mieszanym
- `vat_50_vehicle` — Limit 50% odliczenia VAT od wydatków samochodowych
- `ryczalt_rate` — Stawka ryczałtu wg PKWiU (art. 12 ustawy o ryczałcie)
- `wn_ma_balance` — Zasada równowagi podwójnego zapisu `Winien = Ma` w pełnych księgach
- `split_payment_mpp` — Mechanizm podzielonej płatności powyżej 15 000 PLN brutto (załącznik nr 15)
- `jpk_v7m` — Miesięczny plik ewidencyjno-deklaracyjny `JPK_V7M(3)`
- `white_list_iban` — Weryfikacja rachunku rozliczeniowego na Białej Liście KAS i ZAW-NR

---

## 5. Instrukcja użycia w kodzie UI, MCP i testach

### Pobieranie lekcji, pomocy kontekstowej i ocenianie quizu (`@pap/domain/academy`)

```ts
import {
  ACADEMY_COURSE,
  evaluateQuizByLessonSlug,
  getAcademyLessonBySlug,
  listAcademyLessonsForProfile,
  resolveFieldHelpWithLesson,
} from '@pap/domain/academy';

// 1. Pobierz lekcję po slug do widoku Akademii
const lesson = getAcademyLessonBySlug('ulga-na-zle-dlugi-90-dni-vat-pit-cit');

// 2. Rozwiąż pomoc kontekstową dla komponentu FieldHelpButton (@pap/ui)
const help = resolveFieldHelpWithLesson('vehicle_75_kup');

// 3. Oceń odpowiedzi użytkownika deterministycznym silnikiem quizów
const result = evaluateQuizByLessonSlug({
  lessonSlug: 'ulga-na-zle-dlugi-90-dni-vat-pit-cit',
  answers: {
    'q-10-02-01': 1,
    'q-10-02-02': 2,
  },
});
```

### Walidacja kontraktowa i testy jednostkowe

```powershell
pnpm-native.exe --filter @pap/contracts test
pnpm-native.exe --filter @pap/domain test
```
