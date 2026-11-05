import { randomUUID } from 'node:crypto';
import type { CompanyDocumentItemContract, SettlementItemContract } from '@pap/contracts';
import {
  AccountingWorkspaceService,
  DEMO_COMPANIES_SEED,
  DEMO_EVALUATION_DATE,
  DEMO_PERSONAS_SEED,
  DEMO_USER_JAN_ID,
  DEMO_USER_PIOTR_ID,
  InMemoryAccountingWorkspaceStore,
  TENANT_1_ID,
  TENANT_2_ID,
  type AuditLogEntry,
  type WorkspaceCompanyState,
  type WorkspaceStoredMcpProposal,
} from '@pap/application';
import { sanitizeUntrustedDocumentTextForMcp } from '@pap/application/mcp-gateway';
import type {
  BankReconciliationMatchContract,
  TaxProfileConfigContract,
} from '@pap/contracts/accounting';
import type {
  PrepareInvoiceAndPostingProposalInput,
  ProposedAccountingPreview,
} from '@pap/contracts/mcp-tools';
import {
  createPostgresAccountingScope,
  listTenantCompanyGrantsForAdminFacts,
  type AccountingDocumentRecord,
  type BankTransactionRecord,
  type JournalEntryWithLinesRecord,
  type KpirEntryRecord,
  type McpPreparedProposalRecord,
  type PostgresAccountingScope,
  type RyczaltEntryRecord,
  type SettlementItemRecord,
  type VatRegisterEntryRecord,
} from '@pap/db';
import {
  formatPlnFromGrosze,
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
  type BankStatementTransaction,
  type JournalEntry,
  type KpirEntry,
  type RyczaltEntry,
  type VatRegisterEntry,
} from '@pap/domain';
import {
  INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY,
  decodeBankMatchNotes,
  decodeBankTxExternalRef,
  decodeCompanyMetaFromAddress,
  decodePostedDocumentSnapshotFromDescription,
  isInternalIndexDocumentCategory,
  mapBpsToRyczaltRateCode,
  mapDbKsefMarkerToContract,
  mapDbStageToZusScheme,
  toUuidOrDeterministic,
  type WorkspaceExplanationRecord,
} from './postgres-mappers.js';
import type { ConnectedPostgresRuntime } from './postgres-runtime-config.js';

function mapSqlDocumentStatus(
  status: AccountingDocumentRecord['status'],
): CompanyDocumentItemContract['status'] {
  if (status === 'verified_posted') return 'posted';
  if (status === 'archived') return 'archived';
  if (status === 'draft') return 'draft';
  return 'ai_proposed';
}

function overlaySqlDocumentColumns(
  base: CompanyDocumentItemContract,
  row: AccountingDocumentRecord,
  cleanDescription: string,
): CompanyDocumentItemContract {
  const netGrosze = Number(row.netGrosze);
  const vatGrosze = Number(row.vatGrosze);
  const grossGrosze = Number(row.grossGrosze);
  const mappedStatus = mapSqlDocumentStatus(row.status);
  const ksefMarker = mapDbKsefMarkerToContract(row.ksefMarker, row.ksefReference);

  const linesNetSum = base.document.lines.reduce((acc, line) => acc + line.netGrosze, 0);
  const linesVatSum = base.document.lines.reduce((acc, line) => acc + line.vatGrosze, 0);
  const linesGrossSum = base.document.lines.reduce((acc, line) => acc + line.grossGrosze, 0);
  const firstLine = base.document.lines[0];

  const lines: CompanyDocumentItemContract['document']['lines'] =
    base.document.lines.length > 0 &&
    linesNetSum === netGrosze &&
    linesVatSum === vatGrosze &&
    linesGrossSum === grossGrosze
      ? base.document.lines
      : [
          {
            lineNumber: 1,
            description: cleanDescription || firstLine?.description || row.documentNumber,
            quantity: firstLine?.quantity ?? '1',
            unit: firstLine?.unit ?? 'usł.',
            netGrosze,
            vatRate:
              vatGrosze > 0
                ? firstLine?.vatRate && firstLine.vatRate !== 'zw' && firstLine.vatRate !== '0'
                  ? firstLine.vatRate
                  : '23'
                : firstLine?.vatRate === '0' || firstLine?.vatRate === 'np'
                  ? firstLine.vatRate
                  : 'zw',
            vatGrosze,
            grossGrosze,
            annex15Item: firstLine?.annex15Item ?? false,
          },
        ];

  const {
    dueDate: _prevDueDate,
    counterpartyNip: _prevNip,
    counterpartyAddress: _prevAddress,
    ksefReferenceNumber: _prevKsefRef,
    ...restDocument
  } = base.document;
  void _prevDueDate;
  void _prevNip;
  void _prevAddress;
  void _prevKsefRef;

  return {
    ...base,
    documentId: row.id,
    tenantId: row.tenantId,
    legalEntityId: row.legalEntityId,
    status: mappedStatus,
    sha256Hash: row.sha256Hash,
    updatedAt: (row.verifiedAt ?? row.createdAt).toISOString(),
    approvedByUserId: row.verifiedBy ?? base.approvedByUserId,
    approvedAt: row.verifiedAt ? row.verifiedAt.toISOString() : base.approvedAt,
    document: {
      ...restDocument,
      documentId: row.id,
      documentNumber: row.documentNumber,
      issueDate: row.issueDate,
      eventDate: row.saleDate,
      ...(row.dueDate ? { dueDate: row.dueDate } : {}),
      counterpartyName: row.counterpartyName,
      ...(row.counterpartyNip ? { counterpartyNip: row.counterpartyNip } : {}),
      ...(row.counterpartyAddress ? { counterpartyAddress: row.counterpartyAddress } : {}),
      ...(row.ksefReference ? { ksefReferenceNumber: row.ksefReference } : {}),
      ksefMarker,
      lines,
      totalNetGrosze: netGrosze,
      totalVatGrosze: vatGrosze,
      totalGrossGrosze: grossGrosze,
      totalGrossFormatted: formatPlnFromGrosze(grossGrosze),
    },
  };
}

