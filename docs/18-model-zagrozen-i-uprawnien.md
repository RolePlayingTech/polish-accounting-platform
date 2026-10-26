# 18. Model zagrożeń i uprawnień

**Status:** kontrakt projektowy proponowany w PR do Issue #3; nie jest implementacją autoryzacji ani audytem penetracyjnym.  
**Zakres:** UI, REST API, przyszły MCP Gateway, zadania w tle i przyszłe powierzchnie administracyjne.  
**Jurysdykcja:** Polska. Przykłady danych są syntetyczne.

## Cel i granice zaufania

System będzie przetwarzać dokumenty księgowe, dane finansowe, dane osób fizycznych i uprawnienia do systemów zewnętrznych. Ochrona nie może zależeć od tego, czy operację rozpoczęto w przeglądarce, przez REST, MCP czy worker.

```mermaid
flowchart LR
  H[Użytkownik] --> UI[Web UI]
  A[Klient MCP / agent] --> MCP[MCP Gateway]
  I[Integracja] --> API[REST API]
  UI --> API
  MCP --> API
  API --> POL[Wspólna autoryzacja i use-cases]
  JOB[Worker: ograniczone zadanie] --> POL
  POL --> DATA[(Dane tenanta / firmy)]
  OP[Operator platformy] --> CTRL[Control plane]
  CTRL -. bez domyślnego dostępu .-> DATA
```

UI, API, MCP i worker są niezaufanymi punktami wejścia. Serwer ustala tożsamość i zakres operacji; identyfikatory z żądania wskazują zasób do znalezienia, ale same nie przyznają prawa dostępu. Odpowiedzi i dane z dokumentu, OCR, integracji albo modelu językowego traktujemy jako dane, nigdy jako instrukcje polityki.

## Niezmienniki autoryzacji

1. **Odmowa domyślna:** brak tożsamości, aktywnego członkostwa, jawnego uprawnienia albo niejednoznaczny kontekst oznacza odmowę bez skutków ubocznych.
2. **Zakres serwerowy:** serwer sprawdza aktywne konto, wystawcę i odbiorcę tokenu, jego ważność/cofnięcie, członkostwo, role, zakres firmy, stan obiektu i wymaganą zgodę. Ukrycie przycisku w UI nie jest kontrolą dostępu.
3. **Tenant i firma:** `tenant_id` jest wyznaczany z tożsamości i aktywnych grantów. `legal_entity_id` z wejścia jest wyłącznie selektorem; serwer potwierdza, że firma należy do tenanta i że grant obejmuje tę firmę oraz operację.
4. **Brak dziedziczenia:** rola operatora platformy, administratora tenanta, księgowego, recenzenta i agenta nie wynika automatycznie z innej roli. Przypisanie uprawnień obejmuje tenant, dozwolone firmy, działania i okres obowiązywania.
5. **Wspólna decyzja:** UI, REST i MCP wywołują ten sam application service i policy check. Worker również przechodzi przez te same reguły z ograniczonym grantem zadania. Adapter transportu nie implementuje własnych reguł księgowych ani autoryzacji domenowej.
6. **Rozdzielenie etapów:** przygotowanie propozycji, jej zatwierdzenie i wykonanie są osobnymi operacjami i sprawdzeniami. Zatwierdzenie obejmuje skrót/wersję zatwierdzanej treści; zmiana danych unieważnia zatwierdzenie.
7. **Akceptacja człowieka:** agent MCP, OCR i worker nie mogą zatwierdzić własnej propozycji ani samodzielnie wykonać operacji wymagającej zgody człowieka. Zatwierdza uwierzytelniony człowiek z odpowiednim prawem i ponownym sprawdzeniem uprawnienia. Wymóg drugiej osoby jest dodatkową polityką dla wskazanych operacji, a nie domyślnym założeniem dla każdej firmy.
8. **Audyt:** decyzje zezwól/odmów i krytyczne zmiany dostępu są audytowane bez utrwalania tokenów, dokumentów ani nadmiarowych danych osobowych. Operacja krytyczna kończy się odmową, jeśli nie można atomowo zagwarantować wymaganego wpisu audytowego.
9. **Brak dostępu awaryjnego w MVP:** operator platformy nie podszywa się pod użytkownika. Ewentualny tryb break-glass wymaga odrębnego ADR, procedury, zakresu, terminu wygaśnięcia, zgody, alertu i audytu.
10. **Entitlement to nie autoryzacja:** plan/limit może ograniczyć dostępność funkcji lub wolumen, ale nie przyznaje grantu do danych ani działań. Stan płatności nie może blokować eksportu danych wymaganego prawem ani usunięcia konta zgodnie z polityką retencji.

