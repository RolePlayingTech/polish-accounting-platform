import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AccountingWorkspaceService } from '@pap/application';
import type {
  ApproveAndPostDocumentRequest,
  CreateDocumentRequest,
  CreateJournalEntryRequest,
  CreateKpirEntryRequest,
  CreateRyczaltEntryRequest,
} from '@pap/contracts';
import {
  JwtBearerAuthGuard,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import { ACCOUNTING_WORKSPACE_SERVICE } from '../runtime/workspace-runtime.js';
import { parseOptionalPeriodParam } from './query-helpers.js';

const APPROVE_REQUEST_ALLOWED_KEYS = new Set([
  'documentId',
  'suggestedCategory',
  'vatDeductionMode',
  'kpirQualification',
  'ryczaltRate',
  'ledgerAccountCode',
  'correctedEntryId',
  'correctionReason',
]);

const BFF_COMPAT_EXTRA_APPROVE_KEYS = new Set([
  'counterpartyNip',
  'counterpartyName',
  'netPln',
  'vatPln',
  'description',
  'kpirColumnNumber',
  'vatRateCode',
  'ryczaltRateCode',
]);

function normalizeApprovePayload(body: unknown): ApproveAndPostDocumentRequest | undefined {
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return body as ApproveAndPostDocumentRequest;
  }
  const raw = body as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (APPROVE_REQUEST_ALLOWED_KEYS.has(key)) {
      cleaned[key] = value;
      continue;
    }
    if (BFF_COMPAT_EXTRA_APPROVE_KEYS.has(key)) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned as ApproveAndPostDocumentRequest;
}

@Controller('/api/v1/tenants/:tenantId/companies/:legalEntityId')
@UseGuards(JwtBearerAuthGuard)
export class DocumentsBooksController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: AccountingWorkspaceService,
  ) {}

  @Get('/documents')
  @Header('Cache-Control', 'no-store')
  listDocuments(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.listDocuments(actor, tenantId, legalEntityId, period);
  }

  @Post('/documents')
  @Header('Cache-Control', 'no-store')
  createDocument(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.createDocument(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as CreateDocumentRequest,
    );
  }

  @Get('/documents/:documentId')
  @Header('Cache-Control', 'no-store')
  getDocument(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('documentId') documentId: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getDocument(actor, tenantId, legalEntityId, documentId);
  }

  @Post('/documents/:documentId/approve-and-post')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  approveAndPostDocument(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Param('documentId') documentId: string,
    @Body() body?: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.approveAndPostDocument(
      actor,
      tenantId,
      legalEntityId,
      documentId,
      normalizeApprovePayload(body),
    );
  }

  @Get('/kpir')
  @Header('Cache-Control', 'no-store')
  getKpir(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getKpirView(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Post('/kpir')
  @Header('Cache-Control', 'no-store')
  createKpirEntry(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.createKpirManualEntry(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as CreateKpirEntryRequest,
    );
  }

  @Post('/kpir/storno')
  @Header('Cache-Control', 'no-store')
  createKpirStorno(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    const payload =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? ({ ...(body as Record<string, unknown>), mode: 'storno' } as CreateKpirEntryRequest)
        : ({ mode: 'storno' } as CreateKpirEntryRequest);
    return this.workspace.createKpirManualEntry(actor, tenantId, legalEntityId, payload);
  }

  @Get('/zus')
  @Header('Cache-Control', 'no-store')
  getZus(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.calculateCompanyZus(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Get('/ryczalt')
  @Header('Cache-Control', 'no-store')
  getRyczalt(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getRyczaltView(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Post('/ryczalt')
  @Header('Cache-Control', 'no-store')
  createRyczaltEntry(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.createRyczaltManualEntry(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as CreateRyczaltEntryRequest,
    );
  }

  @Get('/vat')
  @Header('Cache-Control', 'no-store')
  getVat(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getVatView(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Get('/ledger')
  @Header('Cache-Control', 'no-store')
  getLedger(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Query('period') period?: string,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.getLedgerView(
      actor,
      tenantId,
      legalEntityId,
      parseOptionalPeriodParam(period),
    );
  }

  @Post('/ledger')
  @Header('Cache-Control', 'no-store')
  createJournalEntry(
    @Req() request: JwtAuthenticatedRequest,
    @Param('tenantId') tenantId: string,
    @Param('legalEntityId') legalEntityId: string,
    @Body() body: unknown,
  ) {
    const actor = requireRequestActor(request);
    return this.workspace.createJournalEntry(
      actor,
      tenantId,
      legalEntityId,
      (body ?? {}) as CreateJournalEntryRequest,
    );
  }
}
