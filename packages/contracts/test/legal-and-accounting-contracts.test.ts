import { describe, expect, it } from 'vitest';
import {
  AccountingDocumentSchema,
  BankReconciliationMatchSchema,
  BankStatementTransactionSchema,
  IsoCalendarDateSchema,
  JournalEntrySchema,
  KpirEntrySchema,
  LegalExplanationSchema,
  LegalRuleSchema,
  RyczaltEntrySchema,
  TaxCalendarObligationSchema,
  TaxProfileConfigSchema,
  VatRegisterEntrySchema,
} from '../src/index.js';

const sampleExplanation = {
  calculationType: 'vat_register_entry',
  summary: 'Wpis VAT testowy',
  eventDate: '2026-04-15',
  appliedRules: [
    {
      id: 'vat-rates-2025-2026',
      ruleCode: 'VAT_RATES_STANDARD_AND_REDUCED',
      version: '2025.1',
      title: 'Stawki VAT 23%, 8%, 5%',
      actTitle: 'Ustawa o VAT',
      journalReference: 'Dz.U. z 2025 r. poz. 775',
      article: 'art. 41 ust. 1 i art. 146ef ust. 1',
      sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20240000361',
      sourceType: 'statute' as const,
      verificationStatus: 'verified' as const,
      validFrom: '2025-01-01',
      validTo: '2026-12-31',
    },
  ],
  steps: [
    {
      stepNumber: 1,
      label: 'Obliczenie brutto',
      formula: 'netto + vat',
      inputs: { netGrosze: 100_000, vatGrosze: 23_000 },
      resultFormatted: '1 230,00 zł',
      resultGrosze: 123_000,
    },
  ],
  inputs: { netGrosze: 100_000 },
  outputs: { grossGrosze: 123_000 },
  warnings: [],
  requiresHumanApproval: false,
};

