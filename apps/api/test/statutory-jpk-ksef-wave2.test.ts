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
});
