import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getCompaniesManagementSnapshot } from '../../../lib/synthetic-workspace';
import { CompaniesWorkbench } from './companies-workbench';

export default async function CompaniesPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/companies"
        pageEyebrow="Organizacja i uprawnienia (ADR-003)"
        pageTitle="Podmioty, profile podatkowe i dziennik audytu"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/companies"
            screenTitle="Podmioty, profile podatkowe i audyt"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const snapshot = getCompaniesManagementSnapshot(session);
  const zusBasis = snapshot.zusPreview
    ? mapDomainExplanationToBasisInfo(
        snapshot.zusPreview.explanation,
        `Składki ZUS (${snapshot.activeCompany.zusScheme}) za ${session.context.period}`,
      )
    : null;

  return (
    <WorkspaceShell
      activeHref="/app/companies"
      pageEyebrow="Organizacja, RBAC i audyt (ADR-003)"
      pageTitle="Podmioty prawne, profile podatkowe i uprawnienia"
      pageSubtitle="Zarządzaj firmami w organizacji, konfiguruj formę opodatkowania (KPiR, ryczałt, pełne księgi UoR), deleguj granty dla księgowych i weryfikuj ślad audytowy."
      sessionContext={session.context}
      activeCompany={snapshot.activeCompany}
      accessibleCompanies={snapshot.accessibleCompanies}
    >
      <div className="space-y-6">
        <CompaniesWorkbench
          activeCompany={snapshot.activeCompany}
          accessibleCompanies={snapshot.accessibleCompanies}
          grants={snapshot.grants}
          auditLog={snapshot.auditLog}
          period={session.context.period}
          zusTotalGrosze={snapshot.zusPreview?.totalZusToPayGrosze ?? null}
          zusBasis={zusBasis}
          helpMap={{
            nip: mustResolveUiFieldHelp('nip'),
            taxRegime: mustResolveUiFieldHelp('tax_regime'),
            vatLimit: mustResolveUiFieldHelp('vat_exemption_240k'),
            zusScheme: mustResolveUiFieldHelp('zus_scheme'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
