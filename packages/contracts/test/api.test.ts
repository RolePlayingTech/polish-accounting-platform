import { describe, expect, it } from 'vitest';
import {
  ApproveAndPostDocumentRequestSchema,
  CalendarViewResponseSchema,
  ConfirmMcpProposalRequestSchema,
  CreateCompanyRequestSchema,
  CreateDocumentRequestSchema,
  CreateJournalEntryRequestSchema,
  DispatchDueNotificationsRequestSchema,
  ExplainLegalRuleRequestSchema,
  GetMyCompaniesResponseSchema,
  IssueSandboxTokenRequestSchema,
  IssueSandboxTokenResponseSchema,
  ListSandboxPersonasResponseSchema,
  UpdateNotificationPreferencesRequestSchema,
} from '../src/api.js';

describe('@pap/contracts/api schemas', () => {
  it('validates Sandbox OIDC persona list and token issuance payloads with canonical UUIDs', () => {
    const req = IssueSandboxTokenRequestSchema.parse({
      personaId: 'jan-testowy',
      scopes: ['openid', 'pap:ui:full', 'pap:mcp:read', 'pap:mcp:prepare'],
      period: '2026-03',
    });
    expect(req.personaId).toBe('jan-testowy');

    const persona = {
      personaId: 'jan-testowy',
      displayName: 'Jan Testowy',
      email: 'jan.testowy@sandbox.example',
      userId: '00000000-0000-4000-8000-000000000101',
      subject: '00000000-0000-4000-8000-000000000101',
      tenantId: '11111111-1111-4111-8111-111111111100',
      tenantName: 'Grupa Projektowa Jan Testowy (Tenant 1)',
      role: 'tenant_owner' as const,
      tenantRole: 'owner' as const,
      defaultLegalEntityId: '11111111-1111-4111-8111-111111111101',
      roleLabelPl: 'Właściciel tenanta / Przedsiębiorca',
      descriptionPl: 'Pełny dostęp odczytu i zapisu do 3 firm demonstracyjnych w Tenant 1.',
      defaultScopes: ['openid', 'pap:ui:full', 'pap:mcp:read', 'pap:mcp:prepare'],
      companyAccess: [
        {
          tenantId: '11111111-1111-4111-8111-111111111100',
          legalEntityId: '11111111-1111-4111-8111-111111111101',
          displayName: 'Pracownia Projektowa Jan Testowy',
          canRead: true,
          canWrite: true,
        },
      ],
    };

    const personasRes = ListSandboxPersonasResponseSchema.parse({
      issuer: 'http://127.0.0.1:4000',
      personas: [persona],
    });
    expect(personasRes.personas).toHaveLength(1);

    const jwt = 'eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
    const tokenRes = IssueSandboxTokenResponseSchema.parse({
      accessToken: jwt,
      token: jwt,
      tokenType: 'Bearer',
      expiresIn: 3600,
      expiresAt: '2026-03-20T13:00:00.000Z',
      issuer: 'http://127.0.0.1:4000',
      scope: 'openid pap:ui:full pap:mcp:read pap:mcp:prepare',
      persona,
    });
    expect(tokenRes.tokenType).toBe('Bearer');
    expect(tokenRes.token).toBe(tokenRes.accessToken);
  });

  it('validates /api/v1/me/companies and POST /api/v1/tenants/:tenantId/companies contracts', () => {
    const myCompanies = GetMyCompaniesResponseSchema.parse({
      actor: {
        userId: '00000000-0000-4000-8000-000000000101',
        issuer: 'http://127.0.0.1:4000',
        subject: '00000000-0000-4000-8000-000000000101',
        displayName: 'Jan Testowy',
      },
      companies: [
        {
          tenantId: '11111111-1111-4111-8111-111111111100',
          legalEntityId: '11111111-1111-4111-8111-111111111101',
          displayName: 'Pracownia Projektowa Jan Testowy',
          nip: '5250001003',
          legalForm: 'jdg',
          taxRegime: 'kpir_skala',
          vatStatus: 'czynny',
          zusStage: 'duzy_zus',
          role: 'tenant_owner',
          canRead: true,
          canWrite: true,
        },
      ],
    });
    expect(myCompanies.companies[0]?.taxRegime).toBe('kpir_skala');

    const createReq = CreateCompanyRequestSchema.parse({
      displayName: 'Nowa Pracownia Testowa',
      nip: '5250002008',
      legalForm: 'jdg',
      taxRegime: 'ryczalt',
      vatStatus: 'zwolniony_art_113',
      zusStage: 'ulga_na_start',
    });
    expect(createReq.vatStatus).toBe('zwolniony_art_113');

    const bffCreateReq = CreateCompanyRequestSchema.parse({
      companyName: 'Nowa Pracownia BFF',
      nip: '5250002008',
      legalForm: 'jdg',
      profileCode: 'jdg_kpir_skala',
      vatStatus: 'czynny',
    });
    expect(bffCreateReq.companyName).toBe('Nowa Pracownia BFF');
  });

  it('validates structured manual and raw import document payloads and rejects unknown fields', () => {
    const manual = CreateDocumentRequestSchema.parse({
      documentNumber: 'FV/2026/03/10',
      direction: 'purchase',
      issueDate: '2026-03-10',
      dueDate: '2026-03-24',
      counterpartyName: 'Chmura Polska Test Sp. z o.o.',
      counterpartyNip: '5250002008',
      suggestedCategory: 'uslugi_obce',
      vatDeductionMode: 'full_100',
      lines: [
        {
          description: 'Usługa hostingu serwerowego',
          netGrosze: 100_000,
          vatRate: '23',
        },
      ],
    });
    expect('documentNumber' in manual && manual.documentNumber).toBe('FV/2026/03/10');

    const xmlImport = CreateDocumentRequestSchema.parse({
      sourceFormat: 'ksef_xml',
      rawPayload: '<Faktura><P_2>FV/KSEF/1</P_2></Faktura>',
      direction: 'purchase',
    });
    expect('sourceFormat' in xmlImport && xmlImport.sourceFormat).toBe('ksef_xml');

    expect(() =>
      CreateDocumentRequestSchema.parse({
        documentNumber: 'FV/BAD/1',
        direction: 'sales',
        issueDate: '2026-02-30',
        counterpartyName: 'Test',
        lines: [{ description: 'Bad date', netGrosze: 1000, vatRate: '23' }],
      }),
    ).toThrow();

    expect(() =>
      ApproveAndPostDocumentRequestSchema.parse({
        autoPostWithoutHuman: true,
      }),
    ).toThrow();
  });

  it('rejects invalid journal account codes, bad confirmation codes, and authority-spoofing notification emails', () => {
    expect(() =>
      CreateJournalEntryRequestSchema.parse({
        bookingDate: '2026-03-15',
        documentDate: '2026-03-15',
        documentNumber: 'PK/01',
        description: 'Błędne konto',
        lines: [
          { accountCode: 'BAD', side: 'Wn', amountGrosze: 1000, description: 'Wn' },
          { accountCode: '201', side: 'Ma', amountGrosze: 1000, description: 'Ma' },
        ],
      }),
    ).toThrow();

    expect(() =>
      ConfirmMcpProposalRequestSchema.parse({
        confirmationCode: 'too-short',
      }),
    ).toThrow();

    expect(() =>
      ConfirmMcpProposalRequestSchema.parse({
        confirmationCode: 'PAP-HUMAN-valid-code-1234567890',
      }),
    ).toThrow();

    expect(() =>
      UpdateNotificationPreferencesRequestSchema.parse({
        recipientEmail: 'not-an-email',
        frequency: 'standard',
        optionalRemindersOptedOut: false,
      }),
    ).toThrow();

    const dispatch = DispatchDueNotificationsRequestSchema.parse({
      evaluationDate: '2026-03-18',
    });
    expect(dispatch.evaluationDate).toBe('2026-03-18');

    const explain = ExplainLegalRuleRequestSchema.parse({
      ruleCode: 'VAT_JPK_V7M_2026',
      asOfDate: '2026-03-20',
    });
    expect(explain.ruleCode).toBe('VAT_JPK_V7M_2026');

    const calendar = CalendarViewResponseSchema.parse({
      year: 2026,
      month: 3,
      obligations: [],
    });
    expect(calendar.year).toBe(2026);
  });
});
