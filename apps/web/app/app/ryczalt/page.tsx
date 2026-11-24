import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { StatutoryJpkExportPanel } from '../../../components/statutory-jpk-export-panel';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getRyczaltSnapshot, getWorkspaceShellContext } from '../../../lib/synthetic-workspace';
import {
  getApplicableJpkSnapshot,
  getPeriodCloseSnapshot,
} from '../../../lib/wave2-statutory-and-close';
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

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, ryc, applicableJpk, periodClose] = await Promise.all([
      getWorkspaceShellContext(session),
      getRyczaltSnapshot(session),
      getApplicableJpkSnapshot(session, session.context.period),
      getPeriodCloseSnapshot(session, session.context.period),
    ]);
    return { dash, ryc, applicableJpk, periodClose };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/ryczalt"
        pageEyebrow="Ewidencja przychodów · Ryczałt PPE"
        pageTitle="Ryczałt od przychodów ewidencjonowanych i limit VAT 240 000 PLN"
      />
    );
  }

  const { dash, ryc, applicableJpk, periodClose } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/ryczalt"
      pageEyebrow={`Ryczałt ewidencjonowany · okres ${session.context.period}`}
      pageTitle="Ewidencja przychodów wg stawek i limit zwolnienia VAT 240 000 PLN"
      pageSubtitle="Rozbicie przychodów na stawki ryczałtu (12%, 8,5%, 15% itd.), proporcjonalne odliczenie ZUS i 50% składki zdrowotnej oraz kontrola limitu podmiotowego art. 113 VAT."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
      periodStatus={periodClose.status}
    >
      <div className="space-y-6">
        <RyczaltWorkbench
          key={`${ryc.activeCompany.legalEntityId}:${session.context.period}`}
          activeCompany={ryc.activeCompany}
          accessibleCompanies={dash.accessibleCompanies}
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
        <StatutoryJpkExportPanel
          key={`ryc-jpk-${dash.activeCompany.legalEntityId}:${session.context.period}`}
          period={session.context.period}
          structures={applicableJpk.structures}
          vatActive={applicableJpk.vatActive}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
