import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { DueVsPaidObligationsCard } from '../../../components/due-vs-paid-obligations-card';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getFinanceSnapshot, getWorkspaceShellContext } from '../../../lib/synthetic-workspace';
import {
  getPeriodCloseSnapshot,
  getTaxObligationsDueVsPaidSnapshot,
} from '../../../lib/wave2-statutory-and-close';
import { FinanceWorkbench } from './finance-workbench';

export default async function FinancePage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/finance"
        pageEyebrow="Rozrachunki, Biała Lista KAS i bankowość"
        pageTitle="Należności, zobowiązania i uzgadnianie wyciągów CSV / MT940"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/finance"
            screenTitle="Rozrachunki i wyciągi bankowe CSV / MT940"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, fin, dueVsPaid, periodClose] = await Promise.all([
      getWorkspaceShellContext(session),
      getFinanceSnapshot(session),
      getTaxObligationsDueVsPaidSnapshot(session, session.context.period),
      getPeriodCloseSnapshot(session, session.context.period),
    ]);
    return { dash, fin, dueVsPaid, periodClose };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/finance"
        pageEyebrow="Rozrachunki, Biała Lista KAS i bankowość"
        pageTitle="Należności, zobowiązania i uzgadnianie wyciągów CSV / MT940"
      />
    );
  }

  const { dash, fin, dueVsPaid, periodClose } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/finance"
      pageEyebrow={`Rozrachunki i bank · stan na ${fin.asOfDate}`}
      pageTitle="Należności, zobowiązania, Biała Lista KAS i wyciągi bankowe"
      pageSubtitle="Wiekowanie faktur sprzedaży i zakupu, kontrola rachunków w Wykazie KAS i obowiązku MPP oraz deterministyczne parowanie przelewów CSV/MT940."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
      periodStatus={periodClose.status}
    >
      <div className="space-y-6">
        <FinanceWorkbench
          key={`${dash.activeCompany.legalEntityId}:${session.context.period}`}
          openDocuments={fin.openDocuments}
          bankTransactions={fin.bankTransactions}
          reconciliationMatches={fin.reconciliationMatches}
          asOfDate={fin.asOfDate}
          canWrite={fin.activeCompany.grantedActions.includes('write')}
          helpMap={{
            whitelistIban: mustResolveUiFieldHelp('whitelist_iban'),
            mpp: mustResolveUiFieldHelp('split_payment_mpp'),
          }}
        />
        <DueVsPaidObligationsCard snapshot={dueVsPaid} />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