## Role i zakres

Role są niezależnymi grantami, nie hierarchią. Grant zawiera: podmiot (użytkownik lub klient), tenant, zbiór firm, działania, `valid_from`/`valid_to`, status oraz źródło nadania. Członkostwo można odwołać natychmiast; sprawdzenie następuje przy każdej operacji, a nie wyłącznie przy logowaniu.

| Rola | Zakres i dozwolone działania | Czego sama rola nie daje |
| --- | --- | --- |
| Operator platformy | Minimalne, operacyjne metadane control plane: stan usługi, wersja i stan tenanta; zarządzanie platformą zgodnie z odrębną polityką | Odczytu dokumentów, ksiąg, danych podatkowych, członkostw klienta ani podszywania się pod użytkownika |
| Support platformy | Diagnostyczne metadane platformy i stan zgłoszenia, w minimalnym zakresie potrzebnym do wsparcia | Odczytu treści klienta, działania jako użytkownik i dostępu awaryjnego |
| Audytor platformy | Odczyt audytu control plane i zdarzeń bezpieczeństwa platformy według zakresu audytu | Odczytu ksiąg, faktur, plików i biznesowego audytu tenanta |
| Właściciel tenanta (`tenant_owner`) | Odpowiedzialność za własny tenant, ustawienia i członkostwa, mianowanie/odwołanie administratorów i nadawanie grantów tenantowych w dozwolonym zakresie | Globalnej roli platformowej ani praw do ksiąg; dostęp księgowy wymaga osobnego grantu do firmy |
| Administrator tenanta (`tenant_admin`) | Ustawienia własnego tenanta, zaproszenia i członkostwa, nadawanie/odbieranie ról wyłącznie w delegowanym zakresie, metadane firm | Globalnej roli platformowej ani praw do ksiąg; nie może zwiększyć własnych uprawnień ani ustanowić właściciela; dostęp księgowy wymaga osobnego grantu do firmy |
| Członek tenanta (`tenant_member`) | Członkostwo w organizacji i podstawowe ustawienia własnego profilu | Samo członkostwo nie daje dostępu do żadnej firmy ani funkcji księgowej |
| Księgowy | Odczyt i edycja robocza danych księgowych przypisanych firm, przygotowanie propozycji i korekt | Zarządzania tenanta, nadawania ról, zatwierdzania operacji poza przyznanym zakresem ani wysyłki bez odrębnego prawa i zgody |
| Recenzent / zatwierdzający | Odczyt w zakresie firmy, przegląd propozycji, zatwierdzenie wyłącznie tych klas operacji, na które ma jawny grant | Zarządzania tenanta, zmiany własnego grantu ani zatwierdzania jako agent/system |
| Odczyt | Odczyt dozwolonych danych i raportów wskazanych firm | Zapisu, eksportu masowego, zarządzania dostępem i zatwierdzania |
| Agent MCP | Odczyt i — jeśli człowiek jawnie delegował — przygotowanie ograniczonych draftów dla wskazanych firm, scopes, odbiorcy i TTL | Zwiększenia scopes, zmiany tenant context, zatwierdzania, księgowania, płatności, wysyłki do urzędu ani zarządzania użytkownikami |
| Worker | Wykonanie konkretnego, zweryfikowanego joba z kontekstem nadanym przez serwer, ograniczonego do zasobu, działania i czasu zadania | Dowolnego wyboru tenanta/firmy, przyjmowania komend użytkownika ani obchodzenia polityk przez konto techniczne |

