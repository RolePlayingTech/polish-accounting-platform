import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '@pap/application';
import {
  CompanyDocumentItemSchema,
  CreateCompanyResponseSchema,
  FinanceViewResponseSchema,
  ImportBankStatementResponseSchema,
  IssueSandboxTokenResponseSchema,
  LedgerViewResponseSchema,
  PeriodCloseStatusResponseSchema,
  PeriodTaxObligationsResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import {
  ConfirmBankReconciliationOutputSchema,
  ConfirmPreparedProposalOutputSchema,
  ListUnreconciledBankTransactionsOutputSchema,
  PrepareBankReconciliationOutputSchema,
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
  scopes?: readonly string[],
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/oidc/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personaId,
      period: '2026-03',
      ...(scopes ? { scopes } : {}),
    }),
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
  const client = new Client({ name: 'pap-wave2-pg18-mcp', version: '0.1.0' });
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

describe('Wave 2 Financial & Tax Invariants — Ephemeral PostgreSQL 18.6 Integration (#109, #111, #116, #81, #112/#108 MCP)', () => {
  const keyId = 'pap-w2-pg18-ctx';
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
        'Test integracyjny Wave 2 PG18 wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
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

  function buildRuntimeEnv(seedDemo = false): Record<string, string> {
    return {
      DATABASE_URL: runtimeUrl,
      PAP_MIGRATOR_DATABASE_URL: migratorUrl,
      PAP_DATABASE_ENV: 'test',
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_SECRET: `${keyId}:${keyHex}`,
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SEED_SYNTHETIC_DEMO: seedDemo ? 'true' : 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
    };
  }

  it('#109 (GLD-06) & #111 (GLD-07): enforces server-side tax regime boundaries and persists Sp. z o.o. bank reconciliation <-> 130/201/202 GL entries (with red-storno unwind) across PG18 cold restarts', async () => {
    const { app: app1, baseUrl: url1 } = await bootApiInstance(buildRuntimeEnv(true));
    openApps.add(app1);
    const janHeaders = await issuePersonaHeaders(url1, 'jan-testowy');

    // 1. #109: Educational GET stays 200, incompatible manual writes & profile switch fail with 422 incompatible_tax_regime
    const eduRyczalt = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/ryczalt?period=2026-03`,
      { headers: janHeaders },
    );
    expect(eduRyczalt.status).toBe(200);

    const illegalRyczOnKpir = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/ryczalt`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          revenueDate: '2026-03-14',
          documentNumber: 'ILLEGAL/RYCZ/01',
          counterpartyName: 'Kontrahent Test',
          rate: '12',
          revenueGrosze: 40_000,
        }),
      },
    );
    expect(illegalRyczOnKpir.status).toBe(422);
    expect(((await illegalRyczOnKpir.json()) as { reasonCode: string }).reasonCode).toBe(
      'incompatible_tax_regime',
    );

    const illegalKpirOnSpzoo = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/kpir`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          eventDate: '2026-03-14',
          documentNumber: 'ILLEGAL/KPIR/01',
          counterpartyName: 'Kontrahent Test',
          entryKind: 'sales_revenue',
          netGrosze: 40_000,
          vatRate: '23',
        }),
      },
    );
    expect(illegalKpirOnSpzoo.status).toBe(422);
    expect(((await illegalKpirOnSpzoo.json()) as { reasonCode: string }).reasonCode).toBe(
      'incompatible_tax_regime',
    );

    const illegalProfileMutation = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/settings`,
      {
        method: 'PUT',
        headers: janHeaders,
        body: JSON.stringify({ profileCode: 'jdg_ryczalt' }),
      },
    );
    expect(illegalProfileMutation.status).toBe(422);
    expect(((await illegalProfileMutation.json()) as { reasonCode: string }).reasonCode).toBe(
      'incompatible_tax_regime',
    );

    // 2. #111: Provision dedicated Sp. z o.o. in PG18 and verify 130 <-> 201/202 bank GL across split, retry, cold restart, and 0-reset
    const createSpzooRes = await fetch(`${url1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: janHeaders,
      body: JSON.stringify({
        displayName: 'PG18 Sp. z o.o. Bank GL 130 Test',
        nip: '5261040828',
        legalForm: 'sp_z_o_o',
        taxRegime: 'cit_klasyczny',
        vatStatus: 'czynny',
        activityStartDate: '2026-01-01',
      }),
    });
    expect(createSpzooRes.status).toBe(201);
    const spzooId = CreateCompanyResponseSchema.parse(await createSpzooRes.json()).company
      .legalEntityId;

    const boRes = await fetch(`${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/ledger`, {
      method: 'POST',
      headers: janHeaders,
      body: JSON.stringify({
        entryNumber: 'BO/2026/01',
        bookingDate: '2026-01-02',
        documentDate: '2026-01-02',
        documentNumber: 'BO-SPZOO-130',
        description: 'Kapitał zakładowy na rachunku 130',
        lines: [
          { accountCode: '130', side: 'Wn', amountGrosze: 5_000_000, description: 'Bank 130' },
          { accountCode: '800', side: 'Ma', amountGrosze: 5_000_000, description: 'Kapitał 800' },
        ],
      }),
    });
    expect(boRes.status).toBe(201);

    const postInvoice = async (
      docNum: string,
      direction: 'sales' | 'purchase',
      netGrosze: number,
      nip: string,
    ) => {
      const cRes = await fetch(
        `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/documents`,
        {
          method: 'POST',
          headers: janHeaders,
          body: JSON.stringify({
            documentNumber: docNum,
            direction,
            issueDate: '2026-03-05',
            counterpartyName: direction === 'sales' ? 'Odbiorca GL Sp. z o.o.' : 'Dostawca GL S.A.',
            counterpartyNip: nip,
            lines: [{ description: docNum, netGrosze, vatRate: '23' }],
          }),
        },
      );
      expect(cRes.status).toBe(201);
      const draft = CompanyDocumentItemSchema.parse(await cRes.json());
      const aRes = await fetch(
        `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/documents/${draft.documentId}/approve-and-post`,
        { method: 'POST', headers: janHeaders, body: '{}' },
      );
      expect(aRes.status).toBe(200);
      return CompanyDocumentItemSchema.parse(await aRes.json());
    };

    const invSalesA = await postInvoice(
      'FV/PG18-GL/A',
      'sales',
      100_000,
      SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
    );
    const invSalesB = await postInvoice(
      'FV/PG18-GL/B',
      'sales',
      100_000,
      SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
    );
    const invCostC = await postInvoice(
      'FZ/PG18-GL/C',
      'purchase',
      50_000,
      SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
    );
    void invCostC;

    const bankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-03-10;2026-03-10;Odbiorca GL Sp. z o.o.;;Zapłata za FV/PG18-GL/A;1230,00;PLN;PG18-IN-1230',
      '2026-03-11;2026-03-11;Dostawca GL S.A.;;Zapłata FZ/PG18-GL/C;-615,00;PLN;PG18-OUT-615',
    ].join('\n');

    const imp1Res = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/finance/bank-import`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ format: 'csv', rawContent: bankCsv, applySettlements: true }),
      },
    );
    expect(imp1Res.status).toBe(200);
    const imp1 = ImportBankStatementResponseSchema.parse(await imp1Res.json());
    expect(imp1.matchedExactCount).toBe(2);

    // Split 1230 PLN inflow across Sales A (615 PLN) + Sales B (615 PLN)
    const inTx = imp1.finance.bankTransactions.find((t) => t.direction === 'credit')!;
    const splitRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/finance/reconcile`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          matches: [
            {
              transactionId: inTx.transactionId,
              settlementId: invSalesA.postingResult!.settlementId!,
              amountGrosze: 61_500,
            },
            {
              transactionId: inTx.transactionId,
              settlementId: invSalesB.postingResult!.settlementId!,
              amountGrosze: 61_500,
            },
          ],
        }),
      },
    );
    expect(splitRes.status).toBe(200);

    // Cold restart app1 -> app2 and verify GL trialBalance + balanceSheet match open settlements 1:1!
    await app1.close();
    openApps.delete(app1);

    const { app: app2, baseUrl: url2 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app2);
    const janHeaders2 = await issuePersonaHeaders(url2, 'jan-testowy');

    const ledgerColdRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/ledger?period=2026-03`,
      { headers: janHeaders2 },
    );
    expect(ledgerColdRes.status).toBe(200);
    const ledgerCold = LedgerViewResponseSchema.parse(await ledgerColdRes.json());
    expect(ledgerCold.trialBalance.isBalanced).toBe(true);
    expect(ledgerCold.balanceSheet.isBalanced).toBe(true);

    // 130 = 50 000 + 1 230 - 615 = 50 615,00 zł (5 061 500 gr)
    // 201 = 2 460 - 1 230 = 1 230,00 zł (123 000 gr) === openReceivablesGrosze
    // 202 = 615 - 615 = 0 gr === openPayablesGrosze
    expect(
      ledgerCold.trialBalance.rows.find((r) => r.accountCode === '130')?.endingBalanceWnGrosze,
    ).toBe(5_061_500);
    expect(
      ledgerCold.trialBalance.rows.find((r) => r.accountCode === '201')?.endingBalanceWnGrosze,
    ).toBe(123_000);
    expect(
      ledgerCold.trialBalance.rows.find((r) => r.accountCode === '202')?.endingBalanceMaGrosze ?? 0,
    ).toBe(0);

    // 0-amount unmatch on cold app2 appends red-storno without violating PG18 append-only trigger!
    const unmatchRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/finance/reconcile`,
      {
        method: 'POST',
        headers: janHeaders2,
        body: JSON.stringify({
          transactionId: inTx.transactionId,
          settlementId: invSalesA.postingResult!.settlementId!,
          amountGrosze: 0,
        }),
      },
    );
    expect(unmatchRes.status).toBe(200);
    const finAfterUnmatch = FinanceViewResponseSchema.parse(await unmatchRes.json());
    expect(finAfterUnmatch.summary.openReceivablesGrosze).toBe(246_000);

    const ledgerAfterUnmatchRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${spzooId}/ledger?period=2026-03`,
      { headers: janHeaders2 },
    );
    const ledgerAfterUnmatch = LedgerViewResponseSchema.parse(await ledgerAfterUnmatchRes.json());
    expect(ledgerAfterUnmatch.trialBalance.isBalanced).toBe(true);
    expect(
      ledgerAfterUnmatch.trialBalance.rows.find((r) => r.accountCode === '130')
        ?.endingBalanceWnGrosze,
    ).toBe(4_938_500);
    expect(
      ledgerAfterUnmatch.trialBalance.rows.find((r) => r.accountCode === '201')
        ?.endingBalanceWnGrosze,
    ).toBe(246_000);

    await app2.close();
    openApps.delete(app2);
  });

  it('#116 (GLD-08): persists period close state across PG18 cold restarts, enforces Tenant 2 RLS 403 on shorthand & full routes, serializes 2-instance close vs approve race, and blocks retroactive writes while allowing open-period corrections', async () => {
    const { app: app1, baseUrl: url1 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app1);
    const janHeaders = await issuePersonaHeaders(url1, 'jan-testowy');
    const piotrHeaders = await issuePersonaHeaders(url1, 'piotr-izolacyjny');

    // Tenant 2 isolation on both shorthand /v1/companies/:companyId/... and tenant-scoped routes -> 403!
    const crossTenantShort = await fetch(
      `${url1}/v1/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close-status`,
      { headers: piotrHeaders },
    );
    expect(crossTenantShort.status).toBe(403);

    const crossTenantFull = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close`,
      {
        method: 'POST',
        headers: piotrHeaders,
        body: JSON.stringify({ confirmClose: true }),
      },
    );
    expect(crossTenantFull.status).toBe(403);

    // Firma 1 has unverified doc + pending MCP proposal -> readyToClose=false via shorthand route
    const f1StatusRes = await fetch(
      `${url1}/v1/companies/${COMPANY_JDG_KPIR_ID}/periods/2026-03/close-status`,
      { headers: janHeaders },
    );
    expect(f1StatusRes.status).toBe(200);
    const f1Status = PeriodCloseStatusResponseSchema.parse(await f1StatusRes.json());
    expect(f1Status.readyToClose).toBe(false);

    const f1BlockedClose = await fetch(
      `${url1}/v1/companies/${COMPANY_JDG_KPIR_ID}/periods/2026-03/close`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ confirmClose: true }),
      },
    );
    expect(f1BlockedClose.status).toBe(422);

    // Empty body {} on POST .../periods/:period/close must fail schema validation (400), never silently default confirmClose=true
    const emptyBodyClose = await fetch(
      `${url1}/v1/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({}),
      },
    );
    expect(emptyBodyClose.status).toBe(400);

    // Transition COMPANY_SPZOO_ID 2026-03: open -> reconciling, then 2-instance race between close & retroactive approve!
    const recRes = await fetch(`${url1}/v1/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close`, {
      method: 'POST',
      headers: janHeaders,
      body: JSON.stringify({
        confirmClose: false,
        status: 'reconciling',
        note: 'Uzgodnienie ZOiS',
      }),
    });
    expect(recRes.status).toBe(200);
    expect(PeriodCloseStatusResponseSchema.parse(await recRes.json()).status).toBe('reconciling');

    // Boot 2nd API instance on same PG18 schema for concurrent race!
    const { app: app2, baseUrl: url2 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app2);
    const janHeaders2 = await issuePersonaHeaders(url2, 'jan-testowy');

    const raceDraftRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          documentNumber: 'FZ/PG18-RACE/2026/03/01',
          direction: 'purchase',
          issueDate: '2026-03-29',
          eventDate: '2026-03-29',
          counterpartyName: 'Dostawca Race Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
          lines: [{ description: 'Usługa marcowa w wyścigu', netGrosze: 30_000, vatRate: '23' }],
        }),
      },
    );
    expect(raceDraftRes.status).toBe(201);
    const raceDraft = CompanyDocumentItemSchema.parse(await raceDraftRes.json());

    const [closeRaceRes, approveRaceRes] = await Promise.all([
      fetch(
        `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close`,
        {
          method: 'POST',
          headers: janHeaders,
          body: JSON.stringify({ confirmClose: true, note: 'Zamknięcie marca' }),
        },
      ),
      fetch(
        `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents/${raceDraft.documentId}/approve-and-post`,
        { method: 'POST', headers: janHeaders2, body: '{}' },
      ),
    ]);

    // Either approve ran first (200) allowing close to succeed (200), OR close ran first and failed 422 (because unverified doc existed) while approve succeeded (200)!
    expect(approveRaceRes.status).toBe(200);
    expect([200, 422]).toContain(closeRaceRes.status);
    if (closeRaceRes.status === 422) {
      // Now that raceDraft is posted, closing succeeds cleanly!
      const finalClose = await fetch(
        `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close`,
        {
          method: 'POST',
          headers: janHeaders,
          body: JSON.stringify({ confirmClose: true, note: 'Zamknięcie marca po zaksięgowaniu' }),
        },
      );
      expect(finalClose.status).toBe(200);
    }

    await app1.close();
    openApps.delete(app1);
    await app2.close();
    openApps.delete(app2);

    // Cold restart app3 -> verify 2026-03 remains closed, blocks retroactive writes (409), and allows 2026-04 correction!
    const { app: app3, baseUrl: url3 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app3);
    const janHeaders3 = await issuePersonaHeaders(url3, 'jan-testowy');

    const coldCloseStatusRes = await fetch(
      `${url3}/v1/companies/${COMPANY_SPZOO_ID}/periods/2026-03/close-status`,
      { headers: janHeaders3 },
    );
    expect(coldCloseStatusRes.status).toBe(200);
    expect(PeriodCloseStatusResponseSchema.parse(await coldCloseStatusRes.json()).status).toBe(
      'closed',
    );

    const retroJournal = await fetch(
      `${url3}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger`,
      {
        method: 'POST',
        headers: janHeaders3,
        body: JSON.stringify({
          bookingDate: '2026-03-31',
          documentDate: '2026-03-31',
          documentNumber: 'PK/RETRO/2026/03',
          description: 'Próba księgowania wstecznego po restarcie',
          lines: [
            { accountCode: '402', side: 'Wn', amountGrosze: 10_000, description: 'Koszt' },
            { accountCode: '130', side: 'Ma', amountGrosze: 10_000, description: 'Bank' },
          ],
        }),
      },
    );
    expect(retroJournal.status).toBe(409);
    expect(((await retroJournal.json()) as { reasonCode: string }).reasonCode).toBe(
      'period_closed',
    );

    const aprilCorrCreate = await fetch(
      `${url3}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders3,
        body: JSON.stringify({
          documentNumber: 'FK/PG18-APRIL/2026/04/01',
          direction: 'sales',
          issueDate: '2026-04-06',
          eventDate: '2026-04-06',
          counterpartyName: 'Kontrahent Korporacyjny Test Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
          isCorrection: true,
          correctedDocumentNumber: 'FV-SPZOO/2026/03/01',
          correctionReason: 'Korekta rabatu ujęta w otwartym kwietniu 2026',
          lines: [{ description: 'Rabat 23%', netGrosze: -50_000, vatRate: '23' }],
        }),
      },
    );
    expect(aprilCorrCreate.status).toBe(201);
    const aprilDraft = CompanyDocumentItemSchema.parse(await aprilCorrCreate.json());
    const aprilApprove = await fetch(
      `${url3}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents/${aprilDraft.documentId}/approve-and-post`,
      { method: 'POST', headers: janHeaders3, body: '{}' },
    );
    expect(aprilApprove.status).toBe(200);

    await app3.close();
    openApps.delete(app3);
  });

  it('#81 (GLD-06 & GLD-07): persists verified tax/ZUS payments in PG18, deducts ONLY paid ZUS, and enforces 19% CIT on unattested Sp. z o.o. (fail-closed 422 on unattested 9%)', async () => {
    const { app: app1, baseUrl: url1 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app1);
    const janHeaders = await issuePersonaHeaders(url1, 'jan-testowy');

    // 1. Ryczałt before verified ZUS payment: paidGrosze = 0, ryczałt = 216 000 gr
    const ryczBeforeRes = await fetch(
      `${url1}/v1/companies/${COMPANY_JDG_RYCZALT_ID}/taxes/obligations?period=2026-03`,
      { headers: janHeaders },
    );
    expect(ryczBeforeRes.status).toBe(200);
    const ryczBefore = PeriodTaxObligationsResponseSchema.parse(await ryczBeforeRes.json());
    const zusSocBefore = ryczBefore.items.find((i) => i.obligationKind === 'zus_social')!;
    expect(zusSocBefore.paidGrosze).toBe(0);
    expect(
      ryczBefore.items.find((i) => i.obligationKind === 'ryczalt_advance')?.accruedGrosze,
    ).toBe(216_000);

    // Import ZUS debit transfer and record verified payment
    const zusCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      `2026-03-15;2026-03-15;Zakład Ubezpieczeń Społecznych;;Składka ZUS 2026-03;-${(zusSocBefore.accruedGrosze / 100).toFixed(2).replace('.', ',')};PLN;PG18-ZUS-03`,
    ].join('\n');
    const impZusRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_RYCZALT_ID}/finance/bank-import`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ format: 'csv', rawContent: zusCsv, applySettlements: false }),
      },
    );
    expect(impZusRes.status).toBe(200);
    const zusTxId = ImportBankStatementResponseSchema.parse(await impZusRes.json()).finance
      .bankTransactions[0]!.transactionId;

    // Spoofed paidDate !== bank bookingDate -> 422 payment_date_mismatch_with_bank_transaction
    const spoofedDatePayRes = await fetch(
      `${url1}/v1/companies/${COMPANY_JDG_RYCZALT_ID}/taxes/payments`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          obligationKind: 'zus_social',
          targetPeriod: '2026-03',
          paidDate: '2026-03-10',
          amountGrosze: zusSocBefore.accruedGrosze,
          bankTransactionId: zusTxId,
        }),
      },
    );
    expect(spoofedDatePayRes.status).toBe(422);
    expect(((await spoofedDatePayRes.json()) as { reasonCode?: string }).reasonCode).toBe(
      'payment_date_mismatch_with_bank_transaction',
    );

    const payRes = await fetch(`${url1}/v1/companies/${COMPANY_JDG_RYCZALT_ID}/taxes/payments`, {
      method: 'POST',
      headers: janHeaders,
      body: JSON.stringify({
        obligationKind: 'zus_social',
        targetPeriod: '2026-03',
        paidDate: '2026-03-15',
        amountGrosze: zusSocBefore.accruedGrosze,
        bankTransactionId: zusTxId,
      }),
    });
    expect(payRes.status).toBe(200);

    // 2. Provision unattested Sp. z o.o. -> defaults to 19% CIT, rejects unattested 9% with 422!
    const createCit19Res = await fetch(`${url1}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: janHeaders,
      body: JSON.stringify({
        displayName: 'PG18 Niepoświadczona Sp. z o.o. CIT 19%',
        nip: '5213017228',
        legalForm: 'sp_z_o_o',
        taxRegime: 'cit_klasyczny',
        vatStatus: 'czynny',
        activityStartDate: '2024-01-01',
      }),
    });
    expect(createCit19Res.status).toBe(201);
    const cit19CompId = CreateCompanyResponseSchema.parse(await createCit19Res.json()).company
      .legalEntityId;

    const docRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${cit19CompId}/documents`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          documentNumber: 'FV/PG18-CIT19/01',
          direction: 'sales',
          issueDate: '2026-03-12',
          counterpartyName: 'Odbiorca CIT 19% S.A.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
          lines: [{ description: 'Usługa 10 000 zł', netGrosze: 1_000_000, vatRate: '23' }],
        }),
      },
    );
    const draft = CompanyDocumentItemSchema.parse(await docRes.json());
    await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${cit19CompId}/documents/${draft.documentId}/approve-and-post`,
      { method: 'POST', headers: janHeaders, body: '{}' },
    );

    // Cold restart app1 -> app2 and verify both Ryczałt ZUS payment AND CIT 19% persisted!
    await app1.close();
    openApps.delete(app1);

    const { app: app2, baseUrl: url2 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app2);
    const janHeaders2 = await issuePersonaHeaders(url2, 'jan-testowy');

    const ryczAfterColdRes = await fetch(
      `${url2}/v1/companies/${COMPANY_JDG_RYCZALT_ID}/taxes/obligations?period=2026-03`,
      { headers: janHeaders2 },
    );
    expect(ryczAfterColdRes.status).toBe(200);
    const ryczAfterCold = PeriodTaxObligationsResponseSchema.parse(await ryczAfterColdRes.json());
    expect(ryczAfterCold.items.find((i) => i.obligationKind === 'zus_social')?.status).toBe('paid');
    expect(
      ryczAfterCold.items.find((i) => i.obligationKind === 'ryczalt_advance')!.accruedGrosze,
    ).toBeLessThan(216_000);

    const cit19OblRes = await fetch(
      `${url2}/v1/companies/${cit19CompId}/taxes/obligations?period=2026-03`,
      { headers: janHeaders2 },
    );
    expect(cit19OblRes.status).toBe(200);
    const cit19Obl = PeriodTaxObligationsResponseSchema.parse(await cit19OblRes.json());
    expect(cit19Obl.citRateDetails?.operatingAppliedRatePct).toBe(19);
    expect(cit19Obl.items.find((i) => i.obligationKind === 'cit_advance')?.accruedGrosze).toBe(
      190_000,
    );

    const cit9DeniedRes = await fetch(
      `${url2}/v1/companies/${cit19CompId}/taxes/obligations?period=2026-03&requestPreferentialCit9Pct=true`,
      { headers: janHeaders2 },
    );
    expect(cit9DeniedRes.status).toBe(422);

    await app2.close();
    openApps.delete(app2);
  });

  it('MCP Streamable HTTP Parity (#112 + #108 + #116): multi-line FA invoice posting + bank reconciliation -> Sp. z o.o. 130/201 GL survive PG18 cold restart', async () => {
    const { app: app1, baseUrl: url1 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app1);

    const agentToken = await issuePersonaToken(url1, 'jan-testowy', [
      'openid',
      'pap:mcp:read',
      'pap:mcp:prepare',
    ]);
    const martaHumanToken = await issuePersonaToken(url1, 'marta-ksiegowa');
    const janHeaders = await issuePersonaHeaders(url1, 'jan-testowy');
    const martaHeaders = {
      authorization: `Bearer ${martaHumanToken}`,
      'content-type': 'application/json',
    };

    // 1. Multi-line MCP invoice in open 2026-04 on COMPANY_SPZOO_ID (23% + 8%)
    const prepOut = await withMcpClient(url1, agentToken, async (client) => {
      const res = await client.callTool({
        name: 'prepare_invoice_and_posting_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_SPZOO_ID,
          idempotencyKey: 'bbbbbbbb-1111-4222-8333-ccccccccccc1',
          invoice: {
            direction: 'sales',
            invoiceNumber: 'FV/MCP-PG18-MULTI/2026/04/01',
            issueDate: '2026-04-12',
            dueDate: '2026-04-26',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
            counterpartyName: 'Odbiorca MCP Wielostawkowy Sp. z o.o.',
            netAmountPln: '300.00',
            vatAmountPln: '39.00',
            grossAmountPln: '339.00',
            expenseDescription: 'Wdrożenie 23% i dokumentacja 8%',
            suggestedCategory: 'przychod_sprzedaz',
            lines: [
              {
                description: 'Wdrożenie chmurowe 23%',
                quantity: '1',
                unit: 'usł.',
                netAmountPln: '100.00',
                vatRate: '23',
                vatAmountPln: '23.00',
                grossAmountPln: '123.00',
              },
              {
                description: 'Dokumentacja specjalistyczna 8%',
                quantity: '1',
                unit: 'egz.',
                netAmountPln: '200.00',
                vatRate: '8',
                vatAmountPln: '16.00',
                grossAmountPln: '216.00',
              },
            ],
          },
        },
      });
      return PrepareInvoiceAndPostingProposalOutputSchema.parse(res.structuredContent);
    });

    const chInvRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/mcp/proposals/${prepOut.proposalId}/challenge`,
      { method: 'POST', headers: martaHeaders, body: '{}' },
    );
    expect(chInvRes.status).toBe(200);
    const chInv = (await chInvRes.json()) as { confirmationCode: string };

    const confInvOut = await withMcpClient(url1, martaHumanToken, async (client) => {
      const res = await client.callTool({
        name: 'confirm_prepared_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_SPZOO_ID,
          proposalId: prepOut.proposalId,
          expectedPayloadHash: prepOut.payloadHash,
          confirmationCode: chInv.confirmationCode,
          idempotencyKey: 'bbbbbbbb-1111-4222-8333-ccccccccccc2',
        },
      });
      return ConfirmPreparedProposalOutputSchema.parse(res.structuredContent);
    });

    // 2. Import 339.00 PLN bank inflow (applySettlements: false) and reconcile via MCP maker-checker!
    const bankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-04-16;2026-04-16;Odbiorca MCP Wielostawkowy Sp. z o.o.;;Przelew za fakturę kwietniową;339,00;PLN;PG18-MCP-BANK-339',
    ].join('\n');
    const impBankRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/finance/bank-import`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ format: 'csv', rawContent: bankCsv, applySettlements: false }),
      },
    );
    expect(impBankRes.status).toBe(200);

    const prepBankOut = await withMcpClient(url1, agentToken, async (client) => {
      const listRes = await client.callTool({
        name: 'list_unreconciled_bank_transactions',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_SPZOO_ID,
          period: '2026-04',
        },
      });
      const listParsed = ListUnreconciledBankTransactionsOutputSchema.parse(
        listRes.structuredContent,
      );
      expect(listParsed.transactions).toHaveLength(1);
      const bankTransactionId = listParsed.transactions[0]!.bankTransactionId;

      const prepRes = await client.callTool({
        name: 'prepare_bank_reconciliation',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_SPZOO_ID,
          bankTransactionId,
          invoiceId: confInvOut.ledgerEntryId,
          allocationGrossPln: '339.00',
          idempotencyKey: 'bbbbbbbb-1111-4222-8333-ccccccccccc3',
        },
      });
      return PrepareBankReconciliationOutputSchema.parse(prepRes.structuredContent);
    });

    const chBankRes = await fetch(
      `${url1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/mcp/proposals/${prepBankOut.proposalId}/challenge`,
      { method: 'POST', headers: martaHeaders, body: '{}' },
    );
    expect(chBankRes.status).toBe(200);
    const chBank = (await chBankRes.json()) as { confirmationCode: string };

    const confBankOut = await withMcpClient(url1, martaHumanToken, async (client) => {
      const res = await client.callTool({
        name: 'confirm_bank_reconciliation_proposal',
        arguments: {
          tenantId: TENANT_1_ID,
          legalEntityId: COMPANY_SPZOO_ID,
          proposalId: prepBankOut.proposalId,
          expectedPayloadHash: prepBankOut.payloadHash,
          confirmationCode: chBank.confirmationCode,
          idempotencyKey: 'bbbbbbbb-1111-4222-8333-ccccccccccc4',
        },
      });
      return ConfirmBankReconciliationOutputSchema.parse(res.structuredContent);
    });
    expect(confBankOut.remainingInvoiceGrossAfterPln).toBe('0.00');

    // Cold restart app1 -> app2 and verify multi-line VAT + settled invoice + 130/201 GL persisted in PG18!
    await app1.close();
    openApps.delete(app1);

    const { app: app2, baseUrl: url2 } = await bootApiInstance(buildRuntimeEnv(false));
    openApps.add(app2);
    const janHeaders2 = await issuePersonaHeaders(url2, 'jan-testowy');

    const vatAprilRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/vat?period=2026-04`,
      { headers: janHeaders2 },
    );
    expect(vatAprilRes.status).toBe(200);
    const vatApril = VatViewResponseSchema.parse(await vatAprilRes.json());
    expect(
      vatApril.salesEntries.filter((e) => e.documentNumber === 'FV/MCP-PG18-MULTI/2026/04/01'),
    ).toHaveLength(2);

    const finRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/finance`,
      { headers: janHeaders2 },
    );
    const fin = FinanceViewResponseSchema.parse(await finRes.json());
    expect(
      fin.settlements.find((s) => s.documentId === confInvOut.ledgerEntryId)?.remainingGrosze,
    ).toBe(0);

    const ledgerAprilRes = await fetch(
      `${url2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger?period=2026-04`,
      { headers: janHeaders2 },
    );
    const ledgerApril = LedgerViewResponseSchema.parse(await ledgerAprilRes.json());
    expect(ledgerApril.trialBalance.isBalanced).toBe(true);
    expect(
      ledgerApril.journalEntries.some((je) =>
        je.lines.some((l) => l.accountCode === '130' && l.amountGrosze === 33_900),
      ),
    ).toBe(true);

    await app2.close();
    openApps.delete(app2);
  });
});
