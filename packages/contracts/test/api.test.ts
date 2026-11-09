import { describe, expect, it } from 'vitest';
import {
  AcceptTenantInvitationRequestSchema,
  AcceptTenantInvitationResponseSchema,
  ApproveAndPostDocumentRequestSchema,
  AuthenticatedSessionViewSchema,
  AuthSessionStateCodeSchema,
  BootstrapOwnerRequestSchema,
  BootstrapOwnerResponseSchema,
  CalendarViewResponseSchema,
  ConfirmMcpProposalRequestSchema,
  CreateCompanyRequestSchema,
  CreateDocumentRequestSchema,
  CreateJournalEntryRequestSchema,
  CreateTenantInvitationRequestSchema,
  CreateTenantInvitationResponseSchema,
  DispatchDueNotificationsRequestSchema,
  ExplainLegalRuleRequestSchema,
  GetMyCompaniesResponseSchema,
  IssueSandboxTokenRequestSchema,
  IssueSandboxTokenResponseSchema,
  ListSandboxPersonasResponseSchema,
  ListTenantInvitationsResponseSchema,
  OidcAuthorizeRequestSchema,
  OidcAuthorizeResponseSchema,
  OidcCallbackQuerySchema,
  OidcDiscoveryDocumentSchema,
  RejectTenantInvitationRequestSchema,
  RejectTenantInvitationResponseSchema,
  RevokeTenantInvitationRequestSchema,
  RevokeTenantInvitationResponseSchema,
  RuntimeModeSchema,
  SafeRelativeRedirectPathSchema,
  UpdateNotificationPreferencesRequestSchema,
  UpdateSessionContextRequestSchema,
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

    expect(() =>
      ApproveAndPostDocumentRequestSchema.parse({
        netPln: '9'.repeat(24),
      }),
    ).toThrow();

    expect(() =>
      ApproveAndPostDocumentRequestSchema.parse({
        vatPln: `${'9'.repeat(21)}.00`,
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

    expect(() =>
      ApproveAndPostDocumentRequestSchema.parse({
        netPln: '123456789012345.00',
        vatPln: '23.00',
      }),
    ).toThrow(/15 znaków/);
  });

  it('validates Wave 2 OIDC discovery, authorize/callback, BFF session view, and open-redirect protection', () => {
    expect(RuntimeModeSchema.parse('PRODUCTION')).toBe('PRODUCTION');
    expect(() => RuntimeModeSchema.parse('STAGING')).toThrow();

    expect(AuthSessionStateCodeSchema.parse('no_tenant_membership')).toBe('no_tenant_membership');

    const discovery = OidcDiscoveryDocumentSchema.parse({
      issuer: 'https://id.ksiegowosc.roleplayingtech.com/realms/pap',
      authorization_endpoint:
        'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/auth',
      token_endpoint:
        'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/token',
      end_session_endpoint:
        'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/logout',
      jwks_uri: 'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/certs',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256', 'ES256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email'],
    });
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);

    expect(SafeRelativeRedirectPathSchema.parse('/documents?period=2026-03')).toBe(
      '/documents?period=2026-03',
    );
    expect(() => SafeRelativeRedirectPathSchema.parse('//evil.example/phish')).toThrow();
    expect(() => SafeRelativeRedirectPathSchema.parse('https://evil.example/phish')).toThrow();
    expect(() => SafeRelativeRedirectPathSchema.parse('/\\evil.example')).toThrow();
    expect(() => SafeRelativeRedirectPathSchema.parse('/calendar\u0000')).toThrow();

    const authReq = OidcAuthorizeRequestSchema.parse({
      returnTo: '/calendar',
      invitationToken: 'pap_inv_0123456789abcdef0123456789abcdef',
    });
    expect(authReq.returnTo).toBe('/calendar');
    expect(() =>
      OidcAuthorizeRequestSchema.parse({
        returnTo: '/calendar',
        unknownField: 'rejected',
      }),
    ).toThrow();

    const authRes = OidcAuthorizeResponseSchema.parse({
      authorizationUrl:
        'https://id.ksiegowosc.roleplayingtech.com/realms/pap/protocol/openid-connect/auth?client_id=pap-web&response_type=code',
      state: 'state-token-1234567890123456',
      expiresAt: '2026-03-20T13:10:00.000Z',
    });
    expect(authRes.state).toContain('state-token');

    const callbackOk = OidcCallbackQuerySchema.parse({
      code: 'auth-code-xyz',
      state: 'state-token-1234567890123456',
    });
    expect(callbackOk.code).toBe('auth-code-xyz');

    const callbackError = OidcCallbackQuerySchema.parse({
      error: 'access_denied',
      error_description: 'Użytkownik anulował logowanie',
      state: 'state-token-1234567890123456',
    });
    expect(callbackError.error).toBe('access_denied');

    expect(() =>
      OidcCallbackQuerySchema.parse({
        state: 'only-state-without-code-or-error',
      }),
    ).toThrow(/pary \(code, state\)/);

    expect(() =>
      OidcCallbackQuerySchema.parse({
        code: 'auth-code-xyz',
        state: 'state-token-1234567890123456',
        error: 'access_denied',
      }),
    ).toThrow(/jednocześnie kodu autoryzacyjnego/);

    const validSessionViewPayload = {
      state: 'authenticated' as const,
      authMethod: 'oidc' as const,
      userId: '00000000-0000-4000-8000-000000000901',
      issuer: 'https://id.ksiegowosc.roleplayingtech.com/realms/pap',
      subject: 'oidc-sub-owner-01',
      displayName: 'Grzegorz Właściciel',
      email: 'owner@ksiegowosc.example.pl',
      tenantId: '11111111-1111-4111-8111-111111111100',
      legalEntityId: '11111111-1111-4111-8111-111111111101',
      period: '2026-03',
      memberships: [
        {
          tenantId: '11111111-1111-4111-8111-111111111100',
          tenantName: 'Kancelaria Główna Sp. z o.o.',
          role: 'tenant_owner' as const,
          status: 'active' as const,
          validFrom: '2026-03-01T00:00:00.000Z',
          validUntil: null,
        },
      ],
      companies: [
        {
          tenantId: '11111111-1111-4111-8111-111111111100',
          legalEntityId: '11111111-1111-4111-8111-111111111101',
          displayName: 'Kancelaria Główna Sp. z o.o.',
          nip: '5250001003',
          legalForm: 'sp_z_o_o' as const,
          taxRegime: 'cit_klasyczny' as const,
          vatStatus: 'czynny' as const,
          zusStage: 'not_applicable' as const,
          role: 'tenant_owner' as const,
          canRead: true,
          canWrite: true,
        },
      ],
      sessionExpiresAt: '2026-03-20T21:00:00.000Z',
      accessTokenExpiresAt: '2026-03-20T13:15:00.000Z',
    };

    const sessionView = AuthenticatedSessionViewSchema.parse(validSessionViewPayload);
    expect(sessionView.state).toBe('authenticated');

    expect(() =>
      AuthenticatedSessionViewSchema.parse({
        ...validSessionViewPayload,
        accessToken: 'raw-jwt-must-never-leak',
      }),
    ).toThrow();

    expect(() =>
      AuthenticatedSessionViewSchema.parse({
        ...validSessionViewPayload,
        refreshToken: 'raw-refresh-token-must-never-leak',
      }),
    ).toThrow();

    expect(
      UpdateSessionContextRequestSchema.parse({
        tenantId: '11111111-1111-4111-8111-111111111100',
        legalEntityId: '11111111-1111-4111-8111-111111111101',
      }).tenantId,
    ).toBe('11111111-1111-4111-8111-111111111100');

    expect(() => UpdateSessionContextRequestSchema.parse({})).toThrow(
      /co najmniej jednego pola kontekstu/,
    );
  });

  it('validates Wave 2 owner bootstrap and tenant invitation lifecycle contracts', () => {
    const bootstrapReq = BootstrapOwnerRequestSchema.parse({
      issuer: 'https://id.ksiegowosc.roleplayingtech.com/realms/pap',
      subject: 'oidc-sub-owner-01',
      email: 'owner@ksiegowosc.example.pl',
      displayName: 'Grzegorz Właściciel',
      tenantName: 'Kancelaria Główna Sp. z o.o.',
      initialCompany: {
        displayName: 'Kancelaria Główna Sp. z o.o.',
        nip: '5250001003',
        legalForm: 'sp_z_o_o',
        taxRegime: 'cit_klasyczny',
        vatStatus: 'czynny',
        zusStage: 'not_applicable',
      },
      reason: 'Jednorazowy bootstrap pierwszego właściciela platformy i tenanta (#83)',
      operationId: '22222222-2222-4222-8222-222222222201',
    });
    expect(bootstrapReq.tenantName).toBe('Kancelaria Główna Sp. z o.o.');

    expect(() =>
      BootstrapOwnerRequestSchema.parse({
        issuer: bootstrapReq.issuer,
        subject: bootstrapReq.subject,
        email: bootstrapReq.email,
        displayName: bootstrapReq.displayName,
        tenantName: bootstrapReq.tenantName,
      }),
    ).toThrow();

    const bootstrapRes = BootstrapOwnerResponseSchema.parse({
      ok: true,
      idempotentReplay: false,
      userId: '00000000-0000-4000-8000-000000000901',
      issuer: bootstrapReq.issuer,
      subject: bootstrapReq.subject,
      displayName: bootstrapReq.displayName,
      email: bootstrapReq.email,
      tenantId: '11111111-1111-4111-8111-111111111100',
      tenantName: bootstrapReq.tenantName,
      role: 'tenant_owner',
      legalEntityId: '11111111-1111-4111-8111-111111111101',
      operationId: '22222222-2222-4222-8222-222222222201',
      auditEventId: '33333333-3333-4333-8333-333333333301',
      occurredAt: '2026-03-20T12:00:00.000Z',
    });
    expect(bootstrapRes.ok).toBe(true);

    const inviteReq = CreateTenantInvitationRequestSchema.parse({
      inviteeEmail: 'ksiegowa@biuro.example.pl',
      inviteeDisplayName: 'Marta Księgowa',
      intendedRole: 'tenant_member',
      initialCompanyGrants: [
        {
          legalEntityId: '11111111-1111-4111-8111-111111111101',
          actions: ['read', 'write'],
        },
      ],
      expiresInHours: 48,
      reason: 'Zaproszenie księgowej prowadzącej do obsługi spółki',
    });
    expect(inviteReq.intendedRole).toBe('tenant_member');

    expect(() =>
      CreateTenantInvitationRequestSchema.parse({
        inviteeEmail: 'bad-email',
        intendedRole: 'tenant_member',
        reason: 'Błędny format adresu e-mail',
      }),
    ).toThrow();

    expect(() =>
      CreateTenantInvitationRequestSchema.parse({
        inviteeEmail: 'ksiegowa@biuro.example.pl',
        intendedRole: 'tenant_member',
        expiresInHours: 337,
        reason: 'Przekroczony maksymalny czas ważności 336h',
      }),
    ).toThrow();

    expect(() =>
      CreateTenantInvitationRequestSchema.parse({
        inviteeEmail: 'ksiegowa@biuro.example.pl',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [
          {
            legalEntityId: '11111111-1111-4111-8111-111111111101',
            actions: ['write'],
          },
        ],
        reason: 'Brak read przy write',
      }),
    ).toThrow(/wymaga jednoczesnego uprawnienia odczytu/);

    expect(() =>
      CreateTenantInvitationRequestSchema.parse({
        inviteeEmail: 'ksiegowa@biuro.example.pl',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [
          {
            legalEntityId: '11111111-1111-4111-8111-111111111101',
            actions: ['read', 'read'],
          },
        ],
        reason: 'Duplikat akcji',
      }),
    ).toThrow(/duplikatów/);

    expect(() =>
      CreateTenantInvitationRequestSchema.parse({
        inviteeEmail: 'ksiegowa@biuro.example.pl',
        intendedRole: 'tenant_member',
        initialCompanyGrants: [
          {
            legalEntityId: '11111111-1111-4111-8111-111111111101',
            actions: ['read'],
          },
          {
            legalEntityId: '11111111-1111-4111-8111-111111111101',
            actions: ['read', 'write'],
          },
        ],
        reason: 'Duplikat legalEntityId',
      }),
    ).toThrow(/zduplikowanego legalEntityId/);

    const invitationItem = {
      invitationId: '44444444-4444-4444-8444-444444444401',
      tenantId: '11111111-1111-4111-8111-111111111100',
      tenantName: 'Kancelaria Główna Sp. z o.o.',
      inviteeMaskedEmail: 'ks***@biuro.example.pl',
      inviteeDisplayName: 'Marta Księgowa',
      intendedRole: 'tenant_member' as const,
      initialCompanyGrants: [
        {
          legalEntityId: '11111111-1111-4111-8111-111111111101',
          actions: ['read', 'write'] as ('read' | 'write')[],
        },
      ],
      status: 'pending' as const,
      invitedByUserId: '00000000-0000-4000-8000-000000000901',
      invitedByDisplayName: 'Grzegorz Właściciel',
      createdAt: '2026-03-20T12:00:00.000Z',
      expiresAt: '2026-03-22T12:00:00.000Z',
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      rejectedAt: null,
    };

    const createInviteRes = CreateTenantInvitationResponseSchema.parse({
      invitation: invitationItem,
      invitationToken: 'pap_inv_0123456789abcdef0123456789abcdef',
      acceptPath: '/login/invitation?token=pap_inv_0123456789abcdef0123456789abcdef',
      auditEventId: '33333333-3333-4333-8333-333333333302',
    });
    expect(createInviteRes.invitation.status).toBe('pending');

    const listInvitesRes = ListTenantInvitationsResponseSchema.parse({
      tenantId: '11111111-1111-4111-8111-111111111100',
      invitations: [invitationItem],
    });
    expect(listInvitesRes.invitations).toHaveLength(1);

    const acceptReq = AcceptTenantInvitationRequestSchema.parse({
      invitationToken: 'pap_inv_0123456789abcdef0123456789abcdef',
      displayName: 'Marta Księgowa',
    });
    expect(acceptReq.invitationToken).toContain('pap_inv_');

    const acceptRes = AcceptTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: {
        ...invitationItem,
        status: 'accepted',
        acceptedByUserId: '00000000-0000-4000-8000-000000000902',
        acceptedAt: '2026-03-20T12:15:00.000Z',
      },
      membership: {
        tenantId: '11111111-1111-4111-8111-111111111100',
        tenantName: 'Kancelaria Główna Sp. z o.o.',
        role: 'tenant_member',
        status: 'active',
        validFrom: '2026-03-20T12:15:00.000Z',
        validUntil: null,
      },
      grantedCompanyIds: ['11111111-1111-4111-8111-111111111101'],
      auditEventId: '33333333-3333-4333-8333-333333333303',
    });
    expect(acceptRes.invitation.status).toBe('accepted');

    const revokeReq = RevokeTenantInvitationRequestSchema.parse({
      reason: 'Błędnie wskazany adres e-mail księgowej',
    });
    expect(revokeReq.reason).toContain('adres e-mail');
    expect(() => RevokeTenantInvitationRequestSchema.parse({})).toThrow();

    const revokeRes = RevokeTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: {
        ...invitationItem,
        status: 'revoked',
        revokedAt: '2026-03-20T12:20:00.000Z',
      },
      auditEventId: '33333333-3333-4333-8333-333333333304',
    });
    expect(revokeRes.invitation.status).toBe('revoked');

    const rejectReq = RejectTenantInvitationRequestSchema.parse({
      invitationToken: 'pap_inv_0123456789abcdef0123456789abcdef',
      reason: 'Nie obsługuję tego podmiotu',
    });
    expect(rejectReq.invitationToken).toContain('pap_inv_');

    const rejectRes = RejectTenantInvitationResponseSchema.parse({
      ok: true,
      invitation: {
        ...invitationItem,
        status: 'rejected',
        rejectedAt: '2026-03-20T12:25:00.000Z',
      },
      auditEventId: '33333333-3333-4333-8333-333333333305',
    });
    expect(rejectRes.invitation.status).toBe('rejected');
  });
});
