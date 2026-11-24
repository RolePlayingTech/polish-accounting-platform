import { randomUUID } from 'node:crypto';
import type { BankReconciliationMatchContract } from '@pap/contracts/accounting';
import type { SettlementItemContract } from '@pap/contracts/api';
import {
  createValidatedJournalEntry,
  type BankStatementTransaction,
  type JournalEntry,
  type TaxProfileCode,
} from '@pap/domain';

const BANK_GL_MARKER_REGEX = /\[WB-GL:([^\]\s]+)::([0-9a-fA-F-]{36})\]/;

export function encodeBankGlAllocationMarker(transactionId: string, settlementId: string): string {
  return `[WB-GL:${transactionId}::${settlementId.toLowerCase()}]`;
}

export function extractBookedBankGlAllocations(
  journalEntries: readonly JournalEntry[],
): Map<string, number> {
  const bookedByPair = new Map<string, number>();
  for (const je of journalEntries) {
    const match = BANK_GL_MARKER_REGEX.exec(je.description);
    if (!match) {
      continue;
    }
    const txId = match[1]!;
    const settlementId = match[2]!.toLowerCase();
    const pairKey = `${txId}::${settlementId}`;
    const bankLine = je.lines.find((l) => l.accountCode === '130');
    if (!bankLine) {
      continue;
    }
    // Both Wn 130 (credit inflow) and Ma 130 (debit outflow) carry +amountGrosze on booking and -amountGrosze on red-storno
    const prev = bookedByPair.get(pairKey) ?? 0;
    const next = prev + bankLine.amountGrosze;
    if (next === 0) {
      bookedByPair.delete(pairKey);
    } else {
      bookedByPair.set(pairKey, next);
    }
  }
  return bookedByPair;
}

/**
 * Synchronizuje dekrety księgi głównej (`130` <-> `201` / `202`) dla `spzoo_pelne_ksiegi`
 * po imporcie wyciągu bankowego oraz ręcznym/automatycznym uzgodnieniu rozrachunków (#111, GLD-07).
 *
 * Zachowuje niezmienniki:
 * - pełna idempotencja: brak zmian kwoty alokacji `(txId, settlementId)` => 0 nowych dekretów,
 * - append-only + czystość obrotów: wycofanie lub zmiana alokacji księguje czerwone storno (`isRedStorno: true`)
 *   poprzedniej kwoty i (jeśli nowa kwota > 0) nowy zbilansowany dekret `Wn === Ma`,
 * - 100% odtwarzalności po zimnym restarcie z PostgreSQL 18 bez dodatkowych tabel DDL (stan wynika z `journal_entry`).
 */
