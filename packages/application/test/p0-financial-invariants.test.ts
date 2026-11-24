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

describe('Wave 1 P0 Financial Invariants (#106, #118, #110, #107, #113, #108)', () => {
  it('#106 (GLD-01): Split-View approval with echoed netPln/vatPln and header edits preserves all multi-rate lines (23% + 8%), MPP flags, VAT register rows, JPK fields, and KPiR', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    const created = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/MULTIRATE/2026/04/01',
      direction: 'sales',
      issueDate: '2026-04-10',
      eventDate: '2026-04-10',
      dueDate: '2026-04-24',
      counterpartyName: 'Odbiorca Wielostawkowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [
        {
          description: 'Sprzęt serwerowy (załącznik nr 15)',
          quantity: '2',
          unit: 'szt.',
          netGrosze: 10_000, // 100.00 PLN @ 23% = 23.00 VAT
          vatRate: '23',
          annex15Item: true,
        },
        {
          description: 'Publikacja specjalistyczna (stawka obniżona 8%)',
          quantity: '5',
          unit: 'egz.',
          netGrosze: 20_000, // 200.00 PLN @ 8% = 16.00 VAT
          vatRate: '8',
          annex15Item: false,
        },
      ],
    });

    expect(created.document.lines).toHaveLength(2);
    expect(created.document.totalNetGrosze).toBe(30_000);
    expect(created.document.totalVatGrosze).toBe(3_900);
    expect(created.document.totalGrossGrosze).toBe(33_900);

    // Symulacja payloadu wysyłanego przez Split-View UI (z edycją nagłówka i powtórzonymi sumami 300.00 / 39.00)
    const posted = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      created.documentId,
      {
        documentId: created.documentId,
        documentNumber: 'FV/MULTIRATE/2026/04/01-VERIFIED',
        counterpartyName: 'Odbiorca Wielostawkowy Zweryfikowany Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        issueDate: '2026-04-10',
        netPln: '300.00',
        vatPln: '39.00',
        vatDeductionMode: 'full_100',
      },
    );

    expect(posted.status).toBe('posted');
    expect(posted.document.documentNumber).toBe('FV/MULTIRATE/2026/04/01-VERIFIED');
    expect(posted.document.lines).toHaveLength(2);
    expect(posted.document.lines[0]).toMatchObject({
      lineNumber: 1,
      description: 'Sprzęt serwerowy (załącznik nr 15)',
      quantity: '2',
      unit: 'szt.',
      netGrosze: 10_000,
      vatRate: '23',
      vatGrosze: 2_300,
      grossGrosze: 12_300,
      annex15Item: true,
    });
    expect(posted.document.lines[1]).toMatchObject({
      lineNumber: 2,
      description: 'Publikacja specjalistyczna (stawka obniżona 8%)',
      quantity: '5',
      unit: 'egz.',
      netGrosze: 20_000,
      vatRate: '8',
      vatGrosze: 1_600,
      grossGrosze: 21_600,
      annex15Item: false,
    });
    expect(posted.postingResult?.vatEntryIds).toHaveLength(2);

    const vatView = ws.getVatView(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, '2026-04');
    const docVatSales = vatView.salesEntries.filter(
      (e) => e.documentNumber === 'FV/MULTIRATE/2026/04/01-VERIFIED',
    );
    expect(docVatSales).toHaveLength(2);
    expect(docVatSales.find((e) => e.vatRate === '23')).toMatchObject({
      netGrosze: 10_000,
      vatTotalGrosze: 2_300,
    });
    expect(docVatSales.find((e) => e.vatRate === '8')).toMatchObject({
      netGrosze: 20_000,
      vatTotalGrosze: 1_600,
    });
    expect(vatView.jpkV7m?.fields.P_17).toBe(200);
    expect(vatView.jpkV7m?.fields.P_18).toBe(16);
    expect(vatView.jpkV7m?.fields.P_19).toBe(100);
    expect(vatView.jpkV7m?.fields.P_20).toBe(23);
    expect(vatView.jpkV7m?.fields.P_37).toBe(300);
    expect(vatView.jpkV7m?.fields.P_38).toBe(39);

    // Negatywny przypadek: próba nadpisania sumy netto/VAT na fakturze wielopozycyjnej bez rozbicia pozycji (lines)
    const secondMulti = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/MULTIRATE/2026/04/02',
      direction: 'purchase',
      issueDate: '2026-04-12',
      counterpartyName: 'Dostawca Wielostawkowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [
        { description: 'Usługa 23%', netGrosze: 10_000, vatRate: '23' },
        { description: 'Usługa 8%', netGrosze: 10_000, vatRate: '8' },
      ],
    });

    expect(() =>
      ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, secondMulti.documentId, {
        netPln: '250.00',
        vatPln: '31.00',
      }),
    ).toThrow(AccountingWorkspaceValidationError);
  });

  it('#118 (GLD-02): carries over excess input VAT (P_62 -> P_39) from month M to M+1 consistently across VatView, Dashboard, and Tax Calendar, and honors P_54 refund requests', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    const createdCompany = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Test CarryOver VAT JDG',
      nip: '5261040828',
      legalForm: 'jdg',
      taxRegime: 'kpir_liniowy',
      vatStatus: 'czynny',
      activityStartDate: '2026-01-01',
    });
    const companyId = createdCompany.company.legalEntityId;

    // Styczeń 2026: zakup 1000 zł netto + 230 zł VAT -> nadwyżka 230 zł do przeniesienia (P_53 = 230, P_62 = 230)
    const janPurchase = ws.createDocument(jan, TENANT_1_ID, companyId, {
      documentNumber: 'FZ/VAT/2026/01/01',
      direction: 'purchase',
      issueDate: '2026-01-15',
      eventDate: '2026-01-15',
      counterpartyName: 'Dostawca Styczniowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Infrastruktura styczeń', netGrosze: 100_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, companyId, janPurchase.documentId);

    const janVat = ws.getVatView(jan, TENANT_1_ID, companyId, '2026-01');
    expect(janVat.jpkV7m?.excessInputVatP53Grosze).toBe(23_000);
    expect(janVat.jpkV7m?.carryForwardToNextPeriodP62Grosze).toBe(23_000);
    expect(janVat.jpkV7m?.taxDueP51Grosze).toBe(0);

    // Luty 2026: sprzedaż 1000 zł netto + 230 zł VAT należnego, brak bieżących zakupów -> po przeniesieniu P_39=230 => P_51=0!
    const febSales = ws.createDocument(jan, TENANT_1_ID, companyId, {
      documentNumber: 'FV/VAT/2026/02/01',
      direction: 'sales',
      issueDate: '2026-02-15',
      eventDate: '2026-02-15',
      counterpartyName: 'Klient Lutowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [{ description: 'Usługi programistyczne luty', netGrosze: 100_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, companyId, febSales.documentId);

    const febVat = ws.getVatView(jan, TENANT_1_ID, companyId, '2026-02');
    const febOverview = ws.getCompanyOverview(jan, TENANT_1_ID, companyId, '2026-02');
    const febCalendar = ws.getCalendarView(jan, TENANT_1_ID, companyId, 2026, 2);
    const febVatObligation = febCalendar.obligations.find((o) => o.category === 'vat');

    expect(febVat.jpkV7m?.fields.P_39).toBe(230);
    expect(febVat.jpkV7m?.fields.P_38).toBe(230);
    expect(febVat.jpkV7m?.fields.P_48).toBe(230);
    expect(febVat.jpkV7m?.fields.P_51).toBe(0);
    expect(febVat.jpkV7m?.taxDueP51Grosze).toBe(0);
    expect(febOverview.taxSummary.vatPayableGrosze).toBe(0);
    expect(febOverview.taxSummary.vatCarryForwardGrosze).toBe(0);
    expect(febVatObligation?.estimatedAmountGrosze).toBe(0);
  });

  it('#110 (GLD-05): blocks duplicate manual KPiR/Ryczałt/GL posting for an already-posted document and reconciles cross-channel UI/API/MCP operations cleanly', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // 1. KPiR: zatwierdzona faktura blokuje ręczny duplikat w KPiR, ale dopuszcza jawne storno
    const kpirDoc = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/ANTI-DUP/2026/03/01',
      direction: 'purchase',
      issueDate: '2026-03-18',
      eventDate: '2026-03-18',
      counterpartyName: 'Dostawca Unikalny Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Serwery dedykowane', netGrosze: 50_000, vatRate: '23' }],
    });
    const postedKpirDoc = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      kpirDoc.documentId,
    );

    expect(() =>
      ws.createKpirManualEntry(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        eventDate: '2026-03-18',
        documentNumber: 'FV/ANTI-DUP/2026/03/01',
        counterpartyName: 'Dostawca Unikalny Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
        eventDescription: 'Próba ręcznego zdublowania faktury',
        entryKind: 'other_expenses_100_col13',
        netGrosze: 50_000,
        vatRate: '23',
      }),
    ).toThrow(AccountingWorkspaceConflictError);

    // Jawne storno istniejącego wpisu KPiR jest dozwolone
    const storno = ws.createKpirManualEntry(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      mode: 'storno',
      originalEntryId: postedKpirDoc.postingResult!.kpirEntryId!,
      correctionReason: 'Korekta oczywistej omyłki pisarskiej',
    });
    expect(storno.isCorrection).toBe(true);

    // 2. Ryczałt: zatwierdzona faktura sprzedaży blokuje ręczny duplikat w ewidencji przychodów
    const ryczDoc = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
      documentNumber: 'FV/RYCZ-DUP/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-19',
      counterpartyName: 'Klient Ryczałtowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
      ryczaltRate: '12',
      lines: [{ description: 'Usługi IT ryczałt', netGrosze: 80_000, vatRate: 'zw' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, ryczDoc.documentId);

    expect(() =>
      ws.createRyczaltManualEntry(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
        revenueDate: '2026-03-19',
        documentNumber: 'FV/RYCZ-DUP/2026/03/01',
        counterpartyName: 'Klient Ryczałtowy Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
        rate: '12',
        revenueGrosze: 80_000,
      }),
    ).toThrow(AccountingWorkspaceConflictError);

    // 3. Pełne księgi Sp. z o.o.: zatwierdzona faktura blokuje drugi oryginalny dekret dla tego samego dokumentu
    const glDoc = ws.createDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FV/GL-DUP/2026/03/01',
      direction: 'sales',
      issueDate: '2026-03-20',
      counterpartyName: 'Kontrahent Korporacyjny Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
      lines: [{ description: 'Wdrożenie ERP', netGrosze: 100_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, glDoc.documentId);

    expect(() =>
      ws.createJournalEntry(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
        bookingDate: '2026-03-20',
        documentDate: '2026-03-20',
        documentNumber: 'FV/GL-DUP/2026/03/01',
        description: 'Ręczne powtórzenie faktury sprzedaży',
        lines: [
          { accountCode: '201', side: 'Wn', amountGrosze: 123_000, description: 'Należność' },
          { accountCode: '700', side: 'Ma', amountGrosze: 100_000, description: 'Przychód' },
          { accountCode: '221-1', side: 'Ma', amountGrosze: 23_000, description: 'VAT należny' },
        ],
      }),
    ).toThrow(AccountingWorkspaceConflictError);
  });

  it('#107 & #113 (GLD-03): imports two separate unreferenced CSV/MT940 files without dropping transactions, deduplicates identical retries, and parses comma-delimited CSV properly', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    const csv1 = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-05;2026-03-05;Dostawca Pierwszy;;Opłata parkingowa nr 1;-45,00;PLN;',
    ].join('\n');
    const csv2 = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-09;2026-03-09;Dostawca Drugi;;Opłata autostradowa nr 2;-78,50;PLN;',
    ].join('\n');

    const imp1 = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      format: 'csv',
      rawContent: csv1,
    });
    expect(imp1.importedTransactionsCount).toBe(1);

    const imp2 = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      format: 'csv',
      rawContent: csv2,
    });
    expect(imp2.importedTransactionsCount).toBe(1);
    expect(imp2.finance.bankTransactions).toHaveLength(2);

    // Ponowienie identycznej paczki CSV 1 nie tworzy duplikatów
    const imp1Retry = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      format: 'csv',
      rawContent: csv1,
    });
    expect(imp1Retry.importedTransactionsCount).toBe(0);
    expect(imp1Retry.finance.bankTransactions).toHaveLength(2);

    // #113: CSV rozdzielany przecinkiem z polską kwotą dziesiętną w cudzysłowie
    const commaCsv = [
      'Data księgowania,Data waluty,Kontrahent,Rachunek kontrahenta,Tytuł,Kwota,Waluta,Nr referencyjny',
      '2026-03-11,2026-03-11,"Kontrahent Przecinkowy, Sp. z o.o.",,"Usługa konsultingowa","123,45",PLN,REF-C-1',
    ].join('\n');
    const impComma = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      format: 'csv',
      delimiter: ',',
      rawContent: commaCsv,
    });
    expect(impComma.importedTransactionsCount).toBe(1);
    const commaTx = impComma.finance.bankTransactions.find((t) => t.rawReference === 'REF-C-1');
    expect(commaTx?.amountGrosze).toBe(12_345);
  });

  it('#108 (GLD-04): enforces payment allocation invariants (sum <= tx amount, sum <= invoice balance), idempotent repeat, and atomic reallocation reversal from Invoice A to Invoice B', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    const docA = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FZ/ALLOC-A/2026/03',
      direction: 'purchase',
      issueDate: '2026-03-10',
      counterpartyName: 'Dostawca A Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Usługa A', netGrosze: 10_000, vatRate: 'zw' }],
    });
    const postedA = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      docA.documentId,
    );
    const settlementA = postedA.postingResult!.settlementId!;

    const docB = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FZ/ALLOC-B/2026/03',
      direction: 'purchase',
      issueDate: '2026-03-11',
      counterpartyName: 'Dostawca B Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
      lines: [{ description: 'Usługa B', netGrosze: 10_000, vatRate: 'zw' }],
    });
    const postedB = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      docB.documentId,
    );
    const settlementB = postedB.postingResult!.settlementId!;

    const bankImp = ws.importBankStatement(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      format: 'csv',
      applySettlements: false,
      rawContent: [
        'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
        '2026-03-15;2026-03-15;Przelew wychodzący;;Płatność ręczna;-100,00;PLN;TX-100-PLN',
      ].join('\n'),
    });
    const txId = bankImp.finance.bankTransactions.find(
      (t) => t.rawReference === 'TX-100-PLN',
    )!.transactionId;

    // 1. Uzgodnij z fakturą A -> A zapłacona (100 zł), B otwarta (100 zł)
    const afterMatchA = ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      transactionId: txId,
      settlementId: settlementA,
    });
    expect(afterMatchA.settlements.find((s) => s.settlementId === settlementA)?.status).toBe(
      'paid',
    );
    expect(
      afterMatchA.settlements.find((s) => s.settlementId === settlementB)?.remainingGrosze,
    ).toBe(10_000);

    // 2. Powtórzenie tej samej alokacji A -> idempotentne
    const afterRepeatA = ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      transactionId: txId,
      settlementId: settlementA,
    });
    expect(
      afterRepeatA.settlements.find((s) => s.settlementId === settlementA)?.settledGrosze,
    ).toBe(10_000);

    // 3. Przeniesienie tego samego przelewu na fakturę B -> A musi wrócić do salda 100 zł (open), a B zostaje rozliczona!
    const afterReallocB = ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      transactionId: txId,
      settlementId: settlementB,
    });
    const itemAAfter = afterReallocB.settlements.find((s) => s.settlementId === settlementA)!;
    const itemBAfter = afterReallocB.settlements.find((s) => s.settlementId === settlementB)!;
    expect(itemAAfter.settledGrosze).toBe(0);
    expect(itemAAfter.remainingGrosze).toBe(10_000);
    expect(itemBAfter.settledGrosze).toBe(10_000);
    expect(itemBAfter.remainingGrosze).toBe(0);
    expect(itemBAfter.status).toBe('paid');

    // 4. Próba alokacji powyżej kwoty przelewu (150 zł z przelewu 100 zł) musi zostać odrzucona
    expect(() =>
      ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        transactionId: txId,
        settlementId: settlementA,
        amountGrosze: 15_000,
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    // 5. Wyzerowanie alokacji (amountGrosze: 0) przywraca fakturę B do statusu otwartego
    const afterReset = ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      transactionId: txId,
      settlementId: settlementB,
      amountGrosze: 0,
    });
    expect(
      afterReset.settlements.find((s) => s.settlementId === settlementB)?.remainingGrosze,
    ).toBe(10_000);

    // 6. Podział jednego przelewu 100 zł na dwie faktury po 60 zł + 40 zł w jednej paczce
    const afterSplit = ws.reconcileBank(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      matches: [
        { transactionId: txId, settlementId: settlementA, amountGrosze: 6_000 },
        { transactionId: txId, settlementId: settlementB, amountGrosze: 4_000 },
      ],
    });
    expect(
      afterSplit.settlements.find((s) => s.settlementId === settlementA)?.remainingGrosze,
    ).toBe(4_000);
    expect(
      afterSplit.settlements.find((s) => s.settlementId === settlementB)?.remainingGrosze,
    ).toBe(6_000);
  });

  it('#118, #110 & #112 edge cases: P_54 refund + period finalization guard, cross-channel UI+MCP deduplication/conflict, and explicit VAT rate/lines guards', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // #118: częściowy zwrot P_54 (100 zł z nadwyżki 230 zł) -> P_62 = 130 zł przeniesione na luty + blokada zamkniętego okresu
    const company = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Test Finalize VAT Sp. z o.o.',
      nip: '5261040828',
      legalForm: 'jdg',
      taxRegime: 'kpir_skala',
      vatStatus: 'czynny',
      activityStartDate: '2026-01-01',
    });
    const compId = company.company.legalEntityId;

    const janDoc = ws.createDocument(jan, TENANT_1_ID, compId, {
      documentNumber: 'FZ/P54/2026/01/01',
      direction: 'purchase',
      issueDate: '2026-01-10',
      eventDate: '2026-01-10',
      counterpartyName: 'Dostawca P54 Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Serwery styczeń', netGrosze: 100_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, compId, janDoc.documentId);

    // P_54 powyżej P_53 musi zostać odrzucone (422)
    expect(() =>
      ws.configureVatPeriodSettlement(jan, TENANT_1_ID, compId, {
        period: '2026-01',
        refundRequestedP54Grosze: 30_000,
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    const settledJan = ws.configureVatPeriodSettlement(jan, TENANT_1_ID, compId, {
      period: '2026-01',
      refundRequestedP54Grosze: 10_000,
      finalize: true,
    });
    expect(settledJan.jpkV7m?.refundToBankAccountP54Grosze).toBe(10_000);
    expect(settledJan.jpkV7m?.carryForwardToNextPeriodP62Grosze).toBe(13_000);
    expect(settledJan.jpkV7m?.settlementStatus).toBe('finalized');

    // Zwykła faktura do zamkniętego okresu stycznia jest blokowana (409 vat_period_finalized)
    const lateJanDoc = ws.createDocument(jan, TENANT_1_ID, compId, {
      documentNumber: 'FZ/P54/2026/01/02',
      direction: 'purchase',
      issueDate: '2026-01-20',
      eventDate: '2026-01-20',
      counterpartyName: 'Dostawca Spóźniony Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
      lines: [{ description: 'Kabel sieciowy', netGrosze: 5_000, vatRate: '23' }],
    });
    expect(() =>
      ws.approveAndPostDocument(jan, TENANT_1_ID, compId, lateJanDoc.documentId),
    ).toThrow(AccountingWorkspaceConflictError);

    // W lutym P_39 wynosi dokładnie 130 zł (pomniejszone o P_54 = 100 zł!)
    const febVat = ws.getVatView(jan, TENANT_1_ID, compId, '2026-02');
    expect(febVat.jpkV7m?.fields.P_39).toBe(130);
    expect(febVat.jpkV7m?.carryForwardToNextPeriodP62Grosze).toBe(13_000);

    // #110: Cross-channel UI + MCP — faktura zaksięgowana w UI jest idempotentnie rozpoznawana przez MCP, a rozbieżna kwota daje 409
    const uiDoc = ws.createDocument(jan, TENANT_1_ID, compId, {
      documentNumber: 'FV/CROSS/2026/02/01',
      direction: 'purchase',
      issueDate: '2026-02-14',
      dueDate: '2026-02-28',
      counterpartyName: 'Dostawca Cross-Channel Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Licencja chmurowa', netGrosze: 100_000, vatRate: '23' }],
    });
    const postedUiDoc = ws.approveAndPostDocument(jan, TENANT_1_ID, compId, uiDoc.documentId);

    const mcpSame = ws.prepareMcpProposal(jan, {
      tenantId: TENANT_1_ID,
      legalEntityId: compId,
      idempotencyKey: '11111111-2222-4333-8444-555555555551',
      invoice: {
        direction: 'purchase',
        invoiceNumber: 'FV/CROSS/2026/02/01',
        issueDate: '2026-02-14',
        dueDate: '2026-02-28',
        counterpartyName: 'Dostawca Cross-Channel Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
        netAmountPln: '1000.00',
        vatAmountPln: '230.00',
        grossAmountPln: '1230.00',
        expenseDescription: 'Licencja chmurowa',
        suggestedCategory: 'uslugi_obce',
      },
    });
    const chSame = ws.issueMcpProposalChallenge(jan, TENANT_1_ID, compId, mcpSame.proposalId);
    const confirmedSame = ws.confirmMcpProposal(jan, TENANT_1_ID, compId, mcpSame.proposalId, {
      expectedPayloadHash: mcpSame.payloadHash,
      confirmationCode: chSame.confirmationCode,
    });
    expect(confirmedSame.postedDocument.documentId).toBe(postedUiDoc.documentId);
    expect(ws.getKpirView(jan, TENANT_1_ID, compId, '2026-02').entries).toHaveLength(1);

    const mcpDivergent = ws.prepareMcpProposal(jan, {
      tenantId: TENANT_1_ID,
      legalEntityId: compId,
      idempotencyKey: '11111111-2222-4333-8444-555555555552',
      invoice: {
        direction: 'purchase',
        invoiceNumber: 'FV/CROSS/2026/02/01',
        issueDate: '2026-02-14',
        dueDate: '2026-02-28',
        counterpartyName: 'Dostawca Cross-Channel Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
        netAmountPln: '2000.00',
        vatAmountPln: '460.00',
        grossAmountPln: '2460.00',
        expenseDescription: 'Licencja chmurowa — inna kwota',
        suggestedCategory: 'uslugi_obce',
      },
    });
    const chDiv = ws.issueMcpProposalChallenge(jan, TENANT_1_ID, compId, mcpDivergent.proposalId);
    expect(() =>
      ws.confirmMcpProposal(jan, TENANT_1_ID, compId, mcpDivergent.proposalId, {
        expectedPayloadHash: mcpDivergent.payloadHash,
        confirmationCode: chDiv.confirmationCode,
      }),
    ).toThrow(AccountingWorkspaceConflictError);

    // #112: MCP z VAT 0,00 zł u czynnego podatnika VAT bez jawnego vatRate/lines rzuca błąd walidacji 422
    const mcpZeroVat = ws.prepareMcpProposal(jan, {
      tenantId: TENANT_1_ID,
      legalEntityId: compId,
      idempotencyKey: '11111111-2222-4333-8444-555555555553',
      invoice: {
        direction: 'sales',
        invoiceNumber: 'FV/ZERO-VAT-AMBIGUOUS/2026/02/01',
        issueDate: '2026-02-16',
        dueDate: '2026-03-02',
        counterpartyName: 'Odbiorca Zagraniczny Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        netAmountPln: '500.00',
        vatAmountPln: '0.00',
        grossAmountPln: '500.00',
        expenseDescription: 'Usługa eksportowa / zwolniona bez stawki',
        suggestedCategory: 'przychod_sprzedaz',
      },
    });
    const chZero = ws.issueMcpProposalChallenge(jan, TENANT_1_ID, compId, mcpZeroVat.proposalId);
    expect(() =>
      ws.confirmMcpProposal(jan, TENANT_1_ID, compId, mcpZeroVat.proposalId, {
        expectedPayloadHash: mcpZeroVat.payloadHash,
        confirmationCode: chZero.confirmationCode,
      }),
    ).toThrow(AccountingWorkspaceValidationError);
  });

  it('#106 & #118 (GLD-01 / GLD-02): Multi-rate in-minus correction invoices (isCorrection: true) approve cleanly with echoed negative netPln/vatPln across KPiR, Ryczałt, and Sp. z o.o. KH, reject negative amounts when !isCorrection, and flag requiresCorrection when clamped P_54 changes', () => {
    const ws = new AccountingWorkspaceService({ seedDemoData: true });
    const jan = ws.resolveActorFromPersona('jan-testowy');

    // 1. Negative amounts on non-correction document -> 422 negative_amount_requires_correction
    expect(() =>
      ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
        documentNumber: 'FV/NON-CORR-NEG/2026/05/01',
        direction: 'sales',
        issueDate: '2026-05-05',
        counterpartyName: 'Odbiorca Testowy Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        lines: [
          { description: 'Błędna ujemna kwota bez korekty', netGrosze: -10_000, vatRate: '23' },
        ],
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    const regularDoc = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FV/ORIG-KPIR/2026/05/01',
      direction: 'sales',
      issueDate: '2026-05-05',
      eventDate: '2026-05-05',
      counterpartyName: 'Odbiorca KPiR Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [
        { description: 'Usługa wdrożeniowa 23%', netGrosze: 200_000, vatRate: '23' },
        { description: 'Dokumentacja 8%', netGrosze: 100_000, vatRate: '8' },
      ],
    });
    expect(() =>
      ws.approveAndPostDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, regularDoc.documentId, {
        netPln: '-2000.00',
        vatPln: '-460.00',
      }),
    ).toThrow(AccountingWorkspaceValidationError);

    const postedOrigKpir = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      regularDoc.documentId,
      {},
    );

    // 2. KPiR multi-rate in-minus correction referencing in-system invoice with Split-View echoed negative netPln/vatPln and omitted correctedEntryId/correctionReason
    const corrKpirInSystem = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FK/ORIG-KPIR/2026/05/01',
      direction: 'sales',
      issueDate: '2026-05-12',
      eventDate: '2026-05-12',
      counterpartyName: 'Odbiorca KPiR Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      isCorrection: true,
      correctedDocumentNumber: 'FV/ORIG-KPIR/2026/05/01',
      lines: [
        { description: 'Rabat potransakcyjny 23%', netGrosze: -100_000, vatRate: '23' },
        { description: 'Zwrot egzemplarzy 8%', netGrosze: -50_000, vatRate: '8' },
      ],
    });
    const postedCorrKpir = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      corrKpirInSystem.documentId,
      {
        netPln: '-1500.00',
        vatPln: '-270.00',
        suggestedCategory: 'przychod_sprzedaz',
      },
    );
    expect(postedCorrKpir.status).toBe('posted');
    expect(postedCorrKpir.document.lines).toHaveLength(2);
    expect(postedCorrKpir.postingResult?.settlementId).toBeNull();
    const kpirEntriesMay = ws.getKpirView(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, '2026-05').entries;
    const corrKpirRow = kpirEntriesMay.find(
      (e) => e.id === postedCorrKpir.postingResult?.kpirEntryId,
    )!;
    expect(corrKpirRow.isCorrection).toBe(true);
    expect(corrKpirRow.correctedEntryId).toBe(postedOrigKpir.postingResult?.kpirEntryId);
    expect(corrKpirRow.col7SalesRevenueGrosze).toBe(-150_000);

    // KPiR external prior-year purchase correction (correctedDocumentNumber not in PAP)
    const corrKpirExternal = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_KPIR_ID, {
      documentNumber: 'FK/EXT-2025/2026/05/02',
      direction: 'purchase',
      issueDate: '2026-05-15',
      eventDate: '2026-05-15',
      counterpartyName: 'Dostawca Zewnętrzny S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      isCorrection: true,
      correctedDocumentNumber: 'FV/2025/12/EXT-999',
      lines: [
        { description: 'Korekta zakupu z poprzedniego roku', netGrosze: -40_000, vatRate: '23' },
      ],
    });
    const postedCorrExt = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_KPIR_ID,
      corrKpirExternal.documentId,
      { netPln: '-400.00', vatPln: '-92.00' },
    );
    expect(postedCorrExt.status).toBe('posted');

    // 3. Ryczałt sales in-minus correction without explicit correctedEntryId
    const corrRyczalt = ws.createDocument(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, {
      documentNumber: 'FK/RYCZ/2026/05/01',
      direction: 'sales',
      issueDate: '2026-05-18',
      eventDate: '2026-05-18',
      counterpartyName: 'Klient Ryczałtowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      isCorrection: true,
      correctedDocumentNumber: 'FV/RYCZ-EXT/2025/11/07',
      ryczaltRate: '12',
      lines: [
        { description: 'Korekta usługi IT (ryczałt 12%)', netGrosze: -80_000, vatRate: 'zw' },
      ],
    });
    const postedCorrRycz = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_JDG_RYCZALT_ID,
      corrRyczalt.documentId,
      { netPln: '-800.00', vatPln: '0.00', ryczaltRate: '12' },
    );
    expect(postedCorrRycz.status).toBe('posted');
    const ryczView = ws.getRyczaltView(jan, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, '2026-05');
    const ryczCorrRow = ryczView.entries.find(
      (e) => e.id === postedCorrRycz.postingResult?.ryczaltEntryId,
    )!;
    expect(ryczCorrRow.isCorrection).toBe(true);
    expect(ryczCorrRow.revenueGrosze).toBe(-80_000);

    // 4. Sp. z o.o. Full Ledger (spzoo_pelne_ksiegi) multi-rate sales & car-mixed purchase in-minus corrections (red storno Wn === Ma)
    const corrSpzooSales = ws.createDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FK/SPZOO-S/2026/05/01',
      direction: 'sales',
      issueDate: '2026-05-20',
      eventDate: '2026-05-20',
      counterpartyName: 'Kontrahent Korporacyjny S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      isCorrection: true,
      correctedDocumentNumber: 'FV/SPZOO-ORIG/2026/04/10',
      lines: [
        { description: 'Korekta licencji 23%', netGrosze: -100_000, vatRate: '23' },
        { description: 'Korekta szkolenia 8%', netGrosze: -50_000, vatRate: '8' },
      ],
    });
    const postedSpzooSales = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_SPZOO_ID,
      corrSpzooSales.documentId,
      { netPln: '-1500.00', vatPln: '-270.00' },
    );
    expect(postedSpzooSales.status).toBe('posted');

    const corrSpzooPurchaseCar = ws.createDocument(jan, TENANT_1_ID, COMPANY_SPZOO_ID, {
      documentNumber: 'FK/SPZOO-P/2026/05/02',
      direction: 'purchase',
      issueDate: '2026-05-21',
      eventDate: '2026-05-21',
      counterpartyName: 'Flota Leasing S.A.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
      suggestedCategory: 'eksploatacja_samochodu_mieszana',
      isCorrection: true,
      correctedDocumentNumber: 'FV/FLOTA/2026/04/02',
      lines: [
        {
          description: 'Korekta serwisu pojazdu mieszanego 50%',
          netGrosze: -100_000,
          vatRate: '23',
        },
      ],
    });
    const postedSpzooPurch = ws.approveAndPostDocument(
      jan,
      TENANT_1_ID,
      COMPANY_SPZOO_ID,
      corrSpzooPurchaseCar.documentId,
      {
        netPln: '-1000.00',
        vatPln: '-230.00',
        suggestedCategory: 'eksploatacja_samochodu_mieszana',
      },
    );
    expect(postedSpzooPurch.status).toBe('posted');

    const ledgerMay = ws.getLedgerView(jan, TENANT_1_ID, COMPANY_SPZOO_ID, '2026-05');
    expect(ledgerMay.trialBalance.isBalanced).toBe(true);
    const salesJe = ledgerMay.journalEntries.find(
      (je) => je.id === postedSpzooSales.postingResult?.journalEntryId,
    )!;
    expect(salesJe.totalWnGrosze).toBe(-177_000);
    expect(salesJe.totalMaGrosze).toBe(-177_000);
    expect(salesJe.lines.every((l) => l.isRedStorno && Boolean(l.stornoReason))).toBe(true);
    expect(salesJe.lines.find((l) => l.accountCode === '221-1')?.amountGrosze).toBe(-27_000);

    const purchJe = ledgerMay.journalEntries.find(
      (je) => je.id === postedSpzooPurch.postingResult?.journalEntryId,
    )!;
    expect(purchJe.totalWnGrosze).toBe(-123_000);
    expect(purchJe.totalMaGrosze).toBe(-123_000);
    expect(purchJe.lines.find((l) => l.accountCode === '221-2')?.amountGrosze).toBe(-11_500);

    // 5. [P2-1]: Finalized period with P_54 = P_53 flags requiresCorrection=true when an in-minus purchase correction shrinks P_53 (even though P_62=0 and P_51=0 remain 0)
    const { company: refundComp } = ws.createCompany(jan, TENANT_1_ID, {
      displayName: 'Test Refund Clamp Sp. z o.o.',
      nip: '5261040828',
      legalForm: 'sp_z_o_o',
      taxRegime: 'cit_klasyczny',
      vatStatus: 'czynny',
      activityStartDate: '2026-01-01',
    });
    const p1 = ws.createDocument(jan, TENANT_1_ID, refundComp.legalEntityId, {
      documentNumber: 'FZ/REFUND/2026/06/01',
      direction: 'purchase',
      issueDate: '2026-06-05',
      eventDate: '2026-06-05',
      counterpartyName: 'Dostawca Zwrotu Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      lines: [{ description: 'Zakup z nadwyżką VAT 230 zł', netGrosze: 100_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, refundComp.legalEntityId, p1.documentId, {});
    const finalizedJune = ws.configureVatPeriodSettlement(
      jan,
      TENANT_1_ID,
      refundComp.legalEntityId,
      {
        period: '2026-06',
        refundRequestedP54Grosze: 23_000,
        finalize: true,
      },
    );
    expect(finalizedJune.jpkV7m?.refundToBankAccountP54Grosze).toBe(23_000);
    expect(finalizedJune.jpkV7m?.carryForwardToNextPeriodP62Grosze).toBe(0);
    expect(finalizedJune.jpkV7m?.requiresCorrection).toBe(false);

    const p1Corr = ws.createDocument(jan, TENANT_1_ID, refundComp.legalEntityId, {
      documentNumber: 'FK/REFUND/2026/06/02',
      direction: 'purchase',
      issueDate: '2026-06-20',
      eventDate: '2026-06-20',
      counterpartyName: 'Dostawca Zwrotu Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      isCorrection: true,
      correctedDocumentNumber: 'FZ/REFUND/2026/06/01',
      correctionReason: 'Rabat zmniejszający nadwyżkę VAT naliczonego o połowę',
      lines: [{ description: 'Korekta in minus 50%', netGrosze: -50_000, vatRate: '23' }],
    });
    ws.approveAndPostDocument(jan, TENANT_1_ID, refundComp.legalEntityId, p1Corr.documentId, {
      netPln: '-500.00',
      vatPln: '-115.00',
    });
    const juneAfterCorr = ws.getVatView(jan, TENANT_1_ID, refundComp.legalEntityId, '2026-06');
    expect(juneAfterCorr.jpkV7m?.refundToBankAccountP54Grosze).toBe(11_500);
    expect(juneAfterCorr.jpkV7m?.carryForwardToNextPeriodP62Grosze).toBe(0);
    expect(juneAfterCorr.jpkV7m?.taxDueP51Grosze).toBe(0);
    expect(juneAfterCorr.jpkV7m?.requiresCorrection).toBe(true);
  });
});
