import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot, getRyczaltSnapshot } from '../../../lib/synthetic-workspace';
import { RyczaltWorkbench } from './ryczalt-workbench';

export default async function RyczaltPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/ryczalt"
        pageEyebrow="Ewidencja przychodów · Ryczałt PPE"
        pageTitle="Ryczałt od przychodów ewidencjonowanych i limit VAT 240 000 PLN"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard returnTo="/app/ryczalt" screenTitle="Ewidencja przychodów (ryczałt)" />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const dash = getDashboardSnapshot(session);
  const ryc = getRyczaltSnapshot(session);

  return (
    <WorkspaceShell
      activeHref="/app/ryczalt"
      pageEyebrow={`Ryczałt ewidencjonowany · okres ${session.context.period}`}
      pageTitle="Ewidencja przychodów wg stawek i limit zwolnienia VAT 240 000 PLN"
      pageSubtitle="Rozbicie przychodów na stawki ryczałtu (12%, 8,5%, 15% itd.), proporcjonalne odliczenie ZUS i 50% składki zdrowotnej oraz kontrola limitu podmiotowego art. 113 VAT."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <RyczaltWorkbench
          activeCompany={ryc.activeCompany}
          period={session.context.period}
          canWrite={ryc.activeCompany.grantedActions.includes('write')}
          entries={ryc.entries}
          ryczaltSummary={ryc.ryczaltSummary}
          vatExemption={ryc.vatExemption}
          zusHealthGrosze={ryc.zusResult.healthContributionGrosze}
          ryczaltBasis={mapDomainExplanationToBasisInfo(
            ryc.ryczaltSummary.explanation,
            'Wyliczenie miesięcznego ryczałtu PPE',
          )}
          vatLimitBasis={mapDomainExplanationToBasisInfo(
            ryc.vatExemption.explanation,
            'Limit zwolnienia podmiotowego VAT (240 000 PLN od 2026 r.)',
          )}
          zusBasis={mapDomainExplanationToBasisInfo(
            ryc.zusResult.explanation,
            'Składka zdrowotna i społeczna ZUS na ryczałcie',
          )}
          helpMap={{
            ryczaltRate: mustResolveUiFieldHelp('ryczalt_rate'),
            vatLimit: mustResolveUiFieldHelp('vat_exemption_240k'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
