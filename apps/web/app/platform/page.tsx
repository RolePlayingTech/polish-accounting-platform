import { Card, StatusBadge } from '@pap/ui';
import { SystemStatusDiagnosticSection } from '../../components/system-status-section';
import { AlertBanner } from '../../components/ui-controls';
import { WorkspaceShell } from '../../components/workspace-shell';
import { readPublicSystemStatus } from '../../lib/read-system-status';
import { readServerSession } from '../../lib/session';
import { getDashboardSnapshot, getLegalRulesCatalog } from '../../lib/synthetic-workspace';

export default async function PlatformConsolePage() {
  const [systemStatus, session] = await Promise.all([
    readPublicSystemStatus(),
    readServerSession(),
  ]);
  const rulesCount = getLegalRulesCatalog().length;

  let activeSnap: Awaited<ReturnType<typeof getDashboardSnapshot>> | null = null;
  if (session) {
    try {
      activeSnap = await getDashboardSnapshot(session);
    } catch {
      activeSnap = null;
    }
  }

  return (
    <WorkspaceShell
      activeHref="/platform"
      surface="platform"
      pageEyebrow="Powierzchnia /platform · Operator techniczny (ADR-003)"
      pageTitle="Konsola operatora platformy SaaS"
      pageSubtitle="Rozdział ról wg ADR-003: administrator platformy monitoruje kondycję usług, wersje reguł prawnych i izolację tenantów bez cichego dostępu do ksiąg klientów."
      sessionContext={session?.context ?? null}
      activeCompany={activeSnap?.activeCompany ?? null}
      accessibleCompanies={activeSnap?.accessibleCompanies ?? []}
    >
      <div className="space-y-6">
        <AlertBanner
          tone="legal"
          title="Brak domyślnego wglądu operatora technicznego w dokumenty księgowe tenantów"
        >
          Zgodnie z ADR-003 rola operatora platformy (<code className="font-mono">/platform</code>)
          nie nadaje automatycznego uprawnienia do odczytu faktur, KPiR ani wyciągów bankowych
          poszczególnych firm. Każda operacja wsparcia wymaga jawnego, czasowego grantu oraz śladu w
          dzienniku audytu.
        </AlertBanner>

        <div className="grid gap-4 md:grid-cols-3">
          <Card as="div" eyebrow="Rejestr prawa" title="Zweryfikowane reguły 2025/2026">
            <p className="font-mono text-2xl font-semibold tabular-nums text-[#191c1a]">
              {String(rulesCount)}
            </p>
            <p className="mt-1 text-xs text-[#464c48]">
              Aktywne reguły z referencjami ISAP / Dz.U. i testami referencyjnymi
            </p>
          </Card>

          <Card as="div" eyebrow="Bezpieczeństwo transportu" title="Polityka API_BASE_URL i sesji">
            <div className="mt-1">
              <StatusBadge tone="success" label="Zamknięta biała lista URL + HttpOnly" />
            </div>
            <p className="mt-2 text-xs text-[#464c48]">
              Blokada przekierowań (<code className="font-mono">redirect: error</code>), brak zapisu
              tokenów w <code className="font-mono">localStorage</code>.
            </p>
          </Card>

          <Card as="div" eyebrow="Bramka AI / MCP" title="Dwukrokowe zatwierdzanie">
            <div className="mt-1">
              <StatusBadge tone="accent" label="prepare_* → confirm_* (człowiek)" />
            </div>
            <p className="mt-2 text-xs text-[#464c48]">
              Żaden zewnętrzny agent MCP nie może samodzielnie zaksięgować dokumentu ani wysłać JPK.
            </p>
          </Card>
        </div>

        <SystemStatusDiagnosticSection status={systemStatus} />
      </div>
    </WorkspaceShell>
  );
}
