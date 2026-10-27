# ADR-002 — Stos technologiczny i architektura wdrożeniowa

- **Status:** PR do przyjęcia jako bazowa decyzja architektoniczna
- **Data:** 2026-10-26
- **Powiązania:** [Issue #2](https://github.com/RolePlayingTech/polish-accounting-platform/issues/2), [ADR-001](001-rdzen-i-mcp.md), [zasady](../16-zasady-architektoniczne.md)
- **Zakres:** budowa oprogramowania; brak wdrożenia i zakupów

**Aktualizacja sposobu pracy (2026-10-27):** [ADR-005](005-rozwoj-lokalny.md) ustala bieżący rozwój wyłącznie lokalny, bez Dockera, przygotowywania serwera i deploymentu. Stos pozostaje zgodny z tym ADR; opis infrastruktury i stage/prod poniżej jest odroczonym kierunkiem.

## Kontekst i cele

Budujemy polską aplikację finansowo-księgową, w której błędna autoryzacja, utrata dokumentu, duplikat księgowania lub niewłaściwa reguła prawna mają wysoką wagę. Interfejs webowy, importy i MCP muszą wykonywać te same operacje domenowe. Pierwszy etap ma być dostępny dla małego zespołu, ale model musi rozszerzyć się na wiele organizacji, spółek, profili podatkowych i integracji bez przepisywania systemu.

Priorytety, w kolejności: **poprawność i bezpieczeństwo > audytowalność > utrzymywalność > koszt operacyjny > skalowanie > szybkość prototypowania**.

## Decyzja: konkretny stos bazowy

| Warstwa | Wybór | Warunki |
| --- | --- | --- |
| Język | TypeScript, `strict`, ESM | wspólny typowany kontrakt; żadnych implicit `any` w domenie |
| Runtime | **Node.js 24 LTS** | pin wersji patch w obrazie i CI, aktualizacje bezpieczeństwa; Node 26 dopiero po wejściu w LTS i walidacji |
| Web | **React + Next.js App Router** | renderowanie UI, bez bezpośredniego dostępu do ksiąg/DB z Next.js |
| UI | **Tailwind CSS + shadcn/ui (Radix)** | dostępność WCAG 2.2 AA, polski język, brak frameworka narzucającego model domenowy |
| API | **NestJS + FastifyAdapter** | moduły bounded context, OpenAPI `/api/v1`, limity i server-side authorization |
| Walidacja kontraktów | **Zod + OpenAPI** | `packages/contracts`, jawne kontrakty, generowanie client SDK; brak bezwarunkowego zaufania typom TS |
| Baza | **PostgreSQL** (wspierana stabilna linia) | ACID, FK, constraints, RLS, transakcje, indeksy; wersja konkretna w lockfile/IaC |
| DB layer | **Drizzle ORM + jawny SQL** | migracje reviewowane; SQL dla constraints, locking, ledger i RLS |
| Asynchroniczność | **pg-boss + oddzielne workery** | Postgres-backed queue na początek; retry, DLQ, idempotencja, limit concurrency |
| Pliki | **S3-compatible object storage** | szyfrowanie w spoczynku, TLS, wersje/retencja, hash, brak publicznych bucketów |
| Identity | **OIDC/OAuth 2.x**, referencyjnie **Keycloak** | MFA, PKCE, JWKS, short-lived scoped tokens; provider za adapterem; authZ w API |
| MCP | **oficjalny TypeScript MCP SDK** | Streamable HTTP, wersja protokołu obsługiwana przez SDK, OAuth resource server, osobny gateway |
| Observability | **OpenTelemetry + strukturalne logi** | PII redaction, correlation IDs; exporter i monitoring wymienialne |
| Monorepo | **pnpm workspaces + Turborepo** | jeden lockfile, spójne zależności, cache tylko bez sekretów |
| Testy | **Vitest, Playwright, Testcontainers** | testy jednostkowe, kontraktowe, izolacji tenantów, race conditions, e2e |
| Infrastruktura | **Docker/Compose (dev), OpenTofu (stage/prod)** | managed containers, PostgreSQL i object store w UE/EOG; bez Kubernetes w MVP |
| CD | **GitHub Actions** | code scanning, SBOM, review, ręczna bramka deploy; bez sekretów w PR forks |

**Wersje frameworków i bibliotek:** wybierać stabilne, wspierane, wzajemnie kompatybilne wydania podczas bootstrapu w #5, przypiąć w `package.json`/`pnpm-lock.yaml` i aktualizować Renovate/Dependabot z testami. Nie używać automatycznie `latest` na produkcji. Na dzień 2026-10-26 Node 26 to jeszcze Current (LTS zaplanowane na 2026-10-28), dlatego bazą jest Node 24 LTS.

## Styl architektoniczny

**Modularny monolit, odrębne procesy wejścia i przetwarzania.** Moduły domenowe nie zależą od Next/Nest/MCP/ORM i komunikują się przez interfejsy/komendy. Wewnętrzne granice są wyraźne; każde `apps/*` może składać te same use-cases, ale jedynym właścicielem mutacji pozostaje API/core. MCP nie ma własnych algorytmów podatkowych, nie posiada bezpośredniego dostępu do bazy i nie omija polityk API. Workery wykonują kontrolowane komendy aplikacyjne (ten sam core), nigdy nie wprowadzają bocznej ścieżki zmiany ksiąg.

- Zewnętrzny kontrakt: REST + OpenAPI v1, jawne DTO, pagination, rate limits, problem details/error codes i ewolucja kompatybilna wstecz.
- Integracje: porty i adaptery KSeF, JPK, REGON, NBP, banki, OCR i LLM; domyślne fake/test implementations.
- Dane i schematy prawne są wersjonowane: `effective_from/to`, `rule_version`, `source_reference`, review eksperta; historyczne wyliczenia powtarzalne.
- Pośredni messaging: transakcyjna publikacja jobs/outbox, consumer deduplication i idempotentne side effects. Nie zakładać dokładnie-jeden-raz wykonania zewnętrznego API.

### Dlaczego nie mikroserwisy?

Konteksty mogą zostać oddzielone po zmierzeniu rzeczywistych granic obciążenia, autonomii zespołów lub wymagań izolacji. W pierwszym etapie sieciowe transakcje i rozproszona autoryzacja zwiększają ryzyko błędów; modułowy monolit daje prostsze ACID i review.

## Izolacja danych i poprawność finansowa

1. `tenant_id` i `legal_entity_id` są obowiązkowymi elementami modelu tam, gdzie mają zastosowanie; kontekst dostępu pochodzi z serwerowej tożsamości i uprawnień, a nie z dowolnego argumentu MCP.
2. **Defense in depth:** ABAC w use-case/API + PostgreSQL RLS tam, gdzie możliwe. Jednorazowe ustawienie kontekstu DB wyłącznie w transakcji (`SET LOCAL` / `set_config(..., true)`), dedykowana rola runtime bez `BYPASSRLS`, testy connection pooling i cross-tenant.
3. Wartości finansowe: PostgreSQL `numeric`, TS `decimal.js` (albo jawny typ Money oparty o integer minor-units tam gdzie bezstratny); żadnych JS `number`/float dla kwot i kursów. Waluta i precyzja jawne. Daty księgowe jako `date`, timestampy UTC, kalendarz firmy i `Europe/Warsaw` w logice terminów.
4. Zatwierdzone wpisy księgowe nie są edytowane in-place: korekty/odwrócenia, niezmienny audit trail; kontrola zamkniętych okresów, spójność Wn/Ma jako atomowa transakcja.
5. Oryginalne dokumenty write-once, SHA-256, atrybuty dostępu/retencji i wersje metadanych; skan antywirusowy przed udostępnieniem, kwarantanna przy błędzie.

## MCP i zaufanie do AI

- MCP to **zewnętrzna powierzchnia dostępu**, odseparowana wdrożeniowo od API i domeny; wywołuje to samo API/use-case z tożsamością użytkownika.
- Obsługiwać **aktualną stabilną wersję** protokołu wspieraną przez wybrane wydanie SDK (w tym wersję 2026-07-28, gdy weryfikacja interoperacyjności przejdzie), a kompatybilność z klientami 2025-11-25 testować zgodnie z SDK. **Nie projektować własnej obsługi sesji/handshake**, bo rewizje protokołu się różnią.
- OAuth/OIDC z discovery/protected-resource metadata, weryfikacją `iss`, `aud`, `exp`, zakresów i token binding do odbiorcy; `Origin`/`Host` validation, SSRF protection, per-tenant rate limiting.
- Początkowo read-only. Przygotowanie draftu nie jest zaksięgowaniem; wysyłki do urzędów, płatności i księgowanie wymagają osobnego, jawnego zatwierdzenia przez człowieka po ponownej autoryzacji w UI. Token agenta nie może samoistnie zatwierdzać własnego draftu.
- OCR i LLM są niezaufanymi parserami sugestii. Żadnego wykonywania instrukcji znalezionych w PDF/XML; no PII in external AI without approved processor and explicit admin setting.

## Środowiska i wdrażanie

| Środowisko | Tożsamość/dane | Integracje zewnętrzne | Cel |
| --- | --- | --- | --- |
| Local | syntetyczne, lokalny OIDC/Keycloak, PostgreSQL, MinIO | mock/test | Docker Compose i developer experience |
| CI | ephemeral testcontainers, synth fixtures | stubs; egress allowlist | testy i scanning, nigdy produkcyjne KSeF |
| Staging | oddzielna organizacja i zasoby, fikcyjne dane | sandbox/test MF; ścisłe credentials | testy odtworzenia, migracji, obciążenia |
| Production | region UE/EOG, oddzielne konta, szyfrowanie/KMS, MFA | tylko jawnie zatwierdzone adaptery | wyłącznie po audycie i zgodzie właściciela |

- Backup PITR, cykliczny restore drill, RPO/RTO zdefiniowane przed uruchomieniem (na etapie E0 nie deklarujemy niezweryfikowanych liczb).
- Migracje forward-compatible (expand/migrate/contract), blokady rollout gdy migracja niekompatybilna; rollback aplikacji nie może cofać wpisów finansowych.
- Utrzymywać monitoring error rate, p95, saturację DB, czas kolejki, brakujące zdarzenia audytu, błędy integracji i koszty. Logi nie zawierają dokumentów, tokenów, NIP/PESEL itp.
- Horizontal scaling API/MCP bez sticky sessions (dla modern MCP); workery skalowane oddzielnie. PostgreSQL może być pionowo wzmacniany, partycjonowany i z replikami do odczytu; krytyczne operacje na writerze.

## Rozważone warianty

| Wariant | Zalety | Wady / decyzja |
| --- | --- | --- |
| Next.js full-stack + baza bez osobnego API | szybki start, mniej serwisów | zbyt silne sprzężenie UI, MCP i domeny: **odrzucone** |
| NestJS + Fastify, modułowy monolit | spójne use-cases, DI, czytelne moduły, skalowanie API | pewien narzut Nest: **wybrany** |
| Fastify bez Nest | mniejszy narzut, duża kontrola | wymaga ręcznego standardu modularności/DI: rezerwowy wariant |
| Mikroserwisy od początku | niezależne wdrożenia | transakcje rozproszone, wyższy koszt i complexity: **odroczone** |
| Prisma zamiast Drizzle | wygodne relacje i generator | większe rozbieżności w zaawansowanym SQL/RLS; **nie wybrane** |
| Redis/BullMQ zamiast pg-boss | skalowalna, odrębna kolejka | dodatkowy stan i utrzymanie; rozważyć po benchmarkach |
| Zewnętrzny SaaS auth zamiast Keycloak | mniejsza administracja | zależność dostawcy i koszt; OIDC adapter pozwala wymienić |
| Kubernetes od początku | automatyzacja orkiestracji | nadmiar operacji w MVP: nie teraz |

## Koszt i trade-offs

MVP wymaga minimum: 1 web container, 1 API container, 1 MCP gateway, 1 worker, managed PostgreSQL, S3 storage, OIDC provider, backup/monitoring. Największe koszty zmienne: OCR/LLM, retencja plików, egress, backup, utrzymanie tożsamości. Nie obiecujemy konkretnego budżetu bez estymacji ruchu i wybranego dostawcy. Brak Redis/K8s ułatwia start; cena to ograniczona przez Postgres przepustowość kolejki i konieczność testów.

## Warunki rewizji ADR

Rewidować po pomiarach: przeciążenie pg-boss/DB, silnie różne SLA integracji, potrzeba niezależnego skalowania kontekstu, ograniczenia Nest/Next przy konkretnych testach, wymagania bezpieczeństwa dostawcy. **Zmiana musi mieć nowy ADR, analizę migracji danych, kosztów, testów i bezpieczeństwa.** Nie wymieniać technologii tylko dlatego, że pojawiła się nowsza.

## Przydatne źródła techniczne (stan na 2026-10-26)

- Node.js Release: https://github.com/nodejs/Release
- Next.js App Router: https://nextjs.org/docs/app
- NestJS FastifyAdapter: https://docs.nestjs.com/techniques/performance
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- Drizzle RLS: https://orm.drizzle.team/docs/rls
- pg-boss: https://pgboss.io/introduction
- MCP Specification: https://modelcontextprotocol.io/specification
- MCP TypeScript SDK v2: https://ts.sdk.modelcontextprotocol.io/
- Keycloak: https://www.keycloak.org/docs/latest/
