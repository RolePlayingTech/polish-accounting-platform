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
import type { PersonaId } from '../../../lib/session';
import {
  MCP_TOOLS_CATALOG,
  type CompanyProfileRecord,
  type McpPendingProposalRecord,
  type McpToolCatalogItem,
} from '../../../lib/workspace-types';

type McpClientTab = 'claude' | 'cursor' | 'chatgpt' | 'gemini' | 'http';

const REDACTED_OIDC_PLACEHOLDER = '<POBIERZ_TOKEN_Z_ENDPOINTU_OIDC>';

export interface McpWorkbenchProps {
  activeCompany: CompanyProfileRecord;
  period: string;
  canWrite: boolean;
  personaId: PersonaId;
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
  personaId,
  proposals,
}: McpWorkbenchProps) {
  const router = useRouter();
  const [clientTab, setClientTab] = useState<McpClientTab>('claude');
  const [issuedCodesByProposal, setIssuedCodesByProposal] = useState<Record<string, string>>({});
  const [typedCodesByProposal, setTypedCodesByProposal] = useState<Record<string, string>>({});
  const [proposalToConfirm, setProposalToConfirm] = useState<{
    proposal: McpPendingProposalRecord;
    confirmationCode: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'danger' | 'info';
    title: string;
    detail: string;
  } | null>(null);

  const endpointUrl = 'http://127.0.0.1:4000/api/v1/mcp';

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
                Authorization: `Bearer ${REDACTED_OIDC_PLACEHOLDER}`,
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
                Authorization: `Bearer ${REDACTED_OIDC_PLACEHOLDER}`,
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
        `Bearer: ${REDACTED_OIDC_PLACEHOLDER}`,
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
                Authorization: `Bearer ${REDACTED_OIDC_PLACEHOLDER}`,
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
        `# 1. Pobierz osobny token delegowany dla klienta MCP z lokalnego dostawcy OIDC:`,
        `#    POST http://127.0.0.1:4000/api/v1/oidc/token {"personaId":"${personaId}"}`,
        `curl -X POST ${endpointUrl} \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -H "Accept: application/json, text/event-stream" \\`,
        `  -H "Authorization: Bearer ${REDACTED_OIDC_PLACEHOLDER}" \\`,
        `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
      ].join('\n'),
    },
  };

  async function runMcpAction(
    body: Record<string, unknown>,
    okTitle: string,
    okDetail: string,
    onSuccessData?: (data: { confirmationCode?: string }) => void,
  ) {
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
        onSuccessData?.(data);
        setFeedback({
          tone: 'success',
          title: okTitle,
          detail: data.confirmationCode
            ? `${okDetail} Jednorazowy kod wyzwania człowieka: ${data.confirmationCode}`
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
          {proposals.map((prop) => {
            const challengeCode =
              issuedCodesByProposal[prop.proposalId] ?? prop.issuedConfirmationCode;
            const typedCode = typedCodesByProposal[prop.proposalId] ?? '';
            const codeMatches = Boolean(challengeCode) && typedCode.trim() === challengeCode;
            const codeInputId = `mcp-confirm-code-${prop.proposalId}`;

            return (
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
                        tone={
                          prop.status === 'confirmed'
                            ? 'success'
                            : prop.status === 'expired' || prop.status === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                        label={
                          prop.status === 'confirmed'
                            ? `Zatwierdzono (${prop.confirmedBy ?? ''})`
                            : prop.status === 'expired'
                              ? 'Propozycja wygasła'
                              : prop.status === 'rejected'
                                ? 'Odrzucono propozycję'
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
                      {prop.payloadHash.slice(0, 16)}… · Ważność do:{' '}
                      {prop.expiresAt.slice(0, 16).replace('T', ' ')}
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

                {challengeCode && prop.status === 'pending_human_approval' ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-[#1d5c42] bg-[#e7f1ec] p-3 text-xs text-[#191c1a]">
                    <p className="text-[#1d5c42]">
                      Wyzwanie zatwierdzenia człowieka (
                      <code className="font-mono">humanConfirmationCode</code>):{' '}
                      <strong className="font-mono">{challengeCode}</strong>
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[240px] flex-1">
                        <label
                          htmlFor={codeInputId}
                          className="block text-[11px] font-semibold text-[#191c1a]"
                        >
                          Przepisz lub wklej kod wyzwania, aby odblokować zatwierdzenie:
                        </label>
                        <input
                          id={codeInputId}
                          type="text"
                          value={typedCode}
                          onChange={(e) =>
                            setTypedCodesByProposal((prev) => ({
                              ...prev,
                              [prop.proposalId]: e.target.value,
                            }))
                          }
                          placeholder={challengeCode}
                          autoComplete="off"
                          className="mt-1 min-h-9 w-full rounded-md border border-[#858177] bg-white px-2.5 py-1.5 font-mono text-xs text-[#191c1a] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1d5c42]"
                        />
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          setTypedCodesByProposal((prev) => ({
                            ...prev,
                            [prop.proposalId]: challengeCode,
                          }))
                        }
                      >
                        Użyj wyświetlonego kodu wyzwania
                      </Button>
                    </div>
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
                          'Potwierdź wygenerowany kod wyzwania powyżej lub przekaż go do narzędzia confirm_prepared_proposal.',
                          (data) => {
                            if (data.confirmationCode) {
                              setIssuedCodesByProposal((prev) => ({
                                ...prev,
                                [prop.proposalId]: data.confirmationCode!,
                              }));
                            }
                          },
                        )
                      }
                    >
                      1. Wygeneruj kod potwierdzenia człowieka
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy || !canWrite || !codeMatches}
                      onClick={() => {
                        if (!challengeCode || !codeMatches) return;
                        setProposalToConfirm({
                          proposal: prop,
                          confirmationCode: typedCode.trim(),
                        });
                      }}
                    >
                      2. Zatwierdź propozycję z kodem człowieka
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy || !canWrite}
                      onClick={() =>
                        void runMcpAction(
                          {
                            action: 'mcp_reject_proposal',
                            proposalId: prop.proposalId,
                            reason:
                              'Odrzucono propozycję podczas weryfikacji człowieka w UI (/app/mcp).',
                          },
                          'Propozycja MCP została odrzucona przez człowieka',
                          'Szkic przygotowany przez agenta AI został trwale odrzucony i oznaczony w dzienniku audytu (MCP_PROPOSAL_REJECTED).',
                        )
                      }
                    >
                      3. Odrzuć propozycję
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        as="div"
        eyebrow="ADR-001 · Jeden rdzeń aplikacji i MCP jako adapter Streamable HTTP"
        title="Instrukcja podłączenia zewnętrznych klientów AI do /api/v1/mcp"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3 text-xs text-[#464c48]">
            <p className="font-semibold text-[#191c1a]">
              Ochrona sesji przeglądarkowej ({personaDisplayName}):
            </p>
            <p className="mt-1 leading-relaxed">
              Token Twojej sesji webowej pozostaje wyłącznie w ciasteczku serwerowym{' '}
              <code className="font-mono">HttpOnly</code> i nie jest renderowany w HTML ani w
              payloadach RSC. Zewnętrzny klient MCP pobiera własny delegowany token z{' '}
              <code className="font-mono">POST /api/v1/oidc/token</code> i podstawia go w miejsce{' '}
              <code className="font-mono text-[#1d5c42]">{REDACTED_OIDC_PLACEHOLDER}</code>.
            </p>
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
            <pre className="mt-1.5 max-w-full overflow-x-auto break-all rounded-lg border border-[#e5e2d9] bg-[#faf9f5] p-3.5 font-mono text-xs leading-relaxed text-[#191c1a] sm:break-normal">
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
        description={`Zatwierdzasz jako człowiek szkic ${proposalToConfirm?.proposal.invoiceNumber ?? ''} od ${proposalToConfirm?.proposal.counterpartyName ?? ''} za pomocą zweryfikowanego kodu wyzwania ${proposalToConfirm?.confirmationCode ?? ''}.`}
        companyName={activeCompany.companyName}
        nip={activeCompany.nip}
        period={period}
        amountGrosze={proposalToConfirm?.proposal.grossGrosze}
        {...(proposalToConfirm
          ? {
              mcpMetadata: {
                clientName: proposalToConfirm.proposal.clientName,
                scope: proposalToConfirm.proposal.scope,
                expiresAtLabel: proposalToConfirm.proposal.expiresAt.slice(0, 16).replace('T', ' '),
              },
            }
          : {})}
        auditConsequences={[
          'Szkic MCP zostanie trwale oznaczony jako zatwierdzony przez człowieka (MCP_PROPOSAL_CONFIRMED_BY_HUMAN) po weryfikacji jednorazowego kodu wyzwania.',
          `Zgodność skrótu ładunku SHA-256 (${proposalToConfirm?.proposal.payloadHash.slice(0, 12) ?? ''}…) zostanie zapisana w dzienniku audytu.`,
        ]}
        confirmLabel="Potwierdzam kod i zatwierdzam propozycję MCP"
        isSubmitting={busy}
        onCancel={() => setProposalToConfirm(null)}
        onConfirm={() => {
          if (!proposalToConfirm) return;
          const id = proposalToConfirm.proposal.proposalId;
          const code = proposalToConfirm.confirmationCode;
          setProposalToConfirm(null);
          void runMcpAction(
            {
              action: 'mcp_confirm_proposal',
              proposalId: id,
              confirmationCode: code,
            },
            'Propozycja MCP została zatwierdzona przez człowieka',
            'Jednorazowy kod wyzwania został zużyty, a zdarzenie zapisano w niezmiennym dzienniku audytu organizacji.',
          );
        }}
      />
    </div>
  );
}
