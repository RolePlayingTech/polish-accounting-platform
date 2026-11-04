import { createScreenshotSlot, type AcademyModule } from './quiz.js';

export const MODULES_01_TO_03: readonly AcademyModule[] = [
  {
    moduleNumber: 1,
    slug: 'podstawy-ksiegowosci-dla-przedsiebiorcy',
    title: 'Moduł 1: Podstawy księgowości dla przedsiębiorcy',
    subtitle:
      'Zrozum różnicę między przychodem, dochodem a gotówką na koncie, poznaj zasady zaliczania wydatków do kosztów oraz odpowiedzialność za dokumenty księgowe.',
    learningObjectives: [
      'Odróżniać przychód podatkowy od dochodu oraz realnego przepływu pieniężnego (cash flow).',
      'Prawidłowo klasyfikować wydatki firmowe jako koszty uzyskania przychodów (KUP) lub wydatki niestanowiące kosztów (NKUP).',
      'Rozpoznawać prawidłowy dowód księgowy i rozumieć podział odpowiedzialności między właścicielem firmy a biurem rachunkowym.',
    ],
    lessons: [
      {
        id: 'lesson-01-01',
        slug: 'po-co-prowadzi-sie-ksiegowosc-przychod-dochod-przeplyw',
        moduleNumber: 1,
        lessonNumber: 1,
        title: 'Po co prowadzi się księgowość: przychód, dochód a przepływ pieniężny',
        estimatedMinutes: 14,
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
            'Edukacja ogólna — pojęcia przychodu, dochodu i przepływu pieniężnego dotyczą każdej firmy w Polsce niezależnie od formy prawnej.',
        },
        intro:
          'Wielu początkujących przedsiębiorców traktuje księgowość jak przykry obowiązek wobec urzędu skarbowego. Tymczasem dobrze prowadzona księgowość to przede wszystkim deska rozdzielcza Twojej firmy: pokazuje, czy naprawdę zarabiasz, ile pieniędzy należy do Ciebie, a ile musisz odłożyć na podatki i ZUS, zanim wydasz je na inne cele.',
        sections: [
          {
            heading: 'Dwie funkcje księgowości: podatkowa i zarządcza',
            body: 'W polskich realiach księgowość pełni jednocześnie dwie role. Pierwsza to rola ewidencyjno-podatkowa: rzetelne obliczenie podatku dochodowego (PIT lub CIT), podatku od towarów i usług (VAT) oraz składek ZUS zgodnie z przepisami ustaw. Druga — równie ważna — to funkcja informacyjna dla właściciela. Bez bieżącego zapisu faktur i płatności łatwo pomylić wysoki stan konta bankowego z zyskiem, zapominając o zbliżającym się terminie zapłaty VAT czy zaliczki na podatek dochodowy.',
            keyPoints: [
              'Księgowość chroni przed zaległościami podatkowymi i odsetkami za zwłokę.',
              'Bieżąca ewidencja pozwala podejmować decyzje cenowe i inwestycyjne na podstawie twardych liczb, a nie przeczucia.',
            ],
          },
          {
            heading: 'Przychód należny, dochód i przepływ pieniężny (cash flow)',
            body: 'Najgroźniejsza pułapka na starcie działalności polega na utożsamianiu wystawionej faktury z gotówką. W podatkach dochodowych obowiązuje zasada memoriałowa dla przychodów z działalności gospodarczej: przychód powstaje w momencie wykonania usługi lub wydania towaru (nie później niż w dniu wystawienia faktury albo uregulowania należności), nawet jeśli klient ma 30 dni na przelew! Dochód to z kolei przychód pomniejszony o koszty uzyskania przychodów. Natomiast przepływ pieniężny (cash flow) to faktyczny ruch pieniędzy na rachunku bankowym i w kasie.',
            keyPoints: [
              'Przychód to wartość sprzedaży netto (dla czynnego podatnika VAT) wynikająca z wykonanych usług lub sprzedanych towarów.',
              'Dochód = Przychód − Koszty uzyskania przychodów (KUP); gdy koszty przewyższają przychód, powstaje strata podatkowa.',
              'Przepływ pieniężny (cash flow) mówi o tym, ile realnych złotówek wpłynęło na konto i z niego wypłynęło.',
            ],
          },
        ],
        numericalExample: {
          title: 'Faktura z odroczonym terminem płatności a gotówka na koncie',
          scenario:
            'W marcu 2026 r. Jan Kowalski (czynny podatnik VAT, KPiR) wykonał projekt graficzny za 10 000,00 PLN netto + 2 300,00 PLN VAT (12 300,00 PLN brutto) z terminem płatności 14 kwietnia. W tym samym marcu opłacił licencje i biuro na kwotę 3 000,00 PLN netto (3 690,00 PLN brutto). Klient jeszcze nie zapłacił do końca marca.',
          steps: [
            {
              stepNumber: 1,
              label: 'Przychód podatkowy marca (netto)',
              calculation: 'Wartość wykonanej usługi bez podatku VAT',
              amountPln: '10 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Koszty uzyskania przychodów marca (netto)',
              calculation: 'Opłacone i udokumentowane fakturami koszty biura i licencji',
              amountPln: '3 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Dochód podatkowy za marzec',
              calculation: '10 000,00 PLN − 3 000,00 PLN',
              amountPln: '7 000,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Przepływ pieniężny (cash flow) w marcu',
              calculation: '0,00 PLN wpływów od klienta − 3 690,00 PLN wypływu z konta',
              amountPln: '-3 690,00 PLN',
            },
          ],
          finalResultPln: '7 000,00 PLN',
          interpretation:
            'Mimo że w marcu z konta Jana ubyło 3 690,00 PLN, podatkowo osiągnął on 7 000,00 PLN dochodu oraz musi wykazać 2 300,00 PLN VAT należnego (pomniejszonego o 690,00 PLN VAT z zakupów). Dlatego monitorowanie rozrachunków jest równie ważne jak sama księga podatkowa.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 9 ust. 2 oraz art. 14 ust. 1 i ust. 1c',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Definiuje dochód jako nadwyżkę sumy przychodów nad kosztami ich uzyskania oraz określa moment powstania przychodu należnego w działalności gospodarczej.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm01-l01-pulpit-przychod-dochod-przeplywy',
          '/app',
          'Pulpit główny aplikacji zestawiający przychód, koszty, szacowany dochód oraz stan nierozliczonych płatności firmy.',
          '[data-testid="dashboard-financial-overview"]',
        ),
        practicalExercise: {
          title: 'Porównaj wynik podatkowy z saldem rozrachunków firmy demo',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przełącz aktywną firmę w nagłówku aplikacji na „Pracownia Projektowa Alfa — Jan Kowalski”.',
            'Otwórz widok Pulpitu i odczytaj wartość przychodu netto oraz kosztów z bieżącego miesiąca.',
            'Sprawdź kartę „Nierozliczone należności”, aby ustalić, jaka część przychodu oczekuje jeszcze na przelew od kontrahenta.',
          ],
          expectedOutcome:
            'Użytkownik potrafi wskazać różnicę między dochodem do opodatkowania a kwotą środków faktycznie dostępnych na rachunku firmowym.',
        },
        commonMistakes: [
          {
            mistake:
              'Traktowanie kwoty brutto wpływającej na konto jako czystego zysku właściciela.',
            consequence:
              'Brak środków na koncie 20. i 25. dnia kolejnego miesiąca, gdy trzeba zapłacić zaliczkę PIT/CIT, ZUS oraz podatek VAT.',
            howToAvoid:
              'Oddzielaj kwotę VAT oraz rezerwę na podatek dochodowy na osobnym subkoncie natychmiast po otrzymaniu przelewu od klienta.',
          },
          {
            mistake:
              'Wstrzymywanie księgowania wystawionej faktury sprzedaży do czasu otrzymania przelewu.',
            consequence:
              'Zaniżenie przychodu i podatku we właściwym miesiącu rozliczeniowym, co rodzi konieczność korekt i zapłaty odsetek.',
            howToAvoid:
              'Księguj faktury sprzedażowe według daty wykonania usługi / dostawy towaru lub wystawienia faktury zgodnie z art. 14 ust. 1c ustawy o PIT.',
          },
          {
            mistake: 'Mylenie pożyczki lub wkładu własnego z przychodem podatkowym.',
            consequence:
              'Niepotrzebne opodatkowanie kapitału pożyczonego (kapitał pożyczki jest neutralny w PIT/CIT, kosztem mogą być dopiero zapłacone odsetki).',
            howToAvoid:
              'Każdy wpływ spoza sprzedaży oznaczaj właściwym tytułem operacji bankowej (np. zasilenie własne, zwrot kaucji, pożyczka).',
          },
        ],
        summary: [
          'Przychód podatkowy w firmie to co do zasady przychód należny (netto dla VAT czynnego), nawet jeśli kontrahent jeszcze nie zapłacił.',
          'Dochód to różnica między przychodem a kosztami uzyskania przychodów — stanowi podstawę opodatkowania na skali, liniowym i w klasycznym CIT.',
          'Dodatni dochód nie gwarantuje dodatniego cash flow — firma zyskowna na papierze może stracić płynność przez nieopłacone faktury.',
        ],
        quiz: [
          {
            id: 'q-01-01-01',
            question:
              'Kiedy co do zasady powstaje przychód w podatku dochodowym przy świadczeniu usługi B2B udokumentowanej fakturą z 21-dniowym terminem płatności?',
            options: [
              'Dopiero w dniu wpływu przelewu od klienta na rachunek bankowy.',
              'W dniu wykonania usługi, nie później niż w dniu wystawienia faktury albo uregulowania należności.',
              'Zawsze ostatniego dnia kwartału kalendarzowego.',
              'W dniu zatwierdzenia rocznego zeznania PIT-36.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 14 ust. 1c ustawy o PIT za datę powstania przychodu uważa się dzień wydania rzeczy, zbycia prawa majątkowego lub wykonania usługi, nie później niż dzień wystawienia faktury albo uregulowania należności.',
          },
          {
            id: 'q-01-01-02',
            question:
              'Czynny podatnik VAT wystawił fakturę na 5 000,00 PLN netto (6 150,00 PLN brutto) i poniósł koszty KUP w wysokości 1 500,00 PLN netto. Ile wynosi jego dochód z tej transakcji?',
            options: ['6 150,00 PLN', '4 650,00 PLN', '3 500,00 PLN', '5 000,00 PLN'],
            correctOptionIndex: 2,
            explanation:
              'U czynnego podatnika VAT przychodem jest kwota netto (5 000,00 PLN), a kosztem kwota netto odliczalnego zakupu (1 500,00 PLN). Dochód wynosi 5 000,00 PLN − 1 500,00 PLN = 3 500,00 PLN.',
          },
        ],
      },
      {
        id: 'lesson-01-02',
        slug: 'koszty-uzyskania-przychodu-kup-vs-nkup',
        moduleNumber: 1,
        lessonNumber: 2,
        title: 'Koszty uzyskania przychodu (KUP) a wydatki wyłączone z kosztów (NKUP)',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'spolka_cywilna_kpir',
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
          ],
          scopeNote:
            'Dotyczy podatników rozliczających koszty podatkowe (skala PIT, podatek liniowy, klasyczny CIT). Na ryczałcie ewidencjonowanym koszty nie pomniejszają podatku dochodowego.',
        },
        intro:
          '„Wezmę to na fakturę, będzie w kosztach!” — to jedno z najczęściej powtarzanych zdań wśród przedsiębiorców. Sam fakt posiadania faktury z numerem NIP firmy nie oznacza jednak automatycznie, że wydatek legalnie obniży Twój podatek. Poznaj złoty test kosztu podatkowego oraz ustawową czarną listę wydatków NKUP.',
        sections: [
          {
            heading: 'Cztery warunki zaliczenia wydatku do KUP',
            body: 'Zgodnie z art. 22 ust. 1 ustawy o PIT (oraz bliźniaczym art. 15 ust. 1 ustawy o CIT) kosztami uzyskania przychodów są koszty poniesione w celu osiągnięcia przychodów lub zachowania albo zabezpieczenia źródła przychodów, z wyjątkiem kosztów wymienionych w katalogu negatywnym. W praktyce każdy wydatek musi łącznie spełnić cztery warunki: zostać faktycznie poniesiony przez podatnika, mieć charakter definitywny (bezzwrotny), pozostawać w racjonalnym związku z działalnością gospodarczą oraz zostać właściwie udokumentowany i niewyłączony ustawowo.',
            keyPoints: [
              'Związek z przychodem może być bezpośredni (np. zakup towaru handlowego) lub pośredni (np. księgowość, serwer, ubezpieczenie OC firmy).',
              'Ciężar wykazania związku wydatku z działalnością spoczywa na podatniku — warto dodawać krótki opis merytoryczny na nietypowych fakturach.',
            ],
          },
          {
            heading: 'Katalog wydatków niestanowiących kosztów (NKUP)',
            body: 'Ustawodawca w art. 23 ustawy o PIT (i art. 16 ustawy o CIT) wymienił kilkadziesiąt kategorii wydatków, które nawet mimo związku z firmą nigdy nie mogą pomniejszyć podstawy opodatkowania. Należą do nich m.in. koszty reprezentacji (w szczególności okazałe przyjęcia, alkohol dla kontrahentów, prezenty ekskluzywne bez charakteru reklamowego), grzywny i mandaty karne, odsetki za zwłokę od zaległości podatkowych i ZUS, sam podatek dochodowy PIT/CIT, a także wydatki opłacone z pominięciem obowiązkowego MPP lub Białej Listy powyżej 15 000 zł brutto.',
            keyPoints: [
              'Zwykły poczęstunek podczas spotkania roboczego w biurze (kawa, woda, drobne przekąski) to koszt ogólny firmy, ale wystawna kolacja z alkoholem to reprezentacja (NKUP).',
              'W pełnej księgowości wydatki NKUP ujmuje się w księgach rachunkowych (bo faktycznie zmniejszyły majątek spółki), ale wyłącza z kalkulacji podatku CIT.',
            ],
          },
        ],
        numericalExample: {
          title: 'Selekcja wydatków miesiąca na KUP i NKUP w JDG na podatku liniowym 19%',
          scenario:
            'Programista prowadzący JDG na podatku liniowym 19% osiągnął w kwietniu 2026 r. przychód 20 000,00 PLN netto. W tym samym miesiącu zapłacił: 2 500,00 PLN netto za wynajem biura, 600,00 PLN netto za chmurę obliczeniową, 500,00 PLN mandatu drogowego w trasie do klienta oraz 800,00 PLN brutto za alkohol w prezencie świątecznym dla kontrahenta.',
          steps: [
            {
              stepNumber: 1,
              label: 'Przychód podatkowy miesiąca',
              calculation: 'Faktura za usługi programistyczne netto',
              amountPln: '20 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Suma wydatków stanowiących KUP',
              calculation: '2 500,00 PLN (biuro) + 600,00 PLN (chmura)',
              amountPln: '3 100,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Wydatki odrzucone jako NKUP',
              calculation: '500,00 PLN (mandat) + 800,00 PLN (alkohol / reprezentacja)',
              amountPln: '1 300,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Dochód podatkowy stanowiący podstawę PIT',
              calculation: '20 000,00 PLN − 3 100,00 PLN',
              amountPln: '16 900,00 PLN',
            },
          ],
          finalResultPln: '16 900,00 PLN',
          interpretation:
            'Gdyby przedsiębiorca błędnie wrzucił mandat i alkohol w koszty KUP, zaniżyłby podstawę opodatkowania o 1 300,00 PLN, a podatek liniowy o 247,00 PLN, narażając się na korektę podczas czynności sprawdzających.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 22 ust. 1 oraz art. 23 ust. 1 pkt 15, pkt 16 i pkt 23',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa ogólną klauzulę kosztów uzyskania przychodów oraz wyłącza z kosztów m.in. grzywny, kary pieniężne, odsetki budżetowe i koszty reprezentacji.',
          },
          {
            actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
            articleRef: 'art. 15 ust. 1 oraz art. 16 ust. 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19920210086',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Odpowiednik zasad kwalifikacji KUP i katalogu wyłączeń NKUP dla podatników podatku CIT (np. spółek z o.o.).',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm01-l02-weryfikacja-kosztu-kup-nkup',
          '/documents',
          'Panel weryfikacji dokumentu kosztowego z oznaczeniem kwalifikacji podatkowej KUP / NKUP oraz szufladą podstawy prawnej.',
          '[data-testid="document-tax-qualification-panel"]',
        ),
        practicalExercise: {
          title: 'Sklasyfikuj trzy faktury zakupowe pod kątem KUP i NKUP',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do sekcji „Dokumenty” -> „Do weryfikacji” w firmie demo Pracownia Projektowa Alfa.',
            'Otwórz fakturę za subskrypcję oprogramowania CAD i zweryfikuj kwalifikację „KUP 100% — pozostałe wydatki”.',
            'Otwórz dokument opłaty za kosz prezentowy z winem dla klienta, oznacz go jako „NKUP — reprezentacja (art. 23 ust. 1 pkt 23 PIT)” i zapisz uzasadnienie.',
          ],
          expectedOutcome:
            'Faktura za oprogramowanie trafia do PKPiR, natomiast wydatek reprezentacyjny zostaje zarchiwizowany z blokadą ujęcia w kosztach podatkowych.',
        },
        commonMistakes: [
          {
            mistake:
              'Zaliczenie do kosztów ubrań codziennych (garnitur, sukienka, okulary korekcyjne bez specyfiki BHP).',
            consequence:
              'Zakwestionowanie wydatku przez urząd skarbowy jako wydatku o charakterze osobistym, który każdy obywatel ponosi niezależnie od prowadzenia firmy.',
            howToAvoid:
              'Do kosztów zaliczaj wyłącznie odzież ochronną, roboczą lub trwale oznaczoną widocznym logo firmy (pełniącą funkcję reklamową).',
          },
          {
            mistake: 'Ujęcie w kosztach całej raty kapitałowo-odsetkowej kredytu firmowego.',
            consequence:
              'Zawężenie dochodu o spłatę kapitału, która podatkowo jest neutralna (kosztem są wyłącznie zapłacone odsetki i prowizje bankowe).',
            howToAvoid:
              'Księguj kredyt na podstawie harmonogramu lub zaświadczenia z banku rozbijającego ratę na część kapitałową (neutralną) i odsetkową (KUP po zapłacie).',
          },
          {
            mistake:
              'Brak opisu celowości zakupu przy usługach niematerialnych (np. szkolenie, doradztwo, konferencja).',
            consequence:
              'Trudność w udowodnieniu związku z przychodem po 3–4 latach w razie kontroli podatkowej.',
            howToAvoid:
              'Do każdej usługi niematerialnej dołączaj w systemie notatkę biznesową, agendę szkolenia lub protokół odbioru prac.',
          },
        ],
        summary: [
          'Sama faktura z NIP firmy nie wystarczy — wydatek musi służyć osiągnięciu przychodu lub zachowaniu albo zabezpieczeniu jego źródła.',
          'Mandaty, odsetki skarbowe, alkohol oraz wydatki reprezentacyjne znajdują się w ustawowym katalogu NKUP.',
          'W razie wątpliwości zawsze sprawdzaj art. 23 ustawy o PIT (lub art. 16 ustawy o CIT) oraz przycisk „Dlaczego?” w aplikacji.',
        ],
        quiz: [
          {
            id: 'q-01-02-01',
            question:
              'Który z poniższych wydatków w jednoosobowej działalności gospodarczej (KPiR) stanowi koszt uzyskania przychodów (KUP)?',
            options: [
              'Mandat za parkowanie pod siedzibą klienta podczas pilnego wdrożenia.',
              'Zakup butelki whisky wręczonej kontrahentowi z okazji podpisania kontraktu.',
              'Opłata za roczną licencję programu do wystawiania faktur i obsługi KSeF.',
              'Odsetki za zwłokę zapłacone do urzędu skarbowego z tytułu spóźnionego VAT.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Licencja oprogramowania firmowego służy prowadzeniu działalności i nie widnieje w katalogu wyłączeń. Mandaty, odsetki budżetowe oraz alkohol (reprezentacja) są wyłączone z KUP na mocy art. 23 ust. 1 ustawy o PIT.',
          },
          {
            id: 'q-01-02-02',
            question:
              'Jak traktuje się spłatę raty kapitałowej zaciągniętego kredytu obrotowego w podatku dochodowym?',
            options: [
              'Cała spłata kapitału stanowi KUP w dniu obciążenia rachunku.',
              'Spłata kapitału jest neutralna podatkowo; kosztem uzyskania przychodów mogą być wyłącznie faktycznie zapłacone odsetki i prowizje.',
              'Spłata kapitału pomniejsza podatek VAT należny.',
              'Spłata kapitału jest przychodem podatkowym.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Otrzymanie pożyczki/kredytu nie jest przychodem, a zwrot kapitału nie stanowi kosztu uzyskania przychodów (art. 23 ust. 1 pkt 8 lit. a ustawy o PIT). Kosztem są zapłacone odsetki od kredytu firmowego.',
          },
        ],
      },
      {
        id: 'lesson-01-03',
        slug: 'dowod-ksiegowy-i-odpowiedzialnosc-przedsiebiorcy',
        moduleNumber: 1,
        lessonNumber: 3,
        title:
          'Dowód księgowy, jego cechy oraz odpowiedzialność przedsiębiorcy i biura rachunkowego',
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
            'Edukacja ogólna — zasady prawidłowego dokumentowania operacji oraz odpowiedzialności podatkowej dotyczą wszystkich podatników.',
        },
        intro:
          'W księgowości obowiązuje żelazna reguła: nie ma dowodu księgowego — nie ma zapisu w księgach. Zwykłe potwierdzenie płatności kartą z terminala albo zrzut ekranu z koszyka sklepowego nie zastąpią faktury. Równie ważne jest zrozumienie, kto odpowiada przed urzędem skarbowym, gdy zlecasz księgowość na zewnątrz.',
        sections: [
          {
            heading: 'Czym jest rzetelny i niewadliwy dowód księgowy',
            body: 'Podstawowym dowodem księgowym jest faktura (w tym faktura ustrukturyzowana w KSeF oraz tzw. faktura uproszczona, czyli paragon fiskalny z numerem NIP nabywcy do kwoty 450 zł brutto lub 100 euro). W ściśle określonych sytuacjach dowodem mogą być także: lista płac, deklaracja ZUS, wyciąg bankowy (np. dla prowizji bankowych), polisa ubezpieczeniowa, umowa kupna-sprzedaży od osoby prywatnej czy dowód wewnętrzny. Każdy dowód musi być rzetelny (zgodny z rzeczywistym przebiegiem operacji gospodarczej) i kompletny (zawierać strony, datę, przedmiot, kwotę i numer identyfikujący).',
            keyPoints: [
              'Paragon fiskalny BEZ numeru NIP nabywcy nie pozwala na wystawienie do niego faktury na firmę (art. 106b ust. 5 ustawy o VAT) i co do zasady nie daje prawa do odliczenia VAT.',
              'Potwierdzenie przelewu dokumentuje zapłatę, a nie zakup towaru czy usługi (wyjątkiem są m.in. opłaty skarbowe, sądowe i prowizje na wyciągu bankowym).',
            ],
          },
          {
            heading: 'Odpowiedzialność przedsiębiorcy a rola biura rachunkowego',
            body: 'Wielu właścicieli firm zakłada, że podpisanie umowy z biurem rachunkowym całkowicie przenosi odpowiedzialność przed urzędem skarbowym na księgową. To niebezpieczny mit. Zgodnie z art. 26 Ordynacji podatkowej podatnik odpowiada całym swoim majątkiem za wynikające ze zobowiązań podatkowych podatki. Urząd skarbowy w razie niedopłaty zawsze egzekwuje zaległy podatek wraz z odsetkami od podatnika (przedsiębiorcy lub spółki). Dopiero w drugim kroku przedsiębiorca może dochodzić odszkodowania od biura rachunkowego na drodze cywilnej z jego obowiązkowej polisy OC — o ile błąd leżał po stronie biura, a nie niekompletnych informacji od klienta.',
            keyPoints: [
              'Za zaległość podatkową wobec fiskusa zawsze odpowiada podatnik (art. 26 Ordynacji podatkowej).',
              'W spółce z o.o. za rachunkowość odpowiada kierownik jednostki, czyli zarząd spółki (art. 4 ust. 5 ustawy o rachunkowości), nawet gdy księgi prowadzi zewnętrzne biuro.',
            ],
          },
        ],
        numericalExample: {
          title: 'Paragon z NIP (faktura uproszczona) a limit 450,00 PLN brutto',
          scenario:
            'Przedsiębiorca kupił na stacji paliw materiały eksploatacyjne na dwa paragony fiskalne z wydrukowanym numerem NIP firmy: pierwszy na kwotę 369,00 PLN brutto (w tym 23% VAT = 69,00 PLN), a drugi na kwotę 615,00 PLN brutto (w tym 23% VAT = 115,00 PLN), nie prosząc o pełną fakturę do drugiego zakupu.',
          steps: [
            {
              stepNumber: 1,
              label: 'Paragon nr 1 z NIP (do 450,00 PLN brutto)',
              calculation:
                'Stanowi pełnoprawną fakturę uproszczoną (300,00 PLN netto + 69,00 PLN VAT)',
              amountPln: '369,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Paragon nr 2 z NIP (powyżej 450,00 PLN brutto)',
              calculation:
                'Przekracza limit 450,00 PLN — nie jest fakturą uproszczoną, wymaga wymiany na zwykłą fakturę',
              amountPln: '615,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Kwota VAT bezpiecznie odliczalna bez wymiany paragonu nr 2',
              calculation:
                'Wyłącznie VAT z paragonu nr 1 (przy 100% użytku firmowym lub 50% przy aucie mieszanym)',
              amountPln: '69,00 PLN',
            },
          ],
          finalResultPln: '369,00 PLN',
          interpretation:
            'Tylko paragon z NIP do kwoty 450,00 PLN brutto (lub 100 euro) jest z mocy prawa fakturą uproszczoną. Paragon z NIP powyżej 450,00 PLN nie jest fakturą — należy na jego podstawie pobrać od sprzedawcy standardową fakturę (w KSeF).',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
            articleRef: 'art. 26',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Stanowi, że podatnik odpowiada całym swoim majątkiem za wynikające ze zobowiązań podatkowych podatki.',
          },
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef: 'art. 106b ust. 5 oraz art. 106e ust. 5 pkt 3',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Zakazuje wystawiania faktur na firmę do paragonów bez NIP nabywcy oraz definiuje limit 450 zł (100 euro) dla faktury uproszczonej.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm01-l03-historia-audytu-i-odpowiedzialnosc',
          '/settings',
          'Rejestr audytu operacji pokazujący oryginalny plik, autora propozycji oraz osobę zatwierdzającą zapis księgowy.',
          '[data-testid="audit-log-viewer"]',
        ),
        practicalExercise: {
          title: 'Zweryfikuj kompletność formalną dowodu księgowego przed księgowaniem',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Otwórz kolejkę dokumentów w firmie demo i wybierz przesłany skan paragonu za materiały biurowe na kwotę 246,00 PLN brutto.',
            'Sprawdź w podglądzie dokumentu, czy na paragonie widnieje poprawny NIP nabywcy oraz czy kwota brutto nie przekracza 450,00 PLN.',
            'Potwierdź typ dowodu „Faktura uproszczona (paragon z NIP ≤ 450 PLN)” i sprawdź wpis w dzienniku audytu.',
          ],
          expectedOutcome:
            'System dopuszcza dokument jako fakturę uproszczoną i zapisuje niezmienny ślad audytowy zatwierdzenia przez użytkownika.',
        },
        commonMistakes: [
          {
            mistake:
              'Zbieranie paragonów bez numeru NIP i próba zaksięgowania ich w kosztach oraz odliczenia VAT.',
            consequence:
              'Brak prawa do odliczenia VAT oraz sankcja 100% dodatkowego zobowiązania VAT w razie bezprawnego wystawienia faktury do takiego paragonu.',
            howToAvoid:
              'Zawsze podawaj kasjerowi NIP firmy PRZED zakończeniem nabijania paragonu na kasie fiskalnej albo od razu poproś o fakturę w KSeF.',
          },
          {
            mistake: 'Księgowanie faktury pro forma jako dowodu kosztowego.',
            consequence:
              'Zawyżenie kosztów i nieuprawnione odliczenie podatku VAT — pro forma to wyłącznie oferta handlowa / wezwanie do zapłaty, a nie faktura.',
            howToAvoid:
              'Po opłaceniu pro formy zawsze odbierz właściwą fakturę zaliczkową lub końcową (w KSeF).',
          },
          {
            mistake:
              'Brak bieżącej kontroli nad tym, co i na jakiej podstawie księguje biuro rachunkowe lub asystent AI.',
            consequence:
              'Odpowiedzialność finansowa za zaległość podatkową i odsetki obciąża bezpośrednio podatnika.',
            howToAvoid:
              'Korzystaj z przejrzystego podglądu wyliczeń i przycisku „Dlaczego?” przed zatwierdzeniem każdego miesiąca.',
          },
        ],
        summary: [
          'Podstawą zapisu w księgach jest rzetelny dowód księgowy — faktura pro forma lub potwierdzenie z terminala płatniczego nim nie są.',
          'Paragon z NIP nabywcy jest fakturą uproszczoną wyłącznie do kwoty 450,00 PLN brutto (lub 100 euro).',
          'Zlecenie księgowości do biura rachunkowego nie znosi odpowiedzialności podatnika wobec urzędu skarbowego (art. 26 Ordynacji podatkowej).',
        ],
        quiz: [
          {
            id: 'q-01-03-01',
            question:
              'Czy faktura pro forma otrzymana od dostawcy hostingu stanowi podstawę do odliczenia podatku VAT i ujęcia wydatku w PKPiR?',
            options: [
              'Tak, pod warunkiem że została opłacona przelewem firmowym.',
              'Tak, jeśli jej wartość nie przekracza 450,00 PLN brutto.',
              'Nie, faktura pro forma jest jedynie dokumentem handlowym (ofertą/wezwaniem do zapłaty), a nie dowodem księgowym.',
              'Tak, ale tylko u podatników rozliczających się kwartalnie.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Faktura pro forma nie jest fakturą w rozumieniu art. 106e ustawy o VAT ani dowodem księgowym w rozumieniu rozporządzenia ws. PKPiR. Po jej opłaceniu sprzedawca ma obowiązek wystawić właściwą fakturę.',
          },
          {
            id: 'q-01-03-02',
            question:
              'Kto odpowiada całym swoim majątkiem przed urzędem skarbowym za niezapłacony podatek wynikający z błędnego rozliczenia deklaracji?',
            options: [
              'Wyłącznie pracownik biura rachunkowego, który wprowadził dokument.',
              'Podatnik (przedsiębiorca / spółka) zgodnie z art. 26 Ordynacji podatkowej, któremu przysługuje ewentualny regres cywilny wobec biura rachunkowego.',
              'Dostawca oprogramowania księgowego.',
              'Bank prowadzący rachunek firmowy.',
            ],
            correctOptionIndex: 1,
            explanation:
              'W prawie podatkowym podmiotem zobowiązania wobec Skarbu Państwa jest zawsze podatnik (art. 26 Ordynacji podatkowej). Roszczenia wobec biura rachunkowego rozstrzyga się odrębnie na gruncie prawa cywilnego.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 2,
    slug: 'formy-prowadzenia-dzialalnosci-i-rodzaje-ewidencji',
    title: 'Moduł 2: Formy prowadzenia działalności i rodzaje ewidencji',
    subtitle:
      'Porównaj JDG, spółkę cywilną i spółkę z o.o., poznaj próg 2,5 mln euro dla pełnych ksiąg oraz policz, która forma opodatkowania zostawia najwięcej pieniędzy w kieszeni.',
    learningObjectives: [
      'Rozumieć różnice prawne, rejestracyjne i majątkowe między JDG w CEIDG, spółką cywilną a spółką z o.o. w KRS.',
      'Porównać na konkretnych kwotach skalę podatkową (12%/32%), podatek liniowy (19%) oraz ryczałt w 2026 roku.',
      'Rozróżniać klasyczny CIT (9%/19%) od ryczałtu od dochodów spółek (tzw. estońskiego CIT 10%/20%).',
    ],
    lessons: [
      {
        id: 'lesson-02-01',
        slug: 'jdg-spolka-cywilna-spolka-z-oo-porownanie',
        moduleNumber: 2,
        lessonNumber: 1,
        title: 'JDG w CEIDG, spółka cywilna a spółka z o.o. w KRS — różnice prawne i ewidencyjne',
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
          ],
          scopeNote:
            'Edukacja ogólna — lekcja pomaga dobrać formę organizacyjno-prawną i zrozumieć powiązany z nią obowiązkowy rodzaj ksiąg.',
        },
        intro:
          'Zanim wystawisz pierwszą fakturę, musisz zdecydować, w jakiej „zbroi prawnej” wystąpi Twój biznes. Jednoosobowa działalność gospodarcza daje prostotę i darmową rejestrację w kilkanaście minut, natomiast spółka z o.o. oddziela majątek firmy od prywatnego domu czy oszczędności, ale od pierwszego dnia wymaga pełnych ksiąg rachunkowych.',
        sections: [
          {
            heading: 'JDG oraz spółka cywilna — prostota CEIDG i pełna odpowiedzialność majątkowa',
            body: 'Jednoosobową działalność gospodarczą (JDG) rejestruje się bezpłatnie w CEIDG (przez biznes.gov.pl). Przedsiębiorca i firma to ta sama osoba prawna — właściciel może swobodnie wypłacać wypracowane środki, ale za długi biznesowe odpowiada całym majątkiem osobistym. Spółka cywilna nie jest odrębną osobą prawną, lecz umową wspólników wpisanych do CEIDG: sama spółka posiada własny NIP i REGON na potrzeby podatku VAT oraz zatrudniania pracowników, natomiast podatek dochodowy PIT opłaca każdy wspólnik osobno proporcjonalnie do udziału w zysku.',
            keyPoints: [
              'JDG oraz spółka cywilna osób fizycznych mogą prowadzić uproszczoną księgowość (PKPiR lub ewidencję ryczałtu), dopóki ich przychody netto nie osiągną limitu 2 500 000 euro.',
              'Dla roku 2026 limit 2 500 000 euro przeliczony po kursie NBP z 1 października 2025 r. (4,2586 zł/euro) wynosi 10 646 500,00 PLN przychodu netto za 2025 rok.',
            ],
          },
          {
            heading: 'Spółka z ograniczoną odpowiedzialnością (sp. z o.o.) w KRS',
            body: 'Spółka z o.o. jest kapitałową spółką handlową rejestrowaną w Krajowym Rejestrze Sądowym (np. przez system S24 lub u notariusza, z minimalnym kapitałem zakładowym 5 000 zł). Posiada odrębną osobowość prawną: pieniądze na koncie spółki należą do spółki, a nie do wspólników — każde przelanie gotówki wspólnikowi wymaga tytułu prawnego (np. dywidendy, wynagrodzenia z powołania, świadczeń powtarzających się z art. 176 KSH lub faktury B2B na warunkach rynkowych). Wspólnicy nie odpowiadają za zobowiązania spółki swoim majątkiem, natomiast członkowie zarządu odpowiadają subsydiarnie (art. 299 KSH), jeśli nie zgłoszą we właściwym czasie wniosku o upadłość niewypłacalnej spółki.',
            keyPoints: [
              'Każda spółka z o.o. ma bezwzględny obowiązek prowadzenia pełnych ksiąg rachunkowych od pierwszej złotówki przychodu (art. 2 ust. 1 pkt 1 ustawy o rachunkowości).',
              'Wieloosobowa spółka z o.o. (z realnym drugim wspólnikiem) zwalnia wspólników z obowiązkowych składek ZUS z samego tytułu posiadania udziałów.',
            ],
          },
        ],
        numericalExample: {
          title: 'Weryfikacja limitu pełnych ksiąg 2,5 mln euro w JDG na rok 2026',
          scenario:
            'Hurtownia prowadzona w formie JDG osiągnęła w 2025 roku przychody netto ze sprzedaży towarów w wysokości 9 400 000,00 PLN (11 562 000,00 PLN brutto z VAT). Przedsiębiorca sprawdza, czy od 1 stycznia 2026 r. musi przejść z PKPiR na pełne księgi rachunkowe.',
          steps: [
            {
              stepNumber: 1,
              label: 'Ustawowy próg pełnych ksiąg w PLN na 2026 r.',
              calculation: '2 500 000 euro × 4,2586 PLN/euro (kurs NBP z 1.10.2025 r.)',
              amountPln: '10 646 500,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Przychód firmy brany do porównania (wartość netto bez VAT)',
              calculation: '11 562 000,00 PLN brutto − 2 162 000,00 PLN VAT',
              amountPln: '9 400 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Zapas bezpieczeństwa poniżej progu pełnych ksiąg',
              calculation: '10 646 500,00 PLN − 9 400 000,00 PLN',
              amountPln: '1 246 500,00 PLN',
            },
          ],
          finalResultPln: '1 246 500,00 PLN',
          interpretation:
            'Ponieważ do limitu porównuje się przychód netto (9 400 000,00 PLN), a nie brutto, hurtownia mieści się poniżej progu 10 646 500,00 PLN i w 2026 r. może nadal legalnie prowadzić PKPiR.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 września 1994 r. o rachunkowości',
            articleRef: 'art. 2 ust. 1 pkt 1 i pkt 2',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Nakłada bezwzględny obowiązek prowadzenia ksiąg rachunkowych na spółki kapitałowe oraz określa próg 2 500 000 euro przychodów netto dla osób fizycznych i spółek cywilnych.',
          },
          {
            actTitle: 'Ustawa z dnia 15 września 2000 r. — Kodeks spółek handlowych',
            articleRef: 'art. 151 oraz art. 299',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20000941037',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje odrębną osobowość prawną spółki z o.o., brak osobistej odpowiedzialności wspólników oraz subsydiarną odpowiedzialność zarządu.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm02-l01-przelacznik-firm-i-profili',
          '/app',
          'Przełącznik podmiotów prezentujący obok siebie profile JDG KPiR, JDG Ryczałt oraz Spółki z o.o. na pełnych księgach.',
          '[data-testid="company-profile-switcher"]',
        ),
        practicalExercise: {
          title: 'Porównaj ustawienia profilu ewidencyjnego JDG oraz spółki z o.o.',
          demoCompanyId: 'demo_spzoo_gamma',
          demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
          steps: [
            'Otwórz widok konfiguracji podmiotu dla „Pracownia Projektowa Alfa” (JDG) i sprawdź aktywne moduły: PKPiR, Rejestry VAT, ZUS właściciela.',
            'Przełącz kontekst na „Manufaktura Technologiczna Gamma sp. z o.o.” i porównaj aktywne moduły: Księga Główna (Wn/Ma), Bilans, RZiS oraz CIT.',
            'Zwróć uwagę na wersjonowanie profilu podatkowego z datą obowiązywania „od–do”.',
          ],
          expectedOutcome:
            'Użytkownik rozumie, dlaczego aplikacja dobiera zupełnie inne księgi i deklaracje w zależności od formy prawnej podmiotu.',
        },
        commonMistakes: [
          {
            mistake:
              'Wypłacanie pieniędzy z konta firmowego spółki z o.o. na prywatne zakupy wspólnika „jak w JDG”.',
            consequence:
              'Powstanie nieudokumentowanych niedoborów kasowych, ryzyko opodatkowania ukrytego zysku lub odpowiedzialności karnej i podatkowej.',
            howToAvoid:
              'W spółce z o.o. każda wypłata na rzecz wspólnika lub członka zarządu musi wynikać z uchwały, umowy lub faktury.',
          },
          {
            mistake:
              'Zakładanie jednoosobowej spółki z o.o. (100% udziałów u jednej osoby) w celu uniknięcia składek ZUS.',
            consequence:
              'Jedyny wspólnik jednoosobowej spółki z o.o. podlega z mocy ustawy pełnym składkom ZUS niemal tak samo jak przedsiębiorca w JDG!',
            howToAvoid:
              'Przed rejestracją spółki zweryfikuj strukturę udziałową (art. 8 ust. 6 pkt 4 ustawy o systemie ubezpieczeń społecznych).',
          },
          {
            mistake:
              'Rozliczanie podatku dochodowego „na spółkę cywilną” zamiast osobno na każdego wspólnika.',
            consequence:
              'Spółka cywilna jest podatnikiem VAT, ale nigdy nie jest podatnikiem PIT — PIT rozlicza każdy wspólnik według własnego udziału.',
            howToAvoid:
              'Prowadź wspólną PKPiR spółki cywilnej, a zaliczki PIT obliczaj dla każdego wspólnika zgodnie z procentem udziału w zysku.',
          },
        ],
        summary: [
          'JDG to najszybszy start i swobodne dysponowanie gotówką, ale pełna odpowiedzialność prywatnym majątkiem.',
          'Spółka cywilna rozlicza VAT jako spółka, natomiast podatek PIT płacą odrębnie jej wspólnicy.',
          'Spółka z o.o. chroni majątek prywatny wspólników, lecz od pierwszego dnia wymaga pełnej księgowości wg Ustawy o rachunkowości.',
        ],
        quiz: [
          {
            id: 'q-02-01-01',
            question:
              'Od jakiego poziomu przychodów netto spółka z ograniczoną odpowiedzialnością (sp. z o.o.) ma obowiązek prowadzić pełne księgi rachunkowe?',
            options: [
              'Od przekroczenia 240 000,00 PLN rocznie.',
              'Od przekroczenia równowartości 2 500 000 euro.',
              'Od pierwszego dnia istnienia niezależnie od wysokości przychodów (nawet przy 0,00 PLN sprzedaży).',
              'Dopiero po zatrudnieniu co najmniej 10 pracowników.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Zgodnie z art. 2 ust. 1 pkt 1 ustawy o rachunkowości spółki kapitałowe (w tym sp. z o.o.) prowadzą pełne księgi rachunkowe bez względu na wielkość przychodów. Limit 2,5 mln euro dotyczy m.in. osób fizycznych (JDG) i spółek cywilnych osób fizycznych.',
          },
          {
            id: 'q-02-01-02',
            question:
              'Kto jest podatnikiem podatku dochodowego (PIT) w dwuosobowej spółce cywilnej osób fizycznych?',
            options: [
              'Sama spółka cywilna jako odrębna osoba prawna.',
              'Każdy ze wspólników osobno, proporcjonalnie do swojego prawa do udziału w zysku.',
              'Wyłącznie wspólnik posiadający większy wkład początkowy.',
              'Urząd skarbowy wybiera jednego reprezentanta podatkowego na dany rok.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Spółka cywilna nie posiada osobowości prawnej i nie jest podatnikiem PIT — przychody i koszty przypisuje się wspólnikom proporcjonalnie do ich udziału w zysku (art. 8 ust. 1 ustawy o PIT).',
          },
        ],
      },
      {
        id: 'lesson-02-02',
        slug: 'wybor-formy-opodatkowania-jdg-skala-liniowy-ryczalt',
        moduleNumber: 2,
        lessonNumber: 2,
        title: 'Wybór formy opodatkowania w JDG: skala, liniowy i ryczałt — porównanie na liczbach',
        estimatedMinutes: 18,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['jdg_kpir_skala', 'jdg_kpir_liniowy', 'jdg_ryczalt'],
          scopeNote:
            'Dotyczy osób fizycznych prowadzących działalność gospodarczą (JDG oraz wspólników spółek cywilnych/jawnych osób fizycznych).',
        },
        intro:
          'W polskiej księgowości nie wygrywa ten, kto patrzy wyłącznie na stawkę podatku PIT, lecz ten, kto liczy sumę podatku dochodowego ORAZ składki zdrowotnej. Od czasu reform podatkowych składka zdrowotna stała się de facto drugim podatkiem — sprawdźmy na konkretnych liczbach 2026 roku, jak porównać wszystkie trzy formy.',
        sections: [
          {
            heading: 'Skala podatkowa (12% / 32%) i podatek liniowy (19%)',
            body: 'Na zasadach ogólnych (skala podatkowa) płacisz 0% podatku od dochodu do kwoty wolnej 30 000 zł rocznie, następnie 12% od nadwyżki do 120 000 zł (kwota zmniejszająca podatek to 3 600 zł), a powyżej 120 000 zł stawka rośnie do 32%. Możesz rozliczać się wspólnie z małżonkiem i korzystać z ulgi na dzieci, ale składka zdrowotna wynosi aż 9% dochodu bez prawa do jej odliczenia. Na podatku liniowym stawka PIT wynosi zawsze 19% niezależnie od wysokości dochodu (brak kwoty wolnej i wspólnego rozliczenia z małżonkiem), natomiast składka zdrowotna to 4,9% dochodu, a zapłaconą składkę zdrowotną w 2026 r. można zaliczyć w koszty lub odliczyć od dochodu do rocznego limitu 14 100,00 PLN.',
            keyPoints: [
              'Na skali realne łączne obciążenie PIT + zdrowotna w pierwszym progu (powyżej 30 000 zł) to 12% + 9% = 21%, a w drugim progu powyżej 120 000 zł aż 32% + 9% = 41%!',
              'Na podatku liniowym 19% + 4,9% zdrowotnej (z częściowym odliczeniem do 14 100 zł rocznie) daje przewidywalne obciążenie ok. 22,9%–23,9% przy wysokich dochodach i istotnych kosztach.',
            ],
          },
          {
            heading: 'Ryczałt od przychodów ewidencjonowanych i termin zmiany formy',
            body: 'Na ryczałcie podatek liczysz od przychodu (bez odejmowania kosztów zakupu sprzętu, paliwa czy biura), ale stawki bywają znacznie niższe — np. 12% dla programistów, 14% dla architektów i inżynierów, 8,5% dla wielu usług, a 3% dla handlu. Dodatkowo składka zdrowotna w 2026 r. jest zryczałtowana progowo (498,35 zł przy przychodzie do 60 tys. zł; 830,58 zł między 60 tys. a 300 tys. zł; 1 495,04 zł powyżej 300 tys. zł rocznie), a 50% zapłaconej składki zdrowotnej odliczasz od przychodu. Zmiany formy opodatkowania na dany rok dokonuje się przez aktualizację wpisu CEIDG-1 do 20. dnia miesiąca następującego po miesiącu uzyskania pierwszego przychodu w roku (zwykle do 20 lutego).',
            keyPoints: [
              'Zapłacone składki społeczne ZUS właściciela (np. Duży ZUS) można odliczyć zarówno na skali i liniowym (od dochodu lub w KUP), jak i na ryczałcie (od przychodu).',
              'Termin wyboru formy opodatkowania po pierwszym przychodzie w styczniu mija 20 lutego — spóźnienie o jeden dzień blokuje zmianę na cały rok!',
            ],
          },
        ],
        numericalExample: {
          title: 'Roczny pojedynek 2026: Skala vs Liniowy vs Ryczałt 12% dla specjalisty B2B',
          scenario:
            'Konsultant IT (bez wspólnego rozliczenia z małżonkiem, po ulgach ZUS — przyjmijmy dla uproszczenia porównania dochód/przychód już po odliczeniu składek społecznych ZUS): roczny przychód po ZUS społecznym wynosi 200 000,00 PLN, a roczne koszty firmowe KUP wynoszą 20 000,00 PLN (czyli dochód bazowy = 180 000,00 PLN). Porównujemy łączną daninę (PIT + składka zdrowotna) w 2026 roku.',
          steps: [
            {
              stepNumber: 1,
              label: 'Wariant A — Skala podatkowa (dochód 180 000,00 PLN)',
              calculation:
                'PIT: 10 800,00 PLN + 32% × 60 000,00 PLN = 30 000,00 PLN; Zdrowotna 9%: 16 200,00 PLN; Razem = 46 200,00 PLN',
              amountPln: '46 200,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Wariant B — Podatek liniowy 19% (dochód 180 000,00 PLN)',
              calculation:
                'Zdrowotna 4,9%: 8 820,00 PLN (mieści się w limicie 14 100 PLN); Podstawa PIT: 180 000 − 8 820 = 171 180 PLN; PIT 19% = 32 524,00 PLN; Razem = 41 344,00 PLN',
              amountPln: '41 344,00 PLN',
            },
            {
              stepNumber: 3,
              label:
                'Wariant C — Ryczałt 12% (przychód 200 000,00 PLN, próg zdrowotnej 60–300 tys.)',
              calculation:
                'Zdrowotna: 12 × 830,58 PLN = 9 966,96 PLN; Odliczenie 50% zdrowotnej = 4 983,48 PLN; Podstawa ryczałtu: 195 017 PLN × 12% = 23 402,00 PLN; Razem = 33 368,96 PLN',
              amountPln: '33 368,96 PLN',
            },
            {
              stepNumber: 4,
              label: 'Oszczędność ryczałtu 12% względem skali podatkowej w tym scenariuszu',
              calculation: '46 200,00 PLN − 33 368,96 PLN',
              amountPln: '12 831,04 PLN',
            },
          ],
          finalResultPln: '12 831,04 PLN',
          interpretation:
            'Przy niskich kosztach własnych (10% przychodu) i dochodzie wpadającym w drugi próg podatkowy ryczałt 12% zostawia w kieszeni specjalisty o 12 831,04 PLN więcej niż skala podatkowa i o 7 975,04 PLN więcej niż podatek liniowy.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 9a ust. 2, art. 27 ust. 1 oraz art. 30c ust. 1 i ust. 2 pkt 2',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa skalę podatkową 12%/32% z kwotą zmniejszającą 3 600 zł, podatek liniowy 19%, limit odliczenia składki zdrowotnej oraz termin wyboru formy opodatkowania do 20. dnia kolejnego miesiąca.',
          },
          {
            actTitle: 'Portal Podatkowy Ministerstwa Finansów — Wybór formy opodatkowania',
            articleRef: 'Poradnik PIT / Ryczałt dla przedsiębiorców',
            sourceKind: 'official_guidance',
            officialUrl: 'https://www.podatki.gov.pl/pit/',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Oficjalne objaśnienia zasad opodatkowania dochodów i przychodów z działalności gospodarczej osób fizycznych.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm02-l02-porownanie-form-opodatkowania',
          '/settings',
          'Widok konfiguracji profilu podatkowego firmy z podsumowaniem parametrów skali, podatku liniowego i ryczałtu na 2026 rok.',
          '[data-testid="tax-regime-comparison-card"]',
        ),
        practicalExercise: {
          title: 'Sprawdź parametry profilu podatkowego dwóch firm demonstracyjnych JDG',
          demoCompanyId: 'demo_jdg_ryczalt_beta',
          demoCompanyName: 'Studio Kodowania Beta — Anna Nowak (dane syntetyczne)',
          steps: [
            'Wybierz firmę „Pracownia Projektowa Alfa — Jan Kowalski” i odczytaj w Ustawieniach jej formę opodatkowania (PKPiR — skala podatkowa).',
            'Przełącz na „Studio Kodowania Beta — Anna Nowak” i sprawdź profil ryczałtu 12% z aktywnym odliczeniem 50% zapłaconych składek zdrowotnych.',
            'Kliknij ikonę pomocy przy polu „Forma opodatkowania”, aby wyświetlić termin graniczny zmiany formy w CEIDG.',
          ],
          expectedOutcome:
            'Użytkownik potrafi świadomie zweryfikować ustawienia podatkowe firmy przed rozpoczęciem księgowania nowego roku.',
        },
        commonMistakes: [
          {
            mistake:
              'Wybór ryczałtu lub podatku liniowego przy jednoczesnym wykonywaniu w JDG tych samych czynności na rzecz obecnego lub byłego pracodawcy z tego samego roku (lub poprzedniego na ryczałcie).',
            consequence:
              'Utrata prawa do liniówki / ryczałtu z mocy ustawy i przymusowe przeliczenie całego roku według skali podatkowej 12%/32% z odsetkami.',
            howToAvoid:
              'Przy przejściu z etatu na B2B u tego samego pracodawcy dokładnie sprawdź wyłączenia z art. 9a ust. 3 PIT (liniowy) i art. 8 ust. 2 ustawy o ryczałcie!',
          },
          {
            mistake:
              'Pomijanie składki zdrowotnej przy symulacji opłacalności formy opodatkowania.',
            consequence:
              'Błędne przekonanie, że stawka 12% na skali jest równa stawce 12% na ryczałcie (podczas gdy na skali dochodzi 9% nieodliczalnej składki zdrowotnej od dochodu).',
            howToAvoid:
              'Zawsze porównuj sumę: podatek PIT + roczna składka zdrowotna + koszt utraconych ulg rodzinnych.',
          },
          {
            mistake:
              'Próba zmiany formy opodatkowania przez samo wpłacenie zaliczki z innym symbolem (np. PIT-36L) bez aktualizacji CEIDG-1.',
            consequence:
              'Sam tytuł przelewu nie zastępuje oświadczenia o wyborze formy opodatkowania (wymagane jest oświadczenie pisemne do US lub wniosek CEIDG-1 w ustawowym terminie).',
            howToAvoid:
              'Złóż wniosek CEIDG-1 na biznes.gov.pl i zachowaj Urzędowe Poświadczenie Odbioru (UPO).',
          },
        ],
        summary: [
          'Skala podatkowa (12%/32%) opłaca się głównie przy niższych dochodach (dzięki 30 000 zł kwoty wolnej) oraz przy wspólnym rozliczeniu z małżonkiem o niskich dochodach.',
          'Podatek liniowy (19% + 4,9% zdrowotnej z limitem odliczenia 14 100 zł w 2026 r.) wygrywa przy wysokich dochodach i wysokich kosztach firmowych.',
          'Ryczałt opłaca się przy niskich kosztach własnych i korzystnej stawce PKWiU (np. 8,5% lub 12%), ale pozbawia rozliczania kosztów zakupów.',
        ],
        quiz: [
          {
            id: 'q-02-02-01',
            question:
              'Ile wynosi roczna kwota wolna od podatku oraz próg wejścia w stawkę 32% na skali podatkowej PIT w 2026 roku?',
            options: [
              'Kwota wolna 8 000,00 PLN, próg 85 528,00 PLN.',
              'Kwota wolna 30 000,00 PLN, próg 120 000,00 PLN.',
              'Kwota wolna 60 000,00 PLN, próg 240 000,00 PLN.',
              'Brak kwoty wolnej, jednolita stawka 19%.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 27 ust. 1 ustawy o PIT kwota wolna wynosi 30 000,00 PLN (kwota zmniejszająca podatek 3 600,00 PLN), a drugi próg 32% obowiązuje dla nadwyżki podstawy opodatkowania ponad 120 000,00 PLN.',
          },
          {
            id: 'q-02-02-02',
            question:
              'Do kiedy przedsiębiorca, który pierwszy przychód w 2026 roku osiągnął w styczniu, może zmienić formę opodatkowania na ten rok?',
            options: [
              'Wyłącznie do 31 grudnia poprzedniego roku.',
              'Do 20 lutego 2026 r. (do 20. dnia miesiąca następującego po miesiącu uzyskania pierwszego przychodu).',
              'W dowolnym momencie do 30 kwietnia następnego roku przy składaniu zeznania rocznego.',
              'Do 25 stycznia 2026 r.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Art. 9a ust. 2 ustawy o PIT (oraz analogicznie art. 9 ust. 1 ustawy o ryczałcie) wyznacza termin do 20. dnia miesiąca następującego po miesiącu, w którym podatnik osiągnął pierwszy przychód w roku podatkowym.',
          },
        ],
      },
      {
        id: 'lesson-02-03',
        slug: 'opodatkowanie-spolek-cit-klasyczny-i-estonski',
        moduleNumber: 2,
        lessonNumber: 3,
        title: 'CIT klasyczny (9% i 19%) a ryczałt od dochodów spółek (CIT estoński)',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
            'sp_zoo_pelne_ksiegi_cit_estonski',
          ],
          scopeNote:
            'Dotyczy spółek będących podatnikami podatku dochodowego od osób prawnych (w szczególności spółki z o.o., S.A., PSA, spółki komandytowej).',
        },
        intro:
          'Słysząc o 9-procentowym podatku CIT w spółce z o.o., wielu przedsiębiorców myśli, że to najtańsza forma opodatkowania w Polsce. Zapominają jednak o tzw. podwójnym opodatkowaniu: najpierw podatek płaci spółka, a przy wypłacie dywidendy — drugi raz płaci go wspólnik (19% PIT). Sprawdźmy, jak działa klasyczny CIT, a jak rewolucyjny CIT estoński.',
        sections: [
          {
            heading: 'Klasyczny CIT (9% i 19%) oraz podwójne opodatkowanie dywidendy',
            body: 'W klasycznym modelu CIT spółka płaci w trakcie roku zaliczki od bieżącego dochodu podatkowego. Podstawowa stawka CIT wynosi 19%, natomiast mali podatnicy (których przychód ze sprzedaży brutto z VAT w poprzednim roku nie przekroczył równowartości 2 mln euro) oraz spółki rozpoczynające działalność mogą korzystać z preferencyjnej stawki 9% od dochodów operacyjnych, o ile ich bieżące przychody netto w roku podatkowym również nie przekroczą 2 mln euro. Gdy jednak wspólnicy chcą wypłacić zysk po opodatkowaniu jako dywidendę, spółka jako płatnik pobiera dodatkowo zryczałtowany 19% PIT od dywidendy.',
            keyPoints: [
              'Przy 9% CIT i wypłacie 100% zysku dywidendą ze 100 zł zysku zostaje w spółce 91 zł, a po 19% PIT od 91 zł (17,29 zł) do kieszeni wspólnika trafia 73,71 zł — efektywne opodatkowanie wynosi 26,29%!',
              'Przy 19% CIT i 19% PIT od dywidendy łączne efektywne obciążenie sięga aż 34,39%!',
            ],
          },
          {
            heading: 'Ryczałt od dochodów spółek (CIT estoński — 10% i 20%)',
            body: 'CIT estoński (rozdział 6b ustawy o CIT) całkowicie zmienia filozofię rozliczeń: dopóki zysk pozostaje w spółce i pracuje na jej rozwój (zakup maszyn, towarów, zespół, lokaty firmowe), spółka płaci 0,00 PLN bieżącego podatku CIT! Podatek pojawia się dopiero przy podjęciu uchwały o podziale zysku (lub przy wystąpieniu tzw. ukrytych zysków albo wydatków niezwiązanych z działalnością). Stawka CIT estońskiego wynosi 10% dla małego podatnika i 20% dla większych spółek, ale wspólnik odlicza od swojego 19-procentowego PIT od dywidendy aż 90% (u małego podatnika) lub 70% (u pozostałych) podatku zapłaconego przez spółkę! Dzięki temu łączny efektywny podatek (CIT + PIT) spada do równych 20% u małego podatnika oraz 25% u dużego podatnika.',
            keyPoints: [
              'Warunkiem CIT estońskiego jest m.in.: udziałowcami są wyłącznie osoby fizyczne, zatrudnianie min. 3 osób na etacie (lub odpowiednich zleceniach, z ulgą dla startujących spółek) oraz mniej niż 50% przychodów pasywnych.',
              'Na CIT estońskim trzeba skrupulatnie pilnować tzw. ukrytych zysków (np. pożyczek ze spółki dla wspólników czy prywatnego użytku aut spółki — 50% wydatków stanowi ukryty zysk).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Wypłata 100 000,00 PLN wypracowanego zysku małej spółki z o.o.: CIT klasyczny 9% vs CIT estoński',
          scenario:
            'Mała spółka z o.o. spełniająca warunki małego podatnika wypracowała w 2026 roku 100 000,00 PLN zysku brutto przed opodatkowaniem. Wspólnicy (osoby fizyczne) postanawiają wypłacić cały zysk w formie dywidendy.',
          steps: [
            {
              stepNumber: 1,
              label: 'Klasyczny CIT 9% + PIT od dywidendy 19% (łączny podatek)',
              calculation:
                'CIT spółki: 9 000,00 PLN; Zysk netto: 91 000,00 PLN; PIT wspólnika 19% × 91 000 = 17 290,00 PLN; Suma podatków = 26 290,00 PLN',
              amountPln: '26 290,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'CIT estoński 10% + PIT wspólnika po odliczeniu 90% CIT (łączny podatek)',
              calculation:
                'CIT spółki: 10 000,00 PLN; PIT wspólnika: 19% × 100 000 − 90% × 10 000 = 19 000 − 9 000 = 10 000,00 PLN; Suma podatków = 20 000,00 PLN',
              amountPln: '20 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Kwota netto w ręku wspólników na CIT estońskim',
              calculation: '100 000,00 PLN − 20 000,00 PLN',
              amountPln: '80 000,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Korzyść finansowa CIT estońskiego przy wypłacie dywidendy',
              calculation: '26 290,00 PLN − 20 000,00 PLN',
              amountPln: '6 290,00 PLN',
            },
          ],
          finalResultPln: '6 290,00 PLN',
          interpretation:
            'Na każdych 100 000,00 PLN wypłacanego zysku mała spółka na CIT estońskim oszczędza 6 290,00 PLN podatku (efektywnie 20% zamiast 26,29%), a jeśli zysk reinwestuje w spółce — nie płaci podatku dochodowego aż do momentu jego wypłaty.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
            articleRef: 'art. 19 ust. 1 oraz art. 28j–28o (ryczałt od dochodów spółek)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19920210086',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Ustanawia stawki CIT 19% i 9% dla małych podatników oraz kompleksowe zasady opodatkowania ryczałtem od dochodów spółek (CIT estoński 10% i 20%).',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 30a ust. 1 pkt 4 oraz ust. 19',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje 19% zryczałtowany PIT od dywidend oraz odliczenie 90% lub 70% ryczałtu zapłaconego przez spółkę na CIT estońskim.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm02-l03-profil-cit-spolki-zoo',
          '/taxes',
          'Widok kalkulacji podatku dochodowego spółki z o.o. z informacją o statusie małego podatnika CIT i wybranej ścieżce opodatkowania.',
          '[data-testid="cit-tax-summary-panel"]',
        ),
        practicalExercise: {
          title: 'Sprawdź warunki statusu małego podatnika CIT w firmie demo Gamma sp. z o.o.',
          demoCompanyId: 'demo_spzoo_gamma',
          demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
          steps: [
            'Przełącz kontekst na „Manufaktura Technologiczna Gamma sp. z o.o.” i przejdź do sekcji „Podatki i JPK”.',
            'Otwórz szufladę „Dlaczego?” przy stawce CIT 9% i zweryfikuj dwa limity 2 mln euro (brutto za rok poprzedni oraz netto w roku bieżącym).',
            'Sprawdź symulację efektywnego obciążenia dywidendy wspólnika.',
          ],
          expectedOutcome:
            'Użytkownik rozumie różnicę między dwoma progami 2 mln euro w CIT klasycznym 9% oraz mechanizm odliczenia w CIT estońskim.',
        },
        commonMistakes: [
          {
            mistake:
              'Przekonanie, że po zapłaceniu 9% CIT przez spółkę z o.o. wspólnik może bez podatku przelać zysk na swoje prywatne konto.',
            consequence:
              'Pominięcie obowiązkowego 19% podatku PIT od dywidendy (płatnego przez spółkę jako płatnika na deklaracji PIT-8AR).',
            howToAvoid:
              'Zawsze planuj dystrybucję zysku ze spółki z uwzględnieniem obu warstw podatkowych (CIT spółki + PIT wspólnika).',
          },
          {
            mistake:
              'Wejście na CIT estoński przez spółkę, której udziałowcem jest inna spółka z o.o. lub fundacja rodzinna.',
            consequence:
              'Natychmiastowe niespełnienie warunku podmiotowego z art. 28j ust. 1 pkt 4 ustawy o CIT (udziałowcami mogą być wyłącznie osoby fizyczne).',
            howToAvoid:
              'Przed złożeniem zawiadomienia ZAW-RD przeprowadź pełną checklistę warunków wejścia w CIT estoński.',
          },
          {
            mistake:
              'Mylenie sposobu liczenia limitu 2 mln euro dla małego podatnika (ze sprzedaży brutto z VAT za rok poprzedni) z limitem bieżących przychodów dla 9% CIT (wszystkie przychody netto bez VAT w roku bieżącym).',
            consequence:
              'Błędne stosowanie stawki 9% zamiast 19% po przekroczeniu bieżącego limitu w trakcie roku podatkowego.',
            howToAvoid:
              'Monitoruj oba wskaźniki automatycznie w module Podatki polskiej platformy księgowej.',
          },
        ],
        summary: [
          'Klasyczny CIT (9% lub 19%) wiąże się z bieżącymi zaliczkami oraz dodatkowym 19% PIT przy wypłacie dywidendy wspólnikom (efektywnie 26,29% lub 34,39%).',
          'CIT estoński odracza podatek do chwili dystrybucji zysku i obniża łączne obciążenie CIT + PIT do 20% (mały podatnik) lub 25% (pozostali).',
          'Prawo do 9% CIT wymaga pilnowania dwóch odrębnych limitów równowartości 2 mln euro.',
        ],
        quiz: [
          {
            id: 'q-02-03-01',
            question:
              'Ile wynosi łączne efektywne opodatkowanie wypłacanej dywidendy (CIT spółki + PIT wspólnika będącego osobą fizyczną) u małego podatnika na CIT estońskim?',
            options: ['9%', '10%', '20%', '34,39%'],
            correctOptionIndex: 2,
            explanation:
              'Mała spółka na CIT estońskim płaci 10% CIT, a wspólnik pomniejsza swój 19% PIT o 90% podatku zapłaconego przez spółkę (19% − 9% = 10%), co daje łącznie równe 20% efektywnego podatku.',
          },
          {
            id: 'q-02-03-02',
            question:
              'Kto może być wspólnikiem (udziałowcem) spółki z o.o. korzystającej z ryczałtu od dochodów spółek (CIT estońskiego)?',
            options: [
              'Dowolne spółki kapitałowe i fundusze inwestycyjne.',
              'Wyłącznie osoby fizyczne nieposiadające praw majątkowych w funduszach powierniczych / fundacjach rodzinnych wykluczonych ustawowo.',
              'Wyłącznie zagraniczne spółki holdingowe z UE.',
              'Skarb Państwa oraz jednostki samorządu terytorialnego.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 28j ust. 1 pkt 4 ustawy o CIT jednym z fundamentalnych warunków CIT estońskiego jest prosta struktura właścicielska — udziałowcami mogą być wyłącznie osoby fizyczne.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 3,
    slug: 'podatki-w-praktyce-pit-cit-i-vat',
    title: 'Moduł 3: Podatki w praktyce — PIT, CIT i VAT',
    subtitle:
      'Opanuj narastający mechanizm zaliczek dochodowych, neutralność VAT należnego i naliczonego, nowy limit zwolnienia 240 000 zł od 2026 roku oraz obowiązkowy Split Payment.',
    learningObjectives: [
      'Samodzielnie obliczać zaliczki na podatek dochodowy narastająco od początku roku z zaokrągleniem do pełnych złotych.',
      'Rozliczać podatek VAT należny i naliczony oraz stosować właściwe stawki (23%, 8%, 5%, 0%, zw.).',
      'Bezpiecznie stosować zwolnienie podmiotowe z VAT do limitu 240 000 zł (od 2026 r.), metodę kasową oraz obowiązkowy MPP.',
    ],
    lessons: [
      {
        id: 'lesson-03-01',
        slug: 'mechanizm-zaliczek-pit-i-cit-w-trakcie-roku',
        moduleNumber: 3,
        lessonNumber: 1,
        title: 'Mechanizm zaliczek w PIT i CIT — dlaczego liczymy je narastająco od początku roku',
        estimatedMinutes: 15,
        audienceScope: {
          type: 'general_education',
          applicableProfiles: [
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'jdg_ryczalt',
            'spolka_cywilna_kpir',
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
          ],
          scopeNote:
            'Dotyczy wszystkich podatników opłacających miesięczne lub kwartalne zaliczki na PIT i klasyczny CIT oraz ryczałt ewidencjonowany.',
        },
        intro:
          'Dlaczego w jednym miesiącu zaliczka na PIT wynosi 0 zł, mimo że wystawiłeś fakturę, a w kolejnym nagle podskakuje? Odpowiedź kryje się w rachunku narastającym od 1 stycznia. Podatek dochodowy jest podatkiem rocznym, a miesięczne lub kwartalne wpłaty to jedynie zaliczki na poczet końcowego rozliczenia roku.',
        sections: [
          {
            heading: 'Rachunek narastający i termin 20. dnia miesiąca',
            body: 'Na skali podatkowej, podatku liniowym oraz w klasycznym CIT nie liczysz każdego miesiąca w próżni. Co miesiąc sumujesz wszystkie przychody od 1 stycznia do końca danego miesiąca, odejmujesz wszystkie koszty KUP od 1 stycznia (oraz zapłacone składki społeczne ZUS i ewentualne odliczenie zdrowotnej na liniówce), zaokrąglasz podstawę opodatkowania do pełnych złotych, wyliczasz podatek należny od początku roku i odejmujesz sumę zaliczek należnych za poprzednie miesiące! Dzięki temu strata z lutego automatycznie kompensuje zysk z marca, a na skali podatkowej kwota wolna 30 000 zł chroni pierwsze dochody w roku aż do jej wyczerpania.',
            keyPoints: [
              'Zaliczkę miesięczną (lub ryczałt) wpłaca się na indywidualny mikrorachunek podatkowy do 20. dnia kolejnego miesiąca (również za grudzień — do 20 stycznia kolejnego roku!).',
              'Mały podatnik oraz podatnik rozpoczynający działalność może wybrać zaliczki kwartalne (płatne do 20 kwietnia, 20 lipca, 20 października i 20 stycznia).',
            ],
          },
          {
            heading: 'Zasada zaokrąglania podstawy opodatkowania i kwoty podatku',
            body: 'Zgodnie z art. 63 § 1 Ordynacji podatkowej zarówno podstawy opodatkowania, jak i kwoty podatków zaokrągla się do pełnych złotych w ten sposób, że końcówki kwot wynoszące mniej niż 50 groszy pomija się, a końcówki kwot wynoszące 50 i więcej groszy podwyższa się do pełnych złotych. W trakcie wyliczeń pośrednich (przychody, koszty, składki ZUS) operuje się zawsze dokładnymi kwotami co do grosza — zaokrągleniu podlega dopiero wyliczona podstawa opodatkowania oraz finalna kwota podatku/zaliczki.',
            keyPoints: [
              'Końcówka 49 gr zaokrągla się w dół (np. 1 240,49 PLN -> 1 240,00 PLN).',
              'Końcówka 50 gr zaokrągla się w górę (np. 1 240,50 PLN -> 1 241,00 PLN).',
              'Jeżeli obliczona zaliczka na PIT jest mniejsza niż 1 000 zł, podatnik może nie wpłacać jej dopóki narastająco podatek należny od początku roku (pomniejszony o wpłacone zaliczki) nie przekroczy 1 000 zł (art. 44 ust. 15 PIT).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Obliczenie pierwszych zaliczek PIT na skali podatkowej w 2026 roku (styczeń–luty)',
          scenario:
            'Architekt na skali podatkowej osiągnął dochód (po odliczeniu składek społecznych ZUS) w wysokości 22 000,00 PLN w styczniu 2026 r. oraz 18 000,00 PLN w lutym 2026 r. (łącznie narastająco 40 000,00 PLN za styczeń–luty).',
          steps: [
            {
              stepNumber: 1,
              label: 'Styczeń — podatek narastająco od 22 000,00 PLN',
              calculation:
                '22 000,00 PLN × 12% − 3 600,00 PLN = -960,00 PLN -> zaliczka 0,00 PLN (działa kwota wolna 30 000 PLN)',
              amountPln: '0,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Luty — dochód narastająco od początku roku',
              calculation: '22 000,00 PLN (styczeń) + 18 000,00 PLN (luty)',
              amountPln: '40 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Luty — podatek należny od początku roku',
              calculation: '40 000,00 PLN × 12% − 3 600,00 PLN = 4 800,00 PLN − 3 600,00 PLN',
              amountPln: '1 200,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Zaliczka do wpłaty za luty (do 20 marca 2026 r.)',
              calculation: '1 200,00 PLN (narastająco) − 0,00 PLN (zaliczka ze stycznia)',
              amountPln: '1 200,00 PLN',
            },
          ],
          finalResultPln: '1 200,00 PLN',
          interpretation:
            'W styczniu architekt nie płacił zaliczki dzięki kwocie wolnej 30 000,00 PLN. W lutym narastający dochód przekroczył 30 000,00 PLN o 10 000,00 PLN, więc podatek wyniósł dokładnie 12% z tej nadwyżki (1 200,00 PLN).',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef: 'art. 44 ust. 1 pkt 1, ust. 3, ust. 6 oraz ust. 15',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje narastający sposób wyliczania zaliczek na podatek dochodowy, termin wpłaty do 20. dnia kolejnego miesiąca oraz próg 1 000 zł niewpłacania drobnych zaliczek.',
          },
          {
            actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
            articleRef: 'art. 63 § 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wprowadza ogólną regułę zaokrąglania podstaw opodatkowania oraz kwot podatków do pełnych złotych.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm03-l01-slad-obliczen-zaliczki-pit',
          '/taxes',
          'Szuflada śladu obliczeniowego („Dlaczego?”) prezentująca narastające wyliczenie zaliczki PIT z zaokrągleniem wg art. 63 § 1 Ordynacji podatkowej.',
          '[data-testid="pit-advance-calculation-trace"]',
        ),
        practicalExercise: {
          title: 'Prześledź narastające wyliczenie zaliczki PIT w firmie demo Alfa',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do widoku „Podatki i JPK” dla firmy Pracownia Projektowa Alfa.',
            'Wybierz rozliczenie zaliczki PIT za bieżący miesiąc i kliknij przycisk „Dlaczego?”.',
            'Sprawdź kolejno: przychód narastająco, koszty KUP narastająco, odliczone składki ZUS, zaokrągloną podstawę oraz odjęte zaliczki z poprzednich miesięcy.',
          ],
          expectedOutcome:
            'Użytkownik potrafi samodzielnie odtworzyć każdy krok matematyczny prowadzący do kwoty przelewu na mikrorachunek podatkowy.',
        },
        commonMistakes: [
          {
            mistake:
              'Składanie co miesiąc papierowej lub elektronicznej deklaracji na zaliczkę PIT do urzędu skarbowego.',
            consequence:
              'Niepotrzebna strata czasu — w trakcie roku podatnik nie składa miesięcznych deklaracji PIT-5 (zostały zlikwidowane lata temu), lecz wyłącznie oblicza i wpłaca zaliczkę na mikrorachunek, a rozliczenie wykazuje w rocznym PIT-36 / PIT-36L / PIT-28.',
            howToAvoid:
              'W trakcie roku archiwizuj w aplikacji kartę obliczenia zaliczki i wykonuj przelew na indywidualny mikrorachunek podatkowy (IRP).',
          },
          {
            mistake:
              'Zaokrąglanie każdej pojedynczej faktury do pełnych złotych przed wpisaniem do KPiR.',
            consequence:
              'Błędne podsumowanie księgi — faktury księguje się zawsze z dokładnością do 1 grosza, a zaokrągla dopiero podstawę opodatkowania i podatek.',
            howToAvoid:
              'Wprowadzaj kwoty dokumentów dokładnie co do grosza; zaokrąglenie wg art. 63 § 1 Ordynacji wykonuje kalkulator zaliczki na końcu okresu.',
          },
          {
            mistake:
              'Wpłacanie podatków firmowych na ogólne konto urzędu skarbowego zamiast na indywidualny mikrorachunek podatkowy (IRP).',
            consequence:
              'Brak automatycznego zaksięgowania wpłaty na koncie podatnika i powstanie zaległości podatkowej.',
            howToAvoid:
              'Wygeneruj i zweryfikuj swój indywidualny mikrorachunek podatkowy (zawierający Twój NIP lub PESEL) na podatki.gov.pl.',
          },
        ],
        summary: [
          'Zaliczki na skali, podatku liniowym i w klasycznym CIT liczy się narastająco od 1 stycznia do końca danego okresu.',
          'Termin płatności zaliczki dochodowej oraz ryczałtu mija 20. dnia kolejnego miesiąca (lub miesiąca po kwartale).',
          'Podstawę opodatkowania oraz kwotę podatku zaokrągla się do pełnych złotych (poniżej 50 gr w dół, od 50 gr w górę).',
        ],
        quiz: [
          {
            id: 'q-03-01-01',
            question:
              'Jak zgodnie z art. 63 § 1 Ordynacji podatkowej zaokrągla się wyliczoną podstawę opodatkowania wynoszącą 15 480,50 PLN?',
            options: [
              'Do 15 480,00 PLN (końcówkę 50 groszy zaokrągla się w dół).',
              'Do 15 481,00 PLN (końcówki wynoszące 50 i więcej groszy podwyższa się do pełnych złotych).',
              'Nie zaokrągla się — wpłaca się podatek liczony od groszy.',
              'Do 15 500,00 PLN (do pełnych dziesiątek złotych).',
            ],
            correctOptionIndex: 1,
            explanation:
              'Art. 63 § 1 Ordynacji podatkowej stanowi wprost: końcówki kwot wynoszące mniej niż 50 groszy pomija się, a końcówki wynoszące 50 i więcej groszy podwyższa się do pełnych złotych.',
          },
          {
            id: 'q-03-01-02',
            question:
              'Do którego dnia należy zapłacić miesięczną zaliczkę na podatek dochodowy PIT za październik?',
            options: [
              'Do 10 listopada.',
              'Do 15 listopada.',
              'Do 20 listopada (z przesunięciem na kolejny dzień roboczy, jeśli 20 listopada wypada w sobotę lub niedzielę).',
              'Do 25 listopada razem z JPK_V7M.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Zaliczki na PIT, CIT oraz ryczałt ewidencjonowany opłaca się do 20. dnia następnego miesiąca (natomiast 25. dzień miesiąca to termin dla podatku VAT i pliku JPK_V7).',
          },
        ],
      },
      {
        id: 'lesson-03-02',
        slug: 'podatek-vat-nalezny-naliczony-i-stawki',
        moduleNumber: 3,
        lessonNumber: 2,
        title: 'VAT należny a VAT naliczony oraz stawki VAT (23%, 8%, 5%, 0%, zw.) w praktyce',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: ['vat_czynny'],
          scopeNote:
            'Dotyczy czynnych podatników podatku od towarów i usług (zarówno JDG, spółek cywilnych, jak i spółek kapitałowych zarejestrowanych na formularzu VAT-R).',
        },
        intro:
          'Podatek VAT bywa źródłem największego stresu początkujących właścicieli firm, dopóki nie zrozumieją jednej fundamentalnej prawdy: dla czynnego podatnika VAT te 23% doliczone na fakturze NIGDY nie były jego pieniędzmi! Jesteś jedynie inkasentem, który pobiera VAT od klienta i oddaje urzędowi różnicę po potrąceniu VAT ze swoich zakupów firmowych.',
        sections: [
          {
            heading: 'Mechanizm neutralności: VAT należny minus VAT naliczony',
            body: 'Gdy jako czynny podatnik VAT sprzedajesz usługę lub towar, doliczasz do ceny netto podatek **VAT należny** (należny Skarbowi Państwa). Z kolei gdy kupujesz towary, sprzęt czy usługi służące Twojej sprzedaży opodatkowanej VAT, na fakturach zakupowych znajduje się **VAT naliczony**. Na koniec miesiąca (lub kwartału) porównujesz obie sumy w pliku JPK_V7: jeśli VAT należny jest wyższy od naliczonego, nadwyżkę wpłacasz do urzędu skarbowego do 25. dnia kolejnego miesiąca. Jeśli zaś w danym miesiącu poczyniłeś duże zakupy i VAT naliczony przewyższa należny — powstaje nadwyżka VAT, którą możesz przenieść na następny okres rozliczeniowy lub wystąpić o jej zwrot na rachunek bankowy (standardowo w 60 dni, lub w trybach przyspieszonych 25 / 15 dni przy spełnieniu warunków ustawowych).',
            keyPoints: [
              'Prawo do odliczenia VAT naliczonego powstaje co do zasady w rozliczeniu za okres, w którym u sprzedawcy powstał obowiązek podatkowy, nie wcześniej jednak niż w rozliczeniu za okres, w którym podatnik otrzymał fakturę (np. nadano jej numer w KSeF).',
              'Jeśli nie odliczysz faktury zakupowej w miesiącu otrzymania, możesz to zrobić bez korekty w jednym z trzech kolejnych miesięcy (lub dwóch kolejnych kwartałów).',
            ],
          },
          {
            heading: 'Stawki podatku VAT w Polsce: 23%, 8%, 5%, 0% a zwolnienie („zw.”)',
            body: 'Podstawowa stawka VAT w Polsce wynosi **23%** i stosuje się ją zawsze, gdy przepis szczególny nie przewiduje obniżonej stawki. Stawka **8%** obejmuje m.in. wybrane roboty budowlano-montażowe w budownictwie mieszkaniowym (społecznym programie mieszkaniowym), gastronomię (z wyłączeniem napojów i alkoholu), wyroby medyczne czy bilety wstępu. Stawka **5%** dotyczy podstawowych produktów żywnościowych (pieczywo, nabiał, mięso, owoce) oraz książek i czasopism specjalistycznych. Szczególnie ważne jest odróżnienie stawki **0%** (np. eksport towarów, wewnątrzwspólnotowa dostawa towarów WDT) od sprzedaży zwolnionej (**„zw.”** — np. usługi medyczne, finansowe, edukacyjne z art. 43 ust. 1 VAT): stawka 0% to sprzedaż opodatkowana, która daje pełne prawo do odliczania VAT z zakupów firmowych, podczas gdy sprzedaż wyłącznie zwolniona („zw.”) prawa do odliczenia VAT z zakupów NIE daje!',
            keyPoints: [
              'Stawka 0% ≠ stawka „zw.”: przy 0% (np. WDT / eksport) zachowujesz pełne prawo do zwrotu VAT z polskich zakupów, a przy „zw.” podatek VAT z zakupów staje się Twoim kosztem!',
              'Sprzedaż usług B2B dla zagranicznych firm (art. 28b ustawy o VAT — „NP” / odwrotne obciążenie) również pozwala odliczać polski VAT z zakupów związanych z tą działalnością.',
            ],
          },
        ],
        numericalExample: {
          title: 'Rozliczenie miesiąca czynnego podatnika VAT: sprzedaż vs zakup laptopa',
          scenario:
            'W maju 2026 r. firma projektowa wystawiła dwie faktury sprzedaży po 6 000,00 PLN netto + 23% VAT każda. W tym samym maju kupiła stację roboczą za 8 000,00 PLN netto + 23% VAT oraz usługi księgowe za 500,00 PLN netto + 23% VAT (wszystkie faktury odebrano w KSeF w maju).',
          steps: [
            {
              stepNumber: 1,
              label: 'Suma VAT należnego ze sprzedaży w maju',
              calculation: '2 × (6 000,00 PLN × 23%) = 12 000,00 PLN × 23%',
              amountPln: '2 760,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Suma VAT naliczonego z zakupów w maju',
              calculation: '(8 000,00 PLN + 500,00 PLN) × 23% = 8 500,00 PLN × 23%',
              amountPln: '1 955,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Podatek VAT do wpłaty do urzędu skarbowego (przed zaokrągleniem JPK)',
              calculation: '2 760,00 PLN − 1 955,00 PLN',
              amountPln: '805,00 PLN',
            },
          ],
          finalResultPln: '805,00 PLN',
          interpretation:
            'Przedsiębiorca pobrał od swoich klientów 2 760,00 PLN podatku VAT, ale dzięki odliczeniu 1 955,00 PLN VAT zapłaconego w cenie stacji roboczej i księgowości, do 25 czerwca przelewa do urzędu skarbowego tylko 805,00 PLN.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef:
              'art. 41 ust. 1, art. 86 ust. 1 i ust. 10–11, art. 87 ust. 1–2 oraz art. 146ef',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa stawki VAT (w tym 23% i 8%), prawo do obniżenia podatku należnego o podatek naliczony, terminy odliczenia oraz zasady zwrotu nadwyżki VAT.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm03-l02-rejestry-vat-sprzedazy-i-zakupow',
          '/taxes',
          'Zestawienie Rejestru Sprzedaży VAT i Rejestru Zakupów VAT z wyliczeniem kwoty podatku podlegającej wpłacie w JPK_V7M.',
          '[data-testid="vat-registers-summary"]',
        ),
        practicalExercise: {
          title: 'Porównaj rejestr sprzedaży i zakupów VAT przed wygenerowaniem JPK_V7M',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Otwórz zakładkę „Podatki i JPK” -> „Rejestry VAT” w firmie demo Pracownia Projektowa Alfa.',
            'Sprawdź sumę VAT należnego z faktur sprzedażowych oraz sumę VAT naliczonego z zatwierdzonych faktur zakupowych.',
            'Zweryfikuj datę otrzymania faktury zakupowej w KSeF potwierdzającą prawo do odliczenia w bieżącym miesiącu.',
          ],
          expectedOutcome:
            'Użytkownik rozumie powiązanie każdej pozycji rejestru VAT z podsumowaniem deklaracyjnym pliku JPK_V7M.',
        },
        commonMistakes: [
          {
            mistake: 'Odliczanie podatku VAT od usług noclegowych i gastronomicznych.',
            consequence:
              'Naruszenie bezwzględnego zakazu z art. 88 ust. 1 pkt 4 ustawy o VAT (z wyjątkiem zakupu gotowych posiłków dla pasażerów oraz refakturowanych noclegów z art. 8 ust. 2a). Kwota brutto noclegu/restauracji w podróży służbowej może być KUP, ale VAT z niej nie odliczysz!',
            howToAvoid:
              'Faktury za hotel i posiłki w restauracji oznaczaj w systemie znacznikiem „Brak odliczenia VAT — art. 88 ust. 1 pkt 4 (koszt w kwocie brutto)”.',
          },
          {
            mistake:
              'Odliczenie VAT z faktury zakupowej w styczniu, gdy faktura została wystawiona i otrzymana w KSeF dopiero 2 lutego (mimo styczniowej daty sprzedaży).',
            consequence:
              'Przedwczesne odliczenie podatku naliczonego niezgodnie z art. 86 ust. 10b pkt 1 ustawy o VAT (wymagającym również otrzymania faktury).',
            howToAvoid:
              'Pilnuj warunku podwójnego: powstania obowiązku podatkowego u sprzedawcy ORAZ daty faktycznego otrzymania faktury (nadania numeru KSeF).',
          },
          {
            mistake:
              'Odliczenie VAT z faktury wystawionej ze stawką 23% na transakcję, która z mocy prawa była zwolniona z VAT.',
            consequence:
              'Art. 88 ust. 3a pkt 2 ustawy o VAT wyklucza odliczenie VAT z faktury dokumentującej czynność zwolnioną lub niepodlegającą opodatkowaniu.',
            howToAvoid:
              'Zwracaj uwagę na podejrzaną stawkę 23% na usługach tradycyjnie zwolnionych (np. polisy ubezpieczeniowe, pożyczki).',
          },
        ],
        summary: [
          'VAT do urzędu = VAT należny (ze sprzedaży) − VAT naliczony (z zakupów służących działalności opodatkowanej).',
          'Stawka 0% daje prawo do odliczania VAT naliczonego, natomiast sprzedaż zwolniona („zw.”) co do zasady takiego prawa nie daje.',
          'Usługi noclegowe i gastronomiczne nie dają prawa do odliczenia podatku VAT (art. 88 ust. 1 pkt 4 ustawy o VAT).',
        ],
        quiz: [
          {
            id: 'q-03-02-01',
            question:
              'Czy czynny podatnik VAT może odliczyć podatek VAT z faktury za nocleg w hotelu podczas delegacji biznesowej w Warszawie?',
            options: [
              'Tak, w 100%, ponieważ wyjazd służył działalności opodatkowanej.',
              'Tak, ale tylko w 50% jak przy samochodzie osobowym.',
              'Nie — art. 88 ust. 1 pkt 4 ustawy o VAT wyłącza odliczenie VAT od usług noclegowych i gastronomicznych (cała kwota brutto trafia w KUP, o ile nie jest to refaktura usługi turystycznej/noclegowej).',
              'Tak, jeśli nocleg kosztował poniżej 450,00 PLN brutto.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Art. 88 ust. 1 pkt 4 ustawy o VAT wprost zakazuje obniżenia podatku należnego o VAT z tytułu nabycia usług noclegowych i gastronomicznych. Nieodliczony VAT powiększa natomiast koszt uzyskania przychodów (art. 23 ust. 1 pkt 43 PIT).',
          },
          {
            id: 'q-03-02-02',
            question:
              'Czym skutkuje sytuacja, w której w danym miesiącu podatek VAT naliczony z zakupów jest wyższy od VAT należnego ze sprzedaży?',
            options: [
              'Nadwyżka przepada z końcem miesiąca.',
              'Podatnik ma wybór: może przenieść nadwyżkę do rozliczenia na następny okres albo wykazać ją do zwrotu na rachunek bankowy.',
              'Podatnik musi zapłacić karę za brak zysku.',
              'Urząd skarbowy automatycznie wyrejestrowuje firmę z VAT.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 87 ust. 1 ustawy o VAT w przypadku gdy kwota podatku naliczonego jest w okresie rozliczeniowym wyższa od kwoty podatku należnego, podatnik ma prawo do obniżenia o tę różnicę kwoty podatku należnego za następne okresy lub do zwrotu różnicy na rachunek bankowy.',
          },
        ],
      },
      {
        id: 'lesson-03-03',
        slug: 'zwolnienie-z-vat-limit-240000-metoda-kasowa-i-mpp',
        moduleNumber: 3,
        lessonNumber: 3,
        title: 'Zwolnienie podmiotowe z VAT (limit 240 000 zł od 2026 r.), metoda kasowa i MPP',
        estimatedMinutes: 17,
        audienceScope: {
          type: 'general_education',
          applicableProfiles: [
            'vat_czynny',
            'vat_zwolniony_art113',
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'jdg_ryczalt',
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
          ],
          scopeNote:
            'Obejmuje zasady zwolnienia podmiotowego art. 113 VAT (limit 240 000 zł w 2026 r.) oraz szczególne procedury VAT (metoda kasowa i obowiązkowy Split Payment).',
        },
        intro:
          'Nie każda firma musi od pierwszego dnia doliczać 23% VAT do swoich cen. Jeśli Twoimi klientami są głównie osoby prywatne (konsumenci B2C) lub podmioty zwolnione z VAT, zwolnienie podmiotowe pozwala oferować niższe ceny końcowe lub zachować wyższą marżę. Od 1 stycznia 2026 r. limit tego zwolnienia wzrósł z 200 000 zł do 240 000 zł!',
        sections: [
          {
            heading: 'Zwolnienie podmiotowe z art. 113 ustawy o VAT i nowy limit 240 000 zł',
            body: 'Zgodnie ze znowelizowanym art. 113 ust. 1 ustawy o VAT od 1 stycznia 2026 r. ze zwolnienia podmiotowego korzystają podatnicy posiadający siedzibę w Polsce, u których wartość sprzedaży (netto) nie przekroczyła łącznie w poprzednim ani bieżącym roku podatkowym kwoty **240 000,00 PLN**. Jeżeli rozpoczynasz działalność w trakcie roku, limit obliczasz proporcjonalnie do liczby dni prowadzenia firmy w tym roku kalendarzowym: `(240 000 zł × liczba dni do końca roku) / 365`. Pamiętaj jednak o bezwzględnych wyłączeniach z art. 113 ust. 13: ze zwolnienia podmiotowego NIE mogą korzystać od pierwszej złotówki m.in. firmy świadczące usługi prawnicze, usługi doradztwa (w tym doradztwo biznesowe i zarządcze, z wyjątkiem rolniczego), usługi jubilerskie, ściągania długów czy sprzedające online elektronikę, preparaty kosmetyczne i części samochodowe.',
            keyPoints: [
              'Gdy w trakcie roku przekroczysz limit 240 000 zł, zwolnienie traci moc począwszy od CAŁEJ czynności (faktury), którą przekroczono tę kwotę — przed tą czynnością trzeba złożyć VAT-R!',
              'U podatnika zwolnionego z VAT zakupy firmowe ujmuje się w kosztach KPiR w kwotach BRUTTO (ponieważ nie przysługuje mu odliczenie VAT).',
            ],
          },
          {
            heading: 'Metoda kasowa VAT oraz Mechanizm Podzielonej Płatności (MPP / Split Payment)',
            body: 'Mały podatnik VAT może wybrać **metodę kasową** (oznaczenie „metoda kasowa” na fakturze): w relacji z innym czynnym podatnikiem VAT obowiązek zapłaty VAT ze sprzedaży powstaje dopiero po otrzymaniu zapłaty od kontrahenta (a wobec konsumentów lub nie-vatowców — po zapłacie, nie później niż 180. dnia od wydania towaru/wykonania usługi). Ceną za ten przywilej jest fakt, że VAT z własnych faktur zakupowych również odliczysz dopiero po ich opłaceniu! Niezależnie od metody rozliczeń każdy przedsiębiorca musi znać **obowiązkowy Mechanizm Podzielonej Płatności (MPP)**: jeśli faktura opiewa na kwotę brutto powyżej **15 000,00 PLN** i zawiera choćby jedną pozycję z **Załącznika nr 15** do ustawy o VAT (np. komputery, telefony, stal, paliwa, usługi budowlane, części samochodowe), sprzedawca zamieszcza adnotację „mechanizm podzielonej płatności”, a nabywca MUSI opłacić ją specjalnym komunikatem przelewu Split Payment rozdzielającym netto i VAT.',
            keyPoints: [
              'Próg 15 000,00 PLN brutto dla obowiązkowego MPP dotyczy kwoty OGÓŁEM na fakturze — nawet gdy pozycja z Załącznika nr 15 kosztuje na niej tylko 200 zł!',
              'Dobrowolne użycie MPP jest dozwolone przy każdej fakturze B2B z wykazaną kwotą VAT i chroni m.in. przed sankcją Białej Listy.',
            ],
          },
        ],
        numericalExample: {
          title: 'Proporcjonalny limit zwolnienia z VAT przy starcie firmy 1 lipca 2026 roku',
          scenario:
            'Projektantka wnętrz (nieświadcząca usług doradztwa wyłączonych z art. 113 ust. 13) zakłada JDG w dniu 1 lipca 2026 r. (rok nieprzestępny — 365 dni). Od 1 lipca do 31 grudnia włącznie pozostają 184 dni prowadzenia działalności.',
          steps: [
            {
              stepNumber: 1,
              label: 'Pełny roczny limit zwolnienia podmiotowego VAT w 2026 r.',
              calculation: 'Kwota ustawowa z art. 113 ust. 1 ustawy o VAT',
              amountPln: '240 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Wyliczenie limitu proporcjonalnego na 184 dni (art. 113 ust. 9)',
              calculation: '(240 000,00 PLN × 184 dni) / 365 dni = 120 986,301... PLN',
              amountPln: '120 986,30 PLN',
            },
            {
              stepNumber: 3,
              label: 'Sprzedaż zrealizowana do listopada 2026 r.',
              calculation: 'Suma wystawionych rachunków/faktur bez VAT',
              amountPln: '115 000,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Pozostały bezpieczny bufor limitu zwolnienia do 31 grudnia 2026 r.',
              calculation: '120 986,30 PLN − 115 000,00 PLN',
              amountPln: '5 986,30 PLN',
            },
          ],
          finalResultPln: '120 986,30 PLN',
          interpretation:
            'W pierwszym niepełnym roku działalności projektantka nie ma do dyspozycji pełnych 240 000,00 PLN, lecz tylko 120 986,30 PLN. Wystawienie w grudniu kolejnej faktury na 8 000,00 PLN spowoduje przekroczenie limitu i konieczność opodatkowania VAT całej tej grudniowej faktury!',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef:
              'art. 21 ust. 1, art. 108a ust. 1a oraz art. 113 ust. 1, ust. 5, ust. 9 i ust. 13',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje limit zwolnienia podmiotowego 240 000 zł (od 2026 r.), liczenie proporcjonalne, wyłączenia branżowe, metodę kasową oraz obowiązkowy Mechanizm Podzielonej Płatności powyżej 15 000 zł brutto.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm03-l03-pasek-limitu-vat-240k-i-mpp',
          '/taxes',
          'Pasek monitorowania limitu zwolnienia podmiotowego 240 000 PLN oraz oznaczenie obowiązkowego MPP na fakturze powyżej 15 000 PLN brutto.',
          '[data-testid="vat-exemption-limit-tracker"]',
        ),
        practicalExercise: {
          title:
            'Zweryfikuj obowiązek MPP na fakturze zakupu sprzętu komputerowego powyżej 15 000 PLN',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W sekcji „Sprzedaż i zakupy” otwórz fakturę zakupu dwóch laptopów i monitora na łączną kwotę 18 450,00 PLN brutto.',
            'Sprawdź ostrzeżenie systemu o obecności towaru z Załącznika nr 15 (komputery) i przekroczeniu progu 15 000,00 PLN brutto.',
            'Potwierdź oznaczenie wymogu płatności w Mechanizmie Podzielonej Płatności (Split Payment).',
          ],
          expectedOutcome:
            'System blokuje oznaczenie zwykłego przelewu jako poprawnego bez MPP i chroni podatnika przed utratą KUP oraz 30% sankcją VAT.',
        },
        commonMistakes: [
          {
            mistake:
              'Przyjęcie pełnego limitu 240 000,00 PLN przy założeniu firmy np. w październiku.',
            consequence:
              'Nieświadome przekroczenie proporcjonalnego limitu (w październiku to ok. 60 tys. zł!) i powstanie zaległości w podatku VAT należnym od sprzedaży.',
            howToAvoid:
              'Zawsze wyliczaj limit co do dnia wg wzoru z art. 113 ust. 9 ustawy o VAT — aplikacja robi to automatycznie na podstawie daty rozpoczęcia działalności.',
          },
          {
            mistake:
              'Rozbicie zakupu laptopów na dwie częściowe płatności po 9 225,00 PLN zwykłym przelewem przy jednej fakturze na 18 450,00 PLN brutto.',
            consequence:
              'Naruszenie obowiązku MPP — liczy się kwota ogółem na fakturze (> 15 000 zł brutto), niezależnie od liczby rat przelewów!',
            howToAvoid:
              'Każdą ratę do faktury objętej obowiązkowym MPP opłacaj komunikatem przelewu podzielonej płatności.',
          },
          {
            mistake:
              'Skorzystanie ze zwolnienia z art. 113 przy wpisanym i faktycznie wykonywanym doradztwie (np. konsulting biznesowy / podatkowy / strategiczny).',
            consequence:
              'Brak prawa do zwolnienia od pierwszej sprzedaży na mocy art. 113 ust. 13 pkt 2 lit. b ustawy o VAT.',
            howToAvoid:
              'Przed wyborem zwolnienia podmiotowego sprawdź pełną listę wyłączeń przedmiotowych i podmiotowych w art. 113 ust. 13.',
          },
        ],
        summary: [
          'Od 1 stycznia 2026 r. roczny limit zwolnienia podmiotowego z VAT (art. 113) wynosi 240 000,00 PLN sprzedaży netto (w pierwszym roku liczony proporcjonalnie do dni).',
          'Doradztwo, usługi prawnicze, jubilerskie i wybrane towary wrażliwe w e-commerce są wyłączone ze zwolnienia od pierwszej złotówki.',
          'Faktura powyżej 15 000,00 PLN brutto zawierająca towar lub usługę z Załącznika nr 15 wymaga bezwzględnie zapłaty w Mechanizmie Podzielonej Płatności (MPP).',
        ],
        quiz: [
          {
            id: 'q-03-03-01',
            question:
              'Ile wynosi roczny limit wartości sprzedaży uprawniający do zwolnienia podmiotowego z VAT (art. 113 ust. 1) od 1 stycznia 2026 r. dla firmy działającej pełny rok?',
            options: ['150 000,00 PLN', '200 000,00 PLN', '240 000,00 PLN', '500 000,00 PLN'],
            correctOptionIndex: 2,
            explanation:
              'Od 1 stycznia 2026 r. ustawowy limit zwolnienia podmiotowego z podatku VAT określony w art. 113 ust. 1 ustawy o VAT wynosi 240 000,00 PLN (podwyższony z wcześniejszych 200 000,00 PLN).',
          },
          {
            id: 'q-03-03-02',
            question:
              'Kiedy nabywca ma bezwzględny ustawowy obowiązek zapłaty za fakturę przy użyciu Mechanizmu Podzielonej Płatności (MPP)?',
            options: [
              'Przy każdej fakturze kosztowej powyżej 1 000,00 PLN netto.',
              'Gdy kwota należności ogółem na fakturze przekracza 15 000,00 PLN brutto i faktura dokumentuje nabycie towarów lub usług wymienionych w Załączniku nr 15 do ustawy o VAT.',
              'Wyłącznie przy zakupach zagranicznych w walucie EUR.',
              'Tylko wtedy, gdy sprzedawca o to ustnie poprosi.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 108a ust. 1a ustawy o VAT obowiązkowy MPP zachodzi przy łącznym spełnieniu dwóch przesłanek: kwota należności ogółem na fakturze przekracza 15 000,00 PLN (lub równowartość) oraz faktura obejmuje towary/usługi z Załącznika nr 15.',
          },
        ],
      },
    ],
  },
];
