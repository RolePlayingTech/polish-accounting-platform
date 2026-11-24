import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import {
  CompanyDocumentItemSchema,
  CreateCompanyResponseSchema,
  IssueSandboxTokenResponseSchema,
} from '@pap/contracts';
import {
  ExportJpkResponseSchema,
  GenerateInvoiceFa3XmlResponseSchema,
  GetApplicableJpkResponseSchema,
  GetKsefStatusResponseSchema,
  IssueKsefSandboxResponseSchema,
  ListSourceArchiveResponseSchema,
  SplitVerificationPreviewSchema,
  StoreSourceArchiveResponseSchema,
  SyncKsefIncomingResponseSchema,
} from '@pap/contracts/statutory-ksef';
import { generateKsefFaXml, validateKsefNumber } from '@pap/domain';
import { AppModule } from '../src/app.module.js';

describe('Wave 2 Statutory JPK API (#98/GLD-11), Strict FA(2)/FA(3) XML & Source Archive (#82/#99/GLD-09), and KSeF 2.0 Sandbox API (GLD-10)', () => {
  let app: NestFastifyApplication;
  let janToken: string;
  let martaToken: string;
  let piotrToken: string;
  let autonomousAgentToken: string;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      AppModule.register({ PAP_SANDBOX_AUTH_ENABLED: 'true' }),
      new FastifyAdapter({ logger: false }),
      { logger: false, abortOnError: false },
    );
    await app.init();

    const fastify = app.getHttpAdapter().getInstance();
    const mint = async (personaId: string, scopes?: readonly string[]): Promise<string> => {
      const res = await fastify.inject({
        method: 'POST',
        url: '/api/v1/oidc/token',
        payload: {
          personaId,
          period: '2026-03',
          ...(scopes ? { scopes } : {}),
        },
      });
      expect(res.statusCode).toBe(200);
      return IssueSandboxTokenResponseSchema.parse(res.json()).accessToken;
    };

    janToken = await mint('jan-testowy');
    martaToken = await mint('marta-ksiegowa');
    piotrToken = await mint('piotr-izolacyjny');
    autonomousAgentToken = await mint('jan-testowy', ['pap:mcp:agent_autonomous', 'pap:mcp:read']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('[#98, GLD-11] exposes applicable JPK structures and exports XSD-valid JPK_V7M(3) (with live P_39/P_54/P_62), JPK_V7M(2), JPK_V7K(3), JPK_PKPIR(3), JPK_EWP(4), JPK_ST(1), JPK_KR_PD(1), and JPK_ST_KR(1) with strict RBAC', async () => {
    const fastify = app.getHttpAdapter().getInstance();

    // 1. JDG KPiR + VAT: both /v1/companies/:companyId/... and /api/v1/tenants/:tenantId/companies/:companyId/...
    const appResShort = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/applicable?period=2026-03`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(appResShort.statusCode).toBe(200);
    const kpirApplicable = GetApplicableJpkResponseSchema.parse(appResShort.json());
    expect(kpirApplicable.applicableStructures.map((s) => s.structureCode)).toEqual([
      'JPK_V7M(3)',
      'JPK_PKPIR(3)',
      'JPK_ST(1)',
    ]);

    // Archival 2026-01 cutover -> JPK_V7M(2)
    const appJan2026 = await fastify.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/jpk/applicable?period=2026-01`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(appJan2026.statusCode).toBe(200);
    expect(
      GetApplicableJpkResponseSchema.parse(appJan2026.json()).applicableStructures[0]
        ?.structureCode,
    ).toBe('JPK_V7M(2)');

    // Post a large purchase invoice in 2026-03 to create VAT input excess (P_53) and configure P_54 refund + P_62 carryover
    const bigPurchaseCreate = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FZ/EXCESS-VAT/2026/03/01',
        direction: 'purchase',
        issueDate: '2026-03-22',
        dueDate: '2026-04-05',
        counterpartyName: 'Centrum Serwerowe Test Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.dostawcaSprzetu,
        suggestedCategory: 'uslugi_obce',
        lines: [
          {
            description: 'Infrastruktura obliczeniowa GPU i macierze NVMe (23% VAT)',
            netGrosze: 3_000_000,
            vatRate: '23',
          },
          {
            description: 'Dokumentacja techniczna z ISBN (8% VAT)',
            netGrosze: 200_000,
            vatRate: '8',
          },
        ],
      },
    });
    expect(bigPurchaseCreate.statusCode).toBe(201);
    const bigPurchaseId = CompanyDocumentItemSchema.parse(bigPurchaseCreate.json()).documentId;

    const postBigPurchase = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${bigPurchaseId}/approve-and-post`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {},
    });
    expect(postBigPurchase.statusCode).toBe(200);

    // Configure P_54 refund = 500 PLN (50_000 gr) in 2026-03, leaving remainder in P_62
    const settleRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/vat/settlement`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-03',
        refundRequestedP54Grosze: 50_000,
        finalize: true,
      },
    });
    expect(settleRes.statusCode).toBe(200);

    // Export JPK_V7M(3) for 2026-03 via /v1/companies/:companyId/jpk/export
    const v7m3Res = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-03',
        structureCode: 'JPK_V7M(3)',
        purpose: 1,
      },
    });
    expect(v7m3Res.statusCode).toBe(200);
    const v7m3 = ExportJpkResponseSchema.parse(v7m3Res.json());
    expect(v7m3.submissionStatus).toBe('local_xml_only_not_submitted');
    expect(v7m3.officialUpoReferenceNumber).toBeNull();
    expect(v7m3.xsdValid).toBe(true);
    expect(v7m3.summary.p54RefundPln).toBe(500);
    expect((v7m3.summary.p62CarryForwardPln ?? 0) > 0).toBe(true);
    expect(v7m3.xmlContent).toContain('<P_54>500</P_54>');
    expect(v7m3.xmlContent).toContain('<P_560>1</P_560>');
    expect(validateOfficialMfXml(v7m3.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    // Verify P_62 from 2026-03 automatically carries into 2026-04 P_39 on JPK_V7M(3) export!
    const v7m3AprRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-04',
        structureCode: 'JPK_V7M(3)',
        purpose: 1,
      },
    });
    expect(v7m3AprRes.statusCode).toBe(200);
    const v7m3Apr = ExportJpkResponseSchema.parse(v7m3AprRes.json());
    expect(v7m3Apr.summary.p39CarryoverPln).toBe(v7m3.summary.p62CarryForwardPln);
    expect(v7m3Apr.xmlContent).toContain(`<P_39>${v7m3.summary.p62CarryForwardPln}</P_39>`);
    expect(validateOfficialMfXml(v7m3Apr.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    // Archival JPK_V7M(2) valid for 2026-01, rejected with 422 for 2026-03
    const v7m2JanRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-01',
        structureCode: 'JPK_V7M(2)',
        purpose: 1,
      },
    });
    expect(v7m2JanRes.statusCode).toBe(200);
    expect(
      validateOfficialMfXml(
        ExportJpkResponseSchema.parse(v7m2JanRes.json()).xmlContent,
        'JPK_V7M(2)',
      ).valid,
    ).toBe(true);

    const v7m2MarBad = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-03',
        structureCode: 'JPK_V7M(2)',
        purpose: 1,
      },
    });
    expect(v7m2MarBad.statusCode).toBe(422);

    // JPK_PKPIR(3) & JPK_ST(1) for JDG KPiR
    const pkpirRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-03',
        structureCode: 'JPK_PKPIR(3)',
        purpose: 1,
      },
    });
    expect(pkpirRes.statusCode).toBe(200);
    const pkpir = ExportJpkResponseSchema.parse(pkpirRes.json());
    expect(pkpir.summary.rowsCount).toBeGreaterThanOrEqual(4);
    expect(validateOfficialMfXml(pkpir.xmlContent, 'JPK_PKPIR(3)').valid).toBe(true);

    const stPkpirRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        period: '2026-03',
        structureCode: 'JPK_ST(1)',
        purpose: 1,
        fixedAssets: [
          {
            assetKind: 'tangible',
            acquisitionDate: '2026-02-10',
            acceptanceDate: '2026-02-10',
            acceptanceDocumentNumber: 'OT/2026/02/01',
            acquisitionMode: 'S',
            assetName: 'Stacja robocza CAD/BIM',
            kstSymbol: '487',
            depreciationMethod: 'L',
            annualRatePercent: 30,
            initialValueGrosze: 1_500_000,
            periodTaxDepreciationGrosze: 75_000,
            cumulativeTaxDepreciationGrosze: 75_000,
          },
        ],
      },
    });
    expect(stPkpirRes.statusCode).toBe(200);
    const stPkpir = ExportJpkResponseSchema.parse(stPkpirRes.json());
    expect(stPkpir.xmlContent).toContain('<ZnacznikST>2</ZnacznikST>');
    expect(validateOfficialMfXml(stPkpir.xmlContent, 'JPK_ST(1)').valid).toBe(true);

    // 2. JDG Ryczałt + VAT-exempt: JPK_EWP(4) & JPK_ST(1) (ZnacznikST=1), rejects JPK_V7M(3) with 422
    const ryczAppRes = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/applicable?period=2026-03`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(ryczAppRes.statusCode).toBe(200);
    expect(
      GetApplicableJpkResponseSchema.parse(ryczAppRes.json()).applicableStructures.map(
        (s) => s.structureCode,
      ),
    ).toEqual(['JPK_EWP(4)', 'JPK_ST(1)']);

    const ryczV7Denied = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_V7M(3)', purpose: 1 },
    });
    expect(ryczV7Denied.statusCode).toBe(422);

    const ewpRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_EWP(4)', purpose: 1 },
    });
    expect(ewpRes.statusCode).toBe(200);
    const ewp = ExportJpkResponseSchema.parse(ewpRes.json());
    expect(validateOfficialMfXml(ewp.xmlContent, 'JPK_EWP(4)').valid).toBe(true);

    const stEwpRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_ST(1)', purpose: 1 },
    });
    expect(stEwpRes.statusCode).toBe(200);
    const stEwp = ExportJpkResponseSchema.parse(stEwpRes.json());
    expect(stEwp.xmlContent).toContain('<ZnacznikST>1</ZnacznikST>');
    expect(validateOfficialMfXml(stEwp.xmlContent, 'JPK_ST(1)').valid).toBe(true);

    // 3. Sp. z o.o. Full Ledger: JPK_KR_PD(1) & JPK_ST_KR(1) + quarterly JPK_V7K(3)
    const spzooFixedAssetJe = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_SPZOO_ID}/ledger/journal-entries`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        documentNumber: 'OT/SPZOO/2026/01',
        description: 'Przyjęcie do używania klastra serwerowego (środek trwały konto 010)',
        lines: [
          {
            accountCode: '010',
            side: 'Wn',
            amountGrosze: 2_400_000,
            description: 'Klaster serwerowy KŚT 487',
          },
          {
            accountCode: '130',
            side: 'Ma',
            amountGrosze: 2_400_000,
            description: 'Zapłata z rachunku bieżącego za środek trwały',
          },
        ],
      },
    });
    expect(spzooFixedAssetJe.statusCode).toBe(201);

    const krPdRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_SPZOO_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_KR_PD(1)', purpose: 1 },
    });
    expect(krPdRes.statusCode).toBe(200);
    const krPd = ExportJpkResponseSchema.parse(krPdRes.json());
    expect(krPd.xmlContent).toContain('<ZOiS7>');
    expect(krPd.xmlContent).toContain('<RPD>');
    expect(validateOfficialMfXml(krPd.xmlContent, 'JPK_KR_PD(1)').valid).toBe(true);

    const stKrRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_SPZOO_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_ST_KR(1)', purpose: 1 },
    });
    expect(stKrRes.statusCode).toBe(200);
    const stKr = ExportJpkResponseSchema.parse(stKrRes.json());
    expect(stKr.xmlContent).toContain('<ST_KR>');
    expect(validateOfficialMfXml(stKr.xmlContent, 'JPK_ST_KR(1)').valid).toBe(true);

    // Create a quarterly VAT payer company to verify JPK_V7K(3) month 2 (Ewidencja only) vs month 3 (Ewidencja + VAT-7K(17))
    const qCompanyRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        displayName: 'Kwartalna Inżynieria Test Sp. z o.o.',
        nip: '5261040828',
        legalForm: 'sp_z_o_o',
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'quarterly',
      },
    });
    expect(qCompanyRes.statusCode).toBe(201);
    const qCompanyId = CreateCompanyResponseSchema.parse(qCompanyRes.json()).company.legalEntityId;

    const v7kFebRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${qCompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-02', structureCode: 'JPK_V7K(3)', purpose: 1 },
    });
    expect(v7kFebRes.statusCode).toBe(200);
    const v7kFeb = ExportJpkResponseSchema.parse(v7kFebRes.json());
    expect(v7kFeb.xmlContent).not.toContain('<Deklaracja>');
    expect(validateOfficialMfXml(v7kFeb.xmlContent, 'JPK_V7K(3)').valid).toBe(true);

    const v7kMarRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${qCompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_V7K(3)', purpose: 1 },
    });
    expect(v7kMarRes.statusCode).toBe(200);
    const v7kMar = ExportJpkResponseSchema.parse(v7kMarRes.json());
    expect(v7kMar.xmlContent).toContain('<KodFormularzaDekl kodSystemowy="VAT-7K (17)"');
    expect(validateOfficialMfXml(v7kMar.xmlContent, 'JPK_V7K(3)').valid).toBe(true);

    // 4. Cross-tenant (Piotr Tenant 2 -> Tenant 1) & read-only grant (Marta on Ryczałt) RBAC checks
    const piotrCrossShort = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/jpk/applicable?period=2026-03`,
      headers: { authorization: `Bearer ${piotrToken}` },
    });
    expect(piotrCrossShort.statusCode).toBe(403);

    const piotrCrossTenantUrl = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/jpk/export`,
      headers: { authorization: `Bearer ${piotrToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_V7M(3)', purpose: 1 },
    });
    expect(piotrCrossTenantUrl.statusCode).toBe(403);

    const martaReadOk = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/applicable?period=2026-03`,
      headers: { authorization: `Bearer ${martaToken}` },
    });
    expect(martaReadOk.statusCode).toBe(200);

    const martaWriteDenied = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_RYCZALT_ID}/jpk/export`,
      headers: { authorization: `Bearer ${martaToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_EWP(4)', purpose: 1 },
    });
    expect(martaWriteDenied.statusCode).toBe(403);
  }, 90_000);

  it('[#82, #99, GLD-09] enforces strict official FA(2)/FA(3) XML import rules, exports XSD-valid FA(3) XML from live sales invoices, and deduplicates WORM source-archive files', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const companyPath = `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;

    // 1. Negative #82 checks on POST .../documents (sourceFormat: 'ksef_xml')
    // (a) PL-prefixed NIP -> 422
    const plNipXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
      '  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza></Naglowek>',
      '  <Podmiot1><DaneIdentyfikacyjne><NIP>PL5250004007</NIP><Nazwa>Błędny Prefiks Sp. z o.o.</Nazwa></DaneIdentyfikacyjne></Podmiot1>',
      '  <Podmiot2><DaneIdentyfikacyjne><NIP>5250001003</NIP><Nazwa>Pracownia Projektowa Jan Testowy</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
      '  <Fa><P_1>2026-03-25</P_1><P_2>FV/PL-NIP/1</P_2><FaWiersz><P_7>Usługa</P_7><P_11>100.00</P_11><P_12>23</P_12></FaWiersz></Fa>',
      '</Faktura>',
    ].join('\n');
    const plNipRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: plNipXml },
    });
    expect(plNipRes.statusCode).toBe(422);
    expect((plNipRes.json() as { reasonCode: string }).reasonCode).toBe('invalid_ksef_seller_nip');

    // (b) Missing <Naglowek>/<KodFormularza> -> 422 missing_ksef_form_code
    const missingHeaderXml = [
      '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
      `  <Podmiot1><DaneIdentyfikacyjne><NIP>${SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura}</NIP><Nazwa>Bez Nagłówka Sp. z o.o.</Nazwa></DaneIdentyfikacyjne></Podmiot1>`,
      '  <Podmiot2><DaneIdentyfikacyjne><NIP>5250001003</NIP><Nazwa>Pracownia Projektowa Jan Testowy</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
      '  <Fa><P_1>2026-03-25</P_1><P_2>FV/NO-HDR/1</P_2><FaWiersz><P_7>Usługa</P_7><P_11>100.00</P_11><P_12>23</P_12></FaWiersz></Fa>',
      '</Faktura>',
    ].join('\n');
    const missingHdrRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: missingHeaderXml },
    });
    expect(missingHdrRes.statusCode).toBe(422);
    expect((missingHdrRes.json() as { reasonCode: string }).reasonCode).toBe(
      'missing_ksef_form_code',
    );

    // (c) Version mismatch (FA(3) namespace with kodSystemowy="FA (2)") -> 422
    const versionMismatchXml = plNipXml
      .replace('PL5250004007', SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura)
      .replace('kodSystemowy="FA (3)"', 'kodSystemowy="FA (2)"');
    const verMismatchRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: versionMismatchXml },
    });
    expect(verMismatchRes.statusCode).toBe(422);
    expect((verMismatchRes.json() as { reasonCode: string }).reasonCode).toBe(
      'mismatched_ksef_schema_version',
    );

    // (d) Bad namespace -> 422
    const badNsXml = plNipXml
      .replace('PL5250004007', SYNTHETIC_COUNTERPARTY_NIPS.dostawcaChmura)
      .replace('http://crd.gov.pl/wzor/2025/06/25/13775/', 'http://example.invalid/fa3');
    const badNsRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: badNsXml },
    });
    expect(badNsRes.statusCode).toBe(422);
    expect((badNsRes.json() as { reasonCode: string }).reasonCode).toBe(
      'invalid_ksef_xml_namespace',
    );

    // (e) BrakID forbidden in Podmiot1 (422), allowed in Podmiot2 (201)
    const brakIdSellerXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">',
      '  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza></Naglowek>',
      '  <Podmiot1><DaneIdentyfikacyjne><BrakID>1</BrakID><Nazwa>Sprzedawca Bez NIP</Nazwa></DaneIdentyfikacyjne></Podmiot1>',
      '  <Podmiot2><DaneIdentyfikacyjne><NIP>5250001003</NIP><Nazwa>Nabywca</Nazwa></DaneIdentyfikacyjne></Podmiot2>',
      '  <Fa><P_1>2026-03-25</P_1><P_2>FV/BRAKID-P1/1</P_2><FaWiersz><P_7>Usługa</P_7><P_11>100.00</P_11><P_12>23</P_12></FaWiersz></Fa>',
      '</Faktura>',
    ].join('\n');
    const brakIdP1Res = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: brakIdSellerXml },
    });
    expect(brakIdP1Res.statusCode).toBe(422);

    const officialB2cFa3 = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-26T10:00:00Z',
      seller: {
        nip: '5250001003',
        name: 'Pracownia Projektowa Jan Testowy',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 1, 00-001 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'brak_id' },
        name: 'Konsument Prywatny Bez NIP',
        address: { countryCode: 'PL', addressLine1: 'ul. Zielona 4, 02-100 Warszawa' },
      },
      invoiceNumber: 'FV/B2C-BRAKID/2026/03/01',
      issueDate: '2026-03-26',
      lines: [
        { description: 'Konsultacja architektoniczna B2C', netGrosze: 40_000, vatRate: '23' },
      ],
    }).xml;

    const b2cImportRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sourceFormat: 'ksef_xml', rawPayload: officialB2cFa3 },
    });
    expect(b2cImportRes.statusCode).toBe(201);
    const b2cDoc = CompanyDocumentItemSchema.parse(b2cImportRes.json());
    expect(b2cDoc.document.direction).toBe('sales');
    expect(b2cDoc.document.counterpartyNip).toBeUndefined();

    // 2. Generate official XSD-valid FA(3) XML from a live company sales invoice
    const salesCreateRes = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FV/LIVE-FA3/2026/03/55',
        direction: 'sales',
        issueDate: '2026-03-27',
        dueDate: '2026-04-10',
        counterpartyName: 'Odbiorca Inżynieryjny Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        counterpartyAddress: 'ul. Prosta 50, 00-838 Warszawa',
        lines: [
          {
            description: 'Projekt wykonawczy instalacji (23% VAT)',
            netGrosze: 1_800_000,
            vatRate: '23',
            annex15Item: true,
          },
          {
            description: 'Dokumentacja autorska (8% VAT)',
            netGrosze: 200_000,
            vatRate: '8',
          },
        ],
      },
    });
    expect(salesCreateRes.statusCode).toBe(201);
    const salesDocId = CompanyDocumentItemSchema.parse(salesCreateRes.json()).documentId;

    const fa3ExportRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/invoices/${salesDocId}/fa3-xml`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { sellerBankAccountIban: 'PL61109010140000071219812874' },
    });
    expect(fa3ExportRes.statusCode).toBe(200);
    const fa3Export = GenerateInvoiceFa3XmlResponseSchema.parse(fa3ExportRes.json());
    expect(fa3Export.xsdValid).toBe(true);
    expect(fa3Export.submissionStatus).toBe('local_xml_only_not_submitted');
    expect(fa3Export.xmlContent).toContain('<P_18A>1</P_18A>');
    expect(validateOfficialMfXml(fa3Export.xmlContent, 'FA(3)').valid).toBe(true);

    // Credit note (isCorrection = true) FA(3) XML export (<RodzajFaktury>KOR</RodzajFaktury>)
    const korSalesCreate = await fastify.inject({
      method: 'POST',
      url: `${companyPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FKOR/LIVE-FA3/2026/03/01',
        direction: 'sales',
        issueDate: '2026-03-29',
        dueDate: '2026-04-12',
        counterpartyName: 'Odbiorca Inżynieryjny Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        isCorrection: true,
        correctedDocumentNumber: 'FV/LIVE-FA3/2026/03/55',
        correctionReason: 'Rabat potransakcyjny do projektu wykonawczego',
        lines: [
          {
            description: 'Korekta ceny projektu wykonawczego (-200,00 zł netto)',
            netGrosze: -20_000,
            vatRate: '23',
          },
        ],
      },
    });
    expect(korSalesCreate.statusCode).toBe(201);
    const korDocId = CompanyDocumentItemSchema.parse(korSalesCreate.json()).documentId;
    const korFa3Res = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/invoices/${korDocId}/fa3-xml`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {},
    });
    expect(korFa3Res.statusCode).toBe(200);
    const korFa3 = GenerateInvoiceFa3XmlResponseSchema.parse(korFa3Res.json());
    expect(korFa3.xmlContent).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
    expect(validateOfficialMfXml(korFa3.xmlContent, 'FA(3)').valid).toBe(true);

    // Non-existent / cross-company linkedDocumentId on source-archive rejected with 404
    const badLinkedArchive = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fileName: 'unlinked.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.7\n%%EOF\n', 'utf8').toString('base64'),
        linkedDocumentId: '00000000-0000-4000-8000-999999999999',
      },
    });
    expect(badLinkedArchive.statusCode).toBe(404);

    // 3. Immutable WORM Source Document Archive (#99): PDF upload, 409 dedup, preview, byte read & cross-tenant 403
    const minimalPdfBytes = Buffer.from(
      '%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
      'utf8',
    );
    const storePdfRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fileName: 'faktura-kosztowa-marzec.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: minimalPdfBytes.toString('base64'),
        ocrProposal: {
          extractorId: 'pap-ocr-sandbox-v1',
          extractedAtIso: '2026-03-27T11:00:00.000Z',
          overallConfidenceBps: 9100,
          documentNumber: { value: 'FZ/OCR/2026/03/09', confidenceBps: 9400 },
          grossGrosze: { value: 123_000, confidenceBps: 8900 },
          warningsPl: ['Wymagana weryfikacja stawki VAT przez księgowego.'],
        },
      },
    });
    expect(storePdfRes.statusCode).toBe(201);
    const storedPdf = StoreSourceArchiveResponseSchema.parse(storePdfRes.json());
    expect(storedPdf.artifact.immutable).toBe(true);
    expect(storedPdf.artifact.ocrProposal?.requiresHumanApproval).toBe(true);
    expect(storedPdf.splitVerificationPreview.previewMode).toBe('pdf_embed');

    // Duplicate SHA-256 upload -> 409 Conflict
    const dupPdfRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fileName: 'duplikat.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: minimalPdfBytes.toString('base64'),
      },
    });
    expect(dupPdfRes.statusCode).toBe(409);
    expect((dupPdfRes.json() as { reasonCode: string }).reasonCode).toBe(
      'duplicate_source_artifact_sha256',
    );

    // Spoofed PDF binary header -> 422
    const spoofPdfRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fileName: 'fake.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: Buffer.from('NOT_A_PDF_FILE', 'utf8').toString('base64'),
      },
    });
    expect(spoofPdfRes.statusCode).toBe(422);

    const listArchiveRes = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(listArchiveRes.statusCode).toBe(200);
    expect(
      ListSourceArchiveResponseSchema.parse(listArchiveRes.json()).artifacts.some(
        (a) => a.artifactId === storedPdf.artifact.artifactId,
      ),
    ).toBe(true);

    const previewRes = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive/${storedPdf.artifact.artifactId}`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(previewRes.statusCode).toBe(200);
    expect(SplitVerificationPreviewSchema.parse(previewRes.json()).sha256Hex).toBe(
      storedPdf.artifact.sha256Hex,
    );

    const contentRes = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive/${storedPdf.artifact.artifactId}/content`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(contentRes.statusCode).toBe(200);
    expect(contentRes.headers['x-content-type-options']).toBe('nosniff');
    expect(contentRes.headers['x-artifact-sha256']).toBe(storedPdf.artifact.sha256Hex);
    expect(contentRes.rawPayload.equals(minimalPdfBytes)).toBe(true);

    // Piotr (Tenant 2) cannot list or download Tenant 1 archive artifacts -> 403
    const piotrArchiveDenied = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/source-archive/${storedPdf.artifact.artifactId}/content`,
      headers: { authorization: `Bearer ${piotrToken}` },
    });
    expect(piotrArchiveDenied.statusCode).toBe(403);
  }, 90_000);

  it('[GLD-10] exposes KSeF 2.0 sandbox status, hard-blocks production KSeF endpoints with 403, enforces human confirmation & anti-self-approval, issues idempotently via outbox, and syncs incoming invoices as unposted drafts', async () => {
    const fastify = app.getHttpAdapter().getInstance();

    // 1. KSeF status endpoint
    const statusRes = await fastify.inject({
      method: 'GET',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/status`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    const ksefStatus = GetKsefStatusResponseSchema.parse(statusRes.json());
    expect(ksefStatus.productionEndpointsHardBlocked).toBe(true);
    expect(ksefStatus.liveAuthCredentialsConfigured).toBe(false);
    expect(ksefStatus.externalAuthenticatedE2eStatus).toBe(
      'not_run_missing_owner_sandbox_credentials',
    );
    expect(ksefStatus.blockedProductionHosts).toContain('ksef.mf.gov.pl');
    expect(ksefStatus.blockedProductionHosts).toContain('api.ksef.mf.gov.pl');

    // Create a fresh sales invoice to issue into KSeF sandbox
    const createSalesRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FV/KSEF-ISSUE/2026/03/88',
        direction: 'sales',
        issueDate: '2026-03-28',
        dueDate: '2026-04-11',
        counterpartyName: 'Klient KSeF Sandbox Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientECommerce,
        lines: [
          { description: 'Wdrożenie integracji KSeF 2.0', netGrosze: 500_000, vatRate: '23' },
        ],
      },
    });
    expect(createSalesRes.statusCode).toBe(201);
    const salesDocId = CompanyDocumentItemSchema.parse(createSalesRes.json()).documentId;

    // 2. Autonomous MCP agent blocked with 403 agent_self_approval_forbidden
    const agentIssueDenied = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${autonomousAgentToken}` },
      payload: {
        documentId: salesDocId,
        idempotencyKey: 'idem-agent-blocked',
        humanConfirmation: { confirmedByHuman: true },
      },
    });
    expect(agentIssueDenied.statusCode).toBe(403);
    expect((agentIssueDenied.json() as { reasonCode: string }).reasonCode).toBe(
      'agent_self_approval_forbidden',
    );

    // 3. Missing / false humanConfirmation.confirmedByHuman -> 403 human_confirmation_required
    const unconfirmedDenied = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: salesDocId,
        idempotencyKey: 'idem-no-human-conf',
        humanConfirmation: { confirmedByHuman: false },
      },
    });
    expect(unconfirmedDenied.statusCode).toBe(403);
    expect((unconfirmedDenied.json() as { reasonCode: string }).reasonCode).toBe(
      'human_confirmation_required',
    );

    // 4. Hard-block production KSeF URLs (ksef.mf.gov.pl & api.ksef.mf.gov.pl) -> 403 ksef_production_endpoint_blocked
    for (const prodPayload of [
      {
        documentId: salesDocId,
        environment: 'test',
        targetBaseUrl: 'https://ksef.mf.gov.pl/v2',
        humanConfirmation: { confirmedByHuman: true },
      },
      {
        documentId: salesDocId,
        environment: 'local_mock',
        targetBaseUrl: 'https://api.ksef.mf.gov.pl/v2',
        humanConfirmation: { confirmedByHuman: true },
      },
      {
        documentId: salesDocId,
        environment: 'production',
        humanConfirmation: { confirmedByHuman: true },
      },
    ]) {
      const prodBlocked = await fastify.inject({
        method: 'POST',
        url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
        headers: { authorization: `Bearer ${janToken}` },
        payload: prodPayload,
      });
      expect(prodBlocked.statusCode).toBe(403);
      expect((prodBlocked.json() as { reasonCode: string }).reasonCode).toBe(
        'ksef_production_endpoint_blocked',
      );
    }

    // 5. Idempotent KSeF 2.0 sandbox issue (local_mock) + UPO v4-3 XSD validation + replay + conflict
    const issueRes1 = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: salesDocId,
        environment: 'local_mock',
        idempotencyKey: 'ksef-wave2-idem-001',
        humanConfirmation: {
          confirmedByHuman: true,
          confirmationNote: 'Zatwierdzam wysyłkę testowej faktury sprzedaży do sandboxa KSeF 2.0.',
        },
      },
    });
    expect(issueRes1.statusCode).toBe(200);
    const issued1 = IssueKsefSandboxResponseSchema.parse(issueRes1.json());
    expect(issued1.executionMode).toBe('local_sandbox_mock');
    expect(issued1.outcome).toBe('accepted_ksef_number_assigned');
    expect(issued1.replayedFromOutbox).toBe(false);
    expect(issued1.ksefNumber).toBeTruthy();
    expect(validateKsefNumber(issued1.ksefNumber!).valid).toBe(true);
    expect(issued1.upoStatus).toBe('validated_v4_3');
    expect(issued1.upoSha256Hex).toMatch(/^[0-9a-f]{64}$/);
    expect(issued1.archivedArtifactId).toBeTruthy();

    // Replay with identical idempotencyKey -> replayedFromOutbox = true, identical ksefNumber
    const issueReplay = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: salesDocId,
        environment: 'local_mock',
        idempotencyKey: 'ksef-wave2-idem-001',
        humanConfirmation: { confirmedByHuman: true },
      },
    });
    expect(issueReplay.statusCode).toBe(200);
    const replayed = IssueKsefSandboxResponseSchema.parse(issueReplay.json());
    expect(replayed.replayedFromOutbox).toBe(true);
    expect(replayed.ksefNumber).toBe(issued1.ksefNumber);

    // Same idempotencyKey with a different FA(3) XML -> 409 ksef_idempotency_conflict
    const diffXml = generateKsefFaXml({
      schemaVersion: 'FA(3)',
      createdAtIsoUtc: '2026-03-28T15:00:00Z',
      seller: {
        nip: '5250001003',
        name: 'Pracownia Projektowa Jan Testowy',
        address: { countryCode: 'PL', addressLine1: 'ul. Marszałkowska 1, 00-001 Warszawa' },
      },
      buyer: {
        identifier: { kind: 'nip', nip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse },
        name: 'Inny Odbiorca Sp. z o.o.',
        address: { countryCode: 'PL', addressLine1: 'ul. Prosta 1, 00-850 Warszawa' },
      },
      invoiceNumber: 'FV/OTHER/2026/03/99',
      issueDate: '2026-03-28',
      lines: [{ description: 'Inna kwota', netGrosze: 999_00, vatRate: '23' }],
    }).xml;

    const conflictRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fa3Xml: diffXml,
        environment: 'local_mock',
        idempotencyKey: 'ksef-wave2-idem-001',
        humanConfirmation: { confirmedByHuman: true },
      },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect((conflictRes.json() as { reasonCode: string }).reasonCode).toBe(
      'ksef_idempotency_conflict',
    );

    // Mismatched documentId + fa3Xml invoice number -> 422 ksef_document_mismatch
    const mismatchDocXml = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: salesDocId,
        fa3Xml: diffXml,
        environment: 'local_mock',
        idempotencyKey: 'ksef-wave2-idem-mismatch',
        humanConfirmation: { confirmedByHuman: true },
      },
    });
    expect(mismatchDocXml.statusCode).toBe(422);
    expect((mismatchDocXml.json() as { reasonCode: string }).reasonCode).toBe(
      'ksef_document_mismatch',
    );

    // 6. Incoming KSeF purchase sync: blocks prod URL (403), archives XML & creates needs_verification draft (never auto-posted)
    const syncProdBlocked = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/sync-incoming`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fromIso: '2026-03-01T00:00:00.000Z',
        toIso: '2026-03-31T23:59:59.000Z',
        environment: 'test',
        targetBaseUrl: 'https://api.ksef.mf.gov.pl/v2',
      },
    });
    expect(syncProdBlocked.statusCode).toBe(403);

    const syncRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/sync-incoming`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        fromIso: '2026-03-25T00:00:00.000Z',
        toIso: '2026-03-31T23:59:59.000Z',
        environment: 'local_mock',
      },
    });
    expect(syncRes.statusCode).toBe(200);
    const synced = SyncKsefIncomingResponseSchema.parse(syncRes.json());
    expect(synced.fetchedCount).toBe(1);
    expect(synced.items[0]?.archivedArtifactId).toBeTruthy();
    expect(synced.items[0]?.draftDocumentId).toBeTruthy();

    // Verify synced purchase invoice is strictly needs_verification (NOT auto-posted!)
    const fetchedDraft = await fastify.inject({
      method: 'GET',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}/documents/${synced.items[0]!.draftDocumentId}`,
      headers: { authorization: `Bearer ${janToken}` },
    });
    expect(fetchedDraft.statusCode).toBe(200);
    const draftDoc = CompanyDocumentItemSchema.parse(fetchedDraft.json());
    expect(draftDoc.status).toBe('needs_verification');
    expect(draftDoc.postingResult).toBeNull();
  }, 90_000);

  it('enforces Round-1 adversarial statutory & XSD invariants ([P0-1] K_11/P_11 & V7K exact-grosze carry, [P0-2] Art. 63 § 1 OP per-rate summary, [P0-3] JPK_KR_PD ZOiS7 S_12_1/S_12_3, [P1-1] FA(3) buyer IBAN & KOR metadata)', async () => {
    const fastify = app.getHttpAdapter().getInstance();

    // 1. [P0-3] JPK_KR_PD(1) 3-digit GL synthetic accounts emit exact S_12_1 & CIT S_12_3 (PD1/PD2) markers (never dead-code INNE)
    const krPdRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_SPZOO_ID}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-03', structureCode: 'JPK_KR_PD(1)', purpose: 1 },
    });
    expect(krPdRes.statusCode).toBe(200);
    const krPd = ExportJpkResponseSchema.parse(krPdRes.json());
    expect(krPd.xmlContent).toContain('<S_12_1>BAAII1a_W</S_12_1>'); // 010 Środki trwałe
    expect(krPd.xmlContent).toContain('<S_12_1>BABIII1c1_SPKR</S_12_1>'); // 130 Rachunek bieżący
    expect(krPd.xmlContent).toContain('<S_12_1>RPBIII</S_12_1>'); // 402 Usługi obce
    expect(krPd.xmlContent).toContain('<S_12_3>PD2</S_12_3>'); // 402 CIT KUP
    expect(krPd.xmlContent).toContain('<S_12_1>RPAI_RKAI_POZ</S_12_1>'); // 700 Przychody ze sprzedaży
    expect(krPd.xmlContent).toContain('<S_12_3>PD1</S_12_3>'); // 700 CIT Przychód
    expect(krPd.xmlContent).toContain('<S_12_1>BPAI</S_12_1>'); // 800 Kapitał zakładowy
    expect(krPd.xmlContent).not.toContain('<S_12_1>INNE</S_12_1>');
    expect(validateOfficialMfXml(krPd.xmlContent, 'JPK_KR_PD(1)').valid).toBe(true);

    // 2. [P0-1] & [P0-2] Monthly VAT payer: 'np' -> <K_11>/<P_11> (not <K_10>/<P_10>), and multi-rate .50 gr per-rate rounding matches <Deklaracja>
    const mCompanyRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        displayName: 'Miesięczna Walidacja Podatkowa Sp. z o.o.',
        nip: '5260250274',
        legalForm: 'sp_z_o_o',
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'monthly',
      },
    });
    expect(mCompanyRes.statusCode).toBe(201);
    const mCompanyId = CreateCompanyResponseSchema.parse(mCompanyRes.json()).company.legalEntityId;
    const mPath = `/api/v1/tenants/${TENANT_1_ID}/companies/${mCompanyId}`;

    const postDoc = async (companyBasePath: string, payload: Record<string, unknown>) => {
      const created = await fastify.inject({
        method: 'POST',
        url: `${companyBasePath}/documents`,
        headers: { authorization: `Bearer ${janToken}` },
        payload,
      });
      expect(created.statusCode).toBe(201);
      const docItem = CompanyDocumentItemSchema.parse(created.json());
      const posted = await fastify.inject({
        method: 'POST',
        url: `${companyBasePath}/documents/${docItem.documentId}/approve-and-post`,
        headers: { authorization: `Bearer ${janToken}` },
        payload: {},
      });
      expect(posted.statusCode).toBe(200);
      return docItem;
    };

    // 2a. [P0-1] Outside-country B2B service ('np', art. 28b VAT) -> <K_11>/<P_11> & <P_37>, zero <K_10>/<P_10>
    await postDoc(mPath, {
      documentNumber: 'FV/NP/2026/06/01',
      direction: 'sales',
      issueDate: '2026-06-10',
      dueDate: '2026-06-24',
      counterpartyName: 'Nordic Cloud AB (Stockholm, SE)',
      lines: [
        {
          description: 'Usługa inżynierii oprogramowania poza terytorium kraju (art. 28b VAT)',
          netGrosze: 100_000,
          vatRate: 'np',
        },
      ],
    });

    const v7mNpRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${mCompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-06', structureCode: 'JPK_V7M(3)', purpose: 1 },
    });
    expect(v7mNpRes.statusCode).toBe(200);
    const v7mNp = ExportJpkResponseSchema.parse(v7mNpRes.json());
    expect(v7mNp.xmlContent).toContain('<K_11>1000.00</K_11>');
    expect(v7mNp.xmlContent).toContain('<P_11>1000</P_11>');
    expect(v7mNp.xmlContent).toContain('<P_37>1000</P_37>');
    expect(v7mNp.xmlContent).not.toContain('<K_10>');
    expect(v7mNp.xmlContent).not.toContain('<P_10>');
    expect(validateOfficialMfXml(v7mNp.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    // 2b. [P0-2] Multi-rate .50 gr VAT (45,65 zł @ 23% = 10,50 zł VAT -> P_20=11; 131,25 zł @ 8% = 10,50 zł VAT -> P_18=11; P_38=P_51=22)
    await postDoc(mPath, {
      documentNumber: 'FV/MULTIRATE/2026/05/01',
      direction: 'sales',
      issueDate: '2026-05-15',
      dueDate: '2026-05-29',
      counterpartyName: 'Odbiorca Krajowy Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [
        { description: 'Usługa wdrożeniowa 23%', netGrosze: 4_565, vatRate: '23' },
        { description: 'Publikacja specjalistyczna 8%', netGrosze: 13_125, vatRate: '8' },
      ],
    });

    const v7mMultiRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${mCompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-05', structureCode: 'JPK_V7M(3)', purpose: 1 },
    });
    expect(v7mMultiRes.statusCode).toBe(200);
    const v7mMulti = ExportJpkResponseSchema.parse(v7mMultiRes.json());
    expect(v7mMulti.xmlContent).toContain('<PodatekNalezny>21.00</PodatekNalezny>');
    expect(v7mMulti.xmlContent).toContain('<P_18>11</P_18>');
    expect(v7mMulti.xmlContent).toContain('<P_20>11</P_20>');
    expect(v7mMulti.xmlContent).toContain('<P_38>22</P_38>');
    expect(v7mMulti.xmlContent).toContain('<P_51>22</P_51>');
    expect(v7mMulti.summary.p51TaxDuePln).toBe(22);
    expect(validateOfficialMfXml(v7mMulti.xmlContent, 'JPK_V7M(3)').valid).toBe(true);

    // 3. [P0-1] & [P0-2] Quarterly JPK_V7K(3): Month 2 omits declaration summary fields; Month 3 sums exact grosze across Q2 (10,40 zł × 3 = 31,20 zł -> P_20=31, not 30) & carries prior-month 'np' into P_11
    const q2CompanyRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TENANT_1_ID}/companies`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        displayName: 'Kwartalna Precyzja Groszowa Sp. z o.o.',
        nip: '5260250995',
        legalForm: 'sp_z_o_o',
        profileCode: 'spzoo_pelne_ksiegi',
        vatStatus: 'czynny',
        vatSettlementPeriod: 'quarterly',
      },
    });
    expect(q2CompanyRes.statusCode).toBe(201);
    const q2CompanyId = CreateCompanyResponseSchema.parse(q2CompanyRes.json()).company
      .legalEntityId;
    const q2Path = `/api/v1/tenants/${TENANT_1_ID}/companies/${q2CompanyId}`;

    // 45,22 zł * 23% = 10,40 zł VAT (1_040 gr) in each of Apr, May, Jun -> quarterly exact sum = 31,20 zł -> P_20 = 31 PLN
    await postDoc(q2Path, {
      documentNumber: 'FV/Q2/04',
      direction: 'sales',
      issueDate: '2026-04-10',
      counterpartyName: 'Klient Q2 Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [{ description: 'Abonament kwiecień', netGrosze: 4_522, vatRate: '23' }],
    });
    await postDoc(q2Path, {
      documentNumber: 'FV/Q2/05',
      direction: 'sales',
      issueDate: '2026-05-10',
      counterpartyName: 'Klient Q2 Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [
        { description: 'Abonament maj', netGrosze: 4_522, vatRate: '23' },
        { description: 'Konsultacje zagraniczne np maj', netGrosze: 100_000, vatRate: 'np' },
      ],
    });
    await postDoc(q2Path, {
      documentNumber: 'FV/Q2/06',
      direction: 'sales',
      issueDate: '2026-06-10',
      counterpartyName: 'Klient Q2 Sp. z o.o.',
      counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
      lines: [{ description: 'Abonament czerwiec', netGrosze: 4_522, vatRate: '23' }],
    });

    const v7kMayRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${q2CompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-05', structureCode: 'JPK_V7K(3)', purpose: 1 },
    });
    expect(v7kMayRes.statusCode).toBe(200);
    const v7kMay = ExportJpkResponseSchema.parse(v7kMayRes.json());
    expect(v7kMay.xmlContent).not.toContain('<Deklaracja>');
    expect(v7kMay.xmlContent).toContain('<K_11>1000.00</K_11>');
    expect(v7kMay.summary.p39CarryoverPln).toBeUndefined();
    expect(v7kMay.summary.p51TaxDuePln).toBeUndefined();
    expect(v7kMay.summary.p53ExcessPln).toBeUndefined();
    expect(v7kMay.summary.p54RefundPln).toBeUndefined();
    expect(v7kMay.summary.p62CarryForwardPln).toBeUndefined();
    expect(validateOfficialMfXml(v7kMay.xmlContent, 'JPK_V7K(3)').valid).toBe(true);

    const v7kJunRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${q2CompanyId}/jpk/export`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: { period: '2026-06', structureCode: 'JPK_V7K(3)', purpose: 1 },
    });
    expect(v7kJunRes.statusCode).toBe(200);
    const v7kJun = ExportJpkResponseSchema.parse(v7kJunRes.json());
    expect(v7kJun.xmlContent).toContain('<P_11>1000</P_11>');
    expect(v7kJun.xmlContent).toContain('<P_20>31</P_20>');
    expect(v7kJun.xmlContent).toContain('<P_38>31</P_38>');
    expect(v7kJun.summary.p51TaxDuePln).toBe(31);
    expect(validateOfficialMfXml(v7kJun.xmlContent, 'JPK_V7K(3)').valid).toBe(true);

    // 4. [P1-1] FA(3) sales export: never leaks buyer counterpartyIban as seller <NrRB>, resolves original invoice issueDate & NrKSeFFaKorygowanej on KOR, and sets P_18A=1 on negative Annex 15 KOR > 15k PLN
    const jdgPath = `/api/v1/tenants/${TENANT_1_ID}/companies/${COMPANY_JDG_KPIR_ID}`;
    const buyerIban = 'PL10105000997603123456789123';
    const origSalesCreate = await fastify.inject({
      method: 'POST',
      url: `${jdgPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FV/ORIG-IBAN-KSEF/2026/03/05',
        direction: 'sales',
        issueDate: '2026-03-05',
        dueDate: '2026-03-19',
        counterpartyName: 'Odbiorca Sprzętowy Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        counterpartyIban: buyerIban,
        lines: [
          {
            description: 'Dostawa serwerów obliczeniowych (zał. nr 15)',
            netGrosze: 2_000_000,
            vatRate: '23',
            annex15Item: true,
          },
        ],
      },
    });
    expect(origSalesCreate.statusCode).toBe(201);
    const origSalesDoc = CompanyDocumentItemSchema.parse(origSalesCreate.json());

    const origFa3Res = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/invoices/${origSalesDoc.documentId}/fa3-xml`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {},
    });
    expect(origFa3Res.statusCode).toBe(200);
    const origFa3 = GenerateInvoiceFa3XmlResponseSchema.parse(origFa3Res.json());
    expect(origFa3.xmlContent).not.toContain(buyerIban);
    expect(origFa3.xmlContent).not.toContain('<RachunekBankowy>');
    expect(validateOfficialMfXml(origFa3.xmlContent, 'FA(3)').valid).toBe(true);

    // Issue original invoice in KSeF sandbox so it receives an official-format KSeF reference number
    const origIssueRes = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/ksef/sandbox/issue`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentId: origSalesDoc.documentId,
        environment: 'local_mock',
        idempotencyKey: 'ksef-orig-for-kor-001',
        humanConfirmation: { confirmedByHuman: true },
      },
    });
    expect(origIssueRes.statusCode).toBe(200);
    const origKsefNumber = IssueKsefSandboxResponseSchema.parse(origIssueRes.json()).ksefNumber!;
    expect(validateKsefNumber(origKsefNumber).valid).toBe(true);

    // Create in-minus KOR exceeding 15 000 PLN gross (-18 450,00 zł gross) with Annex 15 item referencing the 2026-03-05 invoice
    const bigKorCreate = await fastify.inject({
      method: 'POST',
      url: `${jdgPath}/documents`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {
        documentNumber: 'FKOR/ORIG-IBAN-KSEF/2026/03/29',
        direction: 'sales',
        issueDate: '2026-03-29',
        dueDate: '2026-04-12',
        counterpartyName: 'Odbiorca Sprzętowy Sp. z o.o.',
        counterpartyNip: SYNTHETIC_COUNTERPARTY_NIPS.klientSoftwareHouse,
        counterpartyIban: buyerIban,
        isCorrection: true,
        correctedDocumentNumber: 'FV/ORIG-IBAN-KSEF/2026/03/05',
        correctionReason: 'Zwrot części serwerów obliczeniowych z załącznika nr 15',
        lines: [
          {
            description: 'Korekta in-minus dostawy serwerów (zał. nr 15)',
            netGrosze: -1_500_000,
            vatRate: '23',
            annex15Item: true,
          },
        ],
      },
    });
    expect(bigKorCreate.statusCode).toBe(201);
    const bigKorDoc = CompanyDocumentItemSchema.parse(bigKorCreate.json());

    const bigKorFa3Res = await fastify.inject({
      method: 'POST',
      url: `/v1/companies/${COMPANY_JDG_KPIR_ID}/invoices/${bigKorDoc.documentId}/fa3-xml`,
      headers: { authorization: `Bearer ${janToken}` },
      payload: {},
    });
    expect(bigKorFa3Res.statusCode).toBe(200);
    const bigKorFa3 = GenerateInvoiceFa3XmlResponseSchema.parse(bigKorFa3Res.json());
    expect(bigKorFa3.xmlContent).toContain('<RodzajFaktury>KOR</RodzajFaktury>');
    expect(bigKorFa3.xmlContent).toContain(
      '<DataWystFaKorygowanej>2026-03-05</DataWystFaKorygowanej>',
    );
    expect(bigKorFa3.xmlContent).toContain('<NrKSeF>1</NrKSeF>');
    expect(bigKorFa3.xmlContent).toContain(
      `<NrKSeFFaKorygowanej>${origKsefNumber}</NrKSeFFaKorygowanej>`,
    );
    expect(bigKorFa3.xmlContent).toContain('<P_18A>1</P_18A>');
    expect(bigKorFa3.xmlContent).not.toContain(buyerIban);
    expect(validateOfficialMfXml(bigKorFa3.xmlContent, 'FA(3)').valid).toBe(true);
  }, 90_000);
});
