# 16. Zasady architektoniczne (obowiązkowy kontrakt)

**Status:** obowiązują po zaakceptowaniu [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md). Wraz z [ADR-001](adr/001-rdzen-i-mcp.md) tworzą standard dla każdego PR implementacyjnego.

## A. Granice modułów

1. **Modularny monolit, nie „big ball of mud”.** Bounded contexts: `identity-access`, `organizations`, `documents`, `invoicing`, `accounting`, `tax-rules`, `reporting`, `integrations`, `workflow-approvals`, `audit`. Współdzielić tylko małe, stabilne typy i porty.
2. **Domena nie importuje frameworków, ORM, SDK MCP, Next, Nest ani vendor APIs.** Zewnętrzne systemy to adaptery portów. Kod domenowy można testować bez sieci i bazy.
3. **Własność danych:** jeden moduł odpowiada za jeden agregat i jego reguły; inne odczytują przez kontrakty, bez przypadkowych cross-module write-queries.
4. **Jedna ścieżka komend:** UI, API integracji, MCP i zadania w tle przechodzą przez wspólny application service / policy engine. Nie powielać business rules w Next.js ani gatewayu MCP.
5. **Publiczne kontrakty:** OpenAPI v1 + Zod schema, generowany klient, stabilne kody błędów, jawne wersjonowanie breaking changes. Nie eksponować wewnętrznych modeli bazy.
6. **Dependency direction:** `apps -> application -> domain`; `infrastructure -> ports` (implementacja portów), a nie odwrotnie. Sprawdzać reguły importów ESLint dependency boundaries.

## B. Multi-tenant i tożsamość

Kanoniczny kontrakt granic zaufania i uprawnień przed implementacją opisuje [model zagrożeń i uprawnień](18-model-zagrozen-i-uprawnien.md) oraz [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md). Zmiany polityki muszą zachować wspólny policy check dla UI/API/MCP/worker.

7. Każdy odczyt i zapis uwzględnia tożsamość, `tenant_id`, `legal_entity_id`, role, okres i cel działania. `entity_id` w payload nie jest dowodem prawa dostępu.
8. W serwisie zastosuj deny-by-default RBAC/ABAC, plus RLS w PostgreSQL. RLS nie zastępuje kontroli per-action. Runtime role nie ma `BYPASSRLS`, owner-bypass pod kontrolą; testy dla `SET LOCAL` przy poolingu.
9. Wszelkie testy multi-tenant muszą obejmować: poziomą eskalację (firma A → B), historyczne uprawnienia, revoked memberships, masowy export, job worker i MCP.
10. Tożsamość OIDC można wymienić; autoryzacja firm i dokumentów jest wewnętrzna, nie zamknięta w konfiguracji Keycloak. Integracje mają odrębne, ograniczone sekrety.

## C. Poprawność księgowa i aktualność prawa

11. Kwoty wyłącznie w bezstratnym formacie `numeric/Decimal` z walutą i regułami zaokrągleń określonymi dla konkretnego obliczenia. Nie używać JS `number` do podatków, sald, sum Wn/Ma ani wymiany walut.
12. Rozdzielić datę zdarzenia, datę dokumentu, datę obowiązywania reguły, okres podatkowy, datę księgowania i timestamp wykonania. Historia decyzji prawnych jest wersjonowana i odtwarzalna.
13. Reguła podatkowa = źródło urzędowe + daty obowiązywania + wersja + testy referencyjne + aprobata eksperta. Żaden LLM nie jest źródłem obowiązującej stawki, obowiązku lub rozstrzygnięcia prawnego.
14. Korekty przez zdarzenie/korektę, bez nadpisywania zaakceptowanych księgowań. Zamykanie okresów i Wn/Ma egzekwowane transakcyjnie oraz testowane przy współbieżności.
15. Każdy profil działalności ma jawny `supported|experimental|planned`, rok/okres i macierz testów. Dokumentacja nie może ogłaszać obsługi wszystkich firm przed walidacją.
16. Reguły księgowe i wynik walidacji mają `calculation_trace` pozwalający odtworzyć wynik z identycznymi danymi wejściowymi i wersją reguły.

## D. Dokumenty, AI i MCP

