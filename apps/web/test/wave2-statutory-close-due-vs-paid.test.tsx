import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateKsefNumber } from '@pap/domain';
import { DueVsPaidObligationsCard } from '../components/due-vs-paid-obligations-card.js';
import { KsefSandboxPanel } from '../components/ksef-sandbox-panel.js';
import { PeriodClosePanel } from '../components/period-close-panel.js';
import { StatutoryJpkExportPanel } from '../components/statutory-jpk-export-panel.js';
import { formatUserFacingErrorPl } from '../lib/error-messages-pl.js';
import type { ActiveWebSession } from '../lib/session.js';
import {
  COMPANY_JDG_KPIR_ID,
  COMPANY_JDG_RYCZALT_ID,
  COMPANY_SPZOO_ID,
  TENANT_1_ID,
  WorkspaceAccessError,
  addJournalEntryMutation,
  addManualKpirEntryMutation,
  addRyczaltEntryMutation,
  getDocumentsForActiveCompany,
  getFullLedgerSnapshot,
  getPersonaById,
  importAndReconcileBankStatementMutation,
  resetSyntheticWorkspaceForTests,
} from '../lib/synthetic-workspace.js';
import {
  archiveSourceDocumentWormMutation,
  closeAccountingPeriodMutation,
  exportInvoiceFa3XmlMutation,
  exportValidatedJpkXmlMutation,
  getApplicableJpkSnapshot,
  getKsefSandboxStatusSnapshot,
  getPeriodCloseSnapshot,
  getTaxObligationsDueVsPaidSnapshot,
  issueToKsefSandboxMutation,
  resetWave2FallbackStoreForTests,
  syncIncomingKsefSandboxMutation,
} from '../lib/wave2-statutory-and-close.js';
import { SAMPLE_BANK_CSV } from '../lib/workspace-types.js';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
  }),
}));

function makeOfflineSession(overrides?: {
  readonly legalEntityId?: string;
  readonly period?: string;
}): ActiveWebSession {
  const persona = getPersonaById('jan-testowy');
  return {
    oidcToken: persona.syntheticOidcToken,
    context: {
      personaId: persona.personaId,
      userId: persona.userId,
      displayName: persona.displayName,
      email: persona.email,
      roleSummaryPl: persona.roleSummaryPl,
      tenantId: TENANT_1_ID,
      legalEntityId: overrides?.legalEntityId ?? COMPANY_JDG_KPIR_ID,
      period: overrides?.period ?? '2026-10',
    },
  };
}

