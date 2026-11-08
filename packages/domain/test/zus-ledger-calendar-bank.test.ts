import { describe, expect, it } from 'vitest';
import {
  parseMt940Statement,
  parsePolishBankCsv,
  reconcileBankTransactions,
} from '../src/bank-reconciliation/index.js';
import {
  DoubleEntryValidationError,
  calculateCitAdvance,
  createValidatedJournalEntry,
  generateBalanceSheet,
  generateProfitAndLoss,
  generateTrialBalance,
  qualifyCitVehicleExpense,
} from '../src/full-ledger/index.js';
import {
  computeEasterSundayUtc,
  generateTaxCalendarObligations,
  getPolishStatutoryHolidaysForYear,
  shiftTaxDeadlineToBusinessDay,
} from '../src/tax-calendar/index.js';
import { calculateMonthlyZusContributions } from '../src/zus/index.js';

describe('zus — social & health insurance exact grosze reference calculations (2025 vs 2026)', () => {
  it('calculates Ulga na start in 2026: 0 zł social ZUS + minimum health contribution 432,54 zł', () => {
    const res = calculateMonthlyZusContributions({
      period: '2026-03',
      zusScheme: 'ulga_na_start',
      taxForm: 'skala',
      voluntarySicknessInsurance: false,
      previousMonthIncomeGrosze: 0,
    });

    expect(res.socialContributionsTotalGrosze).toBe(0);
    expect(res.laborAndSolidarityFundGrosze).toBe(0);
    expect(res.healthContributionGrosze).toBe(43_254); // 432,54 zł
    expect(res.totalZusToPayGrosze).toBe(43_254);
  });

  it('calculates Preferencyjny ZUS exact grosze for 2025 (442,90 zł) and 2026 (456,18 zł) with 0 zł FP', () => {
    const pref2025 = calculateMonthlyZusContributions({
      period: '2025-06',
      zusScheme: 'preferencyjny_zus',
      taxForm: 'skala',
      voluntarySicknessInsurance: true,
      previousMonthIncomeGrosze: 0, // min zdrowotna 2025 = 314,96 zł
    });
    expect(pref2025.socialContributionBaseGrosze).toBe(139_980); // 1 399,80 zł
    expect(pref2025.socialContributionsTotalGrosze).toBe(44_290); // 442,90 zł
    expect(pref2025.laborAndSolidarityFundGrosze).toBe(0);
    expect(pref2025.healthContributionGrosze).toBe(31_496); // 314,96 zł
    expect(pref2025.totalZusToPayGrosze).toBe(75_786);

    const pref2026 = calculateMonthlyZusContributions({
      period: '2026-06',
      zusScheme: 'preferencyjny_zus',
      taxForm: 'skala',
      voluntarySicknessInsurance: true,
      previousMonthIncomeGrosze: 1_000_000, // 10 000 zł * 9% = 900,00 zł
    });
    expect(pref2026.socialContributionBaseGrosze).toBe(144_180); // 1 441,80 zł
    expect(pref2026.socialContributionsTotalGrosze).toBe(45_618); // 456,18 zł
    expect(pref2026.laborAndSolidarityFundGrosze).toBe(0);
    expect(pref2026.healthContributionGrosze).toBe(90_000);
    expect(pref2026.totalZusToPayGrosze).toBe(135_618);
  });

  it('calculates Duży ZUS exact grosze for 2025 (1 773,96 zł) and 2026 (1 926,76 zł)', () => {
    const duzy2025 = calculateMonthlyZusContributions({
      period: '2025-08',
      zusScheme: 'duzy_zus',
      taxForm: 'liniowy',
      voluntarySicknessInsurance: true,
      previousMonthIncomeGrosze: 2_000_000, // 20 000 zł * 4,9% = 980,00 zł
    });
    expect(duzy2025.socialContributionsTotalGrosze).toBe(164_647); // 1 646,47 zł
    expect(duzy2025.laborAndSolidarityFundGrosze).toBe(12_749); // 127,49 zł
    expect(duzy2025.socialContributionsTotalGrosze + duzy2025.laborAndSolidarityFundGrosze).toBe(
      177_396,
    ); // 1 773,96 zł
    expect(duzy2025.healthContributionGrosze).toBe(98_000);

    const duzy2026 = calculateMonthlyZusContributions({
      period: '2026-08',
      zusScheme: 'duzy_zus',
      taxForm: 'liniowy',
      voluntarySicknessInsurance: true,
      previousMonthIncomeGrosze: 200_000, // 2 000 zł * 4,9% = 98 zł < minimum 432,54 zł!
    });
    expect(duzy2026.socialContributionsTotalGrosze).toBe(178_829); // 1 788,29 zł
    expect(duzy2026.laborAndSolidarityFundGrosze).toBe(13_847); // 138,47 zł
    expect(duzy2026.socialContributionsTotalGrosze + duzy2026.laborAndSolidarityFundGrosze).toBe(
      192_676,
    ); // 1 926,76 zł
    expect(duzy2026.healthContributionGrosze).toBe(43_254); // minimum 432,54 zł na liniowym!
  });

  it.each([
    { period: '2025-05', ytdRev: 4_000_000, expectedTier: 1, expectedHealth: 46_166 },
    { period: '2025-05', ytdRev: 15_000_000, expectedTier: 2, expectedHealth: 76_943 },
    { period: '2025-05', ytdRev: 35_000_000, expectedTier: 3, expectedHealth: 138_497 },
    { period: '2026-05', ytdRev: 6_000_000, expectedTier: 1, expectedHealth: 49_835 },
    { period: '2026-05', ytdRev: 30_000_000, expectedTier: 2, expectedHealth: 83_058 },
    { period: '2026-05', ytdRev: 30_000_001, expectedTier: 3, expectedHealth: 149_504 },
  ])(
    'calculates ryczalt health insurance tier $expectedTier ($expectedHealth gr) for period $period and YTD $ytdRev gr',
    ({ period, ytdRev, expectedTier, expectedHealth }) => {
      const res = calculateMonthlyZusContributions({
        period,
        zusScheme: 'ulga_na_start',
        taxForm: 'ryczalt',
        voluntarySicknessInsurance: false,
        ytdRyczaltRevenueGrosze: ytdRev,
      });

      expect(res.ryczaltHealthTier).toBe(expectedTier);
      expect(res.healthContributionGrosze).toBe(expectedHealth);
    },
  );

  it('requires expert review when payer has >= 10 insured persons or custom ZUS IWA accident rate', () => {
    const res = calculateMonthlyZusContributions({
      period: '2026-06',
      zusScheme: 'duzy_zus',
      taxForm: 'skala',
      voluntarySicknessInsurance: true,
      insuredPersonsCount: 14,
      customAccidentRateBps: 226,
      previousMonthIncomeGrosze: 1_500_000,
    });

    expect(res.explanation.requiresHumanApproval).toBe(true);
  });
});

