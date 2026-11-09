# Stała bramka jakości QA i macierz weryfikacji oparta na ryzyku (`#85`)

**Status:** obowiązujący mechanizm weryfikacji dla częstych, wąskich PR scalanych do `main` zgodnie z [polityką wewnętrznych merge](../internal-development-merge-policy.md), [ADR-006](../adr/006-tymczasowe-ci-hetzner.md) oraz planem architektury Astra (`#84`).

---

## 1. Cel i zasady nadrzędne

1. **Weryfikowane niezmienniki zamiast liczby testów:** sukces zmiany oceniamy po deterministycznych dowodach zachowania niezmienników (w tym scenariuszy negatywnych i kontrprzykładów na rzeczywistym PostgreSQL 18.6), a nie po samym zielonym zestawie testów jednostkowych.
2. **Jawne rozróżnienie `@pap/db` oraz `@pap/api` w testach integracyjnych:** historyczne polecenie główne `pnpm test:integration` uruchamiało wyłącznie pakiet `@pap/db`. Każda zmiana dotykająca trwałości, transakcji, autoryzacji, OIDC lub runtime HTTP musi jawnie wykonać **oba** zestawy na izolowanym Hetznerze:
   - `pnpm --filter @pap/db test:integration` (`pnpm test:integration:db`)
   - `pnpm --filter @pap/api test:integration` (`pnpm test:integration:api`)
   - oraz zestaw kontrprzykładów `pnpm --filter @pap/api test:adversarial` (`pnpm test:adversarial`).
3. **Proporcjonalność dla dokumentacji i kodu nieaktywnego:** PR-y zmieniające wyłącznie dokumentację (`docs/**`, `README.md`) lub narzędzia QA przechodzą szybki preflight (`pnpm qa:preflight` + `pnpm test:arch`) i nie są blokowane przez nieuruchomione testy integracyjne ani otwarte regresje w nienaruszonych modułach wykonawczych.
4. **Uczciwość raportowania (`PASS` vs `FAIL` vs `NOT RUN`):** żaden niewykonany test nie może zostać oznaczony jako `PASS`. Dowody testowe są ważne wyłącznie dla dokładnego `HEAD SHA`.
5. **GitHub Actions pozostaje wyłączone:** automatyczne wyzwalacze w `.github/workflows/ci.yml` są wyłączone; skrypt preflight blokuje ich przypadkowe włączenie.

---

## 2. Macierz powierzchni ryzyka (`2026-11-09.1`)

Implementacja maszynowa znajduje się w [`scripts/qa/verification-matrix.mjs`](../../scripts/qa/verification-matrix.mjs).