describe('@pap/contracts — legal rules & accounting schemas', () => {
  it('accepts a valid LegalRule contract with official HTTPS source and reference test cases', () => {
    const parsed = LegalRuleSchema.parse({
      id: 'vat-exemption-2026',
      ruleCode: 'VAT_EXEMPTION_LIMIT_ART_113',
      version: '2026.1',
      title: 'Limit zwolnienia VAT 240 000 zł',
      description: 'Limit od 2026 r.',
      scope: ['jdg_kpir_skala', 'jdg_ryczalt'],
      validFrom: '2026-01-01',
      validTo: null,
      legalBasis: {
        actTitle: 'Ustawa o zmianie ustawy o VAT',
        journalReference: 'Dz.U. z 2025 r. poz. 896',
        article: 'art. 113 ust. 1',
      },
      sourceUrl: 'https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000896',
      sourceType: 'statute',
      verifiedAt: '2026-11-04',
      verificationStatus: 'verified',
      exceptions: ['Wyłączenia z art. 113 ust. 13'],
      referenceTestCases: [
        {
          id: 'tc-1',
          description: 'Limit roczny 240k',
          eventDate: '2026-03-01',
          inputSummary: '220 000 zł',
          expectedOutputSummary: 'zwolniony',
        },
      ],
      parameters: {
        annualLimitGrosze: 24_000_000,
      },
    });

    expect(parsed.id).toBe('vat-exemption-2026');
  });

  it('rejects LegalRule with non-HTTPS sourceUrl or validTo earlier than validFrom', () => {
    expect(() =>
      LegalRuleSchema.parse({
        id: 'bad-rule',
        ruleCode: 'TEST',
        version: '1.0',
        title: 'Bad',
        description: 'Bad',
        scope: ['jdg_kpir_skala'],
        validFrom: '2026-05-01',
        validTo: '2026-01-01',
        legalBasis: {
          actTitle: 'Ustawa',
          journalReference: 'Dz.U. 2025 poz. 1',
          article: 'art. 1',
        },
        sourceUrl: 'http://podatki.gov.pl/test',
        sourceType: 'statute',
        verifiedAt: '2026-11-04',
        verificationStatus: 'verified',
        exceptions: [],
        referenceTestCases: [
          {
            id: 'tc-1',
            description: 'Test',
            eventDate: '2026-05-01',
            inputSummary: 'a',
            expectedOutputSummary: 'b',
          },
        ],
      }),
    ).toThrow();
  });

  it('validates LegalExplanationSchema', () => {
    const parsed = LegalExplanationSchema.parse(sampleExplanation);
    expect(parsed.appliedRules).toHaveLength(1);
  });

  it('validates TaxProfileConfigSchema for all 4 Polish entity profiles', () => {
    for (const profileCode of [
      'jdg_kpir_skala',
      'jdg_kpir_liniowy',
      'jdg_ryczalt',
      'spzoo_pelne_ksiegi',
    ] as const) {
      const parsed = TaxProfileConfigSchema.parse({
        profileCode,
        supportLevel: profileCode === 'jdg_kpir_skala' ? 'reviewed' : 'experimental',
        nip: '5261040828',
        companyName: 'Syntetyczna Firma Testowa',
        activityStartDate: '2025-01-01',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'monthly',
        zusScheme: profileCode === 'spzoo_pelne_ksiegi' ? 'not_applicable' : 'duzy_zus',
        voluntarySicknessInsurance: true,
        accidentRateBps: 167,
        insuredPersonsCount: 1,
        smallTaxpayer: true,
        ksefSales2024Above200M: false,
      });
      expect(parsed.profileCode).toBe(profileCode);
    }
  });

  it('rejects floating point amounts in grosze schemas', () => {
    expect(() =>
      AccountingDocumentSchema.parse({
        documentId: 'doc-1',
        documentNumber: 'FV/2026/04/01',
        direction: 'sales',
        issueDate: '2026-04-10',
        eventDate: '2026-04-10',
        counterpartyName: 'Klient Sp. z o.o.',
        currency: 'PLN',
        lines: [
          {
            lineNumber: 1,
            description: 'Usługa IT',
            quantity: '1',
            unit: 'szt.',
            netGrosze: 100.5,
            vatRate: '23',
            vatGrosze: 23,
            grossGrosze: 123.5,
            annex15Item: false,
          },
        ],
        totalNetGrosze: 100.5,
        totalVatGrosze: 23,
        totalGrossGrosze: 123.5,
        totalGrossFormatted: '1,24 zł',
      }),
    ).toThrow();
  });

  it('enforces net + vat === gross in AccountingDocumentSchema', () => {
    expect(() =>
      AccountingDocumentSchema.parse({
        documentId: 'doc-2',
        documentNumber: 'FV/2026/04/02',
        direction: 'sales',
        issueDate: '2026-04-10',
        eventDate: '2026-04-10',
        counterpartyName: 'Klient Sp. z o.o.',
        currency: 'PLN',
        lines: [
          {
            lineNumber: 1,
            description: 'Usługa IT',
            quantity: '1',
            unit: 'szt.',
            netGrosze: 100_000,
            vatRate: '23',
            vatGrosze: 23_000,
            grossGrosze: 123_000,
            annex15Item: false,
          },
        ],
        totalNetGrosze: 100_000,
        totalVatGrosze: 23_000,
        totalGrossGrosze: 125_000,
        totalGrossFormatted: '1 250,00 zł',
      }),
    ).toThrow(/totalGrossGrosze/);
  });

  it('enforces column sums and correction reason in KpirEntrySchema', () => {
    const validKpir = KpirEntrySchema.parse({
      id: 'kpir-1',
      ordinalNumber: 1,
      period: '2026-04',
      eventDate: '2026-04-15',
      documentNumber: 'FV/1/2026',
      ksefReferenceNumber: '5261040828-20260415-ABCDEF-12',
      counterpartyName: 'Kontrahent Testowy',
      counterpartyNip: '5261040828',
      counterpartyAddress: 'ul. Prosta 1, 00-001 Warszawa',
      eventDescription: 'Sprzedaż usług programistycznych',
      col7SalesRevenueGrosze: 1_000_000,
      col8OtherRevenueGrosze: 0,
      col9TotalRevenueGrosze: 1_000_000,
      col10GoodsAndMaterialsGrosze: 0,
      col11IncidentalCostsGrosze: 0,
      col12RemunerationGrosze: 0,
      col13OtherExpensesGrosze: 0,
      col14TotalExpensesGrosze: 0,
      col16ResearchDevelopmentCostGrosze: 0,
      qualificationKind: 'none',
      isCorrection: false,
      regulationVersion: 'pkpir_2026_ksef',
      explanation: sampleExplanation,
    });
    expect(validKpir.col9TotalRevenueGrosze).toBe(1_000_000);

    expect(() =>
      KpirEntrySchema.parse({
        ...validKpir,
        isCorrection: true,
      }),
    ).toThrow();
  });

  it('validates RyczaltEntrySchema and VatRegisterEntrySchema invariants', () => {
    const ryczalt = RyczaltEntrySchema.parse({
      id: 'rycz-1',
      ordinalNumber: 1,
      period: '2026-04',
      entryDate: '2026-04-15',
      revenueDate: '2026-04-15',
      documentNumber: 'FV/10/2026',
      counterpartyName: 'Odbiorca IT',
      rate: '12',
      revenueGrosze: 1_500_000,
      revenueFormatted: '15 000,00 zł',
      isCorrection: false,
    });
    expect(ryczalt.rate).toBe('12');

    expect(() =>
      VatRegisterEntrySchema.parse({
        id: 'vat-bad',
        registerType: 'purchase',
        period: '2026-04',
        taxPointDate: '2026-04-15',
        issueDate: '2026-04-15',
        documentNumber: 'FV/ZAK/1',
        counterpartyName: 'Stacja Paliw',
        vatRate: '23',
        netGrosze: 20_000,
        vatTotalGrosze: 4_600,
        grossGrosze: 24_600,
        deductionMode: 'vehicle_mixed_50',
        deductibleVatGrosze: 2_300,
        nonDeductibleVatGrosze: 2_000,
        mandatorySplitPaymentMpp: false,
        ksefMarker: 'NrKSeF',
        ksefReferenceNumber: 'KSEF-123',
        explanation: sampleExplanation,
      }),
    ).toThrow();
  });

  it('enforces Wn === Ma and positive non-storno amounts in JournalEntrySchema', () => {
    const validJournal = JournalEntrySchema.parse({
      id: 'je-1',
      entryNumber: 'PK/2026/04/001',
      period: '2026-04',
      bookingDate: '2026-04-20',
      documentDate: '2026-04-20',
      documentNumber: 'FV/2026/04/10',
      description: 'Sprzedaż usług krajowych',
      lines: [
        {
          lineNumber: 1,
          accountCode: '201',
          side: 'Wn',
          amountGrosze: 123_000,
          description: 'Należność od odbiorcy',
          isRedStorno: false,
        },
        {
          lineNumber: 2,
          accountCode: '700',
          side: 'Ma',
          amountGrosze: 100_000,
          description: 'Przychód netto',
          isRedStorno: false,
        },
        {
          lineNumber: 3,
          accountCode: '221-1',
          side: 'Ma',
          amountGrosze: 23_000,
          description: 'VAT należny 23%',
          isRedStorno: false,
        },
      ],
      totalWnGrosze: 123_000,
      totalMaGrosze: 123_000,
    });
    expect(validJournal.lines).toHaveLength(3);

    expect(() =>
      JournalEntrySchema.parse({
        ...validJournal,
        totalMaGrosze: 120_000,
      }),
    ).toThrow(/podwójnego zapisu/);
  });

  it('validates TaxCalendarObligationSchema and bank reconciliation contracts', () => {
    const obligation = TaxCalendarObligationSchema.parse({
      code: 'VAT_JPK_V7M',
      title: 'Wysyłka JPK_V7M(3)',
      category: 'vat',
      period: '2026-11',
      statutoryDueDate: '2026-12-25',
      effectiveDueDate: '2026-12-28',
      shiftedFromNonWorkingDays: [
        { date: '2026-12-25', reason: 'Święto ustawowe: Pierwszy dzień Bożego Narodzenia' },
      ],
      status: 'applicable',
      explanation: sampleExplanation,
    });
    expect(obligation.effectiveDueDate).toBe('2026-12-28');

    const tx = BankStatementTransactionSchema.parse({
      transactionId: 'tx-1',
      bookingDate: '2026-04-18',
      direction: 'credit',
      amountGrosze: 123_000,
      amountFormatted: '1 230,00 zł',
      currency: 'PLN',
      counterpartyName: 'Klient Sp. z o.o.',
      title: 'Zapłata za FV/2026/04/10',
    });
    expect(tx.amountGrosze).toBe(123_000);

    const match = BankReconciliationMatchSchema.parse({
      transactionId: 'tx-1',
      status: 'matched_exact',
      matchedDocumentId: 'doc-10',
      matchedDocumentNumber: 'FV/2026/04/10',
      candidateDocumentIds: ['doc-10'],
      matchedCriterion: 'invoice_number_and_amount',
      transactionAmountGrosze: 123_000,
      settledAmountGrosze: 123_000,
      remainingDocumentAmountGrosze: 0,
      overpaymentGrosze: 0,
      notes: 'Dopasowano dokładnie.',
    });
    expect(match.status).toBe('matched_exact');
  });

  it('rejects impossible calendar dates in IsoCalendarDateSchema (e.g. 2026-02-31, 2025-02-29) while accepting leap day 2024-02-29', () => {
    expect(IsoCalendarDateSchema.parse('2026-02-28')).toBe('2026-02-28');
    expect(IsoCalendarDateSchema.parse('2024-02-29')).toBe('2024-02-29');

    expect(() => IsoCalendarDateSchema.parse('2026-02-31')).toThrow(
      /Nieistniejąca data kalendarzowa/,
    );
    expect(() => IsoCalendarDateSchema.parse('2025-02-29')).toThrow(
      /Nieistniejąca data kalendarzowa/,
    );
    expect(() => IsoCalendarDateSchema.parse('2026-04-31')).toThrow(
      /Nieistniejąca data kalendarzowa/,
    );
  });
});
