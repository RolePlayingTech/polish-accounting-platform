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
  type WorkspaceActorContext,
  type WorkspaceCompanyState,
  type WorkspaceHumanChallenge,
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
import type { NotificationOutboxEntry } from '@pap/contracts/notifications';
import {
  createPostgresAccountingScope,
  discoverActorAccessibleEntities,
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

export function hydrateMcpChallengeFromRecord(
  row: McpPreparedProposalRecord,
): WorkspaceHumanChallenge | null {
  if (row.status !== 'pending_human_approval') {
    return null;
  }
  const invRaw = (row.invoiceJson ?? {}) as Record<string, unknown>;
  const rawCh = invRaw._papChallenge;
  if (typeof rawCh !== 'object' || rawCh === null) {
    return null;
  }
  const ch = rawCh as Record<string, unknown>;
  if (
    typeof ch.humanUserId !== 'string' ||
    typeof ch.expectedPayloadHash !== 'string' ||
    typeof ch.codeSha256Hex !== 'string' ||
    typeof ch.expiresAtMs !== 'number' ||
    typeof ch.expiresAtIso !== 'string'
  ) {
    return null;
  }
  return {
    proposalId: row.proposalId,
    tenantId: parseTenantId(row.tenantId),
    legalEntityId: parseLegalEntityId(row.legalEntityId),
    humanUserId: parseUserId(ch.humanUserId),
    expectedPayloadHash: ch.expectedPayloadHash,
    codeSha256Hex: ch.codeSha256Hex,
    expiresAtMs: ch.expiresAtMs,
    expiresAtIso: ch.expiresAtIso,
    consumedAtIso: typeof ch.consumedAtIso === 'string' ? ch.consumedAtIso : null,
  };
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
  delete invRaw._papChallenge;

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

export interface HydratedCompanyFromScopeResult {
  readonly company: WorkspaceCompanyState;
  readonly mcpProposals: readonly WorkspaceStoredMcpProposal[];
  readonly mcpChallenges: readonly WorkspaceHumanChallenge[];
  readonly auditEvents: readonly AuditLogEntry[];
  readonly notificationPrefs: readonly {
    readonly userId: string;
    readonly recipientEmail: string;
    readonly frequency: 'standard' | 'urgent_only' | 'overdue_only';
    readonly optOut: boolean;
    readonly disabledStages: readonly string[];
  }[];
  readonly outboxEntries: readonly NotificationOutboxEntry[];
}

export interface MidHydrationHookInfo {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly documentsCount: number;
  readonly postedDocumentsCount: number;
}

export async function hydrateSingleCompanyFromScope(
  scope: PostgresAccountingScope,
  rawTenantId: string,
  rawLegalEntityId: string,
  extraUserIds: readonly string[] = [],
  onMidHydrationHook?: ((info: MidHydrationHookInfo) => Promise<void> | void) | undefined,
): Promise<HydratedCompanyFromScopeResult | null> {
  // ADR-010 Sekcja 3: korzeń firmy (legal_entity) blokowany jako pierwszy (FOR SHARE przy read, FOR UPDATE przy write),
  // co serializuje wielozapytaniowy odczyt hydracji względem współbieżnych transakcji zapisu pod READ COMMITTED.
  const entitySummary = await scope.getLegalEntitySummary();
  const settings = await scope.getCompanyTaxSettings();
  if (!settings) {
    return null;
  }
  const latestProfileVersion =
    typeof scope.getLatestEntityProfileVersion === 'function'
      ? await scope.getLatestEntityProfileVersion()
      : null;
  const profileJsonObj =
    latestProfileVersion?.profileJson && typeof latestProfileVersion.profileJson === 'object'
      ? (latestProfileVersion.profileJson as Record<string, unknown>)
      : null;
  const addressMeta = decodeCompanyMetaFromAddress(settings.addressSummary);
  const profileTaxProfile =
    profileJsonObj?.taxProfile && typeof profileJsonObj.taxProfile === 'object'
      ? (profileJsonObj.taxProfile as TaxProfileConfigContract)
      : undefined;
  const profileSettingsHistory = Array.isArray(profileJsonObj?.settingsHistory)
    ? (profileJsonObj.settingsHistory as WorkspaceCompanyState['settingsHistory'])
    : undefined;
  const seedFallback = DEMO_COMPANIES_SEED.find(
    (s) => s.tenantId === rawTenantId && s.legalEntityId === rawLegalEntityId,
  );
  const displayName =
    addressMeta?.displayName ??
    (typeof profileJsonObj?.displayName === 'string' ? profileJsonObj.displayName : undefined) ??
    entitySummary?.displayName ??
    seedFallback?.displayName ??
    `Firma ${settings.nip}`;
  const legalForm = settings.legalForm === 'sp_z_o_o' ? 'sp_z_o_o' : 'jdg';
  const vatStatusSimple = settings.vatStatus;
  const taxProfile: TaxProfileConfigContract = addressMeta?.taxProfile ??
    profileTaxProfile ??
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

  if (onMidHydrationHook) {
    await onMidHydrationHook({
      tenantId: rawTenantId,
      legalEntityId: rawLegalEntityId,
      documentsCount: documents.length,
      postedDocumentsCount: documents.filter((d) => d.status === 'posted').length,
    });
  }

  const kpirRows = await scope.listKpirEntries();
  const kpirEntries = kpirRows
    .map((r) => hydrateKpirFromRecord(r, explanationsById))
    .filter((e): e is KpirEntry => e !== null)
    .sort((a, b) => a.ordinalNumber - b.ordinalNumber);
  for (const r of kpirRows) {
    if (r.documentId === null) {
      auditEvents.push({
        auditEventId: `pg-kpir-manual-${r.id}`,
        occurredAt: r.createdAt.toISOString(),
        channel: 'accounting',
        action: 'kpir_manual_entry_created',
        actorUserId: r.createdBy,
        actorDisplayLabel: resolvePersonaDisplayLabel(r.createdBy),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        outcome: 'allow',
        reasonCode: 'manual_kpir_entry',
        summaryPl: `Dodano ręczny wpis KPiR Lp. ${r.lp} (${r.documentNumber}).`,
      });
    }
  }

  const ryczaltRows = await scope.listRyczaltEntries();
  const ryczaltEntries = ryczaltRows
    .map((r) => hydrateRyczaltFromRecord(r, explanationsById))
    .sort((a, b) => a.ordinalNumber - b.ordinalNumber);
  for (const r of ryczaltRows) {
    if (r.documentId === null) {
      auditEvents.push({
        auditEventId: `pg-ryczalt-manual-${r.id}`,
        occurredAt: r.createdAt.toISOString(),
        channel: 'accounting',
        action: 'ryczalt_manual_entry_created',
        actorUserId: r.createdBy,
        actorDisplayLabel: resolvePersonaDisplayLabel(r.createdBy),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        outcome: 'allow',
        reasonCode: 'manual_ryczalt_entry',
        summaryPl: `Dodano ręczny wpis ryczałtu Lp. ${r.lp} (${r.documentNumber}).`,
      });
    }
  }

  const vatRows = await scope.listVatRegisterEntries();
  const vatEntries = vatRows
    .map((r) => hydrateVatFromRecord(r, explanationsById))
    .filter((e): e is VatRegisterEntry => e !== null);

  const journalRows = await scope.listJournalEntries();
  const journalEntries = journalRows.map((r) => hydrateJournalFromRecord(r, explanationsById));
  for (const r of journalRows) {
    if (r.entry.documentId === null) {
      auditEvents.push({
        auditEventId: `pg-journal-manual-${r.entry.id}`,
        occurredAt: r.entry.createdAt.toISOString(),
        channel: 'accounting',
        action: 'journal_entry_posted',
        actorUserId: r.entry.createdBy,
        actorDisplayLabel: resolvePersonaDisplayLabel(r.entry.createdBy),
        tenantId: rawTenantId,
        legalEntityId: rawLegalEntityId,
        outcome: 'allow',
        reasonCode: 'double_entry_balanced',
        summaryPl: `Zaksięgowano dekret ${r.entry.entryNumber} (${r.entry.description}).`,
      });
    }
  }

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
      paidObligationsByKey.set(`${ob.period}::${ob.obligationCode}`, paidIso);
      paidObligationsByKey.set(ob.id, paidIso);
    }
  }

  const mcpProposals: WorkspaceStoredMcpProposal[] = [];
  const mcpChallenges: WorkspaceHumanChallenge[] = [];
  const mcpRecords: McpPreparedProposalRecord[] = [];
  if (typeof scope.listMcpPreparedProposals === 'function') {
    const allMcpRecords = await scope.listMcpPreparedProposals();
    mcpRecords.push(...allMcpRecords);
  } else {
    for (const propId of mcpProposalIds) {
      const rec = await scope.getMcpPreparedProposal(propId);
      if (rec) {
        mcpRecords.push(rec);
      }
    }
  }
  const seenProposalIds = new Set<string>();
  for (const rec of mcpRecords) {
    if (seenProposalIds.has(rec.proposalId)) {
      continue;
    }
    seenProposalIds.add(rec.proposalId);
    const hydratedProposal = hydrateMcpProposalFromRecord(rec);
    mcpProposals.push(hydratedProposal);
    const hydratedChallenge = hydrateMcpChallengeFromRecord(rec);
    if (hydratedChallenge) {
      mcpChallenges.push(hydratedChallenge);
    }
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

  const rawSettingsHistory = addressMeta?.settingsHistory ?? profileSettingsHistory;
  const settingsHistory = rawSettingsHistory ? [...rawSettingsHistory] : [];
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
  const candidatePrefUserIds = new Set<string>();
  for (const persona of DEMO_PERSONAS_SEED) {
    if (persona.tenantId === rawTenantId) {
      candidatePrefUserIds.add(persona.userId);
    }
  }
  for (const extraUserId of extraUserIds) {
    candidatePrefUserIds.add(extraUserId);
  }
  for (const candidateUserId of candidatePrefUserIds) {
    const pref = await scope.getNotificationPreference(candidateUserId);
    if (pref) {
      notificationPrefs.push({
        userId: candidateUserId,
        recipientEmail: pref.recipientEmail,
        frequency: pref.frequency,
        optOut: pref.optOut,
        disabledStages: pref.disabledStages,
      });
    }
  }

  const outboxEntries: NotificationOutboxEntry[] = [];
  if (typeof scope.listNotificationOutbox === 'function') {
    const dbOutbox = await scope.listNotificationOutbox();
    for (const row of dbOutbox) {
      const payload = row.payloadJson;
      if (typeof payload !== 'object' || payload === null) {
        continue;
      }
      const savedOutbox = (payload as { _papOutboxEntry?: unknown })._papOutboxEntry;
      if (
        typeof savedOutbox === 'object' &&
        savedOutbox !== null &&
        typeof (savedOutbox as { outboxId?: unknown }).outboxId === 'string' &&
        typeof (savedOutbox as { deduplicationKey?: unknown }).deduplicationKey === 'string'
      ) {
        const typed = savedOutbox as NotificationOutboxEntry;
        outboxEntries.push({
          ...typed,
          status: row.status,
          retryCount: row.attemptCount,
        });
      }
    }
  }

  const hydratedAddress =
    addressMeta?.address ??
    (profileJsonObj?.address as WorkspaceCompanyState['address'] | undefined);

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
      ...(hydratedAddress !== undefined ? { address: hydratedAddress } : {}),
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
    mcpChallenges,
    auditEvents,
    notificationPrefs,
    outboxEntries,
  };
}

