import type { FieldHelpEntry } from './quiz.js';

export const ACADEMY_FIELD_HELP_ENTRIES: readonly FieldHelpEntry[] = [
  {
    fieldHelpId: 'nip',
    label: 'NIP kontrahenta / podatnika',
    shortHint:
      'Dziesięciocyfrowy Numer Identyfikacji Podatkowej służący do identyfikacji firmy w KSeF, JPK oraz na Białej Liście VAT.',
    detailedExplanation:
      'NIP składa się z 10 cyfr (ostatnia jest cyfrą kontrolną obliczaną z wag 6, 5, 7, 2, 3, 4, 5, 6, 7). W obrocie krajowym B2B wpisuj wyłącznie cyfry bez kresek; dla transakcji wewnątrzwspólnotowych VAT-UE poprzedza się go prefiksem kraju (np. PL).',
    exampleValue: '5250001003',
    warningNote:
      'Od lutego 2026 r. błędnego NIP na fakturze nie poprawisz już notą korygującą — wymagana jest faktura korygująca od sprzedawcy.',
    audienceScope: {
      type: 'general_education',
      applicableProfiles: [
        'jdg_kpir_skala',
        'jdg_kpir_liniowy',
        'jdg_ryczalt',
        'spolka_cywilna_kpir',
        'sp_zoo_pelne_ksiegi_cit_klasyczny',
        'sp_zoo_pelne_ksiegi_cit_estonski',
      ],
      scopeNote: 'Dotyczy wszystkich przedsiębiorców posługujących się NIP w obrocie gospodarczym.',
    },
    legalBasis: {
      actTitle:
        'Ustawa z dnia 13 października 1995 r. o zasadach ewidencji i identyfikacji podatników i płatników',
      articleRef: 'art. 2 oraz art. 11',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19951420702',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Ustanawia obowiązek posługiwania się identyfikatorem podatkowym NIP na dokumentach związanych z obowiązkami podatkowymi.',
    },
    relatedLessonSlug: 'elementy-obowiazkowe-faktury-i-faktury-zaliczkowe',
  },
  {
    fieldHelpId: 'ksef_reference',
    label: 'Numer identyfikujący fakturę w KSeF',
    shortHint:
      'Unikalny urzędowy identyfikator nadawany e-fakturze ustrukturyzowanej FA(3) w chwili jej przyjęcia przez Krajowy System e-Faktur.',
    detailedExplanation:
      'Numer KSeF potwierdza autentyczność i datę wystawienia faktury ustrukturyzowanej. Jest wymagany na fakturach korygujących odnoszących się do e-faktur, w ewidencji JPK_V7M/V7K oraz w tytułach przelewów za e-faktury między podatnikami VAT.',
    exampleValue: '5250001003-20260415-A1B2C3-D4E5F6-78',
    warningNote:
      'Gdy dokument na dzień wysyłki JPK_V7 nie posiada numeru KSeF, w ewidencji stosuje się właściwy znacznik: OFF, BFK lub DI.',
    audienceScope: {
      type: 'general_education',
      applicableProfiles: [
        'jdg_kpir_skala',
        'jdg_kpir_liniowy',
        'jdg_ryczalt',
        'spolka_cywilna_kpir',
        'sp_zoo_pelne_ksiegi_cit_klasyczny',
        'sp_zoo_pelne_ksiegi_cit_estonski',
      ],
      scopeNote:
        'Dotyczy wystawiania i odbierania faktur ustrukturyzowanych wg harmonogramu KSeF 2026.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 106nd ust. 2 pkt 8 oraz art. 106ga',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Określa nadawanie numeru identyfikującego fakturę w KSeF oraz obowiązek korzystania z systemu.',
    },
    relatedLessonSlug: 'ksef-2-0-harmonogram-2026-fa3-offline24-archiwizacja',
  },
  {
    fieldHelpId: 'gtu_code',
    label: 'Kod grupy towarowo-usługowej (GTU_01–GTU_13)',
    shortHint:
      'Oznaczenie wrażliwych towarów lub usług (np. GTU_06 elektronika, GTU_12 usługi niematerialne) wykazywane po stronie sprzedaży w JPK_V7.',
    detailedExplanation:
      'Kody GTU od GTU_01 do GTU_13 służą administracji skarbowej do analizy JPK_V7M/V7K. Przypisuje je wyłącznie sprzedawca będący czynnym podatnikiem VAT w części ewidencyjnej JPK — nie są elementem obowiązkowym na wizualizacji faktury dla klienta i nie dotyczą faktur wewnętrznych z oznaczeniem WEW.',
    exampleValue: 'GTU_12',
    warningNote:
      'Błędne pominięcie wymaganego kodu GTU w części ewidencyjnej JPK_V7 wymaga złożenia korekty ewidencji.',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['vat_czynny'],
      scopeNote:
        'Dotyczy wyłącznie czynnych podatników VAT składających pliki JPK_V7M lub JPK_V7K.',
    },
    legalBasis: {
      actTitle: 'Portal Podatkowy Ministerstwa Finansów — Struktury JPK_VAT z deklaracją',
      articleRef: '§ 10 ust. 3 rozporządzenia w sprawie szczegółowego zakresu danych w JPK_VAT',
      sourceKind: 'official_guidance',
      officialUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Definiuje zamknięty katalog oznaczeń GTU_01–GTU_13 w ewidencji sprzedaży VAT.',
    },
    relatedLessonSlug: 'jpk-v7m-v7k-oznaczenia-ksef-oraz-nowe-jpk-dochodowe',
  },
  {
    fieldHelpId: 'kpir_col_7',
    label: 'Przychód ze sprzedaży w PKPiR (kol. 9 od 2026 r. / dawna kol. 7)',
    shortHint:
      'Podstawowa kolumna przychodowa PKPiR (kol. 9 w układzie 19-kolumnowym od 2026 r., kol. 7 do 2025 r.) na sprzedaż towarów i usług.',
    detailedExplanation:
      'Wpisuje się tu przychody ze sprzedaży wyrobów, towarów handlowych i usług (netto u czynnego podatnika VAT, brutto u zwolnionego). Po reformie PKPiR od 01.01.2026 r. (Dz.U. 2025 poz. 1299 — dodanie kol. 3 na Nr KSeF i kol. 5 na NIP) dawna kolumna 7 nosi numer 9, pozostałe przychody to kolumna 10 (dawna 8), a suma przychodów to kolumna 11 (dawna 9).',
    exampleValue: '12 000,00 PLN',
    warningNote:
      'Otrzymana zaliczka (przedpłata) przed wykonaniem usługi nie stanowi przychodu w PKPiR, choć rodzi obowiązek w VAT.',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['jdg_kpir_skala', 'jdg_kpir_liniowy', 'spolka_cywilna_kpir'],
      scopeNote:
        'Dotyczy wyłącznie podatników prowadzących Podatkową Księgę Przychodów i Rozchodów.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      articleRef: 'art. 14 ust. 1 i 1c oraz Dz.U. 2025 poz. 1299 (wzór PKPiR od 2026 r.)',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Określa moment powstania przychodu należnego z działalności gospodarczej ujmowanego w PKPiR.',
    },
    relatedLessonSlug: 'zasady-prowadzenia-pkpir-i-uklad-kolumn',
  },
  {
    fieldHelpId: 'kpir_col_13',
    label: 'Pozostałe wydatki KUP w PKPiR (kol. 15 od 2026 r. / dawna kol. 13)',
    shortHint:
      'Kolumna kosztów bieżącego funkcjonowania firmy (kol. 15 w układzie 19-kolumnowym od 2026 r., kol. 13 do 2025 r.: czynsz, licencje, 75% auta).',
    detailedExplanation:
      'Ujmuje koszty uzyskania przychodów inne niż zakup towarów handlowych (kol. 12 od 2026 r. / dawna 10), koszty uboczne zakupu (kol. 13 / dawna 11) oraz wynagrodzenia (kol. 14 / dawna 12). W 19-kolumnowym wzorze obowiązującym od 01.01.2026 r. (Dz.U. 2025 poz. 1299) pozostałe wydatki wpisuje się w kolumnie 15 (dawna kolumna 13).',
    exampleValue: '1 505,25 PLN',
    warningNote:
      'Nie wpisuj tu wydatków na reprezentację (np. kolacji z klientem) ani kar i odsetek budżetowych — są to NKUP.',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['jdg_kpir_skala', 'jdg_kpir_liniowy', 'spolka_cywilna_kpir'],
      scopeNote:
        'Dotyczy wyłącznie podatników prowadzących Podatkową Księgę Przychodów i Rozchodów.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      articleRef: 'art. 22 ust. 1 oraz art. 23 ust. 1',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Definiuje warunki zaliczenia wydatku do kosztów uzyskania przychodów oraz katalog wyłączeń NKUP.',
    },
    relatedLessonSlug: 'ksiegowanie-sprzedazy-towarow-wydatkow-i-samochodu-w-kpir',
  },
  {
    fieldHelpId: 'vehicle_75_kup',
    label: 'Limit 75% KUP eksploatacji samochodu osobowego',
    shortHint:
      'Dla samochodu osobowego używanego mieszanie (firmowo i prywatnie) kosztem podatkowym jest 75% kwoty netto powiększonej o nieodliczony VAT.',
    detailedExplanation:
      'Jeżeli dla samochodu osobowego w firmie nie prowadzisz szczegółowej kilometrówki dla celów VAT (VAT-26), wydatki eksploatacyjne takie jak paliwo, serwis, opony i myjnia zaliczasz do KUP w wysokości 75%. Podstawą wyliczenia 75% jest kwota netto + nieodliczone 50% podatku VAT.',
    exampleValue: '75% × (netto + 50% VAT)',
    warningNote:
      'Dobrowolne ubezpieczenia liczone od wartości auta (AC, GAP) podlegają odrębnemu limitowi 150 000 PLN (art. 23 ust. 1 pkt 47 PIT), natomiast obowiązkowe OC stanowi KUP w 100% bez limitu wartości pojazdu.',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: [
        'jdg_kpir_skala',
        'jdg_kpir_liniowy',
        'spolka_cywilna_kpir',
        'sp_zoo_pelne_ksiegi_cit_klasyczny',
      ],
      scopeNote:
        'Dotyczy podatników rozliczających koszty podatkowe w PIT i CIT klasycznym (nie dotyczy ryczałtu).',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
      articleRef: 'art. 23 ust. 1 pkt 46a (oraz art. 16 ust. 1 pkt 51 CIT)',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Wyłącza z kosztów uzyskania przychodów 25% wydatków eksploatacyjnych samochodu osobowego o użytku mieszanym.',
    },
    relatedLessonSlug: 'ksiegowanie-sprzedazy-towarow-wydatkow-i-samochodu-w-kpir',
  },
  {
    fieldHelpId: 'vat_50_vehicle',
    label: 'Odliczenie 50% VAT od wydatków na pojazdy samochodowe',
    shortHint:
      'Domyślne 50% odliczenia podatku VAT od zakupu, leasingu, paliwa i napraw samochodu osobowego bez ewidencji przebiegu VAT-26.',
    detailedExplanation:
      'Czynny podatnik VAT odlicza 50% kwoty podatku naliczonego z faktur dotyczących pojazdów samochodowych o DMC do 3,5 tony wykorzystywanych w trybie mieszanym. Pełne 100% VAT wymaga wyłącznego użytku służbowego, regulaminu, zgłoszenia VAT-26 i bieżącej ewidencji przebiegu pojazdu.',
    exampleValue: '50% kwoty VAT z faktury',
    warningNote:
      'Nieodliczona połowa VAT nie przepada całkowicie — u podatników KPiR/CIT wchodzi do podstawy wyliczenia kosztu podatkowego (np. 75% KUP).',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['vat_czynny'],
      scopeNote: 'Dotyczy wyłącznie czynnych podatników podatku od towarów i usług.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 86a ust. 1–4',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Ustanawia 50% limit odliczenia podatku naliczonego dla pojazdów samochodowych oraz warunki pełnego odliczenia 100%.',
    },
    relatedLessonSlug: 'ksiegowanie-sprzedazy-towarow-wydatkow-i-samochodu-w-kpir',
  },
  {
    fieldHelpId: 'ryczalt_rate',
    label: 'Stawka ryczałtu od przychodów ewidencjonowanych',
    shortHint:
      'Procentowa stawka podatku od przychodu (np. 17%, 15%, 14%, 12%, 8,5%, 5,5%, 3%) zależna od rzeczywistego rodzaju świadczonych usług wg PKWiU.',
    detailedExplanation:
      'Na ryczałcie podatek płaci się od przychodu (bez pomniejszania o koszty zakupów), a właściwą stawkę przypisuje się do każdej pozycji sprzedaży na podstawie klasyfikacji PKWiU i art. 12 ustawy o ryczałcie (np. 12% dla programowania, 14% dla projektowania architektonicznego, 8,5% dla wielu usług ogólnych, 3% dla handlu).',
    exampleValue: '12%',
    warningNote:
      'O stawce ryczałtu decyduje faktyczny przedmiot usługi wg PKWiU, a nie sam kod PKD wpisany w CEIDG!',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['jdg_ryczalt'],
      scopeNote:
        'Dotyczy podatników opodatkowanych ryczałtem od przychodów ewidencjonowanych; w razie wątpliwości wystąp o WIS/interpretację.',
    },
    legalBasis: {
      actTitle:
        'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
      articleRef: 'art. 12 ust. 1',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981440930',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Określa katalog stawek ryczałtu przypisanych do poszczególnych rodzajów działalności i symboli PKWiU.',
    },
    relatedLessonSlug: 'zasady-ewidencji-przychodow-i-stawki-ryczaltu',
  },
  {
    fieldHelpId: 'wn_ma_balance',
    label: 'Równowaga podwójnego zapisu Winien (Wn) = Ma',
    shortHint:
      'Fundamentalna zasada pełnych ksiąg rachunkowych: w każdym dekrecie suma kwot po stronie Winien (Debet) musi równać się sumie po stronie Ma (Kredyt).',
    detailedExplanation:
      'W księgach rachunkowych prowadzonych wg Ustawy o rachunkowości każda operacja gospodarcza jest ujmowana co najmniej na dwóch kontach po przeciwnych stronach (Wn i Ma) w identycznej łącznej kwocie co do grosza. System transakcyjnie blokuje zatwierdzenie niezbilansowanego dekretu.',
    exampleValue: 'Wn: 12 300,00 PLN = Ma: 12 300,00 PLN',
    warningNote:
      'Zatwierdzonego dekretu w zamkniętym okresie nie wolno kasować — korekty wykonuje się wyłącznie dowodem korygującym (storno).',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['sp_zoo_pelne_ksiegi_cit_klasyczny', 'sp_zoo_pelne_ksiegi_cit_estonski'],
      scopeNote:
        'Dotyczy jednostek prowadzących pełne księgi rachunkowe na podstawie Ustawy o rachunkowości.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 29 września 1994 r. o rachunkowości',
      articleRef: 'art. 15 ust. 1 oraz art. 25 ust. 2',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Nakazuje dokonywanie zapisów na kontach księgi głównej zgodnie z zasadą podwójnego zapisu oraz określa zasady poprawiania błędów przez storno.',
    },
    relatedLessonSlug: 'plan-kont-zespoly-0-8-i-zasada-podwojnego-zapisu',
  },
  {
    fieldHelpId: 'split_payment_mpp',
    label: 'Mechanizm podzielonej płatności (MPP / Split Payment)',
    shortHint:
      'Przelew dzielony przez bank na kwotę netto trafiającą na rachunek bieżący dostawcy oraz kwotę VAT trafiającą na jego wydzielony rachunek VAT.',
    detailedExplanation:
      'Mechanizm podzielonej płatności jest obowiązkowy, gdy łącznie spełnione są trzy warunki: transakcja odbywa się między podatnikami B2B, kwota należności ogółem na fakturze przekracza 15 000,00 PLN brutto oraz co najmniej jedna pozycja należy do załącznika nr 15 do ustawy o VAT (np. elektronika, roboty budowlane, części samochodowe).',
    exampleValue: 'Adnotacja: „mechanizm podzielonej płatności”',
    warningNote:
      'Pominięcie obowiązkowego MPP przy fakturze > 15 000 PLN z załącznika nr 15 grozi sankcją VAT oraz utratą kosztu podatkowego (NKUP).',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['vat_czynny', 'vat_zwolniony_art113'],
      scopeNote:
        'Obowiązek zapłaty w MPP może dotyczyć także nabywcy zwolnionego z VAT otrzymującego fakturę z załącznika nr 15 powyżej 15 000 PLN brutto.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 106e ust. 1 pkt 18a oraz art. 108a ust. 1a',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Określa próg powyżej 15 000 PLN brutto i katalog załącznika nr 15 objęty obowiązkowym mechanizmem podzielonej płatności.',
    },
    relatedLessonSlug: 'zwolnienie-z-vat-limit-240000-metoda-kasowa-i-mpp',
  },
  {
    fieldHelpId: 'jpk_v7m',
    label: 'Jednolity Plik Kontrolny JPK_V7M(3)',
    shortHint:
      'Miesięczny plik XML łączący ewidencję sprzedaży i zakupów VAT z deklaracją podatkową, składany elektronicznie do 25. dnia kolejnego miesiąca.',
    detailedExplanation:
      'Struktura JPK_V7M(3) obowiązująca od rozliczeń za luty 2026 r. zawiera szczegółowe wiersze dokumentów (z numerami KSeF lub znacznikami OFF, BFK, DI oraz kodami GTU i procedurami) oraz część deklaracyjną wyliczającą podatek do wpłaty na mikrorachunek podatkowy lub do zwrotu.',
    exampleValue: 'JPK_V7M(3) za 2026-06',
    warningNote:
      'Czynny podatnik VAT musi wysłać JPK_V7M także za tzw. „zerowy miesiąc”, w którym nie wystawił ani nie otrzymał żadnej faktury.',
    audienceScope: {
      type: 'profile_specific',
      applicableProfiles: ['vat_czynny'],
      scopeNote:
        'Dotyczy czynnych podatników VAT rozliczających się miesięcznie (podatnicy kwartalni składają JPK_V7K).',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 99 ust. 1 i 11c oraz art. 109 ust. 3b',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Nakłada obowiązek przesyłania łącznego pliku ewidencyjno-deklaracyjnego JPK_VAT do 25. dnia miesiąca następującego po okresie rozliczeniowym.',
    },
    relatedLessonSlug: 'jpk-v7m-v7k-oznaczenia-ksef-oraz-nowe-jpk-dochodowe',
  },
  {
    fieldHelpId: 'white_list_iban',
    label: 'Rachunek rozliczeniowy na Białej Liście podatników VAT',
    shortHint:
      'Firmowy numer rachunku IBAN zgłoszony do urzędu skarbowego i widoczny w Wykazie podatników VAT Ministerstwa Finansów (KAS).',
    detailedExplanation:
      'Przy płatnościach B2B na rzecz czynnego podatnika VAT przekraczających jednorazowo 15 000,00 PLN brutto przelew musi trafić na rachunek widniejący w dniu zlecenia przelewu na Białej Liście. Zapisanie identyfikatora zapytania KAS stanowi urzędowy dowód dochowania należytej staranności.',
    exampleValue: 'PL61109010140000071219812874',
    warningNote:
      'W razie omyłkowego przelewu powyżej 15 000 PLN poza Białą Listę masz 7 dni na złożenie zawiadomienia ZAW-NR (albo zapłać w MPP).',
    audienceScope: {
      type: 'general_education',
      applicableProfiles: [
        'jdg_kpir_skala',
        'jdg_kpir_liniowy',
        'jdg_ryczalt',
        'spolka_cywilna_kpir',
        'sp_zoo_pelne_ksiegi_cit_klasyczny',
        'sp_zoo_pelne_ksiegi_cit_estonski',
      ],
      scopeNote:
        'Dotyczy wszystkich przedsiębiorców opłacających faktury B2B od czynnych podatników VAT powyżej 15 000 PLN brutto.',
    },
    legalBasis: {
      actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
      articleRef: 'art. 96b (oraz art. 22p PIT / art. 15d CIT)',
      sourceKind: 'statute',
      officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
      verifiedAt: '2026-11-04',
      appliesSummary:
        'Reguluje Wykaz podatników VAT (Białą Listę) oraz sankcje podatkowe za zapłatę powyżej 15 000 PLN na rachunek spoza wykazu.',
    },
    relatedLessonSlug: 'biala-lista-podatnikow-vat-sankcje-zaw-nr-i-e-doreczenia',
  },
];
