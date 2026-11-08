import { describe, expect, it } from 'vitest';
import {
  calculateJpkV7mSummary,
  createVatRegisterEntry,
  evaluateVatExemptionLimit,
} from '../src/vat/index.js';

describe('vat — sales/purchase registers, 50% vehicle deduction, MPP, art. 113 limits & JPK_V7M', () => {
  it('creates a standard 23% sales VAT entry with JPK_V7M(3) KSeF marker in 2026', () => {
    const entry = createVatRegisterEntry({
      id: 'vat-sale-1',
      registerType: 'sales',
      period: '2026-04',
      taxPointDate: '2026-04-15',
      issueDate: '2026-04-15',
      documentNumber: 'FV/2026/04/001',
      counterpartyName: 'Odbiorca Soft Sp. z o.o.',
      counterpartyNip: '526-10-40-828',
      vatRate: '23',
      netGrosze: 1_000_000, // 10 000,00 zł
      vatTotalGrosze: 230_000, // 2 300,00 zł
      ksefReferenceNumber: '5261040828-20260415-0001AA-BB',
    });

    expect(entry.grossGrosze).toBe(1_230_000);
    expect(entry.deductibleVatGrosze).toBe(230_000);
    expect(entry.nonDeductibleVatGrosze).toBe(0);
    expect(entry.ksefMarker).toBe('NrKSeF');
    expect(entry.counterpartyNip).toBe('5261040828');
    expect(entry.explanation.outputs['jpkSchema']).toBe('JPK_V7M(3)');
  });

  it('uses JPK_V7M(2) schema for January 2026 before the 2026-02-01 switch', () => {
    const entry = createVatRegisterEntry({
      id: 'vat-sale-jan26',
      registerType: 'sales',
      period: '2026-01',
      taxPointDate: '2026-01-20',
      issueDate: '2026-01-20',
      documentNumber: 'FV/2026/01/005',
      counterpartyName: 'Klient Styczniowy',
      vatRate: '8',
      netGrosze: 100_000,
      vatTotalGrosze: 8_000,
    });

    expect(entry.explanation.outputs['jpkSchema']).toBe('JPK_V7M(2)');
    expect(entry.ksefMarker).toBe('BFK');
  });

  it('rejects NrKSeF marker without ksefReferenceNumber under JPK_V7M(3) from February 2026', () => {
    expect(() =>
      createVatRegisterEntry({
        id: 'vat-bad-ksef',
        registerType: 'sales',
        period: '2026-03',
        taxPointDate: '2026-03-10',
        issueDate: '2026-03-10',
        documentNumber: 'FV/2026/03/01',
        counterpartyName: 'Klient',
        vatRate: '23',
        netGrosze: 50_000,
        vatTotalGrosze: 11_500,
        ksefMarker: 'NrKSeF',
      }),
    ).toThrow(/NrKSeF wymaga podania numeru/);
  });

  it('rejects invalid counterparty NIP in VAT register', () => {
    expect(() =>
      createVatRegisterEntry({
        id: 'vat-bad-nip',
        registerType: 'purchase',
        period: '2026-04',
        taxPointDate: '2026-04-10',
        issueDate: '2026-04-10',
        documentNumber: 'FV/ZAK/99',
        counterpartyName: 'Błędny NIP',
        counterpartyNip: '5261040829',
        vatRate: '23',
        netGrosze: 10_000,
        vatTotalGrosze: 2_300,
      }),
    ).toThrow(/Nieprawidłowy NIP/);
  });

  it('calculates 50% vehicle VAT deduction (art. 86a) including odd-grosz half-up split', () => {
    // 46,01 zł VAT (4 601 gr): 50% half-up = 2 301 gr (23,01 zł) do odliczenia, 2 300 gr (23,00 zł) nieodliczone (do KPiR!)
    const entry = createVatRegisterEntry({
      id: 'vat-car-odd',
      registerType: 'purchase',
      period: '2026-04',
      taxPointDate: '2026-04-12',
      issueDate: '2026-04-12',
      documentNumber: 'FV/PALIWO/1',
      counterpartyName: 'Stacja Paliw S.A.',
      vatRate: '23',
      netGrosze: 20_004,
      vatTotalGrosze: 4_601,
      deductionMode: 'vehicle_mixed_50',
    });

    expect(entry.deductibleVatGrosze).toBe(2_301);
    expect(entry.nonDeductibleVatGrosze).toBe(2_300);
    expect(entry.deductibleVatGrosze + entry.nonDeductibleVatGrosze).toBe(4_601);
  });

  it('flags 100% purchase deduction without VAT-26 confirmation as requiresHumanApproval', () => {
    const entry = createVatRegisterEntry({
      id: 'vat-car-100-unconfirmed',
      registerType: 'purchase',
      period: '2026-04',
      taxPointDate: '2026-04-12',
      issueDate: '2026-04-12',
      documentNumber: 'FV/SERWIS/2',
      counterpartyName: 'Serwis Auto',
      vatRate: '23',
      netGrosze: 100_000,
      vatTotalGrosze: 23_000,
      deductionMode: 'full_100',
      hasVat26AndMileageLog: false,
    });

    expect(entry.explanation.requiresHumanApproval).toBe(true);
  });

  it('handles 0% deduction mode for non-deductible purchases', () => {
    const entry = createVatRegisterEntry({
      id: 'vat-none-0',
      registerType: 'purchase',
      period: '2026-04',
      taxPointDate: '2026-04-12',
      issueDate: '2026-04-12',
      documentNumber: 'FV/HOTEL/1',
      counterpartyName: 'Hotel Krajowy',
      vatRate: '8',
      netGrosze: 50_000,
      vatTotalGrosze: 4_000,
      deductionMode: 'none_0',
    });

    expect(entry.deductibleVatGrosze).toBe(0);
    expect(entry.nonDeductibleVatGrosze).toBe(4_000);
  });

  it.each([
    { net: 1_219_512, vat: 280_488, annex15: true, expectedMpp: false }, // 15 000,00 zł brutto równo -> NIE przekracza!
    { net: 1_219_513, vat: 280_488, annex15: true, expectedMpp: true }, // 15 000,01 zł brutto + zał. 15 -> OBOWIĄZKOWY MPP!
    { net: 2_000_000, vat: 460_000, annex15: false, expectedMpp: false }, // > 15 000 zł, ale brak towarów z zał. 15 -> NIE
  ])(
    'evaluates mandatory Split Payment MPP (art. 108a ust. 1a) for net=$net + vat=$vat (annex15=$annex15)',
    ({ net, vat, annex15, expectedMpp }) => {
      const entry = createVatRegisterEntry({
        id: 'vat-mpp-test',
        registerType: 'purchase',
        period: '2026-05',
        taxPointDate: '2026-05-10',
        issueDate: '2026-05-10',
        documentNumber: 'FV/MPP/1',
        counterpartyName: 'Hurtownia Elektroniki',
        vatRate: '23',
        netGrosze: net,
        vatTotalGrosze: vat,
        annex15Item: annex15,
      });

      expect(entry.mandatorySplitPaymentMpp).toBe(expectedMpp);
    },
  );

  it('enforces 200 000 zł VAT exemption limit in 2025 and triggers taxation of the exceeding transaction', () => {
    const res = evaluateVatExemptionLimit({
      eventDate: '2025-10-15',
      activityStartDate: '2024-03-01',
      cumulativeNetSalesBeforeGrosze: 19_500_000, // 195 000,00 zł
      currentTransactionNetGrosze: 600_000, // 6 000,00 zł -> razem 201 000,00 zł > 200 000,00 zł!
    });

    expect(res.annualStatutoryLimitGrosze).toBe(20_000_000);
    expect(res.status).toBe('exceeded_by_current_transaction');
    expect(res.currentTransactionTaxableVat).toBe(true);
    expect(res.remainingLimitGrosze).toBe(0);
  });

  it('applies increased 240 000 zł VAT exemption limit from 2026-01-01 (Dz.U. 2025 poz. 896)', () => {
    const res = evaluateVatExemptionLimit({
      eventDate: '2026-10-15',
      activityStartDate: '2024-03-01',
      cumulativeNetSalesBeforeGrosze: 22_000_000, // 220 000,00 zł — w 2025 byłoby przekroczeniem, w 2026 mieści się w limicie!
      currentTransactionNetGrosze: 500_000, // 5 000,00 zł -> razem 225 000,00 zł <= 240 000,00 zł
    });

    expect(res.annualStatutoryLimitGrosze).toBe(24_000_000);
    expect(res.status).toBe('exempt_within_limit');
    expect(res.currentTransactionTaxableVat).toBe(false);
    expect(res.remainingLimitGrosze).toBe(1_500_000); // 15 000,00 zł zapasu
    expect(res.explanation.warnings.some((w) => w.code === 'VAT_LIMIT_ABOVE_90_PERCENT')).toBe(
      true,
    );
  });

  it('computes proportional first-year VAT exemption limit by active days (art. 113 ust. 9)', () => {
    // Start 2026-07-02 -> w II półroczu: lipiec 30 dni (2..31) + sie 31 + wrz 30 + paź 31 + lis 30 + gru 31 = 183 dni z 365!
    // 24 000 000 gr * 183 / 365 = 12 032 876,712... gr -> half-up = 12 032 877 gr (120 328,77 zł)
    const res = evaluateVatExemptionLimit({
      eventDate: '2026-09-01',
      activityStartDate: '2026-07-02',
      cumulativeNetSalesBeforeGrosze: 10_000_000,
    });

    expect(res.activeDaysInYear).toBe(183);
    expect(res.totalDaysInYear).toBe(365);
    expect(res.proportionalLimitGrosze).toBe(12_032_877);
    expect(res.status).toBe('exempt_within_limit');
  });

  it('immediately disqualifies taxpayer performing art. 113 ust. 13 excluded advisory services', () => {
    const res = evaluateVatExemptionLimit({
      eventDate: '2026-02-01',
      activityStartDate: '2026-02-01',
      cumulativeNetSalesBeforeGrosze: 0,
      currentTransactionNetGrosze: 100_00,
      excludedActivityArt113Ust13: true,
    });

    expect(res.status).toBe('excluded_art_113_ust_13');
    expect(res.currentTransactionTaxableVat).toBe(true);
  });

  it('aggregates JPK_V7M summary with art. 63 § 1 rounding, carry-over and P_51 / P_53 calculation', () => {
    const sale1 = createVatRegisterEntry({
      id: 's1',
      registerType: 'sales',
      period: '2026-04',
      taxPointDate: '2026-04-05',
      issueDate: '2026-04-05',
      documentNumber: 'FV/1',
      counterpartyName: 'Klient A',
      vatRate: '23',
      netGrosze: 1_000_217,
      vatTotalGrosze: 230_050, // 2 300,50 zł -> po zaokr. 2 301 zł (230 100 gr)
      ksefReferenceNumber: 'KSEF-1',
    });

    const purchase1 = createVatRegisterEntry({
      id: 'p1',
      registerType: 'purchase',
      period: '2026-04',
      taxPointDate: '2026-04-10',
      issueDate: '2026-04-10',
      documentNumber: 'FZ/1',
      counterpartyName: 'Dostawca B',
      vatRate: '23',
      netGrosze: 200_000,
      vatTotalGrosze: 46_049, // 460,49 zł -> po zaokr. 460 zł (46 000 gr)
      ksefReferenceNumber: 'KSEF-2',
    });

    // Z nadwyżką z marca 100,00 zł (10 000 gr): P_38 = 2 301 zł, P_48 = 460 + 100 = 560 zł -> P_51 = 1 741 zł (174 100 gr)
    const summaryDue = calculateJpkV7mSummary({
      period: '2026-04',
      entries: [sale1, purchase1],
      carryOverInputVatFromPreviousPeriodGrosze: 10_000,
    });

    expect(summaryDue.schemaVersion).toBe('JPK_V7M(3)');
    expect(summaryDue.outputVatRoundedPlnGrosze).toBe(230_100);
    expect(summaryDue.totalInputVatPlnGrosze).toBe(56_000);
    expect(summaryDue.taxDueToPayP51Grosze).toBe(174_100);
    expect(summaryDue.excessInputVatToCarryOverP53Grosze).toBe(0);

    // Z dużą nadwyżką z marca 2 000,00 zł (200 000 gr): P_48 = 2 460 zł > P_38 = 2 301 zł -> nadwyżka P_53 = 159 zł (15 900 gr)
    const summaryExcess = calculateJpkV7mSummary({
      period: '2026-04',
      entries: [sale1, purchase1],
      carryOverInputVatFromPreviousPeriodGrosze: 200_000,
      refundRequestedP54Grosze: 5_900, // 59,00 zł zwrotu na rachunek P_54 -> P_62 = 100 zł
    });

    expect(summaryExcess.taxDueToPayP51Grosze).toBe(0);
    expect(summaryExcess.excessInputVatToCarryOverP53Grosze).toBe(15_900);
    expect(summaryExcess.refundToBankAccountP54Grosze).toBe(5_900);
    expect(summaryExcess.carryForwardToNextPeriodP62Grosze).toBe(10_000);
    expect(summaryExcess.declarationFields.P_53).toBe(159);
    expect(summaryExcess.declarationFields.P_54).toBe(59);
    expect(summaryExcess.declarationFields.P_62).toBe(100);
  });

  it('computes JPK_V7M P_37, P_38 and P_48 as sums of per-rate/per-category rounded PLN fields and applies art. 86a / art. 88 to P_40/P_42 (#65)', () => {
    // 3 sprzedaże z końcówką 40 gr VAT w każdej stawce:
    // 23%: VAT 10,40 zł -> P_20 = 10 zł
    // 8%:  VAT 10,40 zł -> P_18 = 10 zł
    // 5%:  VAT 10,40 zł -> P_16 = 10 zł
    // Suma P_38 w JPK_V7M MUSI wynosić 10 + 10 + 10 = 30 zł (3 000 gr), a nie round(31,20 zł) = 31 zł!
    const s23 = createVatRegisterEntry({
      id: 's-23',
      registerType: 'sales',
      period: '2026-05',
      taxPointDate: '2026-05-05',
      issueDate: '2026-05-05',
      documentNumber: 'FV/23',
      counterpartyName: 'Klient 23',
      vatRate: '23',
      netGrosze: 4_522,
      vatTotalGrosze: 1_040,
      ksefReferenceNumber: '5250001003-20260505-AA11BB-CC22DD-01',
    });
    const s8 = createVatRegisterEntry({
      id: 's-8',
      registerType: 'sales',
      period: '2026-05',
      taxPointDate: '2026-05-06',
      issueDate: '2026-05-06',
      documentNumber: 'FV/8',
      counterpartyName: 'Klient 8',
      vatRate: '8',
      netGrosze: 13_000,
      vatTotalGrosze: 1_040,
      ksefReferenceNumber: '5250001003-20260506-AA11BB-CC22DD-02',
    });
    const s5 = createVatRegisterEntry({
      id: 's-5',
      registerType: 'sales',
      period: '2026-05',
      taxPointDate: '2026-05-07',
      issueDate: '2026-05-07',
      documentNumber: 'FV/5',
      counterpartyName: 'Klient 5',
      vatRate: '5',
      netGrosze: 20_800,
      vatTotalGrosze: 1_040,
      ksefReferenceNumber: '5250001003-20260507-AA11BB-CC22DD-03',
    });

    // Zakupy:
    // 1) Środek trwały 10 000,00 zł netto + 2 300,00 zł VAT (100% odliczenia) -> P_40 = 10 000, P_41 = 2 300
    const pFixed = createVatRegisterEntry({
      id: 'p-fixed',
      registerType: 'purchase',
      period: '2026-05',
      taxPointDate: '2026-05-10',
      issueDate: '2026-05-10',
      documentNumber: 'FZ/ST/1',
      counterpartyName: 'Dostawca Maszyn',
      vatRate: '23',
      netGrosze: 1_000_000,
      vatTotalGrosze: 230_000,
      deductionMode: 'full_100',
      isFixedAssetPurchase: true,
      ksefReferenceNumber: '5250001003-20260510-AA11BB-CC22DD-04',
    });
    // 2) Paliwo mieszane (vehicle_mixed_50): 200,00 zł netto + 46,00 zł VAT -> 50% netto = 100,00 zł (P_42), 50% VAT = 23,00 zł (P_43)
    const pCar = createVatRegisterEntry({
      id: 'p-car',
      registerType: 'purchase',
      period: '2026-05',
      taxPointDate: '2026-05-12',
      issueDate: '2026-05-12',
      documentNumber: 'FZ/CAR/1',
      counterpartyName: 'Stacja Paliw',
      vatRate: '23',
      netGrosze: 20_000,
      vatTotalGrosze: 4_600,
      deductionMode: 'vehicle_mixed_50',
      ksefMarker: 'BFK',
    });
    // 3) Usługa hotelowa (none_0 — art. 88 ust. 1 pkt 4 VAT): 500,00 zł netto + 40,00 zł VAT -> nie wchodzi do P_42 ani P_43!
    const pHotel = createVatRegisterEntry({
      id: 'p-hotel',
      registerType: 'purchase',
      period: '2026-05',
      taxPointDate: '2026-05-15',
      issueDate: '2026-05-15',
      documentNumber: 'FZ/HOTEL/1',
      counterpartyName: 'Hotel',
      vatRate: '8',
      netGrosze: 50_000,
      vatTotalGrosze: 4_000,
      deductionMode: 'none_0',
      ksefMarker: 'BFK',
    });

    const jpk = calculateJpkV7mSummary({
      period: '2026-05',
      entries: [s23, s8, s5, pFixed, pCar, pHotel],
    });

    expect(jpk.declarationFields.P_16).toBe(10);
    expect(jpk.declarationFields.P_18).toBe(10);
    expect(jpk.declarationFields.P_20).toBe(10);
    expect(jpk.declarationFields.P_38).toBe(30);
    expect(jpk.outputVatRoundedPlnGrosze).toBe(3_000);
    expect(jpk.declarationFields.P_40).toBe(10_000);
    expect(jpk.declarationFields.P_41).toBe(2_300);
    expect(jpk.declarationFields.P_42).toBe(100);
    expect(jpk.declarationFields.P_43).toBe(23);
    expect(jpk.declarationFields.P_48).toBe(2_323);
  });

  it('rejects conflicting KSeF marker (BFK/OFF/DI with ksefReferenceNumber) in JPK_V7M(3) and flags non-zero VAT on exempt rate (#65)', () => {
    expect(() =>
      createVatRegisterEntry({
        id: 'vat-conflict-ksef',
        registerType: 'sales',
        period: '2026-04',
        taxPointDate: '2026-04-10',
        issueDate: '2026-04-10',
        documentNumber: 'FV/CONFLICT/1',
        counterpartyName: 'Kontrahent',
        vatRate: '23',
        netGrosze: 10_000,
        vatTotalGrosze: 2_300,
        ksefMarker: 'BFK',
        ksefReferenceNumber: '5250001003-20260410-AA11BB-CC22DD-99',
      }),
    ).toThrow(/wyklucza jednoczesne podanie numeru KSeF/);

    const anomalousZw = createVatRegisterEntry({
      id: 'vat-zw-nonzero',
      registerType: 'sales',
      period: '2026-04',
      taxPointDate: '2026-04-10',
      issueDate: '2026-04-10',
      documentNumber: 'FV/ZW/1',
      counterpartyName: 'Kontrahent',
      vatRate: 'zw',
      netGrosze: 10_000,
      vatTotalGrosze: 500,
      ksefMarker: 'BFK',
    });
    expect(anomalousZw.explanation.requiresHumanApproval).toBe(true);
    expect(
      anomalousZw.explanation.warnings.some((w) => w.code === 'VAT_NONZERO_FOR_ZERO_OR_EXEMPT_RATE'),
    ).toBe(true);
  });
});
