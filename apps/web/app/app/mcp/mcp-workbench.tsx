'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Card,
  CriticalConfirmDialog,
  FieldHelpButton,
  LedgerTable,
  MoneyAmount,
  StatusBadge,
  formatNip,
  type FieldHelpInfo,
  type LedgerColumn,
} from '@pap/ui';
import { AlertBanner, Button } from '../../../components/ui-controls';
import {
  MCP_TOOLS_CATALOG,
  type CompanyProfileRecord,
  type McpPendingProposalRecord,
  type McpToolCatalogItem,
} from '../../../lib/workspace-types';

type McpClientTab = 'claude' | 'cursor' | 'chatgpt' | 'gemini' | 'http';

export interface McpWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  period: string;
  canWrite: boolean;
  syntheticOidcToken: string;
  personaDisplayName: string;
  proposals: readonly McpPendingProposalRecord[];
  mcpHelp: FieldHelpInfo;
}

export function McpWorkbench({
  activeCompany,
  canWrite,
  mcpHelp,
  period,
  personaDisplayName,
  proposals,
  syntheticOidcToken,
}: McpWorkbenchProps) {
  const router = useRouter();
  const [clientTab, setClientTab] = useState<McpClientTab>('claude');
  const [tokenVisible, setTokenVisible] = useState(false);
  const [proposalToConfirm, setProposalToConfirm] = useState<McpPendingProposalRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger' | 'info';
    title: string;
    detail: string;
  } | null>(null);

  const endpointUrl = 'http://127.0.0.1:4000/api/v1/mcp';
  const displayedToken = tokenVisible
    ? syntheticOidcToken
    : `${syntheticOidcToken.slice(0, 14)}••••••••••••••••`;

  const configSnippets: Record<McpClientTab, { title: string; code: string }> = {
    claude: {
      title: 'Claude Desktop / Claude Code (Streamable HTTP MCP)',
      code: JSON.stringify(
        {
          mcpServers: {
            'polish-accounting-platform': {
              type: 'streamable-http',
              url: endpointUrl,
              headers: {
                Authorization: `Bearer ${displayedToken}`,
                'X-PAP-Tenant-Id': activeCompany.tenantId,
                'X-PAP-Legal-Entity-Id': activeCompany.legalEntityId,
              },
            },
          },
        },
        null,
        2,
      ),
    },
    cursor: {
      title: 'Cursor IDE (.cursor/mcp.json)',
      code: JSON.stringify(
        {
          mcpServers: {
            papAccounting: {
              url: endpointUrl,
              transport: 'streamable-http',
              headers: {
                Authorization: `Bearer ${displayedToken}`,
              },
            },
          },
        },
        null,
        2,
      ),
    },
    chatgpt: {
      title: 'ChatGPT Connectors / Custom MCP Action',
      code: [
        `Server URL: ${endpointUrl}`,
        `Transport: MCP Streamable HTTP (JSON-RPC 2.0 POST)`,
        `Authentication: OAuth 2.0 / Bearer Token`,
        `Scopes: pap:mcp:read, pap:mcp:prepare`,
        `Bearer (syntetyczny): ${displayedToken}`,
      ].join('\n'),
    },
    gemini: {
      title: 'Gemini CLI / Antigravity settings.json',
      code: JSON.stringify(
        {
          mcpServers: {
            'pap-ksiegowosc': {
              httpUrl: endpointUrl,
              headers: {
                Authorization: `Bearer ${displayedToken}`,
              },
            },
          },
        },
        null,
        2,
      ),
    },
    http: {
      title: 'Własny klient Streamable HTTP (curl / SDK)',
      code: [
        `curl -X POST ${endpointUrl} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Accept: application/json, text/event-stream" \\`,
        `  -H "Authorization: Bearer ${displayedToken}" \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
      ].join('\n'),
    },
  };

  async function runMcpAction(body: Record<string, unknown>, okTitle: string, okDetail: string) {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/workspace/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        confirmationCode?: string;
      };
      if (!res.ok || !data.ok) {
        setFeedback({
          tone: 'danger',
          title: `Odmowa operacji MCP (HTTP ${String(res.status)})`,
          detail: data.error ?? 'Operacja nie powiodła się.',
        });
      } else {
        setFeedback({
          tone: 'success',
          title: okTitle,
          detail: data.confirmationCode
            ? `${okDetail} Jednorazowy kod dla klienta MCP: ${data.confirmationCode}`
            : okDetail,
        });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const toolColumns: readonly LedgerColumn<McpToolCatalogItem>[] = [
    {
      id: 'name',
      header: 'Narzędzie MCP',
      mobileRole: 'title',
      render: (t) => (
        <div>
          <code className="font-mono text-xs font-semibold text-[#1d5c42]">{t.name}</code>
          <p className="text-[11px] text-[#464c48]">{t.titlePl}</p>
        </div>
      ),
    },
    {
      id: 'scope',
      header: 'Wymagany scope OIDC',
      mobileRole: 'meta',
      render: (t) => <code className="font-mono text-xs text-[#464c48]">{t.scope}</code>,
    },
    {
      id: 'gate',
      header: 'Bramka człowieka',
      mobileRole: 'status',
      render: (t) => (
        <StatusBadge
          size="sm"
          tone={t.mode !== 'read' ? 'warning' : 'success'}
          label={
            t.mode !== 'read'
              ? 'Dwukrokowa (wymaga kodu człowieka)'
              : 'Bezpieczny odczyt (read-only)'
          }
        />
      ),
    },
    {
      id: 'desc',
      header: 'Opis działania w tym samym jądrze autoryzacji (ADR-001)',
      mobileRole: 'meta',
      render: (t) => <span className="text-xs text-[#464c48]">{t.descriptionPl}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      {feedback ? (
        <AlertBanner tone={feedback.tone} title={feedback.title}>
          {feedback.detail}
        </AlertBanner>
      ) : null}

      <Card
        as="div"
        eyebrow="Kolejka propozycji prepare_* oczekujących na decyzję człowieka (Zasada nr 5)"
        title="Szkice przygotowane przez zewnętrznych klientów AI / MCP"
        actions={
          <div className="flex items-center gap-2">
            <FieldHelpButton help={mcpHelp} />
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !canWrite}
              onClick={() =>
                void runMcpAction(
                  { action: 'mcp_create_demo_proposal' },
                  'Zasymulowano nową propozycję z klienta MCP',
                  'Szkic faktury zakupu trafił do kolejki oczekującej na zatwierdzenie człowieka.',
                )
              }
            >
              + Symuluj wywołanie prepare_invoice_and_posting_proposal
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {proposals.map((prop) => (
            <div
              key={prop.proposalId}
              className={`rounded-xl border p-4 ${
                prop.promptInjectionSuspected
                  ? 'border-[#e6b3b0] bg-[#fceeed]/60'
                  : 'border-[#e5e2d9] bg-[#faf9f5]'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-[#191c1a]">
                      {prop.invoiceNumber}
                    </span>
                    <StatusBadge
                      size="sm"
                      tone={prop.status === 'confirmed' ? 'success' : 'warning'}
                      label={
                        prop.status === 'confirmed'
                          ? `Zatwierdzono (${prop.confirmedBy ?? ''})`
                          : 'Oczekuje na zatwierdzenie człowieka'
                      }
                    />
                    {prop.promptInjectionSuspected ? (
                      <StatusBadge
                        size="sm"
                        tone="danger"
                        label="Ostrzeżenie: podejrzenie prompt injection w opisie!"
                      />
                    ) : null}
                  </div>
                  <p className="text-xs font-medium text-[#191c1a]">
                    Kontrahent: {prop.counterpartyName} (NIP {formatNip(prop.counterpartyNip)})
                  </p>
                  <p className="text-xs text-[#464c48]">{prop.description}</p>
                  <p className="font-mono text-[11px] text-[#636b66]">
                    Klient: {prop.clientName} · Narzędzie: {prop.toolName} · Hash SHA-256:{' '}
                    {prop.payloadHash.slice(0, 16)}…
                  </p>
                </div>

                <div className="text-right">
                  <MoneyAmount amount={prop.grossGrosze} inGrosze size="md" variant="expense" />
                  <p className="mt-1 font-mono text-[11px] tabular-nums text-[#636b66]">
                    Podgląd KUP: {(prop.kupPreviewGrosze / 100).toFixed(2)} · VAT:{' '}
                    {(prop.deductibleVatPreviewGrosze / 100).toFixed(2)} PLN
                  </p>
                </div>
              </div>

              {prop.issuedConfirmationCode ? (
                <div className="mt-3 rounded-lg border border-[#1d5c42] bg-[#e7f1ec] px-3 py-2 text-xs text-[#1d5c42]">
                  Jednorazowy kod potwierdzenia człowieka (
                  <code className="font-mono">humanConfirmationCode</code>):{' '}
                  <strong className="font-mono">{prop.issuedConfirmationCode}</strong>
                </div>
              ) : null}

              {prop.status === 'pending_human_approval' ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#e5e2d9] pt-3">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !canWrite}
                    onClick={() =>
                      void runMcpAction(
                        { action: 'mcp_issue_code', proposalId: prop.proposalId },
                        'Wygenerowano jednorazowy kod autoryzacji człowieka',
                        'Możesz przekazać ten kod do narzędzia confirm_prepared_proposal lub zatwierdzić bezpośrednio poniżej.',
                      )
                    }
                  >
                    Wygeneruj kod potwierdzenia dla klienta MCP
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy || !canWrite}
                    onClick={() => setProposalToConfirm(prop)}
                  >
                    Zatwierdź propozycję bezpośrednio w UI
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <Card
        as="div"
        eyebrow="ADR-001 · Jeden rdzeń aplikacji i MCP jako adapter Streamable HTTP"
        title="Instrukcja podłączenia zewnętrznych klientów AI do /api/v1/mcp"
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3 text-xs">
            <div>
              <p className="font-semibold text-[#191c1a]">
                Syntetyczny token OIDC aktywnej persony ({personaDisplayName}):
              </p>
              <code className="mt-0.5 block font-mono text-[#1d5c42]">{displayedToken}</code>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setTokenVisible((v) => !v)}>
              {tokenVisible ? 'Ukryj token syntetyczny' : 'Pokaż pełny token syntetyczny'}
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                { id: 'claude', label: 'Claude Desktop / Code' },
                { id: 'cursor', label: 'Cursor IDE' },
                { id: 'chatgpt', label: 'ChatGPT' },
                { id: 'gemini', label: 'Gemini CLI' },
                { id: 'http', label: 'Streamable HTTP (curl)' },
              ] as const
            ).map((tab) => (
              <Button
                key={tab.id}
                size="sm"
                variant={clientTab === tab.id ? 'primary' : 'secondary'}
                onClick={() => setClientTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold text-[#191c1a]">
              {configSnippets[clientTab].title}
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3.5 font-mono text-xs leading-relaxed text-[#191c1a]">
              {configSnippets[clientTab].code}
            </pre>
          </div>
        </div>
      </Card>

      <LedgerTable
        caption="Pełny katalog 9 narzędzi udostępnianych przez serwer MCP Polish Accounting Platform"
        title="Dostępne narzędzia MCP (9 narzędzi)"
        subtitle="Wszystkie narzędzia przechodzą przez tę samą kontrolę dostępu tenanta, grantów podmiotowych i dziennika audytu co aplikacja webowa."
        columns={toolColumns}
        rows={MCP_TOOLS_CATALOG}
        getRowKey={(t) => t.name}
      />

      <CriticalConfirmDialog
        open={proposalToConfirm !== null}
        operationType="mcp_approval"
        title="Świadome zatwierdzenie propozycji przygotowanej przez klienta MCP"
        description={`Zatwierdzasz jako człowiek szkic ${proposalToConfirm?.invoiceNumber ?? ''} od ${proposalToConfirm?.counterpartyName ?? ''}.`}
        companyName={activeCompany.companyName}
        nip={activeCompany.nip}
        period={period}
        amountGrosze={proposalToConfirm?.grossGrosze}
        {...(proposalToConfirm
          ? {
              mcpMetadata: {
                clientName: proposalToConfirm.clientName,
                scope: proposalToConfirm.scope,
                expiresAtLabel: proposalToConfirm.expiresAt.slice(0, 16).replace('T', ' '),
              },
            }
          : {})}
        auditConsequences={[
          'Szkic MCP zostanie trwale oznaczony jako zatwierdzony przez człowieka (MCP_PROPOSAL_CONFIRMED_BY_HUMAN).',
          `Zgodność skrótu ładunku SHA-256 (${proposalToConfirm?.payloadHash.slice(0, 12) ?? ''}…) zostanie zapisana w dzienniku audytu.`,
        ]}
        confirmLabel="Potwierdzam i zatwierdzam propozycję MCP"
        isSubmitting={busy}
        onCancel={() => setProposalToConfirm(null)}
        onConfirm={() => {
          if (!proposalToConfirm) return;
          const id = proposalToConfirm.proposalId;
          const code = proposalToConfirm.issuedConfirmationCode;
          setProposalToConfirm(null);
          void runMcpAction(
            {
              action: 'mcp_confirm_proposal',
              proposalId: id,
              ...(code ? { confirmationCode: code } : {}),
            },
            'Propozycja MCP została zatwierdzona przez człowieka',
            'Zdarzenie zapisano w niezmiennym dzienniku audytu organizacji.',
          );
        }}
      />
    </div>
  );
}
