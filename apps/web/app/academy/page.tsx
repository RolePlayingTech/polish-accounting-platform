import { ACADEMY_COURSE, ACADEMY_GLOSSARY_TERMS, ACADEMY_MODULES } from '@pap/domain/academy';
import { AcademyDisclaimerBanner } from '../../components/ui-controls';
import { WorkspaceShell } from '../../components/workspace-shell';
import { readServerSession } from '../../lib/session';
import { getDashboardSnapshot } from '../../lib/synthetic-workspace';
import { AcademyCatalogClient } from './academy-catalog-client';

export default async function AcademyHomePage() {
  const session = await readServerSession();
  let dash: Awaited<ReturnType<typeof getDashboardSnapshot>> | null = null;
  if (session) {
    try {
      dash = await getDashboardSnapshot(session);
    } catch {
      dash = null;
    }
  }

  return (
    <WorkspaceShell
      activeHref="/academy"
      pageEyebrow={`Dostęp otwarty bez logowania · stan prawny na ${ACADEMY_COURSE.legalStateAsOf}`}
      pageTitle="Akademia Polskiej Księgowości i Samouczek Aplikacji"
      pageSubtitle="12 modułów i 37 interaktywnych lekcji: od pierwszego wyboru formy opodatkowania (KPiR, ryczałt, Sp. z o.o.), przez KSeF FA(3), VAT i ZUS, po bezpieczną współpracę z agentami AI przez MCP."
      sessionContext={session?.context ?? null}
      activeCompany={dash?.activeCompany ?? null}
      accessibleCompanies={dash?.accessibleCompanies ?? []}
    >
      <div className="space-y-6">
        <AcademyDisclaimerBanner />
        <AcademyCatalogClient modules={ACADEMY_MODULES} glossaryTerms={ACADEMY_GLOSSARY_TERMS} />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
