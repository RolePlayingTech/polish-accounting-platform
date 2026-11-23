# PAP — harness kolejnej iteracji: stabilizacja, UX, refaktor i fundament współpracy z księgową

**Data bazowa:** 2026-11-23 · **zweryfikowany `main`:** `2543fdcdc80bd937346a314fd9672c2badb26fe4` · **status:** plan pracy agenta, nie wykonanie poprawek ani wynik testów. Przed rozpoczęciem agent MUSI ponownie sprawdzić `origin/main`, otwarte PR i Issues, ponieważ SHA i stan zgłoszeń się zmieniają.

## 0. Północna gwiazda produktu
Najpierw **własna, naprawdę użyteczna księgowość właściciela**, później **wielotenantowy, rozszerzalny SaaS dla innych przedsiębiorców**, z osobną **przestrzenią pracy profesjonalnej księgowej** obsługującej powierzonych klientów i bezpiecznymi konsultacjami. Produkt ma prowadzić użytkownika od dokumentu i zdarzenia gospodarczego do weryfikacji, zapisów, rozrachunku, podatków, zamknięcia miesiąca i eksportu — bez wielokrotnego wpisywania tych samych danych i bez fałszywych obietnic zgodności. **Prawdziwa firma/klient = NO-GO dopóki #100 i audyt #119 nie zostaną spełnione.**

Wybory projektowe i implementacyjne należą w dużej mierze do agenta: wolno zmieniać hierarchię ekranów, komponenty, podział modułów i szczegóły API, proponować lepsze rozwiązania, usuwać martwy kod i dopisywać brakujące zabezpieczenia. Nie trzeba pytać o każdy detal. Granice nienegocjowalne: poprawność księgowa, idempotencja, bezpieczeństwo, izolacja, pełny audyt, testowalność, zgodność z obowiązującymi ADR i zakaz nieautoryzowanego deployu/migracji. Nie tworzyć demonstracyjnych atrap funkcji wyglądających na działające.

