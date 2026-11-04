import { describe, expect, it } from 'vitest';
import {
  calculateKpirPitAdvance,
  createKpirEntry,
  createKpirStornoEntry,
  qualifyKpirExpense,
  summarizeKpirPeriod,
} from '../src/kpir/index.js';
import { calculateMonthlyRyczalt, createRyczaltEntry } from '../src/ryczalt/index.js';

describe('kpir & pit — expense qualification, corrections, period summaries & scale/flat advances', () => {
  it('qualifies mixed-use passenger car expense at 75% of (net + 50% non-deductible VAT) for active VAT taxpayer', () => {
    // Faktura paliwowa: 200,00 zł netto (20 000 gr) + 46,00 zł VAT (4 600 gr)
    // Czynny podatnik VAT odlicza 50% VAT = 23,00 zł; nieodliczone 23,00 zł powiększa bazę kosztową = 223,00 zł (22 300 gr)
    // 75% * 22 300 gr = 16 725 gr (167,25 zł) KUP w kolumnie 13; 25% = 5 575 gr (55,75 zł) NKUP!
    const res = qualifyKpirExpense({
      eventDate: '2026-04-12',
      qualificationKind: 'vehicle_mixed_75_col13',
      netGrosze: 20_000,
      vatGrosze: 4_600,
      taxpayerVatActive: true,
    });

    expect(res.expenseBaseForKupGrosze).toBe(22_300);
    expect(res.deductibleKupGrosze).toBe(16_725);
    expect(res.nonDeductibleNkupGrosze).toBe(5_575);
    expect(res.col13OtherExpensesGrosze).toBe(16_725);
  });

  it('qualifies mixed-use car expense at 75% of gross amount for VAT-exempt taxpayer', () => {
    // Podatnik zwolniony z VAT: baza kosztowa = 246,00 zł brutto (24 600 gr) -> 75% = 18 450 gr (184,50 zł)
    const res = qualifyKpirExpense({
      eventDate: '2026-04-12',
      qualificationKind: 'vehicle_mixed_75_col13',
      netGrosze: 20_000,
      vatGrosze: 4_600,
      taxpayerVatActive: false,
    });

    expect(res.expenseBaseForKupGrosze).toBe(24_600);
    expect(res.deductibleKupGrosze).toBe(18_450);
    expect(res.col13OtherExpensesGrosze).toBe(18_450);
  });

  it('qualifies 100% expenses into columns 10, 11, 12, 13, 16 and excludes NKUP (art. 23)', () => {
    const col10 = qualifyKpirExpense({
      eventDate: '2026-03-05',
      qualificationKind: 'goods_and_materials_col10',
      netGrosze: 300_000,
      vatGrosze: 69_000,
      taxpayerVatActive: true,
    });
    expect(col10.col10GoodsAndMaterialsGrosze).toBe(300_000);

    const nkup = qualifyKpirExpense({
      eventDate: '2026-03-05',
      qualificationKind: 'nkup_excluded',
      netGrosze: 50_000,
      vatGrosze: 4_000,
      taxpayerVatActive: true,
    });
    expect(nkup.deductibleKupGrosze).toBe(0);
    expect(nkup.nonDeductibleNkupGrosze).toBe(50_000);
  });

  it('tracks PKPiR regulation version (2025 vs 2026), enforces storno rules and computes YTD summaries', () => {
    const entry2025 = createKpirEntry({
      id: 'k-2025',
      ordinalNumber: 1,
      eventDate: '2025-12-20',
      documentNumber: 'FV/2025/99',
      counterpartyName: 'Klient 2025',
      counterpartyAddress: 'Warszawa',
      eventDescription: 'Usługi doradcze',
      col7SalesRevenueGrosze: 500_000,
    });
    expect(entry2025.regulationVersion).toBe('pkpir_2019_17col');

    const saleJan = createKpirEntry({
      id: 'k-jan-1',
      ordinalNumber: 1,
      eventDate: '2026-01-15',
      documentNumber: 'FV/2026/01/01',
      ksefReferenceNumber: '5261040828-20260115-01',
      counterpartyName: 'Klient Styczeń',
      counterpartyNip: '5261040828',
      counterpartyAddress: 'Kraków',
      eventDescription: 'Usługa programistyczna',
      col7SalesRevenueGrosze: 1_500_000, // 15 000,00 zł
    });
    expect(saleJan.regulationVersion).toBe('pkpir_2026_ksef');

    const costFeb = createKpirEntry({
      id: 'k-feb-1',
      ordinalNumber: 2,
      eventDate: '2026-02-10',
      documentNumber: 'FZ/2026/02/01',
      counterpartyName: 'Hosting Cloud',
      counterpartyAddress: 'Gdańsk',
      eventDescription: 'Serwery chmurowe',
      col13OtherExpensesGrosze: 200_000, // 2 000,00 zł
    });

    // Próba wpisania ujemnej kwoty bez flagi korekty musi rzucić błąd:
    expect(() =>
      createKpirEntry({
        id: 'k-illegal-neg',
        ordinalNumber: 3,
        eventDate: '2026-02-12',
        documentNumber: 'KOR/1',
        counterpartyName: 'Hosting Cloud',
        counterpartyAddress: 'Gdańsk',
        eventDescription: 'Próba ujemnego wpisu bez uzasadnienia',
        col13OtherExpensesGrosze: -50_000,
      }),
    ).toThrow(/Ujemne kwoty w KPiR/);

    // Poprawne storno czerwone anulujące błędnie zaksięgowany koszt w lutym:
    const stornoFeb = createKpirStornoEntry({
      id: 'k-feb-2',
      ordinalNumber: 3,
      correctionDate: '2026-02-15',
      originalEntry: costFeb,
      correctionDocumentNumber: 'PK/STORNO/1',
      correctionReason: 'Duplikat faktury kosztowej — wyksięgowanie stornem czerwonym',
    });

    const febSummary = summarizeKpirPeriod([saleJan, costFeb, stornoFeb], '2026-02');
    expect(febSummary.monthTotals.totalTaxDeductibleCostsGrosze).toBe(0);
    expect(febSummary.yearToDateTotals.col9TotalRevenueGrosze).toBe(1_500_000);
    expect(febSummary.yearToDateTotals.accountingIncomeGrosze).toBe(1_500_000);
  });

  it('calculates 0 zł PIT advance on tax scale within 30 000 zł tax-free allowance', () => {
    const res = calculateKpirPitAdvance({
      period: '2026-02',
      taxForm: 'skala',
      ytdRevenueGrosze: 3_500_000, // 35 000,00 zł
      ytdCostsGrosze: 600_000, // 6 000,00 zł -> dochód 29 000,00 zł <= 30 000,00 zł!
    });

    expect(res.roundedTaxBaseFullPln).toBe(29_000);
    expect(res.advanceDueGrosze).toBe(0);
  });

  it('calculates PIT scale advance across the 120 000 zł threshold (12% -> 32%) and ignores health insurance deduction', () => {
    // Przychód YTD: 200 000,00 zł, Koszty: 30 000,00 zł -> dochód 170 000,00 zł
    // Składki społeczne ZUS zapłacone YTD: 20 000,00 zł -> podstawa 150 000,00 zł
    // Zapłacona zdrowotna 10 000,00 zł NIE odlicza się na skali!
    // Podatek narastająco: 10 800 zł (I próg po kwocie zmniejszającej) + 32% * 30 000 zł (9 600 zł) = 20 400 zł
    // Poprzednie zaliczki: 12 000 zł -> do wpłaty 8 400 zł (840 000 gr)
    const res = calculateKpirPitAdvance({
      period: '2026-10',
      taxForm: 'skala',
      ytdRevenueGrosze: 20_000_000,
      ytdCostsGrosze: 3_000_000,
      paidSocialZusYtdGrosze: 2_000_000,
      paidHealthInsuranceYtdGrosze: 1_000_000,
      previousAdvancesPaidYtdGrosze: 1_200_000,
    });

    expect(res.effectiveHealthDeductionFromIncomeGrosze).toBe(0);
    expect(res.roundedTaxBaseFullPln).toBe(150_000);
    expect(res.cumulativeTaxGrosze).toBe(2_040_000); // 20 400,00 zł
    expect(res.advanceDueGrosze).toBe(840_000); // 8 400,00 zł
    expect(res.explanation.warnings.some((w) => w.code === 'PIT_SECOND_BRACKET_32_EXCEEDED')).toBe(
      true,
    );
  });

  it('enforces annual health deduction cap on 19% flat tax: 12 900 zł in 2025 vs 14 100 zł in 2026', () => {
    // Dochód 100 000 zł, zapłacona zdrowotna 16 000 zł:
    // W 2025 r.: odliczenie ograniczone do 12 900 zł -> podstawa 87 100 zł * 19% = 16 549,00 zł -> 16 549 zł
    const res2025 = calculateKpirPitAdvance({
      period: '2025-11',
      taxForm: 'liniowy',
      ytdRevenueGrosze: 12_000_000,
      ytdCostsGrosze: 2_000_000,
      paidHealthInsuranceYtdGrosze: 1_600_000,
    });
    expect(res2025.effectiveHealthDeductionFromIncomeGrosze).toBe(1_290_000);
    expect(res2025.roundedTaxBaseFullPln).toBe(87_100);
    expect(res2025.advanceDueGrosze).toBe(1_654_900);

    // W 2026 r.: odliczenie ograniczone do 14 100 zł -> podstawa 85 900 zł * 19% = 16 321,00 zł -> 16 321 zł
    const res2026 = calculateKpirPitAdvance({
      period: '2026-11',
      taxForm: 'liniowy',
      ytdRevenueGrosze: 12_000_000,
      ytdCostsGrosze: 2_000_000,
      paidHealthInsuranceYtdGrosze: 1_600_000,
    });
    expect(res2026.effectiveHealthDeductionFromIncomeGrosze).toBe(1_410_000);
    expect(res2026.roundedTaxBaseFullPln).toBe(85_900);
    expect(res2026.advanceDueGrosze).toBe(1_632_100);
  });
});

