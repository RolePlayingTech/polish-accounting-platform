# 12. Roadmapa i status realizacji na gałęzi `main`

> **Stan aktualizacji: listopad 2026 r. (po scaleniu PR `#45`–`#52`).**  
> Niniejszy dokument synchronizuje pierwotny plan etapowy z rzeczywistym kodem zaimplementowanym w monorepo. Zgodnie z zasadą uczciwości inżynieryjnej (`AGENTS.md` Zasada nr 9) precyzyjnie rozdziela funkcje **już wdrożone i przetestowane w kodzie** od integracji zewnętrznych i formalnych odbiorów, które **celowo pozostają poza bieżącym etapem testowym**.

---

## Strategia rozwoju

**Najpierw bezpieczny fundament autoryzacji, dokumentów i MCP, następnie deterministyczne księgowanie profil po profilu — zawsze pod kontrolą człowieka.** Wspólna architektura (`@pap/domain`, `@pap/contracts`, `@pap/application`, `@pap/db`, `@pap/ui`, `@pap/api`, `@pap/mcp`, `@pap/web`) obsługuje wiele form prawnych i reżimów podatkowych, ale żadna integracja z urzędami państwowymi ani bankami nie jest uruchamiana automatycznie bez odrębnej zgody właściciela projektu i formalnego przeglądu zgodności.

---

## Etap 0 — zatwierdzenie specyfikacji, architektury i rejestru prawa

- [x] `E0-01` Nazwa projektu, otwarta licencja `MIT`, repozytorium GitHub, polityka bezpieczeństwa (`SECURITY.md`), reguły agentów (`AGENTS.md`) i polityka wewnętrznych merge (`docs/internal-development-merge-policy.md`). _(Formalne wyznaczenie zewnętrznego doradcy podatkowego przed ewentualną komercjalizacją pozostaje otwartą bramką organizacyjną)._
- [x] `E0-02` Wybór i specyfikacja pierwszego profilu pilota (**JDG KPiR** — skala `12%/32%` oraz podatek liniowy `19%`) wraz z rozszerzeniem o profil **JDG Ryczałt** i **Sp. z o.o. (pełne księgi UoR)** (`@pap/domain`, `docs/32-rejestr-regul-prawnych-i-matryca-jdg.md`, PR `#47`, Issue `#1`).
- [x] `E0-03` Matryca profilu JDG (księgi 2025/2026, VAT, ZUS, składka zdrowotna, granice odpowiedzialności) oraz referencyjne przypadki syntetyczne w groszach PLN (`@pap/domain`, PR `#47`).
- [x] `E0-04` Wybór stosu technologicznego i modelu wdrożeń: [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md) (PR `#9`, Issue `#2`), uzupełniony o model ról administracyjnych [ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md) oraz model środowisk Hetzner [ADR-006](adr/006-prywatny-staging-hetzner.md).
- [x] `E0-05` Wersjonowany rejestr **32 kodów reguł prawnych (42 wersje temporalne na lata 2025–2026)** powiązanych z oficjalnymi publikatorami (`ISAP` / `Dz.U.` / `M.P.`), mechanizm wyjaśnienia `LegalExplanation` („§ Dlaczego?”) i 6-krokowy proces aktualizacji prawa (`@pap/domain` — moduł `legal-rules`, `docs/32-rejestr-regul-prawnych-i-matryca-jdg.md`, PR `#47`, Issue `#4`).
- [x] `E0-06` Model zagrożeń, matryca ról → narzędzi MCP → operacji domenowych i granice zaufania (`docs/18-model-zagrozen-i-uprawnien.md`, [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md), PR `#11`, Issue `#3`).

---

## Etap 1 — fundament techniczny, bezpieczeństwo wielofirmowe i obieg dokumentów

