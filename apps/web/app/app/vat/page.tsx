import { Card, FieldHelpButton, LegalBasisPanel, MoneyAmount } from '@pap/ui';
import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner, AlertBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import {
  buildVatRegistersForCompany,
  getCompaniesManagementSnapshot,
  getDashboardSnapshot,
  getDocumentsForActiveCompany,
  getFullLedgerSnapshot,
} from '../../../lib/synthetic-workspace';
import { VatRegistersWorkbench, type VatDocumentMarkers } from './vat-workbench';

export default async function VatAndJpkPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/vat"
        pageEyebrow="Podatek od towarów i usług · JPK_V7M(3)"
        pageTitle="Rejestry VAT sprzedaży i zakupów oraz deklaracja JPK_V7M(3)"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard returnTo="/app/vat" screenTitle="Rejestry VAT i JPK_V7M(3)" />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const dash = await getDashboardSnapshot(session);
    const [vat, docs, compSnap, ledgerSnap] = await Promise.all([
      buildVatRegistersForCompany(dash.activeCompany, session.context.period, session),
      getDocumentsForActiveCompany(session),
      getCompaniesManagementSnapshot(session),
      getFullLedgerSnapshot(session),
    ]);
    return { dash, vat, docs, compSnap, ledgerSnap };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/vat"
        pageEyebrow="Podatek od towarów i usług · JPK_V7M(3)"
        pageTitle="Rejestry VAT sprzedaży i zakupów oraz deklaracja JPK_V7M(3)"
      />
    );
  }

  const { dash, vat, docs, compSnap, ledgerSnap } = loaded.data;

  const markersByDocNumber: Record<string, VatDocumentMarkers> = {};
  for (const d of docs) {
    markersByDocNumber[d.documentNumber] = {
      gtuCodes: d.gtuCodes,
      procedureCodes: d.procedureCodes,
    };
  }

  const salesNet23 = vat.salesEntries
    .filter((e) => e.vatRate === '23')
    .reduce((acc, e) => acc + e.netGrosze, 0);
  const salesVat23 = vat.salesEntries
    .filter((e) => e.vatRate === '23')
    .reduce((acc, e) => acc + e.deductibleVatGrosze, 0);
  const purchaseNetTotal = vat.purchaseEntries.reduce((acc, e) => acc + e.netGrosze, 0);

  const jpkBasis = mapDomainExplanationToBasisInfo(
    vat.jpkSummary.explanation,
    `Część deklaracyjna ${vat.jpkSummary.schemaVersion} za ${session.context.period}`,
  );

  return (
    <WorkspaceShell
      activeHref="/app/vat"
      pageEyebrow={`Ewidencja VAT i JPK · okres ${session.context.period}`}
      pageTitle="Rejestry VAT sprzedaży i zakupów oraz deklaracja JPK_V7M(3)"
      pageSubtitle="Ewidencja ze znacznikami KSeF (NrKSeF, OFF, BFK, DI), kodami GTU, rozbiciem 50% VAT od samochodów osobowych i prewalidacją pól P_10–P_62."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
      pageActions={
        <div className="flex items-center gap-1.5">
          <FieldHelpButton help={mustResolveUiFieldHelp('gtu_code')} />
          <FieldHelpButton help={mustResolveUiFieldHelp('vat_50_vehicle')} />
          <FieldHelpButton help={mustResolveUiFieldHelp('ksef_reference')} />
        </div>
      }
    >
      <div className="space-y-6">
        <AlertBanner
          tone="warning"
          title="Wysyłka urzędowa JPK_V7M(3) do Ministerstwa Finansów jest zablokowana w środowisku testowym"
        >
          Ten ekran generuje deterministyczny podgląd pól deklaracyjnych i ewidencyjnych{' '}
          <code className="font-mono">{vat.jpkSummary.schemaVersion}</code> na danych syntetycznych.
          Rzeczywiste złożenie pliku XML na bramkę e-Dokumenty MF wymaga poza tym środowiskiem
          odrębnego podpisu kwalifikowanego, Profilu Zaufanego (ePUAP) albo danych autoryzujących
          osoby fizycznej.
        </AlertBanner>

        <VatRegistersWorkbench
          period={session.context.period}
          salesEntries={vat.salesEntries}
          purchaseEntries={vat.purchaseEntries}
          salesNetTotalGrosze={vat.jpkSummary.salesNetTotalGrosze}
          outputVatExactGrosze={vat.jpkSummary.outputVatExactGrosze}
          inputVatExactGrosze={vat.jpkSummary.inputVatExactGrosze}
          markersByDocNumber={markersByDocNumber}
        />

        <div data-testid="jpk-v7-prevalidation-panel">
          <Card
            as="div"
            eyebrow={`Część deklaracyjna · ${vat.jpkSummary.schemaVersion} (zaokrąglenia art. 63 § 1 OP)`}
            title="Karta pól deklaracji JPK_V7M(3) (P_10 – P_62)"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
                <p className="font-mono text-xs font-semibold text-[#636b66]">
                  P_19 / P_20 (Sprzedaż krajowa 23%)
                </p>
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs text-[#464c48]">
                    Podstawa: <MoneyAmount amount={salesNet23} inGrosze size="sm" />
                  </p>
                  <p className="text-xs text-[#464c48]">
                    Podatek: <MoneyAmount amount={salesVat23} inGrosze size="sm" variant="tax" />
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
                <p className="font-mono text-xs font-semibold text-[#636b66]">
                  P_37 / P_38 (Razem podatek należny)
                </p>
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs text-[#464c48]">
                    P_37:{' '}
                    <MoneyAmount amount={vat.jpkSummary.salesNetTotalGrosze} inGrosze size="sm" />
                  </p>
                  <p className="text-xs font-semibold text-[#191c1a]">
                    P_38:{' '}
                    <MoneyAmount
                      amount={vat.jpkSummary.outputVatRoundedPlnGrosze}
                      inGrosze
                      size="sm"
                      variant="tax"
                    />
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3">
                <p className="font-mono text-xs font-semibold text-[#636b66]">
                  P_42 / P_43 / P_48 (Podatek naliczony)
                </p>
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs text-[#464c48]">
                    P_42 (nabycia): <MoneyAmount amount={purchaseNetTotal} inGrosze size="sm" />
                  </p>
                  <p className="text-xs font-semibold text-[#191c1a]">
                    P_48:{' '}
                    <MoneyAmount
                      amount={vat.jpkSummary.totalInputVatPlnGrosze}
                      inGrosze
                      size="sm"
                      variant="tax"
                    />
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-[#1d5c42] bg-[#e7f1ec]/70 p-3">
                <p className="font-mono text-xs font-semibold text-[#1d5c42]">
                  P_51 (Do wpłaty) / P_53 i P_62 (Do przeniesienia)
                </p>
                <div className="mt-1 space-y-0.5">
                  <p className="text-xs font-semibold text-[#191c1a]">
                    P_51:{' '}
                    <MoneyAmount
                      amount={vat.jpkSummary.taxDueToPayP51Grosze}
                      inGrosze
                      size="sm"
                      variant="tax"
                    />
                  </p>
                  <p className="text-xs text-[#464c48]">
                    P_53 / P_62:{' '}
                    <MoneyAmount
                      amount={vat.jpkSummary.excessInputVatToCarryOverP53Grosze}
                      inGrosze
                      size="sm"
                    />
                  </p>
                </div>
              </div>
            </div>

            <div data-testid="legal-basis-why-drawer" className="mt-4">
              <LegalBasisPanel basis={jpkBasis} />
            </div>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div data-testid="bad-debt-relief-90d-panel">
            <Card
              as="div"
              eyebrow="Art. 89a i 89b ustawy o VAT"
              title="Kontrola ulgi na złe długi (90 dni)"
            >
              <p className="text-xs leading-relaxed text-[#464c48]">
                System monitoruje faktury przeterminowane powyżej 90 dni od terminu płatności (prawo
                wierzyciela do korekty VAT należnego w art. 89a oraz obowiązek dłużnika w art. 89b).
              </p>
            </Card>
          </div>

          <div data-testid="zus-relief-timeline-card">
            <Card as="div" eyebrow="Składki ZUS i zdrowotna" title="Zestawienie ZUS dla profilu">
              <div
                data-testid="health-insurance-calculation-card"
                className="space-y-1 text-xs text-[#464c48]"
              >
                <p>Schemat aktywnej firmy: {dash.activeCompany.zusScheme}</p>
                <p>
                  Razem ZUS DRA:{' '}
                  <MoneyAmount
                    amount={compSnap.zusPreview?.totalZusToPayGrosze ?? 0}
                    inGrosze
                    size="sm"
                    variant="tax"
                  />
                </p>
              </div>
            </Card>
          </div>

          <div data-testid="cit-tax-summary-panel">
            <Card
              as="div"
              eyebrow="Podatek dochodowy CIT / PIT"
              title="Zestawienie zaliczki dochodowej"
            >
              <p className="text-xs text-[#464c48]">
                {dash.incomeTaxLabelPl}:{' '}
                <MoneyAmount
                  amount={
                    dash.activeCompany.profileCode === 'spzoo_pelne_ksiegi'
                      ? ledgerSnap.cit9.advanceDueGrosze
                      : dash.estimatedIncomeTaxGrosze
                  }
                  inGrosze
                  size="sm"
                  variant="tax"
                />
              </p>
            </Card>
          </div>
        </div>

        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