function hydrateDocumentFromRecord(
  row: AccountingDocumentRecord,
  explanationsOut: Map<string, WorkspaceExplanationRecord>,
): CompanyDocumentItemContract {
  const { cleanDescription, snapshot: postedSnapshot } =
    decodePostedDocumentSnapshotFromDescription(row.description);
  if (postedSnapshot?.documentItem) {
    for (const [k, v] of Object.entries(postedSnapshot.explanations ?? {})) {
      explanationsOut.set(k, v);
    }
    return overlaySqlDocumentColumns(postedSnapshot.documentItem, row, cleanDescription);
  }

  const aiJson = (row.aiProposalJson ?? {}) as Record<string, unknown>;
  const rawExps = aiJson._papExplanations as Record<string, WorkspaceExplanationRecord> | undefined;
  if (rawExps && typeof rawExps === 'object') {
    for (const [k, v] of Object.entries(rawExps)) {
      explanationsOut.set(k, v);
    }
  }

  const draftSnapshot = aiJson._papDocSnapshot as CompanyDocumentItemContract | undefined;
  if (draftSnapshot && typeof draftSnapshot === 'object' && 'documentId' in draftSnapshot) {
    return overlaySqlDocumentColumns(draftSnapshot, row, cleanDescription);
  }

  const netGrosze = Number(row.netGrosze);
  const vatGrosze = Number(row.vatGrosze);
  const grossGrosze = Number(row.grossGrosze);
  const direction: 'sales' | 'purchase' =
    row.documentType === 'sales_invoice' ? 'sales' : 'purchase';
  const ksefMarker = mapDbKsefMarkerToContract(row.ksefMarker, row.ksefReference);

  return {
    documentId: row.id,
    tenantId: row.tenantId,
    legalEntityId: row.legalEntityId,
    status:
      row.status === 'verified_posted'
        ? 'posted'
        : row.status === 'archived'
          ? 'archived'
          : row.status === 'draft'
            ? 'draft'
            : 'ai_proposed',
    sourceFormat: 'manual',
    sha256Hash: row.sha256Hash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: (row.verifiedAt ?? row.createdAt).toISOString(),
    approvedByUserId: row.verifiedBy ?? null,
    approvedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    isCorrection: row.documentType === 'correction_invoice',
    correctedDocumentNumber: null,
    correctionReason: null,
    document: {
      documentId: row.id,
      documentNumber: row.documentNumber,
      direction,
      issueDate: row.issueDate,
      eventDate: row.saleDate,
      ...(row.dueDate ? { dueDate: row.dueDate } : {}),
      counterpartyName: row.counterpartyName,
      ...(row.counterpartyNip ? { counterpartyNip: row.counterpartyNip } : {}),
      ...(row.counterpartyAddress ? { counterpartyAddress: row.counterpartyAddress } : {}),
      currency: 'PLN',
      ...(row.ksefReference ? { ksefReferenceNumber: row.ksefReference } : {}),
      ksefMarker,
      lines: [
        {
          lineNumber: 1,
          description: cleanDescription || row.documentNumber,
          quantity: '1',
          unit: 'usł.',
          netGrosze,
          vatRate: vatGrosze > 0 ? '23' : 'zw',
          vatGrosze,
          grossGrosze,
          annex15Item: false,
        },
      ],
      totalNetGrosze: netGrosze,
      totalVatGrosze: vatGrosze,
      totalGrossGrosze: grossGrosze,
      totalGrossFormatted: formatPlnFromGrosze(grossGrosze),
    },
    aiProposal: {
      status: row.status === 'verified_posted' ? 'human_approved' : 'ai_proposed',
      confidenceScoreBps: 9000,
      suggestedCategory: 'pozostale_wydatki_kpir',
      vatDeductionMode: 'full_100',
      kpirQualification: 'other_expenses_100_col13',
      ryczaltRate: null,
      ledgerAccountCode: null,
      extractedSummaryPl: cleanDescription || row.documentNumber,
      promptInjectionSuspected: false,
      untrustedCounterpartyName: sanitizeUntrustedDocumentTextForMcp(row.counterpartyName, {
        field: 'counterpartyName',
      }),
      untrustedDescription: sanitizeUntrustedDocumentTextForMcp(
        cleanDescription || row.documentNumber,
        { field: 'description' },
      ),
    },
    postingResult: null,
  };
}