Role platformowe (`platform_operator`, `platform_support`, `platform_auditor`), członkostwa tenantowe (`tenant_owner`, `tenant_admin`, `tenant_member`) i granty firmy (`entity_accountant`, `entity_reviewer`, `entity_reader`) są odrębnymi wymiarami. Jedna osoba może mieć więcej niż jeden jawnie nadany grant, ale role nie tworzą uniwersalnej hierarchii. Delegujący może przyznać tylko granty mieszczące się w jego zakresie; tenant nie może nadać roli platformowej, a administrator nie może ustanowić właściciela ani zwiększyć własnych praw. Tytuł prawnego właściciela firmy, zatrudnienie lub relacja z biurem rachunkowym nie tworzą grantu aplikacyjnego. W przyszłości organizacje biur rachunkowych otrzymają jawne delegacje do konkretnych tenantów/firm, nie globalny dostęp.

## Macierz rola → zasób → działanie → warunek

Legenda: **Tak** — dozwolone w opisanym zakresie; **Warunkowo** — wymaga dodatkowego grantu/polityki i walidacji serwera; **Nie** — rola sama tego nie umożliwia.

| Rola | Status platformy | Konfiguracja / członkostwa tenanta | Dane firmy i dokumenty | Przygotuj draft | Zatwierdź / wykonaj krytyczne działanie | Audyt |
| --- | --- | --- | --- | --- | --- | --- |
| Operator platformy | Tak, minimalne metadane | Nie dla klienta | Nie | Nie | Nie | Warunkowo: zdarzenia operacyjne bez treści klienta |
| Support platformy | Warunkowo, metadane sprawy | Nie | Nie | Nie | Nie | Warunkowo: zakres sprawy bez treści klienta |
| Audytor platformy | Warunkowo, metadane kontroli | Nie | Nie | Nie | Nie | Tak dla control plane; nie audyt biznesowy tenanta |
| Właściciel tenanta | Nie | Tak, własny tenant; może delegować dozwolone członkostwa i role tenantowe | Warunkowo, wymaga osobnego grantu firmy | Warunkowo, wymaga grantu księgowego | Warunkowo, jawny grant do danej klasy działania i ponowne uwierzytelnienie | Tak dla zmian organizacyjnych; dane księgowe tylko z grantem firmy |
| Administrator tenanta | Nie | Tak, własny tenant w granicach delegacji; nie ustanawia ownera ani siebie z wyższą rolą | Warunkowo, wymaga osobnego grantu firmy | Warunkowo, wymaga grantu księgowego | Warunkowo, jawny grant do danej klasy działania i ponowne uwierzytelnienie | Tak dla zmian organizacyjnych; dane księgowe tylko z grantem firmy |
| Członek tenanta | Nie | Nie, poza własnym profilem | Nie bez grantu entity | Nie bez grantu entity | Nie | Nie bez osobnego grantu |
| Księgowy | Nie | Nie | Tak, tylko firmy z aktywnego grantu | Tak, w zakresie firmy | Warunkowo, odrębna rola/polityka, wersja i zgoda człowieka | Warunkowo, zakres przypisanej firmy |
| Recenzent / zatwierdzający | Nie | Nie | Tak, tylko odczyt w zakresie firmy | Nie, jeśli nie ma dodatkowego grantu księgowego | Warunkowo, jawny grant klasy operacji, zgodna wersja, świeża autoryzacja | Tak w zakresie firmy |
| Odczyt | Nie | Nie | Tak, tylko odczyt w zakresie firmy | Nie | Nie | Nie, chyba że przyznano osobny grant |
| Agent MCP | Nie | Nie | Warunkowo, jawny scope, firma, odbiorca tokenu i TTL | Warunkowo, tylko dozwolone drafty | Nie | Nie; identyfikator klienta MCP jest częścią audytu serwerowego |
| Worker | Nie | Nie | Warunkowo, tylko dane potrzebne jobowi | Warunkowo, zgodnie z typem joba | Nie dla zgody człowieka; wykonuje wyłącznie wcześniej zatwierdzony job | Zdarzenia zadania przez audyt aplikacji |

