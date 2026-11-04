export type StatusTone = 'success' | 'neutral' | 'warning' | 'danger' | 'info' | 'accent' | 'legal';

export type TableDensity = 'comfortable' | 'compact';

export type AppSurface = 'app' | 'settings' | 'platform';

export interface SemanticToneDefinition {
  readonly hexBg: string;
  readonly hexText: string;
  readonly hexBorder: string;
  readonly badgeClass: string;
  readonly panelClass: string;
  readonly defaultLabelPl: string;
}

export const ksiegaTokens = {
  name: 'Księga Współczesna',
  colors: {
    canvas: '#faf9f5',
    canvasSubtle: '#f4f2ec',
    canvasDocument: '#efece4',
    surface: '#ffffff',
    borderSubtle: '#e5e2d9',
    /** Kontrast 3.85:1 względem #ffffff i 3.69:1 względem #faf9f5 (WCAG 2.2 AA SC 1.4.11 >= 3:1). */
    borderStrong: '#858177',
    ink: '#191c1a',
    inkSecondary: '#464c48',
    inkMuted: '#636b66',
    accent: '#1d5c42',
    accentHover: '#164833',
    accentSurface: '#e7f1ec',
    accentBorder: '#b7d4c5',
  },
  tones: {
    success: {
      hexBg: '#eaf5ee',
      hexText: '#165b33',
      hexBorder: '#b8dec6',
      badgeClass: 'border-[#b8dec6] bg-[#eaf5ee] text-[#165b33]',
      panelClass: 'border-[#b8dec6] bg-[#f4faf6] text-[#165b33]',
      defaultLabelPl: 'Zatwierdzono',
    },
    warning: {
      hexBg: '#fef7e6',
      hexText: '#854d0e',
      hexBorder: '#f3d38c',
      badgeClass: 'border-[#f3d38c] bg-[#fef7e6] text-[#854d0e]',
      panelClass: 'border-[#f3d38c] bg-[#fffbf0] text-[#713f12]',
      defaultLabelPl: 'Wymaga sprawdzenia',
    },
    danger: {
      hexBg: '#fef2f2',
      hexText: '#991b1b',
      hexBorder: '#f5bcbc',
      badgeClass: 'border-[#f5bcbc] bg-[#fef2f2] text-[#991b1b]',
      panelClass: 'border-[#f5bcbc] bg-[#fff7f7] text-[#7f1d1d]',
      defaultLabelPl: 'Wymaga interwencji',
    },
    info: {
      hexBg: '#eff6ff',
      hexText: '#1e40af',
      hexBorder: '#bfdbfe',
      badgeClass: 'border-[#bfdbfe] bg-[#eff6ff] text-[#1e40af]',
      panelClass: 'border-[#bfdbfe] bg-[#f5f9ff] text-[#1e3a8a]',
      defaultLabelPl: 'Informacja',
    },
    legal: {
      hexBg: '#f7f4ea',
      hexText: '#5b4618',
      hexBorder: '#dcd3b8',
      badgeClass: 'border-[#dcd3b8] bg-[#f7f4ea] text-[#5b4618]',
      panelClass: 'border-[#dcd3b8] bg-[#faf8f1] text-[#3f3a28]',
      defaultLabelPl: 'Podstawa prawna',
    },
    accent: {
      hexBg: '#e7f1ec',
      hexText: '#164833',
      hexBorder: '#b7d4c5',
      badgeClass: 'border-[#b7d4c5] bg-[#e7f1ec] text-[#164833]',
      panelClass: 'border-[#b7d4c5] bg-[#f1f7f4] text-[#164833]',
      defaultLabelPl: 'Aktywny kontekst',
    },
    neutral: {
      hexBg: '#f5f4f0',
      hexText: '#44403c',
      hexBorder: '#dedbd2',
      badgeClass: 'border-[#dedbd2] bg-[#f5f4f0] text-[#44403c]',
      panelClass: 'border-[#e5e2d9] bg-[#faf9f5] text-[#464c48]',
      defaultLabelPl: 'Neutralny',
    },
  } satisfies Record<StatusTone, SemanticToneDefinition>,
  typography: {
    tabularNums: 'tabular-nums [font-variant-numeric:tabular-nums_lining-nums]',
    financialFigure:
      'tabular-nums [font-variant-numeric:tabular-nums_lining-nums] tracking-tight whitespace-nowrap',
    ledgerCode:
      'font-mono tabular-nums [font-variant-numeric:tabular-nums_lining-nums] text-xs tracking-normal',
    eyebrow: 'text-[11px] font-semibold uppercase tracking-[0.14em] text-[#636b66]',
    sectionTitle: 'text-base font-semibold tracking-tight text-[#191c1a]',
    pageTitle: 'text-2xl font-semibold tracking-[-0.025em] text-[#191c1a] sm:text-[28px]',
  },
  a11y: {
    focusRing:
      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]',
    reducedMotion: 'motion-reduce:transition-none motion-reduce:animate-none',
    interactiveTarget: 'min-h-6 min-w-6',
  },
  density: {
    comfortable: {
      labelPl: 'Podstawowa',
      cellPadding: 'px-4 py-3',
      headerPadding: 'px-4 py-2.5',
      textSize: 'text-[13px]',
    },
    compact: {
      labelPl: 'Kompaktowa',
      cellPadding: 'px-3 py-1.5',
      headerPadding: 'px-3 py-2',
      textSize: 'text-xs',
    },
  } satisfies Record<
    TableDensity,
    { labelPl: string; cellPadding: string; headerPadding: string; textSize: string }
  >,
} as const;

