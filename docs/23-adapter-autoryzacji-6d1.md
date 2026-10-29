# 23. Adapter PostgreSQL źródła autoryzacji — 6D-1

**Data:** 2026-10-28. **Zakres:** pierwszy etap 6D w [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6); bez zamykania Issue. Obowiązują ADR-002/003/004/005. To adapter infrastruktury, nie działające logowanie ani ochrona endpointów firm.

## Implementacja i aktualny schemat

`PostgresTenantAuthorizationDataSource` z `@pap/db` implementuje istniejący port `TenantAuthorizationDataSource` z `@pap/application`. Konstruktor przyjmuje Drizzle DB utworzone przez kontrolowane `connectDatabase`; sam import ani konstruktor nie otwiera połączenia. Przyszła kompozycja serwerowa przekaże źródło do istniejącego `authorizeCompanyAction`. Web i MCP nie importują DB; domain/application nie importują ORM ani sterownika. Nie podłączamy źródła do publicznych tras ani do startu `pnpm dev`.

Adapter używa wyłącznie `tenant_membership` i `company_access_grant` z [6B](22-schemat-tenantow-6b.md):

- `WHERE` wybiera dokładną parę `(tenant_id, user_id)` członkostwa; PK gwarantuje jeden rekord stanu.
- `LEFT JOIN` wiąże granty z tym samym tenantem i użytkownikiem oraz filtruje dokładne `legal_entity_id` i `action`. Indeks 6B odpowiada temu zakresowi. Złożone FK chronią przynależność grantu do firmy i członkostwa.
- Jeden parametryzowany SELECT daje członkostwo i granty z jednego obrazu danych; brak dwóch odczytów, które mogłyby połączyć stany sprzed i po równoległej zmianie. [PostgreSQL 18, Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED) opisuje snapshot pojedynczego SELECT.
- Wynik nie zawiera nazw ani profili firm i nigdy nie zawiera grantów spoza żądanej czwórki tenant/firma/użytkownik/akcja. Brak członkostwa daje `null` i `[]`; brak grantu zachowuje członkostwo z pustą listą grantów. Nie rozróżniamy istnienia obcej firmy od braku grantu.
- Mapowanie zachowuje status, milisekundy, `validFrom`, `validUntil`, `revokedAt` i NULL. Nie filtruje czasu w SQL i nie interpretuje statusów na nowo: istniejąca polityka ocenia `[od, do)` i chwilę cofnięcia przy użyciu zaufanego zegara application service. Samo `read` nie daje `write`; administrator wymaga jawnego grantu.
- Nie ma cache faktów ani decyzji, zmiennych przechowujących bieżącego tenanta, `SET` sesji ani przyznawania uprawnień. Każde wywołanie odczytuje bazę ponownie.
- 6B nie ma autorytatywnego źródła ról platformowych. `platformRoleAssignments` zawsze wynosi `[]`, także dla właściciela/administratora tenanta. To ograniczenie adaptera, nie stwierdzenie, że użytkownik nie może mieć takich ról w przyszłym źródle. Role platformowe nie są akcjami grantów (`read`/`write`) ani źródłem praw księgowych.
- Awaria DB lub mapowania powoduje nowy, ogólny błąd bez SQL, parametrów, poświadczeń i `cause`; `authorizeCompanyAction` przechwytuje go i zwraca `{ allowed: false, reason: 'authorization_data_unavailable' }`. Nie logujemy surowego wyjątku. Brak rekordów nie jest awarią.

Nie potrzeba migracji ani zmiany polityki. Migracje `0000`/`0001`, schemat 6B i ich metadane pozostają bez zmian. Wycofanie adaptera oznacza wycofanie kodu/kompozycji, bez usuwania danych.

## Historyczne ryzyko reaktywacji i naprawa 6D-R