Eksport, pobranie oryginału, zmiana członkostwa, zmiana profilu, księgowanie, zamknięcie okresu, płatność i wysyłka urzędowa są odrębnymi działaniami. Nie wynika z prawa `read` ani ogólnej roli „admin”. Każda klasa ma własny grant, walidację stanu i zdarzenie audytowe.

Przyszłe entitlementy są sprawdzane jako dodatkowa bramka dostępności/limitu po autoryzacji, nie jako zamiennik policy check. Webhook płatniczy ani plan nie nadaje ról. Zmiany planu, rozliczeń i adaptera płatności pozostają poza Issue #5.

## Uwierzytelnienie i kontekst żądania

Docelowa tożsamość użytkownika opiera się na OIDC/OAuth zgodnie z ADR-002. Adapter weryfikuje podpis i `iss`, `aud`, `exp`, `nbf`, scopes, status konta oraz odwołanie/rotację tokenu. Przeglądarka używa ochrony sesji i CSRF; klient MCP dostaje token odbiorcy z krótkim TTL i najmniejszym zakresem. Żaden sekret klienta nie trafia do logu ani odpowiedzi.

Serwer tworzy kontekst żądania z uwierzytelnionego podmiotu, typu aktora, nadanych grantów, żądanego tenant/entity selektora, correlation/request ID i źródła wejścia. Policy check rozwiązuje selektory względem członkostwa i bieżącego stanu. Klient nie może przesłać wiążącego `tenant_id`, roli, statusu zatwierdzenia ani dowolnej tożsamości wykonującego.

## Krytyczne przepływy

1. **Odczyt:** uwierzytelnij → zweryfikuj członkostwo i grant do firmy/zasobu → minimalizuj wynik → audytuj decyzję według klasy wrażliwości. Nie zwracaj różnicy odpowiedzi ujawniającej istnienie cudzej firmy.
2. **Przygotowanie:** sprawdź prawo `prepare` i wersję źródła → stwórz draft z autorem, zakresem, TTL i hash danych → brak zewnętrznego side effect.
3. **Zatwierdzenie:** uwierzytelnij człowieka ponownie → ponownie sprawdź aktywność członkostwa i prawo → porównaj hash oraz wersje → zapisz akceptację i zdarzenie audytu atomowo. Zmiana danych, brak prawa lub wygaśnięcie draftu wymaga odmowy i nowego draftu.
4. **Wykonanie:** wymaga osobnego prawa `execute` oraz ważnej akceptacji → ponownie sprawdź stan/idempotency key → zapis lokalny w transakcji albo kontrolowany adapter z weryfikacją statusu; timeout integracji nie oznacza zgody na ślepy retry.
5. **Odwołanie dostępu:** dezaktywacja grantów/tokenów unieważnia przyszłe żądania, joby oczekujące sprawdzają grant ponownie przed skutkiem, a zdarzenie odwołania trafia do audytu.

## Rejestr zagrożeń

