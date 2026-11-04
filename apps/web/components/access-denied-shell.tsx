import type { AppSurface } from '@pap/ui';
import type { ActiveWebSession } from '../lib/session';
import {
  WorkspaceAccessError,
  listAccessibleCompaniesForSession,
} from '../lib/synthetic-workspace';
import { WorkspaceAccessDeniedCard } from './access-denied-card';
import { AcademyDisclaimerBanner } from './ui-controls';
import { WorkspaceShell } from './workspace-shell';

export type WorkspaceDataLoadResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: unknown };

export function tryLoadWorkspaceData<T>(loader: () => T): WorkspaceDataLoadResult<T> {
  try {
    return { ok: true, data: loader() };
  } catch (error) {
    return { ok: false, error };
  }
}

export interface WorkspaceAccessErrorShellProps {
  session: ActiveWebSession;
  error: unknown;
  activeHref: string;
  pageEyebrow: string;
  pageTitle: string;
  surface?: AppSurface;
}

export function WorkspaceAccessErrorShell({
  activeHref,
  error,
  pageEyebrow,
  pageTitle,
  session,
  surface = 'app',
}: WorkspaceAccessErrorShellProps) {
  const accessibleResult = tryLoadWorkspaceData(() => listAccessibleCompaniesForSession(session));
  const accessibleCompanies = accessibleResult.ok ? accessibleResult.data : [];

  const statusCode = error instanceof WorkspaceAccessError ? error.statusCode : 403;
  const reasonCode = error instanceof WorkspaceAccessError ? error.reasonCode : 'access_denied';
  const messagePl =
    error instanceof WorkspaceAccessError
      ? error.message
      : 'Brak uprawnień do wybranego podmiotu prawnego (403). Przełącz aktywną firmę lub zmień personę OIDC.';

  return (
    <WorkspaceShell
      activeHref={activeHref}
      surface={surface}
      pageEyebrow={pageEyebrow}
      pageTitle={pageTitle}
      sessionContext={session.context}
      activeCompany={null}
      accessibleCompanies={accessibleCompanies}
    >
      <div className="space-y-6">
        <WorkspaceAccessDeniedCard
          statusCode={statusCode}
          reasonCode={reasonCode}
          messagePl={messagePl}
          accessibleCompanies={accessibleCompanies}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
