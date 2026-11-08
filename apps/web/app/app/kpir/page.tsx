import {
  WorkspaceAccessErrorShell,
  tryLoadWorkspaceData,
} from '../../../components/access-denied-shell';
import { LoginRequiredCard } from '../../../components/login-required-card';
import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapDomainExplanationToBasisInfo, mustResolveUiFieldHelp } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot, getKpirSnapshot } from '../../../lib/synthetic-workspace';
import { KpirWorkbench } from './kpir-workbench';

export default async function KpirPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/kpir"
        pageEyebrow="Księgowość JDG · PKPiR 2026 / 2019"
        pageTitle="Podatkowa Księga Przychodów i Rozchodów (KPiR)"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/kpir"
            screenTitle="Podatkowa Księga Przychodów i Rozchodów"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, kpir] = await Promise.all([
      getDashboardSnapshot(session),
      getKpirSnapshot(session),
    ]);
    return { dash, kpir };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/kpir"
        pageEyebrow="Księgowość JDG · PKPiR 2026 / 2019"
        pageTitle="Podatkowa Księga Przychodów i Rozchodów (KPiR)"
      />
    );
  }

  const { dash, kpir } = loaded.data;
  const rows = kpir.entries.map((entry) => ({
    entry,
    basis: mapDomainExplanationToBasisInfo(
      entry.explanation,
      `KPiR Lp. ${String(entry.ordinalNumber)} · ${entry.documentNumber}`,
    ),
  }));

  return (
    <WorkspaceShell
      activeHref="/app/kpir"
      pageEyebrow={`Ewidencja podatkowa JDG · okres ${session.context.period}`}
      pageTitle="Podatkowa Księga Przychodów i Rozchodów (19 kolumn KSeF 2026 / 17 kolumn)"
      pageSubtitle="Pełna ewidencja przychodów i kosztów KUP z kolumną numeru KSeF wg Dz.U. 2025 poz. 1299, porównaniem zaliczki PIT (skala vs liniowy 19%) oraz wyjaśnieniem każdego wiersza."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <KpirWorkbench
          activeCompany={kpir.activeCompany}
          period={session.context.period}
          canWrite={kpir.activeCompany.grantedActions.includes('write')}
          rows={rows}
          summary={kpir.summary}
          layout2026={kpir.layout2026}
          layout2019={kpir.layout2019}
          pitSkalaDueGrosze={kpir.pitSkala.advanceDueGrosze}
          pitSkalaBasis={mapDomainExplanationToBasisInfo(
            kpir.pitSkala.explanation,
            'Zaliczka miesięczna PIT — skala podatkowa (art. 44 ust. 3 PIT)',
          )}
          pitLiniowyDueGrosze={kpir.pitLiniowy.advanceDueGrosze}
          pitLiniowyBasis={mapDomainExplanationToBasisInfo(
            kpir.pitLiniowy.explanation,
            'Zaliczka miesięczna PIT — podatek liniowy 19% (art. 44 ust. 3f PIT)',
          )}
          helpMap={{
            ksefReference: mustResolveUiFieldHelp('ksef_reference'),
            col7: mustResolveUiFieldHelp('kpir_col_7'),
            col13: mustResolveUiFieldHelp('kpir_col_13'),
          }}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
