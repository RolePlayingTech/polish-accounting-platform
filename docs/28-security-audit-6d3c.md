# 28. Audyt bezpieczeństwa — kandydat 6D-3C

Kontrakt: [ADR-009](adr/009-atomowy-audyt-decyzji.md). Migracja 0005 rozszerza
0004; historyczne 0000–0003 nie są zmienione. Rewizja SEC-01/02 zmienia kandydackie
0004/0005 i wymaga wspólnej wersji SQL/application/ACL. Rzeczywiste OLD/NEW w receipt,
retry bez DML oraz scenariusze QA **NOT RUN**: [docs/29](29-sec01-sec02-kontrakt-efektow.md).

| Ścieżka | Audyt | Awaria |
| --- | --- | --- |
| HTTP preflight allow/deny | Oddzielny INSERT, kind=preflight | 503, brak dostępu |
| Spoofing nagłówków/brak Bearer | kind=transport, actor=NULL | 503, brak dostępu |
| Firma allow | Ta sama TX co callback, outcome=committed | Rollback efektu |
| Firma deny | Oddzielna TX po rollbacku, outcome=denied | Fail-closed, audit_unavailable |
| Autoryzowana operacja z błędem | Oddzielna TX, allow/rolled_back | Brak deklaracji trwałego śladu przy awarii DB |
| Zmiana dostępu allow | access_management_event + security_decision_event w TX | Rollback obu wpisów i mutacji |
| Idempotentne powtórzenie | Nowa decyzja z FK do istniejącej operacji | Bez powielenia mutacji |

SECURITY_AUDIT_RECORDER jest obowiązkowym providerem użytego guarda. Publiczny
AppModule nadal go nie instancjonuje i nadal nie wystawia endpointów księgowych.
Kompozycja createPostgresSecurityServices zwraca securityAudit oraz zgodne UoW,
resolver, źródło faktów i store. executeAuthorizedCompanyAction wymaga metod audytu
w portach transakcyjnych. Brak metody nie może dać sukcesu. Guard oraz helper HTTP
nadają losowy, serwerowy request ID i zwracają go w x-request-id; nie odczytują aktora
z identyfikatorów korelacji. Access management używa operation_id jako korelacji.

Macierz uzupełniająca do docs/27:

| Obiekt | Runtime |
| --- | --- |
| security_decision_event | INSERT tylko pod podpisem dokładnych metadanych; brak odczytu/zmiany/usuwania/TRUNCATE |
| pap_stamp_security_event | Bez bezpośredniego EXECUTE, BEFORE INSERT nadaje czas i txid |
| pap_require_security_audit | Bez bezpośredniego EXECUTE; mały definer z pinowanym search_path, kontrola przy COMMIT |
| access_management_event INSERT | Wyłącznie executor SQL z podpisanej komendy; runtime nie dostarcza receipt/state_change |

Audyt nie przechowuje FK do tenanta/aktora dla odmów: próba obcej lub nieistniejącej
firmy także wymaga śladu, a czasowa niedostępność konta nie może go skasować.
actor_id pozostaje NULL, gdy uwierzytelnianie lub resolver nie potwierdził tożsamości.
Wewnętrzne identyfikatory podlegają kontroli dostępu i retencji; nie są anonimowymi danymi.
Odczyt audytu przez operatora/tenanta wymaga przyszłego, oddzielnie autoryzowanego
modułu. Runtime nie otrzymuje prawa globalnego czytania logu.

Krytyczny kontrakt dla kolejnego modułu: użyj wspólnego core i przekazanego tx,
dodaj tabelę/RLS/ACL oraz constraint trigger wymagający właściwej decyzji. Nie
wykonuj efektów sieciowych w callbacku; przyszłe wysyłki wymagają outbox i autoryzacji.
Nie wystawiaj execute arbitrary SQL przez MCP. Niższe authorizeCompanyAction jest
czystym, doradczym sprawdzeniem polityki, nie wejściem do danych biznesowych.

Testy PostgreSQL i niezależny security review pozostają **NOT RUN** w tej sesji.
Pełna lista i komendy: [6D3_VALIDATION_HANDOFF.md](6D3_VALIDATION_HANDOFF.md).
