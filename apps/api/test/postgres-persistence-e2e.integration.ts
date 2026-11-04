import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
  DEMO_USER_MARTA_ID,
  DEMO_USER_PIOTR_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '@pap/application';
import {
  CompanyDocumentItemSchema,
  ConfirmMcpProposalResponseSchema,
  DocumentsListResponseSchema,
  FinanceViewResponseSchema,
  ImportBankStatementResponseSchema,
  IssueMcpChallengeResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  McpProposalsListResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import {
  DatabaseConfigError,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { createApiRuntimeServicesAsync } from '../src/runtime/workspace-runtime.js';

const KSEF_FA3_PURCHASE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne>
      <NIP>${SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura}</NIP>
      <Nazwa>Chmura Obliczeniowa Polska Test Sp. z o.o.</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne>
      <NIP>5260001009</NIP>
      <Nazwa>Pracownia Projektowa Jan Testowy</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <NrKSeF>5250004007-20260324-C3E2E1-AA11BB-99</NrKSeF>
  <Fa>
    <P_1>2026-03-24</P_1>
    <P_2>FV-KSEF/2026/03/901</P_2>
    <P_6>2026-03-24</P_6>
    <Platnosc>
      <TerminPlatnosci><Termin>2026-04-07</Termin></TerminPlatnosci>
    </Platnosc>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Klaster bazodanowy PostgreSQL 18.6 dla systemu księgowego</P_7>
      <P_8A>usł.</P_8A>
      <P_8B>1</P_8B>
      <P_11>2000.00</P_11>
      <P_11Vat>460.00</P_11Vat>
      <P_12>23</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`;

interface DrizzleJournalFile {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
  }[];
}

async function applySqlMigrationsToSchema(
  ownerClient: ReturnType<typeof connectDatabase>['client'],
): Promise<void> {
  const drizzleDir = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url));
  const journalRaw = readFileSync(`${drizzleDir}/meta/_journal.json`, 'utf8');
  const journal = JSON.parse(journalRaw) as DrizzleJournalFile;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);

  for (const entry of ordered) {
    const sqlText = readFileSync(`${drizzleDir}/${entry.tag}.sql`, 'utf8');
    if (/(?:"public"|\bpublic)\s*\.|\b(?:CREATE|DROP)\s+SCHEMA\b/i.test(sqlText)) {
      throw new Error(`Migracja ${entry.tag} narusza izolację schematu testowego.`);
    }
    const statements = sqlText
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    await ownerClient.begin(async (tx) => {
      for (const stmt of statements) {
        await tx.unsafe(stmt);
      }
    });
  }
}

async function bootApiInstance(
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly app: NestFastifyApplication; readonly baseUrl: string }> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(env),
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  await app.listen(0, '127.0.0.1');
  const addr = app.getHttpServer().address();
  if (!addr || typeof addr === 'string') {
    await app.close();
    throw new Error('Nie udało się zbindować efemerycznego portu TCP dla @pap/api.');
  }
  return {
    app,
    baseUrl: `http://127.0.0.1:${addr.port}`,
  };
}

async function issuePersonaHeaders(
  baseUrl: string,
  personaId: 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny',
): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/api/v1/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId, period: '2026-03' }),
  });
  expect(res.status).toBe(200);
  const { accessToken } = IssueSandboxTokenResponseSchema.parse(await res.json());
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