export interface FormatCurrencyOptions {
  /** Kod waluty ISO 4217 (dwudziesiętnej 1/100), domyślnie 'PLN'. */
  currency?: string | undefined;
  /**
   * Gdy `true`, liczba `number` jest interpretowana jako całkowita liczba groszy (minor units).
   * Wartość typu `bigint` jest zawsze interpretowana jako grosze (minor units).
   */
  inGrosze?: boolean | undefined;
  /** Sposób prezentacji znaku kwoty: domyślnie `'auto'` (minus tylko dla ujemnych). */
  signDisplay?: 'auto' | 'always' | 'never' | undefined;
}

export interface SplitMoneyParts {
  readonly sign: '' | '-' | '+';
  readonly integerPart: string;
  readonly decimalPart: string;
  readonly currency: string;
  readonly formatted: string;
  readonly isNegative: boolean;
  readonly grosze: bigint;
}

const ISO_CURRENCY_REGEX = /^[A-Z]{3}$/;

/**
 * Waluty ISO 4217 o wykładniku innym niż 2 (0 lub 3 miejsca dziesiętne),
 * odrzucane jawnie w helperze groszowym (1/100), aby wykluczyć ciche przesunięcie rzędu wielkości.
 */
const NON_CENTESIMAL_ISO_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
  'BHD',
  'IQD',
  'JOD',
  'KWD',
  'LYD',
  'OMR',
  'TND',
]);

const MAX_SAFE_MAJOR_UNITS = Math.floor(Number.MAX_SAFE_INTEGER / 100);

const POLISH_MONTHS_SHORT = [
  'sty',
  'lut',
  'mar',
  'kwi',
  'maj',
  'cze',
  'lip',
  'sie',
  'wrz',
  'paź',
  'lis',
  'gru',
] as const;

const POLISH_MONTHS_NOMINATIVE = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
] as const;

function groupThousandsWithNbsp(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

function normalizeToGrosze(value: bigint | number, inGrosze?: boolean): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (!Number.isFinite(value)) {
    throw new RangeError('Nieprawidłowa wartość kwoty finansowej: oczekiwano liczby skończonej.');
  }
  if (inGrosze) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        'Kwota przekazywana w groszach musi być bezpieczną liczbą całkowitą lub wartością bigint.',
      );
    }
    return BigInt(value);
  }
  if (Math.abs(value) > MAX_SAFE_MAJOR_UNITS) {
    throw new RangeError(
      'Przekroczono bezpieczny zakres liczby zmiennoprzecinkowej — przekaż kwotę w groszach jako bigint.',
    );
  }
  const scaled = Math.round(value * 100);
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(
      'Przekroczono bezpieczny zakres całkowity po przeliczeniu na grosze — użyj typu bigint.',
    );
  }
  return BigInt(scaled);
}

