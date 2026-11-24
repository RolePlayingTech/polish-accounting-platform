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
  approveAndPostDocumentMutation,
  buildVatRegistersForCompany,
  createOrImportDocumentMutation,
  getDashboardSnapshot,
  getDocumentsForActiveCompany,
  getFinanceSnapshot,
  getFullLedgerSnapshot,
  getKpirSnapshot,
  getPersonaById,
  getRyczaltSnapshot,
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

  it('[P1-1] hard-blocks trailing-dot FQDN & subdomain production KSeF URLs (403) and SSRF / non-HTTPS targets (400)', async () => {
    const session = makeOfflineSession({ legalEntityId: COMPANY_JDG_KPIR_ID, period: '2026-10' });
    const docs = await getDocumentsForActiveCompany(session);
    const docId = docs[0]!.documentId;

    for (const prodUrl of [
      'https://ksef.mf.gov.pl./api/v2/sessions/online',
      'https://sub.ksef.mf.gov.pl/api/v2/sessions/online',
      'https://api-prd.ksef.mf.gov.pl/v2',
      'https://e-deklaracje.mf.gov.pl./submit',
    ]) {
      await expect(
        issueToKsefSandboxMutation(session, {
          documentId: docId,
          environment: 'test',
          confirmHumanSend: true,
          targetEndpointUrl: prodUrl,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        reasonCode: 'ksef_production_endpoint_blocked',
      });
    }

    for (const ssrfOrInvalidUrl of [
      'http://169.254.169.254/latest/meta-data/',
      'http://api-test.ksef.mf.gov.pl/v2',
      'https://attacker.example.com/v2',
      'https://user:secret@api-test.ksef.mf.gov.pl/v2',
    ]) {
      await expect(
        issueToKsefSandboxMutation(session, {
          documentId: docId,
          environment: 'test',
          confirmHumanSend: true,
          targetEndpointUrl: ssrfOrInvalidUrl,
        }),
      ).rejects.toMatchObject({
        statusCode: 400,
        reasonCode: 'invalid_ksef_endpoint',
      });
    }

    const trailingDotAllowedSandbox = await issueToKsefSandboxMutation(session, {
      documentId: docId,
      environment: 'test',
      confirmHumanSend: true,
      targetEndpointUrl: 'https://api-test.ksef.mf.gov.pl./v2',
    });
    expect(trailingDotAllowedSandbox.status).toBe('external_token_not_configured');
  });

  it('[P1-2] scopes explicit period JPK exports, carries P_39 excess VAT into JPK_V7M(3) XML, and resolves KOR originalIssueDate', async () => {
    const sessionOct = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
    });

    // Cross-period export: session is on 2026-10, explicit period is empty 2026-11 -> 422 empty_jpk_register (no Oct row leak)
    await expect(
      exportValidatedJpkXmlMutation(sessionOct, {
        period: '2026-11',
        structureCode: 'JPK_PKPIR(3)',
        purpose: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      reasonCode: 'empty_jpk_register',
    });

    // Post a large 50 000 PLN net (11 500 PLN VAT) purchase in 2026-10 so 2026-11 has P_39 carry-over > 0
    const bigPurchase = await createOrImportDocumentMutation(sessionOct, {
      mode: 'manual',
      documentKind: 'purchase',
      direction: 'purchase',
      documentNumber: 'FZ/BIG/2026/10/01',
      issueDate: '2026-10-15',
      saleDate: '2026-10-15',
      dueDate: '2026-10-28',
      counterpartyName: 'Hurtownia Serwerów Test Sp. z o.o.',
      counterpartyNip: '5261040828',
      description: 'Zakup klastra obliczeniowego',
      netPln: '50000.00',
      vatRate: '23',
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
    });
    await approveAndPostDocumentMutation(sessionOct, {
      documentId: bigPurchase.documentId,
      documentNumber: bigPurchase.documentNumber,
      counterpartyName: bigPurchase.counterpartyName,
      counterpartyNip: bigPurchase.counterpartyNip,
      issueDate: bigPurchase.issueDate,
      netPln: '50000.00',
      vatPln: '11500.00',
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
    });

    const dash = await getDashboardSnapshot(sessionOct);
    const sessionNov = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-11',
    });
    const vatNov = await buildVatRegistersForCompany(dash.activeCompany, '2026-11', sessionNov);
    const expectedP39Pln = Math.round(vatNov.jpkSummary.carryOverFromPreviousPlnGrosze / 100);
    expect(expectedP39Pln).toBeGreaterThan(0);

    const exportedNovV7 = await exportValidatedJpkXmlMutation(sessionOct, {
      period: '2026-11',
      structureCode: 'JPK_V7M(3)',
      purpose: 1,
    });
    expect(exportedNovV7.xmlContent).toContain(`<P_39>${String(expectedP39Pln)}</P_39>`);

    // KOR FA(3) XML resolves originalIssueDate from the referenced original invoice (2026-10-04 != 2026-10-27)
    const origSales = await createOrImportDocumentMutation(sessionOct, {
      mode: 'manual',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FV/ORIG/2026/10/04',
      issueDate: '2026-10-04',
      saleDate: '2026-10-04',
      dueDate: '2026-10-18',
      counterpartyName: 'Odbiorca Projektu Sp. z o.o.',
      counterpartyNip: '5261040828',
      description: 'Usługa wdrożeniowa',
      netPln: '2000.00',
      vatRate: '23',
    });
    const korSales = await createOrImportDocumentMutation(sessionOct, {
      mode: 'manual',
      documentKind: 'correction',
      direction: 'sales',
      isCorrection: true,
      correctedDocumentNumber: origSales.documentNumber,
      correctionReason: 'Rabat jakościowy',
      documentNumber: 'KOR/ORIG/2026/10/27',
      issueDate: '2026-10-27',
      saleDate: '2026-10-04',
      dueDate: '2026-11-10',
      counterpartyName: 'Odbiorca Projektu Sp. z o.o.',
      counterpartyNip: '5261040828',
      description: 'Korekta usługi wdrożeniowej',
      netPln: '-200.00',
      vatRate: '23',
    });
    const korFa3 = await exportInvoiceFa3XmlMutation(sessionOct, korSales.documentId);
    expect(korFa3.xmlContent).toContain(
      '<DataWystFaKorygowanej>2026-10-04</DataWystFaKorygowanej>',
    );
    expect(korFa3.xmlContent).toContain('<NrFaKorygowanej>FV/ORIG/2026/10/04</NrFaKorygowanej>');
  });

  it('[P1-3] blocks closed-period bank statement imports across applySettlements/header periods, preserves multi-period bank history, and marks unreconciled bank items as blocking in readyToClose', async () => {
    const sessionSep = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-09',
    });
    const sessionNov = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-11',
    });

    await closeAccountingPeriodMutation(sessionSep, { confirmClose: true });

    const sepBankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-09-22;2026-09-22;Dostawca Wrześniowy;PL61109010140000071219812874;Zapłata FZ/09;-500,00;PLN;REF-SEP-01',
    ].join('\n');

    // 1. applySettlements: false in closed 2026-09 -> rejected 409 period_closed
    await expect(
      importAndReconcileBankStatementMutation(sessionSep, {
        format: 'csv',
        content: sepBankCsv,
        applySettlements: false,
      }),
    ).rejects.toMatchObject({ statusCode: 409, reasonCode: 'period_closed' });

    // 2. Header on open 2026-11, but CSV contains 2026-09-22 row -> rejected 409 period_closed
    await expect(
      importAndReconcileBankStatementMutation(sessionNov, {
        format: 'csv',
        content: sepBankCsv,
        applySettlements: true,
      }),
    ).rejects.toMatchObject({ statusCode: 409, reasonCode: 'period_closed' });

    // 3. Header on closed 2026-09, but CSV contains open 2026-11-14 row -> allowed AND preserves seeded 2026-03 bank tx
    const finBefore = await getFinanceSnapshot(sessionNov);
    const marTxCountBefore = finBefore.bankTransactions.filter((t) =>
      t.bookingDate.startsWith('2026-03'),
    ).length;
    expect(marTxCountBefore).toBeGreaterThan(0);

    const novUnmatchedBankCsv = [
      'Data księgowania;Data waluty;Kontrahent;Rachunek kontrahenta;Tytuł;Kwota;Waluta;Nr referencyjny',
      '2026-11-14;2026-11-14;Nieznany Dostawca Listopadowy;PL27114020040000300201355387;Przelew bez faktury;-321,00;PLN;REF-NOV-UNMATCHED-01',
    ].join('\n');

    const importedNov = await importAndReconcileBankStatementMutation(sessionSep, {
      format: 'csv',
      content: novUnmatchedBankCsv,
      applySettlements: false,
    });
    expect(importedNov.bankTransactions.some((t) => t.bookingDate.startsWith('2026-03'))).toBe(
      true,
    );
    expect(importedNov.bankTransactions.some((t) => t.bookingDate === '2026-11-14')).toBe(true);

    // 4. Unreconciled 2026-11 bank transaction makes readyToClose: false and status: 'reconciling'
    const novCloseStatus = await getPeriodCloseSnapshot(sessionNov, '2026-11');
    expect(novCloseStatus.checklist.unreconciledBankTransactionsCount).toBeGreaterThanOrEqual(1);
    expect(novCloseStatus.blockingItemsCount).toBeGreaterThanOrEqual(1);
    expect(novCloseStatus.readyToClose).toBe(false);
    expect(novCloseStatus.status).toBe('reconciling');
  });

  it('[P1-R2-1] exports JPK_V7M(3) XML for foreign/B2C noPolishNip sales (np -> K_11/P_11/BRAK) and purchases (NrDostawcy BRAK) without crashing prior/current VAT registers', async () => {
    const sessionOct = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-10',
    });
    const sessionNov = makeOfflineSession({
      legalEntityId: COMPANY_JDG_KPIR_ID,
      period: '2026-11',
    });

    const foreignNpSales = await createOrImportDocumentMutation(sessionOct, {
      mode: 'manual',
      documentKind: 'sales',
      direction: 'sales',
      documentNumber: 'FV/NP/2026/10/01',
      issueDate: '2026-10-12',
      saleDate: '2026-10-12',
      dueDate: '2026-10-26',
      counterpartyName: 'Nordic Cloud Systems AB',
      counterpartyNip: '',
      noPolishNip: true,
      description: 'Usługi doradztwa IT poza terytorium kraju (art. 28b VAT)',
      netPln: '4000.00',
      vatRate: 'np',
    });
    await approveAndPostDocumentMutation(sessionOct, {
      documentId: foreignNpSales.documentId,
      documentNumber: foreignNpSales.documentNumber,
      counterpartyName: foreignNpSales.counterpartyName,
      counterpartyNip: '',
      noPolishNip: true,
      issueDate: foreignNpSales.issueDate,
      netPln: '4000.00',
      vatPln: '0.00',
      expenseQualification: 'none',
      vatDeductionMode: 'full_100',
    });

    const foreignPurchase = await createOrImportDocumentMutation(sessionOct, {
      mode: 'manual',
      documentKind: 'purchase',
      direction: 'purchase',
      documentNumber: 'FZ/BRAK/2026/10/02',
      issueDate: '2026-10-14',
      saleDate: '2026-10-14',
      dueDate: '2026-10-28',
      counterpartyName: 'Dostawca Bez Polskiego NIP',
      counterpartyNip: '',
      noPolishNip: true,
      description: 'Zakup materiałów pomocniczych',
      netPln: '1000.00',
      vatRate: '23',
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
    });
    await approveAndPostDocumentMutation(sessionOct, {
      documentId: foreignPurchase.documentId,
      documentNumber: foreignPurchase.documentNumber,
      counterpartyName: foreignPurchase.counterpartyName,
      counterpartyNip: '',
      noPolishNip: true,
      issueDate: foreignPurchase.issueDate,
      netPln: '1000.00',
      vatPln: '230.00',
      expenseQualification: 'other_expenses_100_col13',
      vatDeductionMode: 'full_100',
    });

    const octV7 = await exportValidatedJpkXmlMutation(sessionOct, {
      period: '2026-10',
      structureCode: 'JPK_V7M(3)',
      purpose: 1,
    });
    expect(octV7.xmlContent).toContain('<NrKontrahenta>BRAK</NrKontrahenta>');
    expect(octV7.xmlContent).toContain('<K_11>4000.00</K_11>');
    expect(octV7.xmlContent).toContain('<P_11>4000</P_11>');
    expect(octV7.xmlContent).toContain('<NrDostawcy>BRAK</NrDostawcy>');

    // Scanning priorPeriods (including 2026-10 with noPolishNip docs) in 2026-11 succeeds without throwing
    const dash = await getDashboardSnapshot(sessionNov);
    const vatNov = await buildVatRegistersForCompany(dash.activeCompany, '2026-11', sessionNov);
    expect(vatNov.jpkSummary.period).toBe('2026-11');
  });

  it('enforces online-mode UI <-> REST <-> MCP tax parity across getRyczaltSnapshot, getKpirSnapshot, and getFullLedgerSnapshot with 0 unpaid ZUS and 0 phantom prior advances ([P1-G6-1])', async () => {
    vi.stubEnv('PAP_WEB_OFFLINE_DEMO_MODE', 'false');
    const oidcToken = 'eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJqYW4tZzYifQ.sig';

    const makeOnlineSession = (legalEntityId: string, period = '2026-03'): ActiveWebSession => {
      const persona = getPersonaById('jan-testowy');
      return {
        authMethod: 'oidc',
        oidcToken,
        context: {
          personaId: persona.personaId,
          userId: persona.userId,
          displayName: persona.displayName,
          email: persona.email,
          roleSummaryPl: persona.roleSummaryPl,
          tenantId: TENANT_1_ID,
          legalEntityId,
          period,
        },
      };
    };

    const makeMockExplanation = (
      calculationType: string,
      summary: string,
      inputs: Record<string, string | number | boolean> = {},
    ) => ({
      calculationType,
      summary,
      eventDate: '2026-03-01',
      appliedRules: [],
      steps: [],
      inputs,
      outputs: {},
      warnings: [],
      requiresHumanApproval: false,
    });

    let spzooAttested = true;

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = input instanceof URL ? input.toString() : String(input);
        const json = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), {
            status,
            headers: { 'content-type': 'application/json' },
          });

        // 1. Settings endpoints
        if (url.includes(`/companies/${COMPANY_JDG_RYCZALT_ID}/settings`)) {
          return json({
            company: {
              tenantId: TENANT_1_ID,
              legalEntityId: COMPANY_JDG_RYCZALT_ID,
              displayName: 'Beta IT Ryczałt JDG',
              nip: '5213004125',
              legalForm: 'jdg',
              taxRegime: 'ryczalt',
              vatStatus: 'zwolniony_podmiotowo',
              zusStage: 'preferencyjny_zus',
              canRead: true,
              canWrite: true,
            },
            taxProfile: {
              profileCode: 'jdg_ryczalt',
              vatStatus: 'zwolniony_podmiotowo',
              vatSettlementPeriod: 'not_applicable',
              zusScheme: 'preferencyjny_zus',
              voluntarySicknessInsurance: false,
              smallTaxpayer: true,
              activityStartDate: '2025-01-01',
            },
          });
        }

        if (url.includes(`/companies/${COMPANY_JDG_KPIR_ID}/settings`)) {
          return json({
            company: {
              tenantId: TENANT_1_ID,
              legalEntityId: COMPANY_JDG_KPIR_ID,
              displayName: 'Alfa Studio KPiR JDG',
              nip: '5250001003',
              legalForm: 'jdg',
              taxRegime: 'kpir_skala',
              vatStatus: 'czynny',
              zusStage: 'duzy_zus',
              canRead: true,
              canWrite: true,
            },
            taxProfile: {
              profileCode: 'jdg_kpir_skala',
              vatStatus: 'czynny',
              vatSettlementPeriod: 'monthly',
              zusScheme: 'duzy_zus',
              voluntarySicknessInsurance: true,
              smallTaxpayer: true,
              activityStartDate: '2024-01-01',
            },
          });
        }

        if (url.includes(`/companies/${COMPANY_SPZOO_ID}/settings`)) {
          return json({
            company: {
              tenantId: TENANT_1_ID,
              legalEntityId: COMPANY_SPZOO_ID,
              displayName: 'Gamma Systemy Sp. z o.o.',
              nip: '5260250995',
              legalForm: 'sp_z_o_o',
              taxRegime: 'pelne_ksiegi_cit',
              vatStatus: 'czynny',
              zusStage: 'not_applicable',
              canRead: true,
              canWrite: true,
            },
            taxProfile: {
              profileCode: 'spzoo_pelne_ksiegi',
              vatStatus: 'czynny',
              vatSettlementPeriod: 'monthly',
              zusScheme: 'not_applicable',
              voluntarySicknessInsurance: false,
              smallTaxpayer: spzooAttested,
              activityStartDate: '2023-01-01',
            },
          });
        }

        // 2. Profile B: Ryczałt (18 000 PLN @ 12%, -1 600 PLN paid ZUS social, 0 paid ZUS health -> 1 968,00 PLN tax)
        if (url.includes(`/companies/${COMPANY_JDG_RYCZALT_ID}/ryczalt?period=2026-03`)) {
          return json({
            period: '2026-03',
            entries: [
              {
                id: 'ryc-2026-03-1',
                ordinalNumber: 1,
                period: '2026-03',
                entryDate: '2026-03-15',
                revenueDate: '2026-03-15',
                documentNumber: 'FS/RYC/2026/03/01',
                counterpartyName: 'Klient B2B Sp. z o.o.',
                counterpartyNip: '5260250995',
                rate: '12',
                revenueGrosze: 1_800_000,
                revenueFormatted: '18 000,00 zł',
                isCorrection: false,
              },
            ],
            monthlySummary: {
              grossRevenueGrosze: 1_800_000,
              grossRevenueFormatted: '18 000,00 zł',
              taxDueRoundedPlnGrosze: 196_800,
              taxDueFormatted: '1 968,00 zł',
              revenueByRate: { '12': 1_800_000 },
              explanation: makeMockExplanation(
                'ryczalt_monthly',
                'Ryczałt 12% po odliczeniu opłaconego ZUS społecznego 1 600,00 zł = 1 968,00 zł.',
              ),
            },
            vatExemptionLimit: {
              limitGrosze: 24_000_000,
              limitFormatted: '240 000,00 zł',
              ytdSalesGrosze: 4_300_000,
              ytdSalesFormatted: '43 000,00 zł',
              remainingLimitGrosze: 19_700_000,
              remainingLimitFormatted: '197 000,00 zł',
              utilizationBps: 1792,
              status: 'within_limit',
              explanation: makeMockExplanation(
                'vat_exemption_limit',
                'Sprzedaż narastająco 43 000,00 zł / 240 000,00 zł.',
              ),
            },
          });
        }

        if (url.includes(`/companies/${COMPANY_JDG_RYCZALT_ID}/taxes/obligations?period=2026-03`)) {
          return json({
            tenantId: TENANT_1_ID,
            legalEntityId: COMPANY_JDG_RYCZALT_ID,
            period: '2026-03',
            profileCode: 'jdg_ryczalt',
            evaluationDate: '2026-03-31',
            bindingForDeclaration: true,
            items: [
              {
                obligationKind: 'zus_social',
                labelPl: 'Składki ZUS społeczne',
                period: '2026-03',
                statutoryDueDate: '2026-04-20',
                accruedGrosze: 45_618,
                accruedFormatted: '456,18 zł',
                paidGrosze: 160_000,
                paidFormatted: '1 600,00 zł',
                remainingGrosze: 0,
                remainingFormatted: '0,00 zł',
                overpaymentGrosze: 114_382,
                status: 'overpaid',
                appliedPaymentIds: ['pay-1'],
              },
              {
                obligationKind: 'zus_health',
                labelPl: 'Składka zdrowotna ZUS (ryczałt)',
                period: '2026-03',
                statutoryDueDate: '2026-04-20',
                accruedGrosze: 49_835,
                accruedFormatted: '498,35 zł',
                paidGrosze: 0,
                paidFormatted: '0,00 zł',
                remainingGrosze: 49_835,
                remainingFormatted: '498,35 zł',
                overpaymentGrosze: 0,
                status: 'accrued_not_yet_due',
                appliedPaymentIds: [],
              },
              {
                obligationKind: 'ryczalt_advance',
                labelPl: 'Ryczałt PPE',
                period: '2026-03',
                statutoryDueDate: '2026-04-20',
                accruedGrosze: 196_800,
                accruedFormatted: '1 968,00 zł',
                paidGrosze: 0,
                paidFormatted: '0,00 zł',
                remainingGrosze: 196_800,
                remainingFormatted: '1 968,00 zł',
                overpaymentGrosze: 0,
                status: 'accrued_not_yet_due',
                appliedPaymentIds: [],
              },
            ],
            verifiedPayments: [],
            totals: {
              totalAccruedGrosze: 292_253,
              totalAccruedFormatted: '2 922,53 zł',
              totalPaidGrosze: 160_000,
              totalPaidFormatted: '1 600,00 zł',
              totalRemainingGrosze: 246_635,
              totalRemainingFormatted: '2 466,35 zł',
            },
            paidSocialZusUsedInTaxBaseGrosze: 160_000,
            paidHealthZusUsedInTaxBaseGrosze: 0,
            citRateDetails: null,
            explanation: makeMockExplanation('profile_b_ryczalt', 'Ryczałt należny 1 968,00 zł.'),
          });
        }

        // 3. Profile A: KPiR (2026-04 period entries = 10 000 PLN, YTD = 40 000 PLN rev / 5 000 PLN costs, 0 paid ZUS, 0 phantom advances)
        if (url.includes(`/companies/${COMPANY_JDG_KPIR_ID}/kpir?period=2026-04`)) {
          return json({
            period: '2026-04',
            layout: '2026',
            regulationVersion: 'pkpir_2026_ksef',
            columns: [],
            entries: [
              {
                id: 'kpir-2026-04-1',
                ordinalNumber: 2,
                period: '2026-04',
                eventDate: '2026-04-10',
                documentNumber: 'FV/2026/04/01',
                counterpartyName: 'Odbiorca Alfa Sp. z o.o.',
                counterpartyAddress: 'ul. Prosta 1, Warszawa',
                eventDescription: 'Usługi doradcze kwiecień',
                col7SalesRevenueGrosze: 1_000_000,
                col8OtherRevenueGrosze: 0,
                col9TotalRevenueGrosze: 1_000_000,
                col10GoodsAndMaterialsGrosze: 0,
                col11IncidentalCostsGrosze: 0,
                col12RemunerationGrosze: 0,
                col13OtherExpensesGrosze: 0,
                col14TotalExpensesGrosze: 0,
                col16ResearchDevelopmentCostGrosze: 0,
                qualificationKind: 'none',
                isCorrection: false,
                regulationVersion: 'pkpir_2026_ksef',
                explanation: makeMockExplanation('kpir_entry', 'Wpis 2026-04'),
              },
            ],
            periodSummary: {
              period: '2026-04',
              col7SalesRevenueGrosze: 1_000_000,
              col8OtherRevenueGrosze: 0,
              col9TotalRevenueGrosze: 1_000_000,
              col10GoodsAndMaterialsGrosze: 0,
              col11IncidentalCostsGrosze: 0,
              col12RemunerationGrosze: 0,
              col13OtherExpensesGrosze: 0,
              col14TotalExpensesGrosze: 0,
              col16ResearchDevelopmentCostGrosze: 0,
              totalTaxDeductibleCostsGrosze: 0,
              incomeOrLossGrosze: 1_000_000,
            },
            ytdSummary: {
              period: '2026-04',
              col7SalesRevenueGrosze: 4_000_000,
              col8OtherRevenueGrosze: 0,
              col9TotalRevenueGrosze: 4_000_000,
              col10GoodsAndMaterialsGrosze: 0,
              col11IncidentalCostsGrosze: 0,
              col12RemunerationGrosze: 0,
              col13OtherExpensesGrosze: 500_000,
              col14TotalExpensesGrosze: 500_000,
              col16ResearchDevelopmentCostGrosze: 0,
              totalTaxDeductibleCostsGrosze: 500_000,
              incomeOrLossGrosze: 3_500_000,
            },
            pitAdvance: {
              period: '2026-04',
              taxForm: 'skala',
              taxBaseRoundedPlnGrosze: 3_500_000,
              advanceDueRoundedPlnGrosze: 60_000,
              advanceDueFormatted: '600,00 zł',
              explanation: makeMockExplanation('kpir_pit_advance', 'Zaliczka PIT skala 600,00 zł', {
                paidSocialZusYtdGrosze: 0,
                paidHealthInsuranceYtdGrosze: 0,
                previousAdvancesPaidYtdGrosze: 0,
              }),
            },
            regimeComparison: null,
          });
        }

        if (url.includes(`/companies/${COMPANY_JDG_KPIR_ID}/taxes/obligations?period=2026-04`)) {
          return json({
            tenantId: TENANT_1_ID,
            legalEntityId: COMPANY_JDG_KPIR_ID,
            period: '2026-04',
            profileCode: 'jdg_kpir_skala',
            evaluationDate: '2026-04-30',
            bindingForDeclaration: true,
            items: [
              {
                obligationKind: 'pit_advance',
                labelPl: 'Zaliczka PIT-36 (skala 12%/32%)',
                period: '2026-04',
                statutoryDueDate: '2026-05-20',
                accruedGrosze: 60_000,
                accruedFormatted: '600,00 zł',
                paidGrosze: 0,
                paidFormatted: '0,00 zł',
                remainingGrosze: 60_000,
                remainingFormatted: '600,00 zł',
                overpaymentGrosze: 0,
                status: 'accrued_not_yet_due',
                appliedPaymentIds: [],
              },
            ],
            verifiedPayments: [],
            totals: {
              totalAccruedGrosze: 60_000,
              totalAccruedFormatted: '600,00 zł',
              totalPaidGrosze: 0,
              totalPaidFormatted: '0,00 zł',
              totalRemainingGrosze: 60_000,
              totalRemainingFormatted: '600,00 zł',
            },
            paidSocialZusUsedInTaxBaseGrosze: 0,
            paidHealthZusUsedInTaxBaseGrosze: 0,
            citRateDetails: null,
            explanation: makeMockExplanation('profile_a_kpir', 'Zaliczka PIT 600,00 zł.'),
          });
        }

        // 4. Profile C: Sp. z o.o. (40 000 PLN taxable income -> CIT 9% = 3 600,00 PLN, CIT 19% = 7 600,00 PLN; 0 phantom prior advances)
        if (url.includes(`/companies/${COMPANY_SPZOO_ID}/ledger?period=2026-03`)) {
          return json({
            period: '2026-03',
            chartOfAccounts: [],
            journalEntries: [],
            trialBalance: {
              rows: [],
              totalTurnoverWnGrosze: 0,
              totalTurnoverMaGrosze: 0,
              totalEndingBalanceWnGrosze: 0,
              totalEndingBalanceMaGrosze: 0,
              isBalanced: true,
            },
            balanceSheet: {
              fixedAssetsGrosze: 0,
              currentAssetsGrosze: 0,
              totalAssetsGrosze: 0,
              totalAssetsFormatted: '0,00 zł',
              equityTotalGrosze: 0,
              liabilitiesAndProvisionsGrosze: 0,
              totalEquityAndLiabilitiesGrosze: 0,
              totalEquityAndLiabilitiesFormatted: '0,00 zł',
              isBalanced: true,
            },
            profitAndLoss: {
              salesRevenueGrosze: 4_000_000,
              operatingCostsGrosze: 0,
              grossFinancialResultGrosze: 4_000_000,
              incomeTaxCitGrosze: 0,
              netFinancialResultGrosze: 4_000_000,
              netFinancialResultFormatted: '40 000,00 zł',
            },
            citAdvance: {
              citRateKind: spzooAttested ? 'small_9' : 'standard_19',
              citRateBps: spzooAttested ? 900 : 1900,
              taxableIncomeGrosze: 4_000_000,
              citAdvanceDueRoundedPlnGrosze: spzooAttested ? 360_000 : 760_000,
              citAdvanceDueFormatted: spzooAttested ? '3 600,00 zł' : '7 600,00 zł',
              explanation: makeMockExplanation(
                'cit_advance',
                spzooAttested ? 'Zaliczka CIT 9% = 3 600,00 zł' : 'Zaliczka CIT 19% = 7 600,00 zł',
              ),
            },
          });
        }

        if (
          url.includes(
            `/companies/${COMPANY_SPZOO_ID}/taxes/obligations?period=2026-03&requestPreferentialCit9Pct=false`,
          )
        ) {
          return json({
            tenantId: TENANT_1_ID,
            legalEntityId: COMPANY_SPZOO_ID,
            period: '2026-03',
            profileCode: 'spzoo_pelne_ksiegi',
            evaluationDate: '2026-03-31',
            bindingForDeclaration: true,
            items: [
              {
                obligationKind: 'cit_advance',
                labelPl: 'Zaliczka CIT-8 (19%)',
                period: '2026-03',
                statutoryDueDate: '2026-04-20',
                accruedGrosze: 760_000,
                accruedFormatted: '7 600,00 zł',
                paidGrosze: 0,
                paidFormatted: '0,00 zł',
                remainingGrosze: 760_000,
                remainingFormatted: '7 600,00 zł',
                overpaymentGrosze: 0,
                status: 'accrued_not_yet_due',
                appliedPaymentIds: [],
              },
            ],
            verifiedPayments: [],
            totals: {
              totalAccruedGrosze: 760_000,
              totalAccruedFormatted: '7 600,00 zł',
              totalPaidGrosze: 0,
              totalPaidFormatted: '0,00 zł',
              totalRemainingGrosze: 760_000,
              totalRemainingFormatted: '7 600,00 zł',
            },
            paidSocialZusUsedInTaxBaseGrosze: 0,
            paidHealthZusUsedInTaxBaseGrosze: 0,
            citRateDetails: {
              operatingAppliedRatePct: 19,
              capitalGainsAppliedRatePct: 19,
              taxYearMonths: 12,
              operatingIncomeYtdGrosze: 4_000_000,
            },
            explanation: makeMockExplanation('cit_19', 'Zaliczka CIT 19% = 7 600,00 zł.'),
          });
        }

        if (
          url.includes(
            `/companies/${COMPANY_SPZOO_ID}/taxes/obligations?period=2026-03&requestPreferentialCit9Pct=true`,
          )
        ) {
          if (!spzooAttested) {
            return json(
              {
                code: 'cit_preferential_attestation_missing',
                message: 'Brak poświadczenia przesłanek 9% CIT.',
              },
              422,
            );
          }
          return json({
            tenantId: TENANT_1_ID,
            legalEntityId: COMPANY_SPZOO_ID,
            period: '2026-03',
            profileCode: 'spzoo_pelne_ksiegi',
            evaluationDate: '2026-03-31',
            bindingForDeclaration: true,
            items: [
              {
                obligationKind: 'cit_advance',
                labelPl: 'Zaliczka CIT-8 (9%)',
                period: '2026-03',
                statutoryDueDate: '2026-04-20',
                accruedGrosze: 360_000,
                accruedFormatted: '3 600,00 zł',
                paidGrosze: 0,
                paidFormatted: '0,00 zł',
                remainingGrosze: 360_000,
                remainingFormatted: '3 600,00 zł',
                overpaymentGrosze: 0,
                status: 'accrued_not_yet_due',
                appliedPaymentIds: [],
              },
            ],
            verifiedPayments: [],
            totals: {
              totalAccruedGrosze: 360_000,
              totalAccruedFormatted: '3 600,00 zł',
              totalPaidGrosze: 0,
              totalPaidFormatted: '0,00 zł',
              totalRemainingGrosze: 360_000,
              totalRemainingFormatted: '3 600,00 zł',
            },
            paidSocialZusUsedInTaxBaseGrosze: 0,
            paidHealthZusUsedInTaxBaseGrosze: 0,
            citRateDetails: {
              operatingAppliedRatePct: 9,
              capitalGainsAppliedRatePct: 19,
              taxYearMonths: 12,
              operatingIncomeYtdGrosze: 4_000_000,
            },
            explanation: makeMockExplanation('cit_9', 'Zaliczka CIT 9% = 3 600,00 zł.'),
          });
        }

        return json({ code: 'not_found', message: `Unhandled URL: ${url}` }, 404);
      }),
    );

    // A. Ryczałt (/app/ryczalt): 1 968,00 PLN (196_800 gr), 0 unpaid health deducted, YTD = 43 000,00 PLN
    const ryczaltSnap = await getRyczaltSnapshot(
      makeOnlineSession(COMPANY_JDG_RYCZALT_ID, '2026-03'),
    );
    expect(ryczaltSnap.ryczaltSummary.taxDueGrosze).toBe(196_800);
    expect(ryczaltSnap.ryczaltSummary.breakdownByRate[0]?.allocatedSocialDeductionGrosze).toBe(
      160_000,
    );
    expect(ryczaltSnap.ryczaltSummary.breakdownByRate[0]?.allocatedHealthDeductionGrosze).toBe(0);
    expect(ryczaltSnap.vatExemption.cumulativeNetSalesAfterGrosze).toBe(4_300_000);
    expect(ryczaltSnap.zusResult.healthContributionGrosze).toBe(49_835);

    // B. KPiR (/app/kpir): month = 10 000 PLN, YTD = 40 000 PLN rev / 5 000 PLN costs, 0 unpaid ZUS, 0 phantom advances
    // Skala: (35 000 * 12% - 3 600) = 600,00 PLN (60_000 gr); Liniowy: 35 000 * 19% = 6 650,00 PLN (665_000 gr)
    const kpirSnap = await getKpirSnapshot(makeOnlineSession(COMPANY_JDG_KPIR_ID, '2026-04'));
    expect(kpirSnap.summary.monthTotals.col9TotalRevenueGrosze).toBe(1_000_000);
    expect(kpirSnap.summary.yearToDateTotals.col9TotalRevenueGrosze).toBe(4_000_000);
    expect(kpirSnap.summary.yearToDateTotals.totalTaxDeductibleCostsGrosze).toBe(500_000);
    expect(kpirSnap.pitSkala.advanceDueGrosze).toBe(60_000);
    expect(kpirSnap.pitLiniowy.advanceDueGrosze).toBe(665_000);

    // C1. Sp. z o.o. attested (/app/ledger): CIT 9% = 3 600,00 PLN (360_000 gr), CIT 19% = 7 600,00 PLN (760_000 gr)
    const ledgerAttested = await getFullLedgerSnapshot(
      makeOnlineSession(COMPANY_SPZOO_ID, '2026-03'),
    );
    expect(ledgerAttested.cit9.advanceDueGrosze).toBe(360_000);
    expect(ledgerAttested.cit19.advanceDueGrosze).toBe(760_000);

    // C2. Sp. z o.o. unattested (/app/ledger): 422 on requestPreferentialCit9Pct=true does not crash page; CIT 19% = 7 600,00 PLN & warning attached
    spzooAttested = false;
    const ledgerUnattested = await getFullLedgerSnapshot(
      makeOnlineSession(COMPANY_SPZOO_ID, '2026-03'),
    );
    expect(ledgerUnattested.cit19.advanceDueGrosze).toBe(760_000);
    expect(ledgerUnattested.cit9.advanceDueGrosze).toBe(360_000);
    expect(
      ledgerUnattested.cit9.explanation.warnings.some(
        (w) => w.code === 'CIT_9_PCT_ATTESTATION_REQUIRED',
      ),
    ).toBe(true);
  });
});