function hydrateKpirFromRecord(
  row: KpirEntryRecord,
  explanationsOut: Map<string, WorkspaceExplanationRecord>,
): KpirEntry | null {
  const json = (row.legalExplanationJson ?? {}) as Record<string, unknown>;
  const itemExp = json._papItemExplanation as WorkspaceExplanationRecord | undefined;
  const saved = json._papKpirEntry as KpirEntry | undefined;
  if (saved && typeof saved === 'object' && 'id' in saved) {
    if (itemExp) {
      explanationsOut.set(saved.id, itemExp);
    }
    return saved;
  }
  return null;
}

function hydrateRyczaltFromRecord(
  row: RyczaltEntryRecord,
  explanationsOut: Map<string, WorkspaceExplanationRecord>,
): RyczaltEntry {
  const json = (row.legalExplanationJson ?? {}) as Record<string, unknown>;
  const itemExp = json._papItemExplanation as WorkspaceExplanationRecord | undefined;
  const saved = json._papRyczaltEntry as RyczaltEntry | undefined;
  if (saved && typeof saved === 'object' && 'id' in saved) {
    if (itemExp) {
      explanationsOut.set(saved.id, itemExp);
    }
    return saved;
  }
  const revGrosze = Number(row.revenueGrosze);
  return {
    id: row.id,
    ordinalNumber: row.lp,
    period: row.period,
    entryDate: row.eventDate,
    revenueDate: row.eventDate,
    documentNumber: row.documentNumber,
    ...(row.ksefReference ? { ksefReferenceNumber: row.ksefReference } : {}),
    counterpartyName: row.counterpartyName || 'Kontrahent',
    ...(row.counterpartyNip ? { counterpartyNip: row.counterpartyNip } : {}),
    rate: mapBpsToRyczaltRateCode(row.rateBps),
    revenueGrosze: revGrosze,
    revenueFormatted: formatPlnFromGrosze(revGrosze),
    isCorrection: row.isCorrection,
    ...(row.correctedEntryId ? { correctedEntryId: row.correctedEntryId } : {}),
  };
}

function hydrateVatFromRecord(
  row: VatRegisterEntryRecord,
  explanationsOut: Map<string, WorkspaceExplanationRecord>,
): VatRegisterEntry | null {
  const json = (row.legalExplanationJson ?? {}) as Record<string, unknown>;
  const itemExp = json._papItemExplanation as WorkspaceExplanationRecord | undefined;
  const saved = json._papVatEntry as VatRegisterEntry | undefined;
  if (saved && typeof saved === 'object' && 'id' in saved) {
    if (itemExp) {
      explanationsOut.set(saved.id, itemExp);
    }
    return saved;
  }
  return null;
}

function hydrateJournalFromRecord(
  record: JournalEntryWithLinesRecord,
  explanationsOut: Map<string, WorkspaceExplanationRecord>,
): JournalEntry {
  const json = (record.entry.legalExplanationJson ?? {}) as Record<string, unknown>;
  const itemExp = json._papItemExplanation as WorkspaceExplanationRecord | undefined;
  const saved = json._papJournalEntry as JournalEntry | undefined;
  if (saved && typeof saved === 'object' && 'id' in saved) {
    if (itemExp) {
      explanationsOut.set(saved.id, itemExp);
    }
    return saved;
  }
  const lines = record.lines.map((l) => ({
    lineNumber: l.lineNo,
    accountCode: l.accountCode,
    side: l.side,
    amountGrosze: Number(l.side === 'Wn' ? l.debitGrosze : l.creditGrosze),
    description: l.description,
    isRedStorno: false,
  }));
  const totalWn = lines.filter((l) => l.side === 'Wn').reduce((s, l) => s + l.amountGrosze, 0);
  const totalMa = lines.filter((l) => l.side === 'Ma').reduce((s, l) => s + l.amountGrosze, 0);
  return {
    id: record.entry.id,
    entryNumber: record.entry.entryNumber,
    period: record.entry.period,
    bookingDate: record.entry.bookingDate,
    documentDate: record.entry.documentDate,
    documentNumber: record.entry.documentNumber,
    description: record.entry.description,
    lines,
    totalWnGrosze: totalWn,
    totalMaGrosze: totalMa,
  };
}

function computeDaysOverdue(dueDateIso: string, remainingGrosze: number): number {
  if (remainingGrosze <= 0) {
    return 0;
  }
  const dueMs = Date.parse(`${dueDateIso}T00:00:00.000Z`);
  const evalMs = Date.parse(`${DEMO_EVALUATION_DATE}T00:00:00.000Z`);
  if (!Number.isFinite(dueMs) || evalMs <= dueMs) {
    return 0;
  }
  return Math.floor((evalMs - dueMs) / (24 * 60 * 60 * 1000));
}

