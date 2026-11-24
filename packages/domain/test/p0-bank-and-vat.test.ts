import { describe, expect, it } from 'vitest';
import { createVatRegisterEntry, parseMt940Statement, parsePolishBankCsv } from '../src/index.js';

describe('P0 Domain Invariants (#106 MPP multi-rate, #107 bank ID collisions, #113 CSV comma delimiter)', () => {
  it('#107 (GLD-03): generates distinct deterministic transactionIds for separate unreferenced CSV statements while keeping identical statement retries deterministic', () => {
    const csvA = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-05;2026-03-05;Dostawca A Sp. z o.o.;PL61109010140000071219812874;Opłata za serwer A;-100,00;PLN;',
    ].join('\n');
    const csvB = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-12;2026-03-12;Dostawca B Sp. z o.o.;PL27114020040000300201355387;Opłata za domenę B;-250,00;PLN;',
    ].join('\n');

    const parsedA1 = parsePolishBankCsv(csvA);
    const parsedA2 = parsePolishBankCsv(csvA);
    const parsedB = parsePolishBankCsv(csvB);

    expect(parsedA1).toHaveLength(1);
    expect(parsedB).toHaveLength(1);
    expect(parsedA1[0]!.transactionId).toBe(parsedA2[0]!.transactionId);
    expect(parsedA1[0]!.transactionId).not.toBe(parsedB[0]!.transactionId);
  });

  it('#107 (GLD-03): generates distinct deterministic transactionIds for separate MT940 NONREF statements while keeping retries deterministic', () => {
    const mt940A = [
      ':20:WB/2026/03/01',
      ':25:PL61109010140000071219812874',
      ':60F:C260301PLN1000,00',
      ':61:2603050305D100,00NTRFNONREF',
      ':86:020~20Opłata A~32Dostawca A',
      ':62F:C260305PLN900,00',
      '-}',
    ].join('\n');
    const mt940B = [
      ':20:WB/2026/03/02',
      ':25:PL61109010140000071219812874',
      ':60F:C260306PLN900,00',
      ':61:2603100310D150,00NTRFNONREF',
      ':86:020~20Opłata B~32Dostawca B',
      ':62F:C260310PLN750,00',
      '-}',
    ].join('\n');

    const parsedA1 = parseMt940Statement(mt940A);
    const parsedA2 = parseMt940Statement(mt940A);
    const parsedB = parseMt940Statement(mt940B);

    expect(parsedA1.transactions[0]!.transactionId).toBe(parsedA2.transactions[0]!.transactionId);
    expect(parsedA1.transactions[0]!.transactionId).not.toBe(
      parsedB.transactions[0]!.transactionId,
    );
  });

  it('#113: parses comma-delimited CSV with quoted Polish decimal amounts ("123,45") without shifting columns and rejects malformed unquoted comma decimals', () => {
    const validCommaCsv = [
      'Data księgowania,Data waluty,Kontrahent,Rachunek kontrahenta,Tytuł,Kwota,Waluta,Nr referencyjny',
      '2026-03-18,2026-03-18,"Alfa, Beta Sp. z o.o.",PL61109010140000071219812874,"Zapłata za FV/1, część 1","123,45",PLN,REF-COMMA-1',
    ].join('\n');

    const txs = parsePolishBankCsv(validCommaCsv, { delimiter: ',' });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.counterpartyName).toBe('Alfa, Beta Sp. z o.o.');
    expect(txs[0]!.title).toBe('Zapłata za FV/1, część 1');
    expect(txs[0]!.amountGrosze).toBe(12_345);
    expect(txs[0]!.direction).toBe('credit');
    expect(txs[0]!.rawReference).toBe('REF-COMMA-1');

    const brokenUnquotedDecimalCsv = [
      'Data księgowania,Data waluty,Kontrahent,Rachunek kontrahenta,Tytuł,Kwota,Waluta,Nr referencyjny',
      '2026-03-18,2026-03-18,Alfa Sp. z o.o.,,Zapłata,123,45,PLN,REF-BAD',
    ].join('\n');
    expect(() => parsePolishBankCsv(brokenUnquotedDecimalCsv, { delimiter: ',' })).toThrow();
  });

  it('#106: evaluates mandatory MPP threshold against full invoice gross when invoiceTotalGrossGrosze is provided on multi-rate invoices', () => {
    const rateGroupEntry = createVatRegisterEntry({
      id: 'vat-mpp-multirate-1',
      registerType: 'purchase',
      period: '2026-03',
      taxPointDate: '2026-03-15',
      issueDate: '2026-03-15',
      documentNumber: 'FV/MPP/2026/03/01',
      counterpartyName: 'Hurtownia Sprzętu Sp. z o.o.',
      counterpartyNip: '5250004007',
      vatRate: '23',
      netGrosze: 500_000, // 5 000,00 zł net + 1 150,00 zł VAT = 6 150,00 zł in 23% group
      vatTotalGrosze: 115_000,
      annex15Item: true,
      invoiceTotalGrossGrosze: 1_695_000, // 16 950,00 zł total invoice gross (> 15 000,00 zł)
    });

    expect(rateGroupEntry.mandatorySplitPaymentMpp).toBe(true);
  });
});
