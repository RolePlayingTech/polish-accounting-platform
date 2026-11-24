import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { getSystemStatus } from '@pap/application';
import {
  PAP_MCP_TOOL_DESCRIPTORS,
  resolveSafeRequestCorrelationId,
  type McpGatewayToolResult,
  type PapMcpGateway,
} from '@pap/application/mcp-gateway';
import { SystemStatusSchema } from '@pap/contracts';
import {
  ConfirmBankReconciliationInputSchema,
  ConfirmBankReconciliationOutputSchema,
  ConfirmPreparedProposalInputSchema,
  ConfirmPreparedProposalOutputSchema,
  ExplainAccountingItemInputSchema,
  ExplainAccountingItemOutputSchema,
  GetAuditLineageInputSchema,
  GetAuditLineageOutputSchema,
  GetCompanyProfileInputSchema,
  GetCompanyProfileOutputSchema,
  GetLegalBasisInputSchema,
  GetLegalBasisOutputSchema,
  GetMonthCloseChecklistInputSchema,
  GetMonthCloseChecklistOutputSchema,
  GetMonthlyTaxObligationsInputSchema,
  GetMonthlyTaxObligationsOutputSchema,
  ListAvailableCapabilitiesInputSchema,
  ListAvailableCapabilitiesOutputSchema,
  ListMyCompaniesInputSchema,
  ListMyCompaniesOutputSchema,
  ListUnpaidInvoicesInputSchema,
  ListUnpaidInvoicesOutputSchema,
  ListUnreconciledBankTransactionsInputSchema,
  ListUnreconciledBankTransactionsOutputSchema,
  MCP_CAPABILITY_CONTRACT_VERSION,
  PrepareBankReconciliationInputSchema,
  PrepareBankReconciliationOutputSchema,
  PrepareInvoiceAndPostingProposalInputSchema,
  PrepareInvoiceAndPostingProposalOutputSchema,
  PrepareMonthCloseInputSchema,
  PrepareMonthCloseOutputSchema,
  PreviewInvoicePostingInputSchema,
  PreviewInvoicePostingOutputSchema,
  PreviewJpkExportInputSchema,
  PreviewJpkExportOutputSchema,
} from '@pap/contracts/mcp-tools';
import { z } from 'zod';

export function createStatusServer(): McpServer {
  const server = new McpServer({ name: 'polish-accounting-platform', version: '0.1.0' });

  server.registerTool(
    'system_status',
    {
      title: 'Status systemu',
      description:
        'Zwraca publiczny status aplikacji i informację o dostępności modułów. Nie udostępnia danych firm ani dokumentów.',
      inputSchema: z.object({}).strict(),
      outputSchema: SystemStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      const status = getSystemStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );

  server.registerResource(
    'system_status_resource',
    'pap://system/status',
    {
      title: 'Status techniczny platformy PAP',
      description: 'Publiczny status techniczny aplikacji i dostępności modułów.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(getSystemStatus()),
        },
      ],
    }),
  );

  return server;
}

export interface CreatePapMcpServerOptions {
  /**
   * Optional bearer token supplier used ONLY for local/in-memory transports where HTTP AuthInfo
   * is not attached by the Streamable HTTP gateway. HTTP transport always uses `ctx.http?.authInfo?.token`.
   */
  readonly getFallbackBearerToken?: (() => string | undefined | null) | undefined;
}

function extractCallContext(
  ctx: ServerContext,
  options?: CreatePapMcpServerOptions,
): {
  readonly rawBearerToken: string | undefined | null;
  readonly correlationId: string;
  readonly clientId?: string | undefined;
} {
  const httpAuth = ctx.http?.authInfo;
  const headerRequestId = ctx.http?.req?.headers.get('x-request-id');
  const { correlationId } = resolveSafeRequestCorrelationId(headerRequestId);
  const token = httpAuth?.token ?? options?.getFallbackBearerToken?.() ?? undefined;
  return {
    rawBearerToken: token,
    correlationId,
    clientId: httpAuth?.clientId,
  };
}