function hydrateSettlementFromRecord(
  row: SettlementItemRecord,
  docById: ReadonlyMap<string, CompanyDocumentItemContract>,
): SettlementItemContract {
  const grossGrosze = Number(row.originalGrossGrosze);
  const remainingGrosze = Number(row.remainingGrossGrosze);
  const settledGrosze = Math.max(0, grossGrosze - remainingGrosze);
  const daysOverdue = computeDaysOverdue(row.dueDate, remainingGrosze);
  const status: SettlementItemContract['status'] =
    remainingGrosze <= 0
      ? 'paid'
      : settledGrosze > 0
        ? 'partially_paid'
        : daysOverdue > 0
          ? 'overdue'
          : 'open';
  const documentId = row.documentId ?? toUuidOrDeterministic('settlement-orphan-doc', row.id);
  const linkedDoc = docById.get(documentId);

  return {
    settlementId: row.id,
    documentId,
    documentNumber: row.documentNumber,
    direction: row.direction,
    counterpartyName: row.counterpartyName,
    counterpartyNip: row.counterpartyNip ?? null,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    grossGrosze,
    settledGrosze,
    remainingGrosze,
    remainingFormatted: formatPlnFromGrosze(remainingGrosze),
    status,
    daysOverdue,
    ksefReferenceNumber: linkedDoc?.document.ksefReferenceNumber ?? null,
  };
}

function hydrateBankFromRecords(rows: readonly BankTransactionRecord[]): {
  readonly bankTransactions: BankStatementTransaction[];
  readonly reconciliationMatches: BankReconciliationMatchContract[];
} {
  const bankTransactions: BankStatementTransaction[] = [];
  const reconciliationMatches: BankReconciliationMatchContract[] = [];

  for (const row of rows) {
    const ext = decodeBankTxExternalRef(row.externalRef, row.id);
    const amountGrosze = Number(row.amountGrosze);
    bankTransactions.push({
      transactionId: ext.rawTxId,
      bookingDate: row.bookingDate,
      ...(row.valueDate ? { valueDate: row.valueDate } : {}),
      direction: row.direction,
      amountGrosze,
      amountFormatted: formatPlnFromGrosze(amountGrosze),
      currency: 'PLN',
      counterpartyName: row.counterpartyName,
      ...(row.counterpartyIban ? { counterpartyIban: row.counterpartyIban } : {}),
      ...(row.counterpartyNip ? { counterpartyNip: row.counterpartyNip } : {}),
      title: row.title,
      ...(ext.reference ? { rawReference: ext.reference } : {}),
    });

    const decodedMatch = decodeBankMatchNotes(row.matchNotes);
    if (decodedMatch) {
      reconciliationMatches.push(decodedMatch);
    } else if (row.matchStatus !== 'unmatched') {
      const settled = Number(row.settledAmountGrosze);
      reconciliationMatches.push({
        transactionId: ext.rawTxId,
        status: row.matchStatus,
        ...(row.matchedDocumentId ? { matchedDocumentId: row.matchedDocumentId } : {}),
        candidateDocumentIds: row.matchedDocumentId ? [row.matchedDocumentId] : [],
        transactionAmountGrosze: amountGrosze,
        settledAmountGrosze: settled,
        remainingDocumentAmountGrosze: 0,
        overpaymentGrosze: Math.max(0, amountGrosze - settled),
        notes: row.matchNotes ?? 'Uzgodnienie przywrócone z bazy PostgreSQL.',
      });
    }
  }

  return { bankTransactions, reconciliationMatches };
}

export function hydrateMcpProposalFromRecord(
  row: McpPreparedProposalRecord,
): WorkspaceStoredMcpProposal {
  const invRaw = { ...(row.invoiceJson as Record<string, unknown>) };
  const rawIdem =
    typeof invRaw._papRawIdempotencyKey === 'string'
      ? invRaw._papRawIdempotencyKey
      : row.idempotencyKey;
  const createdByRaw =
    typeof invRaw._papCreatedByUserId === 'string' ? invRaw._papCreatedByUserId : row.preparedBy;
  delete invRaw._papRawIdempotencyKey;
  delete invRaw._papCreatedByUserId;

  const expiresAtMs = row.expiresAt.getTime();
  return {
    proposalId: row.proposalId,
    tenantId: parseTenantId(row.tenantId),
    legalEntityId: parseLegalEntityId(row.legalEntityId),
    createdByUserId: parseUserId(createdByRaw),
    idempotencyKey: rawIdem,
    payloadHash: row.payloadHash,
    createdAtIso: row.createdAt.toISOString(),
    expiresAtMs,
    expiresAtIso: row.expiresAt.toISOString(),
    status: row.status,
    ledgerPosted: row.status === 'confirmed',
    ledgerEntryId: row.ledgerEntryId ?? null,
    confirmedAtIso: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    confirmedByUserId: row.confirmedBy ? parseUserId(row.confirmedBy) : null,
    rejectedAtIso: row.status === 'rejected' ? row.createdAt.toISOString() : null,
    rejectedByUserId: null,
    rejectionReason: row.status === 'rejected' ? 'Odrzucono przez człowieka.' : null,
    invoice: invRaw as unknown as PrepareInvoiceAndPostingProposalInput['invoice'],
    proposedPosting: row.proposedPostingJson as unknown as ProposedAccountingPreview,
  };
}

