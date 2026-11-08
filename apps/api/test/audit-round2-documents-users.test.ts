import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_TENANT_2_ID,
  DEMO_DEFAULT_PERIOD,
  DEMO_USER_PIOTR_ID,
  InMemoryAccountingWorkspaceStore,
  SYNTHETIC_COUNTERPARTY_NIPS,
  TENANT_1_ID,
  TENANT_2_ID,
  type AccountingWorkspaceService,
} from '@pap/application';
import {
  CompanyAuditListResponseSchema,
  CompanyDocumentItemSchema,
  IssueSandboxTokenResponseSchema,
  KpirViewResponseSchema,
  VatViewResponseSchema,
} from '@pap/contracts';
import { userId as parseUserId } from '@pap/domain';
import { AppModule } from '../src/app.module.js';
import { ACCOUNTING_WORKSPACE_SERVICE } from '../src/runtime/workspace-runtime.js';

const BASE_PURCHASE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
  '  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek>',
  `  <Podmiot1><DaneIdentyfikacyjne><NIP>${SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura}</NIP><Nazwa>Chmura Pierwotna Sp. z o.o.</Nazwa></DaneIdentyfikacyjne></Podmiot1>`,
  '  <Podmiot2><DaneIdentyfikacyjne><NIP>5250001003</NIP><Nazwa>Pracownia Projektowa Jan Testowy</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
  '  <Fa>',
  '    <NrKSeF>5250004007-20260324-AA99BB88-CC77DD66</NrKSeF>',
  '    <P_1>2026-03-24</P_1>',
  '    <P_2>FV/PIERWOTNA/2026/03/24</P_2>',
  '    <P_6>2026-03-24</P_6>',
  '    <Termin>2026-04-07</Termin>',
  '    <FaWiersz>',
  '      <P_7>Usługa serwerowa przed korektą</P_7>',
  '      <P_8A>szt.</P_8A>',
  '      <P_8B>1</P_8B>',
  '      <P_11>1000.00</P_11>',
  '      <P_12>23</P_12>',
  '    </FaWiersz>',
  '  </Fa>',
  '</Faktura>',
].join('\n');

