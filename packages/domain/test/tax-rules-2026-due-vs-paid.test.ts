import { describe, expect, it } from 'vitest';

import {
  CitPreferentialEligibilityError,
  KSEF_FA2_NAMESPACE,
  KSEF_FA3_NAMESPACE,
  buildSyntheticTestKsefNumber,
  calculateProfileAKpirObligations,
  calculateProfileBRyczaltObligations,
  calculateProfileCCitObligations,
  createRyczaltEntry,
  generateKsefFaXml,
  validateKsefNumber,
} from '../src/index.js';

describe('2026 Deterministic Tax Calculators — Accrued/Due vs Paid (#81)', () => {
  describe('Profile A: JDG KPiR (Skala 12%/32% + 30k free amount, Liniowy 19% + 14.1k health cap)', () => {
    it('excludes unpaid accrued ZUS from PIT base in binding mode and deducts only verified paid ZUS', () => {
      const unpaidResult = calculateProfileAKpirObligations({
        period: '2026-03',
        taxForm: 'skala',
        zusScheme: 'duzy_zus',
        voluntarySicknessInsurance: true,
        previousMonthIncomeForHealthGrosze: 1_500_000, // 15 000.00 PLN
        ytdRevenueGrosze: 5_000_000, // 50 000.00 PLN
        ytdCostsGrosze: 1_000_000, // 10 000.00 PLN
        verifiedPayments: [],
      });

      expect(unpaidResult.profileCode).toBe('jdg_kpir_skala');
      expect(unpaidResult.bindingForDeclaration).toBe(true);
      expect(unpaidResult.isSimulationOnly).toBe(false);
      expect(unpaidResult.confirmedPaidSocialZusInTaxYearYtdGrosze).toBe(0);
      expect(unpaidResult.unpaidAccruedZusExcludedFromDeductionGrosze).toBe(
        unpaidResult.accruedZus.socialContributionsTotalGrosze,
      );
      // Income = 40 000 PLN; Skala 12% * 40 000 - 3 600 = 1 200 PLN = 120 000 grosze
      expect(unpaidResult.pitAdvanceAccruedDueGrosze).toBe(120_000);
      expect(unpaidResult.zusSettlements.social.confirmedPaidGrosze).toBe(0);
      expect(unpaidResult.zusSettlements.social.remainingUnpaidGrosze).toBe(
        unpaidResult.accruedZus.socialContributionsTotalGrosze,
      );

      const paidSocialAmount = unpaidResult.accruedZus.socialContributionsTotalGrosze;
      const paidResult = calculateProfileAKpirObligations({
        period: '2026-03',
        taxForm: 'skala',
        zusScheme: 'duzy_zus',
        voluntarySicknessInsurance: true,
        previousMonthIncomeForHealthGrosze: 1_500_000,
        ytdRevenueGrosze: 5_000_000,
        ytdCostsGrosze: 1_000_000,
        verifiedPayments: [
          {
            paymentId: 'pay-zus-social-2026-02',
            obligationKind: 'zus_social',
            targetPeriod: '2026-02',
            paidDate: '2026-03-18',
            amountGrosze: paidSocialAmount,
            bankTransactionId: 'BANK-TX-20260318-01',
          },
        ],
      });

      expect(paidResult.confirmedPaidSocialZusInTaxYearYtdGrosze).toBe(paidSocialAmount);
      expect(paidResult.pitAdvanceAccruedDueGrosze).toBeLessThan(
        unpaidResult.pitAdvanceAccruedDueGrosze,
      );
    });

    it('enforces 2026 minimum health contribution (432.54 PLN on 4 806 PLN minimum wage from Feb 2026) and 32% bracket above 120k PLN', () => {
      const result = calculateProfileAKpirObligations({
        period: '2026-06',
        taxForm: 'skala',
        zusScheme: 'ulga_na_start',
        voluntarySicknessInsurance: false,
        previousMonthIncomeForHealthGrosze: 100_000, // 1 000 PLN -> below minimum wage 4 806 PLN
        ytdRevenueGrosze: 22_000_000, // 220 000 PLN
        ytdCostsGrosze: 2_000_000, // 20 000 PLN -> 200 000 PLN taxable income
        verifiedPayments: [],
      });

      // 9% * 4 806.00 PLN = 432.54 PLN = 43 254 grosze
      expect(result.accruedZus.healthContributionGrosze).toBe(43_254);
      // Skala on 200 000 PLN: 10 800 PLN + 32% * (200 000 - 120 000) = 10 800 + 25 600 = 36 400 PLN = 3 640 000 grosze
      expect(result.pitAdvanceAccruedDueGrosze).toBe(3_640_000);
    });

    it('caps paid health insurance deduction at 14 100 PLN (1 410 000 grosze) for Liniowy 19% in 2026', () => {
      const result = calculateProfileAKpirObligations({
        period: '2026-10',
        taxForm: 'liniowy',
        zusScheme: 'duzy_zus',
        voluntarySicknessInsurance: false,
        previousMonthIncomeForHealthGrosze: 4_000_000,
        ytdRevenueGrosze: 50_000_000, // 500 000 PLN
        ytdCostsGrosze: 10_000_000, // 100 000 PLN -> 400 000 PLN income before ZUS
        verifiedPayments: [
          {
            paymentId: 'pay-health-over-cap',
            obligationKind: 'zus_health',
            targetPeriod: '2026-09',
            paidDate: '2026-10-15',
            amountGrosze: 2_000_000, // 20 000 PLN paid health -> capped at 14 100 PLN!
            bankTransactionId: 'BANK-TX-HEALTH-CAP',
          },
        ],
      });

      expect(result.profileCode).toBe('jdg_kpir_liniowy');
      // 400 000 - 14 100 = 385 900 PLN * 19% = 73 321 PLN = 7 332 100 grosze
      expect(result.pitAdvanceAccruedDueGrosze).toBe(7_332_100);
    });

    it('marks what_if_simulation as non-binding for statutory declarations and rejects unverified payment records without bankTransactionId', () => {
      const sim = calculateProfileAKpirObligations({
        period: '2026-04',
        taxForm: 'skala',
        zusScheme: 'preferencyjny_zus',
        voluntarySicknessInsurance: true,
        previousMonthIncomeForHealthGrosze: 800_000,
        ytdRevenueGrosze: 6_000_000,
        ytdCostsGrosze: 1_000_000,
        verifiedPayments: [],
        mode: 'what_if_simulation',
        simulatedPaidSocialZusYtdGrosze: 200_000,
      });

      expect(sim.isSimulationOnly).toBe(true);
      expect(sim.bindingForDeclaration).toBe(false);
      expect(sim.explanation.warnings.length).toBeGreaterThan(0);

      expect(() =>
        calculateProfileAKpirObligations({
          period: '2026-04',
          taxForm: 'skala',
          zusScheme: 'duzy_zus',
          voluntarySicknessInsurance: false,
          previousMonthIncomeForHealthGrosze: 800_000,
          ytdRevenueGrosze: 5_000_000,
          ytdCostsGrosze: 1_000_000,
          verifiedPayments: [
            {
              paymentId: 'bad-pay',
              obligationKind: 'zus_social',
              targetPeriod: '2026-03',
              paidDate: '2026-04-10',
              amountGrosze: 100_000,
              bankTransactionId: '   ',
            },
          ],
        }),
      ).toThrow();
    });
  });

  describe('Profile B: JDG Ryczałt (multi-rate buckets + paid ZUS + 50% paid health)', () => {
    it('deducts zero when ZUS is unpaid and proportionally deducts paid social + 50% paid health across rate buckets', () => {
      const entries = [
        createRyczaltEntry({
          id: 'e-12',
          ordinalNumber: 1,
          entryDate: '2026-05-10',
          revenueDate: '2026-05-10',
          documentNumber: 'FV/1/05/2026',
          counterpartyName: 'Klient IT Sp. z o.o.',
          rate: '12',
          revenueGrosze: 1_200_000, // 12 000 PLN
        }),
        createRyczaltEntry({
          id: 'e-85',
          ordinalNumber: 2,
          entryDate: '2026-05-18',
          revenueDate: '2026-05-18',
          documentNumber: 'FV/2/05/2026',
          counterpartyName: 'Klient Wsparcie Sp. z o.o.',
          rate: '8.5',
          revenueGrosze: 800_000, // 8 000 PLN
        }),
      ];

      const unpaid = calculateProfileBRyczaltObligations({
        period: '2026-05',
        zusScheme: 'duzy_zus',
        voluntarySicknessInsurance: true,
        entries,
        verifiedPayments: [],
      });

      expect(unpaid.appliedSocialDeductionGrosze).toBe(0);
      expect(unpaid.appliedHealth50PctDeductionGrosze).toBe(0);
      // 12 000 * 12% + 8 000 * 8.5% = 1 440 + 680 = 2 120 PLN = 212 000 grosze
      expect(unpaid.ryczaltTaxAccruedDueGrosze).toBe(212_000);

      const paid = calculateProfileBRyczaltObligations({
        period: '2026-05',
        zusScheme: 'duzy_zus',
        voluntarySicknessInsurance: true,
        entries,
        verifiedPayments: [
          {
            paymentId: 'rycz-soc-04',
            obligationKind: 'zus_social',
            targetPeriod: '2026-04',
            paidDate: '2026-05-15',
            amountGrosze: 178_829,
            bankTransactionId: 'TX-RYCZ-SOC-01',
          },
          {
            paymentId: 'rycz-hlth-04',
            obligationKind: 'zus_health',
            targetPeriod: '2026-04',
            paidDate: '2026-05-15',
            amountGrosze: 49_835,
            bankTransactionId: 'TX-RYCZ-HLTH-01',
          },
        ],
      });

      expect(paid.appliedSocialDeductionGrosze).toBe(178_829);
      // 50% of 49 835 grosze = 24 918 grosze (half-up)
      expect(paid.appliedHealth50PctDeductionGrosze).toBe(24_918);
      expect(paid.ryczaltTaxAccruedDueGrosze).toBeLessThan(unpaid.ryczaltTaxAccruedDueGrosze);
      expect(paid.breakdownByRate).toHaveLength(2);
    });
  });

  describe('Profile C: Sp. z o.o. CIT (19% standard, fail-closed 9%, separate 19% capital gains, proportional 2M EUR limit)', () => {
    it('defaults to 19% CIT when preferential 9% is not explicitly requested', () => {
      const std = calculateProfileCCitObligations({
        period: '2026-03',
        operatingRevenuesYtdGrosze: 30_000_000, // 300 000 PLN
        operatingTaxDeductibleCostsYtdGrosze: 10_000_000, // 100 000 PLN -> 200 000 PLN
        verifiedPayments: [],
      });

      expect(std.operatingAppliedRatePct).toBe(19);
      expect(std.citAdvanceAccruedDueGrosze).toBe(3_800_000); // 38 000 PLN
    });

    it('fails closed with CitPreferentialEligibilityError when requesting 9% without verified attestation or prior-year sales or tax-year bounds, and falls back to 19% on art. 19 ust. 1a restructuring exclusion', () => {
      // Missing tax-year bounds
      expect(() =>
        calculateProfileCCitObligations({
          period: '2026-03',
          operatingRevenuesYtdGrosze: 20_000_000,
          operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
          requestPreferential9PctRate: true,
          verifiedPayments: [],
        }),
      ).toThrow(CitPreferentialEligibilityError);

      // Missing attestation completely
      expect(() =>
        calculateProfileCCitObligations({
          period: '2026-03',
          taxYearStartDate: '2026-01-01',
          taxYearEndDate: '2026-12-31',
          operatingRevenuesYtdGrosze: 20_000_000,
          operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
          requestPreferential9PctRate: true,
          verifiedPayments: [],
        }),
      ).toThrow(CitPreferentialEligibilityError);

      // Missing priorYearGrossSalesGrosze for continuing entity
      expect(() =>
        calculateProfileCCitObligations({
          period: '2026-03',
          taxYearStartDate: '2026-01-01',
          taxYearEndDate: '2026-12-31',
          operatingRevenuesYtdGrosze: 20_000_000,
          operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
          requestPreferential9PctRate: true,
          preferentialEligibility: {
            smallTaxpayerVerified: true,
            isFirstTaxYearNewEntityVerified: false,
            excludedRestructuringArt19Ust1aVerified: false,
            excludedTaxCapitalGroupOrSplitVerified: false,
          },
          verifiedPayments: [],
        }),
      ).toThrow(CitPreferentialEligibilityError);

      // Restructuring exclusion active (art. 19 ust. 1a CIT) -> forced to 19% CIT with statutory warning
      const restructured = calculateProfileCCitObligations({
        period: '2026-03',
        taxYearStartDate: '2026-01-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 20_000_000,
        operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 100_000_000,
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: true,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });
      expect(restructured.operatingAppliedRatePct).toBe(19);
      expect(
        restructured.explanation.warnings.some(
          (w) => w.code === 'CIT_9PCT_EXCLUDED_RESTRUCTURING_OR_PGK',
        ),
      ).toBe(true);
    });

    it('applies 9% ONLY to operating income while taxing capital gains at 19% and forbidding cross-basket loss offset', () => {
      const res = calculateProfileCCitObligations({
        period: '2026-06',
        taxYearStartDate: '2026-01-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 20_000_000, // 200 000 PLN
        operatingTaxDeductibleCostsYtdGrosze: 10_000_000, // 100 000 PLN -> 100 000 PLN operating profit
        capitalGainsRevenuesYtdGrosze: 5_000_000, // 50 000 PLN
        capitalGainsTaxDeductibleCostsYtdGrosze: 1_000_000, // 10 000 PLN -> 40 000 PLN capital gains
        currentTaxYearNetSalesTotalGrosze: 25_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 200_000_000, // 2 000 000 PLN < 2M EUR
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });

      expect(res.operatingAppliedRatePct).toBe(9);
      expect(res.capitalGainsAppliedRatePct).toBe(19);
      expect(res.operatingCumulativeCitGrosze).toBe(900_000); // 9% * 100 000 PLN = 9 000 PLN
      expect(res.capitalGainsCumulativeCitGrosze).toBe(760_000); // 19% * 40 000 PLN = 7 600 PLN
      expect(res.totalCumulativeCitGrosze).toBe(1_660_000); // 16 600 PLN

      // Verify capital loss NEVER reduces operating tax base (art. 7 ust. 5 CIT)
      const withCapitalLoss = calculateProfileCCitObligations({
        period: '2026-06',
        taxYearStartDate: '2026-01-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 20_000_000,
        operatingTaxDeductibleCostsYtdGrosze: 10_000_000, // 100 000 PLN operating profit
        capitalGainsRevenuesYtdGrosze: 1_000_000,
        capitalGainsTaxDeductibleCostsYtdGrosze: 8_000_000, // -70 000 PLN capital loss!
        currentTaxYearNetSalesTotalGrosze: 21_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 200_000_000,
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });

      expect(withCapitalLoss.operatingCumulativeCitGrosze).toBe(900_000);
      expect(withCapitalLoss.capitalGainsCumulativeCitGrosze).toBe(0);
    });

    it('scales current-year 2 000 000 EUR limit proportionally for shortened (6-month) and extended (15-month) CIT tax years and transitions to 19% on crossing', () => {
      const fullYear = calculateProfileCCitObligations({
        period: '2026-09',
        taxYearStartDate: '2026-01-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 10_000_000,
        operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
        currentTaxYearNetSalesTotalGrosze: 10_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 100_000_000,
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });

      const sixMonthYear = calculateProfileCCitObligations({
        period: '2026-09',
        taxYearStartDate: '2026-07-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 10_000_000,
        operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
        currentTaxYearNetSalesTotalGrosze: 10_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 100_000_000,
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });

      const fifteenMonthYear = calculateProfileCCitObligations({
        period: '2026-09',
        taxYearStartDate: '2025-10-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 10_000_000,
        operatingTaxDeductibleCostsYtdGrosze: 5_000_000,
        currentTaxYearNetSalesTotalGrosze: 10_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          isFirstTaxYearNewEntityVerified: true,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });

      expect(sixMonthYear.taxYearMonths).toBe(6);
      expect(sixMonthYear.operatingAppliedRatePct).toBe(9);
      expect(sixMonthYear.proportionalCurrentYearNetLimitGrosze).toBeLessThan(
        fullYear.proportionalCurrentYearNetLimitGrosze,
      );
      expect(fifteenMonthYear.taxYearMonths).toBe(15);
      expect(fifteenMonthYear.proportionalCurrentYearNetLimitGrosze).toBeGreaterThan(
        fullYear.proportionalCurrentYearNetLimitGrosze,
      );

      // Exceeding 6-month proportional limit (~1M EUR = ~4.2M PLN) forces mid-year transition from 9% to 19% (art. 25 ust. 1g CIT)!
      const crossedHalfYearLimit = calculateProfileCCitObligations({
        period: '2026-09',
        taxYearStartDate: '2026-07-01',
        taxYearEndDate: '2026-12-31',
        operatingRevenuesYtdGrosze: 600_000_000, // 6 000 000 PLN > half-year 1M EUR limit!
        operatingTaxDeductibleCostsYtdGrosze: 100_000_000,
        currentTaxYearNetSalesTotalGrosze: 600_000_000,
        requestPreferential9PctRate: true,
        preferentialEligibility: {
          smallTaxpayerVerified: true,
          priorYearGrossSalesGrosze: 100_000_000,
          isFirstTaxYearNewEntityVerified: false,
          excludedRestructuringArt19Ust1aVerified: false,
          excludedTaxCapitalGroupOrSplitVerified: false,
        },
        verifiedPayments: [],
      });
      expect(crossedHalfYearLimit.operatingAppliedRatePct).toBe(19);
      expect(
        crossedHalfYearLimit.explanation.warnings.some(
          (w) => w.code === 'CIT_CURRENT_TAX_YEAR_LIMIT_EXCEEDED',
        ),
      ).toBe(true);
    });
  });

  describe('KSeF 35-char CRC-8 validator & FA(2)/FA(3) domain XML builder', () => {
    it('computes and verifies KSeF 2.0 CRC-8 checksum and rejects mutated KSeF numbers or PL-prefixed NIP', () => {
      const ksefNo = buildSyntheticTestKsefNumber('5261040828', '2026-03-15', '0123456789AB');
      expect(ksefNo).toHaveLength(35);
      expect(validateKsefNumber(ksefNo).valid).toBe(true);

      const tampered =
        `${ksefNo.slice(0, 33)}FF` === ksefNo
          ? `${ksefNo.slice(0, 33)}00`
          : `${ksefNo.slice(0, 33)}FF`;
      expect(validateKsefNumber(tampered).valid).toBe(false);

      const fa3 = generateKsefFaXml({
        schemaVersion: 'FA(3)',
        createdAtIsoUtc: '2026-03-15T10:00:00Z',
        seller: {
          nip: '5261040828',
          name: 'Test Sp. z o.o.',
          address: { countryCode: 'PL', addressLine1: 'ul. Prosta 1, 00-850 Warszawa' },
        },
        buyer: {
          identifier: { kind: 'brak_id' },
          name: 'Jan Konsument',
        },
        invoiceNumber: 'FV/2026/03/001',
        issueDate: '2026-03-15',
        lines: [
          {
            description: 'Usługa doradcza',
            netGrosze: 100_000,
            vatRate: '23',
          },
        ],
      });
      expect(fa3.targetNamespace).toBe(KSEF_FA3_NAMESPACE);
      expect(fa3.totalGrossGrosze).toBe(123_000);

      const fa2 = generateKsefFaXml({
        schemaVersion: 'FA(2)',
        createdAtIsoUtc: '2025-12-15T10:00:00Z',
        seller: {
          nip: '5261040828',
          name: 'Test Sp. z o.o.',
          address: { countryCode: 'PL', addressLine1: 'ul. Prosta 1, 00-850 Warszawa' },
        },
        buyer: {
          identifier: { kind: 'nip', nip: '9542752600' },
          name: 'Kontrahent Sp. z o.o.',
          address: { countryCode: 'PL', addressLine1: 'ul. Długa 5, 40-001 Katowice' },
        },
        invoiceNumber: 'FV/2025/12/099',
        issueDate: '2025-12-15',
        lines: [
          {
            description: 'Licencja oprogramowania',
            netGrosze: 200_000,
            vatRate: '23',
          },
        ],
      });
      expect(fa2.targetNamespace).toBe(KSEF_FA2_NAMESPACE);

      expect(() =>
        generateKsefFaXml({
          schemaVersion: 'FA(3)',
          createdAtIsoUtc: '2026-03-15T10:00:00Z',
          seller: {
            nip: 'PL5261040828',
            name: 'Zły Prefiks Sp. z o.o.',
            address: { countryCode: 'PL', addressLine1: 'ul. Zła 1' },
          },
          buyer: { identifier: { kind: 'brak_id' }, name: 'Konsument' },
          invoiceNumber: 'FV/ERR/1',
          issueDate: '2026-03-15',
          lines: [{ description: 'Poz', netGrosze: 10_000, vatRate: '23' }],
        }),
      ).toThrow();
    });
  });
});
