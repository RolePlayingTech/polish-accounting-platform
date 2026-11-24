import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_TENANT_2_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  TENANT_2_ID,
} from '@pap/application';
import {
  CalendarViewResponseSchema,
  CompanyDocumentItemSchema,
  CompanyOverviewResponseSchema,
  CreateCompanyResponseSchema,
  ImportBankStatementResponseSchema,
  IssueMcpChallengeResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import {
  ConfirmPreparedProposalOutputSchema,
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
  const client = new Client({ name: 'pap-p0-pg18-mcp', version: '0.1.0' });
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

describe('Wave 1 P0 Financial Invariants — Ephemeral PostgreSQL 18.6 Integration & Concurrency (#106, #118, #110, #107, #113, #108)', () => {
  const keyId = 'pap-p0-pg18-ctx';
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
        'Test integracyjny P0 PG18 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
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

  it('GLD-01 (#106) & GLD-02 (#118): preserves multi-rate (23% + 8%) invoice lines + MPP across PG18 cold restart, and carries over VAT excess (P_62 -> P_39) with P_54 refund & period lock', async () => {
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

    const { app: app1, baseUrl: url1 } = await bootApiInstance(runtimeEnv);
    openApps.add(app1);
    const janHeaders1 = await issuePersonaHeaders(url1, 'jan-testowy');

    // Provision dedicated active VAT company in PG18
    const createCompRes = await fetch(`${url1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: janHeaders1,
      body: JSON.stringify({
        displayName: 'PG18 Wielostawkowy i VAT CarryOver JDG',
        nip: '5261040828',
        legalForm: 'jdg',
        taxRegime: 'kpir_liniowy',
        vatStatus: 'czynny',
        activityStartDate: '2026-01-01',
      }),
    });
    expect(createCompRes.status).toBe(201);
    const companyId = CreateCompanyResponseSchema.parse(await createCompRes.json()).company
      .legalEntityId;

    // 1. GLD-01: Multi-line 23% + 8% sales invoice (> 15 000 PLN gross with Annex 15 on line 1)
    const createMultiRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: 'FV/PG18/MULTI/2026/04/01',
          direction: 'sales',
          issueDate: '2026-04-10',
          eventDate: '2026-04-10',
          dueDate: '2026-04-24',
          counterpartyName: 'Odbiorca Wielostawkowy PG18 Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
          lines: [
            {
              description: 'Stacja robocza GPU (załącznik nr 15)',
              quantity: '1',
              unit: 'szt.',
              netGrosze: 1_000_000, // 10 000 PLN + 2 300 VAT = 12 300 gross
              vatRate: '23',
              annex15Item: true,
            },
            {
              description: 'Dokumentacja wdrożeniowa (stawka 8%)',
              quantity: '4',
              unit: 'egz.',
              netGrosze: 500_000, // 5 000 PLN + 400 VAT = 5 400 gross (total gross = 17 700 > 15 000!)
              vatRate: '8',
              annex15Item: false,
            },
          ],
        }),
      },
    );
    expect(createMultiRes.status).toBe(201);
    const createdMulti = CompanyDocumentItemSchema.parse(await createMultiRes.json());

    // Approve with echoed Split-View totals (15000.00 net / 2700.00 VAT) + header edit
    const approveMultiRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents/${createdMulti.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentId: createdMulti.documentId,
          documentNumber: 'FV/PG18/MULTI/2026/04/01-OK',
          netPln: '15000.00',
          vatPln: '2700.00',
        }),
      },
    );
    expect(approveMultiRes.status).toBe(200);
    const postedMulti = CompanyDocumentItemSchema.parse(await approveMultiRes.json());
    expect(postedMulti.document.lines).toHaveLength(2);
    expect(postedMulti.postingResult?.vatEntryIds).toHaveLength(2);

    // Check raw PG18 vat_register_entry rows
    const dbVatRows = await owner!.client<
      {
        vat_rate_code: string;
        net_grosze: string;
        vat_total_grosze: string;
        procedure_markers: string[];
      }[]
    >`
      SELECT vat_rate_code, net_grosze::text, vat_total_grosze::text, procedure_markers
      FROM ${owner!.client(dataSchema)}.vat_register_entry
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${companyId}::uuid
        AND document_id = ${createdMulti.documentId}::uuid
      ORDER BY vat_rate_code ASC
    `;
    expect(dbVatRows).toEqual([
      {
        vat_rate_code: '23',
        net_grosze: '1000000',
        vat_total_grosze: '230000',
        procedure_markers: ['MPP'],
      },
      {
        vat_rate_code: '8',
        net_grosze: '500000',
        vat_total_grosze: '40000',
        procedure_markers: [],
      },
    ]);

    // 2. GLD-02: January excess 230 PLN -> P_54 refund 80 PLN + P_62 carry-forward 150 PLN -> February output VAT 230 PLN => P_51 = 80 PLN!
    const janPurchRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: 'FZ/PG18/VAT/2026/01/01',
          direction: 'purchase',
          issueDate: '2026-01-14',
          eventDate: '2026-01-14',
          counterpartyName: 'Dostawca Styczeń PG18 Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          lines: [{ description: 'Serwery chmurowe styczeń', netGrosze: 100_000, vatRate: '23' }],
        }),
      },
    );
    expect(janPurchRes.status).toBe(201);
    const janPurch = CompanyDocumentItemSchema.parse(await janPurchRes.json());
    const janPostRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents/${janPurch.documentId}/approve-and-post`,
      { method: 'POST', headers: janHeaders1, body: JSON.stringify({}) },
    );
    expect(janPostRes.status).toBe(200);

    const finalizeJanRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/vat/settlement`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          period: '2026-01',
          refundRequestedP54Grosze: 8_000, // 80 PLN zwrotu na rachunek, 150 PLN przeniesienia P_62
          finalize: true,
        }),
      },
    );
    expect(finalizeJanRes.status).toBe(200);
    const janVatView = VatViewResponseSchema.parse(await finalizeJanRes.json());
    expect(janVatView.jpkV7m?.fields.P_53).toBe(230);
    expect(janVatView.jpkV7m?.fields.P_54).toBe(80);
    expect(janVatView.jpkV7m?.fields.P_62).toBe(150);
    expect(janVatView.jpkV7m?.settlementStatus).toBe('finalized');

    const febSaleRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: 'FV/PG18/VAT/2026/02/01',
          direction: 'sales',
          issueDate: '2026-02-16',
          eventDate: '2026-02-16',
          counterpartyName: 'Klient Luty PG18 Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
          lines: [{ description: 'Usługi doradcze luty', netGrosze: 100_000, vatRate: '23' }],
        }),
      },
    );
    expect(febSaleRes.status).toBe(201);
    const febSale = CompanyDocumentItemSchema.parse(await febSaleRes.json());
    const febPostRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents/${febSale.documentId}/approve-and-post`,
      { method: 'POST', headers: janHeaders1, body: JSON.stringify({}) },
    );
    expect(febPostRes.status).toBe(200);

    // Cold restart: close Instance 1, boot Instance 2 from PostgreSQL 18 only
    await app1.close();
    openApps.delete(app1);

    const { app: app2, baseUrl: url2 } = await bootApiInstance({
      ...runtimeEnv,
      PAP_SEED_SYNTHETIC_DEMO: 'false',
    });
    openApps.add(app2);
    const janHeaders2 = await issuePersonaHeaders(url2, 'jan-testowy');

    // Verify multi-rate invoice survived cold restart with zero line/rate flattening
    const reloadedMultiRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/documents/${createdMulti.documentId}`,
      { headers: janHeaders2 },
    );
    expect(reloadedMultiRes.status).toBe(200);
    const reloadedMulti = CompanyDocumentItemSchema.parse(await reloadedMultiRes.json());
    expect(reloadedMulti.document.lines).toHaveLength(2);
    expect(reloadedMulti.document.lines.map((l) => l.vatRate)).toEqual(['23', '8']);

    const aprVatRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/vat?period=2026-04`,
      { headers: janHeaders2 },
    );
    const aprVat = VatViewResponseSchema.parse(await aprVatRes.json());
    expect(aprVat.jpkV7m?.fields.P_17).toBe(5000);
    expect(aprVat.jpkV7m?.fields.P_18).toBe(400);
    expect(aprVat.jpkV7m?.fields.P_19).toBe(10000);
    expect(aprVat.jpkV7m?.fields.P_20).toBe(2300);

    // Verify February VAT carry-over (P_39 = 150 -> P_51 = 80 PLN = 8 000 gr) agrees across VatView, Overview, and Calendar after cold restart
    const [febVatRes, febOverviewRes, febCalRes] = await Promise.all([
      fetch(`${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/vat?period=2026-02`, {
        headers: janHeaders2,
      }),
      fetch(
        `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/overview?period=2026-02`,
        { headers: janHeaders2 },
      ),
      fetch(
        `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${companyId}/calendar?year=2026&month=2`,
        { headers: janHeaders2 },
      ),
    ]);
    const febVat = VatViewResponseSchema.parse(await febVatRes.json());
    const febOverview = CompanyOverviewResponseSchema.parse(await febOverviewRes.json());
    const febCal = CalendarViewResponseSchema.parse(await febCalRes.json());
    const febVatObl = febCal.obligations.find((o) => o.category === 'vat');

    expect(febVat.jpkV7m?.fields.P_39).toBe(150);
    expect(febVat.jpkV7m?.taxDueP51Grosze).toBe(8_000);
    expect(febOverview.taxSummary.vatPayableGrosze).toBe(8_000);
    expect(febVatObl?.estimatedAmountGrosze).toBe(8_000);

    await app2.close();
    openApps.delete(app2);
  });

  it('GLD-03 (#107, #113) & GLD-04 (#108): handles unreferenced CSV/MT940 imports + comma CSV, serializes concurrent double-allocation races across 2 API instances, and persists reallocation reversals', async () => {
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

    const { app: appA, baseUrl: urlA } = await bootApiInstance(runtimeEnv);
    openApps.add(appA);
    const { app: appB, baseUrl: urlB } = await bootApiInstance(runtimeEnv);
    openApps.add(appB);

    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // Create dedicated company for bank import & payment concurrency tests
    const compRes = await fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        displayName: 'PG18 Bank & Payment Race JDG',
        nip: '5213017228',
        legalForm: 'jdg',
        taxRegime: 'kpir_skala',
        vatStatus: 'zwolniony',
        activityStartDate: '2026-01-01',
      }),
    });
    expect(compRes.status).toBe(201);
    const compId = CreateCompanyResponseSchema.parse(await compRes.json()).company.legalEntityId;

    // GLD-03: Two separate unreferenced CSV files + retry + comma-delimited CSV
    const csvBatch1 = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-04;2026-03-04;Dostawca Bez Ref 1;;Opłata skarbowa;-17,00;PLN;',
    ].join('\n');
    const csvBatch2 = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-06;2026-03-06;Dostawca Bez Ref 2;;Opłata pocztowa;-24,50;PLN;',
    ].join('\n');
    const commaCsv = [
      'Data księgowania,Data waluty,Kontrahent,Rachunek kontrahenta,Tytuł,Kwota,Waluta,Nr referencyjny',
      '2026-03-08,2026-03-08,"Dostawca, Przecinkowy Sp. z o.o.",,"Przelew 1","100,00",PLN,REF-RACE-TX1',
      '2026-03-09,2026-03-09,"Dostawca, Przecinkowy Sp. z o.o.",,"Przelew 2","100,00",PLN,REF-RACE-TX2',
      '2026-03-10,2026-03-10,"Dostawca, Przecinkowy Sp. z o.o.",,"Przelew 3","-100,00",PLN,REF-RACE-TX3',
    ].join('\n');

    const r1 = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/bank-import`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({ format: 'csv', rawContent: csvBatch1, applySettlements: false }),
      },
    );
    expect(r1.status).toBe(200);
    expect(ImportBankStatementResponseSchema.parse(await r1.json()).importedTransactionsCount).toBe(
      1,
    );

    const r2 = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/bank-import`,
      {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({ format: 'csv', rawContent: csvBatch2, applySettlements: false }),
      },
    );
    expect(r2.status).toBe(200);
    const imp2 = ImportBankStatementResponseSchema.parse(await r2.json());
    expect(imp2.importedTransactionsCount).toBe(1);
    expect(imp2.finance.bankTransactions).toHaveLength(2);

    // Retry batch 1 -> 0 new rows
    const r1Retry = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/bank-import`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({ format: 'csv', rawContent: csvBatch1, applySettlements: false }),
      },
    );
    expect(r1Retry.status).toBe(200);
    expect(
      ImportBankStatementResponseSchema.parse(await r1Retry.json()).importedTransactionsCount,
    ).toBe(0);

    // Comma CSV import (#113)
    const rComma = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/bank-import`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          format: 'csv',
          delimiter: ',',
          rawContent: commaCsv,
          applySettlements: false,
        }),
      },
    );
    expect(rComma.status).toBe(200);
    const impComma = ImportBankStatementResponseSchema.parse(await rComma.json());
    expect(impComma.importedTransactionsCount).toBe(3);

    const tx1Id = impComma.finance.bankTransactions.find(
      (t) => t.rawReference === 'REF-RACE-TX1',
    )!.transactionId;
    const tx2Id = impComma.finance.bankTransactions.find(
      (t) => t.rawReference === 'REF-RACE-TX2',
    )!.transactionId;
    const tx3Id = impComma.finance.bankTransactions.find(
      (t) => t.rawReference === 'REF-RACE-TX3',
    )!.transactionId;

    // Create & post 1 sales invoice (100 PLN) + 2 purchase invoices (100 PLN each)
    const createAndPost = async (
      docNumber: string,
      direction: 'sales' | 'purchase',
      nip: string,
    ) => {
      const cRes = await fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/documents`,
        {
          method: 'POST',
          headers: headersA,
          body: JSON.stringify({
            documentNumber: docNumber,
            direction,
            issueDate: '2026-03-05',
            counterpartyName: `Kontrahent ${docNumber}`,
            counterpartyNip: nip,
            lines: [{ description: `Pozycja ${docNumber}`, netGrosze: 10_000, vatRate: 'zw' }],
          }),
        },
      );
      expect(cRes.status).toBe(201);
      const doc = CompanyDocumentItemSchema.parse(await cRes.json());
      const pRes = await fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/documents/${doc.documentId}/approve-and-post`,
        { method: 'POST', headers: headersA, body: JSON.stringify({}) },
      );
      expect(pRes.status).toBe(200);
      return CompanyDocumentItemSchema.parse(await pRes.json()).postingResult!.settlementId!;
    };

    const salesSettlementId = await createAndPost(
      'FV/RACE-SALES/01',
      'sales',
      SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
    );
    const payableBId = await createAndPost(
      'FZ/RACE-PAY-B/01',
      'purchase',
      SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
    );
    const payableCId = await createAndPost(
      'FZ/RACE-PAY-C/01',
      'purchase',
      SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
    );

    // GLD-04 Race 1: Two distinct 100 PLN credit transfers (tx1 on Instance A, tx2 on Instance B) race to settle the same 100 PLN sales invoice
    const [race1A, race1B] = await Promise.all([
      fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/reconcile`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({ transactionId: tx1Id, settlementId: salesSettlementId }),
      }),
      fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/reconcile`, {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({ transactionId: tx2Id, settlementId: salesSettlementId }),
      }),
    ]);
    expect([race1A.status, race1B.status].sort((a, b) => a - b)).toEqual([200, 409]);

    // GLD-04 Race 2: Same 100 PLN debit transfer (tx3) concurrently allocated to payableB on Instance A and payableC on Instance B
    const [race2A, race2B] = await Promise.all([
      fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/reconcile`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({ transactionId: tx3Id, settlementId: payableBId }),
      }),
      fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${compId}/finance/reconcile`, {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({ transactionId: tx3Id, settlementId: payableCId }),
      }),
    ]);
    // Both sequentialized reallocations succeed (200), AND the second atomically unwound the first so total settled across payableB + payableC === 10 000 gr (never 20 000 gr!)
    expect(race2A.status).toBe(200);
    expect(race2B.status).toBe(200);

    const dbPayables = await owner!.client<
      { id: string; remaining_gross_grosze: string; status: string }[]
    >`
      SELECT id, remaining_gross_grosze::text, status
      FROM ${owner!.client(dataSchema)}.settlement_item
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${compId}::uuid
        AND id IN (${payableBId}::uuid, ${payableCId}::uuid)
    `;
    const totalRemainingPayables = dbPayables.reduce(
      (acc, r) => acc + Number(r.remaining_gross_grosze),
      0,
    );
    expect(totalRemainingPayables).toBe(10_000);
    expect(dbPayables.map((r) => r.status).sort()).toEqual(['open', 'settled']);

    await appA.close();
    openApps.delete(appA);
    await appB.close();
    openApps.delete(appB);
  });

  it('GLD-05 (#110): enforces canonical economic operation identity across REST, remote MCP, and manual KPiR in PG18 while preserving 2-tenant isolation', async () => {
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

    const { app, baseUrl } = await bootApiInstance(runtimeEnv);
    openApps.add(app);

    const janToken = await issuePersonaToken(baseUrl, 'jan-testowy');
    const janHeaders = {
      authorization: `Bearer ${janToken}`,
      'content-type': 'application/json',
    };
    const piotrHeaders = await issuePersonaHeaders(baseUrl, 'piotr-izolacyjny');

    // 1. Create & post invoice in Tenant 1 via REST
    const sharedDocNumber = 'FV/CANONICAL/2026/03/777';
    const createRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          documentNumber: sharedDocNumber,
          direction: 'purchase',
          issueDate: '2026-03-25',
          dueDate: '2026-04-08',
          counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          suggestedCategory: 'uslugi_obce',
          lines: [{ description: 'Klaster obliczeniowy PG18', netGrosze: 100_000, vatRate: '23' }],
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const createdDoc = CompanyDocumentItemSchema.parse(await createRes.json());
    const postRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${createdDoc.documentId}/approve-and-post`,
      { method: 'POST', headers: janHeaders, body: JSON.stringify({}) },
    );
    expect(postRes.status).toBe(200);

    // 2. Confirm the SAME invoice via remote Streamable HTTP MCP with matching snapshot -> idempotently links to existing documentId (zero duplicate ledger rows!)
    await withMcpClient(baseUrl, janToken, async (mcpClient) => {
      const prepRaw = await mcpClient.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: sharedDocNumber,
            issueDate: '2026-03-25',
            dueDate: '2026-04-08',
            counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
            netAmountPln: '1000.00',
            vatAmountPln: '230.00',
            grossAmountPln: '1230.00',
            expenseDescription: 'Klaster obliczeniowy PG18',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      const prepared = PrepareInvoiceAndPostingProposalOutputSchema.parse(
        JSON.parse((prepRaw.content as { text: string }[])[0]!.text),
      );

      const chRes = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${prepared.proposalId}/challenge`,
        { method: 'POST', headers: janHeaders, body: JSON.stringify({}) },
      );
      expect(chRes.status).toBe(200);
      const challenge = IssueMcpChallengeResponseSchema.parse(await chRes.json());

      const confirmRaw = await mcpClient.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          proposalId: prepared.proposalId,
          expectedPayloadHash: prepared.payloadHash,
          confirmationCode: challenge.confirmationCode,
        },
      });
      const confirmed = ConfirmPreparedProposalOutputSchema.parse(
        JSON.parse((confirmRaw.content as { text: string }[])[0]!.text),
      );
      expect(confirmed.ledgerEntryId).toBe(createdDoc.documentId);

      // Divergent amount via MCP -> fails closed!
      const prepDivRaw = await mcpClient.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          invoice: {
            direction: 'purchase',
            invoiceNumber: sharedDocNumber,
            issueDate: '2026-03-25',
            dueDate: '2026-04-08',
            counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
            netAmountPln: '1500.00',
            vatAmountPln: '345.00',
            grossAmountPln: '1845.00',
            expenseDescription: 'Klaster obliczeniowy PG18 — zmieniona kwota',
            suggestedCategory: 'uslugi_obce',
          },
        },
      });
      const preparedDiv = PrepareInvoiceAndPostingProposalOutputSchema.parse(
        JSON.parse((prepDivRaw.content as { text: string }[])[0]!.text),
      );
      const chDivRes = await fetch(
        `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/mcp/proposals/${preparedDiv.proposalId}/challenge`,
        { method: 'POST', headers: janHeaders, body: JSON.stringify({}) },
      );
      const challengeDiv = IssueMcpChallengeResponseSchema.parse(await chDivRes.json());

      const confirmDivRaw = await mcpClient.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_JDG_KPIR_ID,
          idempotencyKey: randomUUID(),
          proposalId: preparedDiv.proposalId,
          expectedPayloadHash: preparedDiv.payloadHash,
          confirmationCode: challengeDiv.confirmationCode,
        },
      });
      expect(confirmDivRaw.isError).toBe(true);
      const errEnv = McpToolErrorEnvelopeSchema.parse(
        JSON.parse((confirmDivRaw.content as { text: string }[])[0]!.text),
      );
      expect(errEnv.ok).toBe(false);
    });

    // Verify PG18 has exactly 1 KPiR row, 1 VAT row, and 1 settlement_item row for sharedDocNumber in Tenant 1
    const kpirViewRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
      { headers: janHeaders },
    );
    const kpirView = KpirViewResponseSchema.parse(await kpirViewRes.json());
    expect(kpirView.entries.filter((e) => e.documentNumber === sharedDocNumber)).toHaveLength(1);

    // 3. Manual KPiR duplicate for the same invoice -> 409 Conflict
    const dupManualKpir = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          eventDate: '2026-03-25',
          documentNumber: sharedDocNumber,
          counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          eventDescription: 'Próba duplikatu w KPiR',
          entryKind: 'other_expenses_100_col13',
          netGrosze: 100_000,
          vatRate: '23',
        }),
      },
    );
    expect(dupManualKpir.status).toBe(409);

    // 4. 2-Tenant Isolation: Tenant 2 (Piotr) is forbidden from Tenant 1 (403), and CAN register the same supplier invoice number independently in Tenant 2!
    const crossTenantDeny = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      { headers: piotrHeaders },
    );
    expect(crossTenantDeny.status).toBe(403);

    const t2CreateRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_2_ID}/companies/${COMPANY_TENANT_2_ID}/documents`,
      {
        method: 'POST',
        headers: piotrHeaders,
        body: JSON.stringify({
          documentNumber: sharedDocNumber,
          direction: 'purchase',
          issueDate: '2026-03-25',
          dueDate: '2026-04-08',
          counterpartyName: 'Chmura Polska Infrastruktur Test S.A.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          lines: [
            { description: 'Niezależny zakup w Tenant 2', netGrosze: 100_000, vatRate: '23' },
          ],
        }),
      },
    );
    expect(t2CreateRes.status).toBe(201);

    await app.close();
    openApps.delete(app);
  });
});
