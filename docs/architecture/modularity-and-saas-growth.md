# PAP — architektura modułowa i droga do premium SaaS

**Status:** strategia techniczna / engineering contract, nie wdrożenie · **2026-11-23** · [wizja #123](https://github.com/RolePlayingTech/polish-accounting-platform/issues/123) · [mapa funkcji](../product/full-spectrum-capability-map.md) · [harness](../agents/next-iteration-2026-11-23.md). Obowiązują ADR-001/002/003/004/010/011, `docs/16-zasady-architektoniczne.md`, `AGENTS.md`, #100 i #119. Przy sprzeczności wymagane review i ADR, nie cichy bypass.

## 1. Decyzja: modularny monolit z twardymi granicami

Nie wprowadzać przedwcześnie mikroserwisów, Kafki, Redis, Kubernetes ani nowych baz na każdy moduł. Docelowe kilka–kilkadziesiąt bounded contexts może współistnieć w jednym repo i procesie, z PostgreSQL18 jako trwałym źródłem prawdy. Każdy moduł otrzymuje:
- identyfikator, owner zespołu, publiczny kontrakt typów/komend/zdarzeń, kontrolowany import i osobne testy;
- własność tabel/agregatów i politykę migracji, bez pisania w cudze tabele;
- czytelne entrypointy application/use cases, porty I/O i adaptery integracyjne;
- jawny model permissions, tenant/company/year, legal rules / version i narzędzia MCP podłączone do **tych samych** use cases;
- celowane testy kontraktów, bezpieczeństwa, pieniędzy, migracji i wydajności.

Obecny podział `apps/web`, `apps/api`, `apps/mcp`, `packages/domain`, `packages/application`, `packages/contracts`, `packages/db`, `packages/ui` jest wartościowy i **zostaje**. Problem nie wynika z monorepo, tylko z rozmiaru i sprzężenia monolitów `accounting-workspace.ts` (~6593 linii), `synthetic-workspace.ts` (~5562 linii), `accounting-scope.ts` (~3178 linii), `mcp-gateway.ts` (~3161 linii), oraz potencjalnych podwójnych reguł dla demo. Rozdzielać według use case i danych, nie mechanicznie co X linii. Ochrona przez golden tests przed ekstrakcją.

## 2. Proponowane bounded contexts (capabilities, nie nowe usługi)

| Kontekst | Własność / nieprzekraczalna granica |
| --- | --- |
| `identity-access` | OIDC, sesje, użytkownicy, invitation lifecycle, RBAC/ABAC i grants; app operator nie dziedziczy księgowego |
| `organizations-profiles` | tenant/legal entity, forma prawna, wersjonowany reżim, rok, status VAT, entitlement flags |
| `counterparties` | kontrahent, identyfikatory i walidacja, bez mutowania dokumentów wstecz |
| `document-vault` | immutable source, hash, OCR draft, załącznik i zdarzenia weryfikacji |
| `invoicing` | wystawienie/otrzymanie, pozycje, numeracja, status, korekty, KSeF refs |
| `accounting-events` | kanoniczny identyfikator zdarzenia i lineage dokument→dekret/rejestr/podatek/płatność; idempotencja i odwracalne korekty |
| `simplified-ledgers` | PKPiR / ryczałt według właściwego profilu, bez logiki „try all regimes” |
| `general-ledger` | konta, dziennik Wn/Ma, zamknięcie, korekty, reconciliation |
| `vat-tax-compliance` | VAT/JPK/PIT/CIT/ZUS, przejście okresów, legal rule registry, generated returns, XSD/receipt |
| `bank-settlements` | import, unikalność transakcji, alokacje, nieopłacone, zapłacone i różnice |
| `assets-leasing` | rejestr środków trwałych, amortyzacja bilansowa/podatkowa |
| `payroll-hr` | prywatne kartoteki HR/płace/ZUS i wynik dekretacji do GL; izolacja danych wrażliwych |
| `inventory-purchasing` | stan zapasów, zakupy, zaksięgowane koszt własny i dostawy |
| `reporting-controlling` | **read-model** z autorytatywnych zdarzeń/ksiąg, raporty i budżety bez własnego silnika podatkowego |
| `accountant-practice` | engagement, per-client grants, consultation case, wiadomości i weryfikacje (#121) |
| `workflow-approval` | audytowane zadania, maker-checker, approval hash TTL i reautoryzacja |
| `integrations-outbox` | KSeF, bank, e-mail, marketplace, powiadomienia, retries/unknown state, secrets adapters |
| `mcp-adapter` | transport, katalog capability, mapping do application use cases, niczego nie księguje samodzielnie |
| `platform-control-billing` | operator SaaS, plany/entitlements, usage, billing producenta oprogramowania, brak uprawnienia do ksiąg |

To jest **mapa odpowiedzialności**, nie dyrektywa utworzenia 19 pakietów teraz. Małe konteksty mogą współdzielić katalog, jeśli ich właściciel, API i zależności są jednoznaczne. Gdy kontekst nie ma wdrożonego feature, nie tworzyć bezproduktywnych klas „do rozbudowy”.

## 3. Kanoniczne zdarzenie i transakcyjny zapis — najważniejszy kontrakt

Przykład:
```text
SourceDocument / ExternalEvent
   └─ immutable source hash, tenantId, legalEntityId, origin, actor
   └─ AccountingOperation (stable operationId, type, effectiveDate, version, status)
       ├─ document lines / amounts / tax classification
       ├─ tax registrations VAT/PIT/CIT (links, versioned rules)
       ├─ simplified ledger OR general ledger postings (lineage + Wn/Ma)
       ├─ receivable/payable & settlement allocation
       ├─ close-period inclusion & reporting projections
       └─ audit + outbox (external status pending/unknown/confirmed)
```
- Jedno `operationId`/źródło pochodzenia oraz idempotency key dla komend; `documentId`, `postingId`, `paymentId` pozostają odrębnymi, powiązanymi bytami, nie udawać jednej tabeli na wszystko.
- **Nie wymuszać event sourcing całej aplikacji** jako warunku. Niezmienna historia operacji/księgowań i audyt są niezbędne, pełny event sourcing wymaga osobnego ADR i dowodu korzyści.
- W jednej autoryzowanej transakcji kontrola uprawnień w kontekście PG RLS, wersji/stanu okresu, duplikatów, limitów kwot, salda, księgowania, rozrachunku i audytu. Zewnętrzne efekty tylko przez outbox/inbox po commicie.
- Płatności i podatki mają odróżniać **należne**, **naliczone**, **zadeklarowane**, **zapłacone**, **nadpłata**, **do przeniesienia**, **do zwrotu**. Żadne z nich nie jest prostym synonimem innego.
- Korekta oryginału tworzy nową operację, relację do oryginału i ścieżkę audytu; brak cichego overwrite okresów historycznych. Zamknięcie miesiąca jest serwerowym guardem, nie tylko etykietą UI.
- External unknown outcome (timeout KSeF/bank) -> `pending_reconciliation` + odczyt statusu po external reference; **nie** zakładać porażki/sukcesu i bezmyślnie retry wysyłki.
- VAT wielostawkowy i multi-line nie mogą zredukować się do jednej stawki przy approve/preview (#106). Idempotencja przy wielu kanałach (#110) i przelew bez podwójnego rozrachunku (#108) są invariantami.

## 4. Multi-tenant by design, bez „magicznego admina”
- Klucz autoryzacji: aktor + tenantId + legalEntityId + akcja + zakres dat/okres + cel + effective grants; deny-by-default w application i PostgreSQL FORCE RLS w adapterze DB; UI gating tylko poprawia ergonomię.
- Księgowa z biura może widzieć wiele *konkretnych* legal entities z różnych tenantów: aktywny engagement, osobna relacja, sprawdzenie per zapytanie; nie scalać ich baz ani kont.
- `platform_operator` nie ma dostępu do dokumentów firm; support access wymaga osobnego break-glass ADR i audytu. `tenant_owner` też podlega explicit permission na operacje szczególnie wrażliwe.
- Dwa independent tenants i różne firmy tego samego tenanta w każdej nowej funkcji; scenariusze revoked grant, changed session, direct IDOR URL, background job i MCP.
- Prawdziwe dokumenty klientów, dane HR i korespondencja księgowej: DPA/powierzenie, granice eksportu i retencji, encryption at rest/in transit, restricted access. Do czasu #100 tylko syntetyczny staging.

## 5. Wersje prawa, zakres i poziomy pewności
Każda reguła: `jurisdiction`, `effectiveFrom/To`, `taxRegime`, `legalSource`, `schemaVersion`, `reviewer`, `goldenFixtures`, `calculationTrace`, `supportStatus`. Daty faktury, zdarzenia, obowiązywania reguły, płatności, okresu i zaksięgowania rozdzielne.

Rejestr capability (w danych/kontrakcie, nie jako „todo comments”):
```text
CapabilityId + entityProfile + taxYear + legalVersion + mode
  status=planned|experimental|implemented|verified|suspended
  scope=ui|api|mcp|batch, requires=grants & entitlement
  evidence=tests + reference cases + schema checks + independent review
  limitations=visible to user (not fake success)
```
Zawsze dokonywać kontroli aktualności oficjalnych źródeł prawa i XSD. Dobry kod nie oznacza automatycznie poprawnych stawek. Status „verified” nie jest deklaracją posiadania licencji zawodowej przez platformę.

## 6. Kontrakty, migracje i wtyczki
- `@pap/contracts`: API DTO, schemy Zod, status, idempotency, stable `error_code`, request ID. Granica semantyczna zachowana po zmianie modułu i przy MCP.
- Testy kontraktowe **tego samego przykładu** przez UI/API/MCP/worker/PG, bez podmiany realnego API na osobny engine syntetyczny. Dane demo seedowane do odrębnej, syntetycznej DB; offline demo wyraźnie odizolowane, bez pozornej persystencji.
- Integracje KSeF, bank, OCR, marketplace, e-mail przez `port` z wersjonowanym `adapter` i funkcjonalnym mock serverem, jawne scope/credentials, brak vendor SDK w domenie.
- Migracje `expand → backfill/migrate → contract` + reversible deployment plan, test starego i nowego API podczas rollout, test RLS/grantów i restore; historycznych danych finansowych **nie** usuwać w rollback.
- Flagowanie wdrożeń/entitlements deklaratywne po stronie serwera. Moduły mogą być włączane/wyłączane per tenant i profil, ale nie „kasują” ksiąg przy wyłączeniu planu; prawo do eksportu zachowane.
- Nie dodawać kolejek/cache/search engine, dopóki nie ma wymierzonego problemu. Jeśli potrzebny później — przez port, konsekwencje spójności i audytu opisane w ADR.

## 7. Skalowanie od jednej firmy do tysięcy użytkowników
**Strategia bez odgadywania metryk:**
1. **Teraz:** stateless web/API, jedno PG jako source of truth, indeksy w zapytaniach z tenant/entity/period, transakcje i RLS, staging/testy odizolowane, pomiar istotnych ścieżek (import, zatwierdzenie, raport, przygotowanie JPK, MCP). Rzeczywista liczba obsługiwanych użytkowników NIE jest potwierdzona benchmarkiem.
2. **W miarę przyrostu:** background workers i outbox dla OCR, sync, raportów; paginacja i bounded reads; ograniczenia kosztów/tenant, query plans, connection pool, release canary i stopniowe migracje.
3. **Przed dużym SaaS:** reprezentatywne obciążenie syntetyczne (np. 1/100/1000 tenantów, od kilku do setek tysięcy dokumentów — **scenariusz testowy**, nie deklarowana pojemność), SLO zbudowane na pomiarach, rate limits, queue latency, retry safety, backup/restore, off-host encryption, disaster recovery, plan incydentów oraz tenant-noisy-neighbor tests.
4. **Dopiero po danych:** replicas / partitioning / wyodrębnienie kontekstu do osobnej usługi, jeżeli mierzone bottlenecks i economics uzasadniają złożoność. Zachować kontrakty i zgodność danych.

**SaaS control plane** ma własne stany trial/active/past_due itd., plan version, entitlement grants, usage events, payment provider. Billing samej platformy **nie** księguje automatycznie do ksiąg klientów. Obsługa self-hosted pozostaje możliwa zgodnie z licencją; brak lock-in.

## 8. MCP jako równorzędne API — nie UI automation
Wszystkie funkcje mają capability-level parity: jeśli księgowa może *legalnie* wykonać akcję przez UI, istnieje stabilny application use case, który może być użyty przez REST/MCP po niezależnej autoryzacji. Nie oznacza to jednego toola na przycisk; złożone przepływy mają bezpieczne podzielone narzędzia.

Transport adapter bez dostępu do DB/SQL, bez „write everything”; czytelne resources i discovery, minimalne scopes; idempotentne komendy, request correlation, approval digest/TTL, human-in-the-loop, rate/cost limits, consent i revocation, tylko testowe legal workflows, zero samodzielnych deklaracji lub płatności. [Contract MCP](../agents/mcp-native-capability-contract.md).

## 9. Quality fitness functions — techniczny dług pod kontrolą

**Architektura i kod**
- Nie dodawać nowej logiki domenowej do `apps/web/lib/synthetic-workspace.ts` ani `packages/application/src/accounting-workspace.ts` bez decyzji review; najpierw wskazać właściwego ownera. Nie wprowadzać nowego duplikatu księgowej reguły w API, MCP czy UI.
- Test zależności `pnpm test:arch`, ESLint, strict TypeScript, cykli pakietów, jawnych schem i kontraktów przy każdym odpowiednim PR; konfiguracja ograniczeń kompleksowo weryfikowana.
- Zamiast arbitralnego limitu długości pliku mierzyć zmiany: wielkość hotspotu, cyclomatic/decision complexity, liczba niejawnych zależności, stopień powielonego kodu, diff funkcji i pokrycie use case. Wprowadzanie nowych globalnych store'ów wymaga ADR.
- Refaktor następuje po golden master; poprawka merytoryczna i ekstrakcja mogą być w osobnych PR, żeby rozpoznać regresję. Rezygnacja z niewykorzystanego abstrakcyjnego frameworka jest preferowana wobec tworzenia kolejnej warstwy „na zapas”.

**Testy i prawo**
- Każda krytyczna reguła kwotowa: official legal reference/effective date, independently checked golden fixture, property-based cases (rounding, zero, sign, boundary), multi-line/multi-rate, corrected docs i reverse flow.
- Integracja: PG18 RLS, dwie firmy/dwa tenanty, auth/OIDC/revocation, konflikty, retry i timeout/unknown commit, fail-closed.
- Test browser→BFF→REST→PG after restart i *oddzielnie* realny MCP client→API→PG; Playwright screenshot mobile/tablet/desktop, klawiatura i kontrast.
- `PASS` vs `FAIL` vs `NOT RUN` dla SHA oraz środowiska (nie przepisywać statusów starych PR). Zamknięcie P0 wymaga regresji odpowiadającej oryginalnemu błędowi; test disabled/skipped nie spełnia DoD.
- Kod księgowy podlega niezależnemu przeglądowi księgowej/doradcy w granicach kompetencji; AI nie poświadcza zgodności prawnej.

**Security/operations**
- OIDC/MFA i authz wymuszone serwerowo, RLS, least privilege, brak realnych danych i tokenów w GitHub/logach/promptach, skan zależności i bezpieczne aktualizacje, testy izolacji, szyfrowany off-host backup+restore drill.
- Release gates: internal merge ≠ staging deploy ≠ real accounting ≠ public SaaS. Obecne ograniczenia `AGENTS.md` i #100 nadal obowiązują.

## 10. Techniczne DoD dla każdej nowej funkcji
PR lub issue powinien móc odpowiedzieć z dowodem:
1. **Dlaczego:** konkretny użytkownik, firma/profil/rok, outcome i kryteria akceptacji, czy feature jest opcjonalny.
2. **Granica:** właściciel danych, kontrakt, dostępy, zgodność z canonical operation/ledger, migracje i rollout.
3. **Poprawność:** źródła prawa lub wyraźnie brak, deterministyczne kalkulacje i przypadki referencyjne.
4. **Kanały:** UI/REST/MCP (albo uzasadniony brak kanału), ten sam use case, bezpieczny approval.
5. **Test:** pozytywne, negatywne, tenant isolation, idempotency, concurrency, source docs, E2E, celowany perf test.
6. **Odbiór:** PASS/FAIL/NOT RUN, SHA, środowisko, komentarz niezależnego review, screenshots jeżeli UI, handoff/rollback.
7. **Operacyjność:** przywracalność, observability, support, eksport i brak włączenia niezweryfikowanego modułu.

**Zero długu technologicznego nie da się zagwarantować samą zasadą.** Cel to nieakceptowanie *niezarządzanego* długu: każda świadoma kompromisowa decyzja ma ownera, koszt/ryzyko, testy izolujące problem i warunek spłaty. Nie pozostawiać `TODO` bez issue, nie przyjmować magicznego „later” jako pełnego rozwiązania.
