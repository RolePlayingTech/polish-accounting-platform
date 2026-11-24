import { randomUUID } from 'node:crypto';
import {
  GetAuditLineageInputSchema,
  GetAuditLineageOutputSchema,
  GetMonthCloseChecklistInputSchema,
  GetMonthCloseChecklistOutputSchema,
  PrepareMonthCloseInputSchema,
  PrepareMonthCloseOutputSchema,
  Sha256HexSchema,
  UuidSelectorSchema,
  type GetAuditLineageOutput,
  type GetMonthCloseChecklistOutput,
  type McpAuditLineageItem,
  type PrepareMonthCloseOutput,
} from '@pap/contracts/mcp-tools';
import type { LegalEntityId, TenantId } from '@pap/domain';
import {
  authorizeCompanyScopedMcpTool,
  buildAuditUnavailableError,
  denyMcpToolCall,
  recordMcpAuditFailClosed,
  type McpGateEnvironment,
} from '../gate-runner.js';
import {
  constantTimeHexEquals,
  redactSecretsAndPiiForMcp,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
} from '../security-and-redaction.js';
import type { McpCallContext, McpGatewayToolResult } from '../types.js';

async function evaluateMonthCloseChecklistInternal(
  env: McpGateEnvironment,
  tenantId: TenantId,
  legalEntityId: LegalEntityId,
  period: string,
): Promise<{
  readonly missingDocuments: GetMonthCloseChecklistOutput['missingDocuments'];
  readonly unverifiedAiProposals: GetMonthCloseChecklistOutput['unverifiedAiProposals'];
  readonly unreconciledBankTransfers: GetMonthCloseChecklistOutput['unreconciledBankTransfers'];
  readonly upcomingDeclarations: GetMonthCloseChecklistOutput['upcomingDeclarations'];
  readonly blockingItemsCount: number;
  readonly anyInjection: boolean;
}> {
  const rawChecklist = await env.dataSource.getMonthCloseRawData(tenantId, legalEntityId, period);
  const obligations = await env.dataSource.listMonthlyTaxObligations(
    tenantId,
    legalEntityId,
    period,
  );

  let anyInjection = false;

  const missingDocuments = rawChecklist.missingDocuments.map((doc) => {
    const noteEnv = doc.contextNote
      ? sanitizeUntrustedDocumentTextForMcp(doc.contextNote, {
          field: 'checklist.missingDocument.contextNote',
          maxLength: 400,
        })
      : null;
    if (noteEnv?.promptInjectionSuspected) {
      anyInjection = true;
    }
    return {
      code: doc.code,
      descriptionPl: doc.descriptionPl,
      blocking: doc.blocking,
      contextNote: noteEnv,
    };
  });

  const nowMs = env.clock.now().getTime();
  const pendingProposalsForPeriod: GetMonthCloseChecklistOutput['unverifiedAiProposals'] = [];
  for (const proposal of env.state.proposalsById.values()) {
    if (
      proposal.tenantId === tenantId &&
      proposal.legalEntityId === legalEntityId &&
      (proposal.status === 'pending_human_approval' || proposal.status === 'confirming') &&
      nowMs < proposal.expiresAtMs &&
      proposal.invoice.issueDate.startsWith(period)
    ) {
      const counterpartyEnv = sanitizeUntrustedDocumentTextForMcp(
        proposal.invoice.counterpartyName,
        { field: 'proposal.counterpartyName', maxLength: 300 },
      );
      if (counterpartyEnv.promptInjectionSuspected) {
        anyInjection = true;
      }
      pendingProposalsForPeriod.push({
        proposalId: proposal.proposalId,
        createdAt: proposal.createdAtIso,
        grossAmountPln: proposal.invoice.grossAmountPln,
        counterpartyName: counterpartyEnv,
      });
    }
  }

  const unreconciledBankTransfers = rawChecklist.unreconciledBankTransfers.map((tx) => {
    const titleEnv = sanitizeUntrustedDocumentTextForMcp(tx.transferTitle, {
      field: 'bankTransfer.transferTitle',
      maxLength: 500,
    });
    if (titleEnv.promptInjectionSuspected) {
      anyInjection = true;
    }
    return {
      bankTransactionId: tx.bankTransactionId,
      bookingDate: tx.bookingDate,
      amountPln: tx.amountPln,
      transferTitle: titleEnv,
    };
  });

  const upcomingDeclarations = obligations.map((ob) => ({
    code: ob.code,
    namePl: ob.namePl,
    dueDate: ob.dueDate,
    status: ob.status,
  }));

  const blockingMissingCount = missingDocuments.filter((d) => d.blocking).length;
  const blockingItemsCount =
    blockingMissingCount + pendingProposalsForPeriod.length + unreconciledBankTransfers.length;

  return {
    missingDocuments,
    unverifiedAiProposals: pendingProposalsForPeriod,
    unreconciledBankTransfers,
    upcomingDeclarations,
    blockingItemsCount,
    anyInjection,
  };
}

