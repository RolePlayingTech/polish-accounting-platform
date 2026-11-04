import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AccountingWorkspaceValidationError,
  DEMO_DEFAULT_PERIOD,
  sha256Hex,
  type AccountingWorkspaceService,
} from '@pap/application';
import type { PapMcpGateway } from '@pap/application/mcp-gateway';
import {
  IssueMcpChallengeResponseSchema,
  type ConfirmMcpProposalRequest,
  type DispatchDueNotificationsRequest,
  type ImportBankStatementRequest,
  type ReconcileBankRequest,
  type RejectMcpProposalRequest,
  type UpdateNotificationPreferencesRequest,
  type UpdateObligationStatusRequest,
} from '@pap/contracts';
import { ReminderStageSchema } from '@pap/contracts/notifications';
import {
  legalEntityId as parseLegalEntityId,
  tenantId as parseTenantId,
  userId as parseUserId,
} from '@pap/domain';
import { z } from 'zod';
import {
  JwtBearerAuthGuard,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import { ACCOUNTING_WORKSPACE_SERVICE, PAP_MCP_GATEWAY } from '../runtime/workspace-runtime.js';
import { parseOptionalPeriodParam } from './query-helpers.js';

const SendTestNotificationBodySchema = z
  .object({
    toAddress: z.string().min(3).max(254).optional(),
    recipientEmail: z.string().min(3).max(254).optional(),
    to: z.string().min(3).max(254).optional(),
    stage: ReminderStageSchema.optional(),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional(),
  })
  .strict();

function parseCalendarQuery(
  rawYear?: string,
  rawMonth?: string,
  rawPeriod?: string,
): { readonly year: number; readonly month: number | null; readonly period: string } {
  if (rawPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(rawPeriod)) {
    const [y, m] = rawPeriod.split('-');
    return { year: Number(y), month: Number(m), period: rawPeriod };
  }
  const year = rawYear !== undefined ? Number(rawYear) : 2026;
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw new AccountingWorkspaceValidationError(
      400,
      'invalid_calendar_year',
      'Rok kalendarza musi należeć do przedziału 2020..2100.',
    );
  }
  if (rawMonth === 'all' || rawMonth === 'null') {
    return { year, month: null, period: `${year}-03` };
  }
  const month = rawMonth !== undefined ? Number(rawMonth) : 3;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new AccountingWorkspaceValidationError(
      400,
      'invalid_calendar_month',
      'Miesiąc kalendarza musi należeć do przedziału 1..12.',
    );
  }
  return { year, month, period: `${year}-${String(month).padStart(2, '0')}` };
}

