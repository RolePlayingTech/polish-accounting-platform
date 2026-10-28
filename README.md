# Polish Accounting Platform 🇵🇱

> **Status: działający szkielet developerski; istnieje pierwsza, testowana polityka dostępu w kodzie domeny i aplikacji, ale logowanie, egzekwowanie jej przez API/MCP i izolacja danych firmowych nie są wdrożone.**
>
> **Stan weryfikacji źródeł: 26 października 2026 r.**  
> **Język dokumentacji: polski. Jurysdykcja: Polska.**

**Polish Accounting Platform** to projekt otwartoźródłowej aplikacji webowej do prowadzenia i organizowania polskiej księgowości, obiegu dokumentów oraz obsługi obowiązków podatkowych — zarówno z poziomu przeglądarki, jak i bezpiecznych narzędzi **Model Context Protocol (MCP)**. Aplikacja ma obsługiwać wiele podmiotów, różne formy prawne i różne reżimy podatkowo-księgowe, bez błędnego założenia, że każda firma rozlicza się tak samo.

## Cel

Jedno miejsce na faktury, rachunki, umowy, wyciągi bankowe, dowody księgowe, rozrachunki, ewidencje, terminy i dokumentację. Użytkownik powinien móc napisać agentowi: „Dodaj tę fakturę do spółki X, sprawdź jej poprawność i przygotuj propozycję dekretacji” — zobaczyć wynik z uzasadnieniem oraz **samodzielnie zatwierdzić** wykonanie operacji.

To nie jest wyłącznie „OCR do faktur”. Długoterminowym celem jest **silnik księgowy zgodny z polskimi wymaganiami, z weryfikowalnym źródłem każdej reguły**. Rozliczenia nie mogą opierać się na swobodnej interpretacji modelu językowego.

## Dla kogo

- **JDG**: skala, podatek liniowy, ryczałt oraz przypadki historyczne wymagające odrębnej obsługi; podatnicy VAT czynni lub zwolnieni.
- **Spółki**: cywilna, jawna, partnerska, komandytowa, komandytowo-akcyjna, z o.o., prosta akcyjna, akcyjna — z odmienną identyfikacją podatników i obowiązków.
- **Inne podmioty**: fundacje, stowarzyszenia, spółdzielnie, fundacje rodzinne i pozostałe jednostki dopiero po opracowaniu i walidacji odpowiedniego profilu.
- **Właściciele kilku podmiotów** oraz — w przyszłości — biura rachunkowe i osoby upoważnione.

**Ważne:** „obsługa wszystkich form” jest celem architektury, a nie obietnicą, że wszystkie formy zostaną prawidłowo zaimplementowane w pierwszej wersji. Zakres rzeczywistej zgodności będzie publikowany osobno dla każdego profilu działalności.

## Najważniejsze możliwości

| Obszar | Planowane możliwości |
| --- | --- |
| Dokumenty | Drag & drop, PDF, XML KSeF, obrazy, e-mail (później), metadane, OCR/AI, wersje, wyszukiwanie, duplikaty, archiwizacja |
| Faktury / KSeF | Import zakupów, wystawianie, korekty, zaliczki, statusy, numery KSeF, UPO, obsługa awarii i trybów szczególnych zgodnie z uprawnieniami |
| Księgowość | KPiR, ewidencja przychodów, pełne księgi i podwójny zapis jako odrębne moduły, konta, rozrachunki, środki trwałe |
| Podatki i raportowanie | VAT, JPK_V7, JPK_PD, PIT/CIT, wyliczenia i szkice deklaracji zależnie od profilu i wdrożonego zakresu |
| Płatności | Import CSV/MT940/CAMT, dopasowanie przelewów, salda, przypomnienia; PSD2 tylko za zgodą i przez uprawnionego dostawcę |
| ZUS i kadry | Obowiązki właściciela, składki, terminy; kadry i płace dopiero w rozszerzonym zakresie |
| Prawo i zgodność | Wersjonowane reguły z datą obowiązywania, linkiem do podstawy, testami i ścieżką zatwierdzania zmian |
| MCP | Odczyt dokumentów i rozrachunków, przygotowanie propozycji, wyszukiwanie, kontrolowane operacje zapisu, obowiązkowe potwierdzanie czynności krytycznych |
| Wiele firm | Pełna izolacja danych firm, role, uprawnienia, historia zmian, audyt |

