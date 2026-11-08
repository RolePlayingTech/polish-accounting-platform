import { AcademyDisclaimerBanner } from '../../../components/ui-controls';
import { WorkspaceShell } from '../../../components/workspace-shell';
import { mapLegalRuleToBasisInfo } from '../../../lib/field-help';
import { readServerSession } from '../../../lib/session';
import { getDashboardSnapshot, getLegalRulesCatalog } from '../../../lib/synthetic-workspace';
import { RulesCatalogClient } from './rules-catalog-client';

export default async function LegalRulesPage() {
  const session = await readServerSession();
  const rawRules = getLegalRulesCatalog();

  let dash: Awaited<ReturnType<typeof getDashboardSnapshot>> | null = null;
  if (session) {
    try {
      dash = await getDashboardSnapshot(session);
    } catch {
      dash = null;
    }
  }

  const mappedRules = rawRules.map((rule) => ({
    id: rule.id,
    ruleCode: rule.ruleCode,
    domain: rule.ruleCode.split('_')[0]?.toLowerCase() ?? 'ogolne',
    title: rule.title,
    validFrom: rule.validFrom,
    validTo: rule.validTo,
    basis: mapLegalRuleToBasisInfo(rule),
  }));

  return (
    <WorkspaceShell
      activeHref="/app/rules"
      pageEyebrow="Zasada nr 4 · Wersjonowany rejestr prawa podatkowego i bilansowego RP"
      pageTitle={`Katalog reguł prawnych „Dlaczego?” (${String(mappedRules.length)} pozycji)`}
      pageSubtitle="Każda reguła posiada źródło urzędowe (ISAP / Dz.U. / podatki.gov.pl / zus.pl), daty obowiązywania 2025–2026, wersję oraz przypadki referencyjne."
      sessionContext={session?.context ?? null}
      activeCompany={dash?.activeCompany ?? null}
      accessibleCompanies={dash?.accessibleCompanies ?? []}
    >
      <div className="space-y-6">
        <RulesCatalogClient rules={mappedRules} />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
