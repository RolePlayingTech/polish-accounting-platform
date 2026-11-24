import {
  buildSyntheticTestKsefNumber,
  resolveApplicableJpkStructures,
  type JpkPolishAddress,
  type JpkTaxpayerSubject,
} from '@pap/domain';
import { describe, expect, it } from 'vitest';

import {
  JpkXsdValidationFailedError,
  finalizeValidatedJpkXml,
  prepareValidatedJpkExport,
} from '../src/index.js';

const NATURAL_SUBJECT: JpkTaxpayerSubject = {
  kind: 'natural_person',
  nip: '5261040828',
  firstName: 'Jan',
  lastName: 'Kowalski',
  birthDate: '1986-04-12',
  email: 'jan.kowalski@firma.example.pl',
};

const CORPORATE_ADDRESS: JpkPolishAddress = {
  voivodeship: 'MAZOWIECKIE',
  county: 'WARSZAWA',
  municipality: 'WARSZAWA',
  street: 'PROSTA',
  buildingNumber: '20',
  apartmentNumber: '4',
  city: 'WARSZAWA',
  postalCode: '00-850',
};

describe('Official MF JPK XML Exports & Offline XSD Validation (#98, GLD-11)', () => {
  it('resolves exact statutory JPK structures per profile, VAT cadence, and 2026/2027 effective dates', () => {
    const jan2026 = resolveApplicableJpkStructures({
      profile: 'jdg_kpir_skala',
      vatPayer: true,
      vatCadence: 'monthly',
      periodYearMonth: '2026-01',
    });
    expect(jan2026.map((x) => x.structureCode)).toEqual([
      'JPK_V7M(2)',
      'JPK_PKPIR(3)',
      'JPK_ST(1)',
    ]);

    const feb2026Monthly = resolveApplicableJpkStructures({
      profile: 'jdg_kpir_liniowy',
      vatPayer: true,
      vatCadence: 'monthly',
      periodYearMonth: '2026-02',
    });
    expect(feb2026Monthly.map((x) => x.structureCode)).toEqual([
      'JPK_V7M(3)',
      'JPK_PKPIR(3)',
      'JPK_ST(1)',
    ]);
    expect(
      feb2026Monthly.find((x) => x.structureCode === 'JPK_PKPIR(3)')?.mandatoryForTaxYear,
    ).toBe(true);

    const feb2026RyczaltExempt = resolveApplicableJpkStructures({
      profile: 'jdg_ryczalt',
      vatPayer: false,
      vatCadence: 'not_applicable',
      periodYearMonth: '2026-02',
    });
    expect(feb2026RyczaltExempt.map((x) => x.structureCode)).toEqual(['JPK_EWP(4)', 'JPK_ST(1)']);
    expect(
      feb2026RyczaltExempt.find((x) => x.structureCode === 'JPK_EWP(4)')?.mandatoryForTaxYear,
    ).toBe(false);

    const mar2026CitQuarterly = resolveApplicableJpkStructures({
      profile: 'spzoo_pelne_ksiegi',
      vatPayer: true,
      vatCadence: 'quarterly',
      periodYearMonth: '2026-03',
    });
    expect(mar2026CitQuarterly.map((x) => x.structureCode)).toEqual([
      'JPK_V7K(3)',
      'JPK_KR_PD(1)',
      'JPK_ST_KR(1)',
    ]);
  });

  it('generates and offline-validates JPK_V7M(3), JPK_V7K(3) (months 1 & 3), and archival JPK_V7M(2) against official MF XSDs without inventing fake UPOs', () => {
    const ksefSalesNo = buildSyntheticTestKsefNumber('5261040828', '20260214', '112233445566');
    const ksefPurchaseNo = buildSyntheticTestKsefNumber('9542752600', '20260218', 'AABBCCDDEEFF');

    // 1. JPK_V7M(3) with multi-rate sales (23% + 8% + 5% + zw), KSeF markers, GTU_12, TP, excess VAT split P_54 (60-day refund) + P_62 carryover
    const v7m3 = prepareValidatedJpkExport({
      structureCode: 'JPK_V7M(3)',
      payload: {
        generatedAtIso: '2026-03-10T09:00:00Z',
        purpose: 1,
        taxOfficeCode: '1435',
        year: 2026,
        month: 2,
        subject: NATURAL_SUBJECT,
        priorExcessCarryoverPln: 500,
        requestedRefundPln: 1_000,
        refundTimeframe: '60_days',
        salesRows: [
          {
            counterpartyCountryCode: 'PL',
            counterpartyTin: '9542752600',
            counterpartyName: 'Klient Biznesowy Sp. z o.o.',
            documentNumber: 'FV/2026/02/01',
            issueDate: '2026-02-14',
            saleDate: '2026-02-14',
            ksefMarker: { kind: 'KSEF', ksefNumber: ksefSalesNo },
            gtuCodes: ['GTU_12'],
            procedureCodes: ['TP'],
            net23Grosze: 1_000_000, // 10 000 PLN -> 2 300 PLN VAT
            vat23Grosze: 230_000,
            net8Grosze: 100_000, // 1 000 PLN -> 80 PLN VAT
            vat8Grosze: 8_000,
          },
          {
            counterpartyName: 'Sprzedaż kasa rejestrująca',
            documentNumber: 'RO/2026/02',
            issueDate: '2026-02-28',
            ksefMarker: { kind: 'BFK' },
            documentType: 'RO',
            net5Grosze: 20_000,
            vat5Grosze: 1_000,
            exemptNetGrosze: 10_000,
          },
        ],
        purchaseRows: [
          {
            supplierCountryCode: 'PL',
            supplierTin: '9542752600',
            supplierName: 'Dostawca Serwerów Sp. z o.o.',
            documentNumber: 'FZ/2026/02/99',
            purchaseDate: '2026-02-18',
            receiptDate: '2026-02-18',
            ksefMarker: { kind: 'KSEF', ksefNumber: ksefPurchaseNo },
            fixedAssetsNetGrosze: 2_000_000,
            fixedAssetsVatGrosze: 460_000, // 4 600 PLN input VAT -> excess over output VAT!
          },
        ],
      },
    });

    expect(v7m3.xsdValidation.valid).toBe(true);
    expect(v7m3.lifecycleStatus).toBe('exported_xsd_valid_awaiting_signature');
    expect(v7m3.officialUpoReferenceNumber).toBeNull();
    expect(v7m3.officialUpoXml).toBeNull();
    expect(v7m3.xmlContent).toContain('<P_54>1000</P_54>');
    expect(v7m3.xmlContent).toContain('<P_560>1</P_560>');
    expect(v7m3.xmlContent).toContain('<P_62>1710</P_62>');

    // 2. JPK_V7K(3) month 2 (February — Ewidencja only, NO Deklaracja)
    const v7kMonth2 = prepareValidatedJpkExport({
      structureCode: 'JPK_V7K(3)',
      payload: {
        generatedAtIso: '2026-03-15T10:00:00Z',
        purpose: 1,
        taxOfficeCode: '1435',
        year: 2026,
        month: 2,
        subject: {
          kind: 'legal_entity',
          nip: '5261040828',
          fullName: 'Kwartalna Sp. z o.o.',
          email: 'vat@kwartalna.example.pl',
        },
        salesRows: [
          {
            counterpartyTin: '9542752600',
            counterpartyName: 'Odbiorca Sp. z o.o.',
            documentNumber: 'FV/Q1/02/01',
            issueDate: '2026-02-20',
            ksefMarker: { kind: 'OFF' },
            net23Grosze: 500_000,
            vat23Grosze: 115_000,
          },
        ],
        purchaseRows: [],
      },
    });
    expect(v7kMonth2.xsdValidation.valid).toBe(true);
    expect(v7kMonth2.xmlContent).not.toContain('<Deklaracja>');

    // 3. JPK_V7K(3) month 3 (March — Ewidencja + Deklaracja VAT-7K(17))
    const v7kMonth3 = prepareValidatedJpkExport({
      structureCode: 'JPK_V7K(3)',
      payload: {
        generatedAtIso: '2026-04-15T10:00:00Z',
        purpose: 1,
        taxOfficeCode: '1435',
        year: 2026,
        month: 3,
        subject: {
          kind: 'legal_entity',
          nip: '5261040828',
          fullName: 'Kwartalna Sp. z o.o.',
          email: 'vat@kwartalna.example.pl',
        },
        quarterlyPriorMonthsCarry: {
          net23Pln: 5_000,
          vat23Pln: 1_150,
        },
        salesRows: [
          {
            counterpartyTin: '9542752600',
            counterpartyName: 'Odbiorca Sp. z o.o.',
            documentNumber: 'FV/Q1/03/01',
            issueDate: '2026-03-20',
            ksefMarker: { kind: 'DI' },
            net23Grosze: 400_000,
            vat23Grosze: 92_000,
          },
        ],
        purchaseRows: [],
      },
    });
    expect(v7kMonth3.xsdValidation.valid).toBe(true);
    expect(v7kMonth3.xmlContent).toContain('<KodFormularzaDekl kodSystemowy="VAT-7K (17)"');
    expect(v7kMonth3.xmlContent).toContain('<Kwartal>1</Kwartal>');

    // 4. Archival JPK_V7M(2) for January 2026
    const v7m2 = prepareValidatedJpkExport({
      structureCode: 'JPK_V7M(2)',
      payload: {
        generatedAtIso: '2026-02-18T11:00:00Z',
        purpose: 1,
        taxOfficeCode: '1435',
        year: 2026,
        month: 1,
        subject: NATURAL_SUBJECT,
        salesRows: [
          {
            counterpartyTin: '9542752600',
            counterpartyName: 'Klient Styczniowy Sp. z o.o.',
            documentNumber: 'FV/2026/01/01',
            issueDate: '2026-01-20',
            ksefMarker: { kind: 'BFK' },
            net23Grosze: 300_000,
            vat23Grosze: 69_000,
          },
        ],
        purchaseRows: [],
      },
    });
    expect(v7m2.xsdValidation.valid).toBe(true);
  });

  it('generates and offline-validates JPK_PKPIR(3), JPK_EWP(4), JPK_ST(1) (PKPIR & EWP), JPK_KR_PD(1), and JPK_ST_KR(1), and rejects invalid/tampered payloads', () => {
    const ksefNo = buildSyntheticTestKsefNumber('5261040828', '20260512', '998877665544');

    // 1. JPK_PKPIR(3)
    const pkpir = prepareValidatedJpkExport({
      structureCode: 'JPK_PKPIR(3)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-02-10T10:00:00Z',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        taxOfficeCode: '1435',
        subject: NATURAL_SUBJECT,
        openingInventoryGrosze: 200_000,
        closingInventoryGrosze: 150_000,
        rows: [
          {
            entryDate: '2026-05-12',
            documentNumber: 'FV/2026/05/01',
            ksefNumber: ksefNo,
            counterpartyCountryCode: 'PL',
            counterpartyTin: '9542752600',
            counterpartyName: 'Klient Sp. z o.o.',
            counterpartyAddress: 'ul. Długa 5, 40-001 Katowice',
            description: 'Sprzedaż usług programistycznych',
            salesRevenueGrosze: 1_500_000,
          },
          {
            entryDate: '2026-05-20',
            documentNumber: 'FZ/2026/05/11',
            counterpartyCountryCode: 'PL',
            counterpartyTin: '9542752600',
            counterpartyName: 'Hosting Cloud Sp. z o.o.',
            counterpartyAddress: 'ul. Serwerowa 2, 00-100 Warszawa',
            description: 'Usługi chmurowe',
            otherExpensesGrosze: 120_000,
          },
        ],
      },
    });
    expect(pkpir.xsdValidation.valid).toBe(true);

    // 2. JPK_EWP(4) + negative check for 2% rate omitted from MF TStawkaPodatku enum
    const ewp = prepareValidatedJpkExport({
      structureCode: 'JPK_EWP(4)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-02-10T10:00:00Z',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        taxOfficeCode: '1435',
        subject: NATURAL_SUBJECT,
        rows: [
          {
            entryDate: '2026-05-12',
            revenueDate: '2026-05-12',
            documentNumber: 'FV/RYCZ/2026/05/01',
            ksefNumber: ksefNo,
            counterpartyCountryCode: 'PL',
            counterpartyTin: '9542752600',
            revenueGrosze: 1_800_000,
            ratePercent: '12',
          },
          {
            entryDate: '2026-05-25',
            revenueDate: '2026-05-25',
            documentNumber: 'FV/RYCZ/2026/05/02',
            revenueGrosze: 400_000,
            ratePercent: '8.5',
          },
        ],
      },
    });
    expect(ewp.xsdValidation.valid).toBe(true);

    expect(() =>
      prepareValidatedJpkExport({
        structureCode: 'JPK_EWP(4)',
        payload: {
          purpose: 1,
          generatedAtIso: '2027-02-10T10:00:00Z',
          dateFrom: '2026-01-01',
          dateTo: '2026-12-31',
          taxOfficeCode: '1435',
          subject: NATURAL_SUBJECT,
          rows: [
            {
              entryDate: '2026-05-12',
              revenueDate: '2026-05-12',
              documentNumber: 'FV/RYCZ/2PCT',
              revenueGrosze: 100_000,
              ratePercent: '2',
            },
          ],
        },
      }),
    ).toThrow(/TStawkaPodatku/);

    // 3. JPK_ST(1) — both PKPIR and EWP branches
    const stPkpir = prepareValidatedJpkExport({
      structureCode: 'JPK_ST(1)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-02-10T10:00:00Z',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        taxOfficeCode: '1435',
        subject: NATURAL_SUBJECT,
        registerBranch: 'PKPIR',
        rows: [
          {
            assetKind: 'tangible',
            acquisitionDate: '2026-02-01',
            acceptanceDate: '2026-02-02',
            acceptanceDocumentNumber: 'OT/2026/01',
            acquisitionMode: 'S',
            assetName: 'Stacja robocza serwerowa',
            kstSymbol: '487',
            depreciationMethod: 'L',
            annualRatePercent: 30,
            initialValueGrosze: 1_500_000,
            annualTaxDepreciationGrosze: 375_000,
            cumulativeTaxDepreciationGrosze: 375_000,
            hasKsefDocument: 1,
          },
        ],
      },
    });
    expect(stPkpir.xsdValidation.valid).toBe(true);

    const stEwp = prepareValidatedJpkExport({
      structureCode: 'JPK_ST(1)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-02-10T10:00:00Z',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        taxOfficeCode: '1435',
        subject: NATURAL_SUBJECT,
        registerBranch: 'EWP',
        rows: [
          {
            assetKind: 'tangible',
            acquisitionDate: '2026-03-01',
            acceptanceDate: '2026-03-01',
            acquisitionMode: 'S',
            assetName: 'Samochód osobowy',
            kstSymbol: '741',
            annualRatePercent: 20,
            initialValueGrosze: 9_000_000,
          },
        ],
      },
    });
    expect(stEwp.xsdValidation.valid).toBe(true);

    // 4. JPK_KR_PD(1) + unbalanced journal rejection
    const krPd = prepareValidatedJpkExport({
      structureCode: 'JPK_KR_PD(1)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-03-20T12:00:00Z',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
        financialYearFrom: '2026-01-01',
        financialYearTo: '2026-12-31',
        taxYearFrom: '2026-01-01',
        taxYearTo: '2026-12-31',
        taxOfficeCode: '1435',
        companyNip: '5261040828',
        companyFullName: 'Pełne Księgi Sp. z o.o.',
        companyRegon: '142233445',
        address: CORPORATE_ADDRESS,
        counterparties: [{ code: 'KONTRAHENT_01', countryCode: 'PL', tin: '9542752600' }],
        zois7Accounts: [
          {
            accountId: '201',
            accountName: 'Rozrachunki z odbiorcami',
            accountTypeLabel: 'Bilansowe aktywne',
            openingDebitGrosze: 0,
            openingCreditGrosze: 0,
            turnoverPeriodDebitGrosze: 1_230_000,
            turnoverPeriodCreditGrosze: 0,
            turnoverCumulativeDebitGrosze: 1_230_000,
            turnoverCumulativeCreditGrosze: 0,
            closingDebitGrosze: 1_230_000,
            closingCreditGrosze: 0,
            balanceSheetTagS12_1: 'BAAII1a_W',
          },
          {
            accountId: '700',
            accountName: 'Przychody ze sprzedaży usług',
            accountTypeLabel: 'Wynikowe',
            openingDebitGrosze: 0,
            openingCreditGrosze: 0,
            turnoverPeriodDebitGrosze: 0,
            turnoverPeriodCreditGrosze: 1_000_000,
            turnoverCumulativeDebitGrosze: 0,
            turnoverCumulativeCreditGrosze: 1_000_000,
            closingDebitGrosze: 0,
            closingCreditGrosze: 1_000_000,
            balanceSheetTagS12_1: 'BAAI1_W',
            taxTagS12_3: 'PD1',
          },
        ],
        journalEntries: [
          {
            journalName: 'Dziennik główny',
            counterpartyCode: 'KONTRAHENT_01',
            documentNumber: 'FV/2026/05/01',
            documentKind: 'Faktura sprzedaży',
            operationDate: '2026-05-12',
            documentDate: '2026-05-12',
            postingDate: '2026-05-12',
            operatorName: 'Główny Księgowy',
            description: 'Sprzedaż usług doradczych',
            journalAmountGrosze: 1_230_000,
            ksefNumber: ksefNo,
            postings: [
              {
                description: 'Należność brutto od odbiorcy',
                accountId: '201',
                side: 'Wn',
                amountGrosze: 1_230_000,
              },
              {
                description: 'Przychód netto ze sprzedaży',
                accountId: '700',
                side: 'Ma',
                amountGrosze: 1_000_000,
              },
              {
                description: 'VAT należny 23%',
                accountId: '222',
                side: 'Ma',
                amountGrosze: 230_000,
              },
            ],
          },
        ],
      },
    });
    expect(krPd.xsdValidation.valid).toBe(true);

    // 5. JPK_ST_KR(1)
    const stKr = prepareValidatedJpkExport({
      structureCode: 'JPK_ST_KR(1)',
      payload: {
        purpose: 1,
        generatedAtIso: '2027-03-20T12:00:00Z',
        financialYearFrom: '2026-01-01',
        financialYearTo: '2026-12-31',
        taxOfficeCode: '1435',
        companyNip: '5261040828',
        companyFullName: 'Pełne Księgi Sp. z o.o.',
        address: CORPORATE_ADDRESS,
        assets: [
          {
            inventoryNumber: 'ST/2026/0001',
            assetKind: 'tangible',
            acquisitionDate: '2026-01-15',
            acceptanceDate: '2026-01-16',
            acceptanceDocumentNumber: 'OT/2026/0001',
            acquisitionMode: 'S',
            assetName: 'Klaster obliczeniowy',
            kstSymbol: '487',
            depreciationMethod: 'L',
            accountingRatePercent: 20,
            accountingAnnualAmountGrosze: 400_000,
            accountingInitialValueGrosze: 2_000_000,
            depreciationFrequency: 'M',
            accountingPeriodDepreciationGrosze: 400_000,
            accountingCumulativeDepreciationGrosze: 400_000,
            taxInitialValueGrosze: 2_000_000,
            taxRatePercent: 30,
            taxAnnualAmountGrosze: 600_000,
            taxPeriodDepreciationGrosze: 600_000,
            taxCumulativeDepreciationGrosze: 600_000,
            hasKsefDocument: 1,
          },
        ],
      },
    });
    expect(stKr.xsdValidation.valid).toBe(true);

    // 6. Tampered JPK XML must fail offline XSD validation closed
    const tamperedV7Xml = pkpir.xmlContent.replace(
      '<WariantFormularza>3</WariantFormularza>',
      '<WariantFormularza>99</WariantFormularza>',
    );
    expect(() => finalizeValidatedJpkXml('JPK_PKPIR(3)', tamperedV7Xml)).toThrowError(
      JpkXsdValidationFailedError,
    );
  });
});