| Kod       | Powierzchnia                  | Ścieżki w repozytorium                                                                                                                                                                                                                                                                   | Obowiązkowe testy przed Merge-to-Main                                                                                                                                                         | Kluczowe scenariusze negatywne / kontrprzykłady                                                                                                                                                                                                                                                                                                                          |
| --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a)**   | `db_transaction_provisioning` | `packages/db/**`, `packages/application/src/{transactional-unit-of-work,accounting-workspace}.ts`, `apps/api/src/{runtime,controllers}/**`                                                                                                                                               | `qa:preflight`, `test:arch`, `typecheck`, `lint`, `test`, **Hetzner PG18:** `@pap/db test:integration` **+** `@pap/api test:integration` **+** `@pap/api test:adversarial`, niezależny review | Dwie instancje API ładują tę samą firmę F i naprzemiennie zapisują/czytają (`#79`); wstrzymany zapis i `ROLLBACK` niewidoczny dla czytelników; 20 równoczesnych tworzeń tego samego NIP (`#80`); utrata potwierdzenia `COMMIT` (`503 transaction_outcome_unknown`); powtórzony klucz idempotencji z innym payloadem (`409`); brak fallbacku `PAP_MIGRATOR_DATABASE_URL`. |
| **(b)**   | `oidc_rls_tenant`             | `apps/api/src/auth/**`, `apps/web/lib/session.ts`, `packages/application/src/{oidc-authentication,tenant-authorization,access-management,security-audit}.ts`, `packages/db/src/{runtime-security,signed-context,security-audit,tenant-authorization,access-management,user-identity}.ts` | `qa:preflight`, `test:arch`, `typecheck`, `lint`, `test`, **Hetzner PG18:** `@pap/db test:integration` **+** `@pap/api test:integration` **+** `@pap/api test:adversarial`, niezależny review | Odmowa cross-tenant (`403`), natychmiastowa blokada po cofnięciu członkostwa/grantu (`6D-R`), brak wycieku `pap.context` przy reużyciu połączenia z puli, awaria zapisu audytu wycofująca transakcję, odrzucenie spoofingu nagłówków (`401`).                                                                                                                            |
| **(c)**   | `money_legal_rules`           | `packages/domain/**`, `packages/contracts/**`                                                                                                                                                                                                                                            | `qa:preflight`, `test:arch`, `typecheck`, `lint`, `test`, niezależny review merytoryczny                                                                                                      | Zakaz `float`/`number` dla kwot; odrzucenie kwot spoza zakresu bezpiecznych groszy (`400`); odrzucenie niezbilansowanego dekretu `Wn !== Ma` (`422`); `UnverifiedLegalRuleError` dla reguł niezweryfikowanych; dobór wersji reguły na dzień zdarzenia (`resolveRuleAtDate`).                                                                                             |
| **(d)**   | `mcp_import`                  | `apps/mcp/**`, `apps/api/src/mcp/**`, `packages/application/src/{mcp-gateway,document-import-parsers,notifications-engine}.ts`                                                                                                                                                           | `qa:preflight`, `test:arch`, `typecheck`, `lint`, `test`, niezależny review (+ integracje PG18 przy zmianie persystencji)                                                                     | Neutralizacja prompt injection i Unicode Bidi; zakaz samo-zatwierdzenia propozycji przez token agenta (`403 agent_self_approval_forbidden`); odrzucenie XML z DTD/XXE (`400`) i duplikatu `SHA-256` (`409`).                                                                                                                                                             |
| **(e)**   | `docs_dormant`                | `docs/**`, `README.md`, `scripts/qa/**`, `test/qa-gate.test.ts`                                                                                                                                                                                                                          | `qa:preflight`, `test:arch` (oraz `test/qa-gate.test.ts` przy zmianie narzędzi QA)                                                                                                            | Brak przypadkowych sekretów, tokenów, niezamaskowanych wolumenów `HC_Volume_<ID>` i surowych adresów IP.                                                                                                                                                                                                                                                                 |
| **(gov)** | `governance_infra_alert`      | `AGENTS.md`, `.github/**`, `scripts/hetzner/**`, `infra/**`, `compose.yaml`                                                                                                                                                                                                              | Wszystkie kontrole statyczne + osobna zgoda właściciela projektu                                                                                                                              | Blokada włączenia wyzwalaczy GitHub Actions; zachowanie limitów cgroups v2 i izolacji sieciowej runnera Hetzner.                                                                                                                                                                                                                                                         |

---

## 3. Rozróżnienie bramki wewnętrznego Merge od Release GO

| Bramka                                                  | Znaczenie i wymagane warunki                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wewnętrzny Merge do `main`**                          | Zgodny z [polityką wewnętrznych merge](../internal-development-merge-policy.md). Pozwala częściej integrować małe, zweryfikowane pionowe wycinki (vertical slices). Dla powierzchni `(a)`–`(d)` wymaga przejścia obowiązkowych testów na końcowym SHA oraz niezależnego przeglądu (autor != reviewer). **Nie stanowi zgody na wdrożenie ani dowodu gotowości komercyjnej.** |
| **Prywatny Staging (`ksiegowosc.roleplayingtech.com`)** | Wymaga osobnej zgody właściciela projektu przed jakimkolwiek restartem usługi, migracją bazy lub zmianą konfiguracji Nginx.                                                                                                                                                                                                                                                 |
| **Zamknięta Beta / Produkcja komercyjna**               | Wymaga domknięcia wszystkich czterech fal planu Astra (`#79`–`#83`), formalnego odbioru każdego aktywnego profilu przez licencjonowanego doradcę podatkowego, testów wydajnościowych i odtworzenia kopii zapasowej (restore drill) oraz podpisania manifestu wydania przez właściciela.                                                                                     |