function resolvePersonaDisplayLabel(actorUserId: string | null): string {
  if (!actorUserId) {
    return 'System PAP';
  }
  const persona = DEMO_PERSONAS_SEED.find((p) => p.userId === actorUserId);
  return persona?.displayName ?? `Użytkownik ${actorUserId.slice(0, 8)}`;
}

async function hydrateSingleCompanyFromScope(
  scope: PostgresAccountingScope,
  rawTenantId: string,
  rawLegalEntityId: string,
): Promise<{
  readonly company: WorkspaceCompanyState;
  readonly mcpProposals: readonly WorkspaceStoredMcpProposal[];
  readonly auditEvents: readonly AuditLogEntry[];
  readonly notificationPrefs: readonly {
    readonly userId: string;
    readonly recipientEmail: string;
    readonly frequency: 'standard' | 'urgent_only' | 'overdue_only';
    readonly optOut: boolean;
    readonly disabledStages: readonly string[];
  }[];
} | null> {
  const settings = await scope.getCompanyTaxSettings();
  if (!settings) {
    return null;
  }

  const entitySummary = await scope.getLegalEntitySummary();
  const meta = decodeCompanyMetaFromAddress(settings.addressSummary);
  const seedFallback = DEMO_COMPANIES_SEED.find(
    (s) => s.tenantId === rawTenantId && s.legalEntityId === rawLegalEntityId,
  );
  const displayName =
    meta?.displayName ??
    entitySummary?.displayName ??
    seedFallback?.displayName ??
    `Firma ${settings.nip}`;
  const legalForm = settings.legalForm === 'sp_z_o_o' ? 'sp_z_o_o' : 'jdg';
  const vatStatusSimple = settings.vatStatus;
  const taxProfile: TaxProfileConfigContract = meta?.taxProfile ??
    seedFallback?.taxProfile ?? {
      profileCode:
        legalForm === 'sp_z_o_o'
          ? 'spzoo_pelne_ksiegi'
          : settings.taxRegime === 'ryczalt'
            ? 'jdg_ryczalt'
            : settings.taxRegime === 'kpir_liniowy'
              ? 'jdg_kpir_liniowy'
              : 'jdg_kpir_skala',
      supportLevel: 'supported',
      nip: settings.nip,
      ...(settings.regon ? { regon: settings.regon } : {}),
      ...(settings.krs ? { krs: settings.krs } : {}),
      companyName: displayName,
      activityStartDate: '2025-01-01',
      vatStatus: vatStatusSimple === 'czynny' ? 'czynny' : 'zwolniony_art_113',
      vatSettlementPeriod: vatStatusSimple === 'czynny' ? 'monthly' : 'not_applicable',
      zusScheme: mapDbStageToZusScheme(settings.zusStage),
      voluntarySicknessInsurance: settings.voluntarySicknessInsurance,
      accidentRateBps: 167,
      insuredPersonsCount: 1,
      smallTaxpayer: settings.smallTaxpayer,
      ksefSales2024Above200M: settings.ksefMode === 'mandatory_2026_feb',
    };

  const rawDocs = await scope.listAccountingDocuments();
  const mcpProposalIds = new Set<string>();
  const explanationsById = new Map<string, WorkspaceExplanationRecord>();
  const documents: CompanyDocumentItemContract[] = [];
  const auditEvents: AuditLogEntry[] = [];

  for (const row of rawDocs) {
    if (row.categoryCode === INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY) {
      const json = (row.aiProposalJson ?? {}) as Record<string, unknown>;
      if (typeof json.proposalId === 'string') {
        mcpProposalIds.add(json.proposalId);
      }
      continue;
    }
    if (isInternalIndexDocumentCategory(row.categoryCode)) {
      continue;
    }
    const doc = hydrateDocumentFromRecord(row, explanationsById);
    documents.push(doc);

    auditEvents.push({
      auditEventId: `pg-doc-created-${row.id}`,
      occurredAt: row.createdAt.toISOString(),
      channel: 'accounting',
      action: 'document_created',
      actorUserId: row.createdBy,
      actorDisplayLabel: resolvePersonaDisplayLabel(row.createdBy),
      tenantId: rawTenantId,
      legalEntityId: rawLegalEntityId,
      outcome: 'allow',
      reasonCode: 'document_registered',
      summaryPl: `Zarejestrowano dokument ${row.documentNumber} (${formatPlnFromGrosze(Number(row.grossGrosze))}).`,
    });
    if (row.status === 'verified_posted' && row.verifiedAt) {
      auditEvents.push({
        auditEventId: `pg-doc-posted-${row.id}`,
        occurredAt: row.verifiedAt.toISOString(),
        channel: 'accounting',
        action: 'document_approved_and_posted',
        actorUserId: row.verifiedBy,
        actorDisplayLabel: resolvePersonaDisplayLabel(row.verifiedBy),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        outcome: 'allow',
        reasonCode: 'human_approved_posting',
        summaryPl: `Zatwierdzono i zaksięgowano dokument ${row.documentNumber} (${formatPlnFromGrosze(Number(row.grossGrosze))}).`,
      });
    }
  }

  const docById = new Map(documents.map((d) => [d.documentId, d]));

  const kpirRows = await scope.listKpirEntries();
  const kpirEntries = kpirRows
    .map((r) => hydrateKpirFromRecord(r, explanationsById))
    .filter((e): e is KpirEntry => e !== null)
    .sort((a, b) => a.ordinalNumber - b.ordinalNumber);

  const ryczaltRows = await scope.listRyczaltEntries();
  const ryczaltEntries = ryczaltRows
    .map((r) => hydrateRyczaltFromRecord(r, explanationsById))
    .sort((a, b) => a.ordinalNumber - b.ordinalNumber);

  const vatRows = await scope.listVatRegisterEntries();
  const vatEntries = vatRows
    .map((r) => hydrateVatFromRecord(r, explanationsById))
    .filter((e): e is VatRegisterEntry => e !== null);

  const journalRows = await scope.listJournalEntries();
  const journalEntries = journalRows.map((r) => hydrateJournalFromRecord(r, explanationsById));

  const settlementRows = await scope.listSettlementItems();
  const settlements = settlementRows.map((r) => hydrateSettlementFromRecord(r, docById));

  const bankTxRows = await scope.listBankTransactions();
  const { bankTransactions, reconciliationMatches } = hydrateBankFromRecords(bankTxRows);

  const obligationRows = await scope.listTaxObligations();
  const paidObligationsByKey = new Map<string, string>();
  for (const ob of obligationRows) {
    if (ob.status === 'paid') {
      const paidIso = (ob.paidAt ?? ob.updatedAt).toISOString();
      paidObligationsByKey.set(`${ob.period}:${ob.obligationCode}`, paidIso);
      paidObligationsByKey.set(ob.id, paidIso);
    }
  }

  const mcpProposals: WorkspaceStoredMcpProposal[] = [];
  for (const propId of mcpProposalIds) {
    const rec = await scope.getMcpPreparedProposal(propId);
    if (rec) {
      const hydratedProposal = hydrateMcpProposalFromRecord(rec);
      mcpProposals.push(hydratedProposal);
      auditEvents.push({
        auditEventId: `pg-mcp-prop-${rec.proposalId}`,
        occurredAt: (rec.confirmedAt ?? rec.createdAt).toISOString(),
        channel: 'mcp',
        action:
          rec.status === 'confirmed'
            ? 'confirm_prepared_proposal'
            : rec.status === 'rejected'
              ? 'reject_prepared_proposal'
              : 'prepare_invoice_and_posting_proposal',
        actorUserId: rec.confirmedBy ?? rec.preparedBy,
        actorDisplayLabel: resolvePersonaDisplayLabel(rec.confirmedBy ?? rec.preparedBy),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        outcome: 'allow',
        reasonCode: `mcp_${rec.status}`,
        summaryPl: `Propozycja MCP ${rec.proposalId.slice(0, 8)} (${hydratedProposal.invoice.invoiceNumber}): ${rec.status}.`,
      });
    }
  }

  const settingsHistory = meta?.settingsHistory ? [...meta.settingsHistory] : [];
  for (const hist of settingsHistory) {
    auditEvents.push({
      auditEventId: `pg-settings-v${hist.version}-${rawLegalEntityId}`,
      occurredAt: hist.changedAt,
      channel: 'accounting',
      action: 'company_settings_updated',
      actorUserId: hist.changedByUserId,
      actorDisplayLabel: resolvePersonaDisplayLabel(hist.changedByUserId),
      tenantId: rawTenantId,
      legalEntityId: rawLegalEntityId,
      outcome: 'allow',
      reasonCode: 'settings_version_saved',
      summaryPl: hist.changeSummaryPl,
    });
  }

  const notificationPrefs: {
    readonly userId: string;
    readonly recipientEmail: string;
    readonly frequency: 'standard' | 'urgent_only' | 'overdue_only';
    readonly optOut: boolean;
    readonly disabledStages: readonly string[];
  }[] = [];
  for (const persona of DEMO_PERSONAS_SEED) {
    if (persona.tenantId !== rawTenantId) continue;
    const pref = await scope.getNotificationPreference(persona.userId);
    if (pref) {
      notificationPrefs.push({
        userId: persona.userId,
        recipientEmail: pref.recipientEmail,
        frequency: pref.frequency,
        optOut: pref.optOut,
        disabledStages: pref.disabledStages,
      });
    }
  }

  return {
    company: {
      tenantId: parseTenantId(rawTenantId),
      legalEntityId: parseLegalEntityId(rawLegalEntityId),
      displayName,
      nip: settings.nip,
      legalForm,
      taxRegime: settings.taxRegime,
      vatStatusSimple,
      taxProfile,
      settingsHistory,
      documents,
      kpirEntries,
      ryczaltEntries,
      vatEntries,
      journalEntries,
      settlements,
      bankTransactions,
      reconciliationMatches,
      paidObligationsByKey,
      explanationsById,
    },
    mcpProposals,
    auditEvents,
    notificationPrefs,
  };
}

