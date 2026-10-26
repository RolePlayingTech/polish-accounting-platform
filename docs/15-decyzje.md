# 15. Otwarte decyzje projektowe

To jest rejestr do zatwierdzenia, nie zbiór domyślnych ustawień produkcyjnych.

| ID | Decyzja | Propozycja | Status |
| --- | --- | --- | --- |
| D-01 | Marka i repo | Polish Accounting Platform / polish-accounting-platform | Nazwa przyjęta |
| D-02 | Pierwszy wspierany profil | JDG KPiR, potem ryczałt | Do zatwierdzenia |
| D-03 | MVP dokumentowy | Multi-tenant + archive + OCR + draft + MCP read | Propozycja |
| D-04 | Licencja | MIT (z wyłączeniem danych klientów) | Dokumentowana |
| D-05 | Hosting | UE/EOG, mocny nacisk na RODO i backup | Do decyzji |
| D-06 | Stack | TypeScript + React + Node + PostgreSQL | ADR wymagany |
| D-07 | Storage | Szyfrowany S3-compatible, write-once oryginałów | ADR wymagany |
| D-08 | Identity | OIDC/MFA, role, konta wielu firm | ADR wymagany |
| D-09 | Review podatkowe | Wyznaczyć osobę kompetentną i proces odbioru | Blokuje funkcje compliance |
| D-10 | Integracje produkcyjne | Brak bez osobnej zgody i testów | Zasada |
| D-11 | MCP approval | Draft + TTL/hash + potwierdzenie człowieka | Zasada |
| D-12 | Licencje danych rejestrów | Ocena warunków każdego API | Otwarte |

## Reguła
Decyzja wpływająca na bezpieczeństwo, podatki, strukturę danych lub dostawców zewnętrznych musi mieć uzasadnienie, konsekwencje i powiązany ADR/Issue. Nie podejmować jej automatycznie przez agenta.