**Aktualizacja 6D-R (2026-10-28):** [bezpieczny cykl dostępu](24-bezpieczny-cykl-dostepu-6dr.md) implementuje poniższy wariant transakcyjny, atomowy audyt mutacji i guardy migracji 0002. Regresja PR #20 wymaga teraz odmowy po reaktywacji, także przez zwykły SQL. Poniższy opis ryzyka i propozycji dokumentuje stan samego 6D-1 sprzed naprawy. Ograniczona rola DB, wiarygodny aktor/autoryzator oraz TOCTOU operacji na danych pozostają jawnymi blockerami pierwszego dostępu. Nie ma jeszcze logowania, RLS ani audytu decyzji; Issue #6 pozostaje otwarte.

**Ryzyko jest potwierdzone testem regresyjnym na PostgreSQL:** aktywne członkostwo + nieodwołany grant A1 → zezwolenie; zmiana statusu członkostwa na `revoked` → odmowa; powrót do `active` (nawet z nowym `validFrom`) → ponowne zezwolenie z tego samego historycznego grantu. Grant ma FK do pary tenant/użytkownik, nie do konkretnego okresu członkostwa. Polityka sprawdza niezależnie obie ważności. Nie wymaga początku grantu późniejsniejszego od początku członkostwa. Adapter celowo nie zmienia tego kontraktu po cichu.

**Przed obsługą użytkowników wymagany jest osobny, testowany i reviewowany mechanizm cyklu dostępu.** Minimalna propozycja dla obecnego schematu:

1. Wszystkie operacje cofnięcia/reaktywacji członkostwa i nadania/zmiany grantów blokują ten sam rekord `(tenant_id, user_id)` przez `SELECT FOR UPDATE`, w jednej transakcji. Wydzielona rola runtime nie może obchodzić tej ścieżki dowolnym UPDATE/INSERT.
2. Cofnięcie ustawia `status=revoked` oraz trwale cofa **wszystkie** granty tej pary, także do innych firm, dla obu akcji i z przyszłym początkiem. `revoked_at` ustawiamy najpóźniej na chwilę cofnięcia; wcześniejszego cofnięcia nie przesuwamy na później. Zmiany i audyt muszą zatwierdzić się atomowo.
3. Nadawanie grantu pod tą samą blokadą odmawia, gdy członkostwo jest cofnięte. Reaktywacja nie czyści `revoked_at` i nie wznawia istniejących grantów. Dostęp wymaga nowego, jawnie autoryzowanego nadania z nowym `grant_id` i audytem.
4. Testy obejmują granty przyszłe, wiele firm/akcji, rollback przy awarii audytu oraz równoległe cofnięcie/nadanie/reaktywację w obu kolejnościach blokad. Sam UPDATE statusu, sam FK ani sprawdzenie daty grantu bez historii nie wystarczą.

Jeśli nie da się wymusić wspólnej ścieżki mutacji, potrzebna będzie osobno zaprojektowana migracja z niezmiennym identyfikatorem/generacją okresu członkostwa i grantami powiązanymi z tą generacją; nigdy ponowne użycie dawnej generacji. To alternatywa wymagająca zmiany kontraktu i review. 6D-1 nie implementuje żadnej ścieżki mutacji dostępu i nie rozwiązuje powyższego ryzyka samym adapterem. **Dopuszczenie realnych użytkowników pozostaje zablokowane do wdrożenia mechanizmu.**

## Kontrakt tożsamości (zrealizowany w 6D-2)

**Aktualizacja 6D-2 (2026-10-28):** kontrakt opisany poniżej został zaimplementowany i rozwinięty w [etapie 6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) (`packages/application/src/oidc-authentication.ts`, `packages/db/src/user-identity.ts`, `apps/api/src/auth/`).

```ts
// Tworzony wyłącznie przez serwerowy adapter po weryfikacji tokenu/sesji.
interface VerifiedOidcIdentity {
  readonly issuer: string;
  readonly subject: string;
}

interface UserIdentityResolver {
  resolveVerifiedIdentity(
    identity: VerifiedOidcIdentity,
  ): Promise<{ readonly userId: UserId } | null>;
}
```

