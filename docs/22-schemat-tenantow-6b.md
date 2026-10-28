# 22. Schemat tenantów, firm i grantów — pakiet 6B

**Data:** 2026-10-28. **Powiązanie:** [Issue #6](https://github.com/RolePlayingTech/polish-accounting-platform/issues/6), PR #16 (polityka 6C), PR #17 (fundament 6A).

To minimalny schemat PostgreSQL/Drizzle i testy integralności relacyjnej. Nie jest ukończoną izolacją danych użytkowników: SELECT bez autoryzacji nadal może odczytać cudze rekordy. OIDC, zaufany adapter portu autoryzacji, egzekwowanie w API/MCP, RLS i audyt pozostają w 6D. Issue #6 pozostaje otwarte.

## Tabele i granice

| Tabela | Klucze i reguły |
| --- | --- |
| `tenant` | PK `id` UUID, obowiązkowa niepusta `name`, `created_at` |
| `legal_entity` | PK UUID, FK do tenanta, nazwa wyświetlana, `created_at`; UNIQUE `(tenant_id, id)` jest kluczem kandydującym dla FK |
| `tenant_membership` | PK `(tenant_id, user_id)`, FK do tenanta, jawna rola i status, okres ważności |
| `entity_profile_version` | PK UUID, FK `(tenant_id, legal_entity_id)` do firmy, techniczny `profile_code`, okres i EXCLUDE blokujący nakładanie wersji tej samej firmy |
| `company_access_grant` | PK `grant_id` UUID, FK `(tenant_id, user_id)` do członkostwa oraz `(tenant_id, legal_entity_id)` do firmy, akcja i okres, opcjonalne cofnięcie |

Złożone FK uniemożliwiają zapis grantu tenanta A do firmy B1 z tenanta B, także przy UPDATE. Firma A1 i firma A2 tego samego tenanta mają odrębne granty. Nie ma triggera przyznającego dostęp po utworzeniu członkostwa. Role `tenant_owner`, `tenant_admin`, `tenant_member` są jedynymi rolami członkostwa; statusy to `active` i `revoked`. Grant ma wyłącznie akcję `read` lub `write`. Role platformy nie są częścią tego schematu.

Nie dodajemy technicznej tabeli użytkownika ani logowania. `user_id` jest wewnętrznym UUID, który przyszły adapter ustali ze zweryfikowanej tożsamości serwerowej. Nie jest bezpośrednio claimem OIDC `sub` (ten nie musi być UUID); potrzebne będzie osobne, przemyślane mapowanie wystawca + subject → wewnętrzny użytkownik. Obecnie DB nie gwarantuje istnienia konta użytkownika, lecz gwarantuje istnienie jego członkostwa w tenancie grantu. W 6D trzeba rozstrzygnąć model tożsamości i ewentualną migrację FK. Żądanie klienta nie może tworzyć wiarygodnej tożsamości samym UUID.

Członkostwo jest jednym rekordem stanu na parę tenant/użytkownik, bez historii zmian ról. PK zapobiega niejednoznacznym rekordom dla obecnego kontraktu `TenantMembership`. Granty mają własne identyfikatory, mogą współistnieć i zostać zachowane po cofnięciu. Wszystkie FK mają `RESTRICT` przy usuwaniu i zmianie klucza: nie kasujemy grantów ani profili kaskadowo. Zmiana statusu/okresu członkostwa pozostaje możliwa. Audyt oraz bezpieczny cykl cofnięcia i ponownego nadania członkostwa/grantów wymagają przyszłej operacji aplikacyjnej; obecny schemat ich nie realizuje.

## Czas i wersje profilu

Okresy mają postać **`[valid_from, valid_until)`**: początek włącznie, koniec wyłącznie; NULL oznacza brak zaplanowanego końca. CHECK wymaga końca późniejszego od początku. Pola są `timestamptz(3)`, czyli chwilami czasu z precyzją milisekund zgodną z JS `Date`, a nie datami księgowymi ani lokalnymi datami kalendarzowymi. Przyszłe reguły podatkowe muszą osobno ustalić znaczenie dat i strefę `Europe/Warsaw`. Nie wprowadzamy takich reguł w 6B.

CHECK odrzuca nieskończone początki, końce i `revoked_at`, których obecny kontrakt `Date` nie obsługuje. `revoked_at` może poprzedzać `valid_from`: kontrakt pozwala odwołać przyszły grant. Nie wymuszamy, by okres grantu zawierał się w okresie członkostwa; oba okresy oraz status sprawdza już czysta polityka z PR #16. Przechowanie cofniętego/wygasłego rekordu nie nadaje prawa działania. Sam FK nie sprawdza aktualności dostępu.

`profile_code` jest niepustą etykietą techniczną, bez katalogu VAT, KPiR czy form prawnych i bez deklaracji weryfikacji prawnej. W każdej chwili firma ma najwyżej jeden profil, niezależnie od kodu. Sąsiednie wersje są dozwolone, przerwy również. Brak profilu wymaga przyszłej jawnej obsługi, a nie domyślnego profilu podatkowego.

Najmniejsze deklaratywne rozwiązanie zakazu nakładania to `EXCLUDE USING gist (tenant_id WITH =, legal_entity_id WITH =, tstzrange(valid_from, valid_until, '[)') WITH &&)`. Obsługuje też równoległe transakcje i UPDATE. UUID wymaga operatorów GiST z rozszerzenia `btree_gist`, dołączonego do PostgreSQL. To rozszerzenie zaufane: instalacja wymaga uprawnienia CREATE do bazy, bez nadawania superusera. Alternatywny trigger wymagałby blokowania i dodatkowych dowodów poprawności współbieżnej; zwykły CHECK/UNIQUE nie wystarcza. Źródła: [PostgreSQL 18 — ograniczenia zakresów](https://www.postgresql.org/docs/18/rangetypes.html#RANGETYPES-CONSTRAINT), [btree_gist](https://www.postgresql.org/docs/18/btree-gist.html).

Indeks UNIQUE firmy obsługuje dostęp po tenant/firma. PK członkostwa obsługuje tenant/użytkownik. Grant ma indeks `(tenant_id, user_id, legal_entity_id, action)` oraz `(tenant_id, legal_entity_id)` dla wyszukiwania i FK. Profil ma indeks `(tenant_id, legal_entity_id, valid_from)` i indeks GiST ograniczenia EXCLUDE. Te indeksy nie są mechanizmem autoryzacji.

## Migracje i izolacja testów

`0000_technical-baseline.sql` i jego snapshot pozostają bez zmian. `0001_tenant-schema.sql` jest nową migracją ze snapshotem i wpisem journal. Drizzle nie modeluje EXCLUDE w snapshotach; to ograniczenie i rozszerzenie znajdują się w jawnym SQL. `db:generate` przy niezmienionym modelu nie generuje kolejnej migracji, ale nie dowodzi obecności EXCLUDE w bazie — dowodzą jej testy PostgreSQL.

Zwykły `connectDatabase` ustawia na każdym połączeniu puli `search_path=public,pg_catalog`. Migracje ręczne tworzą tabele i rozszerzenie w `public`, a rejestr w `drizzle.__drizzle_migrations`, zgodnie z 6A. Wszystkie połączenia pozostają ograniczone do local/test i loopback. Nie zmieniamy migratora Drizzle ani uruchamiania `pnpm dev`.

`migrationsSchema` migratora **wybiera tylko rejestr**, nie namespace tabel z SQL. Dlatego testy ustawiają osobno namespace danych przez `connectDatabase(env, dataSchema)`; dozwolona jest wyłącznie nazwa `pap_test_` + 32 znaki hex i środowisko `test`. Używają tej samej nazwy dla rejestru. Drizzle generuje w FK jawne `REFERENCES "public"...`; w nowej migracji 6B usunięto ten kwalifikator podczas review, aby referencje wskazywały namespace połączenia. Przy kolejnych migracjach trzeba zachować tę regułę. Snapshot nadal opisuje domyślny schemat `public`.

Przed otwarciem połączenia helper testowy odrzuca migracje z kwalifikatorami `public` i poleceniami tworzenia/usuwania schematów. Tworzy losowy schemat bez `IF NOT EXISTS`, zapamiętuje udane utworzenie i w `finally` usuwa tylko ten własny schemat. Porównuje inwentaryzację relacji (wraz z OID), schematów i rozszerzeń sprzed i po teście. Nie usuwa bazy ani zastanych tabel. Istniejące dane poza namespace nie są używane jako fixtures. Osobny test sprawdza zachowanie danych istniejących przed nieudaną migracją.

`btree_gist` jest instalowane w bieżącym namespace i usuwane razem ze schematem testu. Ponieważ nazwa rozszerzenia jest globalna dla bazy, zestawy DB działają kolejno (`fileParallelism: false`). Helper odmawia testu, jeśli `pap_test` ma już `btree_gist`; nie przenosi go ani nie usuwa. Sama migracja odmawia, jeśli zastane rozszerzenie należy do innego schematu niż dane. W CI używamy świeżej `pap_test`. Lokalnie najlepiej użyć przygotowanej do testów bazy bez wcześniejszych ręcznych migracji; nie czyść zastanej bazy na potrzeby testu.

Drizzle wykonuje oczekujące pliki i ich wpisy rejestru w transakcji. Test konfliktu tabeli potwierdza rollback wszystkich nowych tabel, rozszerzenia i wpisów migracji; techniczny rejestr utworzony przed transakcją może pozostać pusty. Ponowienie po usunięciu wyłącznie własnej przyczyny błędu stosuje obie wersje. Ponowienie udanej migracji nie zmienia rejestru ani OID obiektów.

## Ryzyka i wycofanie

Migracja jest addytywna i nie ma automatycznej migracji w dół. W razie błędu transakcja wycofuje nowy DDL; konflikt nazwy nie nadpisuje istniejącej tabeli. Po udanej migracji nie usuwać schematu, tabel ani rozszerzenia jako rollbacku aplikacji — wycofanie kodu pozostawia dane, a korekta wymaga kolejnej reviewowanej migracji. Brak rozszerzenia na serwerze lub brak uprawnień CREATE oznacza błąd migracji, bez automatycznej instalacji PostgreSQL lub zmian uprawnień systemowych.

Nie ma audytu, RLS ani ograniczonej roli runtime. Konta local/test służą developerskiemu DDL i nie stanowią konfiguracji produkcyjnej. Nie podłączamy tabel do publicznych endpointów, MCP ani UI. W testach są wyłącznie syntetyczne dane i deterministyczne UUID. Brak integracji z urzędami, płatności, infrastruktury i deploymentu.