async function readCompanyReadOnlyWithSignedContext<T>(
  runtime: ConnectedPostgresRuntime,
  params: {
    readonly purpose: 'facts' | 'company';
    readonly actorUserId: string;
    readonly tenantId: string;
    readonly legalEntityId: string;
  },
  work: (scope: PostgresAccountingScope) => Promise<T>,
): Promise<T> {
  return runtime.connection.db.transaction(async (tx) => {
    const operationId = randomUUID();
    await runtime.signer.apply(tx, {
      purpose: params.purpose,
      actorUserId: params.actorUserId,
      tenantId: params.tenantId,
      legalEntityId: params.legalEntityId,
      action: 'read',
      operationId,
    });
    let active = true;
    try {
      const scope = createPostgresAccountingScope({
        tx,
        context: {
          actorUserId: parseUserId(params.actorUserId),
          tenantId: parseTenantId(params.tenantId),
          legalEntityId: parseLegalEntityId(params.legalEntityId),
          action: 'read',
          operationId,
          decisionAt: new Date().toISOString(),
        },
        assertActive: () => {
          if (!active) {
            throw new Error('Zakres odczytu hydracji został już zamknięty.');
          }
        },
      });
      return await work(scope);
    } finally {
      active = false;
    }
  });
}

export async function hydrateCompanyIntoWorkspaceIfMissing(
  runtime: ConnectedPostgresRuntime,
  workspace: AccountingWorkspaceService,
  rawTenantId: string,
  rawLegalEntityId: string,
  preferredActorUserId?: string,
): Promise<boolean> {
  const store = workspace.store;
  const tId = parseTenantId(rawTenantId);
  const leId = parseLegalEntityId(rawLegalEntityId);

  if (store.getCompany(tId, leId) !== null) {
    return true;
  }

  const candidateUsers = new Set<string>(store.listUsers().map((u) => u.userId));
  if (preferredActorUserId) {
    candidateUsers.add(parseUserId(preferredActorUserId));
  }

  for (const rawUserId of candidateUsers) {
    const uId = parseUserId(rawUserId);
    for (const action of ['read', 'write'] as const) {
      const facts = await runtime.securityServices.authorizationDataSource.getFacts({
        userId: uId,
        tenantId: tId,
        legalEntityId: leId,
        action,
      });
      if (facts.membership) {
        store.upsertMembership(facts.membership);
      }
      for (const grant of facts.grants) {
        store.upsertGrant(grant);
      }
    }
  }

  const activeReaderGrant = store
    .listGrantsForCompany(tId, leId)
    .find(
      (g) =>
        g.action === 'read' &&
        g.revokedAt === null &&
        (store.getUserById(g.userId) !== null || g.userId === preferredActorUserId),
    );
  const defaultOwnerId =
    tId === TENANT_1_ID ? DEMO_USER_JAN_ID : tId === TENANT_2_ID ? DEMO_USER_PIOTR_ID : null;
  const fallbackOwnerReadGrant = defaultOwnerId
    ? store
        .listGrantsForCompany(tId, leId)
        .find(
          (g) =>
            g.userId === defaultOwnerId &&
            g.action === 'read' &&
            g.revokedAt === null &&
            store.getUserById(parseUserId(defaultOwnerId)) !== null,
        )
    : undefined;
  const readerUserId = activeReaderGrant?.userId ?? fallbackOwnerReadGrant?.userId ?? null;
  if (!readerUserId) {
    return false;
  }

  const hydrated = await readCompanyReadOnlyWithSignedContext(
    runtime,
    {
      purpose: 'company',
      actorUserId: readerUserId,
      tenantId: tId,
      legalEntityId: leId,
    },
    (scope) => hydrateSingleCompanyFromScope(scope, tId, leId),
  );

  if (!hydrated) {
    return false;
  }

  store.saveCompany(hydrated.company);
  for (const proposal of hydrated.mcpProposals) {
    store.upsertMcpProposal(proposal);
  }

  const existingAuditIds = new Set(
    store.listAuditEvents({ tenantId: tId, legalEntityId: leId }).map((e) => e.auditEventId),
  );
  const newAudits = hydrated.auditEvents
    .filter((e) => !existingAuditIds.has(e.auditEventId))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const auditEvent of newAudits) {
    store.appendAuditEvent(auditEvent);
  }

  for (const pref of hydrated.notificationPrefs) {
    await workspace.notificationsEngine.configurePreferences({
      tenantId: tId,
      legalEntityId: leId,
      userId: pref.userId,
      recipientEmail: pref.recipientEmail,
      frequency: pref.frequency,
      optionalRemindersOptedOut: pref.optOut,
      explicitDisabledStages: pref.disabledStages as never[],
    });
  }

  return true;
}