describe('Audit Round 2 regressions — P1-3 approve-and-post human corrections, P2-1 JSON validation, P2-2 inactive users', () => {
  let app: NestFastifyApplication;
  let workspace: AccountingWorkspaceService;
  let janToken: string;
  let piotrToken: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({ PAP_SANDBOX_AUTH_ENABLED: 'true' }),
      new FastifyAdapter({ logger: false }),
      { logger: false, abortOnError: false },
    );
    await app.init();
    workspace = app.get<AccountingWorkspaceService>(ACCOUNTING_WORKSPACE_SERVICE);

    const fastify = app.getHttpAdapter().getInstance();
    const mint = async (personaId: string): Promise<string> => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/oidc/token',
        payload: { personaId },
      });
      expect(res.statusCode).toBe(200);
      return IssueSandboxTokenResponseSchema.parse(res.json()).accessToken;
    };

    janToken = await mint('jan-testowy');
    piotrToken = await mint('piotr-izolacyjny');
  });

  afterAll(async () => {
    await app.close();
  });

  it('[P1-3] validates body.documentId mismatch (400), rejects invalid human NIP, and applies human corrections (netPln/vatPln/counterpartyName) to posted books & audit', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const companyPath = `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;

    const createRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: BASE_PURCHASE_XML },
    });
    expect(createRes.statusCode).toBe(201);
    const created = CompanyDocumentItemSchema.parse(createRes.json());
    expect(created.document.totalNetGrosze).toBe(100_000);

    // 1. Mismatched body.documentId -> 400 document_id_mismatch
    const mismatchRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents/${created.documentId}/approve-and-post`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { documentId: '00000000-0000-4000-8000-999999999999' },
    });
    expect(mismatchRes.statusCode).toBe(400);
    expect((mismatchRes.json() as { reasonCode?: string }).reasonCode).toBe('document_id_mismatch');

    // 2. Invalid counterpartyNip in human correction -> 400 invalid_nip (not posted!)
    const badNipRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents/${created.documentId}/approve-and-post`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { documentId: created.documentId, counterpartyNip: '1234567890' },
    });
    expect(badNipRes.statusCode).toBe(400);
    expect((badNipRes.json() as { reasonCode?: string }).reasonCode).toBe('invalid_nip');

    // 3. Valid human corrections -> applied to document, KPiR, VAT register, and audit trail
    const approveRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents/${created.documentId}/approve-and-post`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: created.documentId,
        documentNumber: 'FV/KOREKTA-LUDZKA/2026/03/24',
        counterpartyName: 'Skorygowany Dostawca Chmury Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
        issueDate: '2026-03-24',
        netPln: '1500.00',
        vatPln: '345.00',
        expenseQualification: 'other_expenses_100_col13',
        vatDeductionMode: 'full_100',
      },
    });
    expect(approveRes.statusCode).toBe(200);
    const posted = CompanyDocumentItemSchema.parse(approveRes.json());
    expect(posted.status).toBe('posted');
    expect(posted.document.documentNumber).toBe('FV/KOREKTA-LUDZKA/2026/03/24');
    expect(posted.document.counterpartyName).toBe('Skorygowany Dostawca Chmury Sp. z o.o.');
    expect(posted.document.counterpartyNip).toBe(SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu);
    expect(posted.document.totalNetGrosze).toBe(150_000);
    expect(posted.document.totalVatGrosze).toBe(34_500);
    expect(posted.document.totalGrossGrosze).toBe(184_500);

    const kpirView = KpirViewResponseSchema.parse(
      (
        await fastify.inject({
          method: 'GET',
          url: `${companyPath}/kpir?period=${DEMO_DEFAULT_PERIOD}`,
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    const kpirEntry = kpirView.entries.find((e) => e.id === posted.postingResult?.kpirEntryId);
    expect(kpirEntry?.col13OtherExpensesGrosze).toBe(150_000);
    expect(kpirEntry?.counterpartyName).toBe('Skorygowany Dostawca Chmury Sp. z o.o.');

    const vatView = VatViewResponseSchema.parse(
      (
        await fastify.inject({
          method: 'GET',
          url: `${companyPath}/vat?period=${DEMO_DEFAULT_PERIOD}`,
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    const vatEntry = vatView.purchaseEntries.find((v) =>
      posted.postingResult?.vatEntryIds.includes(v.id),
    );
    expect(vatEntry?.netGrosze).toBe(150_000);
    expect(vatEntry?.deductibleVatGrosze).toBe(34_500);

    const auditView = CompanyAuditListResponseSchema.parse(
      (
        await fastify.inject({
          method: 'GET',
          url: `${companyPath}/audit-log`,
          headers: { authorization: `Bearer ${janToken}` },
        })
      ).json(),
    );
    expect(
      auditView.events.some((ev) => ev.reasonCode === 'human_corrected_and_approved_posting'),
    ).toBe(true);
  });

  it('[P2-1] rejects malformed or non-object sourceFormat=json payloads and invalid ISO dates with 400 (never 500)', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const url = `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`;

    const invalidRawPayloads = [
      'null',
      '[]',
      '"just-a-string"',
      '{broken-json',
      JSON.stringify({ issueDate: 'not-a-date', netGrosze: 10000 }),
      JSON.stringify({ issueDate: '2026-02-31', netGrosze: 10000 }),
      JSON.stringify({ issueDate: '2026-03-20', dueDate: '2026-03-01', netGrosze: 10000 }),
      JSON.stringify({ issueDate: '2026-03-20', netGrosze: -500 }),
    ];

    for (const rawPayload of invalidRawPayloads) {
      const res = await fastify.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${janToken}` },
        payload: { sourceFormat: 'json', rawPayload },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(500);
    }
  });

  it('[P2-2] blocks inactive user accounts (active=false) with 403 across /me/companies, tenant routes, and /api/v1/mcp', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const store = workspace.store as InMemoryAccountingWorkspaceStore;
    const piotrRecord = store.getUserById(parseUserId(DEMO_USER_PIOTR_ID));
    expect(piotrRecord?.active).toBe(true);
    if (!piotrRecord) return;

    store.upsertUser({ ...piotrRecord, active: false });
    try {
      for (const url of [
        '/api/v1/me/companies',
        `/api/v1/tenants/${TENANT_2_ID}/companies`,
        `/api/v1/tenants/${TENANT_2_ID}/companies/${COMPANY_TENANT_2_ID}/dashboard`,
      ]) {
        const res = await fastify.inject({
          method: 'GET',
          url,
          headers: { authorization: `Bearer ${piotrToken}` },
        });
        expect(res.statusCode).toBe(403);
        expect((res.json() as { reasonCode?: string }).reasonCode).toBe('inactive_user_account');
      }

      const mcpRes = await fastify.inject({
        method: 'POST',
        url: '/api/v1/mcp',
        headers: {
          host: '127.0.0.1',
          authorization: `Bearer ${piotrToken}`,
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect(mcpRes.statusCode).toBe(403);
    } finally {
      store.upsertUser({ ...piotrRecord, active: true });
    }
  });

  it('[#62, #63, #67] parses multi-rate KSeF FA(3) XML into separate VAT register entries, sets honest verification statuses, and rejects XXE / invalid NIP / mismatched totals with 422', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const companyPath = `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;

    const multiRateXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
      '  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza></Naglowek>',
      `  <Podmiot1><DaneIdentyfikacyjne><NIP>${SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu}</NIP><Nazwa>Wielostawkowy Dostawca Sp. z o.o.</Nazwa></DaneIdentyfikacyjne></Podmiot1>`,
      '  <Podmiot2><DaneIdentyfikacyjne><NIP>5260001009</NIP><Nazwa>Pracownia Projektowa Jan Testowy</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
      '  <Fa>',
      '    <P_1>2026-03-26</P_1>',
      '    <P_2>FV/MULTI-VAT/2026/03/01</P_2>',
      '    <P_6>2026-03-26</P_6>',
      '    <P_13_1>1000.00</P_13_1>',
      '    <P_14_1>230.00</P_14_1>',
      '    <P_13_2>500.00</P_13_2>',
      '    <P_14_2>40.00</P_14_2>',
      '    <P_15>1770.00</P_15>',
      '    <FaWiersz>',
      '      <NrWierszaFa>1</NrWierszaFa>',
      '      <P_7>Usługa wdrożeniowa 23%</P_7>',
      '      <P_11>1000.00</P_11>',
      '      <P_11Vat>230.00</P_11Vat>',
      '      <P_12>23</P_12>',
      '    </FaWiersz>',
      '    <FaWiersz>',
      '      <NrWierszaFa>2</NrWierszaFa>',
      '      <P_7>Dokumentacja szkoleniowa 8%</P_7>',
      '      <P_11>500.00</P_11>',
      '      <P_11Vat>40.00</P_11Vat>',
      '      <P_12>8</P_12>',
      '    </FaWiersz>',
      '  </Fa>',
      '</Faktura>',
    ].join('\n');

    const importRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: multiRateXml },
    });
    expect(importRes.statusCode).toBe(201);
    const imported = CompanyDocumentItemSchema.parse(importRes.json());
    expect(imported.document.lines).toHaveLength(2);
    expect(imported.document.totalNetGrosze).toBe(150_000);
    expect(imported.document.totalVatGrosze).toBe(27_000);
    expect(imported.document.totalGrossGrosze).toBe(177_000);
    expect(imported.aiProposal.verificationSource).toBe('deterministic_parser');
    expect(imported.aiProposal.kasWhiteListStatus).toBe('not_checked');
    expect(imported.aiProposal.gtuReviewStatus).toBe('requires_human_review');

    const postRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents/${imported.documentId}/approve-and-post`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {},
    });
    expect(postRes.statusCode).toBe(200);
    const posted = CompanyDocumentItemSchema.parse(postRes.json());
    expect(posted.postingResult?.vatEntryIds).toHaveLength(2);

    // Negative #62: XXE / DOCTYPE forbidden
    const xxeRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        sourceFormat: 'ksef_xml',
        rawPayload: '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "bar">]><Faktura></Faktura>',
      },
    });
    expect(xxeRes.statusCode).toBe(400);
    expect((xxeRes.json() as { reasonCode?: string }).reasonCode).toBe('ksef_xml_xxe_forbidden');

    // Negative #62: CSV net + VAT != gross
    const badCsvRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        sourceFormat: 'csv',
        rawPayload: [
          'documentNumber;issueDate;counterpartyName;counterpartyNip;netPln;vatPln;grossPln;vatRate',
          `FV/CSV-BAD/1;2026-03-25;Dostawca CSV;${SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura};100.00;23.00;999.00;23`,
        ].join('\n'),
      },
    });
    expect(badCsvRes.statusCode).toBe(422);
    expect((badCsvRes.json() as { reasonCode?: string }).reasonCode).toBe(
      'document_amount_mismatch',
    );
  });

  it('[#58] creates a company with full address/profile fields and rejects duplicate NIP in tenant with 409', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const createRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        displayName: 'Kancelaria Doradcza Ryczałt Test',
        nip: '5213004007',
        legalForm: 'jdg',
        taxRegime: 'ryczalt',
        vatStatus: 'zwolniony',
        zusStage: 'preferencyjny_zus',
        street: 'ul. Nowy Świat',
        buildingNumber: '22',
        unitNumber: '5',
        postalCode: '00-373',
        city: 'Warszawa',
        voivodeship: 'mazowieckie',
        taxOfficeName: 'Trzeci Urząd Skarbowy Warszawa-Śródmieście',
        ryczaltDefaultRate: '12',
        healthContributionTier: 'middle',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const body = createRes.json() as {
      company: { legalEntityId: string; street?: string; postalCode?: string };
      taxProfile: { ryczaltDefaultRate?: string; healthContributionTier?: string };
    };
    expect(body.company.street).toBe('ul. Nowy Świat');
    expect(body.company.postalCode).toBe('00-373');
    expect(body.taxProfile.ryczaltDefaultRate).toBe('12');
    expect(body.taxProfile.healthContributionTier).toBe('middle');

    const dupRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        displayName: 'Duplikat NIP Test',
        nip: '5213004007',
        legalForm: 'jdg',
        taxRegime: 'kpir_skala',
        vatStatus: 'czynny',
      },
    });
    expect(dupRes.statusCode).toBe(409);
    expect((dupRes.json() as { reasonCode?: string }).reasonCode).toBe('duplicate_company_nip');
  });
});
