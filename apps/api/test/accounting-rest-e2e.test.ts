import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_SPZOO_ID,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
} from '@pap/application';
import {
  CalendarViewResponseSchema,
  CompanyAuditListResponseSchema,
  CompanyDocumentItemSchema,
  DispatchDueNotificationsResponseSchema,
  FinanceViewResponseSchema,
  GetAcademyCourseResponseSchema,
  GetMyCompaniesResponseSchema,
  ImportBankStatementResponseSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  LedgerViewResponseSchema,
  ListLegalRulesResponseSchema,
  SandboxMailboxMessageSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import { AppModule } from '../src/app.module.js';

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
      <Nazwa>Jan Testowy Doradztwo IT</Nazwa>
    </DaneIdentyfikacyjne>
  </Podmiot2>
  <NrKSeF>5250004007-20260319-A1B2C3-D4E5F6-11</NrKSeF>
  <Fa>
    <P_1>2026-03-19</P_1>
    <P_2>FV-KSEF/2026/03/901</P_2>
    <P_6>2026-03-19</P_6>
    <Platnosc>
      <TerminPlatnosci><Termin>2026-04-02</Termin></TerminPlatnosci>
    </Platnosc>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Klaster bazodanowy PostgreSQL 18 dla systemu księgowego</P_7>
      <P_8A>usł.</P_8A>
      <P_8B>1</P_8B>
      <P_11>2000.00</P_11>
      <P_11Vat>460.00</P_11Vat>
      <P_12>23</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`;

describe('Complete Polish accounting REST E2E workflow', () => {
  let app: NestFastifyApplication;
  let baseUrl: string;
  let janHeaders: Record<string, string>;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({ PAP_SANDBOX_AUTH_ENABLED: 'true' }),
      new FastifyAdapter({ logger: false }),
      { logger: false },
    );
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind ephemeral TCP port');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    const tokenRes = await fetch(`${baseUrl}/api/v1/oidc/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ personaId: 'jan-testowy', period: '2026-03' }),
    });
    expect(tokenRes.status).toBe(200);
    const { accessToken } = IssueSandboxTokenResponseSchema.parse(await tokenRes.json());
    janHeaders = {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports KSeF FA(3) XML (blocking SHA-256 duplicates), posts after human approval into 19-col KPiR & JPK_V7M, reconciles bank CSV, and dispatches fail-closed sandbox MIME emails', async () => {
    // 1. Directory of accessible companies
    const meCompaniesRes = await fetch(`${baseUrl}/api/v1/me/companies`, { headers: janHeaders });
    expect(meCompaniesRes.status).toBe(200);
    const meCompanies = GetMyCompaniesResponseSchema.parse(await meCompaniesRes.json());
    expect(meCompanies.companies.length).toBeGreaterThanOrEqual(3);

    // 2. Import KSeF FA(3) XML -> AI/OCR draft (needs_verification, NOT posted yet)
    const createDocRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          sourceFormat: 'ksef_xml',
          rawPayload: KSEF_FA3_PURCHASE_XML,
          direction: 'purchase',
          suggestedCategory: 'uslugi_obce',
        }),
      },
    );
    expect(createDocRes.status).toBe(201);
    const importedDoc = CompanyDocumentItemSchema.parse(await createDocRes.json());
    expect(importedDoc.status).toBe('needs_verification');
    expect(importedDoc.postingResult).toBeNull();
    expect(importedDoc.document.documentNumber).toBe('FV-KSEF/2026/03/901');

    // 3. Duplicate SHA-256 import rejected with 409 Conflict
    const duplicateDocRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          sourceFormat: 'ksef_xml',
          rawPayload: KSEF_FA3_PURCHASE_XML,
          direction: 'purchase',
        }),
      },
    );
    expect(duplicateDocRes.status).toBe(409);
    const duplicateBody = (await duplicateDocRes.json()) as { reasonCode: string };
    expect(duplicateBody.reasonCode).toContain('duplicate');

    // 4. Human approval & posting -> KPiR + VAT register + open settlement
    const approveRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${importedDoc.documentId}/approve-and-post`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          suggestedCategory: 'uslugi_obce',
          vatDeductionMode: 'full_100',
          kpirQualification: 'other_expenses_100_col13',
        }),
      },
    );
    expect(approveRes.status).toBe(200);
    const postedDoc = CompanyDocumentItemSchema.parse(await approveRes.json());
    expect(postedDoc.status).toBe('posted');
    expect(postedDoc.postingResult?.kpirEntryId).toBeTruthy();
    expect(postedDoc.postingResult?.vatEntryIds.length).toBeGreaterThanOrEqual(1);
    expect(postedDoc.postingResult?.settlementId).toBeTruthy();

    // 5. Verify 19-column 2026 KSeF KPiR view + red storno + ZUS calculation
    const kpirRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-03`,
      { headers: janHeaders },
    );
    expect(kpirRes.status).toBe(200);
    const kpirView = KpirViewResponseSchema.parse(await kpirRes.json());
    expect(kpirView.regulationVersion).toBe('pkpir_2026_ksef');
    expect(kpirView.columns).toHaveLength(19);
    const postedKpirEntry = kpirView.entries.find(
      (e) => e.documentNumber === 'FV-KSEF/2026/03/901',
    );
    expect(postedKpirEntry).toBeDefined();
    expect(postedKpirEntry?.col13OtherExpensesGrosze).toBe(200_000);

    const zusRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/zus?period=2026-03`,
      { headers: janHeaders },
    );
    expect(zusRes.status).toBe(200);

    // 6. Verify VAT registers & JPK_V7M(3) preview
    const vatRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat?period=2026-03`,
      { headers: janHeaders },
    );
    expect(vatRes.status).toBe(200);
    const vatView = VatViewResponseSchema.parse(await vatRes.json());
    expect(vatView.purchaseEntries.some((e) => e.documentNumber === 'FV-KSEF/2026/03/901')).toBe(
      true,
    );
    expect(vatView.jpkV7m?.schemaCode).toBe('JPK_V7M(3)');

    // 7. Import Polish bank statement CSV & reconcile the newly posted payable
    const bankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      `2026-03-26;2026-03-26;Chmura Obliczeniowa Polska Test Sp. z o.o.;PL27114020040000300201355387;Przelew za usługi serwerowe marzec;-2460,00;PLN;TX-E2E-901`,
    ].join('\n');

    const bankImportRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/finance/bank-import`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ format: 'csv', rawContent: bankCsv }),
      },
    );
    expect(bankImportRes.status).toBe(200);
    const importedBank = ImportBankStatementResponseSchema.parse(await bankImportRes.json());
    expect(importedBank.importedTransactionsCount).toBe(1);
    const importedTx = importedBank.finance.bankTransactions.find(
      (tx) => tx.rawReference?.includes('TX-E2E-901') || tx.title.includes('serwerowe'),
    );
    expect(importedTx).toBeDefined();

    const settlementId = postedDoc.postingResult!.settlementId!;
    const reconcileRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/finance/reconcile`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          transactionId: importedTx!.transactionId,
          settlementId,
          amountGrosze: 246_000,
        }),
      },
    );
    expect(reconcileRes.status).toBe(200);
    const reconciledFinance = FinanceViewResponseSchema.parse(await reconcileRes.json());
    const settledItem = reconciledFinance.settlements.find((s) => s.settlementId === settlementId);
    expect(settledItem?.status).toBe('paid');
    expect(settledItem?.remainingGrosze).toBe(0);

    // 8. Controlled Sandbox Mailbox: deliver MIME to .example, block external @gmail.com (403)
    const dispatchFirst = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/notifications/dispatch-due`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ period: '2026-03', evaluationDate: '2026-04-18' }),
      },
    );
    expect(dispatchFirst.status).toBe(200);
    const firstOutbox = DispatchDueNotificationsResponseSchema.parse(await dispatchFirst.json());
    expect(firstOutbox.sentCount).toBeGreaterThanOrEqual(1);

    const dispatchSecond = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/notifications/dispatch-due`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({ period: '2026-03', evaluationDate: '2026-04-18' }),
      },
    );
    expect(dispatchSecond.status).toBe(200);
    const secondOutbox = DispatchDueNotificationsResponseSchema.parse(await dispatchSecond.json());
    expect(secondOutbox.enqueuedCount).toBe(0);
    expect(secondOutbox.skippedDuplicatesCount).toBeGreaterThanOrEqual(1);

    const testMailRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/notifications/send-test`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          toAddress: 'ksiegowosc@firma-testowa.example',
          stage: 'urgent_2d',
          period: '2026-03',
        }),
      },
    );
    expect(testMailRes.status).toBe(200);
    const deliveredMime = SandboxMailboxMessageSchema.parse(await testMailRes.json());
    expect(deliveredMime.rawRfc822).toContain('MIME-Version: 1.0');
    expect(deliveredMime.rawRfc822).toContain('Message-ID:');
    expect(deliveredMime.subject).not.toContain('5260001009');

    const blockedExternalRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/notifications/send-test`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          toAddress: 'jan.rzeczywisty@gmail.com',
          stage: 'urgent_2d',
          period: '2026-03',
        }),
      },
    );
    expect(blockedExternalRes.status).toBe(403);
    const blockedBody = (await blockedExternalRes.json()) as { reasonCode: string };
    expect(blockedBody.reasonCode).toBe('blocked_recipient_policy');
  });

  it('supports Sp. z o.o. double-entry ledger, tax calendar, legal rules explain, academy grading, and audit log', async () => {
    const ledgerGet = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger?period=2026-03`,
      { headers: janHeaders },
    );
    expect(ledgerGet.status).toBe(200);
    LedgerViewResponseSchema.parse(await ledgerGet.json());

    const imbalancedPost = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          bookingDate: '2026-03-22',
          documentDate: '2026-03-22',
          documentNumber: 'PK/2026/03/99',
          description: 'Niezbilansowany dekret testowy',
          lines: [
            { accountCode: '402', side: 'Wn', amountGrosze: 10_000, description: 'Koszt' },
            { accountCode: '130', side: 'Ma', amountGrosze: 9_000, description: 'Bank' },
          ],
        }),
      },
    );
    expect(imbalancedPost.status).toBe(422);

    const balancedPost = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger`,
      {
        method: 'POST',
        headers: janHeaders,
        body: JSON.stringify({
          bookingDate: '2026-03-22',
          documentDate: '2026-03-22',
          documentNumber: 'PK/2026/03/100',
          description: 'Zbilansowany dekret testowy opłaty bankowej',
          lines: [
            { accountCode: '402', side: 'Wn', amountGrosze: 10_000, description: 'Prowizja' },
            { accountCode: '130', side: 'Ma', amountGrosze: 10_000, description: 'Rachunek' },
          ],
        }),
      },
    );
    expect(balancedPost.status).toBe(201);

    const calendarRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/calendar?year=2026&month=3`,
      { headers: janHeaders },
    );
    expect(calendarRes.status).toBe(200);
    const cal = CalendarViewResponseSchema.parse(await calendarRes.json());
    expect(cal.obligations.length).toBeGreaterThanOrEqual(2);

    const toggleRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/calendar/obligations/${cal.obligations[0]!.obligationId}/toggle-paid?period=2026-03`,
      { method: 'POST', headers: janHeaders, body: JSON.stringify({}) },
    );
    expect(toggleRes.status).toBe(200);

    const rulesRes = await fetch(`${baseUrl}/api/v1/legal-rules`);
    expect(rulesRes.status).toBe(200);
    const rules = ListLegalRulesResponseSchema.parse(await rulesRes.json());
    expect(rules.rules.length).toBeGreaterThan(5);

    const academyRes = await fetch(`${baseUrl}/api/v1/academy`);
    expect(academyRes.status).toBe(200);
    const academy = GetAcademyCourseResponseSchema.parse(await academyRes.json());
    expect(academy.course.modules).toHaveLength(12);
    const firstLesson = academy.course.modules[0]!.lessons[0]!;
    const answers: Record<string, number> = {};
    for (const q of firstLesson.quiz) {
      answers[q.id] = q.correctOptionIndex;
    }
    const gradeRes = await fetch(`${baseUrl}/api/v1/academy/lessons/${firstLesson.slug}/grade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    expect(gradeRes.status).toBe(200);

    const auditRes = await fetch(
      `${baseUrl}/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/audit-log`,
      { headers: janHeaders },
    );
    expect(auditRes.status).toBe(200);
    const audit = CompanyAuditListResponseSchema.parse(await auditRes.json());
    expect(audit.events.length).toBeGreaterThan(0);
  });
});
