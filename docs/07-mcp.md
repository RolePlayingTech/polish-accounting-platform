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
Każdy tool wymaga aktywnego entity_id i autoryzacji względem tenant_id, a write także idempotency_key, request_id i oczekiwanej wersji obiektu. Każda odpowiedź zawiera status, identyfikator audytu, wersję reguły (gdy dotyczy), działania użytkownika i czytelne błędy.

## Threat model
- Złośliwy tekst w OCR faktury jest danymi, a nie instrukcją dla agenta.
- Agent nie może podwyższać scope ani wybierać innego tenant_id przez argument wejściowy.
- Deny by default, limitowanie wywołań, ochrona przed replay i masowym pobraniem danych.
- Logi nie przechowują całych dokumentów ani tokenów; metryki są odpersonalizowane.
- Krótki TTL draftów; hash zatwierdzanej treści uniemożliwia potwierdzenie zmienionej operacji.
- Osobne zgody na integracje i dostęp agenta, z możliwością natychmiastowego cofnięcia.

## Przykładowy flow
1. Client MCP pobiera profile firm dostępne w scope.
2. Wybiera jedną firmę i dokument.
3. Wzywa ledger.prepare_entry; serwer zapisuje draft i zwraca ślad obliczeń.
4. Użytkownik w UI widzi kwoty, okres, podstawę i źródło.
5. Podpisuje zatwierdzenie, serwer sprawdza ponownie politykę i wersje.
6. Audyt zapamiętuje klienta MCP, osobę, zatwierdzony hash i rezultat.

## Kryteria
Testy read/write, odwołania tokenów, cross-tenant, prompt injection, replay, race conditions, rollback i przypadków bez zgody. Zero write krytycznych bez odrębnego zatwierdzenia.