## 1. Obowiązkowe źródła prawdy — w tej kolejności
1. `AGENTS.md`, `apps/web/AGENTS.md` (w tym lokalna dokumentacja Next), `docs/internal-development-merge-policy.md`, `docs/adr/010-granica-transakcji-i-idempotencja-fala1.md` i `docs/adr/011-tozsamosc-oidc-sesje-bff-i-cykl-zycia-uzytkownikow-fala2.md`.
2. [Audyt integralności #119](https://github.com/RolePlayingTech/polish-accounting-platform/issues/119), [bramki realnej firmy #100](https://github.com/RolePlayingTech/polish-accounting-platform/issues/100), [refaktor #117](https://github.com/RolePlayingTech/polish-accounting-platform/issues/117), [panel księgowej #121](https://github.com/RolePlayingTech/polish-accounting-platform/issues/121), [panel operatora #97](https://github.com/RolePlayingTech/polish-accounting-platform/issues/97).
3. `docs/qa/verification-matrix.md`, `scripts/qa/preflight.mjs`, `scripts/qa/verification-matrix.mjs`, `docs/reports/final-product-audit.md` oraz testy E2E; stare raporty to dowody **dla historycznego SHA**, nie dla dzisiejszej wersji.
4. [Otwarte PR #84](https://github.com/RolePlayingTech/polish-accounting-platform/pull/84): historyczny plan Astra/Gemini (bazowany na starszym `main`). Przed merge przeprowadzić rebase / przegląd nieaktualnych twierdzeń, zwłaszcza napraw z PR #88–#96; nie scalać bezrefleksyjnie.
5. Dla reguł podatkowych: aktualne oficjalne źródło, okres obowiązywania, fixture i niezależny review merytoryczny. Nie traktować przykładowego kodu lub README jako potwierdzenia obowiązującego prawa.

## 2. Repozytorium i miejsca dużego ryzyka (static review na ww. SHA)
- `packages/application/src/accounting-workspace.ts` (~6593 linii) — połączenie dokumentów, VAT, KPiR, ryczałtu, księgi głównej, banku, kalendarza i podatków; hotspoty: `postDocumentRecordInternal`, `getVatView`, zaliczki i rozrachunki.
- `apps/web/lib/synthetic-workspace.ts` (~5562 linii) — klient API/BFF oraz odrębny tryb demonstracyjny, potencjalne rozjechanie semantyki; krytyczne zachowanie fail-closed.
- `packages/db/src/accounting-scope.ts` (~3178 linii) — persystencja, operacje księgowe, tenant scope, błędy idempotencji; zachować PostgreSQL 18, RLS, ograniczone role.
- `packages/application/src/mcp-gateway.ts` (~3161 linii) — przygotowanie/potwierdzenie propozycji i twardy zakaz autonomicznego zatwierdzenia zapisu.
- `packages/application/src/document-import-parsers.ts` — XML/CSV/JSON, ograniczenia parsera FA(2)/FA(3), ryzyko pozornej walidacji KSeF.
- `apps/web/app/app/documents/documents-workbench.tsx`: nadal hardcoded syntetyczny NIP, opis, kwoty, `ksefMarker='NrKSeF'` i sztuczny `ksefRef` w formularzu (#102, #115); nie wolno przenieść tych defaultów do prawdziwej firmy.
- `apps/web/components/workspace-shell.tsx`: `WORKSPACE_NAV_SECTIONS` bezwarunkowo wyświetla KPiR, ryczałt i pełne księgi (#120), pomimo znajomości wybranego profilu.
- `apps/web/app/app/companies/companies-workbench.tsx`: istnieje nadawanie i cofanie grantów księgowej; NIE dublować mechanizmu dla #121.
- Wydzielony `@pap/domain` z arytmetyką groszową, kontrakty Zod, `@pap/ui`, Nest/Fastify, Next i `@pap/mcp`: **zachować modularny monolit**. Nie rekomendować rewrite, nowego frameworka, Redis, mikroserwisów, osobnej bazy na księgową lub systemu agentów do decydowania o kwotach podatku.

## 3. Kolejność wykonania — outcome first, nie checklista „odfajkowania”
**Fala A — integralność i reprodukcja P0 (blokery):**
- #106 wszystkie linie/stawki źródła → podgląd korekty → zatwierdzenie → VAT/JPK/PG bez strat; nigdy spłaszczanie wielu wierszy.
- #118 stan okresu VAT, przeniesienia, zwroty, P_54/P_62, jeden spójny wynik pulpitu, VAT, kalendarza i eksportu.
- #110 kanoniczny identyfikator zdarzenia księgowego, link dokument→operacje i idempotentne przejścia między ścieżkami UI/API/MCP; korekty jawne.
- #107 stabilny identyfikator/import source hash dla banku; bez kolizji z identycznym numerem linii w innym CSV/MT940.
- #108 kwota alokacji nie może przekroczyć kwoty transakcji; zastąpienie alokacji atomowe i odwracalne.
Dla KAŻDEGO: test czerwony (odtworzenie oryginalnego błędu), poprawka, test zielony, przypadki negatywne, persystencja po restarcie. Można pracować równolegle, ale ustalić właścicieli plików i integrację.

**Fala B — spójność funkcjonalna (P1/P2):** #109 błędny reżim podatkowy, #111 bank→dekret GL, #112 zero VAT w MCP nie zgaduje stawki, #116 rzeczywiste zamknięcie okresu; #81 opłacone ≠ naliczone. Zależne moduły zmieniać w pionowych wycinkach. Sprawy #82/#98 (XSD, JPK/KSeF) to osobna bramka zgodności, nie obiecywać pełnej obsługi przed testem źródeł urzędowych.

**Fala C — realny UX oraz wygląd:** #102, #104, #105, #114, #115, #120, #103, #113 (+ niezamknięte sprawy z #101). Przejść wszystkie widoki jak nowy właściciel JDG, właściciel sp. z o.o. i księgowa, na ekranie desktop, tablet i telefon. Dla każdego widocznego CTA: jest pełny scenariusz i informacja o skutku albo CTA jest wycofane/oznaczone jako niedostępne. Usuń surowe Zod/SQL errors z UI. Formy proste, po polsku, z opisem podatkowym, bez fikcyjnego „zweryfikowano przez urząd”.
Cel stylu: istniejąca „Księga Współczesna”, czytelne kwoty i tabele, spójna typografia/odstępy, nowoczesność bez „AI dashboard slop”. Przeprojektuj nawigację zależnie od firmy, ale nie polegaj na ukrytych linkach jako autoryzacji. Screenshoty przed/po i a11y/regresja mobile. Agent może zaproponować warianty i wybrać rekomendowany we własnym PR, nie blokując napraw oczywistych niedziałających kontrolek.

**Fala D — refaktor kontrolowany:** dopiero po ochronie golden testami wydzielaj obszary z monolitów (#117). Jedno źródło reguł księgowych, `web` UI/BFF bez alternatywnego engine, przypadki użycia i porty w application, repozytoria/transakcje w db. Rozdziel `DocumentPosting`, `PeriodVatSettlement`, `PaymentAllocation`, `MonthClose`, `BankImport` i `AccountantCollaboration` według rzeczywistych granic. Każda ekstrakcja zmniejsza sprzężenie i nie zmienia wyników arytmetycznych; nie prowadzić ogromnego zbiorczego refaktoru bez testów porównawczych. Usuń martwy kod, wprowadź stabilne błędy domenowe i kontrakty.

**Fala E — współpraca z księgową, MVP projektowe:** #121 i [specyfikacja](../architecture/accountant-collaboration-v0.md). W tej iteracji wymagane są model uprawnień, granice modułu, makiety/przepływy i test plan; agent może wykonać mały działający pionowy wycinek konsultacji na **syntetycznej** bazie, jeśli nie zagraża to falom A/B. Prawdziwe wiadomości lub dostęp profesjonalisty wymagają faktycznego personelu, zgód, RODO, polityki retencji i #100. Prace nad panelem operatora #97 nie mogą odblokować dostępu do cudzej księgowości. Billing SaaS pozostaje projektem późniejszym z ADR-003.

## 4. Matryca minimum do odbioru
- 3 profile: JDG KPiR (skala i liniowy), JDG ryczałt, sp. z o.o. pełne księgi. Reżim i VAT status sterują formularzem, menu, akcjami API. Osobno przypadki czynny VAT i zwolnienie.
- Testy P0 z #119: faktura z dwiema stawkami; nadwyżka VAT M→M+1; dwie operacje bankowe bez ID; przydział jednej wpłaty do dwóch faktur; brak dubla księgowego.
- Testy P1: ograniczenie źródła zapisu według profilu; zerowy VAT bez zgadywania; okres zamknięty; płatności częściowe i odpowiednie Wn/Ma; podatki naliczone i zapłacone oddzielnie.
- **Warstwa end-to-end**: prawdziwy browser → Next BFF → API → *oddzielna* PostgreSQL18 z migracjami, kontrola po zimnym restarcie API, izolacja dwóch tenantów, revoked grants, fail-closed po wyłączeniu API, dwa równoległe requesty oraz retry idempotency.
- MCP: testy jako zewnętrzny klient przez rzeczywisty transport/scope, przygotowanie wniosku i jawne potwierdzenie człowieka. Agent/LLM nie może zatwierdzić własnego księgowania.
- UI: screenshoty z pełnymi stanami (loading, empty, validation error, API outage, success, permission denied) dla co najmniej 375, 768, 1280 px. Klawiatura, focus, kontrast WCAG; czytelność kwot i dat.
- Uzgodnienie domenowe: niezależne fixture od kompetentnej księgowej/doradcy zgodnie z zakresem, aktualność podstaw prawnych; same testy własnego kodu nie potwierdzają zgodności.
- Weryfikacja #121: księgowa widzi tylko wybrane firmy z grantem; brak trans-tenant IDOR; wiadomości nie powodują zapisów w księgach.

## 5. Środowisko i polecenia
- `pnpm install --frozen-lockfile` zgodnie z `package.json`: Node 24.22.1+, pnpm 12.15.x. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:arch`, `pnpm format:check`, `pnpm qa:preflight`.
- Testy PG: `pnpm test:integration:db`, `pnpm test:integration:api`, `pnpm test:adversarial`. **`pnpm test:integration` uruchamia tylko DB — nie jest pełnym testem API**.
- E2E: `pnpm test:e2e`, `pnpm test:e2e:oidc`; sprawdzać konfigurację i rzeczywiste połączenia. Wykorzystać `scripts/hetzner/with-ephemeral-pg18.sh` oraz `scripts/qa/run-hetzner-qa.sh` zgodnie z `docs/qa/verification-matrix.md` — bez zgadywania parametrów.
- GH Actions jest tymczasowo wyłączone na mocy ADR-006. Docelowe CI integracyjne w **izolowanym** runnerze Hetzner z limitami; jeżeli agent nie ma SSH, zapisuje NOT RUN i instrukcję odtworzenia, nigdy fałszywe PASS. Nie wykonywać niekontrolowanego `pnpm build` na współdzielonym hostcie.
- **Nie modyfikować** stagingu `https://ksiegowosc.roleplayingtech.com`, usług, bieżącej bazy, danych, Nginx, DNS, certyfikatów, backupów, ani produkcyjnych połączeń MF/banków; osobna zgoda przed deployem i migracją. Nie używać rzeczywistych danych księgowych. Zero sekretów w GitHubie.

## 6. Swarm: samodzielność, własność plików, handoff
1. Coordinator najpierw analizuje `main`, wszystkie otwarte Issues i PR, mapuje błędy do dokładnych ścieżek i ustala zależności; aktualizuje listę prac w #119 (nie duplikuje 34 Issues).
2. Równolegle: podzespół integralności dokument/VAT, bank/rozrachunki, authorization/period, UX/Playwright oraz niezależny reviewer/QA. Przed edycją wspólnych monolitów ustalić właściciela pliku albo sekwencyjne gałęzie; żadnych wzajemnych nadpisań. Autor PR ≠ reviewer dla krytycznych zmian.
3. Agent może wybierać lepsze rozwiązania, nie ma narzuconych nazw klas ani mikrozadań. Ma obowiązek **doprowadzić funkcję do działającego końca**, przetestować cały obieg użytkownika i sprawdzić, czy nie odkrył następnej przyczyny. Nie „naprawiać” testu przez wyłączenie asercji. Problemy poza zakresem dokumentować/zgłaszać i priorytetyzować, nie ignorować.
4. Zmiana `schema`/migracji: addytywna, udokumentowana kompatybilność/rollback, testy RLS/revocation/2-tenants i DB18; bez niezweryfikowanego zapisu w stare okresy. Każda zmiana finansowa: porównanie wyników złotówka/grosz i idempotencja.
5. PR-y małe lub średnie, opisujące jeden pionowy efekt biznesowy; można integrować częściej zgodnie z `docs/internal-development-merge-policy.md`, ale **merge zgodny z polityką nie oznacza zgody na deployment**. Nie scalić krytycznego PR bez niezależnego review i wymaganych testów.
6. W PR / issue handoff: `base SHA`, `head SHA`, środowisko, dokładne polecenia PASS/FAIL/NOT RUN, dowód przed/po, znane ryzyka, migrowane dane, screenshots, co pozostaje, następna zależność. Stale PR #84 ocenić przed wykorzystaniem. Finalnie uaktualnić README i roadmapę: obecne opisy „kompletne”/stare migracje nie mogą być jedynym źródłem statusu.

## 7. Warunki zakończenia etapu
- **Iteration ready**: zero otwartych P0 z sekcji A *po reprodukcji i retestach*, brak regresji tenant/RLS, zamknięte lub jawnie odroczone P1 z uzasadnieniem, E2E działa na nowym SHA (lub wyraźne NO-GO).
- **Design ready**: spójna nawigacja po profilach, działające formularze, brak fikcyjnych identyfikatorów/urzędowych weryfikacji i martwych CTA, testy screenshot/mobile i a11y.
- **Maintainability ready**: zmierzone ograniczenie duplikacji i zależności po refaktorze, golden tests kontraktów UI/API/MCP/PG, decyzje w ADR, czytelne moduły.
- **Accountant MVP designed**: model spraw, wiadomości i ról z #121 zaakceptowany, brak automatycznych księgowań.
- **Private use of real data / SaaS production**: osobne NO-GO do czasu #100, prawnych/merytorycznych odbiorów, realnych kopii bezpieczeństwa z testem odtwarzania i formalnego release gate.

**Ten dokument to harness startowy; nie poświadcza wykonania żadnej implementacji ani świeżych testów.**
