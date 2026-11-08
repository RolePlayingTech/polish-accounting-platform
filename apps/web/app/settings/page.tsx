import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../components/access-denied-shell';
import { LoginRequiredCard } from '../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../components/ui-controls';
import { WorkspaceShell } from '../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../lib/field-help';
import { readServerSession } from '../../lib/session';
import { getCompaniesManagementSnapshot } from '../../lib/synthetic-workspace';
import { CompaniesWorkbench } from '../app/companies/companies-workbench';

export default async function SettingsPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/settings"
        surface="settings"
        pageEyebrow="Powierzchnia /settings · Administracja organizacją (ADR-003)"
        pageTitle="Ustawienia organizacji (tenanta) i podmiotów"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard returnTo="/settings" screenTitle="Ustawienia organizacji" />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(() => getCompaniesManagementSnapshot(session));
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/settings"
        surface="settings"
        pageEyebrow="Powierzchnia /settings · Administracja organizacją (ADR-003)"
        pageTitle="Ustawienia organizacji (tenanta) i podmiotów"
      />
    );
  }

  const snapshot = loaded.data;
  const zusBasis = snapshot.zusPreview
    ? mapDomainExplanationToBasisInfo(
        snapshot.zusPreview.explanation,
        `Składki ZUS (${snapshot.activeCompany.zusScheme})`,
      )
    : null;

  return (
    <WorkspaceShell
      activeHref="/settings"
      surface="settings"
      pageEyebrow="Powierzchnia /settings · Administracja tenanta (ADR-003)"
      pageTitle="Ustawienia organizacji, profili podatkowych i grantów"
      pageSubtitle="Wyodrębniona powierzchnia administracji tenanta zgodnie z ADR-003 (oddzielona od codziennej księgowości /app oraz technicznej konsoli /platform)."
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