- [x] `E1-01` Monorepo `pnpm` + `Turborepo`, kontrola granic architektonicznych (`pnpm test:arch`), lokalny rozwój bez wymogu DB (`pnpm dev`, [ADR-005](adr/005-rozwoj-lokalny.md)), prywatny staging techniczny na Hetznerze (`https://ksiegowosc.roleplayingtech.com`) oraz izolowany runner testowy PostgreSQL 18.6 (`scripts/hetzner/with-ephemeral-pg18.sh`, PR `#12`, `#15`, `#23`, `#24`, `#33`).
- [x] `E1-02` Uwierzytelnianie OIDC (`ES256`/`RS256` w `JwksOidcAccessTokenVerifier` + odgrodzony bezpiecznikami `SandboxOidcService` dla person testowych), sesja BFF `HttpOnly` podpisana `HMAC-SHA256` w `@pap/web`, wybór i przełączanie firmy/okresu oraz atomowy audyt decyzji `allow/deny` w `security_decision_event` (`6D-2`, `6D-3`, PR `#25`, `#48`, `#51`, `#52`, Issue `#6`). _(Podłączenie zewnętrznego produkcyjnego dostawcy OIDC z wymuszonym MFA pozostaje zadaniem przedprodukcyjnym)._
- [x] `E1-03` Model relacyjny i domenowy `tenant` / `legal_entity` / `tenant_membership` / `entity_profile_version` / `company_access_grant` z ograniczeniami `EXCLUDE USING gist`, cyklem unieważniania grantów `6D-R`, rolą runtime `NOBYPASSRLS` oraz `FORCE ROW LEVEL SECURITY` na **27 tabelach** w migracjach `0000`–`0007` (`@pap/db`, PR `#16`–`#21`, `#48`, `#50`).
- [x] `E1-04` Obieg i rejestr dokumentów z obliczaniem skrótu `SHA-256`, deterministyczną blokadą duplikatów (`409 Conflict`), walidacją sumy kontrolnej NIP oraz zachowaniem niemodyfikowanego ładunku źródłowego XML/CSV/JSON (`@pap/application`, `@pap/db`, `@pap/api`, PR `#50`–`#52`, Issue `#7`). _(Szyfrowany zewnętrzny magazyn obiektowy S3 ze skanerem antywirusowym dla binarnych skanów PDF/JPG pozostaje poza bieżącym trybem syntetycznym)._
- [x] `E1-05` Kolejka weryfikacji dokumentów (`Szkic`, `Propozycja AI`, `Zweryfikowany i zaksięgowany`), wyszukiwanie, filtrowanie oraz ekran weryfikacji `SplitVerificationView` z obowiązkowym modalem zatwierdzenia przez człowieka (`@pap/ui`, `@pap/web`, PR `#46`, `#51`).
- [x] `E1-06` Prezentacja propozycji ekstrakcji ze wskaźnikiem pewności pola, kwalifikacją podatkową (w tym pojazd mieszany `50% VAT / 75% KUP`) i twardym zakazem samoczynnego zapisu do ksiąg bez akcji `approve-and-post` (`@pap/application`, `@pap/api`, `@pap/web`, PR `#51`, `#52`).
- [x] `E1-07` Import wyciągów bankowych `CSV` i `MT940`, kontrola rachunków na Białej Liście KAS, oznaczanie obowiązkowego MPP (`> 15 000 PLN` brutto) oraz deterministyczne parowanie przelewów z rozrachunkami (`@pap/domain`, `@pap/application`, `@pap/api`, `@pap/web`, PR `#47`, `#51`, `#52`).
- [x] `E1-08` Design System **„Księga Współczesna”** (`@pap/ui`, WCAG 2.2 AA, `tabular-nums`, responsywność `375px`), pulpit operacyjny „Do zrobienia dziś” (`/app`), kalendarz zobowiązań (`art. 12 § 5` OP), skrzynka powiadomień Sandbox RFC 5322 oraz **12-modułowa Akademia Polskiej Księgowości** (`@pap/domain/academy`, `/academy`, 37 lekcji, pomoc kontekstowa `?` `FieldHelpButton`, PR `#45`, `#46`, `#49`, `#51`, Issue `#13`).

---

## Etap 2 — zdalny serwer MCP oraz kontrola działań AI

- [x] `E2-01` Zdalny serwer **Streamable HTTP MCP** (`/api/v1/mcp` w `@pap/api` oraz handler w `@pap/mcp`) z weryfikacją `Host`/`Origin` i Bearer JWT przed odczytem strumienia body (`1 MiB`), egzekwowaniem zakresów `pap:mcp:read` / `pap:mcp:prepare` oraz audytem fail-closed (`docs/33-mcp-i-powiadomienia.md`, `docs/34-architektura-api-oidc-i-mcp.md`, PR `#45`, `#52`, Issue `#8`).
- [x] `E2-02` Narzędzia odczytowe MCP: `system_status`, `list_my_companies`, `list_unpaid_invoices`, `get_monthly_tax_obligations`, `explain_accounting_item`, `get_month_close_checklist` (`@pap/mcp`, `@pap/application`, PR `#45`, `#52`).
- [x] `E2-03` Dwuetapowy przepływ propozycji zapisu: `prepare_invoice_and_posting_proposal` (`pending_human_approval`, brak zapisu w księgach) -> wydanie jednorazowego wyzwania człowieka `confirmationCode` z TTL -> atomowe zatwierdzenie `confirm_prepared_proposal` ze stałoczasową weryfikacją `expectedPayloadHash` i blokadą samo-zatwierdzenia agenta (`403 agent_self_approval_forbidden`, PR `#45`, `#51`, `#52`).
- [x] `E2-04` Narzędzie `get_legal_basis` udostępniające zweryfikowane przepisy prawa podatkowego i daty ich obowiązywania bez ryzyka halucynacji modelu językowego (`@pap/mcp`, PR `#45`).
- [x] `E2-05` Automatyczne testy izolacji cross-tenant, wygasłych/niewystarczających tokenów, blokady spoofingu nagłówków (`x-user-id`, `x-tenant-id`), neutralizacji _indirect prompt injection_ i niewidocznych znaczników Unicode Bidi (`sanitizeUntrustedDocumentTextForMcp`, PR `#45`, `#52`).

