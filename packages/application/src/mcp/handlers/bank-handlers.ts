import { randomUUID } from 'node:crypto';
import {
  ConfirmBankReconciliationInputSchema,
  ConfirmBankReconciliationOutputSchema,
  ListUnreconciledBankTransactionsInputSchema,
  ListUnreconciledBankTransactionsOutputSchema,
  PrepareBankReconciliationInputSchema,
  PrepareBankReconciliationOutputSchema,
  type ConfirmBankReconciliationOutput,
  type ListUnreconciledBankTransactionsOutput,
  type PrepareBankReconciliationOutput,
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
  formatGroszeToPln,
  parsePlnToGrosze,
  resolveSafeRequestCorrelationId,
  sanitizeUntrustedDocumentTextForMcp,
  sha256Hex,
} from '../security-and-redaction.js';
import type {
  McpCallContext,
  McpGatewayToolResult,
  StoredBankReconciliationProposal,
  UnreconciledBankTransactionRecord,
} from '../types.js';

async function loadEffectiveUnreconciledTransactions(
  env: McpGateEnvironment,
  tenantId: TenantId,
  legalEntityId: LegalEntityId,
  period?: string,
): Promise<readonly UnreconciledBankTransactionRecord[]> {
  if (env.dataSource.listUnreconciledBankTransactions) {
    const direct = await env.dataSource.listUnreconciledBankTransactions(
      tenantId,
      legalEntityId,
      period,
    );
    return direct.filter(
      (tx) =>
        tx.tenantId === tenantId &&
        tx.legalEntityId === legalEntityId &&
        (!period || tx.bookingDate.startsWith(period)),
    );
  }

  const periodsToScan = new Set<string>();
  if (period) {
    periodsToScan.add(period);
  } else {
    periodsToScan.add(env.clock.now().toISOString().slice(0, 7));
    const openInvoices = await env.dataSource.listUnpaidInvoices(tenantId, legalEntityId);
    for (const inv of openInvoices) {
      periodsToScan.add(inv.issueDate.slice(0, 7));
      periodsToScan.add(inv.dueDate.slice(0, 7));
    }
  }

  const seenTxIds = new Set<string>();
  const collected: UnreconciledBankTransactionRecord[] = [];
  for (const p of periodsToScan) {
    const rawChecklist = await env.dataSource.getMonthCloseRawData(tenantId, legalEntityId, p);
    for (const tx of rawChecklist.unreconciledBankTransfers) {
      const normalizedId = tx.bankTransactionId.toLowerCase();
      if (seenTxIds.has(normalizedId)) {
        continue;
      }
      seenTxIds.add(normalizedId);
      const signedGrosze = parsePlnToGrosze(tx.amountPln);
      const absGrosze = signedGrosze < 0n ? -signedGrosze : signedGrosze;
      collected.push({
        bankTransactionId: tx.bankTransactionId,
        tenantId,
        legalEntityId,
        bookingDate: tx.bookingDate,
        direction: signedGrosze < 0n ? 'debit' : 'credit',
        amountPln: tx.amountPln,
        remainingUnallocatedPln: formatGroszeToPln(absGrosze),
        counterpartyName: tx.counterpartyName ?? 'Kontrahent przelewu bankowego',
        transferTitle: tx.transferTitle,
      });
    }
  }
  return collected;
}

export function computeCanonicalBankReconciliationPayloadHash(params: {
  readonly tenantId: string;
  readonly legalEntityId: string;
  readonly bankTransactionId: string;
  readonly invoiceId: string;
  readonly allocationGrossPln: string;
}): string {
  return sha256Hex(
    JSON.stringify({
      kind: 'bank_reconciliation_v1',
      tenantId: params.tenantId.toLowerCase(),
      legalEntityId: params.legalEntityId.toLowerCase(),
      bankTransactionId: params.bankTransactionId.toLowerCase(),
      invoiceId: params.invoiceId.toLowerCase(),
      allocationGrossPln: params.allocationGrossPln,
    }),
  );
}