/**
 * Rozbija kwotę na części (znak, pełne jednostki z niełamliwymi spacjami, grosze, kod waluty ISO).
 * Gwarantuje bezstratne formatowanie dla `bigint` (w groszach).
 */
export function splitFormattedMoney(
  value: bigint | number,
  options?: FormatCurrencyOptions,
): SplitMoneyParts {
  const currency = (options?.currency ?? 'PLN').trim().toUpperCase();
  if (!ISO_CURRENCY_REGEX.test(currency)) {
    throw new RangeError(
      `Nieprawidłowy kod waluty ISO 4217: "${options?.currency ?? ''}". Oczekiwano np. PLN, EUR, USD.`,
    );
  }
  if (NON_CENTESIMAL_ISO_CURRENCIES.has(currency)) {
    throw new RangeError(
      `Waluta ISO 4217 "${currency}" nie stosuje podziału 1/100 (grosze/centy) — wymagany dedykowany kalkulator wykładnika waluty.`,
    );
  }

  const grosze = normalizeToGrosze(value, options?.inGrosze);
  const isNegative = grosze < 0n;
  const absGrosze = isNegative ? -grosze : grosze;
  const majorUnits = absGrosze / 100n;
  const minorUnits = absGrosze % 100n;

  const integerPart = groupThousandsWithNbsp(majorUnits.toString());
  const decimalPart = minorUnits.toString().padStart(2, '0');

  const signMode = options?.signDisplay ?? 'auto';
  let sign: '' | '-' | '+' = '';
  if (signMode === 'never') {
    sign = '';
  } else if (isNegative) {
    sign = '-';
  } else if (signMode === 'always' && absGrosze > 0n) {
    sign = '+';
  }

  const formatted = `${sign}${integerPart},${decimalPart}\u00A0${currency}`;

  return {
    sign,
    integerPart,
    decimalPart,
    currency,
    formatted,
    isNegative,
    grosze,
  };
}

/**
 * Formatuje kwotę finansową zgodnie ze standardem polskiej księgowości (np. `12 450,75 PLN`).
 * Wartości `bigint` są traktowane jako grosze; dla `number` można ustawić `{ inGrosze: true }`.
 */
export function formatCurrencyPln(value: bigint | number, options?: FormatCurrencyOptions): string {
  return splitFormattedMoney(value, options).formatted;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Formatuje datę księgową (`RRRR-MM-DD` lub `Date`) do czytelnego formatu polskiego
 * bez przesunięć strefy czasowej dla łańcuchów ISO `RRRR-MM-DD`.
 */
export function formatPolishDate(
  input: string | Date,
  options?: { style?: 'numeric' | 'medium' | undefined },
): string {
  let year: number;
  let month: number;
  let day: number;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    const isoDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (isoDateMatch) {
      year = Number(isoDateMatch[1]);
      month = Number(isoDateMatch[2]);
      day = Number(isoDateMatch[3]);
      if (!isValidCalendarDate(year, month, day)) {
        throw new RangeError(`Nieprawidłowa data kalendarzowa: "${input}".`);
      }
    } else {
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new RangeError(`Nieprawidłowy format daty: "${input}".`);
      }
      year = parsed.getUTCFullYear();
      month = parsed.getUTCMonth() + 1;
      day = parsed.getUTCDate();
    }
  } else {
    if (Number.isNaN(input.getTime())) {
      throw new RangeError('Przekazano nieprawidłowy obiekt Date.');
    }
    year = input.getUTCFullYear();
    month = input.getUTCMonth() + 1;
    day = input.getUTCDate();
  }

  const dayPadded = String(day).padStart(2, '0');
  const monthPadded = String(month).padStart(2, '0');

  if (options?.style === 'medium') {
    const monthLabel = POLISH_MONTHS_SHORT[month - 1] ?? monthPadded;
    return `${day} ${monthLabel} ${year}`;
  }

  return `${dayPadded}.${monthPadded}.${year}`;
}