Serwerowy adapter OIDC weryfikuje podpis/algorytm i klucze z zaufanej konfiguracji, dokładne `iss` z allowlisty, właściwe `aud`, `exp`, `nbf` (gdy występuje), wymagane scopes, stan konta i sesji/odwołania. Dla przyszłego przepływu logowania również PKCE, state i nonce. Nie pobieramy kluczy z dowolnego URL wskazanego przez niezaufany token. Po tej weryfikacji resolver odczytuje jedyne mapowanie `(issuer, subject)` → losowy wewnętrzny UUID aktywnego konta.

Tabela tożsamości (`user_oidc_identity` w migracji `0003`) posiada UNIQUE dokładnej, czułej na wielkość liter pary `(issuer, subject)` i FK do wewnętrznego użytkownika (`app_user`). `subject` jest nieprzezroczystym tekstem, nie musi być UUID. Nie normalizujemy go, nie łączymy kont po e-mailu/nazwie i nie traktujemy `sub` z dwóch wystawców jako tej samej osoby. Rejestracja/powiązanie kont to osobna kontrolowana operacja; brak/wyłączenie mapowania daje odmowę, awaria źródła bezpieczny błąd bez danych tokenu. Podstawa: [OIDC Core 1.0, §5.7 Claim Stability and Uniqueness](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) i [§3.1.3.7 walidacja ID Token](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation).

Wyłącznie serwer wpisuje rozwiązany `userId` do `TenantAuthorizationQuery`. UUID podany w body/path/MCP może być selektorem zasobu, ale **nie tożsamością wykonującego**: jego format ani istnienie członkostwa nie dowodzą posiadania zweryfikowanej sesji. Adapter 6D-1 ufa wywołującej go kompozycji serwerowej i sam nie uwierzytelnia. Nie należy wystawiać `getFacts` jako publicznego API ani zwracać szczegółów faktów do klienta.

## Dowody i granice testów

Testy jednostkowe uruchamiają rzeczywisty builder i mapowanie Drizzle z transportem sterownika zastąpionym syntetycznymi wierszami: jeden SELECT, parametry i wszystkie predykaty zakresu, NULL, milisekundy, status/daty, wiele grantów, brak domyślnych ról, nowy odczyt po cofnięciu i redakcja awarii. Nie wymagają DB.

`packages/db/test/tenant-authorization.integration.ts` wykonuje migracje na prawdziwym PostgreSQL i wywołuje istniejący application service z adapterem. Pokrywa zezwolenie A/read/A1; odmowy A2, B1, zmiany tenanta, innej akcji/użytkownika, administratora bez grantu, braku/cofnięcia/przyszłego/wygaśnięcia członkostwa; daty/cofnięcie/wygaśnięcie grantu i granice `[od, do)`; świeży odczyt, równoległe wielokrotne zapytania różnych tenantów (także ten sam użytkownik w A i B), rzeczywistą awarię tabeli oraz ochronę przed reaktywacją. Sprawdza też zawartość faktów, więc odmowa nie maskuje pobrania cudzych grantów. Używa istniejącego helpera bezpiecznej `pap_test`, własnego losowego namespace i sprzątania/inwentaryzacji. CI uruchamia cały zestaw `pnpm test:integration` obowiązkowo; przed nim buduje zależności application/domain.

## Następne etapy (6D-2 zrealizowane, pozostaje 6D-3)

Etap [6D-2](25-uwierzytelnianie-oidc-i-tozsamosc-6d2.md) dostarczył serwerowy adapter tożsamości OIDC, resolver `(issuer, subject) -> userId`, autoryzację administracyjną `manageAccess` oraz kompozycję z `authorizeCompanyAction` w pipeline API. RLS/rola runtime, atomowość transakcyjna decyzji z operacją na danych i audyt decyzji pozostają wydzielonym etapem 6D-3 z security review.
