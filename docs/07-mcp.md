# 07. Specyfikacja Model Context Protocol (MCP)

## Cel
Użytkownik lub agent może czytać uprawnione zasoby konkretnego podmiotu, importować dokumenty i przygotować działania, lecz nie może obejść zatwierdzeń domenowych.

## Transport i protokół
Docelowo MCP Streamable HTTP zgodny z aktualnym standardem i audytowanym SDK; dla klienta lokalnego opcjonalny STDIO. OAuth/OIDC, ograniczenia origin/redirect, scoped i krótkożyjące tokeny, rotacja i odwołanie. Dokładne wersje MCP ustalić w ADR.

## Namespaces (projekt interfejsu, nie gotowe API)
### Read-only
- entities.list / entities.get_profile / entities.get_permissions
- documents.list / documents.get / documents.search
- invoices.list / invoices.get / invoices.validate
- tasks.list / calendar.list_due / integrations.get_status
- rules.list_active / rules.explain_for_period

### Przygotowanie, bez księgowania
- documents.prepare_upload: nazwa, mime, hash, entity_id → pre-signed upload session, po autoryzacji.
- documents.prepare_classification: doc_id, proposal → draft, justification.
- invoices.prepare_invoice: fields, recipient, rules_date → wersja robocza.
- ledger.prepare_entry: source_document, period → projekt dekretacji.
- reconciliation.prepare_match: bank_tx, invoice → projekt dopasowania.

### Zatwierdzanie (osobny tor)
- operations.get_draft / operations.list_pending / operations.cancel_draft.
- Zatwierdzenie wyłącznie przez politykę domenową z uwierzytelnionym człowiekiem w UI.
- Wysyłka KSeF/JPK, trwałe księgowanie, zamknięcie okresu i płatności — nie są zwykłymi automatycznymi tools.

## Schemat żądania
Nie wszystkie narzędzia MCP mają ten sam zakres i wymagania uwierzytelnienia:

- **Narzędzia operujące na danych konkretnej firmy:** wymagają wskazania `entity_id` albo jednoznacznej identyfikacji firmy na podstawie uprawnionego zasobu; serwer zawsze wyznacza tenant i ponownie sprawdza aktywny grant dla firmy, zasobu oraz akcji. Selektor przekazany przez klienta nie jest dowodem dostępu.
- **Narzędzia na poziomie użytkownika/organizacji**, np. `entities.list`: wymagają uwierzytelnionej tożsamości i właściwego grantu/zakresu, ale **nie** wymagają wcześniej wybranej firmy. Odpowiedź zawiera tylko podmioty dozwolone temu aktorowi; brak aktywnego `entity_id` nigdy nie czyni takiego narzędzia publicznym.
- **Jawnie publiczne narzędzia techniczne**, np. `system_status` w lokalnym szkielecie: nie korzystają z kontekstu firmy ani danych tenanta i mogą działać bez uwierzytelnienia tylko po osobnej, jawnej decyzji w allowliście. Odpowiedź zawiera minimalne, niewrażliwe metadane; nie ujawnia konfiguracji infrastruktury, klientów ani sekretów. Przed publikacją zdalnego MCP obowiązuje oddzielny przegląd transportu i polityki.
- **Przygotowanie lub zapis:** oprócz powyższych reguł wymaga właściwej komendy, `idempotency_key`, `request_id` i — tam, gdzie potrzebne — oczekiwanej wersji obiektu; operacje krytyczne wymagają oddzielnego potwierdzenia przez człowieka w UI.

Odpowiedzi biznesowe mają czytelny status, kod błędu, ślad audytowy i wersję reguły, gdy ma zastosowanie. Nie wymagamy fikcyjnego identyfikatora audytu ani danych firmy w odpowiedzi jawnie publicznego `system_status`.

## Threat model i autoryzacja

Kanoniczny model zagrożeń, role, warunki dostępu oraz wymagane odmowy dla wszystkich kanałów opisuje [docs/18-model-zagrozen-i-uprawnien.md](18-model-zagrozen-i-uprawnien.md); uzasadnienie architektoniczne zawiera [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md). MCP jest niezaufanym adapterem protokołu i przechodzi przez tę samą politykę aplikacyjną co REST i UI.

Wymagania specyficzne dla MCP: serwer waliduje audience, scopes, termin ważności i odwołanie tokenu; argument `tenant_id`/`entity_id` jest tylko selektorem do sprawdzenia na serwerze; narzędzia są deny-by-default i ograniczone allowlistą; agent nie zatwierdza własnego draftu ani nie wykonuje krytycznego zapisu. Złośliwy tekst w OCR pozostaje danymi. Limity, idempotencja i audyt nie mogą utrwalać pełnego dokumentu ani tokenu. Te zapisy są wymaganiami projektowymi, nie działającym serwerem MCP.

## Przykładowy flow
1. Client MCP pobiera profile firm dostępne w scope.
2. Wybiera jedną firmę i dokument.
3. Wzywa ledger.prepare_entry; serwer zapisuje draft i zwraca ślad obliczeń.
4. Użytkownik w UI widzi kwoty, okres, podstawę i źródło.
5. Podpisuje zatwierdzenie, serwer sprawdza ponownie politykę i wersje.
6. Audyt zapamiętuje klienta MCP, osobę, zatwierdzony hash i rezultat.

## Kryteria
Testy read/write, odwołania tokenów, cross-tenant, prompt injection, replay, race conditions, rollback i przypadków bez zgody. Zero write krytycznych bez odrębnego zatwierdzenia.
