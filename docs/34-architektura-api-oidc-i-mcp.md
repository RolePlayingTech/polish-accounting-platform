# 34. Architektura REST API, Sandbox OIDC (`ES256`) i Zdalnego Serwera MCP

Dokument opisuje zaimplementowaną w `apps/api` warstwę transportową HTTP dla Polish Accounting Platform: zabezpieczone REST API `/api/v1/*`, opcjonalnego dostawcę Sandbox OIDC (`ES256`) do testów rozwojowych oraz wbudowany zdalny endpoint Streamable HTTP MCP (`/api/v1/mcp`).

Rozwiązanie realizuje ustalenia [ADR-001](adr/001-rdzen-i-mcp.md), [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md) oraz [ADR-004](adr/004-oidc-i-tozsamosc.md): interfejs webowy, REST API oraz agenci MCP korzystają z tego samego rdzenia aplikacyjnego (`AccountingWorkspaceService` w `@pap/application`), wspólnych kontraktów Zod (`@pap/contracts`) i identycznego kryptograficznego weryfikatora tokenów dostępowych (`JwksOidcAccessTokenVerifier`).

---

## 1. Tryby uruchomienia i wsteczna kompatybilność

`apps/api` (NestJS + Fastify) startuje bez zewnętrznej bazy danych i bez włączonego trybu sandbox:

- `GET /health` oraz `GET /api/v1/system/status` pozostają publiczne i odpowiadają `200 OK` (`{"service":"Polish Accounting Platform","status":"ok",...}`).
- Wszystkie trasy wielofirmowe (`/api/v1/me/companies`, `/api/v1/tenants/:tenantId/...`) wymagają kryptograficznie zweryfikowanego nagłówka `Authorization: Bearer <JWT>`. Gdy OIDC nie jest skonfigurowany lub żądanie nie zawiera ważnego tokena, strażnik `JwtBearerAuthGuard` odrzuca wywołanie w trybie **fail-closed (`401 Unauthorized`)**.
- Jakakolwiek próba przekazania nagłówków spoofujących tożsamość (`x-user-id`, `x-tenant-id`, `x-actor-id`, `x-legal-entity-id`, `x-role` itd.) lub tokena w query stringu (`?access_token=...`) powoduje natychmiastowe odrzucenie żądania (`401`) z zapisem do audytu bezpieczeństwa.

---

## 2. Sandbox OIDC (`ES256`, RFC 9068 `at+jwt`)

Do lokalnego rozwoju i izolowanych testów E2E `apps/api` zawiera opcjonalnego dostawcę OIDC w `apps/api/src/auth/`:

- **Domyślnie wyłączony (fail-closed):** dopóki `PAP_SANDBOX_AUTH_ENABLED !== 'true'`, wszystkie trasy Sandbox OIDC zwracają **`404 Not Found`**. Włączenie jest również twardo zablokowane, gdy `PAP_OIDC_ENV=staging`.
- **Prawdziwa kryptografia asymetryczna `ES256`:** przy starcie `SandboxOidcService` generuje efemeryczną parę kluczy ECDSA P-256 (`jose` `generateKeyPair('ES256')`). Klucz prywatny nigdy nie opuszcza pamięci serwisu, natomiast zsanityzowany klucz publiczny JWK (`kty`, `crv`, `x`, `y`, `kid`, `alg: "ES256"`, `use: "sig"`) zasila standardowy `JwksOidcAccessTokenVerifier`. Brak jakichkolwiek furtek omijających weryfikację podpisu JWT, `iss`, `aud`, `typ: "at+jwt"`, `exp` i `iat`.

### Endpointy Sandbox OIDC (aktywne wyłącznie przy `PAP_SANDBOX_AUTH_ENABLED=true`)