export async function handleGetMonthCloseChecklist(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetMonthCloseChecklistOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetMonthCloseChecklistInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_month_close_checklist',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry listy kontrolnej zamknięcia miesiąca.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'get_month_close_checklist',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const evaluated = await evaluateMonthCloseChecklistInternal(
    env,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_month_close_checklist',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: auth.actor.reason,
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: evaluated.anyInjection,
  });

  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: GetMonthCloseChecklistOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      readyToClose: evaluated.blockingItemsCount === 0,
      blockingItemsCount: evaluated.blockingItemsCount,
      missingDocuments: evaluated.missingDocuments,
      unverifiedAiProposals: evaluated.unverifiedAiProposals,
      unreconciledBankTransfers: evaluated.unreconciledBankTransfers,
      upcomingDeclarations: evaluated.upcomingDeclarations,
      auditEventId,
    }),
  };
}

export async function handlePrepareMonthClose(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PrepareMonthCloseOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PrepareMonthCloseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_month_close',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe parametry przygotowania zamknięcia okresu (wymagany okres RRRR-MM i UUID idempotencyKey).',
    });
  }

  const input = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const isDryRun = input.dryRun === true;

  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'prepare_month_close',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'write',
    requiredScopes: ['pap:mcp:prepare'],
    idempotencyKey: normalizedIdemKey,
  });
  if (!auth.ok) {
    return auth;
  }

  if (
    env.dataSource.isPeriodClosed &&
    (await env.dataSource.isPeriodClosed(
      auth.actor.tenantId,
      auth.actor.legalEntityId,
      input.period,
    ))
  ) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_month_close',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'period_closed',
      reasonCode: 'period_already_closed',
      messagePl: `Okres ${input.period} został już zamknięty.`,
    });
  }

  const idemSlotKey = `${auth.actor.userId}:${auth.actor.tenantId}:${normalizedIdemKey}`;
  const requestCanonicalHash = sha256Hex(
    JSON.stringify({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      dryRun: isDryRun,
    }),
  );

  return env.mutex.runExclusive([`month-close-idem:${idemSlotKey}`], async () => {
    const existingIdem = env.state.monthCloseIdempotency.get(idemSlotKey);
    if (existingIdem) {
      if (!constantTimeHexEquals(existingIdem.requestCanonicalHash, requestCanonicalHash)) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_month_close',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'idempotency_key_payload_conflict',
          reasonCode: 'month_close_idempotency_conflict',
          messagePl:
            'Klucz idempotencyKey został już użyty dla innego okresu lub trybu zamknięcia miesiąca.',
        });
      }

      const replayAuditId = await recordMcpAuditFailClosed(env, {
        toolName: 'prepare_month_close',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        outcome: 'allow',
        reasonCode: 'month_close_prepare_idempotent_replay',
        idempotencyKey: normalizedIdemKey,
        proposalId: existingIdem.responseData.proposalId,
        payloadHash: existingIdem.responseData.payloadHash,
        promptInjectionSuspected: false,
      });
      if (!replayAuditId) {
        return buildAuditUnavailableError();
      }

      return {
        ok: true,
        data: PrepareMonthCloseOutputSchema.parse({
          ...existingIdem.responseData,
          idempotentReplay: true,
          auditEventId: replayAuditId,
        }),
      };
    }

    const evaluated = await evaluateMonthCloseChecklistInternal(
      env,
      auth.actor.tenantId,
      auth.actor.legalEntityId,
      input.period,
    );

    const blockingMissingCount = evaluated.missingDocuments.filter((d) => d.blocking).length;
    const blockingReasonsPl: string[] = [];
    if (blockingMissingCount > 0) {
      blockingReasonsPl.push(
        `Brakujące lub niezweryfikowane dokumenty blokujące zamknięcie: ${blockingMissingCount}.`,
      );
    }
    if (evaluated.unverifiedAiProposals.length > 0) {
      blockingReasonsPl.push(
        `Oczekujące niezatwierdzone propozycje AI/MCP w okresie ${input.period}: ${evaluated.unverifiedAiProposals.length}.`,
      );
    }
    if (evaluated.unreconciledBankTransfers.length > 0) {
      blockingReasonsPl.push(
        `Nieuzgodnione przelewy bankowe w okresie ${input.period}: ${evaluated.unreconciledBankTransfers.length}.`,
      );
    }

    const readyToClose = evaluated.blockingItemsCount === 0;
    const payloadHash = sha256Hex(
      JSON.stringify({
        kind: 'month_close_v1',
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        period: input.period,
        blockingItemsCount: evaluated.blockingItemsCount,
      }),
    );

    const proposalId = readyToClose && !isDryRun ? randomUUID() : null;
    const status: PrepareMonthCloseOutput['status'] = !readyToClose
      ? 'blocked_by_checklist'
      : isDryRun
        ? 'dry_run_ready'
        : 'pending_human_approval';

    const auditEventId = await recordMcpAuditFailClosed(env, {
      toolName: 'prepare_month_close',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      outcome: 'allow',
      reasonCode: readyToClose
        ? 'month_close_proposal_ready_pending_human_approval'
        : 'month_close_blocked_by_checklist',
      idempotencyKey: normalizedIdemKey,
      proposalId,
      payloadHash,
      promptInjectionSuspected: evaluated.anyInjection,
    });
    if (!auditEventId) {
      return buildAuditUnavailableError();
    }

    if (proposalId) {
      env.state.monthCloseProposalsById.set(proposalId, {
        proposalId,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        period: input.period,
        createdByUserId: auth.actor.userId,
        idempotencyKey: normalizedIdemKey,
        payloadHash,
        createdAtIso: env.clock.now().toISOString(),
        status: 'pending_human_approval',
      });
    }

    const output = PrepareMonthCloseOutputSchema.parse({
      proposalId,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      period: input.period,
      status,
      periodClosed: false,
      readyToClose,
      blockingItemsCount: evaluated.blockingItemsCount,
      blockingReasonsPl,
      idempotencyKey: normalizedIdemKey,
      idempotentReplay: false,
      payloadHash,
      checklistSummary: {
        missingDocumentsCount: blockingMissingCount,
        unverifiedAiProposalsCount: evaluated.unverifiedAiProposals.length,
        unreconciledBankTransfersCount: evaluated.unreconciledBankTransfers.length,
      },
      humanApprovalInstructionsPl: !readyToClose
        ? 'Okres nie może zostać zamknięty przed rozwiązaniem wszystkich pozycji blokujących checklisty.'
        : isDryRun
          ? 'Symulacja zamknięcia okresu pozytywna (dryRun=true) — okres pozostaje otwarty.'
          : 'Plan zamknięcia okresu oczekuje na zatwierdzenie przez uprawnionego człowieka w interfejsie aplikacji (periodClosed=false).',
      auditEventId,
    });

    env.state.monthCloseIdempotency.set(idemSlotKey, {
      requestCanonicalHash,
      responseData: output,
    });

    return {
      ok: true,
      data: output,
    };
  });
}

