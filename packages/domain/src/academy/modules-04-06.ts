import { createScreenshotSlot, type AcademyModule } from './quiz.js';

export const MODULES_04_TO_06: readonly AcademyModule[] = [
  {
    moduleNumber: 4,
    slug: 'faktury-korekty-archiwizacja-i-ksef-2-0',
    title: 'Moduł 4: Faktury, korekty, archiwizacja i KSeF 2.0',
    subtitle:
      'Poznaj obowiązkowe elementy faktury wg art. 106e VAT, rozliczanie zaliczek i korekt po likwidacji not korygujących oraz praktyczne działanie KSeF FA(3) i trybu offline24.',
    learningObjectives: [
      'Wystawiać bezbłędne faktury sprzedażowe, zaliczkowe i końcowe z rozróżnieniem skutków w VAT oraz PIT/CIT.',
      'Korygować błędy i rabaty fakturami korygującymi in minus oraz in plus z uwzględnieniem likwidacji not korygujących.',
      'Stosować harmonogram KSeF 2026, strukturę FA(3), tryby offline24/awaryjne z kodami QR oraz 5-letnią archiwizację podatkową.',
    ],
    lessons: [
      {
        id: 'lesson-04-01',
        slug: 'elementy-obowiazkowe-faktury-i-faktury-zaliczkowe',
        moduleNumber: 4,
        lessonNumber: 1,
        title: 'Elementy obowiązkowe faktury (art. 106e VAT) oraz faktury zaliczkowe i końcowe',
        estimatedMinutes: 15,
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
            'Edukacja ogólna — zasady wystawiania faktur i dokumentowania zaliczek dotyczą wszystkich przedsiębiorców w obrocie gospodarczym.',
        },
        intro:
          'Faktura to najważniejszy dokument w obrocie gospodarczym. Jedna pomylona data sprzedaży lub niewłaściwie rozliczona zaliczka potrafi rozjechać deklarację VAT z podatkiem dochodowym PIT/CIT. Zobaczmy, czego wymaga ustawa na każdej fakturze i dlaczego zaliczka rządzi się podwójnym prawem.',
        sections: [
          {
            heading: 'Obowiązkowe elementy faktury wg art. 106e i termin jej wystawienia',
            body: 'Każda standardowa faktura musi zawierać m.in.: datę wystawienia, kolejny numer nadany w ramach jednej lub więcej serii jednoznacznie identyfikujący fakturę, imiona i nazwiska lub nazwy sprzedawcy i nabywcy wraz z adresami i numerami NIP, datę dokonania lub zakończenia dostawy towarów albo wykonania usługi (o ile jest określona i różni się od daty wystawienia), nazwę towaru lub usługi, miarę i ilość, cenę jednostkową netto, wartość netto, stawkę i kwotę VAT oraz kwotę należności ogółem. Zgodnie z art. 106i ust. 1 ustawy o VAT fakturę wystawia się nie później niż **15. dnia miesiąca następującego po miesiącu**, w którym dokonano dostawy towaru lub wykonano usługę (ani nie wcześniej niż 60. dnia przed tą dostawą/usługą).',
            keyPoints: [
              'Data wystawienia faktury to nie to samo co data sprzedaży/wykonania usługi — to data sprzedaży decyduje co do zasady o miesiącu powstania obowiązku podatkowego!',
              'Podatnik zwolniony z VAT na podstawie art. 113 nie musi wskazywać podstawy prawnej zwolnienia na fakturze (w przeciwieństwie do niektórych zwolnień przedmiotowych z art. 43 ust. 1), choć dobrą praktyką jest czytelna informacja dla kontrahenta.',
            ],
          },
          {
            heading: 'Faktura zaliczkowa a faktura końcowa: VAT kontra PIT/CIT',
            body: 'Gdy przed wykonaniem usługi lub wydaniem towaru otrzymasz od klienta B2B zaliczkę, zadatek lub przedpłatę, w podatku **VAT** powstaje obowiązek podatkowy w dniu otrzymania wpłaty w odniesieniu do otrzymanej kwoty (art. 19a ust. 8 VAT) i masz czas do 15. dnia kolejnego miesiąca na wystawienie **faktury zaliczkowej** (zawierającej kwotę VAT wyliczoną metodą „w stu”: `VAT = wpłata brutto × stawka / (100 + stawka)`). Natomiast w podatku dochodowym (**PIT/CIT**) pobrana zaliczka na poczet przyszłej dostawy lub usługi NIE JEST jeszcze przychodem podatkowym (art. 14 ust. 3 pkt 1 PIT)! Przychód w PIT/CIT powstaje dopiero w momencie finalnego wykonania usługi i wystawienia **faktury końcowej** (lub rozliczenia całości, jeśli zaliczka pokryła 100% zamówienia).',
            keyPoints: [
              'Zaliczka B2B = VAT płacisz już za miesiąc otrzymania przelewu, ale PIT/CIT płacisz dopiero po wykonaniu zamówienia!',
              'Faktura końcowa pomniejsza wartość zamówienia i podatek VAT o kwoty wykazane na wcześniejszych fakturach zaliczkowych (wskazując ich numery KSeF / numery faktur).',
            ],
          },
        ],
        numericalExample: {
          title: 'Zaliczka 40% we wrześniu i faktura końcowa w październiku (VAT vs KPiR)',
          scenario:
            'Stolarz (czynny podatnik VAT, KPiR) przyjął zlecenie wykonania zabudowy biurowej za 10 000,00 PLN netto + 2 300,00 PLN VAT (12 300,00 PLN brutto). 20 września otrzymał przelew zaliczki 4 920,00 PLN brutto (40%), a 18 października zakończył montaż i wystawił fakturę końcową na pozostałe 60%.',
          steps: [
            {
              stepNumber: 1,
              label: 'Wrzesień — VAT należny z faktury zaliczkowej (metodą „w stu”)',
              calculation:
                '(4 920,00 PLN × 23) / 123 = 920,00 PLN VAT (netto zaliczki: 4 000,00 PLN)',
              amountPln: '920,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Wrzesień — przychód w KPiR (podatek PIT)',
              calculation:
                'Zaliczka na poczet przyszłej usługi nie stanowi przychodu w PIT (art. 14 ust. 3 pkt 1)',
              amountPln: '0,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Październik — pozostały VAT należny z faktury końcowej',
              calculation: '2 300,00 PLN (cały VAT) − 920,00 PLN (VAT z zaliczki)',
              amountPln: '1 380,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Październik — pełny przychód w KPiR po wykonaniu zabudowy',
              calculation:
                'Cała wartość netto zrealizowanego zamówienia (4 000,00 PLN + 6 000,00 PLN)',
              amountPln: '10 000,00 PLN',
            },
          ],
          finalResultPln: '10 000,00 PLN',
          interpretation:
            'Podatek VAT podzielił się na dwa miesiące (920,00 PLN we wrześniu i 1 380,00 PLN w październiku), natomiast cały przychód w podatku dochodowym PIT (10 000,00 PLN) powstał jednorazowo w październiku w dacie wykonania zabudowy.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef:
              'art. 19a ust. 8, art. 106b ust. 1 pkt 4, art. 106e ust. 1, art. 106f oraz art. 106i ust. 1–2',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Definiuje obowiązkowe elementy faktury, termin wystawienia do 15. dnia kolejnego miesiąca oraz zasady opodatkowania zaliczek i wystawiania faktur końcowych.',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 14 ust. 3 pkt 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wyłącza pobrane wpłaty lub zarachowane należności na poczet dostaw towarów i usług, które zostaną wykonane w następnych okresach sprawozdawczych, z przychodów PIT.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm04-l01-formularz-faktury-i-zaliczki',
          '/invoices',
          'Widok szczegółów faktury zaliczkowej i powiązanej z nią faktury końcowej z rozdzieleniem ujęcia w rejestrze VAT oraz PKPiR.',
          '[data-testid="invoice-advance-final-chain"]',
        ),
        practicalExercise: {
          title: 'Powiąż fakturę końcową z wcześniejszą fakturą zaliczkową w firmie demo',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do sekcji „Sprzedaż i zakupy” w firmie Pracownia Projektowa Alfa.',
            'Odszukaj fakturę zaliczkową za I etap projektu architektonicznego i sprawdź, że zasiliła wyłącznie rejestr sprzedaży VAT (a w PKPiR widnieje jedynie w kolumnie uwag).',
            'Otwórz fakturę końcową z kolejnego miesiąca i zweryfikuj odwołanie do numeru KSeF faktury zaliczkowej oraz ujęcie pełnego przychodu w PKPiR.',
          ],
          expectedOutcome:
            'Użytkownik unika podwójnego opodatkowania zaliczki w VAT i przedwczesnego wykazania przychodu w PIT.',
        },
        commonMistakes: [
          {
            mistake:
              'Wpisanie faktury zaliczkowej na przyszłą usługę prosto do kolumny przychodów ze sprzedaży w PKPiR.',
            consequence:
              'Przedwczesne zawyżenie zaliczki na podatek dochodowy PIT (chyba że podatnik celowo wybrał szczególny wariant kasowego rozliczania zaliczek rejestrowanych na kasie fiskalnej z art. 14 ust. 1j).',
            howToAvoid:
              'Oznaczaj fakturę typem „Zaliczkowa” — system automatycznie ujmie ją w JPK_V7, a przychód PIT rozpozna dopiero przy realizacji zamówienia.',
          },
          {
            mistake:
              'Wystawienie w lipcu zwykłej faktury z lipcową datą wystawienia za usługę wykonaną 28 czerwca i zaksięgowanie jej do przychodów lipca zamiast czerwca.',
            consequence:
              'Zaniżenie podatku VAT i PIT za czerwiec — o okresie powstania przychodu i obowiązku VAT decyduje data wykonania usługi (28 czerwca), mimo że fakturę wystawiono zgodnie z prawem do 15 lipca!',
            howToAvoid:
              'Zawsze rozróżniaj pole „Data wystawienia” od pola „Data sprzedaży / wykonania usługi”.',
          },
          {
            mistake:
              'Pominięcie numeru KSeF wcześniejszej faktury zaliczkowej na fakturze końcowej.',
            consequence:
              'Niezgodność z art. 106f ust. 3 ustawy o VAT oraz błędna struktura logiczna FA(3).',
            howToAvoid:
              'Wystawiaj fakturę końcową bezpośrednio z widoku zamówienia lub faktury zaliczkowej, aby system automatycznie przeniósł numer KSeF zaliczki.',
          },
        ],
        summary: [
          'Fakturę wystawia się do 15. dnia kolejnego miesiąca po wykonaniu usługi, dostawie towaru lub otrzymaniu zaliczki.',
          'O miesiącu rozliczenia przychodu i VAT co do zasady decyduje data wykonania usługi / dostawy towaru, a nie data wystawienia faktury.',
          'Zaliczka na poczet przyszłej usługi rodzi obowiązek w VAT w miesiącu wpłaty, lecz w PIT/CIT staje się przychodem dopiero po realizacji świadczenia.',
        ],
        quiz: [
          {
            id: 'q-04-01-01',
            question:
              'Usługa programistyczna została w całości wykonana i odebrana protokołem 29 maja, a fakturę wystawiono 5 czerwca. W którym miesiącu powstaje przychód w PIT i obowiązek podatkowy w VAT (zasady ogólne)?',
            options: [
              'W czerwcu, bo liczy się data wystawienia faktury.',
              'W maju, ponieważ decyduje data faktycznego wykonania usługi (29 maja).',
              'Dopiero w lipcu po otrzymaniu zapłaty.',
              'W VAT w czerwcu, a w PIT w maju.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zarówno w VAT (art. 19a ust. 1), jak i w PIT (art. 14 ust. 1c — usługa wykonana wcześniej niż wystawiono fakturę) obowiązek podatkowy powstaje w maju, mimo że wystawienie faktury do 15 czerwca było całkowicie terminowe.',
          },
          {
            id: 'q-04-01-02',
            question:
              'Jak wpływa otrzymana we wrześniu 30% zaliczka na poczet październikowej dostawy mebli u czynnego podatnika VAT prowadzącego KPiR?',
            options: [
              'Nie wywołuje żadnych skutków ani w VAT, ani w PIT aż do października.',
              'Rodzi obowiązek podatkowy w VAT we wrześniu (od kwoty zaliczki), natomiast w podatku dochodowym PIT nie stanowi jeszcze przychodu we wrześniu.',
              'Jest przychodem w PIT we wrześniu, ale w VAT dopiero w październiku.',
              'Jest opodatkowana podwójnie we wrześniu i październiku.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Otrzymanie zaliczki rodzi obowiązek w VAT w chwili jej otrzymania (art. 19a ust. 8 VAT), lecz na mocy art. 14 ust. 3 pkt 1 ustawy o PIT nie stanowi przychodu podatkowego do czasu wydania towaru / wykonania usługi.',
          },
        ],
      },
      {
        id: 'lesson-04-02',
        slug: 'faktury-korygujace-in-minus-in-plus-noty-duplikaty',
        moduleNumber: 4,
        lessonNumber: 2,
        title: 'Faktury korygujące in minus i in plus, likwidacja not korygujących oraz duplikaty',
        estimatedMinutes: 16,
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
            'Edukacja ogólna — prawidłowe korygowanie błędów, zwrotów i rabatów obowiązuje każdego wystawcę i odbiorcę faktur.',
        },
        intro:
          'W realnym biznesie pomyłki, rabaty potransakcyjne i zwroty towarów są codziennością. Nigdy nie wolno jednak „podmieniać” raz wysłanej do klienta lub do KSeF faktury! Wraz z wejściem obowiązkowego KSeF w 2026 r. z polskiego prawa zniknęły także noty korygujące — sprawdźmy, jak bezpiecznie korygować dokumenty dzisiaj.',
        sections: [
          {
            heading: 'Faktury korygujące in minus (zmniejszające) i in plus (zwiększające)',
            body: 'Gdy po wystawieniu faktury udzielisz rabatu, przyjmiesz zwrot towaru lub wykryjesz zawyżenie ceny, wystawiasz **fakturę korygującą in minus**. W systemie KSeF rozliczanie korekt uległo znacznemu uproszczeniu: dla faktur korygujących ustrukturyzowanych wystawionych w KSeF sprzedawca pomniejsza VAT w okresie wystawienia korekty w KSeF (bez konieczności gromadzenia odrębnej dokumentacji uzgodnień jak przy tradycyjnych fakturach papierowych), a nabywca pomniejsza VAT naliczony w okresie otrzymania tej korekty w KSeF! Z kolei przy **korekcie in plus** (podwyższenie ceny): jeśli przyczyna istniała już w momencie wystawienia faktury pierwotnej (np. błąd rachunkowy lub zaniżona stawka na starcie), cofasz się i korygujesz okres pierwotny; jeśli zaś wynika z nowej okoliczności powstałej później (np. waloryzacja ceny aneksem), rozliczasz ją na bieżąco w miesiącu wystawienia korekty!',
            keyPoints: [
              'W podatku dochodowym PIT/CIT zasada jest bardzo zbliżona (art. 14 ust. 1m–1n PIT): korektę niezwiązaną z błędem rachunkowym (np. rabat, zwrot towaru) ujmuje się na bieżąco, natomiast korektę wynikającą z błędu rachunkowego lub innej oczywistej omyłki — wstecznie w okresie pierwotnym!',
              'Faktura korygująca ustrukturyzowana musi wskazywać numer KSeF faktury korygowanej.',
            ],
          },
          {
            heading: 'Koniec not korygujących (uchylenie art. 106k VAT) i rola duplikatów w KSeF',
            body: 'Od lutego 2026 r. wraz z wdrożeniem KSeF uchylono **art. 106k ustawy o VAT**, co oznacza **całkowitą likwidację not korygujących**! Nabywca nie ma już prawa samodzielnie poprawić literówki w adresie, nazwie firmy czy numerze NIP notą korygującą — każdą pomyłkę na fakturze poprawia wyłącznie sprzedawca poprzez wystawienie faktury korygującej (a w przypadku błędnego NIP na fakturze w KSeF stosuje się korektę błędnej faktury do zera i wystawienie nowej z prawidłowym NIP). Równocześnie dla faktur ustrukturyzowanych w KSeF zniknęła potrzeba wystawiania **duplikatów** (art. 106l VAT dotyczy wyłącznie faktur wystawionych poza KSeF, np. konsumenckich lub historycznych), ponieważ e-faktura w KSeF nie może zaginąć ani ulec zniszczeniu i można ją pobrać ponownie w dowolnej chwili przez 10 lat.',
            keyPoints: [
              'Nie myl zlikwidowanej noty korygującej (do faktur VAT) z **notą księgową obciążeniową/uznaniową** (np. na kary umowne czy odsetki poza VAT) — noty księgowe nadal funkcjonują poza KSeF!',
              'Anulowanie faktury bez korekty jest dopuszczalne wyłącznie wyjątkowo dla faktury papierowej/PDF poza KSeF, która nigdy nie weszła do obrotu prawnego (nie dotarła do nabywcy); faktury wysłanej do KSeF NIE DA SIĘ anulować ani usunąć — można ją tylko skorygować do zera!',
            ],
          },
        ],
        numericalExample: {
          title: 'Korekta in minus z tytułu rabatu jakościowego udzielonego w kolejnym miesiącu',
          scenario:
            'W marcu 2026 r. drukarnia sprzedała katalogi za 5 000,00 PLN netto + 1 150,00 PLN VAT (6 150,00 PLN brutto). W kwietniu klient zgłosił drobne przebarwienie okładki i strony uzgodniły rabat 20% — 10 kwietnia drukarnia wystawiła w KSeF fakturę korygującą in minus.',
          steps: [
            {
              stepNumber: 1,
              label: 'Wartość pierwotna zaksięgowana w marcu (netto)',
              calculation: 'Faktura pierwotna w PKPiR i JPK_V7M za marzec',
              amountPln: '5 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Kwota zmniejszenia przychodu netto w kwietniu (rabat 20%)',
              calculation:
                '-20% × 5 000,00 PLN (bieżące ujęcie w kwietniu — brak błędu pierwotnego)',
              amountPln: '-1 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Kwota zmniejszenia VAT należnego w kwietniu (w dacie KSeF)',
              calculation: '-20% × 1 150,00 PLN',
              amountPln: '-230,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Skorygowana kwota należności brutto do zapłaty przez klienta',
              calculation: '6 150,00 PLN − 1 230,00 PLN',
              amountPln: '4 920,00 PLN',
            },
          ],
          finalResultPln: '4 920,00 PLN',
          interpretation:
            'Ponieważ przyczyną korekty był rabat uzgodniony w kwietniu (a nie błąd rachunkowy z marca), drukarnia nie koryguje zamkniętego marca, lecz pomniejsza zarówno przychód w PKPiR, jak i podatek VAT należny na bieżąco w rozliczeniu za kwiecień.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef: 'art. 29a ust. 13–17, art. 86 ust. 19a–19d oraz art. 106j',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa zasady wystawiania faktur korygujących oraz moment ujęcia korekt in minus i in plus u sprzedawcy i nabywcy w KSeF.',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 14 ust. 1m–1p oraz art. 22 ust. 7c–7f',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Rozróżnia bieżące ujęcie korekt przychodów i kosztów (rabat, zwrot) od wstecznego ujęcia korekt spowodowanych błędem rachunkowym lub oczywistą omyłką.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm04-l02-kreator-faktury-korygujacej-ksef',
          '/invoices',
          'Widok wystawiania faktury korygującej powiązanej z numerem KSeF dokumentu pierwotnego oraz wyborem przyczyny korekty (rabat vs błąd pierwotny).',
          '[data-testid="credit-note-creator-panel"]',
        ),
        practicalExercise: {
          title: 'Rozlicz fakturę korygującą in minus i sprawdź wybór okresu księgowania',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W sekcji „Sprzedaż i zakupy” wybierz fakturę korygującą odebraną z KSeF od hurtowni papierniczej (zwrot części zamówienia).',
            'Zwróć uwagę na automatycznie wybrany powód korekty: „Zwrot towaru / rabat potransakcyjny (ujęcie bieżące)”.',
            'Sprawdź podgląd zmian przed zatwierdzeniem: pomniejszenie VAT naliczonego i kosztów w bieżącym okresie rozliczeniowym.',
          ],
          expectedOutcome:
            'Użytkownik prawidłowo odróżnia korektę rozliczaną na bieżąco od korekty błędu rachunkowego wymagającej cofnięcia się do okresu pierwotnego.',
        },
        commonMistakes: [
          {
            mistake:
              'Próba wystawienia noty korygującej w celu poprawienia adresu lub NIP na fakturze z 2026 roku.',
            consequence:
              'Dokument prawnie bezskuteczny — po uchyleniu art. 106k ustawy o VAT wyłącznie sprzedawca może skorygować dane na fakturze za pomocą faktury korygującej.',
            howToAvoid:
              'Po wykryciu błędu w danych kontrahenta wyślij do sprzedawcy prośbę o wystawienie faktury korygującej w KSeF.',
          },
          {
            mistake:
              'Ujęcie korekty in plus spowodowanej błędnym zaniżeniem ceny już na starcie transakcji w bieżącym miesiącu zamiast wstecznie.',
            consequence:
              'Zaniżenie podatku VAT i PIT za pierwotny miesiąc sprzedaży i ryzyko naliczenia odsetek podatkowych.',
            howToAvoid:
              'Zawsze odpowiadaj na pytanie kontrolne w systemie: „Czy przyczyna korekty istniała już w chwili wystawienia faktury pierwotnej?”.',
          },
          {
            mistake:
              'Wysłanie roboczego szkicu faktury bezpośrednio do KSeF bez przeglądu pozycji.',
            consequence:
              'Faktury przyjętej przez KSeF nie można skasować — nawet sekundę po wysyłce jedyną drogą odkręcenia pomyłki jest oficjalna faktura korygująca do zera.',
            howToAvoid:
              'Zawsze korzystaj z dwuetapowego trybu w aplikacji: „Zapisz szkic i podgląd” -> „Zatwierdź i wyślij do KSeF”.',
          },
        ],
        summary: [
          'Faktury wysłanej do KSeF nie da się usunąć ani „podmienić” — poprawia się ją wyłącznie fakturą korygującą.',
          'Noty korygujące do faktur VAT zostały zlikwidowane (uchylony art. 106k VAT); błędy formalne koryguje wystawca faktury.',
          'Rabaty i zwroty rozlicza się na bieżąco, natomiast błędy rachunkowe istniejące od początku transakcji wymagają korekty wstecznej.',
        ],
        quiz: [
          {
            id: 'q-04-02-01',
            question:
              'Nabywca otrzymał w maju 2026 r. fakturę z błędną nazwą ulicy swojej siedziby. W jaki sposób należy poprawić ten błąd?',
            options: [
              'Nabywca samodzielnie wystawia notę korygującą i wysyła ją do KSeF.',
              'Nabywca przekreśla adres długopisem na wydruku PDF i parafuje zmianę.',
              'Sprzedawca wystawia fakturę korygującą poprawiającą dane adresowe (noty korygujące zostały zlikwidowane wraz z uchyleniem art. 106k ustawy o VAT).',
              'Błędów adresowych w ogóle nie wolno korygować.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Po uchyleniu art. 106k ustawy o VAT nabywca nie może wystawiać not korygujących. Wszelkie błędy na fakturze — również formalne — koryguje wyłącznie sprzedawca fakturą korygującą.',
          },
          {
            id: 'q-04-02-02',
            question:
              'Co należy zrobić, gdy przedsiębiorca omyłkowo wyśle do KSeF fakturę dla niewłaściwego kontrahenta (błędny NIP), która nie dokumentowała rzeczywistej sprzedaży dla tego podmiotu?',
            options: [
              'Kliknąć przycisk „Usuń z serwera Ministerstwa Finansów” w ciągu 24 godzin.',
              'Wystawić fakturę korygującą „do zera” do błędnej faktury oraz wystawić nową, prawidłową fakturę dla właściwego nabywcy.',
              'Zignorować dokument, bo KSeF usuwa nieopłacone faktury po 30 dniach.',
              'Wystawić duplikat z innym numerem NIP.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Dokumentu przyjętego do KSeF nie można usunąć ani wycofać. Błędną fakturę należy wyzerować fakturą korygującą i wystawić nową fakturę z poprawnym numerem NIP właściwego nabywcy.',
          },
        ],
      },
      {
        id: 'lesson-04-03',
        slug: 'ksef-2-0-harmonogram-2026-fa3-offline24-archiwizacja',
        moduleNumber: 4,
        lessonNumber: 3,
        title:
          'KSeF 2.0 (FA(3)): harmonogram 2026, numer KSeF, tryb offline24 i 5-letnia archiwizacja',
        estimatedMinutes: 18,
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
            'Edukacja ogólna — odbiór faktur w KSeF oraz stopniowy obowiązek wystawiania faktur ustrukturyzowanych obejmuje zarówno vatowców, jak i podmioty zwolnione z VAT.',
        },
        intro:
          'Rok 2026 to największa cyfrowa zmiana w historii polskiego fakturowania: papierowe faktury i pliki PDF wysyłane mailem ustępują miejsca centralnej bazie Krajowego Systemu e-Faktur (KSeF) w strukturze XML FA(3). Zobaczmy dokładny kalendarz wdrożenia, procedurę na wypadek braku internetu (offline24) oraz regułę 5-letniego przechowywania dokumentów.',
        sections: [
          {
            heading: 'Harmonogram obowiązkowego KSeF w 2026 r. i struktura FA(3)',
            body: 'Obowiązkowy KSeF oparty o strukturę logiczną **FA(3)** wchodzi w życie etapowo: od **1 lutego 2026 r.** obowiązek wystawiania faktur w KSeF objął największych podatników (sprzedaż z VAT powyżej 200 mln zł w 2024 r.), ale uwaga — **od 1 lutego 2026 r. KAŻDY polski przedsiębiorca z numerem NIP (nawet jednoosobowa firma zwolniona z VAT!) musi już odbierać w KSeF faktury zakupowe** od takich dostawców (np. za prąd, telekomunikację, paliwo czy leasing)! Od **1 kwietnia 2026 r.** obowiązek wystawiania faktur B2B w KSeF obejmuje pozostałych przedsiębiorców (zarówno czynnych, jak i zwolnionych z VAT), z przejściowym wyłączeniem do **31 grudnia 2026 r.** tylko dla najmniejszych firm, u których łączna miesięczna wartość sprzedaży z VAT udokumentowana fakturami nie przekracza 10 000,00 PLN. Ponadto ustawodawca odroczył nakładanie kar pieniężnych za błędy w stosowaniu KSeF do **1 stycznia 2027 r.** Faktury konsumenckie (B2C dla osób fizycznych nieprowadzących działalności) pozostają w KSeF dobrowolne.',
            keyPoints: [
              'Faktura ustrukturyzowana zostaje uznana za wystawioną w dniu jej przesłania do KSeF, a za otrzymaną — w dniu przydzielenia jej unikalnego 35-znakowego **numeru KSeF**.',
              'Przy przelewach B2B między czynnymi podatnikami VAT (oraz przy MPP) od 2027 r. obowiązkowe staje się podawanie numeru KSeF (lub identyfikatora zbiorczego) w tytule przelewu.',
            ],
          },
          {
            heading: 'Tryb offline24, awaria KSeF, kody QR oraz 5-letnia archiwizacja podatkowa',
            body: 'Brak internetu lub chwilowe przeciążenie serwera nie zatrzymuje sprzedaży! Ustawa przewiduje **tryb offline24** (dostępny dla każdego podatnika z jego inicjatywy): wystawiasz fakturę zgodnie ze wzorem FA(3) lokalnie w aplikacji i masz obowiązek przesłać ją do KSeF **najpóźniej w następnym dniu roboczym** (natomiast podczas oficjalnie ogłoszonej **awarii KSeF** — w ciągu **7 dni roboczych** od zakończenia awarii). Jeśli wydajesz wizualizację takiej faktury offline klientowi przed nadaniem numeru KSeF (lub klientowi zagranicznemu / konsumentowi), dokument musi posiadać **dwa kody QR** („OFFLINE” oraz „CERTYFIKAT” wygenerowany na podstawie pobranego wcześniej certyfikatu wystawcy KSeF). A co z archiwizacją? Sam KSeF przechowuje e-faktury przez **10 lat** licząc od końca roku ich wystawienia, jednak całą pozostałą dokumentację księgową (wyciągi bankowe, umowy, listy płac, ewidencje, faktury spoza KSeF, dokumenty środków trwałych) musisz przechowywać do czasu przedawnienia zobowiązania podatkowego — czyli **5 lat licząc od końca roku kalendarzowego, w którym upłynął termin płatności podatku** (art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej)!',
            keyPoints: [
              'Uwaga na pułapkę „5 lat”: za rok podatkowy 2026 zeznanie PIT-36 składa się i opłaca do 30 kwietnia 2027 r. Koniec tego roku kalendarzowego to 31 grudnia 2027 r., a plus 5 lat oznacza obowiązek przechowywania dokumentów za 2026 rok aż do **31 grudnia 2032 roku** (czyli realnie prawie 7 lat od stycznia 2026 r.!).',
              'Dokumenty zakupu amortyzowanych środków trwałych (np. nieruchomości, maszyn) przechowuje się aż przez 5 lat od końca roku, w którym zakończono ich amortyzację!',
            ],
          },
        ],
        numericalExample: {
          title: 'Obliczenie realnego okresu archiwizacji ksiąg i dokumentów za styczeń 2026 r.',
          scenario:
            'Przedsiębiorca na KPiR kupił w styczniu 2026 r. materiały spoza KSeF (import usług z zagranicy na kwotę 4 500,00 PLN) i rozliczył je w zeznaniu rocznym PIT-36 za 2026 rok, którego termin płatności upływa 30 kwietnia 2027 r. Obliczmy koszt błędu w razie przedwczesnego zniszczenia dokumentacji w styczniu 2031 r.',
          steps: [
            {
              stepNumber: 1,
              label: 'Wartość kosztu wykazanego w KPiR w styczniu 2026 r.',
              calculation: 'Faktura zagraniczna importu usług ujęta w kosztach 2026 r.',
              amountPln: '4 500,00 PLN',
            },
            {
              stepNumber: 2,
              label:
                'Potencjalna dopłata podatku liniowego 19% w razie braku dowodu przy kontroli w 2032 r.',
              calculation: '4 500,00 PLN × 19% (okres przedawnienia upływa dopiero 31.12.2032 r.!)',
              amountPln: '855,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Szacunkowe 5-letnie odsetki za zwłokę (przykładowo ok. 50% zaległości)',
              calculation: 'Ok. 50% × 855,00 PLN za lata 2027–2032',
              amountPln: '427,50 PLN',
            },
          ],
          finalResultPln: '1 282,50 PLN',
          interpretation:
            'Zniszczenie dokumentów ze stycznia 2026 r. równo po 5 latach kalendarzowych (w styczniu 2031 r.) jest przedwczesne o prawie 2 lata! Zobowiązanie za 2026 rok przedawnia się dopiero z końcem 31 grudnia 2032 r.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef:
              'art. 106ga, art. 106nda (offline24), art. 106nf (awaria KSeF) oraz art. 112aa',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wprowadza obowiązek fakturowania w KSeF, tryb offline24 z wysyłką do następnego dnia roboczego, kody QR oraz 10-letnie przechowywanie faktur w KSeF.',
          },
          {
            actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
            articleRef: 'art. 70 § 1 oraz art. 86 § 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Zobowiązuje do przechowywania ksiąg i dokumentów do upływu 5-letniego okresu przedawnienia liczonego od końca roku kalendarzowego, w którym upłynął termin płatności podatku.',
          },
          {
            actTitle: 'Portal Krajowego Systemu e-Faktur Ministerstwa Finansów',
            articleRef: 'Zasady obowiązywania KSeF 2.0 i struktura FA(3)',
            sourceKind: 'official_guidance',
            officialUrl: 'https://ksef.podatki.gov.pl/',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Oficjalna dokumentacja harmonogramu wdrożenia (1.02.2026 / 1.04.2026), certyfikatów wystawcy i trybów offline.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm04-l03-synchronizacja-ksef-i-status-fa3',
          '/invoices',
          'Panel synchronizacji z KSeF pokazujący nadane numery KSeF, podgląd XML FA(3), sumę kontrolną SHA-256 i status archiwizacji.',
          '[data-testid="ksef-sync-status-panel"]',
        ),
        practicalExercise: {
          title:
            'Sprawdź odbiór faktury ustrukturyzowanej FA(3) z KSeF i jej niezmienny oryginał XML',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Otwórz zakładkę „Sprzedaż i zakupy” -> „Synchronizacja KSeF” w firmie demo Alfa.',
            'Wybierz zaimportowaną fakturę ustrukturyzowaną i porównaj czytelny podgląd wizualny z surowymi polami XML FA(3) oraz numerem KSeF.',
            'Sprawdź datę wygaśnięcia obowiązku archiwizacji podatkowej wyliczoną dla tego dokumentu (31.12.2032 r.).',
          ],
          expectedOutcome:
            'Użytkownik rozumie, czym jest 35-znakowy numer KSeF, jak działa tryb offline24 i jak długo należy archiwizować dokumentację podatkową.',
        },
        commonMistakes: [
          {
            mistake:
              'Przekonanie podatnika zwolnionego z VAT (art. 113), że KSeF w ogóle go nie dotyczy w 2026 roku.',
            consequence:
              'Nieodebranie faktur kosztowych za media, paliwo czy telefon, które duzi dostawcy od 1 lutego 2026 r. wystawiają wyłącznie w KSeF (bez wysyłania PDF na e-mail!).',
            howToAvoid:
              'Każda firma posiadająca NIP musi mieć skonfigurowany odbiór faktur z KSeF od lutego 2026 r., a wystawianie wg harmonogramu od kwietnia 2026 r. (lub po przekroczeniu progu przejściowego).',
          },
          {
            mistake:
              'Brak wcześniej pobranego certyfikatu wystawcy KSeF przed wystąpieniem awarii internetu.',
            consequence:
              'Niemożność wygenerowania wymaganego drugiego kodu QR („CERTYFIKAT”) przy wydawaniu wizualizacji faktury w trybie offline24.',
            howToAvoid:
              'Pobierz certyfikat offline KSeF zawczasu podczas konfiguracji integracji firmy, zanim zdarzy się awaria łącza.',
          },
          {
            mistake:
              'Kasowanie dokumentów podatkowych z 2026 r. z początkiem 2031 r. („bo minęło 5 lat”).',
            consequence:
              'Brak dowodów księgowych w trakcie ostatniego, szóstego/siódmego roku biegu terminu przedawnienia PIT/CIT.',
            howToAvoid:
              'Stosuj regułę: dla PIT za rok R przechowuj dokumenty minimum do końca roku `R + 6` (a przy rozliczaniu straty z lat ubiegłych lub amortyzacji — jeszcze dłużej!).',
          },
        ],
        summary: [
          'Od 1 lutego 2026 r. wszyscy przedsiębiorcy z NIP odbierają faktury w KSeF; obowiązek wystawiania wchodzi 1.02.2026 (>200 mln zł) i 1.04.2026 (pozostali, z przejściowym wyjątkiem mikro do końca 2026 r.).',
          'W trybie offline24 fakturę przesyła się do KSeF najpóźniej w następnym dniu roboczym, a wizualizacja dla nabywcy wymaga dwóch kodów QR.',
          'Dokumentację podatkową przechowuje się 5 lat licząc od końca roku kalendarzowego upływu terminu płatności podatku (dla PIT za 2026 r. aż do 31.12.2032 r.).',
        ],
        quiz: [
          {
            id: 'q-04-03-01',
            question:
              'W jakim terminie należy przesłać do KSeF fakturę wystawioną w trybie offline24 (z powodu chwilowego braku internetu u podatnika)?',
            options: [
              'W ciągu 30 dni kalendarzowych.',
              'Najpóźniej w następnym dniu roboczym po dniu jej wystawienia.',
              'Do 25. dnia kolejnego miesiąca przy wysyłce pliku JPK_V7M.',
              'Dopiero na wezwanie urzędu skarbowego.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 106nda ustawy o VAT fakturę wystawioną w trybie offline24 podatnik jest obowiązany przesłać do KSeF nie później niż w następnym dniu roboczym po dniu jej wystawienia.',
          },
          {
            id: 'q-04-03-02',
            question:
              'Do kiedy upływa ustawowy 5-letni okres przedawnienia i archiwizacji dokumentów dotyczących podatku PIT za rok 2026 (którego termin płatności przypada 30 kwietnia 2027 r.)?',
            options: [
              '31 grudnia 2030 r.',
              '30 kwietnia 2031 r.',
              '31 grudnia 2031 r.',
              '31 grudnia 2032 r.',
            ],
            correctOptionIndex: 3,
            explanation:
              'Termin płatności PIT za 2026 r. upływa w 2027 r. Pięć lat liczone od końca roku kalendarzowego 2027 (art. 70 § 1 i art. 86 § 1 Ordynacji podatkowej) kończy się 31 grudnia 2032 r.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 5,
    slug: 'podatkowa-ksiega-przychodow-i-rozchodow-kpir',
    title: 'Moduł 5: Podatkowa Księga Przychodów i Rozchodów (KPiR)',
    subtitle:
      'Opanuj praktyczne prowadzenie PKPiR po reformie 2026 roku (nowy układ kolumn z KSeF a dawne 17 kolumn), rozliczanie auta osobowego 50% VAT / 75% KUP oraz remanent roczny.',
    learningObjectives: [
      'Swobodnie poruszać się po kolumnach PKPiR — zarówno w nowym 19-kolumnowym wzorze od 2026 r. (z KSeF ID i NIP), jak i historycznym układzie 17 kolumn.',
      'Księgować sprzedaż, towary handlowe, pozostałe wydatki oraz samochód osobowy w użytku mieszanym (50% VAT i 75% KUP).',
      'Sporządzać remanent początkowy i końcowy (spis z natury) oraz korygować dochód roczny o różnicę remanentową.',
    ],
    lessons: [
      {
        id: 'lesson-05-01',
        slug: 'zasady-prowadzenia-pkpir-i-uklad-kolumn',
        moduleNumber: 5,
        lessonNumber: 1,
        title: 'Zasady prowadzenia PKPiR i układ kolumn (reforma 2026 a historyczne 17 kolumn)',
        estimatedMinutes: 17,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_kpir_skala', 'jdg_kpir_liniowy', 'spolka_cywilna_kpir'],
          scopeNote:
            'Dotyczy podatników PIT prowadzących Podatkową Księgę Przychodów i Rozchodów (skala podatkowa lub podatek liniowy).',
        },
        intro:
          'Podatkowa Księga Przychodów i Rozchodów (PKPiR) to najpopularniejsza ewidencja księgowa w Polsce — przypomina dobrze uporządkowaną tabelę, w której po jednej stronie zapisujesz sprzedaż, a po drugiej zakupy podzielone na kategorie. Uwaga: od 1 stycznia 2026 r. weszło w życie nowe rozporządzenie PKPiR dostosowane do KSeF i JPK_PKPIR!',
        sections: [
          {
            heading: 'Nowy 19-kolumnowy wzór PKPiR od 1 stycznia 2026 r. a dawne 17 kolumn',
            body: 'Przez ponad dwie dekady PKPiR liczyła **17 kolumn** (gdzie sprzedaż wpisywano w kol. 7, pozostałe przychody w kol. 8, razem przychód w kol. 9, zakup towarów handlowych w kol. 10, koszty uboczne zakupu w kol. 11, wynagrodzenia w kol. 12, a pozostałe wydatki w kol. 13). Od **1 stycznia 2026 r.** obowiązuje nowe Rozporządzenie Ministra Finansów i Gospodarki z 6 września 2025 r. (Dz.U. 2025 poz. 1299), które rozbudowało księgę do **19 kolumn**, dodając **kolumnę 3 na numer KSeF** oraz **kolumnę 5 na NIP kontrahenta**! Przesunęło to numerację o dwa oczka: w księdze od 2026 r. przychód ze sprzedaży towarów i usług to **kolumna 9** (dawna 7), pozostałe przychody to **kolumna 10** (dawna 8), razem przychód to **kolumna 11** (dawna 9), zakup towarów handlowych i materiałów to **kolumna 12** (dawna 10), koszty uboczne zakupu to **kolumna 13** (dawna 11), wynagrodzenia brutto to **kolumna 14** (dawna 12), pozostałe wydatki to **kolumna 15** (dawna 13), razem wydatki to **kolumna 16** (dawna 14), kolumna wolna to **17**, koszty B+R to **18** (dawna 16), a uwagi to **19** (dawna 17).',
            keyPoints: [
              'Znajomość obu numeracji jest bezcenna: przy księgowaniu 2026+ używasz układu 19-kolumnowego (z KSeF w kol. 3), a przy czytaniu ksiąg lub korekt za lata do 2025 r. spotkasz układ 17-kolumnowy!',
              'W naszej platformie nagłówki tabeli pokazują zawsze pełną nazwę ekonomiczną kolumny (np. „Sprzedaż towarów i usług”, „Pozostałe wydatki”), eliminując ryzyko pomyłki numeru.',
            ],
          },
          {
            heading: 'Metoda kasowa (uproszczona) a metoda memoriałowa ujmowania kosztów w KPiR',
            body: 'Przedsiębiorca prowadzący KPiR wybiera jedną z dwóch metod ujmowania kosztów w czasie (i musi ją stosować konsekwentnie przez cały rok podatkowy). Większość wybiera **metodę uproszczoną** (art. 22 ust. 4 i ust. 6b PIT — potocznie, choć myląco, zwaną „kasową”, mimo że nie zależy od zapłaty!): w tej metodzie koszty ujmuje się po prostu w dacie wystawienia faktury (dowodu księgowego), bez żmudnego dzielenia np. rocznej polisy ubezpieczeniowej na przełomie lat. Z kolei **metoda memoriałowa** (art. 22 ust. 5–5c PIT) wymaga dzielenia kosztów na bezpośrednie (przypisywane do roku osiągnięcia odpowiadającego im przychodu) oraz pośrednie (dzielone proporcjonalnie na lata podatkowe, jeśli dotyczą okresu przekraczającego rok, np. ubezpieczenia od lipca 2026 do czerwca 2027).',
            keyPoints: [
              'W metodzie uproszczonej KPiR za dzień poniesienia kosztu uważa się dzień wystawienia faktury (art. 22 ust. 6b ustawy o PIT), niezależnie od daty przelewu!',
              'Od 2026 r. czynni podatnicy VAT składający JPK_V7M mają obowiązek prowadzenia PKPiR wyłącznie elektronicznie w standardzie umożliwiającym wygenerowanie pliku JPK_PKPIR.',
            ],
          },
        ],
        numericalExample: {
          title: 'Podsumowanie miesiąca w kolumnach PKPiR (wzór 2026)',
          scenario:
            'Sklep internetowy (czynny podatnik VAT, KPiR) w czerwcu 2026 r. sprzedał towary za 25 000,00 PLN netto (kol. 9), otrzymał odsetki na koncie firmowym 40,00 PLN (kol. 10), zakupił towary handlowe za 12 000,00 PLN netto (kol. 12), zapłacił kurierowi za dostawę tych towarów do magazynu 400,00 PLN netto (kol. 13 — koszty uboczne zakupu) oraz opłacił księgowość i reklamę za 2 100,00 PLN netto (kol. 15 — pozostałe wydatki).',
          steps: [
            {
              stepNumber: 1,
              label: 'Razem przychód miesiąca — Kolumna 11 (kol. 9 + kol. 10)',
              calculation: '25 000,00 PLN (sprzedaż) + 40,00 PLN (odsetki bankowe)',
              amountPln: '25 040,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Zakup towarów handlowych i koszty uboczne (kol. 12 + kol. 13)',
              calculation: '12 000,00 PLN (towary) + 400,00 PLN (transport zakupu)',
              amountPln: '12 400,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Razem pozostałe wydatki i wynagrodzenia — Kolumna 16 (kol. 14 + kol. 15)',
              calculation: '0,00 PLN (wynagrodzenia) + 2 100,00 PLN (księgowość i reklama)',
              amountPln: '2 100,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Bieżący wynik miesiąca w KPiR (przychody minus suma kosztów)',
              calculation: '25 040,00 PLN − (12 400,00 PLN + 2 100,00 PLN)',
              amountPln: '10 540,00 PLN',
            },
          ],
          finalResultPln: '10 540,00 PLN',
          interpretation:
            'Rozdzielenie towarów handlowych i kosztów ubocznych (kol. 12 i 13) od pozostałych wydatków (kol. 15) jest kluczowe, ponieważ na koniec roku wartość towarów skoryguje jeszcze spis z natury (remanent).',
        },
        legalBasis: [
          {
            actTitle:
              'Rozporządzenie Ministra Finansów i Gospodarki z dnia 6 września 2025 r. w sprawie prowadzenia podatkowej księgi przychodów i rozchodów',
            articleRef: 'Dz.U. 2025 poz. 1299 — załącznik (wzór PKPiR kolumny 1–19 i objaśnienia)',
            sourceKind: 'statute',
            officialUrl: 'https://dziennikustaw.gov.pl/DU/2025/1299',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa obowiązujący od 1 stycznia 2026 r. elektroniczny wzór PKPiR uwzględniający numer KSeF (kol. 3) i NIP kontrahenta (kol. 5).',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 22 ust. 4–6b oraz art. 24a ust. 1 i ust. 1e',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje metodę uproszczoną i memoriałową ujmowania kosztów w PKPiR oraz obowiązek elektronicznego prowadzenia księgi i przesyłania JPK_PKPIR.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm05-l01-widok-tabeli-pkpir-kolumny',
          '/accounting/kpir',
          'Tabela Podatkowej Księgi Przychodów i Rozchodów z czytelnymi nagłówkami kolumn, numerami KSeF i sumowaniem strony oraz narastająco od początku roku.',
          '[data-testid="kpir-ledger-table"]',
        ),
        practicalExercise: {
          title:
            'Przejrzyj zapisy w tabeli PKPiR firmy demo i porównaj kolumnę towarów z pozostałymi wydatkami',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do sekcji „Księgowość” -> „PKPiR” w firmie demo Pracownia Projektowa Alfa.',
            'Sprawdź wypełnienie kolumny numeru KSeF oraz identyfikatora NIP dla faktur ustrukturyzowanych.',
            'Kliknij ikonę pomocy kontekstowej przy nagłówku kolumny „Pozostałe wydatki”, aby zobaczyć mapowanie wzoru 2026 (kol. 15) i wzoru do 2025 r. (kol. 13).',
          ],
          expectedOutcome:
            'Użytkownik bezbłędnie odróżnia przeznaczenie poszczególnych kolumn PKPiR w obu stanach prawnych.',
        },
        commonMistakes: [
          {
            mistake:
              'Wpisywanie zakupu wyposażenia biurowego (np. krzesła, drukarki, kawy do biura) w kolumnie „Zakup towarów handlowych i materiałów” zamiast w „Pozostałych wydatkach”.',
            consequence:
              'Błędne zakwalifikowanie kosztów ogólnych jako towarów do dalszej odsprzedaży, co zniekształca rozliczenie remanentowe.',
            howToAvoid:
              'Do kolumny towarów handlowych/materiałów wpisuj wyłącznie towary przeznaczone do dalszej odsprzedaży oraz surowce bezpośrednio zużywające się w wytwarzanym produkcie.',
          },
          {
            mistake:
              'Łączenie kosztów transportu sprzedanych już towarów do klienta z kosztami ubocznymi zakupu.',
            consequence:
              'Koszty uboczne zakupu (kol. 13 w 2026 / dawna kol. 11) dotyczą wyłącznie transportu PRZY ZAKUPIE towarów do Twojego magazynu; wysyłka kurierem sprzedanego towaru do Twojego klienta to „Pozostałe wydatki”!',
            howToAvoid:
              'Sprawdzaj kierunek przesyłki: dostawa towaru od hurtowni do Ciebie = koszty uboczne zakupu; wysyłka do Twojego klienta = pozostałe wydatki.',
          },
          {
            mistake:
              'Mieszanie metody uproszczonej i memoriałowej w trakcie tego samego roku podatkowego.',
            consequence:
              'Naruszenie zasady ciągłości wybranej metody potrącania kosztów w roku podatkowym.',
            howToAvoid:
              'Zdefiniuj metodę rozliczania kosztów w profilu firmy na początku roku i trzymaj się jej konsekwentnie dla wszystkich dokumentów.',
          },
        ],
        summary: [
          'Od 1 stycznia 2026 r. PKPiR ma 19 kolumn (dodano kol. 3 na numer KSeF i kol. 5 na NIP kontrahenta, przesuwając kolumny kwotowe o 2 miejsca względem dawnego wzoru 17-kolumnowego).',
          'Towary handlowe (do odsprzedaży) i koszty ich dostawy do magazynu ewidencjonuje się odrębnie od bieżących kosztów prowadzenia firmy („Pozostałe wydatki”).',
          'W metodzie uproszczonej KPiR koszty potrąca się co do zasady w dacie wystawienia dowodu księgowego.',
        ],
        quiz: [
          {
            id: 'q-05-01-01',
            question:
              'Które dwie nowe kolumny dodano do wzoru PKPiR obowiązującego od 1 stycznia 2026 r. (rozszerzając układ z 17 do 19 kolumn)?',
            options: [
              'Kolumnę kursu kryptowalut oraz kolumnę podpisu biura rachunkowego.',
              'Kolumnę numeru identyfikującego fakturę w KSeF (kol. 3) oraz kolumnę identyfikatora podatkowego kontrahenta NIP (kol. 5).',
              'Kolumnę podatku akcyzowego oraz kolumnę cła.',
              'Kolumnę składek PPK oraz kolumnę dywidend.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Rozporządzenie z 6 września 2025 r. (Dz.U. 2025 poz. 1299) wprowadziło kolumnę 3 na numer KSeF oraz kolumnę 5 na identyfikator podatkowy (NIP) kontrahenta.',
          },
          {
            id: 'q-05-01-02',
            question:
              'W której kategorii kolumn PKPiR firma usługowa (np. grafik komputerowy) ujmuje fakturę za wynajem biura i abonament telefoniczny?',
            options: [
              'Zakup towarów handlowych i materiałów podstawowych.',
              'Koszty uboczne zakupu.',
              'Pozostałe wydatki (kolumna 15 w układzie od 2026 r. / dawna kolumna 13).',
              'Koszty działalności badawczo-rozwojowej.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Czynsz za biuro, media, telekomunikacja, księgowość czy paliwo to bieżące koszty funkcjonowania firmy ujmowane w kolumnie „Pozostałe wydatki”.',
          },
        ],
      },
      {
        id: 'lesson-05-02',
        slug: 'ksiegowanie-sprzedazy-towarow-wydatkow-i-samochodu-w-kpir',
        moduleNumber: 5,
        lessonNumber: 2,
        title:
          'Księgowanie w KPiR w praktyce oraz samochód osobowy (50% VAT, 75% KUP i limity 2026)',
        estimatedMinutes: 18,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'spolka_cywilna_kpir',
            'vat_czynny',
          ],
          scopeNote:
            'Szczegółowa instrukcja księgowania dla podatników KPiR i czynnych podatników VAT wykorzystujących samochód osobowy w działalności.',
        },
        intro:
          'Faktura za paliwo lub serwis samochodu osobowego na 369,00 zł brutto to klasyczny egzamin praktyczny każdego księgowego. Dlaczego nie wrzucamy do KPiR po prostu kwoty netto z faktury? Ponieważ przy użytku mieszanym auta osobowego spotykają się jednocześnie dwa ograniczenia: 50% w ustawie o VAT oraz 75% w ustawie o PIT!',
        sections: [
          {
            heading: 'Złoty wzór na eksploatację auta w użytku mieszanym: 50% VAT i 75% KUP',
            body: 'Jeżeli samochód osobowy w firmie służy zarówno działalności, jak i celom prywatnym (czyli nie zgłosiłeś go formularzem VAT-26 do urzędu skarbowego i nie prowadzisz szczegółowej kilometrówki dla VAT), przysługuje Ci prawo do odliczenia **50% podatku VAT** z faktur za paliwo, myjnię, opony, części i naprawy (art. 86a ust. 1 ustawy o VAT). Co dzieje się z drugą, **nieodliczoną połową VAT**? Zgodnie z art. 23 ust. 1 pkt 43 PIT nieodliczony VAT powiększa wartość wydatku! Dopiero od tej łącznej kwoty (`netto + 50% nieodliczonego VAT`) obliczasz **75%**, które trafia jako koszt uzyskania przychodów do KPiR (art. 23 ust. 1 pkt 46a PIT — pozostałe 25% to wydatek NKUP odpowiadający ryczałtowo użytkowi prywatnemu)! Natomiast jeśli używasz w firmie prywatnego samochodu osobowego niewprowadzonego do ewidencji środków trwałych, do KPiR zaliczysz jedynie **20%** wydatków eksploatacyjnych (w tym ubezpieczenia).',
            keyPoints: [
              'Krok 1 (VAT): odliczasz 50% VAT w rejestrze zakupów VAT.',
              'Krok 2 (Baza kosztowa): dodajesz kwotę netto + drugie 50% nieodliczonego VAT.',
              'Krok 3 (KPiR): mnożysz bazę kosztową razy 75% i tę kwotę wpisujesz do kolumny „Pozostałe wydatki”!',
            ],
          },
          {
            heading:
              'Limity amortyzacji i leasingu samochodów osobowych od 2026 r. (100 tys. / 150 tys. / 225 tys. zł)',
            body: 'Limit 75% dotyczy bieżącej eksploatacji (paliwo, serwis, części). Osobne ograniczenie kwotowe dotyczy samego nabycia auta (odpisów amortyzacyjnych oraz części kapitałowej rat leasingu operacyjnego i najmu długoterminowego) oraz ubezpieczenia AC! Od **1 stycznia 2026 r.** obowiązują trzy progi zależne od emisji CO₂ pojazdu wg danych CEPiK: **225 000,00 PLN** dla aut elektrycznych i wodorowych, **150 000,00 PLN** dla aut spalinowych/hybryd o emisji CO₂ **poniżej 50 g/km** (np. wybrane hybrydy plug-in) oraz **100 000,00 PLN** dla standardowych aut spalinowych i hybryd o emisji CO₂ **50 g/km lub wyższej**! Część odsetkowa raty leasingowej nie podlega temu limitowi kwotowemu i wchodzi w KUP w 100%, a przy opłacie za ubezpieczenie AC limit wynosi 150 000 zł wartości auta.',
            keyPoints: [
              'Wartość auta do limitu 100 000 / 150 000 / 225 000 zł liczy się razem z nieodliczoną częścią podatku VAT!',
              'Do samej raty kapitałowej leasingu (jeśli na fakturze nie wliczono w nią ryczałtu serwisowego) NIE stosuje się redukcji 75% — stosuje się wyłącznie proporcję limitu wartości pojazdu (100/150/225 tys. zł)!',
            ],
          },
        ],
        numericalExample: {
          title:
            'Dokładne księgowanie faktury za paliwo 369,00 PLN brutto (auto w leasingu / ŚT — użytek mieszany)',
          scenario:
            'Czynny podatnik VAT prowadzący KPiR zatankował firmowy samochód osobowy (użytek mieszany) na kwotę 300,00 PLN netto + 69,00 PLN VAT = 369,00 PLN brutto. Obliczmy kwotę VAT do odliczenia oraz kwotę KUP do wpisania w KPiR.',
          steps: [
            {
              stepNumber: 1,
              label: 'VAT naliczony do odliczenia w JPK_V7 (50% VAT)',
              calculation: '50% × 69,00 PLN',
              amountPln: '34,50 PLN',
            },
            {
              stepNumber: 2,
              label: 'Kwota netto powiększona o nieodliczony VAT (baza dla PIT)',
              calculation: '300,00 PLN (netto) + 34,50 PLN (nieodliczone 50% VAT)',
              amountPln: '334,50 PLN',
            },
            {
              stepNumber: 3,
              label: 'Koszt uzyskania przychodów w KPiR (75% bazy)',
              calculation: '75% × 334,50 PLN = 250,875 PLN -> zaokrąglenie księgowe do grosza',
              amountPln: '250,88 PLN',
            },
            {
              stepNumber: 4,
              label: 'Część wyłączona z kosztów jako NKUP (25% bazy)',
              calculation: '334,50 PLN − 250,88 PLN',
              amountPln: '83,62 PLN',
            },
          ],
          finalResultPln: '250,88 PLN',
          interpretation:
            'Z faktury paliwowej na 369,00 PLN brutto podatnik odlicza w JPK_V7 kwotę 34,50 PLN podatku VAT, a do kolumny „Pozostałe wydatki” w PKPiR wpisuje dokładnie 250,88 PLN (a nie 300,00 PLN ani 225,00 PLN!).',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef: 'art. 86a ust. 1–4',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Ustanawia 50% odliczenie podatku VAT od wydatków związanych z pojazdami samochodowymi w użytku mieszanym oraz warunki 100% odliczenia (VAT-26 i ewidencja przebiegu).',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 23 ust. 1 pkt 4, pkt 46, pkt 46a oraz pkt 47a',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje limit 75% KUP dla eksploatacji auta firmowego (20% dla prywatnego) oraz limity 100 000 zł / 150 000 zł / 225 000 zł dla amortyzacji i leasingu aut osobowych wg emisji CO₂.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm05-l02-kalkulator-faktury-samochodowej-50-75',
          '/documents',
          'Podgląd automatycznego rozbicia faktury paliwowej na 50% VAT odliczalnego oraz 75% kosztu KUP (netto + nieodliczony VAT) przed zatwierdzeniem wpisu.',
          '[data-testid="vehicle-mixed-use-split-preview"]',
        ),
        practicalExercise: {
          title: 'Zaksięguj fakturę za przegląd i paliwo samochodu osobowego w użytku mieszanym',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W sekcji „Dokumenty” otwórz fakturę za serwis klimatyzacji i paliwo samochodu firmowego oznaczoną kategorią „Pojazd osobowy — użytek mieszany”.',
            'Kliknij „Dlaczego?” przy wyliczonej kwocie KUP i porównaj krok po kroku: 50% VAT -> netto + nieodliczony VAT -> 75% do KPiR.',
            'Zatwierdź dokument i sprawdź, że właściwe kwoty zasiliły równocześnie Rejestr Zakupów VAT oraz PKPiR.',
          ],
          expectedOutcome:
            'Użytkownik bezbłędnie księguje wydatki samochodowe z zachowaniem reguł art. 86a VAT i art. 23 ust. 1 pkt 46a PIT.',
        },
        commonMistakes: [
          {
            mistake:
              'Liczenie 75% KUP wyłącznie od samej kwoty netto z faktury (pomijanie nieodliczonego 50% VAT).',
            consequence:
              'Niepotrzebne zaniżenie własnych kosztów podatkowych i zawyżenie podatku PIT — nieodliczony VAT legalnie zwiększa bazę, od której liczy się 75%!',
            howToAvoid:
              'Zawsze korzystaj z wbudowanego w aplikację profilu rozliczeniowego pojazdu („Użytek mieszany 50% VAT / 75% KUP”).',
          },
          {
            mistake:
              'Deklarowanie 100% odliczenia VAT od samochodu osobowego bez złożenia VAT-26 w terminie i bez prowadzenia rygorystycznej kilometrówki ze stanem licznika.',
            consequence:
              'Zakwestionowanie 50% całego odliczonego VAT od zakupu/leasingu i paliwa wraz z odsetkami i sankcją VAT podczas kontroli.',
            howToAvoid:
              'Stosuj 100% odliczenia VAT od auta osobowego wyłącznie wtedy, gdy realnie wykluczasz użytek prywatny regulaminem, składasz VAT-26 i prowadzisz bieżącą ewidencję przebiegu pojazdu.',
          },
          {
            mistake:
              'Przyjęcie starego limitu 150 000,00 PLN dla nowego auta spalinowego z emisją CO₂ >= 50 g/km w 2026 roku.',
            consequence:
              'Zawyżenie kosztów leasingu lub amortyzacji o połowę nadwyżki ponad nowy limit 100 000,00 PLN obowiązujący od 1 stycznia 2026 r.',
            howToAvoid:
              'W karcie pojazdu wprowadź emisję CO₂ z dowodu rejestracyjnego / CEPiK, aby system zastosował właściwy próg 100 000 / 150 000 / 225 000 PLN.',
          },
        ],
        summary: [
          'Przy samochodzie osobowym w użytku mieszanym odliczasz 50% VAT, a do KPiR wpisujesz 75% sumy (netto + nieodliczone 50% VAT).',
          'Dla prywatnego auta właściciela niewprowadzonego do środków trwałych limit KUP w JDG wynosi 20% wydatków.',
          'Od 2026 r. limity leasingu i amortyzacji aut osobowych wynoszą: 225 000 zł (EV/wodór), 150 000 zł (CO₂ < 50 g/km) i 100 000 zł (CO₂ >= 50 g/km).',
        ],
        quiz: [
          {
            id: 'q-05-02-01',
            question:
              'Czynny podatnik VAT kupił opony do firmowego samochodu osobowego w użytku mieszanym za 1 000,00 PLN netto + 230,00 PLN VAT (1 230,00 PLN brutto). Jaką kwotę wpisze w koszty KPiR?',
            options: [
              '750,00 PLN (75% z 1 000,00 PLN netto).',
              '836,25 PLN (75% z sumy 1 000,00 PLN netto + 115,00 PLN nieodliczonego VAT).',
              '1 000,00 PLN (100% netto).',
              '615,00 PLN (50% z kwoty brutto).',
            ],
            correctOptionIndex: 1,
            explanation:
              'Odliczeniu w VAT podlega 50% × 230,00 PLN = 115,00 PLN. Druga połowa VAT (115,00 PLN) powiększa kwotę netto do 1 115,00 PLN, a 75% × 1 115,00 PLN = 836,25 PLN stanowi koszt uzyskania przychodów w KPiR.',
          },
          {
            id: 'q-05-02-02',
            question:
              'Jaki limit podatkowy dla części kapitałowej rat leasingowych i amortyzacji obowiązuje od 1 stycznia 2026 r. dla typowego samochodu benzynowego o emisji CO₂ wynoszącej 135 g/km?',
            options: [
              '225 000,00 PLN',
              '150 000,00 PLN',
              '100 000,00 PLN',
              'Brak jakiegokolwiek limitu kwotowego.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Od 1 stycznia 2026 r. dla samochodów osobowych o emisji CO₂ równej lub wyższej niż 50 g/km obowiązuje limit 100 000,00 PLN (150 000,00 PLN dotyczy emisji poniżej 50 g/km, a 225 000,00 PLN pojazdów elektrycznych i wodorowych).',
          },
        ],
      },
      {
        id: 'lesson-05-03',
        slug: 'remanent-poczatkowy-koncowy-i-typowe-bledy-w-kpir',
        moduleNumber: 5,
        lessonNumber: 3,
        title: 'Spis z natury (remanent początkowy i końcowy) oraz najczęstsze błędy w KPiR',
        estimatedMinutes: 15,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_kpir_skala', 'jdg_kpir_liniowy', 'spolka_cywilna_kpir'],
          scopeNote:
            'Dotyczy wszystkich podatników prowadzących PKPiR — w tym firm czysto usługowych zobowiązanych do wykazania remanentu „zerowego”.',
        },
        intro:
          'Wyobraź sobie, że 29 grudnia kupujesz za 50 000 zł towar do sklepu, żeby wyzerować swój podatek dochodowy za mijający rok, a towar leży nietknięty na półkach w sylwestra. Czy ten trik zadziała? Nie! Właśnie po to w KPiR istnieje obowiązkowy spis z natury (remanent), który wyłącza z kosztów roku niesprzedane zapasy magazynowe.',
        sections: [
          {
            heading: 'Jak działa spis z natury na 1 stycznia i 31 grudnia',
            body: 'W trakcie roku zakupy towarów handlowych i materiałów wpisujesz do KPiR od razu w dacie faktury. Na koniec dnia **31 grudnia** (oraz na dzień rozpoczęcia działalności, likwidacji lub zmiany wspólnika) każdy podatnik prowadzący KPiR ma obowiązek sporządzić i wpisać do księgi **spis z natury (remanent)** obejmujący fizycznie policzone towary handlowe, materiały (surowce) podstawowe i pomocnicze, półwyroby, produkcję w toku, wyroby gotowe oraz braki i odpady — wycenione według cen zakupu lub nabycia (albo cen rynkowych, jeśli są niższe). Nawet jeżeli prowadzisz firmę w 100% usługową (np. programista, lekarz, doradca) i nie posiadasz żadnych towarów handlowych, masz obowiązek sporządzić spis z natury o wartości **0,00 PLN** i wpisać go do księgi! Remanent końcowy z 31 grudnia staje się automatycznie remanentem początkowym na 1 stycznia kolejnego roku.',
            keyPoints: [
              'Jeżeli remanent końcowy jest WYŻSZY niż początkowy (zostało więcej niesprzedanego towaru w magazynie), różnica POMNIEJSZA koszty roku i ZWIĘKSZA dochód do opodatkowania!',
              'Jeżeli remanent końcowy jest NIŻSZY niż początkowy (wyprzedałeś towary kupione w poprzednim roku), różnica POWIĘKSZA koszty roku i OBNIŻA dochód do opodatkowania!',
            ],
          },
          {
            heading: 'Najczęstsze błędy prowadzenia KPiR w praktyce',
            body: 'Poza pominięciem zerowego remanentu w firmach usługowych przedsiębiorcy najczęściej popełniają cztery błędy w KPiR: (1) wpisują do spisu z natury wyposażenie biura i środki trwałe (np. laptopa czy biurko — a spis obejmuje wyłącznie towary handlowe, materiały i produkcję!), (2) zapominają doliczyć do wyceny remanentu proporcjonalnych kosztów ubocznych zakupu (transportu towarów), (3) księgują różnice kursowe nieudokumentowane faktyczną zapłatą lub według kursu z niewłaściwego dnia (powinien to być średni kurs NBP z ostatniego dnia roboczego poprzedzającego dzień wystawienia faktury / poniesienia kosztu), oraz (4) ujmują składki ZUS w kosztach w dacie deklaracji zamiast w dacie ich faktycznego opłacenia.',
            keyPoints: [
              'Środki trwałe i wyposażenie biura NIGDY nie wchodzą do spisu z natury (remanentu)!',
              'Składki ZUS oraz wynagrodzenia stanowią koszt podatkowy (lub podlegają odliczeniu) wyłącznie pod warunkiem faktycznej zapłaty w terminie.',
            ],
          },
        ],
        numericalExample: {
          title:
            'Wpływ różnicy remanentów na roczny dochód sklepu z zabawkami (art. 24 ust. 2 PIT)',
          scenario:
            'Sklep z zabawkami w 2026 roku osiągnął przychód 300 000,00 PLN. Remanent początkowy na 1.01.2026 r. wynosił 20 000,00 PLN. W ciągu roku kupiono towary za 160 000,00 PLN oraz poniesiono pozostałe wydatki (czynsz, księgowość) 40 000,00 PLN. Na dzień 31.12.2026 r. w magazynie zostały niesprzedane zabawki o wartości 55 000,00 PLN (remanent końcowy).',
          steps: [
            {
              stepNumber: 1,
              label: 'Suma kosztów ujętych w kolumnach KPiR przed korektą remanentową',
              calculation: '160 000,00 PLN (zakup towarów) + 40 000,00 PLN (pozostałe wydatki)',
              amountPln: '200 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Korekta kosztów o różnicę remanentów (Początkowy − Końcowy)',
              calculation:
                '20 000,00 PLN (1.01) − 55 000,00 PLN (31.12) = -35 000,00 PLN (wyłączenie niesprzedanego towaru z kosztów 2026 r.)',
              amountPln: '-35 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Rzeczywiste koszty uzyskania przychodów roku 2026 po remanencie',
              calculation: '200 000,00 PLN − 35 000,00 PLN',
              amountPln: '165 000,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Roczny dochód podatkowy sklepu wg art. 24 ust. 2 PIT',
              calculation:
                '300 000,00 PLN (przychód) − 165 000,00 PLN (koszty skorygowane remanentem)',
              amountPln: '135 000,00 PLN',
            },
          ],
          finalResultPln: '135 000,00 PLN',
          interpretation:
            'Bez spisu z natury dochód wynosiłby pozornie 100 000,00 PLN. Ponieważ jednak magazyn wzrósł o 35 000,00 PLN niesprzedanych zabawek, dochód podatkowy za 2026 r. wynosi 135 000,00 PLN, a te 55 000,00 PLN przejdzie jako remanent początkowy i obniży podatek w 2027 r., gdy zabawki zostaną sprzedane.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 24 ust. 2',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Definiuje algorytm ustalania dochodu rocznego u podatników prowadzących PKPiR z uwzględnieniem różnicy pomiędzy wartością remanentu końcowego i początkowego.',
          },
          {
            actTitle:
              'Rozporządzenie Ministra Finansów i Gospodarki z dnia 6 września 2025 r. w sprawie prowadzenia podatkowej księgi przychodów i rozchodów',
            articleRef:
              'Dz.U. 2025 poz. 1299 — przepisy o spisie z natury i wycenie w terminie 14 dni',
            sourceKind: 'statute',
            officialUrl: 'https://dziennikustaw.gov.pl/DU/2025/1299',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa obowiązkowe elementy spisu z natury, terminy jego sporządzenia oraz zasady wyceny składników majątku obrotowego.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm05-l03-zamkniecie-roku-i-remanent-kpir',
          '/accounting/kpir',
          'Kreator rocznego spisu z natury (remanentu) w module PKPiR z podglądem wpływu różnicy remanentowej na roczną podstawę PIT.',
          '[data-testid="kpir-annual-inventory-summary"]',
        ),
        practicalExercise: {
          title: 'Wprowadź zerowy spis z natury dla firmy usługowej na koniec roku podatkowego',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W module „Księgowość” -> „PKPiR” otwórz zakładkę „Spis z natury (remanent)”.',
            'Utwórz protokół spisu z natury na dzień 31 grudnia z wartością 0,00 PLN (brak towarów handlowych i materiałów w pracowni projektowej).',
            'Sprawdź wygenerowany wpis podsumowujący zamknięcie roku w PKPiR oraz automatyczne przeniesienie bilansu otwarcia na 1 stycznia.',
          ],
          expectedOutcome:
            'Księga posiada formalnie wymagany wpis remanentu początkowego i końcowego, co pozwala poprawnie wygenerować roczny plik JPK_PKPIR i PIT-36.',
        },
        commonMistakes: [
          {
            mistake:
              'Całkowite pominięcie spisu z natury 31 grudnia przez programistę, lekarza lub prawnika („bo nie handluję towarem”).',
            consequence:
              'Formalna wadliwość księgi — rozporządzenie nakazuje sporządzenie i wpisanie spisu z natury każdemu podatnikowi na KPiR, również wtedy, gdy wartość zapasów wynosi 0,00 PLN.',
            howToAvoid:
              'Każdego 31 grudnia zatwierdź w aplikacji protokół zerowego spisu z natury jednym kliknięciem.',
          },
          {
            mistake:
              'Wpisanie do spisu z natury komputerów, telefonów i mebli używanych na potrzeby własne biura.',
            consequence:
              'Sztuczne zawyżenie remanentu końcowego i zapłacenie nienależnego podatku dochodowego od wyposażenia, które już słusznie było kosztem w kolumnie „Pozostałe wydatki”.',
            howToAvoid:
              'Pamiętaj: w spisie z natury ujmujesz wyłącznie składniki z kolumny towarów handlowych/materiałów oraz własną produkcję.',
          },
          {
            mistake:
              'Przeliczanie faktur walutowych według kursu z dnia wystawienia faktury zamiast z ostatniego dnia roboczego POPRZEDZAJĄCEGO dzień wystawienia faktury.',
            consequence: 'Błędna kwota przychodu/kosztu w PLN na każdym dokumencie walutowym.',
            howToAvoid:
              'Korzystaj z automatycznej tabeli średnich kursów NBP z dnia `D-1 roboczego` zaszytej w aplikacji.',
          },
        ],
        summary: [
          'Spis z natury (remanent) sporządza się obowiązkowo na rozpoczęcie działalności, na 31 grudnia każdego roku oraz na 1 stycznia (nawet gdy wynosi 0,00 PLN).',
          'Wzrost wartości magazynu na koniec roku pomniejsza koszty podatkowe danego roku, natomiast spadek magazynu powiększa koszty.',
          'Wyposażenie i środki trwałe firmy nie wchodzą w skład remanentu towarów handlowych.',
        ],
        quiz: [
          {
            id: 'q-05-03-01',
            question:
              'Czy jednoosobowa firma świadcząca wyłącznie usługi doradcze i nieposiadająca żadnych towarów handlowych musi sporządzić spis z natury na 31 grudnia w PKPiR?',
            options: [
              'Nie, firmy usługowe są całkowicie zwolnione z tego obowiązku.',
              'Tak — ma obowiązek sporządzić tzw. zerowy spis z natury (o wartości 0,00 PLN) i ująć go w księdze.',
              'Tylko wtedy, gdy przekroczy 240 000,00 PLN obrotu.',
              'Tylko raz na 5 lat.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Przepisy rozporządzenia w sprawie PKPiR nie przewidują zwolnienia dla firm usługowych — sporządzają one i wpisują do księgi spis z natury wykazujący wartość 0,00 PLN.',
          },
          {
            id: 'q-05-03-02',
            question:
              'Jak wpływa na roczny dochód w KPiR sytuacja, w której remanent końcowy na 31 grudnia (80 000,00 PLN) jest wyższy niż remanent początkowy z 1 stycznia (30 000,00 PLN)?',
            options: [
              'Obniża dochód do opodatkowania o 50 000,00 PLN.',
              'Zwiększa dochód do opodatkowania o 50 000,00 PLN (ponieważ niesprzedane towary zostają wyłączone z kosztów bieżącego roku).',
              'Nie ma żadnego wpływu na dochód.',
              'Powoduje obowiązek przejścia na pełne księgi rachunkowe.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 24 ust. 2 ustawy o PIT nadwyżka remanentu końcowego nad początkowym (50 000,00 PLN) pomniejsza roczne koszty uzyskania przychodów, a tym samym zwiększa dochód podlegający opodatkowaniu.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 6,
    slug: 'ryczalt-od-przychodow-ewidencjonowanych',
    title: 'Moduł 6: Ryczałt od przychodów ewidencjonowanych',
    subtitle:
      'Poznaj uproszczoną ewidencję przychodów, mapę stawek ryczałtu od 3% do 17% wg PKWiU, odliczenie 50% składki zdrowotnej oraz policz, kiedy ryczałt pomaga, a kiedy szkodzi.',
    learningObjectives: [
      'Prawidłowo prowadzić Ewidencję Przychodów i dobierać stawkę ryczałtu na podstawie klasyfikacji PKWiU (nie PKD!).',
      'Stosować wyłączenia ustawowe z art. 8 ustawy o ryczałcie oraz proporcjonalne odliczanie ZUS i 50% składki zdrowotnej.',
      'Wyliczyć próg rentowności kosztowej ryczałtu względem skali podatkowej i podatku liniowego.',
    ],
    lessons: [
      {
        id: 'lesson-06-01',
        slug: 'zasady-ewidencji-przychodow-i-stawki-ryczaltu',
        moduleNumber: 6,
        lessonNumber: 1,
        title: 'Ewidencja przychodów bez kosztów i przegląd stawek ryczałtu (od 3% do 17%)',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_ryczalt'],
          scopeNote:
            'Dotyczy osób fizycznych (oraz spółek cywilnych i jawnych osób fizycznych) opodatkowanych ryczałtem od przychodów ewidencjonowanych.',
        },
        intro:
          'Ryczałt od przychodów ewidencjonowanych kusi niezwykłą prostotą: nie zbierasz faktur kosztowych do podatku dochodowego, bo płacisz stały procent od samego przychodu netto. Cały sekret bezpieczeństwa na ryczałcie tkwi jednak w prawidłowym dopasowaniu świadczonej usługi do kodu PKWiU — bo różnica między stawką 8,5%, 12% a 15% potrafi wynosić dziesiątki tysięcy złotych rocznie.',
        sections: [
          {
            heading: 'Zasady Ewidencji Przychodów i limit 2 000 000 euro',
            body: 'Podatnik na ryczałcie prowadzi uproszczoną **Ewidencję Przychodów** (w której przypisuje każdy przychód do właściwej kolumny stawkowej) oraz wykaz środków trwałych, ale nie księguje w niej kosztów uzyskania przychodów (uwaga: jeśli ryczałtowiec jest jednocześnie czynnym podatnikiem VAT, nadal normalnie zbiera faktury zakupowe i odlicza z nich podatek VAT w rejestrze zakupów VAT!). Prawo do kontynuowania ryczałtu w kolejnym roku mają podatnicy, których przychody w poprzednim roku nie przekroczyły równowartości **2 000 000 euro** (dla 2026 r. po kursie NBP 4,2586 zł/euro z 1.10.2025 r. limit ten wynosi **8 517 200,00 PLN**). Co więcej, jeżeli prowadzisz kilka rodzajów działalności (np. programowanie i sprzedaż kursów online), możesz stosować różne stawki ryczałtu na tej samej lub osobnych fakturach — pod warunkiem prowadzenia ewidencji w sposób umożliwiający wyodrębnienie przychodów dla każdej stawki!',
            keyPoints: [
              'O stawce ryczałtu decyduje **PKWiU** (Polska Klasyfikacja Wyrobów i Usług z 2015 r.) faktycznie wykonywanej czynności, a nie ogólny kod PKD wpisany w CEIDG!',
              'Brak wyodrębnienia w ewidencji przychodów opodatkowanych różnymi stawkami grozi zastosowaniem najwyższej stawki z prowadzonych działalności (lub sankcyjnej wielokrotności przy braku ewidencji).',
            ],
          },
          {
            heading: 'Mapa najważniejszych stawek ryczałtu w art. 12 ustawy',
            body: 'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym przewiduje szeroką paletę stawek: **17%** dla wolnych zawodów wykonywanych osobiście (np. tłumacze, adwokaci, notariusze, doradcy podatkowi, księgowi bez zatrudniania personelu merytorycznego); **15%** dla usług reklamowych, badania rynku, doradztwa w zakresie zarządzania (PKWiU 70.22), pośrednictwa w sprzedaży hurtowej i fotografii; **14%** dla usług architektonicznych, inżynierskich, badań technicznych oraz opieki zdrowotnej; **12%** dla usług związanych z wydawaniem oprogramowania, doradztwem w zakresie informatyki i oprogramowania (PKWiU 62.01 / 62.02.20 / instalacja oprogramowania); **8,5% / 12,5%** dla najmu, dzierżawy, zakwaterowania i usług badawczo-rozwojowych (8,5% do 100 000 zł przychodu rocznie i 12,5% od nadwyżki); **8,5%** dla większości pozostałych usług (w tym edukacji, gastronomii bez alkoholu pow. 1,5%, wybranych usług wsparcia IT typu helpdesk / testy manualne niewiążące się z programowaniem — warto potwierdzać je informacją GUS i interpretacją KIS!); **5,5%** dla robót budowlanych, działalności wytwórczej i transportu ciężarowego pow. 2 ton; oraz **3%** dla działalności usługowej w zakresie handlu!',
            keyPoints: [
              'W branży IT granica między 12% (tworzenie oprogramowania / doradztwo w zakresie sprzętu i oprogramowania) a 8,5% (wybrane usługi techniczne niebędące programowaniem ani doradztwem) jest najczęstszym przedmiotem kontroli — w razie wątpliwości wystąp o opinię klasyfikacyjną GUS i interpretację indywidualną KIS (opłata 40 zł).',
              'Ryczałtowiec nadal ma obowiązek przechowywać dowody zakupu towarów handlowych!',
            ],
          },
        ],
        numericalExample: {
          title: 'Rozliczenie miesiąca przy dwóch stawkach ryczałtu jednocześnie (12% oraz 8,5%)',
          scenario:
            'Właścicielka Studia Kodowania Beta (czynna podatniczka VAT na ryczałcie) wystawiła w lipcu 2026 r. fakturę za wytworzenie aplikacji mobilnej na 15 000,00 PLN netto (stawka 12%) oraz fakturę za przeprowadzenie warsztatów szkoleniowych dla juniorów (usługi edukacyjne PKWiU 85.59) na 5 000,00 PLN netto (stawka 8,5%). Pomijamy na moment odliczenia ZUS (omówimy je dokładnie w lekcji 6.2).',
          steps: [
            {
              stepNumber: 1,
              label: 'Przychód zaewidencjonowany w kolumnie stawki 12%',
              calculation: 'Wytworzenie oprogramowania (15 000,00 PLN × 12%)',
              amountPln: '1 800,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Przychód zaewidencjonowany w kolumnie stawki 8,5%',
              calculation: 'Usługi szkoleniowe / edukacyjne (5 000,00 PLN × 8,5%)',
              amountPln: '425,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Łączny ryczałt przed odliczeniami ZUS i zdrowotnej',
              calculation: '1 800,00 PLN + 425,00 PLN',
              amountPln: '2 225,00 PLN',
            },
          ],
          finalResultPln: '2 225,00 PLN',
          interpretation:
            'Dzięki rzetelnemu rozdzieleniu pozycji na fakturze i w Ewidencji Przychodów szkolenie zostało opodatkowane stawką 8,5% zamiast 12%, co na jednej fakturze dało 175,00 PLN oszczędności.',
        },
        legalBasis: [
          {
            actTitle:
              'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
            articleRef: 'art. 6 ust. 1 i ust. 4, art. 12 ust. 1 i ust. 3 oraz art. 15',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981440930',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa limit 2 000 000 euro uprawniający do ryczałtu, katalog stawek od 2%/3% do 17% wg PKWiU oraz obowiązek prowadzenia wyodrębnionej ewidencji przychodów.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm06-l01-ewidencja-przychodow-ryczalt-stawki',
          '/accounting/ryczalt',
          'Widok Ewidencji Przychodów ryczałtowca z podziałem na kolumny stawkowe (12%, 8,5%, 3%) oraz powiązaniem z kodami PKWiU.',
          '[data-testid="ryczalt-revenue-register"]',
        ),
        practicalExercise: {
          title: 'Sprawdź przypisanie stawek ryczałtu w Ewidencji Przychodów firmy demo Beta',
          demoCompanyId: 'demo_jdg_ryczalt_beta',
          demoCompanyName: 'Studio Kodowania Beta — Anna Nowak (dane syntetyczne)',
          steps: [
            'Przełącz aktywną firmę na „Studio Kodowania Beta — Anna Nowak”.',
            'Otwórz widok „Księgowość” -> „Ewidencja Przychodów (Ryczałt)”.',
            'Zweryfikuj przypisanie faktury za programowanie do stawki 12% oraz faktury za szkolenie do stawki 8,5% wraz z kodami PKWiU.',
          ],
          expectedOutcome:
            'Użytkownik potrafi prowadzić wielostawkową Ewidencję Przychodów zgodnie z art. 12 ust. 3 ustawy o ryczałcie.',
        },
        commonMistakes: [
          {
            mistake:
              'Dobieranie stawki ryczałtu na podstawie kodu PKD zamiast PKWiU i rzeczywistego zakresu umowy z klientem.',
            consequence:
              'Stosowanie zaniżonej stawki (np. 8,5% zamiast 12% albo 12% zamiast 15% przy doradztwie zarządczym CTO/Product Managera), co kończy się dopłatą podatku z odsetkami.',
            howToAvoid:
              'Weryfikuj faktycznie wykonywane czynności w umowie B2B względem grupowania PKWiU 2015, a w przypadkach granicznych wystąp o interpretację indywidualną KIS.',
          },
          {
            mistake:
              'Wyrzucanie faktur zakupowych przez ryczałtowca będącego czynnym podatnikiem VAT.',
            consequence:
              'Utrata prawa do odliczenia 23% podatku VAT z zakupów firmowych (komputera, telefonu, samochodu, biura) — ryczałt dotyczy wyłącznie podatku dochodowego PIT, a nie VAT!',
            howToAvoid:
              'Jako ryczałtowiec + czynny VAT zbieraj i księguj faktury kosztowe do Rejestru Zakupów VAT dokładnie tak samo jak przedsiębiorca na KPiR.',
          },
          {
            mistake:
              'Wystawienie jednej zbiorczej pozycji „Usługi współpracy B2B” przy łączeniu czynności objętych stawkami 12% i 8,5%.',
            consequence:
              'Brak możliwości wyodrębnienia przychodów skutkuje koniecznością opodatkowania całej kwoty stawką wyższą (art. 12 ust. 3 ustawy o ryczałcie).',
            howToAvoid:
              'Rozbijaj różne usługi na osobne pozycje faktury z precyzyjnym opisem i stawką ryczałtu.',
          },
        ],
        summary: [
          'Ryczałt płaci się od przychodu netto (bez pomniejszania o koszty zakupów), do limitu 2 000 000 euro przychodu z roku poprzedniego.',
          'O właściwej stawce ryczałtu (np. 3%, 5,5%, 8,5%, 12%, 14%, 15%, 17%) decyduje klasyfikacja PKWiU faktycznie wykonanego świadczenia.',
          'Ryczałtowiec będący czynnym podatnikiem VAT zachowuje pełne prawo do odliczania podatku VAT z faktur zakupowych.',
        ],
        quiz: [
          {
            id: 'q-06-01-01',
            question:
              'Jaka klasyfikacja statystyczna decyduje bezpośrednio o przypisaniu właściwej stawki ryczałtu w ustawie o zryczałtowanym podatku dochodowym?',
            options: [
              'Kod PKD wpisany przy zakładaniu działalności w CEIDG.',
              'Polska Klasyfikacja Wyrobów i Usług (PKWiU) odpowiadająca faktycznie świadczonym usługom lub sprzedawanym towarom.',
              'Kod CN używany wyłącznie na granicach celnych.',
              'Dowolna nazwa wymyślona przez wystawcę na fakturze.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Art. 4 ust. 1 pkt 1 oraz art. 12 ustawy o ryczałcie odwołują się wprost do Polskiej Klasyfikacji Wyrobów i Usług (PKWiU), a nie do kodów PKD z rejestru CEIDG.',
          },
          {
            id: 'q-06-01-02',
            question:
              'Czy podatnik rozliczający podatek dochodowy ryczałtem, który jest jednocześnie czynnym podatnikiem VAT, może odliczyć VAT z zakupu nowego laptopa firmowego?',
            options: [
              'Nie, na ryczałcie nie wolno odliczać żadnych faktur ani w PIT, ani w VAT.',
              'Tak — ryczałt wyłącza koszty uzyskania przychodu wyłącznie w podatku dochodowym (PIT), natomiast w podatku VAT prawo do odliczenia podatku naliczonego przysługuje na zasadach ogólnych.',
              'Tylko w 50%, jak przy samochodzie osobowym.',
              'Tylko po przekroczeniu 2 000 000 euro przychodu.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Podatek dochodowy (ryczałt) i podatek od towarów i usług (VAT) to dwa odrębne podatki. Czynny podatnik VAT na ryczałcie normalnie odlicza VAT naliczony od zakupów służących sprzedaży opodatkowanej VAT.',
          },
        ],
      },
      {
        id: 'lesson-06-02',
        slug: 'wylaczenia-z-ryczaltu-i-odliczenie-skladki-zdrowotnej',
        moduleNumber: 6,
        lessonNumber: 2,
        title: 'Wyłączenia z ryczałtu (art. 8) oraz proporcjonalne odliczanie ZUS i 50% zdrowotnej',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_ryczalt'],
          scopeNote:
            'Dotyczy podatników planujących wybór ryczałtu lub obliczających miesięczną kwotę ryczałtu do wpłaty (PPE).',
        },
        intro:
          'Choć ryczałt nie pozwala wrzucać w koszty faktur za paliwo czy sprzęt, pozwala legalnie obniżyć przychód o dwie bardzo istotne kwoty: 100% zapłaconych składek na ubezpieczenia społeczne ZUS oraz 50% zapłaconej składki zdrowotnej! Zanim jednak z niego skorzystasz, musisz sprawdzić, czy nie wpadasz w pułapkę ustawowego wyłączenia z art. 8.',
        sections: [
          {
            heading: 'Kto NIE może korzystać z ryczałtu — wyłączenia z art. 8 ustawy',
            body: 'Zgodnie z art. 8 ust. 1 i ust. 2 ustawy o ryczałcie, opodatkowania w tej formie nie stosuje się do podatników prowadzących: apteki, działalność w zakresie kupna i sprzedaży wartości dewizowych (kantory), ani działalność w zakresie **handlu częściami i akcesoriami do pojazdów mechanicznych** (uwaga: sprzedaż nawet jednej używanej lampy samochodowej czy kompletu felg jako towaru handlowego natychmiast wyrzuca z ryczałtu na zasady ogólne od dnia tej sprzedaży!). Drugą kluczową barierą jest **relacja z pracodawcą**: jeżeli w ramach JDG uzyskasz przychód ze świadczenia usług na rzecz byłego lub obecnego pracodawcy, odpowiadających czynnościom, które wykonywałeś na etacie w **roku poprzedzającym rok podatkowy lub w roku podatkowym**, tracisz prawo do ryczałtu (uwaga: na ryczałcie karencja obejmuje także poprzedni rok kalendarzowy, podczas gdy na podatku liniowym — tylko ten sam rok podatkowy!).',
            keyPoints: [
              'Przechodzisz z etatu na B2B u tego samego szefa od 1 stycznia 2026 r., wykonując te same obowiązki? Ponieważ pracowałeś u niego w 2025 r., w 2026 r. NIE MOŻESZ wybrać ryczałtu — ale możesz wybrać podatek liniowy 19% (bo w 2026 r. nie masz już u niego etatu)!',
              'Sprzedaż środka trwałego (np. wykupionego z leasingu samochodu firmowego) nie jest handlem częściami i ma swoją własną stawkę ryczałtu (zwykle 3% dla ruchomości).',
            ],
          },
          {
            heading:
              'Jak odliczać składki społeczne ZUS oraz 50% składki zdrowotnej przy wielu stawkach',
            body: 'Na ryczałcie od przychodu odliczasz faktycznie **zapłacone** w danym miesiącu (lub od początku roku, o ile nie zostały już odliczone) składki na własne ubezpieczenia społeczne (emerytalne, rentowe, chorobowe, wypadkowe — bez Funduszu Pracy, bo na ryczałcie brak KUP, w których ujmuje się FP!) oraz **50% zapłaconych składek na ubezpieczenie zdrowotne** dotyczącej działalności na ryczałcie (art. 11 ust. 1 i ust. 1a ustawy o ryczałcie). Jeżeli w danym miesiącu osiągasz przychody opodatkowane kilkoma stawkami (np. 12% i 8,5%), odliczeń dokonujesz **proporcjonalnie** do udziału każdego rodzaju przychodu w ogólnej kwocie przychodów danego okresu!',
            keyPoints: [
              'Liczy się data FAKTYCZNEJ ZAPŁATY składek do ZUS: składki ZUS za maj opłacone przelewem 18 czerwca pomniejszają przychód czerwca (a nie maja!).',
              'Składka na Fundusz Pracy na ryczałcie nie podlega odliczeniu od przychodu (ponieważ odliczeniu podlegają wyłącznie składki społeczne określone w ustawie systemowej oraz 50% zdrowotnej).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Dokładne obliczenie ryczałtu 12% za czerwiec 2026 r. z odliczeniem Dużego ZUS i 50% zdrowotnej',
          scenario:
            'Programistka na ryczałcie 12% wystawiła w czerwcu 2026 r. fakturę na 20 000,00 PLN netto. W dniu 17 czerwca opłaciła przelewem do ZUS składki za maj (Duży ZUS z chorobowym + średni próg zdrowotnej 60–300 tys. zł): składki społeczne (emerytalna, rentowa, wypadkowa, chorobowa — bez FP!) w kwocie 1 788,29 PLN oraz składkę zdrowotną w kwocie 830,58 PLN.',
          steps: [
            {
              stepNumber: 1,
              label: 'Przychód czerwca opodatkowany stawką 12%',
              calculation: 'Wartość netto wykonanej usługi IT',
              amountPln: '20 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Odliczenie zapłaconych w czerwcu składek społecznych ZUS (bez FP)',
              calculation: '1 103,27 + 452,16 + 94,39 + 138,47 = 1 788,29 PLN',
              amountPln: '1 788,29 PLN',
            },
            {
              stepNumber: 3,
              label: 'Odliczenie 50% zapłaconej w czerwcu składki zdrowotnej',
              calculation: '50% × 830,58 PLN',
              amountPln: '415,29 PLN',
            },
            {
              stepNumber: 4,
              label: 'Podstawa ryczałtu po zaokrągleniu i ryczałt należny 12%',
              calculation:
                '20 000,00 − 1 788,29 − 415,29 = 17 796,42 PLN -> podstawa 17 796,00 PLN × 12% = 2 135,52 PLN -> ryczałt do wpłaty 2 136,00 PLN',
              amountPln: '2 136,00 PLN',
            },
          ],
          finalResultPln: '2 136,00 PLN',
          interpretation:
            'Dzięki odliczeniu zapłaconych składek społecznych (1 788,29 PLN) i połowy zdrowotnej (415,29 PLN) podatek ryczałtowy za czerwiec spadł z 2 400,00 PLN do 2 136,00 PLN (oszczędność 264,00 PLN w jednym miesiącu).',
        },
        legalBasis: [
          {
            actTitle:
              'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
            articleRef: 'art. 8 ust. 1–3, art. 11 ust. 1–1b oraz art. 21 ust. 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981440930',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa katalog wyłączeń z ryczałtu (w tym były pracodawca i części samochodowe), odliczenie składek społecznych oraz 50% składki zdrowotnej i termin wpłaty do 20. dnia kolejnego miesiąca.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm06-l02-kalkulacja-ryczaltu-ppe-i-odliczenia-zus',
          '/taxes',
          'Karta miesięcznego wyliczenia ryczałtu (PPE) prezentująca proporcjonalne rozbicie odliczeń składek społecznych i 50% zdrowotnej na poszczególne stawki.',
          '[data-testid="ryczalt-monthly-tax-trace"]',
        ),
        practicalExercise: {
          title:
            'Prześledź proporcjonalne odliczenie ZUS i 50% zdrowotnej w firmie demo Studio Kodowania Beta',
          demoCompanyId: 'demo_jdg_ryczalt_beta',
          demoCompanyName: 'Studio Kodowania Beta — Anna Nowak (dane syntetyczne)',
          steps: [
            'W kontekście firmy „Studio Kodowania Beta — Anna Nowak” przejdź do sekcji „Podatki i JPK”.',
            'Otwórz wyliczenie ryczałtu za lipiec i kliknij „Dlaczego?”.',
            'Sprawdź, jak aplikacja podzieliła zapłacone składki społeczne i 50% składki zdrowotnej w proporcji 75% (stawka 12%) i 25% (stawka 8,5%), pomijając Fundusz Pracy.',
          ],
          expectedOutcome:
            'Użytkownik rozumie mechanizm proporcji odliczeń z art. 11 ust. 1 i 1a ustawy o ryczałcie oraz rolę daty zapłaty składek ZUS.',
        },
        commonMistakes: [
          {
            mistake:
              'Wybór ryczałtu od stycznia 2026 r. przy wystawianiu faktur na rzecz pracodawcy, u którego miało się umowę o pracę jeszcze w listopadzie 2025 r. na tożsamym stanowisku.',
            consequence:
              'Utrata prawa do ryczałtu na mocy art. 8 ust. 2 ustawy o ryczałcie i konieczność dopłaty podatku wg skali 12%/32% wraz z 9% składką zdrowotną.',
            howToAvoid:
              'W pierwszym roku po przejściu z etatu u tego samego pracodawcy wybierz podatek liniowy 19% (który bada etat wyłącznie w tym samym roku podatkowym), a na ryczałt przejdź dopiero w kolejnym roku!',
          },
          {
            mistake:
              'Odliczanie w ryczałcie całej kwoty przelewu do ZUS razem z Funduszem Pracy (138,47 PLN w 2026 r.).',
            consequence:
              'Zaniżenie podstawy ryczałtu — Fundusz Pracy na KPiR jest kosztem uzyskania przychodów, ale na ryczałcie nie podlega odliczeniu od przychodu!',
            howToAvoid:
              'Korzystaj z kalkulatora składek w aplikacji, który automatycznie oddziela ubezpieczenia społeczne od Funduszu Pracy.',
          },
          {
            mistake:
              'Odliczanie w ryczałcie za grudzień składek ZUS opłaconych dopiero w styczniu kolejnego roku.',
            consequence:
              'Składki zapłacone w styczniu można odliczyć dopiero w rozliczeniu nowego roku (stycznia), a nie starego roku!',
            howToAvoid:
              'Jeśli chcesz pomniejszyć przychód danego roku o grudniowy ZUS, możesz wyjątkowo opłacić i złożyć DRA jeszcze przed 31 grudnia — pamiętaj jednak o spójności z rocznym rozliczeniem zdrowotnej.',
          },
        ],
        summary: [
          'Z ryczałtu wyklucza m.in. handel częściami samochodowymi, prowadzenie aptek/kantorów oraz świadczenie tożsamych usług dla pracodawcy z bieżącego lub poprzedniego roku.',
          'Ryczałtowiec odlicza od przychodu zapłacone składki społeczne ZUS (bez Funduszu Pracy) oraz 50% zapłaconej składki zdrowotnej.',
          'Przy kilku stawkach ryczałtu odliczenia ZUS i zdrowotnej dzieli się proporcjonalnie do udziału przychodów każdej stawki w przychodzie ogółem.',
        ],
        quiz: [
          {
            id: 'q-06-02-01',
            question:
              'Jaką część zapłaconej składki na ubezpieczenie zdrowotne może odliczyć od przychodu przedsiębiorca opodatkowany ryczałtem od przychodów ewidencjonowanych w 2026 roku?',
            options: [
              '0% — na ryczałcie nie ma żadnego odliczenia składki zdrowotnej.',
              '50% zapłaconych składek zdrowotnych dotyczących działalności opodatkowanej ryczałtem.',
              '100% do limitu 14 100,00 PLN.',
              '9% kwoty wolnej od podatku.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 11 ust. 1a ustawy o ryczałcie podatnik ma prawo pomniejszyć przychody o 50% składek na ubezpieczenie zdrowotne zapłaconych w roku podatkowym z tytułu działalności opodatkowanej ryczałtem.',
          },
          {
            id: 'q-06-02-02',
            question:
              'Grafik pracował na umowie o pracę w agencji reklamowej do 31 grudnia 2025 r., a od 2 stycznia 2026 r. założył JDG i chce wystawiać tej samej agencji faktury za identyczne projekty graficzne. Czy w 2026 r. może opodatkować te przychody ryczałtem?',
            options: [
              'Tak, bo w 2026 roku nie ma już umowy o pracę.',
              'Nie — art. 8 ust. 2 ustawy o ryczałcie wyłącza ryczałt, jeśli usługi odpowiadają czynnościom wykonywanym na etacie u tego pracodawcy w roku podatkowym LUB w roku poprzedzającym rok podatkowy (2025).',
              'Tak, pod warunkiem że wybierze stawkę 17%.',
              'Tak, jeśli wystawi mniej niż jedną fakturę miesięcznie.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Na ryczałcie karencja wobec byłego pracodawcy obejmuje zarówno bieżący, jak i poprzedni rok kalendarzowy (art. 8 ust. 2). Grafik w 2026 r. może natomiast rozważyć podatek liniowy 19% (gdzie karencja obejmuje wyłącznie ten sam rok podatkowy) i przejść na ryczałt od 2027 r.',
          },
        ],
      },
      {
        id: 'lesson-06-03',
        slug: 'kiedy-ryczalt-sie-oplaca-a-kiedy-szkodzi',
        moduleNumber: 6,
        lessonNumber: 3,
        title:
          'Kiedy ryczałt się opłaca, a kiedy szkodzi — pułapka marży, straty i progów zdrowotnej',
        estimatedMinutes: 15,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_ryczalt', 'jdg_kpir_skala', 'jdg_kpir_liniowy'],
          scopeNote:
            'Lekcja decyzyjna dla przedsiębiorców ważących zalety i ryzyka ryczałtu wobec KPiR (skali lub liniowego).',
        },
        intro:
          'Niska stawka ryczałtu (np. 3% w handlu czy 5,5% w budownictwie) potrafi uśpić czujność i doprowadzić firmę do płacenia podatku... od realnej straty ekonomicznej! Zobaczmy, gdzie przebiega matematyczna granica opłacalności ryczałtu i dlaczego przekroczenie 60 000 zł lub 300 000 zł przychodu w grudniu o 100 złotych może kosztować kilka tysięcy złotych dopłaty do ZUS.',
        sections: [
          {
            heading: 'Kiedy ryczałt szkodzi: niska marża, inwestycje i brak rozliczenia straty',
            body: 'Ryczałt jest bezlitosny w trzech sytuacjach. Po pierwsze: **gdy masz niską marżę handlową lub podwykonawców**! Jeśli kupujesz towar za 92 000 zł i sprzedajesz go za 100 000 zł (Twoja marża to tylko 8 000 zł), to 3% ryczałtu liczone od pełnych 100 000 zł przychodu wyniesie 3 000 zł — co stanowi aż **37,5% Twojego realnego zysku**! Po drugie: **w roku dużych inwestycji lub straty** — gdy wydasz 150 000 zł na wyposażenie gabinetu lub materiały, a sprzedasz usługi za 80 000 zł, na KPiR masz 0 zł podatku i 70 000 zł straty do odliczenia w kolejnych 5 latach, natomiast na ryczałcie i tak musisz zapłacić podatek od 80 000 zł przychodu! Po trzecie: na ryczałcie tracisz prawo do wspólnego rozliczenia z małżonkiem oraz do ulgi prorodzinnej na dzieci (chyba że masz równolegle inne dochody opodatkowane skalą, np. etat).',
            keyPoints: [
              'Szybki wzór orientacyjny (bez ZUS): ryczałt `r%` przegrywa z podatkiem liniowym `19%`, gdy udział Twoich kosztów KUP w przychodzie przekracza `(19% − r%) / 19%` (np. dla stawki 12% ryczałt zaczyna przegrywać już przy kosztach przekraczających ok. 37%–40% przychodu!).',
              'Jeśli zatrudniasz drogich podwykonawców i refakturujesz ich pracę klientowi końcowemu, na ryczałcie płacisz podatek także od cudzego wynagrodzenia!',
            ],
          },
          {
            heading: 'Pułapka skokowych progów składki zdrowotnej (60 000 zł i 300 000 zł)',
            body: 'Na ryczałcie składka zdrowotna zależy od **rocznego przychodu** (pomniejszonego o zapłacone składki społeczne ZUS!). W 2026 roku obowiązują trzy sztywne progi: do **60 000,00 PLN** płacisz **498,35 PLN/mies.** (5 980,20 PLN rocznie); powyżej **60 000,00 PLN do 300 000,00 PLN** płacisz **830,58 PLN/mies.** (9 966,96 PLN rocznie); a powyżej **300 000,00 PLN** płacisz **1 495,04 PLN/mies.** (17 940,48 PLN rocznie). Najważniejszy haczyk: przekroczenie progu choćby w grudniu powoduje przeliczenie składki zdrowotnej według wyższego progu **wstecznie za wszystkie 12 miesięcy całego roku** w rocznym rozliczeniu ZUS DRA za kwiecień! Oznacza to, że przekroczenie progu 300 000,00 PLN w grudniu o 100,00 PLN rodzi jednorazową dopłatę rocznej składki zdrowotnej w wysokości prawie **8 000,00 PLN**!',
            keyPoints: [
              'Do limitów 60 000 zł i 300 000 zł w składce zdrowotnej bierze się przychód POMNIEJSZONY o zapłacone w danym roku składki na ubezpieczenia społeczne ZUS!',
              'Pod koniec roku (listopad–grudzień) zawsze sprawdzaj w aplikacji licznik bezpiecznego dystansu do progu 60 000 zł i 300 000 zł.',
            ],
          },
        ],
        numericalExample: {
          title:
            'Skutek przekroczenia progu 300 000,00 PLN na ryczałcie o 500,00 PLN w grudniu 2026 r.',
          scenario:
            'Inżynier na ryczałcie 14% osiągnął od stycznia do listopada 2026 r. przychód (już po odliczeniu składek społecznych ZUS) równy 299 500,00 PLN i co miesiąc płacił składkę zdrowotną z II progu (830,58 PLN). W grudniu rozważa dodatkowe drobne zlecenie na 1 000,00 PLN netto, które podniesie jego roczny przychód po ZUS do 300 500,00 PLN.',
          steps: [
            {
              stepNumber: 1,
              label: 'Roczna składka zdrowotna przy zatrzymaniu się w II progu (≤ 300 000,00 PLN)',
              calculation: '12 miesięcy × 830,58 PLN',
              amountPln: '9 966,96 PLN',
            },
            {
              stepNumber: 2,
              label: 'Roczna składka zdrowotna po wejściu w III próg (> 300 000,00 PLN)',
              calculation: '12 miesięcy × 1 495,04 PLN (przeliczenie wstecz za cały rok!)',
              amountPln: '17 940,48 PLN',
            },
            {
              stepNumber: 3,
              label:
                'Jednorazowa dopłata rocznej składki zdrowotnej przez zlecenie za 1 000,00 PLN',
              calculation: '17 940,48 PLN − 9 966,96 PLN',
              amountPln: '7 973,52 PLN',
            },
          ],
          finalResultPln: '7 973,52 PLN',
          interpretation:
            'Dodatkowa faktura na 1 000,00 PLN na przełomie progu 300 000,00 PLN wywołałaby 7 973,52 PLN dopłaty do ZUS plus podatek ryczałtowy — czyli przyniosłaby ponad 7 000,00 PLN realnej straty netto! Świadome monitorowanie progów w aplikacji chroni przed takimi niespodziankami.',
        },
        legalBasis: [
          {
            actTitle:
              'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
            articleRef: 'art. 81 ust. 2e–2j',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20042102135',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Ustanawia trzy progi przychodowe składki zdrowotnej na ryczałcie (60 000 zł i 300 000 zł po odliczeniu składek społecznych) oraz obowiązek rocznego wyrównania za wszystkie miesiące.',
          },
          {
            actTitle:
              'Ustawa z dnia 20 listopada 1998 r. o zryczałtowanym podatku dochodowym od niektórych przychodów osiąganych przez osoby fizyczne',
            articleRef: 'art. 6 ust. 1 oraz art. 11',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981440930',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Potwierdza opodatkowanie przychodu bez kosztów uzyskania przychodów oraz brak rozliczania straty podatkowej z lat ubiegłych z kosztów bieżących.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm06-l03-alert-progu-zdrowotnej-ryczalt-300k',
          '/taxes',
          'Wskaźnik ostrzegawczy zbliżania się do progu 60 000 PLN / 300 000 PLN rocznej składki zdrowotnej na ryczałcie wraz z symulacją dopłaty rocznej.',
          '[data-testid="ryczalt-health-threshold-gauge"]',
        ),
        practicalExercise: {
          title: 'Sprawdź pasek wykorzystania progu składki zdrowotnej w firmie demo Beta',
          demoCompanyId: 'demo_jdg_ryczalt_beta',
          demoCompanyName: 'Studio Kodowania Beta — Anna Nowak (dane syntetyczne)',
          steps: [
            'W kontekście „Studio Kodowania Beta — Anna Nowak” otwórz widok „Podatki i JPK”.',
            'Odszukaj kartę „Progi składki zdrowotnej (Ryczałt 2026)” i sprawdź narastający przychód po odliczeniu składek społecznych ZUS.',
            'Przeczytaj komunikat ostrzegawczy pokazujący kwotę pozostałą do progu 300 000,00 PLN oraz wysokość ewentualnej dopłaty rocznej.',
          ],
          expectedOutcome:
            'Użytkownik potrafi z wyprzedzeniem zaplanować przychody końcówki roku i uniknąć nieopłacalnego przeskoczenia progu zdrowotnej o kilkaset złotych.',
        },
        commonMistakes: [
          {
            mistake:
              'Wybór ryczałtu 3% w sklepie internetowym z dropshippingiem lub elektroniką o marży 4%–5%.',
            consequence:
              'Ryczałt 3% od całego obrotu zjada większość marży handlowej (60%–75% zysku!), a koszty reklam i zwrotów pogrążają rentowność.',
            howToAvoid:
              'W handlu o niskiej marży i wysokich kosztach marketingu/logistyki policz opłacalność KPiR (skali lub liniowego), gdzie podatek płacisz wyłącznie od wypracowanej marży netto po kosztach.',
          },
          {
            mistake:
              'Zapomnienie, że przekroczenie progu 60 000 zł lub 300 000 zł podnosi składkę zdrowotną za CAŁY ROK wstecz, a nie tylko od nadwyżki.',
            consequence:
              'Niespodziewana konieczność dopłaty ok. 4 000 zł lub 8 000 zł w deklaracji ZUS za kwiecień kolejnego roku (płatnej do 20 maja).',
            howToAvoid:
              'Od października monitoruj narastający przychód pomniejszony o opłacone składki społeczne ZUS.',
          },
          {
            mistake:
              'Pozostanie na ryczałcie w roku planowanego generalnego remontu lokalu lub zatrudnienia zespołu podwykonawców.',
            consequence:
              'Brak możliwości odliczenia dziesiątek tysięcy złotych kosztów inwestycji i podwykonawców od podstawy opodatkowania.',
            howToAvoid:
              'Przed rokiem wysokich nakładów kosztowych zmień formę opodatkowania na KPiR (do 20 lutego!).',
          },
        ],
        summary: [
          'Ryczałt błyszczy w usługach eksperckich o wysokiej marży i niskich kosztach własnych (np. IT, architektura, edukacja, medycyna).',
          'Ryczałt bywa groźną pułapką w niskomarżowym handlu, przy pracy z podwykonawcami oraz w latach wysokich inwestycji.',
          'Przekroczenie progu 60 000 zł lub 300 000 zł na ryczałcie podwyższa składkę zdrowotną wstecznie za wszystkie miesiące roku.',
        ],
        quiz: [
          {
            id: 'q-06-03-01',
            question:
              'Co dzieje się ze składką zdrowotną ryczałtowca, który przez 11 miesięcy mieścił się w progu do 60 000,00 PLN, a w grudniu osiągnął łączny roczny przychód (po ZUS społecznym) w wysokości 62 000,00 PLN?',
            options: [
              'Wyższą składkę zapłaci tylko za sam grudzień.',
              'Wyższą składkę zapłaci wyłącznie od kwoty 2 000,00 PLN nadwyżki.',
              'W rocznym rozliczeniu składki zdrowotnej musi wyrównać składkę do II progu (830,58 PLN/mies. w 2026 r.) za wszystkie 12 miesięcy prowadzenia działalności w tym roku.',
              'Zostaje automatycznie zwolniony ze składki zdrowotnej za grudzień.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Roczna podstawa wymiaru składki zdrowotnej na ryczałcie jest ustalana na podstawie sumy przychodów z całego roku kalendarzowego (art. 81 ust. 2f ustawy zdrowotnej), co oznacza wyrównanie stawki miesięcznej za wszystkie miesiące podlegania ubezpieczeniu w danym roku.',
          },
          {
            id: 'q-06-03-02',
            question:
              'W którym z poniższych modeli biznesowych ryczałt jest najbardziej ryzykowny ekonomicznie?',
            options: [
              'Samodzielny programista pracujący na własnym laptopie z kosztami 500,00 PLN miesięcznie.',
              'Sklep handlowy kupujący towary za 95 000,00 PLN miesięcznie i sprzedający je za 100 000,00 PLN przy kosztach reklamy 4 000,00 PLN.',
              'Lekarz prowadzący indywidualną praktykę w szpitalu bez zakupu drogich materiałów.',
              'Wykładowca prowadzący szkolenia online z domu.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Sklep osiąga tylko 1 000,00 PLN realnego zysku przed podatkiem (100 000 − 95 000 − 4 000), a na ryczałcie 3% musiałby zapłacić aż 3 000,00 PLN samego podatku od obrotu 100 000,00 PLN — dokładając do interesu.',
          },
        ],
      },
    ],
  },
];
