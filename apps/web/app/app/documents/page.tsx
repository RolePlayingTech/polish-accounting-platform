import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import {
  getDocumentsForActiveCompany,
  getWorkspaceShellContext,
} from '../../../lib/synthetic-workspace';
import { DocumentsWorkbench } from './documents-workbench';

export default async function DocumentsPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/documents"
        pageEyebrow="Obieg dokumentów i KSeF FA(3)"
        pageTitle="Dokumenty źródłowe, import FA(3) i weryfikacja AI"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/documents"
            screenTitle="Obieg dokumentów i import FA(3)"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, documents] = await Promise.all([
      getWorkspaceShellContext(session),
      getDocumentsForActiveCompany(session),
    ]);
    return { dash, documents };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/documents"
        pageEyebrow="Obieg dokumentów i KSeF FA(3)"
        pageTitle="Dokumenty źródłowe, import FA(3) i weryfikacja AI"
      />
    );
  }

  const { dash, documents } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/documents"
      pageEyebrow={`Obieg dokumentów · ${dash.activeCompany.shortName}`}
      pageTitle="Dokumenty źródłowe, e-faktury KSeF FA(3) i kolejka AI"
      pageSubtitle="Wyszukuj faktury, sprawdzaj unikalność skrótu SHA-256, importuj pliki XML FA(3) jednym kliknięciem i przechodź do dwukolumnowego warsztatu Split-View."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <DocumentsWorkbench
          documents={documents}
          period={session.context.period}
          canWrite={dash.activeCompany.grantedActions.includes('write')}
          helpMap={{
            nip: mustResolveUiFieldHelp('nip'),
            ksefReference: mustResolveUiFieldHelp('ksef_reference'),
            gtuCode: mustResolveUiFieldHelp('gtu_code'),
            mpp: mustResolveUiFieldHelp('split_payment_mpp'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
