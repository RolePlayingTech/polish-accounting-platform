import { formatPlnFromGrosze, type LedgerAccountDefinition } from '@pap/domain';

export interface FormatErrorInput {
  readonly status?: number | undefined;
  readonly reasonCode?: string | undefined;
  readonly rawMessage?: string | null | undefined;
  readonly fallbackPl?: string | undefined;
}

export function isValidIsoCalendarDate(candidate: string): boolean {
  const trimmed = candidate.trim();
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.exec(trimmed);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(utc.getTime()) &&
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

const TECHNICAL_LEAK_PATTERNS = [
  /\bSELECT\b.+\bFROM\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\b.+\bSET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDrizzleError\b/i,
  /\bPostgresError\b/i,
  /\bECONNREFUSED\b/i,
  /\n\s+at\s+[A-Za-z0-9_$.]+\s*\(/,
];

const REASON_CODE_MESSAGES_PL: Readonly<Record<string, string>> = {
  unauthenticated:
    'Twoja sesja wygasła lub nie jesteś zalogowany. Przejdź na ekran logowania i uwierzytelnij się ponownie.',
  api_unauthorized:
    'Sesja uwierzytelniania wygasła (HTTP 401). Zaloguj się ponownie, aby kontynuować pracę.',
  auth_service_unavailable:
    'Usługa uwierzytelniania lub sesji BFF jest chwilowo niedostępna (tryb fail-closed, HTTP 503). Spróbuj ponownie za chwilę.',
  api_unavailable:
    'Serwer API księgowości nie odpowiada (HTTP 503 — tryb fail-closed). Żadne dane nie zostały zmienione.',
  active_membership_required:
    'Brak dostępu do wybranej organizacji — Twoje konto należy do innego tenanta (twarda izolacja międzyorganizacyjna).',
  missing_tenant_membership: 'Brak aktywnego członkostwa we wskazanej organizacji (HTTP 403).',
  company_grant_required:
    'Twoje konto nie posiada wymaganego uprawnienia (odczyt/zapis) do tej firmy. Poproś właściciela organizacji o nadanie grantu w /app/companies.',
  explicit_company_grant_required:
    'Brak jawnego grantu podmiotowego do wykonania tej operacji księgowej (HTTP 403).',
  owner_required: 'Ta operacja wymaga roli właściciela lub administratora organizacji (ADR-003).',
  company_not_found:
    'Wskazana firma nie istnieje lub została usunięta z listy dostępnych podmiotów (HTTP 404).',
  api_not_found: 'Żądany zasób księgowy nie został znaleziony w wybranej firmie (HTTP 404).',
  document_not_found: 'Nie znaleziono wskazanego dokumentu w ewidencji bieżącej firmy.',
  duplicate_document_sha256:
    'Ten sam plik lub dokument (identyczny skrót SHA-256) został już wcześniej zarejestrowany w tej firmie. Sprawdź istniejący wpis na liście dokumentów.',
  duplicate_economic_operation:
    'Ta operacja gospodarcza została już ujęta w księgach. Aby zmienić kwoty po zaksięgowaniu, wystaw dokument korygujący lub storno.',
  period_closed:
    'Wybrany okres rozliczeniowy jest zamknięty — wsteczne dopisywanie zapisów zostało zablokowane. Wprowadź uzasadnioną korektę w otwartym okresie.',
  vat_period_finalized:
    'Rozliczenie VAT (JPK_V7M) za ten okres zostało sfinalizowane — zmiana zapisów wymaga złożenia korekty deklaracji.',
  incompatible_tax_regime:
    'Aktywna firma rozlicza się w innym reżimie podatkowym — zapis w tej ewidencji jest niedozwolony dla jej profilu.',
  tax_profile_locked_by_posted_entries:
    'Nie można zmienić formy opodatkowania podmiotu posiadającego już zaksięgowane operacje w księgach bez formalnej procedury przejścia międzyokresowego.',
  ksef_production_endpoint_blocked:
    'Połączenie z produkcyjną bramką rządową KSeF / e-Deklaracje jest trwale zablokowane (HTTP 403) — dozwolone są wyłącznie środowiska testowe i lokalny symulator.',
  jpk_xsd_validation_failed:
    'Wygenerowany plik XML nie przeszedł walidacji względem urzędowej schemy XSD Ministerstwa Finansów. Sprawdź kompletność danych podmiotu i zapisów.',
  ksef_xml_prevalidation_failed:
    'Plik XML faktury nie spełnia wymogów oficjalnej schemy XSD FA(2)/FA(3) (np. brak KodFormularza, prefiks kraju w polu NIP lub niezgodna przestrzeń nazw).',
  empty_jpk_register:
    'Wybrana struktura JPK wymaga co najmniej jednego zaksięgowanego wiersza w ewidencji za dany okres.',
  human_confirmation_required:
    'Ta operacja wymaga jawnego potwierdzenia człowieka w oknie dialogowym przed wykonaniem.',
  invalid_document_csv_headers:
    'Plik CSV nie zawiera wszystkich wymaganych kolumn. Wymagany nagłówek (średnik lub przecinek): numer_faktury;data_wystawienia;kontrahent;nip;opis;stawka_vat;netto;vat;brutto.',
  invalid_document_csv:
    'Nieprawidłowa struktura pliku CSV. Upewnij się, że plik zawiera wiersz nagłówka oraz co najmniej jeden wiersz pozycji faktury rozdzielony średnikami (;).',
  missing_csv_required_fields:
    'W pliku CSV brakuje numeru faktury, daty wystawienia (RRRR-MM-DD), nazwy kontrahenta lub numeru NIP.',
  document_amount_mismatch:
    'Suma kwoty netto i podatku VAT w pozycji nie zgadza się z kwotą brutto. Sprawdź wartości co do grosza.',
  document_vat_rate_amount_mismatch:
    'Kwota podatku VAT w wierszu nie odpowiada wybranej stawce VAT liczonej od kwoty netto.',
  multiple_documents_in_single_csv_import:
    'Pojedynczy import CSV w tym formularzu reprezentuje jedną fakturę (może mieć wiele wierszy z różnymi stawkami VAT dla tego samego numeru dokumentu i NIP).',
  payload_too_large: 'Przesyłany plik przekracza dopuszczalny limit 256 KB.',
  correction_line_amounts_locked:
    'Kwoty ujemne faktury korygującej (KOR) wynikają bezpośrednio z pozycji dokumentu — zatwierdź dokument bez ręcznego nadpisywania sumy nagłówka.',
  double_entry_violation:
    'Dekret księgowy musi być zbilansowany (suma strony Wn musi być równa sumie strony Ma co do grosza) i zawierać co najmniej dwie pozycje.',
};

function looksLikeRawZodOrEnglishValidation(msg: string): string | null {
  const normalized = msg.trim();
  if (!normalized) return null;

  if (/Too small:\s*expected string to have >=\s*1 characters/i.test(normalized)) {
    return 'Uzupełnij wymagane pole tekstowe (np. treść operacji gospodarczej, numer dowodu lub opis pozycji) — wartość nie może być pusta.';
  }
  if (/String must contain at least (\d+) character/i.test(normalized)) {
    const minChars = RegExp.$1 || '1';
    return `Wprowadzony tekst jest za krótki — wpisz co najmniej ${minChars} znak(i), aby jednoznacznie opisać operację.`;
  }
  if (/Too big:\s*expected string to have <=\s*(\d+) characters/i.test(normalized)) {
    const maxChars = RegExp.$1 || '500';
    return `Wprowadzony tekst przekracza dopuszczalną długość (${maxChars} znaków). Skróć opis do najważniejszych danych dowodu.`;
  }
  if (/Too small:\s*expected array to have >=\s*(\d+) items/i.test(normalized)) {
    const minItems = RegExp.$1 || '1';
    return `Formularz wymaga co najmniej ${minItems} pozycji (np. minimum dwóch linii Wn/Ma w dekrecie lub jednej pozycji na fakturze).`;
  }
  if (
    /Invalid enum value/i.test(normalized) ||
    /Invalid option/i.test(normalized) ||
    /Expected '.*' \| '.*'/i.test(normalized)
  ) {
    return 'Wybrano nieobsługiwaną wartość słownikową (np. stawkę podatku, kierunek dokumentu lub znacznik KSeF). Wybierz jedną z pozycji dostępnych na liście.';
  }
  if (
    /^Invalid input$/i.test(normalized) ||
    /Invalid input:\s*expected/i.test(normalized) ||
    /^Expected\s+\w+,\s*received\s+\w+/i.test(normalized)
  ) {
    return 'Jedno z pól formularza ma nieprawidłowy format danych. Sprawdź kwoty (np. 1230.00), daty (RRRR-MM-DD) oraz wymagane opisy.';
  }
  if (/Unrecognized key/i.test(normalized)) {
    return 'Żądanie zawiera nierozpoznane pole spoza kontraktu API. Odśwież widok i spróbuj ponownie.';
  }
  if (/Invalid regex|Invalid string:\s*must match pattern/i.test(normalized)) {
    return 'Wartość pola ma nieprawidłowy format — sprawdź numer NIP (10 cyfr), datę (RRRR-MM-DD), symbol konta (np. 202 lub 221-2) oraz kwoty PLN.';
  }
  if (/^\[?\s*\{\s*"code"\s*:/i.test(normalized) || /^\{.*"issues"\s*:/i.test(normalized)) {
    return 'Dane formularza nie przeszły walidacji. Sprawdź wymagane opisy, daty w formacie RRRR-MM-DD oraz poprawność kwot PLN.';
  }
  return null;
}

/**
 * Zamienia błędy API / Zod / sieciowe na zrozumiałe, bezpieczne komunikaty po polsku (#105).
 * Nigdy nie ujawnia zapytań SQL, śladów stosu ani surowych zrzutów JSON/Zod.
 */
export function formatUserFacingErrorPl({
  fallbackPl = 'Nie udało się wykonać operacji. Sprawdź poprawność wprowadzonych pól i spróbuj ponownie.',
  rawMessage,
  reasonCode,
  status,
}: FormatErrorInput): string {
  if (reasonCode && REASON_CODE_MESSAGES_PL[reasonCode]) {
    const mapped = REASON_CODE_MESSAGES_PL[reasonCode]!;
    if (
      rawMessage &&
      !TECHNICAL_LEAK_PATTERNS.some((rx) => rx.test(rawMessage)) &&
      !looksLikeRawZodOrEnglishValidation(rawMessage) &&
      /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|brak|nieprawidłow|odmowa|błąd|wymagan|duplikat|okres|faktura|dekret/i.test(
        rawMessage,
      ) &&
      rawMessage.trim().length <= 360
    ) {
      return rawMessage.trim();
    }
    return mapped;
  }

  const trimmed = (rawMessage ?? '').trim();
  if (!trimmed) {
    if (status === 401) return REASON_CODE_MESSAGES_PL['api_unauthorized']!;
    if (status === 403) return REASON_CODE_MESSAGES_PL['company_grant_required']!;
    if (status === 404) return REASON_CODE_MESSAGES_PL['api_not_found']!;
    if (status === 503) return REASON_CODE_MESSAGES_PL['api_unavailable']!;
    return fallbackPl;
  }

  if (TECHNICAL_LEAK_PATTERNS.some((rx) => rx.test(trimmed))) {
    return status && status >= 500
      ? 'Wystąpił błąd po stronie usługi księgowej (tryb fail-closed). Operacja została bezpiecznie zatrzymana bez zmiany ksiąg.'
      : fallbackPl;
  }

  const zodTranslated = looksLikeRawZodOrEnglishValidation(trimmed);
  if (zodTranslated) {
    return zodTranslated;
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return fallbackPl;
  }

  return trimmed;
}

export interface JournalSemanticWarning {
  readonly id: string;
  readonly messagePl: string;
}

/**
 * Kontekstowe, nieblokujące ostrzeżenia merytoryczne dla edytora dekretu Wn/Ma (#105).
 * Pomagają wychwycić typowe pomyłki kont (np. „zobowiązanie wobec dostawcy” na koncie 010 Środki trwałe)
 * oraz niezgodność kwoty VAT z typową stawką, bez blokowania uzasadnionych dekretów księgowego.
 */
export function evaluateJournalSemanticWarnings(
  lines: readonly {
    readonly accountCode: string;
    readonly side: 'Wn' | 'Ma';
    readonly amountGrosze: number;
    readonly description: string;
  }[],
  chartOfAccounts: readonly LedgerAccountDefinition[],
): readonly JournalSemanticWarning[] {
  const warnings: JournalSemanticWarning[] = [];
  const accountByCode = new Map(chartOfAccounts.map((a) => [a.code, a]));

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]!;
    const desc = line.description.trim();
    const descLower = desc.toLowerCase();
    const code = line.accountCode.trim();
    const acc = accountByCode.get(code);
    const accLabel = acc ? `${code} — ${acc.name}` : code;

    if (
      (descLower.includes('zobowiązan') || descLower.includes('wobec dostawc')) &&
      !code.startsWith('2')
    ) {
      warnings.push({
        id: `payable-non-class2-${String(idx)}`,
        messagePl: `Pozycja nr ${String(idx + 1)} („${desc}”) jest przypisana do konta ${accLabel}. Sprawdź, czy dla rozrachunku z dostawcą właściwe nie jest konto Zespołu 2 (np. 202 — Rozrachunki z dostawcami) zgodnie z zakładowym planem kont.`,
      });
    } else if (
      (descLower.includes('należnoś') || descLower.includes('od odbiorc')) &&
      !code.startsWith('2')
    ) {
      warnings.push({
        id: `receivable-non-class2-${String(idx)}`,
        messagePl: `Pozycja nr ${String(idx + 1)} („${desc}”) jest przypisana do konta ${accLabel}. Sprawdź, czy dla należności od odbiorcy właściwe nie jest konto rozrachunkowe (np. 201 — Rozrachunki z odbiorcami).`,
      });
    }

    if (
      (descLower.includes('vat naliczon') || descLower.includes('vat należn')) &&
      !code.startsWith('22')
    ) {
      warnings.push({
        id: `vat-non-22x-${String(idx)}`,
        messagePl: `Pozycja nr ${String(idx + 1)} („${desc}”) opisuje podatek VAT, lecz wskazuje konto ${accLabel}. Sprawdź, czy nie należy użyć konta rozliczenia VAT (np. 221-1 VAT należny lub 221-2 VAT naliczony).`,
      });
    }
  }

  // Kontrola orientacyjnej relacji VAT 23% do kwoty netto, gdy dekret ma wyraźną pozycję VAT 221-*
  const vatLines = lines.filter(
    (l) => l.accountCode.trim().startsWith('221') && l.amountGrosze > 0,
  );
  if (vatLines.length === 1) {
    const vatLine = vatLines[0]!;
    const sameSideNetLines = lines.filter(
      (l) =>
        l !== vatLine &&
        l.side === vatLine.side &&
        !l.accountCode.trim().startsWith('2') &&
        l.amountGrosze > 0,
    );
    const netSumGrosze = sameSideNetLines.reduce((acc, l) => acc + l.amountGrosze, 0);
    if (netSumGrosze > 0) {
      const candidateRatesBps = [2300, 1150, 800, 400, 500, 250]; // 23%, 50%*23%, 8%, 50%*8%, 5%, 50%*5%
      const matchesStandard = candidateRatesBps.some((bps) => {
        const expected = Math.round((netSumGrosze * bps) / 10_000);
        return Math.abs(vatLine.amountGrosze - expected) <= 2;
      });
      if (!matchesStandard) {
        const expected23 = Math.round((netSumGrosze * 2300) / 10_000);
        warnings.push({
          id: 'vat-rate-proportion-check',
          messagePl: `Kwota na koncie VAT ${vatLine.accountCode} (${formatPlnFromGrosze(vatLine.amountGrosze)}) nie odpowiada standardowej stawce 23%, 8%, 5% (ani 50% odliczenia pojazdowego) liczonej od sumy pozycji netto po stronie ${vatLine.side} (${formatPlnFromGrosze(netSumGrosze)} — pełne 23% to ${formatPlnFromGrosze(expected23)}). Zweryfikuj kwotę z dowodem źródłowym.`,
        });
      }
    }
  }

  return warnings;
}