export async function handleListUnreconciledBankTransactions(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ListUnreconciledBankTransactionsOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ListUnreconciledBankTransactionsInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'list_unreconciled_bank_transactions',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl: 'Nieprawidłowe parametry wywołania list_unreconciled_bank_transactions.',
    });
  }

  const input = parsed.data;
  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'list_unreconciled_bank_transactions',
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

  const allTxs = await loadEffectiveUnreconciledTransactions(
    env,
    auth.actor.tenantId,
    auth.actor.legalEntityId,
    input.period,
  );

  const filtered: ListUnreconciledBankTransactionsOutput['transactions'] = [];
  let promptInjectionWarningsCount = 0;
  let anyInjection = false;

  for (const tx of allTxs) {
    const effectiveRem = parsePlnToGrosze(tx.remainingUnallocatedPln);
    if (effectiveRem <= 0n) {
      continue;
    }

    const cpEnv = sanitizeUntrustedDocumentTextForMcp(tx.counterpartyName, {
      field: 'bankTransaction.counterpartyName',
      maxLength: 300,
    });
    const titleEnv = sanitizeUntrustedDocumentTextForMcp(tx.transferTitle, {
      field: 'bankTransaction.transferTitle',
      maxLength: 500,
    });
    if (cpEnv.promptInjectionSuspected || titleEnv.promptInjectionSuspected) {
      promptInjectionWarningsCount += 1;
      anyInjection = true;
    }

    filtered.push({
      bankTransactionId: tx.bankTransactionId.toLowerCase(),
      bookingDate: tx.bookingDate,
      direction: tx.direction,
      amountPln: tx.amountPln,
      remainingUnallocatedPln: formatGroszeToPln(effectiveRem),
      currency: 'PLN',
      counterpartyName: cpEnv,
      transferTitle: titleEnv,
    });
  }

  const limit = input.limit ?? 50;
  let startIndex = 0;
  if (input.cursor) {
    const foundIdx = filtered.findIndex((t) => t.bankTransactionId === input.cursor?.toLowerCase());
    startIndex = foundIdx >= 0 ? foundIdx + 1 : filtered.length;
  }
  const page = filtered.slice(startIndex, startIndex + limit);
  const nextCursor =
    startIndex + limit < filtered.length && page.length > 0
      ? page[page.length - 1]!.bankTransactionId
      : null;

  const auditEventId = await recordMcpAuditFailClosed(env, {
    toolName: 'list_unreconciled_bank_transactions',
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
    promptInjectionSuspected: anyInjection,
  });
  if (!auditEventId) {
    return buildAuditUnavailableError();
  }

  return {
    ok: true,
    data: ListUnreconciledBankTransactionsOutputSchema.parse({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      transactions: page,
      nextCursor,
      promptInjectionWarningsCount,
      auditEventId,
    }),
  };
}

