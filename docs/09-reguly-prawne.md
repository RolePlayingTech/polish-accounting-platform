# 09. Silnik reguł prawnych i aktualizacji

## Dlaczego reguły wersjonowane
Prawo podatkowe zmienia się w trakcie roku. Reguła rozliczenia musi być przypisana do okresu, formy działalności i faktów, a także do obowiązującego na dany moment aktu prawnego.

## Źródła pierwszego wyboru
Dziennik Ustaw / ISAP, Ministerstwo Finansów, podatki.gov.pl, ksef.podatki.gov.pl, ZUS, gov.pl, oficjalne schemy i dokumentacja API. Materiały wtórne są tylko sygnałem do kontroli, nigdy samodzielną podstawą.

## Pipeline aktualizacji
1. Monitor źródeł (RSS, katalogi publikacji, API, ewentualnie przegląd ręczny).
2. Detekcja nowej wersji przepisu, interpretacji, schemy, terminu lub komunikatu.
3. Klasyfikacja: dotyczy jakich typów podmiotów, okresów i operacji.
4. Przygotowanie propozycji zmiany w osobnym PR, z linkiem i datą wejścia w życie.
5. Weryfikacja merytoryczna (księgowy/doradca) oraz testy regresyjne na syntetycznych przypadkach.
6. Zatwierdzenie i wersja rule-set w systemie; możliwość wycofania.
7. Użytkownik widzi, jakie wyliczenia zmieniła wersja.

## Model reguły
rule_id, rule_version, source_url, act_reference, published_at, effective_from, effective_to, applicable_profiles, schema_version, reviewers, test_case_ids, approved_at. Historycznych reguł nie nadpisuj.

## Oddzielenie AI od prawa
LLM może streścić zmiany, znaleźć dokument źródłowy, zaproponować scenariusze i przygotować PR. Nie może samodzielnie zatwierdzić interpretacji, stawki, deklaracji ani automatycznie zmienić algorytmów dla rzeczywistych rozliczeń.

## Kontrole
Harmonogram sprawdzania stanu prawa, alert o nowej wersji schemy, testy granicznych dat, walidacja różnic i widok „stan prawny na dzień”. Każda deklaracja raportuje użyte rule-set i schemy.

## Uwaga
Żaden zewnętrzny system MCP nie gwarantuje aktualności prawa. Zapytania o dane publiczne muszą być zweryfikowane, a zmiany dopuszczone przez proces zatwierdzeń.