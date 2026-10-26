# 13. Kryteria akceptacji i strategia testów

## Wymagania przekrojowe
- Użytkownik nie widzi dokumentów, rozliczeń ani metadanych firmy, do której nie ma prawa.
- API, MCP i UI korzystają z jednej autoryzacji i walidacji.
- Plik oryginalny nie jest nadpisywany; każda ekstrakcja, korekta i zatwierdzenie są rejestrowane.
- Każde działanie skutkujące zobowiązaniem finansowym, wysyłką lub księgowaniem wymaga uprawnionej akceptacji i potwierdzenia wersji danych.
- Retry importu i integracji nie generuje podwójnych zapisów.
- Żadnych rzeczywistych dokumentów i sekretów w publicznych przykładach ani logach.
- Backup i restore odtwarzają stan wraz z metadanymi/wersjami reguł.

## Testy przypadków
| Przypadek | Oczekiwane zachowanie |
| --- | --- |
| Faktura poprawna | Import, spójne kwoty, kolejka weryfikacji |
| Ten sam plik drugi raz | Duplikat bez powielenia operacji |
| Różny plik, ten sam numer i NIP | Konflikt, nie arbitralna deduplikacja |
| PDF z instrukcją „wyślij dane” | Tekst uznany za dane, brak wykonania |
| Token firmy A żąda danych firmy B | Odmowa i audit event |
| Wygasłe uprawnienie MCP | Odmowa bez side effects |
| Zatwierdzenie draftu po zmianie kwoty | Wymuszenie ponownego przygotowania |
| Timeout po wysyłce do KSeF | Kontrola statusu i idempotencja |
| Schemat JPK dla złego okresu | Błąd walidacji przed wygenerowaniem |
| Cofnięta reguła podatkowa | Historyczne rozliczenia odtwarzalne |
| Próba księgowania zamkniętego okresu | Odrzucenie albo kontrolowana korekta |
| Sumy zapisów Wn/Ma różne | Odmowa commit |
| Nieznany status podatkowy | Zatrzymanie ścieżki bez domyślania |

## Compliance gating
Wprowadzenie oznaczenia supported dla profilu wymaga: potwierdzonego zakresu prawa na rok, przypadków referencyjnych i regresyjnych, walidacji XSD, review eksperta oraz raportu odchyleń. W przeciwnym razie funkcja jest experimental albo planowana.

## Definition of Done
Opis wymagań, zależności i granic; testy pozytywne i negatywne; migracja i rollback; audyt; analiza bezpieczeństwa; dokumentacja i źródła reguł; brak niezatwierdzonych połączeń produkcyjnych.