import { describe, expect, it } from 'vitest';
import {
  AccountingWorkspaceConflictError,
  AccountingWorkspaceService,
  AccountingWorkspaceValidationError,
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '../src/index.js';

describe('Wave 2 Financial & Tax Invariants (#109, #111, #116, #81, #112/#108 MCP Port)', () => {
  it('#109 (GLD-06): enforces server-side assertAccountingRegimeSupportsAction (422 incompatible_tax_regime) across manual books, approval overrides, and settings profile mutation when posted entries exist', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // 1. Educational GET views remain readable, while manual writes into incompatible books fail with 422 incompatible_tax_regime
    expect(ws.getRyczaltView(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, '2026-03').entries).toEqual([]);

    try {
      ws.createRyczaltManualEntry(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        revenueDate: '2026-03-15',
        documentNumber: 'ILLEGAL-RYCZ-ON-KPIR/01',
        counterpartyName: 'Kontrahent Test',
        rate: '12',
        revenueGrosze: 50_000,
      });
      expect.unreachable('Powinno rzucić 422 incompatible_tax_regime');
    } catch (err) {
      expect(err).toBeInstanceOf(AccountingWorkspaceValidationError);
      expect((err as AccountingWorkspaceValidationError).statusCode).toBe(422);
      expect((err as AccountingWorkspaceValidationError).reasonCode).toBe(
        'incompatible_tax_regime',
      );
    }

    expect(() =>
      ws.createJournalEntry(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        documentNumber: 'ILLEGAL-GL-ON-KPIR/01',
        description: 'Niedozwolony dekret KH w JDG KPiR',
        lines: [
          { accountCode: '402', side: 'Wn', amountGrosze: 10_000, description: 'Koszt' },
          { accountCode: '130', side: 'Ma', amountGrosze: 10_000, description: 'Bank' },
        ],
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    expect(() =>
      ws.createKpirManualEntry(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
        eventDate: '2026-03-15',
        documentNumber: 'ILLEGAL-KPIR-ON-RYCZ/01',
        counterpartyName: 'Kontrahent Test',
        entryKind: 'sales_revenue',
        netGrosze: 50_000,
        vatRate: 'zw',
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    expect(() =>
      ws.createKpirManualEntry(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
        eventDate: '2026-03-15',
        documentNumber: 'ILLEGAL-KPIR-ON-SPZOO/01',
        counterpartyName: 'Kontrahent Test',
        entryKind: 'sales_revenue',
        netGrosze: 50_000,
        vatRate: '23',
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    // 2. Incompatible override on approveAndPostDocument fails with 422 incompatible_tax_regime
    const kpirDraft = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/REGIME-OVR/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-18',
      counterpartyName: 'Klient Test Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [{ description: 'Usługa doradcza', netGrosze: 100_000, vatRate: '23' }],
    });
    expect(() =>
      ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, kpirDraft.documentId, {
        ledgerAccountCode: '700',
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    // 3. Blocking tax-profile mutation when posted entries exist, while allowing it on an empty JDG company
    expect(() =>
      ws.updateCompanySettings(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        profileCode: 'jdg_ryczalt',
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    const { company: emptyJdg } = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Nowa Pusta JDG Test',
      nip: '5261040828',
      legalForm: 'jdg',
      taxRegime: 'kpir_skala',
      vatStatus: 'zwolniony',
      activityStartDate: '2026-01-01',
    });
    const switchedEmpty = ws.updateCompanySettings(jan, TENANT_1_ID, emptyJdg.legalEntityId, {
      profileCode: 'jdg_ryczalt',
    });
    expect(switchedEmpty.taxProfile.profileCode).toBe('jdg_ryczalt');
  });

  it('#111 (GLD-07): Sp. z o.o. bank statement import & manual reconciliation (partial split, reallocation unwind, 0-reset, idempotent retry) emit balanced 130 <-> 201/202 journal entries', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');
    const { company } = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Sp. z o.o. Bank GL Test',
      nip: '5261040828',
      legalForm: 'sp_z_o_o',
      taxRegime: 'cit_klasyczny',
      vatStatus: 'czynny',
      activityStartDate: '2026-01-01',
    });
    const compId = company.legalEntityId;

    // Opening balance: 130 Wn 50 000 zł / 800 Ma 50 000 zł
    ws.createJournalEntry(jan, TENANT_1_ID, compId, {
      entryNumber: 'BO/2026/01',
      bookingDate: '2026-01-02',
      documentDate: '2026-01-02',
      documentNumber: 'BO-2026',
      description: 'Kapitał zakładowy na rachunku 130',
      lines: [
        { accountCode: '130', side: 'Wn', amountGrosze: 5_000_000, description: 'Rachunek 130' },
        { accountCode: '800', side: 'Ma', amountGrosze: 5_000_000, description: 'Kapitał 800' },
      ],
    });

    // Two sales invoices: Inv A = 1 230,00 zł gross (1000+230), Inv B = 1 230,00 zł gross (1000+230)
    const invA = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      compId,
      ws.createDocument(jan, TENANT_1_ID, compId, {
        documentNumber: 'FV/SPZOO-GL/A',
        direction: 'sales',
        issueDate: '2026-03-05',
        counterpartyName: 'Odbiorca A Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        lines: [{ description: 'Wdrożenie A', netGrosze: 100_000, vatRate: '23' }],
      }).documentId,
    );
    const invB = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      compId,
      ws.createDocument(jan, TENANT_1_ID, compId, {
        documentNumber: 'FV/SPZOO-GL/B',
        direction: 'sales',
        issueDate: '2026-03-06',
        counterpartyName: 'Odbiorca B Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
        lines: [{ description: 'Wdrożenie B', netGrosze: 100_000, vatRate: '23' }],
      }).documentId,
    );

    // Import 1 230,00 zł credit transfer referencing FV/SPZOO-GL/A (auto-matches Inv A!)
    const csv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-10;2026-03-10;Odbiorca A Sp. z o.o.;;Zapłata za FV/SPZOO-GL/A;1230,00;PLN;TX-SPZOO-1230',
    ].join('\n');
    const imp1 = ws.importBankStatement(jan, TENANT_1_ID, compId, {
      format: 'csv',
      rawContent: csv,
      applySettlements: true,
    });
    expect(imp1.matchedExactCount).toBe(1);

    // Retry identical bank import -> 0 new journal entries!
    const jeCountAfterFirstImport = ws.getLedgerView(jan, TENANT_1_ID, compId, '2026-03')
      .journalEntries.length;
    ws.importBankStatement(jan, TENANT_1_ID, compId, {
      format: 'csv',
      rawContent: csv,
      applySettlements: true,
    });
    const ledgerAfterAuto = ws.getLedgerView(jan, TENANT_1_ID, compId, '2026-03');
    expect(ledgerAfterAuto.journalEntries).toHaveLength(jeCountAfterFirstImport);
    expect(ledgerAfterAuto.trialBalance.isBalanced).toBe(true);
    expect(ledgerAfterAuto.balanceSheet.isBalanced).toBe(true);

    // Account 130 ending balance = 50 000 + 1 230 = 51 230,00 zł; Account 201 ending balance = 1 230,00 zł (only Inv B remains open!)
    const row130 = ledgerAfterAuto.trialBalance.rows.find((r) => r.accountCode === '130')!;
    const row201 = ledgerAfterAuto.trialBalance.rows.find((r) => r.accountCode === '201')!;
    expect(row130.endingBalanceWnGrosze).toBe(5_123_000);
    expect(row201.endingBalanceWnGrosze).toBe(123_000);

    // Split 1 230,00 zł across Inv A (615,00 zł) + Inv B (615,00 zł)
    const txId = imp1.finance.bankTransactions[0]!.transactionId;
    ws.reconcileBank(jan, TENANT_1_ID, compId, {
      matches: [
        {
          transactionId: txId,
          settlementId: invA.postingResult!.settlementId!,
          amountGrosze: 61_500,
        },
        {
          transactionId: txId,
          settlementId: invB.postingResult!.settlementId!,
          amountGrosze: 61_500,
        },
      ],
    });
    const ledgerAfterSplit = ws.getLedgerView(jan, TENANT_1_ID, compId, '2026-03');
    expect(ledgerAfterSplit.trialBalance.isBalanced).toBe(true);
    expect(ledgerAfterSplit.balanceSheet.isBalanced).toBe(true);
    expect(
      ledgerAfterSplit.trialBalance.rows.find((r) => r.accountCode === '130')!
        .endingBalanceWnGrosze,
    ).toBe(5_123_000);
    expect(
      ledgerAfterSplit.trialBalance.rows.find((r) => r.accountCode === '201')!
        .endingBalanceWnGrosze,
    ).toBe(123_000);

    // Unmatch (0-reset) -> 130 returns to 50 000,00 zł and 201 returns to 2 460,00 zł!
    ws.reconcileBank(jan, TENANT_1_ID, compId, {
      transactionId: txId,
      settlementId: invA.postingResult!.settlementId!,
      amountGrosze: 0,
    });
    const ledgerAfterReset = ws.getLedgerView(jan, TENANT_1_ID, compId, '2026-03');
    expect(ledgerAfterReset.trialBalance.isBalanced).toBe(true);
    expect(
      ledgerAfterReset.trialBalance.rows.find((r) => r.accountCode === '130')!
        .endingBalanceWnGrosze,
    ).toBe(5_000_000);
    expect(
      ledgerAfterReset.trialBalance.rows.find((r) => r.accountCode === '201')!
        .endingBalanceWnGrosze,
    ).toBe(246_000);
  });

  it('#116 (GLD-08): enforces period close checklist, blocks retroactive writes across all paths with 409 period_closed, and allows audited corrections in subsequent open period', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // Firma 1 (COMPANY_JDG_KPIR_ID) has an unverified XML draft + pending MCP proposal in 2026-03 -> readyToClose=false!
    const f1Status = ws.getPeriodCloseStatus(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, '2026-03');
    expect(f1Status.status).toBe('open');
    expect(f1Status.readyToClose).toBe(false);
    expect(f1Status.blockingItemsCount).toBeGreaterThanOrEqual(2);
    expect(() =>
      ws.closeAccountingPeriod(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, '2026-03', {
        confirmClose: true,
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    // Firma 3 (COMPANY_SPZOO_ID) has 0 unverified docs/proposals/unreconciled txs in 2026-03 -> transitions open -> reconciling -> closed!
    const spzooReconciling = ws.closeAccountingPeriod(
      jan,
      TENANT_1_ID,
      COMPANY_SPZOO_ID,
      '2026-03',
      {
        confirmClose: false,
        status: 'reconciling',
        note: 'Weryfikacja sald przed zamknięciem marca',
      },
    );
    expect(spzooReconciling.status).toBe('reconciling');

    const spzooClosed = ws.closeAccountingPeriod(jan, TENANT_1_ID, COMPANY_SPZOO_ID, '2026-03', {
      confirmClose: true,
      note: 'Zamknięcie ksiąg marca 2026 po uzgodnieniu ZOiS',
    });
    expect(spzooClosed.status).toBe('closed');
    expect(spzooClosed.closedByUserId).toBe(jan.userId);

    // Retroactive journal entry & document approval in closed 2026-03 fail with 409 period_closed
    try {
      ws.createJournalEntry(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
        bookingDate: '2026-03-30',
        documentDate: '2026-03-30',
        documentNumber: 'PK/CLOSED/2026/03',
        description: 'Próba księgowania do zamkniętego marca',
        lines: [
          { accountCode: '402', side: 'Wn', amountGrosze: 10_000, description: 'Koszt' },
          { accountCode: '130', side: 'Ma', amountGrosze: 10_000, description: 'Bank' },
        ],
      });
      expect.unreachable('Powinno rzucić 409 period_closed');
    } catch (err) {
      expect(err).toBeInstanceOf(AccountingWorkspaceConflictError);
      expect((err as AccountingWorkspaceConflictError).reasonCode).toBe('period_closed');
    }

    const marchLateDraft = ws.createDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FZ/LATE-MARCH/01',
      direction: 'purchase',
      issueDate: '2026-03-28',
      eventDate: '2026-03-28',
      counterpartyName: 'Dostawca Spóźniony Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
      lines: [{ description: 'Usługa marcowa', netGrosze: 20_000, vatRate: '23' }],
    });
    expect(() =>
      ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, marchLateDraft.documentId),
    ).toThrow(AccountingWorkspaceConflictError);

    // Correction booked in open 2026-04 referencing closed 2026-03 invoice SUCCEEDS cleanly!
    const aprilCorrection = ws.createDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FK/APRIL-CORR/2026/04/01',
      direction: 'sales',
      issueDate: '2026-04-05',
      eventDate: '2026-04-05',
      counterpartyName: 'Kontrahent Korporacyjny Test Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
      isCorrection: true,
      correctedDocumentNumber: 'FV-SPZOO/2026/03/01',
      correctionReason: 'Rabat posprzedażowy ujęty w otwartym kwietniu po zamknięciu marca',
      lines: [{ description: 'Rabat 23%', netGrosze: -50_000, vatRate: '23' }],
    });
    const postedAprilCorr = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_SPZOO_ID,
      aprilCorrection.documentId,
      {},
    );
    expect(postedAprilCorr.status).toBe('posted');

    // Also close Ryczałt 2026-03 and verify manual ryczałt write is blocked with 409 period_closed
    ws.closeAccountingPeriod(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, '2026-03', {
      confirmClose: true,
    });
    expect(() =>
      ws.createRyczaltManualEntry(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
        revenueDate: '2026-03-29',
        documentNumber: 'RS/CLOSED/01',
        counterpartyName: 'Klient Test',
        rate: '12',
        revenueGrosze: 10_000,
      }),
    ).toThrow(AccountingWorkspaceConflictError);
  });

  it('#81 (GLD-06 & GLD-07): separates accrued (naliczone) vs paid (opłacone) obligations, deducts ONLY paid ZUS in KPiR & Ryczałt, and enforces 19% CIT unless 9% eligibility is explicitly attested', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // 1. Ryczałt (Firma 2): without verified ZUS payment, paidGrosze = 0 and ryczałt does NOT deduct unpaid ZUS!
    const ryczBeforePay = ws.getPeriodTaxObligations(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_RYCZALT_ID,
      '2026-03',
    );
    const zusSocialBefore = ryczBeforePay.items.find((i) => i.obligationKind === 'zus_social')!;
    const ryczTaxBefore = ryczBeforePay.items.find((i) => i.obligationKind === 'ryczalt_advance')!;
    expect(zusSocialBefore.accruedGrosze).toBeGreaterThan(0);
    expect(zusSocialBefore.paidGrosze).toBe(0);
    expect(zusSocialBefore.status).not.toBe('paid');
    // 18 000,00 zł @ 12% without ZUS deduction = 2 160,00 zł (216 000 gr)
    expect(ryczTaxBefore.accruedGrosze).toBe(216_000);

    // Import ZUS transfer & record verified ZUS social payment -> ryczałt tax drops!
    const zusCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      `2026-03-15;2026-03-15;Zakład Ubezpieczeń Społecznych;;Składka ZUS społeczna 2026-03;-${(zusSocialBefore.accruedGrosze / 100).toFixed(2).replace('.', ',')};PLN;ZUS-SOC-2026-03`,
    ].join('\n');
    const impZus = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
      format: 'csv',
      rawContent: zusCsv,
      applySettlements: false,
    });
    const zusBankTxId = impZus.finance.bankTransactions[0]!.transactionId;
    ws.recordVerifiedTaxPayment(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
      obligationKind: 'zus_social',
      targetPeriod: '2026-03',
      paidDate: '2026-03-15',
      amountGrosze: zusSocialBefore.accruedGrosze,
      bankTransactionId: zusBankTxId,
    });

    const ryczAfterPay = ws.getPeriodTaxObligations(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_RYCZALT_ID,
      '2026-03',
    );
    const zusSocialAfter = ryczAfterPay.items.find((i) => i.obligationKind === 'zus_social')!;
    const ryczTaxAfter = ryczAfterPay.items.find((i) => i.obligationKind === 'ryczalt_advance')!;
    expect(zusSocialAfter.paidGrosze).toBe(zusSocialBefore.accruedGrosze);
    expect(zusSocialAfter.status).toBe('paid');
    expect(ryczTaxAfter.accruedGrosze).toBeLessThan(ryczTaxBefore.accruedGrosze);

    // 2. Sp. z o.o. CIT: newly created Sp. z o.o. WITHOUT explicit 9% attestation defaults to 19% CIT!
    const { company: unattestedSpzoo } = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Niepoświadczona Sp. z o.o. 19%',
      nip: '5261040828',
      legalForm: 'sp_z_o_o',
      taxRegime: 'cit_klasyczny',
      vatStatus: 'czynny',
      activityStartDate: '2024-01-01',
    });
    const sDoc = ws.createDocument(jan, TENANT_1_ID, unattestedSpzoo.legalEntityId, {
      documentNumber: 'FV/CIT19/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-10',
      counterpartyName: 'Klient CIT 19% S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [{ description: 'Usługa B2B 10 000 zł', netGrosze: 1_000_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, unattestedSpzoo.legalEntityId, sDoc.documentId);

    const citObl = ws.getPeriodTaxObligations(
      jan,
      TENANT_1_ID,
      unattestedSpzoo.legalEntityId,
      '2026-03',
    );
    expect(citObl.citRateDetails?.operatingAppliedRatePct).toBe(19);
    // 10 000 zł * 19% = 1 900,00 zł (190 000 gr)
    expect(citObl.items.find((i) => i.obligationKind === 'cit_advance')?.accruedGrosze).toBe(
      190_000,
    );

    // Requesting 9% without priorYearGrossSalesGrosze / attestation fails closed with 422!
    expect(() =>
      ws.getPeriodTaxObligations(jan, TENANT_1_ID, unattestedSpzoo.legalEntityId, '2026-03', {
        requestPreferentialCit9Pct: true,
      }),
    ).toThrow(AccountingWorkspaceValidationError);
  });

  it('MCP Domain Port (#112 + #108 + #116): forwards multi-line PrepareInvoiceLineDraft (23% + 8%) on confirmPreparedProposal and persists applyConfirmedBankReconciliation with Sp. z o.o. GL 130 <-> 201', async () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');
    const marta = ws.resolveActorFromPersona('marta-ksiegowa');

    const verifier = {
      async verifyAccessToken(rawToken: string) {
        if (rawToken === 'tok-agent-prepare') {
          return {
            ok: true as const,
            identity: {
              issuer: 'https://idp.example.test',
              subject: jan.userId,
              audience: ['pap-api'],
              scopes: ['openid', 'pap:mcp:read', 'pap:mcp:prepare'],
              issuedAtEpochSeconds: 1_700_000_000,
              expiresAtEpochSeconds: 1_900_000_000,
            },
          };
        }
        if (rawToken === 'tok-human-marta') {
          return {
            ok: true as const,
            identity: {
              issuer: 'https://idp.example.test',
              subject: marta.userId,
              audience: ['pap-api'],
              scopes: ['openid', 'pap:ui:accounting', 'pap:mcp:read', 'pap:mcp:prepare'],
              issuedAtEpochSeconds: 1_700_000_000,
              expiresAtEpochSeconds: 1_900_000_000,
            },
          };
        }
        return { ok: false as const, reason: 'invalid_signature' as const };
      },
    };
    const gw = ws.createBoundMcpGateway(verifier);

    // 1. Multi-line MCP invoice (23% + 8% decimal string lines) -> human challenge -> confirm -> preserves 2 VAT rows!
    const prepInv = await gw.prepareInvoiceAndPostingProposal(
      { rawBearerToken: 'tok-agent-prepare' },
      {
        tenantId: TENANT_1_ID,
        legalEntityId: COMPANY_SPZOO_ID,
        idempotencyKey: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbb1',
        invoice: {
          direction: 'sales',
          invoiceNumber: 'FV/MCP-MULTILINE/2026/04/01',
          issueDate: '2026-04-10',
          dueDate: '2026-04-24',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
          counterpartyName: 'Klient MCP Wielostawkowy Sp. z o.o.',
          netAmountPln: '300.00',
          vatAmountPln: '39.00',
          grossAmountPln: '339.00',
          expenseDescription: 'Wdrożenie 23% oraz dokumentacja 8%',
          suggestedCategory: 'przychod_sprzedaz',
          lines: [
            {
              description: 'Wdrożenie systemu 23%',
              quantity: '1',
              unit: 'usł.',
              netAmountPln: '100.00',
              vatRate: '23',
              vatAmountPln: '23.00',
              grossAmountPln: '123.00',
            },
            {
              description: 'Publikacja dokumentacyjna 8%',
              quantity: '2',
              unit: 'egz.',
              netAmountPln: '200.00',
              vatRate: '8',
              vatAmountPln: '16.00',
              grossAmountPln: '216.00',
            },
          ],
        },
      },
    );
    expect(prepInv.ok).toBe(true);
    if (!prepInv.ok) return;

    const chInv = await gw.issueHumanConfirmationChallenge({
      humanBearerToken: 'tok-human-marta',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      proposalId: prepInv.data.proposalId,
    });
    expect(chInv.ok).toBe(true);
    if (!chInv.ok) return;

    const confInv = await gw.confirmPreparedProposal(
      { rawBearerToken: 'tok-human-marta' },
      {
        tenantId: TENANT_1_ID,
        legalEntityId: COMPANY_SPZOO_ID,
        proposalId: prepInv.data.proposalId,
        expectedPayloadHash: prepInv.data.payloadHash,
        confirmationCode: chInv.confirmationCode,
        idempotencyKey: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbb2',
      },
    );
    expect(confInv.ok).toBe(true);
    if (!confInv.ok) return;

    const postedDoc = ws.getDocument(
      jan,
      TENANT_1_ID,
      COMPANY_SPZOO_ID,
      confInv.data.ledgerEntryId,
    );
    expect(postedDoc.document.lines).toHaveLength(2);
    const aprilVat = ws.getVatView(jan, TENANT_1_ID, COMPANY_SPZOO_ID, '2026-04');
    expect(
      aprilVat.salesEntries.filter((e) => e.documentNumber === 'FV/MCP-MULTILINE/2026/04/01'),
    ).toHaveLength(2);

    // 2. MCP Bank Reconciliation maker-checker -> persists settlement + Sp. z o.o. 130 <-> 201 GL entry!
    const bankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-04-15;2026-04-15;Klient MCP Wielostawkowy Sp. z o.o.;;Przelew częściowy;339,00;PLN;MCP-BANK-339',
    ].join('\n');
    ws.importBankStatement(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      format: 'csv',
      rawContent: bankCsv,
      applySettlements: false,
    });

    const unrecList = await gw.listUnreconciledBankTransactions(
      { rawBearerToken: 'tok-agent-prepare' },
      { tenantId: TENANT_1_ID, legalEntityId: COMPANY_SPZOO_ID, period: '2026-04' },
    );
    expect(unrecList.ok).toBe(true);
    if (!unrecList.ok) return;
    const mcpBankTxId = unrecList.data.transactions[0]!.bankTransactionId;

    const prepBank = await gw.prepareBankReconciliation(
      { rawBearerToken: 'tok-agent-prepare' },
      {
        tenantId: TENANT_1_ID,
        legalEntityId: COMPANY_SPZOO_ID,
        bankTransactionId: mcpBankTxId,
        invoiceId: postedDoc.documentId,
        allocationGrossPln: '339.00',
        idempotencyKey: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbb3',
      },
    );
    expect(prepBank.ok).toBe(true);
    if (!prepBank.ok) return;

    const chBank = await gw.issueHumanConfirmationChallenge({
      humanBearerToken: 'tok-human-marta',
      tenantId: TENANT_1_ID,
      legalEntityId: COMPANY_SPZOO_ID,
      proposalId: prepBank.data.proposalId,
      proposalKind: 'bank_reconciliation',
    });
    expect(chBank.ok).toBe(true);
    if (!chBank.ok) return;

    const confBank = await gw.confirmBankReconciliationProposal(
      { rawBearerToken: 'tok-human-marta' },
      {
        tenantId: TENANT_1_ID,
        legalEntityId: COMPANY_SPZOO_ID,
        proposalId: prepBank.data.proposalId,
        expectedPayloadHash: prepBank.data.payloadHash,
        confirmationCode: chBank.confirmationCode,
        idempotencyKey: 'aaaaaaaa-1111-4222-8333-bbbbbbbbbbb4',
      },
    );
    expect(confBank.ok).toBe(true);
    if (!confBank.ok) return;
    expect(confBank.data.remainingInvoiceGrossAfterPln).toBe('0.00');

    // Verify Finance settlement is 0.00 AND Sp. z o.o. Ledger 130 increased by 339,00 zł!
    const finAfter = ws.getFinanceView(jan, TENANT_1_ID, COMPANY_SPZOO_ID);
    const settledInv = finAfter.settlements.find((s) => s.documentId === postedDoc.documentId)!;
    expect(settledInv.remainingGrosze).toBe(0);

    const ledgerApril = ws.getLedgerView(jan, TENANT_1_ID, COMPANY_SPZOO_ID, '2026-04');
    expect(ledgerApril.trialBalance.isBalanced).toBe(true);
    expect(
      ledgerApril.journalEntries.some((je) =>
        je.lines.some((l) => l.accountCode === '130' && l.amountGrosze === 33_900),
      ),
    ).toBe(true);
  });
});
