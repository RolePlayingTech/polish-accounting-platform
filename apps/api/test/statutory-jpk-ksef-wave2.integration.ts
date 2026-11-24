import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  validateOfficialMfXml,
} from '@pap/application';
import { CompanyDocumentItemSchema, IssueSandboxTokenResponseSchema } from '@pap/contracts';
import {
  ExportJpkResponseSchema,
  GenerateInvoiceFa3XmlResponseSchema,
  SyncKsefIncomingResponseSchema,
} from '@pap/contracts/statutory-ksef';
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
    throw new Error('Failed to bind ephemeral TCP port for @pap/api.');
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

describe('Wave 2 Statutory JPK, FA(3) XML & KSeF Sandbox under PostgreSQL 18.6 FORCE RLS (#82, #98, #99, GLD-09..11)', () => {
  const keyId = 'pap-api-w2-jpk-ctx';
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
        'Integration test requires PAP_DATABASE_ENV=test, DATABASE_URL and PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
      );
    }
    migratorUrl = process.env.DATABASE_URL.trim();
    runtimeUrl = (process.env.PAP_EPHEMERAL_RUNTIME_DATABASE_URL ?? '').trim();
    if (!runtimeUrl) {
      throw new DatabaseConfigError('Missing PAP_EPHEMERAL_RUNTIME_DATABASE_URL.');
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

  it('persists VAT P_54/P_62/P_39 settlements, KPiR/Ledger postings, and KSeF synced drafts across PG18 API restarts and exports XSD-valid JPK/FA(3) XMLs with strict 2-tenant RLS isolation', async () => {
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

    // === INSTANCE #1 ===
    const { app: app1, baseUrl: baseUrl1 } = await bootApiInstance(runtimeEnv);
    openApps.add(app1);

    const janHeaders1 = await issuePersonaHeaders(baseUrl1, 'jan-testowy');

    // 1. Create & post a large purchase invoice on JDG KPiR to produce VAT excess P_53, then configure P_54=300 PLN
    const purchRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: 'FZ/PG18-VAT/2026/03/01',
          direction: 'purchase',
          issueDate: '2026-03-23',
          dueDate: '2026-04-06',
          counterpartyName: 'Infrastruktura PG18 Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
          suggestedCategory: 'uslugi_obce',
          lines: [
            { description: 'Klaster obliczeniowy marzec', netGrosze: 3_000_000, vatRate: '23' },
          ],
        }),
      },
    );
    expect(purchRes.status).toBe(201);
    const purchDoc = CompanyDocumentItemSchema.parse(await purchRes.json());

    const postPurchRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${purchDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({}),
      },
    );
    expect(postPurchRes.status).toBe(200);

    const settleRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat/settlement`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          period: '2026-03',
          refundRequestedP54Grosze: 30_000,
          finalize: true,
        }),
      },
    );
    expect(settleRes.status).toBe(200);

    // 2. Create a sales invoice on JDG KPiR and a fixed-asset 010 entry on Sp. z o.o.
    const salesRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          documentNumber: 'FV/PG18-FA3/2026/03/10',
          direction: 'sales',
          issueDate: '2026-03-24',
          dueDate: '2026-04-07',
          counterpartyName: 'Odbiorca PG18 Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
          lines: [
            { description: 'Audyt architektury bezpieczeństwa', netGrosze: 400_000, vatRate: '23' },
          ],
        }),
      },
    );
    expect(salesRes.status).toBe(201);
    const salesDocId = CompanyDocumentItemSchema.parse(await salesRes.json()).documentId;

    const jeRes = await fetch(
      `${baseUrl1}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger/journal-entries`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          bookingDate: '2026-03-18',
          documentDate: '2026-03-18',
          documentNumber: 'OT/PG18-SPZOO/01',
          description: 'Przyjęcie środka trwałego serwerowego do ewidencji ksiąg rachunkowych',
          lines: [
            {
              accountCode: '010',
              side: 'Wn',
              amountGrosze: 1_800_000,
              description: 'Serwer bazodanowy KŚT 487',
            },
            {
              accountCode: '130',
              side: 'Ma',
              amountGrosze: 1_800_000,
              description: 'Przelew za serwer bazodanowy',
            },
          ],
        }),
      },
    );
    expect(jeRes.status).toBe(201);

    // 3. Sync incoming KSeF sandbox invoice -> persisted in PG18 as needs_verification
    const syncRes = await fetch(
      `${baseUrl1}/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/sync-incoming`,
      {
        method: 'POST',
        headers: janHeaders1,
        body: JSON.stringify({
          fromIso: '2026-03-26T00:00:00.000Z',
          toIso: '2026-03-31T23:59:59.000Z',
          environment: 'local_mock',
        }),
      },
    );
    expect(syncRes.status).toBe(200);
    const synced = SyncKsefIncomingResponseSchema.parse(await syncRes.json());
    const syncedDraftId = synced.items[0]!.draftDocumentId!;

    await app1.close();
    openApps.delete(app1);

    // === INSTANCE #2 (Fresh API hydrated from PostgreSQL 18.6 under NOBYPASSRLS + FORCE RLS) ===
    const { app: app2, baseUrl: baseUrl2 } = await bootApiInstance({
      ...runtimeEnv,
      PAP_SEED_SYNTHETIC_DEMO: 'false',
    });
    openApps.add(app2);

    const janHeaders2 = await issuePersonaHeaders(baseUrl2, 'jan-testowy');
    const piotrHeaders2 = await issuePersonaHeaders(baseUrl2, 'piotr-izolacyjny');

    // Synced KSeF draft survived PG18 restart and remains unposted (needs_verification / ai_proposed, postingResult === null)
    const draftAfterRestart = await fetch(
      `${baseUrl2}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${syncedDraftId}`,
      { headers: janHeaders2 },
    );
    expect(draftAfterRestart.status).toBe(200);
    const restartedDraft = CompanyDocumentItemSchema.parse(await draftAfterRestart.json());
    expect(['needs_verification', 'ai_proposed']).toContain(restartedDraft.status);
    expect(restartedDraft.postingResult).toBeNull();
    expect(restartedDraft.approvedByUserId).toBeNull();

    // Export JPK_V7M(3) for 2026-03 and 2026-04 -> persisted P_54=300 and P_62->P_39 carryover!
    const v7MarRes = await fetch(`${baseUrl2}/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`, {
      method: 'POST',
      headers: janHeaders2,
      body: JSON.stringify({ period: '2026-03', structureCode: 'JPK_V7M(3)', purpose: 1 }),
    });
    expect(v7MarRes.status).toBe(200);
    const v7Mar = ExportJpkResponseSchema.parse(await v7MarRes.json());
    expect(v7Mar.summary.p54RefundPln).toBe(300);
    expect(validateOfficialMfXml(v7Mar.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    const v7AprRes = await fetch(`${baseUrl2}/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`, {
      method: 'POST',
      headers: janHeaders2,
      body: JSON.stringify({ period: '2026-04', structureCode: 'JPK_V7M(3)', purpose: 1 }),
    });
    expect(v7AprRes.status).toBe(200);
    const v7Apr = ExportJpkResponseSchema.parse(await v7AprRes.json());
    expect(v7Apr.summary.p39CarryoverPln).toBe(v7Mar.summary.p62CarryForwardPln);
    expect(validateOfficialMfXml(v7Apr.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    // Export JPK_PKPIR(3), JPK_EWP(4), JPK_KR_PD(1), JPK_ST_KR(1), and FA(3) XML from PG18 state
    for (const [compId, struct] of [
      [COMPANY_JDG_KPIR_ID, 'JPK_PKPIR(3)'],
      [COMPANY_JDG_RYCZALT_ID, 'JPK_EWP(4)'],
      [COMPANY_SPZOO_ID, 'JPK_KR_PD(1)'],
      [COMPANY_SPZOO_ID, 'JPK_ST_KR(1)'],
    ] as const) {
      const expRes = await fetch(`${baseUrl2}/v1/companies/${compId}/jpk/export`, {
        method: 'POST',
        headers: janHeaders2,
        body: JSON.stringify({ period: '2026-03', structureCode: struct, purpose: 1 }),
      });
      expect(expRes.status).toBe(200);
      const parsed = ExportJpkResponseSchema.parse(await expRes.json());
      expect(validateOfficialMfXml(parsed.xmlContent, struct).valid).toBe(true);
    }

    const fa3Res = await fetch(
      `${baseUrl2}/v1/companies/${COMPANY_JDG_KPIR_ID}/invoices/${salesDocId}/fa3-xml`,
      {
        method: 'POST',
        headers: janHeaders2,
        body: JSON.stringify({}),
      },
    );
    expect(fa3Res.status).toBe(200);
    const fa3 = GenerateInvoiceFa3XmlResponseSchema.parse(await fa3Res.json());
    expect(validateOfficialMfXml(fa3.xmlContent, 'FA(3)').valid).toBe(true);

    // Tenant 2 (Piotr) strictly blocked by RLS/RBAC (403)
    const piotrDenied = await fetch(`${baseUrl2}/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`, {
      method: 'POST',
      headers: piotrHeaders2,
      body: JSON.stringify({ period: '2026-03', structureCode: 'JPK_V7M(3)', purpose: 1 }),
    });
    expect(piotrDenied.status).toBe(403);
  }, 120_000);
});