| ID | Zagrożenie / przykładowy skutek | Minimalne zabezpieczenia i wymagany dowód |
| --- | --- | --- |
| T1 | Użytkownik A odczytuje dokument firmy B (IDOR, błędne filtrowanie) | Sprawdzenie tenant/entity przy każdym use-case, później RLS jako defense in depth; test cross-tenant i cross-entity |
| T2 | Manipulacja `tenant_id`, `entity_id` lub rolą w body/tool | Identyfikator wejściowy tylko selektorem; role/granty z serwera; test zmienionych identyfikatorów |
| T3 | Nieaktualne membership pozwala na dostęp po usunięciu użytkownika | Weryfikacja aktywnego grantu przy każdej operacji, revocation; test odebrania roli i oczekującego joba |
| T4 | Operator platformy lub wsparcie odczytuje księgi | Rozdzielenie control plane; brak impersonacji/break-glass w MVP; test braku dostępu operatora |
| T5 | Admin tenanta uzyskuje domyślnie uprawnienia księgowe | Osobne granty admin/księgowy, matryca firm; test administracyjny bez grantu księgowego |
| T6 | Kradzież/wtórne użycie tokenu OIDC lub MCP | Krótki TTL, odbiorca, scopes, PKCE, rotacja/odwołanie, walidacja `iss/aud/exp`; test tokenu wygasłego, złego odbiorcy i revoked |
| T7 | Agent wywołuje niedozwolone narzędzie lub eskaluje scopes | Deny-by-default allowlist, serwerowe scopes, ten sam application policy; test braku/rozszerzenia scope |
| T8 | Prompt injection w PDF/OCR nakazuje eksport lub wysyłkę | Treść dokumentu jako niezaufane dane, bez narzędzi krytycznych bez akceptacji; test syntetyczną instrukcją w dokumencie |
| T9 | Replay żądania, podwójne księgowanie lub powtórna wysyłka | Idempotency key powiązany z aktorem/operacją/payloadem, stan i wersja, kontrola statusu adaptera; test replay i zmienionego payloadu |
| T10 | Race condition zmienia kwotę po zatwierdzeniu | Hash/ETag i wersja zatwierdzonej treści, atomowe compare-and-set; test konfliktu wersji |
| T11 | Worker działa jako confused deputy na cudzym tenantcie | Kontekst joba nadany przez serwer, minimalne granty, recheck przy wykonaniu, brak dowolnego tenant selector; test podmienionego payloadu joba |
| T12 | Sekrety, tokeny, faktury lub PESEL wyciekają przez logi/błędy | Redakcja, allowlist pól logowanych, błędy bez surowych wyjątków/treści, skan sekretów; test log sink |
| T13 | Atakujący masowo eksportuje poprawnie dostępne dane | Rate limit i limity wolumenu, reautoryzacja/alert dla eksportu, stronicowanie; test przekroczenia limitu |
| T14 | Złośliwy plik wykorzystuje parser/archiwum lub przekracza zasoby | Limit rozmiaru, sniff MIME, AV/kwarantanna, izolowane parsery i timeout; test pliku niezgodnego/za dużego |
| T15 | SSRF przez URL dostarczony przez integrację/dokument | Pobieranie wyłącznie przez kontrolowane konektory, walidacja hosta/DNS i blokada adresów prywatnych; test loopback/link-local |
| T16 | Brak audytu pozwala ukryć zmianę/odmowę | Append-only aplikacyjny interfejs audytu, kontrola uprawnień, monitoring ciągłości; krytyczny zapis odmawia przy błędzie audytu |
| T17 | Niezaufany origin lub błędna konfiguracja hosta omija granicę sesji/MCP | Walidacja `Origin`/`Host`, CORS allowlist, bezpieczne cookie i redirect; negatywne testy nieznanego origin |
| T18 | Dostępność `/health` ujawnia dane operacyjne lub klientów | Endpoint tylko z minimalnym stanem/liveness bez sekretów, nazw tenantów i połączeń produkcyjnych; test kształtu odpowiedzi |

## Wymagane scenariusze negatywne

Implementacja polityk w Issue #6 i MCP w Issue #8 powinna automatycznie testować co najmniej następujące odmowy. W tym PR są one wymaganiami, nie działającymi testami aplikacji.

