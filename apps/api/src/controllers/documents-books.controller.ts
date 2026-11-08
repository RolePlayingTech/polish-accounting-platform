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
import type {
  ApproveAndPostDocumentRequest,
  CreateDocumentRequest,
  CreateJournalEntryRequest,
  CreateKpirEntryRequest,
  CreateRyczaltEntryRequest,
} from '@pap/contracts';
import {
  JwtBearerAuthGuard,
  RequireHumanApprovalScope,
  requireRequestActor,
  type JwtAuthenticatedRequest,
} from '../auth/jwt-bearer.guard.js';
import {
  ACCOUNTING_WORKSPACE_SERVICE,
  type WorkspaceRuntimePort,
} from '../runtime/workspace-runtime.js';
import { parseOptionalPeriodParam } from './query-helpers.js';

@Controller('/api/v1/tenants/:tenantId/companies/:legalEntityId')
@UseGuards(JwtBearerAuthGuard)
export class DocumentsBooksController {
  constructor(
    @Inject(ACCOUNTING_WORKSPACE_SERVICE)
    private readonly workspace: WorkspaceRuntimePort,
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
  @RequireHumanApprovalScope()
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
    const overrides =
      body === undefined || body === null ? undefined : (body as ApproveAndPostDocumentRequest);
    return this.workspace.approveAndPostDocument(
      actor,
      tenantId,
      legalEntityId,
      documentId,
      overrides,
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

  @Post(['/kpir', '/kpir/entries'])
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

  @Post(['/ryczalt', '/ryczalt/entries'])
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

  @Post(['/ledger', '/ledger/entries', '/ledger/journal-entries'])
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
