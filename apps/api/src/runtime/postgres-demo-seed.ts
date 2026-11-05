import { randomUUID } from 'node:crypto';
import type { CompanyDocumentItemContract, SettlementItemContract } from '@pap/contracts';
import type {
  JournalEntryContract,
  KpirEntryContract,
  RyczaltEntryContract,
} from '@pap/contracts/accounting';
import {
  AccountingWorkspaceService,
  DEMO_COMPANIES_SEED,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
  DEMO_INITIAL_GRANTS_SEED,
  DEMO_PERSONAS_SEED,
  DEMO_USER_JAN_ID,
  DEMO_USER_PIOTR_ID,
  TENANT_1_ID,
  executeAuthorizedCompanyAction,
  type OidcAccessTokenVerifier,
  type WorkspaceCompanyState,
  type WorkspaceStoredMcpProposal,
} from '@pap/application';
import {
  DatabaseConfigError,
  connectDatabase,
  createPostgresAccountingScope,
  type DatabaseEnvironment,
  type PostgresAccountingScope,
} from '@pap/db';
import {
  STANDARD_SPZOO_CHART_OF_ACCOUNTS,
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
  type JournalEntry,
  type KpirEntry,
  type RyczaltEntry,
  type VatRegisterEntry,
} from '@pap/domain';
import {
  INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY,
  computeMcpProposalSealHash,
  deterministicUuidV4,
  encodeCompanyMetaInAddress,
  encodePostedDocumentSnapshotInDescription,
  isCanonicalUuid,
  mapContractKsefMarkerToDb,
  mapRyczaltRateCodeToBps,
  mapZusSchemeToDbStage,
  resolveDbKsefMode,
  sha256Hex,
  toUuidOrDeterministic,
  type WorkspaceExplanationRecord,
} from './postgres-mappers.js';
import type { ConnectedPostgresRuntime } from './postgres-runtime-config.js';

export function buildExplanationMapSnapshot(
  company: WorkspaceCompanyState,
  docItem: CompanyDocumentItemContract,
): Record<string, WorkspaceExplanationRecord> {
  const result: Record<string, WorkspaceExplanationRecord> = {};
  const ids = new Set<string>([docItem.documentId]);
  if (docItem.postingResult) {
    ids.add(docItem.postingResult.accountingItemId);
    if (docItem.postingResult.kpirEntryId) ids.add(docItem.postingResult.kpirEntryId);
    if (docItem.postingResult.ryczaltEntryId) ids.add(docItem.postingResult.ryczaltEntryId);
    if (docItem.postingResult.journalEntryId) ids.add(docItem.postingResult.journalEntryId);
    for (const vatId of docItem.postingResult.vatEntryIds) {
      ids.add(vatId);
    }
  }
  for (const id of ids) {
    const found = company.explanationsById.get(id);
    if (found) {
      result[id] = found;
    }
  }
  return result;
}

export async function persistCompanyTaxSettingsToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
): Promise<void> {
  await scope.upsertCompanyTaxSettings({
    id: deterministicUuidV4(`tax-settings:${company.tenantId}:${company.legalEntityId}`),
    nip: company.nip,
    regon: company.taxProfile.regon ?? null,
    krs: company.taxProfile.krs ?? null,
    legalForm: company.legalForm,
    taxRegime: company.taxRegime,
    vatStatus: company.vatStatusSimple,
    zusStage: mapZusSchemeToDbStage(company.taxProfile.zusScheme),
    ksefMode: resolveDbKsefMode(company.taxProfile),
    addressSummary: encodeCompanyMetaInAddress({
      displayName: company.displayName,
      legalForm: company.legalForm,
      taxRegime: company.taxRegime,
      vatStatusSimple: company.vatStatusSimple,
      taxProfile: company.taxProfile,
      settingsHistory: company.settingsHistory,
    }),
    smallTaxpayer: company.taxProfile.smallTaxpayer,
    voluntarySicknessInsurance: company.taxProfile.voluntarySicknessInsurance,
  });
}

