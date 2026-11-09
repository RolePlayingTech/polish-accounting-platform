import type { AppSurface } from '@pap/ui';
import { isOfflineDemoModeEnabled } from '../lib/api-url';
import { isSyntheticPersonaLoginAllowed } from '../lib/runtime-mode';
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

export async function tryLoadWorkspaceData<T>(
  loader: () => T | Promise<T>,
): Promise<WorkspaceDataLoadResult<T>> {
  try {
    return { ok: true, data: await loader() };
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

export async function WorkspaceAccessErrorShell({
  activeHref,
  error,
  pageEyebrow,
  pageTitle,
  session,
  surface = 'app',
}: WorkspaceAccessErrorShellProps) {
  const accessibleResult = await tryLoadWorkspaceData(() =>
    listAccessibleCompaniesForSession(session),
  );
  const accessibleCompanies = accessibleResult.ok ? accessibleResult.data : [];

  const allowPersonas = isSyntheticPersonaLoginAllowed();
  const statusCode = error instanceof WorkspaceAccessError ? error.statusCode : 403;
  const reasonCode = error instanceof WorkspaceAccessError ? error.reasonCode : 'access_denied';
  const messagePl =
    error instanceof WorkspaceAccessError
      ? error.message
      : allowPersonas
        ? 'Brak uprawnień do wybranego podmiotu prawnego (403). Przełącz aktywną firmę lub zmień personę OIDC.'
        : 'Brak uprawnień do wybranego podmiotu prawnego (403). Przełącz aktywną firmę lub zaloguj się na uprawnione konto.';

  return (
    <WorkspaceShell
      activeHref={activeHref}
      surface={surface}
      pageEyebrow={pageEyebrow}
      pageTitle={pageTitle}
      sessionContext={session.context}
      activeCompany={null}
      accessibleCompanies={accessibleCompanies}
      offlineDemoMode={isOfflineDemoModeEnabled()}
      allowSyntheticLogin={allowPersonas}
    >
      <div className="space-y-6">
        <WorkspaceAccessDeniedCard
          statusCode={statusCode}
          reasonCode={reasonCode}
          messagePl={messagePl}
          accessibleCompanies={accessibleCompanies}
          allowSyntheticLogin={allowPersonas}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
