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
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --audit-level high
```

Osobny job skanuje pełną historię repozytorium pod kątem sekretów. Workflow ma minimalne uprawnienia odczytu i przypięte akcje GitHub do SHA.

## Zakres testów w szkielecie

- **Domain:** akceptacja poprawnych UUID oraz odrzucanie niepoprawnych identyfikatorów. Typ identyfikatora nie zastępuje autoryzacji. Testowana jest także czysta polityka aktywnego członkostwa, jawnych grantów tenant/firma/akcja, czasu ważności i odmowy domyślnej.
- **Contracts:** walidacja kontraktu statusu, odrzucanie nieznanych pól i nieuzasadnionych twierdzeń o dostępności.
- **Application:** wynik współdzielonego use case statusu oraz policy use case działający na porcie zaufanego źródła. Testy używają wyłącznie syntetycznych danych i implementacji in-memory.
- **API:** testy przez prawdziwy adapter Nest/Fastify w pamięci; health check, zgodność odpowiedzi z kontraktem i brak niezdefiniowanej trasy administracyjnej tenantów.
- **Web:** renderowalny, prawidłowy status; odrzucanie niepoprawnego payloadu i adresu API zawierającego dane logowania.
- **Web → API E2E:** przeglądarka sprawdza działające połączenie z lokalnym Nest/Fastify API, stan UI po zatrzymaniu API oraz styl komponentu współdzielonego z `packages/ui`.
- **MCP:** test klient-serwer przez transport in-memory i potwierdzenie, że serwer udostępnia wyłącznie narzędzie `system_status`; osobny proces uruchamia serwer przez STDIO.
- **Granice architektoniczne (`pnpm test:arch`, uruchamiane także w `pnpm test`):** programowy test ESLint weryfikujący reguły `no-restricted-imports` z `eslint.config.mjs` — blokowanie niedozwolonych zależności (m.in. `@nestjs/common` i `drizzle-orm` w `packages/domain`, `@pap/db` w `apps/web` oraz `apps/mcp`) oraz akceptację dozwolonych importów (np. `@pap/contracts`).

Testy polityki nie dowodzą działającej autoryzacji użytkowników ani izolacji tenantów w aplikacji: nie ma testów integracyjnych DB, migracji, OIDC, połączenia policy check z API/MCP, audytu operacji finansowych ani integracji urzędowych. Dla przyszłych operacji firmowych wymagane będą testy negatywne izolacji i uprawnień end-to-end według [ADR-004](adr/004-model-zagrozen-i-autoryzacji.md).

## Lokalna kontrola PR

Uruchom wszystkie polecenia CI przed otwarciem PR.

Każda zmiana reguł prawnych wymaga osobnych testów referencyjnych, dat obowiązywania, źródła urzędowego i przeglądu eksperta — sam szkielet nie implementuje takich reguł.