export async function applyHydratedCompanyToWorkspace(
  workspace: AccountingWorkspaceService,
  hydrated: HydratedCompanyFromScopeResult,
  rawTenantId: string,
  rawLegalEntityId: string,
): Promise<void> {
  const store = workspace.store;
  const tId = parseTenantId(rawTenantId);
  const leId = parseLegalEntityId(rawLegalEntityId);

  store.saveCompany(hydrated.company);
  for (const proposal of hydrated.mcpProposals) {
    store.upsertMcpProposal(proposal);
  }
  for (const challenge of hydrated.mcpChallenges) {
    store.saveHumanChallenge(challenge);
  }
  workspace.syncStoreMcpProposalsToBoundGateways(tId, leId);

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

  for (const outboxEntry of hydrated.outboxEntries) {
    workspace.notificationsEngine.seedPersistedOutboxEntry(outboxEntry);
  }
}

export async function createTransactionIsolatedWorkspaceFromScope(params: {
  readonly scope: PostgresAccountingScope;
  readonly baseWorkspace: AccountingWorkspaceService;
  readonly actor: WorkspaceActorContext;
  readonly rawTenantId: string;
  readonly rawLegalEntityId: string;
  readonly action: 'read' | 'write';
  readonly onMidHydrationHook?: ((info: MidHydrationHookInfo) => Promise<void> | void) | undefined;
}): Promise<{
  readonly txWorkspace: AccountingWorkspaceService;
  readonly hydrated: HydratedCompanyFromScopeResult | null;
}> {
  const tId = parseTenantId(params.rawTenantId);
  const leId = parseLegalEntityId(params.rawLegalEntityId);
  const uId = parseUserId(params.actor.userId);

  const hydrated = await hydrateSingleCompanyFromScope(
    params.scope,
    tId,
    leId,
    [uId],
    params.onMidHydrationHook,
  );
  const txStore = new InMemoryAccountingWorkspaceStore();
  const txWorkspace = new AccountingWorkspaceService({
    store: txStore,
    clock: params.baseWorkspace.clock,
    seedDemoData: false,
    sandboxMailboxTransport: params.baseWorkspace.sandboxMailboxTransport,
  });

  for (const u of params.baseWorkspace.store.listUsers()) {
    txStore.upsertUser(u);
  }
  if (!txStore.getUserById(uId)) {
    txStore.upsertUser({
      userId: uId,
      subject: params.actor.subject ?? uId,
      displayName: params.actor.displayName ?? `Użytkownik ${uId.slice(0, 8)}`,
      email: params.actor.email ?? 'uzytkownik@pap.example',
      active: true,
    });
  }

  for (const m of params.baseWorkspace.store.listTenantMemberships(tId)) {
    txStore.upsertMembership(m);
  }
  const existingMembership = txStore.getMembership(tId, uId);
  if (!existingMembership || existingMembership.status !== 'active') {
    txStore.upsertMembership({
      tenantId: tId,
      userId: uId,
      role: existingMembership?.role ?? 'tenant_owner',
      status: 'active',
      validFrom: new Date(0),
      validUntil: null,
    });
  }

  for (const g of params.baseWorkspace.store.listGrantsForCompany(tId, leId)) {
    txStore.upsertGrant(g);
  }
  const requiredActions: readonly ('read' | 'write')[] =
    params.action === 'write' ? ['read', 'write'] : ['read'];
  for (const reqAction of requiredActions) {
    const hasActiveGrant = txStore
      .listGrantsForCompany(tId, leId)
      .some((g) => g.userId === uId && g.action === reqAction && g.revokedAt === null);
    if (!hasActiveGrant) {
      txStore.upsertGrant({
        grantId: randomUUID(),
        tenantId: tId,
        legalEntityId: leId,
        userId: uId,
        action: reqAction,
        validFrom: new Date(0),
        validUntil: null,
        revokedAt: null,
      });
    }
  }

  const baseAudits = params.baseWorkspace.store
    .listAuditEvents({ tenantId: tId, legalEntityId: leId })
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const ev of baseAudits) {
    txStore.appendAuditEvent(ev);
  }

  if (hydrated) {
    await applyHydratedCompanyToWorkspace(txWorkspace, hydrated, tId, leId);
  }

  return { txWorkspace, hydrated };
}

