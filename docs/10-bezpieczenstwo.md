# 10. Bezpieczeństwo, prywatność i odporność

## Dane i zagrożenia
Aplikacja operuje na fakturach, danych identyfikacyjnych osób fizycznych, danych finansowych i uprawnieniach do systemów urzędowych. Repozytorium publiczne ma zawierać wyłącznie kod i syntetyczne przykłady.

## Kontrola dostępu
Kontrakt ról, granic zaufania, reguł odmowy i przypadków negatywnych opisuje [model zagrożeń i uprawnień](18-model-zagrozen-i-uprawnien.md) oraz [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md). Są to wymagania dla implementacji, nie dowód, że aplikacja już egzekwuje te polityki.

Docelowo OIDC/OAuth, MFA dla operacji wrażliwych i RBAC wsparty warunkami ABAC obejmującymi tenant, firmę, profil, typ operacji i okres. Tokeny MCP mają osobne odbiorniki/scopes, krótki TTL i odwołanie. Każdy odczyt i zapis sprawdza bieżące prawa po stronie serwera. UI nie jest granicą bezpieczeństwa.

## Dokumenty
Malware scanning, MIME/content sniffing, limity wielkości, bezpieczna obróbka plików, anti-zip-bomb i izolowane przetwarzanie OCR. Przechowywanie szyfrowane; oryginał i jego hash niezmienne. Linki do obiektów krótkotrwałe i uwierzytelnione.

## RODO
Określ administratora i procesorów, podstawy przetwarzania, retencję i politykę minimalizacji. Udokumentuj proces realizacji praw osób, analizę DPIA kiedy wymagana, transfery danych poza EOG, ewidencję naruszeń i plan reagowania. Dane w modelach AI: tylko przy wyraźnej konfiguracji i odpowiedniej podstawie/umowie, domyślnie minimalizacja.

## KSeF / banki
Tajemnice przechowuj w secrets manager/KMS, nie w bazie jawnie. Rozdziel konfigurację test/prod. Wszystkie operacje urzędowe i bankowe z pełnym audytem, ponowną autoryzacją i double-check wyniku.

## MCP i AI
Złośliwy opis faktury nie ma mocy instrukcji. Model nie dostaje tokenów dostępu do urzędów; gateway stosuje allowlist narzędzi, ograniczenia output i rate limit. Żaden agent nie jest automatycznie księgowym z pełnymi uprawnieniami.

## Audyt
Nieusuwalny / append-only log metadanych: kto, kiedy, firma, operacja, decyzja, idempotency key, wersja danych, hash, wynik, źródło MCP. Logi aplikacyjne nie zawierają PESEL, całego dokumentu, tokenów czy innych tajemnic.

## Backup, odporność, reagowanie
Odzyskiwanie danych testowane okresowo; alerty na nietypowe eksporty i próby dostępu między firmami; procedura incydentowa, rotacja kluczy, odcięcie integracji i komunikacja użytkowników. Stały przegląd zależności i analiza SAST/DAST.

## Warunki uruchomienia
Zewnętrzny przegląd bezpieczeństwa, testy RODO i izolacji tenantów, wdrożona retencja, backup/restore i udokumentowane procedury. Brak spełnienia = brak produkcyjnego pilotażu.
