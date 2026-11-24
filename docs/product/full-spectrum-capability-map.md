# PAP — pełna mapa funkcjonalności produktu (product capability map)

> **Wykonanie najbliższej dużej iteracji:** [#124](https://github.com/RolePlayingTech/polish-accounting-platform/issues/124) i [runbook dla Swarm](../agents/swarm-mission-end-to-end-accounting-2026-11-23.md). Ambitny, ale ograniczony do _zweryfikowanych_ profili i oficjalnych testów KSeF/JPK; ta mapa pozostaje długofalowym katalogiem, nie checklistą do odhaczenia podczas jednego uruchomienia.

**Stan:** strategiczny katalog i kontrakt rozwoju, nie deklaracja implementacji · **ostatni przegląd:** 2026-11-24 · [Epic #123](https://github.com/RolePlayingTech/polish-accounting-platform/issues/123) · [żywy rejestr capability i bramek (`#124` / `#100`)](capability-and-gate-registry.md) · [harness](../agents/next-iteration-2026-11-23.md) · [architektura](../architecture/modularity-and-saas-growth.md). Priorytety mogą być przestawiane po analizie użytkowników, prawa i zależności. Nie duplikować jako kilkudziesięciu pustych Issues.

## 1. Wizja i zasady produktu

Polish Accounting Platform = **pełny polski system księgowości, finansów i współpracy z księgową, sterowalny tak samo przez interfejs, API i MCP**. Pierwszy użytkownik = właściciel pojedynczej lub kilku własnych firm. W przyszłości: JDG, spółki osobowe i kapitałowe, organizacje prowadzące księgi, zespoły księgowe i biura rachunkowe oraz tysiące odizolowanych klientów płatnego SaaS.

Nie obiecujemy, że **każdy** reżim prawny lub branża jest zaimplementowana. Wszystkie wymienione możliwości są **celem / kandydatem**. Każda ma otrzymać status per profil, wersja prawa i okres: `planned` → `experimental` → `implemented` → `verified` → opcjonalnie `deprecated`/ `suspended`. Status `verified` wymaga testów od końca do końca, wzorców urzędowych tam, gdzie stosowne, i podpisanego odbioru księgowego. Nigdy nie wyświetlać w produkcji pozornej funkcji.

**Najważniejszy invariants:** dokument lub inne zdarzenie gospodarcze ma **jedną tożsamość i pochodzenie**, prowadzi do wielu uzasadnionych, powiązanych zapisów. Podatki, rozrachunki, księgi, raporty i deklaracje powstają z tego samego utrwalonego źródła i rozliczenia okresu. Bez podwójnych księgowań, utraty pozycji, zgadywania stawki, nadpisania przeszłości, ukrytych „demo sukcesów”.

## 2. Matryca wymiarów (nie kodować jednego profilu na sztywno)

| Wymiar                   | Przykładowe warianty i pułapki                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Forma / osobowość prawna | JDG, spółka cywilna, jawna, komandytowa, z o.o., akcyjna, inne; zastosowanie zależy od rzeczywistych obowiązków i okresu           |
| Reżim rachunkowości      | KPiR, ewidencja przychodów, pełne księgi UoR, szczególne reżimy jako osobne rozszerzenia                                           |
| Podatek dochodowy        | PIT skala/liniowy/ryczałt, CIT 9%/19% (gdy uprawnione), inne warianty po walidacji                                                 |
| VAT                      | czynny/zwolniony, miesięczny/kwartalny, sprzedaż krajowa/zagraniczna, OSS/IOSS, specjalne procedury jeśli mają zweryfikowany moduł |
| Zatrudnienie i obowiązki | bez pracowników, zleceniobiorcy, pracownicy, płatnik składek, kadry i płace                                                        |
| Operacje i skala         | usługi, handel, magazyn, produkcja, e-commerce, wiele walut, wiele oddziałów, wiele spółek                                         |
| Osoba korzystająca       | właściciel, pracownik, księgowa, reviewer, audytor, operator SaaS; odrębne uprawnienia                                             |
| Jurysdykcja i czas       | Polska + okres obowiązywania prawa; transakcja zagraniczna nie oznacza automatycznej zgodności podatkowej w innym kraju            |
| Dojrzałość funkcji       | planned / experimental / implemented / verified, z dowodami, wersją struktury i ograniczeniami                                     |

**Profil firmy jest konfiguracją capability + legal-regime + tax-year + grants**, a nie globalnym przełącznikiem wyświetlającym naraz trzy niezgodne księgi. Dla zmiany reżimu w trakcie działalności wymagany jest kontrolowany, historyczny workflow. Księgowa może pracować dla wielu firm w różnych tenantach, ale nie widzi innych danych bez ich odrębnych grantów.

## 3. Katalog modułów i docelowych funkcji

Legenda horyzontów: **H0** = poprawność, obecne błędy i testy; **H1** = pierwszy w pełni zweryfikowany przepływ własnej JDG; **H2** = rozszerzenia polskiej księgowości i biura rachunkowego; **H3** = zaawansowana funkcjonalność i SaaS scale. Horyzont ≠ obietnica terminu; testy i zewnętrzne integracje mogą przestawić kolejność.

### A. Fundament firmy, współpraca i tożsamość (H0→H3)

- Wiele firm i organizacji, poprawny profil, historia zmian danych, NIP/REGON/KRS w źródłach (weryfikacja uprawnień/danych, bez fabrykowania odpowiedzi), kontrahenci, adresy, jednostki organizacyjne, rachunki bankowe.
- Zaproszenia OIDC, MFA, sesje i urządzenia, role/granty per firma i operacja, czasowe uprawnienia, delegacja, audyt dostępu, bezpieczny eksport i usunięcie w ramach obowiązków.
- Dokumentacja profilu: forma, reżim księgowy, VAT, kalendarz podatkowy, bieżący okres, zakres aktywnych funkcji; nieaktywne widoki ukryte lub jasno wytłumaczone.
- **Nie** łączyć roli operatora infrastruktury, właściciela firmy, księgowego, doradcy podatkowego ani administratora SaaS; ADR-003, #97.

### B. Fakturowanie przychodowe i zakupowe (H1→H2)

- Faktura krajowa B2B/B2C/B2G (w zakresie potwierdzonych obowiązków), proforma, zaliczkowa, końcowa, korekta, duplikat/ponowne udostępnienie, cykliczna; pozycje, rabaty, jednostki, różne stawki i znaczniki VAT, numeracja, waluty/zaokrąglenia.
- Klienci, cenniki, szablony i branding dokumentów, wysyłka e-mail/PDF (po zgodzie na dostarczenie i ochronie danych), przypomnienia, status dostarczenia i płatności.
- Zakupy: otrzymane faktury, koszty, kwalifikacja, załączniki, terminy, alokacja między firmami/projektami, korekty, obieg akceptacji.
- Faktura z wielu wierszy przechodzi bez utraty szczegółów do VAT/KPiR/GL/JPK (#106), jedna tożsamość faktury i wiele odrębnych widoków bez duplikatów (#110).

### C. KSeF i e-fakturowanie (H1→H2)

- Dwa kierunki: wystawianie i **odbieranie** faktur przez bezpieczny adapter KSeF 2.0, historia pobrań/synchronizacji, referencje i stan uwierzytelnienia oraz dostarczenia.
- Oficjalna FA(3)/starsze formaty wg okresu, pełna XSD lub jawnie oznaczony podzbiór (#82); oryginały, korekty, retry, status sesji/dokumentu, identyfikatory KSeF, offline/tryb awaryjny tam gdzie wymagane, certyfikaty/QR i terminy.
- Integracja z produkcyjną bramką **dopiero** po autoryzowanym odbiorze/testach i osobnej zgodzie; obsługa środowisk testowych przydatna niezależnie. Numer KSeF nie może pochodzić z fikcyjnej wartości formularza (#115).
- Aktualność sprawdzać na oficjalnej [stronie KSeF](https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/zakres-obowiazkowego-ksef/) i [etapach wdrożenia](https://ksef.podatki.gov.pl/etapy-wdrozenia-ksef/).

### D. Repozytorium dokumentów, OCR i dowody (H1→H2)

- Bezpieczny upload/archiwum XML, PDF, JPG/PNG, CSV, wyciągów i umów, hash, antywirus, immutable originals, przypisanie do firmy/zdarzenia, wersje ekstrakcji, OCR, adnotacje, wyszukiwarka, retencja.
- Pobieranie z dozwolonych źródeł: KSeF, e-mail/załącznik, katalog upload, zaakceptowane konektory do chmur, bezpieczne kolejki synchronizacji i deduplikacja.
- AI/OCR podają propozycję oraz źródło i niepewność; człowiek rozstrzyga klasyfikację podatkową. Podgląd oryginału obok pól, porównanie wersji i komentarze (#99).

### E. Księgowość uproszczona (H1)

- KPiR (zgodnie z aktualnym wzorem i okresem), ryczałt, odpowiednie formy PIT, przychody, koszty, rozliczenia działalności, ewidencje zakupów i sprzedaży.
- Wyjaśnienie KUP/NKUP, samochody, koszty mieszane, remanent początkowy/końcowy, korekty, amortyzacja, straty/odliczenia wyłącznie przy zweryfikowanym modelu.
- ZUS składki należne **oddzielnie** od zapłaconych (#81), płatności należności podatkowych bez automatycznego uznania zapłaty na podstawie naliczenia.
- Forma i uprawnienia blokują niewłaściwy rejestr po stronie API (#109).

### F. Pełne księgi i zamknięcie okresów (H2)

- Plan kont, konta analityczne, dziennik, zapisy Wn/Ma, dzienniki cząstkowe, rozliczenia międzyokresowe, rozrachunki, memoriał, rezerwy, odpisy, inwentaryzacje, kursy walut, korekty.
- Automatyczne dekretacje z zatwierdzonych dokumentów i banku oraz jawne uzgodnienia, zgodność sum Wn/Ma, korekty/storna, źródło dekretu, bezstratna historia.
- Okres open/reconciling/closed, twarda blokada retroaktywnego zapisu, checklisty zamknięcia miesiąca i roku, polityka korekt, wygenerowanie bilansu otwarcia (#116).
- Raporty: obroty i salda, bilans, RZiS, przepływy pieniężne, zestawienia analityczne, podatkowe powiązania i załączniki; e-sprawozdania finansowe dopiero po walidacji schem.
- Obsługa spółek o różnych politykach/obowiązkach ma mieć osobne sprawdzone profile; konsolidacja grupy i rozliczenia międzyspółkowe jako zaawansowany moduł, nie przypadkowa reguła globalna.

### G. VAT i podatki (H1→H3)

- Rejestry VAT, krajowe stawki i zwolnienia, częściowe odliczenia, korekty, transakcje WDT/WNT/import/eksport, odwrotne obciążenie tam gdzie przewidziane, MPP, rozliczenia kwartalne i miesięczne.
- Zweryfikowane JPK_V7M(3) i **JPK_V7K(3)**, powiązanie z KSeF, P_54/P_62, przeniesienia między okresami, status wysyłki/UPO, walidacja XSD (#118, #98).
- PIT, CIT (w tym preferencyjne stawki tylko po sprawdzeniu warunków), zaliczki, zestawienia roczne, podatki specjalne / estoński CIT jako odrębne profile _dopiero po osobnej walidacji_.
- JPK dla ksiąg podatkowych/dochodowych: JPK_KR_PD, JPK_ST_KR, JPK_PKPIR, JPK_EWP i JPK_ST według statusu firmy, roku i aktualnego harmonogramu. Oficjalne [JPK_PD](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_pd/jpk_pd) i [struktury](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_pd/pliki-do-pobrania-jpk_pd).
- OSS/IOSS, wewnątrzwspólnotowe i transgraniczne usługi/sprzedaż jako opcjonalne rozszerzenia z precyzyjnymi ograniczeniami, bez deklarowania pełnej zgodności międzynarodowej.
- Szablony rozliczeń, praca księgowej, przygotowanie deklaracji → kontrola → uprawniony podpis → wysyłka → potwierdzenie urzędowe; samo UI „wyślij” nie jest dowodem poprawnej wysyłki.

### H. Bank, kasa i płatności (H1→H2)

- Rachunki/waluty, import bez strat CSV/MT940, później CAMT.053/PSD2 przez autoryzowanego operatora, przypisywanie przelewów, wpłaty/zaliczki, opłaty, chargebacki, split payment, przepływy gotówki.
- Rozrachunki AP/AR, częściowe płatności, zaliczki, kompensaty, uzgodnienie salda, różnice kursowe, kontrola przeterminowanych należności i zobowiązań, raport aging.
- Bezkolizyjny import #107, atomowa alokacja #108, automatyczna dekretacja prawdziwego banku do GL #111; retry/outbox/unknown outcomes.
- Zlecenia płatnicze wyłącznie po osobnym uprawnieniu, bez generowania wykonywalnych przelewów przez nieautoryzowanego agenta.

### I. Środki trwałe, wartości niematerialne i leasing (H2)

- Rejestr aktywów, kwalifikacja, zakup/sprzedaż/likwidacja, rozliczenie nabycia i amortyzacji, odpisy, zmiany wartości, likwidacja, amortyzacja bilansowa i podatkowa osobno.
- Pojazdy, leasing, użytkowanie mieszane, kilometrówka/ewidencje wymagane w danym przypadku, protokoły inwentaryzacji i historia; żadnych stawek „uniwersalnych” bez czasu i źródła prawa.

### J. Kadry, płace i ZUS (H2→H3, osobne legal/compliance gates)

- Kartoteki pracowników, umowy, wymiar czasu, nieobecności/urlopy, listy płac, potrącenia, składki ZUS, PIT i deklaracje pracownicze, PPK w zakresie aktywnego profilu.
- Dane pracownicze i zdrowotne mogą wymagać szczególnie restrykcyjnych uprawnień i retencji; izolacja od zwykłej księgowości oraz brak wysyłki bez zgody.
- Integracje urzędowe/HR import-export przez oddzielny adapter i aktualne struktury, niezależny audyt merytoryczny przed użyciem na prawdziwych płacach.

### K. Sprzedaż, zakupy, magazyn, e-commerce (H2→H3)

- Oferta → zamówienie → dostawa → faktura → płatność oraz zapotrzebowanie → zamówienie zakupowe → przyjęcie → faktura kosztowa.
- Produkty, stany i lokalizacje magazynowe, przyjęcia/wydania, rezerwacje, zwroty, inwentaryzacja, metody wyceny, koszt własny sprzedaży; podłączenie do ksiąg, nie odrębna „magazynowa księga prawdy”.
- Opcjonalne konektory sklepów, marketplace, POS, systemów sprzedaży i płatności (np. Allegro/Shopify) przez wersjonowane adaptery, nie zależności domenowe. Nie rozbudowywać pełnego ERP przed udowodnieniem zapotrzebowania.

### L. Raportowanie, controlling, cash flow, budżet (H1→H3)

- Dashboard „do zrobienia”, należności/zobowiązania, VAT/PIT/CIT/ZUS, salda i terminy, prognoza płynności, budżet vs wykonanie, koszty wg projektu/centrum, KPI; drill-down do dokumentu i zapisu.
- Każda kwota z informacją: okres, waluta, źródło, status (prognoza / naliczone / zapłacone / zatwierdzone), data aktualizacji. Żadnych syntetycznych „95% zgodności” przedstawianych jako urząd lub ekspert.
- Eksport CSV/XLSX/PDF w zakresie autoryzacji, API raportowe/MCP i harmonogramy; prognoza AI nie jest księgowaniem.

### M. Księgowa i biuro rachunkowe (H1 projekt, H2 wdrożenie)

- Osobny panel profesjonalisty obsługującego wiele firm/tenantów, kolejka spraw, zadania, dokumenty do weryfikacji, komentarze, konsultacje, wiadomości, akceptacje, checklisty zamknięcia, różne poziomy uprawnień.
- Jedna firma może pracować bez zewnętrznej księgowej. Obsługa klienta z oddzielnym SLA/umową, ale nie obiecywać żywej obsługi dopóki nie ma rzeczywistego człowieka i procedur.
- Identyfikacja kwalifikacji i uprawnień zawodowych rzetelna, nie symulowana; zakres doradztwa podatkowego odrębny.
- [MVP #121](https://github.com/RolePlayingTech/polish-accounting-platform/issues/121), [projekt szczegółowy](../architecture/accountant-collaboration-v0.md).

### N. AI, asystent, automatyzacje i MCP (H0→H3 — przez każdy moduł)

- **MCP jako pełnoprawna, bezpieczna powierzchnia produktu**: discovery zasobów firm i capability, listowanie/szukanie/podgląd, pytania o saldo i podatki, wyjaśnianie operacji, przygotowanie i weryfikacja szkiców; raporty, dokumenty, bank i rozrachunki, stopniowo każdy nowy moduł.
- Jeden rdzeń use-case/authorization/validation dla UI, REST, worker i MCP. Agent może wyszukać faktury, przygotować wyciąg, zasugerować dekret lub przygotować zamknięcie, lecz **nie może sam zatwierdzić własnego działania księgowego, zapłacić podatku ani wysłać do urzędu**.
- Poziomy ryzyka: odczyt → propozycja → symulacja/dry-run → human review → uprawnione zatwierdzenie → wykonanie → niezależna weryfikacja. Dla bezpiecznych niefinansowych operacji (np. tagowanie, przypomnienia) osobne, jawne delegacje i limity.
- OCR, NLP, analityka anomalii, wykrywanie duplikatów, rekomendacje i pomoc kontekstowa. Model AI nie jest silnikiem obliczającym podatek; obowiązują prawa, testy i przejrzysta ścieżka decyzji.
- Wymagane: ograniczone scope i tenant, rate limit, prompt-injection resistance, input/output schemas, idempotency, human approval, correlation ID, audit, E2E przez **realny klient MCP** oraz obsługa 429/403/timeout/unknown outcome. Szczegółowo: [MCP contract](../agents/mcp-native-capability-contract.md).

### O. Integracje i ekosystem danych (H1→H3)

- Import/eksport przenośny z innych systemów księgowych, banków, KSeF/JPK, OCR, chmury, e-commerce, e-mail, CRM/ERP; manifest adaptera, wersje API, rate limits, retry, historia synchronizacji.
- Bezpieczny model portów i pluginów, niezależny od dostawcy OCR/LLM, z konfiguracją BYOK gdy uzasadnione, ale nie kosztem prywatności i zgodności.
- Brak wymuszonego uzależnienia użytkownika od platformy: eksport dokumentów, oryginałów, rejestrów, audytu i danych w formatach otwartych.

### P. Utrzymanie, kurs, wsparcie i administracja SaaS (H1 dokumentacja, H3 produkcja)

- Pierwsze uruchomienie, checklisty konfiguracji firmy, polskojęzyczne formularze, Akademia i pomoc „Dlaczego?”, samouczki z realnych ekranów, komunikaty niepewności, responsywny UX i WCAG 2.2 AA.
- Operator SaaS: status usług, tenant lifecycle, limity, feature flags, monitoring bezpieczeństwa, onboarding, wsparcie bez domyślnego dostępu do cudzych danych, logi decyzji, wskaźniki błędów.
- Plans/entitlements, subscriptions, metering, dunning, rozliczenie operatora SaaS jako **osobny bounded context od księgowości użytkownika**, billing i webhooki dopiero w H3; self-hosted open-source nie wymaga zewnętrznego systemu płatności.

## 4. Przykładowe „pełne ścieżki” (vertical slices)

1. **JDG freelancer, VAT czynny**: onboard → faktura klienta z wieloma stawkami → KSeF → faktura kosztowa → weryfikacja → VAT/KPiR/PIT/ZUS → przelew i uzgodnienie → zamknięcie miesiąca → prawidłowe JPK/eksport + archiwum.
2. **JDG ryczałt, zwolnienie VAT**: odpowiednia ewidencja i brak zakładek KPiR/GL, monitor limitu, przychody wg prawidłowych stawek, opłacone składki, zobowiązania i raport roczny.
3. **Sp. z o.o.**: zakupy/sprzedaż → dokumenty i wielostawkowy VAT → rozrachunki → Wn/Ma z banku → CIT → rezerwy/amortyzacja → zamknięcie okresu → zestawienia UoR i e-sprawozdanie (po testach XSD).
4. **Firma usługowa z pracownikami**: dokumenty, koszty projektów, czas/HR → wynagrodzenia/ZUS → dekretacja i płatność → raport projektowy; pracownicy mają ograniczony dostęp.
5. **Firma handlowa**: zakup → przyjęcie magazynowe → sprzedaż → wydanie → koszt własny → zwrot/korekta → VAT/GL, jedno źródło zapasu.
6. **Biuro rachunkowe**: 20 powierzonych firm różnych tenantów → kolejka faktur, pytania, review, jawne uprawnienia → zamknięcie → raporty i historia po wycofaniu grantu.
7. **Agent przez MCP**: „Pokaż faktury nieopłacone, przygotuj uzgodnienie i wyjaśnij różnice” → bezpieczny odczyt, draft, preview → osobna zgoda człowieka na skutki księgowe → verify po restarcie API. Każdy wariant negatywny z testem.

## 5. Priorytety praktyczne (nie budować od razu wszystkiego)

- **H0 teraz:** #119 integralność #106/#107/#108/#110/#118, poprawki podatków i UX, #117 bezpieczny refaktor, weryfikacja aktualnych narzędzi i MCP.
- **H1 własny użytek:** wybierz _jeden_ rzeczywisty profil przyszłego użytkownika, ale używaj tylko danych syntetycznych do zamknięcia bramki #100; doprowadź faktura → bank → rozrachunek → VAT/dochód → zamknięcie → eksport do stanu naprawdę zweryfikowanego.
- **H2 po działającym pionowym wycinku:** pozostałe profile; panel księgowej #121; aktywa, magazyn, kadry/płace po ich odrębnej walidacji i kryteriach wejścia.
- **H3 przed skalą SaaS:** self-service, entitlements, billing, support, limitowanie, HA/DR i bezpieczne wdrażanie. Projektuj przyszłe porty i granice, ale implementuj tylko gdy nadchodzi potrzeba.

## 6. Definicja „gotowe do użycia” per capability

Rekord katalogu funkcji musi podać: `capabilityId`, profil/reżim/okres, właściciela modułu, status, link do Issue/PR/SHA, wejścia/wyjścia i ograniczenia, źródła prawne, schemy, zakres UI+REST+MCP, wymagane uprawnienia, strategię approval, testy i fixture, observability/reconciliation i wymagany review merytoryczny.

**GO na dane realne** tylko przez #100 i pełen audyt zgodności z aktualnym prawem dla aktywnego profilu. Brak walidacji XSD, podpisu/UPO, przelewu, kadrowego PIT czy prawdziwego księgowego = `experimental`/ `planned`, nie `verified`.

## 7. Oficjalne źródła do wersjonowania (przykłady, nie zamknięta lista)

- [KSeF 2.0](https://ksef.podatki.gov.pl/informacje-ogolne-ksef-20/zakres-obowiazkowego-ksef/), [harmonogram](https://ksef.podatki.gov.pl/etapy-wdrozenia-ksef/), [portal MF](https://podatki.gov.pl/).
- [JPK_V7M/V7K — schemy i pliki](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_vat-z-deklaracja/pliki-do-pobrania), [JPK_PD](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_pd/jpk_pd).
- [e-Sprawozdania Finansowe](https://podatki.gov.pl/e-sprawozdania-finansowe), [pełnomocnictwo UPL-1](https://podatki.gov.pl/eurzad-skarbowy-zalatw-sprawy-podatkowe-online/pytania-i-odpowiedzi/wnioski-i-pelnomocnictwa/2-czy-za-pomoca-e-urzedu-skarbowego-moge-zlozyc-pelnomocnictwo-do-podpisywania-deklaracji-skladanej-z-pomoca-srodkow-komunikacji-elektronicznej-upl-1).
- [OSS/IOSS](https://podatki.gov.pl/pozostale/tax-free-vat-refund-vap-oss-i-ioss/punkt-kompleksowej-obslugi-oss-i-ioss), [ZUS](https://www.zus.pl/), [ISAP](https://isap.sejm.gov.pl/), [UODO](https://uodo.gov.pl/).

Oficjalne portale są **źródłami do ponownej weryfikacji na dzień obowiązywania i wykonania**, nie przyrzeczeniem, że kod zawiera komplet schem lub ma produkcyjne uprawnienia. Raportować ograniczenia i nie zgadywać.
