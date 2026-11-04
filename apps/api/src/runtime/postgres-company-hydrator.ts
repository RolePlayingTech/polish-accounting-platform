import { randomUUID } from 'node:crypto';
import type { CompanyDocumentItemContract, SettlementItemContract } from '@pap/contracts';
import {
  AccountingWorkspaceService,
  COMPANY_JDG_KPIR_ID,
  COMPANY_TENANT_2_ID,
  DEMO_COMPANIES_SEED,
  DEMO_EVALUATION_DATE,
  DEMO_PERSONAS_SEED,
  DEMO_USER_JAN_ID,
  DEMO_USER_PIOTR_ID,
  InMemoryAccountingWorkspaceStore,
  TENANT_1_ID,
  TENANT_2_ID,
  executeAuthorizedCompanyAction,
  type OidcAccessTokenVerifier,
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
import type {
  AccountingDocumentRecord,
  BankTransactionRecord,
  JournalEntryWithLinesRecord,
  KpirEntryRecord,
  McpPreparedProposalRecord,
  PostgresAccountingScope,
  RyczaltEntryRecord,
  SettlementItemRecord,
  VatRegisterEntryRecord,
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
  INTERNAL_TENANT_COMPANY_INDEX_CATEGORY,
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

function createInternalHydrationVerifier(issuer: string): OidcAccessTokenVerifier {
  return {
    async verifyAccessToken(rawToken: string) {
      const subject = rawToken.replace(/^hydrate-token:/, '');
      return {
        ok: true,
        identity: {
          issuer,
          subject,
        },
      };
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
    return postedSnapshot.documentItem;
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
    const mappedStatus: CompanyDocumentItemContract['status'] =
      row.status === 'verified_posted'
        ? 'posted'
        : row.status === 'archived'
          ? 'archived'
          : draftSnapshot.status;
    return {
      ...draftSnapshot,
      status: mappedStatus,
      approvedByUserId: row.verifiedBy ?? draftSnapshot.approvedByUserId,
      approvedAt: row.verifiedAt ? row.verifiedAt.toISOString() : draftSnapshot.approvedAt,
    };
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

function hydrateMcpProposalFromRecord(row: McpPreparedProposalRecord): WorkspaceStoredMcpProposal {
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

async function hydrateSingleCompanyFromScope(
  scope: PostgresAccountingScope,
  rawTenantId: string,
  rawLegalEntityId: string,
): Promise<{
  readonly company: WorkspaceCompanyState;
  readonly mcpProposals: readonly WorkspaceStoredMcpProposal[];
  readonly discoveredCompanyIds: readonly string[];
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

  const meta = decodeCompanyMetaFromAddress(settings.addressSummary);
  const seedFallback = DEMO_COMPANIES_SEED.find(
    (s) => s.tenantId === rawTenantId && s.legalEntityId === rawLegalEntityId,
  );
  const displayName = meta?.displayName ?? seedFallback?.displayName ?? `Firma ${settings.nip}`;
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
  const discoveredCompanyIds: string[] = [];
  const mcpProposalIds = new Set<string>();
  const explanationsById = new Map<string, WorkspaceExplanationRecord>();
  const documents: CompanyDocumentItemContract[] = [];

  for (const row of rawDocs) {
    if (row.categoryCode === INTERNAL_TENANT_COMPANY_INDEX_CATEGORY) {
      const json = (row.aiProposalJson ?? {}) as Record<string, unknown>;
      if (typeof json.createdLegalEntityId === 'string') {
        discoveredCompanyIds.push(json.createdLegalEntityId);
      }
      continue;
    }
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
    documents.push(hydrateDocumentFromRecord(row, explanationsById));
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
      mcpProposals.push(hydrateMcpProposalFromRecord(rec));
    }
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
      settingsHistory: meta?.settingsHistory ? [...meta.settingsHistory] : [],
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
    discoveredCompanyIds,
    notificationPrefs,
  };
}

export async function hydrateWorkspaceFromPostgres(
  runtime: ConnectedPostgresRuntime,
  sandboxIssuer: string,
): Promise<AccountingWorkspaceService> {
  const store = new InMemoryAccountingWorkspaceStore();
  const workspace = new AccountingWorkspaceService({ store, seedDemoData: false });
  const verifier = createInternalHydrationVerifier(sandboxIssuer);

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

  // 2. Kolejka znanych firm (4 firmy bazowe + ewentualne nowe firmy utworzone przez POST /companies)
  const queue: { tenantId: string; legalEntityId: string }[] = DEMO_COMPANIES_SEED.map((c) => ({
    tenantId: c.tenantId,
    legalEntityId: c.legalEntityId,
  }));
  const visited = new Set<string>();

  while (queue.length > 0) {
    const target = queue.shift()!;
    const key = `${target.tenantId}:${target.legalEntityId}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);

    const tId = parseTenantId(target.tenantId);
    const leId = parseLegalEntityId(target.legalEntityId);

    // Hydracja członkostw i grantów dostępu dla wszystkich person z bazy PostgreSQL
    for (const persona of DEMO_PERSONAS_SEED) {
      const uId = parseUserId(persona.userId);
      if (!store.getUserById(uId)) {
        continue;
      }
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

    const ownerUserId =
      target.tenantId === TENANT_1_ID
        ? DEMO_USER_JAN_ID
        : target.tenantId === TENANT_2_ID
          ? DEMO_USER_PIOTR_ID
          : null;
    if (!ownerUserId || !store.getUserById(parseUserId(ownerUserId))) {
      continue;
    }

    const hydrated = await executeAuthorizedCompanyAction(
      {
        requestId: randomUUID(),
        rawBearerToken: `hydrate-token:${ownerUserId}`,
        tenantId: tId,
        legalEntityId: leId,
        action: 'read',
      },
      {
        ...runtime.securityServices,
        verifier,
      },
      (_ctx, scope) => hydrateSingleCompanyFromScope(scope, target.tenantId, target.legalEntityId),
    );

    if (!hydrated.allowed || !hydrated.data) {
      continue;
    }

    store.saveCompany(hydrated.data.company);
    for (const proposal of hydrated.data.mcpProposals) {
      store.upsertMcpProposal(proposal);
    }
    for (const extraLeId of hydrated.data.discoveredCompanyIds) {
      if (!visited.has(`${target.tenantId}:${extraLeId}`)) {
        queue.push({ tenantId: target.tenantId, legalEntityId: extraLeId });
      }
    }
    for (const pref of hydrated.data.notificationPrefs) {
      const persona = DEMO_PERSONAS_SEED.find((p) => p.userId === pref.userId);
      if (persona) {
        await workspace.updateNotificationPreferences(
          {
            userId: persona.userId,
            issuer: sandboxIssuer,
            subject: persona.userId,
            displayName: persona.displayName,
            email: persona.email,
            scopes: persona.defaultScopes,
          },
          target.tenantId,
          target.legalEntityId,
          {
            recipientEmail: pref.recipientEmail,
            frequency: pref.frequency,
            optionalRemindersOptedOut: pref.optOut,
            explicitDisabledStages: pref.disabledStages as never[],
          },
        );
      }
    }
  }

  // Odkrycie dodatkowych firm z dokumentów indeksowych w firmach kotwiczących (defensywnie)
  void COMPANY_JDG_KPIR_ID;
  void COMPANY_TENANT_2_ID;

  return workspace;
}
