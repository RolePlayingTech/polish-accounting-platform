import { createScreenshotSlot, type AcademyModule } from './quiz.js';

export const MODULE_10: AcademyModule = {
  moduleNumber: 10,
  slug: 'rozrachunki-zatory-platnicze-bank-i-plynnosc',
  title: 'Moduł 10: Rozrachunki, ulga na złe długi, wyciągi bankowe i płynność',
  subtitle:
    'Kontroluj należności i zobowiązania, stosuj ulgę na złe długi po 90 dniach w VAT oraz PIT/CIT, uzgadniaj wyciągi CSV/MT940 i buduj bezpieczną rezerwę podatkową.',
  learningObjectives: [
    'Odróżniać należności od zobowiązań, czytać raport wiekowania rozrachunków i reagować na opóźnienia płatności.',
    'Prawidłowo stosować ulgę na złe długi po upływie 90 dni od terminu płatności w VAT (art. 89a/89b) oraz w PIT/CIT (art. 26i PIT / art. 18f CIT).',
    'Uzgadniać wyciągi bankowe w formatach CSV i MT940 (w tym przelewy MPP) oraz wyliczać bezpieczną rezerwę na podatki i ZUS.',
  ],
  lessons: [
    {
      id: 'lesson-10-01',
      slug: 'naleznosci-zobowiazania-wiek-rozrachunkow-i-monity',
      moduleNumber: 10,
      lessonNumber: 1,
      title: 'Należności, zobowiązania i wiekowanie rozrachunków w firmie',
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
          'Edukacja ogólna — kontrola rozrachunków z kontrahentami i urzędami dotyczy każdej firmy niezależnie od formy opodatkowania.',
      },
      intro:
        'Nawet rentowna na papierze firma może stracić płynność finansową, jeżeli klienci płacą z wielotygodniowym opóźnieniem, a terminy podatków i ZUS są nieprzesuwalne. Moduł rozrachunków porządkuje wszystkie otwarte faktury sprzedażowe i zakupowe, pokazując dokładnie, kto i od ilu dni zalega z płatnością.',
      sections: [
        {
          heading: 'Należności a zobowiązania handlowe i publicznoprawne',
          body: 'W języku księgowości należności to kwoty brutto, których zapłaty oczekujesz od swoich odbiorców z tytułu wystawionych faktur sprzedaży. Zobowiązania to z kolei kwoty, które Twoja firma musi zapłacić dostawcom (zobowiązania handlowe), pracownikom lub instytucjom takim jak urząd skarbowy i ZUS (zobowiązania publicznoprawne). Dopóki faktura nie zostanie w pełni sparowana z przelewem lub kompensatą, figuruje jako rozrachunek otwarty.',
          keyPoints: [
            'Rozrachunki śledzi się w kwotach brutto (z VAT), ponieważ dokładnie taką kwotę kontrahent przelewa na rachunek.',
            'Wpłata częściowa nie zamyka rozrachunku — zmniejsza jedynie pozostałe saldo do zapłaty.',
          ],
        },
        {
          heading: 'Wiekowanie rozrachunków (aging) i dyscyplina płatnicza B2B',
          body: 'Raport wiekowania dzieli niezapłacone faktury na przedziały przeterminowania: bieżące (przed terminem), 1–30 dni, 31–60 dni, 61–90 dni oraz powyżej 90 dni po terminie płatności. Przekroczenie kolejnych progów uruchamia konkretne działania: uprzejme przypomnienie po kilku dniach, formalne wezwanie do zapłaty z odsetkami ustawowymi za opóźnienie w transakcjach handlowych, a po 90 dniach — podatkową ulgę na złe długi.',
          keyPoints: [
            'Termin przeterminowania liczy się od dnia następującego po terminie płatności wskazanym na fakturze lub w umowie.',
            'W relacjach B2B wierzycielowi przysługują odsetki ustawowe za opóźnienie w transakcjach handlowych bez odrębnego wezwania.',
          ],
        },
      ],
      numericalExample: {
        title: 'Ustalenie salda przeterminowanych należności po wpłacie częściowej',
        scenario:
          'Syntetyczna Pracownia Projektowa Test Sp. z o.o. (dane syntetyczne) wystawiła w marcu 2026 r. dwie faktury: FV/03/01 na 18 450,00 PLN brutto (termin 20 marca) oraz FV/03/02 na 12 300,00 PLN brutto (termin 15 kwietnia). Dnia 28 marca klient od FV/03/01 przelał zaliczkowo tylko 8 450,00 PLN. Sprawdzamy stan należności na dzień 31 marca 2026 r.',
        steps: [
          {
            stepNumber: 1,
            label: 'Suma należności brutto z wystawionych faktur',
            calculation: '18 450,00 PLN + 12 300,00 PLN',
            amountPln: '30 750,00 PLN',
          },
          {
            stepNumber: 2,
            label: 'Pomniejszenie o zaksięgowaną wpłatę częściową do FV/03/01',
            calculation: '30 750,00 PLN - 8 450,00 PLN',
            amountPln: '22 300,00 PLN',
          },
          {
            stepNumber: 3,
            label: 'Wyodrębnienie należności przeterminowanej (koszyk 1–30 dni po terminie)',
            calculation: '18 450,00 PLN - 8 450,00 PLN (FV/03/02 jest jeszcze przed terminem)',
            amountPln: '10 000,00 PLN',
          },
        ],
        finalResultPln: '10 000,00 PLN',
        interpretation:
          'Na koniec marca spółka ma łącznie 22 300,00 PLN otwartych należności, z czego 10 000,00 PLN jest już przeterminowane o 11 dni i kwalifikuje się do wysyłki przypomnienia o płatności.',
      },
      legalBasis: [
        {
          actTitle:
            'Ustawa z dnia 8 marca 2013 r. o przeciwdziałaniu nadmiernym opóźnieniom w transakcjach handlowych',
          articleRef: 'art. 7 ust. 1 oraz art. 10 ust. 1',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20130000403',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Określa prawo wierzyciela B2B do odsetek ustawowych za opóźnienie w transakcjach handlowych oraz rekompensaty za koszty odzyskiwania należności.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm10-l01-tabela-wiekowania-rozrachunkow',
        '/payments',
        'Widok wiekowania należności i zobowiązań z podziałem na przedziały przeterminowania (1–30, 31–60, 61–90, >90 dni).',
        '[data-testid="receivables-aging-table"]',
      ),
      practicalExercise: {
        title: 'Przegląd przeterminowanych faktur i przygotowanie przypomnienia',
        demoCompanyId: 'demo_spzoo_gamma',
        demoCompanyName: 'Manufaktura Technologiczna Gamma sp. z o.o. (dane syntetyczne)',
        steps: [
          'Otwórz zakładkę Rozrachunki i płatności dla spółki demonstracyjnej i włącz filtr „Przeterminowane należności”.',
          'Sprawdź rozbicie faktury częściowo opłaconej na kwotę pierwotną, kwotę rozliczoną oraz saldo pozostałe do zapłaty.',
          'Wygeneruj szkic przypomnienia o zapłacie i zweryfikuj, że aplikacja wymaga ręcznego zatwierdzenia przed wysyłką e-mail.',
        ],
        expectedOutcome:
          'Użytkownik poprawnie odczytuje koszyki wiekowania rozrachunków i potrafi odróżnić należność niewymagalną od przeterminowanej.',
      },
      commonMistakes: [
        {
          mistake: 'Śledzenie rozrachunków w kwotach netto zamiast brutto.',
          consequence: 'Pozorne niedopłaty w wysokości podatku VAT na każdej fakturze.',
          howToAvoid:
            'Zawsze uzgadniaj rozrachunki z wyciągiem bankowym w kwotach brutto dokumentu.',
        },
        {
          mistake:
            'Oznaczanie całej faktury jako opłaconej po otrzymaniu jedynie zaliczki lub części przelewu.',
          consequence:
            'Utrata kontroli nad brakującą resztą należności i brak alertu windykacyjnego.',
          howToAvoid:
            'Korzystaj z rozliczeń częściowych, które pozostawiają otwarte saldo różnicy.',
        },
        {
          mistake: 'Mylenie daty wystawienia faktury z datą wymagalności (terminem płatności).',
          consequence:
            'Przedwczesne wysyłanie wezwań do zapłaty albo błędne liczenie 90 dni do ulgi na złe długi.',
          howToAvoid:
            'Sprawdzaj kolumnę „Termin płatności” — dopiero dzień po nim rozpoczyna bieg opóźnienia.',
        },
      ],
      summary: [
        'Należności to kwoty brutto należne od klientów, a zobowiązania to długi firmy wobec dostawców, ZUS i US.',
        'Wiekowanie rozrachunków porządkuje zaległości w przedziałach czasowych i chroni płynność firmy.',
        'Odliczanie dni opóźnienia zawsze startuje dzień po upływie terminu płatności z faktury lub umowy.',
      ],
      quiz: [
        {
          id: 'q-10-01-01',
          question:
            'Od którego momentu liczy się dni przeterminowania należności w raporcie wiekowania rozrachunków?',
          options: [
            'Od daty wystawienia faktury w systemie KSeF',
            'Od daty wykonania usługi wskazanej na protokole odbioru',
            'Od dnia następującego po upływie terminu płatności określonego na fakturze lub w umowie',
            'Od ostatniego dnia miesiąca, w którym złożono plik JPK_V7M',
          ],
          correctOptionIndex: 2,
          explanation:
            'Dopóki nie minie termin płatności uzgodniony na fakturze lub w umowie, należność jest bieżąca (niewymagalna). Opóźnienie biegnie od dnia następnego po terminie płatności.',
        },
        {
          id: 'q-10-01-02',
          question:
            'Klient opłacił 4 000,00 PLN z faktury opiewającej na 12 300,00 PLN brutto (10 000,00 PLN netto). Jakie saldo otwartej należności pozostaje w rozrachunkach?',
          options: ['6 000,00 PLN', '8 300,00 PLN', '10 000,00 PLN', '0,00 PLN'],
          correctOptionIndex: 1,
          explanation:
            'Rozrachunki prowadzone są w kwotach brutto: 12 300,00 PLN minus wpłacone 4 000,00 PLN pozostawia 8 300,00 PLN otwartej należności.',
        },
      ],
    },
    {
      id: 'lesson-10-02',
      slug: 'ulga-na-zle-dlugi-90-dni-vat-pit-cit',
      moduleNumber: 10,
      lessonNumber: 2,
      title: 'Ulga na złe długi po 90 dniach w VAT (art. 89a/89b) oraz PIT i CIT',
      estimatedMinutes: 16,
      audienceScope: {
        type: 'profile_specific',
        applicableProfiles: [
          'jdg_kpir_skala',
          'jdg_kpir_liniowy',
          'jdg_ryczalt',
          'spolka_cywilna_kpir',
          'sp_zoo_pelne_ksiegi_cit_klasyczny',
          'vat_czynny',
        ],
        scopeNote:
          'Zasady szczegółowe: część VAT dotyczy czynnych podatników VAT (art. 89a i 89b), a część dochodowa podatników PIT/CIT/ryczałtu (art. 26i PIT, art. 18f CIT, art. 11 ust. 4 ustawy o ryczałcie); informacja edukacyjna, nie stanowi doradztwa podatkowego.',
      },
      intro:
        'Gdy kontrahent nie płaci przez wiele miesięcy, przedsiębiorca bez podjęcia działań sfinansowałby z własnej kieszeni zarówno podatek VAT należny, jak i podatek dochodowy od nieotrzymanych pieniędzy. Polska ulga na złe długi pozwala po upływie 90 dni od terminu płatności odzyskać VAT oraz zmniejszyć podstawę opodatkowania PIT/CIT — a na niesolidnego dłużnika nakłada symetryczny obowiązek dopłaty podatku.',
      sections: [
        {
          heading: 'Asymetria praw i obowiązków: prawo wierzyciela, obowiązek dłużnika',
          body: 'Uprawdopodobnienie nieściągalności następuje, gdy wierzytelność nie została uregulowana ani zbyta w ciągu 90 dni od dnia upływu terminu płatności określonego na fakturze lub w umowie. Po stronie sprzedawcy (wierzyciela) ulga jest prawem: na podstawie art. 89a ustawy o VAT może pomniejszyć podatek należny w JPK_V7, a na podstawie art. 26i PIT (lub art. 18f CIT) — pomniejszyć podstawę obliczenia zaliczki na podatek dochodowy o wartość netto. Po stronie nabywcy (dłużnika) korekta jest bezwzględnym obowiązkiem ustawowym: zgodnie z art. 89b VAT musi on oddać odliczony wcześniej VAT naliczony i doliczyć niezapłacony koszt z powrotem do dochodu!',
          keyPoints: [
            'Wierzyciel ma prawo skorzystać z ulgi (o ile od końca roku wystawienia faktury nie minęły 3 lata w VAT / 2 lata w PIT i CIT).',
            'Dłużnik ma ustawowy obowiązek korekty w rozliczeniu za okres, w którym minął 90. dzień — niezależnie od tego, czy wierzyciel skorzystał z ulgi.',
          ],
        },
        {
          heading: 'Warunki formalne i późniejsze uregulowanie zaległości',
          body: 'W podatku VAT wierzyciel musi pozostawać czynnym podatnikiem VAT na dzień poprzedzający złożenie JPK_V7 z korektą. W PIT/CIT dłużnik nie może być w trakcie postępowania restrukturyzacyjnego, upadłościowego ani w likwidacji. Ważne: w PKPiR ulga na złe długi nie polega na wykreśleniu faktury z kolumny przychodów lub kosztów, lecz na korekcie podstawy opodatkowania przy obliczaniu zaliczki i w zeznaniu rocznym. Jeżeli dłużnik spłaci dług po zastosowaniu ulgi, w okresie otrzymania zapłaty wierzyciel ponownie wykazuje VAT należny i dolicza kwotę netto do dochodu, a dłużnik odzyskuje prawo do VAT i kosztu.',
          keyPoints: [
            'Ulga w PIT/CIT działa na poziomie podstawy zaliczki i zeznania rocznego — zapis w samej tabeli PKPiR pozostaje nienaruszony.',
            'Późniejsza zapłata (w całości lub w części) wymaga proporcjonalnego odwrócenia korekty w miesiącu otrzymania przelewu.',
          ],
        },
      ],
      numericalExample: {
        title: 'Odzyskanie VAT i obniżenie zaliczki PIT liniowego (19%) po 90 dniach',
        scenario:
          'Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne), czynny podatnik VAT na podatku liniowym 19%, wystawił fakturę na 10 000,00 PLN netto + 2 300,00 PLN VAT (12 300,00 PLN brutto) z terminem płatności 15 stycznia 2026 r. Do końca kwietnia 2026 r. klient nie zapłacił ani złotówki (90. dzień od 15 stycznia upłynął 15 kwietnia 2026 r.). Obliczamy łączną ochronę płynności w rozliczeniu za kwiecień.',
        steps: [
          {
            stepNumber: 1,
            label: 'Korekta in minus podatku VAT należnego w JPK_V7M za kwiecień (art. 89a VAT)',
            calculation: '100% × 2 300,00 PLN nieuregulowanego VAT',
            amountPln: '2 300,00 PLN',
          },
          {
            stepNumber: 2,
            label:
              'Zmniejszenie zaliczki na podatek liniowy PIT za kwiecień (art. 26i i art. 44 ust. 17 PIT)',
            calculation: '10 000,00 PLN netto × 19%',
            amountPln: '1 900,00 PLN',
          },
          {
            stepNumber: 3,
            label: 'Łączne zmniejszenie obciążeń podatkowych wierzyciela za kwiecień 2026 r.',
            calculation: '2 300,00 PLN (VAT) + 1 900,00 PLN (PIT)',
            amountPln: '4 200,00 PLN',
          },
        ],
        finalResultPln: '4 200,00 PLN',
        interpretation:
          'Dzięki uldze na złe długi Jan Testowy odzyskuje w rozliczeniu kwietniowym 4 200,00 PLN żywej gotówki (2 300,00 PLN w VAT oraz 1 900,00 PLN mniejszej zaliczki PIT). Jeżeli klient zapłaci np. w czerwcu, podatek zostanie ponownie rozliczony w czerwcu.',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 11 marca 2004 r. o podatku od towarów i usług',
          articleRef: 'art. 89a oraz art. 89b',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20040540535',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Reguluje prawo wierzyciela do korekty VAT należnego (art. 89a) oraz obowiązek dłużnika do korekty VAT naliczonego (art. 89b) po upływie 90 dni od terminu płatności.',
        },
        {
          actTitle: 'Ustawa z dnia 26 lipca 1991 r. o podatku dochodowym od osób fizycznych',
          articleRef: 'art. 26i oraz art. 44 ust. 17–24',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19910800350',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Umożliwia wierzycielowi zmniejszenie podstawy opodatkowania PIT (już na etapie zaliczek), a na dłużnika nakłada obowiązek jej zwiększenia po 90 dniach braku zapłaty.',
        },
        {
          actTitle: 'Ustawa z dnia 15 lutego 1992 r. o podatku dochodowym od osób prawnych',
          articleRef: 'art. 18f oraz art. 25 ust. 19–26',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19920210086',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Odpowiednik ulgi na złe długi po 90 dniach dla podatników CIT klasycznego.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm10-l02-kwalifikator-ulgi-na-zle-dlugi-90-dni',
        '/taxes',
        'Panel kwalifikacji faktur przeterminowanych powyżej 90 dni do ulgi na złe długi w JPK_V7M oraz zaliczce PIT/CIT.',
        '[data-testid="bad-debt-relief-90d-panel"]',
      ),
      practicalExercise: {
        title: 'Weryfikacja 90. dnia przeterminowania dla wierzyciela i dłużnika',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'Przejdź do widoku Podatki -> Ulga na złe długi (90 dni) dla firmy demonstracyjnej JDG KPiR.',
          'Otwórz ślad obliczeniowy („Dlaczego?”) przy przeterminowanej fakturze sprzedaży i sprawdź dokładną datę upływu 90. dnia od terminu płatności.',
          'Sprawdź sekcję zobowiązań kosztowych i zobacz ostrzeżenie systemowe o obowiązkowej korekcie z art. 89b VAT w razie nieopłacenia faktury zakupowej.',
        ],
        expectedOutcome:
          'Użytkownik rozumie asymetrię między dobrowolną ulgą wierzyciela a obowiązkową korektą dłużnika oraz wie, że PKPiR nie jest przy tym wymazywana.',
      },
      commonMistakes: [
        {
          mistake:
            'Ignorowanie nieopłaconych faktur kosztowych po stronie dłużnika po upływie 90 dni.',
          consequence:
            'Zaniżenie zobowiązania w VAT (art. 89b) i zaliczki PIT/CIT wraz z odsetkami podatkowymi.',
          howToAvoid:
            'Monitoruj alerty 90 dni również dla własnych zobowiązań zakupowych, nie tylko należności.',
        },
        {
          mistake:
            'Usuwanie niezapłaconej faktury bezpośrednio z kolumny przychodów lub wydatków PKPiR (kol. 9 / 15 od 2026 r., dawna kol. 7 / 13).',
          consequence:
            'Nierzetelność księgi podatkowej — ulga rozliczana jest poza zapisami PKPiR.',
          howToAvoid:
            'Pozostaw zapis w PKPiR bez zmian i wykaż odliczenie w kalkulacji zaliczki oraz załączniku PIT/WZ.',
        },
        {
          mistake:
            'Brak ponownego opodatkowania po otrzymaniu spóźnionego przelewu od kontrahenta.',
          consequence: 'Zaległość podatkowa w okresie faktycznego wpływu środków na rachunek.',
          howToAvoid:
            'Paruj każdy wpływ z wyciągu bankowego z rozrachunkiem, aby system wykrył konieczność odwrócenia ulgi.',
        },
      ],
      summary: [
        'Próg 90 dni liczy się od dnia następującego po terminie płatności wskazanym na fakturze lub w umowie.',
        'Dla wierzyciela ulga na złe długi jest prawem (art. 89a VAT, art. 26i PIT, art. 18f CIT), natomiast dla dłużnika korekta jest obowiązkiem (art. 89b VAT).',
        'Gdy dłużnik zapłaci po dokonaniu korekty, obie strony odwracają skutki ulgi w okresie zapłaty.',
      ],
      quiz: [
        {
          id: 'q-10-02-01',
          question:
            'Nabywca (czynny podatnik VAT) odliczył VAT z faktury kosztowej i zaliczył ją do KUP, ale nie opłacił jej przez ponad 90 dni od terminu płatności. Co musi zrobić?',
          options: [
            'Nic, dopóki sprzedawca nie wystawi mu faktury korygującej w KSeF',
            'Ma ustawowy obowiązek skorygować odliczony VAT naliczony (art. 89b VAT) oraz zwiększyć podstawę opodatkowania PIT/CIT',
            'Musi wykreślić fakturę korektorem z tabeli PKPiR z datą wsteczną',
            'Ma wybór — korekta u dłużnika jest całkowicie dobrowolna',
          ],
          correctOptionIndex: 1,
          explanation:
            'Zgodnie z art. 89b ustawy o VAT oraz art. 26i PIT / art. 18f CIT dłużnik ma bezwzględny obowiązek skorygowania VAT naliczonego i podstawy opodatkowania w okresie, w którym upłynął 90. dzień od terminu płatności.',
        },
        {
          id: 'q-10-02-02',
          question:
            'Jak ulgę na złe długi w podatku dochodowym (art. 26i PIT) ujmuje wierzyciel prowadzący PKPiR?',
          options: [
            'Usuwa pierwotną fakturę sprzedaży z kolumny przychodów PKPiR (kol. 9 od 2026 r., dawna kol. 7)',
            'Wpisuje ujemny koszt w kolumnie pozostałych wydatków PKPiR (kol. 15 od 2026 r., dawna kol. 13)',
            'Nie zmienia zapisu w PKPiR, lecz pomniejsza podstawę obliczenia zaliczki PIT i wykazuje korektę w zeznaniu rocznym',
            'Wystawia w KSeF fakturę korygującą do zera z przyczyną braku zapłaty',
          ],
          correctOptionIndex: 2,
          explanation:
            'Brak zapłaty nie unieważnia sprzedaży ani nie daje prawa do zerowania faktury korygującej — ulga na złe długi w PIT pomniejsza dochód do opodatkowania na etapie wyliczenia zaliczki i w załączniku rocznym.',
        },
      ],
    },
    {
      id: 'lesson-10-03',
      slug: 'uzgadnianie-wyciagow-bankowych-csv-mt940-i-rezerwa-podatkowa',
      moduleNumber: 10,
      lessonNumber: 3,
      title: 'Uzgadnianie wyciągów bankowych CSV/MT940, subkonto VAT i rezerwa podatkowa',
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
          'Edukacja ogólna — uzgadnianie wyciągów bankowych dotyczy każdej firmy (w pełnych księgach stanowi również podstawę dekretacji konta 130/131), a budowa rezerwy podatkowej jest dobrą praktyką zarządzania płynnością.',
      },
      intro:
        'Ręczne odznaczanie dziesiątek przelewów prowadzi do pomyłek, dlatego w codziennej pracy księgowej importuje się ustrukturyzowane wyciągi bankowe w plikach CSV lub standardzie bankowym MT940. Równie ważne jak samo parowanie płatności jest zrozumienie, jaka część salda na rachunku to środki „zamrożone” na subkoncie VAT albo należne urzędowi skarbowemu i ZUS.',
      sections: [
        {
          heading: 'Import wyciągów CSV i MT940 oraz parowanie operacji',
          body: 'Plik MT940 (międzynarodowy standard komunikatów bankowych SWIFT) oraz eksporty CSV z polskich banków zawierają saldo początkowe, kompletną listę uznań i obciążeń wraz z rachunkiem IBAN kontrahenta, tytułem przelewu i datą księgowania oraz saldo końcowe. Silnik dopasowujący proponuje powiązanie przelewu z otwartym rozrachunkiem na podstawie numeru faktury lub numeru KSeF w tytule, NIP/IBAN kontrahenta i kwoty, ale nietypowe operacje (np. jeden przelew za trzy faktury, prowizje bankowe lub płatność z konta prywatnego wspólnika) zawsze wymagają weryfikacji człowieka.',
          keyPoints: [
            'Zawsze sprawdzaj zgodność salda początkowego i końcowego wyciągu z poprzednim zaimportowanym okresem, aby nie pominąć żadnego dnia.',
            'Prowizje za prowadzenie rachunku w JDG na KPiR można ująć w kosztach na podstawie samego wyciągu bankowego (dowód równoważny).',
          ],
        },
        {
          heading: 'Rachunek VAT (MPP) oraz zasada „Rezerwy podatkowej”',
          body: 'Każdy firmowy rachunek rozliczeniowy posiada powiązany, bezpłatny rachunek VAT do obsługi mechanizmu podzielonej płatności (Split Payment / MPP). Środki zgromadzone na rachunku VAT należą do firmy, lecz mają ograniczoną dyspozycyjność: zapłacisz z nich VAT na fakturach dostawców (przelewem MPP), VAT do urzędu skarbowego, a także PIT, CIT, ZUS i cło — ale nie wypłacisz ich kartą w bankomacie bez zgody naczelnika US. Dobra praktyka finansowa nakazuje ponadto po każdym wpływie odkładać równowartość VAT należnego, szacowanego PIT/CIT i ZUS na osobne subkonto oszczędnościowe.',
          keyPoints: [
            'Środki na rachunku VAT (MPP) można przeznaczyć nie tylko na VAT, lecz także na przelewy PIT, CIT i składek ZUS.',
            'Wydawanie kwot brutto z bieżącego konta to najczęstsza przyczyna stresu płatniczego 20. i 25. dnia kolejnego miesiąca.',
          ],
        },
      ],
      numericalExample: {
        title: 'Obliczenie wolnej gotówki po odłożeniu rezerwy podatkowo-składkowej',
        scenario:
          'Jan Testowy — Projektowanie Syntetyczne (dane syntetyczne), opodatkowany skalą podatkową (12% w pierwszym progu) i czynny podatnik VAT, wystawił i otrzymał w maju 2026 r. przelewy na 24 600,00 PLN brutto (20 000,00 PLN netto + 4 600,00 PLN VAT). Opłacił koszty firmowe 4 920,00 PLN brutto (4 000,00 PLN netto + 920,00 PLN VAT) i ma do zapłaty 2 400,00 PLN łącznych składek ZUS (w tym społeczne 1 600,00 PLN i zdrowotna 800,00 PLN, przyjęte poglądowo do kalkulacji rezerwy; bez uwzględniania kwoty zmniejszającej podatek dla bezpiecznego bufora). Ile wynosi bezpieczna rezerwa na czerwcowe terminy urzędowe?',
        steps: [
          {
            stepNumber: 1,
            label: 'Rezerwa na podatek VAT do urzędu skarbowego (do 25 czerwca)',
            calculation: '4 600,00 PLN (VAT należny) - 920,00 PLN (VAT naliczony)',
            amountPln: '3 680,00 PLN',
          },
          {
            stepNumber: 2,
            label: 'Rezerwa na składki ZUS (do 20 czerwca) oraz bezpieczny bufor zaliczki PIT 12%',
            calculation:
              '2 400,00 PLN (ZUS) + ((20 000,00 - 4 000,00 - 1 600,00) × 12% ≈ 1 728,00 PLN)',
            amountPln: '4 128,00 PLN',
          },
          {
            stepNumber: 3,
            label: 'Łączna kwota rezerwy do przelania na subkonto podatkowe',
            calculation: '3 680,00 PLN (VAT) + 4 128,00 PLN (ZUS + bufor PIT)',
            amountPln: '7 808,00 PLN',
          },
        ],
        finalResultPln: '7 808,00 PLN',
        interpretation:
          'Choć po opłaceniu faktur kosztowych na koncie Jana zostało 19 680,00 PLN (24 600,00 − 4 920,00), aż 7 808,00 PLN należy odłożyć na ZUS, PIT i VAT — realna wolna gotówka właściciela wynosi 11 872,00 PLN.',
      },
      legalBasis: [
        {
          actTitle: 'Ustawa z dnia 29 sierpnia 1997 r. — Prawo bankowe',
          articleRef: 'art. 62a–62f (rachunek VAT)',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19971400939',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Określa zasady otwierania rachunku VAT do rachunku rozliczeniowego oraz zamknięty katalog podatków i składek ZUS, które można z niego opłacać.',
        },
        {
          actTitle: 'Ustawa z dnia 6 marca 2018 r. — Prawo przedsiębiorców',
          articleRef: 'art. 19',
          sourceKind: 'statute',
          officialUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20180000646',
          verifiedAt: '2026-11-04',
          appliesSummary:
            'Ustanawia obowiązek rozliczeń za pośrednictwem rachunku płatniczego w transakcjach B2B przekraczających 15 000 PLN brutto.',
        },
      ],
      screenshotSlot: createScreenshotSlot(
        'm10-l03-import-wyciagu-csv-mt940-i-rezerwa',
        '/payments',
        'Widok uzgadniania zaimportowanego wyciągu bankowego MT940/CSV z propozycjami sparowania rozrachunków oraz widżetem Rezerwy podatkowej.',
        '[data-testid="bank-statement-reconciliation-view"]',
      ),
      practicalExercise: {
        title: 'Import syntetycznego wyciągu CSV i sparowanie przelewu zbiorczego',
        demoCompanyId: 'demo_jdg_kpir_alfa',
        demoCompanyName: 'Pracownia Projektowa Alfa — Jan Kowalski (dane syntetyczne)',
        steps: [
          'W module Płatności wybierz „Importuj wyciąg bankowy (CSV / MT940)” i wczytaj syntetyczny plik demonstracyjny za maj 2026 r.',
          'Zweryfikuj zgodność salda otwarcia i zamknięcia wyciągu oraz zatwierdź dopasowanie przelewu zbiorczego do dwóch faktur sprzedaży.',
          'Sprawdź na pulpicie zaktualizowaną kwotę „Bezpieczna rezerwa na podatki i ZUS” oddzieloną od wolnych środków.',
        ],
        expectedOutcome:
          'Wszystkie pozycje wyciągu mają przypisany status rozliczenia, a przedsiębiorca widzi realną kwotę wolnej gotówki po odjęciu przyszłych zobowiązań publicznoprawnych.',
      },
      commonMistakes: [
        {
          mistake:
            'Importowanie nakładających się zakresów dat z pliku CSV bez kontroli duplikatów.',
          consequence:
            'Podwójne rozliczenie tej samej wpłaty i sztuczna nadpłata na karcie kontrahenta.',
          howToAvoid:
            'Importuj pełne wyciągi miesięczne lub korzystaj z kontroli ciągłości numerów i sald wyciągów.',
        },
        {
          mistake:
            'Przekonanie, że środki z rachunku VAT (MPP) mogą służyć wyłącznie do zapłaty podatku VAT.',
          consequence:
            'Niepotrzebne zamrożenie gotówki, podczas gdy z subkonta VAT bank automatycznie pokryje też PIT, CIT i ZUS.',
          howToAvoid:
            'Pamiętaj, że przelewy podatkowe do US i składkowe do ZUS w pierwszej kolejności schodzą z rachunku VAT.',
        },
        {
          mistake:
            'Traktowanie pełnego salda rachunku bieżącego jako zysku dostępnego do wypłaty prywatnej.',
          consequence:
            'Brak środków na zapłatę ZUS (20. dzień) i VAT/PIT (20./25. dzień) w kolejnym miesiącu.',
          howToAvoid:
            'Utrzymuj oddzielne subkonto rezerwy podatkowej zasilane po każdym opłaconym zleceniu.',
        },
      ],
      summary: [
        'Ustrukturyzowane wyciągi CSV i MT940 przyspieszają rozliczanie faktur, lecz nietypowe przelewy zawsze zatwierdza człowiek.',
        'Środki zgromadzone na rachunku VAT (MPP) mogą być wykorzystane do zapłaty VAT dostawcom oraz VAT, PIT, CIT i ZUS do urzędów.',
        'Oddzielanie rezerwy podatkowo-składkowej od bieżącego salda chroni firmę przed utratą płynności.',
      ],
      quiz: [
        {
          id: 'q-10-03-01',
          question:
            'Jakie zobowiązania publicznoprawne (oprócz podatku VAT) można opłacić środkami zgromadzonymi na firmowym rachunku VAT (MPP)?',
          options: [
            'Żadne inne — subkonto VAT służy wyłącznie do rozliczeń podatku od towarów i usług',
            'Podatek dochodowy PIT, podatek dochodowy CIT, składki ZUS oraz należności celne',
            'Wyłącznie podatek od nieruchomości do gminy oraz abonament RTV',
            'Dowolne raty leasingowe oraz rachunki za energię elektryczną w przelewie zwykłym',
          ],
          correctOptionIndex: 1,
          explanation:
            'Zgodnie z art. 62b Prawa bankowego środki z rachunku VAT mogą być przeznaczane nie tylko na VAT (w MPP i do US), ale także m.in. na PIT, CIT, akcyzę, cło oraz składki ZUS.',
        },
        {
          id: 'q-10-03-02',
          question:
            'Co należy bezwzględnie sprawdzić bezpośrednio po zaimportowaniu pliku wyciągu MT940 lub CSV?',
          options: [
            'Czy bank użył czcionki szeryfowej na wydruku PDF',
            'Zgodność salda początkowego z saldem końcowym poprzedniego wyciągu oraz poprawność propozycji sparowania przelewów',
            'Czy wszystkie przelewy przychodzące miały tytuł pisany wielkimi literami',
            'Wyłącznie sumę prowizji bankowych, pomijając wpłaty od kontrahentów',
          ],
          correctOptionIndex: 1,
          explanation:
            'Ciągłość salda początkowego i końcowego gwarantuje, że nie pominięto ani nie zduplikowano żadnego dnia operacyjnego, a przegląd propozycji eliminuje błędne dopasowania.',
        },
      ],
    },
  ],
};
