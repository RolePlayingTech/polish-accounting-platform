import type {
  CalendarObligationItemContract,
  CompanyDocumentItemContract,
  NotificationsViewResponse,
  SandboxMailboxMessageContract,
} from '@pap/contracts';
import {
  AccountingWorkspaceConflictError,
  type VatPeriodSettlementState,
  type WorkspaceCompanyState,
  type WorkspaceHumanChallenge,
  type WorkspaceStoredMcpProposal,
} from '@pap/application';
import type { BankReconciliationMatchContract } from '@pap/contracts/accounting';
import type { PostgresAccountingScope } from '@pap/db';
import {
  computeMcpProposalSealHash,
  encodeBankMatchesNotes,
  encodeBankTxExternalRef,
  encodePostedDocumentSnapshotInDescription,
  mapContractKsefMarkerToDb,
  sha256Hex,
  toUuidOrDeterministic,
} from './postgres-mappers.js';
import {
  buildExplanationMapSnapshot,
  persistDocumentItemToScope,
  persistJournalEntryToScope,
  persistKpirEntryToScope,
  persistRyczaltEntryToScope,
  persistSettlementToScope,
  persistVatEntryToScope,
} from './postgres-demo-seed.js';

export async function persistPostedDocumentChildrenToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  postedDoc: CompanyDocumentItemContract,
): Promise<void> {
  const res = postedDoc.postingResult;
  if (!res) {
    return;
  }
  if (res.kpirEntryId) {
    const kpir = company.kpirEntries.find((e) => e.id === res.kpirEntryId);
    if (kpir) {
      await persistKpirEntryToScope(scope, company, kpir, postedDoc.documentId);
    }
  }
  if (res.ryczaltEntryId) {
    const rycz = company.ryczaltEntries.find((e) => e.id === res.ryczaltEntryId);
    if (rycz) {
      await persistRyczaltEntryToScope(scope, company, rycz, postedDoc.documentId);
    }
  }
  for (const vatId of res.vatEntryIds) {
    const vat = company.vatEntries.find((e) => e.id === vatId);
    if (vat) {
      await persistVatEntryToScope(scope, company, vat, postedDoc.documentId);
    }
  }
  if (res.journalEntryId) {
    const journal = company.journalEntries.find((e) => e.id === res.journalEntryId);
    if (journal) {
      await persistJournalEntryToScope(scope, company, journal, postedDoc.documentId);
    }
  }
  if (res.settlementId) {
    const settlement = company.settlements.find((s) => s.settlementId === res.settlementId);
    if (settlement) {
      await persistSettlementToScope(scope, settlement, new Set([postedDoc.documentId]));
    }
  }
}

export async function persistApproveAndPostDocumentMutation(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  postedDoc: CompanyDocumentItemContract,
): Promise<void> {
  const existing = await scope.getAccountingDocumentById(postedDoc.documentId);
  if (!existing) {
    await persistDocumentItemToScope(scope, company, postedDoc);
  } else {
    const baseDesc = postedDoc.document.lines[0]?.description ?? postedDoc.document.documentNumber;
    const explanationsSnapshot = buildExplanationMapSnapshot(company, postedDoc);
    const encodedDesc = encodePostedDocumentSnapshotInDescription(baseDesc, {
      documentItem: postedDoc,
      explanations: explanationsSnapshot,
    });
    const vehicleUsage: 'none' | 'mixed_50_75' | 'exclusive_100' =
      postedDoc.aiProposal.vatDeductionMode === 'vehicle_mixed_50' ||
      postedDoc.aiProposal.kpirQualification === 'vehicle_mixed_75_col13'
        ? 'mixed_50_75'
        : 'none';
    await scope.verifyAndPostAccountingDocument({
      documentId: postedDoc.documentId,
      documentNumber: postedDoc.document.documentNumber,
      issueDate: postedDoc.document.issueDate,
      saleDate: postedDoc.document.eventDate,
      dueDate: postedDoc.document.dueDate ?? null,
      counterpartyName: postedDoc.document.counterpartyName,
      counterpartyNip: postedDoc.document.counterpartyNip ?? null,
      counterpartyAddress: postedDoc.document.counterpartyAddress ?? null,
      netGrosze: postedDoc.document.totalNetGrosze,
      vatGrosze: postedDoc.document.totalVatGrosze,
      grossGrosze: postedDoc.document.totalGrossGrosze,
      categoryCode: postedDoc.aiProposal.suggestedCategory,
      vehicleUsage,
      description: encodedDesc,
      ksefReference: postedDoc.document.ksefReferenceNumber ?? null,
      ksefMarker: mapContractKsefMarkerToDb(postedDoc.document.ksefMarker),
      aiProposalJson: {
        ...postedDoc.aiProposal,
        _papDocSnapshot: postedDoc,
        _papEconomicOpKey: postedDoc.economicOperationKey ?? null,
        _papEconomicSnapshotHash: postedDoc.economicSnapshotHash ?? null,
        _papExplanations: explanationsSnapshot,
      },
      ...(postedDoc.approvedAt ? { verifiedAt: new Date(postedDoc.approvedAt) } : {}),
    });
  }

  await persistPostedDocumentChildrenToScope(scope, company, postedDoc);
}

