import { describe, expect, it } from 'vitest';
import {
  parseMt940Statement,
  parsePolishBankCsv,
  reconcileBankTransactions,
} from '../src/bank-reconciliation/index.js';
import {
  calculateKpirPitAdvance,
  createKpirEntry,
  getKpirColumnLayout,
  qualifyKpirExpense,
} from '../src/kpir/index.js';
import { resolveRuleAtDate } from '../src/legal-rules/index.js';
import { roundSignedTaxAmountPln } from '../src/money.js';
import {
  allocateDeductionProportionally,
  calculateMonthlyRyczalt,
  createRyczaltEntry,
} from '../src/ryczalt/index.js';
import {
  generateTaxCalendarObligations,
  shiftTaxDeadlineToBusinessDay,
} from '../src/tax-calendar/index.js';
import {
  calculateJpkV7mSummary,
  createVatRegisterEntry,
  evaluateVatExemptionLimit,
} from '../src/vat/index.js';
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
      expect(res.explanation.warnings.some((w) => w.code === 'PIT_FLAT_HEALTH_CAP_APPLIED')).toBe(
        true,
      );
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

  describe('Audit P1-1 — JPK_V7M signed TKwotaC fields P_38 & P_48 on in-minus corrections', () => {
    it('rounds signed tax amounts per art. 63 § 1 OP without producing -0', () => {
      const zeroFromNeg = roundSignedTaxAmountPln(-49);
      expect(zeroFromNeg.roundedFullPln).toBe(0);
      expect(zeroFromNeg.roundedGrosze).toBe(0);
      expect(Object.is(zeroFromNeg.roundedFullPln, -0)).toBe(false);
      expect(Object.is(zeroFromNeg.roundedGrosze, -0)).toBe(false);

      const negHalfUp = roundSignedTaxAmountPln(-50);
      expect(negHalfUp.roundedFullPln).toBe(-1);
      expect(negHalfUp.roundedGrosze).toBe(-100);

      const neg23050 = roundSignedTaxAmountPln(-23_050);
      expect(neg23050.roundedFullPln).toBe(-231);
      expect(neg23050.roundedGrosze).toBe(-23_100);
    });

    it('a) purchase correction -230,00 zł VAT with 0 zł sales and 0 zł other purchases -> P_38 = 0, P_48 = -230 zł (-23000 gr), P_51 = 230 zł (23000 gr) due to US', () => {
      const purchaseCorrection = createVatRegisterEntry({
        id: 'vat-kor-zak-1',
        registerType: 'purchase',
        period: '2026-07',
        taxPointDate: '2026-07-15',
        issueDate: '2026-07-15',
        documentNumber: 'FK/ZAK/2026/07/01',
        counterpartyName: 'Dostawca Sp. z o.o.',
        counterpartyNip: '5261040828',
        vatRate: '23',
        netGrosze: -100_000,
        vatTotalGrosze: -23_000,
        deductionMode: 'full_100',
        ksefReferenceNumber: '5261040828-20260715-KORZAK-01',
      });

      const summary = calculateJpkV7mSummary({
        period: '2026-07',
        entries: [purchaseCorrection],
      });

      expect(summary.outputVatRoundedPlnGrosze).toBe(0); // P_38 = 0
      expect(summary.totalInputVatPlnGrosze).toBe(-23_000); // P_48 = -230 zł (-23000 gr)
      expect(summary.taxDueToPayP51Grosze).toBe(23_000); // P_51 = 230 zł (23000 gr) do wpłaty!
      expect(summary.excessInputVatToCarryOverP53Grosze).toBe(0);
      expect(
        summary.explanation.warnings.some(
          (w) => w.code === 'JPK_V7M_SIGNED_NEGATIVE_CORRECTION_TKWOTAC',
        ),
      ).toBe(true);
    });

    it('b) sales correction -230,00 zł VAT with 0 zł other sales and 0 zł purchases -> P_38 = -230 zł (-23000 gr), P_48 = 0, P_53 = 230 zł (23000 gr) excess', () => {
      const salesCorrection = createVatRegisterEntry({
        id: 'vat-kor-sprz-1',
        registerType: 'sales',
        period: '2026-07',
        taxPointDate: '2026-07-20',
        issueDate: '2026-07-20',
        documentNumber: 'FK/SPRZ/2026/07/01',
        counterpartyName: 'Odbiorca Sp. z o.o.',
        counterpartyNip: '5261040828',
        vatRate: '23',
        netGrosze: -100_000,
        vatTotalGrosze: -23_000,
        ksefReferenceNumber: '5261040828-20260720-KORSPRZ-01',
      });

      const summary = calculateJpkV7mSummary({
        period: '2026-07',
        entries: [salesCorrection],
      });

      expect(summary.outputVatRoundedPlnGrosze).toBe(-23_000); // P_38 = -230 zł (-23000 gr)
      expect(summary.totalInputVatPlnGrosze).toBe(0); // P_48 = 0
      expect(summary.taxDueToPayP51Grosze).toBe(0);
      expect(summary.excessInputVatToCarryOverP53Grosze).toBe(23_000); // P_53 = 230 zł (23000 gr) nadwyżki!
    });

    it('returns P_51 = 0 and P_53 = 0 when signed P_38 and P_48 cancel out to netDiff === 0', () => {
      const salesCorrection = createVatRegisterEntry({
        id: 'vat-kor-s-eq',
        registerType: 'sales',
        period: '2026-08',
        taxPointDate: '2026-08-10',
        issueDate: '2026-08-10',
        documentNumber: 'FK/S/1',
        counterpartyName: 'Klient',
        vatRate: '23',
        netGrosze: -100_000,
        vatTotalGrosze: -23_000,
        ksefMarker: 'BFK',
      });
      const purchaseCorrection = createVatRegisterEntry({
        id: 'vat-kor-p-eq',
        registerType: 'purchase',
        period: '2026-08',
        taxPointDate: '2026-08-11',
        issueDate: '2026-08-11',
        documentNumber: 'FK/P/1',
        counterpartyName: 'Dostawca',
        vatRate: '23',
        netGrosze: -100_000,
        vatTotalGrosze: -23_000,
        ksefMarker: 'BFK',
      });

      const summary = calculateJpkV7mSummary({
        period: '2026-08',
        entries: [salesCorrection, purchaseCorrection],
      });

      expect(summary.outputVatRoundedPlnGrosze).toBe(-23_000);
      expect(summary.totalInputVatPlnGrosze).toBe(-23_000);
      expect(summary.taxDueToPayP51Grosze).toBe(0);
      expect(summary.excessInputVatToCarryOverP53Grosze).toBe(0);
    });
  });

  describe('Audit P1-2 & P2-2 — Ryczałt negative rate bucket carry-forward (art. 6 ust. 1c) & iterative largest-remainder cap', () => {
    it('preserves negative correction bucket for carry-forward (art. 6 ust. 1c), sets requiresHumanApproval=true, and allocates ZUS only across positive buckets', () => {
      const entries = [
        createRyczaltEntry({
          id: 'r-12-pos',
          ordinalNumber: 1,
          entryDate: '2026-07-05',
          revenueDate: '2026-07-05',
          documentNumber: 'FV/2026/07/01',
          counterpartyName: 'Klient IT',
          rate: '12',
          revenueGrosze: 100_000, // +1 000,00 zł
        }),
        createRyczaltEntry({
          id: 'r-12-kor',
          ordinalNumber: 2,
          entryDate: '2026-07-12',
          revenueDate: '2026-07-12',
          documentNumber: 'FK/2026/07/01',
          counterpartyName: 'Klient IT',
          rate: '12',
          revenueGrosze: -350_000, // -3 500,00 zł korekta in minus -> saldo stawki 12% = -2 500,00 zł!
          isCorrection: true,
          correctedEntryId: 'r-prev-month',
          correctionReason: 'Rabat potransakcyjny za II kwartał',
        }),
        createRyczaltEntry({
          id: 'r-85-pos',
          ordinalNumber: 3,
          entryDate: '2026-07-20',
          revenueDate: '2026-07-20',
          documentNumber: 'FV/2026/07/02',
          counterpartyName: 'Klient Usługi',
          rate: '8.5',
          revenueGrosze: 200_000, // +2 000,00 zł w stawce 8,5%
        }),
      ];

      const res = calculateMonthlyRyczalt({
        period: '2026-07',
        entries,
        paidSocialZusInMonthGrosze: 50_000, // 500,00 zł
        paidHealthInsuranceInMonthGrosze: 40_000, // 50% = 200,00 zł (20 000 gr)
      });

      expect(res.totalNetRevenueGrosze).toBe(-50_000); // -500,00 zł algebraicznie
      expect(res.totalPositiveBucketRevenueGrosze).toBe(200_000); // +2 000,00 zł dodatnich koszyków
      expect(res.unappliedNegativeCorrectionGrosze).toBe(250_000); // 2 500,00 zł do przeniesienia na kolejne okresy!
      expect(res.explanation.requiresHumanApproval).toBe(true);
      expect(
        res.explanation.warnings.some(
          (w) => w.code === 'RYCZALT_NEGATIVE_CORRECTION_CARRY_FORWARD_ART_6_1C',
        ),
      ).toBe(true);

      const bucket12 = res.breakdownByRate.find((b) => b.rate === '12');
      expect(bucket12?.rawNetRevenueGrosze).toBe(-250_000);
      expect(bucket12?.taxableRevenueInPeriodGrosze).toBe(0);
      expect(bucket12?.carryForwardNegativeRevenueGrosze).toBe(250_000);
      expect(bucket12?.allocatedSocialDeductionGrosze).toBe(0);
      expect(bucket12?.allocatedHealthDeductionGrosze).toBe(0);

      const bucket85 = res.breakdownByRate.find((b) => b.rate === '8.5');
      expect(bucket85?.allocatedSocialDeductionGrosze).toBe(50_000);
      expect(bucket85?.allocatedHealthDeductionGrosze).toBe(20_000);
      expect(bucket85?.revenueAfterDeductionsGrosze).toBe(130_000); // 1 300,00 zł * 8,5% = 110,50 zł -> 111 zł (11 100 gr)
      expect(res.taxDueGrosze).toBe(11_100);
    });

    it('allocates exact 20 gr across [7, 7, 7, 1] gr without losing 1 gr on tiny last bucket (P2-2)', () => {
      const alloc = allocateDeductionProportionally(
        20,
        [
          { rate: '17', revenueGrosze: 7 },
          { rate: '15', revenueGrosze: 7 },
          { rate: '12', revenueGrosze: 7 },
          { rate: '8.5', revenueGrosze: 1 },
        ],
        22,
      );

      const values = [
        alloc.get('17') ?? 0,
        alloc.get('15') ?? 0,
        alloc.get('12') ?? 0,
        alloc.get('8.5') ?? 0,
      ];
      const sumAllocated = values.reduce((a, b) => a + b, 0);

      expect(sumAllocated).toBe(20);
      expect(alloc.get('17')).toBeLessThanOrEqual(7);
      expect(alloc.get('15')).toBeLessThanOrEqual(7);
      expect(alloc.get('12')).toBeLessThanOrEqual(7);
      expect(alloc.get('8.5')).toBeLessThanOrEqual(1);
    });
  });

  describe('Audit P2-1, P2-3 & P2-4 — PKPiR 2026 19-column layout, deductibleVat validation & registry citations', () => {
    it('maps 17 columns for pkpir_2019_17col and 19 columns (col. 3 KSeF, col. 5 NIP, col. 9..19) for pkpir_2026_ksef in explanation steps', () => {
      const layout2019 = getKpirColumnLayout('pkpir_2019');
      expect(layout2019.totalColumns).toBe(17);
      expect(layout2019.salesRevenueCol).toBe(7);
      expect(layout2019.totalRevenueCol).toBe(9);
      expect(layout2019.otherExpensesCol).toBe(13);
      expect(layout2019.totalExpensesCol).toBe(14);
      expect(layout2019.researchDevelopmentCol).toBe(16);
      expect(layout2019.remarksCol).toBe(17);

      const layout2026 = getKpirColumnLayout('pkpir_2026_ksef');
      expect(layout2026.totalColumns).toBe(19);
      expect(layout2026.ksefReferenceCol).toBe(3);
      expect(layout2026.counterpartyNipCol).toBe(5);
      expect(layout2026.salesRevenueCol).toBe(9);
      expect(layout2026.otherRevenueCol).toBe(10);
      expect(layout2026.totalRevenueCol).toBe(11);
      expect(layout2026.goodsAndMaterialsCol).toBe(12);
      expect(layout2026.incidentalCostsCol).toBe(13);
      expect(layout2026.remunerationCol).toBe(14);
      expect(layout2026.otherExpensesCol).toBe(15);
      expect(layout2026.totalExpensesCol).toBe(16);
      expect(layout2026.researchDevelopmentCol).toBe(18);
      expect(layout2026.remarksCol).toBe(19);

      const entry2026 = createKpirEntry({
        id: 'kpir-2026-19col',
        ordinalNumber: 1,
        eventDate: '2026-04-10',
        documentNumber: 'FV/2026/04/99',
        ksefReferenceNumber: '5261040828-20260410-ABCDEF-99',
        counterpartyName: 'Kontrahent KSeF',
        counterpartyNip: '5261040828',
        counterpartyAddress: 'ul. Prosta 10, Warszawa',
        eventDescription: 'Usługa doradcza',
        col7SalesRevenueGrosze: 500_000,
      });
      expect(entry2026.explanation.steps[0]?.label).toContain(
        'kolumna 11 = kolumna 9 + kolumna 10',
      );
      expect(entry2026.explanation.steps[1]?.label).toContain(
        'kolumna 16 = kolumna 14 + kolumna 15',
      );

      const exp2026 = qualifyKpirExpense({
        eventDate: '2026-04-10',
        qualificationKind: 'other_expenses_100_col13',
        netGrosze: 10_000,
        vatGrosze: 2_300,
        taxpayerVatActive: true,
      });
      expect(exp2026.explanation.steps[1]?.label).toContain('kolumnie 15 PKPiR');
    });

    it('rejects negative or out-of-bounds deductibleVatGrosze in qualifyKpirExpense (P2-3)', () => {
      expect(() =>
        qualifyKpirExpense({
          eventDate: '2026-05-10',
          qualificationKind: 'other_expenses_100_col13',
          netGrosze: 20_000,
          vatGrosze: 4_600,
          taxpayerVatActive: true,
          deductibleVatGrosze: -100,
        }),
      ).toThrow(/nie może być ujemna/);

      expect(() =>
        qualifyKpirExpense({
          eventDate: '2026-05-10',
          qualificationKind: 'other_expenses_100_col13',
          netGrosze: 20_000,
          vatGrosze: 4_600,
          taxpayerVatActive: true,
          deductibleVatGrosze: 5_000,
        }),
      ).toThrow(/nie może przekraczać kwoty VAT/);

      expect(() =>
        qualifyKpirExpense({
          eventDate: '2026-05-10',
          qualificationKind: 'other_expenses_100_col13',
          netGrosze: -20_000,
          vatGrosze: -4_600,
          taxpayerVatActive: true,
          deductibleVatGrosze: 2_300,
        }),
      ).toThrow(/Niezgodny znak/);
    });

    it('includes consolidated UoR journal citation and exact unrounded ryczałt 2M EUR parameter in registry (P2-4)', () => {
      const uorRule = resolveRuleAtDate('UOR_DOUBLE_ENTRY_AND_BALANCE', '2026-06-01');
      expect(uorRule.legalBasis.journalReference).toContain('Dz.U. z 2023 r. poz. 120');

      const smallTaxpayer2026 = resolveRuleAtDate('SMALL_TAXPAYER_LIMIT_2M_EUR', '2026-06-01');
      expect(smallTaxpayer2026.parameters?.['ryczaltExactLimitNetGrosze']).toBe(851_720_000);
      const smallTaxpayer2025 = resolveRuleAtDate('SMALL_TAXPAYER_LIMIT_2M_EUR', '2025-06-01');
      expect(smallTaxpayer2025.parameters?.['ryczaltExactLimitNetGrosze']).toBe(856_920_000);
    });
  });
});
