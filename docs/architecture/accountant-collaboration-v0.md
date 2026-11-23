# Propozycja modułu współpracy z księgową — MVP v0

**Status:** koncepcja architektury i kryteria testowe, NIE wdrożony panel · **2026-11-23**. Główne zadanie: [#121](https://github.com/RolePlayingTech/polish-accounting-platform/issues/121). Zależności: [#6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), [#97](https://github.com/RolePlayingTech/polish-accounting-platform/issues/97), [#99](https://github.com/RolePlayingTech/polish-accounting-platform/issues/99), [#100](https://github.com/RolePlayingTech/polish-accounting-platform/issues/100), [#116](https://github.com/RolePlayingTech/polish-accounting-platform/issues/116), [#117](https://github.com/RolePlayingTech/polish-accounting-platform/issues/117), ADR-003, ADR-011.

## 1. Problem i cel
PAP ma najpierw służyć do samodzielnej pracy nad księgowością właściciela, później stać się SaaS dla wielu niezależnych przedsiębiorców. Potrzebna jest możliwość **realnego kontaktu z księgową** oraz księgowej obsługującej **wiele uprawnionych firm**, bez dostępu technicznego do ich innych danych lub do konta operatora platformy.

Osobne powierzchnie w tej samej aplikacji:
- `/app/accountant` (klient): „Moja księgowa”, wybór firmy, założenie sprawy, bezpieczny wątek, przesłane dokumenty (gdy dostępny magazyn), status odpowiedzi, potwierdzenie albo odrzucenie proponowanych czynności.
- `/accounting` (księgowa/biuro): kolejka *powierzonych* firm, zadania przypisane do zalogowanego członka biura, filtr „oczekuje na klienta”, weryfikacja dokumentów, komentarze i przygotowanie propozycji.
- `/platform` (operator usługi, inny bounded context): zarządzanie usługą, bez domyślnego dostępu do dokumentów i korespondencji klientów. Patrz ADR-003/#97.

Nazwy tras można zmienić w ADR po ocenie bieżącego routingu. Nie budować osobnej aplikacji/serwisu w MVP bez dowodu potrzeby.

## 2. Jeden przepływ użytkownika
1. Klient wybiera aktywną firmę i widzi, kto ma grant: „Księgowa: [nazwa] / brak przypisania”, zakres read/review/write oraz od kiedy i do kiedy obowiązuje. Własne konto może być używane bez księgowej.
2. Właściciel/administrator zaprasza lub przypina księgową (wykorzystując istniejące OIDC, zaproszenia i granty), może odwołać dostęp. Nigdy nie wystarczy samo wpisanie emaila w lokalnym stanie UI.
3. Klient rozpoczyna `ConsultationCase` typu `question`, `document_review`, `correction_request`, `month_close` i wiadomość. Wątek jest przypisany do **konkretnego `tenantId + legalEntityId`** i opcjonalnie do `documentId` / `taxPeriod`.
4. Uprawniona księgowa widzi sprawę w kolejce, odpowiada, zmienia status i może zaproponować działanie, lecz **wysłanie wiadomości nigdy nie powoduje księgowania**.
5. Wymagające zapisu działanie przechodzi przez istniejący autoryzowany use case zatwierdzenia; klient otrzymuje czytelne „co się zmieni” (kwoty, okres, źródło), a operacja ma `Idempotency-Key` i zdarzenie audytu.
6. Klient i księgowa widzą historię wiadomości / zmian po odświeżeniu i restarcie. Jeżeli księgowa straci grant, nie widzi nowych i historycznych danych poza uzgodnionym prawem do administracyjnych metadanych rozliczeniowych; szczegóły retencji wymagają decyzji prawnej.
7. W razie braku przypisanej osoby: UI uczciwie oferuje utworzenie zapytania oczekującego lub informację „Usługa księgowej niedostępna”, **nigdy nie symuluje prawdziwej odpowiedzi człowieka przez AI**.

## 3. Model logiczny do przeglądu (nazwy robocze)
```text
Tenant -- LegalEntity
AccountantPractice -- PracticeMember(UserIdentity)
ClientEngagement(tenantId, legalEntityId, practiceId, grants, validity, status)
ConsultationCase(tenantId, legalEntityId, engagementId, creatorId,
                 assignedAccountantId?, type, status, priority?, documentId?,
                 period?, createdAt, updatedAt, version)
CaseMessage(caseId, authorId, body, createdAt, editedAt?, clientVisible)
CaseAttachmentReference(caseId, immutableDocumentId, accessScope)
CaseActivityEvent(caseId, actorId, action, requestId, occurredAt)
AccountingActionProposal(caseId, sourceDocumentId, payloadHash, status, approverId?)
```

- Nie kopiować faktur, skanów ani NIP w treść powiadomień lub tabel konsultacji. Pliki źródłowe w oddzielnym bezpiecznym magazynie (zależność #99).
- Klucz `tenantId + legalEntityId + caseId` we wszystkich zapytaniach. Foreign key, wersje optimistic concurrency/locks i indeksy po firmie, statusie oraz aktualizacji; zachować możliwość eksportu danych.
- Statusy spraw: `open` → `waiting_for_accountant` → `waiting_for_client` → `resolved` / `closed`, opcjonalnie `reopened`. Statusy proponowanych księgowań są osobną maszyną stanów i nie dziedziczą ze sprawy `resolved`.
- Wiadomości i decyzje muszą mieć nieusuwalny ślad autorstwa / timestamp, bez arbitralnej edycji finansowej historii; wersjonowanie albo korekta zamiast cichego overwrite.
- Możliwość biura obsługującego wiele tenantów **nie** daje wspólnego katalogu dokumentów: każdy pobrany wątek i załącznik sprawdza uprawnienie do konkretnej firmy i aktywne zlecenie.
- Przy nowych encjach użyć istniejącego `@pap/contracts` (Zod), `@pap/domain` (maszyna stanów/authorization policies), `@pap/application` (use case), `@pap/db` (Postgres/Drizzle/RLS) i `@pap/api` + Next BFF; zdalny MCP tylko po przejrzeniu scope. W ogóle nie wiązać kont biura z `platform_operator`.

## 4. Rozdzielenie ról i decyzji autoryzacyjnych

| Aktor | Operacje | Niedozwolone bez dodatkowego grantu |
| --- | --- | --- |
| Właściciel firmy | zapraszanie księgowej, konsultacje, zatwierdzenie własnych operacji, cofanie dostępu | inne firmy/tenanty |
| Księgowa z read + consultation | sprawy, odpowiedzi, przegląd w granicach aktywnej firmy | księgowanie, inne firmy |
| Księgowa z jawnie nadanym write | przygotowanie/kontrolowane księgowanie w dozwolonym profilu, zgodnie z polityką akceptacji | nieograniczone zarządzanie tenantem i automatyczne obejście approve |
| Operator platformy | metryki usługowe, tenant metadata, incydenty bez treści dokumentów | dostęp do ksiąg i wiadomości bez ścisłego break-glass |
| AI/MCP | obliczalne, audytowane propozycje zgodne ze scope | własne potwierdzenie, nadanie sobie grantu |

Role mogą być modelowane jako oddzielne capability/granty (np. `case.read`, `case.reply`, `accounting.review`, `accounting.post`); agent ma przeanalizować kompatybilność obecnego `read/write` i nie dodawać nadmiarowych ról. Granice obowiązują także na bezpośrednich URL, przez REST/MCP i po zmianie firmy w istniejącej sesji.

## 5. Profesjonalna tożsamość i sposób komunikacji
MVP: **asynchroniczna wymiana wiadomości w aplikacji** + oznaczenie statusu + powiadomienia bez treści wrażliwej. Niewysyłany do zewnętrznych odbiorców sandbox e-mail pozostaje sandboxem do czasu osobnego projektu bezpiecznej wysyłki. Późniejsze: rezerwacja terminu, połączenie audio/wideo, zaawansowane SLA, udostępnienie ekranu.

Profil księgowej: nazwisko/nazwa biura, metody kontaktu tylko w zakresie wyrażonej zgody, obszar specjalizacji i kwalifikacje, ale słowo **„certyfikowana / zweryfikowana”** wyłącznie po dokumentowalnym procesie sprawdzenia. Nie przypisywać automatycznie uprawnień doradcy podatkowego. Trzeba zdefiniować status partnera: `unverified` / `verification_pending` / `verified` z datą i osobą weryfikującą. Nie rozpoczynać obsługi rzeczywistych danych przed warunkami #100.

## 6. Odpowiedzialność za SaaS i dane
- Dostęp do konsultacji / usługi biura jest osobnym entitlement od dostępu do oprogramowania. Opłaty SaaS ≠ faktury klientów ≠ wynagrodzenie księgowej; zgodnie z ADR-003.
- Izolacja, MFA, uprawnienia, DPA/powierzenie, podstawa prawna przetwarzania danych, retencja spraw i załączników, bezpieczny eksport, żądania usunięcia, audyt dostępu i reagowanie na incydenty przed go-live.
- Brak automatycznej migracji danych z demo do klientów, żadnych realnych e-deklaracji lub banków w ramach developmentu.
- Start: 1 właściciel + 1 syntetyczna księgowa + dwie izolowane testowe firmy, następnie test cross-tenant i realistyczny workflow.

## 7. Pionowy wycinek implementacyjny i tests-as-contract
**Najmniejszy wartościowy wycinek:** w odizolowanym PG18 firma A ma właściciela U i księgową K z ważnym grantem. U tworzy sprawę i wiadomość. K odczytuje, odpowiada. U odczytuje odpowiedź po restarcie API, widzi status. W tym czasie firma B w tym samym tenancie oraz tenant C nie widzą niczego.

**Testy negatywne wymagane przed merge:**
- K bez aktywnego grantu albo po jego cofnięciu: brak odczytu sprawy/wiadomości/załącznika (w tym przez zgadnięty URL), brak możliwości odpowiedzi; test w istniejącej sesji.
- Właściciel firmy B: nie może odczytać sprawy firmy A mimo znajomości `caseId`; aplikacyjna kontrola + RLS.
- Dwa równoczesne statusy/odpowiedzi: bez gubienia wiadomości, atomowa operacja z czytelnym konfliktem wersji; request retry nie dubluje.
- Symulowany błąd DB / API outage: żadnego pozornego „wysłano”; brak częściowego zapisu; po przywróceniu pełna spójność.
- Wiadomość „zaksięguj to natychmiast” lub modelowa sugestia nie wykonuje akcji finansowej; konieczne jawne zatwierdzenie autoryzowanego aktora.
- Powiadomienia bez danych z innego tenanta, bez wrażliwej treści; limit długości/payloadu, sanitacja treści, test XSS i prompt injection jako danych niezaufanych.
- Dostępność (formularz, focus, komunikaty błędów) i mobile 375 px.

## 8. Stopień gotowości na dzień utworzenia
W kodzie jest **podstawa**: `apps/web/app/app/companies/companies-workbench.tsx` obsługuje granty; `apps/web/lib/synthetic-workspace.ts` zawiera syntetyczną personę `marta-ksiegowa`; istnieją OIDC, PostgreSQL i model uprawnień. **Nie znaleziono zaimplementowanego wątku konsultacji ani kolejki spraw**, lecz brak wyniku wyszukiwania/obecnej trasy to tylko statyczna przesłanka, nie pełen dowód nieistnienia funkcji. Szczegóły wymagają osobnego testu i przeglądu przed decyzją implementacyjną.

**Definicja GOTOWOŚCI:** ADR / API contract i maszyna stanów → mały PR schema+use cases+tests → UI+E2E → review księgowej na syntetycznych przykładach → dopiero potem oddzielne zgody na realne firmy.