---

## Etap 3 — polska zgodność podatkowa: profil JDG KPiR i VAT

- [x] `E3-01` Zweryfikowana matryca JDG KPiR na lata 2025–2026, arytmetyka groszowa i zaokrąglenia podatkowe wg `art. 63 § 1` Ordynacji podatkowej (`@pap/domain` — moduł `kpir`, PR `#47`).
- [x] `E3-02` Rejestry sprzedaży i zakupów VAT (`23%`, `8%`, `5%`, `0%`, `zw.`, `np.`), rozliczenie 50% VAT od samochodów osobowych (`art. 86a` VAT) oraz reguły dla podatników zwolnionych podmiotowo do **240 000 PLN** od 2026 r. (`art. 113 ust. 1` VAT, `@pap/domain` — moduł `vat`, PR `#47`).
- [x] `E3-03` Parser i walidator faktur ustrukturyzowanych XML **KSeF `FA(2)` oraz `FA(3)`**, obsługa numerów referencyjnych KSeF i trybów `OFF` / `BFK` / `DI` w obiegu dokumentów (`@pap/domain`, `@pap/application`, `@pap/api`, PR `#47`, `#52`).
- [ ] `E3-03b` _(Poza bieżącym etapem testowym)_ Bezpośrednia komunikacja sieciowa i uwierzytelnianie kryptograficzne (pieczęć/podpis kwalifikowany/token KSeF 2.0) z bramkami Ministerstwa Finansów oraz pobieranie urzędowych UPO.
- [x] `E3-05` Podatkowa Księga Przychodów i Rozchodów w układzie **17-kolumnowym (2025, `Dz.U. 2019 poz. 2544`)** oraz nowym układzie **19-kolumnowym (od 2026 r., `Dz.U. 2025 poz. 1299`)**, czerwone storno z uzasadnieniem, narastające zaliczki PIT (skala `12%/32%`, liniowy `19%`) oraz kalkulator składek ZUS/zdrowotnej (`@pap/domain`, `@pap/web`, PR `#47`, `#51`).
- [x] `E3-06` Generator i podgląd danych deklaracyjno-ewidencyjnych **`JPK_V7M(2)` oraz `JPK_V7M(3)`** (obowiązującego od lutego 2026 r. wg `Dz.U. 2025 poz. 1800`, pola `P_10`–`P_62`, oznaczenia KSeF i GTU) powiązany z rejestrami VAT (`@pap/domain` — moduł `vat`, `@pap/web`, PR `#47`, `#51`).
- [ ] `E3-07` _(Wymaga osobnej decyzji właściciela przed udostępnieniem komercyjnym)_ Formalny odbiór i certyfikacja profili przez licencjonowanego doradcę podatkowego, pełny eksport i wysyłka kryptograficzna plików XML `JPK_PKPIR`/`JPK_V7M` do bramki e-Deklaracje MF oraz audyt RODO pod kątem przetwarzania danych rzeczywistych.

---

## Etap 4 — kolejne profile podatkowe i pełne księgi rachunkowe