function toCallToolResult<T extends Record<string, unknown>>(
  outcome: McpGatewayToolResult<T>,
): CallToolResult {
  if (!outcome.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify(outcome.error) }],
      structuredContent: outcome.error,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(outcome.data) }],
    structuredContent: outcome.data,
  };
}

export function createPapMcpServer(
  gateway: PapMcpGateway,
  options?: CreatePapMcpServerOptions,
): McpServer {
  const server = new McpServer({
    name: 'polish-accounting-platform',
    version: '0.1.0',
  });

  // ── MCP Resources (read-only context & discovery) ──────────────────────────

  server.registerResource(
    'system_status_resource',
    'pap://system/status',
    {
      title: 'Status techniczny platformy PAP',
      description: 'Status techniczny aplikacji i dostępności modułów księgowych.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(gateway.getSystemStatus()),
        },
      ],
    }),
  );

  server.registerResource(
    'capabilities_catalog_resource',
    'pap://system/capabilities-catalog',
    {
      title: 'Wersjonowany katalog narzędzi i bramek bezpieczeństwa MCP',
      description:
        'Pełna specyfikacja narzędzi MCP, klasyfikacji ryzyka, wymaganych zakresów OIDC oraz bramek maker-checker.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            contractVersion: MCP_CAPABILITY_CONTRACT_VERSION,
            tools: PAP_MCP_TOOL_DESCRIPTORS,
          }),
        },
      ],
    }),
  );

  server.registerResource(
    'my_companies_resource',
    'pap://companies/mine',
    {
      title: 'Podmioty prawne dostępne dla bieżącego aktora OIDC',
      description:
        'Lista firm i profili podatkowych dostępnych na podstawie aktywnych grantów bieżącego użytkownika.',
      mimeType: 'application/json',
    },
    async (uri, ctx) => {
      const outcome = await gateway.listMyCompanies(extractCallContext(ctx, options), {});
      const payload = outcome.ok ? outcome.data : outcome.error;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  );

  // ── 1. System & Company / Capability Discovery ─────────────────────────────

  server.registerTool(
    'system_status',
    {
      title: 'Status systemu',
      description:
        'Zwraca status techniczny aplikacji i informację o dostępności modułów. Nie udostępnia danych firm ani dokumentów.',
      inputSchema: z.object({}).strict(),
      outputSchema: SystemStatusSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => {
      const status = gateway.getSystemStatus();
      return {
        content: [{ type: 'text', text: JSON.stringify(status) }],
        structuredContent: status,
      };
    },
  );

  server.registerTool(
    'list_my_companies',
    {
      title: 'Moje firmy i profile podatkowe',
      description:
        'Zwraca wyłącznie podmioty prawne i profile podatkowe dostępne dla uwierzytelnionego użytkownika na podstawie aktywnych grantów.',
      inputSchema: ListMyCompaniesInputSchema,
      outputSchema: ListMyCompaniesOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.listMyCompanies(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'get_company_profile',
    {
      title: 'Profil podatkowy i status wsparcia firmy',
      description:
        'Zwraca profil prawno-podatkowy wybranej firmy, aktywne granty aktora oraz status wsparcia (supported/experimental/unsupported).',
      inputSchema: GetCompanyProfileInputSchema,
      outputSchema: GetCompanyProfileOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.getCompanyProfile(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'list_available_capabilities',
    {
      title: 'Dostępne możliwości i statusy wsparcia MCP dla firmy',
      description:
        'Zwraca macierz możliwości księgowych i podatkowych (supported/experimental/unsupported) oraz katalog narzędzi MCP dla wybranej firmy i roku podatkowego.',
      inputSchema: ListAvailableCapabilitiesInputSchema,
      outputSchema: ListAvailableCapabilitiesOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.listAvailableCapabilities(
        extractCallContext(ctx, options),
        args,
      );
      return toCallToolResult(result);
    },
  );

  // ── 2. Documents, Invoices & Safe Posting Proposals ────────────────────────

  server.registerTool(
    'list_unpaid_invoices',
    {
      title: 'Niezapłacone faktury',
      description:
        'Zwraca listę niezapłaconych faktur sprzedaży lub zakupu w PLN dla wybranej firmy. Pola tekstowe dokumentów są oznaczone jako niezaufane dane.',
      inputSchema: ListUnpaidInvoicesInputSchema,
      outputSchema: ListUnpaidInvoicesOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.listUnpaidInvoices(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'preview_invoice_posting',
    {
      title: 'Symulacja kwalifikacji VAT i dekretacji faktury (tylko odczyt)',
      description:
        'Waliduje jawne stawki VAT i pozycje wielostawkowe (#112) oraz wylicza podgląd KUP/NKUP, VAT i skrót payloadHash bez tworzenia szkicu w bazie.',
      inputSchema: PreviewInvoicePostingInputSchema,
      outputSchema: PreviewInvoicePostingOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.previewInvoicePosting(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'prepare_invoice_and_posting_proposal',
    {
      title: 'Przygotuj bezpieczną propozycję faktury i dekretacji (bez księgowania)',
      description:
        'Tworzy audytowany, idempotentny szkic faktury i propozycji zaksięgowania ze statusem pending_human_approval. Wymaga jawnej kwalifikacji VAT przy 0 PLN / wielu stawkach (#112) i nigdy nie księguje bez zatwierdzenia człowieka.',
      inputSchema: PrepareInvoiceAndPostingProposalInputSchema,
      outputSchema: PrepareInvoiceAndPostingProposalOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await gateway.prepareInvoiceAndPostingProposal(
        extractCallContext(ctx, options),
        args,
      );
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'confirm_prepared_proposal',
    {
      title: 'Zatwierdź przygotowaną propozycję (wymaga niezależnego kodu potwierdzenia człowieka)',
      description:
        'Operacja krytyczna: zatwierdza wcześniej przygotowany szkic wyłącznie po podaniu świeżego, jednorazowego tokenu potwierdzenia człowieka (confirmationCode) i zgodnego skrótu expectedPayloadHash. Samozatwierdzenie przez agenta jest zablokowane.',
      inputSchema: ConfirmPreparedProposalInputSchema,
      outputSchema: ConfirmPreparedProposalOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await gateway.confirmPreparedProposal(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  // ── 3. Tax Obligations, Explanations, Legal Basis & JPK Preview ────────────

  server.registerTool(
    'get_monthly_tax_obligations',
    {
      title: 'Miesięczne obowiązki podatkowe i ZUS',
      description:
        'Zwraca terminy i statusy obowiązków ZUS, PIT/CIT, VAT, JPK oraz KSeF dla wybranej firmy i okresu RRRR-MM wraz ze zweryfikowaną podstawą prawną.',
      inputSchema: GetMonthlyTaxObligationsInputSchema,
      outputSchema: GetMonthlyTaxObligationsOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.getMonthlyTaxObligations(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'explain_accounting_item',
    {
      title: 'Wyjaśnienie kwalifikacji księgowej i podatkowej',
      description:
        'Wyjaśnia krok po kroku kwalifikację kwoty do KUP/NKUP oraz odliczenia VAT wraz z zastosowanymi przepisami i wyliczeniem.',
      inputSchema: ExplainAccountingItemInputSchema,
      outputSchema: ExplainAccountingItemOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.explainAccountingItem(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'get_legal_basis',
    {
      title: 'Podstawa prawna obowiązku lub reguły',
      description:
        'Zwraca zweryfikowany przepis prawa podatkowego lub ubezpieczeniowego, Dziennik Ustaw, okres obowiązywania, wyjątki i link urzędowy.',
      inputSchema: GetLegalBasisInputSchema,
      outputSchema: GetLegalBasisOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.getLegalBasis(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'preview_jpk_export',
    {
      title: 'Podgląd gotowości i kontrola spójności JPK (bez wysyłki urzędowej)',
      description:
        'Generuje deterministyczny podgląd gotowości JPK_V7M / JPK_PKPIR / JPK_EWP / JPK_FA bez wykonywania wysyłki zewnętrznej ani generowania fałszywego UPO.',
      inputSchema: PreviewJpkExportInputSchema,
      outputSchema: PreviewJpkExportOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.previewJpkExport(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  // ── 4. Bank Reconciliation (List, Prepare, Human-Approved Confirm) ─────────

  server.registerTool(
    'list_unreconciled_bank_transactions',
    {
      title: 'Nieuzgodnione transakcje bankowe',
      description:
        'Zwraca listę nieuzgodnionych operacji bankowych w PLN dla wybranej firmy. Tytuły przelewów i nazwy kontrahentów są opatrzone kopertą ochrony przed prompt injection.',
      inputSchema: ListUnreconciledBankTransactionsInputSchema,
      outputSchema: ListUnreconciledBankTransactionsOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.listUnreconciledBankTransactions(
        extractCallContext(ctx, options),
        args,
      );
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'prepare_bank_reconciliation',
    {
      title: 'Przygotuj bezpieczną propozycję rozliczenia przelewu z fakturą (bez zapisu)',
      description:
        'Tworzy audytowaną, idempotentną propozycję alokacji transakcji bankowej do nierozliczonej faktury ze statusem pending_human_approval i skrótem payloadHash.',
      inputSchema: PrepareBankReconciliationInputSchema,
      outputSchema: PrepareBankReconciliationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await gateway.prepareBankReconciliation(
        extractCallContext(ctx, options),
        args,
      );
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'confirm_bank_reconciliation_proposal',
    {
      title: 'Zatwierdź propozycję rozliczenia bankowego (wymaga kodu potwierdzenia człowieka)',
      description:
        'Zatwierdza przygotowaną propozycję rozliczenia bankowego wyłącznie po podaniu świeżego, niezależnego tokenu potwierdzenia człowieka (confirmationCode) i zgodnego expectedPayloadHash.',
      inputSchema: ConfirmBankReconciliationInputSchema,
      outputSchema: ConfirmBankReconciliationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await gateway.confirmBankReconciliationProposal(
        extractCallContext(ctx, options),
        args,
      );
      return toCallToolResult(result);
    },
  );

  // ── 5. Month Close Checklist, Prepare & Redacted Audit Lineage ─────────────

  server.registerTool(
    'get_month_close_checklist',
    {
      title: 'Lista kontrolna zamknięcia miesiąca',
      description:
        'Analizuje brakujące dokumenty, niezatwierdzone propozycje AI, nieuzgodnione przelewy bankowe i zbliżające się deklaracje dla wybranego okresu RRRR-MM.',
      inputSchema: GetMonthCloseChecklistInputSchema,
      outputSchema: GetMonthCloseChecklistOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.getMonthCloseChecklist(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'prepare_month_close',
    {
      title: 'Przygotuj paczkę kontrolną zamknięcia okresu (bez zamykania okresu)',
      description:
        'Tworzy audytowaną paczkę zamknięcia miesiąca ze skrótem snapshotHash i listą blokad. Nigdy samodzielnie nie zamyka okresu rozliczeniowego.',
      inputSchema: PrepareMonthCloseInputSchema,
      outputSchema: PrepareMonthCloseOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, ctx) => {
      const result = await gateway.prepareMonthClose(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  server.registerTool(
    'get_audit_lineage',
    {
      title: 'Ścieżka audytowa i pochodzenie operacji MCP (z redakcją sekretów i PII)',
      description:
        'Zwraca historię zdarzeń audytowych dla firmy, propozycji lub correlationId z automatyczną redakcją tokenów, kodów potwierdzeń oraz danych wrażliwych.',
      inputSchema: GetAuditLineageInputSchema,
      outputSchema: GetAuditLineageOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (args, ctx) => {
      const result = await gateway.getAuditLineage(extractCallContext(ctx, options), args);
      return toCallToolResult(result);
    },
  );

  return server;
}
