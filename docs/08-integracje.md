# 08. Integracje publiczne i finansowe

## KSeF 2.0
Adapter konfiguracji środowiska, pozyskiwania poświadczeń zgodnie z oficjalnymi metodami, pobierania faktur XML, synchronizacji identyfikatorów, statusów i UPO, walidacji FA(3), wystawiania faktur i korekt. Ewidencjonuj środowisko, zgody, daty, identyfikatory, retry i historię błędów. Test i produkcja muszą mieć osobne konfiguracje i uprawnienia; produkcyjne wysyłanie wymaga osobnego zatwierdzenia.

## JPK
Wersjonowane eksporty plików zgodne z konkretnym profilem oraz datą obowiązywania schemy; walidacje XSD, spójność danych bazowych, okresu i sald. Przede wszystkim JPK_V7M/V7K i struktury dochodowe JPK_PD, a potem kolejne po merytorycznej walidacji. Samo wygenerowanie poprawnego XML nie oznacza poprawnego podatku.

## Podatki i instytucje
- Podatki.gov.pl/MF: dokumentacja i schematy urzędowe.
- ZUS/PUE/eZUS: wstępnie terminy i wyliczenia, integracje transakcyjne dopiero po analizie legalności/API.
- CEIDG/REGON/KRS: weryfikacja podmiotu na podstawie udostępnionych oficjalnych danych.
- Biała lista VAT i VIES: sprawdzanie właściwych identyfikatorów i statusów, cache z datą kontroli.
- NBP: kursy z datą publikacji i zastosowania.
- e-Doręczenia: kalendarz obowiązków, link do operatora, bez nieuzasadnionego założenia otwartego API.

## Banki
Pierwsza wersja: CSV, MT940, CAMT. Uznawaj transakcję za zimportowaną dopiero po walidacji struktury i duplikatu. Dostęp PSD2/Open Banking w przyszłości przez uprawnionego dostawcę, przy zgodzie i odrębnym modelu ryzyka.

## Operacyjne zasady adapterów
Dla każdej integracji dokumentuj: oficjalną specyfikację, licencję/użytkowanie API, dostępne środowiska, sposób uwierzytelnienia, limity, idempotencję, błędy, monitoring, retencję danych, wersję i testy. Żadnej funkcji transakcyjnej nie ogłaszaj jako aktywnej przed testami end-to-end.