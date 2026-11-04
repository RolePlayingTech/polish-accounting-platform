import { randomUUID } from 'node:crypto';
import { McpServer, type CallToolResult, type ServerContext } from '@modelcontextprotocol/server';
import { getSystemStatus } from '@pap/application';
import {
   type McpGatewayToolResult,
  type PapMcpGateway,
} from '@pap/application/mcp-gateway';
import { SystemStatusSchema } from '@pap/contracts';
import {
  ConfirmPreparedProposalInputSchema,
  ConfirmPreparedProposalOutputSchema,
  ExplainAccountingItemInputSchema,
  ExplainAccountingItemOutputSchema,
  GetLegalBasisInputSchema,
  GetLegalBasisOutputSchema,
  GetMonthCloseChecklistInputSchema,
  GetMonthCloseChecklistOutputSchema,
  GetMonthlyTaxObligationsInputSchema,
  GetMonthlyTaxObligationsOutputSchema,
  ListMyCompaniesInputSchema,
  ListMyCompaniesOutputSchema,
  ListUnpaidInvoicesInputSchema,
  ListUnpaidInvoicesOutputSchema,
  PrepareInvoiceAndPostingProposalInputSchema,
  PrepareInvoiceAndPostingProposalOutputSchema,
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
  const headerRequestId = ctx.http?.req?.headers.get('x-request-id') ?? undefined;
  const token = httpAuth?.token ?? options?.getFallbackBearerToken?.() ?? undefined;
  return {
    rawBearerToken: token,
    correlationId: headerRequestId && headerRequestId.trim().length > 0 ? headerRequestId : randomUUID(),
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
    'prepare_invoice_and_posting_proposal',
    {
      title: 'Przygotuj bezpieczną propozycję faktury i dekretacji (bez księgowania)',
      description:
        'Tworzy audytowany, idempotentny szkic faktury i propozycji zaksięgowania ze statusem pending_human_approval. Nigdy nie dokonuje trwałego zapisu w księgach bez odrębnego zatwierdzenia człowieka.',
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
      title: 'Zatwierdź przygotowaną propozycję (wymaga kodu potwierdzenia człowieka)',
      description:
        'Operacja krytyczna: zatwierdza wcześniej przygotowany szkic wyłącznie po podaniu świeżego, jednorazowego tokenu potwierdzenia człowieka (confirmationCode) i zgodnego skrótu expectedPayloadHash.',
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

  return server;
}
