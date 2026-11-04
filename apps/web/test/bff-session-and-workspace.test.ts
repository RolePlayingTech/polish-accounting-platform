import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { papBffFetch, resolveValidatedApiBaseUrl } from '../lib/api-url.js';
import {
  OIDC_TOKEN_COOKIE_NAME,
  SESSION_CONTEXT_COOKIE_NAME,
  buildSessionCookieOptions,
  parseSessionCookies,
} from '../lib/session.js';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  COMPANY_TENANT_2_ID,
  TENANT_1_ID,
  TENANT_2_ID,
  WorkspaceAccessError,
  addJournalEntryMutation,
  approveAndPostDocumentMutation,
  createOrImportDocumentMutation,
  getDashboardSnapshot,
  getFullLedgerSnapshot,
  getPersonaById,
  listAccessibleCompaniesForSession,
  manageCompanyGrantMutation,
  resetSyntheticWorkspaceForTests,
  verifySessionAccess,
} from '../lib/synthetic-workspace.js';
import { SAMPLE_KSEF_FA3_XML } from '../lib/workspace-types.js';
import type { ActiveWebSession } from '../lib/session.js';

function makeSessionForPersona(
  personaId: 'jan-testowy' | 'marta-ksiegowa' | 'piotr-izolacyjny',
  overrides?: { tenantId?: string; legalEntityId?: string; period?: string },
): ActiveWebSession {
  const persona = getPersonaById(personaId);
  return {
    oidcToken: persona.syntheticOidcToken,
    context: {
      personaId: persona.personaId,
      userId: persona.userId,
      displayName: persona.displayName,
      email: persona.email,
      roleSummaryPl: persona.roleSummaryPl,
      tenantId: overrides?.tenantId ?? persona.tenantId,
      legalEntityId: overrides?.legalEntityId ?? persona.defaultLegalEntityId,
      period: overrides?.period ?? '2026-10',
    },
  };
}

describe('BFF API_BASE_URL security & HttpOnly session cookies', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('enforces closed production API_BASE_URL allowlist and rejects untrusted origins', () => {
    expect(
      resolveValidatedApiBaseUrl({
        apiBaseUrl: 'http://127.0.0.1:4100',
        isProduction: true,
      })?.origin,
    ).toBe('http://127.0.0.1:4100');

    expect(
      resolveValidatedApiBaseUrl({
        apiBaseUrl: 'https://ksiegowosc.roleplayingtech.com',
        isProduction: true,
      })?.origin,
    ).toBe('https://ksiegowosc.roleplayingtech.com');

    for (const untrusted of [
      'http://127.0.0.1:4000',
      'https://evil.example.com',
      'http://169.254.169.254',
      'https://user:secret@ksiegowosc.roleplayingtech.com',
      'https://ksiegowosc.roleplayingtech.com/custom',
    ]) {
      expect(
        resolveValidatedApiBaseUrl({ apiBaseUrl: untrusted, isProduction: true }),
      ).toBeUndefined();
    }
  });

  it('rejects protocol-relative paths and enforces redirect=error & no-store in papBffFetch', async () => {
    const spy = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      papBffFetch('//evil.example.com/steal', {
        apiBaseUrl: 'http://127.0.0.1:4000',
        fetcher: spy,
      }),
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(spy).not.toHaveBeenCalled();

    const okResult = await papBffFetch<{ ok: boolean }>('/api/v1/oidc/personas', {
      apiBaseUrl: 'http://127.0.0.1:4000',
      bearerToken: 'synth-token-12345678',
      fetcher: spy,
    });
    expect(okResult).toEqual({ kind: 'ok', status: 200, data: { ok: true } });
    expect(spy).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:4000/api/v1/oidc/personas'),
      expect.objectContaining({
        cache: 'no-store',
        redirect: 'error',
        headers: expect.objectContaining({
          Authorization: 'Bearer synth-token-12345678',
        }),
      }),
    );
  });

  it('builds strict HttpOnly; SameSite=Lax cookie options and validates session payloads', () => {
    expect(OIDC_TOKEN_COOKIE_NAME).toBe('pap_oidc_token');
    expect(SESSION_CONTEXT_COOKIE_NAME).toBe('pap_session_ctx');

    const devCookie = buildSessionCookieOptions(false);
    expect(devCookie).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: false,
      maxAge: 28_800,
    });

    const prodCookie = buildSessionCookieOptions(true);
    expect(prodCookie.httpOnly).toBe(true);
    expect(prodCookie.secure).toBe(true);

    const validSession = makeSessionForPersona('jan-testowy');
    expect(
      parseSessionCookies({
        oidcToken: validSession.oidcToken,
        sessionContextJson: JSON.stringify(validSession.context),
      }),
    ).toEqual(validSession);

    // Scenariusz negatywny: nieznana persona lub uszkodzony okres rozliczeniowy są odrzucane
    expect(
      parseSessionCookies({
        oidcToken: validSession.oidcToken,
        sessionContextJson: JSON.stringify({
          ...validSession.context,
          period: '2026-13',
        }),
      }),
    ).toBeNull();
  });
});

