import type { BankReconciliationMatchContract } from '@pap/contracts/accounting';
import type { CompanyDocumentItemContract } from '@pap/contracts/api';
import {
  generateBalanceSheet,
  generateTrialBalance,
  type BankStatementTransaction,
  type JournalEntry,
  type TaxProfileCode,
  type VerifiedTaxOrZusPayment,
} from '@pap/domain';
import { AccountingWorkspaceConflictError, AccountingWorkspaceValidationError } from './errors.js';

export type AccountingPeriodCloseStatus = 'open' | 'reconciling' | 'closed';

export interface PeriodCloseState {
  readonly period: string;
  readonly status: AccountingPeriodCloseStatus;
  readonly version: number;
  readonly updatedAt: string;
  readonly updatedByUserId: string;
  readonly closedAt: string | null;
  readonly closedByUserId: string | null;
  readonly note: string | null;
}

export interface PeriodCloseChecklistItem {
  readonly code:
    | 'UNVERIFIED_DOCUMENTS'
    | 'PENDING_MCP_PROPOSALS'
    | 'UNRECONCILED_BANK_TRANSACTIONS'
    | 'GL_TRIAL_BALANCE';
  readonly labelPl: string;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly count: number;
  readonly detailsPl: string;
}

export interface EvaluatedPeriodCloseStatus {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly period: string;
  readonly status: AccountingPeriodCloseStatus;
  readonly readyToClose: boolean;
  readonly blockingItemsCount: number;
  readonly checklist: readonly PeriodCloseChecklistItem[];
  readonly version: number;
  readonly updatedAt: string | null;
  readonly closedAt: string | null;
  readonly closedByUserId: string | null;
  readonly note: string | null;
}

export function assertValidPeriodMonth(period: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    throw new AccountingWorkspaceValidationError(
      400,
      'invalid_period',
      `Nieprawidłowy format okresu rozliczeniowego "${period}" (wymagany YYYY-MM).`,
    );
  }
}

export function listClosedPeriods(
  periodCloseStates?: ReadonlyMap<string, PeriodCloseState>,
): string[] {
  if (!periodCloseStates) {
    return [];
  }
  const out: string[] = [];
  for (const [period, state] of periodCloseStates.entries()) {
    if (state.status === 'closed') {
      out.push(period);
    }
  }
  return out.sort();
}

export function assertPeriodOpenForWrite(
  periodCloseStates: ReadonlyMap<string, PeriodCloseState> | undefined,
  period: string,
  operationLabelPl: string,
): void {
  const existing = periodCloseStates?.get(period);
  if (existing?.status === 'closed') {
    throw new AccountingWorkspaceConflictError(
      'period_closed',
      `Okres sprawozdawczy ${period} został trwale zamknięty — operacja (${operationLabelPl}) z datą w zamkniętym miesiącu jest zablokowana (art. 25 ust. 2 UoR). Wprowadź dowód korygujący w otwartym okresie rozliczeniowym.`,
    );
  }
}