17. Oryginały plików immutable, checksum i metadane z odrębną historią; malware scan, content sniffing, quarantine, limity rozmiaru, signed URLs o krótkim TTL, brak public buckets.
18. OCR/LLM to **untrusted input**, również gdy tekst pochodzi z dokumentu, e-maila lub odpowiedzi zewnętrznej. Żadnych instrukcji użytkownika/sekretów wykonanych na podstawie treści faktury.
19. MCP nie ma bezpośrednich uprawnień do DB ani narzędzia „execute arbitrary SQL”. Każdy tool ma jawny schema, scope, politykę, rate limit, audit_event, correlation ID. Read-only jako pierwszy etap.
20. Krytyczna operacja przebiega przez `prepare -> human review -> approve -> execute -> verify`. Token agenta nie może zatwierdzać przygotowanych przez siebie działań. Approval zawiera `hash payload`, expected version, TTL i reautoryzację człowieka.
21. Klucze KSeF, bankowe i podatkowe przechowywać poza LLM, poza logami i poza repo; zewnętrzny model AI tylko przez zaakceptowanego dostawcę przetwarzania danych lub w wariancie lokalnym.

## E. Spójność i współbieżność

22. Operacje finansowe są transakcyjne; dla integracji zdalnych zastosuj outbox/inbox, retry, limit i dead-letter queue. Operacje zewnętrzne mogą zostać wykonane lub potwierdzone ponownie — **idempotency key i reconciliation są obowiązkowe**.
23. Po timeout KSeF/banku nie zakładaj ani sukcesu, ani porażki: sprawdź status po `external_reference` przed ponowną próbą.
24. Nie dodawać cache dla decyzji autoryzacyjnych, sald, ksiąg i stanu wysyłki bez wersjonowania, invalidation strategy i testów; default to correctness.
25. Migracje `expand/migrate/contract`, rollback kompatybilności oprogramowania, snapshot/restore drill. Nie wolno usuwać historycznych danych finansowych w trakcie „rollbacku”.

## F. Observability, dostępność, wydajność

26. Correlation/request ID, OpenTelemetry, jawne kody błędów. Logi mają być użyteczne **bez PII**; payloady, PESEL/NIP, tokeny, pliki i pełne prompty nie mogą trafiać do telemetry.
27. SLO i limity dopiero po profilowaniu realnych wymagań; obowiązkowo testy p95, concurrency, import dużych plików, queue backpressure i anty-DOS przed produkcją.
28. Każda zmiana UI ma uwzględniać WCAG 2.2 AA, czytelne komunikaty walidacji, polskie nazwy domenowe oraz potwierdzenia wyraźnie oddzielające szkic od operacji finalnej.
29. Wszystkie środowiska odseparowane; CI/test/staging nie mają dostępu do produkcyjnego MF ani produkcyjnych danych. Dane testowe zawsze syntetyczne.
30. Dostawcy storage, OCR, tożsamości i urzędowe API są wymienialni dzięki adapterom. Nie dodawać „elastyczności” bez realnego przypadku użycia; YAGNI przy zachowaniu granic kontraktów.

## G. Zasady pracy i Definition of Done

31. Jedno Issue — jeden mały PR (po uzasadnieniu można łączyć). Najpierw aktualne ADR, granice i zależności, potem kod.
32. Testy: unit domeny, DB/integration na realnym PostgreSQL, API contract, security negative, E2E UI/MCP, regresje księgowe i testy idempotencji.
33. Nowy moduł nie może ominąć audytu i autoryzacji; brak testów tenant isolation blokuje merge.
34. Zmiany architektury wymagają **nowego ADR**, opisu alternatyw, kosztu migracji, ryzyk i planu rollbacku. Bez „cichego” zastępowania technologii.
35. Przed PR: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (od momentu bootstrapu); przed wypuszczeniem profilu podatkowego wymagany podpis review merytorycznego.
36. Zero sekretów, danych klientów i poufnych promptów w publicznym repo. Audyt zależności, SAST, secret scanning, pinowane actions/digest obrazu, SBOM przy wydaniach.
37. Brak wdrożeń produkcyjnych, urzędowych wysyłek i zakupów usług bez odrębnej zgody właściciela.

## Egzekwowanie zasad

- `CODEOWNERS` i obowiązkowe review dla modułów finansowych, bezpieczeństwa i podatków (po ustaleniu zespołu); nie tworzyć fikcyjnych reviewerów.
- Automatyczne reguły lint + dependency constraints, schema checks i integration tests.
- CI gate: build/test/secret scan/dependency scan; wymagane approval także przed deploy.
- Testy rozszerzające w `docs/13-kryteria-akceptacji.md`; katalog decyzji `docs/adr/`.
- Każdy wyjątek opisujemy w Issue + ADR z właścicielem, datą przeglądu i zakresem.