## Co jest szczególnie ważne w Polsce w 2026 r.

- **KSeF 2.0**: obowiązek wystawiania faktur wdrożono od 1 lutego lub 1 kwietnia 2026 r. zależnie od grupy podatnika; dla określonych podatników z miesięczną sprzedażą fakturowaną do 10 000 zł brutto przewidziano przejściowy wyjątek do końca 2026 r. Odbieranie faktur w KSeF co do zasady obowiązuje od 1 lutego 2026 r., z wyjątkami ustawowymi. [MF — zasady KSeF](https://ksef.podatki.gov.pl/ksef-news/zasady-obowiazywania-ksef-i-przepisy-prawne/).
- **JPK_V7M(3) i JPK_V7K(3)**: obowiązują od 1 lutego 2026 r.; uwzględniają numer KSeF i szczególne oznaczenia. [MF — struktury JPK](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_vat-z-deklaracja/pliki-do-pobrania).
- **JPK dla podatków dochodowych (JPK_PD)**: wprowadzany etapami; obejmuje m.in. JPK_KR_PD, JPK_PKPIR i JPK_EWP, z różnymi datami rozpoczęcia obowiązku. [MF — JPK_PD](https://podatki.gov.pl/podatki-firmowe/jednolity-plik-kontrolny/jpk_pd/jpk_pd).
- **e-Doręczenia**: obowiązują różne terminy w zależności od rejestracji podmiotu, a od 1 października 2026 r. także wcześniej zarejestrowane JDG; samo założenie skrzynki bez aktywacji nie wystarcza. [Gov.pl — zasady z 20.10.2026](https://www.gov.pl/web/e-doreczenia/e-doreczenia--najwazniejsze-zasady-dla-przedsiebiorcow).

**Zasada nadrzędna:** przepisy, stawki, schemy i terminy muszą być weryfikowane na dzień zdarzenia/okresu rozliczeniowego. Dokumentacja nie stanowi porady podatkowej ani gwarancji zgodności gotowego produktu.

## Jak będzie wyglądać praca

1. **Dodaj podmiot** i wskaż jego rzeczywistą formę prawną, typ ksiąg, status VAT i okresy obowiązywania ustawień.
2. **Wgraj dokumenty** lub pobierz faktury z KSeF za zgodą właściciela uprawnień.
3. **Otrzymaj propozycje** klasyfikacji, kwot, dekretacji i rozrachunków wraz z poziomem pewności i podstawą reguły.
4. **Zweryfikuj** w kolejce zadań i zatwierdź lub popraw; automat nie może zaksięgować niepewnej operacji bez kontroli.
5. **Sprawdź obowiązki** i wygeneruj raporty/deklaracje dostępne dla danego profilu.
6. **Używaj MCP** do zapytań, importów i przygotowania operacji, zachowując te same uprawnienia i zatwierdzenia co w interfejsie webowym.

## Plan aplikacji

- **Frontend:** responsywna aplikacja webowa, dostępność WCAG 2.2 AA jako cel, język polski, widok właściciela i księgowego.
- **Backend:** modułowy monolit z jasno odseparowanymi kontekstami domenowymi; jeden rdzeń księgowy dla UI, API i MCP.
- **Dane:** relacyjna baza transakcyjna, niezmienialne zdarzenia/audyt, zaszyfrowany magazyn dokumentów, asynchroniczne procesy.
- **AI/OCR:** sugestie i ekstrakcja danych, nigdy jedyne źródło obliczenia podatku ani księgowania.
- **Reguły:** wersjonowane, testowalne i zatwierdzane przez człowieka przed wejściem w życie.

## Wybrana architektura techniczna (ADR-002)

Na potrzeby rozpoczęcia implementacji przyjmujemy **TypeScript strict + Node.js 24 LTS, Next.js/React, NestJS/Fastify, PostgreSQL/Drizzle, pg-boss, S3-compatible object storage, OIDC/Keycloak, oficjalny MCP SDK i monorepo pnpm/Turborepo**. Granice modułów zabezpieczają przed wiązaniem logiki podatkowej z frameworkiem, dostawcą OCR czy modelem AI. Pozwala to zacząć od prostego modułowego monolitu i osobno skalować API, MCP oraz workery.

- [ADR-002 — wybór technologii, porównanie wariantów i wdrożenia](docs/adr/002-stos-technologiczny-i-wdrozenia.md)
- [16 — obowiązkowe zasady architektoniczne](docs/16-zasady-architektoniczne.md)
- [17 — struktura repo i standardy pracy](docs/17-struktura-repo-i-standardy.md)

**Bieżący tryb pracy: wyłącznie lokalny ([ADR-005](docs/adr/005-rozwoj-lokalny.md)).** `pnpm dev` uruchamia frontend i backend bez bazy. Opcjonalny PostgreSQL 18 instaluje się bezpośrednio na komputerze developera; Docker nie jest wymagany. Instrukcja Windows/PowerShell, oddzielne konta i bazy `pap_local`/`pap_test` oraz ręczne migracje są w [przewodniku developera](docs/19-przewodnik-developera.md#postgresql-lokalnie-bez-dockera). Pakiet 6A jest fundamentem technicznym, nie modułem firm ani księgowości. Nie przygotowujemy obecnie serwera, deploymentu ani infrastruktury kontenerowej.

**Stan implementacji:** repozytorium zawiera monorepo pnpm/Turborepo, polski interfejs demonstracyjny `/app`, lokalne API statusu i lokalny serwer MCP STDIO z narzędziem tylko do odczytu. Pakiety `domain` i `application` zawierają pierwszą, deny-by-default politykę grantów tenant/firma/akcja oraz port zaufanego źródła. Pakiet `@pap/db` udostępnia Drizzle ORM, kontrolowane połączenia wyłącznie do lokalnych baz `pap_local` i `pap_test` oraz wersjonowany mechanizm migracji. Po technicznej migracji 6A pakiet 6B dodaje schemat tenantów, firm, członkostw, wersji profilu i jawnych grantów oraz testy constraints PostgreSQL. [Opis modelu 6B](docs/22-schemat-tenantow-6b.md) rozróżnia integralność relacji od ochrony odczytów. [Adapter 6D-1](docs/23-adapter-autoryzacji-6d1.md) łączy ten schemat z portem autoryzacji: odczytuje bieżące członkostwo i granty wyłącznie w żądanym zakresie, bez cache. Testy jednostkowe i PostgreSQL sprawdzają wspólną politykę z adapterem. To nie jest działająca autoryzacja użytkowników końcowych: brak OIDC/logowania, połączenia pakietu DB z API/MCP, egzekwowania polityki przez API/MCP, RLS, audytu decyzji i testów izolacji end-to-end. Ryzyko odnowienia historycznych grantów po reaktywacji członkostwa jest potwierdzone testem i wymaga osobnego mechanizmu przed obsługą użytkowników. Nie ma jeszcze obsługi tenantów ani firm w aplikacji, księgowania, integracji urzędowych ani wdrożenia produkcyjnego. Zatwierdzenie architektury nie jest zgodą na zakupy hostingu ani wdrożenie produkcyjne. Zakres działającego szkieletu opisują [przewodnik developera](docs/19-przewodnik-developera.md) i [strategia testów](docs/20-strategia-testow.md).

## Administracja i przyszłe abonamenty

Projekt przewiduje oddzielone uprawnieniami trzy powierzchnie: **konsolę operatora platformy**, **ustawienia organizacji** i **obszar księgowości konkretnej firmy**. Operator techniczny nie uzyskuje automatycznie dostępu do faktur ani ksiąg klientów. Architektura umożliwi przyszłe plany, limity i płatności przez adapter, bez wiązania księgowości z dostawcą płatności. W pierwszym etapie to **założenia projektowe, nie działające funkcje**. Szczegóły: [ADR-003 — administracja i entitlementy](docs/adr/003-administracja-i-uprawnienia-produktowe.md).

## Zakres pierwszej wersji

**MVP — stabilny rdzeń:** wielopodmiotowość, konto i role, bezpieczne archiwum dokumentów, import XML/PDF/CSV, kontrola duplikatów, wyodrębnienie danych i walidacja, rejestr faktur, kalendarz zobowiązań, podstawowe raporty, odczyt i przygotowanie operacji przez MCP, audyt. Obsługa rzeczywistych ksiąg i wysyłka do MF będą udostępniane **profil po profilu** po testach zgodności. Pierwszy kandydat: **JDG z KPiR**, następnie **ryczałt**, a osobny tor dla **sp. z o.o. z pełnymi księgami**.

**Nie deklarujemy w MVP:** pełnej obsługi wszystkich form prawnych, autonomicznego składania deklaracji, kompletnej listy podatków i raportów, automatycznej integracji z każdym bankiem ani samodzielnego zastąpienia licencjonowanych/usługowych specjalistów.

## Dokumentacja

| Dokument | Zawartość |
| --- | --- |
| [01 — Wizja i zakres](docs/01-wizja-i-zakres.md) | Cele, użytkownicy, granice produktu, miary sukcesu |
| [02 — Formy prawne i profile](docs/02-profile-podmiotow.md) | Model rozdzielający podmiot, podatnika i sposób ewidencji |
| [03 — Funkcje](docs/03-funkcjonalnosci.md) | Szczegółowy katalog funkcjonalności i priorytety |
| [04 — Przepływy](docs/04-przeplywy-uzytkownika.md) | Przykłady procesów end-to-end |
| [05 — Architektura](docs/05-architektura.md) | Komponenty, granice i przepływy danych |
| [06 — Dane](docs/06-model-danych.md) | Model pojęciowy, spójność, rozliczenia, wersjonowanie |
| [07 — MCP](docs/07-mcp.md) | Narzędzia, zasoby, autoryzacja i polityki zapisów |
| [08 — Integracje](docs/08-integracje.md) | KSeF, MF, REGON, NBP, rejestry i banki |
| [09 — Przepisy](docs/09-reguly-prawne.md) | Aktualizacja prawa, źródła, reguły, testy i kontrola |
| [10 — Bezpieczeństwo](docs/10-bezpieczenstwo.md) | RODO, ryzyka finansowe, szyfrowanie i audyt |
| [11 — UI/UX](docs/11-ui-ux.md) | Mapa ekranów, stany, dostępność |
| [21 — Kierunek wizualny](docs/21-kierunek-wizualny.md) | Propozycje estetyki, charakter interfejsu, UX i proces walidacji |
| [12 — Roadmapa](docs/12-roadmapa.md) | Fazy, zależności, zadania dla agentów |
| [13 — Testy i odbiór](docs/13-kryteria-akceptacji.md) | Kryteria akceptacji i scenariusze testowe |
| [14 — Źródła](docs/14-zrodla.md) | Oficjalne strony i dokumentacja techniczna |
| [15 — Decyzje otwarte](docs/15-decyzje.md) | Decyzje projektowe do podjęcia |
| [ADR-001](docs/adr/001-rdzen-i-mcp.md) | Oddzielenie księgowania od AI i MCP |
| [ADR-002](docs/adr/002-stos-technologiczny-i-wdrozenia.md) | Decyzja technologiczna, koszty, alternatywy i środowiska |
| [ADR-003](docs/adr/003-administracja-i-uprawnienia-produktowe.md) | Propozycja administracji, ról platformowych oraz abonamentów |
| [16 — Standard architektury](docs/16-zasady-architektoniczne.md) | Zasady modułów, uprawnień, ksiąg, testów i skalowania |
| [17 — Standard repo](docs/17-struktura-repo-i-standardy.md) | Docelowe pakiety, importy, CI i komendy |
| [18 — Model zagrożeń i uprawnień](docs/18-model-zagrozen-i-uprawnien.md) | Granice zaufania, role, autoryzacja i testy negatywne (kontrakt projektowy) |
| [ADR-004](docs/adr/004-model-zagrozen-i-autoryzacji.md) | Wspólna autoryzacja i granice zaufania (propozycja do przeglądu) |
| [ADR-005](docs/adr/005-rozwoj-lokalny.md) | Bieżący rozwój wyłącznie lokalny, bez Dockera i przygotowywania deploymentu |
| [19 — Przewodnik developera](docs/19-przewodnik-developera.md) | Wymagania środowiska, instalacja, uruchamianie web/API/MCP |
| [20 — Strategia testów](docs/20-strategia-testow.md) | Działające polecenia, testowane granice i ograniczenia pokrycia |
| [22 — Schemat tenantów 6B](docs/22-schemat-tenantow-6b.md) | Schemat PostgreSQL/Drizzle dla tenantów, firm, członkostw, profili i grantów |
| [23 — Adapter autoryzacji 6D-1](docs/23-adapter-autoryzacji-6d1.md) | Adapter PostgreSQL źródła autoryzacji i zakres odczytu |
| [24 — Bezpieczny cykl dostępu 6D-R](docs/24-bezpieczny-cykl-dostepu-6dr.md) | Transakcyjny cykl członkostw i grantów, audyt i guardy SQL |
| [ADR-006](docs/adr/006-prywatny-staging-hetzner.md) | Propozycja przejścia do prywatnego stagingu na serwerze Hetzner |
| [Audyt serwera Hetzner](docs/HETZNER_SERVER_AUDIT_2026-10-28.md) | Odczytowa inwentaryzacja hosta, usług, portów i domeny IDN (bez sekretów) |
| [Architektura stagingu Hetzner](docs/HETZNER_STAGING_ARCHITECTURE.md) | Rekomendowany model uruchomienia Web, API, PostgreSQL 18, TLS i backupów |
| [Plan wdrożenia Hetzner](docs/HETZNER_DEPLOYMENT_PLAN.md) | Procedura pierwszej publikacji (Etap A i Etap B), CI/CD i ochrona `main` |
| [Checklista gotowości Hetzner](docs/HETZNER_READINESS_CHECKLIST.md) | Kryteria Go/No-Go, lista decyzji właściciela i warunki zatrzymania |

## Status funkcji i bezpieczeństwa

Nie istnieją funkcje księgowe, konta użytkowników, działająca autoryzacja, izolacja danych firmowych, połączenie z KSeF ani zdalny serwer MCP. Sama polityka w pakietach nie jest używana przez API i nie chroni danych aplikacji. Lokalny MCP udostępnia wyłącznie publiczny status systemu. Trasy `/settings` i `/platform` są statycznymi stronami zastępczymi bez endpointów administracyjnych. Nie przesyłaj do tego repozytorium prawdziwych faktur, numerów PESEL, danych klientów, certyfikatów KSeF ani tokenów. Błędy bezpieczeństwa zgłaszaj zgodnie z [SECURITY.md](SECURITY.md).

## Zasady open source

Projekt jest przygotowany do rozwoju publicznego. **Kod i dokumentacja** mogą być rozwijane na licencji [MIT](LICENSE). Dane podatników, klucze, testowe materiały z rzeczywistymi danymi i materiały objęte tajemnicą nie mogą trafiać do repozytorium. Zasady wkładu opisuje [CONTRIBUTING.md](CONTRIBUTING.md).

## Repozytorium projektu

Repozytorium: [RolePlayingTech/polish-accounting-platform](https://github.com/RolePlayingTech/polish-accounting-platform). Dla agentów implementacyjnych przygotowano [AGENTS.md](AGENTS.md). Zadania prowadź w GitHub Issues.

## Rozpoczęcie rozwoju

Przeczytaj [roadmapę](docs/12-roadmapa.md), [architekturę](docs/05-architektura.md), [bezpieczeństwo](docs/10-bezpieczenstwo.md) i [kryteria akceptacji](docs/13-kryteria-akceptacji.md). Nie implementuj reguł podatkowych bez powiązania ich z [rejestrem źródeł](docs/14-zrodla.md), datą obowiązywania i zestawem testów. Dla zewnętrznego agenta implementacyjnego przygotuj osobny PR na jeden wydzielony moduł.