@Controller('/api/v1/tenants/:tenantId/companies/:legalEntityId')
@UseGuards(JwtBearerAuthGuard)
export class OperationsAutomationController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: AccountingWorkspaceService,
    @Inject(PAP_MCP_GATEWAY)
    private readonly mcpGateway: PapMcpGateway,
  ) {}

  @Get('/finance')
  @Header('Cache-Control', 'no-store')
  getFinance(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getFinanceView(actor, tenantId, legalEntityId);
  }

  @Post('/finance/bank-import')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  importBank(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.importBankStatement(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as ImportBankStatementRequest,
    );
  }

  @Post('/finance/reconcile')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reconcileBank(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    if (
      typeof body === 'object' &&
      body !== null &&
      'matches' in body &&
      Array.isArray((body as { matches?: unknown }).matches)
    ) {
      const rawMatches = (body as { matches: unknown[] }).matches;
      const needsDocMapping = rawMatches.some(
        (m) =>
          typeof m === 'object' && m !== null && !('settlementId' in m) && 'matchedDocumentId' in m,
      );
      if (needsDocMapping) {
        const finance = this.workspace.getFinanceView(actor, tenantId, legalEntityId);
        const mapped = rawMatches
          .filter(
            (m): m is Record<string, unknown> =>
              typeof m === 'object' &&
              m !== null &&
              typeof (m as Record<string, unknown>).matchedDocumentId === 'string',
          )
          .flatMap((m) => {
            const found = finance.settlements.find((s) => s.documentId === m.matchedDocumentId);
            if (!found || typeof m.transactionId !== 'string') {
              return [];
            }
            return [
              {
                transactionId: m.transactionId,
                settlementId: found.settlementId,
                ...(typeof m.settledAmountGrosze === 'number'
                  ? { amountGrosze: m.settledAmountGrosze }
                  : {}),
              },
            ];
          });
        if (mapped.length === 0) {
          return finance;
        }
        return this.workspace.reconcileBank(actor, tenantId, legalEntityId, { matches: mapped });
      }
    }
    return this.workspace.reconcileBank(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as ReconcileBankRequest,
    );
  }

  @Get('/calendar')
  @Header('Cache-Control', 'no-store')
  getCalendar(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    const parsed = parseCalendarQuery(year, month, period);
    return this.workspace.getCalendarView(
      actor,
      tenantId,
      legalEntityId,
      parsed.year,
      parsed.month,
    );
  }

  @Post('/calendar/obligations/:obligationId/toggle-paid')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  toggleObligationPaid(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('obligationId') obligationId: string,
    @Query('period') queryPeriod?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const period = parseOptionalPeriodParam(queryPeriod) ?? DEMO_DEFAULT_PERIOD;
    const explicitBody =
      typeof body === 'object' && body !== null && 'status' in body
        ? (body as UpdateObligationStatusRequest)
        : null;
    if (explicitBody) {
      return this.workspace.updateObligationStatus(
        actor,
        tenantId,
        legalEntityId,
        obligationId,
        explicitBody,
        period,
      );
    }
    const [y, m] = period.split('-');
    const calendar = this.workspace.getCalendarView(
      actor,
      tenantId,
      legalEntityId,
      Number(y),
      Number(m),
    );
    const current = calendar.obligations.find(
      (o) => o.obligationId === obligationId || o.code === obligationId,
    );
    const nextStatus = current?.workflowStatus === 'paid' ? 'upcoming' : 'paid';
    return this.workspace.updateObligationStatus(
      actor,
      tenantId,
      legalEntityId,
      obligationId,
      { status: nextStatus },
      period,
    );
  }

  @Patch('/calendar/obligations/:obligationId/status')
  @Header('Cache-Control', 'no-store')
  patchObligationStatus(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('obligationId') obligationId: string,
    @Query('period') queryPeriod?: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.updateObligationStatus(
      actor,
      tenantId,
      legalEntityId,
      obligationId,
      (body ?? {}) as UpdateObligationStatusRequest,
      parseOptionalPeriodParam(queryPeriod) ?? DEMO_DEFAULT_PERIOD,
    );
  }

  @Get('/notifications')
  @Header('Cache-Control', 'no-store')
  getNotifications(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getNotificationsView(actor, tenantId, legalEntityId);
  }

  @Get('/notifications/preferences')
  @Header('Cache-Control', 'no-store')
  getNotificationPreferences(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getNotificationsView(actor, tenantId, legalEntityId).preferences;
  }

  @Put('/notifications/preferences')
  @Header('Cache-Control', 'no-store')
  async updateNotificationPreferences(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.updateNotificationPreferences(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as UpdateNotificationPreferencesRequest,
    );
  }

  @Post('/notifications/dispatch-due')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async dispatchDueNotifications(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload =
      body !== undefined && body !== null ? (body as DispatchDueNotificationsRequest) : undefined;
    return this.workspace.dispatchDueNotifications(actor, tenantId, legalEntityId, payload);
  }

  @Get('/notifications/sandbox-mailbox')
  @Header('Cache-Control', 'no-store')
  getSandboxMailbox(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    const view = this.workspace.getNotificationsView(actor, tenantId, legalEntityId);
    return {
      deliveredMailbox: view.deliveredMailbox,
      messages: view.deliveredMailbox,
      sandboxPolicy: view.sandboxPolicy,
    };
  }

  @Post('/notifications/send-test')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async sendSandboxTestEmail(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    const parsed = SendTestNotificationBodySchema.parse(body ?? {});
    const target = parsed.toAddress ?? parsed.recipientEmail ?? parsed.to;
    if (!target) {
      throw new AccountingWorkspaceValidationError(
        400,
        'missing_recipient_email',
        'Wymagany jest adres odbiorcy (toAddress lub recipientEmail).',
      );
    }
    return this.workspace.sendSandboxReminderEmailFailClosed(actor, tenantId, legalEntityId, {
      toAddress: target,
      stage: parsed.stage,
      period: parsed.period,
    });
  }

  @Get('/mcp/proposals')
  @Header('Cache-Control', 'no-store')
  listMcpProposals(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.listMcpProposals(actor, tenantId, legalEntityId);
  }

  @Post('/mcp/proposals/:proposalId/challenge')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async issueMcpProposalChallenge(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('proposalId') proposalId: string,
  ) {
    const actor = requireRequestActor(request);
    if (this.mcpGateway.getStoredProposalSnapshot(proposalId) && actor.rawBearerToken) {
      const gatewayChallenge = await this.mcpGateway.issueHumanConfirmationChallenge({
        humanBearerToken: actor.rawBearerToken,
        tenantId,
        legalEntityId,
        proposalId,
        correlationId: actor.requestId,
      });
      if (gatewayChallenge.ok) {
        const expiresAtMs = new Date(gatewayChallenge.expiresAt).getTime();
        this.workspace.store.saveHumanChallenge({
          proposalId,
          tenantId: parseTenantId(tenantId),
          legalEntityId: parseLegalEntityId(legalEntityId),
          humanUserId: parseUserId(actor.userId),
          expectedPayloadHash: gatewayChallenge.payloadHash,
          codeSha256Hex: sha256Hex(gatewayChallenge.confirmationCode),
          expiresAtMs,
          expiresAtIso: gatewayChallenge.expiresAt,
          consumedAtIso: null,
        });
        return IssueMcpChallengeResponseSchema.parse({
          proposalId,
          confirmationCode: gatewayChallenge.confirmationCode,
          payloadHash: gatewayChallenge.payloadHash,
          expiresAt: gatewayChallenge.expiresAt,
          auditEventId: gatewayChallenge.auditEventId,
        });
      }
    }
    return this.workspace.issueMcpProposalChallenge(actor, tenantId, legalEntityId, proposalId);
  }

  @Post('/mcp/proposals/:proposalId/confirm')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  confirmMcpProposal(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.confirmMcpProposal(
      actor,
      tenantId,
      legalEntityId,
      proposalId,
      (body ?? {}) as ConfirmMcpProposalRequest,
    );
  }

  @Post('/mcp/proposals/:proposalId/reject')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  rejectMcpProposal(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('proposalId') proposalId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload =
      body !== undefined && body !== null ? (body as RejectMcpProposalRequest) : undefined;
    return this.workspace.rejectMcpProposal(actor, tenantId, legalEntityId, proposalId, payload);
  }
}
