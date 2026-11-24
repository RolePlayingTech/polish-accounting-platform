# PAP — wieloagentowa misja implementacyjna: od fundamentów do kompletnego pilota księgowego

**Data:** 2026-11-23 · **Ticket koordynacyjny:** [#124](https://github.com/RolePlayingTech/polish-accounting-platform/issues/124) · **Wizja docelowa:** [#123](https://github.com/RolePlayingTech/polish-accounting-platform/issues/123) · **Audit blokad:** [#119](https://github.com/RolePlayingTech/polish-accounting-platform/issues/119) · **Real-data release gate:** [#100](https://github.com/RolePlayingTech/polish-accounting-platform/issues/100).

> **UWAGA:** To plan wykonawczy dla Gemini 4 Carbon / Antigravity `/swarm`, a nie dowód wykonania. Najważniejsza różnica: celem jest **szeroki, rzeczywiście działający pilot end-to-end na danych syntetycznych**, nie deklarowana obsługa wszystkich podatków, branż, form prawnych i rzeczywistych integracji urzędowych. Wszystkie pisane funkcje muszą mieć testy, dowody i status `verified/experimental/unsupported` dla właściwego profilu/roku. Przed dopuszczeniem realnych danych obowiązują #100 i zewnętrzny odbiór księgowy.

## 1. Mission statement

Zwiększ znacznie funkcjonalność PAP w jednym zintegrowanym programie prac, zachowując kontrolę jakości:
- Napraw wszystkie potwierdzone błędy finansowe, podatkowe i kluczowe błędy UI, nie ukrywając pozostałych.
- Zbuduj pełny przepływ fakturowania, odbioru/wystawiania KSeF 2.0 w środowisku testowym i/lub demo (jeśli poprawnie dostępne), ewidencji i rozliczeń podatkowych, banku, zamknięcia miesiąca i eksportów do plików urzędowych.
- Zapewnij **realną parytetowość UI/API/MCP** po jednym zestawie reguł aplikacyjnych, bez naśladowania działania w pamięci czy udawania zewnętrznej integracji.
- Refaktoruj modułowo kod i kontrakty tam, gdzie ograniczają bezpieczeństwo i rozszerzalność; bez globalnego rewrite, nowego frameworka, kilku baz, nieuzasadnionych mikroserwisów.
- Daj agentom dużo autonomii w projektowaniu, wyborze rozwiązań, testach, recenzjach i przygotowaniu PR, ale nie deleguj prawa do zatwierdzania własnych skutków finansowych ani właścicielskich zgód na staging/prod.

**Docelowy zakres wersji:** trzy główne profile (A: JDG KPiR VAT czynny PIT skala/liniowy, B: JDG ryczałt VAT aktywny/zwolniony zgodnie z prawem, C: sp. z o.o. GL VAT CIT). Nie deklarować kompetencji w zakresie pracowniczych płac, handlu międzynarodowego, akcyzy, cen transferowych, podatku estońskiego czy wszystkich innych reżimów bez konkretnych testów i zatwierdzenia. Mapa wszystkich kandydatów pozostaje w [full-spectrum capability map](../product/full-spectrum-capability-map.md).

## 2. Start — governance i source-of-truth

1. Odśwież `origin/main` i każdą listę Issues/PR. Użytkownik zleca implementację, **nie** potwierdza merge/deploy/migracji środowiska bieżącego.
2. Przeczytaj `AGENTS.md`, `apps/web/AGENTS.md`, `docs/internal-development-merge-policy.md`, architektury i ADR-010/011, #119, #117, #123 i ten runbook. Podagent ma dostać jedynie odnośnik do swojej domeny.
3. PR #122 zawiera przygotowany harness: zintegruj odpowiednio z `main` po review i zasadach polityki repo; PR #84 jest historyczny — sprawdź, które elementy już weszły do `main`, oznacz superseded lub dopasuj po review. Nie zostawiaj konfliktu źródeł prawdy.
4. Ustal czy obecny test harness pozwala uruchomić osobne PG18, API, Web, OIDC, MCP i Playwright z syntetycznymi danymi, bez dotykania stagingu. `pnpm test:integration` obejmuje tylko DB; osobno `pnpm test:integration:all` i `pnpm test:adversarial`. Najpierw preflight, sprawdzenie zasobów runnera, brak GitHub Actions.
5. **Legal source-of-truth 2026+:** dokumentacja MF KSeF 2.0 API i środowisk test/demo, oficjalne FA(3) XSD, JPK_V7M(3)/V7K(3) i JPK_PD obowiązujące dla daty; ZUS dla składek. Udokumentuj `source URL + effectiveDate + profile + accepted fixture + reviewer`; LLM nie jest źródłem podatku.

## 3. Swarm team i odrębna własność plików

- **Coordinator — Carbon (High)**: zależności, wspólne kontrakty, sprint ledger, stany PR, integracja; unika edycji tych samych plików co workery; rozstrzyga podział finansowych agregatów i pilnuje zakresu.
- **Finance invariant & PG lead — Carbon/Argon**: #106, #110, #107, #108, #118; transakcje, idempotencja, rejestr operacji, przejścia okresu. Pozostałe workery nie zmieniają w ciemno tych samych serwisów.
- **Tax & official schema lead — Carbon**: #81, #82, #98, #112; rule registry, obowiązujące wersje, FA/JPK XSD i golden fixtures, niezależnie od UI; wymagany odrębny reviewer.
- **KSeF/invoice and document lead — Argon/Hydrogen**: KSeF 2.0 test adapter, źródła i statuses, fakturowanie, import, #99, #102, #115; koordynuje kontrakty z tax lead.
- **Bank/GL/close lead — Argon/Carbon**: #109, #111, #113, #116, rozrachunki, zamknięcia; nie miesza naliczeń z zapłaconymi.
- **Web UX/accessibility — Argon/Hydrogen**: #101/#104/#105/#114/#120, interfejs i kontrakty; nie dodaje osobnych reguł księgowych w Next.
- **MCP/API interface lead — Carbon/Argon**: typed catalog, safe approvals, zdalny prawdziwy klient, retry/denies; kod domeny nie trafia do transportu.
- **Independent adversarial QA — Carbon**: nie zatwierdza własnych zmian jako niezależnych; testy E2E obu kanałów, izolacja tenantów, race/retry, XML injection, evidence report, root causes.

W Antigravity `/swarm` każdy worker ma izolowane git worktree; komunikację przez shared board, contract decisions przez zaakceptowany ADR i issue, małe reviewowalne PR. Nie istnieje obowiązek trzymania stale 8 agentów aktywnych: dobieraj liczbę ról do rzeczywistych zależności i budżetu; najtrudniejsze rozumowanie i verification przypisz Carbon.

## 4. Execution stages (dependency gates)

**G0 — Baseline i dowody**: zestaw syntetycznych zestawów A/B/C dla 2 kolejnych okresów, bieżące FAIL/NOT RUN i mapa poprzednich zgłoszeń. Zbuduj zestaw golden snapshots pokrywający źródło→VAT→księgi→rozrachunki→płatność; przejdź problem wejścia P0 przed refaktorem.

**G1 — P0 przed feature expansion**: #106 zachowaj wszystkie pozycje/stawek, #118 VAT carryover/refund P_54/P_62, #110 jedna ekonomiczna operacja i anti-double-posting, #107 stabilny bank import ID, #108 alokacje atomowe i bez podwójnego salda. Ze wszystkich kanałów UI/API/MCP i z różnymi wejściami. Nie przepuszczaj G1 bez PG18+concurrency+negative cases.

**G2 — Księgowość i podatki**: #81 due vs paid PIT/ZUS/CIT, #109 właściwy reżim, #111 GL księgowanie banku, #112 jawna klasyfikacja VAT w MCP, #116 closed period, #113 separator bankowy. Dla A/B/C: 2 kolejne miesiące, korekty/zaliczki, statusy i odpowiednio VAT/PIT/CIT/ZUS; brak „CIT 9%” bez warunków preferencji, brak niewłaściwych ksiąg.

**G3 — Fakturowanie i KSeF**: edycja pełnej faktury/pozycji, korekty, terminy, waluty tylko tam gdzie są zweryfikowane, różne stawki; #102/#115/#99/#82, kopia oryginału, deduplikacja i XSD FA(3), obsługiwany zakres FA(2) dla archiwum. W test/demo KSeF 2.0 (jeśli bezpiecznie dostępne): autoryzacja, utworzenie/wysłanie, odbiór, synchronizacja, status/UPO i retry. **Nie wolno wystawić dokumentu w produkcyjnym KSeF — także testowego**. Przy braku uprawnień do sandboxu: mock API i jasno `external E2E NOT RUN`.

**G4 — Obowiązki i eksporty urzędowe**: #98, profile + effective date + urzędowe XSD:
- VAT: JPK_V7M(3) i JPK_V7K(3) wraz z przeniesieniami, niezgodnościami i ustawami przejściowymi; wcześniejsze wersje dla archiwum tylko jeśli testowane.
- Dochód / księgi: JPK_PKPIR, JPK_EWP, JPK_ST, JPK_KR_PD, JPK_ST_KR **według obowiązku dla konkretnego profilu i roku**.
- XSD PASS nie równa się poprawności podatkowej; wygenerowane XML muszą być powiązane z dowodami, podpisem/urzędem tylko po osobnej autoryzacji, UPO bez wynalezionych numerów. ZUS i sprawozdania finansowe w zakresie własnych zweryfikowanych adapterów/eksportów; brak integracji produkcyjnej oznacz jako ograniczenie.

**G5 — UI/MCP/arch**: prawdziwa praca od Dashboard → Dokument/FA → Preview → Human Approval → Księga/Tax → Bank → Month Close → UPO/Export; responsive i dostępne #101/#104/#105/#114/#120. MCP jako drugi klient tego samego use case, strict scopes/ABAC/RLS/tenant, idempotency, no self-approve, true remote MCP e2e. Modularizuj #117 tylko z testami i bez cichego przepisywania reguł.

**G6 — Independent verification/release candidate**: adversarial review bez autora zmian, testy po restarcie PG/API, two-tenant attacks, XML malformed, xsd, concurrency i rollback, porównanie UI/API/MCP, golden fixtures A/B/C na 2 okresach; pełny raport per commit. Gotowość do osobistego pilota dopiero po niezależnym księgowym i #100.

## 5. Konkretny złoty przepływ odbiorowy

| ID | Scenariusz / oczekiwany rezultat |
| --- | --- |
| GLD-01 | JDG KPiR: wielopozycyjna 23%+8% FA(3) → approve → dwie właściwe pozycje VAT/JPK, KPiR, rozrachunek, brak utraty informacji |
| GLD-02 | VAT miesiąc M nadwyżka → M+1 poprawne P_54 i P_62, spójny dashboard/ledger/JPK |
| GLD-03 | Dwa różne importy bankowe z brakiem reference / tym samym ordinal ID → obie transakcje; retry tej samej paczki bez duplikacji |
| GLD-04 | Jeden przelew częściowy → poprawna alokacja do FV; concurrent double allocation i reallocate bez 2x settlement |
| GLD-05 | Ta sama FV dostarczona przez UI, API i MCP → 1 operacja + jawny konflikt / idempotent confirmation |
| GLD-06 | Ryczalt: proper revenue classification and **paid** ZUS; niedozwolona KPiR/GL jest odrzucona po stronie API |
| GLD-07 | Sp. z o.o.: AP/AR → GL Wn/Ma → bank 130/rozrachunki → CIT, trial balance i zamknięcie okresu |
| GLD-08 | Zamknięty miesiąc: zapis wstecz odrzucony; uzasadniona korekta z audytem w dozwolonym okresie |
| GLD-09 | Import XML z NIP `PL` tam gdzie zakazany, z brakującym `KodFormularza`, niespójną wersją, XXE, namespace: odmowa; przypadek `BrakID` dozwolony tylko wg XSD |
| GLD-10 | KSeF test/demo: issue → retrieve → reconcile status + receipt, retry po timeout; test external marked NOT RUN, gdy brak rzeczywistego sandbox |
| GLD-11 | Eksport właściwych JPK dla danego profilu i okresu, validacja offline z **oficjalnym** XSD MF; nie ma fałszywego statusu wysyłki |
| GLD-12 | OIDC 2 tenants + 2 companies, grant revoke, read-only, MCP self-approve, injection in invoice, browser E2E, crash before/after commit |
| GLD-13 | Wszystkie widoczne przyciski i formularze na każdej aktywnej ścieżce działają i jasno komunikują efekt, status, błąd i nieobsługiwaną funkcję |
| GLD-14 | Ponowny odczyt po restarcie aplikacji i DB, kwoty i lineage takie same dla UI, REST, MCP |

Przy każdym ID raport: `PASS / FAIL / NOT RUN`, SHA, komenda, fixtures, środowisko, path dowodu (log/screenshot/zrzut metryk bez sekretów), numer PR/Issue i wymagany reviewer. Żaden mock nie dowodzi zewnętrznego KSeF, a przejście XML XSD nie dowodzi prawidłowości PIT/CIT.

## 6. Test matrix i dowody wymagane przed „finished”
- `pnpm qa:preflight`, `pnpm test:arch`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, security/dependency checks właściwe dla repo.
- PG18 isolated: `pnpm test:integration:all` (**DB i API**), `pnpm test:adversarial`, migracje/RLS + 2 API instances / race, negative fixtures.
- Browser: `pnpm test:e2e`, `pnpm test:e2e:oidc` + critical mobile & desktop screenshots; true API, not offline fake.
- MCP: rzeczywisty transport z autoryzowanym klientem i tym samym API/DB, przygotowanie przez agenta, niezależne zatwierdzenie człowieka testowego, verify/retry/deny.
- Schemy urzędowe: oficjalne pliki XSD pobrane z udokumentowanym URL/hash i testy pozytywne/negatywne; legal rule fixtures sprawdzone przez eksperta.
- Staging nietknięty bez odrębnej zgody; test zewnętrznego sandboxu tylko na fikcyjnych danych, bez prawdziwych tokenów i bez publikacji wyników z danymi osobowymi.

## 7. Handoff, zarządzanie długiem, brak osieroconych PR

Zostaw:
1. GitHub updated #124 z tabelą `Issue → root cause → fixing PR → SHA → verified fixture → status → remaining risk` oraz aktualizacją #119.
2. Wąskie PR-y z ownerami, niezależnymi review, changelogami zmian architektury i kontraktów; po zgodnym z polityką repo merge usuń/oznacz superseded odpowiednie PR-y, nie pozostawiaj nadmiarowych duplikatów.
3. Wersjonowany capability registry per forma prawna/rok i wynik `verified/experimental/unsupported`; dokumentację API/MCP i UX, screenshoty, artefakty testów.
4. End-to-end sample accounting periods dla A/B/C, zestaw rzeczywistych *syntetycznych* XML faktur i JPK, testy negative i procedurę bezpiecznego odtworzenia.
5. Finalny **GO/NO-GO** osobno: dev merge, sandbox KSeF, pilot na danych syntetycznych, własne prawdziwe dane, przyszły SaaS. Osobno wypisz brak zewnętrznej księgowej, brak urzędowego podpisu, licencji lub credentials, brak testu `NOT RUN`.
6. Każdy nowy dług ma ownera, issue, koszt/ryzyko, ograniczający test i warunek spłaty. Nigdy nie przedstawiaj niedokończonego modułu jako kompletnej księgowości.

## 8. Bezwzględne granice uprawnień

Autonomia projektowa i kodowa **TAK**. Operacje finansowe na prawdziwych danych i samodzielny audit merytoryczny przez AI **NIE**. Brak prod/staging deploy, migracji działającej instancji, realnych klientów, maili do kontrahentów, produkcyjnych faktur KSeF, podatkowych/zusowskich wysyłek i przelewów bez **odrębnej zgody** użytkownika, właściwych uprawnień i niezależnej kontroli. Nie uruchamiać GitHub Actions. Jeśli realne środowisko sandbox jest niedostępne: nie wyłączaj zabezpieczeń i nie dopisuj fikcyjnego PASS.

**Ambitna iteracja ≠ jedna transakcja wdrożeniowa**: autonomiczny Swarm może wykonywać wiele bezpiecznych etapów/PR w ramach tego dużego zadania, ale musi zatrzymać się na prawdziwych blockerach lub barierach release i wyraźnie poinformować o nich na GitHubie.