describe('ryczalt — multi-rate revenue register & proportional 50% health insurance deduction (art. 11 ust. 2)', () => {
  it('allocates social ZUS and 50% paid health insurance proportionally across 12% and 8.5% rates', () => {
    // Przychody w kwietniu 2026:
    // - 12% (IT): 8 000,00 zł (800 000 gr) -> udział 80%
    // - 8,5% (usługi): 2 000,00 zł (200 000 gr) -> udział 20%
    // Razem przychód: 10 000,00 zł (1 000 000 gr)
    // Zapłacone społeczne ZUS: 1 788,29 zł (178 829 gr) -> 80% = 143 063 gr, 20% = 35 766 gr (suma = 178 829 gr!)
    // Zapłacona zdrowotna II próg 2026: 830,58 zł (83 058 gr) -> 50% = 41 529 gr (415,29 zł)
    //   -> 80% = 33 223 gr, 20% = 8 306 gr (suma = 41 529 gr!)
    // Stawka 12%: 800 000 - 143 063 - 33 223 = 623 714 gr (6 237,14 zł) -> podstawa 6 237 zł (623 700 gr) * 12% = 74 844 gr (748,44 zł)
    // Stawka 8,5%: 200 000 - 35 766 - 8 306 = 155 928 gr (1 559,28 zł) -> podstawa 1 559 zł (155 900 gr) * 8,5% = 13 251,5 gr -> 13 252 gr (132,52 zł)
    // Suma podatku przed zaokrągleniem końcowym: 74 844 + 13 252 = 88 096 gr (880,96 zł) -> należny ryczałt = 881 zł (88 100 gr)!
    const e1 = createRyczaltEntry({
      id: 'r1',
      ordinalNumber: 1,
      entryDate: '2026-04-10',
      revenueDate: '2026-04-10',
      documentNumber: 'FV/IT/1',
      counterpartyName: 'Software House',
      rate: '12',
      revenueGrosze: 800_000,
    });
    const e2 = createRyczaltEntry({
      id: 'r2',
      ordinalNumber: 2,
      entryDate: '2026-04-20',
      revenueDate: '2026-04-20',
      documentNumber: 'FV/USL/2',
      counterpartyName: 'Klient B',
      rate: '8.5',
      revenueGrosze: 200_000,
    });

    const res = calculateMonthlyRyczalt({
      period: '2026-04',
      entries: [e1, e2],
      paidSocialZusInMonthGrosze: 178_829,
      paidHealthInsuranceInMonthGrosze: 83_058,
    });

    expect(res.deductibleHealth50PctGrosze).toBe(41_529);
    expect(res.breakdownByRate).toHaveLength(2);
    expect(res.breakdownByRate[0]?.allocatedSocialDeductionGrosze).toBe(143_063);
    expect(res.breakdownByRate[1]?.allocatedSocialDeductionGrosze).toBe(35_766);
    expect(res.breakdownByRate[0]?.allocatedHealthDeductionGrosze).toBe(33_223);
    expect(res.breakdownByRate[1]?.allocatedHealthDeductionGrosze).toBe(8_306);
    expect(res.taxDueRoundedPln).toBe(881);
    expect(res.taxDueGrosze).toBe(88_100);
  });

  it('caps deductions at available revenue when ZUS exceeds monthly revenue on ryczalt', () => {
    const e1 = createRyczaltEntry({
      id: 'r-small',
      ordinalNumber: 1,
      entryDate: '2026-05-05',
      revenueDate: '2026-05-05',
      documentNumber: 'FV/1',
      counterpartyName: 'Klient',
      rate: '15',
      revenueGrosze: 100_000, // 1 000,00 zł
    });

    const res = calculateMonthlyRyczalt({
      period: '2026-05',
      entries: [e1],
      paidSocialZusInMonthGrosze: 192_676, // > 1 000,00 zł
      paidHealthInsuranceInMonthGrosze: 49_835,
    });

    expect(res.totalEffectiveDeductionGrosze).toBe(100_000);
    expect(res.taxDueGrosze).toBe(0);
  });
});