describe('Wave 2: Statutory JPK XSD exports, FA(3) & KSeF 2.0 Sandbox, WORM Archive, Period Close (#116), Due-vs-Paid (#81), and Bank->GL 130 (#111)', () => {
  beforeEach(() => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'true');
    vi.stubEnv('PAP_ALLOW_SYNTHETIC_OFFLINE_DEMO', 'true');
    resetSyntheticWorkspaceForTests();
    resetWave2FallbackStoreForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('resolves temporal JPK structures (#98, GLD-11) and generates XSD-aligned XML without fake UPO claims', async () => {
    const kpirOct = makeOfflineSession({ legalEntityId: COMPANY_JDG_KPIR_ID, period: '2026-10' });
    const kpirJan = makeOfflineSession({ legalEntityId: COMPANY_JDG_KPIR_ID, period: '2026-01' });
    const ryczaltOct = makeOfflineSession({
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      period: '2026-10',
    });
    const spzooOct = makeOfflineSession({ legalEntityId: COMPANY_SPZOO_ID, period: '2026-10' });

    const appOct = await getApplicableJpkSnapshot(kpirOct);
    expect(appOct.structures.map((s) => s.structureCode)).toContain('JPK_V7M(3)');
    expect(appOct.structures.map((s) => s.structureCode)).toContain('JPK_PKPIR(3)');

    const appJan = await getApplicableJpkSnapshot(kpirJan);
    expect(appJan.structures.map((s) => s.structureCode)).toContain('JPK_V7M(2)');
    expect(appJan.structures.map((s) => s.structureCode)).not.toContain('JPK_V7M(3)');

    const appRyc = await getApplicableJpkSnapshot(ryczaltOct);
    expect(appRyc.vatActive).toBe(false);
    expect(appRyc.structures.map((s) => s.structureCode)).toContain('JPK_EWP(4)');
    expect(appRyc.structures.some((s) => s.structureCode.startsWith('JPK_V7'))).toBe(false);

    const appSpzoo = await getApplicableJpkSnapshot(spzooOct);
    expect(appSpzoo.structures.map((s) => s.structureCode)).toEqual(
      expect.arrayContaining(['JPK_V7M(3)', 'JPK_KR_PD(1)', 'JPK_ST_KR(1)']),
    );

    const v7m3 = await exportValidatedJpkXmlMutation(kpirOct, {
      structureCode: 'JPK_V7M(3)',
      purpose: 1,
    });
    expect(v7m3.submissionStatus).toBe('local_xml_only_not_submitted');
    expect(v7m3.officialUpoReferenceNumber).toBeNull();
    expect(v7m3.xmlContent).toContain('http://crd.gov.pl/wzor/2025/12/19/14090/');
    expect(v7m3.xmlContent).toContain('<KodFormularza kodSystemowy="JPK_V7M (3)"');
    expect(v7m3.xmlSha256Hex).toMatch(/^[0-9a-f]{64}$/);

    const pkpir3 = await exportValidatedJpkXmlMutation(kpirOct, {
      structureCode: 'JPK_PKPIR(3)',
      purpose: 1,
    });
    expect(pkpir3.xmlContent).toContain('http://jpk.mf.gov.pl/wzor/2024/10/30/10302/');

    const ewp4 = await exportValidatedJpkXmlMutation(ryczaltOct, {
      structureCode: 'JPK_EWP(4)',
      purpose: 1,
    });
    expect(ewp4.xmlContent).toContain('http://jpk.mf.gov.pl/wzor/2024/10/30/10301/');

    const krPd1 = await exportValidatedJpkXmlMutation(spzooOct, {
      structureCode: 'JPK_KR_PD(1)',
      purpose: 1,
    });
    expect(krPd1.xmlContent).toContain('http://jpk.mf.gov.pl/wzor/2024/09/04/09041/');
    expect(krPd1.xmlContent).toContain('<ZOiS7>');
  });

  it('exports FA(3) XML, enforces KSeF 2.0 production hard-block (403) + human confirmation, and deduplicates WORM archive (#82, #99, GLD-09, GLD-10)', async () => {
    const session = makeOfflineSession({ legalEntityId: COMPANY_JDG_KPIR_ID, period: '2026-10' });
    const docs = await getDocumentsForActiveCompany(session);
    const firstDoc = docs[0]!;

    const fa3 = await exportInvoiceFa3XmlMutation(session, firstDoc.documentId);
    expect(fa3.schemaVersion).toBe('FA(3)');
    expect(fa3.targetNamespace).toBe('http://crd.gov.pl/wzor/2025/06/25/13775/');
    expect(fa3.submissionStatus).toBe('local_xml_only_not_submitted');
    expect(fa3.xmlContent).toContain('<KodFormularza kodSystemowy="FA (3)"');

    await expect(
      issueToKsefSandboxMutation(session, {
        documentId: firstDoc.documentId,
        environment: 'local_mock',
        confirmHumanSend: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      reasonCode: 'human_confirmation_required',
    });

    await expect(
      issueToKsefSandboxMutation(session, {
        documentId: firstDoc.documentId,
        environment: 'test',
        confirmHumanSend: true,
        targetEndpointUrl: 'https://ksef.mf.gov.pl/api/v2/sessions/online',
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
      reasonCode: 'ksef_production_endpoint_blocked',
    });

    const testEnvResult = await issueToKsefSandboxMutation(session, {
      documentId: firstDoc.documentId,
      environment: 'test',
      confirmHumanSend: true,
    });
    expect(testEnvResult.liveExternalSubmitted).toBe(false);
    expect(testEnvResult.status).toBe('external_token_not_configured');
    expect(testEnvResult.officialUpoReferenceNumber).toBeNull();
    expect(testEnvResult.messagePl).toContain('NOT RUN');

    const mockResult = await issueToKsefSandboxMutation(session, {
      documentId: firstDoc.documentId,
      environment: 'local_mock',
      confirmHumanSend: true,
    });
    expect(mockResult.status).toBe('mock_simulated_local_only');
    expect(mockResult.officialUpoReferenceNumber).toBeNull();
    expect(mockResult.syntheticReferenceNumber).toBeTruthy();
    expect(validateKsefNumber(mockResult.syntheticReferenceNumber!).valid).toBe(true);

    const syncRes = await syncIncomingKsefSandboxMutation(session, { environment: 'local_mock' });
    expect(syncRes.liveExternalConnected).toBe(false);
    expect(syncRes.syncedInvoicesCount).toBeGreaterThanOrEqual(1);

    const archived = await archiveSourceDocumentWormMutation(session, {
      fileName: 'nota-ksiegowa-10-2026.pdf',
      mimeType: 'application/pdf',
      content: 'NOTA KSIEGOWA NR 10/2026 KWOTA 350.00 PLN',
    });
    expect(archived.sha256Hex).toMatch(/^[0-9a-f]{64}$/);

    await expect(
      archiveSourceDocumentWormMutation(session, {
        fileName: 'duplikat-noty.pdf',
        mimeType: 'application/pdf',
        content: 'NOTA KSIEGOWA NR 10/2026 KWOTA 350.00 PLN',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      reasonCode: 'duplicate_document_sha256',
    });
  });

  it('closes accounting period (#116, GLD-08) and rejects retroactive writes with 409 period_closed while keeping open periods writable', async () => {
    const sessionOct = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
    });

    const beforeClose = await getPeriodCloseSnapshot(sessionOct);
    expect(beforeClose.status).not.toBe('closed');

    await expect(
      closeAccountingPeriodMutation(sessionOct, {
        confirmClose: false,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      reasonCode: 'human_confirmation_required',
    });

    const afterClose = await closeAccountingPeriodMutation(sessionOct, {
      confirmClose: true,
      note: 'Zamknięcie miesiąca testowego 2026-10 po uzgodnieniu rejestrów',
    });
    expect(afterClose.status).toBe('closed');
    expect(afterClose.closeNote).toContain('Zamknięcie miesiąca testowego');

    await expect(
      addManualKpirEntryMutation(sessionOct, {
        eventDate: '2026-10-28',
        documentNumber: 'DW/RETRO/01',
        counterpartyName: 'Kontrahent Wsteczny',
        counterpartyNip: '',
        counterpartyAddress: 'Warszawa',
        eventDescription: 'Próba dopisania kosztu do zamkniętego miesiąca',
        salesPln: '0.00',
        otherExpensesPln: '500.00',
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessError);

    await expect(
      addManualKpirEntryMutation(sessionOct, {
        eventDate: '2026-10-28',
        documentNumber: 'DW/RETRO/01',
        counterpartyName: 'Kontrahent Wsteczny',
        counterpartyNip: '',
        counterpartyAddress: 'Warszawa',
        eventDescription: 'Próba dopisania kosztu do zamkniętego miesiąca',
        salesPln: '0.00',
        otherExpensesPln: '500.00',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      reasonCode: 'period_closed',
    });

    const sessionNov = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-11',
    });
    const novEntry = await addManualKpirEntryMutation(sessionNov, {
      eventDate: '2026-11-05',
      documentNumber: 'DW/OPEN/11',
      counterpartyName: 'Kontrahent Listopadowy',
      counterpartyNip: '',
      counterpartyAddress: 'Kraków',
      eventDescription: 'Bieżący koszt w otwartym okresie listopadowym',
      salesPln: '0.00',
      otherExpensesPln: '250.00',
    });
    expect(novEntry.documentNumber).toBe('DW/OPEN/11');

    // Również ryczałt i dziennik pełnych ksiąg respektują zamknięcie okresu
    const rycSession = makeOfflineSession({
      legalEntityId: COMPANY_JDG_RYCZALT_ID,
      period: '2026-10',
    });
    await closeAccountingPeriodMutation(rycSession, { confirmClose: true });
    await expect(
      addRyczaltEntryMutation(rycSession, {
        revenueDate: '2026-10-25',
        documentNumber: 'FV/RYC/CLOSED',
        counterpartyNip: '',
        rate: 12,
        revenuePln: '1000.00',
        remarks: 'Test blokady ryczałtu',
      }),
    ).rejects.toMatchObject({ statusCode: 409, reasonCode: 'period_closed' });

    const spzooSession = makeOfflineSession({
      legalEntityId: COMPANY_SPZOO_ID,
      period: '2026-10',
    });
    await closeAccountingPeriodMutation(spzooSession, { confirmClose: true });
    await expect(
      addJournalEntryMutation(spzooSession, {
        documentNumber: 'PK/CLOSED/01',
        documentDate: '2026-10-25',
        bookingDate: '2026-10-25',
        description: 'Dekret wsteczny w zamkniętym okresie',
        lines: [
          { accountCode: '402', side: 'Wn', amountPln: '100.00', description: 'Koszt' },
          { accountCode: '202', side: 'Ma', amountPln: '100.00', description: 'Rozrachunek' },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 409, reasonCode: 'period_closed' });
  });

  it('separates accrued vs confirmed paid obligations (#81) and reconciles Sp. z o.o. bank statements into GL Account 130 (#111)', async () => {
    const kpirSession = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
    });
    const dueVsPaid = await getTaxObligationsDueVsPaidSnapshot(kpirSession);
    expect(dueVsPaid.totalAccruedGrosze).toBeGreaterThan(0);
    expect(dueVsPaid.totalRemainingUnpaidGrosze).toBe(
      dueVsPaid.totalAccruedGrosze - dueVsPaid.totalConfirmedPaidGrosze,
    );
    expect(dueVsPaid.rows.map((r) => r.kind)).toEqual(
      expect.arrayContaining(['zus_social', 'zus_health', 'pit_advance', 'vat_settlement']),
    );

    const spzooSession = makeOfflineSession({
      legalEntityId: COMPANY_SPZOO_ID,
      period: '2026-10',
    });
    const spzooTaxes = await getTaxObligationsDueVsPaidSnapshot(spzooSession);
    expect(spzooTaxes.rows.some((r) => r.kind === 'cit_advance')).toBe(true);

    const ledgerBefore = await getFullLedgerSnapshot(spzooSession);
    const bankVouchersBefore = ledgerBefore.journalEntries.filter((je) =>
      je.documentNumber.startsWith('WB/'),
    ).length;

    await importAndReconcileBankStatementMutation(spzooSession, {
      format: 'csv',
      content: SAMPLE_BANK_CSV,
      applySettlements: true,
    });

    const ledgerAfter = await getFullLedgerSnapshot(spzooSession);
    const bankVouchersAfter = ledgerAfter.journalEntries.filter((je) =>
      je.documentNumber.startsWith('WB/'),
    );
    expect(bankVouchersAfter.length).toBeGreaterThanOrEqual(bankVouchersBefore);
    const acc130 = ledgerAfter.trialBalance.rows.find((r) => r.accountCode === '130');
    expect(acc130).toBeDefined();
    expect(acc130!.turnoverWnGrosze + acc130!.turnoverMaGrosze).toBeGreaterThan(0);
  });

  it('renders Wave 2 panels with truthful Polish labels and translates domain error codes without raw dumps', async () => {
    const session = makeOfflineSession({ legalEntityId: COMPANY_JDG_KPIR_ID, period: '2026-10' });
    const [jpk, ksefStatus, docs, closeSnap, dueVsPaid] = await Promise.all([
      getApplicableJpkSnapshot(session),
      getKsefSandboxStatusSnapshot(session),
      getDocumentsForActiveCompany(session),
      getPeriodCloseSnapshot(session),
      getTaxObligationsDueVsPaidSnapshot(session),
    ]);

    const jpkHtml = renderToStaticMarkup(
      <StatutoryJpkExportPanel
        period="2026-10"
        structures={jpk.structures}
        vatActive={jpk.vatActive}
      />,
    );
    expect(jpkHtml).toContain('JPK_V7M(3)');
    expect(jpkHtml).toContain('nigdy nie nadaje fikcyjnego numeru UPO');

    const ksefHtml = renderToStaticMarkup(
      <KsefSandboxPanel
        companyName="Pracownia Projektowa Jan Testowy"
        companyNip="5250001003"
        period="2026-10"
        canWrite={true}
        status={ksefStatus}
        documents={docs}
      />,
    );
    expect(ksefHtml).toContain('ksef.mf.gov.pl zablokowany 403');
    expect(ksefHtml).toContain('NOT_RUN');

    const closeHtml = renderToStaticMarkup(
      <PeriodClosePanel
        companyName="Pracownia Projektowa Jan Testowy"
        companyNip="5250001003"
        canWrite={true}
        initialSnapshot={closeSnap}
      />,
    );
    expect(closeHtml).toContain('Zamknij okres 2026-10');

    const dueHtml = renderToStaticMarkup(<DueVsPaidObligationsCard snapshot={dueVsPaid} />);
    expect(dueHtml).toContain('Naliczone vs Faktycznie opłacone');

    expect(formatUserFacingErrorPl({ status: 409, reasonCode: 'period_closed' })).toContain(
      'zamknięty',
    );
    expect(
      formatUserFacingErrorPl({ status: 403, reasonCode: 'ksef_production_endpoint_blocked' }),
    ).toContain('zablokowane');
  });
});