describe('Synthetic workspace RBAC, tenant isolation, AI human gate & accounting invariants', () => {
  beforeEach(() => {
    resetSyntheticWorkspaceForTests();
  });

  it('enforces hard cross-tenant isolation (403 active_membership_required) when Piotr (Tenant 2) accesses Tenant 1', () => {
    const piotrSession = makeSessionForPersona('piotr-izolacyjny');
    const piotrCompanies = listAccessibleCompaniesForSession(piotrSession);
    expect(piotrCompanies.map((c) => c.legalEntityId)).toEqual([COMPANY_TENANT_2_ID]);
    expect(piotrCompanies[0]?.tenantId).toBe(TENANT_2_ID);

    expect(() =>
      verifySessionAccess(piotrSession, TENANT_1_ID, COMPANY_JDG_KPIR_ID, 'read'),
    ).toThrowError(WorkspaceAccessError);

    try {
      verifySessionAccess(piotrSession, TENANT_1_ID, COMPANY_JDG_KPIR_ID, 'read');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceAccessError);
      const accessErr = error as WorkspaceAccessError;
      expect(accessErr.statusCode).toBe(403);
      expect(accessErr.reasonCode).toBe('active_membership_required');
    }
  });

  it('enforces granular company grants for Marta Księgowa (read-only on Ryczałt, no grant revocation rights)', () => {
    const martaRyczaltSession = makeSessionForPersona('marta-ksiegowa', {
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
    });

    // Odczyt dozwolony na firmie z grantem read
    const company = verifySessionAccess(
      martaRyczaltSession,
      TENANT_1_ID,
      COMPANY_JDG_RYCZALT_ID,
      'read',
    );
    expect(company.grantedActions).toEqual(['read']);

    // Zapis zabroniony (403 explicit_company_grant_required)
    expect(() =>
      verifySessionAccess(martaRyczaltSession, TENANT_1_ID, COMPANY_JDG_RYCZALT_ID, 'write'),
    ).toThrowError(/Brak wymaganego grantu podmiotowego/);

    // Zarządzanie grantami zabronione dla roli księgowej nawet na firmie z grantem write
    const martaKpirSession = makeSessionForPersona('marta-ksiegowa', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
    });
    expect(() =>
      manageCompanyGrantMutation(martaKpirSession, {
        op: 'revoke',
        grantId: 'grant-marta-kpir',
      }),
    ).toThrowError(/wymaga uprawnień właściciela organizacji/);
  });

  it('imports KSeF FA(3) XML as unposted AI proposal, detects SHA-256 duplicates, and posts to KPiR only on human approval', async () => {
    const janSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_JDG_KPIR_ID,
    });

    const beforeDash = getDashboardSnapshot(janSession);
    const initialRevenue = beforeDash.monthlyRevenueGrosze;
    const initialCosts = beforeDash.monthlyKupCostsGrosze;

    const firstImport = await createOrImportDocumentMutation(janSession, {
      mode: 'import_xml_or_csv',
      format: 'fa3_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });
    expect(firstImport.status).toBe('ai_proposal');
    expect(firstImport.isDuplicateSha256).toBe(false);
    expect(firstImport.ksefReferenceNumber).toBe('5213004125-20261016-FA3084-99A1B2-44');

    // Zasada nr 5: sama propozycja AI NIE zmienia ksiąg przed zatwierdzeniem człowieka
    const midDash = getDashboardSnapshot(janSession);
    expect(midDash.monthlyRevenueGrosze).toBe(initialRevenue);
    expect(midDash.monthlyKupCostsGrosze).toBe(initialCosts);

    // Drugi import tego samego pliku XML wykrywa duplikat SHA-256
    const duplicateImport = await createOrImportDocumentMutation(janSession, {
      mode: 'import_xml_or_csv',
      format: 'fa3_xml',
      rawPayload: SAMPLE_KSEF_FA3_XML,
    });
    expect(duplicateImport.isDuplicateSha256).toBe(true);

    // Jawne zatwierdzenie przez człowieka z kwalifikacją 50% VAT / 75% KUP księguje wydatek w KPiR
    const approved = await approveAndPostDocumentMutation(janSession, {
      documentId: firstImport.documentId,
      documentNumber: firstImport.documentNumber,
      counterpartyName: firstImport.counterpartyName,
      counterpartyNip: firstImport.counterpartyNip,
      issueDate: firstImport.issueDate,
      netPln: '2400.00',
      vatPln: '552.00',
      expenseQualification: 'vehicle_mixed_75_col13',
      vatDeductionMode: 'vehicle_mixed_50',
    });
    expect(approved.status).toBe('approved_posted');

    const afterDash = getDashboardSnapshot(janSession);
    // 2400,00 netto + 276,00 nieodliczonego VAT (50% z 552,00) = 2676,00 PLN * 75% = 2007,00 PLN (200 700 gr)
    expect(afterDash.monthlyKupCostsGrosze).toBe(initialCosts + 200_700);
  });

  it('rejects unbalanced double-entry journal lines (Wn !== Ma) and accepts balanced Sp. z o.o. postings', () => {
    const janSpzooSession = makeSessionForPersona('jan-testowy', {
      legalEntityId: COMPANY_SPZOO_ID,
    });

    // Scenariusz negatywny: niezbilansowany dekret (Wn 1000 != Ma 900)
    expect(() =>
      addJournalEntryMutation(janSpzooSession, {
        bookingDate: '2026-10-22',
        documentNumber: 'PK/2026/10/ERR',
        description: 'Niezbilansowany dekret testowy',
        lines: [
          { accountCode: '402', side: 'Wn', amountPln: '1000.00', description: 'Koszt' },
          { accountCode: '130', side: 'Ma', amountPln: '900.00', description: 'Rachunek' },
        ],
      }),
    ).toThrowError(WorkspaceAccessError);

    // Scenariusz pozytywny: zbilansowany dekret Wn === Ma
    const posted = addJournalEntryMutation(janSpzooSession, {
      bookingDate: '2026-10-22',
      documentNumber: 'PK/2026/10/OK',
      description: 'Opłata notarialna opłacona z rachunku bieżącego',
      lines: [
        { accountCode: '402', side: 'Wn', amountPln: '1000.00', description: 'Usługi obce' },
        { accountCode: '130', side: 'Ma', amountPln: '1000.00', description: 'Rachunek bieżący' },
      ],
    });
    expect(posted.totalWnGrosze).toBe(100_000);
    expect(posted.totalMaGrosze).toBe(100_000);

    const ledgerSnap = getFullLedgerSnapshot(janSpzooSession);
    expect(ledgerSnap.trialBalance.isBalanced).toBe(true);
    expect(ledgerSnap.balanceSheet.isBalanced).toBe(true);
  });
});
