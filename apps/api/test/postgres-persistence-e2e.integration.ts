import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  DEMO_FIRMA_1_PENDING_MCP_PROPOSAL_ID,
  DEMO_INITIAL_GRANTS_SEED,
  DEMO_USER_JAN_ID,
  DEMO_USER_MARTA_ID,
  DEMO_USER_PIOTR_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '@pap/application';
import {
  CompanyDocumentItemSchema,
  ConfirmMcpProposalResponseSchema,
  CreateCompanyResponseSchema,
  DocumentsListResponseSchema,
  FinanceViewResponseSchema,
  GetMyCompaniesResponseSchema,
  ImportBankStatementResponseSchema,
  IssueMcpChallengeResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  McpProposalsListResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import {
  ListMyCompaniesOutputSchema,
  McpToolErrorEnvelopeSchema,
  PrepareInvoiceAndPostingProposalOutputSchema,
} from '@pap/contracts/mcp-tools';
import {
  DatabaseConfigError,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import {
  connectPostgresRuntime,
  resolveDatabaseContextKeyMaterial,
} from '../src/runtime/postgres-runtime-config.js';
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

async function issuePersonaToken(
  baseUrl: string,
  personaId: 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny',
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ personaId, period: '2026-03' }),
  });
  expect(res.status).toBe(200);
  return IssueSandboxTokenResponseSchema.parse(await res.json()).accessToken;
}

async function issuePersonaHeaders(
  baseUrl: string,
  personaId: 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny',
): Promise<Record<string, string>> {
  const accessToken = await issuePersonaToken(baseUrl, personaId);
  return {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  };
}

