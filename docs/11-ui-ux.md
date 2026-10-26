# 11. Projekt interfejsu webowego

## Założenia
Profesjonalny, spokojny interfejs desktop-first, responsywny na tablecie i telefonie; język polski, waluta PLN, czytelne daty i statusy. Nie przytłaczać użytkownika językiem podatkowym bez potrzeby. WCAG 2.2 AA jako cel.

## Nawigacja
- Pulpit — stan firmy, nierozliczone dokumenty, zadania, terminy, alerty.
- Firmy — przełącznik kontekstu i profil: forma, metoda ewidencji, VAT, daty.
- Dokumenty — upload, OCR, faktury, umowy, wyciągi, przeszukiwanie, duplikaty.
- Sprzedaż i zakupy — rejestr, rozrachunki, wystawianie, KSeF.
- Księgowość — dostępne moduły zależnie od profilu (KPiR/ryczałt/księgi).
- Podatki i JPK — status walidacji i plików, okresy i źródła danych.
- Płatności — bankowe operacje zaimportowane i do uzgodnienia.
- Automatyzacje i MCP — klienci, autoryzacje, lista przygotowanych operacji, log.
- Kalendarz / zadania — terminy, powiadomienia.
- Ustawienia — role, integracje, backup, audyt, powiadomienia.

## Pulpit
Nagłówek zawsze pokazuje firmę, jej status i okres rozliczeniowy. Karty: „do sprawdzenia”, „zbliżające się terminy”, „synchronizacja KSeF”, „niedopasowane płatności”, „integracje wymagają zgody”. Pokaż źródło aktualności danych oraz stan ostatniej synchronizacji.

## Ekran dokumentu
Po lewej oryginał PDF/XML z bezpiecznym podglądem; po prawej pola ekstrakcji, oznaczenia niepewności i historia korekt. Przyciski: zapisz wersję roboczą, odrzuć, zaakceptuj. Zmiana danych nie modyfikuje oryginału.

## Centrum zatwierdzania
Przed wykonaniem działań z MCP pokaż: kto/który klient proponuje, firmę, stan przed/po, kwoty, podatki, okres, podstawę reguły, ryzyka, datę wygaśnięcia i dokładny zakres zgody. Zatwierdzenie musi być świadome, wywołanie bez zgody kończy się odmową.

## Stany
Wgraj → Przetwarzanie → Weryfikacja → Zatwierdzony → Zaksięgowany; błędy, konflikty i odrzucone w osobnych stanach. Nie maskować „nie znam” domyślnym zerem.

## Dostępność
Obsługa klawiaturą, screen-reader, kontrast, walidacje inline, nieskrótowe komunikaty błędów, oznaczenie waluty i pełna historia czynności.