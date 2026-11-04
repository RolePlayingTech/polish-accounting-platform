export const GROSZE_PER_PLN = 100;
export const BPS_DENOMINATOR = 10_000;

export type VatRateCode = '23' | '8' | '5' | '0' | 'zw' | 'np';

export class InvalidMoneyAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyAmountError';
  }
}

export interface InvoiceLineAmounts {
  readonly netGrosze: number;
  readonly vatRate: VatRateCode;
  readonly vatRateBps: number;
  readonly vatGrosze: number;
  readonly grossGrosze: number;
}

export interface TaxRoundingResult {
  readonly inputGrosze: number;
  readonly roundedFullPln: number;
  readonly roundedGrosze: number;
}

export interface NipValidationResult {
  readonly valid: boolean;
  readonly normalizedNip?: string;
  readonly reason?: string;
}

export interface IbanValidationResult {
  readonly valid: boolean;
  readonly normalizedIban?: string;
  readonly nrb26?: string;
  readonly bankRoutingCode8?: string;
  readonly reason?: string;
}

export function assertSafeGrosze(amount: number, label = 'amountGrosze'): number {
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new InvalidMoneyAmountError(
      `Pole ${label} musi być bezpieczną liczbą całkowitą w groszach (otrzymano: ${String(amount)})`,
    );
  }
  return amount;
}

export function assertNonNegativeGrosze(amount: number, label = 'amountGrosze'): number {
  assertSafeGrosze(amount, label);
  if (amount < 0) {
    throw new InvalidMoneyAmountError(
      `Pole ${label} nie może być ujemne (otrzymano: ${String(amount)} gr)`,
    );
  }
  return amount;
}

function bigintToSafeNumber(value: bigint, context: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InvalidMoneyAmountError(
      `Przekroczenie zakresu bezpiecznych liczb całkowitych w operacji ${context}: ${value.toString()}`,
    );
  }
  const normalized = Number(value);
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function addGrosze(left: number, right: number): number {
  assertSafeGrosze(left, 'left');
  assertSafeGrosze(right, 'right');
  return bigintToSafeNumber(BigInt(left) + BigInt(right), 'addGrosze');
}

export function subtractGrosze(left: number, right: number): number {
  assertSafeGrosze(left, 'left');
  assertSafeGrosze(right, 'right');
  return bigintToSafeNumber(BigInt(left) - BigInt(right), 'subtractGrosze');
}

export function sumGrosze(values: readonly number[]): number {
  let acc = 0n;
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    if (item === undefined) {
      continue;
    }
    assertSafeGrosze(item, `values[${String(index)}]`);
    acc += BigInt(item);
  }
  return bigintToSafeNumber(acc, 'sumGrosze');
}

export type RatioRoundingMode = 'half_up' | 'floor' | 'trunc';

/**
 * Mnoży kwotę w groszach przez ułamek całkowity numerator / denominator bez użycia liczb zmiennoprzecinkowych.
 * Domyślny tryb `half_up` zaokrągla symetrycznie od zera (handlowe zaokrąglenie do grosza: 0,5 gr -> 1 gr; -0,5 gr -> -1 gr).
 */
