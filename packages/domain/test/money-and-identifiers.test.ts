import { describe, expect, it } from 'vitest';
import {
  InvalidMoneyAmountError,
  addGrosze,
  assertNonNegativeGrosze,
  assertSafeGrosze,
  calculateInvoiceLineFromGross,
  calculateInvoiceLineFromNet,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
  multiplyGroszeByRatio,
  parsePlnToGrosze,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
  validatePolishIban,
  validatePolishNip,
} from '../src/money.js';

describe('money.ts — deterministic grosze arithmetic, tax rounding & Polish identifiers', () => {
  it('adds, subtracts and sums grosze deterministically without float drift', () => {
    // Klasyczny problem IEEE-754: 0.1 + 0.2 !== 0.3; w groszach: 10 + 20 === 30
    expect(addGrosze(10, 20)).toBe(30);
    expect(subtractGrosze(100_000, 99_999)).toBe(1);
    expect(sumGrosze([19_99, 29_99, 50_02])).toBe(100_00);
  });

  it('rejects floating-point numbers, NaN, Infinity and unsafe integers', () => {
    expect(() => assertSafeGrosze(12.34)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.NaN)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyAmountError);
    expect(() => assertNonNegativeGrosze(-1)).toThrow(InvalidMoneyAmountError);
  });

  it('prevents overflow beyond MAX_SAFE_INTEGER', () => {
    expect(() => addGrosze(Number.MAX_SAFE_INTEGER, 1)).toThrow(InvalidMoneyAmountError);
  });

  it('multiplies grosze by basis points with half-up commercial rounding', () => {
    // 100,00 zł * 23% = 23,00 zł
    expect(multiplyGroszeByBps(10_000, 2300)).toBe(2_300);
    // 1,07 zł (107 gr) * 23% = 24,61 gr -> 25 gr
    expect(multiplyGroszeByBps(107, 2300)).toBe(25);
    // 2,50 zł (250 gr) * 50% = 125 gr
    expect(multiplyGroszeByBps(250, 5000)).toBe(125);
    // Granica dokładnie 0,5 grosza: 1 gr * 50% = 0,5 gr -> half-up = 1 gr; dla -1 gr * 50% = -1 gr
    expect(multiplyGroszeByBps(1, 5000, 'half_up')).toBe(1);
    expect(multiplyGroszeByBps(-1, 5000, 'half_up')).toBe(-1);
  });

  it('supports floor and trunc modes in multiplyGroszeByRatio', () => {
    expect(multiplyGroszeByRatio(10, 1, 3, 'floor')).toBe(3);
    expect(multiplyGroszeByRatio(-10, 1, 3, 'floor')).toBe(-4);
    expect(multiplyGroszeByRatio(-10, 1, 3, 'trunc')).toBe(-3);
  });

  it.each([
    { net: 100_00, rate: '23' as const, expectedVat: 23_00, expectedGross: 123_00 },
    { net: 99_99, rate: '23' as const, expectedVat: 23_00, expectedGross: 122_99 },
    { net: 123_45, rate: '8' as const, expectedVat: 9_88, expectedGross: 133_33 },
    { net: 55_50, rate: '5' as const, expectedVat: 2_78, expectedGross: 58_28 },
    { net: 500_00, rate: '0' as const, expectedVat: 0, expectedGross: 500_00 },
    { net: 500_00, rate: 'zw' as const, expectedVat: 0, expectedGross: 500_00 },
    { net: 500_00, rate: 'np' as const, expectedVat: 0, expectedGross: 500_00 },
  ])(
    'calculates invoice line from net ($net gr @ $rate%)',
    ({ net, rate, expectedVat, expectedGross }) => {
      const res = calculateInvoiceLineFromNet(net, rate);
      expect(res.vatGrosze).toBe(expectedVat);
      expect(res.grossGrosze).toBe(expectedGross);
    },
  );

  it.each([
    { gross: 123_00, rate: '23' as const, expectedNet: 100_00, expectedVat: 23_00 },
    { gross: 100_00, rate: '23' as const, expectedNet: 81_30, expectedVat: 18_70 },
    { gross: 108_00, rate: '8' as const, expectedNet: 100_00, expectedVat: 8_00 },
    { gross: 105_00, rate: '5' as const, expectedNet: 100_00, expectedVat: 5_00 },
    { gross: 250_00, rate: 'zw' as const, expectedNet: 250_00, expectedVat: 0 },
  ])(
    'calculates invoice line from gross "w stu" ($gross gr @ $rate%)',
    ({ gross, rate, expectedNet, expectedVat }) => {
      const res = calculateInvoiceLineFromGross(gross, rate);
      expect(res.netGrosze).toBe(expectedNet);
      expect(res.vatGrosze).toBe(expectedVat);
      expect(res.netGrosze + res.vatGrosze).toBe(gross);
    },
  );

  it.each([
    { input: 0, expectedPln: 0, expectedGrosze: 0 },
    { input: -550, expectedPln: 0, expectedGrosze: 0 },
    { input: 49, expectedPln: 0, expectedGrosze: 0 },
    { input: 50, expectedPln: 1, expectedGrosze: 100 },
    { input: 120_049, expectedPln: 1_200, expectedGrosze: 120_000 },
    { input: 120_050, expectedPln: 1_201, expectedGrosze: 120_100 },
    { input: 120_099, expectedPln: 1_201, expectedGrosze: 120_100 },
  ])(
    'applies Ordynacja podatkowa art. 63 § 1 rounding for $input gr -> $expectedPln zł',
    ({ input, expectedPln, expectedGrosze }) => {
      const res = roundTaxAmountOrdynacjaArt63(input);
      expect(res.roundedFullPln).toBe(expectedPln);
      expect(res.roundedGrosze).toBe(expectedGrosze);
    },
  );

  it('formats and parses Polish currency strings accurately', () => {
    expect(formatPlnFromGrosze(0)).toBe('0,00 zł');
    expect(formatPlnFromGrosze(5)).toBe('0,05 zł');
    expect(formatPlnFromGrosze(123_456_78)).toBe('123 456,78 zł');
    expect(formatPlnFromGrosze(-450_10)).toBe('-450,10 zł');
    expect(formatPlnFromGrosze(1_926_76, { includeCurrencySymbol: false })).toBe('1 926,76');

    expect(parsePlnToGrosze('1 234,56 zł')).toBe(123_456);
    expect(parsePlnToGrosze('-45,10 PLN')).toBe(-4_510);
    expect(parsePlnToGrosze('240000')).toBe(24_000_000);
    expect(parsePlnToGrosze('19,5')).toBe(1_950);
    expect(() => parsePlnToGrosze('12,345')).toThrow(InvalidMoneyAmountError);
    expect(() => parsePlnToGrosze('')).toThrow(InvalidMoneyAmountError);
  });

  it('validates Polish NIP checksums including mod-11 === 10 edge case', () => {
    // Poprawne syntetyczne numery NIP ze zgodną sumą kontrolną:
    expect(validatePolishNip('526-10-40-828')).toEqual({
      valid: true,
      normalizedNip: '5261040828',
    });
    expect(validatePolishNip('PL 123 456 32 18')).toEqual({
      valid: true,
      normalizedNip: '1234563218',
    });

    // Błędna ostatnia cyfra:
    expect(validatePolishNip('5261040829').valid).toBe(false);
    // Same zera:
    expect(validatePolishNip('0000000000').valid).toBe(false);
    // Przypadek, w którym suma ważona mod 11 === 10 (np. 123-456-78-90: 1*6+2*5+3*7+4*2+5*3+6*4+7*5+8*6+9*7 = 6+10+21+8+15+24+35+48+63 = 230; 230 % 11 = 10 -> ZAWSZE nieprawidłowy!)
    expect(validatePolishNip('1234567890').valid).toBe(false);
    // Zbyt krótki:
    expect(validatePolishNip('12345').valid).toBe(false);
  });

  it('validates Polish IBAN / NRB using ISO 13616 MOD-97', () => {
    // Wyznaczmy poprawny syntetyczny rachunek NRB: 109010140000071219812874 -> 252100 -> 109010140000071219812874252100 % 97 = 37 -> 98 - 37 = 61 -> PL61 1090 1014 0000 0712 1981 2874
    const validFormatted = 'PL61 1090 1014 0000 0712 1981 2874';
    const res = validatePolishIban(validFormatted);
    expect(res).toEqual({
      valid: true,
      normalizedIban: 'PL61109010140000071219812874',
      nrb26: '61109010140000071219812874',
      bankRoutingCode8: '10901014',
    });

    // Bez prefiksu PL (26 cyfr NRB):
    expect(validatePolishIban('61109010140000071219812874').valid).toBe(true);

    // Zmieniona cyfra kontrolna:
    expect(validatePolishIban('PL62 1090 1014 0000 0712 1981 2874').valid).toBe(false);
    // Niemiecki IBAN odrzucany przez walidator polskiego IBAN:
    expect(validatePolishIban('DE89370400440532013000').valid).toBe(false);
  });
});
