import { createScreenshotSlot, type AcademyModule } from './quiz.js';

export const MODULE_12: AcademyModule = {
  moduleNumber: 12,
  slug: 'praktyczny-samouczek-krok-po-kroku-w-aplikacji',
  title: 'Moduł 12: Praktyczny samouczek w aplikacji krok po kroku na firmie demo',
  subtitle:
    'Przejdź pełny miesięczny cykl pracy na syntetycznej firmie demonstracyjnej: od konfiguracji profilu 2026, przez weryfikację split-view, KPiR/VAT/JPK i szufladę „Dlaczego?”, aż po kalendarz e-mail i MCP.',
  learningObjectives: [
    'Skonfigurować profil podatkowy 2026 (PKPiR/Ryczałt/CIT, VAT czynny lub zwolniony z limitem 240 000 PLN, harmonogram KSeF) przy wsparciu przycisków pomocy „?”.',
    'Przeprowadzić pełny obieg faktury sprzedaży i zakupu z weryfikacją propozycji AI/OCR w widoku dzielonym (split-view).',
    'Sprawdzić wpisy w KPiR, rejestrach VAT i JPK_V7M(3) oraz zweryfikować ślad obliczeniowy w szufladzie „§ Dlaczego?”.',
    'Skonfigurować kalendarz podatkowy i powiadomienia e-mail oraz wykonać bezpieczny odczyt i prepare_* przez zdalny serwer MCP.',
  ],
  lessons: [
    {
      id: 'lesson-12-01',
      slug: 'konfiguracja-profilu-podatkowego-firmy-demo-na-2026-rok',
      moduleNumber: 12,
      lessonNumber: 1,
      title: 'Krok 1: Konfiguracja profilu podatkowego firmy demo i pomoc kontekstowa „?”',
      estimatedMinutes: 12,
      audienceScope: {
        type: 'general_education',
        applicableProfiles: [
          'jdg_kpir_skala',
          'jdg_kpir_liniowy',
          'jdg_ryczalt',
          'spolka_cywilna_kpir',
          'sp_zoo_pelne_ksiegi_cit_klasyczny',
          'sp_zoo_pelne_ksiegi_cit_estonski',
          'vat_czynny',
          'vat_zwolniony_art113',
        ],
        scopeNote:
          'Samouczek produktowy na danych syntetycznych — pokazuje dobór parametrów dla różnych profili podatkowych w stanie prawnym 2025/2026; nie stanowi indywidualnego doradztwa podatkowego.',
      },
      intro:
        'Każda poprawna kalkulacja w systemie zaczyna się od właściwego ustawienia profilu podatkowego firmy na dany rok obrotowy. W pierwszej lekcji samouczka uruchamiamy bezpieczną piaskownicę demonstracyjną i sprawdzamy, jak aplikacja dobiera ewidencje, progi limitów 2026 oraz podpowiedzi kontekstowe przy polach formularza.',
      sections: [
        {
          heading: 'Parametry roku 2026: forma opodatkowania, limit VAT 240 000 PLN i KSeF',
          body: 'W kreatorze Ustawień firmy wybierasz formę prawną i podatkową (np. JDG na KPiR ze skalą 12%/32% lub podatkiem liniowym 19%, ryczałt ewidencjonowany albo spółkę z o.o. na pełnych księgach), okres rozliczeń VAT (miesięczny JPK_V7M lub kwartalny JPK_V7K) oraz wariant składek ZUS. Dla podatników korzystających ze zwolnienia podmiotowego z art. 113 ust. 1 ustawy o VAT aplikacja automatycznie monitoruje podwyższony od 1 stycznia 2026 r. limit 240 000,00 PLN sprzedaży netto (liczony proporcjonalnie przy starcie w trakcie roku). Sekcja KSeF uwzględnia obowiązek wystawiania e-faktur od 1 lutego 2026 r. (najwięksi podatnicy powyżej 200 mln PLN sprzedaży w 2024 r.) oraz od 1 kwietnia 2026 r. (pozostali przedsiębiorcy), z przejściowym progiem 10 000,00 PLN brutto miesięcznie do końca 2026 r.',
          keyPoints: [
            'Od 1 lutego 2026 r. odbiór faktur zakupowych w KSeF dotyczy praktycznie wszystkich firm posiadających NIP, nawet korzystających z progu przejściowego po stronie sprzedaży.',
            'Każda zmiana profilu podatkowego jest wersjonowana datą obowiązywania i nie nadpisuje zamkniętych okresów historycznych.',
          ],
        },
        {
          heading: 'Jak korzystać z pomocy kontekstowej „?” (fieldHelpId) w formularzach',
          body: 'Przy każdym specjalistycznym polu w aplikacji — takim jak NIP, numer referencyjny KSeF, kod GTU, kolumna KPiR czy użytek mieszany pojazdu 50% VAT / 75% KUP — znajduje się dyskretna ikona „?”. Kliknięcie jej otwiera zwięzłą podpowiedź z przykładem wypełnienia, ostrzeżeniem przed typowym błędem oraz bezpośrednim linkiem do właściwej lekcji w Akademii Polskiej Księgowości, bez utraty wpisywanych w formularzu danych.',
          keyPoints: [
            'Klawisz Escape zamyka dymek pomocy kontekstowej, zachowując pełną dostępność klawiaturową (WCAG 2.2 AA).',
            'Każda podpowiedź wyraźnie zaznacza, czy reguła jest ogólna, czy dotyczy wyłącznie wybranego profilu podatkowego.',
          ],
        },
      ],
      numericalExample: {
        title: 'Proporcjonalny limit zwolnienia z VAT przy starcie działalności 1 lipca 2026 r.',
        scenario:
          'Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne) testuje w piaskownicy wariant założenia nowej JDG bez VAT dokładnie 1 lipca 2026 r. (184 dni prowadzenia działalności z 365 dni roku 2026). Jaką maksymalną sprzedaż zwolnioną wylicza pasek limitu w ustawieniach profilu?',
        steps: [
          {
            stepNumber: 1,
            label: 'Roczny limit zwolnienia podmiotowego VAT obowiązujący od 1 stycznia 2026 r.',
            calculation: 'Limit ustawowy z art. 113 ust. 1 ustawy o VAT',
            amountPln: '240 000,00 PLN',
          },
          {
            stepNumber: 2,
            label: 'Wyliczenie proporcji za 184 dni działalności w 2026 r. (art. 113 ust. 9 VAT)',
            calculation: '240 000,00 PLN × (184 / 365)',
            amountPln: '120 986,30 PLN',
          },
          {
            stepNumber: 3,
            label: 'Bezpieczny zapas limitu po wystawieniu pierwszych rachunków na 20 986,30 PLN',
            calculation: '120 986,30 PLN - 20 986,30 PLN',
            amountPln: '100 000,00 PLN',
          },
        ],
        finalResultPln: '100 000,00 PLN',
        interpretation:
          'Kreator profilu automatycznie przelicza limit proporcjonalny do dnia rozpoczęcia sprzedaży (120 986,30 PLN) i ostrzega z wyprzedzeniem przed przekroczeniem progu wymagającym rejestracji VAT-R.',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
          articleRef: 'art. 113 ust. 1 i 9 oraz art. 106ga (KSeF)',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Określa limit zwolnienia podmiotowego 240 000 PLN od 2026 r., zasadę proporcji przy starcie w trakcie roku oraz obowiązek fakturowania w KSeF.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm12-l01-kreator-profilu-firmy-demo-i-field-help',
        '/settings',
        'Konfiguracja profilu podatkowego syntetycznej firmy demonstracyjnej na 2026 r. z otwartym dymkiem pomocy kontekstowej „?”.',
        '[data-testid="demo-company-tax-profile-wizard"]',
      ),
      practicalExercise: {
        title: 'Ustawienie profilu podatkowego 2026 i test przycisku „?”',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'Wybierz na górnym pasku firmę demonstracyjną „Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)” i przejdź do Ustawień podatkowych.',
          'Kliknij ikonę „?” obok pola „Status VAT” oraz „Forma opodatkowania PIT”, aby przeczytać wyjaśnienie kontekstowe.',
          'Zapisz konfigurację na rok 2026: PKPiR, podatek liniowy 19%, czynny podatnik VAT rozliczany miesięcznie (JPK_V7M).',
        ],
        expectedOutcome:
          'Aplikacja aktywuje moduły PKPiR, Rejestry VAT i JPK_V7M(3) dopasowane do wybranego profilu 2026.',
      },
      commonMistakes: [
        {
          mistake: 'Przyjęcie pełnego limitu 240 000 PLN VAT przy otwarciu firmy w połowie roku.',
          consequence: 'Przeoczenie momentu obowiązkowej rejestracji VAT-R i zaległy VAT należny.',
          howToAvoid:
            'Zawsze wpisuj dokładną datę rozpoczęcia sprzedaży w profilu firmy, aby działał licznik proporcjonalny.',
        },
        {
          mistake:
            'Założenie, że próg przejściowy 10 000 PLN w KSeF zwalnia z odbierania e-faktur kosztowych od dostawców.',
          consequence:
            'Nieodebranie faktur za media, paliwo lub telekomunikację wystawionych przez dużych dostawców w KSeF od lutego 2026 r.',
          howToAvoid:
            'Skonfiguruj pobieranie dokumentów zakupowych z KSeF niezależnie od skali własnej sprzedaży.',
        },
        {
          mistake: 'Pomijanie wpisania firmowego rachunku rozliczeniowego do profilu podmiotu.',
          consequence:
            'Brak automatycznej kontroli spójności rachunku z Białą Listą podatników VAT na wystawianych fakturach.',
          howToAvoid: 'Uzupełnij i zweryfikuj firmowy numer IBAN zaraz po założeniu profilu.',
        },
      ],
      summary: [
        'Profil podatkowy 2026 steruje widocznymi ewidencjami, stawkami i limitami ostrzegawczymi w całej aplikacji.',
        'Limit zwolnienia z art. 113 VAT wynosi od 2026 r. 240 000,00 PLN i przy starcie w trakcie roku liczy się proporcjonalnie.',
        'Ikony pomocy kontekstowej „?” łączą każde trudniejsze pole formularza bezpośrednio z wiedzą w Akademii.',
      ],
      quiz: [
        {
          id: 'q-12-01-01',
          question:
            'Ile wynosi roczny limit zwolnienia podmiotowego z VAT (art. 113 ust. 1 ustawy o VAT) obowiązujący od 1 stycznia 2026 r. dla firmy działającej przez cały rok?',
          options: ['150 000,00 PLN', '200 000,00 PLN', '240 000,00 PLN', '300 000,00 PLN'],
          correctOptionIndex: 2,
          explanation:
            'Od 1 stycznia 2026 r. roczny limit wartości sprzedaży uprawniający do zwolnienia podmiotowego z VAT został podwyższony z 200 000 PLN do 240 000 PLN netto.',
        },
        {
          id: 'q-12-01-02',
          question:
            'Do czego służy przycisk „?” (fieldHelpId) umieszczony przy polach formularzy w aplikacji?',
          options: [
            'Do automatycznego wysyłania zapytania o interpretację indywidualną do KIS',
            'Do wyświetlania zwięzłego wyjaśnienia pola, przykładu, ostrzeżenia oraz odnośnika do powiązanej lekcji Akademii',
            'Do kasowania wszystkich wpisanych danych w bieżącym formularzu',
            'Do ukrywania obowiązkowych pól podatkowych przed walidacją',
          ],
          correctOptionIndex: 1,
          explanation:
            'Pomoc kontekstowa fieldHelpId tłumaczy znaczenie pola prostym językiem i pozwala jednym kliknięciem przejść do pogłębionej lekcji bez zgadywania.',
        },
      ],
    },
    {
      id: 'lesson-12-02',
      slug: 'obieg-faktury-sprzedazy-i-kosztowej-w-widoku-dzielonym',
      moduleNumber: 12,
      lessonNumber: 2,
      title: 'Krok 2: Faktura sprzedaży, KSeF oraz weryfikacja kosztu w widoku dzielonym',
      estimatedMinutes: 14,
      audienceScope: {
        type: 'profile_specific',
        applicableProfiles: [
          'jdg_kpir_skala',
          'jdg_kpir_liniowy',
          'spolka_cywilna_kpir',
          'sp_zoo_pelne_ksiegi_cit_klasyczny',
          'vat_czynny',
        ],
        scopeNote:
          'Samouczek dla czynnego podatnika VAT ewidencjonującego koszty — obejmuje wystawienie sprzedaży FA(3) oraz weryfikację zakupu w split-view; materiał edukacyjny.',
      },
      intro:
        'W drugim kroku samouczka wprowadzamy do firmy demonstracyjnej dwa prawdziwe zdarzenia gospodarcze z syntetycznych danych: wystawiamy fakturę sprzedaży za projekt architektoniczny oraz weryfikujemy w widoku dzielonym (split-view) fakturę kosztową za licencje i eksploatację auta.',
      sections: [
        {
          heading: 'Wystawienie faktury sprzedaży i zasady korekt od lutego 2026 r.',
          body: 'W module Faktury wybierasz kontrahenta po numerze NIP (dane adresowe i status czynnego podatnika VAT pobierane są z rejestrów urzędowych), wskazujesz datę wykonania usługi, stawkę 23% VAT oraz kod GTU (jeżeli dotyczy, np. GTU_12 dla usług niematerialnych takich jak doradztwo czy zarządcze — oznaczany w ewidencji JPK_V7). Pamiętaj o kluczowej zmianie od 1 lutego 2026 r.: z polskiego porządku prawnego zniknęły noty korygujące! Jeżeli pomylisz nazwę lub NIP nabywcy, błąd poprawia wyłącznie sprzedawca poprzez wystawienie faktury korygującej powiązanej z numerem KSeF faktury pierwotnej.',
          keyPoints: [
            'Od lutego 2026 r. nabywca nie wystawia już not korygujących — każdą pomyłkę w danych formalnych koryguje sprzedawca fakturą korygującą.',
            'Kody GTU_01–GTU_13 należą do ewidencji JPK_V7, a nie do wizualnego wydruku faktury dla klienta.',
          ],
        },
        {
          heading: 'Weryfikacja faktury kosztowej i propozycji AI w widoku dzielonym',
          body: 'Po wgraniu pliku PDF lub pobraniu dokumentu z KSeF otwierasz stację weryfikacji (VerificationSplitView). Po lewej stronie widzisz niezmienny podgląd dokumentu źródłowego, a po prawej propozycję odczytu z oznaczeniem pewności pól. Twoim zadaniem jako weryfikatora jest potwierdzenie trzech rzeczy: zgodności kwot i dat z dokumentem, związku wydatku z przychodem (kwalifikacja KUP vs NKUP, np. wyłączenie kosztów reprezentacji z art. 23 ust. 1 pkt 23 PIT) oraz specjalnych reguł odliczenia (np. użytek mieszany samochodu osobowego: 50% VAT i 75% KUP).',
          keyPoints: [
            'Żaden dokument z kolejki OCR/KSeF nie trafia do KPiR ani JPK_V7 przed kliknięciem przycisku zatwierdzenia przez uprawnionego użytkownika.',
            'System automatycznie sprawdza rachunek dostawcy na Białej Liście KAS i zapisuje identyfikator zapytania.',
          ],
        },
      ],
      numericalExample: {
        title: 'Zestawienie sprzedaży projektu i dwóch zweryfikowanych faktur kosztowych',
        scenario:
          'Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne) w czerwcu 2026 r. wystawia fakturę sprzedaży za projekt na 12 000,00 PLN netto + 2 760,00 PLN VAT (14 760,00 PLN brutto). Następnie weryfikuje w widoku dzielonym dwie faktury zakupowe: oprogramowanie CAD za 1 000,00 PLN netto + 230,00 PLN VAT (100% odliczenia) oraz serwis auta w użytku mieszanym za 800,00 PLN netto + 184,00 PLN VAT (50% VAT, 75% KUP). Obliczamy łączny koszt KUP trafiający do kolumny pozostałych wydatków PKPiR (kol. 15 we wzorze 2026 r., dawna kol. 13).',
        steps: [
          {
            stepNumber: 1,
            label: 'Koszt KUP z faktury za oprogramowanie CAD (100% VAT odliczone)',
            calculation: '100% × 1 000,00 PLN netto',
            amountPln: '1 000,00 PLN',
          },
          {
            stepNumber: 2,
            label:
              'Koszt KUP z faktury serwisowej auta osobowego (50% nieodliczonego VAT = 92,00 PLN)',
            calculation: '75% × (800,00 PLN netto + 92,00 PLN nieodliczonego VAT)',
            amountPln: '669,00 PLN',
          },
          {
            stepNumber: 3,
            label:
              'Suma zweryfikowanych pozostałych wydatków w kolumnie 15 PKPiR (dawna kol. 13) za czerwiec 2026 r.',
            calculation: '1 000,00 PLN + 669,00 PLN',
            amountPln: '1 669,00 PLN',
          },
        ],
        finalResultPln: '1 669,00 PLN',
        interpretation:
          'W widoku dzielonym Jan zatwierdził pełne 1 000,00 PLN kosztu z licencji CAD oraz wyliczone przez deterministyczny silnik 669,00 PLN kosztu eksploatacji samochodu (przy jednoczesnym odliczeniu 230,00 PLN + 92,00 PLN = 322,00 PLN VAT naliczonego).',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
          articleRef: 'art. 86a ust. 1 oraz art. 106j ust. 1',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Reguluje 50% odliczenie VAT od wydatków na pojazdy samochodowe o użytku mieszanym oraz zasady wystawiania faktur korygujących przez sprzedawcę.',
        },
        {
          actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
          articleRef: 'art. 22 ust. 1 oraz art. 23 ust. 1 pkt 46a',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Określa ogólną definicję kosztu uzyskania przychodów oraz limit 75% KUP dla eksploatacji samochodu osobowego wykorzystywanego mieszanie.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm12-l02-samouczek-obieg-faktur-split-view',
        '/documents',
        'Stacja weryfikacji dokumentów kosztowych w widoku dzielonym z wyborem reguły pojazdu 50% VAT / 75% KUP i podglądem źródłowego PDF.',
        '[data-testid="tutorial-invoice-split-verification"]',
      ),
      practicalExercise: {
        title: 'Wystawienie faktury sprzedaży i zatwierdzenie kosztu samochodowego w split-view',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'W module Faktury utwórz szkic faktury sprzedaży na 12 000,00 PLN netto (23% VAT) dla syntetycznego kontrahenta i zatwierdź dokument.',
          'Przejdź do Dokumentów kosztowych, otwórz fakturę serwisową auta na 800,00 PLN netto + 184,00 PLN VAT w widoku dzielonym.',
          'Wybierz kategorię „Eksploatacja samochodu osobowego — użytek mieszany (50% VAT / 75% KUP)” i kliknij „Zatwierdź zapis księgowy”.',
        ],
        expectedOutcome:
          'Obie faktury otrzymują status zatwierdzony i automatycznie generują powiązane pozycje w KPiR oraz rejestrach VAT.',
      },
      commonMistakes: [
        {
          mistake:
            'Próba wystawienia noty korygującej po 1 lutego 2026 r. w celu poprawienia literówki w adresie nabywcy.',
          consequence:
            'Dokument jest prawnie bezskuteczny po uchyleniu przepisów o notach korygujących.',
          howToAvoid:
            'Poproś sprzedawcę o wystawienie ustrukturyzowanej faktury korygującej dane formalne w KSeF.',
        },
        {
          mistake:
            'Zaliczenie obiadu z kontrahentem w restauracji do KUP podczas weryfikacji faktury.',
          consequence:
            'Zawyżenie kosztów o wydatki na reprezentację wyłączone na mocy art. 23 ust. 1 pkt 23 PIT.',
          howToAvoid:
            'Oznaczaj wydatki reprezentacyjne jako NKUP już na etapie weryfikacji w widoku dzielonym.',
        },
        {
          mistake:
            'Liczenie 75% KUP wyłącznie od kwoty netto przy 50% odliczeniu VAT od samochodu.',
          consequence:
            'Niedoszacowanie kosztu podatkowego — 75% liczy się od sumy netto powiększonej o nieodliczoną połowę VAT.',
          howToAvoid:
            'Korzystaj z wbudowanego profilu pojazdu mieszanego, który stosuje dokładny wzór ustawowy.',
        },
      ],
      summary: [
        'Od lutego 2026 r. jedynym sposobem korekty błędnych danych na fakturze jest faktura korygująca wystawiona przez sprzedawcę.',
        'Widok dzielony (split-view) łączy podgląd oryginału z kontrolą kwalifikacji KUP/NKUP i reguł pojazdów.',
        'Zatwierdzenie dokumentu przez człowieka jest warunkiem koniecznym ujęcia go w ewidencjach podatkowych.',
      ],
      quiz: [
        {
          id: 'q-12-02-01',
          question:
            'W jaki sposób od 1 lutego 2026 r. poprawia się błędny NIP lub nazwę nabywcy na otrzymanej fakturze?',
          options: [
            'Nabywca wystawia papierową notę korygującą i wysyła ją pocztą do akceptacji',
            'Sprzedawca wystawia fakturę korygującą w KSeF (noty korygujące zostały zlikwidowane)',
            'Księgowy ręcznie zamazuje NIP w pliku XML pobranym z KSeF',
            'Błędów formalnych na fakturach ustrukturyzowanych w ogóle nie wolno korygować',
          ],
          correctOptionIndex: 1,
          explanation:
            'Od 1 lutego 2026 r. instytucja noty korygującej (dawny art. 106k ustawy o VAT) została zlikwidowana — wszelkie błędy na fakturze poprawia sprzedawca fakturą korygującą.',
        },
        {
          id: 'q-12-02-02',
          question:
            'Faktura za serwis samochodu osobowego w użytku mieszanym wynosi 800,00 PLN netto + 184,00 PLN VAT. Jaka kwota trafi do kolumny pozostałych wydatków PKPiR (kol. 15 od 2026 r., dawna kol. 13) u czynnego podatnika VAT?',
          options: ['800,00 PLN', '600,00 PLN', '669,00 PLN', '738,00 PLN'],
          correctOptionIndex: 2,
          explanation:
            'Odliczeniu podlega 50% VAT (92,00 PLN). Nieodliczony VAT (92,00 PLN) powiększa kwotę netto (800,00 + 92,00 = 892,00 PLN), a 75% z 892,00 PLN daje dokładnie 669,00 PLN kosztu KUP.',
        },
      ],
    },
    {
      id: 'lesson-12-03',
      slug: 'ksiegowanie-kpir-vat-jpk-v7m-i-szuflada-dlaczego',
      moduleNumber: 12,
      lessonNumber: 3,
      title: 'Krok 3: KPiR, rejestry VAT, walidacja JPK_V7M(3) i szuflada „§ Dlaczego?”',
      estimatedMinutes: 13,
      audienceScope: {
        type: 'profile_specific',
        applicableProfiles: [
          'jdg_kpir_skala',
          'jdg_kpir_liniowy',
          'spolka_cywilna_kpir',
          'vat_czynny',
        ],
        scopeNote:
          'Samouczek dla podatników prowadzących PKPiR oraz ewidencję JPK_V7M — pokazuje kontrolę ksiąg i transparentny ślad obliczeniowy przed zamknięciem miesiąca.',
      },
      intro:
        'Po zatwierdzeniu wszystkich czerwcowych faktur przechodzimy do serca księgowości: sprawdzamy wiersze w Podatkowej Księdze Przychodów i Rozchodów, uzgadniamy Rejestry VAT i prewalidację pliku JPK_V7M(3) oraz otwieramy szufladę „§ Dlaczego?”, która krok po kroku tłumaczy każdą wyliczoną złotówkę podatku.',
      sections: [
        {
          heading: 'Kontrola PKPiR, rejestrów VAT i oznaczeń KSeF w JPK_V7M(3)',
          body: 'W 19-kolumnowym widoku PKPiR obowiązującym od 2026 r. (Dz.U. 2025 poz. 1299) widzisz sprzedaż z lekcji drugiej w kolumnie 9 — dawnej kolumnie 7 (12 000,00 PLN) oraz oba koszty w kolumnie 15 — dawnej kolumnie 13 (1 000,00 PLN oraz 669,00 PLN), wraz z numerami KSeF w kolumnie 3 i NIP kontrahenta w kolumnie 5. W zakładce JPK_V7M(3) walidator przedwysyłkowy sprawdza spójność części ewidencyjnej i deklaracyjnej, obecność numerów KSeF lub wymaganych od lutego 2026 r. znaczników szczególnych (OFF dla trybu offline24 nieprzesłanego jeszcze na dzień wysyłki JPK, BFK dla faktur poza KSeF, DI dla dowodów wewnętrznych/innych) oraz zaokrąglenia podatku do pełnych złotych wg art. 63 § 1 Ordynacji podatkowej.',
          keyPoints: [
            'W części ewidencyjnej JPK_V7 kwoty wykazuje się co do grosza, a w części deklaracyjnej podstawy i podatek zaokrągla się do pełnych złotych.',
            'Zamknięcie miesiąca blokuje przypadkową edycję wpisów — ewentualne późniejsze zmiany przechodzą wyłącznie przez udokumentowaną korektę.',
          ],
        },
        {
          heading: 'Szuflada podstawy prawnej „§ Dlaczego?” (LegalBasisDrawer)',
          body: 'Czarna skrzynka w programie księgowym budzi nieufność, dlatego przy każdej wyliczonej kwocie podatku lub limicie klikniesz przycisk „§ Dlaczego?”. Otwiera on szufladę zawierającą trzy warstwy prawdy: dokładną ścieżkę obliczeń (calculation_trace z każdym działaniem pośrednim), identyfikator i wersję deterministycznej reguły obowiązującej w danym okresie podatkowym oraz link do oficjalnego aktu prawnego w ISAP / Dzienniku Ustaw wraz z ostrzeżeniem, czy zasada zależy od indywidualnego profilu firmy.',
          keyPoints: [
            'Ślad obliczeniowy pozwala księgowemu i właścicielowi w 10 sekund odtworzyć skąd wzięła się zaliczka PIT oraz kwota VAT do urzędu.',
            'Każda reguła ma zapisaną datę obowiązywania — przeglądając stary rok, widzisz przepisy właściwe dla tamtego okresu.',
          ],
        },
      ],
      numericalExample: {
        title:
          'Sprawdzenie w szufladzie „§ Dlaczego?” kwoty VAT i zaliczki PIT za czerwiec 2026 r.',
        scenario:
          'Kontynuujemy czerwiec 2026 r. w firmie Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne) na podatku liniowym 19% (dla czytelności przykładu zakładamy zerowe saldo z poprzednich miesięcy i ujęcie odliczalnych składek społecznych ZUS w kwocie 1 831,00 PLN). Sprawdzamy kwotę VAT do wpłaty w JPK_V7M oraz zaliczkę PIT wyliczoną w szufladzie „§ Dlaczego?”.',
        steps: [
          {
            stepNumber: 1,
            label:
              'Podatek VAT do wpłaty w JPK_V7M za czerwiec (2 760,00 należny − 322,00 naliczony)',
            calculation: '2 760,00 PLN - (230,00 PLN + 92,00 PLN)',
            amountPln: '2 438,00 PLN',
          },
          {
            stepNumber: 2,
            label:
              'Podstawa opodatkowania PIT liniowego po odjęciu kosztów KUP i składek społecznych ZUS',
            calculation: '12 000,00 PLN - 1 669,00 PLN - 1 831,00 PLN',
            amountPln: '8 500,00 PLN',
          },
          {
            stepNumber: 3,
            label:
              'Zaliczka na podatek liniowy 19% (zaokrąglona do pełnych złotych wg art. 63 § 1 OP)',
            calculation: '8 500,00 PLN × 19%',
            amountPln: '1 615,00 PLN',
          },
        ],
        finalResultPln: '4 053,00 PLN',
        interpretation:
          'Szuflada „§ Dlaczego?” pokazuje pełny rachunek: 2 438,00 PLN podatku VAT do 25 lipca oraz 1 615,00 PLN zaliczki PIT-36L do 20 lipca — łącznie 4 053,00 PLN zobowiązań podatkowych za czerwiec.',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
          articleRef: 'art. 63 § 1',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Podstawy opodatkowania oraz kwoty podatków zaokrągla się do pełnych złotych (końcówki poniżej 50 groszy pomija się, a 50 i więcej groszy podwyższa do pełnych złotych).',
        },
        {
          actTitle: 'Portal Podatkowy Ministerstwa Finansów — Struktura JPK_V7M(3)',
          articleRef: 'Broszura informacyjna JPK_VAT z deklaracją (wariant 3)',
          sourceKind: 'official_guidance',
          officialUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Opisuje pola ewidencyjne i deklaracyjne JPK_V7M(3), w tym raportowanie numerów KSeF oraz znaczników OFF, BFK i DI.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm12-l03-szuflada-dlaczego-slad-obliczeniowy-jpk',
        '/taxes',
        'Otwarta szuflada „§ Dlaczego?” prezentująca krok po kroku wyliczenie zaliczki PIT i podatku VAT z wersją reguły oraz linkiem do ISAP.',
        '[data-testid="legal-basis-why-drawer"]',
      ),
      practicalExercise: {
        title: 'Uruchomienie walidacji JPK_V7M(3) i inspekcja szuflady „§ Dlaczego?”',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'Otwórz widok PKPiR za czerwiec 2026 r. i sprawdź zgodność sumy kolumny 9 — dawnej 7 (12 000,00 PLN) oraz kolumny 15 — dawnej 13 (1 669,00 PLN).',
          'Przejdź do zakładki Podatki i JPK, kliknij „§ Dlaczego?” przy kwocie zaliczki PIT i prześledź kolejne wiersze calculation_trace.',
          'Uruchom walidator przedwysyłkowy JPK_V7M(3) i upewnij się, że żaden dokument nie zgłasza brakującego numeru KSeF / znacznika.',
        ],
        expectedOutcome:
          'Użytkownik samodzielnie weryfikuje poprawność zamknięcia miesiąca i potrafi odczytać podstawę prawną każdego wyliczenia.',
      },
      commonMistakes: [
        {
          mistake:
            'Zaokrąglanie pojedynczych faktur do pełnych złotych w kolumnach PKPiR lub części ewidencyjnej JPK.',
          consequence:
            'Niezgodność ksiąg z dowodami źródłowymi — poszczególne dokumenty księguje się zawsze z dokładnością do grosza.',
          howToAvoid:
            'Pamiętaj, że zaokrąglenie z art. 63 § 1 OP stosuje się dopiero do łącznej podstawy opodatkowania i kwoty podatku.',
        },
        {
          mistake:
            'Generowanie pliku JPK_V7M przed zatwierdzeniem wszystkich faktur oczekujących w kolejce weryfikacji.',
          consequence:
            'Konieczność późniejszego składania korekty JPK_V7M po odnalezieniu pominiętych faktur.',
          howToAvoid:
            'Przed wygenerowaniem deklaracji zawsze wyzeruj licznik „Dokumenty do weryfikacji”.',
        },
        {
          mistake:
            'Brak rozróżnienia między przelewem podatku na mikrorachunek podatkowy (IRP) a wysłaniem samego pliku JPK_V7M.',
          consequence:
            'Samo zapłacenie VAT nie zastępuje złożenia JPK_V7M (i odwrotnie) — trzeba wykonać obie czynności.',
          howToAvoid:
            'Odhaczaj w liście kontrolnej miesiąca zarówno wysyłkę deklaracji z UPO, jak i realizację przelewu na IRP.',
        },
      ],
      summary: [
        'Wpisy w PKPiR i części ewidencyjnej JPK_V7 ujmuje się co do grosza, a podstawę i podatek w deklaracji zaokrągla do pełnych złotych.',
        'Walidator JPK_V7M(3) weryfikuje kompletność numerów KSeF oraz oznaczeń OFF, BFK, DI i GTU.',
        'Szuflada „§ Dlaczego?” zapewnia pełną przejrzystość każdego wyliczenia wraz z linkiem do urzędowego źródła prawa.',
      ],
      quiz: [
        {
          id: 'q-12-03-01',
          question:
            'Co zawiera szuflada „§ Dlaczego?” (LegalBasisDrawer) dostępna przy kwotach podatków w aplikacji?',
          options: [
            'Losowo wygenerowaną poradę marketingową od czatu AI',
            'Deterministyczny ślad obliczeniowy (calculation_trace), wersję reguły z datą obowiązywania oraz odwołanie do przepisu w oficjalnym źródle (np. ISAP)',
            'Hasła dostępowe do bankowości elektronicznej kontrahentów',
            'Historię kursów akcji na giełdzie',
          ],
          correctOptionIndex: 1,
          explanation:
            'Szuflada „§ Dlaczego?” prezentuje odtwarzalny ślad obliczeniowy deterministycznego silnika reguł oraz dokładną podstawę prawną ze wskazaniem zakresu profilowego.',
        },
        {
          id: 'q-12-03-02',
          question:
            'Na którym etapie stosuje się zaokrąglenie do pełnych złotych na podstawie art. 63 § 1 Ordynacji podatkowej?',
          options: [
            'Przy każdej pojedynczej pozycji towarowej na fakturze sprzedaży',
            'Przy wpisywaniu pojedynczej faktury kosztowej do kolumny pozostałych wydatków PKPiR (kol. 15 od 2026 r. / dawnej kol. 13)',
            'Przy ustalaniu łącznej podstawy opodatkowania oraz kwoty podatku/zaliczki podlegającej wpłacie do urzędu skarbowego',
            'W polskim prawie podatkowym nigdy nie zaokrągla się podatków do pełnych złotych',
          ],
          correctOptionIndex: 2,
          explanation:
            'Dowody księgowe, PKPiR i część ewidencyjną JPK prowadzi się z dokładnością do groszy, a zaokrąglenie do pełnych złotych dotyczy podstaw opodatkowania i kwot podatków w deklaracji/zaliczce.',
        },
      ],
    },
    {
      id: 'lesson-12-04',
      slug: 'kalendarz-podatkowy-powiadomienia-email-i-praca-przez-mcp',
      moduleNumber: 12,
      lessonNumber: 4,
      title: 'Krok 4: Kalendarz podatkowy, powiadomienia e-mail oraz praca przez MCP',
      estimatedMinutes: 13,
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
          'Samouczek końcowy dla wszystkich profili — obejmuje kalendarz świąteczny 2025/2026 (w tym wolną Wigilię 24.12), bezpieczne powiadomienia e-mail oraz współpracę przez MCP.',
      },
      intro:
        'Na finał samouczka spinamy codzienną pracę z automatycznym pilnowaniem terminów: sprawdzamy przesunięcia świąteczne w kalendarzu podatkowym, włączamy powiadomienia e-mail bez wycieku danych wrażliwych oraz testujemy odczyt podsumowania miesiąca i przygotowanie operacji prepare_* przez zdalny serwer MCP.',
      sections: [
        {
          heading: 'Kalendarz podatkowy 2026 z wolną Wigilią 24 grudnia i powiadomienia e-mail',
          body: 'Kalendarz w aplikacji wylicza dokładne daty zapłaty ZUS (15. dzień dla podmiotów z osobowością prawną jak sp. z o.o., 20. dzień dla JDG), zaliczek PIT/CIT/ryczałtu (20. dzień) oraz JPK_V7 i VAT (25. dzień). Jeżeli termin wypada w sobotę, niedzielę lub dzień ustawowo wolny od pracy — wliczając obowiązującą od 2025 r. ustawowo wolną Wigilię 24 grudnia — silnik kalendarza przesuwa go na najbliższy dzień roboczy na mocy art. 12 § 5 Ordynacji podatkowej (np. grudniowy termin 25 grudnia 2026 r. wypadający w piątek Boże Narodzenie przesuwa się po sobocie 26.12 i niedzieli 27.12 na poniedziałek 28 grudnia 2026 r.). Silnik powiadomień e-mail wysyła z wyprzedzeniem przypomnienia o terminach i brakujących dokumentach, nie umieszczając w treści niezaszyfrowanego maila tajemnic skarbowych ani pełnych danych osobowych.',
          keyPoints: [
            'Od 2025 r. Wigilia 24 grudnia jest dniem ustawowo wolnym od pracy, co uwzględnia kalendarz przesunięć terminów urzędowych.',
            'Powiadomienia e-mail zawierają bezpieczne podsumowanie zadania i link do aplikacji wymagający zalogowania użytkownika.',
          ],
        },
        {
          heading: 'Praktyczny scenariusz MCP: odczyt statusu miesiąca i prepare_*',
          body: 'Korzystając z podłączonego przez Streamable HTTP i OIDC klienta MCP, możesz w języku naturalnym poprosić asystenta: „Pokaż otwarte obowiązki za czerwiec i przygotuj szkic faktury cyklicznej na lipiec dla stałego klienta”. Asystent wywołuje narzędzia odczytowe (list_tax_deadlines, get_monthly_summary) w granicach Twojego tenanta, a następnie wywołuje prepare_invoice_draft. W interfejsie aplikacji pojawia się gotowa karta oczekującego zatwierdzenia ze skrótem payloadu i wyliczeniem z deterministycznego silnika — klikasz „Sprawdź i zatwierdź”, zamykając pełny, bezpieczny obieg pracy.',
          keyPoints: [
            'Odczyt przez MCP natychmiast odpowiada na pytania o płynność, otwarte rozrachunki i terminy bez ręcznego przeklikiwania tabel.',
            'Każda przygotowana przez MCP akcja czeka w kolejce zatwierdzeń na świadomą decyzję człowieka.',
          ],
        },
      ],
      numericalExample: {
        title: 'Harmonogram trzech przelewów urzędowych po zamknięciu czerwca 2026 r.',
        scenario:
          'Po zamknięciu czerwca 2026 r. kalendarz podatkowy firmy Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne) generuje w lipcu 2026 r. harmonogram trzech płatności: składki ZUS (2 400,00 PLN do 20 lipca — poniedziałek), zaliczka PIT-36L (1 615,00 PLN do 20 lipca — poniedziałek) oraz podatek VAT z JPK_V7M (2 438,00 PLN: ustawowy 25 lipca 2026 r. to sobota, więc termin przesuwa się na poniedziałek 27 lipca 2026 r.!). Obliczamy kwotę wymaganą na dzień 20 lipca oraz łączną sumę lipcowych przelewów urzędowych.',
        steps: [
          {
            stepNumber: 1,
            label:
              'Suma przelewów wymagalnych do poniedziałku 20 lipca 2026 r. (ZUS + zaliczka PIT)',
            calculation: '2 400,00 PLN + 1 615,00 PLN',
            amountPln: '4 015,00 PLN',
          },
          {
            stepNumber: 2,
            label:
              'Przelew VAT z JPK_V7M przesunięty z soboty 25 lipca na poniedziałek 27 lipca 2026 r.',
            calculation: 'Kwota z części deklaracyjnej JPK_V7M',
            amountPln: '2 438,00 PLN',
          },
          {
            stepNumber: 3,
            label:
              'Łączna kwota rozliczeń publicznoprawnych pokrywana z subkonta rezerwy podatkowej',
            calculation: '4 015,00 PLN + 2 438,00 PLN',
            amountPln: '6 453,00 PLN',
          },
        ],
        finalResultPln: '6 453,00 PLN',
        interpretation:
          'Kalendarz automatycznie wykrył, że 25 lipca 2026 r. wypada w sobotę, przesunął termin JPK_V7M i zapłaty VAT na poniedziałek 27 lipca 2026 r. oraz zaplanował przypomnienia e-mail przed 20 i 27 lipca na łączną kwotę 6 453,00 PLN.',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
          articleRef: 'art. 12 § 5',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Jeżeli ostatni dzień terminu przypada na sobotę lub dzień ustawowo wolny od pracy, za ostatni dzień terminu uważa się następny dzień po dniu lub dniach wolnych od pracy.',
        },
        {
          actTitle: 'Ustawa z dnia 18 stycznia 1951 r. o dniach wolnych od pracy',
          articleRef: 'art. 1 pkt 1 lit. k (24 grudnia — Wigilia Bożego Narodzenia, od 2025 r.)',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19510040028',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Ustanawia katalog dni ustawowo wolnych od pracy (w tym 24 grudnia od 2025 r.), które przesuwają terminy podatkowe i ZUS na kolejny dzień roboczy.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm12-l04-kalendarz-powiadomienia-email-i-mcp',
        '/calendar',
        'Widok Kalendarza podatkowego z przesunięciem sobotniego terminu 25 lipca 2026 r., ustawieniami alertów e-mail oraz kartą szkicu z MCP.',
        '[data-testid="tutorial-calendar-notifications-mcp-panel"]',
      ),
      practicalExercise: {
        title: 'Włączenie alertów e-mail i zatwierdzenie szkicu przygotowanego przez MCP',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'Otwórz Kalendarz podatkowy na lipiec 2026 r. i sprawdź adnotację o przesunięciu terminu JPK_V7M z soboty 25.07 na poniedziałek 27.07.',
          'Włącz przypomnienia e-mail wysyłane na 3 dni robocze przed terminem ZUS, PIT i VAT.',
          'Przejdź do kolejki „Propozycje MCP”, sprawdź szkic cyklicznej faktury utworzony wywołaniem prepare_* i zatwierdź go jako uprawniony użytkownik.',
        ],
        expectedOutcome:
          'Użytkownik kończy pełną ścieżkę Akademii Polskiej Księgowości, łącząc wiedzę merytoryczną z bezpieczną codzienną pracą w aplikacji.',
      },
      commonMistakes: [
        {
          mistake:
            'Korzystanie ze starych papierowych kalendarzy sprzed 2025 r., które traktują Wigilię 24 grudnia jako zwykły dzień roboczy.',
          consequence:
            'Błędne wyliczenie dni roboczych i przesunięć terminów przypadających w okresie świątecznym.',
          howToAvoid:
            'Sprawdzaj terminy w aktualizowanym kalendarzu aplikacji opartym o ustawę o dniach wolnych od pracy.',
        },
        {
          mistake:
            'Zlecanie przelewu podatkowego późnym wieczorem w ostatnim dniu terminu w banku realizującym sesję dopiero następnego dnia.',
          consequence:
            'Obciążenie rachunku po północy oznacza zapłatę po terminie (zgodnie z art. 60 § 1 pkt 2 Ordynacji podatkowej decyduje dzień obciążenia rachunku).',
          howToAvoid:
            'Ustaw powiadomienia e-mail na minimum 2–3 dni robocze przed ustawowym terminem płatności.',
        },
        {
          mistake:
            'Zostawienie przygotowanych przez MCP szkiców prepare_* bez decyzji aż do wygaśnięcia ich TTL.',
          consequence:
            'Szkic wygasa ze względów bezpieczeństwa i wymaga ponownego wygenerowania przed zatwierdzeniem.',
          howToAvoid:
            'Przeglądaj kolejkę oczekujących propozycji MCP na bieżąco podczas codziennego bloku pracy z dokumentami.',
        },
      ],
      summary: [
        'Kalendarz automatycznie przesuwa terminy z sobót, niedziel i świąt (w tym wolnej od 2025 r. Wigilii 24.12) na pierwszy dzień roboczy.',
        'Powiadomienia e-mail przypominają o terminach i brakach dokumentowych bez przesyłania poufnych danych podatkowych otwartym tekstem.',
        'Połączenie odczytu i prepare_* przez MCP z zatwierdzeniem człowieka daje szybkość automatyzacji bez utraty kontroli i bezpieczeństwa.',
      ],
      quiz: [
        {
          id: 'q-12-04-01',
          question:
            'Ustawowy termin wysłania JPK_V7M i zapłaty VAT (25 lipca 2026 r.) wypada w sobotę. Który dzień jest ostatnim dniem terminu zgodnie z art. 12 § 5 Ordynacji podatkowej?',
          options: [
            'Piątek 24 lipca 2026 r. — zawsze trzeba zapłacić dzień wcześniej',
            'Sobota 25 lipca 2026 r. do godziny 12:00',
            'Poniedziałek 27 lipca 2026 r. (pierwszy dzień roboczy po sobocie i niedzieli)',
            'Piątek 31 lipca 2026 r.',
          ],
          correctOptionIndex: 2,
          explanation:
            'Zgodnie z art. 12 § 5 Ordynacji podatkowej termin przypadający w sobotę lub dzień ustawowo wolny od pracy przesuwa się na najbliższy dzień roboczy — czyli poniedziałek 27 lipca 2026 r.',
        },
        {
          id: 'q-12-04-02',
          question:
            'Jaki status ma dzień 24 grudnia (Wigilia Bożego Narodzenia) przy ustalaniu dni ustawowo wolnych od pracy od 2025 r.?',
          options: [
            'Jest zwykłym dniem roboczym do godziny 14:00',
            'Jest dniem ustawowo wolnym od pracy na mocy znowelizowanej ustawy z dnia 18 stycznia 1951 r. o dniach wolnych od pracy',
            'Jest dniem wolnym wyłącznie dla spółek opodatkowanych estońskim CIT',
            'Przesuwa terminy podatkowe wstecz na 23 grudnia',
          ],
          correctOptionIndex: 1,
          explanation:
            'Od 2025 r. 24 grudnia jest dniem ustawowo wolnym od pracy, dzięki czemu terminy podatkowe przypadające na ten dzień ulegają przesunięciu na pierwszy dzień roboczy po świętach.',
        },
      ],
    },
  ],
};