export async function handlePrepareBankReconciliation(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<PrepareBankReconciliationOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = PrepareBankReconciliationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_bank_reconciliation',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Nieprawidłowe parametry propozycji uzgodnienia bankowego (wymagane UUID bankTransactionId, invoiceId, idempotencyKey oraz dodatnia kwota allocationGrossPln).',
    });
  }

  const input = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const normalizedTxId = input.bankTransactionId.toLowerCase();
  const normalizedInvoiceId = input.invoiceId.toLowerCase();
  const isDryRun = input.dryRun === true;

  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'prepare_bank_reconciliation',
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

  const allocationGrosze = parsePlnToGrosze(input.allocationGrossPln);
  if (allocationGrosze <= 0n) {
    return denyMcpToolCall(env, {
      toolName: 'prepare_bank_reconciliation',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      errorCode: 'validation_failed',
      reasonCode: 'zero_allocation_amount',
      messagePl: 'Kwota alokacji (allocationGrossPln) musi być większa od 0.00 PLN.',
    });
  }

  const idemSlotKey = `${auth.actor.userId}:${auth.actor.tenantId}:${normalizedIdemKey}`;
  const requestCanonicalHash = sha256Hex(
    JSON.stringify({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      bankTransactionId: normalizedTxId,
      invoiceId: normalizedInvoiceId,
      allocationGrossPln: input.allocationGrossPln,
      dryRun: isDryRun,
    }),
  );

  return env.mutex.runExclusive(
    [
      `bank-prep-idem:${idemSlotKey}`,
      `bank-tx:${normalizedTxId}`,
      `inv-alloc:${normalizedInvoiceId}`,
    ],
    async () => {
      const existingIdem = env.state.bankPrepareIdempotency.get(idemSlotKey);
      if (existingIdem) {
        if (!constantTimeHexEquals(existingIdem.requestCanonicalHash, requestCanonicalHash)) {
          return denyMcpToolCall(env, {
            toolName: 'prepare_bank_reconciliation',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            idempotencyKey: normalizedIdemKey,
            errorCode: 'idempotency_key_payload_conflict',
            reasonCode: 'bank_prepare_idempotency_conflict',
            messagePl:
              'Klucz idempotencyKey został już użyty z innymi parametrami alokacji bankowej.',
          });
        }

        let liveStatus = existingIdem.responseData.status;
        if (existingIdem.responseData.proposalId) {
          const liveProp = env.state.bankProposalsById.get(existingIdem.responseData.proposalId);
          if (liveProp?.status === 'confirmed') {
            liveStatus = 'confirmed';
          } else if (liveProp && env.clock.now().getTime() >= liveProp.expiresAtMs) {
            liveStatus = 'expired';
          }
        }

        const replayAuditId = await recordMcpAuditFailClosed(env, {
          toolName: 'prepare_bank_reconciliation',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          outcome: 'allow',
          reasonCode: 'bank_prepare_idempotent_replay',
          idempotencyKey: normalizedIdemKey,
          proposalId: existingIdem.responseData.proposalId,
          payloadHash: existingIdem.responseData.payloadHash,
          promptInjectionSuspected: existingIdem.responseData.promptInjectionSuspected,
        });
        if (!replayAuditId) {
          return buildAuditUnavailableError();
        }

        return {
          ok: true,
          data: PrepareBankReconciliationOutputSchema.parse({
            ...existingIdem.responseData,
            status: liveStatus,
            idempotentReplay: true,
            auditEventId: replayAuditId,
          }),
        };
      }

      const unpaidInvoices = await env.dataSource.listUnpaidInvoices(
        auth.actor.tenantId,
        auth.actor.legalEntityId,
      );
      const targetInvoice = unpaidInvoices.find(
        (i) =>
          i.invoiceId.toLowerCase() === normalizedInvoiceId &&
          i.tenantId === auth.actor.tenantId &&
          i.legalEntityId === auth.actor.legalEntityId,
      );
      if (!targetInvoice) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_bank_reconciliation',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'resource_not_found',
          reasonCode: 'unpaid_invoice_not_found',
          messagePl: 'Nie znaleziono otwartej faktury do rozliczenia we wskazanej firmie.',
        });
      }

      const invoicePeriod = targetInvoice.issueDate.slice(0, 7);
      const candidateTxs = [
        ...(await loadEffectiveUnreconciledTransactions(
          env,
          auth.actor.tenantId,
          auth.actor.legalEntityId,
        )),
        ...(await loadEffectiveUnreconciledTransactions(
          env,
          auth.actor.tenantId,
          auth.actor.legalEntityId,
          invoicePeriod,
        )),
      ];
      const targetTx = candidateTxs.find(
        (t) => t.bankTransactionId.toLowerCase() === normalizedTxId,
      );
      if (!targetTx) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_bank_reconciliation',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'resource_not_found',
          reasonCode: 'unreconciled_bank_transaction_not_found',
          messagePl: 'Nie znaleziono nieuzgodnionej transakcji bankowej w wybranej firmie.',
        });
      }

      const expectedTxDir = targetInvoice.direction === 'purchase' ? 'debit' : 'credit';
      if (targetTx.direction !== expectedTxDir) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_bank_reconciliation',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'validation_failed',
          reasonCode: 'bank_transaction_direction_mismatch',
          messagePl:
            'Kierunek przelewu bankowego (uznanie/obciążenie) nie zgadza się z kierunkiem rozrachunku faktury (sprzedaż/zakup).',
        });
      }

      const effectiveInvRem = parsePlnToGrosze(targetInvoice.remainingGrossAmountPln);
      const effectiveTxRem = parsePlnToGrosze(targetTx.remainingUnallocatedPln);

      if (allocationGrosze > effectiveInvRem || allocationGrosze > effectiveTxRem) {
        return denyMcpToolCall(env, {
          toolName: 'prepare_bank_reconciliation',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          errorCode: 'amount_mismatch',
          reasonCode: 'allocation_exceeds_open_settlement_or_transaction_balance',
          messagePl: `Kwota alokacji (${input.allocationGrossPln} PLN) przekracza otwarte saldo faktury (${formatGroszeToPln(effectiveInvRem)} PLN) lub niealokowaną kwotę przelewu (${formatGroszeToPln(effectiveTxRem)} PLN).`,
        });
      }

      const titleEnv = sanitizeUntrustedDocumentTextForMcp(targetTx.transferTitle, {
        field: 'bankTransaction.transferTitle',
        maxLength: 500,
      });
      const invDescEnv = sanitizeUntrustedDocumentTextForMcp(targetInvoice.description, {
        field: 'invoice.description',
        maxLength: 500,
      });
      const promptInjectionSuspected =
        titleEnv.promptInjectionSuspected || invDescEnv.promptInjectionSuspected;

      const payloadHash = computeCanonicalBankReconciliationPayloadHash({
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        bankTransactionId: normalizedTxId,
        invoiceId: normalizedInvoiceId,
        allocationGrossPln: input.allocationGrossPln,
      });

      const now = env.clock.now();
      const createdAtIso = now.toISOString();
      const expiresAtMs = now.getTime() + env.proposalTtlMs;
      const expiresAtIso = new Date(expiresAtMs).toISOString();
      const proposalId = isDryRun ? null : randomUUID();

      const auditEventId = await recordMcpAuditFailClosed(env, {
        toolName: 'prepare_bank_reconciliation',
        correlationId,
        actorUserId: auth.actor.userId,
        actorIssuer: auth.actor.identity.issuer,
        actorSubject: auth.actor.identity.subject,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        outcome: 'allow',
        reasonCode: isDryRun
          ? 'bank_reconciliation_dry_run_preview'
          : 'bank_reconciliation_proposal_created_pending_human_approval',
        idempotencyKey: normalizedIdemKey,
        proposalId,
        payloadHash,
        promptInjectionSuspected,
      });
      if (!auditEventId) {
        return buildAuditUnavailableError();
      }

      const remainingInvAfterPln = formatGroszeToPln(effectiveInvRem - allocationGrosze);
      const remainingTxAfterPln = formatGroszeToPln(effectiveTxRem - allocationGrosze);

      if (!isDryRun && proposalId) {
        const stored: StoredBankReconciliationProposal = {
          proposalId,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          createdByUserId: auth.actor.userId,
          idempotencyKey: normalizedIdemKey,
          payloadHash,
          bankTransactionId: normalizedTxId,
          invoiceId: normalizedInvoiceId,
          allocationGrossPln: input.allocationGrossPln,
          remainingInvoiceGrossBeforePln: formatGroszeToPln(effectiveInvRem),
          remainingInvoiceGrossAfterPln: remainingInvAfterPln,
          remainingTransactionGrossAfterPln: remainingTxAfterPln,
          createdAtIso,
          expiresAtMs,
          expiresAtIso,
          status: 'pending_human_approval',
          reconciliationEntryId: null,
          confirmedAtIso: null,
          confirmedByUserId: null,
          promptInjectionSuspected,
        };
        env.state.bankProposalsById.set(proposalId, stored);
      }

      const output = PrepareBankReconciliationOutputSchema.parse({
        proposalId,
        dryRun: isDryRun,
        tenantId: auth.actor.tenantId,
        legalEntityId: auth.actor.legalEntityId,
        status: isDryRun ? 'dry_run_preview' : 'pending_human_approval',
        bankWriteExecuted: false,
        idempotencyKey: normalizedIdemKey,
        idempotentReplay: false,
        payloadHash,
        bankTransactionId: normalizedTxId,
        invoiceId: normalizedInvoiceId,
        allocationGrossPln: input.allocationGrossPln,
        remainingInvoiceGrossBeforePln: formatGroszeToPln(effectiveInvRem),
        remainingInvoiceGrossAfterPln: remainingInvAfterPln,
        remainingTransactionGrossAfterPln: remainingTxAfterPln,
        createdAt: createdAtIso,
        expiresAt: isDryRun ? null : expiresAtIso,
        promptInjectionSuspected,
        humanApprovalInstructionsPl: isDryRun
          ? 'Podgląd symulacyjny (dryRun=true) — brak zapisu rozrachunku.'
          : 'Propozycja alokacji płatności oczekuje na niezależne zatwierdzenie człowieka powiązane ze skrótem payloadHash.',
        auditEventId,
      });

      env.state.bankPrepareIdempotency.set(idemSlotKey, {
        requestCanonicalHash,
        responseData: output,
      });

      return {
        ok: true,
        data: output,
      };
    },
  );
}