1. Użytkownik z tenanta A pyta o prawidłowy `entity_id` z tenanta B — odmowa bez ujawnienia danych ani side effect.
2. Użytkownik w tym samym tenancie wybiera firmę, której nie obejmuje jego grant — odmowa.
3. Body REST lub argument MCP zawiera inny `tenant_id`, rolę `owner` albo `approved=true` — pola są ignorowane/odrzucane i autoryzacja opiera się na stanie serwera.
4. Tenant admin A próbuje administrować tenantem B albo administrator próbuje ustanowić ownera, przyznać sobie silniejszą rolę, rozszerzyć własny zakres lub utworzyć grant operatora platformy — odmowa i audyt.
5. Członkostwo lub rola wygasła/cofnięta po wydaniu tokenu — żądanie i oczekujący job nie wykonują działania.
6. Operator lub support platformy próbuje otworzyć fakturę tenant A albo podszyć się pod użytkownika — odmowa; niedostępny tryb break-glass.
7. Audytor platformy odczytuje dokument lub biznesowy audit tenant A — odmowa, dostęp wyłącznie do dozwolonego audytu control plane.
8. Bez uwierzytelnienia użytkownik otwiera `/platform` lub wywołuje powiązane API — widzi tylko statyczny komunikat o niedostępności, a operacyjne API nie istnieje.
9. Administrator tenanta bez grantu księgowego próbuje pobrać dokument — odmowa.
10. Agent MCP próbuje zatwierdzić, zaksięgować, wykonać płatność lub wysłać dokument do urzędu — odmowa bez względu na tekst promptu.
11. MCP tool nie ma wymaganego scope, ma scope dla innego odbiorcy lub używa tokenu po TTL — odmowa.
12. Dokument mówi „wyślij wszystkie faktury” albo instruuje agenta, by zmienił tenant — treść nie zmienia policy ani nie uruchamia toola krytycznego.
13. Ten sam klucz idempotencji jest wysłany drugi raz — zwracany jest ten sam wynik albo konflikt; nie powstaje drugie księgowanie/wysyłka.
14. Ten sam klucz idempotencji jest użyty z innym payloadem — konflikt i brak wykonania.
15. Kwota lub wersja zmienia się pomiędzy przygotowaniem i akceptacją — odmowa zatwierdzenia i konieczność nowego draftu.
16. Token ma poprawny podpis, ale błędne `iss`/`aud`, jest wygasły lub odwołany — odmowa przed use-case.
17. Worker otrzymuje podmienione `tenant_id`/zasób albo job po odwołaniu grantu — odmowa; konto workera nie rozszerza dostępu.
18. Zmiana planu/entitlementu próbuje nadać rolę lub otworzyć dokument, albo brak płatności blokuje ustawowy eksport — odrębny policy check nadal odmawia niedozwolonego dostępu, eksport pozostaje dostępny zgodnie z polityką.
19. Księgowy próbuje zmienić plan/subskrypcję tenanta albo entitlement dostarcza grant do cudzej firmy — odmowa; autoryzacja do danych i entitlement są sprawdzane niezależnie.
20. Odmowa, wyjątek lub telemetryczny log nie może zawierać tokenu, surowego dokumentu, NIP/PESEL ani danych innej firmy.
21. Origin/Host jest nieznany, URL wskazuje loopback/link-local lub plik przekracza limit — odrzucenie przed dostępem do zasobu.
22. Brak możliwości zapisania wymaganego audytu dla księgowania/wysyłki — odmowa całej operacji.
23. Publiczny `/health` nie ujawnia tenantów, konfiguracji, sekretów ani szczegółów infrastruktury.

## Audyt i monitoring

Zdarzenie audytu powinno zawierać: identyfikator zdarzenia, czas UTC, actor ID i typ aktora, źródło (UI/API/MCP/worker), tenant/entity w zakresie niezbędnym do rozliczalności, działanie i zasób, wynik allow/deny, kod przyczyny, request/correlation ID, wersję/hash obiektu przy zatwierdzeniu, idempotency key (bez payloadu), oraz identyfikator draftu. Nie zapisuje tokenów, całych dokumentów, pełnych parametrów żądania ani sekretów. Dostęp do audytu jest osobno ograniczony i sam audytowany.

Monitorować odmowy cross-tenant, nietypowe serie eksportów, wzrost błędów tokenów, nieważne Origin/Host, przerwy w audycie, powtarzane replay oraz błędne joby. Alert nie może kopiować treści dokumentu lub tokenu.

## Zakres wdrożenia i źródła

Ten dokument wyznacza kontrakt dla przyszłych implementacji. Nie wdraża logowania, OIDC, MCP, tabel tenantów, PostgreSQL RLS, panelu operatora, dostępu break-glass ani zgodności produkcyjnej. Issue #6 ma dostarczyć serwerową autoryzację tenant/entity i testy izolacji; Issue #8 ma użyć tej samej polityki w MCP.

Odniesienia techniczne:

- [ADR-001 — jeden rdzeń, MCP jako adapter](adr/001-rdzen-i-mcp.md)
- [ADR-002 — stos i OIDC/MCP](adr/002-stos-technologiczny-i-wdrozenia.md)
- [ADR-003 — granice administracji](adr/003-administracja-i-uprawnienia-produktowe.md)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700)
- [Model Context Protocol — authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
