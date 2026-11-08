import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { COMPANY_JDG_KPIR_ID, SYNTHETIC_COUNTERPARTY_NIPS, TENANT_1_ID } from '@pap/application';
import {
  CompanyDocumentItemSchema,
  DocumentsListResponseSchema,
  GetMyCompaniesResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import {
  DatabaseConfigError,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';

interface DrizzleJournalFile {
  readonly entries: readonly {
    readonly idx: number;
    readonly tag: string;
  }[];
}

async function applySqlMigrationsToSchema(
  ownerClient: ReturnType<typeof connectDatabase>['client'],
): Promise<void> {
  const drizzleDir = fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url));
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

describe('Adversarial Wave 1 Regression Suite (#79 spójność multi-instance, #80 współbieżność NIP)', () => {
  const keyId = 'pap-adv-wave1-ctx';
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
        'Zestaw adversarial wymaga PAP_DATABASE_ENV=test, DATABASE_URL oraz PAP_EPHEMERAL_RUNTIME_DATABASE_URL.',
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

    // Jednorazowe zasianie danych startowych (tenant, tożsamości i firmy demo) w beforeAll,
    // tak aby docelowe instancje testowe A i B działały wyłącznie na nieuprzywilejowanej roli
    // pap_test_app bez PAP_MIGRATOR_DATABASE_URL i mogły być uruchamiane w dowolnej kolejności.
    const { app: seedApp } = await bootApiInstance({
      NODE_ENV: 'test',
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_MIGRATOR_DATABASE_URL: migratorUrl,
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: keyHex,
      PAP_SEED_SYNTHETIC_DEMO: 'true',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SANDBOX_OIDC_SEED: 'pap-adv-79-oidc-seed-2026',
    });
    await seedApp.close();
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

  it('ADV-79-01: dwie instancje API ładują tę samą firmę F, a następnie naprzemiennie zapisują i czytają dokumenty, KPiR i VAT bez restartu', async () => {
    const runtimeEnv = {
      NODE_ENV: 'test',
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: keyHex,
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SANDBOX_OIDC_SEED: 'pap-adv-79-oidc-seed-2026',
    };

    const { app: appA, baseUrl: urlA } = await bootApiInstance(runtimeEnv);
    openApps.add(appA);

    const { app: appB, baseUrl: urlB } = await bootApiInstance(runtimeEnv);
    openApps.add(appB);

    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // Krok 1: Obie instancje (A i B) ładują/odczytują istniejącą firmę F przed jakąkolwiek nową mutacją
    const initialDocsA = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersA },
        )
      ).json(),
    );
    const initialDocsB = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersB },
        )
      ).json(),
    );
    expect(initialDocsB.documents.length).toBe(initialDocsA.documents.length);

    const initialKpirB = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    const initialVatB = VatViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );

    // Krok 2: Instancja A tworzy i księguje nową fakturę kosztową (1000.00 PLN netto, 230.00 PLN VAT)
    const docNumFromA = 'FV/ADV-79/A-TO-B/2026/03/01';
    const createOnARes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          documentNumber: docNumFromA,
          direction: 'purchase',
          issueDate: '2026-03-28',
          dueDate: '2026-04-11',
          counterpartyName: 'Kontrahent Adversarial A Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          suggestedCategory: 'uslugi_obce',
          lines: [
            {
              description: 'Usługa audytu spójności z Instancji A',
              netGrosze: 100_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(createOnARes.status).toBe(201);
    const createdOnA = CompanyDocumentItemSchema.parse(await createOnARes.json());

    const postOnARes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${createdOnA.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          netPln: '1000.00',
          vatPln: '230.00',
          vatRate: '23',
          suggestedCategory: 'uslugi_obce',
          vatDeductionMode: 'full_100',
          kpirQualification: 'other_expenses_100_col13',
        }),
      },
    );
    expect(postOnARes.status).toBe(200);
    const postedOnA = CompanyDocumentItemSchema.parse(await postOnARes.json());
    expect(postedOnA.status).toBe('posted');

    // Krok 3: Instancja B BEZ RESTARTU odczytuje dokumenty, KPiR i VAT firmy F
    const docsOnBAfterA = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersB },
        )
      ).json(),
    );
    const seenOnB = docsOnBAfterA.documents.find((d) => d.document.documentNumber === docNumFromA);
    expect(seenOnB).toBeDefined();
    expect(seenOnB?.status).toBe('posted');

    const kpirOnBAfterA = KpirViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    expect(kpirOnBAfterA.entries.length).toBe(initialKpirB.entries.length + 1);
    const kpirEntryOnB = kpirOnBAfterA.entries.find((e) => e.documentNumber === docNumFromA);
    expect(kpirEntryOnB?.col13OtherExpensesGrosze).toBe(100_000);

    const vatOnBAfterA = VatViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    expect(vatOnBAfterA.purchaseEntries.length).toBe(initialVatB.purchaseEntries.length + 1);
    const vatEntryOnB = vatOnBAfterA.purchaseEntries.find((e) => e.documentNumber === docNumFromA);
    expect(vatEntryOnB?.netGrosze).toBe(100_000);

    // Krok 4: Naprzemienny zapis na Instancji B -> natychmiastowy odczyt na Instancji A bez restartu
    const docNumFromB = 'FV/ADV-79/B-TO-A/2026/03/02';
    const createOnBRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({
          documentNumber: docNumFromB,
          direction: 'purchase',
          issueDate: '2026-03-29',
          dueDate: '2026-04-12',
          counterpartyName: 'Kontrahent Adversarial B Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
          suggestedCategory: 'uslugi_obce',
          lines: [
            {
              description: 'Usługa audytu spójności z Instancji B',
              netGrosze: 200_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(createOnBRes.status).toBe(201);
    const createdOnB = CompanyDocumentItemSchema.parse(await createOnBRes.json());

    const postOnBRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${createdOnB.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({
          netPln: '2000.00',
          vatPln: '460.00',
          vatRate: '23',
          suggestedCategory: 'uslugi_obce',
          vatDeductionMode: 'full_100',
          kpirQualification: 'other_expenses_100_col13',
        }),
      },
    );
    expect(postOnBRes.status).toBe(200);

    const docsOnAAfterB = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersA },
        )
      ).json(),
    );
    const seenOnA = docsOnAAfterB.documents.find((d) => d.document.documentNumber === docNumFromB);
    expect(seenOnA).toBeDefined();
    expect(seenOnA?.status).toBe('posted');
  });

  it('ADV-80-01: 20 równoczesnych prób utworzenia firmy o tym samym NIP na dwóch instancjach tworzy dokładnie 1 kompletną firmę, a pozostałe kończą się 409 bez sierot w DB', async () => {
    const runtimeEnv = {
      NODE_ENV: 'test',
      PAP_DATABASE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      PAP_DB_SCHEMA: dataSchema,
      PAP_DB_CONTEXT_KEY_ID: keyId,
      PAP_DB_CONTEXT_KEY_HEX: keyHex,
      PAP_SEED_SYNTHETIC_DEMO: 'false',
      PAP_SANDBOX_AUTH_ENABLED: 'true',
      PAP_ENFORCE_RUNTIME_DB_SECURITY: 'true',
      PAP_SANDBOX_OIDC_SEED: 'pap-adv-79-oidc-seed-2026',
    };

    const { app: appA, baseUrl: urlA } = await bootApiInstance(runtimeEnv);
    openApps.add(appA);
    const { app: appB, baseUrl: urlB } = await bootApiInstance(runtimeEnv);
    openApps.add(appB);

    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // Poprawny modulo-11 NIP testowy (5270009002)
    const contestedNip = '5270009002';

    const requests = Array.from({ length: 20 }, (_, idx) => {
      const targetUrl = idx % 2 === 0 ? urlA : urlB;
      const headers = idx % 2 === 0 ? headersA : headersB;
      return fetch(`${targetUrl}/api/v1/tenants/${TENANT_1_ID}/companies`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          displayName: `Współbieżna Spółka Testowa #${idx + 1}`,
          nip: contestedNip,
          legalForm: 'jdg',
          taxRegime: 'kpir_liniowy',
          vatStatus: 'czynny',
          zusStage: 'duzy_zus',
        }),
      });
    });

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const createdCount = statuses.filter((s) => s === 201).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    expect(createdCount).toBe(1);
    expect(conflictCount).toBe(19);

    // 1. Dokładnie 1 wiersz w company_tax_settings dla tego NIP
    const taxSettingsRows = await owner!.client<{ legal_entity_id: string }[]>`
      SELECT legal_entity_id
      FROM ${owner!.client(dataSchema)}.company_tax_settings
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND nip = ${contestedNip}
    `;
    expect(taxSettingsRows).toHaveLength(1);
    const winnerEntityId = taxSettingsRows[0]!.legal_entity_id;

    // 2. Dokładnie 1 wiersz w entity_profile_version dla tego NIP, wskazujący tę samą firmę
    const profileRows = await owner!.client<{ legal_entity_id: string }[]>`
      SELECT legal_entity_id
      FROM ${owner!.client(dataSchema)}.entity_profile_version
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND profile_json->>'nip' = ${contestedNip}
    `;
    expect(profileRows).toHaveLength(1);
    expect(profileRows[0]!.legal_entity_id).toBe(winnerEntityId);

    // 3. Zero osieroconych rekordów w legal_entity bez company_tax_settings (wykrywa częściowy provisioning)
    const orphanEntities = await owner!.client<{ id: string }[]>`
      SELECT le.id
      FROM ${owner!.client(dataSchema)}.legal_entity le
      LEFT JOIN ${owner!.client(dataSchema)}.company_tax_settings cts
        ON cts.tenant_id = le.tenant_id AND cts.legal_entity_id = le.id
      WHERE le.tenant_id = ${TENANT_1_ID}::uuid
        AND cts.legal_entity_id IS NULL
    `;
    expect(orphanEntities).toHaveLength(0);

    // 4. Obie instancje API zwracają tę samą pojedynczą firmę dla tego NIP
    const companiesOnA = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies`, { headers: headersA })
      ).json(),
    );
    const companiesOnB = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies`, { headers: headersB })
      ).json(),
    );
    expect(companiesOnA.companies.filter((c) => c.nip === contestedNip)).toHaveLength(1);
    expect(companiesOnB.companies.filter((c) => c.nip === contestedNip)).toHaveLength(1);
    expect(companiesOnB.companies.find((c) => c.nip === contestedNip)?.legalEntityId).toBe(
      winnerEntityId,
    );
  });
});
