# 05. Architektura techniczna

## Podejście
Modułowy monolit jako pierwszy krok. Ten sam silnik domenowy obsługuje UI, API i MCP; integracje zewnętrzne implementujemy w adapterach. Unikamy mikroserwisów do czasu wykazania potrzeby.

## Logiczne komponenty
- Web UI: responsywne widoki firmy, dokumentów, finansów, zadań i audytu.
- API/BFF: uwierzytelnianie, RBAC/ABAC, rate limiting, CSRF i walidacje.
- Identity & Tenant: relacje organizacja–podmiot–użytkownik–uprawnienie.
- Document Service: upload, storage, OCR, deduplikacja, indeks, retencja.
- Accounting Core: zdarzenia finansowe, okresy, zapisy i niezmienne korekty.
- Tax Rules: wersjonowane definicje obliczeń oraz provenance.
- Integrations: osobne adaptery KSeF, rejestry, JPK, bank, kursy NBP.
- MCP Gateway: sesje, OAuth, scoped resources, tools, audyt.
- Async Workers: import, ekstrakcja, synchronizacja, zadania i ponowienia.

## Technologia — propozycja, jeszcze nie ADR zatwierdzony
TypeScript + Node.js, React/Next.js dla web, NestJS lub Fastify dla API; PostgreSQL i S3-compatible encrypted object store; Redis/queue dla zadań; schema validation (Zod/JSON Schema), OpenTelemetry. Uzasadnienie, dostawcy i wersje do ustalenia przed E1.

## Izolacja i spójność
- Każdy rekord biznesowy ma tenant_id oraz entity_id; dostęp kontroluje warstwa autoryzacji *przed* zapytaniem.
- DB ogranicza spójność i wymusza referencje; row-level security jako dodatkowa obrona, nie jedyna.
- Oryginał dokumentu nie zmienia się po przyjęciu; stan dokumentu i zapisy księgowe przechodzą przez jawne maszyny stanów.
- Wieloetapowe integracje: transakcje lokalne, outbox/inbox i idempotency keys.
- Brak bezpośredniego zapisu z MCP do ksiąg; serwer MCP wywołuje te same komendy domenowe co UI.

## Diagram
Web UI → API → Auth/Tenant → Document & Accounting & Rules → DB/Object Store.
MCP Clients → MCP Gateway → API/Domain Commands → ten sam DB/Object Store.
Async Workers ↔ API/Outbox ↔ KSeF / rejestry / banki.

## Obsługa błędów
Timeouty i retry with backoff; osobne kolejki błędów, dziennik synchronizacji, możliwość ponowienia bez duplikatu, odtwarzalne checkpointy; żaden fail nie pozostawia „częściowo zaksięgowanego” dokumentu.

## Operacje i wdrażanie
Infrastruktura jako kod, izolowane test/stage/prod, secrets manager, backup i test restore, metryki działania bez PII, kontrola migracji, rollout/rollback. Nigdy nie wywołuj produkcyjnego MF w testach CI. Nie uruchamiaj deploymentu bez zgody.