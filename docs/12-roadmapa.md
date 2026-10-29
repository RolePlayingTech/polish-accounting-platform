# 12. Roadmapa i backlog wdrożeniowy

## Strategia

**Najpierw bezpieczny fundament dokumentowy i MCP, następnie księgowanie profil po profilu.** Wspólna architektura obsłuży różne typy działalności, ale poszczególnych rozliczeń nie można wdrożyć skrótowo. Zależności są ważniejsze niż liczba feature'ów.

## Etap 0 — zatwierdzenie specyfikacji i standardów

- [ ] `E0-01` Zatwierdzić nazwę, licencję, repo, odpowiedzialnych za review podatkowe i bezpieczeństwa.
- [ ] `E0-02` Określić pierwszą grupę odbiorców: JDG KPiR czy sp. z o.o. (sugerowana JDG KPiR).
- [ ] `E0-03` Matryca profilu JDG: księgi, VAT, ZUS i granice odpowiedzialności; próbki syntetyczne.
- [x] `E0-04` Wybrany stos i zasady wdrożeń: [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md). Konkretnego hostingu, kosztów i operacyjnej konfiguracji OIDC nie wybieramy przed uruchomieniem. Bez produkcyjnego deploymentu.
- [ ] `E0-05` Utworzyć rejestr źródeł, wersji schem i obowiązków aktualizacji; wskazać opiekuna merytorycznego.
- [ ] `E0-06` Przygotować test threat-model i matrycę roli → narzędzia MCP → operacje domenowe.

**Bramka:** jednoznacznie ustalony profil pilota, zagrożenia, kryteria odbioru.

**Warunek dla #3 i #5:** rozróżnić operatora platformy, administratora tenanta i użytkownika firmy. Nie budować publicznego panelu administracyjnego bez serwerowej autoryzacji i nie implementować płatności w E1. Kierunek: [ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md).

## Etap 1 — szkielet techniczny i dokumenty (pierwszy MVP)

- [x] `E1-01` Monorepo pnpm/Turborepo, lint/typecheck/test/build oraz przeglądarkowy E2E web → API i lokalne web/API/MCP STDIO. Rozwój lokalny przez `pnpm dev` działa bez DB i bez Dockera ([ADR-005](adr/005-rozwoj-lokalny.md)), równolegle z prywatnym stagingiem technicznym Web/API Etapu A na serwerze Hetzner ([ADR-006 — staging](adr/006-prywatny-staging-hetzner.md)) oraz izolowanym CI na Hetznerze przy wstrzymanym GitHub Actions ([ADR-006 — CI](adr/006-tymczasowe-ci-hetzner.md)). Pakiet 6A dostarcza techniczny fundament PostgreSQL/Drizzle i ręczne migracje. Realny stan: [17 — struktura repo](17-struktura-repo-i-standardy.md), [19 — przewodnik developera](19-przewodnik-developera.md), [20 — strategia testów](20-strategia-testow.md).
- [ ] `E1-02` OIDC/MFA, tenant i wybór firmy, role, audyt logowania i odmów.
- [ ] `E1-03` Model `legal_entity` / `tax_subject` / `entity_profile_version` i uprawnienia zależne od czasu.
- [ ] `E1-04` Magazyn oryginałów + upload + antywirus + hash + deduplikacja + retencja.
- [ ] `E1-05` Rejestr dokumentów, klasyfikacja ręczna, wyszukiwanie i kolejka do weryfikacji.
- [ ] `E1-06` Adapter OCR/LLM jako funkcja opcjonalna, pola ze źródłem, bez samoczynnego zapisu do ksiąg.
- [ ] `E1-07` Bank CSV/MT940/CAMT importowany i bezpiecznie dopasowywany do dokumentów.
- [ ] `E1-08` Pulpit, zadania, kalendarz, podstawowe eksporty, UX testy dostępności.