describe('Persystencja PostgreSQL 18.6 w @pap/api pod FORCE RLS i security_decision_event (C3-1)', () => {
  const keyId = 'pap-api-c31-ctx';
  const keyHex = randomBytes(32).toString('hex');
  let dataSchema = '';
  let migratorUrl = '';
  let runtimeUrl = '';
  let owner: ReturnType<typeof connectDatabase> | undefined;
  let schemaCreated = false;
  const openApps = new Set<NestFastifyApplication>();

  beforeAll(async () => {
    if (process.env.PAP_DATABASE_ENV !== 'test' || !process.env.DATABASE_URL) {
      throw new DatabaseConfigError(
        'Test integracyjny C3-1 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }
    migratorUrl = process.env.DATABASE_URL.trim();
    runtimeUrl = (process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL ?? '').trim();
    if (!runtimeUrl) {
      throw new DatabaseConfigError(
        'Brak PAP_EPHEMERAL_RUNTIME_DATABASE_URL — uruchom przez scripts/hetzner/with-ephemeral-pg18.sh --mode strict-migrator --bootstrap-runtime-role.',
      );
    }

    dataSchema = `pap_api_e2e_${randomUUID().replaceAll('-', '')}`;
    owner = connectDatabase(process.env, dataSchema, { roleScope: 'migrator' });
    await owner.client`CREATE SCHEMA ${owner.client(dataSchema)}`;
    schemaCreated = true;

    await applySqlMigrationsToSchema(owner.client);
    await provisionDatabaseContextKey(owner.db, {
      keyId,
      keyHex,
      runtimeRole: 'pap_test_app',
    });
    await configureRuntimePrivileges(owner.db, 'pap_test_app');

    const roleRows = await owner.client<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls
      FROM pg_catalog.pg_roles
      WHERE rolname = 'pap_test_app'
    `;
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

    const rlsTables = await owner.client<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ${dataSchema}
        AND c.relkind = 'r'
      ORDER BY c.relname
    `;
    expect(rlsTables.length).toBe(27);
    expect(rlsTables.every((t) => t.relrowsecurity && t.relforcerowsecurity)).toBe(true);
  });

  afterAll(async () => {
    for (const app of openApps) {
      await app.close();
    }
    openApps.clear();

    if (owner) {
      try {
        if (schemaCreated) {
          await owner.client`DROP SCHEMA ${owner.client(dataSchema)} CASCADE`;
        }
      } finally {
        await owner.client.end({ timeout: 2 });
      }
    }
  });

  it('odrzuca fail-closed start z DATABASE_URL bez klucza HMAC kontekstu lub na roli właściciela tabel', async () => {
    await expect(
      createApiRuntimeServicesAsync({
        DATABASE_URL: runtimeUrl,
        PAP_DATABASE_ENV: 'test',
        PAP_DB_SCHEMA: dataSchema,
        PAP_SANDBOX_AUTH_ENABLED: 'true',
      }),
    ).rejects.toThrow(DatabaseConfigError);

    await expect(
      createApiRuntimeServicesAsync({
        DATABASE_URL: migratorUrl,
        PAP_DATABASE_ENV: 'test',
        PAP_DB_SCHEMA: dataSchema,
        PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
        PAP_SANDBOX_AUTH_ENABLED: 'true',
      }),
    ).rejects.toThrow(DatabaseConfigError);
  });

  it('utrwala w PostgreSQL 18.6 fakturę KSeF z korektą kwoty, wyciąg bankowy CSV, zatwierdzenie MCP i odmowy RLS (403) pomiędzy restartami @pap/api z idempotentnym seederem', async () => {
    const runtimeEnv: Record<string, string> = {
      DATABASE_URL: runtimeUrl,
      PAP_MIGRATOR_DATABASE_URL: migratorUrl,
      PAP_DATABASE_ENV: 'test',
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: 'true',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
    };

    // === INSTANCJA #1 @pap/api ===
    const { app: app1, baseUrl: baseUrl1 } = await bootApiInstance(runtimeEnv);
    openApps.add(app1);

    const janHeaders1 = await issuePersonaHeaders(baseUrl1, 'jan-testowy');
    const martaHeaders1 = await issuePersonaHeaders(baseUrl1, 'marta-ksiegowa');
    const piotrHeaders1 = await issuePersonaHeaders(baseUrl1, 'piotr-izolacyjny');

    // 1. Import faktury KSeF FA(3) XML (kwota w XML: 2000.00 netto / 460.00 VAT)
    const importRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          sourceFormat: 'ksef_xml',
          rawPayload: KSEF_FA3_PURCHASE_XML,
          direction: 'purchase',
          suggestedCategory: 'uslugi_obce',
        }),
      },
    );
    expect(importRes.status).toBe(201);
    const importedDoc = CompanyDocumentItemSchema.parse(await importRes.json());
    expect(importedDoc.status).toBe('needs_verification');
    expect(importedDoc.document.totalNetGrosze).toBe(200_000);

    // 2. Kontrola P3: 24-cyfrowa kwota PLN zwraca 400 Bad Request zamiast 500
    const overflowApproveRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${importedDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          netPln: '123456789012345678901234.00',
          vatPln: '23.00',
        }),
      },
    );
    expect(overflowApproveRes.status).toBe(400);

    // 3. Ludzkie zatwierdzenie i księgowanie z korektą kwoty (2800.00 netto / 644.00 VAT = 3444.00 brutto)
    const approveRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${importedDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          netPln: '2800.00',
          vatPln: '644.00',
          vatRate: '23',
          suggestedCategory: 'uslugi_obce',
          vatDeductionMode: 'full_100',
          kpirQualification: 'other_expenses_100_col13',
        }),
      },
    );
    expect(approveRes.status).toBe(200);
    const postedDoc = CompanyDocumentItemSchema.parse(await approveRes.json());
    expect(postedDoc.status).toBe('posted');
    expect(postedDoc.document.totalNetGrosze).toBe(280_000);
    expect(postedDoc.document.totalVatGrosze).toBe(64_400);
    expect(postedDoc.document.totalGrossGrosze).toBe(344_400);
    expect(postedDoc.postingResult?.settlementId).toBeTruthy();

    // 4. Import wyciągu bankowego CSV i rozliczenie rozrachunku 3444,00 PLN
    const bankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-27;2026-03-27;Chmura Obliczeniowa Polska Test Sp. z o.o.;PL27114020040000300201355387;Zapłata FV-KSEF/2026/03/901;-3444,00;PLN;TX-PG18-E2E-901',
    ].join('\n');

    const bankImportRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/finance/bank-import`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({ format: 'csv', rawContent: bankCsv }),
      },
    );
    expect(bankImportRes.status).toBe(200);
    const importedBank = ImportBankStatementResponseSchema.parse(await bankImportRes.json());
    expect(importedBank.importedTransactionsCount).toBe(1);
    const importedTx = importedBank.finance.bankTransactions.find(
      (tx) =>
        tx.rawReference?.includes('TX-PG18-E2E-901') || tx.title.includes('FV-KSEF/2026/03/901'),
    );
    expect(importedTx).toBeDefined();

    const settlementId = postedDoc.postingResult!.settlementId!;
    const reconcileRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/finance/reconcile`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          transactionId: importedTx!.transactionId,
          settlementId,
          amountGrosze: 344_400,
        }),
      },
    );
    expect(reconcileRes.status).toBe(200);
    const reconciledFinance1 = FinanceViewResponseSchema.parse(await reconcileRes.json());
    expect(
      reconciledFinance1.settlements.find((s) => s.settlementId === settlementId)?.status,
    ).toBe('paid');

    // 5. Zatwierdzenie oczekującej propozycji MCP przez człowieka (challenge + confirm)
    const challengeRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/challenge`,
      { method: 'POST', headers: janHeaders1 },
    );
    expect(challengeRes.status).toBe(200);
    const challenge = IssueMcpChallengeResponseSchema.parse(await challengeRes.json());

    const confirmMcpRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID}/confirm`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          confirmationCode: challenge.confirmationCode,
          expectedPayloadHash: challenge.payloadHash,
        }),
      },
    );
    expect(confirmMcpRes.status).toBe(200);
    const confirmedMcp = ConfirmMcpProposalResponseSchema.parse(await confirmMcpRes.json());
    expect(confirmedMcp.confirmation.status).toBe('confirmed');
    expect(confirmedMcp.postedDocument.status).toBe('posted');

    // 6. Testy negatywne autoryzacji i weryfikacja wpisów odmowy w tabeli security_decision_event
    const piotrForbiddenRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      { headers: piotrHeaders1 },
    );
    expect(piotrForbiddenRes.status).toBe(403);

    const martaReadAllowedRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/documents`,
      { headers: martaHeaders1 },
    );
    expect(martaReadAllowedRes.status).toBe(200);

    const martaWriteForbiddenRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/documents`,
      {
        method: 'POST',
        headers: martaHeaders1,
        body: JSON.stringify({
          documentNumber: 'FV-DENY/2026/03/01',
          direction: 'sales',
          issueDate: '2026-03-25',
          dueDate: '2026-04-08',
          counterpartyName: 'Kontrahent Testowy Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
          lines: [
            { description: 'Próba nieuprawnionego zapisu', netGrosze: 10_000, vatRate: 'zw' },
          ],
        }),
      },
    );
    expect(martaWriteForbiddenRes.status).toBe(403);

    const denialAuditRows = await owner!.client<
      {
        actor_id: string | null;
        tenant_id: string | null;
        legal_entity_id: string | null;
        action: string | null;
        decision: string;
        outcome: string;
        reason: string;
      }[]
    >`
      SELECT actor_id, tenant_id, legal_entity_id, action, decision, outcome, reason
      FROM security_decision_event
      WHERE decision = 'deny' AND outcome = 'denied'
    `;

    expect(
      denialAuditRows.some(
        (row) =>
          row.actor_id === DEMO_USER_PIOTR_ID &&
          row.tenant_id === TENANT_1_ID &&
          row.reason === 'active_membership_required',
      ),
    ).toBe(true);

    expect(
      denialAuditRows.some(
        (row) =>
          row.actor_id === DEMO_USER_MARTA_ID &&
          row.tenant_id === TENANT_1_ID &&
          row.legal_entity_id === COMPANY_JDG_RYCZALT_ID &&
          row.action === 'write' &&
          row.reason === 'explicit_company_grant_required',
      ),
    ).toBe(true);

    // Pobranie stanu referencyjnego Instancji #1 tuż przed zamknięciem
    const docs1 = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: janHeaders1 },
        )
      ).json(),
    );
    const kpir1 = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
          { headers: janHeaders1 },
        )
      ).json(),
    );
    const vat1 = VatViewResponseSchema.parse(
      await (
        await fetch(
          `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat?period=2026-03`,
          { headers: janHeaders1 },
        )
      ).json(),
    );
    const proposals1 = McpProposalsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals`,
          { headers: janHeaders1 },
        )
      ).json(),
    );

    // Zamknięcie Instancji #1 @pap/api (wraz z pulą połączeń PostgreSQL)
    await app1.close();
    openApps.delete(app1);

    // === INSTANCJA #2 @pap/api (pełny zimny start na tej samej bazie + PAP_SEED_SYNTHETIC_DEMO=true) ===
    const { app: app2, baseUrl: baseUrl2 } = await bootApiInstance(runtimeEnv);
    openApps.add(app2);

    const janHeaders2 = await issuePersonaHeaders(baseUrl2, 'jan-testowy');

    const docs2Res = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      { headers: janHeaders2 },
    );
    expect(docs2Res.status).toBe(200);
    const docs2 = DocumentsListResponseSchema.parse(await docs2Res.json());

    const kpir2Res = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
      { headers: janHeaders2 },
    );
    expect(kpir2Res.status).toBe(200);
    const kpir2 = KpirViewResponseSchema.parse(await kpir2Res.json());

    const vat2Res = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat?period=2026-03`,
      { headers: janHeaders2 },
    );
    expect(vat2Res.status).toBe(200);
    const vat2 = VatViewResponseSchema.parse(await vat2Res.json());

    const finance2Res = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/finance`,
      { headers: janHeaders2 },
    );
    expect(finance2Res.status).toBe(200);
    const finance2 = FinanceViewResponseSchema.parse(await finance2Res.json());

    const proposals2Res = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals`,
      { headers: janHeaders2 },
    );
    expect(proposals2Res.status).toBe(200);
    const proposals2 = McpProposalsListResponseSchema.parse(await proposals2Res.json());

    // Idempotentność seedera: dokładnie te same liczności, zero zduplikowanych rekordów startowych
    expect(docs2.documents).toHaveLength(docs1.documents.length);
    expect(kpir2.entries).toHaveLength(kpir1.entries.length);
    expect(vat2.purchaseEntries).toHaveLength(vat1.purchaseEntries.length);
    expect(vat2.salesEntries).toHaveLength(vat1.salesEntries.length);
    expect(proposals2.proposals).toHaveLength(proposals1.proposals.length);

    // Weryfikacja odtworzenia faktury KSeF z ludzką korektą kwoty po restarcie
    const restoredKsefDoc = docs2.documents.find((d) => d.documentId === importedDoc.documentId);
    expect(restoredKsefDoc).toBeDefined();
    expect(restoredKsefDoc?.status).toBe('posted');
    expect(restoredKsefDoc?.document.totalNetGrosze).toBe(280_000);
    expect(restoredKsefDoc?.document.totalVatGrosze).toBe(64_400);
    expect(restoredKsefDoc?.document.totalGrossGrosze).toBe(344_400);

    // Weryfikacja odtworzenia faktury z zatwierdzonej propozycji MCP
    const restoredMcpDoc = docs2.documents.find(
      (d) => d.documentId === confirmedMcp.postedDocument.documentId,
    );
    expect(restoredMcpDoc).toBeDefined();
    expect(restoredMcpDoc?.status).toBe('posted');

    // Weryfikacja KPiR i rejestru VAT po restarcie
    const restoredKpirEntry = kpir2.entries.find((e) => e.documentNumber === 'FV-KSEF/2026/03/901');
    expect(restoredKpirEntry?.col13OtherExpensesGrosze).toBe(280_000);

    const restoredVatEntry = vat2.purchaseEntries.find(
      (e) => e.documentNumber === 'FV-KSEF/2026/03/901',
    );
    expect(restoredVatEntry?.netGrosze).toBe(280_000);
    expect(restoredVatEntry?.deductibleVatGrosze).toBe(64_400);

    // Weryfikacja wyciągu bankowego CSV i rozliczenia płatności po restarcie
    const restoredBankTx = finance2.bankTransactions.find((tx) =>
      tx.title.includes('FV-KSEF/2026/03/901'),
    );
    expect(restoredBankTx).toBeDefined();
    expect(restoredBankTx?.amountGrosze).toBe(344_400);
    expect(restoredBankTx?.direction).toBe('debit');

    const restoredSettlement = finance2.settlements.find((s) => s.settlementId === settlementId);
    expect(restoredSettlement?.status).toBe('paid');
    expect(restoredSettlement?.remainingGrosze).toBe(0);
    expect(finance2.reconciliationMatches.length).toBeGreaterThanOrEqual(1);

    // Weryfikacja statusu propozycji MCP po restarcie
    const restoredProposal = proposals2.proposals.find(
      (p) => p.proposalId === DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
    );
    expect(restoredProposal?.status).toBe('confirmed');
    expect(restoredProposal?.ledgerPosted).toBe(true);

    await app2.close();
    openApps.delete(app2);
  });
});