async function withMcpClient<T>(
  baseUrl: string,
  bearerToken: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: 'pap-api-pg18-e2e-mcp', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL('/api/v1/mcp', baseUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await transport.close();
  }
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

    dataSchema = `pap_test_${randomUUID().replaceAll('-', '')}`;
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

  it('odrzuca fail-closed start z DATABASE_URL bez klucza HMAC, z wyłączonym PAP_ENFORCE_RUNTIME_DB_SECURITY poza test, ze słabym sekretem poza test lub na roli właściciela tabel', async () => {
    await expect(
      createApiRuntimeServicesAsync({
        DATABASE_URL: runtimeUrl,
        PAP_DATABASE_ENV: 'test',
        PAP_DB_SCHEMA: dataSchema,
        PAP_SANDBOX_AUTH_ENABLED: 'true',
      }),
    ).rejects.toThrow(/Niepoprawna konfiguracja podpisu kontekstu DB/);

    await expect(
      connectPostgresRuntime({
        DATABASE_URL: runtimeUrl,
        PAP_DATABASE_ENV: 'staging',
        PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
        PAP_ENFORCE_RUNTIME_DB_SECURITY: 'false',
      }),
    ).rejects.toThrow(/PAP_ENFORCE_RUNTIME_DB_SECURITY=false/);

    expect(() =>
      resolveDatabaseContextKeyMaterial({
        PAP_DATABASE_ENV: 'staging',
        PAP_DB_CONTEXT_SECRET: 'zwykle-haslo-nie-szesnastkowe-123456',
      }),
    ).toThrow(/256-bitowym kluczem szesnastkowym/);

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

    // P1-1: Bezpośrednia weryfikacja SQL kolumn relacyjnych tabeli accounting_document po ludzkiej korekcie
    const docSqlRows = await owner!.client<
      {
        status: string;
        net_grosze: string | number;
        vat_grosze: string | number;
        gross_grosze: string | number;
        document_number: string;
        counterparty_nip: string | null;
      }[]
    >`
      SELECT status, net_grosze, vat_grosze, gross_grosze, document_number, counterparty_nip
      FROM accounting_document
      WHERE id = ${importedDoc.documentId}
    `;
    expect(docSqlRows).toHaveLength(1);
    expect(docSqlRows[0]?.status).toBe('verified_posted');
    expect(Number(docSqlRows[0]?.net_grosze)).toBe(280_000);
    expect(Number(docSqlRows[0]?.vat_grosze)).toBe(64_400);
    expect(Number(docSqlRows[0]?.gross_grosze)).toBe(344_400);
    expect(docSqlRows[0]?.document_number).toBe('FV-KSEF/2026/03/901');
    expect(docSqlRows[0]?.counterparty_nip).toBe(SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura);

    // P2-2: Brak sztucznych rekordów indeksowych __pap_tenant_company_index__ w accounting_document
    const indexDocRows = await owner!.client<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
      FROM accounting_document
      WHERE category_code = '__pap_tenant_company_index__'
    `;
    expect(indexDocRows[0]?.cnt).toBe(0);

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
      { method: 'POST', headers: janHeaders1, body: JSON.stringify({}) },
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

    // P2-3: Pomiar liczby wpisów w security_decision_event przed i po zimnym starcie Instancji #2
    const auditBeforeBoot2Rows = await owner!.client<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt FROM security_decision_event
    `;
    const auditCountBeforeBoot2 = auditBeforeBoot2Rows[0]!.cnt;

    // === INSTANCJA #2 @pap/api (pełny zimny start na tej samej bazie + PAP_SEED_SYNTHETIC_DEMO=true) ===
    const { app: app2, baseUrl: baseUrl2 } = await bootApiInstance(runtimeEnv);
    openApps.add(app2);

    const auditAfterBoot2Rows = await owner!.client<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt FROM security_decision_event
    `;
    expect(auditAfterBoot2Rows[0]!.cnt).toBe(auditCountBeforeBoot2);

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

  it('synchronizuje na żywo granty read i write (DELETE bez body, MCP list_my_companies) oraz wycofuje stan RAM przy błędzie DB w HTTP i MCP (zero split-brain, P1-2, P1-3, P2-1)', async () => {
    const runtimeEnv: Record<string, string> = {
      DATABASE_URL: runtimeUrl,
      PAP_MIGRATOR_DATABASE_URL: migratorUrl,
      PAP_DATABASE_ENV: 'test',
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
    };

    // Dwie równoległe instancje @pap/api na tej samej bazie PostgreSQL 18.6 (osobne pamięci RAM)
    const { app: appA, baseUrl: baseUrlA } = await bootApiInstance(runtimeEnv);
    openApps.add(appA);
    const { app: appB, baseUrl: baseUrlB } = await bootApiInstance(runtimeEnv);
    openApps.add(appB);

    const janTokenA = await issuePersonaToken(baseUrlA, 'jan-testowy');
    const janHeadersA = {
      authorization: `Bearer ${janTokenA}`,
      'content-type': 'application/json',
    };
    const martaTokenA = await issuePersonaToken(baseUrlA, 'marta-ksiegowa');
    const martaHeadersA = {
      authorization: `Bearer ${martaTokenA}`,
      'content-type': 'application/json',
    };

    const janTokenB = await issuePersonaToken(baseUrlB, 'jan-testowy');
    const janHeadersB = {
      authorization: `Bearer ${janTokenB}`,
      'content-type': 'application/json',
    };

    // === 1. P1-2: Nadanie grantu 'write' na Instancji B -> natychmiastowy zapis Marty na Instancji A -> DELETE bez body -> 403 ===
    const writeGrantId = randomUUID();
    const grantWriteRes = await fetch(
      `${baseUrlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/grants`,
      {
        method: 'POST',
        headers: janHeadersB,
        body: JSON.stringify({
          targetUserId: DEMO_USER_MARTA_ID,
          action: 'write',
          grantId: writeGrantId,
        }),
      },
    );
    expect(grantWriteRes.status).toBe(201);

    const martaRyczaltAllowedRes = await fetch(
      `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/ryczalt`,
      {
        method: 'POST',
        headers: martaHeadersA,
        body: JSON.stringify({
          revenueDate: '2026-03-28',
          documentNumber: 'FV-RYCZ-GRANT-LIVE/2026/03/01',
          counterpartyName: 'Klient Ryczałtowy Live Grant Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
          rate: '12',
          revenueGrosze: 120_000,
          remarks: 'Zapis po nadaniu grantu write bez restartu API',
        }),
      },
    );
    expect(martaRyczaltAllowedRes.status).toBe(201);

    // Cofnięcie grantu 'write' wywołaniem DELETE /grants/:grantId BEZ ciała JSON i bez targetUserId
    const revokeWriteRes = await fetch(
      `${baseUrlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/grants/${writeGrantId}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${janTokenB}` },
      },
    );
    expect(revokeWriteRes.status).toBe(200);

    const martaRyczaltRevokedRes = await fetch(
      `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/ryczalt`,
      {
        method: 'POST',
        headers: martaHeadersA,
        body: JSON.stringify({
          revenueDate: '2026-03-29',
          documentNumber: 'FV-RYCZ-AFTER-REVOKE/2026/03/02',
          counterpartyName: 'Klient Ryczałtowy Live Grant Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientRyczaltIt,
          rate: '12',
          revenueGrosze: 50_000,
        }),
      },
    );
    expect(martaRyczaltRevokedRes.status).toBe(403);

    // === 2. P2-1: Cofnięcie grantu 'read' na Instancji B -> natychmiastowe zniknięcie firmy z MCP list_my_companies na Instancji A ===
    await withMcpClient(baseUrlA, martaTokenA, async (mcpMarta) => {
      const beforeRevokeRead = ListMyCompaniesOutputSchema.parse(
        (await mcpMarta.callTool({ name: 'list_my_companies', arguments: {} })).structuredContent,
      );
      expect(
        beforeRevokeRead.companies.some((c) => c.legalEntityId === COMPANY_JDG_RYCZALT_ID),
      ).toBe(true);
    });

    const seededRyczaltReadGrant = DEMO_INITIAL_GRANTS_SEED.find(
      (g) =>
        g.userId === DEMO_USER_MARTA_ID &&
        g.legalEntityId === COMPANY_JDG_RYCZALT_ID &&
        g.action === 'read',
    );
    expect(seededRyczaltReadGrant).toBeDefined();

    const revokeReadRes = await fetch(
      `${baseUrlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/grants/${seededRyczaltReadGrant!.grantId}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${janTokenB}` },
      },
    );
    expect(revokeReadRes.status).toBe(200);

    await withMcpClient(baseUrlA, martaTokenA, async (mcpMarta) => {
      const afterRevokeRead = ListMyCompaniesOutputSchema.parse(
        (await mcpMarta.callTool({ name: 'list_my_companies', arguments: {} })).structuredContent,
      );
      expect(
        afterRevokeRead.companies.some((c) => c.legalEntityId === COMPANY_JDG_RYCZALT_ID),
      ).toBe(false);
    });

    // === 3. P1-3 (HTTP): Kolizja UNIQUE (period, lp) w PostgreSQL wycofuje wpis w pamięci RAM Instancji A (zero split-brain) ===
    const peerKpirRes = await fetch(
      `${baseUrlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: janHeadersB,
        body: JSON.stringify({
          eventDate: '2026-04-10',
          documentNumber: 'DW-PEER/2026/04/01',
          counterpartyName: 'Kontrahent Równoległy Sp. z o.o.',
          counterpartyAddress: 'ul. Testowa 1, Warszawa',
          eventDescription: 'Wpis utworzony na Instancji B w okresie 2026-04 w bazie PostgreSQL',
          entryKind: 'other_expenses_100_col13',
          netGrosze: 40_000,
          vatRate: '23',
        }),
      },
    );
    expect(peerKpirRes.status).toBe(201);

    // Wstawiamy surowy wiersz w kpir_entry (bez _papKpirEntry w JSON) zajmujący kolejny lp w okresie 2026-04,
    // aby wymusić rzeczywistą kolizję UNIQUE (tenant_id, legal_entity_id, period, lp) podczas INSERT na Instancji A
    await owner!.client`
      INSERT INTO ${owner!.client(dataSchema)}.kpir_entry (
        id,
        tenant_id,
        legal_entity_id,
        lp,
        period,
        event_date,
        document_number,
        counterparty_name,
        counterparty_address,
        description,
        regulation_version,
        col_7_sales_revenue_grosze,
        col_8_other_revenue_grosze,
        col_9_total_revenue_grosze,
        col_10_goods_materials_grosze,
        col_11_incidental_costs_grosze,
        col_12_remuneration_grosze,
        col_13_other_expenses_grosze,
        col_14_total_expenses_grosze,
        rd_cost_grosze,
        is_storno,
        rule_code,
        legal_explanation_json,
        created_by
      )
      SELECT
        ${randomUUID()},
        ${TENANT_1_ID},
        ${COMPANY_JDG_KPIR_ID},
        count(*)::int + 1,
        '2026-04',
        '2026-04-11',
        'DW-RAW-COLLISION/2026/04/99',
        'Surowa Kolizja SQL',
        'Warszawa',
        'Surowy wpis SQL wymuszający kolizję UNIQUE (period, lp)',
        'pkpir_2026_ksef',
        0, 0, 0, 0, 0, 0, 1000, 1000, 0,
        false,
        'KPIR_2026',
        '{}'::jsonb,
        ${DEMO_USER_JAN_ID}
      FROM ${owner!.client(dataSchema)}.kpir_entry
      WHERE tenant_id = ${TENANT_1_ID}
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}
    `;

    const conflictingHttpKpirRes = await fetch(
      `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: janHeadersA,
        body: JSON.stringify({
          eventDate: '2026-04-12',
          documentNumber: 'DW-SPLIT-HTTP/2026/04/02',
          counterpartyName: 'Kontrahent Split-Brain HTTP',
          counterpartyAddress: 'ul. Złota 10, Warszawa',
          eventDescription: 'Wpis, który musi zostać wycofany z pamięci RAM po błędzie DB',
          entryKind: 'other_expenses_100_col13',
          netGrosze: 55_000,
          vatRate: '23',
        }),
      },
    );
    expect(conflictingHttpKpirRes.status).toBe(500);

    const kpirAprilOnA = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-04`,
          { headers: janHeadersA },
        )
      ).json(),
    );
    expect(kpirAprilOnA.entries.some((e) => e.documentNumber === 'DW-SPLIT-HTTP/2026/04/02')).toBe(
      false,
    );
    expect(kpirAprilOnA.entries.some((e) => e.documentNumber === 'DW-PEER/2026/04/01')).toBe(true);
    expect(kpirAprilOnA.entries).toHaveLength(1);

    await owner!.client`
      DELETE FROM ${owner!.client(dataSchema)}.kpir_entry
      WHERE tenant_id = ${TENANT_1_ID}
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}
        AND document_number = 'DW-RAW-COLLISION/2026/04/99'
    `;

    // === 4. P1-3 (MCP): confirm_prepared_proposal na propozycji odrzuconej równolegle w DB wycofuje stan RAM Instancji A ===
    const docsBeforeMcp = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: janHeadersA },
        )
      ).json(),
    );
    const kpirMarchBeforeMcp = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
          { headers: janHeadersA },
        )
      ).json(),
    );

    const splitInvoiceNumber = 'FV-SPLIT-MCP/2026/03/777';
    await withMcpClient(baseUrlA, janTokenA, async (mcpJan) => {
      const prepCall = await mcpJan.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: splitInvoiceNumber,
            counterpartyName: 'Dostawca Split-Brain MCP Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
            issueDate: '2026-03-29',
            dueDate: '2026-04-12',
            netAmountPln: '900.00',
            vatAmountPln: '207.00',
            grossAmountPln: '1107.00',
            expenseDescription: 'Test atomowego wycofania RAM przy odrzuconej propozycji w PG18',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      expect(prepCall.isError).toBeFalsy();
      const prepared = PrepareInvoiceAndPostingProposalOutputSchema.parse(
        prepCall.structuredContent,
      );

      // Wystawienie jednorazowego wyzwania człowieka na Instancji A
      const challRes = await fetch(
        `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${prepared.proposalId}/challenge`,
        {
          method: 'POST',
          headers: janHeadersA,
          body: JSON.stringify({}),
        },
      );
      expect(challRes.status).toBe(200);
      const chall = IssueMcpChallengeResponseSchema.parse(await challRes.json());

      // Świeża Instancja C widzi propozycję z bazy i odrzuca ją w PostgreSQL (status = 'rejected')
      const { app: appC, baseUrl: baseUrlC } = await bootApiInstance(runtimeEnv);
      openApps.add(appC);
      const janHeadersC = await issuePersonaHeaders(baseUrlC, 'jan-testowy');
      const rejectOnCRes = await fetch(
        `${baseUrlC}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${prepared.proposalId}/reject`,
        {
          method: 'POST',
          headers: janHeadersC,
          body: JSON.stringify({ reason: 'Równoległe odrzucenie propozycji w bazie PostgreSQL' }),
        },
      );
      expect(rejectOnCRes.status).toBe(200);
      await appC.close();
      openApps.delete(appC);

      // Instancja A wciąż ma w RAM status pending_human_approval, ale zapis do PG18 wykrywa status 'rejected' i wycofuje RAM!
      const confirmOnACall = await mcpJan.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          proposalId: prepared.proposalId,
          expectedPayloadHash: chall.payloadHash,
          confirmationCode: chall.confirmationCode,
        },
      });
      expect(confirmOnACall.isError).toBe(true);
      const errEnvelope = McpToolErrorEnvelopeSchema.parse(confirmOnACall.structuredContent);
      expect(errEnvelope.errorCode).toBe('proposal_already_processed');
    });

    const docsAfterMcp = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: janHeadersA },
        )
      ).json(),
    );
    const kpirMarchAfterMcp = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
          { headers: janHeadersA },
        )
      ).json(),
    );

    expect(docsAfterMcp.documents).toHaveLength(docsBeforeMcp.documents.length);
    expect(
      docsAfterMcp.documents.some((d) => d.document.documentNumber === splitInvoiceNumber),
    ).toBe(false);
    expect(kpirMarchAfterMcp.entries).toHaveLength(kpirMarchBeforeMcp.entries.length);
    expect(kpirMarchAfterMcp.entries.some((e) => e.documentNumber === splitInvoiceNumber)).toBe(
      false,
    );

    await appB.close();
    openApps.delete(appB);
    await appA.close();
    openApps.delete(appA);
  });

  it('odkrywa nowo utworzone firmy (POST /companies BEZ PAP_MIGRATOR_DATABASE_URL na roli runtime) na żywej równoległej instancji oraz po zimnym restarcie z utrwaleniem adresu i challenge MCP (#58, #60, #70, #71)', async () => {
    const runtimeEnv: NodeJS.ProcessEnv = {
      DATABASE_URL: runtimeUrl,
      PAP_DATABASE_ENV: 'test',
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
    };

    const { app: app1, baseUrl: baseUrl1 } = await bootApiInstance(runtimeEnv);
    openApps.add(app1);
    const { app: appPeer, baseUrl: baseUrlPeer } = await bootApiInstance(runtimeEnv);
    openApps.add(appPeer);

    const janToken1 = await issuePersonaToken(baseUrl1, 'jan-testowy');
    const janHeaders1 = {
      authorization: `Bearer ${janToken1}`,
      'content-type': 'application/json',
    };
    const martaHeaders1 = await issuePersonaHeaders(baseUrl1, 'marta-ksiegowa');
    const piotrHeaders1 = await issuePersonaHeaders(baseUrl1, 'piotr-izolacyjny');

    // #58: Odmowa utworzenia firmy przez użytkownika bez roli admina (Marta - 403) i z innego tenanta (Piotr - 403)
    const martaCreateRes = await fetch(`${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: martaHeaders1,
      body: JSON.stringify({
        displayName: 'Próba Marty Sp. z o.o.',
        nip: '5270009002',
        legalForm: 'jdg',
        taxRegime: 'kpir_liniowy',
        vatStatus: 'czynny',
      }),
    });
    expect(martaCreateRes.status).toBe(403);

    const piotrCreateRes = await fetch(`${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: piotrHeaders1,
      body: JSON.stringify({
        displayName: 'Próba Piotra Sp. z o.o.',
        nip: '5270009002',
        legalForm: 'jdg',
        taxRegime: 'kpir_liniowy',
        vatStatus: 'czynny',
      }),
    });
    expect(piotrCreateRes.status).toBe(403);

    // 1. Utworzenie nowej firmy przez POST /api/v1/tenants/:tenantId/companies na Instancji #1 BEZ PAP_MIGRATOR_DATABASE_URL
    const createCompanyRes = await fetch(`${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: janHeaders1,
      body: JSON.stringify({
        displayName: 'Nowa Pracownia Architektoniczna Test',
        nip: '5270009002',
        legalForm: 'jdg',
        taxRegime: 'kpir_liniowy',
        vatStatus: 'czynny',
        zusStage: 'duzy_zus',
        street: 'ul. Marszałkowska',
        buildingNumber: '10',
        unitNumber: '4',
        postalCode: '00-590',
        city: 'Warszawa',
        voivodeship: 'mazowieckie',
        taxOfficeName: 'Pierwszy Urząd Skarbowy Warszawa-Śródmieście',
        smallTaxpayer: true,
        ksefEnabled: true,
      }),
    });
    expect(createCompanyRes.status).toBe(201);
    const createdCompany = CreateCompanyResponseSchema.parse(await createCompanyRes.json());
    const newLegalEntityId = createdCompany.company.legalEntityId;
    expect(createdCompany.company.street).toBe('ul. Marszałkowska');
    expect(createdCompany.company.postalCode).toBe('00-590');
    expect(createdCompany.company.taxOfficeName).toBe(
      'Pierwszy Urząd Skarbowy Warszawa-Śródmieście',
    );

    // #58: Duplikat NIP w tym samym tenancie zwraca 409 Conflict (duplicate_company_nip)
    const dupCompanyRes = await fetch(`${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: janHeaders1,
      body: JSON.stringify({
        displayName: 'Duplikat NIP Architektura',
        nip: '5270009002',
        legalForm: 'jdg',
        taxRegime: 'kpir_skala',
        vatStatus: 'czynny',
      }),
    });
    expect(dupCompanyRes.status).toBe(409);

    // #60 + #71: Przygotowanie propozycji MCP przez endpoint REST i wystawienie challenge PRZED zimnym restartem
    const coldMcpPrepRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/mcp/proposals`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          invoiceNumber: 'FV/COLD-CHALLENGE/2026/03/01',
          counterpartyName: 'Dostawca Cold Restart Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          issueDate: '2026-03-30',
          dueDate: '2026-04-14',
          netAmountPln: '500.00',
          vatAmountPln: '115.00',
          grossAmountPln: '615.00',
          expenseDescription: 'Test utrwalenia challenge MCP przez zimny restart PG18',
          suggestedCategory: 'uslugi_obce',
        }),
      },
    );
    expect(coldMcpPrepRes.status).toBe(201);
    const coldPreparedProposal = PrepareInvoiceAndPostingProposalOutputSchema.parse(
      await coldMcpPrepRes.json(),
    );

    const coldChallengeBeforeRestartRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/mcp/proposals/${coldPreparedProposal.proposalId}/challenge`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({}),
      },
    );
    expect(coldChallengeBeforeRestartRes.status).toBe(200);
    const coldChallenge = IssueMcpChallengeResponseSchema.parse(
      await coldChallengeBeforeRestartRes.json(),
    );

    // 2. Dodanie dokumentu w nowo utworzonej firmie na Instancji #1
    const newDocNumber = 'FV-NEW-COMPANY/2026/03/01';
    const createDocRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: newDocNumber,
          direction: 'purchase',
          issueDate: '2026-03-30',
          dueDate: '2026-04-14',
          counterpartyName: 'Dostawca Projektowy Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
          suggestedCategory: 'uslugi_obce',
          lines: [
            {
              description: 'Licencja oprogramowania CAD na marzec 2026',
              netGrosze: 150_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(createDocRes.status).toBe(201);
    const createdDoc = CompanyDocumentItemSchema.parse(await createDocRes.json());

    // 3. P3: Kwoty PLN > 15 znaków lub przekraczające MAX_SAFE_INTEGER groszy zwracają 400 (nigdy 500)
    const tooLongPlnRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents/${createdDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          netPln: '123456789012345.00',
          vatPln: '23.00',
        }),
      },
    );
    expect(tooLongPlnRes.status).toBe(400);

    const unsafeSafeIntPlnRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents/${createdDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          netPln: '999999999999999',
          vatPln: '0.00',
        }),
      },
    );
    expect(unsafeSafeIntPlnRes.status).toBe(400);

    // 4. NEW-P1-1 (równoległa żywa Instancja B bez restartu): widoczność nowej firmy i dokumentu we wszystkich 4 punktach wejścia
    const janTokenPeer = await issuePersonaToken(baseUrlPeer, 'jan-testowy');
    const janHeadersPeer = {
      authorization: `Bearer ${janTokenPeer}`,
      'content-type': 'application/json',
    };

    const myCompaniesOnPeer = GetMyCompaniesResponseSchema.parse(
      await (await fetch(`${baseUrlPeer}/api/v1/me/companies`, { headers: janHeadersPeer })).json(),
    );
    expect(myCompaniesOnPeer.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
      true,
    );

    const tenantCompaniesOnPeer = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${baseUrlPeer}/api/v1/tenants/${TENANT_1_ID}/companies`, {
          headers: janHeadersPeer,
        })
      ).json(),
    );
    expect(tenantCompaniesOnPeer.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
      true,
    );

    await withMcpClient(baseUrlPeer, janTokenPeer, async (mcpJanPeer) => {
      const mcpCompaniesPeer = ListMyCompaniesOutputSchema.parse(
        (await mcpJanPeer.callTool({ name: 'list_my_companies', arguments: {} })).structuredContent,
      );
      expect(mcpCompaniesPeer.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
        true,
      );
    });

    const docsOnPeer = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlPeer}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents`,
          { headers: janHeadersPeer },
        )
      ).json(),
    );
    expect(docsOnPeer.documents.some((d) => d.document.documentNumber === newDocNumber)).toBe(true);

    // 5. NEW-P1-1 (zimny restart): 0 syntetycznych wpisów w security_decision_event przy starcie oraz pełna widoczność nowej firmy, adresu i challenge MCP
    await appPeer.close();
    openApps.delete(appPeer);
    await app1.close();
    openApps.delete(app1);

    const [auditBeforeCold] = await owner!.client<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
      FROM ${owner!.client(dataSchema)}.security_decision_event
    `;
    const countBeforeColdBoot = auditBeforeCold!.cnt;

    const { app: appCold, baseUrl: baseUrlCold } = await bootApiInstance(runtimeEnv);
    openApps.add(appCold);

    const [auditAfterCold] = await owner!.client<{ cnt: number }[]>`
      SELECT count(*)::int AS cnt
      FROM ${owner!.client(dataSchema)}.security_decision_event
    `;
    expect(auditAfterCold!.cnt).toBe(countBeforeColdBoot);

    const janTokenCold = await issuePersonaToken(baseUrlCold, 'jan-testowy');
    const janHeadersCold = {
      authorization: `Bearer ${janTokenCold}`,
      'content-type': 'application/json',
    };

    const myCompaniesOnCold = GetMyCompaniesResponseSchema.parse(
      await (await fetch(`${baseUrlCold}/api/v1/me/companies`, { headers: janHeadersCold })).json(),
    );
    const hydratedNewCompanyItem = myCompaniesOnCold.companies.find(
      (c) => c.legalEntityId === newLegalEntityId,
    );
    expect(hydratedNewCompanyItem).toBeDefined();
    expect(hydratedNewCompanyItem?.street).toBe('ul. Marszałkowska');
    expect(hydratedNewCompanyItem?.postalCode).toBe('00-590');
    expect(hydratedNewCompanyItem?.city).toBe('Warszawa');
    expect(hydratedNewCompanyItem?.taxOfficeName).toBe(
      'Pierwszy Urząd Skarbowy Warszawa-Śródmieście',
    );

    // #60 + #71: Zatwierdzenie propozycji MCP PO ZIMNYM RESTARCIE przy użyciu challenge wydanego PRZED restartem!
    const confirmAfterColdRes = await fetch(
      `${baseUrlCold}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/mcp/proposals/${coldPreparedProposal.proposalId}/confirm`,
      {
        method: 'POST',
        headers: janHeadersCold,
        body: JSON.stringify({
          confirmationCode: coldChallenge.confirmationCode,
          expectedPayloadHash: coldChallenge.payloadHash,
        }),
      },
    );
    expect(confirmAfterColdRes.status).toBe(200);
    const confirmedAfterCold = ConfirmMcpProposalResponseSchema.parse(
      await confirmAfterColdRes.json(),
    );
    expect(confirmedAfterCold.confirmation.status).toBe('confirmed');

    const tenantCompaniesOnCold = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${baseUrlCold}/api/v1/tenants/${TENANT_1_ID}/companies`, {
          headers: janHeadersCold,
        })
      ).json(),
    );
    expect(tenantCompaniesOnCold.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
      true,
    );

    await withMcpClient(baseUrlCold, janTokenCold, async (mcpJanCold) => {
      const mcpCompaniesCold = ListMyCompaniesOutputSchema.parse(
        (await mcpJanCold.callTool({ name: 'list_my_companies', arguments: {} })).structuredContent,
      );
      expect(mcpCompaniesCold.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
        true,
      );
    });

    const docsOnCold = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${baseUrlCold}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents`,
          { headers: janHeadersCold },
        )
      ).json(),
    );
    expect(docsOnCold.documents.some((d) => d.document.documentNumber === newDocNumber)).toBe(true);
    expect(
      docsOnCold.documents.some(
        (d) =>
          d.document.documentNumber === 'FV/COLD-CHALLENGE/2026/03/01' && d.status === 'posted',
      ),
    ).toBe(true);

    // Izolacja międzytenantowa: Piotr z TENANT_2 nie widzi nowej firmy z TENANT_1 ani jej dokumentów
    const piotrHeadersCold = await issuePersonaHeaders(baseUrlCold, 'piotr-izolacyjny');
    const piotrMyCompaniesCold = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${baseUrlCold}/api/v1/me/companies`, { headers: piotrHeadersCold })
      ).json(),
    );
    expect(piotrMyCompaniesCold.companies.some((c) => c.legalEntityId === newLegalEntityId)).toBe(
      false,
    );

    const piotrDocsForbidden = await fetch(
      `${baseUrlCold}/api/v1/tenants/${TENANT_1_ID}/companies/${newLegalEntityId}/documents`,
      { headers: piotrHeadersCold },
    );
    expect(piotrDocsForbidden.status).toBe(403);

    await appCold.close();
    openApps.delete(appCold);
  });
});
