import { describe, expect, it } from 'vitest';
import {
  parseMt940Statement,
  parsePolishBankCsv,
  reconcileBankTransactions,
} from '../src/bank-reconciliation/index.js';
import {
  calculateKpirPitAdvance,
  qualifyKpirExpense,
} from '../src/kpir/index.js';
import {
  calculateMonthlyRyczalt,
  createRyczaltEntry,
} from '../src/ryczalt/index.js';
import {
  generateTaxCalendarObligations,
  shiftTaxDeadlineToBusinessDay,
} from '../src/tax-calendar/index.js';
import { evaluateVatExemptionLimit } from '../src/vat/index.js';
import { calculateMonthlyZusContributions } from '../src/zus/index.js';

describe('reference edge-cases matrix — 2025/2026 boundaries, 1-grosz conservation & statutory shifts', () => {
  describe('PIT scale & flat tax exact PLN boundaries (art. 27, art. 30c, art. 63 § 1 OP)', () => {
    it.each([
      // Wokół kwoty wolnej 30 000 zł (podatek przed zaokr. = podstawa * 12% - 3 600 zł):
      // 30 000 zł * 12% = 3 600,00 zł -> 0,00 zł -> 0 zł
      { baseGrosze: 3_000_000, expectedBasePln: 30_000, expectedAdvanceGrosze: 0 },
      // 30 004 zł * 12% = 3 600,48 zł - 3 600 zł = 0,48 zł (< 50 gr!) -> po zaokr. art. 63 § 1 = 0 zł!
      { baseGrosze: 3_000_400, expectedBasePln: 30_004, expectedAdvanceGrosze: 0 },
      // 30 005 zł * 12% = 3 600,60 zł - 3 600 zł = 0,60 zł (>= 50 gr!) -> po zaokr. art. 63 § 1 = 1 zł (100 gr)!
      { baseGrosze: 3_000_500, expectedBasePln: 30_005, expectedAdvanceGrosze: 100 },
      // Dokładnie na progu 120 000 zł: 120 000 zł * 12% - 3 600 zł = 10 800,00 zł (1 080 000 gr)
      { baseGrosze: 12_000_000, expectedBasePln: 120_000, expectedAdvanceGrosze: 1_080_000 },
      // 1 zł ponad próg (120 001 zł): 10 800 zł + 1 zł * 32% = 10 800,32 zł -> po zaokr. 10 800 zł (1 080 000 gr)
      { baseGrosze: 12_000_100, expectedBasePln: 120_001, expectedAdvanceGrosze: 1_080_000 },
      // 2 zł ponad próg (120 002 zł): 10 800 zł + 2 zł * 32% = 10 800,64 zł -> po zaokr. 10 801 zł (1 080 100 gr)
      { baseGrosze: 12_000_200, expectedBasePln: 120_002, expectedAdvanceGrosze: 1_080_100 },
    ])(
      'computes exact PIT scale advance for taxable base $baseGrosze gr -> $expectedAdvanceGrosze gr',
      ({ baseGrosze, expectedBasePln, expectedAdvanceGrosze }) => {
        const res = calculateKpirPitAdvance({
          period: '2026-06',
          taxForm: 'skala',
          ytdRevenueGrosze: baseGrosze,
          ytdCostsGrosze: 0,
        });

        expect(res.roundedTaxBaseFullPln).toBe(expectedBasePln);
        expect(res.advanceDueGrosze).toBe(expectedAdvanceGrosze);
        expect(res.explanation.steps.length).toBeGreaterThanOrEqual(4);
      },
    );

    it('shares annual 14 100 zł flat-tax health cap between KUP-booked health and income deduction + applies prior-year loss', () => {
      // Dochód = 150 000 zł; w KUP ujęto już 10 000 zł składki zdrowotnej; dodatkowo zapłacono 8 000 zł do odliczenia od dochodu.
      // Pozostały limit 2026 = 14 100 - 10 000 = 4 100 zł! Strata z lat ubiegłych = 5 900 zł.
      // Podstawa = 150 000 - 4 100 - 5 900 = 140 000 zł * 19% = 26 600 zł (2 660 000 gr).
      const res = calculateKpirPitAdvance({
        period: '2026-09',
        taxForm: 'liniowy',
        ytdRevenueGrosze: 20_000_000,
        ytdCostsGrosze: 5_000_000,
        healthAlreadyIncludedInKupYtdGrosze: 1_000_000,
        paidHealthInsuranceYtdGrosze: 800_000,
        priorYearsLossDeductionGrosze: 590_000,
      });

      expect(res.effectiveHealthDeductionFromIncomeGrosze).toBe(410_000);
      expect(res.roundedTaxBaseFullPln).toBe(140_000);
      expect(res.advanceDueGrosze).toBe(2_660_000);
      expect(
        res.explanation.warnings.some((w) => w.code === 'PIT_FLAT_HEALTH_CAP_APPLIED'),
      ).toBe(true);
    });

    it('routes KPiR columns 11 (incidental purchase costs), 12 (remuneration) and 16 (R&D)', () => {
      const col11 = qualifyKpirExpense({
        eventDate: '2026-02-10',
        qualificationKind: 'incidental_purchase_costs_col11',
        netGrosze: 15_000,
        vatGrosze: 3_450,
        taxpayerVatActive: true,
      });
      expect(col11.col11IncidentalCostsGrosze).toBe(15_000);

      const col12 = qualifyKpirExpense({
        eventDate: '2026-02-28',
        qualificationKind: 'remuneration_col12',
        netGrosze: 800_000,
        vatGrosze: 0,
        taxpayerVatActive: true,
      });
      expect(col12.col12RemunerationGrosze).toBe(800_000);

      const col16 = qualifyKpirExpense({
        eventDate: '2026-03-15',
        qualificationKind: 'research_development_col16',
        netGrosze: 450_000,
        vatGrosze: 103_500,
        taxpayerVatActive: true,
      });
      expect(col16.col16ResearchDevelopmentCostGrosze).toBe(450_000);
    });
  });

  describe('ZUS contribution-year Feb 1 boundary & age/sickness variants', () => {
    it.each([
      // Styczeń 2025 należy do roku składkowego 2024 -> min. 381,78 zł (38 178 gr)
      { period: '2025-01', expectedMinHealthGrosze: 38_178 },
      // Luty 2025 otwiera rok składkowy 2025 (75% z 4 666 zł) -> min. 314,96 zł (31 496 gr)
      { period: '2025-02', expectedMinHealthGrosze: 31_496 },
      // Styczeń 2026 kończy rok składkowy 2025 -> nadal min. 314,96 zł (31 496 gr)!
      { period: '2026-01', expectedMinHealthGrosze: 31_496 },
      // Luty 2026 otwiera rok składkowy 2026 (100% z 4 806 zł) -> min. 432,54 zł (43 254 gr)!
      { period: '2026-02', expectedMinHealthGrosze: 43_254 },
    ])(
      'resolves minimum health contribution across Feb 1 contribution-year boundary for $period -> $expectedMinHealthGrosze gr',
      ({ period, expectedMinHealthGrosze }) => {
        const res = calculateMonthlyZusContributions({
          period,
          zusScheme: 'ulga_na_start',
          taxForm: 'skala',
          voluntarySicknessInsurance: false,
          previousMonthIncomeGrosze: -50_000, // strata w poprzednim miesiącu
        });

        expect(res.healthContributionGrosze).toBe(expectedMinHealthGrosze);
      },
    );

    it('omits sickness contribution when voluntarySicknessInsurance=false and omits FP when exemptFromLaborFundByAge=true', () => {
      // Duży ZUS 2026 podstawa 5 652,00 zł (565 200 gr):
      // emerytalna 19,52% = 110 327 gr, rentowa 8% = 45 216 gr, chorobowa = 0 gr, wypadkowa 1,67% = 9 439 gr
      // Razem społeczne bez chorobowego = 164 982 gr (1 649,82 zł); FP zwolniony wiekowo = 0 gr!
      const res = calculateMonthlyZusContributions({
        period: '2026-05',
        zusScheme: 'duzy_zus',
        taxForm: 'skala',
        voluntarySicknessInsurance: false,
        exemptFromLaborFundByAge: true,
        previousMonthIncomeGrosze: 1_000_000, // 900,00 zł zdrowotnej
      });

      expect(res.sicknessContributionGrosze).toBe(0);
      expect(res.socialContributionsTotalGrosze).toBe(164_982);
      expect(res.laborAndSolidarityFundGrosze).toBe(0);
      expect(res.totalZusToPayGrosze).toBe(254_982);
    });
  });

  describe('VAT art. 113 ust. 9 extreme first-day and last-day proportional limits', () => {
    it('grants full 240 000,00 zł limit when starting business on January 1, 2026 (365/365 days)', () => {
      const res = evaluateVatExemptionLimit({
        eventDate: '2026-01-15',
        activityStartDate: '2026-01-01',
        cumulativeNetSalesBeforeGrosze: 1_000_000,
      });

      expect(res.activeDaysInYear).toBe(365);
      expect(res.proportionalLimitGrosze).toBe(24_000_000);
    });

    it('grants exact 1-day proportional limit on December 31, 2026 (240 000 zł * 1 / 365 = 657,53 zł)', () => {
      // 24 000 000 gr / 365 = 65 753,4246... gr -> half-up = 65 753 gr (657,53 zł)
      const res = evaluateVatExemptionLimit({
        eventDate: '2026-12-31',
        activityStartDate: '2026-12-31',
        cumulativeNetSalesBeforeGrosze: 0,
        currentTransactionNetGrosze: 65_753,
      });

      expect(res.activeDaysInYear).toBe(1);
      expect(res.proportionalLimitGrosze).toBe(65_753);
      expect(res.status).toBe('exempt_within_limit');
    });
  });

  describe('Ryczałt 3-rate 1-grosz conservation of proportional deductions (art. 11 ust. 2)', () => {
    it('conserves exact grosz totals across 3 uneven revenue rates without rounding drift', () => {
      const entries = [
        createRyczaltEntry({
          id: 'r-17',
          ordinalNumber: 1,
          entryDate: '2026-06-10',
          revenueDate: '2026-06-10',
          documentNumber: 'FV/1',
          counterpartyName: 'Klient 1',
          rate: '17',
          revenueGrosze: 333_333,
        }),
        createRyczaltEntry({
          id: 'r-12',
          ordinalNumber: 2,
          entryDate: '2026-06-15',
          revenueDate: '2026-06-15',
          documentNumber: 'FV/2',
          counterpartyName: 'Klient 2',
          rate: '12',
          revenueGrosze: 333_333,
        }),
        createRyczaltEntry({
          id: 'r-55',
          ordinalNumber: 3,
          entryDate: '2026-06-20',
          revenueDate: '2026-06-20',
          documentNumber: 'FV/3',
          counterpartyName: 'Klient 3',
          rate: '5.5',
          revenueGrosze: 333_334,
        }),
      ];

      const socialPaid = 178_829;
      const healthPaid = 83_058; // 50% = 41 529 gr

      const res = calculateMonthlyRyczalt({
        period: '2026-06',
        entries,
        paidSocialZusInMonthGrosze: socialPaid,
        paidHealthInsuranceInMonthGrosze: healthPaid,
      });

      const sumSocialAllocated = res.breakdownByRate.reduce(
        (acc, r) => acc + r.allocatedSocialDeductionGrosze,
        0,
      );
      const sumHealthAllocated = res.breakdownByRate.reduce(
        (acc, r) => acc + r.allocatedHealthDeductionGrosze,
        0,
      );

      expect(sumSocialAllocated).toBe(socialPaid);
      expect(sumHealthAllocated).toBe(41_529);
    });
  });

  describe('Tax calendar statutory holiday shifts, December due dates & KSeF/JPK_PD waves', () => {
    it.each([
      // 2026-06-04 to czwartek Boże Ciało -> przesuwa się na piątek 2026-06-05
      { statutory: '2026-06-04', expectedEffective: '2026-06-05' },
      // 2026-11-11 to środa Narodowe Święto Niepodległości -> czwartek 2026-11-12
      { statutory: '2026-11-11', expectedEffective: '2026-11-12' },
      // 2026-05-01 (piątek Święto Pracy) -> sobota 02.05 -> niedziela 03.05 -> poniedziałek 2026-05-04
      { statutory: '2026-05-01', expectedEffective: '2026-05-04' },
      // 2026-12-24 (czwartek Wigilia wolna od 2025 r.) -> 25.12 -> 26.12 -> 27.12 (nd) -> poniedziałek 2026-12-28!
      { statutory: '2026-12-24', expectedEffective: '2026-12-28' },
    ])(
      'shifts Polish statutory holiday $statutory to next business day $expectedEffective',
      ({ statutory, expectedEffective }) => {
        const res = shiftTaxDeadlineToBusinessDay(statutory);
        expect(res.wasShifted).toBe(true);
        expect(res.effectiveDueDate).toBe(expectedEffective);
      },
    );

    it('sets December 2025 Ryczałt due date to January 20, 2026 (art. 21 ust. 1) and flags February 2026 KSeF wave for >200M PLN taxpayers', () => {
      const decRyczalt = generateTaxCalendarObligations(
        {
          profileCode: 'jdg_ryczalt',
          vatStatus: 'zwolniony_art_113',
          vatSettlementPeriod: 'not_applicable',
          zusApplicable: true,
        },
        '2025-12',
      );
      const ppeObl = decRyczalt.find((o) => o.code === 'RYCZALT_PPE_PAYMENT');
      expect(ppeObl?.statutoryDueDate).toBe('2026-01-20');
      expect(ppeObl?.effectiveDueDate).toBe('2026-01-20');

      const largeSpzooFeb2026 = generateTaxCalendarObligations(
        {
          profileCode: 'spzoo_pelne_ksiegi',
          vatStatus: 'czynny',
          vatSettlementPeriod: 'monthly',
          zusApplicable: true,
          ksefSales2024Above200M: true,
          krsRegisteredBefore2025: true,
        },
        '2026-02',
      );
      const ksefLarge = largeSpzooFeb2026.find((o) => o.code === 'KSEF_COMPLIANCE_2026');
      expect(ksefLarge?.status).toBe('applicable');
      expect(ksefLarge?.statutoryDueDate).toBe('2026-02-01');
    });
  });

  describe('Bank reconciliation — MT940 RC/RD reversals & headerless CSV sequential partial settlements', () => {
    it('handles MT940 RC (Reversal Credit = debit) mark accurately in closing balance verification', () => {
      const mt940Reversal = [
        ':20:STMT-REV-1',
        ':25:PL61109010140000071219812874',
        ':60F:C260501PLN5000,00',
        ':61:2605050505RC1000,00NTRFNONREF//REV1',
        ':86:Korekta błędnego uznania',
        ':62F:C260531PLN4000,00',
      ].join('\n');

      const parsed = parseMt940Statement(mt940Reversal);
      expect(parsed.transactions).toHaveLength(1);
      expect(parsed.transactions[0]?.direction).toBe('debit');
      expect(parsed.transactions[0]?.amountGrosze).toBe(100_000);
      expect(parsed.closingBalanceGrosze).toBe(400_000);
    });

    it('reconciles two sequential partial transfers settling the same invoice to exact 0 grosze remaining', () => {
      const headerlessCsv = [
        '2026-05-10;2026-05-10;Alfa Sp. z o.o.;PL61109010140000071219812874;I rata za FV/2026/05/77;600,00;PLN;RATA-1',
        '2026-05-20;2026-05-20;Alfa Sp. z o.o.;PL61109010140000071219812874;Dopłata końcowa FV/2026/05/77;630,00;PLN;RATA-2',
      ].join('\n');

      const txs = parsePolishBankCsv(headerlessCsv);
      const matches = reconcileBankTransactions(txs, [
        {
          documentId: 'inv-77',
          documentNumber: 'FV/2026/05/77',
          direction: 'sales',
          remainingAmountGrosze: 123_000, // 1 230,00 zł
        },
      ]);

      expect(matches[0]?.status).toBe('matched_partial');
      expect(matches[0]?.remainingDocumentAmountGrosze).toBe(63_000);
      expect(matches[1]?.status).toBe('matched_exact');
      expect(matches[1]?.remainingDocumentAmountGrosze).toBe(0);
    });
  });
});