Zakres [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6) obejmuje scaloną czystą politykę grantów (6C, PR #16), scalony fundament PostgreSQL/Drizzle (6A, PR #17) i schemat 6B (PR #18): tenanty, firmy, członkostwa, wersje profilu oraz jawne granty z testami integralności ([model 6B](22-schemat-tenantow-6b.md)). [6D-1](23-adapter-autoryzacji-6d1.md) dodaje adapter DB portu autoryzacji, testy decyzji i propozycję kontraktu tożsamości. Nie oznacza to ukończenia `E1-02` ani `E1-03`: OIDC, egzekwowanie polityki w API/MCP, bezpieczny cykl reaktywacji członkostwa, audyt, RLS i izolacja odczytów end-to-end pozostają kolejnymi etapami. Issue #6 pozostaje otwarte; nie ma obsługi firm w UI ani wdrożenia produkcyjnego.

**Bramka:** syntetyczne faktury różnych firm nie przeciekają między kontami; żaden ekstraktor nie zmienia oryginałów; backup odtwarzalny.

## Etap 2 — MCP oraz kontrola działań

**Aktualizacja #6 / 6D-R i 6D-2 na `main` oraz kandydat 6D-3 (2026-10-29):** na `main` scalono [bezpieczny cykl dostępu 6D-R](24-bezpieczny-cykl-dostepu-6dr.md) (PR #21) oraz [serwerowe uwierzytelnianie OIDC i mapowanie tożsamości 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) (PR #25: `JwksOidcAccessTokenVerifier`, `PostgresUserIdentityResolver`, autoryzacja `manageAccess` i guard HTTP na kontrolerze testowym). Z kolei kandydat **6D-3** (transakcyjny `UnitOfWork`, ograniczona rola runtime DB, podpisany kontekst HMAC, `FORCE RLS` i audyt decyzji `allow/deny` wraz z poprawkami `SEC-01`–`SEC-05`) znajduje się wyłącznie w otwartych Draft PR-ach przed końcową integracją i odbiorem QA ([plan QA 6D-3](6D3_SECURITY_QA_ACCEPTANCE_PLAN.md)). Interaktywne logowanie UI, wybór firmy (`6E`), izolacja danych w publicznym API/MCP oraz odbiór `6D-3` nadal blokują pierwszy dostęp użytkowników końcowych. Issue #6 pozostaje otwarte; brak wdrożenia produkcyjnego i brak danych firmowych na stagingu.

- [ ] `E2-01` Serwer MCP Streamable HTTP, discovery/auth, scope’y, logowanie i limity.
- [ ] `E2-02` Narzędzia read-only `entities`, `documents`, `invoices`, `calendar`.
- [ ] `E2-03` `prepare_*` / draft / idempotency; zatwierdzanie w UI z TTL i hashem.
- [ ] `E2-04` Narzędzia do odczytu zaakceptowanych reguł prawa i statusu integracji.
- [ ] `E2-05` Testy izolacji podmiotów, tokenów, prompt injection, replay, odmów i log leakage.

**Bramka:** 0 zapisów krytycznych przez nieautoryzowanego klienta, wszystkie operacje w audycie.

## Etap 3 — Polska zgodność: pierwszy profil

- [ ] `E3-01` Ukończyć zweryfikowaną matrycę JDG KPiR na rok pilota i testy graniczne.
- [ ] `E3-02` Rejestr VAT i kwalifikacja transakcji z udokumentowaną regułą.
- [ ] `E3-03` KSeF 2.0: uwierzytelnienie, odbiór, identyfikatory i synchronizacja (najpierw test, potem produkcja za zgodą).
- [ ] `E3-04` Przygotowanie wystawiania KSeF, walidacje FA(3), akceptacja, status/UPO, obsługa błędów.
- [ ] `E3-05` KPiR, rozrachunki, korekty i walidacja okresu.
- [ ] `E3-06` JPK_V7M(3)/V7K(3) i JPK_PKPIR/ST w zakresie rzeczywistego obowiązku, testy XSD i cross-check z księgami.
- [ ] `E3-07` Pilotaż na syntetycznych danych oraz profesjonalny przegląd zgodności; po nim ograniczony pilotaż prawdziwych danych, jeśli spełniono warunki RODO i bezpieczeństwa.

**Bramka:** odtwarzalny wynik rozliczeń, zatwierdzenie eksperta, poprawna walidacja XSD i uprawnienia do wysyłki.

## Etap 4 — kolejne profile i pełne księgi

- [ ] `E4-01` JDG na ryczałcie: ewidencja przychodów i JPK_EWP/ST w odpowiednich latach, wybór właściwych stawek.
- [ ] `E4-02` Osobny moduł pełnych ksiąg: plan kont, dzienniki, Wn/Ma, uzgodnienia, zamykanie okresów.
- [ ] `E4-03` Sp. z o.o.: CIT, JPK_KR_PD/ST_KR, e-Sprawozdania według odrębnego zestawu testów.
- [ ] `E4-04` Spółki osobowe i cywilne: oddzielenie podatku podmiotu i wspólników.
- [ ] `E4-05` Rejestry publiczne i walutowe, bankowe integracje i automatyzacja zadań.

**Bramka:** certyfikacja/testy każdego profilu zamiast flagi „obsługa wszystkich spółek”.

## Etap 5 — rozszerzenia

- [ ] `E5-01` Biuro rachunkowe, wielu klientów, delegacje, umowy powierzenia.
- [ ] `E5-02` Kadry i płace, ZUS, PPK — odrębna domena i uprawnienia.
- [ ] `E5-03` Podatki specjalistyczne (CIT estoński, OSS/IOSS, WHT), NGO/fundacje i pozostałe profile.
- [ ] `E5-04` Integracje bankowe przez uprawnionego dostawcę, import poczty, dashboardy.
- [ ] `E5-05` Zaawansowane procesy AI z MCP, nadal z kontrolą człowieka.
- [ ] `E5-06` Opcjonalny SaaS: plany i entitlementy, limitowanie na serwerze oraz integracja billingowa dopiero po decyzji biznesowej; bez blokowania ustawowych obowiązków i eksportu danych.

## Zalecana kolejność pierwszych PR-ów

1. [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md) i [zasady architektury](16-zasady-architektoniczne.md); następnie threat-model (#3) i profil podatkowy (#1/#4).
2. Logowanie + struktura tenantów (nie dokumenty przed izolacją dostępu).
3. Dokumenty + audyt + oryginały.
4. MCP read-only + testy uprawnień.
5. OCR i szkice operacji z zatwierdzeniami.
6. KSeF odbiór i korekta błędów synchronizacji.
7. Księgi dla jednego profilu z testami prawno-podatkowymi.

## Jak dzielić zadania dla agentów AI

Każda sprawa/issue musi określić: **cel, profil firmy, okres prawny, zakres poza zadaniem, źródła, zależności, API/schema, testy, zagrożenia, Definition of Done**. Agent nie ma samodzielnie przyjmować nowych stawek podatkowych ani deklarować pełnej zgodności. Nie scalać funkcji finansowych bez testów i review osoby kompetentnej.

## Szablon Definition of Done

- [ ] Wymaganie i scenariusz opisane w Markdown.
- [ ] Zmiana ma testy automatyczne oraz co najmniej jeden przypadek błędny.
- [ ] Zmiany reguł mają źródło urzędowe, zakres dat i weryfikację merytoryczną.
- [ ] Żadnych sekretów ani realnych danych w repo/CI.
- [ ] Weryfikacja uprawnień w API i MCP.
- [ ] Logi i audyt prawidłowe, bez danych wrażliwych.
- [ ] Migracja/rollback/test odtwarzalności i dokumentacja zmian.
- [ ] Test integracyjny nie wysyła przypadkowo danych do urzędu produkcyjnego.

## Kanoniczna kolejka GitHub Issues — bootstrap (2026-10-26)

Zadania do wykonania są prowadzone w [GitHub Issues](https://github.com/RolePlayingTech/polish-accounting-platform/issues). Ten spis jest mapowaniem etykiet z roadmapy na konkretne, niewielkie zadania; nie otwieraj duplikatów.

| Kolejność | Zakres roadmapy                      | Issue                                                                         | Stan / Start                                                                                         |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1         | E0-02 / E0-03 — profil pilota        | [#1](https://github.com/RolePlayingTech/polish-accounting-platform/issues/1)  | Otwarte; można niezależnie                                                                           |
| 2         | E0-04 — ADR stosu                    | [#2](https://github.com/RolePlayingTech/polish-accounting-platform/issues/2)  | Zamknięte ([ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md), PR #9)                             |
| 3         | E0-06 — zagrożenia i autoryzacja     | [#3](https://github.com/RolePlayingTech/polish-accounting-platform/issues/3)  | Zamknięte ([18 — model zagrożeń](18-model-zagrozen-i-uprawnien.md), PR #11)                          |
| 4         | E0-05 — źródła prawa                 | [#4](https://github.com/RolePlayingTech/polish-accounting-platform/issues/4)  | Otwarte; można niezależnie                                                                           |
| 5         | E1-01 — szkielety/CI                 | [#5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5)  | Zamknięte (PR #12, #15)                                                                              |
| 6         | E1-02 / E1-03 — tenant i role        | [#6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6)  | W toku (`6A`–`6D-2` na `main`; `6D-3` w otwartych Draft PR-ach przed QA; `6E` oczekuje)              |
| 7         | INFRA-01 — prywatny staging i CI PG  | [#19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19)| W toku (Etap A Web/API aktywny; runner testowy PG 18.6 w Draft PR #33)                               |
| 8         | E1-04 / E1-05 — dokumenty            | [#7](https://github.com/RolePlayingTech/polish-accounting-platform/issues/7)  | Oczekuje na zamknięcie #6                                                                            |
| 9         | E2-01 / E2-02 — MCP read-only        | [#8](https://github.com/RolePlayingTech/polish-accounting-platform/issues/8)  | Oczekuje na zamknięcie #6 i #7                                                                       |

Dalsze Issues twórz dopiero po zweryfikowaniu ukończonych PR-ów oraz zależności. Etap 0 i etap 1 nie obejmują wysyłek na produkcję ani realnych rozliczeń podatkowych.