export async function handleGetAuditLineage(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<GetAuditLineageOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = GetAuditLineageInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'get_audit_lineage',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry zapytania o ślad audytowy (get_audit_lineage).',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'get_audit_lineage',
    correlationId,
    rawBearerToken: callContext.rawBearerToken,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    action: 'read',
    requiredScopes: ['pap:mcp:read'],
  });
  if (!auth.ok) {
    return auth;
  }

  const outcomeFilter = input.outcomeFilter ?? 'all';
  const combined: McpAuditLineageItem[] = [];
  const seenIds = new Set<string>();

  if (env.dataSource.listCompanyAuditEvents) {
    const externalEvents = await env.dataSource.listCompanyAuditEvents(
      auth.actor.tenantId,
      auth.actor.legalEntityId,
    );
    for (const ev of externalEvents) {
      if (outcomeFilter !== 'all' && ev.outcome !== outcomeFilter) {
        continue;
      }
      if (seenIds.has(ev.auditEventId)) {
        continue;
      }
      seenIds.add(ev.auditEventId);
      combined.push({
        auditEventId: ev.auditEventId.slice(0, 128),
        occurredAt: ev.occurredAt,
        channel: ev.channel,
        toolOrAction: ev.action.slice(0, 160),
        outcome: ev.outcome,
        reasonCode: (redactSecretsAndPiiForMcp(ev.reasonCode) ?? 'redacted').slice(0, 160),
        correlationId: null,
        proposalId: null,
        payloadHash: null,
        promptInjectionSuspected: false,
        redactedSummaryPl: (redactSecretsAndPiiForMcp(ev.summaryPl) ?? 'Zdarzenie audytowe').slice(
          0,
          600,
        ),
      });
    }
  }

  for (const mcpEv of env.state.recordedAuditHistory) {
    if (
      mcpEv.tenantId !== auth.actor.tenantId ||
      mcpEv.legalEntityId !== auth.actor.legalEntityId
    ) {
      continue;
    }
    if (outcomeFilter !== 'all' && mcpEv.outcome !== outcomeFilter) {
      continue;
    }
    if (seenIds.has(mcpEv.auditEventId)) {
      continue;
    }
    seenIds.add(mcpEv.auditEventId);
    const validPropId =
      mcpEv.proposalId && UuidSelectorSchema.safeParse(mcpEv.proposalId).success
        ? mcpEv.proposalId.toLowerCase()
        : null;
    const validHash =
      mcpEv.payloadHash && Sha256HexSchema.safeParse(mcpEv.payloadHash).success
        ? mcpEv.payloadHash.toLowerCase()
        : null;
    const safeReason = (redactSecretsAndPiiForMcp(mcpEv.reasonCode) ?? 'redacted').slice(0, 160);
    combined.push({
      auditEventId: mcpEv.auditEventId,
      occurredAt: mcpEv.occurredAt,
      channel: 'mcp',
      toolOrAction: mcpEv.toolName.slice(0, 160),
      outcome: mcpEv.outcome,
      reasonCode: safeReason,
      correlationId: mcpEv.correlationId.slice(0, 128),
      proposalId: validPropId,
      payloadHash: validHash,
      promptInjectionSuspected: mcpEv.promptInjectionSuspected,
      redactedSummaryPl: `MCP ${mcpEv.toolName}: ${mcpEv.outcome} (${safeReason})`.slice(0, 600),
    });
  }

  combined.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  const limit = input.limit ?? 50;
  let startIndex = 0;
  if (input.cursor) {
    const idx = combined.findIndex((e) => e.auditEventId === input.cursor);
    startIndex = idx >= 0 ? idx + 1 : combined.length;
  }
  const page = combined.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < combined.length && page.length > 0
      ? page[page.length - 1]!.auditEventId
      : null;

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'get_audit_lineage',
    correlationId,
    actorUserId: auth.actor.userId,
    actorIssuer: auth.actor.identity.issuer,
    actorSubject: auth.actor.identity.subject,
    tenantId: auth.actor.tenantId,
    legalEntityId: auth.actor.legalEntityId,
    outcome: 'allow',
    reasonCode: 'audit_lineage_returned_redacted',
    idempotencyKey: null,
    proposalId: null,
    payloadHash: null,
    promptInjectionSuspected: false,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: GetAuditLineageOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      piiRedacted: true,
      events: page,
      nextCursor,
      auditEventId,
    }),
  };
}
