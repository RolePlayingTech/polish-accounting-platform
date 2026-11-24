import { randomUUID } from 'node:crypto';
import {
  ConfirmMonthCloseInputSchema,
  ConfirmMonthCloseOutputSchema,
  GetAuditLineageInputSchema,
  GetAuditLineageOutputSchema,
  GetMonthCloseChecklistInputSchema,
  GetMonthCloseChecklistOutputSchema,
  PrepareMonthCloseInputSchema,
  PrepareMonthCloseOutputSchema,
  Sha256HexSchema,
  UuidSelectorSchema,
  type ConfirmMonthCloseOutput,
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
  isAutonomousAgentToken,
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

      let liveStatus = existingIdem.responseData.status;
      let livePeriodClosed = existingIdem.responseData.periodClosed;
      if (existingIdem.responseData.proposalId) {
        const liveProp = env.state.monthCloseProposalsById.get(
          existingIdem.responseData.proposalId,
        );
        if (liveProp?.status === 'confirmed') {
          liveStatus = 'confirmed';
          livePeriodClosed = true;
        } else if (liveProp && env.clock.now().getTime() >= liveProp.expiresAtMs) {
          liveStatus = 'expired';
        }
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
          status: liveStatus,
          periodClosed: livePeriodClosed,
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

    const now = env.clock.now();
    const createdAtIso = now.toISOString();
    const expiresAtMs = now.getTime() + env.proposalTtlMs;
    const expiresAtIso = new Date(expiresAtMs).toISOString();

    if (proposalId) {
      env.state.monthCloseProposalsById.set(proposalId, {
        proposalId,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        period: input.period,
        createdByUserId: auth.actor.userId,
        idempotencyKey: normalizedIdemKey,
        payloadHash,
        createdAtIso,
        expiresAtMs,
        expiresAtIso,
        status: 'pending_human_approval',
        closedAtIso: null,
        confirmedByUserId: null,
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
      expiresAt: proposalId ? expiresAtIso : null,
      checklistSummary: {
        missingDocumentsCount: blockingMissingCount,
        unverifiedAiProposalsCount: evaluated.unverifiedAiProposals.length,
        unreconciledBankTransfersCount: evaluated.unreconciledBankTransfers.length,
      },
      humanApprovalInstructionsPl: !readyToClose
        ? 'Okres nie może zostać zamknięty przed rozwiązaniem wszystkich pozycji blokujących checklisty.'
        : isDryRun
          ? 'Symulacja zamknięcia okresu pozytywna (dryRun=true) — okres pozostaje otwarty.'
          : 'Plan zamknięcia okresu oczekuje na niezależne zatwierdzenie przez uprawnionego człowieka (confirm_month_close_proposal z kodem confirmationCode; periodClosed=false).',
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

export async function handleConfirmMonthCloseProposal(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ConfirmMonthCloseOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ConfirmMonthCloseInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_month_close_proposal',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe parametry potwierdzenia zamknięcia okresu (wymagane proposalId, expectedPayloadHash, confirmationCode oraz UUID idempotencyKey).',
    });
  }

  const input = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const normalizedProposalId = input.proposalId.toLowerCase();

  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'confirm_month_close_proposal',
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

  if (isAutonomousAgentToken(auth.actor.identity)) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_month_close_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      proposalId: normalizedProposalId,
      errorCode: 'agent_self_approval_forbidden',
      reasonCode: 'autonomous_agent_cannot_confirm_month_close',
      messagePl:
        'Agent autonomiczny MCP nie może samodzielnie zamknąć okresu sprawozdawczego (#116). Wymagane niezależne zatwierdzenie człowieka.',
    });
  }

  const persistMonthClose = env.dataSource.applyConfirmedMonthClose;
  if (!persistMonthClose) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_month_close_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      proposalId: normalizedProposalId,
      errorCode: 'capability_unsupported',
      reasonCode: 'month_close_persistence_adapter_missing',
      messagePl:
        'Zatwierdzanie zamknięcia okresu przez MCP wymaga aktywnego adaptera trwałego zapisu statusu okresu (#116 — brak pozornego zamknięcia wyłącznie w RAM).',
    });
  }

  const idemSlotKey = `${auth.actor.userId}:${auth.actor.tenantId}:${normalizedIdemKey}`;
  const confirmRequestHash = sha256Hex(
    JSON.stringify({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      proposalId: normalizedProposalId,
      expectedPayloadHash: input.expectedPayloadHash,
      note: input.note ?? null,
    }),
  );

  return env.mutex.runExclusive(
    [`month-close-proposal:${normalizedProposalId}`, `month-close-confirm-idem:${idemSlotKey}`],
    async () => {
      const existingConfirm = env.state.monthCloseConfirmIdempotency.get(idemSlotKey);
      if (existingConfirm) {
        if (!constantTimeHexEquals(existingConfirm.requestCanonicalHash, confirmRequestHash)) {
          return denyMcpToolCall(env, {
            toolName: 'confirm_month_close_proposal',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            idempotencyKey: normalizedIdemKey,
            proposalId: normalizedProposalId,
            errorCode: 'idempotency_key_payload_conflict',
            reasonCode: 'month_close_confirm_idempotency_conflict',
            messagePl:
              'Klucz idempotencyKey został już użyty do potwierdzenia innej operacji zamknięcia okresu.',
          });
        }

        const replayAuditId = await recordMcpAuditFailClosed(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          outcome: 'allow',
          reasonCode: 'month_close_confirm_idempotent_replay',
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          payloadHash: existingConfirm.responseData.confirmedPayloadHash,
          promptInjectionSuspected: false,
        });
        if (!replayAuditId) {
          return buildAuditUnavailableError();
        }

        return {
          ok: true,
          data: ConfirmMonthCloseOutputSchema.parse({
            ...existingConfirm.responseData,
            idempotentReplay: true,
            auditEventId: replayAuditId,
          }),
        };
      }

      const proposal = env.state.monthCloseProposalsById.get(normalizedProposalId);
      if (
        !proposal ||
        proposal.tenantId !== auth.actor.tenantId ||
        proposal.legalEntityId !== auth.actor.legalEntityId
      ) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_not_found_or_forbidden',
          reasonCode: 'month_close_proposal_not_found_in_authorized_entity',
          messagePl: 'Nie znaleziono wskazanej propozycji zamknięcia okresu w wybranej firmie.',
        });
      }

      const now = env.clock.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();

      if (proposal.status !== 'pending_human_approval') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_already_processed',
          reasonCode: 'month_close_proposal_not_pending',
          messagePl: 'Propozycja zamknięcia okresu została już wcześniej przetworzona.',
        });
      }

      if (nowMs >= proposal.expiresAtMs) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_expired',
          reasonCode: 'month_close_proposal_ttl_expired',
          messagePl: 'Ważność propozycji zamknięcia okresu wygasła.',
        });
      }

      if (!constantTimeHexEquals(proposal.payloadHash, input.expectedPayloadHash)) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'payload_hash_mismatch',
          reasonCode: 'month_close_proposal_payload_hash_mismatch',
          messagePl: 'Skrót propozycji zamknięcia okresu (payloadHash) uległ zmianie.',
        });
      }

      const challenge = env.state.humanChallengesByProposal.get(normalizedProposalId);
      if (!challenge || challenge.proposalKind !== 'month_close') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'human_confirmation_required',
          reasonCode: 'missing_fresh_human_confirmation_challenge',
          messagePl: 'Brak świeżego potwierdzenia człowieka dla propozycji zamknięcia okresu.',
        });
      }

      const providedCodeHash = sha256Hex(input.confirmationCode.trim());
      const challengeMatches =
        !challenge.consumingInFlight &&
        challenge.consumedAtIso === null &&
        nowMs < challenge.expiresAtMs &&
        challenge.authorizedHumanUserId === auth.actor.userId &&
        challenge.tenantId === auth.actor.tenantId &&
        challenge.legalEntityId === auth.actor.legalEntityId &&
        constantTimeHexEquals(challenge.expectedPayloadHash, proposal.payloadHash) &&
        constantTimeHexEquals(challenge.codeSha256Hex, providedCodeHash);

      if (!challengeMatches) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'invalid_confirmation_code',
          reasonCode: 'confirmation_code_invalid_expired_or_wrong_actor',
          messagePl:
            'Kod potwierdzenia człowieka jest nieprawidłowy, wygasł, został już użyty lub należy do innego użytkownika.',
        });
      }

      if (
        env.dataSource.isPeriodClosed &&
        (await env.dataSource.isPeriodClosed(
          auth.actor.tenantId,
          auth.actor.legalEntityId,
          proposal.period,
        ))
      ) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'period_closed',
          reasonCode: 'period_already_closed',
          messagePl: `Okres ${proposal.period} został już zamknięty.`,
        });
      }

      const liveChecklist = await evaluateMonthCloseChecklistInternal(
        env,
        auth.actor.tenantId,
        auth.actor.legalEntityId,
        proposal.period,
      );
      if (liveChecklist.blockingItemsCount > 0) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'checklist_blocked',
          reasonCode: 'month_close_checklist_no_longer_clean',
          messagePl: `Okres ${proposal.period} nie może zostać zamknięty: pojawiły się nowe pozycje blokujące (${liveChecklist.blockingItemsCount}).`,
        });
      }

      proposal.status = 'confirming';
      challenge.consumingInFlight = true;

      const auditEventId = await recordMcpAuditFailClosed(env, {
        toolName: 'confirm_month_close_proposal',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        outcome: 'allow',
        reasonCode: 'month_close_confirmed_with_human_token',
        idempotencyKey: normalizedIdemKey,
        proposalId: normalizedProposalId,
        payloadHash: proposal.payloadHash,
        promptInjectionSuspected: liveChecklist.anyInjection,
      });

      if (!auditEventId) {
        proposal.status = 'pending_human_approval';
        challenge.consumingInFlight = false;
        return buildAuditUnavailableError();
      }

      let closedAtIso = nowIso;
      try {
        const applied = await persistMonthClose.call(env.dataSource, {
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          period: proposal.period,
          proposalId: proposal.proposalId,
          confirmedByUserId: auth.actor.userId,
          note: input.note,
        });
        if (applied && typeof applied === 'object' && applied.closedAt) {
          closedAtIso = applied.closedAt;
        }
      } catch {
        proposal.status = 'pending_human_approval';
        challenge.consumingInFlight = false;
        return denyMcpToolCall(env, {
          toolName: 'confirm_month_close_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'checklist_blocked',
          reasonCode: 'month_close_persistence_rejected',
          messagePl:
            'Trwały zapis zamknięcia okresu został odrzucony (okres już zamknięty lub wykryto równoległą blokadę).',
        });
      }

      challenge.consumingInFlight = false;
      challenge.consumedAtIso = nowIso;
      proposal.status = 'confirmed';
      proposal.closedAtIso = closedAtIso;
      proposal.confirmedByUserId = auth.actor.userId;

      const output = ConfirmMonthCloseOutputSchema.parse({
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        legalEntityId: proposal.legalEntityId,
        period: proposal.period,
        status: 'confirmed',
        periodClosed: true,
        closedAt: closedAtIso,
        confirmedPayloadHash: proposal.payloadHash,
        idempotencyKey: normalizedIdemKey,
        idempotentReplay: false,
        auditEventId,
      });

      env.state.monthCloseConfirmIdempotency.set(idemSlotKey, {
        requestCanonicalHash: confirmRequestHash,
        responseData: output,
      });

      return {
        ok: true,
        data: output,
      };
    },
  );
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
