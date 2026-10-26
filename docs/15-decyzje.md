# 15. Otwarte decyzje projektowe

To rejestr decyzji architektury. Wybór stosu w [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md) dotyczy kodu, **nie** zgody na konfigurację ani uruchomienie produkcji.

| ID | Decyzja | Propozycja | Status |
| --- | --- | --- | --- |
| D-01 | Marka i repo | Polish Accounting Platform / polish-accounting-platform | Nazwa przyjęta |
| D-02 | Pierwszy wspierany profil | JDG KPiR, potem ryczałt | Do zatwierdzenia |
| D-03 | MVP dokumentowy | Multi-tenant + archive + OCR + draft + MCP read | Propozycja |
| D-04 | Licencja | MIT (z wyłączeniem danych klientów) | Dokumentowana |
| D-05 | Hosting | Kontenery/managed Postgres/S3 w UE/EOG, OpenTofu, bez Kubernetes na start | Podejście wybrane; konkretny dostawca i koszty otwarte |
| D-06 | Stack | TS strict, Node 24 LTS, Next.js, NestJS/Fastify, PostgreSQL/Drizzle, pg-boss | Wybrane w [ADR-002](adr/002-stos-technologiczny-i-wdrozenia.md) |
| D-07 | Storage | Szyfrowany S3-compatible, immutable oryginały, AV scan i retencja | Architektura wybrana; dostawca przed wdrożeniem |
| D-08 | Identity | OIDC/MFA; Keycloak jako dostawca referencyjny, API odpowiada za ABAC | Architektura wybrana; konfiguracja i operacje do przeglądu |
| D-09 | Review podatkowe | Wyznaczyć osobę kompetentną i proces odbioru | Blokuje funkcje compliance |
| D-10 | Integracje produkcyjne | Brak bez osobnej zgody i testów | Zasada |
| D-11 | MCP approval | Draft + TTL/hash + potwierdzenie człowieka | Zasada |
| D-12 | Licencje danych rejestrów | Ocena warunków każdego API | Otwarte |

## Reguła
Decyzja wpływająca na bezpieczeństwo, podatki, strukturę danych lub dostawców zewnętrznych musi mieć uzasadnienie, konsekwencje i powiązany ADR/Issue. Nie podejmować jej automatycznie przez agenta.