export function computeUnreconciledBankTransactionsForPeriod(params: {
  readonly bankTransactions: readonly BankStatementTransaction[];
  readonly reconciliationMatches: readonly BankReconciliationMatchContract[];
  readonly verifiedTaxPayments?: readonly VerifiedTaxOrZusPayment[] | undefined;
  readonly period?: string | undefined;
}): readonly {
  readonly tx: BankStatementTransaction;
  readonly allocatedGrosze: number;
  readonly remainingUnallocatedGrosze: number;
}[] {
  const allocatedByTxId = new Map<string, number>();
  for (const m of params.reconciliationMatches) {
    if (
      m.settledAmountGrosze > 0 &&
      (m.status === 'matched_exact' || m.status === 'matched_partial' || m.status === 'overpaid')
    ) {
      allocatedByTxId.set(
        m.transactionId,
        (allocatedByTxId.get(m.transactionId) ?? 0) + m.settledAmountGrosze,
      );
    }
  }
  for (const vp of params.verifiedTaxPayments ?? []) {
    allocatedByTxId.set(
      vp.bankTransactionId,
      (allocatedByTxId.get(vp.bankTransactionId) ?? 0) + vp.amountGrosze,
    );
  }

  const out: {
    readonly tx: BankStatementTransaction;
    readonly allocatedGrosze: number;
    readonly remainingUnallocatedGrosze: number;
  }[] = [];

  for (const tx of params.bankTransactions) {
    if (params.period && !tx.bookingDate.startsWith(params.period)) {
      continue;
    }
    const allocatedGrosze = Math.min(tx.amountGrosze, allocatedByTxId.get(tx.transactionId) ?? 0);
    const remainingUnallocatedGrosze = Math.max(0, tx.amountGrosze - allocatedGrosze);
    if (remainingUnallocatedGrosze > 0) {
      out.push({ tx, allocatedGrosze, remainingUnallocatedGrosze });
    }
  }

  return out;
}

export function evaluatePeriodCloseStatus(params: {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly period: string;
  readonly profileCode: TaxProfileCode;
  readonly documents: readonly CompanyDocumentItemContract[];
  readonly pendingMcpProposalsCount: number;
  readonly bankTransactions: readonly BankStatementTransaction[];
  readonly reconciliationMatches: readonly BankReconciliationMatchContract[];
  readonly verifiedTaxPayments?: readonly VerifiedTaxOrZusPayment[] | undefined;
  readonly journalEntries: readonly JournalEntry[];
  readonly existingState?: PeriodCloseState | undefined;
}): EvaluatedPeriodCloseStatus {
  assertValidPeriodMonth(params.period);

  const unverifiedDocs = params.documents.filter(
    (d) =>
      d.document.eventDate.startsWith(params.period) &&
      (d.status === 'draft' || d.status === 'needs_verification' || d.status === 'ai_proposed'),
  );

  const unreconciledBank = computeUnreconciledBankTransactionsForPeriod({
    bankTransactions: params.bankTransactions,
    reconciliationMatches: params.reconciliationMatches,
    verifiedTaxPayments: params.verifiedTaxPayments,
    period: params.period,
  });

  const checklist: PeriodCloseChecklistItem[] = [
    {
      code: 'UNVERIFIED_DOCUMENTS',
      labelPl: 'Dokumenty oczekujące na weryfikację człowieka',
      passed: unverifiedDocs.length === 0,
      blocking: true,
      count: unverifiedDocs.length,
      detailsPl:
        unverifiedDocs.length === 0
          ? 'Wszystkie dokumenty w okresie zostały zweryfikowane i zaksięgowane.'
          : `${unverifiedDocs.length} dokument(ów) w okresie ${params.period} oczekuje na zatwierdzenie człowieka.`,
    },
    {
      code: 'PENDING_MCP_PROPOSALS',
      labelPl: 'Niezatwierdzone propozycje MCP w okresie',
      passed: params.pendingMcpProposalsCount === 0,
      blocking: true,
      count: params.pendingMcpProposalsCount,
      detailsPl:
        params.pendingMcpProposalsCount === 0
          ? 'Brak oczekujących propozycji agenta MCP dla zamykanego miesiąca.'
          : `${params.pendingMcpProposalsCount} propozycja(i) MCP dla okresu ${params.period} oczekuje na decyzję człowieka.`,
    },
    {
      code: 'UNRECONCILED_BANK_TRANSACTIONS',
      labelPl: 'Nieuzgodnione pozycje wyciągu bankowego',
      passed: unreconciledBank.length === 0,
      blocking: true,
      count: unreconciledBank.length,
      detailsPl:
        unreconciledBank.length === 0
          ? 'Wszystkie operacje bankowe w okresie zostały rozliczone.'
          : `${unreconciledBank.length} transakcja(i) bankowa w okresie ${params.period} posiada nierozliczone saldo.`,
    },
  ];

  if (params.profileCode === 'spzoo_pelne_ksiegi') {
    const entriesUpTo = params.journalEntries.filter((je) => je.period <= params.period);
    const tb = generateTrialBalance(entriesUpTo);
    const bs = generateBalanceSheet(entriesUpTo);
    const glBalanced = tb.isBalanced && bs.isBalanced;
    checklist.push({
      code: 'GL_TRIAL_BALANCE',
      labelPl: 'Równowaga Zestawienia Obrotów i Sald oraz Bilansu (UoR)',
      passed: glBalanced,
      blocking: true,
      count: glBalanced ? 0 : 1,
      detailsPl: glBalanced
        ? 'Obroty i salda Wn/Ma oraz Aktywa/Pasywa są w pełni zbilansowane.'
        : 'Wykryto niezgodność bilansową ZOiS lub Bilansu księgi głównej.',
    });
  }

  const blockingItemsCount = checklist
    .filter((item) => item.blocking && !item.passed)
    .reduce((sum, item) => sum + Math.max(1, item.count), 0);

  const state = params.existingState;
  return {
    tenantId: params.tenantId,
    legalEntityId: params.legalEntityId,
    period: params.period,
    status: state?.status ?? 'open',
    readyToClose: blockingItemsCount === 0,
    blockingItemsCount,
    checklist,
    version: state?.version ?? 0,
    updatedAt: state?.updatedAt ?? null,
    closedAt: state?.closedAt ?? null,
    closedByUserId: state?.closedByUserId ?? null,
    note: state?.note ?? null,
  };
}