export async function persistBankReconciliationMatchesAndSettlements(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  prevSettledById: ReadonlyMap<string, number>,
): Promise<void> {
  const modifiedSettlements = company.settlements
    .filter((s) => {
      const prev = prevSettledById.get(s.settlementId) ?? 0;
      return s.settledGrosze !== prev;
    })
    .slice()
    .sort((a, b) => a.settlementId.localeCompare(b.settlementId));

  for (const settlement of modifiedSettlements) {
    const prevSettled = prevSettledById.get(settlement.settlementId) ?? 0;
    const expectedPrevRemaining = Math.max(0, settlement.grossGrosze - prevSettled);
    await scope.setSettlementRemainingBalance({
      settlementId: settlement.settlementId,
      remainingGrossGrosze: settlement.remainingGrosze,
      expectedPreviousRemainingGrosze: expectedPrevRemaining,
    });
  }

  const txByRawId = new Map(company.bankTransactions.map((t) => [t.transactionId, t]));
  const settlementByDocId = new Map(company.settlements.map((s) => [s.documentId, s]));
  const matchesByTxId = new Map<string, BankReconciliationMatchContract[]>();

  for (const match of company.reconciliationMatches) {
    const list = matchesByTxId.get(match.transactionId) ?? [];
    list.push(match);
    matchesByTxId.set(match.transactionId, list);
  }

  const orderedTxEntries = [...matchesByTxId.entries()]
    .map(([rawTxId, txMatches]) => {
      const tx = txByRawId.get(rawTxId);
      const dbTxId = tx
        ? toUuidOrDeterministic(
            `bank-tx:${company.tenantId}:${company.legalEntityId}`,
            tx.transactionId,
          )
        : '';
      return { tx, txMatches, dbTxId };
    })
    .filter(
      (
        entry,
      ): entry is {
        tx: NonNullable<typeof entry.tx>;
        txMatches: BankReconciliationMatchContract[];
        dbTxId: string;
      } => Boolean(entry.tx),
    )
    .sort((a, b) => a.dbTxId.localeCompare(b.dbTxId));

  for (const { tx, txMatches, dbTxId } of orderedTxEntries) {
    const totalSettled = txMatches.reduce((acc, m) => acc + m.settledAmountGrosze, 0);
    if (totalSettled < 0 || totalSettled > tx.amountGrosze) {
      throw new Error(
        `Naruszenie niezmiennika alokacji bankowej: suma alokacji (${totalSettled} gr) przekracza kwotę transakcji (${tx.amountGrosze} gr).`,
      );
    }
    const primaryMatch = txMatches[0]!;
    const matchedDocId = totalSettled > 0 ? (primaryMatch.matchedDocumentId ?? null) : null;
    const matchedSettlementId = matchedDocId
      ? (settlementByDocId.get(matchedDocId)?.settlementId ?? null)
      : null;
    const aggregateStatus: BankReconciliationMatchContract['status'] =
      totalSettled === 0
        ? primaryMatch.status === 'ambiguous_manual_review'
          ? 'ambiguous_manual_review'
          : 'unmatched'
        : txMatches.length === 1
          ? primaryMatch.status
          : totalSettled === tx.amountGrosze
            ? 'matched_exact'
            : 'matched_partial';

    await scope.recordBankTransactionMatch({
      transactionId: dbTxId,
      matchStatus: aggregateStatus,
      matchedSettlementId,
      matchedDocumentId: matchedDocId,
      settledAmountGrosze: totalSettled,
      matchNotes: encodeBankMatchesNotes(txMatches),
    });
  }
}