---

## 4. Lokalizacja testów regresji adversarial

Stałym miejscem dla deterministycznych testów kontrprzykładów odkrywających błędy współbieżności, spójności wieloinstancyjnej i autoryzacji jest katalog:

- [`apps/api/test/adversarial/`](../../apps/api/test/adversarial/) (konfiguracja: [`apps/api/vitest.adversarial.config.ts`](../../apps/api/vitest.adversarial.config.ts)).

Każdy wykryty błąd P0/P1 (począwszy od `#79` i `#80`) otrzymuje najpierw test reprodukujący usterkę na niezodyfikowanej bazie (czerwony wynik przed poprawką), który po wdrożeniu poprawki staje się stałym testem regresyjnym (zielony wynik na docelowym SHA).

---

## 5. Polecenia wykonawcze

```bash
# 1. Lokalny preflight gałęzi, skan sekretów i klasyfikacja ryzyka względem origin/main
pnpm qa:preflight

# 2. Izolowany preflight zasobów i cgroups v2 na serwerze Hetzner (wyłącznie odczytowy)
scripts/qa/run-hetzner-qa.sh --preflight-only --port 55432 --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral

# 3. Uruchomienie testów technicznych na Hetznerze przed uzyskaniem zatwierdzenia review (kod wyjścia 0 z jawnym statusem mergeReady=false)
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/qa/run-hetzner-qa.sh \
  --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral \
  --port 55432 \
  --scope full \
  --allow-technical-pass-only \
  --report-json /tmp/qa-report.json \
  --report-md /tmp/qa-report.md

# 4. Pełna weryfikacja bramki merge z weryfikowalnym dowodem niezależnego review (kod wyjścia 0 wyłącznie przy READY_FOR_MERGE; kod 2 przy braku dowodu governance)
PAP_ALLOW_HETZNER_EPHEMERAL_PG=1 scripts/qa/run-hetzner-qa.sh \
  --work-root /mnt/HC_Volume_<ID>/pap-ci-ephemeral \
  --port 55432 \
  --scope full \
  --review-evidence-json /tmp/independent-review.json \
  --report-json /tmp/qa-report.json \
  --report-md /tmp/qa-report.md
```

---

## 6. Weryfikowalne dowody Governance i kody wyjścia (`2026-11-09.1`)

Bramka QA nie akceptuje samodeklarowanych zmiennych środowiskowych (`PAP_INDEPENDENT_REVIEW_STATUS` zostało usunięte). Konsumenci automatyczni rozróżniają wynik za pomocą kodu wyjścia oraz pól `mergeReady`, `gateStatus` i `recommendedExitCode` w raporcie JSON:

- **Kod wyjścia `0` (`READY_FOR_MERGE`):** wszystkie wymagane testy techniczne mają status `PASS`, sprzątanie zasobów `cleanupVerified === true`, a wymagane dowody governance (`independentReview` oraz — dla migracji/infra — `ownerApproval`) są kryptograficznie powiązane z `HEAD SHA` lub `HEAD^{tree}`, wystawione przez podmiot różny od autora (`reviewerId !== authorId`) i mają `unresolvedFindingsCount === 0`.
- **Kod wyjścia `2` (`TECHNICAL_PASS_PENDING_GOVERNANCE`):** wszystkie testy techniczne przeszły (`technicalChecksValid === true`), lecz brakuje weryfikowalnego dowodu niezależnego przeglądu lub zgody właściciela (`governanceValid === false`, `mergeReady === false`, werdykt `NO-GO (TECHNICAL PASS — PENDING GOVERNANCE APPROVAL)`). Flaga `--allow-technical-pass-only` służy wyłącznie do uruchomień przed review i nadal zapisuje `mergeReady: false` w raporcie.
- **Kod wyjścia `1` (`TECHNICAL_FAIL`):** przynajmniej jeden wymagany test techniczny ma status `FAIL` lub `NOT RUN`, wystąpił błąd sprzątania albo niezgodność SHA (`NO-GO (KEEP DRAFT)`).