export async function persistDocumentItemToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  docItem: CompanyDocumentItemContract,
): Promise<void> {
  const dbDocType = docItem.isCorrection
    ? 'correction_invoice'
    : docItem.document.direction === 'sales'
      ? 'sales_invoice'
      : 'purchase_invoice';
  const dbStatus =
    docItem.status === 'posted'
      ? 'verified_posted'
      : docItem.status === 'draft'
        ? 'draft'
        : 'ai_proposed';
  const vehicleUsage: 'none' | 'mixed_50_75' | 'exclusive_100' =
    docItem.aiProposal.vatDeductionMode === 'vehicle_mixed_50' ||
    docItem.aiProposal.kpirQualification === 'vehicle_mixed_75_col13'
      ? 'mixed_50_75'
      : 'none';
  const baseLineDesc = docItem.document.lines[0]?.description ?? docItem.document.documentNumber;
  const description =
    docItem.status === 'posted'
      ? encodePostedDocumentSnapshotInDescription(baseLineDesc, {
          documentItem: docItem,
          explanations: buildExplanationMapSnapshot(company, docItem),
        })
      : baseLineDesc;

  await scope.createAccountingDocument({
    id: docItem.documentId,
    documentType: dbDocType,
    documentNumber: docItem.document.documentNumber,
    issueDate: docItem.document.issueDate,
    saleDate: docItem.document.eventDate,
    dueDate: docItem.document.dueDate ?? null,
    counterpartyName: docItem.document.counterpartyName,
    counterpartyNip: docItem.document.counterpartyNip ?? null,
    counterpartyAddress: docItem.document.counterpartyAddress ?? null,
    netGrosze: docItem.document.totalNetGrosze,
    vatGrosze: docItem.document.totalVatGrosze,
    grossGrosze: docItem.document.totalGrossGrosze,
    sha256Hash: docItem.sha256Hash,
    status: dbStatus,
    categoryCode: docItem.aiProposal.suggestedCategory,
    description,
    vehicleUsage,
    ksefReference: docItem.document.ksefReferenceNumber ?? null,
    ksefMarker: mapContractKsefMarkerToDb(docItem.document.ksefMarker),
    aiProposalJson: {
      ...docItem.aiProposal,
      _papDocSnapshot: docItem,
      _papExplanations: buildExplanationMapSnapshot(company, docItem),
    },
    ...(docItem.approvedAt ? { verifiedAt: new Date(docItem.approvedAt) } : {}),
  });
}

export async function persistKpirEntryToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  entry: KpirEntry | KpirEntryContract,
  documentId: string | null,
): Promise<void> {
  const entryUuid = toUuidOrDeterministic(
    `kpir:${company.tenantId}:${company.legalEntityId}`,
    entry.id,
  );
  const stornoTargetUuid = entry.correctedEntryId
    ? toUuidOrDeterministic(
        `kpir:${company.tenantId}:${company.legalEntityId}`,
        entry.correctedEntryId,
      )
    : null;
  const itemExplanation = company.explanationsById.get(entry.id) ?? null;
  await scope.appendKpirEntry({
    id: entryUuid,
    lp: entry.ordinalNumber,
    period: entry.period,
    eventDate: entry.eventDate,
    documentId,
    documentNumber: entry.documentNumber,
    ksefReference: entry.ksefReferenceNumber ?? null,
    counterpartyName: entry.counterpartyName,
    counterpartyNip: entry.counterpartyNip ?? null,
    counterpartyAddress: entry.counterpartyAddress || 'Polska',
    description: entry.eventDescription,
    regulationVersion: entry.regulationVersion,
    col7SalesRevenueGrosze: entry.col7SalesRevenueGrosze,
    col8OtherRevenueGrosze: entry.col8OtherRevenueGrosze,
    col10GoodsMaterialsGrosze: entry.col10GoodsAndMaterialsGrosze,
    col11IncidentalCostsGrosze: entry.col11IncidentalCostsGrosze,
    col12RemunerationGrosze: entry.col12RemunerationGrosze,
    col13OtherExpensesGrosze: entry.col13OtherExpensesGrosze,
    rdCostGrosze: entry.col16ResearchDevelopmentCostGrosze,
    remarks: entry.col17Remarks ?? entry.correctionReason ?? null,
    isStorno: entry.isCorrection,
    stornoOfEntryId: stornoTargetUuid,
    ruleCode: entry.explanation.appliedRules[0]?.ruleCode ?? 'KPIR_2026',
    legalExplanationJson: {
      ...entry.explanation,
      _papKpirEntry: entry,
      _papItemExplanation: itemExplanation,
    },
  });
}