| Metoda i ścieżka                                                         | Przeznaczenie                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/openid-configuration`                                  | Dokument OIDC Discovery (`issuer`, `jwks_uri`, `token_endpoint`, `ES256`).                              |
| `GET /api/v1/auth/sandbox/jwks.json` _(alias: `/api/v1/oidc/jwks.json`)_ | Publiczny zestaw kluczy `JWKS` (wyłącznie składowe publiczne).                                          |
| `GET /api/v1/oidc/personas` _(alias: `/api/v1/auth/sandbox/personas`)_   | Lista syntetycznych person testowych i przypisanych im firm/uprawnień.                                  |
| `POST /api/v1/oidc/token` _(alias: `/api/v1/auth/sandbox/token`)_        | Wydanie podpisanego tokena `ES256` (`at+jwt`) dla wybranej persony (`{ personaId, scopes?, period? }`). |

### Syntetyczne persony testowe

| `personaId`                                | Rola w tenancie              | Zakres dostępu do firm demonstracyjnych                                                                                                                                                     |
| ------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `jan-testowy`                              | `owner` (`TENANT_1_ID`)      | Pełny odczyt i zapis we wszystkich 3 firmach tenanta 1: JDG KPiR + VAT, JDG Ryczałt (zwolniony z VAT) oraz Sp. z o.o. (pełne księgi UoR + CIT).                                             |
| `marta-ksiegowa`                           | `accountant` (`TENANT_1_ID`) | Macierz grantów na poziomie `legalEntityId`: `accounting_write` na firmie KPiR oraz wyłącznie `accounting_read` na firmie Ryczałt (próba `POST`/`PUT` na Ryczałcie zwraca `403 Forbidden`). |
| `piotr-izolacyjny` _(alias: `piotr-beta`)_ | `owner` (`TENANT_2_ID`)      | Dostęp wyłącznie do firmy w drugim tenancie; każde odwołanie REST lub MCP do `TENANT_1_ID` kończy się blokadą cross-tenant (`403 Forbidden`).                                               |

---

## 3. Endpointy REST API (`/api/v1/*`)

Kontrolery w `apps/api/src/controllers/` delegują logikę do `AccountingWorkspaceService`, a filtr `AccountingWorkspaceExceptionFilter` mapuje błędy domenowe i aplikacyjne na deterministyczne kody HTTP (`400`, `401`, `403`, `404`, `409`, `422`) wraz z polem `reasonCode`.

- **Katalog firm i uprawnienia (`CompaniesAccessController`):**
  - `GET /api/v1/me/companies`
  - `GET`, `POST /api/v1/tenants/:tenantId/companies`
  - `GET /api/v1/tenants/:tenantId/companies/:legalEntityId/dashboard` _(oraz alias `/overview`)_
  - `GET`, `PUT /api/v1/tenants/:tenantId/companies/:legalEntityId/settings`
  - `GET`, `POST /api/v1/tenants/:tenantId/companies/:legalEntityId/grants` _(oraz alias `/access`)_, `DELETE .../grants/:grantId`, `POST .../grants/:grantId/revoke`
  - `GET /api/v1/tenants/:tenantId/companies/:legalEntityId/audit-log`
- **Dokumenty, KSeF i księgi podatkowe/rachunkowe (`DocumentsBooksController`):**
  - `GET`, `POST /api/v1/tenants/:tenantId/companies/:legalEntityId/documents` (obsługa ręcznego szkicu JSON oraz surowego KSeF XML `FA(3)` z detekcją duplikatów SHA-256 `409`)
  - `GET .../documents/:documentId`, `POST .../documents/:documentId/approve-and-post`
  - `GET`, `POST .../kpir`, `POST .../kpir/storno` (19-kolumnowa PKPiR 2026 z obsługą numeru KSeF i czerwonego storna)
  - `GET .../zus`, `GET`, `POST .../ryczalt`, `GET .../vat` (rejestry VAT + podgląd `JPK_V7M(3)`), `GET`, `POST .../ledger` (księgi rachunkowe UoR, ZOiS, bilans, RZiS, zaliczka CIT; walidacja bilansowania `Wn = Ma` -> `422`)
- **Finanse, kalendarz, powiadomienia i propozycje MCP (`OperationsAutomationController`):**
  - `GET .../finance`, `POST .../finance/bank-import`, `POST .../finance/reconcile`
  - `GET .../calendar`, `POST .../calendar/obligations/:obligationId/toggle-paid`, `PATCH .../calendar/obligations/:obligationId/status`
  - `GET .../notifications`, `GET`, `PUT .../notifications/preferences`, `POST .../notifications/dispatch-due`, `GET .../notifications/sandbox-mailbox`, `POST .../notifications/send-test`
  - `GET .../mcp/proposals`, `POST .../mcp/proposals/:proposalId/challenge`, `POST .../mcp/proposals/:proposalId/confirm`, `POST .../mcp/proposals/:proposalId/reject`
- **Baza reguł prawa i Akademia Księgowości (`EducationRulesController`, `@OptionalJwtAuth()`):**
  - `GET /api/v1/legal-rules`, `GET /api/v1/legal-rules/:ruleCode`, `POST /api/v1/legal-rules/explain`
  - `GET /api/v1/academy`, `POST /api/v1/academy/lessons/:lessonSlug/grade`

---

## 4. Zdalny serwer Streamable HTTP MCP (`/api/v1/mcp`)

Moduł `apps/api/src/mcp/remote-mcp.registrar.ts` osadza bezstanowy handler `createPapMcpHttpEndpoint` (`@pap/mcp`) wewnątrz enkapsulowanego kontekstu Fastify na ścieżce `/api/v1/mcp` (`POST`, `GET`, `DELETE`), zachowując surowy bufor żądania i nagłówki HTTP.

Przykładowe połączenie klienta `@modelcontextprotocol/client`:

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:4000/api/v1/mcp'), {
  requestInit: {
    headers: { authorization: `Bearer ${accessToken}` },
  },
});
const client = new Client({ name: 'pap-mcp-client', version: '0.1.0' });
await client.connect(transport);
const { tools } = await client.listTools(); // 9 narzędzi MCP
```

Udostępniane narzędzia MCP (9):

1. `system_status` — odczyt statusu i zweryfikowanej tożsamości aktora,
2. `list_my_companies` — lista firm dostępnych dla zalogowanego użytkownika (z zamaskowanym NIP),
3. `list_unpaid_invoices` — nierozliczone faktury zakupu i sprzedaży,
4. `get_monthly_tax_obligations` — terminy ZUS/PIT/CIT/VAT/JPK z podstawą prawną,
5. `explain_accounting_item` — kroki wyliczenia KUP/NKUP i VAT z cytowaniem przepisów,
6. `get_legal_basis` — szczegóły zweryfikowanej reguły prawa podatkowego na zadany dzień,
7. `get_month_close_checklist` — lista kontrolna zamknięcia miesiąca (niezweryfikowane dokumenty, nieuzgodnione przelewy),
8. `prepare_invoice_and_posting_proposal` — utworzenie bezpiecznej propozycji księgowania (bez zapisu do ksiąg!),
9. `confirm_prepared_proposal` — zatwierdzenie propozycji wyłącznie z ważnym jednorazowym kodem wyzwania od człowieka (`confirmationCode`) oraz zgodnym skrótem `expectedPayloadHash`.

---

## 5. Gwarancje bezpieczeństwa AI, MCP i powiadomień

1. **Brak autonomicznego księgowania przez AI (`prepare_*` vs `confirm_*`):** wywołanie `prepare_invoice_and_posting_proposal` tworzy wyłącznie rekord w stanie `pending_human_approval` (`ledgerPosted: false`). Zaksięgowanie w KPiR / rejestrze VAT następuje dopiero po przeglądzie propozycji przez uprawnionego człowieka, wygenerowaniu jednorazowego kodu wyzwania (`POST .../mcp/proposals/:proposalId/challenge`) i potwierdzeniu skrótu SHA-256 (`expectedPayloadHash`).
2. **Obrona przed prompt injection z treści faktur:** wszystkie pola tekstowe pochodzące z dokumentów i przelewów (`invoiceNumber`, `counterpartyName`, `expenseDescription`, `transferTitle`) są oznaczane jako `untrusted_document_data`, oczyszczane ze znaków sterujących i skanowane pod kątem wzorców nadpisywania instrukcji (`promptInjectionSuspected`).
3. **Izolacja powiadomień e-mail (fail-closed):** w środowisku testowym i demonstracyjnym wysyłka korzysta z `ControlledSandboxMailboxTransport` (pełny format RFC 5322 MIME z `Message-ID` i `Auto-Submitted: auto-generated`, outbox z kluczami idempotencji i obsługą opt-out). Każda próba wysyłki poza domeny rezerwowe IANA (`.example`, `.test`, `.invalid`, `.localhost`), np. na `@gmail.com`, jest odrzucana błędem `403 Forbidden` (`blocked_recipient_policy`). Tematy i nagłówki wiadomości nie zawierają pełnego NIP ani szczegółowych kwot podatkowych, a nadawca jawnie wyklucza podszywanie się pod organy KAS/ZUS/MF.

> **Status wdrożeniowy:** Warstwa `apps/api` korzysta obecnie z domyślnego magazynu w pamięci (`InMemoryAccountingWorkspaceStore` w `AccountingWorkspaceService`) na danych syntetycznych. Podpięcie trwałego repozytorium PostgreSQL z RLS oraz produkcyjnego dostawcy OIDC jest kolejnym etapem integracji infrastrukturalnej.