export async function discoverAndHydrateMissingCompaniesForTenants(
  runtime: ConnectedPostgresRuntime,
  workspace: AccountingWorkspaceService,
  rawTenantIds: readonly string[],
  extraCandidateUserIds: readonly string[] = [],
  options?: { readonly includeDemoSeedFallback?: boolean },
): Promise<void> {
  const store = workspace.store;
  const candidateUserIds = Array.from(
    new Set<string>([
      ...store.listUsers().map((u) => u.userId),
      ...DEMO_PERSONAS_SEED.map((p) => p.userId),
      ...extraCandidateUserIds,
    ]),
  );

  const queue: { tenantId: string; legalEntityId: string }[] = [];
  const queuedKeys = new Set<string>();
  const enqueue = (tenantId: string, legalEntityId: string): void => {
    const key = `${tenantId}:${legalEntityId}`;
    if (!queuedKeys.has(key)) {
      queuedKeys.add(key);
      queue.push({ tenantId, legalEntityId });
    }
  };

  if (options?.includeDemoSeedFallback) {
    for (const seedComp of DEMO_COMPANIES_SEED) {
      if (rawTenantIds.includes(seedComp.tenantId)) {
        enqueue(seedComp.tenantId, seedComp.legalEntityId);
      }
    }
  }

  for (const rawTenantId of Array.from(new Set(rawTenantIds))) {
    const tId = parseTenantId(rawTenantId);
    const discovered = await listTenantCompanyGrantsForAdminFacts(
      runtime.connection.db,
      runtime.signer,
      {
        tenantId: tId,
        candidateUserIds,
      },
    );

    for (const mRow of discovered.memberships) {
      store.upsertMembership({
        ...mRow,
        tenantId: parseTenantId(mRow.tenantId),
        userId: parseUserId(mRow.userId),
      });
    }

    const seenGrantIds = new Set<string>();
    const discoveredUserIds = new Set<string>(discovered.memberships.map((m) => m.userId));
    for (const gRow of discovered.grants) {
      seenGrantIds.add(gRow.grantId);
      discoveredUserIds.add(gRow.userId);
      store.upsertGrant({
        grantId: gRow.grantId,
        tenantId: parseTenantId(gRow.tenantId),
        userId: parseUserId(gRow.userId),
        legalEntityId: parseLegalEntityId(gRow.legalEntityId),
        action: gRow.action,
        validFrom: gRow.validFrom,
        validUntil: gRow.validUntil,
        revokedAt: gRow.revokedAt,
      });
      enqueue(gRow.tenantId, gRow.legalEntityId);
    }

    if (discovered.grants.length > 0) {
      const now = new Date();
      for (const comp of store.listCompaniesForTenant(tId)) {
        for (const cached of store.listGrantsForCompany(tId, comp.legalEntityId)) {
          if (
            discoveredUserIds.has(cached.userId) &&
            cached.revokedAt === null &&
            !seenGrantIds.has(cached.grantId)
          ) {
            store.upsertGrant({
              ...cached,
              revokedAt: now,
            });
          }
        }
      }
    }
  }

  for (const target of queue) {
    await hydrateCompanyIntoWorkspaceIfMissing(
      runtime,
      workspace,
      target.tenantId,
      target.legalEntityId,
    );
  }
}

