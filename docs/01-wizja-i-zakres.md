# 01. Wizja i zakres

## Problem
Dokumenty, bankowość, rozrachunki, terminy podatkowe i różne formy ewidencji są rozproszone. Użytkownik musi wielokrotnie przepisywać te same dane i kontrolować poprawność integracji.

## Wizja
Polish Accounting Platform to webowa, otwartoźródłowa platforma do polskich dokumentów finansowo-księgowych i księgowości, sterowana z UI oraz przez Model Context Protocol (MCP). Jeden rdzeń domenowy, wiele firm, niezależne profile księgowe.

## Użytkownicy
- Właściciel jednej lub wielu firm, w szczególności JDG.
- Wspólnik lub reprezentant spółki.
- Księgowy i osoba weryfikująca.
- Administrator tenantów i integracji.
- W przyszłości biuro rachunkowe zarządzające klientami.

## Zasady
- Brak jednolitej reguły dla wszystkich form prawnych: forma prawna, podatnik, VAT, sposób księgowania i upoważnienia są niezależnymi wymiarami.
- Nieodwracalne czynności wymagają zgody osoby uprawnionej.
- Oryginalne dokumenty są niezmienne, poprawki tworzą kolejne wersje i ślad audytu.
- AI dostarcza propozycje wraz z pochodzeniem danych i niepewnością.
- Decyzje podatkowe wynikają z zatwierdzonych reguł, nie z halucynacji LLM.

## Poza pierwszym wydaniem
Wszystkie formy działalności, kadry i płace, automatyczne deklaracje, wszystkie banki, zaawansowane VAT OSS, pełne CIT i zamknięcie roku. Rozwój jest profilowany i walidowany, bez fałszywych deklaracji zgodności.

## Metryki
Poprawność izolacji danych, odtwarzalność rozliczeń, liczba wykrytych duplikatów, czas obsługi dokumentu, pokrycie wersjonowanych przepisów testami, odsetek operacji zatwierdzonych po weryfikacji, brak nieautoryzowanych działań.

## Granice odpowiedzialności
System wspomaga pracę; uprawniony użytkownik lub profesjonalny księgowy odpowiada za zatwierdzanie krytycznych rozliczeń. Produkt nie stanowi sam z siebie usługi doradztwa podatkowego.