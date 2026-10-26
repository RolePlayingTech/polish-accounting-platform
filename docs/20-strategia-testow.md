# 20. Strategia testów i aktualna walidacja

## Polecenia automatyczne

CI uruchamia na pull requestach i pushach do `main`:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high
```

Osobny job skanuje pełną historię repozytorium pod kątem sekretów. Workflow ma minimalne uprawnienia odczytu i przypięte akcje GitHub do SHA.

## Zakres testów w szkielecie

- **Domain:** akceptacja poprawnych UUID oraz odrzucanie niepoprawnych identyfikatorów. Typ identyfikatora nie zastępuje autoryzacji.
- **Contracts:** walidacja kontraktu statusu, odrzucanie nieznanych pól i nieuzasadnionych twierdzeń o dostępności.
- **Application:** wynik współdzielonego use case statusu.
- **API:** testy przez prawdziwy adapter Nest/Fastify w pamięci; health check, zgodność odpowiedzi z kontraktem i brak niezdefiniowanej trasy administracyjnej tenantów.
- **Web:** renderowalny, prawidłowy status; odrzucanie niepoprawnego payloadu i adresu API zawierającego dane logowania.
- **MCP:** test klient-serwer przez transport in-memory i potwierdzenie, że serwer udostępnia wyłącznie narzędzie `system_status`; osobny proces uruchamia serwer przez STDIO.

Testy nie dowodzą izolacji tenantów ani poprawności księgowania, bo te mechanizmy jeszcze nie istnieją. Brak jest testów integracyjnych DB, migracji, przeglądarkowych e2e, OIDC, ról, audytu operacji finansowych i integracji urzędowych. Dla przyszłych operacji firmowych wymagane będą testy negatywne izolacji i uprawnień według [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md).

## Lokalna kontrola PR

Uruchom wszystkie polecenia CI przed otwarciem PR.

Każda zmiana reguł prawnych wymaga osobnych testów referencyjnych, dat obowiązywania, źródła urzędowego i przeglądu eksperta — sam szkielet nie implementuje takich reguł.
