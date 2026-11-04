import { createScreenshotSlot, type AcademyModule } from './quiz.js';

export const MODULES_07_TO_09: readonly AcademyModule[] = [
  {
    moduleNumber: 7,
    slug: 'pelna-ksiegowosc-ksiegi-rachunkowe-wg-uor',
    title: 'Moduł 7: Pełna księgowość (Księgi rachunkowe wg UoR)',
    subtitle:
      'Zrozum logikę podwójnego zapisu Wn = Ma, poznaj Zespoły kont 0–8, samodzielnie prześledź dekretację faktur i wyciągu bankowego oraz naucz się czytać Bilans i RZiS.',
    learningObjectives: [
      'Rozumieć budowę Zakładowego Planu Kont (Zespoły 0–8) oraz niezmienną zasadę podwójnego zapisu (Winien = Ma).',
      'Odczytywać i weryfikować dekrety księgowe faktury sprzedażowej, kosztowej oraz wyciągu bankowego.',
      'Czytać ze zrozumieniem Bilans (Aktywa = Pasywa) oraz Rachunek Zysków i Strat (RZiS) spółki.',
    ],
    lessons: [
      {
        id: 'lesson-07-01',
        slug: 'plan-kont-zespoly-0-8-i-zasada-podwojnego-zapisu',
        moduleNumber: 7,
        lessonNumber: 1,
        title: 'Plan kont (Zespoły 0–8), zasada podwójnego zapisu Wn = Ma oraz rodzaje kont',
        estimatedMinutes: 18,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
            'sp_zoo_pelne_ksiegi_cit_estonski',
          ],
          scopeNote:
            'Dotyczy spółek kapitałowych (np. sp. z o.o.) oraz innych podmiotów prowadzących pełne księgi rachunkowe na podstawie Ustawy o rachunkowości.',
        },
        intro:
          'Dla osób przyzwyczajonych do prostej tabeli KPiR pełna księgowość wygląda na początku jak tajny szyfr: numery kont 130, 201, 402 oraz dwie strony „Winien (Wn)” i „Ma”. Gdy jednak uchwycisz jedną genialną ideę sprzed pięciuset lat — że każda złotówka ma zawsze swoje źródło pochodzenia i miejsce przeznaczenia — pełne księgi stają się najbardziej logicznym systemem finansowym świata.',
        sections: [
          {
            heading: 'Zespoły kont 0–8 w polskim Zakładowym Planie Kont',
            body: 'Każda spółka przyjmuje w swojej polityce rachunkowości **Zakładowy Plan Kont (ZPK)**. Pierwsza cyfra numeru konta oznacza zawsze tzw. Zespół: **Zespół 0** — Aktywa trwałe (środki trwałe, wartości niematerialne i prawne, umorzenie); **Zespół 1** — Środki pieniężne i rachunki bankowe (np. konto `100` Kasa, `130` Rachunek bieżący, kredyty bankowe); **Zespół 2** — Rozrachunki i roszczenia (np. `201` Rozrachunki z odbiorcami, `202` Rozrachunki z dostawcami, `221` Rozrachunki z US z tytułu VAT, `229` ZUS, `231` Wynagrodzenia); **Zespół 3** — Materiały i towary (magazyn); **Zespół 4** — Koszty według rodzajów (amortyzacja, zużycie materiałów, usługi obce, podatki i opłaty, wynagrodzenia, ubezpieczenia społeczne, pozostałe koszty); **Zespół 5** — Koszty według typów działalności (opcjonalny układ kalkulacyjny); **Zespół 6** — Produkty i rozliczenia międzyokresowe; **Zespół 7** — Przychody i koszty ich osiągnięcia (np. `700` Sprzedaż usług, `730` Sprzedaż towarów, `750/751` Przychody i koszty finansowe); **Zespół 8** — Kapitały własne, fundusze i wynik finansowy (`800` Kapitał zakładowy, `860` Wynik finansowy).',
            keyPoints: [
              'W pełnej księgowości śledzisz nie tylko przychody i koszty, ale KAŻDĄ złotówkę majątku, należności, długów, gotówki i kapitału spółki!',
              'Konta syntetyczne (np. `201` Rozrachunki z odbiorcami) dzielą się na konta analityczne dla każdego kontrahenta z osobna (np. `201-00042` Klient Alfa).',
            ],
          },
          {
            heading:
              'Zasada podwójnego zapisu (Wn = Ma) i zachowanie kont aktywnych, pasywnych oraz wynikowych',
            body: 'Każde konto księgowe przypomina literę **T**: lewa strona nazywa się **Winien (Wn / Debet)**, a prawa strona **Ma (Kredyt)**. Zasada podwójnego zapisu stanowi, że każdą operację gospodarczą księguje się na co najmniej dwóch kontach, po przeciwnych stronach i w identycznej łącznej kwocie (**Suma Wn = Suma Ma**, co do jednego grosza!). Dlaczego początkującym mylą się strony? Bo próbują tłumaczyć słowo „Winien” potocznie! Zapamiętaj zamiast tego żelazny układ: **Konta aktywne** (majątek spółki: rachunek bankowy `130`, kasa `100`, należności od klientów `201`, towary `330`) rosną po lewej stronie **Wn (+)**, a maleją po prawej stronie **Ma (−)** — dlatego wpływ przelewu na konto bankowe spółki to zapis po stronie **Wn** konta `130`! Z kolei **Konta pasywne** (źródła finansowania i długi: kapitał zakładowy `800`, zobowiązania wobec dostawców `202`, kredyty, VAT należny) rosną po prawej stronie **Ma (+)**, a maleją przy spłacie po lewej stronie **Wn (−)**. Natomiast na **kontach wynikowych**: koszty (Zespół 4/7) zbieramy po stronie **Wn**, a przychody ze sprzedaży (Zespół 7) po stronie **Ma**!',
            keyPoints: [
              'Aktywa i Koszty rosną po lewej stronie **Wn**; Pasywa (zobowiązania/kapitał) i Przychody rosną po prawej stronie **Ma**!',
              'Żaden dekret, w którym suma kwot po stronie Wn różni się od sumy kwot po stronie Ma choćby o 1 grosz, nie może zostać zaksięgowany w Księdze Głównej.',
            ],
          },
        ],
        numericalExample: {
          title: 'Wpłata kapitału zakładowego 5 000,00 PLN na rachunek bankowy nowej spółki z o.o.',
          scenario:
            'Wspólnicy założyli spółkę z o.o. z kapitałem zakładowym 5 000,00 PLN i wpłacili całą kwotę na firmowy rachunek bankowy spółki. Sprawdźmy równowagę podwójnego zapisu Wn = Ma.',
          steps: [
            {
              stepNumber: 1,
              label: 'Strona Wn (lewa) — Konto 130 „Rachunek bieżący” (wzrost aktywów)',
              calculation: 'Wpływ środków pieniężnych na rachunek bankowy spółki (+Aktywa = Wn)',
              amountPln: '5 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Strona Ma (prawa) — Konto 800 „Kapitał zakładowy” (wzrost pasywów)',
              calculation: 'Źródło pochodzenia majątku od wspólników (+Pasywa = Ma)',
              amountPln: '5 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Kontrola bilansowania dekretu (Wn minus Ma)',
              calculation: '5 000,00 PLN (Wn) − 5 000,00 PLN (Ma) = 0,00 PLN różnicy',
              amountPln: '0,00 PLN',
            },
          ],
          finalResultPln: '5 000,00 PLN',
          interpretation:
            'Jedna operacja odpowiedziała na dwa pytania naraz: GDZIE są pieniądze spółki (Wn 130 Rachunek bankowy: 5 000,00 PLN) oraz SKĄD się wzięły (Ma 800 Kapitał zakładowy: 5 000,00 PLN). Bilans od pierwszej sekundy jest w idealnej równowadze.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 września 1994 r. o rachunkowości',
            articleRef:
              'art. 10 ust. 1 pkt 3 (zakładowy plan kont) oraz art. 15 ust. 1 (zasada podwójnego zapisu)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Nakazuje posiadanie dokumentacji opisującej Zakładowy Plan Kont oraz prowadzenie kont księgi głównej zgodnie z zasadą podwójnego zapisu.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm07-l01-zakladowy-plan-kont-zespoly-0-8',
          '/accounting/ledger',
          'Widok Zakładowego Planu Kont podzielonego na Zespoły 0–8 wraz z oznaczeniem typu konta (aktywne, pasywne, aktywno-pasywne, wynikowe).',
          '[data-testid="chart-of-accounts-tree"]',
        ),
        practicalExercise: {
          title: 'Przejrzyj Zakładowy Plan Kont i zestawienie obrotów i sald w spółce demo Gamma',
          demoCompanyId: 'demo_spzoo_gamma',
          demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
          steps: [
            'Przełącz aktywny podmiot na „Manufaktura Technologiczna Gamma sp. z o.o.”.',
            'Otwórz widok „Księgowość” -> „Plan kont i Księga Główna”.',
            'Sprawdź Zestawienie Obrotów i Sald (ZOiS) i zweryfikuj, że łączna suma obrotów Wn jest co do grosza równa łącznej sumie obrotów Ma.',
          ],
          expectedOutcome:
            'Użytkownik rozumie architekturę Zespołów 0–8 oraz niezmiennik matematyczny Wn = Ma egzekwowany przez silnik księgowy.',
        },
        commonMistakes: [
          {
            mistake:
              'Intuicyjne zakładanie, że wpływ gotówki na rachunek bankowy księguje się po stronie „Ma” („bo mam pieniądze”).',
            consequence:
              'Odwrócenie stron na koncie aktywnym `130` — na wyciągu wysyłanym PRZEZ BANK Twoje konto jest dla banku zobowiązaniem (dlatego bank pisze „Ma / Uznanie”), ale w TWOICH księgach rachunek bankowy jest składnikiem Aktywów i rośnie po stronie **Wn**!',
            howToAvoid:
              'Pamiętaj o lustrzanym odbiciu: „Uznanie (Ma)” na wyciągu z banku = zapis po stronie **Wn** konta `130` w księgach Twojej spółki!',
          },
          {
            mistake:
              'Księgowanie faktur różnych kontrahentów na jednym ogólnym koncie rozrachunkowym bez analityki per kontrahent.',
            consequence:
              'Utrata kontroli nad tym, który konkretnie klient zalega z płatnością, a któremu dostawcy spółka musi zapłacić.',
            howToAvoid:
              'Zawsze używaj automatycznych kont analitycznych odbiorców (`201-xxx`) i dostawców (`202-xxx`).',
          },
          {
            mistake:
              'Traktowanie każdego kosztu bilansowego na Zespole 4 jako kosztu podatkowego KUP w CIT.',
            consequence:
              'Zaniżenie podatku CIT — w pełnych księgach księguje się wszystkie rzeczywiste koszty spółki (także NKUP, np. reprezentację czy rezerwę), wydzielając je na osobną analitykę NKUP (np. `409-NKUP`)!',
            howToAvoid:
              'Prowadź osobne konta analityczne dla kosztów podatkowych (KUP) oraz kosztów wyłącznie bilansowych (NKUP).',
          },
        ],
        summary: [
          'Zakładowy Plan Kont porządkuje rachunkowość spółki w Zespołach 0–8 (majątek, bank, rozrachunki, magazyn, koszty, przychody, kapitały).',
          'Zasada podwójnego zapisu wymaga, aby każdy dowód księgowy miał identyczną sumę zapisów po stronie Wn i po stronie Ma.',
          'Aktywa (np. rachunek bankowy 130, należności 201) oraz Koszty (Zespół 4) rosną po stronie Wn; Pasywa (kapitał 800, zobowiązania 202) oraz Przychody (Zespół 7) rosną po stronie Ma.',
        ],
        quiz: [
          {
            id: 'q-07-01-01',
            question:
              'Po której stronie konta księgowego „130 — Rachunek bieżący” w księgach spółki z o.o. ujmuje się wpływ przelewu od klienta?',
            options: [
              'Po stronie Ma (prawej), bo spółka „ma” więcej środków.',
              'Po stronie Wn (lewej), ponieważ rachunek bankowy jest kontem aktywnym, a wszystkie aktywa zwiększają swoją wartość po stronie Wn.',
              'Jednocześnie po stronie Wn i Ma tego samego konta 130.',
              'Wpływów bankowych w ogóle nie księguje się na kontach.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Konto 130 (Rachunek bieżący) jest kontem aktywnym bilansowym — jego zwiększenia (wpływy) księguje się po stronie Wn, a zmniejszenia (wypływy/przelewy wychodzące) po stronie Ma.',
          },
          {
            id: 'q-07-01-02',
            question:
              'Który zespół w typowym polskim Zakładowym Planie Kont grupuje koszty w układzie rodzajowym (np. zużycie materiałów, usługi obce, wynagrodzenia)?',
            options: ['Zespół 0', 'Zespół 2', 'Zespół 4', 'Zespół 8'],
            correctOptionIndex: 2,
            explanation:
              'Zespół 4 służy do ewidencji kosztów prostych według rodzajów (amortyzacja, zużycie materiałów i energii, usługi obce, podatki i opłaty, wynagrodzenia, ubezpieczenia społeczne i inne świadczenia, pozostałe koszty rodzajowe).',
          },
        ],
      },
      {
        id: 'lesson-07-02',
        slug: 'dekretacja-faktur-i-wyciagu-bankowego-w-ksiegach',
        moduleNumber: 7,
        lessonNumber: 2,
        title: 'Praktyczna dekretacja faktury sprzedażowej, kosztowej i wyciągu bankowego',
        estimatedMinutes: 17,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
            'sp_zoo_pelne_ksiegi_cit_estonski',
          ],
          scopeNote:
            'Warsztat dekretacji księgowej dla podmiotów prowadzących księgi rachunkowe wg Ustawy o rachunkowości.',
        },
        intro:
          'Najlepszy sposób na zrozumienie pełnej księgowości to prześledzenie życia dwóch zwykłych faktur oraz wyciągu bankowego na prawdziwych kontach. Zobaczysz za chwilę, jak faktura tworzy rozrachunek na Zespole 2, a przelew bankowy elegancko go zamyka do zera!',
        sections: [
          {
            heading: 'Dekretacja faktury sprzedaży i faktury kosztowej (rozbicie na 3 konta)',
            body: 'Gdy spółka (czynny podatnik VAT) wystawia **fakturę sprzedaży usług** na kwotę brutto (netto + VAT), w dekrecie biorą udział trzy konta: klient staje się nam winien całą kwotę **brutto** -> strona **Wn** konta `201` (Rozrachunki z odbiorcami); równocześnie wypracowaliśmy **przychód netto** -> strona **Ma** konta `700` (Przychody ze sprzedaży usług) oraz powstało zobowiązanie wobec urzędu skarbowego z tytułu **VAT należnego** -> strona **Ma** konta `221-1` (VAT należny). Zauważ: `Brutto (Wn) = Netto (Ma) + VAT (Ma)`! Odwrotnie działa **faktura kosztowa za usługę obcą** (np. hosting): powstaje **koszt netto** -> strona **Wn** konta `402` (Usługi obce) oraz należność od US z tytułu **VAT naliczonego** do odliczenia -> strona **Wn** konta `221-2` (VAT naliczony), a cała kwota **brutto** stanowi nasz dług wobec dostawcy -> strona **Ma** konta `202` (Rozrachunki z dostawcami)!',
            keyPoints: [
              'Na konta wynikowe (przychody `700` i koszty `402`) u czynnego podatnika VAT trafiają zawsze kwoty NETTO (chyba że VAT jest nieodliczalny, np. hotel lub 50% przy aucie).',
              'Na konta rozrachunków z kontrahentami (`201` i `202`) trafiają zawsze kwoty BRUTTO do zapłaty!',
            ],
          },
          {
            heading: 'Dekretacja wyciągu bankowego oraz korekty zapisów (storno)',
            body: 'Kiedy tydzień później klient opłaca naszą fakturę przelewem na konto spółki, księgujemy **wyciąg bankowy (WB)**: rośnie stan konta bankowego -> **Wn `130`** (Rachunek bieżący) w kwocie brutto, i jednocześnie spada należność od klienta -> **Ma `201`** (Rozrachunki z odbiorcami) w tej samej kwocie brutto! Konto `201` danego klienta ma teraz po lewej (Wn) i prawej (Ma) identyczną kwotę — jego saldo wynosi **0,00 PLN** (rozrachunek rozliczony!). Analogicznie, gdy my płacimy dostawcy z konta bankowego: maleje nasz dług wobec dostawcy -> **Wn `202`**, i maleją środki na rachunku bankowym -> **Ma `130`**. A co jeśli w zatwierdzonym już dekrecie księgowym wykryto błąd? Zgodnie z art. 25 ust. 1 pkt 2 Ustawy o rachunkowości zatwierdzonych zapisów w księgach NIGDY się nie kasuje ani nie nadpisuje — wprowadza się dowód korygujący (**storno czerwone** zapisem ujemnym po tych samych stronach kont, zachowujące czystość obrotów, lub **storno czarne** zapisem dodatnim po stronach przeciwnych)!',
            keyPoints: [
              'Zapłata faktury w pełnej księgowości NIE dotyka już kont przychodów (`700`) ani kosztów (`402`) — operuje wyłącznie między bankiem (`130`) a rozrachunkami (`201`/`202`)!',
              'Storno czerwone (zapis ze znakiem minus) jest preferowane w polskich systemach FK, ponieważ nie zawyża sztucznie obrotów na kontach przychodów i kosztów.',
            ],
          },
        ],
        numericalExample: {
          title:
            'Kompletny cykl księgowy: sprzedaż 12 300,00 PLN brutto, zakup 2 460,00 PLN brutto i opłacenie obu na WB',
          scenario:
            'Spółka Gamma sp. z o.o. wystawiła fakturę sprzedaży usług IT na 10 000,00 PLN netto + 2 300,00 PLN VAT (12 300,00 PLN brutto) oraz otrzymała fakturę za biuro na 2 000,00 PLN netto + 460,00 PLN VAT (2 460,00 PLN brutto). Obie faktury rozliczono na wyciągu bankowym (stan początkowy konta 130 wynosił 5 000,00 PLN).',
          steps: [
            {
              stepNumber: 1,
              label: 'Dekret 1 — Faktura sprzedaży (Wn = Ma = 12 300,00 PLN)',
              calculation:
                'Wn 201 Odbiorcy: 12 300,00 PLN | Ma 700 Przychody: 10 000,00 PLN + Ma 221-1 VAT należny: 2 300,00 PLN',
              amountPln: '12 300,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Dekret 2 — Faktura zakupu biura (Wn = Ma = 2 460,00 PLN)',
              calculation:
                'Wn 402 Usługi obce: 2 000,00 PLN + Wn 221-2 VAT naliczony: 460,00 PLN | Ma 202 Dostawcy: 2 460,00 PLN',
              amountPln: '2 460,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Dekret 3 — Wyciąg bankowy: wpływ od klienta i przelew dla wynajmującego',
              calculation:
                'Wpływ: Wn 130 Bank / Ma 201 Odbiorcy (12 300,00 PLN); Wypływ: Wn 202 Dostawcy / Ma 130 Bank (2 460,00 PLN)',
              amountPln: '9 840,00 PLN',
            },
            {
              stepNumber: 4,
              label: 'Saldo końcowe konta 130 Rachunek bieżący (Wn)',
              calculation: '5 000,00 PLN (BO) + 12 300,00 PLN (wpływ) − 2 460,00 PLN (wypływ)',
              amountPln: '14 840,00 PLN',
            },
          ],
          finalResultPln: '14 840,00 PLN',
          interpretation:
            'Konta rozrachunków 201 i 202 wyzerowały się (salda 0,00 PLN), wynik operacyjny netto wynosi 8 000,00 PLN (10 000 − 2 000), nadwyżka VAT należnego nad naliczonym na koncie 221 wynosi 1 840,00 PLN (2 300 − 460), a na koncie bankowym 130 znajduje się dokładnie 14 840,00 PLN.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 września 1994 r. o rachunkowości',
            articleRef:
              'art. 20 ust. 1, art. 21 ust. 1 pkt 6 (dekretacja) oraz art. 25 ust. 1 pkt 2 (korekta zapisów / storno)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wymaga wskazania sposobu ujęcia dowodu w księgach rachunkowych (dekretacji) oraz zakazuje wymazywania zatwierdzonych zapisów, nakazując stosowanie zapisów korygujących (storna).',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm07-l02-edytor-dekretu-wn-ma-i-storno',
          '/accounting/ledger',
          'Widok dekretu księgowego w Dzienniku i Księdze Głównej z kontrolą równowagi Wn = Ma oraz historią storna czerwonego.',
          '[data-testid="journal-entry-voucher-editor"]',
        ),
        practicalExercise: {
          title:
            'Sprawdź dekretację faktury kosztowej i rozliczającego ją wyciągu bankowego w spółce Gamma',
          demoCompanyId: 'demo_spzoo_gamma',
          demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
          steps: [
            'W kontekście spółki „Manufaktura Technologiczna Gamma sp. z o.o.” przejdź do „Księgowość” -> „Dziennik księgowań”.',
            'Otwórz dekret faktury za wynajem hali i zweryfikuj trójstronny zapis: Wn 402, Wn 221-2 oraz Ma 202.',
            'Kliknij powiązany zapis wyciągu bankowego i potwierdź zamknięcie salda na koncie analitycznym dostawcy `202-xxx`.',
          ],
          expectedOutcome:
            'Użytkownik potrafi przeczytać pełny dekret FK oraz rozumie, dlaczego zamkniętego zapisu nie edytuje się w miejscu, lecz koryguje dokumentem storna.',
        },
        commonMistakes: [
          {
            mistake:
              'Ponowne księgowanie przychodu na koncie `700` w momencie wpływu przelewu od klienta za wcześniej zaksięgowaną fakturę.',
            consequence:
              'Podwójne wykazanie tego samego przychodu i pozostawienie wiecznie wiszącej należności na koncie `201`!',
            howToAvoid:
              'Wpływ zapłaty za fakturę księguj zawsze korespondencyjnie z kontem rozrachunkowym odbiorcy (`Wn 130 / Ma 201`), a nigdy ponownie z kontem `700`!',
          },
          {
            mistake:
              'Próba ręcznego edytowania lub usuwania zaksięgowanego dekretu z zamkniętego miesiąca.',
            consequence:
              'Naruszenie niezmienności Dziennika i Księgi Głównej wymaganej przez art. 23 i art. 25 Ustawy o rachunkowości.',
            howToAvoid:
              'Używaj wyłącznie autoryzowanej operacji „Utwórz zapis korygujący (storno czerwone)”, która zostawia pełny ślad rewizyjny.',
          },
          {
            mistake:
              'Stosowanie storna czarnego na kontach przychodów lub kosztów bez tzw. zapisu technicznego czystości obrotów.',
            consequence:
              'Sztuczne zawyżenie sumy obrotów na koncie przychodów lub kosztów w zestawieniu obrotów i sald.',
            howToAvoid:
              'Stosuj storno czerwone (zapis ujemny), które jednocześnie koryguje saldo i przywraca prawidłową wysokość obrotów konta.',
          },
        ],
        summary: [
          'Faktura sprzedaży u vatowca to dekret: Wn 201 Odbiorcy (brutto) | Ma 700 Przychody (netto) + Ma 221-1 VAT należny.',
          'Faktura kosztowa u vatowca to dekret: Wn 402 Koszty (netto) + Wn 221-2 VAT naliczony | Ma 202 Dostawcy (brutto).',
          'Zatwierdzonych zapisów w pełnych księgach nigdy się nie nadpisuje — błędy koryguje się wyłącznie dowodem storna (najczęściej czerwonego).',
        ],
        quiz: [
          {
            id: 'q-07-02-01',
            question:
              'Jak wygląda prawidłowa dekretacja wyciągu bankowego dokumentującego zapłatę przelewem 2 460,00 PLN brutto naszemu dostawcy za wcześniej zaksięgowaną fakturę kosztową?',
            options: [
              'Wn 402 Usługi obce 2 460,00 PLN / Ma 130 Rachunek bieżący 2 460,00 PLN',
              'Wn 202 Rozrachunki z dostawcami 2 460,00 PLN / Ma 130 Rachunek bieżący 2 460,00 PLN',
              'Wn 130 Rachunek bieżący 2 460,00 PLN / Ma 202 Rozrachunki z dostawcami 2 460,00 PLN',
              'Wn 700 Przychody 2 460,00 PLN / Ma 201 Odbiorcy 2 460,00 PLN',
            ],
            correctOptionIndex: 1,
            explanation:
              'Spłata zobowiązania zmniejsza pasywne konto długu wobec dostawcy (zapis po stronie Wn konta 202) oraz zmniejsza aktywne konto środków na rachunku bankowym (zapis po stronie Ma konta 130).',
          },
          {
            id: 'q-07-02-02',
            question:
              'W jaki sposób zgodnie z Ustawą o rachunkowości poprawia się błąd w trwale zatwierdzonym zapisie księgowym?',
            options: [
              'Usuwa się wiersz bezpośrednio w bazie danych SQL i przenumerowuje dziennik.',
              'Wprowadza się dowód korygujący zapisem dodatnim lub ujemnym (storno czarne lub storno czerwone) z zachowaniem pełnego śladu audytowego.',
              'Nadpisuje się kwotę bez śladu w historii.',
              'Błędów w księgach rachunkowych nie wolno poprawiać.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Art. 25 ust. 1 pkt 2 Ustawy o rachunkowości zabrania modyfikacji zatwierdzonych zapisów i nakazuje poprawianie błędów wyłącznie przez wprowadzenie do ksiąg dowodu zawierającego korekty błędnych zapisów (storno).',
          },
        ],
      },
      {
        id: 'lesson-07-03',
        slug: 'bilans-oraz-rachunek-zyskow-i-strat-jak-czytac',
        moduleNumber: 7,
        lessonNumber: 3,
        title: 'Bilans oraz Rachunek Zysków i Strat (RZiS) — jak czytać sprawozdanie finansowe',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
            'sp_zoo_pelne_ksiegi_cit_estonski',
          ],
          scopeNote:
            'Dotyczy członków zarządu, wspólników i księgowych jednostek sporządzających roczne e-Sprawozdanie Finansowe wg Ustawy o rachunkowości.',
        },
        intro:
          'Raz w roku każda spółka z o.o. robi dokładne „zdjęcie rentgenowskie” swojego majątku (Bilans) oraz „film z całego roku działania” (Rachunek Zysków i Strat). Umiejętność przeczytania tych dwóch tabel w pięć minut pozwala ocenić kondycję własnej spółki, ale też prześwietlić wypłacalność dużego kontrahenta przed podpisaniem kontraktu!',
        sections: [
          {
            heading: 'Bilans: zdjęcie majątku i źródeł jego finansowania na konkretny dzień',
            body: 'Bilans sporządza się na określony **dzień bilansowy** (najczęściej 31 grudnia) i składa się on z dwóch zawsze równych sobie części (**Suma Aktywów = Suma Pasywów**). **Aktywa** odpowiadają na pytanie „Co posiada spółka?” i układane są od najmniej płynnych do najbardziej płynnych: **A. Aktywa trwałe** (budynki, maszyny, samochody, licencje długoterminowe) oraz **B. Aktywa obrotowe** (zapasy towarów w magazynie, należności krótkoterminowe od klientów, środki pieniężne w banku i kasie). **Pasywa** odpowiadają na pytanie „Skąd spółka wzięła na to pieniądze?”: **A. Kapitał (fundusz) własny** (kapitał zakładowy, kapitał zapasowy z zatrzymanych zysków z lat ubiegłych oraz zysk/strata netto bieżącego roku) oraz **B. Zobowiązania i rezerwy na zobowiązania** (kredyty, pożyczki, niezapłacone faktury dla dostawców, podatki i ZUS).',
            keyPoints: [
              'Ujemny kapitał własny w Bilansie (gdy skumulowane straty przewyższają kapitały spółki) to poważny sygnał ostrzegawczy dla zarządu (obowiązki z art. 233 KSH i test niewypłacalności)!',
              'Wysokie należności krótkoterminowe przy pustym koncie bankowym oznaczają, że kapitał spółki utknął w nieopłaconych fakturach klientów.',
            ],
          },
          {
            heading: 'Rachunek Zysków i Strat (RZiS) oraz terminy e-Sprawozdania Finansowego',
            body: 'Podczas gdy Bilans pokazuje stan na dany dzień, **Rachunek Zysków i Strat (RZiS)** sumuje strumienie przychodów i kosztów za cały okres (np. od 1 stycznia do 31 grudnia), prowadząc warstwa po warstwie do wyniku: najpierw **Zysk/strata ze sprzedaży** (podstawowy biznes spółki), potem po uwzględnieniu pozostałych przychodów i kosztów operacyjnych (np. sprzedaż środka trwałego, dotacje, spisane należności) — **Zysk/strata z działalności operacyjnej (EBIT)**, następnie po dodaniu przychodów i kosztów finansowych (odsetki, różnice kursowe) — **Zysk/strata brutto**, a po odjęciu podatku dochodowego CIT — **Zysk/strata netto**, który trafia prosto do Pasywów Bilansu! Spółka z rokiem obrotowym równym kalendarzowemu musi: sporządzić i podpisać elektronicznie e-Sprawozdanie Finansowe w strukturze XML do **31 marca** (3 miesiące), zatwierdzić je uchwałą Zgromadzenia Wspólników do **30 czerwca** (6 miesięcy) i złożyć do Repozytorium Dokumentów Finansowych (RDF) w KRS w ciągu **15 dni** od zatwierdzenia (najpóźniej do 15 lipca).',
            keyPoints: [
              'Jednostki małe i mikro (po podjęciu uchwały wspólników) mogą sporządzać uproszczony Bilans i RZiS według Załącznika nr 4 (mikro) lub Załącznika nr 5 (małe) do Ustawy o rachunkowości.',
              'e-Sprawozdanie Finansowe w XML podpisują elektronicznie (Profilem Zaufanym, podpisem kwalifikowanym lub osobistym) osoba prowadząca księgi ORAZ wszyscy członkowie zarządu (lub jeden członek zarządu po złożeniu oświadczeń przez pozostałych).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Sprawdzenie równowagi Bilansu zamknięcia spółki Gamma sp. z o.o. na 31.12.2026 r.',
          scenario:
            'Na dzień 31.12.2026 r. spółka Gamma posiada: serwery o wartości netto po amortyzacji 40 000,00 PLN, należności od klientów 35 000,00 PLN oraz gotówkę na rachunku bankowym 65 000,00 PLN. Kapitał zakładowy wynosi 10 000,00 PLN, kapitał zapasowy z lat ubiegłych 50 000,00 PLN, wypracowany w 2026 r. zysk netto po CIT 55 000,00 PLN, a bieżące zobowiązania wobec dostawców i US 25 000,00 PLN.',
          steps: [
            {
              stepNumber: 1,
              label: 'Suma Aktywów (Trwałe + Obrotowe)',
              calculation:
                '40 000,00 PLN (serwery) + 35 000,00 PLN (należności) + 65 000,00 PLN (bank)',
              amountPln: '140 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Kapitał własny w Pasywach',
              calculation:
                '10 000,00 PLN (zakładowy) + 50 000,00 PLN (zapasowy) + 55 000,00 PLN (zysk netto)',
              amountPln: '115 000,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Suma Pasywów (Kapitał własny + Zobowiązania)',
              calculation: '115 000,00 PLN (kapitał własny) + 25 000,00 PLN (zobowiązania)',
              amountPln: '140 000,00 PLN',
            },
          ],
          finalResultPln: '140 000,00 PLN',
          interpretation:
            'Aktywa (140 000,00 PLN) są idealnie równe Pasywom (140 000,00 PLN). Spółka ma bardzo zdrową strukturę: kapitał własny finansuje ponad 82% majątku, a sama gotówka w banku (65 000,00 PLN) ponad dwukrotnie pokrywa wszystkie zobowiązania krótkoterminowe (25 000,00 PLN).',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 września 1994 r. o rachunkowości',
            articleRef:
              'art. 45, art. 46 (Bilans), art. 47 (RZiS), art. 52 ust. 1, art. 53 ust. 1 oraz art. 69 ust. 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19941210591',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa strukturę sprawozdania finansowego (Bilans, RZiS, informacja dodatkowa) oraz ustawowe terminy sporządzenia (3 mies.), zatwierdzenia (6 mies.) i złożenia do KRS (15 dni).',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm07-l03-raport-bilans-i-rzis-spolki',
          '/accounting/reports',
          'Widok interaktywnego Bilansu oraz Rachunku Zysków i Strat spółki z kontrolą równowagi Aktywa = Pasywa i przejściem do kont źródłowych.',
          '[data-testid="balance-sheet-and-pnl-report"]',
        ),
        practicalExercise: {
          title:
            'Odczytaj zysk netto z RZiS i znajdź tę samą kwotę w Pasywach Bilansu spółki Gamma',
          demoCompanyId: 'demo_spzoo_gamma',
          demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
          steps: [
            'W kontekście spółki „Manufaktura Technologiczna Gamma sp. z o.o.” otwórz „Księgowość” -> „Bilans i RZiS”.',
            'Sprawdź wiersz końcowy Rachunku Zysków i Strat („Zysk (strata) netto”) za wybrany okres.',
            'Przełącz zakładkę na „Bilans” i potwierdź obecność identycznej kwoty w pozycji Pasywów „A.VI. Zysk (strata) netto” oraz zgodność Sumy Aktywów i Sumy Pasywów.',
          ],
          expectedOutcome:
            'Użytkownik rozumie organiczne połączenie Rachunku Zysków i Strat z Bilansem spółki kapitałowej.',
        },
        commonMistakes: [
          {
            mistake:
              'Utożsamianie dodatniego „Zysku netto” w RZiS z kwotą wolnej gotówki leżącej na rachunku bankowym spółki.',
            consequence:
              'Próba wypłaty dywidendy w sytuacji, gdy zysk został już zamrożony w zakupionych maszynach, zapasach towarów lub niespłaconych fakturach od klientów.',
            howToAvoid:
              'Przed uchwałą o dywidendzie sprawdź równocześnie zysk w RZiS/Kapitale własnym ORAZ stan środków pieniężnych i zobowiązań krótkoterminowych w Bilansie.',
          },
          {
            mistake:
              'Przekroczenie terminu 31 marca na podpisanie e-Sprawozdania Finansowego lub niezłożenie go do KRS w ciągu 15 dni od zatwierdzenia.',
            consequence:
              'Wszczęcie przez sąd rejestrowy postępowania przymuszającego z grzywnami oraz odpowiedzialność karna z art. 77 i art. 79 Ustawy o rachunkowości.',
            howToAvoid:
              'Pilnuj trzech kamieni milowych w Kalendarzu obowiązków aplikacji: 31 marca (sporządzenie i podpis XML), 30 czerwca (uchwała ZW) i +15 dni (zgłoszenie do RDF KRS).',
          },
          {
            mistake:
              'Traktowanie zysku bilansowego brutto z RZiS jako identycznego z podstawą opodatkowania podatkiem CIT-8.',
            consequence:
              'Błędne wyliczenie podatku CIT — wynik bilansowy wymaga najpierw korekty statystycznej o przychody niepodatkowe i koszty NKUP (np. niezapłacone składki ZUS, rezerwy, reprezentację, różnice w stawkach amortyzacji).',
            howToAvoid:
              'Zawsze korzystaj z noty podatkowej (przejścia z wyniku bilansowego na wynik podatkowy CIT).',
          },
        ],
        summary: [
          'Bilans pokazuje majątek (Aktywa) i źródła jego finansowania (Pasywa) na konkretny dzień — Suma Aktywów musi równać się Sumie Pasywów.',
          'Rachunek Zysków i Strat sumuje przychody i koszty okresu, a wyliczony w nim zysk/strata netto zasila kapitał własny w Pasywach Bilansu.',
          'Dla roku kalendarzowego terminy sprawozdawcze to: 31 marca (sporządzenie e-SF), 30 czerwca (zatwierdzenie) oraz 15 dni od zatwierdzenia na złożenie do KRS.',
        ],
        quiz: [
          {
            id: 'q-07-03-01',
            question:
              'Jaka fundamentalna zależność matematyczna musi być spełniona w każdym prawidłowo sporządzonym Bilansie?',
            options: [
              'Przychody = Koszty',
              'Suma Aktywów = Suma Pasywów',
              'Gotówka w banku = Kapitał zakładowy',
              'Należności = Zobowiązania',
            ],
            correctOptionIndex: 1,
            explanation:
              'Ponieważ Aktywa przedstawiają składniki majątku jednostki, a Pasywa źródła finansowania dokładnie tego samego majątku (kapitały własne i obce), Suma Aktywów jest zawsze równa Sumie Pasywów.',
          },
          {
            id: 'q-07-03-02',
            question:
              'W jakim terminie zarząd spółki z o.o. (której rok obrotowy pokrywa się z kalendarzowym) ma obowiązek sporządzić i podpisać elektroniczne sprawozdanie finansowe?',
            options: [
              'Do 20 stycznia kolejnego roku.',
              'Nie później niż w ciągu 3 miesięcy od dnia bilansowego (czyli do 31 marca).',
              'Do 30 września kolejnego roku.',
              'Dopiero przy sprzedaży udziałów w spółce.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 52 ust. 1 i ust. 2 Ustawy o rachunkowości kierownik jednostki zapewnia sporządzenie rocznego sprawozdania finansowego nie później niż w ciągu 3 miesięcy od dnia bilansowego.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 8,
    slug: 'zus-i-skladka-zdrowotna-przedsiebiorcy',
    title: 'Moduł 8: ZUS i składka zdrowotna przedsiębiorcy',
    subtitle:
      'Przejdź bezbłędnie przez Ulgę na start, Preferencyjny ZUS, Mały ZUS Plus i Duży ZUS w 2026 roku, oblicz składkę zdrowotną i wykorzystaj wakacje składkowe ZUS.',
    learningObjectives: [
      'Stosować kolejne etapy ulg w ubezpieczeniach społecznych ZUS (Ulga na start -> Preferencyjny ZUS -> Mały ZUS Plus / Duży ZUS) wg stawek 2026 r.',
      'Wyliczać miesięczną i roczną składkę zdrowotną na skali (9%), podatku liniowym (4,9%) oraz ryczałcie.',
      'Dotrzymywać terminów deklaracji ZUS DRA (15. i 20. dzień miesiąca) oraz prawidłowo składać wniosek o wakacje składkowe ZUS.',
    ],
    lessons: [
      {
        id: 'lesson-08-01',
        slug: 'ulga-na-start-preferencyjny-zus-maly-zus-plus-duzy-zus',
        moduleNumber: 8,
        lessonNumber: 1,
        title:
          'Ulga na start, Preferencyjny ZUS, Mały ZUS Plus i Duży ZUS — stawki i warunki w 2026 r.',
        estimatedMinutes: 17,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'jdg_ryczalt',
            'spolka_cywilna_kpir',
          ],
          scopeNote:
            'Dotyczy osób fizycznych prowadzących działalność gospodarczą (JDG oraz wspólników spółek cywilnych).',
        },
        intro:
          'Składki ZUS to dla większości małych firm największy stały koszt miesięczny — płatny niezależnie od tego, czy w danym miesiącu wystawiłeś dziesięć faktur, czy ani jednej. Na szczęście polskie prawo daje nowym przedsiębiorcom aż 30 miesięcy (2,5 roku!) bardzo głębokich ulg na starcie, a mniejszym firmom także Mały ZUS Plus. Zobaczmy dokładne stawki na 2026 rok!',
        sections: [
          {
            heading: 'Etap 1 i 2: Ulga na start (6 miesięcy) oraz Preferencyjny ZUS (24 miesiące)',
            body: 'Jeżeli zakładasz JDG po raz pierwszy (lub po co najmniej **60 miesiącach** od zamknięcia/zawieszenia poprzedniej firmy) i nie świadczysz w niej usług na rzecz byłego pracodawcy z bieżącego lub poprzedniego roku kalendarzowego odpowiadających Twoim obowiązkom etatowym, przysługuje Ci **Ulga na start** (art. 18 Prawa przedsiębiorców, kod tytułu ubezpieczenia `05 40`): przez **6 pełnych miesięcy kalendarzowych** nie płacisz składek społecznych — opłacasz wyłącznie składkę zdrowotną! Praktyczny tip: zakładając firmę **2. dnia miesiąca** (np. 2 marca zamiast 1 marca), zyskujesz nie 6, lecz niemal **7 miesięcy** ulgi (bo niepełny marzec nie wlicza się do 6 pełnych miesięcy!). Po zakończeniu Ulgi na start przechodzisz z kodem `05 70` na **Preferencyjny ZUS** przez kolejne **24 pełne miesiące** (art. 18a ustawy systemowej): podstawą składek społecznych jest 30% minimalnego wynagrodzenia (w 2026 r. 30% z 4 806 zł = **1 441,80 PLN**), co daje **456,18 PLN/mies.** z dobrowolnym chorobowym (lub **420,86 PLN** bez chorobowego, bez Funduszu Pracy).',
            keyPoints: [
              'Podczas Ulgi na start nie podlegasz ubezpieczeniu chorobowemu ani wypadkowemu (w razie L4 nie otrzymasz zasiłku z ZUS, ale zachowujesz pełne prawo do lekarza NFZ dzięki składce zdrowotnej!).',
              'Przejście z Ulgi na start na Preferencyjny ZUS NIE dzieje się automatycznie — wymaga wyrejestrowania na ZUS ZWUA z kodem `05 40` i zgłoszenia na ZUS ZUA z kodem `05 70` w terminie 7 dni!',
            ],
          },
          {
            heading: 'Etap 3: Mały ZUS Plus (do 120 000 zł przychodu) lub Duży ZUS w 2026 r.',
            body: 'Po wykorzystaniu 24 miesięcy Preferencyjnego ZUS przedsiębiorca wchodzi na **Duży ZUS** (kod `05 10`), gdzie podstawą wymiaru jest 60% prognozowanego przeciętnego wynagrodzenia — w 2026 r. podstawa ta wynosi **5 652,00 PLN** (60% × 9 420,00 PLN), a pełne składki społeczne z dobrowolnym chorobowym i Funduszem Pracy wynoszą łącznie **1 926,76 PLN/mies.** (emerytalna 1 103,27 zł + rentowa 452,16 zł + wypadkowa 94,39 zł + chorobowa 138,47 zł + FP 138,47 zł). Jeżeli jednak Twój przychód w poprzednim roku kalendarzowym nie przekroczył **120 000,00 PLN** (i prowadziłeś działalność przez min. 60 dni), możesz zgłosić się (kod `05 90`) do **Małego ZUS Plus** (art. 18c ustawy systemowej): wtedy podstawą składek społecznych jest połowa Twojego średniomiesięcznego dochodu z poprzedniego roku (w widełkach między 30% płacy minimalnej a 60% przeciętnego wynagrodzenia), maksymalnie przez **36 miesięcy w każdym 60-miesięcznym okresie** prowadzenia działalności!',
            keyPoints: [
              'Zbieg tytułów do ubezpieczeń: jeśli poza JDG pracujesz jednocześnie na etacie z wynagrodzeniem równym co najmniej płacy minimalnej (od 2026 r. min. **4 806,00 PLN brutto**), z działalności gospodarczej nie płacisz składek społecznych ZUS — opłacasz tylko składkę zdrowotną!',
              'Do Małego ZUS Plus od 1 stycznia należy zgłosić się w nieprzekraczalnym terminie do **31 stycznia** (lub w ciągu 7 dni od zakończenia Preferencyjnego ZUS w trakcie roku).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Porównanie łącznych składek społecznych przez pierwsze 30 miesięcy z Ulgą na start vs Duży ZUS (stawki 2026)',
          scenario:
            'Początkujący przedsiębiorca spełnia warunki Ulgi na start (6 miesięcy) oraz Preferencyjnego ZUS z chorobowym (24 miesiące). Policzmy, ile zostaje w jego firmie na samych składkach społecznych względem stawki Dużego ZUS z 2026 roku (1 926,76 PLN/mies.).',
          steps: [
            {
              stepNumber: 1,
              label: 'Koszt składek społecznych przez 6 miesięcy Ulgi na start',
              calculation: '6 miesięcy × 0,00 PLN (płatna wyłącznie składka zdrowotna)',
              amountPln: '0,00 PLN',
            },
            {
              stepNumber: 2,
              label:
                'Koszt składek społecznych przez 24 miesiące Preferencyjnego ZUS (z chorobowym)',
              calculation: '24 miesiące × 456,18 PLN',
              amountPln: '10 948,32 PLN',
            },
            {
              stepNumber: 3,
              label: 'Hipotetyczny koszt 30 miesięcy na pełnym Dużym ZUS (stawka 2026)',
              calculation: '30 miesięcy × 1 926,76 PLN',
              amountPln: '57 802,80 PLN',
            },
            {
              stepNumber: 4,
              label: 'Łączna ulga kapitałowa na rozwój firmy w pierwszych 30 miesiącach',
              calculation: '57 802,80 PLN − 10 948,32 PLN',
              amountPln: '46 854,48 PLN',
            },
          ],
          finalResultPln: '46 854,48 PLN',
          interpretation:
            'Prawidłowe pilnowanie terminów zgłoszeń do Ulgi na start (`05 40`) i Preferencyjnego ZUS (`05 70`) oszczędza młodej firmie ponad 46,8 tys. PLN w ciągu pierwszych dwóch i pół roku działalności.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 6 marca 2018 r. — Prawo przedsiębiorców',
            articleRef: 'art. 18 ust. 1 (Ulga na start — 6 pełnych miesięcy)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20180000646',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Zwalnia początkujących przedsiębiorców z obowiązku ubezpieczeń społecznych przez okres 6 miesięcy od dnia podjęcia działalności.',
          },
          {
            actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
            articleRef:
              'art. 18 ust. 8 (Duży ZUS), art. 18a (Preferencyjny ZUS 24 mies.) oraz art. 18c (Mały ZUS Plus)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981370887',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje podstawy wymiaru składek społecznych przedsiębiorców na Preferencyjnym ZUS, Małym ZUS Plus i Dużym ZUS.',
          },
          {
            actTitle: 'Zakład Ubezpieczeń Społecznych — Składki i podstawy wymiaru',
            articleRef: 'Komunikat o wysokości składek dla osób prowadzących działalność w 2026 r.',
            sourceKind: 'official_guidance',
            officialUrl:
              'https://www.zus.pl/baza-wiedzy/skladki-wskazniki-odsetki/skladki/wysokosc-skladek-na-ubezpieczenia-spoleczne',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Oficjalne zestawienie podstaw wymiaru i kwot składek ZUS obowiązujących przedsiębiorców w 2026 roku.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm08-l01-sciezka-ulg-zus-przedsiebiorcy',
          '/taxes',
          'Oś czasu uprawnień ZUS przedsiębiorcy pokazująca datę końca bieżącej ulgi oraz przypomnienie o zmianie kodu ubezpieczenia ZUS ZWUA / ZUA.',
          '[data-testid="zus-relief-timeline-card"]',
        ),
        practicalExercise: {
          title: 'Sprawdź aktywny schemat ZUS i datę wygaśnięcia ulgi w firmie demo Alfa',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Otwórz widok „Podatki i JPK” -> „ZUS i składka zdrowotna” w firmie Pracownia Projektowa Alfa.',
            'Sprawdź ustawiony kod tytułu ubezpieczenia oraz wyszczególnienie składek: emerytalnej, rentowej, wypadkowej, chorobowej i Funduszu Pracy.',
            'Kliknij ikonę pomocy przy polu „Schemat ZUS”, aby sprawdzić warunki przejścia na kolejny etap.',
          ],
          expectedOutcome:
            'Użytkownik rozumie dokładnie każdą składową przelewu do ZUS oraz terminy przerejestrowania między ulgami.',
        },
        commonMistakes: [
          {
            mistake:
              'Rozpoczęcie działalności dokładnie 1. dnia miesiąca zamiast 2. dnia miesiąca przy korzystaniu z Ulgi na start.',
            consequence:
              'Utrata niemal miesiąca ulgi (przy starcie 1 marca pierwszym z 6 pełnych miesięcy jest już marzec; przy starcie 2 marca pierwszym pełnym miesiącem jest dopiero kwiecień!).',
            howToAvoid:
              'Planując start nowej firmy z Ulgą na start, wybieraj we wniosku CEIDG-1 drugi lub kolejny dzień miesiąca.',
          },
          {
            mistake:
              'Zapomnienie o przerejestrowaniu kodu z `05 40` na `05 70` po upływie 6 miesięcy Ulgi na start.',
            consequence:
              'Niezgodność na koncie płatnika w PUE/eZUS i wezwanie do korekty dokumentów zgłoszeniowych oraz rozliczeniowych.',
            howToAvoid:
              'Skonfiguruj w Kalendarzu aplikacji przypomnienie e-mail na 7 dni przed końcem szóstego pełnego miesiąca Ulgi na start.',
          },
          {
            mistake:
              'Skorzystanie z Ulgi na start / Preferencyjnego ZUS przy wystawianiu faktur dla byłego pracodawcy z bieżącego lub poprzedniego roku za te same czynności co na etacie.',
            consequence:
              'Zakwestionowanie prawa do ulgi przez ZUS i konieczność dopłaty pełnego Dużego ZUS wraz z odsetkami za cały okres.',
            howToAvoid:
              'Współpracując na B2B z byłym pracodawcą za tożsame zadania, od pierwszego dnia zgłoś kod `05 10` (Duży ZUS) i wlicz wyższy ZUS w stawkę swojej faktury B2B!',
          },
        ],
        summary: [
          'Ścieżka składek społecznych JDG to: 6 pełnych miesięcy Ulgi na start (0 zł społecznych) -> 24 miesiące Preferencyjnego ZUS (456,18 zł z chorobowym w 2026 r.) -> Mały ZUS Plus lub Duży ZUS (1 926,76 zł w 2026 r.).',
          'Żadna z ulg na ubezpieczenia społeczne nie zwalnia z opłacania miesięcznej składki zdrowotnej.',
          'Etat z wynagrodzeniem co najmniej równym płacy minimalnej (4 806 zł brutto w 2026 r.) zwalnia z obowiązkowych składek społecznych w JDG.',
        ],
        quiz: [
          {
            id: 'q-08-01-01',
            question:
              'Przez ile pełnych miesięcy kalendarzowych początkujący przedsiębiorca może korzystać łącznie z Ulgi na start oraz następującego po niej Preferencyjnego ZUS?',
            options: [
              '12 miesięcy (6 + 6).',
              '24 miesiące (12 + 12).',
              '30 pełnych miesięcy kalendarzowych (6 miesięcy Ulgi na start + 24 miesiące Preferencyjnego ZUS).',
              '60 miesięcy bez żadnych warunków.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Ulga na start trwa 6 pełnych miesięcy kalendarzowych (art. 18 Prawa przedsiębiorców), a bezpośrednio po niej przysługują 24 pełne miesiące Preferencyjnego ZUS (art. 18a ustawy systemowej) — łącznie 30 pełnych miesięcy.',
          },
          {
            id: 'q-08-01-02',
            question:
              'Jaki maksymalny limit rocznego przychodu z działalności w poprzednim roku uprawnia przedsiębiorcę do skorzystania z Małego ZUS Plus?',
            options: [
              '60 000,00 PLN',
              '120 000,00 PLN (pomniejszane proporcjonalnie, jeśli działalność prowadzono przez część poprzedniego roku, min. 60 dni).',
              '240 000,00 PLN',
              '2 000 000 euro',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 18c ust. 1 ustawy o systemie ubezpieczeń społecznych z Małego ZUS Plus może skorzystać przedsiębiorca, którego przychód w poprzednim roku kalendarzowym nie przekroczył 120 000,00 PLN.',
          },
        ],
      },
      {
        id: 'lesson-08-02',
        slug: 'skladka-zdrowotna-na-skali-liniowym-i-ryczalcie',
        moduleNumber: 8,
        lessonNumber: 2,
        title: 'Składka zdrowotna w 2026 roku: skala 9%, liniowy 4,9% (limit 14 100 zł) i ryczałt',
        estimatedMinutes: 16,
        audienceScope: {
          type: 'profile_specific',
          applicableProfiles: [
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'jdg_ryczalt',
            'spolka_cywilna_kpir',
          ],
          scopeNote:
            'Dotyczy wyliczania miesięcznej składki zdrowotnej właścicieli JDG i wspólników spółek osobowych w roku składkowym 2026.',
        },
        intro:
          'Dlaczego składkę zdrowotną za luty liczymy od dochodu ze stycznia, a w styczniu płacimy ją jeszcze według zeszłorocznego grudnia? Wszystko przez specyficzny „rok składkowy”, przesunięty o jeden miesiąc względem roku kalendarzowego! Rozszyfrujmy zasady i minimalną składkę zdrowotną w 2026 roku.',
        sections: [
          {
            heading:
              'Skala (9%) i podatek liniowy (4,9%): przesunięcie o miesiąc i składka minimalna 432,54 zł',
            body: 'U przedsiębiorców na KPiR (skala i podatek liniowy) miesięczną podstawą wymiaru składki zdrowotnej jest **dochód z miesiąca bezpośrednio poprzedzającego miesiąc**, za który dokonywane jest rozliczenie! Na przykład w deklaracji ZUS DRA za **marzec** (składanej do 20 kwietnia) składkę zdrowotną liczysz od dochodu wypracowanego w **lutym** (a ściślej: różnicy między dochodem narastająco od początku roku do lutego a dochodem narastająco do stycznia). Z tego powodu tzw. **rok składkowy** trwa od **1 lutego danego roku do 31 stycznia roku następnego**! Na skali płacisz **9%** tak ustalonego dochodu (bez prawa odliczenia w PIT), a na podatku liniowym **4,9%** dochodu (z prawem zaliczenia zapłaconej składki w koszty KUP lub odliczenia od dochodu do limitu **14 100,00 PLN** w 2026 roku). Uwaga: nawet gdy w danym miesiącu masz stratę lub niski dochód, obowiązuje **minimalna składka zdrowotna**, która dla roku składkowego zaczynającego się 1 lutego 2026 r. wynosi **432,54 PLN/mies.** (9% z minimalnego wynagrodzenia 4 806 zł)!',
            keyPoints: [
              'Na podatku liniowym 4,9% minimalna składka zdrowotna (432,54 PLN w 2026 r.) włącza się zawsze, gdy miesięczny dochód spadnie poniżej ok. 8 827,35 PLN!',
              'Przy sprzedaży zamortyzowanego środka trwałego warto sprawdzić wyłączenie tego przychodu/kosztu z podstawy składki zdrowotnej zgodnie z aktualnymi przepisami ustawy zdrowotnej.',
            ],
          },
          {
            heading:
              'Składka zdrowotna na ryczałcie w 2026 roku i metoda uproszczona z roku poprzedniego',
            body: 'Na ryczałcie rok składkowy pokrywa się ze zwykłym rokiem kalendarzowym (1 stycznia – 31 grudnia), a miesięczna składka w 2026 r. wynosi: **498,35 PLN** (przychód roczny do 60 000 zł), **830,58 PLN** (przychód powyżej 60 000 zł do 300 000 zł) oraz **1 495,04 PLN** (przychód powyżej 300 000 zł). Ryczałtowiec prowadzący działalność przez cały poprzedni rok kalendarzowy może wybrać wygodny wariant: płacić w trakcie całego bieżącego roku stałą miesięczną składkę na podstawie sumy przychodów z **poprzedniego roku**, a ewentualną różnicę wyrównać dopiero raz w roku po jego zakończeniu!',
            keyPoints: [
              'Jeśli prowadzisz jednocześnie kilka działalności (np. JDG na KPiR i udział w spółce cywilnej), zasady sumowania dochodów lub odrębnych składek zdrowotnych wymagają szczególnej uwagi wg art. 82 ustawy zdrowotnej!',
              'Emeryt prowadzący działalność z niską emeryturą i niskimi przychodami może w określonych w art. 82 ust. 8 ustawy przypadkach skorzystać ze zwolnienia ze składki zdrowotnej z JDG.',
            ],
          },
        ],
        numericalExample: {
          title:
            'Wyliczenie składki zdrowotnej za kwiecień 2026 r. na skali (9%) oraz na liniowym (4,9%) przy niskim i wysokim dochodzie',
          scenario:
            'Porównajmy składkę zdrowotną w deklaracji ZUS DRA za kwiecień 2026 r. (liczoną na podstawie dochodu z marca 2026 r.) w dwóch sytuacjach: (1) w marcu przedsiębiorca miał przejściowy przestój i osiągnął tylko 2 000,00 PLN dochodu; (2) w kolejnym miesiącu osiągnął 15 000,00 PLN dochodu.',
          steps: [
            {
              stepNumber: 1,
              label: 'Przypadek 1 (dochód 2 000,00 PLN) — Skala 9% oraz Liniowy 4,9%',
              calculation:
                '9% × 2 000 = 180,00 PLN oraz 4,9% × 2 000 = 98,00 PLN -> obie kwoty niższe od minimum 432,54 PLN -> do zapłaty 432,54 PLN!',
              amountPln: '432,54 PLN',
            },
            {
              stepNumber: 2,
              label: 'Przypadek 2 (dochód 15 000,00 PLN) — Skala podatkowa 9%',
              calculation: '9% × 15 000,00 PLN (powyżej minimum)',
              amountPln: '1 350,00 PLN',
            },
            {
              stepNumber: 3,
              label: 'Przypadek 2 (dochód 15 000,00 PLN) — Podatek liniowy 4,9%',
              calculation: '4,9% × 15 000,00 PLN (powyżej minimum)',
              amountPln: '735,00 PLN',
            },
            {
              stepNumber: 4,
              label:
                'Różnica miesięcznej składki zdrowotnej między skalą a liniowym przy 15 000,00 PLN dochodu',
              calculation: '1 350,00 PLN − 735,00 PLN',
              amountPln: '615,00 PLN',
            },
          ],
          finalResultPln: '615,00 PLN',
          interpretation:
            'Przy dochodzie 15 000,00 PLN miesięcznie podatek liniowy daje o 615,00 PLN niższą składkę zdrowotną niż skala podatkowa (a dodatkowo te 735,00 PLN obniży jeszcze podstawę 19% podatku liniowego w limicie 14 100,00 PLN!). Przy dochodzie 2 000,00 PLN w obu formach włącza się ta sama składka minimalna 432,54 PLN.',
        },
        legalBasis: [
          {
            actTitle:
              'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
            articleRef:
              'art. 79a (4,9% liniowy), art. 81 ust. 2, ust. 2b–2d (rok składkowy i minimum) oraz art. 81 ust. 2e–2h (ryczałt)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20042102135',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Definiuje zasady obliczania miesięcznej i minimalnej składki zdrowotnej dla skali (9%), podatku liniowego (4,9%) oraz ryczałtu.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm08-l02-kalkulator-skladki-zdrowotnej-2026',
          '/taxes',
          'Karta obliczenia miesięcznej składki zdrowotnej ze wskazaniem miesiąca bazowego dochodu oraz progu składki minimalnej 432,54 PLN.',
          '[data-testid="health-insurance-calculation-card"]',
        ),
        practicalExercise: {
          title:
            'Zweryfikuj miesiąc bazowy dochodu użyty do wyliczenia składki zdrowotnej w ZUS DRA',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W widoku „Podatki i JPK” -> „ZUS i składka zdrowotna” wybierz deklarację ZUS DRA za bieżący miesiąc w firmie Alfa.',
            'Otwórz panel „Dlaczego?” przy pozycji „Składka na ubezpieczenie zdrowotne”.',
            'Zwróć uwagę, że podstawą wymiaru w ZUS DRA za miesiąc M jest dochód z miesiąca `M − 1`, oraz sprawdź test składki minimalnej 432,54 PLN.',
          ],
          expectedOutcome:
            'Użytkownik nie myli dochodu bieżącego miesiąca (do zaliczki PIT) z dochodem poprzedniego miesiąca (do składki zdrowotnej ZUS DRA).',
        },
        commonMistakes: [
          {
            mistake:
              'Wpisywanie do deklaracji ZUS DRA za marzec dochodu z marca zamiast dochodu z lutego.',
            consequence:
              'Rozbieżność podstaw wymiaru we wszystkich miesiącach roku składkowego i konieczność korygowania 12 deklaracji ZUS DRA!',
            howToAvoid:
              'Zapamiętaj żelazną zasadę na KPiR: zaliczka PIT za marzec bazuje na dochodzie do marca, ale zdrowotna w ZUS DRA za marzec bazuje na dochodzie z LUTEGO!',
          },
          {
            mistake: 'Wpłacenie 0,00 PLN składki zdrowotnej w miesiącu straty podatkowej na KPiR.',
            consequence:
              'Powstanie niedopłaty na koncie w ZUS (co może przerwać m.in. rozliczenia i wymagać odsetek) — nawet przy stracie 50 000 zł musisz zapłacić składkę minimalną (432,54 PLN od lutego 2026 r.)!',
            howToAvoid:
              'Zawsze weryfikuj dolny próg minimalnej składki zdrowotnej pilnowany automatycznie przez system.',
          },
          {
            mistake:
              'Odliczanie w kosztach podatku liniowego składki zdrowotnej ponad roczny limit ustawowy (14 100,00 PLN w 2026 r.).',
            consequence: 'Zawyżenie kosztów uzyskania przychodów i niedopłata podatku PIT-36L.',
            howToAvoid:
              'Śledź licznik wykorzystanego limitu 14 100,00 PLN w widoku podatku liniowego.',
          },
        ],
        summary: [
          'Na skali (9%) i podatku liniowym (4,9%) składkę zdrowotną za dany miesiąc liczy się od dochodu z miesiąca poprzedniego.',
          'Od lutego 2026 r. minimalna miesięczna składka zdrowotna na skali i liniowym wynosi 432,54 PLN (płatna również w razie straty).',
          'Na podatku liniowym zapłaconą składkę zdrowotną w 2026 r. można ująć w kosztach lub odliczyć od dochodu do limitu 14 100,00 PLN.',
        ],
        quiz: [
          {
            id: 'q-08-02-01',
            question:
              'Dochód z którego miesiąca stanowi podstawę obliczenia składki zdrowotnej w deklaracji ZUS DRA składanej za maj 2026 r. u przedsiębiorcy prowadzącego PKPiR?',
            options: [
              'Dochód z maja 2026 r.',
              'Dochód z kwietnia 2026 r. (miesiąca bezpośrednio poprzedzającego miesiąc rozliczeniowy).',
              'Średni dochód z 2024 roku.',
              'Prognozowany dochód z czerwca 2026 r.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 81 ust. 2c ustawy o świadczeniach opieki zdrowotnej miesięczną podstawę wymiaru składki zdrowotnej na skali i liniowym ustala się na podstawie dochodu z miesiąca bezpośrednio poprzedzającego miesiąc, za który dokonywane jest rozliczenie.',
          },
          {
            id: 'q-08-02-02',
            question:
              'Ile składki zdrowotnej za marzec 2026 r. zapłaci przedsiębiorca na podatku liniowym (4,9%), który w lutym 2026 r. poniósł stratę podatkową (-5 000,00 PLN)?',
            options: [
              '0,00 PLN, ponieważ poniósł stratę.',
              '432,54 PLN — obowiązującą od lutego 2026 r. minimalną składkę zdrowotną.',
              '1 926,76 PLN.',
              'ZUS wypłaci mu zwrot 4,9% od straty.',
            ],
            correctOptionIndex: 1,
            explanation:
              'W przypadku gdy podstawa wymiaru składki zdrowotnej jest niższa od minimalnego wynagrodzenia (lub wystąpiła strata), składka zdrowotna wynosi 9% minimalnego wynagrodzenia — czyli od lutego 2026 r. 432,54 PLN.',
          },
        ],
      },
      {
        id: 'lesson-08-03',
        slug: 'terminy-zus-dra-roczne-rozliczenie-i-wakacje-skladkowe',
        moduleNumber: 8,
        lessonNumber: 3,
        title:
          'Terminy ZUS DRA (15. i 20. dzień), roczne rozliczenie zdrowotnej i wakacje składkowe',
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
            'Obejmuje terminy rozliczeniowe ZUS dla spółek z osobowością prawną i JDG oraz zasady wakacji składkowych dla mikroprzedsiębiorców CEIDG.',
        },
        intro:
          'W rozliczeniach z ZUS obowiązują inne terminy dla spółki z o.o., a inne dla jednoosobowej działalności gospodarczej. Dodatkowo każdy przedsiębiorca w CEIDG ma dziś prawo do jednego „darmowego miesiąca” składek społecznych w roku — tzw. wakacji składkowych, które przy Dużym ZUS w 2026 roku zostawiają w kieszeni niemal 2 000 złotych!',
        sections: [
          {
            heading: 'Terminy składania deklaracji ZUS DRA i opłacania składek (15. vs 20. dzień)',
            body: 'Obecnie obowiązują trzy główne terminy płatności i przekazywania dokumentów rozliczeniowych do ZUS (art. 47 ust. 1 ustawy systemowej): do **5. dnia następnego miesiąca** dla jednostek budżetowych i samorządowych zakładów budżetowych; do **15. dnia następnego miesiąca** dla płatników posiadających **osobowość prawną** — czyli m.in. **spółek z o.o.**, spółek akcyjnych, PSA, fundacji i stowarzyszeń; oraz do **20. dnia następnego miesiąca** dla pozostałych płatników — czyli **wszystkich jednoosobowych działalności gospodarczych (JDG)** (zarówno opłacających składki wyłącznie za siebie, jak i zatrudniających pracowników!) oraz spółek cywilnych, jawnych, partnerskich i komandytowych! Uwaga: przedsiębiorcy rozliczający składkę zdrowotną na skali, liniowym lub ryczałcie muszą co miesiąc przesyłać deklarację ZUS DRA (nie działa dla nich dawne klonowanie deklaracji bez wysyłki, ponieważ co miesiąc raportują bieżącą podstawę zdrowotnej!).',
            keyPoints: [
              'Spółka z o.o. zatrudniająca pracowników lub zleceniobiorców rozlicza ZUS zawsze do **15. dnia** kolejnego miesiąca!',
              'JDG (nawet z 5 pracownikami) rozlicza ZUS zawsze do **20. dnia** kolejnego miesiąca!',
              'Raz w roku — w deklaracji ZUS DRA za kwiecień składanej do **20 maja** — każdy przedsiębiorca wypełnia obowiązkowy blok **rocznego rozliczenia składki zdrowotnej** za poprzedni rok (i dopłaca niedopłatę do 20 maja lub składa wniosek RZS-R o zwrot nadpłaty do 1 czerwca!).',
            ],
          },
          {
            heading: 'Wakacje składkowe ZUS (wniosek RWS) — jak odebrać 1 926,76 zł w 2026 roku',
            body: 'Mikroprzedsiębiorca wpisany do CEIDG (ubezpieczający do 10 osób łącznie z sobą, o przychodzie do 2 mln euro w co najmniej jednym z dwóch ostatnich lat i niewykonujący działalności na rzecz byłego pracodawcy z bieżącego lub poprzedniego roku) może **raz w roku kalendarzowym** skorzystać z **wakacji składkowych** za jeden wybrany miesiąc (art. 17a i art. 36d ustawy systemowej). Budżet państwa finansuje wtedy 100% jego własnych składek na ubezpieczenia społeczne (emerytalną, rentową, wypadkową i dobrowolną chorobową — o ile podlegał jej w miesiącu wniosku i miesiącu poprzednim!) oraz Fundusz Pracy! Kluczowe zasady: (1) wniosek **RWS** składa się wyłącznie elektronicznie przez PUE/eZUS **w miesiącu kalendarzowym poprzedzającym wybrany miesiąc** (np. na grudzień 2026 r. wniosek składasz w listopadzie 2026 r. — złożenie w grudniu przejdzie już na styczeń 2027 r.!); (2) ulga NIE zwalnia ze **składki zdrowotnej** ani składek za pracowników; (3) za miesiąc wakacji nadal składasz deklarację ZUS DRA z kodem wakacyjnym (np. `05 14` / `05 74` / `05 94`) oraz standardowy raport na składkę zdrowotną!',
            keyPoints: [
              'Nieprzekraczalny termin złożenia wniosku RWS (miesiąc poprzedzający) jest terminem prawa materialnego — nie przesuwa się, a spóźnienie o 1 dzień przenosi wakacje na kolejny miesiąc lub rok!',
              'Sfinansowane przez państwo składki są zwolnione z podatku PIT, ale oczywiście nie stanowią kosztu KUP ani nie pomniejszają dochodu/przychodu (bo nie zapłaciłeś ich z własnej kieszeni).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Bilans finansowy miesiąca z Wakacjami składkowymi na Dużym ZUS w listopadzie 2026 r.',
          scenario:
            'Przedsiębiorca na Dużym ZUS (z dobrowolnym ubezpieczeniem chorobowym) osiągnął w październiku 2026 r. dochód 10 000,00 PLN (podatek liniowy 4,9% zdrowotnej) i w październiku złożył przez eZUS wniosek RWS o wakacje składkowe na listopad 2026 r.',
          steps: [
            {
              stepNumber: 1,
              label: 'Standardowy przelew do ZUS za listopad BEZ wakacji składkowych',
              calculation:
                '1 926,76 PLN (Duży ZUS + FP) + 490,00 PLN (zdrowotna 4,9% × 10 000 PLN)',
              amountPln: '2 416,76 PLN',
            },
            {
              stepNumber: 2,
              label: 'Kwota sfinansowana z budżetu państwa w ramach wakacji składkowych',
              calculation: '100% składek społecznych właściciela + Fundusz Pracy',
              amountPln: '1 926,76 PLN',
            },
            {
              stepNumber: 3,
              label: 'Faktyczny przelew przedsiębiorcy do ZUS za listopad (do 20 grudnia 2026 r.)',
              calculation: 'Wyłącznie obowiązkowa składka zdrowotna (4,9% × 10 000,00 PLN)',
              amountPln: '490,00 PLN',
            },
          ],
          finalResultPln: '1 926,76 PLN',
          interpretation:
            'Dzięki złożeniu wniosku RWS w październiku przedsiębiorca w okresie wakacji normalnie wystawia faktury i zachowuje ciągłość ubezpieczenia emerytalnego i chorobowego, a na jego koncie zostaje 1 926,76 PLN.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 13 października 1998 r. o systemie ubezpieczeń społecznych',
            articleRef:
              'art. 17a, art. 36d (wakacje składkowe RWS) oraz art. 47 ust. 1 (terminy 5., 15. i 20. dnia miesiąca)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19981370887',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Określa terminy rozliczeń i wpłat do ZUS oraz warunki i tryb wnioskowania o jednomiesięczne zwolnienie z opłacania składek społecznych (wakacje składkowe).',
          },
          {
            actTitle:
              'Ustawa z dnia 27 sierpnia 2004 r. o świadczeniach opieki zdrowotnej finansowanych ze środków publicznych',
            articleRef: 'art. 81 ust. 2k–2u (roczne rozliczenie składki zdrowotnej do 20 maja)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20042102135',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Nakłada obowiązek złożenia rocznego rozliczenia składki zdrowotnej w dokumencie za kwiecień oraz reguluje zwrot nadpłaty i dopłatę różnicy.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm08-l03-kalendarz-zus-dra-i-wakacje-skladkowe',
          '/calendar',
          'Karta przypomnienia o złożeniu wniosku RWS na wakacje składkowe oraz rozróżnienie terminów ZUS DRA 15. dnia (sp. z o.o.) i 20. dnia (JDG).',
          '[data-testid="zus-dra-and-holiday-reminder"]',
        ),
        practicalExercise: {
          title: 'Sprawdź symulację miesiąca z wakacjami składkowymi ZUS w firmie demo Alfa',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Otwórz zakładkę „Kalendarz / zadania” w firmie Pracownia Projektowa Alfa.',
            'Zaznacz planowany miesiąc wakacji składkowych i zobacz automatycznie wygenerowany termin złożenia wniosku RWS w miesiącu poprzedzającym.',
            'Sprawdź podgląd zestawienia ZUS za miesiąc wakacji: 0,00 PLN składek społecznych właściciela z kieszeni podatnika oraz należną składkę zdrowotną.',
          ],
          expectedOutcome:
            'Użytkownik nie przegapi miesięcznego okna na wniosek RWS i pamięta o zapłacie składki zdrowotnej oraz złożeniu deklaracji DRA.',
        },
        commonMistakes: [
          {
            mistake:
              'Próba złożenia wniosku RWS o wakacje składkowe na listopad w dniu 2 listopada.',
            consequence:
              'System eZUS odrzuci wybór listopada lub potraktuje go jako wniosek na grudzień — wniosek RWS MUSI zostać wysłany w miesiącu POPRZEDZAJĄCYM wybrany miesiąc!',
            howToAvoid:
              'Planując wakacje składkowe na wybrany miesiąc (np. grudzień), złóż wniosek RWS najpóźniej do ostatniego dnia miesiąca poprzedniego (np. do 30 listopada).',
          },
          {
            mistake:
              'Niezłożenie deklaracji ZUS DRA i nieopłacenie składki zdrowotnej za miesiąc objęty wakacjami składkowymi.',
            consequence:
              'Zaległość w składce zdrowotnej i brak wymaganych raportów RCA/DRA z kodem wakacyjnym w ZUS.',
            howToAvoid:
              'W miesiącu wakacji składkowych złóż komplet dokumentów rozliczeniowych i przelej samą składkę zdrowotną do 20. dnia kolejnego miesiąca.',
          },
          {
            mistake: 'Opłacanie ZUS za pracowników w spółce z o.o. do 20. dnia miesiąca jak w JDG.',
            consequence:
              'Pięciodniowe opóźnienie co miesiąc — spółka z o.o. posiada osobowość prawną, więc jej ustawowy termin ZUS mija 15. dnia miesiąca!',
            howToAvoid:
              'Polegaj na Kalendarzu obowiązków aplikacji, który automatycznie ustawia 15. dzień dla sp. z o.o. i 20. dzień dla JDG.',
          },
        ],
        summary: [
          'Termin ZUS DRA i płatności składek to 15. dzień miesiąca dla osób prawnych (np. sp. z o.o.) oraz 20. dzień miesiąca dla JDG i spółek osobowych.',
          'Roczne rozliczenie składki zdrowotnej składa się w deklaracji za kwiecień (do 20 maja).',
          'Wakacje składkowe ZUS (1 miesiąc w roku dla mikroprzedsiębiorców CEIDG) wymagają wniosku RWS w miesiącu poprzedzającym i nie zwalniają ze składki zdrowotnej.',
        ],
        quiz: [
          {
            id: 'q-08-03-01',
            question:
              'W jakim terminie spółka z ograniczoną odpowiedzialnością (sp. z o.o.) ma obowiązek złożyć deklarację ZUS DRA i opłacić składki za zatrudnionych pracowników?',
            options: [
              'Do 5. dnia następnego miesiąca.',
              'Do 15. dnia następnego miesiąca (jako płatnik posiadający osobowość prawną).',
              'Do 20. dnia następnego miesiąca.',
              'Do 25. dnia następnego miesiąca.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 47 ust. 1 pkt 2 ustawy o systemie ubezpieczeń społecznych płatnicy posiadający osobowość prawną (w tym sp. z o.o.) rozliczają i opłacają składki do 15. dnia następnego miesiąca.',
          },
          {
            id: 'q-08-03-02',
            question:
              'Przedsiębiorca z CEIDG chce skorzystać z wakacji składkowych ZUS za grudzień 2026 r. Kiedy musi złożyć elektroniczny wniosek RWS i co nadal będzie musiał opłacić za grudzień?',
            options: [
              'Wniosek składa do 20 stycznia 2027 r. i nie płaci absolutnie nic.',
              'Wniosek RWS musi złożyć w listopadzie 2026 r. (w miesiącu poprzedzającym), a za grudzień nadal opłaca obowiązkową składkę zdrowotną (oraz ewentualne składki za pracowników).',
              'Wniosek składa w dowolnym miesiącu roku i zwalnia on wyłącznie ze składki zdrowotnej.',
              'Wakacje składkowe przyznawane są automatycznie bez wniosku.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Wniosek RWS składa się wyłącznie w miesiącu poprzedzającym miesiąc objęty zwolnieniem (na grudzień -> w listopadzie), a zwolnienie dotyczy własnych składek społecznych i FP, nie obejmując składki zdrowotnej.',
          },
        ],
      },
    ],
  },
  {
    moduleNumber: 9,
    slug: 'kalendarz-podatkowy-jpk-biala-lista-i-e-doreczenia',
    title: 'Moduł 9: Kalendarz podatkowy, JPK, Biała Lista i e-Doręczenia',
    subtitle:
      'Opanuj harmonogram miesiąca i roku z przesuwaniem terminów świątecznych, oznaczenia KSeF w JPK_V7M(3), nowe pliki JPK dochodowe, weryfikację Białej Listy oraz e-Doręczenia.',
    learningObjectives: [
      'Stosować harmonogram obowiązków podatkowych oraz regułę przesuwania terminów z soboty i święta (art. 12 § 5 Ordynacji podatkowej).',
      'Rozumieć budowę JPK_V7M(3)/K(3) z oznaczeniami KSeF (NrKSeF, OFF, BFK, DI) oraz harmonogram JPK_PKPIR, JPK_EWP i JPK_KR_PD.',
      'Chronić firmę przed sankcjami Białej Listy (limit 15 000 zł, ZAW-NR w 7 dni) oraz obsługiwać obowiązkową skrzynkę do e-Doręczeń.',
    ],
    lessons: [
      {
        id: 'lesson-09-01',
        slug: 'kalendarz-podatkowy-i-zasada-przesuwania-terminow',
        moduleNumber: 9,
        lessonNumber: 1,
        title:
          'Kalendarz miesiąca i roku podatkowego oraz zasada przesuwania terminów z soboty i święta',
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
            'vat_czynny',
            'vat_zwolniony_art113',
          ],
          scopeNote:
            'Edukacja ogólna — rytm miesięcznych i rocznych terminów urzędowych dotyczy każdej firmy działającej w Polsce.',
        },
        intro:
          'W księgowości spokój ducha bierze się z rytmu. Zamiast pamiętać dziesiątki rozproszonych przepisów, wystarczy opanować trzy stałe daty każdego miesiąca (15., 20. i 25. dzień) oraz jedną zbawienną zasadę z Ordynacji podatkowej, która ratuje weekendy wszystkich księgowych i przedsiębiorców w Polsce!',
        sections: [
          {
            heading: 'Rytm każdego miesiąca (15., 20., 25.) oraz najważniejsze daty w roku',
            body: 'Każdy miesiąc księgowy układa się w logiczną drabinę: **do 15. dnia miesiąca** wystawiasz ostatnie faktury za sprzedaż z poprzedniego miesiąca oraz opłacasz ZUS w spółce z o.o. (i wpłaty do PPK); **do 20. dnia miesiąca** opłacasz ZUS w JDG i spółkach osobowych, zaliczki na PIT, CIT i ryczałt oraz zaliczki PIT-4 od wynagrodzeń pracowników; **do 25. dnia miesiąca** wysyłasz plik JPK_V7M (lub część ewidencyjną/deklaracyjną JPK_V7K), informację podsumowującą VAT-UE oraz wpłacasz podatek VAT! Z kolei w skali roku kluczowe daty to: **31 stycznia** (zgłoszenie do Małego ZUS Plus oraz PIT-11 do urzędu skarbowego), **20 lutego** (zmiana formy opodatkowania JDG po styczniowym przychodzie), **koniec lutego** (wysłanie PIT-11 pracownikom), **31 marca** (zeznanie roczne CIT-8 oraz sporządzenie e-Sprawozdania Finansowego), **30 kwietnia** (zeznania roczne PIT-36, PIT-36L i PIT-28 — także dla ryczałtowców!), **20 maja** (roczne rozliczenie składki zdrowotnej) oraz **30 czerwca** (zatwierdzenie sprawozdania finansowego spółki).',
            keyPoints: [
              'Od kilku lat zeznanie roczne ryczałtowca **PIT-28** składa się do **30 kwietnia** (a nie jak dawniej do końca lutego)!',
              'Za dzień zapłaty podatku w obrocie bezgotówkowym uważa się dzień **obciążenia rachunku bankowego podatnika** (art. 60 § 1 pkt 2 Ordynacji podatkowej), a nie dzień zaksięgowania w urzędzie — byle przelew wyszedł przed północą dnia terminu i miał pokrycie!',
            ],
          },
          {
            heading: 'Przesunięcie terminu z soboty i święta (art. 12 § 5 Ordynacji podatkowej)',
            body: 'Co dzieje się, gdy 20. lub 25. dzień miesiąca wypada w sobotę, niedzielę albo dzień ustawowo wolny od pracy (np. 25 grudnia — Boże Narodzenie, 1 listopada czy Poniedziałek Wielkanocny)? Zgodnie z **art. 12 § 5 Ordynacji podatkowej**, jeżeli ostatni dzień terminu przypada na sobotę lub dzień ustawowo wolny od pracy, za ostatni dzień terminu uważa się **następny dzień po dniu lub dniach wolnych od pracy**! Analogiczna reguła obowiązuje również dla terminów płatności składek ZUS (art. 31 ustawy systemowej odsyła wprost do art. 12 Ordynacji podatkowej!). Uważaj jednak na wyjątki spoza prawa podatkowego: zwykły piątek po Bożym Ciele („długi weekend”) NIE jest dniem ustawowo wolnym od pracy, więc terminy urzędowe mijają w taki piątek normalnie!',
            keyPoints: [
              'W grudniu 2026 r. dzień 25 grudnia (piątek) i 26 grudnia (sobota) to święta, a 27 grudnia to niedziela — dlatego termin JPK_V7M i zapłaty VAT za listopad 2026 r. przesuwa się aż na **poniedziałek 28 grudnia 2026 r.**!',
              'Wigilia 24 grudnia — należy zawsze sprawdzać w oficjalnym kalendarzu dni ustawowo wolnych od pracy (ustawa o dniach wolnych od pracy po nowelizacji ustanawiającej Wigilię dniem wolnym!).',
            ],
          },
        ],
        numericalExample: {
          title:
            'Przesunięcie terminu zaliczki PIT i składek ZUS wypadających w sobotę 20 czerwca 2026 r.',
          scenario:
            'W czerwcu 2026 roku dzień 20 czerwca wypada w sobotę, a 21 czerwca w niedzielę. Przedsiębiorca ma do zapłaty 1 926,76 PLN składek ZUS za maj oraz 2 480,00 PLN zaliczki na podatek dochodowy PIT za maj. Obliczmy kwotę odsetek za zwłokę przy wysłaniu obu przelewów w poniedziałek 22 czerwca 2026 r.',
          steps: [
            {
              stepNumber: 1,
              label: 'Suma zobowiązań przypadających ustawowo na „20 czerwca 2026 r.”',
              calculation: '1 926,76 PLN (ZUS) + 2 480,00 PLN (PIT)',
              amountPln: '4 406,76 PLN',
            },
            {
              stepNumber: 2,
              label:
                'Przesunięcie terminu z soboty 20.06 i niedzieli 21.06 na poniedziałek 22.06 (art. 12 § 5 OP)',
              calculation: 'Poniedziałek 22 czerwca 2026 r. jest ostatnim dniem ustawowego terminu',
              amountPln: '4 406,76 PLN',
            },
            {
              stepNumber: 3,
              label: 'Kwota odsetek za zwłokę przy obciążeniu rachunku w dniu 22 czerwca 2026 r.',
              calculation: '0 dni opóźnienia × stawka odsetek podatkowych',
              amountPln: '0,00 PLN',
            },
          ],
          finalResultPln: '0,00 PLN',
          interpretation:
            'Zapłata zarówno ZUS, jak i zaliczki PIT w poniedziałek 22 czerwca 2026 r. jest w 100% terminowa z mocy art. 12 § 5 Ordynacji podatkowej i nie generuje ani grosza odsetek.',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Ordynacja podatkowa',
            articleRef: 'art. 12 § 5 oraz art. 60 § 1 pkt 2',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971370926',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Przesuwa terminy przypadające na sobotę lub dzień ustawowo wolny od pracy na najbliższy dzień roboczy oraz definiuje dzień zapłaty podatku przelewem.',
          },
          {
            actTitle: 'Ustawa z dnia 18 stycznia 1951 r. o dniach wolnych od pracy',
            articleRef: 'art. 1',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19510040028',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wymienia zamknięty katalog świąt państwowych i kościelnych będących dniami ustawowo wolnymi od pracy w Polsce.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm09-l01-kalendarz-podatkowy-przesuniecia-swiateczne',
          '/calendar',
          'Widok Kalendarza obowiązków podatkowych z adnotacją o przesunięciu terminu z weekendu na poniedziałek na podstawie art. 12 § 5 Ordynacji podatkowej.',
          '[data-testid="tax-calendar-month-view"]',
        ),
        practicalExercise: {
          title: 'Sprawdź przesunięcie weekendowego terminu podatkowego w Kalendarzu aplikacji',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do sekcji „Kalendarz / zadania” w firmie Pracownia Projektowa Alfa.',
            'Wybierz czerwiec 2026 r. (lub grudzień 2026 r.) i kliknij termin ZUS / PIT / JPK_V7M oznaczony ikoną przesunięcia kalendarzowego.',
            'Otwórz okienko „Dlaczego?” potwierdzające pierwotną datę ustawową (sobota/święto) oraz wyznaczony dzień roboczy wg art. 12 § 5 Ordynacji podatkowej.',
          ],
          expectedOutcome:
            'Użytkownik ma 100% pewności co do rzeczywistych terminów płatności w każdym miesiącu roku.',
        },
        commonMistakes: [
          {
            mistake:
              'Zlecanie wieczorem 25. dnia miesiąca przelewu z datą realizacji „jutro rano” (gdy sesja wychodząca lub saldo nie obciąży konta przed północą).',
            consequence:
              'Jeżeli rachunek bankowy zostanie obciążony dopiero 26. dnia miesiąca, powstaje opóźnienie (choć niskie odsetki poniżej trzykrotności opłaty pocztowej za przesyłkę poleconą — art. 54 § 1 pkt 5 OP — nie są pobierane, spóźnienie psuje historię terminowości np. do 25-dniowego zwrotu VAT!).',
            howToAvoid:
              'Realizuj przelewy podatkowe w godzinach pracy banku najpóźniej w ostatnim dniu terminu.',
          },
          {
            mistake:
              'Stosowanie art. 12 § 5 Ordynacji podatkowej do terminu wystawienia faktury z art. 106i ustawy o VAT lub innych terminów materialnych bez weryfikacji.',
            consequence:
              'W prawie podatkowym niektóre terminy materialne (określające samo istnienie uprawnienia, np. okno złożenia wniosku RWS w miesiącu poprzedzającym) nie ulegają przesunięciu procesowemu!',
            howToAvoid:
              'Wnioski o ulgi i wybory form opodatkowania składaj zawsze z co najmniej 2-dniowym zapasem przed weekendem.',
          },
          {
            mistake:
              'Traktowanie Wielkiego Piątku lub Sylwestra (31 grudnia) jako dnia ustawowo wolnego od pracy.',
            consequence:
              'Przegapienie terminu przypadającego 31 grudnia (np. spisu z natury lub zgłoszeń końcoworocznych) — Sylwester i Wielki Piątek są w Polsce normalnymi dniami roboczymi!',
            howToAvoid:
              'Polegaj wyłącznie na ustawowym katalogu świąt wbudowanym w generator kalendarza platformy.',
          },
        ],
        summary: [
          'Trzy filary każdego miesiąca to: 15. dzień (ZUS sp. z o.o. i faktury za poprzedni miesiąc), 20. dzień (ZUS JDG i PIT/CIT/ryczałt) oraz 25. dzień (JPK_V7 i VAT).',
          'Gdy termin procesowy podatku lub ZUS przypada w sobotę albo święto ustawowe, przesuwa się na pierwszy kolejny dzień roboczy (art. 12 § 5 Ordynacji podatkowej).',
          'Za dzień zapłaty podatku przelewem uznaje się dzień obciążenia rachunku bankowego podatnika.',
        ],
        quiz: [
          {
            id: 'q-09-01-01',
            question:
              'Dzień 25 października wypada w niedzielę, a 26 października jest zwykłym roboczym poniedziałkiem. Kiedy upływa ustawowy termin wysłania pliku JPK_V7M i zapłaty podatku VAT za wrzesień?',
            options: [
              'W piątek 23 października (termin cofa się przed weekend).',
              'W niedzielę 25 października o północy bez żadnych przesunięć.',
              'W poniedziałek 26 października (zgodnie z art. 12 § 5 Ordynacji podatkowej termin przesuwa się na następny dzień po dniu lub dniach wolnych od pracy).',
              'Dopiero 30 października.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Art. 12 § 5 Ordynacji podatkowej przesuwa termin przypadający w sobotę lub dzień ustawowo wolny od pracy (w tym niedzielę) na następny dzień roboczy — nigdy go nie skraca na piątek.',
          },
          {
            id: 'q-09-01-02',
            question:
              'Do kiedy podatnik rozliczający się ryczałtem od przychodów ewidencjonowanych składa roczne zeznanie podatkowe PIT-28 za rok 2026?',
            options: [
              'Do 31 stycznia 2027 r.',
              'Do 28 lutego 2027 r.',
              'Do 30 kwietnia 2027 r. (w ujednoliconym terminie razem z PIT-36 i PIT-36L).',
              'Ryczałtowcy nie składają zeznania rocznego.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Termin składania zeznania rocznego PIT-28 został ujednolicony z pozostałymi deklaracjami PIT i przypada od 15 lutego do 30 kwietnia roku następującego po roku podatkowym.',
          },
        ],
      },
      {
        id: 'lesson-09-02',
        slug: 'jpk-v7m-v7k-oznaczenia-ksef-oraz-nowe-jpk-dochodowe',
        moduleNumber: 9,
        lessonNumber: 2,
        title:
          'JPK_V7M(3)/V7K(3) z oznaczeniami KSeF (OFF, BFK, DI) oraz nowe JPK_PKPIR, JPK_EWP i JPK_KR_PD',
        estimatedMinutes: 17,
        audienceScope: {
          type: 'general_education',
          applicableProfiles: [
            'vat_czynny',
            'jdg_kpir_skala',
            'jdg_kpir_liniowy',
            'jdg_ryczalt',
            'spolka_cywilna_kpir',
            'sp_zoo_pelne_ksiegi_cit_klasyczny',
            'sp_zoo_pelne_ksiegi_cit_estonski',
          ],
          scopeNote:
            'JPK_V7M/K dotyczy czynnych podatników VAT, natomiast nowe roczne struktury JPK dochodowe (JPK_PKPIR, JPK_EWP, JPK_KR_PD) obejmują stopniowo wszystkich przedsiębiorców.',
        },
        intro:
          'Jednolity Plik Kontrolny (JPK) to ustandaryzowany plik XML, dzięki któremu urząd skarbowy automatycznie weryfikuje Twoje rejestry i księgi. W 2026 roku świat JPK przeszedł dwie wielkie aktualizacje: nową wersję JPK_V7(3) ściśle spiętą z numerami KSeF oraz wejście obowiązkowych struktur JPK dla podatków dochodowych!',
        sections: [
          {
            heading:
              'JPK_V7M(3) i JPK_V7K(3): część ewidencyjna, deklaracyjna, GTU oraz znaczniki KSeF',
            body: 'Czynni podatnicy VAT składają plik **JPK_V7M** (przy rozliczeniu miesięcznym — łączy ewidencję i deklarację co miesiąc) albo **JPK_V7K** (przy rozliczeniu kwartalnym u małych podatników — uwaga: za 1. i 2. miesiąc kwartału i tak wysyła się co miesiąc część ewidencyjną JPK_V7K, a po 3. miesiącu ewidencję wraz z częścią deklaracyjną i wpłatą VAT!). W części ewidencyjnej sprzedaży oznacza się m.in. grupy towarowo-usługowe **GTU_01 do GTU_13** (np. `GTU_12` dla usług niematerialnych: doradczych, księgowych, prawnych, zarządczych, marketingowych, szkoleniowych; `GTU_06` dla urządzeń elektronicznych) oraz procedury (np. `TP` dla powiązań rodzinnych/kapitałowych). Od lutego 2026 r. w schemie **JPK_V7M(3) / JPK_V7K(3)** każda pozycja fakturowa (w sprzedaży i w zakupach!) musi posiadać albo nadany **NrKSeF**, albo jeden z trzech obowiązkowych znaczników zastępczych: **OFF** (faktura z trybu awarii KSeF nieposiadająca jeszcze numeru KSeF na dzień wysyłki JPK), **BFK** (faktura wystawiona poza KSeF, np. konsumencka B2C, zagraniczna WNT/import usług lub od podmiotu wyłączonego) albo **DI** (dowód inny niż faktura ustrukturyzowana, np. raport okresowy z kasy rejestrującej `RO`, dokument wewnętrzny `WEW` lub szczególny tryb przed nadaniem numeru wg broszury MF).',
            keyPoints: [
              'Kody `GTU_01..GTU_13` stosuje się WYŁĄCZNIE po stronie sprzedaży (nigdy przy fakturach zakupowych i nigdy na samym wizualnym wydruku faktury dla klienta)!',
              'Puste pole numeru KSeF bez znacznika `OFF`, `BFK` lub `DI` powoduje natychmiastowe techniczne odrzucenie pliku JPK_V7M(3) przez bramkę Ministerstwa Finansów!',
            ],
          },
          {
            heading:
              'Nowe pliki JPK w podatkach dochodowych: JPK_PKPIR, JPK_EWP, JPK_KR_PD i JPK_ST',
            body: 'Dotychczas księgi dochodowe (PKPiR, Ewidencję Przychodów, Księgi Rachunkowe) przekazywało się w formacie JPK wyłącznie na żądanie urzędu skarbowego podczas kontroli. Od **2026 roku** (I fala: dla podatników PIT/ryczałtu składających miesięczne JPK_V7M oraz większości podatników CIT; a od **1 stycznia 2027 r.** w II fali dla wszystkich pozostałych przedsiębiorców, w tym kwartalnych i nie-vatowców!) obowiązuje prowadzenie tych ksiąg w ustrukturyzowanej formie elektronicznej i **automatyczne przesyłanie ich raz w roku po zakończeniu roku podatkowego**: **JPK_PKPIR** + **JPK_ST** (środki trwałe) dla podatników KPiR (pierwsza wysyłka za rok 2026 do **30 kwietnia 2027 r.**), **JPK_EWP** + **JPK_ST** dla ryczałtowców (do **30 kwietnia 2027 r.**) oraz **JPK_KR_PD** + **JPK_ST_KR** dla ksiąg rachunkowych (ze znacznikami kont księgowych i rozliczeniem podatkowym CIT/PIT).',
            keyPoints: [
              'Rok wejścia obowiązku (2026) oznacza obowiązek zbierania kompletnych danych (np. NIP kontrahentów, numerów KSeF, dat nabycia i wykreślenia środków trwałych w JPK_ST) od 1 stycznia 2026 r., aby bez stresu wysłać plik po zakończeniu roku!',
              'Za rażące błędy w ewidencji JPK_V7 nieusunięte w ciągu 14 dni od wezwania naczelnika US grozi administracyjna kara 500 zł za każdy błąd (art. 109 ust. 3h ustawy o VAT).',
            ],
          },
        ],
        numericalExample: {
          title: 'Rozliczenie kwartalne JPK_V7K u małego podatnika VAT w I kwartale 2026 r.',
          scenario:
            'Mały podatnik VAT rozliczający się kwartalnie (JPK_V7K) wygenerował nadwyżkę VAT należnego nad naliczonym: w styczniu 2 000,00 PLN, w lutym 3 100,00 PLN i w marcu 1 900,00 PLN. Sprawdźmy przepływ pieniężny wpłat VAT w poszczególnych miesiącach kwartału.',
          steps: [
            {
              stepNumber: 1,
              label: 'Do 25 lutego (za styczeń) — wysyłka samej części ewidencyjnej JPK_V7K',
              calculation:
                'Obowiązek wysyłki ewidencji XML, ale wpłata VAT za styczeń wynosi 0,00 PLN',
              amountPln: '0,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Do 25 marca (za luty) — wysyłka samej części ewidencyjnej JPK_V7K',
              calculation: 'Obowiązek wysyłki ewidencji XML, wpłata VAT za luty wynosi 0,00 PLN',
              amountPln: '0,00 PLN',
            },
            {
              stepNumber: 3,
              label:
                'Do 27 kwietnia 2026 r. (25.04 to sobota!) — pełny JPK_V7K za I kwartał i wpłata VAT',
              calculation: '2 000,00 PLN (styczeń) + 3 100,00 PLN (luty) + 1 900,00 PLN (marzec)',
              amountPln: '7 000,00 PLN',
            },
          ],
          finalResultPln: '7 000,00 PLN',
          interpretation:
            'Kwartalny VAT odracza sam przelew pieniędzy (7 000,00 PLN dopiero po zakończeniu kwartału), ale NIE zwalnia z comiesięcznego wysyłania części ewidencyjnej JPK_V7K do 25. dnia miesiąca za pierwsze dwa miesiące kwartału!',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef: 'art. 99 ust. 11c oraz art. 109 ust. 3–3k (JPK_VAT z deklaracją)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje obowiązek przesyłania plików JPK_V7M i JPK_V7K drogą elektroniczną do 25. dnia miesiąca oraz procedurę korekt w terminie 14 dni.',
          },
          {
            actTitle: 'Portal Podatkowy Ministerstwa Finansów — Struktury JPK_VAT(3) oraz JPK_PD',
            articleRef:
              'Broszura informacyjna JPK_V7M(3)/JPK_V7K(3) oraz JPK_PKPIR / JPK_EWP / JPK_KR_PD',
            sourceKind: 'official_guidance',
            officialUrl: 'https://www.podatki.gov.pl/jednolity-plik-kontrolny/',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Oficjalne schemy XSD, zasady stosowania znaczników NrKSeF / OFF / BFK / DI, kodów GTU oraz harmonogram JPK w podatkach dochodowych.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm09-l02-walidator-jpk-v7m3-i-znaczniki-ksef',
          '/taxes',
          'Walidator przedwysyłkowy pliku JPK_V7M(3) sprawdzający kompletność numerów KSeF / znaczników OFF, BFK, DI oraz kodów GTU.',
          '[data-testid="jpk-v7-prevalidation-panel"]',
        ),
        practicalExercise: {
          title: 'Uruchom walidację wstępną pliku JPK_V7M(3) dla firmy demo Alfa',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'W sekcji „Podatki i JPK” wybierz bieżący miesiąc dla firmy Pracownia Projektowa Alfa.',
            'Kliknij „Sprawdź spójność JPK_V7M(3)” i przejrzyj przypisane kody: `GTU_12` przy usługach projektowych/doradczych, `NrKSeF` przy fakturach krajowych oraz `BFK` przy imporcie usługi chmurowej z Irlandii.',
            'Potwierdź brak błędów blokujących strukturę XSD (gotowość do autoryzowanego podpisu i eksportu).',
          ],
          expectedOutcome:
            'Użytkownik rozumie znaczenie walidacji przedwysyłkowej JPK_V7M(3) i bezbłędnie dobiera oznaczenia KSeF oraz GTU.',
        },
        commonMistakes: [
          {
            mistake:
              'Niewysłanie części ewidencyjnej JPK_V7K za styczeń i luty przez podatnika rozliczającego VAT kwartalnie („bo rozliczam się co kwartał”).',
            consequence:
              'Niezłożenie wymaganej prawem informacji podatkowej w terminie (w JPK_V7K kwartalna jest tylko część deklaracyjna i wpłata, natomiast ewidencję śle się co miesiąc!).',
            howToAvoid:
              'Pamiętaj: niezależnie od M czy K, 25. dzień KAŻDEGO miesiąca to dzień wysyłki pliku JPK do Ministerstwa Finansów.',
          },
          {
            mistake:
              'Pominięcie kodu `GTU_12` przy sprzedaży usług doradczych, zarządczych, księgowych, marketingowych lub szkoleniowych.',
            consequence:
              'Wadliwość części ewidencyjnej JPK_V7 i ryzyko wezwania z urzędu skarbowego do korekty w ciągu 14 dni pod rygorem kary 500 zł.',
            howToAvoid:
              'Przypisz domyślny kod GTU do szablonu swoich usług w katalogu produktów i usług aplikacji.',
          },
          {
            mistake:
              'Wpisanie kodu `BFK` przy polskiej fakturze ustrukturyzowanej, która zdążyła już otrzymać numer KSeF przed dniem wysyłki JPK_V7M.',
            consequence:
              'Błędne raportowanie w JPK_V7M(3) — jeśli na dzień złożenia JPK faktura posiada numer KSeF, podaje się zawsze jej rzeczywisty `NrKSeF`!',
            howToAvoid:
              'Przed wygenerowaniem JPK_V7M uruchom synchronizację z KSeF, aby pobrać wszystkie nadane numery KSeF.',
          },
        ],
        summary: [
          'W JPK_V7M(3)/V7K(3) od lutego 2026 r. każdy wpis fakturowy wymaga numeru `NrKSeF` albo znacznika `OFF`, `BFK` lub `DI`.',
          'Podatnicy kwartalni (JPK_V7K) płacą VAT raz na kwartał, ale część ewidencyjną przesyłają co miesiąc do 25. dnia miesiąca.',
          'Nowe roczne pliki JPK_PKPIR, JPK_EWP i JPK_KR_PD wchodzą etapowo od 2026/2027 r. i są przesyłane po zakończeniu roku podatkowego.',
        ],
        quiz: [
          {
            id: 'q-09-02-01',
            question:
              'Jakie oznaczenie KSeF należy zastosować w części ewidencyjnej pliku JPK_V7M(3) dla faktury wystawionej na rzecz prywatnego konsumenta (B2C) poza systemem KSeF?',
            options: [
              'OFF',
              'BFK (faktura wystawiona poza Krajowym Systemem e-Faktur).',
              'GTU_12',
              'Wpisuje się same zera w polu NrKSeF.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Kod BFK służy w strukturze JPK_V7M(3)/V7K(3) do oznaczania faktur elektronicznych lub papierowych wystawionych zgodnie z prawem poza systemem KSeF (np. B2C lub faktur zagranicznych).',
          },
          {
            id: 'q-09-02-02',
            question:
              'Kiedy przedsiębiorca prowadzący PKPiR i składający miesięczne JPK_V7M (objęty I etapem od 1 stycznia 2026 r.) po raz pierwszy przesyła plik JPK_PKPIR za rok 2026 do urzędu skarbowego?',
            options: [
              'Co tydzień w każdy piątek 2026 roku.',
              'Po zakończeniu roku podatkowego 2026 — w terminie złożenia zeznania rocznego, czyli do 30 kwietnia 2027 r.',
              'Już 25 stycznia 2026 r.',
              'Nigdy, plik drukuje się na papierze.',
            ],
            correctOptionIndex: 1,
            explanation:
              'JPK_PKPIR (oraz analogicznie JPK_EWP dla ryczałtowców) jest plikiem rocznym przesyłanym po zakończeniu roku podatkowego w terminie właściwym dla złożenia zeznania PIT (za 2026 r. do 30 kwietnia 2027 r.).',
          },
        ],
      },
      {
        id: 'lesson-09-03',
        slug: 'biala-lista-podatnikow-vat-sankcje-zaw-nr-i-e-doreczenia',
        moduleNumber: 9,
        lessonNumber: 3,
        title: 'Biała Lista podatników VAT (limit 15 000 zł, ZAW-NR) oraz obowiązkowe e-Doręczenia',
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
            'Edukacja ogólna — zarówno weryfikacja rachunków na Białej Liście powyżej 15 000 zł brutto, jak i posiadanie firmowej skrzynki do e-Doręczeń to kluczowe wymogi bezpieczeństwa prawnego.',
        },
        intro:
          'Wysłanie przelewu za drogą fakturę na prywatny rachunek oszczędnościowy kontrahenta (ROR) oraz zignorowanie powiadomienia ze skrzynki e-Doręczeń przez dwa tygodnie to dwa błędy, które w 2026 roku potrafią kosztować dziesiątki tysięcy złotych bez jednego błędu w rachunkach! Zobaczmy, jak zabezpieczyć przed nimi swoją firmę.',
        sections: [
          {
            heading: 'Biała Lista podatników VAT, próg 15 000 zł brutto i ratunek ZAW-NR w 7 dni',
            body: '**Wykaz podatników VAT (tzw. Biała Lista)** prowadzony przez Szefa KAS zawiera status VAT firmy oraz jej zgłoszone firmowe rachunki rozliczeniowe (i powiązane z nimi wirtualne subkonta masowe, np. u operatorów telekomunikacyjnych i energetycznych). Jeżeli płacisz innemu przedsiębiorcy będącemu **czynnym podatnikiem VAT** za jednorazową transakcję (umowę!) przekraczającą równowartość **15 000,00 PLN brutto** (nawet jeśli jest rozbita na mniejsze faktury częściowe!), masz obowiązek wykonać przelew na rachunek widniejący na Białej Liście **w dniu zlecenia przelewu**! Zapłata na rachunek spoza Białej Listy powoduje dwie surowe sankcje: (1) **wyrzucenie całego wydatku z kosztów uzyskania przychodów KUP** w PIT/CIT (art. 22p PIT / art. 15d CIT) oraz (2) **solidarną odpowiedzialność całym majątkiem** za nierozliczony przez sprzedawcę VAT z tej transakcji (art. 117ba Ordynacji podatkowej)! Jak uratować sytuację, jeśli przelew już poszedł? Masz dwa wyjścia: zapłata z użyciem **Mechanizmu Podzielonej Płatności (MPP)** chroni przed sankcją, albo złożenie zawiadomienia **ZAW-NR** do naczelnika własnego urzędu skarbowego w nieprzekraczalnym terminie **7 dni od dnia zlecenia przelewu**!',
            keyPoints: [
              'Limit 15 000,00 PLN brutto dotyczy wartości CAŁEJ UMOWY / TRANSAKCJI (np. rocznej umowy najmu biura na czas określony albo zlecenia budowlanego płatnego w 3 transzach po 6 000 zł!), a nie pojedynczego przelewu!',
              'Prywatny rachunek ROR przedsiębiorcy JDG nie trafia na Białą Listę — do rozliczeń B2B powyżej 15 000 zł konieczny jest firmowy rachunek rozliczeniowy zgłoszony w CEIDG / NIP-8!',
            ],
          },
          {
            heading: 'Obowiązkowe e-Doręczenia (ADE) i 14-dniowa fikcja doręczenia',
            body: 'System **e-Doręczeń** zastępuje tradycyjne papierowe listy polecone za zwrotnym potwierdzeniem odbioru z urzędów skarbowych, ZUS, sądów i gmin. Posiadanie aktywnego firmowego **Adresu do Doręczeń Elektronicznych (ADE)** wpisanego do Bazy Adresów Elektronicznych (BAE) stało się obowiązkowe: dla spółek z KRS zarejestrowanych przed 2025 r. od **1 kwietnia 2025 r.** (a dla nowych przy rejestracji), natomiast dla wszystkich przedsiębiorców z **CEIDG (JDG)** najpóźniej od **1 października 2026 r.** (a dla zakładających firmę lub aktualizujących wpis CEIDG — już wcześniej!). Najważniejszy skutek prawny to **fikcja doręczenia**: jeżeli urząd wyśle decyzję lub wezwanie na Twoją skrzynkę e-Doręczeń, a Ty jej nie otworzysz w ciągu **14 dni** od wpłynięcia wiadomości, pismo uznaje się z mocy prawa za skutecznie doręczone 14. dnia i zaczyna biec np. 7-dniowy lub 14-dniowy termin na odwołanie!',
            keyPoints: [
              'Samo złożenie wniosku o ADE na biznes.gov.pl nie wystarcza — po przyznaniu adresu musisz zalogować się i **AKTYWOWAĆ skrzynkę**, skonfigurowawszy powiadomienia e-mail/SMS!',
              'Prywatny adres e-Doręczeń obywatela nie zastępuje odrębnej skrzynki firmowej przedsiębiorcy, a zawieszenie działalności JDG nie zwalnia z jej posiadania.',
            ],
          },
        ],
        numericalExample: {
          title:
            'Koszt podatkowy pominięcia Białej Listy przy fakturze na 24 600,00 PLN brutto (bez ZAW-NR i bez MPP)',
          scenario:
            'Przedsiębiorca na podatku liniowym 19% kupił usługę remontową biura od czynnego podatnika VAT za 20 000,00 PLN netto + 4 600,00 PLN VAT = 24 600,00 PLN brutto. Zapłacił zwykłym przelewem (bez MPP) na prywatny ROR wykonawcy niewidniejący na Białej Liście i nie złożył ZAW-NR w ciągu 7 dni.',
          steps: [
            {
              stepNumber: 1,
              label: 'Wartość netto wydatku wyłączona z KUP na mocy sankcji art. 22p ustawy o PIT',
              calculation:
                'Cała kwota netto opłacona z naruszeniem Białej Listy powyżej 15 000 PLN brutto',
              amountPln: '20 000,00 PLN',
            },
            {
              stepNumber: 2,
              label: 'Dodatkowy podatek liniowy 19% + składka zdrowotna 4,9% wskutek utraty kosztu',
              calculation: '20 000,00 PLN × (19% + 4,9%) = 3 800,00 PLN + 980,00 PLN',
              amountPln: '4 780,00 PLN',
            },
            {
              stepNumber: 3,
              label:
                'Maksymalna ekspozycja na solidarną odpowiedzialność za VAT sprzedawcy (art. 117ba OP)',
              calculation: 'Kwota VAT z faktury, gdyby wykonawca nie odprowadził jej do US',
              amountPln: '4 600,00 PLN',
            },
          ],
          finalResultPln: '4 780,00 PLN',
          interpretation:
            'Jeden niezweryfikowany przelew na prywatny rachunek ROR kosztował nabywcę pewne 4 780,00 PLN wyższego podatku i składki zdrowotnej (oraz ryzyko kolejnych 4 600,00 PLN w VAT). Wystarczyło sprawdzić rachunek w API Białej Listy, zapłacić przez MPP lub wysłać ZAW-NR w ciągu 7 dni!',
        },
        legalBasis: [
          {
            actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
            articleRef: 'art. 96b (Wykaz podatników VAT — Biała Lista)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Reguluje elektroniczny wykaz podmiotów zarejestrowanych jako podatnicy VAT wraz z ich rachunkami rozliczeniowymi.',
          },
          {
            actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
            articleRef:
              'art. 22p ust. 1 i ust. 4 (wyłączenie z KUP oraz zawiadomienie ZAW-NR w 7 dni)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Wyłącza z kosztów uzyskania przychodów płatności powyżej 15 000 zł dokonane na rachunek spoza Białej Listy oraz określa zwolnienie z sankcji przez ZAW-NR lub MPP.',
          },
          {
            actTitle: 'Ustawa z dnia 18 listopada 2020 r. o doręczeniach elektronicznych',
            articleRef: 'art. 9 oraz art. 42 (skutek doręczenia po 14 dniach)',
            sourceKind: 'statute',
            officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20200002320',
            verifiedAt: '2026-11-04',
            appliesSummary:
              'Nakłada na podmioty wpisane do KRS i CEIDG obowiązek posiadania adresu do doręczeń elektronicznych oraz wprowadza 14-dniową fikcję doręczenia.',
          },
        ],
        screenshotSlot: createScreenshotSlot(
          'm09-l03-weryfikacja-bialej-listy-i-ade',
          '/payments',
          'Status weryfikacji rachunku bankowego kontrahenta na Białej Liście podatników VAT (z identyfikatorem zapytania KAS) przed zatwierdzeniem płatności.',
          '[data-testid="whitelist-bank-verification-badge"]',
        ),
        practicalExercise: {
          title:
            'Sprawdź wynik weryfikacji rachunku kontrahenta na Białej Liście przed płatnością powyżej 15 000 PLN',
          demoCompanyId: 'demo_jdg_kpir_alfa',
          demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
          steps: [
            'Przejdź do sekcji „Płatności” w firmie Pracownia Projektowa Alfa.',
            'Wybierz oczekującą płatność powyżej 15 000,00 PLN brutto i sprawdź zielony status weryfikacji rachunku w wykazie KAS wraz z zachowanym ID zapytania.',
            'Przejdź do Ustawień podmiotu i sprawdź pole firmowego Adresu do Doręczeń Elektronicznych (`AE:PL-...`) oraz powiązany alert monitorowania skrzynki.',
          ],
          expectedOutcome:
            'Użytkownik wie, jak udowodnić dochowanie należytej staranności na Białej Liście oraz regularnie monitorować firmowe e-Doręczenia.',
        },
        commonMistakes: [
          {
            mistake:
              'Sprawdzenie rachunku kontrahenta na Białej Liście wyłącznie przy zakładaniu kartoteki miesiąc wcześniej, a nie w samym dniu zlecenia przelewu.',
            consequence:
              'Przepis wymaga obecności rachunku w wykazie **na dzień zlecenia przelewu** — jeśli kontrahent zamknął lub wykreślił rachunek w międzyczasie, wcześniejszy wydruk nie chroni przed sankcją.',
            howToAvoid:
              'Weryfikuj rachunek automatycznie w dniu zlecania przelewu i zachowuj elektroniczny identyfikator zapytania z API KAS.',
          },
          {
            mistake:
              'Płatność za trzy faktury po 6 000,00 PLN brutto wynikające z jednej umowy na 18 000,00 PLN na rachunek spoza Białej Listy („bo pojedyncza faktura ma mniej niż 15 000 zł”).',
            consequence:
              'Utrata KUP dla wszystkich trzech faktur — próg 15 000,00 PLN dotyczy jednorazowej wartości transakcji (umowy), bez względu na liczbę wynikających z niej płatności!',
            howToAvoid:
              'Przy umowach ciągłych lub wieloetapowych sumuj wartość całej umowy i od pierwszej transzy wymagaj rachunku z Białej Listy.',
          },
          {
            mistake:
              'Złożenie wniosku o e-Doręczenia w CEIDG bez późniejszego kliknięcia aktywacji skrzynki i bez podania aktualnego e-maila do powiadomień.',
            consequence:
              'Albo brak spełnienia ustawowego obowiązku aktywnego adresu w BAE, albo po aktywacji przegapienie pisma urzędowego objętego 14-dniową fikcją doręczenia.',
            howToAvoid:
              'Aktywuj skrzynkę ADE na biznes.gov.pl i skonfiguruj natychmiastowe powiadomienia e-mail do właściciela i księgowości.',
          },
        ],
        summary: [
          'Przy transakcjach powyżej 15 000,00 PLN brutto z czynnym podatnikiem VAT rachunek odbiorcy musi widnieć na Białej Liście w dniu zlecenia przelewu.',
          'W razie pomyłki sankcji utraty KUP można uniknąć, płacąc przez MPP albo składając zawiadomienie ZAW-NR w ciągu 7 dni od zlecenia przelewu.',
          'Firmowa skrzynka do e-Doręczeń jest obowiązkowa w KRS oraz w CEIDG (od 1.10.2026 dla wszystkich pozostałych JDG), a nieodebrane pismo uznaje się za doręczone po 14 dniach.',
        ],
        quiz: [
          {
            id: 'q-09-03-01',
            question:
              'Ile dni od dnia zlecenia przelewu ma podatnik na złożenie zawiadomienia ZAW-NR, aby uchronić się przed utratą kosztów KUP po omyłkowym przelaniu 20 000,00 PLN brutto na rachunek spoza Białej Listy (bez użycia MPP)?',
            options: [
              '3 dni robocze.',
              '7 dni od dnia zlecenia przelewu.',
              '30 dni od końca miesiąca.',
              'Do 30 kwietnia następnego roku.',
            ],
            correctOptionIndex: 1,
            explanation:
              'Zgodnie z art. 22p ust. 4 pkt 1 ustawy o PIT (oraz art. 117ba § 3 pkt 2 Ordynacji podatkowej) zawiadomienie ZAW-NR składa się w terminie 7 dni od dnia zlecenia przelewu.',
          },
          {
            id: 'q-09-03-02',
            question:
              'Po ilu dniach od wpłynięcia pisma urzędowego na firmową skrzynkę e-Doręczeń następuje ustawowy skutek doręczenia („fikcja doręczenia”), jeśli przedsiębiorca nie otworzy wiadomości?',
            options: [
              'Po 3 dniach.',
              'Po 7 dniach.',
              'Po upływie 14 dni od dnia wpłynięcia korespondencji na adres do doręczeń elektronicznych.',
              'Nigdy — dopóki przedsiębiorca nie kliknie wiadomości, termin nie biegnie.',
            ],
            correctOptionIndex: 2,
            explanation:
              'Art. 42 ust. 2 ustawy o doręczeniach elektronicznych przewiduje, że w przypadku nieodebrania korespondencji uznaje się ją za doręczoną po upływie 14 dni od dnia jej wpłynięcia na ADE.',
          },
        ],
      },
    ],
  },
];
