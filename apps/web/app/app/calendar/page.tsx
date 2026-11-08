import { getPolishStatutoryHolidaysForYear } from '@pap/domain';
import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot } from '../../../lib/synthetic-workspace';
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

  const loaded = await tryLoadWorkspaceData(() => getDashboardSnapshot(session));
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

  const dash = loaded.data;
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
    >
      <div className="space-y-6">
        <CalendarWorkbench
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