export function multiplyGroszeByRatio(
  amountGrosze: number,
  numerator: number,
  denominator: number,
  roundingMode: RatioRoundingMode = 'half_up',
): number {
  assertSafeGrosze(amountGrosze, 'amountGrosze');
  if (!Number.isSafeInteger(numerator)) {
    throw new InvalidMoneyAmountError(`Licznik ułamka musi być safe integer: ${String(numerator)}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new InvalidMoneyAmountError(
      `Mianownik ułamka musi być dodatnim safe integer: ${String(denominator)}`,
    );
  }

  const product = BigInt(amountGrosze) * BigInt(numerator);
  const den = BigInt(denominator);

  if (product === 0n) {
    return 0;
  }

  if (roundingMode === 'trunc') {
    return bigintToSafeNumber(product / den, 'multiplyGroszeByRatio(trunc)');
  }

  const isNegative = product < 0n;
  const absProduct = isNegative ? -product : product;
  const quotient = absProduct / den;
  const remainder = absProduct % den;

  if (roundingMode === 'floor') {
    if (!isNegative) {
      return bigintToSafeNumber(quotient, 'multiplyGroszeByRatio(floor)');
    }
    const negativeFloor = remainder === 0n ? -quotient : -(quotient + 1n);
    return bigintToSafeNumber(negativeFloor, 'multiplyGroszeByRatio(floor)');
  }

  // half_up (symetrycznie od zera: 2 * remainder >= denominator)
  const roundedAbs = remainder * 2n >= den ? quotient + 1n : quotient;
  const signed = isNegative ? -roundedAbs : roundedAbs;
  return bigintToSafeNumber(signed, 'multiplyGroszeByRatio(half_up)');
}

/**
 * Mnoży kwotę w groszach przez punkty bazowe (1% = 100 bps, np. 23% = 2300 bps, 19,52% = 1952 bps).
 */
export function multiplyGroszeByBps(
  amountGrosze: number,
  rateBps: number,
  roundingMode: RatioRoundingMode = 'half_up',
): number {
  return multiplyGroszeByRatio(amountGrosze, rateBps, BPS_DENOMINATOR, roundingMode);
}

export function vatRateToBps(rate: VatRateCode): number {
  switch (rate) {
    case '23':
      return 2300;
    case '8':
      return 800;
    case '5':
      return 500;
    case '0':
    case 'zw':
    case 'np':
      return 0;
  }
}

/**
 * Zaokrąglenie handlowe na fakturze od kwoty netto do grosza (half-up):
 * VAT = round_half_up(netto * stawka), brutto = netto + VAT.
 */
export function calculateInvoiceLineFromNet(
  netGrosze: number,
  vatRate: VatRateCode,
): InvoiceLineAmounts {
  assertSafeGrosze(netGrosze, 'netGrosze');
  const vatRateBps = vatRateToBps(vatRate);
  const vatGrosze = multiplyGroszeByBps(netGrosze, vatRateBps, 'half_up');
  const grossGrosze = addGrosze(netGrosze, vatGrosze);
  return {
    netGrosze,
    vatRate,
    vatRateBps,
    vatGrosze,
    grossGrosze,
  };
}

/**
 * Wyliczenie pozycji faktury metodą „w stu” (od kwoty brutto):
 * VAT = round_half_up(brutto * stawka / (100% + stawka)), netto = brutto - VAT.
 */
export function calculateInvoiceLineFromGross(
  grossGrosze: number,
  vatRate: VatRateCode,
): InvoiceLineAmounts {
  assertSafeGrosze(grossGrosze, 'grossGrosze');
  const vatRateBps = vatRateToBps(vatRate);
  const vatGrosze =
    vatRateBps === 0
      ? 0
      : multiplyGroszeByRatio(grossGrosze, vatRateBps, BPS_DENOMINATOR + vatRateBps, 'half_up');
  const netGrosze = subtractGrosze(grossGrosze, vatGrosze);
  return {
    netGrosze,
    vatRate,
    vatRateBps,
    vatGrosze,
    grossGrosze,
  };
}

/**
 * Zaokrąglanie podstawy opodatkowania lub kwoty podatku zgodnie z art. 63 § 1 Ordynacji podatkowej:
 * końcówki kwot wynoszące mniej niż 50 groszy pomija się, a końcówki wynoszące 50 i więcej groszy
 * podwyższa się do pełnych złotych. Dla wartości niedodatnich zwraca 0 zł (0 gr).
 */
export function roundTaxAmountOrdynacjaArt63(amountGrosze: number): TaxRoundingResult {
  assertSafeGrosze(amountGrosze, 'amountGrosze');
  if (amountGrosze <= 0) {
    return {
      inputGrosze: amountGrosze,
      roundedFullPln: 0,
      roundedGrosze: 0,
    };
  }

  const fullPln = Math.trunc(amountGrosze / GROSZE_PER_PLN);
  const remainderGrosze = amountGrosze % GROSZE_PER_PLN;
  const roundedFullPln = remainderGrosze >= 50 ? fullPln + 1 : fullPln;
  const roundedGrosze = roundedFullPln * GROSZE_PER_PLN;

  return {
    inputGrosze: amountGrosze,
    roundedFullPln,
    roundedGrosze,
  };
}

/**
 * Formatuje kwotę z groszy do czytelnego polskiego zapisu walutowego, np. `123456 -> "1 234,56 zł"`.
 */
export function formatPlnFromGrosze(
  amountGrosze: number,
  options?: { readonly includeCurrencySymbol?: boolean },
): string {
  assertSafeGrosze(amountGrosze, 'amountGrosze');
  const includeCurrency = options?.includeCurrencySymbol ?? true;
  const isNegative = amountGrosze < 0;
  const absValue = BigInt(amountGrosze < 0 ? -amountGrosze : amountGrosze);

  const zloty = absValue / 100n;
  const grosze = absValue % 100n;

  const zlotyDigits = zloty.toString();
  const groupedZloty = zlotyDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const groszeDigits = grosze.toString().padStart(2, '0');
  const sign = isNegative ? '-' : '';
  const suffix = includeCurrency ? ' zł' : '';

  return `${sign}${groupedZloty},${groszeDigits}${suffix}`;
}

/**
 * Deterministyczny parser polskiej lub technicznej kwoty PLN do groszy (bez użycia `parseFloat`).
 * Obsługuje np. `"1 234,56"`, `"1234.56"`, `"-45,10 zł"`, `"100"`.
 */
export function parsePlnToGrosze(raw: string): number {
  const cleaned = raw
    .trim()
    .replace(/\s*(zł|PLN)$/i, '')
    .replace(/[\u00A0\u202F\s]/g, '');

  if (cleaned.length === 0) {
    throw new InvalidMoneyAmountError('Nie można sparsować pustego napisu kwoty PLN');
  }

  const match = /^([+-])?(\d+)(?:[,.](\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new InvalidMoneyAmountError(`Nieprawidłowy format kwoty PLN: "${raw}"`);
  }

  const signPart = match[1];
  const integerPart = match[2];
  const fractionPart = match[3] ?? '';

  if (integerPart === undefined) {
    throw new InvalidMoneyAmountError(`Nieprawidłowa część całkowita kwoty PLN: "${raw}"`);
  }

  const zloty = BigInt(integerPart);
  const grosze = BigInt(fractionPart.padEnd(2, '0'));
  const totalAbs = zloty * 100n + grosze;
  const signed = signPart === '-' ? -totalAbs : totalAbs;

  return bigintToSafeNumber(signed, 'parsePlnToGrosze');
}

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/**
 * Waliduje polski Numer Identyfikacji Podatkowej (NIP) z kontrolą sumy kontrolnej modulo 11.
 */
export function validatePolishNip(rawNip: string): NipValidationResult {
  const normalized = rawNip
    .trim()
    .replace(/^PL/i, '')
    .replace(/[\s-]/g, '');

  if (!/^\d{10}$/.test(normalized)) {
    return {
      valid: false,
      reason: 'NIP musi składać się dokładnie z 10 cyfr',
    };
  }

  if (normalized === '0000000000') {
    return {
      valid: false,
      reason: 'NIP nie może składać się z samych zer',
    };
  }

  let weightedSum = 0;
  for (let i = 0; i < 9; i += 1) {
    const digit = Number(normalized[i]);
    const weight = NIP_WEIGHTS[i];
    if (weight !== undefined) {
      weightedSum += digit * weight;
    }
  }

  const checksum = weightedSum % 11;
  const lastDigit = Number(normalized[9]);

  // Gdy reszta z dzielenia przez 11 wynosi 10, taki numer NIP jest z definicji nieprawidłowy.
  if (checksum === 10 || checksum !== lastDigit) {
    return {
      valid: false,
      reason: 'Nieprawidłowa cyfra kontrolna polskiego numeru NIP',
    };
  }

  return {
    valid: true,
    normalizedNip: normalized,
  };
}

/**
 * Waliduje polski numer rachunku bankowego w standardzie IBAN (`PL` + 26 cyfr) lub NRB (26 cyfr)
 * za pomocą standardu ISO 13616 (MOD 97-10).
 */
export function validatePolishIban(rawIban: string): IbanValidationResult {
  const compact = rawIban.trim().replace(/[\s-]/g, '').toUpperCase();
  const withCountry = /^\d{26}$/.test(compact) ? `PL${compact}` : compact;

  if (!/^PL\d{26}$/.test(withCountry)) {
    return {
      valid: false,
      reason: 'Polski IBAN musi mieć prefiks PL oraz dokładnie 26 cyfr (NRB)',
    };
  }

  const checkDigits = withCountry.slice(2, 4);
  const accountDigits24 = withCountry.slice(4);
  // 'P' -> 25, 'L' -> 21 wg ISO 13616 (A=10 ... Z=35)
  const numericRearranged = `${accountDigits24}2521${checkDigits}`;
  const remainder = BigInt(numericRearranged) % 97n;

  if (remainder !== 1n) {
    return {
      valid: false,
      reason: 'Nieprawidłowa suma kontrolna MOD-97 rachunku IBAN/NRB',
    };
  }

  const nrb26 = withCountry.slice(2);
  return {
    valid: true,
    normalizedIban: withCountry,
    nrb26,
    bankRoutingCode8: nrb26.slice(2, 10),
  };
}