- [x] `E4-01` **JDG na ryczałcie od przychodów ewidencjonowanych:** ewidencja przychodów wg stawek `17%`–`2%` (`art. 12` ustawy o ryczałcie), proporcjonalne odliczenie składek ZUS społecznych i **50% zapłaconej składki zdrowotnej** (`art. 11`), progi zdrowotne `60 000 PLN` / `300 000 PLN` oraz wizualny monitor limitu zwolnienia VAT `240 000 PLN` (`@pap/domain`, `@pap/web`, PR `#47`, `#51`).
- [x] `E4-02` **Pełne księgi rachunkowe (Ustawa o rachunkowości):** Zakładowy Plan Kont (Zespoły `0`–`8`), wielopozycyjny dziennik księgowań z twardą walidacją równowagi podwójnego zapisu `SUM(Wn) === SUM(Ma)` (`422` przy niezgodności), Zestawienie Obrotów i Sald (ZOiS), uproszczony Bilans (`Aktywa === Pasywa`) oraz Rachunek Zysków i Strat (`@pap/domain` — moduł `full-ledger`, `@pap/db`, `@pap/api`, `@pap/web`, PR `#47`, `#50`–`#52`).
- [x] `E4-03` **Spółka z o.o. (CIT klasyczny):** kalkulacja miesięcznej zaliczki CIT (`9%` mały podatnik do 2 mln EUR vs `19%` stawka podstawowa, wyłączenia NKUP i `75%` limitu samochodowego wg `art. 16 ust. 1 pkt 51` CIT, PR `#47`, `#51`, `#52`). _(Generowanie pełnych struktur XML `JPK_KR_PD` / `JPK_ST_KR` i `e-Sprawozdań Finansowych` z podpisem zarządu pozostaje w backlogu przedprodukcyjnym)._
- [ ] `E4-04` _(Planowane)_ Spółki osobowe i cywilne w pełnym rozliczeniu wielowspólnikowym (rozdział ksiąg podmiotu od indywidualnych zaliczek PIT i składek ZUS poszczególnych wspólników — obecnie ujęte edukacyjnie w Akademii).
- [ ] `E4-05` _(Planowane)_ Automatyczne odpytywanie zewnętrznego API Białej Listy KAS (MF WL API), GUS REGON i tabel kursowych NBP w czasie rzeczywistym (obecnie walidacja opiera się na deterministycznych regułach i danych kontrolowanego środowiska).

---

## Etap 5 — integracje produkcyjne, rozszerzenia domenowe i przyszły SaaS

Poniższe elementy **celowo nie są aktywne w obecnym środowisku testowym** i wymagają odrębnej decyzji biznesowej, prawnej oraz infrastrukturalnej właściciela projektu przed jakimkolwiek udostępnieniem komercyjnym:

- [ ] `E5-01` **Trwałe spięcie produkcyjnego runtime HTTP z PostgreSQL 18 + OIDC MFA:** przełączenie `AccountingWorkspaceService` w `apps/api` z domyślnego syntetycznego `InMemoryAccountingWorkspaceStore` na wdrożony w `@pap/db` adapter `PostgresAccountingScope` (`0007`), uruchomienie zewnętrznego IdP OIDC z wymuszonym MFA oraz szyfrowanych backupów off-host (`age`/`restic`) w zewnętrznym regionie UE/EOG.
- [ ] `E5-02` **Produkcyjne bramki urzędowe (KSeF 2.0, e-Deklaracje MF, PUE/eZUS):** kryptograficzne podpisywanie i wysyłka deklaracji oraz odbiór UPO wyłącznie po certyfikacji eksperckiej danego profilu.
- [ ] `E5-03` **Bankowość PSD2 na żywo i zewnętrzny dostawca SMTP:** integracja z rachunkami bankowymi przez licencjonowanego dostawcę AISP oraz zastąpienie `ControlledSandboxMailboxTransport` produkcyjnym transportem e-mail z zachowaniem reguł prywatności i `opt-out`.
- [ ] `E5-04` **Biura rachunkowe o dużej skali, kadry i płace (listy płac, PIT-11, PPK, ZUS RCA/RSA) oraz rozliczenia specjalistyczne** (pełny Estoński CIT z ukrytymi zyskami, WNT/WDT/OSS/IOSS, podatek u źródła WHT, fundacje i stowarzyszenia).
- [ ] `E5-05` **Plany abonamentowe i billing SaaS ([ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md)):** serwerowe entitlementy, limity i adapter operatora płatności (bez blokowania dostępu do własnych danych księgowych i ustawowego eksportu).

---

## Podsumowanie zamkniętych i otwartych strumieni prac (GitHub Issues & PR)