export async function persistRyczaltEntryToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  entry: RyczaltEntry | RyczaltEntryContract,
  documentId: string | null,
): Promise<void> {
  const entryUuid = toUuidOrDeterministic(
    `ryczalt:${company.tenantId}:${company.legalEntityId}`,
    entry.id,
  );
  const correctedUuid = entry.correctedEntryId
    ? toUuidOrDeterministic(
        `ryczalt:${company.tenantId}:${company.legalEntityId}`,
        entry.correctedEntryId,
      )
    : null;
  const itemExplanation = company.explanationsById.get(entry.id) ?? null;
  await scope.appendRyczaltEntry({
    id: entryUuid,
    lp: entry.ordinalNumber,
    period: entry.period,
    eventDate: entry.revenueDate,
    documentId,
    documentNumber: entry.documentNumber,
    counterpartyName: entry.counterpartyName,
    counterpartyNip: entry.counterpartyNip ?? null,
    ksefReference: entry.ksefReferenceNumber ?? null,
    rateBps: mapRyczaltRateCodeToBps(entry.rate),
    revenueGrosze: entry.revenueGrosze,
    isCorrection: entry.isCorrection,
    correctedEntryId: correctedUuid,
    legalExplanationJson: {
      _papRyczaltEntry: entry,
      _papItemExplanation: itemExplanation,
    },
  });
}

export async function persistVatEntryToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  entry: VatRegisterEntry,
  documentId: string | null,
): Promise<void> {
  const entryUuid = toUuidOrDeterministic(
    `vat:${company.tenantId}:${company.legalEntityId}`,
    entry.id,
  );
  const itemExplanation = company.explanationsById.get(entry.id) ?? null;
  await scope.appendVatRegisterEntry({
    id: entryUuid,
    direction: entry.registerType,
    period: entry.period,
    taxPointDate: entry.taxPointDate,
    documentId,
    documentNumber: entry.documentNumber,
    counterpartyName: entry.counterpartyName,
    counterpartyNip: entry.counterpartyNip ?? null,
    vatRateCode: entry.vatRate,
    netGrosze: entry.netGrosze,
    vatTotalGrosze: entry.vatTotalGrosze,
    vatDeductibleGrosze: entry.deductibleVatGrosze,
    vatNonDeductibleGrosze: entry.nonDeductibleVatGrosze,
    procedureMarkers: entry.mandatorySplitPaymentMpp ? ['MPP'] : [],
    ksefMarker: mapContractKsefMarkerToDb(entry.ksefMarker),
    ksefReference: entry.ksefReferenceNumber ?? null,
    legalExplanationJson: {
      ...entry.explanation,
      _papVatEntry: entry,
      _papItemExplanation: itemExplanation,
    },
  });
}

function mapDomainAccountNatureToDb(
  nature: string,
):
  | 'asset'
  | 'contra_asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense'
  | 'tax_expense'
  | 'off_balance' {
  switch (nature) {
    case 'asset':
    case 'contra_asset':
    case 'liability':
    case 'equity':
    case 'revenue':
    case 'expense':
    case 'tax_expense':
    case 'off_balance':
      return nature;
    case 'active':
      return 'asset';
    case 'passive':
    case 'active_passive':
      return 'liability';
    case 'cost':
      return 'expense';
    default:
      return 'asset';
  }
}

export async function ensureLedgerAccountsInScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  extraCodes: readonly string[] = [],
): Promise<Map<string, string>> {
  const existing = await scope.listLedgerAccounts();
  const byCode = new Map<string, string>(existing.map((a) => [a.accountCode, a.id]));
  const catalogByCode = new Map(STANDARD_SPZOO_CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

  const neededCodes = new Set<string>(extraCodes);
  if (company.legalForm === 'sp_z_o_o') {
    for (const acc of STANDARD_SPZOO_CHART_OF_ACCOUNTS) {
      neededCodes.add(acc.code);
    }
  }

  for (const code of neededCodes) {
    if (byCode.has(code)) {
      continue;
    }
    const std = catalogByCode.get(code);
    const firstDigit = Number(code.slice(0, 1));
    const teamNumber =
      Number.isInteger(firstDigit) && firstDigit >= 0 && firstDigit <= 8 ? firstDigit : 0;
    const saved = await scope.upsertLedgerAccount({
      id: deterministicUuidV4(`ledger-acc:${company.tenantId}:${company.legalEntityId}:${code}`),
      accountCode: code,
      namePl: std?.name ?? `Konto syntetyczne ${code}`,
      teamNumber,
      accountNature: mapDomainAccountNatureToDb(std?.nature ?? 'asset'),
      isActive: true,
    });
    byCode.set(code, saved.id);
  }
  return byCode;
}

export async function persistJournalEntryToScope(
  scope: PostgresAccountingScope,
  company: WorkspaceCompanyState,
  entry: JournalEntry | JournalEntryContract,
  documentId: string | null,
): Promise<void> {
  const accountMap = await ensureLedgerAccountsInScope(
    scope,
    company,
    entry.lines.map((l) => l.accountCode),
  );
  const entryUuid = toUuidOrDeterministic(
    `journal:${company.tenantId}:${company.legalEntityId}`,
    entry.id,
  );
  const hasRedStorno = entry.lines.some((l) => l.isRedStorno || l.amountGrosze < 0);
  const itemExplanation = company.explanationsById.get(entry.id) ?? null;

  await scope.postJournalEntry({
    id: entryUuid,
    entryNumber: entry.entryNumber,
    period: entry.period,
    bookingDate: entry.bookingDate,
    documentDate: entry.documentDate,
    documentId,
    documentNumber: entry.documentNumber,
    description: entry.description,
    isStorno: hasRedStorno,
    legalExplanationJson: {
      _papJournalEntry: entry,
      _papItemExplanation: itemExplanation,
    },
    lines: entry.lines.map((line, index) => {
      const ledgerAccountId = accountMap.get(line.accountCode)!;
      const isNegative = line.amountGrosze < 0;
      const dbSide: 'Wn' | 'Ma' = isNegative ? (line.side === 'Wn' ? 'Ma' : 'Wn') : line.side;
      return {
        id: deterministicUuidV4(`journal-line:${entryUuid}:${index + 1}`),
        ledgerAccountId,
        accountCode: line.accountCode,
        side: dbSide,
        amountGrosze: Math.abs(line.amountGrosze),
        description: line.description,
      };
    }),
  });
}

export async function persistSettlementToScope(
  scope: PostgresAccountingScope,
  settlement: SettlementItemContract,
  knownDocumentIds: ReadonlySet<string>,
): Promise<void> {
  if (settlement.grossGrosze <= 0) {
    return;
  }
  const linkedDocId = knownDocumentIds.has(settlement.documentId) ? settlement.documentId : null;
  await scope.createSettlementItem({
    id: settlement.settlementId,
    documentId: linkedDocId,
    direction: settlement.direction,
    counterpartyName: settlement.counterpartyName,
    counterpartyNip: settlement.counterpartyNip,
    documentNumber: settlement.documentNumber,
    issueDate: settlement.issueDate,
    dueDate: settlement.dueDate,
    originalGrossGrosze: settlement.grossGrosze,
  });
  if (settlement.settledGrosze > 0) {
    await scope.applySettlementPayment({
      settlementId: settlement.settlementId,
      paidAmountGrosze: settlement.settledGrosze,
    });
  }
}

export async function persistMcpProposalWithIndexToScope(
  scope: PostgresAccountingScope,
  proposal: WorkspaceStoredMcpProposal,
): Promise<void> {
  const proposalId = isCanonicalUuid(proposal.proposalId)
    ? proposal.proposalId.toLowerCase()
    : deterministicUuidV4(`mcp-prop:${proposal.proposalId}`);
  const idempotencyUuid = toUuidOrDeterministic(
    `mcp-idem:${proposal.tenantId}:${proposal.legalEntityId}`,
    proposal.idempotencyKey,
  );
  const sealHash = computeMcpProposalSealHash(
    proposal.tenantId,
    proposal.legalEntityId,
    proposalId,
    proposal.payloadHash,
  );

  await scope.saveMcpPreparedProposal({
    proposalId,
    idempotencyKey: idempotencyUuid,
    payloadHash: proposal.payloadHash,
    invoiceJson: {
      ...proposal.invoice,
      _papRawIdempotencyKey: proposal.idempotencyKey,
      _papCreatedByUserId: proposal.createdByUserId,
    },
    proposedPostingJson: {
      ...proposal.proposedPosting,
    },
    confirmationChallengeHash: sealHash,
    expiresAt: new Date(proposal.expiresAtMs),
  });

  // Lekki wpis indeksowy w accounting_document pozwalający odnaleźć proposalId po restarcie wyłącznie przez pap_*_app.
  const indexDocId = deterministicUuidV4(
    `mcp-index-doc:${proposal.tenantId}:${proposal.legalEntityId}:${proposalId}`,
  );
  const indexSha = sha256Hex(
    `pap-mcp-index:${proposal.tenantId}:${proposal.legalEntityId}:${proposalId}`,
  );
  await scope.createAccountingDocument({
    id: indexDocId,
    documentType: 'internal_note',
    documentNumber: `MCP-IDX/${proposalId.slice(0, 8)}`,
    issueDate: proposal.invoice.issueDate,
    saleDate: proposal.invoice.issueDate,
    counterpartyName: proposal.invoice.counterpartyName,
    netGrosze: 0,
    vatGrosze: 0,
    grossGrosze: 0,
    sha256Hash: indexSha,
    status: 'draft',
    categoryCode: INTERNAL_MCP_PROPOSAL_INDEX_CATEGORY,
    description: `Indeks propozycji MCP ${proposalId}`,
    aiProposalJson: {
      _papMcpProposalIndex: true,
      proposalId,
    },
  });
}

export interface SeedSyntheticDemoOptions {
  readonly runtime: ConnectedPostgresRuntime;
  readonly migratorDatabaseUrl?: string | undefined;
  readonly sandboxIssuer: string;
}

export interface SeedSyntheticDemoResult {
  readonly seededCompanies: number;
  readonly skippedExistingCompanies: number;
}

async function provisionCoreDirectoryEntitiesWithMigrator(
  migratorUrl: string,
  databaseEnv: DatabaseEnvironment,
  dataSchema: string,
  sandboxIssuer: string,
): Promise<void> {
  const migrator = connectDatabase(
    {
      DATABASE_URL: migratorUrl,
      PAP_DATABASE_ENV: databaseEnv,
    },
    dataSchema,
    { roleScope: 'migrator', maxConnections: 1 },
  );
  const sql = migrator.client;
  try {
    const validFrom = '2026-01-01T00:00:00.000Z';
    for (const persona of DEMO_PERSONAS_SEED) {
      await sql`
        INSERT INTO tenant (id, name, created_at)
        VALUES (${persona.tenantId}, ${persona.tenantName}, ${validFrom})
        ON CONFLICT (id) DO NOTHING
      `;
    }

    for (const comp of DEMO_COMPANIES_SEED) {
      await sql`
        INSERT INTO legal_entity (id, tenant_id, display_name, created_at)
        VALUES (${comp.legalEntityId}, ${comp.tenantId}, ${comp.displayName}, ${validFrom})
        ON CONFLICT (id) DO NOTHING
      `;
      const profileVersionId = deterministicUuidV4(
        `entity-profile-v1:${comp.tenantId}:${comp.legalEntityId}`,
      );
      const existingProfile = await sql`
        SELECT id FROM entity_profile_version
        WHERE tenant_id = ${comp.tenantId} AND legal_entity_id = ${comp.legalEntityId}
        LIMIT 1
      `;
      if (existingProfile.length === 0) {
        await sql`
          INSERT INTO entity_profile_version (id, tenant_id, legal_entity_id, profile_code, valid_from)
          VALUES (${profileVersionId}, ${comp.tenantId}, ${comp.legalEntityId}, ${comp.taxProfile.profileCode}, ${validFrom})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    }

    const issuers = Array.from(new Set([sandboxIssuer, 'http://127.0.0.1:4000']));
    for (const persona of DEMO_PERSONAS_SEED) {
      await sql`
        INSERT INTO app_user (id, status, created_at)
        VALUES (${persona.userId}, 'active', ${validFrom})
        ON CONFLICT (id) DO NOTHING
      `;
      for (const iss of issuers) {
        const subjects = Array.from(
          new Set([persona.userId, persona.personaId, `sub:${persona.personaId}`]),
        );
        for (const sub of subjects) {
          const identityId = deterministicUuidV4(`oidc-link:${iss}:${sub}`);
          await sql`
            INSERT INTO user_oidc_identity (id, user_id, issuer, subject, status, linked_at)
            VALUES (${identityId}, ${persona.userId}, ${iss}, ${sub}, 'active', ${validFrom})
            ON CONFLICT DO NOTHING
          `;
        }
      }
      await sql`
        INSERT INTO tenant_membership (tenant_id, user_id, role, status, valid_from)
        VALUES (${persona.tenantId}, ${persona.userId}, ${persona.role}, 'active', ${validFrom})
        ON CONFLICT (tenant_id, user_id) DO NOTHING
      `;
    }

    for (const grant of DEMO_INITIAL_GRANTS_SEED) {
      const existingGrant = await sql`
        SELECT grant_id FROM company_access_grant
        WHERE tenant_id = ${grant.tenantId}
          AND user_id = ${grant.userId}
          AND legal_entity_id = ${grant.legalEntityId}
          AND action = ${grant.action}
        LIMIT 1
      `;
      if (existingGrant.length === 0) {
        await sql`
          INSERT INTO company_access_grant (grant_id, tenant_id, user_id, legal_entity_id, action, valid_from)
          VALUES (${grant.grantId}, ${grant.tenantId}, ${grant.userId}, ${grant.legalEntityId}, ${grant.action}, ${validFrom})
          ON CONFLICT (grant_id) DO NOTHING
        `;
      }
    }
  } finally {
    await sql.end({ timeout: 3 }).catch(() => undefined);
  }
}

function createInternalSeedVerifier(issuer: string): OidcAccessTokenVerifier {
  return {
    async verifyAccessToken(rawToken: string) {
      const subject = rawToken.replace(/^seed-token:/, '');
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

export async function seedSyntheticDemoToPostgres(
  options: SeedSyntheticDemoOptions,
): Promise<SeedSyntheticDemoResult> {
  const { runtime, migratorDatabaseUrl, sandboxIssuer } = options;

  if (migratorDatabaseUrl && migratorDatabaseUrl.trim().length > 0) {
    await provisionCoreDirectoryEntitiesWithMigrator(
      migratorDatabaseUrl.trim(),
      runtime.databaseEnv,
      runtime.dataSchema,
      sandboxIssuer,
    );
  } else {
    const janResolved = await runtime.securityServices.identityResolver.resolveVerifiedIdentity({
      issuer: sandboxIssuer,
      subject: DEMO_USER_JAN_ID,
    });
    if (!janResolved) {
      throw new DatabaseConfigError(
        'PAP_SEED_SYNTHETIC_DEMO=true wymaga PAP_MIGRATOR_DATABASE_URL przy pierwszym zasileniu pustej bazy (rola runtime pap_*_app nie ma prawa INSERT do tabel katalogowych tenant/app_user/legal_entity).',
      );
    }
  }

  const referenceWorkspace = new AccountingWorkspaceService({ seedDemoData: true });
  const seedVerifier = createInternalSeedVerifier(sandboxIssuer);
  let seededCompanies = 0;
  let skippedExistingCompanies = 0;

  for (const seedDef of DEMO_COMPANIES_SEED) {
    const ownerUserId = seedDef.tenantId === TENANT_1_ID ? DEMO_USER_JAN_ID : DEMO_USER_PIOTR_ID;
    const ownerEmail =
      seedDef.tenantId === TENANT_1_ID
        ? 'jan.testowy@example.test'
        : 'piotr.izolacyjny@example.test';
    const tId = parseTenantId(seedDef.tenantId);
    const leId = parseLegalEntityId(seedDef.legalEntityId);

    const existingSettings = await runtime.connection.db.transaction(async (tx) => {
      const operationId = randomUUID();
      await runtime.signer.apply(tx, {
        purpose: 'company',
        actorUserId: ownerUserId,
        tenantId: tId,
        legalEntityId: leId,
        action: 'read',
        operationId,
      });
      const scope = createPostgresAccountingScope({
        tx,
        context: {
          actorUserId: parseUserId(ownerUserId),
          tenantId: tId,
          legalEntityId: leId,
          action: 'read',
          operationId,
          decisionAt: new Date().toISOString(),
        },
        assertActive: () => {},
      });
      return scope.getCompanyTaxSettings();
    });
    if (existingSettings !== null) {
      skippedExistingCompanies += 1;
      continue;
    }

    const refCompany = referenceWorkspace.store.getCompany(tId, leId);
    if (!refCompany) {
      continue;
    }

    const writeRes = await executeAuthorizedCompanyAction(
      {
        requestId: randomUUID(),
        operationId: deterministicUuidV4(
          `demo-seed-v1:${seedDef.tenantId}:${seedDef.legalEntityId}`,
        ),
        rawBearerToken: `seed-token:${ownerUserId}`,
        tenantId: tId,
        legalEntityId: leId,
        action: 'write',
      },
      {
        ...runtime.securityServices,
        verifier: seedVerifier,
      },
      async (_ctx, scope) => {
        await persistCompanyTaxSettingsToScope(scope, refCompany);
        await ensureLedgerAccountsInScope(scope, refCompany);

        const knownDocIds = new Set<string>();
        const kpirDocByEntryId = new Map<string, string>();
        const ryczaltDocByEntryId = new Map<string, string>();
        const vatDocByEntryId = new Map<string, string>();
        const journalDocByEntryId = new Map<string, string>();

        for (const docItem of refCompany.documents) {
          await persistDocumentItemToScope(scope, refCompany, docItem);
          knownDocIds.add(docItem.documentId);
          if (docItem.postingResult?.kpirEntryId) {
            kpirDocByEntryId.set(docItem.postingResult.kpirEntryId, docItem.documentId);
          }
          if (docItem.postingResult?.ryczaltEntryId) {
            ryczaltDocByEntryId.set(docItem.postingResult.ryczaltEntryId, docItem.documentId);
          }
          if (docItem.postingResult?.journalEntryId) {
            journalDocByEntryId.set(docItem.postingResult.journalEntryId, docItem.documentId);
          }
          for (const vatId of docItem.postingResult?.vatEntryIds ?? []) {
            vatDocByEntryId.set(vatId, docItem.documentId);
          }
        }

        for (const kpir of refCompany.kpirEntries) {
          await persistKpirEntryToScope(
            scope,
            refCompany,
            kpir,
            kpirDocByEntryId.get(kpir.id) ?? null,
          );
        }
        for (const rycz of refCompany.ryczaltEntries) {
          await persistRyczaltEntryToScope(
            scope,
            refCompany,
            rycz,
            ryczaltDocByEntryId.get(rycz.id) ?? null,
          );
        }
        for (const vat of refCompany.vatEntries) {
          await persistVatEntryToScope(scope, refCompany, vat, vatDocByEntryId.get(vat.id) ?? null);
        }
        for (const journal of refCompany.journalEntries) {
          await persistJournalEntryToScope(
            scope,
            refCompany,
            journal,
            journalDocByEntryId.get(journal.id) ?? null,
          );
        }
        for (const settlement of refCompany.settlements) {
          await persistSettlementToScope(scope, settlement, knownDocIds);
        }

        await scope.upsertNotificationPreference({
          id: deterministicUuidV4(
            `notif-pref:${seedDef.tenantId}:${seedDef.legalEntityId}:${ownerUserId}`,
          ),
          userId: ownerUserId,
          recipientEmail: ownerEmail,
          frequency: 'standard',
          optOut: false,
        });

        if (seedDef.legalEntityId === DEMO_COMPANIES_SEED[0]!.legalEntityId) {
          const pendingProposal = referenceWorkspace.store.getMcpProposal(
            DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
          );
          if (pendingProposal) {
            await persistMcpProposalWithIndexToScope(scope, pendingProposal);
          }
        }
      },
    );

    if (!writeRes.allowed) {
      throw new DatabaseConfigError(
        `Błąd transakcyjnego zasilenia firmy demo ${seedDef.displayName}: ${writeRes.reason}.`,
      );
    }
    seededCompanies += 1;
  }

  return Object.freeze({ seededCompanies, skippedExistingCompanies });
}
