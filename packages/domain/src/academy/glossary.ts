import { ACADEMY_FIELD_HELP_ENTRIES } from './field-help.js';
import type { FieldHelpEntry, GlossaryCategory, GlossaryTerm } from './quiz.js';

export { ACADEMY_FIELD_HELP_ENTRIES };

export const ACADEMY_GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  {
    id: 'przychod-nalezny',
    term: 'Przychód należny',
    shortDefinition:
      'Wartość sprzedanych towarów lub wykonanych usług powstająca w podatku dochodowym nawet wtedy, gdy klient jeszcze nie zapłacił faktury.',
    detailedExplanation:
      'W działalności gospodarczej (PIT i CIT) przychód powstaje co do zasady w dniu wydania rzeczy, zbycia prawa majątkowego lub wykonania usługi (nie później niż w dniu wystawienia faktury albo uregulowania należności). U czynnego podatnika VAT przychodem jest kwota netto.',
    exampleInPractice:
      'Wykonanie projektu 28 marca z terminem płatności 14 kwietnia tworzy przychód podatkowy już w marcu.',
    category: 'podstawy',
    relatedLessonSlugs: ['po-co-prowadzi-sie-ksiegowosc-przychod-dochod-przeplyw'],
  },
  {
    id: 'koszty-uzyskania-przychodow-kup',
    term: 'Koszty uzyskania przychodów (KUP)',
    shortDefinition:
      'Wydatki poniesione w celu osiągnięcia przychodów lub zachowania albo zabezpieczenia źródła przychodów, niewyłączone ustawowo (art. 23 PIT / art. 16 CIT).',
    detailedExplanation:
      'Aby wydatek pomniejszył podstawę opodatkowania w skali, podatku liniowym lub CIT klasycznym, musi być definitywny, właściwie udokumentowany, powiązany z działalnością firmy i nie znajdować się w katalogu wydatków NKUP (takich jak reprezentacja czy kary urzędowe).',
    exampleInPractice:
      'Zakup licencji programu projektowego za 1 000,00 PLN netto obniża dochód do opodatkowania o 1 000,00 PLN.',
    category: 'podstawy',
    relatedLessonSlugs: ['koszty-uzyskania-przychodu-kup-vs-nkup'],
  },
  {
    id: 'estonski-cit',
    term: 'Ryczałt od dochodów spółek (Estoński CIT)',
    shortDefinition:
      'Model opodatkowania spółek kapitałowych, w którym podatek dochodowy pojawia się dopiero w momencie dystrybucji zysku (np. wypłaty dywidendy) lub ukrytych zysków.',
    detailedExplanation:
      'Dopóki spółka spełniająca warunki ustawowe (m.in. określony poziom zatrudnienia, prosta struktura udziałowców — osób fizycznych i brak przychodów pasywnych powyżej limitu) zatrzymuje i reinwestuje zysk w firmie, nie płaci miesięcznych zaliczek CIT.',
    exampleInPractice:
      'Spółka z o.o. wypracowuje 200 000,00 PLN zysku i przeznacza całość na zakup maszyn — bieżący CIT wynosi 0,00 PLN.',
    category: 'podatki_dochodowe',
    relatedLessonSlugs: ['opodatkowanie-spolek-cit-klasyczny-i-estonski'],
  },
  {
    id: 'mikrorachunek-podatkowy-irp',
    term: 'Indywidualny rachunek podatkowy (mikrorachunek IRP)',
    shortDefinition:
      'Stały, indywidualny numer rachunku bankowego podatnika w formacie IBAN zawierający jego NIP lub PESEL, służący do wpłat PIT, CIT i VAT.',
    detailedExplanation:
      'Na jeden mikrorachunek podatkowy wygenerowany dla danego identyfikatora podatkowego (w firmach zawsze z użyciem NIP) przedsiębiorca wpłaca zarówno zaliczki na podatek dochodowy PIT/CIT/ryczałt, jak i podatek VAT z deklaracji JPK_V7.',
    exampleInPractice:
      'Jan Testowy przelewa zaliczkę PIT-36L do 20. dnia miesiąca oraz VAT do 25. dnia miesiąca na ten sam mikrorachunek IRP.',
    category: 'podatki_dochodowe',
    relatedLessonSlugs: [
      'mechanizm-zaliczek-pit-i-cit-w-trakcie-roku',
      'kalendarz-podatkowy-i-zasada-przesuwania-terminow',
    ],
  },
  {
    id: 'krajowy-system-e-faktur-ksef',
    term: 'Krajowy System e-Faktur (KSeF)',
    shortDefinition:
      'Centralna platforma teleinformatyczna Ministerstwa Finansów do wystawiania, odbierania i 10-letniego przechowywania faktur ustrukturyzowanych XML FA(3).',
    detailedExplanation:
      'W KSeF faktura ustrukturyzowana staje się prawnie wystawiona i doręczona odbiorcy B2B z chwilą przydzielenia jej unikalnego numeru KSeF. Obowiązek wystawiania wchodzi etapowo od 1 lutego 2026 r. i 1 kwietnia 2026 r. (z progiem przejściowym 10 000 PLN miesięcznie do końca 2026 r.).',
    exampleInPractice:
      'Sprzedawca wysyła plik XML zgodny ze schemą FA(3) i po sekundzie otrzymuje UPO oraz numer KSeF widoczny u nabywcy.',
    category: 'vat_i_ksef',
    relatedLessonSlugs: ['ksef-2-0-harmonogram-2026-fa3-offline24-archiwizacja'],
  },
  {
    id: 'mechanizm-podzielonej-platnosci-mpp',
    term: 'Mechanizm podzielonej płatności (MPP / Split Payment)',
    shortDefinition:
      'Szczególny tryb przelewu bankowego rozdzielający automatycznie kwotę netto na rachunek rozliczeniowy sprzedawcy i kwotę VAT na jego rachunek VAT.',
    detailedExplanation:
      'Obowiązkowy przy fakturach B2B przekraczających 15 000,00 PLN brutto obejmujących towary lub usługi z załącznika nr 15 do ustawy o VAT, a dobrowolnie dostępny dla każdej faktury z wykazaną kwotą podatku VAT.',
    exampleInPractice:
      'Opłacając fakturę za sprzęt komputerowy na 18 450,00 PLN brutto w MPP, bank przekazuje 3 450,00 PLN na subkonto VAT dostawcy.',
    category: 'vat_i_ksef',
    relatedLessonSlugs: [
      'zwolnienie-z-vat-limit-240000-metoda-kasowa-i-mpp',
      'uzgadnianie-wyciagow-bankowych-csv-mt940-i-rezerwa-podatkowa',
    ],
  },
  {
    id: 'podatkowa-ksiega-przychodow-i-rozchodow-pkpir',
    term: 'Podatkowa Księga Przychodów i Rozchodów (PKPiR)',
    shortDefinition:
      'Uproszczona ewidencja podatkowa (19 kolumn od 2026 r. wg Dz.U. 2025 poz. 1299; 17 kolumn do końca 2025 r.) do ustalania dochodu na skali lub liniowym.',
    detailedExplanation:
      'Od 1 stycznia 2026 r. wzór PKPiR liczy 19 kolumn: dodano kolumnę 3 na numer KSeF oraz kolumnę 5 na NIP kontrahenta, przesuwając przychody do kolumn 9–11 (dawne 7–9), zakupy towarów i koszty uboczne do kolumn 12–13 (dawne 10–11), a wynagrodzenia i pozostałe wydatki do kolumn 14–16 (dawne 12–14).',
    exampleInPractice:
      'Faktura za biuro rachunkowe na 400,00 PLN netto w 2026 r. trafia w dacie wystawienia do kolumny 15 PKPiR (dawnej kolumny 13).',
    category: 'ewidencje_i_ksiegi',
    relatedLessonSlugs: ['zasady-prowadzenia-pkpir-i-uklad-kolumn'],
  },
  {
    id: 'podwojny-zapis-wn-ma',
    term: 'Zasada podwójnego zapisu (Winien = Ma)',
    shortDefinition:
      'Reguła pełnej księgowości wymagająca ujęcia każdej operacji gospodarczej na co najmniej dwóch kontach po przeciwnych stronach w równej kwocie.',
    detailedExplanation:
      'Dzięki zasadzie Winien (Debet) = Ma (Kredyt) księgi rachunkowe zachowują pełną samokontrolę bilansową (Aktywa = Pasywa), pokazując nie tylko przychody i koszty, ale też każdy ruch gotówki, należności, zobowiązań i kapitałów.',
    exampleInPractice:
      'Zapłata zobowiązania przelewem: Wn konto 210 „Rozrachunki z dostawcami” 1 230,00 PLN / Ma konto 130 „Rachunek bieżący” 1 230,00 PLN.',
    category: 'ewidencje_i_ksiegi',
    relatedLessonSlugs: [
      'plan-kont-zespoly-0-8-i-zasada-podwojnego-zapisu',
      'dekretacja-faktur-i-wyciagu-bankowego-w-ksiegach',
    ],
  },
  {
    id: 'skladka-zdrowotna-przedsiebiorcy',
    term: 'Składka na ubezpieczenie zdrowotne przedsiębiorcy',
    shortDefinition:
      'Obowiązkowa miesięczna składka do ZUS, której sposób wyliczenia i możliwość odliczenia zależą od wybranej formy opodatkowania (skala, liniowy, ryczałt).',
    detailedExplanation:
      'Na skali podatkowej wynosi 9% dochodu (bez prawa odliczenia), na podatku liniowym 4,9% dochodu (z rocznym limitem odliczenia i progiem składki minimalnej), a na ryczałcie ma trzy zryczałtowane progi przychodowe (do 60 tys., do 300 tys. i powyżej 300 tys. PLN) z odliczeniem 50% zapłaconej składki od przychodu.',
    exampleInPractice:
      'Ryczałtowiec z rocznym przychodem 180 000,00 PLN opłaca środkowy próg składki zdrowotnej i odlicza jej połowę od przychodu.',
    category: 'zus_i_kadry',
    relatedLessonSlugs: ['skladka-zdrowotna-na-skali-liniowym-i-ryczalcie'],
  },
  {
    id: 'wakacje-skladkowe-zus-rws',
    term: 'Wakacje składkowe ZUS (wniosek RWS)',
    shortDefinition:
      'Prawo mikroprzedsiębiorcy do zwolnienia z opłacania własnych składek na ubezpieczenia społeczne ZUS za jeden wybrany miesiąc w roku kalendarzowym.',
    detailedExplanation:
      'Zwolnienie finansowane z budżetu państwa obejmuje składki emerytalną, rentowe, wypadkową (i dobrowolną chorobową) samego przedsiębiorcy, natomiast nie zwalnia z opłacenia składki zdrowotnej ani składek za pracowników. Wniosek RWS składa się przez PUE/eZUS w miesiącu poprzedzającym wybrany miesiąc.',
    exampleInPractice:
      'Złożenie wniosku RWS w listopadzie zwalnia przedsiębiorcę ze składek społecznych za grudzień (płatnych w styczniu).',
    category: 'zus_i_kadry',
    relatedLessonSlugs: ['terminy-zus-dra-roczne-rozliczenie-i-wakacje-skladkowe'],
  },
  {
    id: 'ulga-na-zle-dlugi-90-dni',
    term: 'Ulga na złe długi (90 dni)',
    shortDefinition:
      'Mechanizm korekty VAT (art. 89a/89b) oraz podatku dochodowego PIT/CIT (art. 26i PIT / art. 18f CIT) po 90 dniach braku zapłaty od terminu płatności.',
    detailedExplanation:
      'Chroni wierzyciela (dając mu prawo odzyskania VAT należnego i zmniejszenia dochodu do opodatkowania) oraz dyscyplinuje dłużnika (nakładając na niego bezwzględny obowiązek zwrotu odliczonego VAT naliczonego i doliczenia niezapłaconego kosztu do podstawy opodatkowania).',
    exampleInPractice:
      'Po 90 dniach od terminu płatności faktury na 12 300,00 PLN brutto sprzedawca pomniejsza VAT należny o 2 300,00 PLN w JPK_V7M.',
    category: 'rozrachunki_i_bank',
    relatedLessonSlugs: ['ulga-na-zle-dlugi-90-dni-vat-pit-cit'],
  },
  {
    id: 'biala-lista-podatnikow-vat',
    term: 'Biała Lista podatników VAT (Wykaz KAS)',
    shortDefinition:
      'Publiczny wykaz prowadzony przez Szefa KAS zawierający status VAT podmiotów oraz zgłoszone przez nie firmowe rachunki rozliczeniowe.',
    detailedExplanation:
      'Zapłata faktury B2B od czynnego podatnika VAT o wartości przekraczającej 15 000,00 PLN brutto na rachunek niewidniejący na Białej Liście w dniu zlecenia przelewu skutkuje wyłączeniem wydatku z KUP oraz solidarną odpowiedzialnością za VAT sprzedawcy (chyba że złożono ZAW-NR w 7 dni lub opłacono w MPP).',
    exampleInPractice:
      'Przed zleceniem przelewu 24 600,00 PLN aplikacja weryfikuje IBAN dostawcy w API KAS i archiwizuje identyfikator zapytania.',
    category: 'rozrachunki_i_bank',
    relatedLessonSlugs: [
      'biala-lista-podatnikow-vat-sankcje-zaw-nr-i-e-doreczenia',
      'obrona-przed-prompt-injection-i-ochrona-tajemnicy-skarbowej',
    ],
  },
  {
    id: 'slad-obliczeniowy-calculation-trace',
    term: 'Ślad obliczeniowy (calculation_trace / „§ Dlaczego?”)',
    shortDefinition:
      'Pełny, odtwarzalny zapis kolejnych kroków matematycznych, wersji reguły i artykułu ustawy stojących za każdą kwotą podatku w systemie.',
    detailedExplanation:
      'Zamiast nieprzejrzystego wyniku „z czarnej skrzynki” deterministyczny silnik reguł generuje listę kroków pośrednich, zaokrągleń i zastosowanych limitów obowiązujących na dany dzień, prezentowaną użytkownikowi w szufladzie „§ Dlaczego?”.',
    exampleInPractice:
      'Kliknięcie „§ Dlaczego?” przy zaliczce PIT pokazuje odjęcie kosztów, składek ZUS, stawkę i zaokrąglenie wg art. 63 § 1 OP.',
    category: 'automatyzacja_ai_mcp',
    relatedLessonSlugs: [
      'ocr-i-ai-jako-propozycja-czlowiek-zatwierdza',
      'ksiegowanie-kpir-vat-jpk-v7m-i-szuflada-dlaczego',
    ],
  },
  {
    id: 'wzorzec-prepare-confirm-mcp',
    term: 'Wzorzec prepare_* / confirm_* w MCP',
    shortDefinition:
      'Dwuetapowa bramka bezpieczeństwa wymagająca, aby każda zmiana przygotowana przez agenta AI została sprawdzona i zatwierdzona przez uprawnionego człowieka.',
    detailedExplanation:
      'Wywołanie prepare_* w zdalnym serwerze MCP (Streamable HTTP + OIDC) tworzy wyłącznie zwalidowany szkic opatrzony skrótem kryptograficznym (payload hash) i krótkim czasem ważności (TTL). Dopiero odrębna autoryzacja człowieka w kroku confirm_* wykonuje zapis księgowy.',
    exampleInPractice:
      'Asystent AI przygotowuje szkic faktury przez prepare_invoice_draft, a właściciel zatwierdza go po weryfikacji kwoty i NIP.',
    category: 'automatyzacja_ai_mcp',
    relatedLessonSlugs: [
      'zdalny-serwer-mcp-streamable-http-oidc-prepare-confirm',
      'kalendarz-podatkowy-powiadomienia-email-i-praca-przez-mcp',
    ],
  },
];

const glossaryByIdMap = new Map<string, GlossaryTerm>(
  ACADEMY_GLOSSARY_TERMS.map((term) => [term.id, term]),
);

const fieldHelpByIdMap = new Map<string, FieldHelpEntry>(
  ACADEMY_FIELD_HELP_ENTRIES.map((entry) => [entry.fieldHelpId, entry]),
);

export function getGlossaryTermById(id: string): GlossaryTerm | undefined {
  return glossaryByIdMap.get(id);
}

export function listGlossaryTermsByCategory(category: GlossaryCategory): readonly GlossaryTerm[] {
  return ACADEMY_GLOSSARY_TERMS.filter((term) => term.category === category);
}

export function getFieldHelpById(fieldHelpId: string): FieldHelpEntry | undefined {
  return fieldHelpByIdMap.get(fieldHelpId);
}