export async function persistBankImportMutation(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  format: 'csv' | 'mt940',
  rawContent: string,
  beforeTxCount: number,
  prevSettledById: ReadonlyMap<string, number>,
): Promise<void> {
  const newTxs = company.bankTransactions.slice(beforeTxCount);
  if (newTxs.length > 0) {
    const contentHash = sha256Hex(`bank-import:${format}:${rawContent}`);
    await scope.importBankStatement({
      sourceFormat: format,
      fileName: `wyciag-${format}-${contentHash.slice(0, 8)}.${format}`,
      sha256Hash: contentHash,
      transactions: newTxs.map((tx) => ({
        id: toUuidOrDeterministic(
          `bank-tx:${company.tenantId}:${company.legalEntityId}`,
          tx.transactionId,
        ),
        externalRef: encodeBankTxExternalRef({
          rawTxId: tx.transactionId,
          reference: tx.rawReference,
        }),
        bookingDate: tx.bookingDate,
        valueDate: tx.valueDate ?? null,
        direction: tx.direction,
        amountGrosze: tx.amountGrosze,
        counterpartyName: tx.counterpartyName,
        counterpartyIban: tx.counterpartyIban ?? null,
        counterpartyNip: tx.counterpartyNip ?? null,
        title: tx.title,
      })),
    });
  }

  await persistBankReconciliationMatchesAndSettlements(scope, company, prevSettledById);
}

export async function persistCalendarObligationStatusMutation(
  scope: PostgresAccountingScope,
  item: CalendarObligationItemContract,
): Promise<void> {
  const dbStatus =
    item.workflowStatus === 'paid'
      ? 'paid'
      : item.workflowStatus === 'overdue'
        ? 'overdue'
        : 'upcoming';
  const shiftReason =
    item.shiftedFromNonWorkingDays.length > 0
      ? item.shiftedFromNonWorkingDays.map((s) => `${s.date}: ${s.reason}`).join('; ')
      : null;

  await scope.upsertTaxObligation({
    id: item.obligationId,
    period: item.period,
    obligationCode: item.code,
    category: item.category,
    titlePl: item.title,
    statutoryDueDate: item.statutoryDueDate,
    adjustedDueDate:
      item.effectiveDueDate >= item.statutoryDueDate
        ? item.effectiveDueDate
        : item.statutoryDueDate,
    shiftReason,
    estimatedAmountGrosze: item.estimatedAmountGrosze,
    status: dbStatus,
    legalBasisJson: { ...item.explanation },
    paidAt: item.paidAt ? new Date(item.paidAt) : null,
  });
}