export async function hydrateWorkspaceFromPostgres(
  runtime: ConnectedPostgresRuntime,
  sandboxIssuer: string,
): Promise<AccountingWorkspaceService> {
  const store = new InMemoryAccountingWorkspaceStore();
  const workspace = new AccountingWorkspaceService({ store, seedDemoData: false });

  // 1. Hydracja kont użytkowników z app_user + user_oidc_identity przez pap_resolve_identity
  for (const persona of DEMO_PERSONAS_SEED) {
    const resolved = await runtime.securityServices.identityResolver.resolveVerifiedIdentity({
      issuer: sandboxIssuer,
      subject: persona.userId,
    });
    if (resolved) {
      store.upsertUser({
        userId: resolved.userId,
        subject: persona.userId,
        displayName: persona.displayName,
        email: persona.email,
        active: true,
      });
    }
  }

  // 2. Odkrycie i hydracja wszystkich firm w każdym tenancie przez administracyjne `facts`
  //    z obiektem `command` (`pap_admin_allowed` + `pap_grant_read`, zero DML i zero wpisów
  //    w `security_decision_event`).
  await discoverAndHydrateMissingCompaniesForTenants(
    runtime,
    workspace,
    [TENANT_1_ID, TENANT_2_ID],
    [],
    { includeDemoSeedFallback: true },
  );

  return workspace;
}