/**
 * Waliduje i formatuje okres rozliczeniowy `RRRR-MM` (np. `2026-10` lub `Październik 2026 (2026-10)`).
 */
export function formatAccountingPeriod(
  period: string,
  options?: { style?: 'code' | 'long' | undefined },
): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period.trim());
  if (!match) {
    throw new RangeError(
      `Nieprawidłowy okres rozliczeniowy: "${period}". Oczekiwano formatu RRRR-MM.`,
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1990 || year > 2200 || month < 1 || month > 12) {
    throw new RangeError(`Okres rozliczeniowy poza zakresem kalendarzowym: "${period}".`);
  }
  const normalized = `${match[1]}-${match[2]}`;
  if (options?.style === 'long') {
    const monthName = POLISH_MONTHS_NOMINATIVE[month - 1] ?? match[2];
    return `${monthName} ${year} (${normalized})`;
  }
  return normalized;
}

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/**
 * Oficjalny wzorzec strukturalny `TNIP` ze schem XSD Ministerstwa Finansów / KSeF:
 * pierwsza cyfra 1–9, w trzycyfrowym prefiksie Urzędu Skarbowego brak dwóch zer obok siebie.
 */
const KSEF_TNIP_REGEX = /^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/;

function stripNipFormatting(rawNip: string): string {
  return rawNip
    .trim()
    .replace(/^PL\s*/i, '')
    .replace(/[\s-]/g, '');
}

/**
 * Weryfikuje strukturę prefiksu Urzędu Skarbowego wg schemy MF/KSeF (`TNIP`)
 * oraz oficjalną sumę kontrolną polskiego numeru NIP (wagi `[6,5,7,2,3,4,5,6,7]` modulo 11).
 */
export function isValidNipChecksum(rawNip: string): boolean {
  const digits = stripNipFormatting(rawNip);
  if (!KSEF_TNIP_REGEX.test(digits)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < NIP_WEIGHTS.length; i += 1) {
    const weight = NIP_WEIGHTS[i] ?? 0;
    const digit = Number(digits[i]);
    sum += weight * digit;
  }
  const checksum = sum % 11;
  if (checksum === 10) {
    return false;
  }
  return checksum === Number(digits[9]);
}

/**
 * Formatuje polski numer NIP do postaci ewidencyjnej `XXX-XXX-XX-XX`.
 * W trybie `strict: true` odrzuca ciąg znaków o niepoprawnej długości, prefiksie US lub sumie kontrolnej.
 */
export function formatNip(rawNip: string, options?: { strict?: boolean | undefined }): string {
  const digits = stripNipFormatting(rawNip);
  if (!/^\d{10}$/.test(digits)) {
    if (options?.strict) {
      throw new RangeError(`Nieprawidłowy numer NIP: oczekiwano 10 cyfr, otrzymano "${rawNip}".`);
    }
    return rawNip.trim();
  }
  if (options?.strict && !isValidNipChecksum(digits)) {
    throw new RangeError(
      `Nieprawidłowy prefiks Urzędu Skarbowego lub suma kontrolna numeru NIP: "${rawNip}".`,
    );
  }
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
}

// eslint-disable-next-line no-control-regex
const UNSAFE_CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/;

/**
 * Defence-in-depth dla adresów nawigacji, akcji i zasobów obrazów w UI:
 * akceptuje wyłącznie wewnętrzne ścieżki względne `/...` (bez `//` i `/\`) albo pełne adresy `https://...`.
 * Blokuje `javascript:`, `data:`, `vbscript:`, `file:`, `http:` oraz znaki sterujące.
 */
export function isSafeAppUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || UNSAFE_CONTROL_CHARS_REGEX.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith('/')) {
    return !trimmed.startsWith('//') && !trimmed.startsWith('/\\');
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Zwraca oczyszczony bezpieczny adres `/...` lub `https://...`, albo `undefined` w razie naruszenia polityki.
 */
export function sanitizeAppUrl(rawUrl: string | undefined): string | undefined {
  if (rawUrl === undefined) {
    return undefined;
  }
  const trimmed = rawUrl.trim();
  return isSafeAppUrl(trimmed) ? trimmed : undefined;
}