describe('full-ledger (UoR) & CIT — double-entry invariants, Trial Balance, P&L, Balance Sheet & CIT 9%/19%', () => {
  it('validates double-entry journals and produces a balanced Trial Balance, P&L and Balance Sheet (Aktywa === Pasywa)', () => {
    // 1. Wniesienie kapitału zakładowego sp. z o.o. 50 000,00 zł na rachunek bankowy
    const je1 = createValidatedJournalEntry({
      id: 'je-1',
      entryNumber: 'BO/2026/01',
      bookingDate: '2026-04-01',
      documentDate: '2026-04-01',
      documentNumber: 'AKT/01',
      description: 'Wpłata kapitału zakładowego',
      lines: [
        {
          accountCode: '130',
          side: 'Wn',
          amountGrosze: 5_000_000,
          description: 'Rachunek bieżący',
        },
        {
          accountCode: '800',
          side: 'Ma',
          amountGrosze: 5_000_000,
          description: 'Kapitał zakładowy',
        },
      ],
    });

    // 2. Zakup środka trwałego 10 000,00 zł netto + 2 300,00 zł VAT
    const je2 = createValidatedJournalEntry({
      id: 'je-2',
      entryNumber: 'FZ/2026/01',
      bookingDate: '2026-04-05',
      documentDate: '2026-04-05',
      documentNumber: 'FV/ST/1',
      description: 'Zakup serwera',
      lines: [
        { accountCode: '010', side: 'Wn', amountGrosze: 1_000_000, description: 'Środek trwały' },
        { accountCode: '221-2', side: 'Wn', amountGrosze: 230_000, description: 'VAT naliczony' },
        {
          accountCode: '202',
          side: 'Ma',
          amountGrosze: 1_230_000,
          description: 'Zobowiązanie wobec dostawcy',
        },
      ],
    });

    // 3. Odpis amortyzacyjny 500,00 zł
    const je3 = createValidatedJournalEntry({
      id: 'je-3',
      entryNumber: 'PK/2026/01',
      bookingDate: '2026-04-30',
      documentDate: '2026-04-30',
      documentNumber: 'AMO/04/2026',
      description: 'Amortyzacja miesięczna',
      lines: [
        { accountCode: '400', side: 'Wn', amountGrosze: 50_000, description: 'Koszt amortyzacji' },
        { accountCode: '070', side: 'Ma', amountGrosze: 50_000, description: 'Umorzenie ŚT' },
      ],
    });

    // 4. Sprzedaż usług 20 000,00 zł netto + 4 600,00 zł VAT
    const je4 = createValidatedJournalEntry({
      id: 'je-4',
      entryNumber: 'FS/2026/01',
      bookingDate: '2026-04-28',
      documentDate: '2026-04-28',
      documentNumber: 'FV/2026/04/01',
      description: 'Sprzedaż usług programistycznych',
      lines: [
        {
          accountCode: '201',
          side: 'Wn',
          amountGrosze: 2_460_000,
          description: 'Należność od odbiorcy',
        },
        {
          accountCode: '700',
          side: 'Ma',
          amountGrosze: 2_000_000,
          description: 'Przychód ze sprzedaży usług',
        },
        { accountCode: '221-1', side: 'Ma', amountGrosze: 460_000, description: 'VAT należny' },
      ],
    });

    const entries = [je1, je2, je3, je4];
    const tb = generateTrialBalance(entries);
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalTurnoverWnGrosze).toBe(8_740_000);
    expect(tb.totalTurnoverMaGrosze).toBe(8_740_000);

    const pnl = generateProfitAndLoss(entries);
    expect(pnl.totalRevenuesGrosze).toBe(2_000_000); // 20 000,00 zł
    expect(pnl.totalOperatingAndFinancialExpensesGrosze).toBe(50_000); // 500,00 zł
    expect(pnl.netProfitOrLossGrosze).toBe(1_950_000); // 19 500,00 zł

    const bs = generateBalanceSheet(entries);
    expect(bs.fixedAssetsNetGrosze).toBe(950_000); // 10 000 - 500 = 9 500,00 zł
    expect(bs.isBalanced).toBe(true);
    expect(bs.totalAssetsGrosze).toBe(bs.totalEquityAndLiabilitiesGrosze);
  });

  it('rejects unbalanced journal entries (Wn != Ma), closed periods, unknown accounts and unjustified negative amounts', () => {
    // Wn != Ma
    expect(() =>
      createValidatedJournalEntry({
        id: 'bad-1',
        entryNumber: 'PK/ERR/1',
        bookingDate: '2026-04-10',
        documentDate: '2026-04-10',
        documentNumber: 'DOK/1',
        description: 'Niezbilansowany dekret',
        lines: [
          { accountCode: '130', side: 'Wn', amountGrosze: 100_000, description: 'Bank' },
          {
            accountCode: '700',
            side: 'Ma',
            amountGrosze: 99_999,
            description: 'Przychód o 1 gr za mało',
          },
        ],
      }),
    ).toThrow(DoubleEntryValidationError);

    // Zamknięty okres
    expect(() =>
      createValidatedJournalEntry({
        id: 'bad-2',
        entryNumber: 'PK/ERR/2',
        bookingDate: '2026-03-31',
        documentDate: '2026-03-31',
        documentNumber: 'DOK/2',
        description: 'Księgowanie do zamkniętego marca',
        closedPeriods: ['2026-03'],
        lines: [
          { accountCode: '130', side: 'Wn', amountGrosze: 10_000, description: 'Bank' },
          { accountCode: '201', side: 'Ma', amountGrosze: 10_000, description: 'Rozrachunek' },
        ],
      }),
    ).toThrow(/zamknięty/);

    // Ujemna kwota bez flagi storna czerwonego
    expect(() =>
      createValidatedJournalEntry({
        id: 'bad-3',
        entryNumber: 'PK/ERR/3',
        bookingDate: '2026-04-10',
        documentDate: '2026-04-10',
        documentNumber: 'DOK/3',
        description: 'Ujemna bez storna',
        lines: [
          { accountCode: '402', side: 'Wn', amountGrosze: -10_000, description: 'Usługi obce' },
          { accountCode: '202', side: 'Ma', amountGrosze: -10_000, description: 'Dostawca' },
        ],
      }),
    ).toThrow(/storna czerwonego/);

    // Poprawne storno czerwone z uzasadnieniem
    const redStorno = createValidatedJournalEntry({
      id: 'ok-storno',
      entryNumber: 'PK/STORNO/1',
      bookingDate: '2026-04-12',
      documentDate: '2026-04-12',
      documentNumber: 'PK/ST/1',
      description: 'Storno czerwone błędnego kosztu',
      lines: [
        {
          accountCode: '402',
          side: 'Wn',
          amountGrosze: -10_000,
          description: 'Korekta kosztu',
          isRedStorno: true,
          stornoReason: 'Błędne konto kosztowe',
        },
        {
          accountCode: '202',
          side: 'Ma',
          amountGrosze: -10_000,
          description: 'Korekta zobowiązania',
          isRedStorno: true,
          stornoReason: 'Błędne konto kosztowe',
        },
      ],
    });
    expect(redStorno.totalWnGrosze).toBe(-10_000);
  });

  it('calculates CIT 9% for small taxpayer and enforces 19% when prior-year gross sales exceed 8 517 000 zł in 2026', () => {
    const cit9 = calculateCitAdvance({
      period: '2026-04',
      ytdTaxableRevenuesGrosze: 50_000_000, // 500 000 zł
      ytdTaxDeductibleCostsGrosze: 30_000_000, // 300 000 zł -> dochód 200 000 zł
      smallTaxpayerStatus: true,
      priorYearGrossSalesGrosze: 500_000_000, // 5 000 000 zł <= 8 517 000 zł
    });
    expect(cit9.appliedRatePct).toBe(9);
    expect(cit9.advanceDueGrosze).toBe(1_800_000); // 18 000,00 zł

    const cit19Exceeded = calculateCitAdvance({
      period: '2026-04',
      ytdTaxableRevenuesGrosze: 50_000_000,
      ytdTaxDeductibleCostsGrosze: 30_000_000,
      smallTaxpayerStatus: true,
      priorYearGrossSalesGrosze: 900_000_000, // 9 000 000 zł > 8 517 000 zł!
    });
    expect(cit19Exceeded.appliedRatePct).toBe(19);
    expect(cit19Exceeded.advanceDueGrosze).toBe(3_800_000); // 38 000,00 zł

    // Przekroczenie bieżącego limitu 2 mln EUR netto wg kursu NBP z 2 stycznia (8 534 000 zł w 2025 r., 8 431 000 zł w 2026 r. — art. 19 ust. 1 pkt 2 i art. 25 ust. 1g CIT, #65):
    const cit2025WithinCurrentCap = calculateCitAdvance({
      period: '2025-10',
      ytdTaxableRevenuesGrosze: 853_400_000, // równo 8 534 000,00 zł netto <= 8 534 000,00 zł w 2025 r.
      ytdTaxDeductibleCostsGrosze: 753_400_000, // dochód 1 000 000,00 zł
      smallTaxpayerStatus: true,
      priorYearGrossSalesGrosze: 500_000_000,
    });
    expect(cit2025WithinCurrentCap.appliedRatePct).toBe(9);
    expect(cit2025WithinCurrentCap.currentYearSmallTaxpayerLimitNetGrosze).toBe(853_400_000);
    expect(cit2025WithinCurrentCap.advanceDueGrosze).toBe(9_000_000); // 90 000,00 zł

    const cit2026CurrentCapExceeded = calculateCitAdvance({
      period: '2026-10',
      ytdTaxableRevenuesGrosze: 845_000_000, // 8 450 000,00 zł netto > 8 431 000,00 zł w 2026 r.!
      ytdTaxDeductibleCostsGrosze: 745_000_000, // dochód 1 000 000,00 zł
      smallTaxpayerStatus: true,
      priorYearGrossSalesGrosze: 500_000_000, // mały podatnik z roku poprzedniego, ale przekroczył limit bieżący!
    });
    expect(cit2026CurrentCapExceeded.appliedRatePct).toBe(19);
    expect(cit2026CurrentCapExceeded.currentYearSmallTaxpayerLimitNetGrosze).toBe(843_100_000);
    expect(cit2026CurrentCapExceeded.advanceDueGrosze).toBe(19_000_000); // 190 000,00 zł
    expect(
      cit2026CurrentCapExceeded.explanation.warnings.some(
        (w) => w.code === 'CIT_CURRENT_YEAR_2M_EUR_NET_LIMIT_EXCEEDED',
      ),
    ).toBe(true);
  });

  it('qualifies mixed-use passenger car expenses in CIT as 75% KUP / 25% NKUP (art. 16 ust. 1 pkt 51 CIT) and separates period vs cumulative trial balance turnovers (#65)', () => {
    // 1 000,00 zł netto + 230,00 zł VAT -> 50% VAT do odliczenia = 115,00 zł; koszt bilansowy = 1 115,00 zł
    // 75% KUP = 836,25 zł (83 625 gr), 25% NKUP = 278,75 zł (27 875 gr)
    const carCit = qualifyCitVehicleExpense({
      eventDate: '2026-03-20',
      usageKind: 'mixed_use_75',
      netGrosze: 100_000,
      vatGrosze: 23_000,
      taxpayerVatActive: true,
    });
    expect(carCit.deductibleVatGrosze).toBe(11_500);
    expect(carCit.nonDeductibleVatGrosze).toBe(11_500);
    expect(carCit.accountingExpenseBaseGrosze).toBe(111_500);
    expect(carCit.taxDeductibleKupGrosze).toBe(83_625);
    expect(carCit.nonDeductibleNkupGrosze).toBe(27_875);

    const febEntry = createValidatedJournalEntry({
      id: 'j-feb',
      entryNumber: 'DK/2026/02/001',
      bookingDate: '2026-02-10',
      documentDate: '2026-02-10',
      documentNumber: 'WB/02/1',
      description: 'Wpłata kapitału zakładowego',
      lines: [
        {
          accountCode: '130',
          side: 'Wn',
          amountGrosze: 1_000_000,
          description: 'Rachunek bankowy',
        },
        {
          accountCode: '800',
          side: 'Ma',
          amountGrosze: 1_000_000,
          description: 'Kapitał zakładowy',
        },
      ],
    });
    const marEntry = createValidatedJournalEntry({
      id: 'j-mar',
      entryNumber: 'DK/2026/03/001',
      bookingDate: '2026-03-15',
      documentDate: '2026-03-15',
      documentNumber: 'FV/03/1',
      description: 'Sprzedaż usług w marcu',
      lines: [
        { accountCode: '130', side: 'Wn', amountGrosze: 200_000, description: 'Wpływ na rachunek' },
        {
          accountCode: '700',
          side: 'Ma',
          amountGrosze: 200_000,
          description: 'Przychód ze sprzedaży',
        },
      ],
    });

    const tbMarch = generateTrialBalance([febEntry, marEntry], undefined, { period: '2026-03' });
    expect(tbMarch.isBalanced).toBe(true);
    expect(tbMarch.totalOpeningBalanceWnGrosze).toBe(1_000_000);
    expect(tbMarch.totalOpeningBalanceMaGrosze).toBe(1_000_000);
    expect(tbMarch.totalPeriodTurnoverWnGrosze).toBe(200_000);
    expect(tbMarch.totalPeriodTurnoverMaGrosze).toBe(200_000);
    expect(tbMarch.totalTurnoverWnGrosze).toBe(1_200_000);
    expect(tbMarch.totalEndingBalanceWnGrosze).toBe(1_200_000);

    const bankRow = tbMarch.rows.find((r) => r.accountCode === '130');
    expect(bankRow?.openingBalanceWnGrosze).toBe(1_000_000);
    expect(bankRow?.periodTurnoverWnGrosze).toBe(200_000);
    expect(bankRow?.turnoverWnGrosze).toBe(1_200_000);
    expect(bankRow?.endingBalanceWnGrosze).toBe(1_200_000);
  });
});