export async function syncCommittedTxWorkspaceToInner(params: {
  readonly txWorkspace: AccountingWorkspaceService;
  readonly innerWorkspace: AccountingWorkspaceService;
  readonly rawTenantId: string;
  readonly rawLegalEntityId: string;
  readonly actorUserId: string;
}): Promise<void> {
  const tId = parseTenantId(params.rawTenantId);
  const leId = parseLegalEntityId(params.rawLegalEntityId);
  const uId = parseUserId(params.actorUserId);

  const committedCompany = params.txWorkspace.store.getCompany(tId, leId);
  if (committedCompany) {
    params.innerWorkspace.store.saveCompany(committedCompany);
  }

  for (const proposal of params.txWorkspace.store.listMcpProposals(tId, leId)) {
    params.innerWorkspace.store.upsertMcpProposal(proposal);
    const challenge = params.txWorkspace.store.getHumanChallenge(proposal.proposalId);
    if (challenge) {
      params.innerWorkspace.store.saveHumanChallenge(challenge);
    }
  }
  params.innerWorkspace.syncStoreMcpProposalsToBoundGateways(tId, leId);

  const existingAuditIds = new Set(
    params.innerWorkspace.store
      .listAuditEvents({ tenantId: tId, legalEntityId: leId })
      .map((e) => e.auditEventId),
  );
  const newAudits = params.txWorkspace.store
    .listAuditEvents({ tenantId: tId, legalEntityId: leId })
    .filter((e) => !existingAuditIds.has(e.auditEventId))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const ev of newAudits) {
    params.innerWorkspace.store.appendAuditEvent(ev);
  }

  const userRecord = params.txWorkspace.store.getUserById(uId);
  const defaultRecipient = userRecord?.email ?? 'powiadomienia@syntetyczny.example';
  const txPrefs = params.txWorkspace.notificationsEngine.getOrDefaultPreferences({
    tenantId: tId,
    legalEntityId: leId,
    userId: uId,
    recipientEmail: defaultRecipient,
  });
  await params.innerWorkspace.notificationsEngine.configurePreferences({
    tenantId: tId,
    legalEntityId: leId,
    userId: uId,
    recipientEmail: txPrefs.recipientEmail,
    frequency: txPrefs.frequency,
    optionalRemindersOptedOut: txPrefs.optionalRemindersOptedOut,
    explicitDisabledStages: txPrefs.disabledStages,
  });

  for (const outboxEntry of params.txWorkspace.notificationsEngine.listOutboxEntries({
    tenantId: tId,
    legalEntityId: leId,
  })) {
    params.innerWorkspace.notificationsEngine.seedPersistedOutboxEntry(outboxEntry);
  }
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
  options?: { readonly forceFresh?: boolean },
): Promise<boolean> {
  const store = workspace.store;
  const tId = parseTenantId(rawTenantId);
  const leId = parseLegalEntityId(rawLegalEntityId);

  if (!options?.forceFresh && store.getCompany(tId, leId) !== null) {
    return true;
  }

  const candidateUsers = new Set<string>(store.listUsers().map((u) => u.userId));
  if (preferredActorUserId) {
    candidateUsers.add(parseUserId(preferredActorUserId));
  }

  const batchDiscovered = await discoverActorAccessibleEntities(
    runtime.connection.db,
    runtime.signer,
    Array.from(candidateUsers),
    tId,
  ).catch(() => null);

  if (
    batchDiscovered &&
    (batchDiscovered.memberships.length > 0 || batchDiscovered.grants.length > 0)
  ) {
    for (const m of batchDiscovered.memberships) {
      store.upsertMembership({
        ...m,
        tenantId: parseTenantId(m.tenantId),
        userId: parseUserId(m.userId),
      });
    }
    for (const g of batchDiscovered.grants) {
      store.upsertGrant({
        grantId: g.grantId,
        tenantId: parseTenantId(g.tenantId),
        userId: parseUserId(g.userId),
        legalEntityId: parseLegalEntityId(g.legalEntityId),
        action: g.action,
        validFrom: g.validFrom,
        validUntil: g.validUntil,
        revokedAt: g.revokedAt,
      });
    }
  } else {
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
    (scope) => hydrateSingleCompanyFromScope(scope, tId, leId, Array.from(candidateUsers)),
  );

  if (!hydrated) {
    return false;
  }

  await applyHydratedCompanyToWorkspace(workspace, hydrated, tId, leId);
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

  const tenantSet = new Set<string>(rawTenantIds);
  const actorDiscovered = await discoverActorAccessibleEntities(
    runtime.connection.db,
    runtime.signer,
    candidateUserIds,
  ).catch(() => null);
  const hasActorDiscovered =
    actorDiscovered !== null &&
    (actorDiscovered.memberships.length > 0 ||
      actorDiscovered.grants.length > 0 ||
      actorDiscovered.entities.length > 0);

  if (hasActorDiscovered && actorDiscovered) {
    const seenGrantIds = new Set<string>();
    const discoveredUserByTenant = new Set<string>();
    for (const mRow of actorDiscovered.memberships) {
      tenantSet.add(mRow.tenantId);
      discoveredUserByTenant.add(`${mRow.tenantId}:${mRow.userId}`);
      store.upsertMembership({
        ...mRow,
        tenantId: parseTenantId(mRow.tenantId),
        userId: parseUserId(mRow.userId),
      });
    }
    for (const gRow of actorDiscovered.grants) {
      tenantSet.add(gRow.tenantId);
      seenGrantIds.add(gRow.grantId);
      discoveredUserByTenant.add(`${gRow.tenantId}:${gRow.userId}`);
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
    for (const ent of actorDiscovered.entities) {
      enqueue(ent.tenantId, ent.legalEntityId);
    }
    const now = new Date();
    for (const comp of store.listAllCompanies()) {
      for (const cached of store.listGrantsForCompany(comp.tenantId, comp.legalEntityId)) {
        if (
          discoveredUserByTenant.has(`${comp.tenantId}:${cached.userId}`) &&
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
  } else {
    const explicitActorIds = Array.from(
      new Set<string>(
        extraCandidateUserIds.length > 0
          ? extraCandidateUserIds
          : store.listUsers().map((u) => u.userId),
      ),
    );
    if (explicitActorIds.length > 0) {
      for (const rawTenantId of Array.from(tenantSet)) {
        const tId = parseTenantId(rawTenantId);
        for (const actorUserId of explicitActorIds) {
          const discovered = await listTenantCompanyGrantsForAdminFacts(
            runtime.connection.db,
            runtime.signer,
            {
              actorUserId,
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
            break;
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
