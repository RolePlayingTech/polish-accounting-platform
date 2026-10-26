# ADR-003 — Administracja platformą, uprawnienia i przygotowanie do rozliczania abonamentów

**Data:** 2026-10-26  
**Status:** propozycja kierunku projektowego do przeglądu; implementacja etapowa w kolejnych Issues  
**Powiązania:** [ADR-001](001-rdzen-i-mcp.md), [ADR-002](002-stos-technologiczny-i-wdrozenia.md), [model bezpieczeństwa — #3](https://github.com/RolePlayingTech/polish-accounting-platform/issues/3), [szkielet — #5](https://github.com/RolePlayingTech/polish-accounting-platform/issues/5), [tenant i uprawnienia — #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6).

## Problem

Platforma może działać jako prywatna instalacja open source, produkt SaaS lub instalacja obsługująca wielu klientów biura rachunkowego. Potrzebuje zarządzania operacyjnego, użytkownikami, firmami, rolami, wsparciem, limitami i (opcjonalnie w przyszłości) opłatami. Nie można jednak utożsamiać administratora technicznego z księgowym ani dawać mu nieograniczonego dostępu do dokumentów klientów. Nie można też wprowadzić opłat przez rozproszone `if (plan === "pro")` w interfejsie.

## Propozycja 1 — trzy odrębne obszary odpowiedzialności

| Obszar | Przykładowe funkcje | Granica uprawnień |
| --- | --- | --- |
| **Platform control plane** (operator usługi) | status instancji, tenanty i ich statusy, użytkownicy w minimalnym zakresie, subskrypcje i zdarzenia billingowe, feature rollout, integracje, kolejki i diagnostyka, incydenty | *Nie* dziedziczy automatycznie dostępu do faktur, ksiąg i plików tenantów |
| **Tenant administration** (właściciel/administrator organizacji) | firmy, zaproszenia, członkostwa, role, uprawnienia MCP, polityki, eksport danych, konfiguracja subskrypcji organizacji | tylko własny tenant i firmy, do których ma prawo |
| **Accounting workspace** (operator, księgowy, recenzent, odczyt) | dokumenty, księgi, raporty, zatwierdzenia | dostęp do konkretnej `legal_entity`, okresu i akcji, nie globalny |

**Operator platformy nie jest automatycznie administratorem księgowości.** Wsparcie techniczne nie może podszywać się pod klienta. Ewentualny dostęp awaryjny (`break-glass`) wymaga osobnego ADR/procedury: określona przyczyna i zgoda, osobno ograniczony czas i zakres, MFA, log/alert oraz możliwość przeglądu przez klienta; w MVP nie implementujemy impersonacji.

## Propozycja 2 — jedna aplikacja webowa, wyraźnie rozdzielone powierzchnie

- `/app/*` — widok użytkownika/księgowego, skoncentrowany na wybranej firmie.
- `/settings/*` — ustawienia organizacji i członkostw, dostęp sprawdzany na serwerze.
- `/platform/*` — konsola operatora platformy, niezależny shell i policy boundary.
- Oddzielna aplikacja `apps/admin` **nie jest potrzebna na początku**; jeśli kiedyś będzie konieczne niezależne wdrożenie lub izolacja domeny administracyjnej, route/API boundaries pozwolą ją wydzielić. Wspólne komponenty UI nie oznaczają wspólnych uprawnień.
- Brak aktywnej sesji i praw = odmowa. Nawigacja i ukrywanie linku nie są mechanizmem autoryzacji. Trasy platformowe po wdrożeniu logowania wymagają osobnych claimów/polityk + silnej reautoryzacji dla działań wysokiego ryzyka.

**W pierwszym PR szkieletu (#5):** przygotować nazewnictwo i możliwość zbudowania tych shelli, ewentualnie statyczny/niedostępny produkcyjnie placeholder; *nie tworzyć* publicznego panelu administracyjnego z mockowanym przyciskiem zarządzania prawdziwymi użytkownikami i *nie implementować* własnego logowania.

## Propozycja 3 — wspólna polityka dostępu

- Rozdzielić **role platformowe** (`platform_operator`, `platform_support`, `platform_auditor`) od **członkostw w tenantach** (`tenant_owner`, `tenant_admin`, `tenant_member`) oraz **grants do firmy** (`entity_accountant`, `entity_reviewer`, `entity_reader`).
- Nie budować jednej uniwersalnej hierarchii, w której `admin` ma zawsze wszystkie uprawnienia.
- RBAC + ABAC: aktor, tenant, firma, działanie, zakres danych, cel dostępu i data/okres.
- Ta sama decyzja serwera obowiązuje UI, REST, workery i MCP; agent posiada tylko jawnie delegowane scope'y, nigdy platform operator przez samo wywołanie toola.
- Wszystkie mutacje uprawnień i operacje platformowe są audytowane z identyfikatorem aktora, powodem, zakresem i correlation ID, bez PII w standardowych logach.
- Dane operatora (np. subskrypcje, monitoring) są logicznie oddzielone od rejestru księgowego klientów.

## Propozycja 4 — abonamenty jako osobny bounded context (nie część księgowania klienta)

Projektujemy **entitlements** od początku, a prawdziwe płatności później:

- `Plan`: publiczna oferta i wersjonowana konfiguracja (opcjonalna, np. self-hosted ma policy lokalną).
- `Subscription`: powiązanie z tenantem; status, zakres i czas obowiązywania; nie przechowuje numerów kart.
- `Entitlement`: pojedyncze prawo/limit do cechy produktu (np. `mcp.read`, `document.storage_bytes`, `organization.max_entities`, `users.max_active`) i źródło nadania (plan, trial, manual, self-hosted).
- `UsageMeter`: osobne idempotentne zdarzenia użycia (przetworzone strony OCR, magazyn, operacje) tylko dla funkcji z realną potrzebą limitów; projektujemy identyfikatory i semantykę, ale nie uruchamiamy szczegółowego meteringu w MVP.
- `BillingProvider`: interfejs adaptera dla późniejszego dostawcy płatności; brak wyboru dostawcy, brak webhooków i checkout w pierwszym PR.
- **Opłaty za korzystanie z Polish Accounting Platform są oddzielone od faktur sprzedażowych, płatności i ksiąg firm użytkowników.** `BillingInvoice` nie jest `CustomerInvoice`.

Autoryzacja odpowiada na pytanie **czy ten aktor może wykonać akcję na tych danych**, entitlement odpowiada **czy organizacja ma prawo do danej funkcji/limitu**. Konieczne są obie pozytywne odpowiedzi, gdzie funkcja jest płatna; sam plan nie daje dostępu do cudzej firmy.

Enforcement musi być **serwerowy** i wspólny dla web/API/MCP/workera; UI służy jedynie do pokazywania stanu i przycisków upgrade. Na czas wdrażania płatności można używać deklaratywnej polityki `entitlement provider` w pamięci (test/self-hosted), bez sztywnego kodowania planów w domenie.

## Propozycja 5 — odpowiedzialna obsługa zmian abonamentów

- Zakończenie triala, problem z kartą czy wygaśnięcie planu nie mogą automatycznie usunąć dokumentów ani pozbawić użytkownika możliwości eksportu danych i wykonania obowiązków prawnych.
- Statusy: trial/active/past_due/grace/suspended/cancelled — dokładne konsekwencje osobno zdefiniować w policy i poddać przeglądowi biznesowo-prawnemu.
- Odczyt historii, bezpieczny eksport, pobranie oryginałów i wymagane operacje zgodności nie mogą zależeć od uzyskania nowej płatności bez analizy obowiązków i retencji.
- Webhooki, gdy zostaną dodane: podpis/weryfikacja, idempotencja, deduplikacja zdarzeń, przechowywanie statusów, reconciliation, zero przechowywania danych kart.
- Dla self-hosted open source brak obowiązkowego połączenia z komercyjną usługą billingową. MIT i opcjonalny hosted SaaS pozostają rozdzielone od prawa do kodu.

## Model logiczny (na razie bez migracji)

```text
PlatformUser
  ├── PlatformRoleAssignment
  └── TenantMembership ─── Tenant ─── LegalEntity
                                ├── EntityMembership
                                ├── Subscription ─── PlanVersion
                                ├── EntitlementGrant
                                ├── UsageEvent
                                └── BillingCustomerMapping
OperationalAuditEvent           BillingEvent / WebhookInbox
```

Modele `PlanVersion` i `EntitlementGrant` powinny jawnie definiować datę ważności, źródło i regułę pierwszeństwa; dla rezygnacji/zmiany planu wymagana jest odtwarzalność decyzji. Trzeba oddzielić identyfikator tenant od external ID dostawcy billingowego.

## Etapy, bez rozszerzania pierwszego PR

**Etap 0 / #3 (teraz):** ująć trzy powierzchnie i macierz ról oraz scenariusze negative (platform operator nie czyta faktur, księgowy nie edytuje planu, MCP nie zarządza tenantami, nieuprawniony operator nie dostaje diagnozy z PII).

**Etap 1 / #5 (pierwszy kod):** mono-repo, auth/policy boundary i routing conventions, przykładowy publiczny `/health`, statyczne widoki bez danych klientów. Można dodać neutralny `/platform` placeholder niedostępny przy braku autoryzacji, ale **nie** udawać wdrożonej autoryzacji. Na potrzeby demo można pokazywać publiczną informację „administracja jest jeszcze niedostępna”.

**Etap 2 / #6:** rzeczywista izolacja tenantów, tożsamość, role i testy cross-tenant. Ustanowić polityki odrębne dla platform operator/tenant admin; brak nadawania globalnych ról przez klienta.

**Etap 3 / nowe Issue po #6:** rzeczywisty panel operatora, admin tenantów, audit, read-only health operacyjne, zarządzanie członkostwami i policy backend, następnie statyczny entitlement provider. Dzielić na PR-y.

**Etap 4 / po potwierdzeniu modelu biznesowego:** pricing/plany, metering, wybrany dostawca płatności, webhooks, onboarding i ewentualne fakturowanie własnej usługi. Wymaga osobnej analizy prawnej VAT/fakturowania, bezpieczeństwa i nowych Issues.

## Alternatywy i konsekwencje

| Wariant | Ocena |
| --- | --- |
| Jeden panel „superadmin” do wszystkich dokumentów | Odrzucony: nadmierne uprawnienia, ryzyko tajemnicy księgowej/RODO i nadużyć |
| Osobny `apps/admin` i mikroserwis billing w pierwszym PR | Odrzucony: narzut i przedwczesne sprzężenie z nieznanym cennikiem |
| Twarde warunki `if plan=pro` w Next.js | Odrzucony: obejście przez MCP/API, duplikacja i migracje |
| Trzy powierzchnie w jednym web + polityki serwerowe + późniejszy billing adapter | **Rekomendowany**: rozszerzalność, mały zakres startowy, zachowane granice bezpieczeństwa |

## Wymagane testy w przyszłych implementacjach

1. Platform operator bez zgody nie może odczytać dokumentu tenant A.
2. Tenant admin A nie może administrować B.
3. Księgowy A nie może zmienić planu ani nadać sobie globalnej roli.
4. Agent MCP bez jawnego scope nie wyświetla planu, danych faktur ani narzędzi administracyjnych.
5. Zmiana planu nie obejmuje dostępu do cudzego dokumentu.
6. Wygasłe członkostwo powoduje odmowę.
7. Duplikat webhooka nie zwiększa entitlement ani kwoty naliczenia.
8. Nieudana płatność nie usuwa dokumentów i nie wyłącza przewidzianej prawem ścieżki eksportu.
9. Każda modyfikacja uprawnienia/abonamentu ma zdarzenie audytowe.
10. Brak aktywnej autoryzacji blokuje `/platform` i jego API; niewidoczny przycisk nie jest wystarczającą ochroną.

## Wciąż otwarte decyzje

Cennik, jednostka rozliczenia (tenant/firma/użytkownik/zużycie), dostawca płatności, tryb offline self-hosted, polityki trial/grace, proces dostępu awaryjnego i wdrożeniowy hosting — bez automatycznego rozstrzygania przez agenta. Zmiany te wymagają osobnego Issue i w razie potrzeby kolejnego ADR.