export async function persistMcpChallengeMutation(
  scope: PostgresAccountingScope,
  proposal: WorkspaceStoredMcpProposal,
  challenge: WorkspaceHumanChallenge,
): Promise<void> {
  if (typeof scope.updateMcpPreparedProposalChallenge !== 'function') {
    return;
  }
  const existingDbProposal = await scope.getMcpPreparedProposal(proposal.proposalId);
  if (!existingDbProposal || existingDbProposal.status !== 'pending_human_approval') {
    return;
  }
  await scope.updateMcpPreparedProposalChallenge({
    proposalId: proposal.proposalId,
    confirmationChallengeHash: challenge.codeSha256Hex,
    invoiceJson: {
      ...existingDbProposal.invoiceJson,
      _papChallenge: {
        proposalId: challenge.proposalId,
        tenantId: challenge.tenantId,
        legalEntityId: challenge.legalEntityId,
        humanUserId: challenge.humanUserId,
        expectedPayloadHash: challenge.expectedPayloadHash,
        codeSha256Hex: challenge.codeSha256Hex,
        expiresAtMs: challenge.expiresAtMs,
        expiresAtIso: challenge.expiresAtIso,
        consumedAtIso: challenge.consumedAtIso,
      },
    },
  });
}

export async function persistConfirmMcpProposalMutation(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  proposal: WorkspaceStoredMcpProposal,
  postedDoc: CompanyDocumentItemContract | null,
): Promise<void> {
  const existingDbProposal = await scope.getMcpPreparedProposal(proposal.proposalId);
  if (!existingDbProposal) {
    throw new AccountingWorkspaceConflictError(
      'proposal_not_found_in_postgres',
      'Propozycja MCP nie istnieje w bazie PostgreSQL i nie może zostać zaksięgowana.',
    );
  }
  if (existingDbProposal.status === 'rejected') {
    throw new AccountingWorkspaceConflictError(
      'proposal_already_rejected',
      'Odrzucona propozycja MCP nie może zostać zatwierdzona ani zaksięgowana.',
    );
  }
  if (existingDbProposal.status === 'expired') {
    throw new AccountingWorkspaceConflictError(
      'proposal_expired',
      'Wygasła propozycja MCP nie może zostać zatwierdzona ani zaksięgowana.',
    );
  }
  if (existingDbProposal.status !== 'pending_human_approval') {
    throw new AccountingWorkspaceConflictError(
      'proposal_already_processed',
      'Propozycja MCP nie oczekuje już na zatwierdzenie człowieka w PostgreSQL.',
    );
  }

  const sealHash = computeMcpProposalSealHash(
    proposal.tenantId,
    proposal.legalEntityId,
    proposal.proposalId,
    proposal.payloadHash,
  );
  const ledgerEntryUuid = toUuidOrDeterministic(
    `mcp-ledger:${proposal.tenantId}:${proposal.legalEntityId}`,
    proposal.ledgerEntryId ?? postedDoc?.documentId ?? proposal.proposalId,
  );
  await scope.confirmMcpPreparedProposal({
    proposalId: proposal.proposalId,
    confirmationChallengeHash: existingDbProposal.confirmationChallengeHash || sealHash,
    ledgerEntryId: ledgerEntryUuid,
    ...(proposal.confirmedAtIso ? { confirmedAt: new Date(proposal.confirmedAtIso) } : {}),
  });
  if (postedDoc) {
    await persistApproveAndPostDocumentMutation(scope, company, postedDoc);
  }
}

export async function persistVatPeriodSettlementMutation(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  settlement: VatPeriodSettlementState,
): Promise<void> {
  const [yearStr, monthStr] = settlement.period.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const duePeriod =
    month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const dueDate = `${duePeriod}-25`;

  await scope.upsertTaxObligation({
    id: toUuidOrDeterministic(
      `vat-settlement:${company.tenantId}:${company.legalEntityId}`,
      settlement.period,
    ),
    period: settlement.period,
    obligationCode: 'VAT_JPK_V7M_SETTLEMENT',
    category: 'vat',
    titlePl: `Rozliczenie deklaracyjne VAT JPK_V7M za ${settlement.period} (v${settlement.version})`,
    statutoryDueDate: dueDate,
    adjustedDueDate: dueDate,
    estimatedAmountGrosze: settlement.taxDueP51Grosze,
    status: 'upcoming',
    legalBasisJson: {
      _papVatPeriodSettlement: settlement,
    },
    paidAt: null,
  });
}