| Zakres / Issue                                                                                                                                                                                                                                                            | Kluczowe scalone PR na `main`                                   | Aktualny status w repozytorium                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1](https://github.com/RolePlayingTech/polish-accounting-platform/issues/1) — Profil pilota JDG KPiR i matryca                                                                                                                                                           | PR `#47`, `#49`, `#51`, `#52`                                   | **Wdrożone w kodzie** (`@pap/domain`, `@pap/web`, `docs/32`); formalny przegląd doradcy podatkowego przed produkcją pozostaje otwartą bramką.                                                            |
| [#2](https://github.com/RolePlayingTech/polish-accounting-platform/issues/2) / [#3](https://github.com/RolePlayingTech/polish-accounting-platform/issues/3) / [#5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5) — Stos, Threat Model, Szkielet | PR `#9`, `#11`, `#12`, `#15`                                    | **Zamknięte i wdrożone.**                                                                                                                                                                                |
| [#4](https://github.com/RolePlayingTech/polish-accounting-platform/issues/4) — Rejestr źródeł prawa i reguł 2025–2026                                                                                                                                                     | PR `#47`, `#49`, `#51`, `#52`                                   | **Wdrożone w kodzie** (32 kody reguł / 42 wersje temporalne, szuflada „§ Dlaczego?”, widok `/app/rules`).                                                                                                |
| [#6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6) — Izolacja tenantów, role, RLS i audyt                                                                                                                                                       | PR `#16`–`#21`, `#25`, `#40`, `#43`, `#48`, `#50`, `#51`, `#52` | **Wdrożone w kodzie** (`6A`–`6D-3` + migracja `0007` z `FORCE RLS` na 27 tabelach + UI/API wyboru firmy i grantów). Odbiór na żywym PG 18.6 na Hetznerze wg `docs/6D3_SECURITY_QA_ACCEPTANCE_PLAN.md`.   |
| [#7](https://github.com/RolePlayingTech/polish-accounting-platform/issues/7) — Obieg, import i weryfikacja dokumentów                                                                                                                                                     | PR `#46`, `#50`, `#51`, `#52`                                   | **Wdrożone w kodzie** (XML KSeF `FA(2)`/`FA(3)`, CSV, JSON, deduplikacja `SHA-256`, `SplitVerificationView`, `approve-and-post`).                                                                        |
| [#8](https://github.com/RolePlayingTech/polish-accounting-platform/issues/8) — Zdalny serwer MCP i powiadomienia                                                                                                                                                          | PR `#45`, `#51`, `#52`                                          | **Wdrożone w kodzie** (`/api/v1/mcp` Streamable HTTP, 9 narzędzi, `prepare_*`/`confirm_*`, `ControlledSandboxMailboxTransport`).                                                                         |
| [#13](https://github.com/RolePlayingTech/polish-accounting-platform/issues/13) — Design System „Księga Współczesna”                                                                                                                                                       | PR `#46`, `#51`                                                 | **Wdrożone w kodzie** (`@pap/ui` + pełna aplikacja `@pap/web` zgodna z WCAG 2.2 AA).                                                                                                                     |
| [#19](https://github.com/RolePlayingTech/polish-accounting-platform/issues/19) — Prywatny staging Hetzner i CI PG 18.6                                                                                                                                                    | PR `#23`, `#24`, `#33`, `#39`                                   | **Aktywny prywatny staging Etapu A** (`https://ksiegowosc.roleplayingtech.com`) oraz izolowany skrypt efemerycznego PG 18.6 (`with-ephemeral-pg18.sh`). Wdrożenie nowych wydań wymaga zgody właściciela. |
| [#44](https://github.com/RolePlayingTech/polish-accounting-platform/issues/44) — Kompletny rdzeń księgowy, UI, API i Akademia                                                                                                                                             | PR `#45`–`#52`                                                  | **Rdzeń scalony na `main`** (silnik podatkowy, `@pap/ui`, `6D-3`, Akademia 12 modułów, migracja `0007`, `@pap/web`, `@pap/api` + OIDC/MCP).                                                              |

---

## Obowiązujący szablon Definition of Done dla kolejnych zmian

- [ ] Wymaganie, granice odpowiedzialności i scenariusz opisane po polsku w dokumentacji `docs/`.
- [ ] Zmiana pokryta testami automatycznymi (w tym co najmniej jednym scenariuszem negatywnym / odmowy dostępu).
- [ ] Każda reguła podatkowa posiada oficjalne źródło (`ISAP`/`Dz.U.`/`M.P.`), przedział dat `validFrom`–`validTo`, przypadek referencyjny w groszach i jawny `verificationStatus`.
- [ ] Brak sekretów, kluczy, haseł, niezamaskowanych identyfikatorów infrastruktury oraz prawdziwych danych osobowych/faktur w repozytorium.
- [ ] Jednolita weryfikacja uprawnień i zakresów OIDC w UI, REST API oraz MCP.
- [ ] Migracje bazy danych posiadają polityki `FORCE ROW LEVEL SECURITY`, uprawnienia `NOBYPASSRLS` i zachowują odtwarzalność kopii zapasowej.
- [ ] Żaden test ani proces uruchomieniowy nie inicjuje połączeń z produkcyjnymi systemami MF, ZUS, KSeF ani zewnętrznymi skrzynkami pocztowymi użytkowników.
