# 21. Kierunek wizualny i doświadczenie użytkownika

**Status:** roboczy brief kierunku, **niezatwierdzona identyfikacja ani gotowy design system**. Wynika z uwagi właściciela: platforma ma być **prosta, ciekawa, przyjemna i rozpoznawalna**, nie wyglądać jak generyczny „AI slop”. Do dopracowania i walidacji w [Issue #13](https://github.com/RolePlayingTech/polish-accounting-platform/issues/13). Podstawowe funkcjonalne UX: [11-ui-ux.md](11-ui-ux.md).

## Ambicja produktu

Polish Accounting Platform ma dawać poczucie **porządku, zaufania i sprawczości**. To narzędzie do codziennego rozwiązywania realnych spraw finansowych. Użytkownik powinien szybko rozumieć: **w której firmie i okresie pracuje, co wymaga uwagi, co jest niepewne, co wykonał system i co ma zrobić dalej**.

Nie projektujemy „aplikacji AI” z elementami księgowymi, lecz wiarygodne środowisko pracy księgowej, które wykorzystuje AI w tle. AI ma pomagać w przepływach (np. propozycja pól faktury), a użytkownik zachowuje kontrolę.

**Słowa definiujące charakter:** klarowny, spokojny, ludzki, precyzyjny, dyskretnie elegancki, lekko charakterystyczny. **Nie:** futurystyczny, neonowy, generycznie fintechowy, infantylny, ciężki urzędowo.

## Trzy kierunki do rozważenia (jeszcze nie wybór)

| Koncepcja | Pomysł | Zalety | Ryzyka |
| --- | --- | --- | --- |
| **A. Nowoczesny dziennik finansowy** (rekomendacja wyjściowa) | Delikatne nawiązanie do księgi: wyraźna typografia, linie i rytm tabel, ciepłe tła, pojedynczy świadomy akcent. | Rozpoznawalny charakter, wiarygodność, dobrze działa przy liczbach i dokumentach. | Zbyt dosłowne „papierowe” motywy mogą sprawiać wrażenie retro. |
| **B. Spokojne studio finansów** | Bardziej przestrzenny, współczesny interfejs narzędziowy, większe odstępy, precyzyjne bloki informacji. | Przyjazny początkującym, lekkość, prostota. | Łatwo stać się kopią tysiąca SaaS-owych dashboardów. |
| **C. Profesjonalny warsztat księgowego** | Większa gęstość informacji, świetne tabele, komendy, filtry, skróty klawiaturowe. | Wysoka wydajność pracy specjalistów. | Może odstraszać właścicieli małych firm, jeśli zastosowany wszędzie. |

**Rekomendacja:** zbadać **A jako osobowość marki + C jako ergonomię zaawansowanych obszarów**, zostawiając prostotę B w onboardingu i ekranach podstawowych. Agent może zaproponować lepszy czwarty wariant; wybór wymaga makiet i oceny użyteczności, nie tylko deklaracji stylistycznej.

## Co buduje unikalność

1. **Rytm ewidencji, nie katalog kart:** konsekwentne linie podziału, dobrze dobrane wysokości wierszy, tabularne cyfry i dyskretne nagłówki. Karty stosować dla jednostek, które naprawdę potrzebują obramowania (np. ostrzeżenie, grupa akcji, zatwierdzenie), a nie każdej liczby.
2. **Własny język mikrodetali:** przemyślane ikony i statusy, delikatny motyw „zapis / pozycja / okres”, bez przypadkowych ilustracji AI, glow, glassmorphism, neonów, emoji jako podstawowej ikonografii.
3. **Mniej dekoracji, więcej sensu:** pierwsza połowa ekranu pokazuje kolejny ruch użytkownika, a nie pięć równorzędnych KPI. Brak fałszywych wykresów, procentów postępu księgowości czy makiet pokazujących fikcyjne dane jako rzeczywiste.
4. **Ton języka:** naturalna polszczyzna, zwięzłe komunikaty, zadaniowe czasowniki („Sprawdź”, „Uzupełnij”, „Zatwierdź”), bez żargonu LLM i sztucznej wesołości. Terminologia prawna dostępna obok prostego objaśnienia.
5. **Ruch i przyjemność:** delikatna responsywność, szybka nawigacja, czytelny hover/focus, miękkie przejścia tylko gdy pomagają zorientować się w zmianie stanu; zawsze respektuj reduced-motion.

## Robocza estetyka (nie finalne tokeny)

- **Tło:** ciepła, rozjaśniona neutralność (jasna kość słoniowa / off-white), bez dominującej zielonej poświaty.
- **Tekst:** ciemny grafit z subtelną zielenią lub ink, wysoki kontrast.
- **Akcent:** głęboka, stonowana zieleń może zostać, ale rozważ też chłodniejszy niebieskografitowy i bursztynowe detale dla wyraźniejszej tożsamości; do potwierdzenia na makietach.
- **Semantyka:** osobne kolory dla sukcesu, ostrzeżenia, błędu i informacji — nie mieszaj tych znaczeń z samym kolorem marki. Każdy status także tekst/ikona.
- **Typografia:** bardzo czytelny krój UI, jeden kontrolowany detal typograficzny dla tytułów, `font-variant-numeric: tabular-nums` przy kwotach, saldach, datach i numerach; równe pozycje dziesiętne w tabelach.
- **Warstwy:** cienkie separatory, miękkie, umiarkowane promienie; cienie tylko w rzeczywistych warstwach (dialog, popover) zamiast dekoracyjnych kart.
- **Gęstość:** podstawowa i kompaktowa w tabelach, bez utraty WCAG target size i focus. Nie sztywno desktop-first: mobile ma własny sensowny przepływ.

W PR #12 istnieje pierwsza paleta i `Card`/`StatusBadge`. **Traktuj je jako roboczy scaffold**, nie bezdyskusyjny standard interfejsu. Jeśli makiety wykażą lepszy kierunek, refaktoruj stopniowo, z dokumentacją.

## UX: najpierw zadanie, później panel

### 1. Pulpit właściciela firmy

Góra widoku: **firma + okres rozliczeniowy + źródło/świeżość danych**. Następnie jedno zdanie podsumowania typu „Masz 3 dokumenty do sprawdzenia i jeden zbliżający się termin” (na danych rzeczywistych, nie udawanych). Priorytetem jest **kolejka działań** i kluczowe terminy. Dopiero niżej ostatnie dokumenty, synchronizacje, opcjonalnie wartości finansowe dostępne dla danego profilu.

### 2. Lista dokumentów

Tabelaryczna, wydajna lista: status weryfikacji, kontrahent, daty, numery, kwoty/waluta, firma, źródło/import. Sensowne sortowanie, filtrowanie i szybkie akcje. Kwoty wyrównane; mobile jako pogrupowana lista, bez ściskania desktopowej tabeli. Nie umieszczaj każdej faktury w wielkiej karcie.

### 3. Ekran weryfikacji faktury

**Podgląd oryginału z lewej, pola i decyzje po prawej** (na mobile sekwencyjnie z łatwą zmianą). Widoczny powód ekstrakcji / źródło pola, niepewność i różnica proponowane vs zatwierdzone. Jedna dominująca akcja zależna od stanu. Nie ukrywaj ryzyka i nie wykonuj księgowania przez przypadkowy Enter.

### 4. Administracja

Wyraźnie rozdzielony system operatora platformy `/platform`, ustawień organizacji `/settings` i pracy księgowej `/app` zgodnie z [ADR-003](adr/003-administracja-i-uprawnienia-produktowe.md). Można używać wspólnych tokenów i komponentów, ale administracja powinna być spokojniejsza, bardziej narzędziowa, a nie „drugi dashboard marketingowy”. Globalny administrator **nie** widzi automatycznie ksiąg klienta.

### 5. MCP i asysta AI

Nie projektować osobnego „czatbotowego centrum świata” jako warunku użycia produktu. Asysta kontekstowa tam, gdzie potrzebna; widoczne działanie i ślad „co system zaproponował, z jaką pewnością i co zatwierdził człowiek”. Projekt centrum akceptacji przed pierwszym krytycznym narzędziem MCP, nie po jego udostępnieniu.

## Standardy jakości UX do egzekwowania

- Każdy ekran ma jeden wyraźny cel; dwie/trzy najważniejsze akcje łatwe do znalezienia.
- Przy każdej tabeli: nagłówek, jednostki, format PLN/ISO walut, wyrównanie, stany pusty/ładowanie/błąd/niewystarczające uprawnienia, responsywność.
- Przy danych prawnych: firma, okres, data aktualności, wersja reguły, ewentualne „nie obsługujemy” zamiast mylącego zera.
- Przy działaniach nieodwracalnych: jawne podsumowanie, skutki, firma, kwoty, ponowne potwierdzenie i możliwość śledzenia historii.
- WCAG 2.2 AA: kontrast, focus-visible, klawiatura, rozmiar celów, etykiety, form errors, nie tylko kolor. Animacje respektują `prefers-reduced-motion`.
- Projektuj zawczasu dla polskich długich nazw firm, wielu walut, separatorów liczb, zawijających się terminów i wieloletniej historii.
- Mobile: najczęstsze zadania (przesłanie dokumentu, sprawdzenie statusu, prosty przegląd), bez zmuszania do pracy jak w desktopowej tabeli.
- Zadbaj o czas reakcji, skeleton/loading tylko tam, gdzie realne oczekiwanie; stan pusty tłumaczy kolejne działanie.

## Antywzorce do unikania

- Dziesiątki jednakowych `Card` z losowymi ikonami i kolorami.
- Wielkie gradienty, szklane panele, nadmiar rounded-3xl, sztuczne „AI-powered” hasła.
- Bezsensowne wykresy i fikcyjne „paski ukończenia księgowości”.
- Ukryte statusy i nieczytelne szare drobne teksty na jasnych tłach.
- Dekoracyjna animacja w tabelach, modale przy każdej małej czynności.
- Kolor zielony oznaczający jednocześnie „markę”, „aktywne”, „sukces” i „bezpieczne”.
- Mylenie projektu publicznego dema ze zgodnością produkcyjną.
- Przeskakiwanie między trzema typami użytkowników w jednym shellu bez granic kontekstu.

## Jak zatwierdzić kierunek — mały proces projektowy

1. Agent przygotowuje **2–3 warianty makiet reprezentatywnych ekranów**, z argumentacją oraz próbą charakterystycznego motywu UI.
2. Właściciel ocenia je pod kątem zaufania, odróżnialności, czytelności, sympatii i poczucia kontroli. Agent może zaproponować własny, lepszy wariant.
3. Wybrany wariant otrzymuje katalog tokenów, typografii, komponentów, zasad tabel i stanów.
4. Krótki test 3 zadań: „znajdź dokument do sprawdzenia”, „sprawdź firmę i okres”, „zidentyfikuj różnicę przed zatwierdzeniem”. Sprawdź desktop i mobile oraz czytelność dla początkującego i księgowego.
5. Implementacja małymi PR-ami, z testami dostępności i regresji. Zmiany zachowania, nie tylko kolorów, mają testy.

**Moment:** decyzja wizualna przed wdrożeniem wielu ekranów operacyjnych i obiegu dokumentów (#7), nie musi blokować zamknięcia bieżącego technicznego scaffoldu (#12). PR ze scaffoldem może dostać konkretne małe poprawki UX, ale **bez pełnego redesignu wewnątrz tego PR**.

**Powiązane zadanie:** [#13](https://github.com/RolePlayingTech/polish-accounting-platform/issues/13). Ten dokument nie jest zamknięciem Issue i nie zawiera zatwierdzonych projektów graficznych.