export async function persistNotificationsStateMutation(
  scope: PostgresAccountingScope,
  userId: string,
  view: NotificationsViewResponse,
): Promise<void> {
  const existingOutbox = await scope.listNotificationOutbox();
  const existingById = new Map(existingOutbox.map((o) => [o.id, o]));
  const existingMailbox = await scope.listSandboxMailboxMessages();
  const existingMailboxIds = new Set(existingMailbox.map((m) => m.id));
  const outboxDbIdByEntryId = new Map<string, string>(existingOutbox.map((o) => [o.id, o.id]));

  for (const entry of view.outbox) {
    const dbFound = existingById.get(entry.outboxId);
    const targetAttemptCount = Math.max(entry.retryCount, entry.attempts.length);
    if (!dbFound) {
      const enqueued = await scope.enqueueNotificationOutbox({
        id: entry.outboxId,
        userId,
        obligationId: null,
        obligationCode: entry.deduplicationKey.split(':')[0] || 'PODATKI',
        stage: entry.stage,
        dedupKey: entry.deduplicationKey,
        recipientEmail: entry.email.toAddress,
        subject: entry.email.subject,
        payloadJson: {
          _papOutboxEntry: entry,
        },
        status: entry.status,
        maxAttempts: entry.maxAttempts,
        nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
      });
      outboxDbIdByEntryId.set(entry.outboxId, enqueued.item.id);
      if (enqueued.item.status !== 'sent' && enqueued.item.status !== entry.status) {
        await scope.updateNotificationOutboxStatus({
          outboxId: enqueued.item.id,
          status: entry.status,
          attemptCount: Math.max(enqueued.item.attemptCount, targetAttemptCount),
          nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
        });
      }
    } else if (
      dbFound.status !== 'sent' &&
      (dbFound.status !== entry.status || dbFound.attemptCount !== targetAttemptCount)
    ) {
      await scope.updateNotificationOutboxStatus({
        outboxId: dbFound.id,
        status: entry.status,
        attemptCount: Math.max(dbFound.attemptCount, targetAttemptCount),
        nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
      });
    }
  }

  for (const msg of view.deliveredMailbox) {
    const msgUuid = toUuidOrDeterministic('sandbox-mail', msg.messageId);
    if (existingMailboxIds.has(msgUuid)) {
      continue;
    }
    const resolvedOutboxId = outboxDbIdByEntryId.get(msg.outboxId) ?? msg.outboxId;
    await scope.appendSandboxMailboxMessage({
      id: msgUuid,
      outboxId: resolvedOutboxId,
      recipientEmail: msg.to,
      subject: msg.subject,
      rawRfc5322Mime: msg.rawRfc822,
      obligationCode: msg.deduplicationKey.split(':')[0] || 'PODATKI',
    });
  }
}

export async function persistSandboxTestEmailMutation(
  scope: PostgresAccountingScope,
  userId: string,
  sent: SandboxMailboxMessageContract,
): Promise<void> {
  const outboxUuid = toUuidOrDeterministic('sandbox-test-outbox', sent.outboxId);
  await scope.enqueueNotificationOutbox({
    id: outboxUuid,
    userId,
    obligationId: null,
    obligationCode: 'TEST_SANDBOX',
    stage: 'urgent_2d',
    dedupKey: sent.deduplicationKey,
    recipientEmail: sent.to,
    subject: sent.subject,
    payloadJson: {
      _papTestSandboxMessage: sent,
    },
    status: 'sent',
    maxAttempts: 3,
    nextAttemptAt: null,
  });
  await scope.appendSandboxMailboxMessage({
    id: toUuidOrDeterministic('sandbox-mail', sent.messageId),
    outboxId: outboxUuid,
    recipientEmail: sent.to,
    subject: sent.subject,
    rawRfc5322Mime: sent.rawRfc822,
    obligationCode: 'TEST_SANDBOX',
  });
}
