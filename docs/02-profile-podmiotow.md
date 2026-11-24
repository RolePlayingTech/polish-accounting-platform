# 02. Profile podmiotów i ewidencji

> **Aktualne matryce wykonawcze (2026-11-24):** Szczegółowa matryca profilu pilota JDG KPiR (`#1`) znajduje się w [dokumencie 32](32-rejestr-regul-prawnych-i-matryca-jdg.md), a bieżący status weryfikacji end-to-end wszystkich profili (`JDG KPiR`, `JDG ryczałt`, `Sp. z o.o. UoR`), źródeł XSD i bramek wydania (`#124`, `#119`, `#100`) prowadzi [rejestr capability i bramek](product/capability-and-gate-registry.md).

## Model

Należy rozdzielić:

1. Jednostkę prawną: NIP/REGON/KRS lub CEIDG i forma organizacyjna.
2. Podatnika: może różnić się od podmiotu (np. wspólnicy spółki osobowej).
3. Profil podatkowy: VAT czynny/zwolniony, PIT/CIT, metody szczególne, okresy ważności.
4. Typ ksiąg: KPiR, ewidencja przychodów, pełna rachunkowość, inne dopuszczone rejestry.
5. Użytkowników, przedstawicieli i delegacje uprawnień.

Każdą zmianę profilu zapisujemy jako wersję z datą od/do; zamkniętych okresów nie przeliczamy milcząco.

## Matryca form

| Podmiot                                  | Typowe scenariusze                         | Uwagi                                                |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| JDG                                      | KPiR, ryczałt, VAT lub zwolnienie          | Sprawdzić warunki wyboru opodatkowania i okres       |
| Spółka cywilna                           | KPiR lub księgi zgodnie z obowiązkami      | Inna identyfikacja rozliczeń wspólników i VAT spółki |
| Spółka jawna / partnerska                | Zależnie od warunków i formy               | Nie zakładać jednolitego PIT/CIT                     |
| Komandytowa / komandytowo-akcyjna        | Księgi rachunkowe, CIT i skutki wspólników | Osobne testy                                         |
| Spółka z o.o. / PSA / S.A.               | Pełne księgi, CIT, VAT                     | Oddzielna domena sprawozdawcza                       |
| Fundacja / stowarzyszenie / spółdzielnia | Własne obowiązki, warianty ewidencji       | Oddzielne, zweryfikowane profile                     |
| Fundacja rodzinna                        | Reżim szczególny                           | Nieaktywna do czasu przeglądu eksperta               |

## Minimalny profil aktywacyjny

Forma prawna, identyfikatory, daty działalności, metoda ewidencji, rok obrotowy, waluta ksiąg, okresy VAT, sposób opodatkowania, statusy i pełnomocnictwa. System nie powinien umożliwiać rozliczenia, jeśli obowiązkowe pola są nieustalone.

## Zasada zgodności

Publiczna macierz wsparcia: profile planned / experimental / reviewed / supported z datą i listą zweryfikowanych scenariuszy; brak ogólnej etykiety „zgodne ze wszystkimi przepisami”.
