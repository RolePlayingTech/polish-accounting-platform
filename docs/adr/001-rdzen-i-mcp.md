# ADR-001: Jeden rdzeń księgowy, MCP jako powierzchnia dostępu

**Status:** zaakceptowana zasada architektoniczna; szczegóły implementacyjne otwarte.

## Kontekst
Ten sam dokument może zostać dodany i sprawdzony przez web UI, API integracji albo agenta MCP. Oddzielny mechanizm księgowy dla każdej powierzchni prowadziłby do niespójnych uprawnień i rozbieżnych obliczeń.

## Decyzja
- Jeden modułowy rdzeń domenowy z jedną autoryzacją i wersjonowaniem reguł.
- MCP Gateway jest adapterem protokołu, nie „superadministratorem”.
- AI/OCR dostarczają szkice; wyliczenia należą do testowanego silnika reguł.
- Niezmienny audit trail i rozdzielone przygotowanie oraz zatwierdzenie operacji.
- Wspólne policy checks uwzględniają tenant, entity, profil, datę i role.

## Alternatywy
1. Niezależne backendy dla UI/MCP: odrzucone z powodu rozjazdu uprawnień.
2. Pełna automatyczna księgowość przez LLM: odrzucona ze względu na nieprzewidywalność i brak weryfikowalnej podstawy.
3. Architektura mikroserwisowa od początku: odłożona do uzasadnienia skalą.

## Konsekwencje
Wczesna praca nad modelem danych, autoryzacją i testami, ograniczenie tempa dodawania integracji, lepsza audytowalność i łatwiejsze rozszerzanie profili.