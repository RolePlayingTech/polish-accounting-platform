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
  getDashboardSnapshot,
  getNotificationsAndMcpSnapshot,
} from '../../../lib/synthetic-workspace';
import { McpWorkbench } from './mcp-workbench';

export default async function McpIntegrationPage() {
  const session = await readServerSession();

  if (!session) {
    return (
      <WorkspaceShell
        activeHref="/app/mcp"
        pageEyebrow="Model Context Protocol (ADR-001)"
        pageTitle="Klienci AI (Claude, Cursor, ChatGPT, Gemini) i kolejka propozycji MCP"
        sessionContext={null}
        activeCompany={null}
      >
        <div className="space-y-6">
          <LoginRequiredCard
            returnTo="/app/mcp"
            screenTitle="Integracja MCP i kolejka propozycji AI"
          />
          <AcademyDisclaimerBanner />
        </div>
      </WorkspaceShell>
    );
  }

  const loaded = await tryLoadWorkspaceData(async () => {
    const [dash, snap] = await Promise.all([
      getDashboardSnapshot(session),
      getNotificationsAndMcpSnapshot(session),
    ]);
    return {
      dash,
      snap,
    };
  });
  if (!loaded.ok) {
    return (
      <WorkspaceAccessErrorShell
        session={session}
        error={loaded.error}
        activeHref="/app/mcp"
        pageEyebrow="Model Context Protocol (ADR-001)"
        pageTitle="Klienci AI i kolejka propozycji MCP"
      />
    );
  }

  const { dash, snap } = loaded.data;

  return (
    <WorkspaceShell
      activeHref="/app/mcp"
      pageEyebrow="Model Context Protocol · Streamable HTTP (/api/v1/mcp)"
      pageTitle="Zewnętrzni klienci AI i zatwierdzanie propozycji MCP"
      pageSubtitle="Podłącz swojego agenta AI z zachowaniem izolacji tenanta i dwukrokowej bramki bezpieczeństwa: AI przygotowuje szkic (prepare_*), człowiek zatwierdza (confirm_*)."
      sessionContext={session.context}
      activeCompany={dash.activeCompany}
      accessibleCompanies={dash.accessibleCompanies}
    >
      <div className="space-y-6">
        <McpWorkbench
          activeCompany={dash.activeCompany}
          period={session.context.period}
          canWrite={dash.activeCompany.grantedActions.includes('write')}
          personaId={session.context.personaId}
          personaDisplayName={session.context.displayName}
          proposals={snap.mcpProposals}
          mcpHelp={mustResolveUiFieldHelp('mcp_human_confirmation')}
        />
        <AcademyDisclaimerBanner />
      </div>
    </WorkspaceShell>
  );
}
