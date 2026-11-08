import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot, getFullLedgerSnapshot } from '../../../lib/synthetic-workspace';
import { LedgerWorkbench } from './ledger-workbench';

export default async function FullLedgerPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/ledger"
        pageEyebrow="Pełne księgi rachunkowe · Ustawa o rachunkowości"
        pageTitle="Księga główna Sp. z o.o., Dziennik, Bilans, RZiS i CIT"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/ledger"
            screenTitle="Pełna księgowość UoR i CIT dla Sp. z o.o."
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, ledger] = await Promise.all([
      getDashboardSnapshot(session),
      getFullLedgerSnapshot(session),
    ]);
    return { dash, ledger };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/ledger"
        pageEyebrow="Pełne księgi rachunkowe · Ustawa o rachunkowości"
        pageTitle="Księga główna Sp. z o.o., Dziennik, Bilans, RZiS i CIT"
      />
    );
  }

  const { dash, ledger } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/ledger"
      pageEyebrow={`Rachunkowość spółki kapitałowej · okres ${session.context.period}`}
      pageTitle="Pełne księgi rachunkowe UoR, Bilans, RZiS i zaliczka CIT"
      pageSubtitle="Plan kont Zespołów 0–8, dziennik dekretów z kontrolą równowagi Wn === Ma na żywo, zestawienie obrotów i sald, sprawozdania finansowe oraz kalkulacja CIT 9% / 19%."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <LedgerWorkbench
          activeCompany={ledger.activeCompany}
          period={session.context.period}
          canWrite={ledger.activeCompany.grantedActions.includes('write')}
          chartOfAccounts={ledger.chartOfAccounts}
          journalEntries={ledger.journalEntries}
          trialBalance={ledger.trialBalance}
          balanceSheet={ledger.balanceSheet}
          profitAndLoss={ledger.profitAndLoss}
          cit9DueGrosze={ledger.cit9.advanceDueGrosze}
          cit9Basis={mapDomainExplanationToBasisInfo(
            ledger.cit9.explanation,
            'Miesięczna zaliczka CIT-8 (stawka preferencyjna 9%)',
          )}
          cit19DueGrosze={ledger.cit19.advanceDueGrosze}
          cit19Basis={mapDomainExplanationToBasisInfo(
            ledger.cit19.explanation,
            'Miesięczna zaliczka CIT-8 (stawka podstawowa 19%)',
          )}
          helpMap={{
            wnMa: mustResolveUiFieldHelp('double_entry_wn_ma'),
            cit9: mustResolveUiFieldHelp('cit_small_taxpayer_9'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
