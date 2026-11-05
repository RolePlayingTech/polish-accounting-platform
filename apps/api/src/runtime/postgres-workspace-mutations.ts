import type {
  CalendarObligationItemContract,
  CompanyDocumentItemContract,
  NotificationsViewResponse,
  SandboxMailboxMessageContract,
} from '@pap/contracts';
import {
  AccountingWorkspaceConflictError,
  type WorkspaceCompanyState,
  type WorkspaceStoredMcpProposal,
} from '@pap/application';
import { connectDatabase, type DatabaseEnvironment, type PostgresAccountingScope } from '@pap/db';
import {
  computeMcpProposalSealHash,
  deterministicUuidV4,
  encodeBankMatchNotes,
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
    const encodedDesc = encodePostedDocumentSnapshotInDescription(baseDesc, {
      documentItem: postedDoc,
      explanations: buildExplanationMapSnapshot(company, postedDoc),
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
  for (const settlement of company.settlements) {
    const prev = prevSettledById.get(settlement.settlementId) ?? 0;
    const delta = settlement.settledGrosze - prev;
    if (delta > 0) {
      await scope.applySettlementPayment({
        settlementId: settlement.settlementId,
        paidAmountGrosze: delta,
      });
    }
  }

  const txByRawId = new Map(company.bankTransactions.map((t) => [t.transactionId, t]));
  const settlementByDocId = new Map(company.settlements.map((s) => [s.documentId, s]));

  for (const match of company.reconciliationMatches) {
    const tx = txByRawId.get(match.transactionId);
    if (!tx) {
      continue;
    }
    const dbTxId = toUuidOrDeterministic(
      `bank-tx:${company.tenantId}:${company.legalEntityId}`,
      tx.transactionId,
    );
    const clampedSettled = Math.max(0, Math.min(match.settledAmountGrosze, tx.amountGrosze));
    const matchedDocId = match.matchedDocumentId ?? null;
    const matchedSettlementId = matchedDocId
      ? (settlementByDocId.get(matchedDocId)?.settlementId ?? null)
      : null;

    await scope.recordBankTransactionMatch({
      transactionId: dbTxId,
      matchStatus: match.status,
      matchedSettlementId,
      matchedDocumentId: matchedDocId,
      settledAmountGrosze: clampedSettled,
      matchNotes: encodeBankMatchNotes(match),
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
    confirmationChallengeHash: sealHash,
    ledgerEntryId: ledgerEntryUuid,
    ...(proposal.confirmedAtIso ? { confirmedAt: new Date(proposal.confirmedAtIso) } : {}),
  });
  if (postedDoc) {
    await persistDocumentItemToScope(scope, company, postedDoc);
    await persistPostedDocumentChildrenToScope(scope, company, postedDoc);
  }
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

  for (const entry of view.outbox) {
    const dbFound = existingById.get(entry.outboxId);
    if (!dbFound) {
      await scope.enqueueNotificationOutbox({
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
      if (entry.retryCount > 0 || entry.status !== 'pending') {
        await scope.updateNotificationOutboxStatus({
          outboxId: entry.outboxId,
          status: entry.status,
          attemptCount: Math.max(entry.retryCount, entry.attempts.length),
          nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
        });
      }
    } else if (dbFound.status !== entry.status || dbFound.attemptCount !== entry.retryCount) {
      await scope.updateNotificationOutboxStatus({
        outboxId: entry.outboxId,
        status: entry.status,
        attemptCount: Math.max(entry.retryCount, entry.attempts.length),
        nextAttemptAt: entry.nextAttemptAt ? new Date(entry.nextAttemptAt) : null,
      });
    }
  }

  for (const msg of view.deliveredMailbox) {
    const msgUuid = toUuidOrDeterministic('sandbox-mail', msg.messageId);
    if (existingMailboxIds.has(msgUuid)) {
      continue;
    }
    await scope.appendSandboxMailboxMessage({
      id: msgUuid,
      outboxId: msg.outboxId,
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

export async function provisionNewCompanyDirectoryWithMigrator(params: {
  readonly migratorUrl: string;
  readonly databaseEnv: DatabaseEnvironment;
  readonly dataSchema: string;
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly displayName: string;
  readonly profileCode: string;
  readonly ownerUserId: string;
}): Promise<void> {
  const migrator = connectDatabase(
    {
      DATABASE_URL: params.migratorUrl,
      PAP_DATABASE_ENV: params.databaseEnv,
    },
    params.dataSchema,
    { roleScope: 'migrator', maxConnections: 1 },
  );
  const sql = migrator.client;
  try {
    const nowIso = new Date().toISOString();
    await sql.begin(async (txRaw) => {
      const txSql = txRaw as unknown as typeof sql;
      await txSql`
        INSERT INTO legal_entity (id, tenant_id, display_name, created_at)
        VALUES (${params.legalEntityId}, ${params.tenantId}, ${params.displayName}, ${nowIso})
        ON CONFLICT (id) DO NOTHING
      `;
      const profileVerId = deterministicUuidV4(
        `entity-profile-v1:${params.tenantId}:${params.legalEntityId}`,
      );
      await txSql`
        INSERT INTO entity_profile_version (id, tenant_id, legal_entity_id, profile_code, valid_from)
        VALUES (${profileVerId}, ${params.tenantId}, ${params.legalEntityId}, ${params.profileCode}, ${nowIso})
        ON CONFLICT (id) DO NOTHING
      `;

      const ownerRows = await txSql<{ user_id: string }[]>`
        SELECT user_id::text AS user_id
        FROM tenant_membership
        WHERE tenant_id = ${params.tenantId}
          AND role = 'tenant_owner'
          AND status = 'active'
      `;
      const grantees = new Set<string>([
        params.ownerUserId,
        ...ownerRows.map((row) => row.user_id),
      ]);

      for (const granteeUserId of grantees) {
        for (const action of ['read', 'write'] as const) {
          const grantId = deterministicUuidV4(
            `owner-grant:${params.tenantId}:${params.legalEntityId}:${granteeUserId}:${action}`,
          );
          await txSql`
            INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from)
            VALUES (${grantId}, ${params.tenantId}, ${granteeUserId}, ${params.legalEntityId}, ${action}, ${nowIso})
            ON CONFLICT (grant_id) DO NOTHING
          `;
        }
      }
    });
  } finally {
    await sql.end({ timeout: 3 }).catch(() => undefined);
  }
}