export function transitionPeriodCloseState(params: {
  readonly evaluated: EvaluatedPeriodCloseStatus;
  readonly existingState?: PeriodCloseState | undefined;
  readonly actorUserId: string;
  readonly nowIso: string;
  readonly confirmClose: boolean;
  readonly requestedStatus?: 'reconciling' | 'closed' | undefined;
  readonly note?: string | undefined;
}): PeriodCloseState {
  const existing = params.existingState;
  const targetStatus: 'reconciling' | 'closed' =
    params.requestedStatus ?? (params.confirmClose ? 'closed' : 'reconciling');

  if (existing?.status === 'closed') {
    if (targetStatus === 'reconciling') {
      throw new AccountingWorkspaceConflictError(
        'period_closed',
        `Okres sprawozdawczy ${params.evaluated.period} został już trwale zamknięty i nie może zostać ponownie otwarty (art. 25 ust. 2 UoR).`,
      );
    }
    throw new AccountingWorkspaceConflictError(
      'period_already_closed',
      `Okres sprawozdawczy ${params.evaluated.period} został już wcześniej zamknięty.`,
    );
  }

  if (targetStatus === 'closed') {
    if (!params.confirmClose) {
      throw new AccountingWorkspaceValidationError(
        422,
        'close_confirmation_required',
        'Trwałe zamknięcie okresu sprawozdawczego wymaga jawnego potwierdzenia (confirmClose: true).',
      );
    }
    if (!params.evaluated.readyToClose) {
      const reasons = params.evaluated.checklist
        .filter((i) => i.blocking && !i.passed)
        .map((i) => i.detailsPl)
        .join(' ');
      throw new AccountingWorkspaceValidationError(
        422,
        'period_close_blocked_by_checklist',
        `Nie można zamknąć okresu ${params.evaluated.period} przed usunięciem blokad listy kontrolnej: ${reasons}`,
      );
    }
  }

  const nextVersion = (existing?.version ?? 0) + 1;
  return {
    period: params.evaluated.period,
    status: targetStatus,
    version: nextVersion,
    updatedAt: params.nowIso,
    updatedByUserId: params.actorUserId,
    closedAt: targetStatus === 'closed' ? params.nowIso : null,
    closedByUserId: targetStatus === 'closed' ? params.actorUserId : null,
    note: params.note?.trim() || existing?.note || null,
  };
}
