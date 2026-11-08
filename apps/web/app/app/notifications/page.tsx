import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { readServerSession } from '../../../lib/session';
import {
  getNotificationsAndMcpSnapshot,
  getWorkspaceShellContext,
} from '../../../lib/synthetic-workspace';
import { NotificationsWorkbench } from './notifications-workbench';

export default async function NotificationsPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/notifications"
        pageEyebrow="Powiadomienia e-mail i Skrzynka Sandbox RFC 5322"
        pageTitle="Przypomnienia o terminach podatkowych i podgląd wiadomości"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/notifications"
            screenTitle="Powiadomienia e-mail i Skrzynka Sandbox"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, snap] = await Promise.all([
      getWorkspaceShellContext(session),
      getNotificationsAndMcpSnapshot(session),
    ]);
    return {
      dash,
      snap,
    };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/notifications"
        pageEyebrow="Powiadomienia e-mail i Skrzynka Sandbox RFC 5322"
        pageTitle="Przypomnienia o terminach podatkowych i podgląd wiadomości"
      />
    );
  }

  const { dash, snap } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/notifications"
      pageEyebrow={`Powiadomienia pomocnicze · okres ${session.context.period}`}
      pageTitle="Powiadomienia e-mail i Skrzynka Sandbox RFC 5322"
      pageSubtitle="Zarządzaj wyprzedzeniami przypomnień (7 dni, 2 dni, w dniu terminu), opcją opt-out oraz sprawdzaj na żywo wygenerowane wiadomości ze stopką anty-impersonacyjną."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <NotificationsWorkbench
          period={session.context.period}
          canWrite={dash.activeCompany.grantedActions.includes('write')}
          preferences={snap.preferences}
          outbox={snap.outbox}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
