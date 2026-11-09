import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  AccountingWorkspaceConflictError,
  COMPANY_JDG_KPIR_ID,
  COMPANY_SPZOO_ID,
  DEMO_USER_MARTA_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  TransactionOutcomeUnknownError,
} from '@pap/application';
import {
  AccessMutationResponseSchema,
  CompanyDocumentItemSchema,
  CompanyOverviewResponseSchema,
  DocumentsListResponseSchema,
  GetMyCompaniesResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  LedgerViewResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import { KpirEntrySchema } from '@pap/contracts/accounting';
import {
  DatabaseConfigError,
  configureRuntimePrivileges,
  connectDatabase,
  provisionDatabaseContextKey,
} from '@pap/db';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import type { PostgresBackedWorkspaceService } from '../../src/runtime/postgres-workspace-persistence.js';
import { ACCOUNTING_WORKSPACE_SERVICE } from '../../src/runtime/workspace-runtime.js';

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

  afterEach(async () => {
    for (const app of openApps) {
      await app.close();
    }
    openApps.clear();
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

    // Krok 5: Sp. z o.o. (pełne księgi) — obie instancje ładują księgę główną, Instancja A księguje fakturę, Instancja B widzi dekret bez restartu
    const initialLedgerB = LedgerViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    const spzooDocNum = 'FV/ADV-79/SPZOO-A-TO-B/2026/03/01';
    const createSpzooRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          documentNumber: spzooDocNum,
          direction: 'sales',
          issueDate: '2026-03-28',
          dueDate: '2026-04-11',
          counterpartyName: 'Odbiorca Ksiąg Handlowych Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.kontrahentSpzoo,
          lines: [
            {
              description: 'Usługa wdrożeniowa UoR z Instancji A',
              netGrosze: 300_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(createSpzooRes.status).toBe(201);
    const createdSpzoo = CompanyDocumentItemSchema.parse(await createSpzooRes.json());

    const postSpzooRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/documents/${createdSpzoo.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({}),
      },
    );
    expect(postSpzooRes.status).toBe(200);

    const ledgerOnBAfterA = LedgerViewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    expect(ledgerOnBAfterA.journalEntries.length).toBe(initialLedgerB.journalEntries.length + 1);
    expect(
      ledgerOnBAfterA.journalEntries.some((je) => je.documentNumber === spzooDocNum),
    ).toBe(true);
  });

  it('ADV-79-02: mutacja wstrzymana przed COMMIT nie ujawnia niezatwierdzonego stanu na żadnej instancji, a po wycofaniu (ROLLBACK) nie pozostawia śladu w RAM ani PostgreSQL', async () => {
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

    const serviceA = appA.get<PostgresBackedWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);
    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // Wstępny odczyt na obu instancjach
    const beforeDocsA = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersA },
        )
      ).json(),
    );

    let notifyEnteredHook!: () => void;
    const enteredHookPromise = new Promise<void>((resolve) => {
      notifyEnteredHook = resolve;
    });
    let releaseAndAbortHook!: (err: Error) => void;
    const waitForReleasePromise = new Promise<void>((_resolve, reject) => {
      releaseAndAbortHook = reject;
    });

    serviceA.beforeCommitHook = async (info) => {
      if (info.action === 'write' && info.actionKind === 'createDocument') {
        notifyEnteredHook();
        await waitForReleasePromise;
      }
    };

    const rolledBackDocNumber = 'FV/ADV-79/PAUSED-ROLLBACK/2026/03/99';
    let writeDonePromise: Promise<Response> | undefined;
    try {
      writeDonePromise = fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
        {
          method: 'POST',
          headers: headersA,
          body: JSON.stringify({
            documentNumber: rolledBackDocNumber,
            direction: 'purchase',
            issueDate: '2026-03-30',
            dueDate: '2026-04-13',
            counterpartyName: 'Kontrahent Wycofany Przed Commit Sp. z o.o.',
            counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
            suggestedCategory: 'uslugi_obce',
            lines: [
              {
                description: 'Pozycja z transakcji wstrzymanej przed COMMIT',
                netGrosze: 55_000,
                vatRate: '23',
              },
            ],
          }),
        },
      );

      // Czekamy aż transakcja na Instancji A wykona INSERT w tx i zatrzyma się przed COMMIT (trzymając FOR UPDATE na legal_entity)
      await enteredHookPromise;

      // 1. Bezpośredni odczyt MVCC w PostgreSQL potwierdza brak zatwierdzonego wiersza przed COMMIT
      const uncommittedDbRows = await owner!.client<{ id: string }[]>`
        SELECT id
        FROM ${owner!.client(dataSchema)}.accounting_document
        WHERE tenant_id = ${TENANT_1_ID}::uuid
          AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}::uuid
          AND document_number = ${rolledBackDocNumber}
      `;
      expect(uncommittedDbRows).toHaveLength(0);

      // 2. Współdzielona pamięć RAM obu instancji nie zawiera niezatwierdzonego dokumentu przed COMMIT
      expect(
        serviceA.store
          .getCompany(TENANT_1_ID as never, COMPANY_JDG_KPIR_ID as never)
          ?.documents.some((d) => d.document.documentNumber === rolledBackDocNumber) ?? false,
      ).toBe(false);

      // 3. Równoległe odczyty HTTP uruchomione na Instancji A i Instancji B w trakcie wstrzymanego zapisu
      // czekają na zwolnienie blokady FOR UPDATE na legal_entity i po ROLLBACK zwracają czysty stan sprzed mutacji
      let midReadAResolvedWhilePaused = false;
      let midReadBResolvedWhilePaused = false;
      const midDocsAPromise = fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
        { headers: headersA },
      ).then(async (res) => {
        midReadAResolvedWhilePaused = true;
        return DocumentsListResponseSchema.parse(await res.json());
      });
      const midDocsBPromise = fetch(
        `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
        { headers: headersB },
      ).then(async (res) => {
        midReadBResolvedWhilePaused = true;
        return DocumentsListResponseSchema.parse(await res.json());
      });

      await new Promise((resolve) => setTimeout(resolve, 120));
      expect(midReadAResolvedWhilePaused).toBe(false);
      expect(midReadBResolvedWhilePaused).toBe(false);

      // Przerywamy transakcję przed COMMIT, wymuszając ROLLBACK
      releaseAndAbortHook(
        new AccountingWorkspaceConflictError(
          'simulated_pre_commit_abort',
          'Wymuszone wycofanie transakcji przed COMMIT w teście adversarial.',
        ),
      );

      const [writeRes, midDocsA, midDocsB] = await Promise.all([
        writeDonePromise,
        midDocsAPromise,
        midDocsBPromise,
      ]);
      expect(writeRes.status).toBe(409);
      expect(
        midDocsA.documents.some((d) => d.document.documentNumber === rolledBackDocNumber),
      ).toBe(false);
      expect(
        midDocsB.documents.some((d) => d.document.documentNumber === rolledBackDocNumber),
      ).toBe(false);
      expect(midDocsA.documents).toHaveLength(beforeDocsA.documents.length);
      expect(midDocsB.documents).toHaveLength(beforeDocsA.documents.length);
    } finally {
      serviceA.beforeCommitHook = undefined;
    }

    // Po ROLLBACK dokument nie istnieje w PostgreSQL ani na żadnej instancji API
    const dbRows = await owner!.client<{ id: string }[]>`
      SELECT id
      FROM ${owner!.client(dataSchema)}.accounting_document
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}::uuid
        AND document_number = ${rolledBackDocNumber}
    `;
    expect(dbRows).toHaveLength(0);

    const afterDocsA = DocumentsListResponseSchema.parse(
      await (
        await fetch(
          `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
          { headers: headersA },
        )
      ).json(),
    );
    expect(
      afterDocsA.documents.some((d) => d.document.documentNumber === rolledBackDocNumber),
    ).toBe(false);

    // Ślad audytowy security_decision_event odnotował allow/rolled_back
    const rolledBackAudits = await owner!.client<{ decision: string; outcome: string }[]>`
      SELECT decision, outcome
      FROM ${owner!.client(dataSchema)}.security_decision_event
      WHERE tenant_id = ${TENANT_1_ID}
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}
        AND decision = 'allow'
        AND outcome = 'rolled_back'
    `;
    expect(rolledBackAudits.length).toBeGreaterThanOrEqual(1);
  });

  it('ADV-79-03: równoczesne zapisy z dwóch instancji API są serializowane per firma (brak podwójnego księgowania dokumentu i brak kolizji Lp. w KPiR)', async () => {
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

    // (a) Równoczesne approve-and-post tego samego dokumentu na Instancji A i Instancji B
    const contestedDocNum = 'FV/ADV-79/CONCURRENT-POST/2026/03/01';
    const createRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          documentNumber: contestedDocNum,
          direction: 'purchase',
          issueDate: '2026-03-30',
          dueDate: '2026-04-13',
          counterpartyName: 'Kontrahent Wyścigu Księgowania Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
          suggestedCategory: 'uslugi_obce',
          lines: [
            {
              description: 'Faktura testująca równoczesne approve-and-post',
              netGrosze: 150_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const draftDoc = CompanyDocumentItemSchema.parse(await createRes.json());

    const [postResA, postResB] = await Promise.all([
      fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${draftDoc.documentId}/approve-and-post`,
        {
          method: 'POST',
          headers: headersA,
          body: JSON.stringify({}),
        },
      ),
      fetch(
        `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${draftDoc.documentId}/approve-and-post`,
        {
          method: 'POST',
          headers: headersB,
          body: JSON.stringify({}),
        },
      ),
    ]);

    const postStatuses = [postResA.status, postResB.status].sort((a, b) => a - b);
    expect(postStatuses).toEqual([200, 409]);

    const kpirRowsForDoc = await owner!.client<{ id: string; lp: number }[]>`
      SELECT id, lp
      FROM ${owner!.client(dataSchema)}.kpir_entry
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}::uuid
        AND document_number = ${contestedDocNum}
    `;
    expect(kpirRowsForDoc).toHaveLength(1);

    // (b) Dwa równoczesne ręczne wpisy KPiR na Instancji A i Instancji B otrzymują kolejne, unikalne Lp.
    const manualDocA = 'DW/ADV-79/CONCURRENT-KPIR-A';
    const manualDocB = 'DW/ADV-79/CONCURRENT-KPIR-B';
    const [manualResA, manualResB] = await Promise.all([
      fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          eventDate: '2026-03-30',
          documentNumber: manualDocA,
          counterpartyName: 'Dowód Wewnętrzny A',
          counterpartyAddress: 'Warszawa',
          eventDescription: 'Równoczesny wpis KPiR z Instancji A',
          netGrosze: 10_000,
          entryKind: 'other_expenses_100_col13',
        }),
      }),
      fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`, {
        method: 'POST',
        headers: headersB,
        body: JSON.stringify({
          eventDate: '2026-03-30',
          documentNumber: manualDocB,
          counterpartyName: 'Dowód Wewnętrzny B',
          counterpartyAddress: 'Kraków',
          eventDescription: 'Równoczesny wpis KPiR z Instancji B',
          netGrosze: 20_000,
          entryKind: 'other_expenses_100_col13',
        }),
      }),
    ]);

    expect(manualResA.status).toBe(201);
    expect(manualResB.status).toBe(201);
    const entryA = KpirEntrySchema.parse(await manualResA.json());
    const entryB = KpirEntrySchema.parse(await manualResB.json());
    expect(entryA.ordinalNumber).not.toBe(entryB.ordinalNumber);
    expect(Math.abs(entryA.ordinalNumber - entryB.ordinalNumber)).toBe(1);
  });

  it('ADV-79-04: trwały Idempotency-Key zapewnia idempotentny replay między instancjami, 409 przy zmianie ładunku, odzyskanie po utracie potwierdzenia COMMIT (503 -> 201) oraz 403 po cofnięciu uprawnień', async () => {
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

    const serviceA = appA.get<PostgresBackedWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);
    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // 1. Idempotentne utworzenie dokumentu na Instancji A i powtórzenie na Instancji B
    const idemKeyDoc = 'idem-adv-79-doc-replay-01';
    const docPayload = {
      documentNumber: 'FV/ADV-79/IDEM/2026/03/01',
      direction: 'purchase',
      issueDate: '2026-03-31',
      dueDate: '2026-04-14',
      counterpartyName: 'Kontrahent Idempotentny Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
      suggestedCategory: 'uslugi_obce',
      lines: [
        {
          description: 'Usługa z kluczem Idempotency-Key',
          netGrosze: 77_000,
          vatRate: '23',
        },
      ],
    };

    const firstRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: { ...headersA, 'idempotency-key': idemKeyDoc },
        body: JSON.stringify(docPayload),
      },
    );
    expect(firstRes.status).toBe(201);
    const firstDoc = CompanyDocumentItemSchema.parse(await firstRes.json());

    const replayOnBRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: { ...headersB, 'idempotency-key': idemKeyDoc },
        body: JSON.stringify(docPayload),
      },
    );
    expect(replayOnBRes.status).toBe(201);
    const replayedDoc = CompanyDocumentItemSchema.parse(await replayOnBRes.json());
    expect(replayedDoc.documentId).toBe(firstDoc.documentId);

    // 2. Ten sam Idempotency-Key z innym ładunkiem -> 409 Conflict (idempotency_payload_mismatch)
    const conflictRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: { ...headersB, 'idempotency-key': idemKeyDoc },
        body: JSON.stringify({
          ...docPayload,
          lines: [
            {
              description: 'Zmodyfikowana kwota przy tym samym Idempotency-Key',
              netGrosze: 999_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as { reasonCode?: string };
    expect(conflictBody.reasonCode).toBe('idempotency_payload_mismatch');

    // 3. Symulacja utraty potwierdzenia po COMMIT (TransactionOutcomeUnknownError -> 503), a następnie bezpieczne ponowienie z tym samym Idempotency-Key
    const lostCommitKey = 'idem-adv-79-lost-commit-01';
    const lostCommitDocNum = 'DW/ADV-79/LOST-COMMIT/01';
    const lostCommitPayload = {
      eventDate: '2026-03-31',
      documentNumber: lostCommitDocNum,
      counterpartyName: 'Dowód Po Utracie Potwierdzenia Commit',
      counterpartyAddress: 'Gdańsk',
      eventDescription: 'Wpis zatwierdzony w DB przed utratą potwierdzenia COMMIT',
      netGrosze: 33_300,
      entryKind: 'other_expenses_100_col13',
    };

    let faultInjected = false;
    serviceA.afterDbCommitFaultHook = async (info) => {
      if (!faultInjected && info.action === 'write' && info.actionKind === 'createKpirManualEntry') {
        faultInjected = true;
        throw new TransactionOutcomeUnknownError(new Error('simulated_lost_commit_ack'));
      }
    };

    try {
      const unknownOutcomeRes = await fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
        {
          method: 'POST',
          headers: { ...headersA, 'idempotency-key': lostCommitKey },
          body: JSON.stringify(lostCommitPayload),
        },
      );
      expect(unknownOutcomeRes.status).toBe(503);
      const unknownBody = (await unknownOutcomeRes.json()) as { reasonCode?: string };
      expect(unknownBody.reasonCode).toBe('transaction_outcome_unknown');
    } finally {
      serviceA.afterDbCommitFaultHook = undefined;
    }

    // Ponowienie żądania z tym samym Idempotency-Key na Instancji B odzyskuje wynik z trwałego receiptu bez duplikacji wpisu KPiR
    const retryAfterLostCommitRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: { ...headersB, 'idempotency-key': lostCommitKey },
        body: JSON.stringify(lostCommitPayload),
      },
    );
    expect(retryAfterLostCommitRes.status).toBe(201);
    const recoveredEntry = KpirEntrySchema.parse(await retryAfterLostCommitRes.json());
    expect(recoveredEntry.documentNumber).toBe(lostCommitDocNum);

    const kpirRowsAfterRetry = await owner!.client<{ id: string }[]>`
      SELECT id
      FROM ${owner!.client(dataSchema)}.kpir_entry
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${COMPANY_JDG_KPIR_ID}::uuid
        AND document_number = ${lostCommitDocNum}
    `;
    expect(kpirRowsAfterRetry).toHaveLength(1);

    // 4. Cofnięcie uprawnień (revoke) natychmiast blokuje ponowne użycie Idempotency-Key (autoryzacja przed odczytem receiptu)
    const grantRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/grants`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          targetUserId: DEMO_USER_MARTA_ID,
          action: 'write',
        }),
      },
    );
    expect(grantRes.status).toBe(201);
    const granted = AccessMutationResponseSchema.parse(await grantRes.json());

    const headersMartaB = await issuePersonaHeaders(urlB, 'marta-ksiegowa');
    const martaIdemKey = 'idem-adv-79-marta-write-01';
    const martaKpirPayload = {
      eventDate: '2026-03-31',
      documentNumber: 'DW/ADV-79/MARTA/01',
      counterpartyName: 'Wpis Marty Przed Cofnięciem Grantu',
      counterpartyAddress: 'Poznań',
      eventDescription: 'Autoryzowany zapis Marty',
      netGrosze: 12_000,
      entryKind: 'other_expenses_100_col13',
    };

    const martaWriteRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: { ...headersMartaB, 'idempotency-key': martaIdemKey },
        body: JSON.stringify(martaKpirPayload),
      },
    );
    expect(martaWriteRes.status).toBe(201);

    // Właściciel cofa grant zapisu dla Marty na Instancji A
    const revokeRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/grants/revoke`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          grantId: granted.receipt.grantId,
          targetUserId: DEMO_USER_MARTA_ID,
        }),
      },
    );
    expect(revokeRes.status).toBe(200);

    // Powtórzenie żądania z tym samym Idempotency-Key przez Martę na Instancji B musi zostać odrzucone 403 Forbidden
    const martaReplayAfterRevokeRes = await fetch(
      `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir`,
      {
        method: 'POST',
        headers: { ...headersMartaB, 'idempotency-key': martaIdemKey },
        body: JSON.stringify(martaKpirPayload),
      },
    );
    expect(martaReplayAfterRevokeRes.status).toBe(403);
  });

  it('ADV-79-05: wielozapytaniowe odczyty hydracji (hydrateSingleCompanyFromScope) pod READ COMMITTED zachowują pełną spójność międzytabelową podczas współbieżnego księgowania (FOR SHARE vs FOR UPDATE na legal_entity)', async () => {
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

    const serviceA = appA.get<PostgresBackedWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);
    const serviceB = appB.get<PostgresBackedWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);

    // (a) Dwa równoległe wielozapytaniowe odczyty (action='read') zakładają kompatybilne blokady FOR SHARE na legal_entity
    // i nie blokują się wzajemnie (oba jednocześnie docierają do midReadHydrationHook).
    let concurrentReadersInMidHydration = 0;
    let resolveBothReadersArrived!: () => void;
    const bothReadersArrivedPromise = new Promise<void>((resolve) => {
      resolveBothReadersArrived = resolve;
    });
    const onReaderMidHydration = async (info: { readonly legalEntityId: string }) => {
      if (info.legalEntityId === COMPANY_JDG_KPIR_ID) {
        concurrentReadersInMidHydration += 1;
        if (concurrentReadersInMidHydration >= 2) {
          resolveBothReadersArrived();
        }
        await bothReadersArrivedPromise;
      }
    };

    serviceA.midReadHydrationHook = onReaderMidHydration;
    serviceB.midReadHydrationHook = onReaderMidHydration;
    try {
      const [overviewRes1, overviewRes2] = await Promise.all([
        fetch(
          `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/overview?period=2026-03`,
          { headers: headersA },
        ),
        fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/overview?period=2026-03`,
          { headers: headersB },
        ),
      ]);
      expect(overviewRes1.status).toBe(200);
      expect(overviewRes2.status).toBe(200);
      expect(concurrentReadersInMidHydration).toBe(2);
    } finally {
      serviceA.midReadHydrationHook = undefined;
      serviceB.midReadHydrationHook = undefined;
    }

    // (b) Wielozapytaniowy odczyt (hydrateSingleCompanyFromScope na Instancji B) wstrzymany w połowie (po odczycie accounting_document,
    // a przed odczytem kpir_entry, vat_register_entry i settlement_item) w trakcie współbieżnego approve-and-post na Instancji A.
    const draftDocNum = 'FV/ADV-79/READ-CONSISTENCY/2026/03/01';
    const draftCreateRes = await fetch(
      `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          documentNumber: draftDocNum,
          direction: 'purchase',
          issueDate: '2026-03-30',
          dueDate: '2026-04-13',
          counterpartyName: 'Kontrahent Spójności Wielozapytaniowego Odczytu Sp. z o.o.',
          counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura,
          suggestedCategory: 'uslugi_obce',
          lines: [
            {
              description:
                'Usługa chmurowa testująca brak rozjazdu międzytabelowego pod READ COMMITTED',
              netGrosze: 200_000,
              vatRate: '23',
            },
          ],
        }),
      },
    );
    expect(draftCreateRes.status).toBe(201);
    const createdDraft = CompanyDocumentItemSchema.parse(await draftCreateRes.json());

    const baselineOverview = CompanyOverviewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/overview?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );

    let notifyReaderAtMidpoint!: () => void;
    const readerAtMidpointPromise = new Promise<void>((resolve) => {
      notifyReaderAtMidpoint = resolve;
    });
    let releaseReaderFromMidpoint!: () => void;
    const releaseReaderFromMidpointPromise = new Promise<void>((resolve) => {
      releaseReaderFromMidpoint = resolve;
    });

    let hookTriggered = false;
    serviceB.midReadHydrationHook = async (info) => {
      if (!hookTriggered && info.legalEntityId === COMPANY_JDG_KPIR_ID) {
        hookTriggered = true;
        notifyReaderAtMidpoint();
        await releaseReaderFromMidpointPromise;
      }
    };

    try {
      // 1. Instancja B rozpoczyna wielozapytaniowy odczyt overview i zatrzymuje się po listAccountingDocuments() (widząc jeszcze status='draft')
      const midReadOverviewPromise = fetch(
        `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/overview?period=2026-03`,
        { headers: headersB },
      ).then(async (res) => ({
        status: res.status,
        body: CompanyOverviewResponseSchema.parse(await res.json()),
      }));

      await readerAtMidpointPromise;

      // 2. W trakcie gdy Instancja B jest w połowie hydracji (przed listKpirEntries/listVatRegisterEntries/listSettlementItems),
      // Instancja A wysyła approve-and-post dla tego dokumentu. Dzięki blokadzie FOR SHARE (read) vs FOR UPDATE (write)
      // na legal_entity, zapis na Instancji A NIE MOŻE zatwierdzić zmian w połowie odczytu Instancji B.
      let writerCommittedWhileReaderInFlight = false;
      const postPromise = fetch(
        `${urlA}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${createdDraft.documentId}/approve-and-post`,
        {
          method: 'POST',
          headers: headersA,
          body: JSON.stringify({}),
        },
      ).then(async (res) => {
        writerCommittedWhileReaderInFlight = true;
        return {
          status: res.status,
          body: (await res.json()) as { document?: { status?: string } },
        };
      });

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(writerCommittedWhileReaderInFlight).toBe(false);

      // 3. Zwalniamy wstrzymany odczyt na Instancji B — musi zwrócić 100% spójny snapshot sprzed księgowania
      // (brak rozjazdu, w którym dokument jest 'draft' w pendingApprovals, a expensesKupGrosze/unpaidPayablesGrosze/unpaidInvoices zawierają już zaksięgowane kwoty!).
      releaseReaderFromMidpoint();

      const [midReadResult, postResult] = await Promise.all([midReadOverviewPromise, postPromise]);
      expect(midReadResult.status).toBe(200);
      expect(postResult.status).toBe(200);
      expect(postResult.body.document?.status).toBe('posted');

      expect(midReadResult.body.pendingApprovals.aiDocumentProposalsCount).toBe(
        baselineOverview.pendingApprovals.aiDocumentProposalsCount,
      );
      expect(midReadResult.body.kpis.expensesKupGrosze).toBe(
        baselineOverview.kpis.expensesKupGrosze,
      );
      expect(midReadResult.body.kpis.unpaidPayablesGrosze).toBe(
        baselineOverview.kpis.unpaidPayablesGrosze,
      );
      expect(
        midReadResult.body.unpaidInvoices.some((inv) => inv.documentNumber === draftDocNum),
      ).toBe(false);
    } finally {
      serviceB.midReadHydrationHook = undefined;
    }

    // 4. Kolejny odczyt na Instancji B po zakończeniu zapisu widzi kompletny, spójny stan po COMMIT we wszystkich tabelach
    const afterPostOverview = CompanyOverviewResponseSchema.parse(
      await (
        await fetch(
          `${urlB}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/overview?period=2026-03`,
          { headers: headersB },
        )
      ).json(),
    );
    expect(afterPostOverview.pendingApprovals.aiDocumentProposalsCount).toBe(
      baselineOverview.pendingApprovals.aiDocumentProposalsCount - 1,
    );
    expect(afterPostOverview.kpis.expensesKupGrosze).toBe(
      baselineOverview.kpis.expensesKupGrosze + 200_000,
    );
    expect(afterPostOverview.kpis.unpaidPayablesGrosze).toBe(
      baselineOverview.kpis.unpaidPayablesGrosze + 246_000,
    );
    expect(
      afterPostOverview.unpaidInvoices.some((inv) => inv.documentNumber === draftDocNum),
    ).toBe(true);
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

  it('ADV-80-02: awaria w połowie provisioningu firmy (po zapisie legal_entity, grantów i company_tax_settings) wycofuje całą transakcję bez sierot w DB i w pamięci RAM', async () => {
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

    const serviceA = appA.get<PostgresBackedWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);
    const headersA = await issuePersonaHeaders(urlA, 'jan-testowy');
    const headersB = await issuePersonaHeaders(urlB, 'jan-testowy');

    // Poprawny modulo-11 NIP testowy (7740001454)
    const rollbackNip = '7740001454';
    let abortedLegalEntityId: string | null = null;

    serviceA.beforeProvisionCommitHook = async (info) => {
      if (info.nip === rollbackNip) {
        abortedLegalEntityId = info.legalEntityId;
        throw new Error('simulated_halfway_provisioning_failure_adv_80_02');
      }
    };

    try {
      const failedRes = await fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies`, {
        method: 'POST',
        headers: headersA,
        body: JSON.stringify({
          displayName: 'Firma Wycofana W Połowie Provisioningu',
          nip: rollbackNip,
          legalForm: 'jdg',
          taxRegime: 'ryczalt',
          vatStatus: 'zwolniony',
          zusStage: 'preferencyjny_zus',
        }),
      });
      expect(failedRes.status).toBe(500);
      expect(abortedLegalEntityId).not.toBeNull();
    } finally {
      serviceA.beforeProvisionCommitHook = undefined;
    }

    // 1. W bazie PostgreSQL nie pozostał żaden ślad po wycofanej firmie
    const taxRowsAfterAbort = await owner!.client<{ legal_entity_id: string }[]>`
      SELECT legal_entity_id
      FROM ${owner!.client(dataSchema)}.company_tax_settings
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND nip = ${rollbackNip}
    `;
    expect(taxRowsAfterAbort).toHaveLength(0);

    const profileRowsAfterAbort = await owner!.client<{ legal_entity_id: string }[]>`
      SELECT legal_entity_id
      FROM ${owner!.client(dataSchema)}.entity_profile_version
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND profile_json->>'nip' = ${rollbackNip}
    `;
    expect(profileRowsAfterAbort).toHaveLength(0);

    const entityRowsAfterAbort = await owner!.client<{ id: string }[]>`
      SELECT id
      FROM ${owner!.client(dataSchema)}.legal_entity
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND id = ${abortedLegalEntityId!}::uuid
    `;
    expect(entityRowsAfterAbort).toHaveLength(0);

    const grantRowsAfterAbort = await owner!.client<{ grant_id: string }[]>`
      SELECT grant_id
      FROM ${owner!.client(dataSchema)}.company_access_grant
      WHERE tenant_id = ${TENANT_1_ID}::uuid
        AND legal_entity_id = ${abortedLegalEntityId!}::uuid
    `;
    expect(grantRowsAfterAbort).toHaveLength(0);

    // 2. Ani Instancja A (autor wycofanej transakcji), ani Instancja B nie widzą wycofanej firmy
    const listA = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies`, { headers: headersA })
      ).json(),
    );
    const listB = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies`, { headers: headersB })
      ).json(),
    );
    expect(listA.companies.filter((c) => c.nip === rollbackNip)).toHaveLength(0);
    expect(listB.companies.filter((c) => c.nip === rollbackNip)).toHaveLength(0);

    // 3. Ponowienie po usunięciu awarii tworzy kompletną firmę z tym samym NIP bez fałszywego 409
    const retryRes = await fetch(`${urlB}/api/v1/tenants/${TENANT_1_ID}/companies`, {
      method: 'POST',
      headers: headersB,
      body: JSON.stringify({
        displayName: 'Firma Utworzona Po Wycofaniu Provisioningu',
        nip: rollbackNip,
        legalForm: 'jdg',
        taxRegime: 'ryczalt',
        vatStatus: 'zwolniony',
        zusStage: 'preferencyjny_zus',
      }),
    });
    expect(retryRes.status).toBe(201);

    const listAAfterRetry = GetMyCompaniesResponseSchema.parse(
      await (
        await fetch(`${urlA}/api/v1/tenants/${TENANT_1_ID}/companies`, { headers: headersA })
      ).json(),
    );
    expect(listAAfterRetry.companies.filter((c) => c.nip === rollbackNip)).toHaveLength(1);
  });
});
