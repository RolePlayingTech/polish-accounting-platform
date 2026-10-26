# 04. Przepływy end-to-end

## Nowa firma
1. Użytkownik loguje się przez OIDC i MFA.
2. Tworzy tenant i profil jednostki; wprowadza NIP, status VAT, typ ewidencji i okres obowiązywania.
3. System potwierdza spójność pól, bez przyjmowania domyślnego reżimu opodatkowania.
4. Dopiero po nadaniu ról użytkownik może importować dokumenty.

## Wgranie faktury
1. Upload po wyborze firmy, antywirus, hash i zapis niezmiennego oryginału.
2. Ekstrakcja i walidacja dat, NIP, kwot, VAT i oznaczeń.
3. Rozpoznanie duplikatu i oznaczenie niepewnych pól.
4. Kolejka do weryfikacji → ręczne poprawki z uzasadnieniem → zatwierdzenie.
5. Jeżeli aktywna funkcja księgowa: propozycja kwalifikacji z wersją reguły; księgowanie dopiero po akceptacji.

## Import KSeF
1. Autoryzowany użytkownik konfiguruje uprawnienia i wybiera środowisko test/produkcja.
2. Adapter synchronizuje z paginacją i checkpointem, pobiera faktury i przechowuje XML.
3. Rejestruje numer KSeF, status, identyfikatory i konflikty; nie tworzy duplikatów.
4. Awaria nie powoduje utraty checkpointów, ponowienie jest idempotentne.

## MCP: propozycja księgowania
Agent uzyskuje scoped token do konkretnej firmy → wywołuje dokumenty i walidacje → create_draft z idempotency_key → użytkownik dostaje ekran porównania → zatwierdza lub odrzuca → audyt wskazuje agenta, operację, wersję danych i zatwierdzającego. Brak zgody = brak zapisu księgowego.

## Zamknięcie okresu
Sprawdzenie brakujących dokumentów i nieuzgodnionych rozrachunków → podsumowanie obowiązków → walidacja okresu i wersji reguł → uprawnione zatwierdzenie → zamknięcie. Korekty tworzą osobne, śledzone operacje.

## Błędy
Niezgodny NIP, podwójny upload, fałszywa faktura, błąd OCR, niepełne uprawnienia, reset tokena lub przerwa połączenia muszą kończyć się bezpiecznym stanem i czytelnym raportem.