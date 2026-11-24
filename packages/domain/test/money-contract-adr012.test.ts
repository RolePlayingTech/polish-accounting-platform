import { describe, expect, it } from 'vitest';
import {
  InvalidMoneyAmountError,
  addGrosze,
  allocateDeductionProportionally,
  assertNonNegativeGrosze,
  assertSafeGrosze,
  calculateInvoiceLineFromGross,
  calculateInvoiceLineFromNet,
  formatPlnFromGrosze,
  multiplyGroszeByBps,
  multiplyGroszeByRatio,
  parsePlnToGrosze,
  roundSignedTaxAmountPln,
  roundTaxAmountOrdynacjaArt63,
  subtractGrosze,
  sumGrosze,
} from '../src/index.js';

describe('ADR-012 Money Representation Contract (#117) — SafeGrosze & BigInt Boundary Guarantees', () => {
  it('enforces exact integer grosze boundaries (MAX_SAFE_INTEGER / MIN_SAFE_INTEGER) and rejects floats, NaN, Infinity, and safe-integer overflow', () => {
    expect(assertSafeGrosze(0)).toBe(0);
    expect(assertSafeGrosze(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(assertSafeGrosze(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);

    // Rejects IEEE-754 floats, NaN, Infinity, and unsafe integers
    expect(() => assertSafeGrosze(0.1 + 0.2)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(10.5)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.NaN)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.POSITIVE_INFINITY)).toThrow(InvalidMoneyAmountError);
    expect(() => assertSafeGrosze(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyAmountError);
    expect(() => assertNonNegativeGrosze(-1)).toThrow(InvalidMoneyAmountError);

    // Overflow during BigInt addition/subtraction/summation/multiplication fails closed instead of silently losing precision
    expect(() => addGrosze(Number.MAX_SAFE_INTEGER, 1)).toThrow(InvalidMoneyAmountError);
    expect(() => subtractGrosze(Number.MIN_SAFE_INTEGER, 1)).toThrow(InvalidMoneyAmountError);
    expect(() => sumGrosze([Number.MAX_SAFE_INTEGER - 10, 5, 6])).toThrow(InvalidMoneyAmountError);
    expect(() => multiplyGroszeByBps(Number.MAX_SAFE_INTEGER, 20_000, 'half_up')).toThrow(
      InvalidMoneyAmountError,
    );
  });

  it('prevents IEEE-754 precision drift on large multi-billion PLN aggregations and normalizes -0 to +0', () => {
    // 10_000_000_000.01 PLN + 20_000_000_000.02 PLN = 30_000_000_000.03 PLN
    const tenBillionAnd1Gr = parsePlnToGrosze('10000000000.01');
    const twentyBillionAnd2Gr = parsePlnToGrosze('20000000000.02');
    expect(tenBillionAnd1Gr).toBe(1_000_000_000_001);
    expect(twentyBillionAnd2Gr).toBe(2_000_000_000_002);

    const total = addGrosze(tenBillionAnd1Gr, twentyBillionAnd2Gr);
    expect(total).toBe(3_000_000_000_003);
    expect(formatPlnFromGrosze(total)).toBe('30 000 000 000,03 zł');

    // -0 normalization across arithmetic, ratio, and signed tax rounding
    expect(Object.is(multiplyGroszeByRatio(-1, 0, 100, 'half_up'), -0)).toBe(false);
    expect(Object.is(roundSignedTaxAmountPln(-49).roundedFullPln, -0)).toBe(false);
    expect(Object.is(roundSignedTaxAmountPln(-49).roundedGrosze, -0)).toBe(false);
    expect(roundSignedTaxAmountPln(-50)).toEqual({
      inputGrosze: -50,
      roundedFullPln: -1,
      roundedGrosze: -100,
    });
    expect(roundTaxAmountOrdynacjaArt63(149)).toEqual({
      inputGrosze: 149,
      roundedFullPln: 1,
      roundedGrosze: 100,
    });
    expect(roundTaxAmountOrdynacjaArt63(150)).toEqual({
      inputGrosze: 150,
      roundedFullPln: 2,
      roundedGrosze: 200,
    });
  });

  it('conserves 1-grosz invariants across net/gross VAT calculations and Hamilton proportional deduction allocation', () => {
    for (const net of [-999_99, -1, 0, 1, 33_33, 10_02, 999_999_99]) {
      for (const rate of ['23', '8', '5', '0', 'zw', 'np'] as const) {
        const fromNet = calculateInvoiceLineFromNet(net, rate);
        expect(fromNet.netGrosze + fromNet.vatGrosze).toBe(fromNet.grossGrosze);
        const fromGross = calculateInvoiceLineFromGross(fromNet.grossGrosze, rate);
        expect(fromGross.netGrosze + fromGross.vatGrosze).toBe(fromGross.grossGrosze);
      }
    }

    const buckets = [
      { rate: '12' as const, revenueGrosze: 10_000 },
      { rate: '8.5' as const, revenueGrosze: 10_000 },
      { rate: '5.5' as const, revenueGrosze: 10_000 },
    ];
    const allocated = allocateDeductionProportionally(10_000, buckets, 30_000);
    const totalAllocated = [...allocated.values()].reduce((acc, v) => acc + v, 0);
    expect(totalAllocated).toBe(10_000);
  });
});