export function syncSpzooBankReconciliationJournalEntries(params: {
  readonly profileCode: TaxProfileCode;
  readonly bankTransactions: readonly BankStatementTransaction[];
  readonly settlements: readonly SettlementItemContract[];
  readonly reconciliationMatches: readonly BankReconciliationMatchContract[];
  readonly journalEntries: JournalEntry[];
  readonly closedPeriods?: readonly string[] | undefined;
}): readonly JournalEntry[] {
  if (params.profileCode !== 'spzoo_pelne_ksiegi') {
    return [];
  }

  const txById = new Map(params.bankTransactions.map((t) => [t.transactionId, t]));
  const settlementById = new Map(params.settlements.map((s) => [s.settlementId.toLowerCase(), s]));
  const settlementByDocId = new Map(params.settlements.map((s) => [s.documentId, s]));

  const desiredByPair = new Map<string, number>();
  for (const match of params.reconciliationMatches) {
    if (
      !match.matchedDocumentId ||
      match.settledAmountGrosze <= 0 ||
      (match.status !== 'matched_exact' &&
        match.status !== 'matched_partial' &&
        match.status !== 'overpaid')
    ) {
      continue;
    }
    const tx = txById.get(match.transactionId);
    const settlement = settlementByDocId.get(match.matchedDocumentId);
    if (!tx || !settlement) {
      continue;
    }
    const pairKey = `${tx.transactionId}::${settlement.settlementId.toLowerCase()}`;
    desiredByPair.set(pairKey, (desiredByPair.get(pairKey) ?? 0) + match.settledAmountGrosze);
  }

  const bookedByPair = extractBookedBankGlAllocations(params.journalEntries);
  const allPairKeys = Array.from(new Set([...bookedByPair.keys(), ...desiredByPair.keys()])).sort();

  const appended: JournalEntry[] = [];

  for (const pairKey of allPairKeys) {
    const prevGrosze = bookedByPair.get(pairKey) ?? 0;
    const nextGrosze = desiredByPair.get(pairKey) ?? 0;
    if (prevGrosze === nextGrosze) {
      continue;
    }

    const sepIdx = pairKey.lastIndexOf('::');
    const txId = pairKey.slice(0, sepIdx);
    const settlementId = pairKey.slice(sepIdx + 2);
    const tx = txById.get(txId);
    const settlement = settlementById.get(settlementId);
    if (!tx || !settlement) {
      continue;
    }

    const bookingDate = tx.bookingDate;
    const period = bookingDate.slice(0, 7);
    const marker = encodeBankGlAllocationMarker(tx.transactionId, settlement.settlementId);
    const isReceivableInflow = tx.direction === 'credit' || settlement.direction === 'receivable';

    if (prevGrosze > 0) {
      const seq = String(params.journalEntries.length + 1).padStart(3, '0');
      const stornoReason =
        nextGrosze === 0
          ? `Wycofanie rozliczenia płatności bankowej z rozrachunkiem ${settlement.documentNumber}`
          : `Korekta alokacji płatności bankowej na rozrachunku ${settlement.documentNumber}`;
      const stornoLines = isReceivableInflow
        ? [
            {
              accountCode: '130',
              side: 'Wn' as const,
              amountGrosze: -prevGrosze,
              description: `Storno wpływu bankowego — ${settlement.documentNumber}`,
              isRedStorno: true,
              stornoReason,
            },
            {
              accountCode: '201',
              side: 'Ma' as const,
              amountGrosze: -prevGrosze,
              description: `Storno rozliczenia należności — ${settlement.documentNumber}`,
              isRedStorno: true,
              stornoReason,
            },
          ]
        : [
            {
              accountCode: '202',
              side: 'Wn' as const,
              amountGrosze: -prevGrosze,
              description: `Storno rozliczenia zobowiązania — ${settlement.documentNumber}`,
              isRedStorno: true,
              stornoReason,
            },
            {
              accountCode: '130',
              side: 'Ma' as const,
              amountGrosze: -prevGrosze,
              description: `Storno wypływu bankowego — ${settlement.documentNumber}`,
              isRedStorno: true,
              stornoReason,
            },
          ];

      const stornoJe = createValidatedJournalEntry({
        id: randomUUID(),
        entryNumber: `WB/${period}/${seq}-STORNO`,
        bookingDate,
        documentDate: bookingDate,
        documentNumber: `WB-STORNO/${settlement.documentNumber}/${seq}`,
        description: `Storno czerwone wyciągu bankowego (${settlement.documentNumber}) ${marker}`,
        lines: stornoLines,
        ...(params.closedPeriods ? { closedPeriods: params.closedPeriods } : {}),
      });
      params.journalEntries.push(stornoJe);
      appended.push(stornoJe);
    }

    if (nextGrosze > 0) {
      const seq = String(params.journalEntries.length + 1).padStart(3, '0');
      const bookingLines = isReceivableInflow
        ? [
            {
              accountCode: '130',
              side: 'Wn' as const,
              amountGrosze: nextGrosze,
              description: `Wpływ na rachunek bieżący od ${settlement.counterpartyName} (${settlement.documentNumber})`,
            },
            {
              accountCode: '201',
              side: 'Ma' as const,
              amountGrosze: nextGrosze,
              description: `Rozliczenie należności od odbiorcy — ${settlement.documentNumber}`,
            },
          ]
        : [
            {
              accountCode: '202',
              side: 'Wn' as const,
              amountGrosze: nextGrosze,
              description: `Rozliczenie zobowiązania wobec dostawcy — ${settlement.documentNumber}`,
            },
            {
              accountCode: '130',
              side: 'Ma' as const,
              amountGrosze: nextGrosze,
              description: `Wypływ z rachunku bieżącego dla ${settlement.counterpartyName} (${settlement.documentNumber})`,
            },
          ];

      const bookingJe = createValidatedJournalEntry({
        id: randomUUID(),
        entryNumber: `WB/${period}/${seq}`,
        bookingDate,
        documentDate: bookingDate,
        documentNumber: `WB/${settlement.documentNumber}/${seq}`,
        description: `Wyciąg bankowy — rozliczenie rozrachunku ${settlement.documentNumber} ${marker}`,
        lines: bookingLines,
        ...(params.closedPeriods ? { closedPeriods: params.closedPeriods } : {}),
      });
      params.journalEntries.push(bookingJe);
      appended.push(bookingJe);
    }
  }

  return appended;
}
