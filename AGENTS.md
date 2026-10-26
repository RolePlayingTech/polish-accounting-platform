# Zasady dla agentów AI

Projekt: Polish Accounting Platform. Wszystkie zmiany projektuj dla jurysdykcji polskiej i w języku polskim.

## Zasady bezwzględne
1. Priorytet: bezpieczeństwo danych, zgodność, audytowalność, dopiero potem funkcje.
2. Zanim rozpoczniesz pracę, przeczytaj README, roadmapę, architekturę, MCP, bezpieczeństwo, Issue i otwarte PR. Nie duplikuj zadań.
3. Jedno zadanie = jeden wąski PR. Dodaj testy (także negatywne), dokumentację, ryzyka i migracje.
4. Reguły księgowe/podatkowe muszą mieć źródło urzędowe, daty obowiązywania, wersję, testy referencyjne i kontrolę eksperta.
5. AI i OCR wyłącznie proponują dane; zatwierdzanie księgowania, deklaracji, płatności i wysyłki do urzędów jest odrębną autoryzowaną operacją.
6. Żadnych danych rzeczywistych osób, tokenów, sekretów, certyfikatów ani faktur w publicznym repozytorium.
7. Nie wykonuj operacji na produkcji ani wysyłki do instytucji bez odrębnej zgody właściciela projektu.
8. W API, UI i MCP obowiązuje jedna i ta sama autoryzacja; każdy tenant jest izolowany.
9. Dokumentacja to plan, nie dowód, że system realizuje daną funkcję.

## Checklist PR
- [ ] Połączono z właściwym Issue.
- [ ] Uwzględniono przynajmniej jeden scenariusz niepoprawny.
- [ ] Zweryfikowano izolację firm, role i audyt.
- [ ] Brak danych wrażliwych i sekretów.
- [ ] Zaktualizowano dokumentację i ADR, gdy decyzje się zmieniły.
- [ ] W przypadku reguł prawa udokumentowano źródło, wersję i datę.
- [ ] Zmiany nie uruchamiają automatycznie połączeń produkcyjnych.

Najpierw: docs/12-roadmapa.md i docs/13-kryteria-akceptacji.md.