describe('tax-calendar — Polish movable holidays, Christmas Eve 2025+, art. 12 § 5 shifts & obligations', () => {
  it('computes Easter Sunday and Corpus Christi accurately for 2025 and 2026 and includes Christmas Eve from 2025', () => {
    expect(computeEasterSundayUtc(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
    expect(computeEasterSundayUtc(2026).toISOString().slice(0, 10)).toBe('2026-04-05');

    const holidays2026 = getPolishStatutoryHolidaysForYear(2026);
    expect(holidays2026.get('2026-04-06')).toBe('Poniedziałek Wielkanocny');
    expect(holidays2026.get('2026-06-04')).toBe('Boże Ciało');
    expect(holidays2026.get('2026-12-24')).toBe('Wigilia Bożego Narodzenia');
  });

  it('shifts April 20, 2025 deadline (Easter Sunday + Easter Monday) to Tuesday April 22, 2025 (art. 12 § 5 OP)', () => {
    const shift = shiftTaxDeadlineToBusinessDay('2025-04-20');
    expect(shift.wasShifted).toBe(true);
    expect(shift.effectiveDueDate).toBe('2025-04-22');
    expect(shift.shiftedFromNonWorkingDays).toHaveLength(2);
  });

  it('shifts December 25, 2026 JPK_V7M deadline across Christmas and weekend to Monday December 28, 2026', () => {
    const shift = shiftTaxDeadlineToBusinessDay('2026-12-25');
    expect(shift.effectiveDueDate).toBe('2026-12-28');
    expect(shift.shiftedFromNonWorkingDays).toHaveLength(3);
  });

  it('distinguishes ZUS DRA due date: 15th for sp. z o.o. vs 20th for JDG, and detects KSeF & e-Doręczenia milestones', () => {
    // Za lipiec 2026 r.: 15 sierpnia 2026 r. to sobota i Wniebowzięcie NMP -> dla sp. z o.o. przesunięcie na 2026-08-17!
    const spzooJuly = generateTaxCalendarObligations(
      {
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'monthly',
        zusApplicable: true,
      },
      '2026-07',
    );
    const zusSpzoo = spzooJuly.find((o) => o.code === 'ZUS_DRA_PAYMENT');
    expect(zusSpzoo?.statutoryDueDate).toBe('2026-08-15');
    expect(zusSpzoo?.effectiveDueDate).toBe('2026-08-17');

    // Dla JDG w październiku 2026 r. z mikro-sprzedażą <= 10 000 zł brutto: wykrywa e-Doręczenia CEIDG oraz wyłączenie przejściowe KSeF!
    const jdgOct2026 = generateTaxCalendarObligations(
      {
        profileCode: 'jdg_kpir_skala',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'monthly',
        zusApplicable: true,
        monthlyB2bGrossSalesGrosze: 800_000, // 8 000,00 zł <= 10 000,00 zł
        ceidgRegisteredBefore2025: true,
      },
      '2026-10',
    );

    const zusJdg = jdgOct2026.find((o) => o.code === 'ZUS_DRA_PAYMENT');
    expect(zusJdg?.statutoryDueDate).toBe('2026-11-20');

    const ksefObl = jdgOct2026.find((o) => o.code === 'KSEF_COMPLIANCE_2026');
    expect(ksefObl?.status).toBe('exempt_transitional');

    const edorObl = jdgOct2026.find((o) => o.code === 'EDORECZENIA_CEIDG_MANDATORY');
    expect(edorObl?.statutoryDueDate).toBe('2026-10-01');
  });
});

describe('bank-reconciliation — Polish CSV & MT940 parsers and deterministic invoice matching', () => {
  it('parses Polish semicolon-separated bank CSV with decimal commas and matches exact, partial, overpaid & ambiguous items', () => {
    const csv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-04-16;2026-04-16;"Klient Alfa Sp. z o.o.";PL61 1090 1014 0000 0712 1981 2874;"Zapłata za fakturę FV/2026/04/01";1 230,00;PLN;REF-001',
      '2026-04-17;2026-04-17;"Klient Beta";;"Zaliczka do FV/2026/04/02";500,00;PLN;REF-002',
      '2026-04-18;2026-04-18;"Klient Gamma";;"Opłata FV/2026/04/03";1 050,00;PLN;REF-003',
      '2026-04-19;2026-04-19;"Dostawca Chmury NIP 5261040828";;"Usługi serwerowe kwiecień";-615,00;PLN;REF-004',
      '2026-04-20;2026-04-20;"Klient Delta NIP 1234563218";;"Przelew zbiorczy";2 460,00;PLN;REF-005',
    ].join('\n');

    const txs = parsePolishBankCsv(csv);
    expect(txs).toHaveLength(5);
    expect(txs[0]?.amountGrosze).toBe(123_000);
    expect(txs[0]?.direction).toBe('credit');
    expect(txs[3]?.direction).toBe('debit');
    expect(txs[3]?.counterpartyNip).toBe('5261040828');

    const matches = reconcileBankTransactions(txs, [
      {
        documentId: 'doc-1',
        documentNumber: 'FV/2026/04/01',
        direction: 'sales',
        remainingAmountGrosze: 123_000,
      },
      {
        documentId: 'doc-2',
        documentNumber: 'FV/2026/04/02',
        direction: 'sales',
        remainingAmountGrosze: 150_000,
      },
      {
        documentId: 'doc-3',
        documentNumber: 'FV/2026/04/03',
        direction: 'sales',
        remainingAmountGrosze: 100_000,
      },
      {
        documentId: 'doc-4',
        documentNumber: 'FZ/CHMURA/04',
        direction: 'purchase',
        counterpartyNip: '5261040828',
        remainingAmountGrosze: 61_500,
      },
      // Dwie identyczne faktury dla tego samego NIP bez numeru w tytule -> musi zwrócić ambiguous_manual_review!
      {
        documentId: 'doc-5a',
        documentNumber: 'FV/2026/04/10',
        direction: 'sales',
        counterpartyNip: '1234563218',
        remainingAmountGrosze: 246_000,
      },
      {
        documentId: 'doc-5b',
        documentNumber: 'FV/2026/04/11',
        direction: 'sales',
        counterpartyNip: '1234563218',
        remainingAmountGrosze: 246_000,
      },
    ]);

    expect(matches[0]?.status).toBe('matched_exact');
    expect(matches[1]?.status).toBe('matched_partial');
    expect(matches[1]?.remainingDocumentAmountGrosze).toBe(100_000);
    expect(matches[2]?.status).toBe('overpaid');
    expect(matches[2]?.overpaymentGrosze).toBe(5_000);
    expect(matches[3]?.status).toBe('matched_exact');
    expect(matches[3]?.matchedCriterion).toBe('nip_or_iban_and_exact_amount');
    expect(matches[4]?.status).toBe('ambiguous_manual_review');
    expect(matches[4]?.candidateDocumentIds).toEqual(['doc-5a', 'doc-5b']);
  });

  it('parses MT940 statement (:60F:, :61:, structured :86:, :62F:) and rejects mismatched closing balance', () => {
    const mt940 = [
      ':20:STMT20260430',
      ':25:PL61109010140000071219812874',
      ':60F:C260401PLN10000,00',
      ':61:2604150415C2460,00NTRFNONREF//BANKREF1',
      ':86:020~20Faktura FV/2026/04/99~32 Alfa Tech Sp. z o.o.~38PL61109010140000071219812874',
      ':61:2604200420D460,00NTRFNONREF//BANKREF2',
      ':86:020~20Opłata ZUS~32Zakład Ubezpieczeń Społecznych',
      ':62F:C260430PLN12000,00',
      '-}',
    ].join('\n');

    const parsed = parseMt940Statement(mt940);
    expect(parsed.openingBalanceGrosze).toBe(1_000_000);
    expect(parsed.closingBalanceGrosze).toBe(1_200_000);
    expect(parsed.transactions).toHaveLength(2);
    expect(parsed.transactions[0]?.title).toContain('FV/2026/04/99');
    expect(parsed.transactions[0]?.counterpartyName).toBe('Alfa Tech Sp. z o.o.');
    expect(parsed.transactions[1]?.direction).toBe('debit');

    const corruptedMt940 = mt940.replace(':62F:C260430PLN12000,00', ':62F:C260430PLN99999,00');
    expect(() => parseMt940Statement(corruptedMt940)).toThrow(
      /Niezgodność kontrolna wyciągu MT940/,
    );
  });

  it('deducts paid social ZUS from ryczałt revenue before evaluating 60 000 zł / 300 000 zł health tiers (art. 81 ust. 2e u.ś.o.z., #66)', () => {
    // Przychód narastająco 63 000,00 zł, zapłacone składki społeczne ZUS 5 364,87 zł (3 * 1 788,29 zł):
    // 63 000,00 - 5 364,87 = 57 635,13 zł <= 60 000,00 zł -> pozostaje w I progu (498,35 zł w 2026 r.)!
    const withDeduction = calculateMonthlyZusContributions({
      period: '2026-04',
      zusScheme: 'duzy_zus',
      taxForm: 'ryczalt',
      voluntarySicknessInsurance: true,
      ytdRyczaltRevenueGrosze: 6_300_000,
      ytdDeductibleSocialZusGrosze: 536_487,
    });
    expect(withDeduction.ryczaltHealthTier).toBe(1);
    expect(withDeduction.healthContributionGrosze).toBe(49_835);
  });

  it('supports all three ZUS DRA statutory deadlines (5th, 15th, 20th day per art. 47 ust. 1 pkt 2, 3, 4 u.s.u.s.) and handles MT940 Dec/Jan year rollover (#66)', () => {
    const budgetZus = generateTaxCalendarObligations(
      {
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'zwolniony_przedmiotowo',
        vatSettlementPeriod: 'not_applicable',
        zusApplicable: true,
        zusPayerKind: 'budget_5th',
      },
      '2026-03',
    ).find((o) => o.code === 'ZUS_DRA_PAYMENT');
    expect(budgetZus?.statutoryDueDate).toBe('2026-04-05');
    expect(budgetZus?.effectiveDueDate).toBe('2026-04-07'); // 5 kwietnia 2026 to Wielkanoc, 6 kwietnia Poniedziałek Wielkanocny -> 7 kwietnia!

    const soleShareholderSpzooZus = generateTaxCalendarObligations(
      {
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'monthly',
        zusApplicable: true,
        zusPayerKind: 'other_20th',
      },
      '2026-03',
    ).find((o) => o.code === 'ZUS_DRA_PAYMENT');
    expect(soleShareholderSpzooZus?.statutoryDueDate).toBe('2026-04-20');

    // MT940 na przełomie roku: valueDate 251231 (2025-12-31) + entryDate 0102 -> bookingDate 2026-01-02;
    // oraz valueDate 260102 (2026-01-02) + entryDate 1231 -> bookingDate 2025-12-31
    const mt940YearBoundary = [
      ':20:STMT-BOUNDARY',
      ':25:PL61109010140000071219812874',
      ':60F:C251231PLN1000,00',
      ':61:2512310102C500,00NTRFNONREF//REF-DEC-JAN',
      ':86:020~20Wpłata sylwestrowa zaksięgowana w styczniu~32Klient A',
      ':61:2601021231D200,00NTRFNONREF//REF-JAN-DEC',
      ':86:020~20Obciążenie z grudnia z walutą styczniową~32Dostawca B',
      ':62F:C260102PLN1300,00',
      '-}',
    ].join('\n');

    const boundaryParsed = parseMt940Statement(mt940YearBoundary);
    expect(boundaryParsed.transactions[0]?.valueDate).toBe('2025-12-31');
    expect(boundaryParsed.transactions[0]?.bookingDate).toBe('2026-01-02');
    expect(boundaryParsed.transactions[1]?.valueDate).toBe('2026-01-02');
    expect(boundaryParsed.transactions[1]?.bookingDate).toBe('2025-12-31');
  });
});
