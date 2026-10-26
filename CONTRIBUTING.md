# Współtworzenie

Dziękujemy za zainteresowanie projektem polskiej księgowości open source. Repozytorium zawiera działający szkielet developerski. Nie obsługuje jeszcze rzeczywistych procesów księgowych.

## Przed zgłoszeniem

1. Przeczytaj [README](README.md), [wizję](docs/01-wizja-i-zakres.md) i [roadmapę](docs/12-roadmapa.md).
2. Sprawdź, czy temat nie istnieje już w roadmapie albo zgłoszeniach; unikaj duplikatów.
3. Nie udostępniaj żadnych realnych danych podatkowych, faktur klientów, certyfikatów ani sekretów.
4. Jeżeli proponujesz regułę finansowo-podatkową, podaj oficjalne źródło, datę obowiązywania, zakres profili i testy dat granicznych.

## Pull request

- Jeden logiczny temat na PR, nawiązanie do zadania (`E0-01` itd.).
- Opisz **co, po co, ryzyka, sposób testowania i ograniczenia zgodności**.
- Dla zmian prawnych: dodaj źródła i oczekiwane wyniki zweryfikowane merytorycznie.
- Dla MCP: wyjaśnij scopes, izolację podmiotów, idempotencję i zatwierdzenia.
- Dla integracji: używaj mocków i środowisk testowych, nigdy produkcyjnych danych w CI.
- Przed zmianami kodu przeczytaj [przewodnik developera](docs/19-przewodnik-developera.md), [strategię testów](docs/20-strategia-testow.md) oraz zasady z [AGENTS.md](AGENTS.md).
- Zmiana kodu powinna przechodzić `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` i `pnpm build`.

## Bezpieczeństwo

Wady powodujące ujawnienie dokumentów, nieautoryzowany zapis lub problem z certyfikatami zgłaszaj poufnie zgodnie z [SECURITY.md](SECURITY.md), nie w publicznym issue.