export async function handleConfirmBankReconciliationProposal(
  env: McpGateEnvironment,
  callContext: McpCallContext,
  rawInput: unknown,
): Promise<McpGatewayToolResult<ConfirmBankReconciliationOutput>> {
  const { correlationId } = resolveSafeRequestCorrelationId(callContext.correlationId);
  const parsed = ConfirmBankReconciliationInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_bank_reconciliation_proposal',
      correlationId,
      errorCode: 'validation_failed',
      reasonCode: 'invalid_input_schema',
      messagePl:
        'Wymagane są poprawne parametry: proposalId, idempotencyKey, expectedPayloadHash oraz jawny confirmationCode człowieka.',
    });
  }

  const input = parsed.data;
  const normalizedIdemKey = input.idempotencyKey.toLowerCase();
  const normalizedProposalId = input.proposalId.toLowerCase();

  const auth = await authorizeCompanyScopedMcpTool(env, {
    toolName: 'confirm_bank_reconciliation_proposal',
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
      toolName: 'confirm_bank_reconciliation_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      proposalId: normalizedProposalId,
      errorCode: 'agent_self_approval_forbidden',
      reasonCode: 'autonomous_agent_cannot_confirm_bank_allocation',
      messagePl:
        'Agent autonomiczny MCP nie może samodzielnie zatwierdzić rozliczenia przelewu bankowego.',
    });
  }

  const persistBankReconciliation = env.dataSource.applyConfirmedBankReconciliation;
  if (!persistBankReconciliation) {
    return denyMcpToolCall(env, {
      toolName: 'confirm_bank_reconciliation_proposal',
      correlationId,
      actorUserId: auth.actor.userId,
      actorIssuer: auth.actor.identity.issuer,
      actorSubject: auth.actor.identity.subject,
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      idempotencyKey: normalizedIdemKey,
      proposalId: normalizedProposalId,
      errorCode: 'capability_unsupported',
      reasonCode: 'bank_reconciliation_persistence_adapter_missing',
      messagePl:
        'Zatwierdzanie uzgodnień bankowych przez MCP wymaga aktywnego adaptera trwałego zapisu rozrachunków (użyj modułu Finanse w UI/REST — brak pozornego zapisu wyłącznie w RAM).',
    });
  }

  const idemSlotKey = `${auth.actor.userId}:${auth.actor.tenantId}:${normalizedIdemKey}`;
  const confirmRequestHash = sha256Hex(
    JSON.stringify({
      tenantId: auth.actor.tenantId,
      legalEntityId: auth.actor.legalEntityId,
      proposalId: normalizedProposalId,
      expectedPayloadHash: input.expectedPayloadHash,
    }),
  );

  return env.mutex.runExclusive(
    [`bank-proposal:${normalizedProposalId}`, `bank-confirm-idem:${idemSlotKey}`],
    async () => {
      const existingConfirm = env.state.bankConfirmIdempotency.get(idemSlotKey);
      if (existingConfirm) {
        if (!constantTimeHexEquals(existingConfirm.requestCanonicalHash, confirmRequestHash)) {
          return denyMcpToolCall(env, {
            toolName: 'confirm_bank_reconciliation_proposal',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            idempotencyKey: normalizedIdemKey,
            proposalId: normalizedProposalId,
            errorCode: 'idempotency_key_payload_conflict',
            reasonCode: 'bank_confirm_idempotency_conflict',
            messagePl:
              'Klucz idempotencyKey został już użyty do potwierdzenia innego rozliczenia bankowego.',
          });
        }

        const replayAuditId = await recordMcpAuditFailClosed(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          outcome: 'allow',
          reasonCode: 'bank_confirm_idempotent_replay',
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
          data: ConfirmBankReconciliationOutputSchema.parse({
            ...existingConfirm.responseData,
            idempotentReplay: true,
            auditEventId: replayAuditId,
          }),
        };
      }

      const proposal = env.state.bankProposalsById.get(normalizedProposalId);
      if (
        !proposal ||
        proposal.tenantId !== auth.actor.tenantId ||
        proposal.legalEntityId !== auth.actor.legalEntityId
      ) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_not_found_or_forbidden',
          reasonCode: 'bank_proposal_not_found_in_authorized_entity',
          messagePl: 'Nie znaleziono wskazanej propozycji uzgodnienia bankowego w wybranej firmie.',
        });
      }

      const now = env.clock.now();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();

      if (proposal.status !== 'pending_human_approval') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_already_processed',
          reasonCode: 'bank_proposal_not_pending',
          messagePl: 'Propozycja uzgodnienia bankowego została już wcześniej przetworzona.',
        });
      }

      if (nowMs >= proposal.expiresAtMs) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'proposal_expired',
          reasonCode: 'bank_proposal_ttl_expired',
          messagePl: 'Ważność propozycji uzgodnienia bankowego wygasła.',
        });
      }

      if (!constantTimeHexEquals(proposal.payloadHash, input.expectedPayloadHash)) {
        return denyMcpToolCall(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
          correlationId,
          actorUserId: auth.actor.userId,
          actorIssuer: auth.actor.identity.issuer,
          actorSubject: auth.actor.identity.subject,
          tenantId: auth.actor.tenantId,
          legalEntityId: auth.actor.legalEntityId,
          idempotencyKey: normalizedIdemKey,
          proposalId: normalizedProposalId,
          errorCode: 'payload_hash_mismatch',
          reasonCode: 'bank_proposal_payload_hash_mismatch',
          messagePl: 'Skrót zawartości propozycji alokacji (payloadHash) uległ zmianie.',
        });
      }

      const challenge = env.state.humanChallengesByProposal.get(normalizedProposalId);
      if (!challenge || challenge.proposalKind !== 'bank_reconciliation') {
        return denyMcpToolCall(env, {
          toolName: 'confirm_bank_reconciliation_proposal',
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
          messagePl:
            'Brak świeżego potwierdzenia człowieka dla tej propozycji rozliczenia bankowego.',
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
          toolName: 'confirm_bank_reconciliation_proposal',
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

      // Atomic live balance re-check on BOTH invoice AND bank transaction (#108 anti-double-allocation!)
      return env.mutex.runExclusive(
        [`bank-tx:${proposal.bankTransactionId}`, `inv-alloc:${proposal.invoiceId}`],
        async () => {
          const allocationGrosze = parsePlnToGrosze(proposal.allocationGrossPln);
          const unpaidList = await env.dataSource.listUnpaidInvoices(
            auth.actor.tenantId,
            auth.actor.legalEntityId,
          );
          const liveInvoice = unpaidList.find(
            (i) =>
              i.tenantId === auth.actor.tenantId &&
              i.legalEntityId === auth.actor.legalEntityId &&
              i.invoiceId.toLowerCase() === proposal.invoiceId,
          );
          const liveInvRem = liveInvoice
            ? parsePlnToGrosze(liveInvoice.remainingGrossAmountPln)
            : -1n;

          if (!liveInvoice || liveInvRem < allocationGrosze) {
            return denyMcpToolCall(env, {
              toolName: 'confirm_bank_reconciliation_proposal',
              correlationId,
              actorUserId: auth.actor.userId,
              actorIssuer: auth.actor.identity.issuer,
              actorSubject: auth.actor.identity.subject,
              tenantId: auth.actor.tenantId,
              legalEntityId: auth.actor.legalEntityId,
              idempotencyKey: normalizedIdemKey,
              proposalId: normalizedProposalId,
              errorCode: 'amount_mismatch',
              reasonCode: 'concurrent_allocation_exhausted_invoice_balance',
              messagePl:
                'Saldo rozrachunku faktury uległo zmniejszeniu przed zatwierdzeniem — podwójna alokacja została zablokowana.',
            });
          }

          const candidatePeriods = new Set<string>([
            proposal.createdAtIso.slice(0, 7),
            liveInvoice.issueDate.slice(0, 7),
            liveInvoice.dueDate.slice(0, 7),
          ]);
          const liveTxCandidates: UnreconciledBankTransactionRecord[] = [
            ...(await loadEffectiveUnreconciledTransactions(
              env,
              auth.actor.tenantId,
              auth.actor.legalEntityId,
            )),
          ];
          for (const p of candidatePeriods) {
            liveTxCandidates.push(
              ...(await loadEffectiveUnreconciledTransactions(
                env,
                auth.actor.tenantId,
                auth.actor.legalEntityId,
                p,
              )),
            );
          }
          const liveTx = liveTxCandidates.find(
            (tx) =>
              tx.tenantId === auth.actor.tenantId &&
              tx.legalEntityId === auth.actor.legalEntityId &&
              tx.bankTransactionId.toLowerCase() === proposal.bankTransactionId,
          );
          const liveTxRem = liveTx ? parsePlnToGrosze(liveTx.remainingUnallocatedPln) : -1n;

          if (!liveTx || liveTxRem < allocationGrosze) {
            return denyMcpToolCall(env, {
              toolName: 'confirm_bank_reconciliation_proposal',
              correlationId,
              actorUserId: auth.actor.userId,
              actorIssuer: auth.actor.identity.issuer,
              actorSubject: auth.actor.identity.subject,
              tenantId: auth.actor.tenantId,
              legalEntityId: auth.actor.legalEntityId,
              idempotencyKey: normalizedIdemKey,
              proposalId: normalizedProposalId,
              errorCode: 'amount_mismatch',
              reasonCode: 'concurrent_allocation_exhausted_bank_transaction_balance',
              messagePl:
                'Niealokowane saldo transakcji bankowej uległo zmniejszeniu przed zatwierdzeniem — podwójna alokacja przelewu została zablokowana.',
            });
          }

          proposal.status = 'confirming';
          challenge.consumingInFlight = true;

          const auditEventId = await recordMcpAuditFailClosed(env, {
            toolName: 'confirm_bank_reconciliation_proposal',
            correlationId,
            actorUserId: auth.actor.userId,
            actorIssuer: auth.actor.identity.issuer,
            actorSubject: auth.actor.identity.subject,
            tenantId: auth.actor.tenantId,
            legalEntityId: auth.actor.legalEntityId,
            outcome: 'allow',
            reasonCode: 'bank_reconciliation_confirmed_with_human_token',
            idempotencyKey: normalizedIdemKey,
            proposalId: normalizedProposalId,
            payloadHash: proposal.payloadHash,
            promptInjectionSuspected: false,
          });

          if (!auditEventId) {
            proposal.status = 'pending_human_approval';
            challenge.consumingInFlight = false;
            return buildAuditUnavailableError();
          }

          let applied: {
            readonly reconciliationEntryId: string;
            readonly remainingInvoiceGrossAfterPln: string;
          };
          try {
            applied = await persistBankReconciliation.call(env.dataSource, {
              tenantId: auth.actor.tenantId,
              legalEntityId: auth.actor.legalEntityId,
              bankTransactionId: proposal.bankTransactionId,
              invoiceId: proposal.invoiceId,
              allocationGrossPln: proposal.allocationGrossPln,
              confirmedByUserId: auth.actor.userId,
            });
          } catch {
            proposal.status = 'pending_human_approval';
            challenge.consumingInFlight = false;
            return denyMcpToolCall(env, {
              toolName: 'confirm_bank_reconciliation_proposal',
              correlationId,
              actorUserId: auth.actor.userId,
              actorIssuer: auth.actor.identity.issuer,
              actorSubject: auth.actor.identity.subject,
              tenantId: auth.actor.tenantId,
              legalEntityId: auth.actor.legalEntityId,
              idempotencyKey: normalizedIdemKey,
              proposalId: normalizedProposalId,
              errorCode: 'amount_mismatch',
              reasonCode: 'bank_reconciliation_persistence_rejected',
              messagePl:
                'Trwały zapis rozliczenia bankowego został odrzucony z powodu równoległej zmiany salda rozrachunku lub przelewu.',
            });
          }

          challenge.consumingInFlight = false;
          challenge.consumedAtIso = nowIso;
          proposal.status = 'confirmed';
          proposal.reconciliationEntryId = applied.reconciliationEntryId;
          proposal.confirmedAtIso = nowIso;
          proposal.confirmedByUserId = auth.actor.userId;

          const output = ConfirmBankReconciliationOutputSchema.parse({
            proposalId: proposal.proposalId,
            tenantId: proposal.tenantId,
            legalEntityId: proposal.legalEntityId,
            status: 'confirmed',
            allocationApplied: true,
            reconciliationEntryId: applied.reconciliationEntryId,
            bankTransactionId: proposal.bankTransactionId,
            invoiceId: proposal.invoiceId,
            allocatedGrossPln: proposal.allocationGrossPln,
            remainingInvoiceGrossAfterPln: applied.remainingInvoiceGrossAfterPln,
            confirmedAt: nowIso,
            confirmedPayloadHash: proposal.payloadHash,
            idempotencyKey: normalizedIdemKey,
            idempotentReplay: false,
            auditEventId,
          });

          env.state.bankConfirmIdempotency.set(idemSlotKey, {
            requestCanonicalHash: confirmRequestHash,
            responseData: output,
          });

          return {
            ok: true,
            data: output,
          };
        },
      );
    },
  );
}
