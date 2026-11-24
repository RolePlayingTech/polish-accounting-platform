import { getPolishStatutoryHolidaysForYear } from '@pap/domain';
import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { DueVsPaidObligationsCard } from '../../../components/due-vs-paid-obligations-card';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { PeriodClosePanel } from '../../../components/period-close-panel';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot } from '../../../lib/synthetic-workspace';
import {
  getPeriodCloseSnapshot,
  getTaxObligationsDueVsPaidSnapshot,
} from '../../../lib/wave2-statutory-and-close';
import { CalendarWorkbench } from './calendar-workbench';

export default async function TaxCalendarPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/calendar"
        pageEyebrow="Terminarz US / ZUS / KSeF"
        pageTitle="Kalendarz obowiązków podatkowych i składkowych"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/calendar"
            screenTitle="Kalendarz podatkowy, ZUS i KSeF"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, periodClose, dueVsPaid] = await Promise.all([
      getDashboardSnapshot(session),
      getPeriodCloseSnapshot(session, session.context.period),
      getTaxObligationsDueVsPaidSnapshot(session, session.context.period),
    ]);
    return { dash, periodClose, dueVsPaid };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/calendar"
        pageEyebrow="Terminarz US / ZUS / KSeF"
        pageTitle="Kalendarz obowiązków podatkowych i składkowych"
      />
    );
  }

  const { dash, periodClose, dueVsPaid } = loaded.data;
  const yearNum = Number(session.context.period.slice(0, 4)) || 2026;
  const holidaysMap = getPolishStatutoryHolidaysForYear(yearNum);
  const holidaysInYear = [...holidaysMap.entries()]
    .map(([date, name]) => ({ date, name }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const obligations = dash.obligations.map((ob) => ({
    code: ob.code,
    title: ob.title,
    category: ob.category,
    statutoryDueDate: ob.statutoryDueDate,
    effectiveDueDate: ob.effectiveDueDate,
    shiftedDays: ob.shiftedFromNonWorkingDays,
    status: ob.status,
    isPaid: ob.isPaid,
    basis: mapDomainExplanationToBasisInfo(ob.explanation, ob.title),
  }));

  return (
    <WorkspaceShell
      activeHref="/app/calendar"
      pageEyebrow={`Kalendarz ustawowy · okres ${session.context.period}`}
      pageTitle="Kalendarz podatkowy, ZUS i KSeF z przesunięciami świątecznymi"
      pageSubtitle="Terminy ZUS DRA (15. lub 20.), zaliczek PIT/CIT/PPE (20.), JPK_V7M (25.) oraz etapów KSeF 2026 z pełnym uwzględnieniem art. 12 § 5 Ordynacji podatkowej."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
      periodStatus={periodClose.status}
    >
      <div className="space-y-6">
        <DueVsPaidObligationsCard snapshot={dueVsPaid} />

        <PeriodClosePanel
          key={`cal-close-${dash.activeCompany.legalEntityId}:${session.context.period}`}
          companyName={dash.activeCompany.companyName}
          companyNip={dash.activeCompany.nip}
          canWrite={dash.activeCompany.grantedActions.includes('write')}
          initialSnapshot={periodClose}
        />

        <CalendarWorkbench
          key={`${dash.activeCompany.legalEntityId}:${session.context.period}`}
          period={session.context.period}
          canWrite={dash.activeCompany.grantedActions.includes('write')}
          obligations={obligations}
          holidaysInYear={holidaysInYear}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
