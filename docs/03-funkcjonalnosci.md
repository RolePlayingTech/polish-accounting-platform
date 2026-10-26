# 03. Katalog funkcjonalności

Priorytety: P0 — fundament, P1 — pierwsza księgowość JDG, P2 — pełne księgi i rozszerzenia.

## P0 — administracja
- OIDC, MFA, zaproszenia, kontrola sesji, role właściciel/księgowy/recenzent/odczyt.
- Wiele podmiotów, widoczny kontekst firmy, profile wersjonowane.
- Uwierzytelnione API, audyt każdego odczytu wrażliwych danych i modyfikacji.
- Pulpit, powiadomienia, terminy, kolejki do weryfikacji.

## P0 — dokumenty
- Upload PDF, JPG/PNG, XML, CSV; weryfikacja MIME, skanowanie malware, limity, hash.
- Wersja oryginalna write-once, metadane, OCR, ręczna poprawa, tagowanie i full-text search.
- Typy: faktury zakup/sprzedaż, korekty, umowy, rachunki, wyciągi, dowody wewnętrzne, pisma.
- Wykrywanie duplikatów wielowymiarowo: hash, wystawca, numer, data, kwota, identyfikator KSeF.
- Zgoda człowieka przed zmianą danych finansowych.

## P0 — MCP
- Rozpoznawanie zasobów firmy, odczyt i filtrowanie dokumentów, status zadań, metadane.
- Przygotowywanie importów, klasyfikacji i wersji roboczych; brak niekontrolowanego publikowania.
- Scoped tokens, RBAC/ABAC, idempotencja, audyt, ograniczenia i zatwierdzenia UI.

## P1 — księgowość i podatki JDG
- Zatwierdzone profile KPiR i ryczałtu; księgowanie na wskazane okresy, korekty i zamknięcie okresu.
- Rejestry VAT i rozrachunki; środki trwałe i amortyzacja po odrębnej walidacji.
- Integracja KSeF: synchronizacja faktur, przygotowanie wystawienia, stan, UPO, ponowienia.
- JPK i szkice rozliczeń wyłącznie tam, gdzie profil ma pełny zestaw testów.

## P2 — rachunkowość spółek
- Pełny plan kont, Wn/Ma, dzienniki, obroty/salda, uzgodnienia, CIT, sprawozdania.
- Obsługa wspólników, wielowalutowość, bilanse i rachunek wyników.
- Biuro rachunkowe, kadry i płace, bank PSD2 przez uprawnionego dostawcę.

## Wymagania niefunkcjonalne
WCAG 2.2 AA jako cel, dostępność mobilna, backup i restore, obserwowalność bez PII, bezpieczeństwo plików, wykonalność testów na danych syntetycznych, brak zmian prawa bez procesu zatwierdzania.